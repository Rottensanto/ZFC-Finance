alter table public.invoice_items add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace function public.team_balance_cents(p_team_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(j.amount_cents), 0)::bigint from public.journal_entries j where j.team_id = p_team_id
$$;

create or replace function public.team_open_invoice_cents(p_team_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(i.total_cents), 0)::bigint from public.invoices i where i.team_id = p_team_id and i.status in ('open', 'overdue')
$$;

create or replace function public.account_snapshot(p_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_balance bigint;
  v_open bigint;
  v_claims bigint;
  v_reservations bigint;
begin
  if auth.uid() is null or not public.is_team_president(p_team_id) then raise exception 'Zugriff verweigert'; end if;
  v_balance := public.team_balance_cents(p_team_id);
  v_open := public.team_open_invoice_cents(p_team_id);
  select coalesce(sum(c.amount_cents), 0) into v_claims from public.sponsor_claims c
    where c.team_id = p_team_id and c.status in ('pending', 'approved');
  select coalesce(sum(i.total_cents), 0) into v_reservations from public.hq_reservations r
    join public.invoices i on i.id = r.invoice_id
    where r.team_id = p_team_id and r.status = 'pending' and i.status in ('open', 'overdue');
  return jsonb_build_object(
    'team_id', p_team_id,
    'balance_cents', v_balance,
    'open_invoices_cents', v_open,
    'open_claims_cents', v_claims,
    'reserved_purchases_cents', v_reservations,
    'available_cents', v_balance - v_open,
    'as_of', now()
  );
end;
$$;

create or replace function public.finance_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Zugriff verweigert'; end if;
  select jsonb_build_object(
    'season', (select to_jsonb(s) from public.seasons s where s.is_active limit 1),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'ownership_active', t.ownership_active,
        'balance_cents', public.team_balance_cents(t.id),
        'open_invoices_cents', public.team_open_invoice_cents(t.id),
        'open_claims_cents', (select coalesce(sum(c.amount_cents), 0) from public.sponsor_claims c where c.team_id = t.id and c.status in ('pending', 'approved'))
      ) order by t.name) from public.teams t
    ), '[]'::jsonb),
    'open_invoices', (select count(*) from public.invoices i where i.status in ('open', 'overdue')),
    'overdue_invoices', (select count(*) from public.invoices i where i.status = 'overdue' or (i.status = 'open' and i.due_on < current_date)),
    'pending_claims_cents', (select coalesce(sum(c.amount_cents), 0) from public.sponsor_claims c where c.status in ('pending', 'approved')),
    'fees_collected_cents', (select coalesce(sum(-j.amount_cents), 0) from public.journal_entries j where j.category = 'Liga-Gebühr' and j.amount_cents < 0),
    'recent_audit', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) from (select * from public.audit_logs order by created_at desc limit 12) a)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.request_team_presidency(p_team_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_request uuid;
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  if exists (select 1 from public.team_members m where m.user_id = auth.uid()) then
    raise exception 'Für dieses Konto ist bereits eine Teamzuordnung vorhanden';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.owner_id is null) then
    raise exception 'Dieses Team ist nicht verfügbar';
  end if;
  insert into public.team_presidency_requests(team_id, user_id)
  values (p_team_id, auth.uid()) returning id into v_request;
  perform public.audit_event('Teampräsidentschaft beantragt', 'team_request', v_request, p_team_id);
  return v_request;
end;
$$;

create or replace function public.review_team_presidency(p_request_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request public.team_presidency_requests%rowtype;
begin
  if auth.uid() is null or not public.is_league_admin() then raise exception 'Nur Liga-Administratoren dürfen Präsidenten zuordnen'; end if;
  select * into v_request from public.team_presidency_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then raise exception 'Anfrage ist nicht mehr offen'; end if;
  if p_approve then
    update public.teams set owner_id = v_request.user_id where id = v_request.team_id and owner_id is null;
    if not found then raise exception 'Team wurde inzwischen vergeben'; end if;
    insert into public.team_members(team_id, user_id, member_role) values (v_request.team_id, v_request.user_id, 'president');
    update public.profiles set role = 'team_president' where id = v_request.user_id and role = 'public_visitor';
  end if;
  update public.team_presidency_requests set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_request_id;
  perform public.audit_event(case when p_approve then 'Teampräsident zugeordnet' else 'Teampräsidentschaft abgelehnt' end,
    'team_request', p_request_id, v_request.team_id, jsonb_build_object('user_id', v_request.user_id));
end;
$$;

create or replace function public.create_team(p_name text, p_public_description text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_team_id uuid;
  v_season public.seasons%rowtype;
  v_start_cents bigint;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  if length(trim(p_name)) not between 2 and 80 then raise exception 'Teamname ungültig'; end if;
  select * into strict v_season from public.seasons where is_active for update;
  v_start_cents := v_season.initial_capital_cents;
  insert into public.teams(name, public_description, created_by)
    values (trim(p_name), left(coalesce(p_public_description, ''), 500), auth.uid()) returning id into v_team_id;
  insert into public.journal_entries(team_id, season_id, category, description, amount_cents, source_type, source_id, created_by)
    values (v_team_id, v_season.id, 'Startkapital', 'Einmaliges Team-Startkapital', v_start_cents, 'team_opening', v_team_id, auth.uid());
  insert into public.league_journal_entries(season_id, team_id, category, description, amount_cents, source_type, source_id)
    values (v_season.id, v_team_id, 'Startkapital', 'Startkapital an Team ausgegeben', -v_start_cents, 'team_opening', v_team_id);
  perform public.audit_event('Team angelegt und Startkapital einmalig gebucht', 'team', v_team_id, v_team_id,
    jsonb_build_object('start_capital_cents', v_start_cents));
  return v_team_id;
end;
$$;

create or replace function public.initialize_team_costs(p_team_id uuid, p_due_on date default current_date + 7)
returns setof uuid language plpgsql security definer set search_path = '' as $$
declare
  v_season public.seasons%rowtype;
  v_item jsonb;
  v_items jsonb;
  v_invoice_id uuid;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  perform 1 from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team nicht gefunden'; end if;
  if exists (select 1 from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
    where i.team_id = p_team_id and i.status <> 'cancelled' and ii.category = 'Teamkauf') then
    raise exception 'Grundkosten wurden bereits angelegt';
  end if;
  select * into strict v_season from public.seasons where is_active;
  for v_item in select value from jsonb_array_elements('[
    {"category":"Teamkauf","description":"Einmalige Teamübernahme","amount_cents":1200000000},
    {"category":"Lizenzen","description":"Teamlizenz Saison","amount_cents":120000000},
    {"category":"Lizenzen","description":"Fahrerlizenz Stammfahrer 1","amount_cents":20000000},
    {"category":"Lizenzen","description":"Fahrerlizenz Stammfahrer 2","amount_cents":20000000},
    {"category":"Teilnahmegebühr","description":"Saisonanmeldung","amount_cents":160000000},
    {"category":"Server und Technik","description":"Saison-Technikpaket","amount_cents":48000000},
    {"category":"Marketing","description":"Saison-Marketingpaket","amount_cents":80000000}
  ]'::jsonb)
  loop
    v_items := jsonb_build_array(v_item);
    v_invoice_id := public.create_invoice(p_team_id, v_season.id, v_item->>'description', p_due_on, v_items, true, null, null);
    return next v_invoice_id;
  end loop;
  perform public.audit_event('Sieben Grundkostenrechnungen erstellt', 'team', p_team_id, p_team_id);
end;
$$;

create or replace function public.create_invoice(
  p_team_id uuid, p_season_id uuid, p_title text, p_due_on date, p_items jsonb,
  p_issue boolean default true, p_idempotency_key text default null, p_correction_of uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_season public.seasons%rowtype;
  v_invoice_id uuid;
  v_number bigint;
  v_subtotal bigint := 0;
  v_fee bigint := 0;
  v_status public.invoice_status;
  v_item jsonb;
  v_category public.money_category;
  v_amount bigint;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  if length(trim(p_title)) not between 1 and 200 or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Rechnungsdaten ungültig';
  end if;
  if p_idempotency_key is not null then
    select id into v_invoice_id from public.invoices where team_id = p_team_id and idempotency_key = p_idempotency_key;
    if found then return v_invoice_id; end if;
  end if;
  select * into strict v_season from public.seasons where id = p_season_id for update;
  if not exists (select 1 from public.teams where id = p_team_id) then raise exception 'Team nicht gefunden'; end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category := (v_item->>'category')::public.money_category;
    v_amount := (v_item->>'amount_cents')::bigint;
    if v_amount <= 0 or length(trim(v_item->>'description')) not between 1 and 250 then raise exception 'Rechnungsposition ungültig'; end if;
    v_subtotal := v_subtotal + v_amount;
  end loop;
  if v_subtotal <= 0 then raise exception 'Rechnungssumme muss positiv sein'; end if;
  update public.seasons set next_invoice_number = next_invoice_number + 1 where id = p_season_id returning next_invoice_number - 1 into v_number;
  v_status := case when p_issue then 'open'::public.invoice_status else 'draft'::public.invoice_status end;
  v_fee := case when p_issue then v_season.invoice_fee_cents else 0 end;
  insert into public.invoices(invoice_number, season_id, team_id, title, due_on, status, subtotal_cents, fee_cents,
      created_by, approved_by, correction_of, idempotency_key)
    values ('ZFC-' || to_char(current_date, 'YYYY') || '-' || lpad(v_number::text, 6, '0'),
      p_season_id, p_team_id, trim(p_title), p_due_on, v_status, v_subtotal, v_fee, auth.uid(),
      case when p_issue then auth.uid() else null end, p_correction_of, p_idempotency_key)
    returning id into v_invoice_id;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category := (v_item->>'category')::public.money_category;
    v_amount := (v_item->>'amount_cents')::bigint;
    if v_amount <= 0 or length(trim(v_item->>'description')) not between 1 and 250 then raise exception 'Rechnungsposition ungültig'; end if;
    insert into public.invoice_items(invoice_id, category, description, amount_cents, metadata)
      values (v_invoice_id, v_category, trim(v_item->>'description'), v_amount, coalesce(v_item->'metadata', '{}'::jsonb));
  end loop;
  perform public.audit_event(case when p_issue then 'Rechnung ausgestellt' else 'Rechnungsentwurf erstellt' end,
    'invoice', v_invoice_id, p_team_id, jsonb_build_object('fee_cents', v_fee, 'total_cents', v_subtotal + v_fee));
  return v_invoice_id;
end;
$$;

create or replace function public.issue_invoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_invoice public.invoices%rowtype; v_fee bigint;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found or v_invoice.status <> 'draft' then raise exception 'Entwurf ist nicht mehr ausstellbar'; end if;
  select invoice_fee_cents into strict v_fee from public.seasons where id = v_invoice.season_id;
  update public.invoices set status = 'open', fee_cents = v_fee, approved_by = auth.uid() where id = p_invoice_id;
  perform public.audit_event('Rechnungsentwurf ausgestellt', 'invoice', p_invoice_id, v_invoice.team_id,
    jsonb_build_object('fee_cents', v_fee));
end;
$$;

create or replace function public.pay_invoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.invoices%rowtype;
  v_balance bigint;
  v_item record;
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found or not public.is_team_president(v_invoice.team_id) then raise exception 'Zugriff verweigert'; end if;
  perform 1 from public.teams where id = v_invoice.team_id for update;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.status not in ('open', 'overdue') then raise exception 'Rechnung ist nicht zahlbar'; end if;
  if v_invoice.due_on < current_date and v_invoice.status = 'open' then
    update public.invoices set status = 'overdue' where id = p_invoice_id;
    v_invoice.status := 'overdue';
  end if;
  v_balance := public.team_balance_cents(v_invoice.team_id);
  if v_balance < v_invoice.total_cents then raise exception 'Kontostand reicht nicht aus'; end if;
  for v_item in select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    insert into public.journal_entries(team_id, season_id, invoice_id, category, description, amount_cents, source_type, source_id, created_by)
      values (v_invoice.team_id, v_invoice.season_id, p_invoice_id, v_item.category, 'Rechnung ' || v_invoice.invoice_number || ': ' || v_item.description,
        -v_item.amount_cents, 'invoice_item', v_item.id, auth.uid());
    insert into public.league_journal_entries(season_id, team_id, category, description, amount_cents, source_type, source_id)
      values (v_invoice.season_id, v_invoice.team_id, v_item.category, 'Einnahme Rechnung ' || v_invoice.invoice_number || ': ' || v_item.description,
        v_item.amount_cents, 'invoice_item', v_item.id);
  end loop;
  if v_invoice.fee_cents > 0 then
    insert into public.journal_entries(team_id, season_id, invoice_id, category, description, amount_cents, source_type, source_id, created_by)
      values (v_invoice.team_id, v_invoice.season_id, p_invoice_id, 'Liga-Gebühr', 'Rechnungsgebühr ' || v_invoice.invoice_number,
        -v_invoice.fee_cents, 'invoice_fee', p_invoice_id, auth.uid());
    insert into public.league_journal_entries(season_id, team_id, category, description, amount_cents, source_type, source_id)
      values (v_invoice.season_id, v_invoice.team_id, 'Liga-Gebühr', 'Rechnungsgebühr ' || v_invoice.invoice_number,
        v_invoice.fee_cents, 'invoice_fee', p_invoice_id);
  end if;
  update public.invoices set status = 'paid', paid_at = now() where id = p_invoice_id;
  update public.hq_reservations set status = 'completed'
    where invoice_id = p_invoice_id and status = 'pending';
  update public.teams t set active_hq_offer_id = r.offer_id,
      ownership_active = true, acquired_at = coalesce(t.acquired_at, now())
    from public.hq_reservations r where r.invoice_id = p_invoice_id and r.team_id = t.id;
  update public.teams t set ownership_active = true, acquired_at = coalesce(t.acquired_at, now())
    where t.id = v_invoice.team_id and exists (
      select 1 from public.invoice_items ii where ii.invoice_id = p_invoice_id and ii.category = 'Teamkauf'
    );
  perform public.audit_event('Rechnung bezahlt', 'invoice', p_invoice_id, v_invoice.team_id,
    jsonb_build_object('total_cents', v_invoice.total_cents));
end;
$$;

create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_invoice public.invoices%rowtype; v_entry record;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Stornogrund erforderlich'; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found or v_invoice.status not in ('open', 'overdue', 'paid') then raise exception 'Rechnung kann nicht storniert werden'; end if;
  if exists (select 1 from public.invoice_items ii where ii.invoice_id = p_invoice_id and ii.category = 'Teamkauf')
     and exists (select 1 from public.teams t where t.id = v_invoice.team_id and t.active_hq_offer_id is not null) then
    raise exception 'Ein Teamkauf mit aktivem HQ kann nicht storniert werden';
  end if;
  if v_invoice.status = 'paid' then
    for v_entry in select * from public.journal_entries where invoice_id = p_invoice_id and reverses_entry_id is null
    loop
      insert into public.journal_entries(team_id, season_id, invoice_id, category, description, amount_cents, source_type, source_id, reverses_entry_id, created_by)
        values (v_entry.team_id, v_entry.season_id, p_invoice_id, v_entry.category, 'Storno: ' || p_reason || ' · Position ' || v_entry.id::text,
          -v_entry.amount_cents, 'invoice_reversal', p_invoice_id, v_entry.id, auth.uid());
      insert into public.league_journal_entries(season_id, team_id, category, description, amount_cents, source_type, source_id)
        values (v_entry.season_id, v_entry.team_id, v_entry.category, 'Storno Rechnung ' || v_invoice.invoice_number || ' · Position ' || v_entry.id::text,
          -v_entry.amount_cents, 'invoice_reversal', p_invoice_id);
    end loop;
  end if;
  update public.invoices set status = 'cancelled', correction_reason = trim(p_reason) where id = p_invoice_id;
  update public.teams t set active_hq_offer_id = r.old_offer_id
    from public.hq_reservations r where r.invoice_id = p_invoice_id and r.team_id = t.id and r.status = 'completed';
  update public.hq_reservations set status = 'cancelled' where invoice_id = p_invoice_id and status = 'pending';
  if exists (select 1 from public.invoice_items ii where ii.invoice_id = p_invoice_id and ii.category = 'Teamkauf') then
    update public.teams set ownership_active = false, acquired_at = null where id = v_invoice.team_id;
  end if;
  perform public.audit_event('Rechnung storniert', 'invoice', p_invoice_id, v_invoice.team_id,
    jsonb_build_object('reason', trim(p_reason), 'was_paid', v_invoice.status = 'paid'));
end;
$$;

create or replace function public.reserve_hq(p_team_id uuid, p_offer_id uuid, p_due_on date default current_date + 7)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_team public.teams%rowtype;
  v_offer public.hq_offers%rowtype;
  v_old public.hq_offers%rowtype;
  v_season public.seasons%rowtype;
  v_invoice uuid;
  v_number bigint;
  v_buyback bigint := 0;
  v_moving bigint := 0;
  v_subtotal bigint;
begin
  if auth.uid() is null or not public.can_access_team(p_team_id) then raise exception 'Zugriff verweigert'; end if;
  select * into strict v_team from public.teams where id = p_team_id for update;
  select * into strict v_offer from public.hq_offers where id = p_offer_id and is_active;
  select * into strict v_season from public.seasons where is_active for update;
  if exists (select 1 from public.hq_reservations r where r.team_id = p_team_id and r.status = 'pending') then
    raise exception 'Für dieses Team ist bereits ein HQ-Kauf reserviert';
  end if;
  if v_team.active_hq_offer_id is not null then
    select * into strict v_old from public.hq_offers where id = v_team.active_hq_offer_id;
    v_buyback := (v_old.purchase_price_cents * 70) / 100;
    v_moving := 30000000;
  end if;
  v_subtotal := v_offer.purchase_price_cents + v_moving - v_buyback;
  if v_subtotal <= 0 then raise exception 'HQ-Wechselbetrag ungültig'; end if;
  if public.team_balance_cents(p_team_id) - public.team_open_invoice_cents(p_team_id)
       < v_subtotal + v_season.invoice_fee_cents then
    raise exception 'Verfügbares Budget reicht für HQ und Liga-Gebühr nicht aus';
  end if;
  update public.seasons set next_invoice_number = next_invoice_number + 1 where id = v_season.id returning next_invoice_number - 1 into v_number;
  insert into public.invoices(invoice_number, season_id, team_id, title, due_on, status, subtotal_cents, fee_cents, created_by, approved_by)
    values ('ZFC-' || to_char(current_date, 'YYYY') || '-' || lpad(v_number::text, 6, '0'), v_season.id, p_team_id,
      case when v_old.id is null then 'HQ-Kauf ' || v_offer.city else 'HQ-Umzug nach ' || v_offer.city end,
      p_due_on, 'open', v_subtotal, v_season.invoice_fee_cents, auth.uid(), auth.uid()) returning id into v_invoice;
  insert into public.invoice_items(invoice_id, category, description, amount_cents)
    values (v_invoice, 'HQ', 'HQ-Kauf ' || v_offer.city, v_offer.purchase_price_cents);
  if v_moving > 0 then
    insert into public.invoice_items(invoice_id, category, description, amount_cents)
      values (v_invoice, 'HQ', 'HQ-Umzugsgebühr', v_moving);
    insert into public.invoice_items(invoice_id, category, description, amount_cents, metadata)
      values (v_invoice, 'HQ', 'Rücknahme HQ ' || v_old.city, -v_buyback,
        jsonb_build_object('buyback_percent', 70, 'old_purchase_price_cents', v_old.purchase_price_cents));
  end if;
  insert into public.hq_reservations(team_id, offer_id, invoice_id, old_offer_id)
    values (p_team_id, p_offer_id, v_invoice, v_team.active_hq_offer_id);
  perform public.audit_event(case when v_old.id is null then 'HQ-Kauf reserviert' else 'HQ-Umzug reserviert' end,
    'hq_reservation', v_invoice, p_team_id,
    jsonb_build_object('offer_id', p_offer_id, 'old_offer_id', v_team.active_hq_offer_id, 'buyback_cents', v_buyback, 'moving_fee_cents', v_moving));
  return v_invoice;
end;
$$;

create or replace function public.travel_cost(p_from_hq uuid, p_race_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hq public.hq_offers%rowtype; v_race public.races%rowtype; v_distance numeric; v_cost bigint;
begin
  select * into strict v_hq from public.hq_offers where id = p_from_hq;
  select * into strict v_race from public.races where id = p_race_id;
  if v_hq.country_code = v_race.country_code then v_distance := 0; v_cost := 3000000;
  else
    v_distance := 6371 * 2 * asin(sqrt(
      power(sin(radians(v_race.latitude - v_hq.latitude) / 2), 2) +
      cos(radians(v_hq.latitude)) * cos(radians(v_race.latitude)) *
      power(sin(radians(v_race.longitude - v_hq.longitude) / 2), 2)
    ));
    v_cost := case when v_distance <= 1500 then 5000000 when v_distance <= 3500 then 9000000
      when v_distance <= 7000 then 14000000 else 20000000 end;
  end if;
  return jsonb_build_object('distance_km', round(v_distance, 2), 'amount_cents', v_cost,
    'hq_offer_id', v_hq.id, 'country_code', v_hq.country_code);
end;
$$;

create or replace function public.create_race_invoices(p_race_id uuid, p_team_ids uuid[] default null)
returns setof uuid language plpgsql security definer set search_path = '' as $$
declare
  v_race public.races%rowtype;
  v_team public.teams%rowtype;
  v_hq public.hq_offers%rowtype;
  v_travel jsonb;
  v_items jsonb;
  v_invoice uuid;
  v_season public.seasons%rowtype;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  select * into strict v_race from public.races where id = p_race_id for update;
  select * into strict v_season from public.seasons where id = v_race.season_id;
  for v_team in select t.* from public.teams t
    where t.ownership_active and t.active_hq_offer_id is not null
      and (p_team_ids is null or t.id = any(p_team_ids)) order by t.id for update
  loop
    if exists (select 1 from public.race_entries e where e.race_id = p_race_id and e.team_id = v_team.id and e.billed_invoice_id is not null) then
      continue;
    end if;
    select * into strict v_hq from public.hq_offers where id = v_team.active_hq_offer_id;
    v_travel := public.travel_cost(v_hq.id, p_race_id);
    v_items := jsonb_build_array(
      jsonb_build_object('category','Teilnahmegebühr','description','Teilnahme Runde ' || v_race.round_number,'amount_cents',18000000),
      jsonb_build_object('category','Rennveranstaltung','description',v_race.name,'amount_cents',12000000),
      jsonb_build_object('category','Streckenmiete','description',v_race.name,'amount_cents',16000000),
      jsonb_build_object('category','Sonstiges','description','Rennbetrieb ' || v_race.name,'amount_cents',2500000),
      jsonb_build_object('category','HQ','description','HQ-Unterhalt ' || v_hq.city,'amount_cents',v_hq.upkeep_per_race_cents),
      jsonb_build_object('category','Reisekosten','description',v_hq.city || ' → ' || v_race.name,
        'amount_cents',(v_travel->>'amount_cents')::bigint,
        'metadata',jsonb_build_object('distance_km',v_travel->'distance_km','hq_offer_id',v_hq.id,'country_code',v_race.country_code))
    );
    v_invoice := public.create_invoice(v_team.id, v_season.id, 'R' || v_race.round_number || ' · ' || v_race.name,
      v_race.race_date - 3, v_items, true, 'race:' || p_race_id || ':' || v_team.id, null);
    insert into public.race_entries(race_id, team_id, billed_invoice_id)
      values (p_race_id, v_team.id, v_invoice)
      on conflict (race_id, team_id) do update set billed_invoice_id = excluded.billed_invoice_id;
    return next v_invoice;
  end loop;
end;
$$;

create or replace function public.sign_sponsor_contract(p_team_id uuid, p_template_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_template public.sponsor_templates%rowtype;
  v_season public.seasons%rowtype;
  v_contract uuid;
  v_team public.teams%rowtype;
  v_due date := (now() at time zone 'Europe/Bucharest')::date;
  v_round smallint;
  v_amount bigint;
begin
  if auth.uid() is null or not exists (select 1 from public.team_members m where m.team_id = p_team_id and m.user_id = auth.uid() and m.member_role = 'president') then
    raise exception 'Nur der eigene Teampräsident darf Verträge bestätigen';
  end if;
  select * into strict v_template from public.sponsor_templates where id = p_template_id and is_active;
  select * into strict v_season from public.seasons where is_active;
  select * into strict v_team from public.teams where id = p_team_id for update;
  if exists (select 1 from public.sponsor_contracts c where c.team_id = p_team_id and c.season_id = v_season.id and c.slot = v_template.slot and c.status = 'active') then
    raise exception 'Sponsorplatz ist bereits vergeben';
  end if;
  if v_template.required_hq_tier is not null and not exists (
    select 1 from public.hq_offers h where h.id = v_team.active_hq_offer_id and h.tier in ('premium', 'prestige')
  ) then raise exception 'Dieses Angebot setzt ein Premium- oder Prestige-HQ voraus'; end if;
  if v_template.required_marketing_cents > 0 and not exists (
    select 1 from public.journal_entries j where j.team_id = p_team_id and j.category = 'Marketing'
      and j.amount_cents < 0 and abs(j.amount_cents) >= v_template.required_marketing_cents
  ) then raise exception 'Das erforderliche Marketingpaket ist noch nicht bezahlt'; end if;
  insert into public.sponsor_contracts(team_id, season_id, template_id, slot, terms_snapshot, signed_by)
    values (p_team_id, v_season.id, p_template_id, v_template.slot, to_jsonb(v_template), auth.uid()) returning id into v_contract;
  if v_template.first_tranche_cents > 0 then
    insert into public.sponsor_claims(team_id, season_id, contract_id, description, amount_cents, due_on, origin_key)
      values (p_team_id, v_season.id, v_contract, v_template.display_name || ' · Rate 1', v_template.first_tranche_cents, v_due, 'contract:' || v_contract || ':1');
  end if;
  if v_template.template_key = 'main-premium' then
    foreach v_round in array array[0, 4, 8, 12]::smallint[] loop
      if v_round > 0 then
        select race_date into v_due from public.races where season_id = v_season.id and round_number = v_round limit 1;
      else v_due := (now() at time zone 'Europe/Bucharest')::date;
      end if;
      v_amount := v_template.guaranteed_cents / 4;
      if v_round > 0 then
        insert into public.sponsor_claims(team_id, season_id, contract_id, description, amount_cents, due_on, origin_key)
          values (p_team_id, v_season.id, v_contract, v_template.display_name || ' · Rate ' || (v_round / 4 + 1), v_amount, v_due,
            'contract:' || v_contract || ':round:' || v_round);
      end if;
    end loop;
  end if;
  perform public.audit_event('Sponsorvertrag angenommen', 'sponsor_contract', v_contract, p_team_id,
    jsonb_build_object('slot', v_template.slot, 'template', v_template.template_key, 'terms', to_jsonb(v_template)));
  return v_contract;
end;
$$;

create or replace function public.release_race_sponsor_claims(p_race_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_race public.races%rowtype;
  v_entry record;
  v_contract record;
  v_terms jsonb;
  v_amount bigint;
  v_count integer := 0;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  select * into strict v_race from public.races where id = p_race_id for update;
  for v_entry in select * from public.race_entries where race_id = p_race_id and billed_invoice_id is not null for update
  loop
    for v_contract in select c.*, t.display_name, t.per_race_cents, t.once_after_round
      from public.sponsor_contracts c join public.sponsor_templates t on t.id = c.template_id
      where c.team_id = v_entry.team_id and c.season_id = v_race.season_id and c.status = 'active'
    loop
      v_terms := v_contract.terms_snapshot;
      v_amount := v_contract.per_race_cents;
      if v_contract.slot = 'race' then
        if v_entry.started_drivers = 0 then v_amount := 0;
        elsif coalesce((v_terms->'terms'->>'one_driver_percent')::integer, 0) > 0 and v_entry.started_drivers = 1 then
          v_amount := v_amount * (v_terms->'terms'->>'one_driver_percent')::integer / 100;
        elsif coalesce((v_terms->'terms'->>'min_starters')::integer, 0) > v_entry.started_drivers then v_amount := 0;
        end if;
      elsif v_contract.slot = 'technical' and v_entry.started_drivers = 0 then v_amount := 0;
      end if;
      if v_amount > 0 then
        insert into public.sponsor_claims(team_id, season_id, contract_id, description, amount_cents, due_on, origin_key)
          values (v_entry.team_id, v_race.season_id, v_contract.id,
            v_contract.display_name || ' · R' || v_race.round_number, v_amount, v_race.race_date,
            'race:' || p_race_id || ':contract:' || v_contract.id)
          on conflict (origin_key) do nothing;
        if found then v_count := v_count + 1; end if;
      end if;
      if v_contract.slot = 'main' and v_race.round_number = 8 and (v_terms->>'template_key' = 'nexora-standard' or v_contract.template_id = (select id from public.sponsor_templates where template_key = 'nexora-standard')) then
        insert into public.sponsor_claims(team_id, season_id, contract_id, description, amount_cents, due_on, origin_key)
          values (v_entry.team_id, v_race.season_id, v_contract.id, v_contract.display_name || ' · Rate 2',
            coalesce((v_terms->>'second_tranche_cents')::bigint, 300000000), v_race.race_date,
            'race:' || p_race_id || ':contract:' || v_contract.id || ':rate2') on conflict (origin_key) do nothing;
        if found then v_count := v_count + 1; end if;
      end if;
      if v_contract.slot = 'regional' and v_race.round_number = v_contract.once_after_round then
        insert into public.sponsor_claims(team_id, season_id, contract_id, description, amount_cents, due_on, origin_key)
          values (v_entry.team_id, v_race.season_id, v_contract.id, v_contract.display_name,
            coalesce((v_terms->>'guaranteed_cents')::bigint, 0), v_race.race_date,
            'race:' || p_race_id || ':contract:' || v_contract.id || ':once') on conflict (origin_key) do nothing;
        if found then v_count := v_count + 1; end if;
      end if;
    end loop;
    update public.race_entries set released_at = coalesce(released_at, now()) where id = v_entry.id;
  end loop;
  perform public.audit_event('Rennbezogene Sponsoransprüche freigegeben', 'race', p_race_id, null, jsonb_build_object('claims_created', v_count));
  return v_count;
end;
$$;

create or replace function public.set_race_starters(p_race_id uuid, p_team_id uuid, p_started_drivers smallint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  if p_started_drivers not between 0 and 2 then raise exception 'Starterzahl muss 0, 1 oder 2 sein'; end if;
  update public.race_entries set started_drivers = p_started_drivers
    where race_id = p_race_id and team_id = p_team_id and billed_invoice_id is not null;
  if not found then raise exception 'Für dieses Team existiert keine Rennanmeldung'; end if;
  perform public.audit_event('Starterzahl dokumentiert', 'race_entry', p_race_id, p_team_id,
    jsonb_build_object('started_drivers', p_started_drivers));
end;
$$;

create or replace function public.review_sponsor_claim(p_claim_id uuid, p_new_amount_cents bigint, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_claim public.sponsor_claims%rowtype;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  if p_new_amount_cents < 0 or length(trim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Prüfungsdaten ungültig'; end if;
  select * into v_claim from public.sponsor_claims where id = p_claim_id for update;
  if not found or v_claim.status not in ('pending', 'approved') then raise exception 'Anspruch kann nicht mehr geändert werden'; end if;
  insert into public.claim_reviews(claim_id, previous_amount_cents, new_amount_cents, reason, reviewed_by)
    values (p_claim_id, v_claim.amount_cents, p_new_amount_cents, trim(p_reason), auth.uid());
  update public.sponsor_claims set amount_cents = p_new_amount_cents, status = 'approved', reviewed_by = auth.uid() where id = p_claim_id;
  perform public.audit_event('Sponsoranspruch geprüft', 'sponsor_claim', p_claim_id, v_claim.team_id,
    jsonb_build_object('previous_cents', v_claim.amount_cents, 'new_cents', p_new_amount_cents, 'reason', trim(p_reason)));
end;
$$;

create or replace function public.pay_sponsor_claim(p_claim_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_claim public.sponsor_claims%rowtype;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  select * into v_claim from public.sponsor_claims where id = p_claim_id;
  if not found then raise exception 'Anspruch nicht gefunden'; end if;
  perform 1 from public.teams where id = v_claim.team_id for update;
  select * into v_claim from public.sponsor_claims where id = p_claim_id for update;
  if v_claim.status <> 'approved' then raise exception 'Anspruch muss geprüft und freigegeben sein'; end if;
  if (now() at time zone 'Europe/Bucharest')::date < v_claim.payable_on then raise exception 'Sieben Kalendertage Auszahlungsfrist noch nicht abgelaufen'; end if;
  update public.sponsor_claims set status = 'paid', paid_at = now() where id = p_claim_id;
  insert into public.journal_entries(team_id, season_id, claim_id, category, description, amount_cents, source_type, source_id, created_by)
    values (v_claim.team_id, v_claim.season_id, p_claim_id, v_claim.category, v_claim.description,
      v_claim.amount_cents, 'claim', p_claim_id, auth.uid());
  insert into public.league_journal_entries(season_id, team_id, category, description, amount_cents, source_type, source_id)
    values (v_claim.season_id, v_claim.team_id, v_claim.category, 'Auszahlung ' || v_claim.description,
      -v_claim.amount_cents, 'claim', p_claim_id);
  perform public.audit_event('Sponsoranspruch ausgezahlt', 'sponsor_claim', p_claim_id, v_claim.team_id,
    jsonb_build_object('amount_cents', v_claim.amount_cents));
end;
$$;

create or replace function public.record_race_results(p_race_id uuid, p_results jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_count integer := 0; v_driver public.team_drivers%rowtype; v_position integer; v_status text;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 40 then raise exception 'Ergebnisdaten ungültig'; end if;
  perform 1 from public.races where id = p_race_id for update;
  if not found then raise exception 'Rennen nicht gefunden'; end if;
  for v_result in select value from jsonb_array_elements(p_results)
  loop
    select * into strict v_driver from public.team_drivers where id = (v_result->>'driver_id')::uuid;
    v_position := nullif(v_result->>'position', '')::integer;
    v_status := v_result->>'status';
    if v_status not in ('classified', 'dnf', 'disqualified', 'pending') or (v_position is not null and v_position not between 1 and 99) then
      raise exception 'Ein Ergebnis enthält einen ungültigen Platz oder Status';
    end if;
    insert into public.race_results(race_id, team_id, driver_id, finishing_position, result_status, official, approved_by, approved_at)
      values (p_race_id, v_driver.team_id, v_driver.id, v_position, v_status, false, null, null)
      on conflict (race_id, driver_id) do update set finishing_position = excluded.finishing_position,
        result_status = excluded.result_status, official = false, approved_by = null, approved_at = null;
    v_count := v_count + 1;
  end loop;
  perform public.audit_event('Rennergebnisse erfasst; noch nicht freigegeben', 'race', p_race_id, null, jsonb_build_object('drivers', v_count));
  return v_count;
end;
$$;

create or replace function public.approve_race_results(p_race_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_result record; v_season uuid; v_amount bigint; v_created integer := 0;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  select season_id into strict v_season from public.races where id = p_race_id for update;
  for v_result in select r.*, ra.race_date from public.race_results r join public.races ra on ra.id = r.race_id
    where r.race_id = p_race_id and not r.official for update of r
  loop
    v_amount := case
      when v_result.result_status <> 'classified' or v_result.finishing_position is null then 0
      when v_result.finishing_position = 1 then 70000000
      when v_result.finishing_position = 2 then 55000000
      when v_result.finishing_position = 3 then 45000000
      when v_result.finishing_position = 4 then 35000000
      when v_result.finishing_position = 5 then 30000000
      when v_result.finishing_position = 6 then 25000000
      when v_result.finishing_position = 7 then 22000000
      when v_result.finishing_position = 8 then 19000000
      when v_result.finishing_position = 9 then 16000000
      when v_result.finishing_position = 10 then 13000000
      when v_result.finishing_position between 11 and 15 then 7000000
      else 3000000 end;
    if v_amount > 0 then
      insert into public.sponsor_claims(team_id, season_id, category, description, amount_cents, due_on, origin_key)
        values (v_result.team_id, v_season, 'Preisgeld', 'Rennpreisgeld · ' || v_result.driver_id::text,
          v_amount, v_result.race_date, 'result:' || p_race_id || ':driver:' || v_result.driver_id)
        on conflict (origin_key) do nothing;
      if found then v_created := v_created + 1; end if;
    end if;
    update public.race_results set official = true, approved_by = auth.uid(), approved_at = now() where id = v_result.id;
  end loop;
  perform public.audit_event('Rennergebnisse offiziell freigegeben', 'race', p_race_id, null,
    jsonb_build_object('claims_created', v_created));
  return v_created;
end;
$$;

create or replace function public.award_season_prize(p_season_id uuid, p_team_id uuid, p_position smallint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_amount bigint; v_award uuid; v_team public.teams%rowtype;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  v_amount := case p_position when 1 then 500000000 when 2 then 400000000 when 3 then 320000000
    when 4 then 260000000 when 5 then 200000000 when 6 then 170000000 when 7 then 140000000
    when 8 then 110000000 when 9 then 90000000 when 10 then 70000000 else null end;
  if v_amount is null then raise exception 'Platz muss zwischen 1 und 10 liegen'; end if;
  select * into strict v_team from public.teams where id = p_team_id;
  insert into public.team_season_awards(season_id, team_id, finishing_position, amount_cents, approved_by)
    values (p_season_id, p_team_id, p_position, v_amount, auth.uid()) returning id into v_award;
  insert into public.sponsor_claims(team_id, season_id, category, description, amount_cents, due_on, status, reviewed_by, origin_key)
    values (p_team_id, p_season_id, 'Preisgeld', 'Saisonprämie · Platz ' || p_position, v_amount,
      (now() at time zone 'Europe/Bucharest')::date, 'approved', auth.uid(), 'season-award:' || v_award);
  perform public.audit_event('Saisonprämie freigegeben', 'season_award', v_award, p_team_id,
    jsonb_build_object('position', p_position, 'amount_cents', v_amount));
  return v_award;
end;
$$;

create or replace function public.record_manual_entry(
  p_team_id uuid, p_season_id uuid, p_category public.money_category, p_description text, p_amount_cents bigint
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  if p_amount_cents = 0 or length(trim(p_description)) not between 1 and 250 then raise exception 'Buchungsdaten ungültig'; end if;
  perform 1 from public.teams where id = p_team_id for update;
  if public.team_balance_cents(p_team_id) + p_amount_cents < 0 then raise exception 'Buchung würde einen negativen Kontostand erzeugen'; end if;
  v_id := gen_random_uuid();
  insert into public.journal_entries(team_id, season_id, category, description, amount_cents, source_type, source_id, created_by)
    values (p_team_id, p_season_id, p_category, trim(p_description), p_amount_cents, 'manual', v_id, auth.uid());
  insert into public.league_journal_entries(season_id, team_id, category, description, amount_cents, source_type, source_id)
    values (p_season_id, p_team_id, p_category, trim(p_description), -p_amount_cents, 'manual', v_id);
  perform public.audit_event('Manuelle Finanzbuchung', 'journal_entry', v_id, p_team_id,
    jsonb_build_object('category', p_category, 'amount_cents', p_amount_cents));
  return v_id;
end;
$$;

create or replace function public.update_season_settings(p_season_id uuid, p_name text, p_fee_cents bigint, p_start_capital_cents bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_before jsonb;
begin
  if auth.uid() is null or not public.is_league_admin() then raise exception 'Nur Liga-Administratoren dürfen Saisoneinstellungen ändern'; end if;
  if p_fee_cents < 0 or p_start_capital_cents < 0 or length(trim(p_name)) not between 1 and 100 then raise exception 'Saisondaten ungültig'; end if;
  select to_jsonb(s) into strict v_before from public.seasons s where id = p_season_id for update;
  update public.seasons set name = trim(p_name), invoice_fee_cents = p_fee_cents, initial_capital_cents = p_start_capital_cents where id = p_season_id;
  perform public.audit_event('Saisoneinstellungen geändert', 'season', p_season_id, null,
    jsonb_build_object('before', v_before, 'after', jsonb_build_object('name', p_name, 'invoice_fee_cents', p_fee_cents, 'initial_capital_cents', p_start_capital_cents)));
end;
$$;

create or replace function public.assign_user_role(p_user_id uuid, p_role public.user_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.user_role;
begin
  if auth.uid() is null or not public.is_league_admin() then raise exception 'Nur Liga-Administratoren dürfen Rollen zuweisen'; end if;
  select role into strict v_old from public.profiles where id = p_user_id for update;
  if p_user_id = auth.uid() and p_role <> v_old then raise exception 'Die eigene Rolle kann nicht geändert werden'; end if;
  update public.profiles set role = p_role where id = p_user_id;
  perform public.audit_event('Benutzerrolle geändert', 'profile', p_user_id, null, jsonb_build_object('before', v_old, 'after', p_role));
end;
$$;

create or replace function public.create_season(p_name text, p_starts_on date, p_ends_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_league_admin() then raise exception 'Nur Liga-Administratoren dürfen Saisons erstellen'; end if;
  update public.seasons set is_active = false where is_active;
  insert into public.seasons(name, starts_on, ends_on, initial_capital_cents, invoice_fee_cents, is_active)
    values (trim(p_name), p_starts_on, p_ends_on, 2500000000, 800000, true) returning id into v_id;
  insert into public.races(season_id, round_number, name, country, country_code, latitude, longitude, race_date, published)
    select v_id, round_number, name, country, country_code, latitude, longitude, race_date, false
    from public.races where season_id = (select id from public.seasons where name = 'ZFC Saison 2026' limit 1)
    order by round_number;
  perform public.audit_event('Neue Saison angelegt; bestehende Team- und HQ-Eigentümer beibehalten', 'season', v_id);
  return v_id;
end;
$$;

create or replace function public.update_invoice_due_dates()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.is_finance_staff() then raise exception 'Finanzberechtigung erforderlich'; end if;
  update public.invoices set status = 'overdue' where status = 'open' and due_on < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.finance_export()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_league_admin() then raise exception 'Nur Liga-Administratoren dürfen das vollständige Backup exportieren'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'seasons', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.seasons x),
    'teams', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.teams x),
    'journal_entries', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.journal_entries x),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.invoices x),
    'invoice_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.invoice_items x),
    'sponsor_claims', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.sponsor_claims x),
    'sponsor_contracts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.sponsor_contracts x),
    'audit_logs', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.audit_logs x)
  );
end;
$$;

create or replace function public.public_market_snapshot()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'season', (select jsonb_build_object('id', id, 'name', name) from public.seasons where is_active limit 1),
    'hq_offers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'city', city, 'country', country, 'tier', tier,
      'purchase_price_cents', purchase_price_cents, 'upkeep_per_race_cents', upkeep_per_race_cents) order by tier, city) from public.hq_offers where is_active), '[]'::jsonb),
    'sponsors', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'slot', slot,
      'description', description, 'guaranteed_cents', guaranteed_cents, 'per_race_cents', per_race_cents,
      'required_hq_tier', required_hq_tier) order by slot, display_name) from public.sponsor_templates where is_active), '[]'::jsonb)
  )
$$;

revoke all on all functions in schema public from public, anon;
grant execute on function public.current_role() to anon, authenticated;
grant execute on function public.is_finance_staff() to anon, authenticated;
grant execute on function public.is_league_admin() to anon, authenticated;
grant execute on function public.can_access_team(uuid) to authenticated;
grant execute on function public.account_snapshot(uuid) to authenticated;
grant execute on function public.finance_dashboard() to authenticated;
grant execute on function public.public_market_snapshot() to anon, authenticated;
grant execute on function public.request_team_presidency(uuid) to authenticated;
grant execute on function public.review_team_presidency(uuid, boolean) to authenticated;
grant execute on function public.create_team(text, text) to authenticated;
grant execute on function public.initialize_team_costs(uuid, date) to authenticated;
grant execute on function public.create_invoice(uuid, uuid, text, date, jsonb, boolean, text, uuid) to authenticated;
grant execute on function public.issue_invoice(uuid) to authenticated;
grant execute on function public.pay_invoice(uuid) to authenticated;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;
grant execute on function public.reserve_hq(uuid, uuid, date) to authenticated;
grant execute on function public.travel_cost(uuid, uuid) to authenticated;
grant execute on function public.create_race_invoices(uuid, uuid[]) to authenticated;
grant execute on function public.sign_sponsor_contract(uuid, uuid) to authenticated;
grant execute on function public.release_race_sponsor_claims(uuid) to authenticated;
grant execute on function public.set_race_starters(uuid, uuid, smallint) to authenticated;
grant execute on function public.review_sponsor_claim(uuid, bigint, text) to authenticated;
grant execute on function public.pay_sponsor_claim(uuid) to authenticated;
grant execute on function public.record_race_results(uuid, jsonb) to authenticated;
grant execute on function public.approve_race_results(uuid) to authenticated;
grant execute on function public.award_season_prize(uuid, uuid, smallint) to authenticated;
grant execute on function public.record_manual_entry(uuid, uuid, public.money_category, text, bigint) to authenticated;
grant execute on function public.update_season_settings(uuid, text, bigint, bigint) to authenticated;
grant execute on function public.assign_user_role(uuid, public.user_role) to authenticated;
grant execute on function public.create_season(text, date, date) to authenticated;
grant execute on function public.update_invoice_due_dates() to authenticated;
grant execute on function public.finance_export() to authenticated;
