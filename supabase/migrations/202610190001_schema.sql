create extension if not exists pgcrypto with schema extensions;

create type public.user_role as enum (
  'public_visitor', 'team_president', 'finance_manager', 'league_admin'
);
create type public.money_category as enum (
  'Sponsoring', 'Preisgeld', 'Teilnahmegebühr', 'Rennveranstaltung',
  'Streckenmiete', 'Server und Technik', 'Lizenzen', 'Marketing',
  'Teamprämien', 'Reisekosten', 'Sonstiges', 'Teamkauf', 'HQ',
  'Liga-Gebühr', 'Startkapital'
);
create type public.invoice_status as enum ('draft', 'open', 'overdue', 'paid', 'cancelled');
create type public.claim_status as enum ('pending', 'approved', 'paid', 'withheld');
create type public.hq_tier as enum ('basis', 'standard', 'premium', 'prestige');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role public.user_role not null default 'public_visitor',
  created_at timestamptz not null default now()
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  starts_on date,
  ends_on date,
  initial_capital_cents bigint not null default 2500000000 check (initial_capital_cents >= 0),
  invoice_fee_cents bigint not null default 800000 check (invoice_fee_cents >= 0),
  next_invoice_number bigint not null default 1,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create unique index one_active_season on public.seasons (is_active) where is_active;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  owner_id uuid references public.profiles(id),
  ownership_active boolean not null default false,
  public_profile boolean not null default true,
  public_description text not null default '',
  discord_channel_name text,
  discord_channel_id text,
  active_hq_offer_id uuid,
  acquired_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'president' check (member_role in ('president', 'driver', 'staff')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table public.team_presidency_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_pending_presidency_request on public.team_presidency_requests(team_id, user_id) where status = 'pending';

create table public.team_drivers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  driver_type text not null default 'regular' check (driver_type in ('regular', 'reserve')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index one_active_driver_name_per_team
  on public.team_drivers (team_id, lower(name)) where is_active;

create table public.hq_offers (
  id uuid primary key default gen_random_uuid(),
  offer_key text not null unique,
  city text not null,
  country text not null,
  country_code char(2) not null,
  tier public.hq_tier not null,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  purchase_price_cents bigint not null check (purchase_price_cents > 0),
  upkeep_per_race_cents bigint not null check (upkeep_per_race_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.teams add constraint teams_active_hq_fk
  foreign key (active_hq_offer_id) references public.hq_offers(id);

create table public.races (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  round_number smallint not null check (round_number between 1 and 16),
  name text not null,
  country text not null,
  country_code char(2) not null,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  race_date date not null,
  published boolean not null default false,
  released_at timestamptz,
  released_by uuid references public.profiles(id),
  unique (season_id, round_number)
);

create table public.sponsor_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  display_name text not null,
  slot text not null check (slot in ('main', 'race', 'technical', 'regional')),
  description text not null default '',
  guaranteed_cents bigint not null default 0 check (guaranteed_cents >= 0),
  per_race_cents bigint not null default 0 check (per_race_cents >= 0),
  first_tranche_cents bigint not null default 0 check (first_tranche_cents >= 0),
  second_tranche_cents bigint not null default 0 check (second_tranche_cents >= 0),
  once_after_round smallint check (once_after_round between 1 and 16),
  required_hq_tier public.hq_tier,
  required_marketing_cents bigint not null default 0 check (required_marketing_cents >= 0),
  terms jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.sponsor_contracts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  season_id uuid not null references public.seasons(id),
  template_id uuid not null references public.sponsor_templates(id),
  slot text not null check (slot in ('main', 'race', 'technical', 'regional')),
  terms_snapshot jsonb not null,
  signed_by uuid not null references public.profiles(id),
  signed_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'terminated', 'completed'))
);
create unique index one_sponsor_per_slot_and_season
  on public.sponsor_contracts (team_id, season_id, slot) where status = 'active';

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  season_id uuid not null references public.seasons(id),
  team_id uuid not null references public.teams(id),
  title text not null,
  created_at timestamptz not null default now(),
  due_on date not null,
  status public.invoice_status not null default 'draft',
  subtotal_cents bigint not null default 0,
  fee_cents bigint not null default 0,
  total_cents bigint generated always as (subtotal_cents + fee_cents) stored,
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  paid_at timestamptz,
  correction_of uuid references public.invoices(id),
  correction_reason text,
  idempotency_key text,
  check (subtotal_cents > 0),
  unique (team_id, idempotency_key)
);
create index invoices_team_due_idx on public.invoices (team_id, due_on) where status in ('open', 'overdue');

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  category public.money_category not null,
  description text not null,
  amount_cents bigint not null check (amount_cents <> 0),
  created_at timestamptz not null default now()
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  season_id uuid not null references public.seasons(id),
  invoice_id uuid references public.invoices(id),
  claim_id uuid,
  category public.money_category not null,
  description text not null,
  amount_cents bigint not null check (amount_cents <> 0),
  source_type text not null,
  source_id uuid not null,
  reverses_entry_id uuid references public.journal_entries(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (team_id, source_type, source_id, category, description)
);
create index journal_team_date_idx on public.journal_entries (team_id, created_at desc);

create table public.league_journal_entries (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  team_id uuid references public.teams(id),
  category public.money_category not null,
  description text not null,
  amount_cents bigint not null check (amount_cents <> 0),
  source_type text not null,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  unique (source_type, source_id, category, description)
);

create table public.hq_reservations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  offer_id uuid not null references public.hq_offers(id),
  invoice_id uuid not null unique references public.invoices(id),
  old_offer_id uuid references public.hq_offers(id),
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

create table public.sponsor_claims (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  season_id uuid not null references public.seasons(id),
  contract_id uuid references public.sponsor_contracts(id),
  category public.money_category not null default 'Sponsoring',
  description text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  due_on date not null,
  payable_on date generated always as (due_on + 7) stored,
  status public.claim_status not null default 'pending',
  origin_key text not null unique,
  reviewed_by uuid references public.profiles(id),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.journal_entries add constraint journal_claim_fk
  foreign key (claim_id) references public.sponsor_claims(id);

create table public.claim_reviews (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.sponsor_claims(id),
  previous_amount_cents bigint not null,
  new_amount_cents bigint not null check (new_amount_cents >= 0),
  reason text not null,
  reviewed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.race_entries (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id),
  team_id uuid not null references public.teams(id),
  started_drivers smallint not null default 0 check (started_drivers between 0 and 2),
  billed_invoice_id uuid references public.invoices(id),
  released_at timestamptz,
  unique (race_id, team_id)
);

create table public.race_results (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id),
  team_id uuid not null references public.teams(id),
  driver_id uuid not null references public.team_drivers(id),
  finishing_position smallint check (finishing_position between 1 and 99),
  result_status text not null check (result_status in ('classified', 'dnf', 'disqualified', 'pending')),
  official boolean not null default false,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  unique (race_id, driver_id)
);

create table public.team_season_awards (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  team_id uuid not null references public.teams(id),
  finishing_position smallint not null check (finishing_position between 1 and 10),
  amount_cents bigint not null check (amount_cents >= 0),
  approved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (season_id, team_id),
  unique (season_id, finishing_position)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  team_id uuid references public.teams(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.team_documents (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 0 and 20971520),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.current_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role from public.profiles p where p.id = auth.uid()), 'public_visitor'::public.user_role)
$$;

create or replace function public.is_finance_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_role() in ('finance_manager', 'league_admin')
$$;

create or replace function public.is_league_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_role() = 'league_admin'
$$;

create or replace function public.can_access_team(p_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_finance_staff() or exists (
    select 1 from public.team_members m where m.team_id = p_team_id and m.user_id = auth.uid()
  )
$$;

create or replace function public.is_team_president(p_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_finance_staff() or exists (
    select 1 from public.team_members m where m.team_id = p_team_id
      and m.user_id = auth.uid() and m.member_role = 'president'
  )
$$;

create or replace function public.audit_event(
  p_action text, p_entity_type text, p_entity_id uuid, p_team_id uuid default null, p_details jsonb default '{}'::jsonb
)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs(actor_id, team_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_team_id, p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb))
$$;

create view public.public_team_directory as
  select t.id, t.name, t.public_description, t.public_profile, t.ownership_active,
         h.city as hq_city, h.country as hq_country, h.tier as hq_tier,
         (select jsonb_agg(jsonb_build_object('name', d.name, 'type', d.driver_type) order by d.driver_type, d.name)
          from public.team_drivers d where d.team_id = t.id and d.is_active) as drivers
  from public.teams t left join public.hq_offers h on h.id = t.active_hq_offer_id
  where t.public_profile;

alter table public.profiles enable row level security;
alter table public.seasons enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_presidency_requests enable row level security;
alter table public.team_drivers enable row level security;
alter table public.hq_offers enable row level security;
alter table public.races enable row level security;
alter table public.sponsor_templates enable row level security;
alter table public.sponsor_contracts enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.journal_entries enable row level security;
alter table public.league_journal_entries enable row level security;
alter table public.hq_reservations enable row level security;
alter table public.sponsor_claims enable row level security;
alter table public.claim_reviews enable row level security;
alter table public.race_entries enable row level security;
alter table public.race_results enable row level security;
alter table public.team_season_awards enable row level security;
alter table public.audit_logs enable row level security;
alter table public.team_documents enable row level security;

create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_league_admin());
create policy active_seasons_public_read on public.seasons for select to anon, authenticated
  using (is_active or public.is_finance_staff());
create policy teams_private_read on public.teams for select to authenticated
  using (public.can_access_team(id));
create policy members_read on public.team_members for select to authenticated
  using (user_id = auth.uid() or public.can_access_team(team_id));
create policy presidency_requests_read on public.team_presidency_requests for select to authenticated
  using (user_id = auth.uid() or public.is_finance_staff());
create policy drivers_team_read on public.team_drivers for select to authenticated
  using (public.can_access_team(team_id));
create policy hq_offers_public_read on public.hq_offers for select to anon, authenticated using (is_active or public.is_finance_staff());
create policy races_public_read on public.races for select to anon, authenticated
  using (published or public.is_finance_staff() or exists (select 1 from public.team_members m where m.user_id = auth.uid()));
create policy sponsor_templates_public_read on public.sponsor_templates for select to anon, authenticated
  using (is_active or public.is_finance_staff());
create policy contracts_team_read on public.sponsor_contracts for select to authenticated
  using (public.can_access_team(team_id));
create policy invoices_team_read on public.invoices for select to authenticated
  using (public.can_access_team(team_id));
create policy invoice_items_team_read on public.invoice_items for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and public.can_access_team(i.team_id)));
create policy journal_team_read on public.journal_entries for select to authenticated
  using (public.can_access_team(team_id));
create policy league_journal_finance_read on public.league_journal_entries for select to authenticated
  using (public.is_finance_staff());
create policy hq_reservations_team_read on public.hq_reservations for select to authenticated
  using (public.can_access_team(team_id));
create policy claims_team_read on public.sponsor_claims for select to authenticated
  using (public.can_access_team(team_id));
create policy claim_reviews_team_read on public.claim_reviews for select to authenticated
  using (exists (select 1 from public.sponsor_claims c where c.id = claim_id and public.can_access_team(c.team_id)));
create policy race_entries_team_read on public.race_entries for select to authenticated
  using (public.can_access_team(team_id) or public.is_finance_staff());
create policy results_public_read on public.race_results for select to anon, authenticated
  using (official or public.is_finance_staff());
create policy awards_public_read on public.team_season_awards for select to anon, authenticated
  using (public.is_finance_staff() or exists (select 1 from public.teams t where t.id = team_id and t.public_profile));
create policy audit_restricted_read on public.audit_logs for select to authenticated
  using (public.is_finance_staff() or (actor_id = auth.uid()) or (team_id is not null and public.can_access_team(team_id)));
create policy team_documents_read on public.team_documents for select to authenticated
  using (public.can_access_team(team_id));
create policy team_documents_insert on public.team_documents for insert to authenticated
  with check (public.can_access_team(team_id) and uploaded_by = auth.uid());

grant usage on schema public to anon, authenticated;
revoke all on public.profiles, public.seasons, public.teams, public.team_members,
  public.team_presidency_requests, public.team_drivers, public.sponsor_contracts,
  public.invoices, public.invoice_items, public.journal_entries, public.league_journal_entries,
  public.hq_reservations, public.sponsor_claims, public.claim_reviews, public.race_entries,
  public.race_results, public.audit_logs, public.team_documents from public, anon;
revoke all on public.hq_offers, public.sponsor_templates, public.races, public.team_season_awards
  from public;
grant select on public.public_team_directory, public.hq_offers, public.sponsor_templates, public.races, public.team_season_awards to anon, authenticated;
grant select on public.profiles, public.seasons, public.teams, public.team_members, public.team_presidency_requests,
  public.team_drivers, public.sponsor_contracts, public.invoices, public.invoice_items, public.journal_entries,
  public.league_journal_entries, public.hq_reservations, public.sponsor_claims, public.claim_reviews,
  public.race_entries, public.race_results, public.audit_logs, public.team_documents to authenticated;

insert into public.seasons (name, starts_on, ends_on, is_active)
values ('ZFC Saison 2026', date '2026-01-01', date '2026-12-31', true)
on conflict (name) do nothing;

insert into public.teams (name, public_description) values
  ('Alpine', 'Virtuelles F1-Teamkonto, Saison 2026.'),
  ('Aston Martin', 'Virtuelles F1-Teamkonto, Saison 2026.'),
  ('Audi', 'Virtuelles F1-Teamkonto, Saison 2026.'),
  ('Cadillac', 'Virtuelles F1-Teamkonto, Saison 2026.'),
  ('Ferrari', 'Virtuelles F1-Teamkonto, Saison 2026.'),
  ('Haas', 'Virtuelles F1-Teamkonto, Saison 2026.'),
  ('McLaren', 'Virtuelles F1-Teamkonto, Saison 2026.'),
  ('Mercedes', 'Virtuelles F1-Teamkonto, Saison 2026.'),
  ('Racing Bulls', 'Virtuelles F1-Teamkonto, Saison 2026.'),
  ('Red Bull Racing', 'Virtuelles F1-Teamkonto, Saison 2026.'),
  ('Williams', 'Virtuelles F1-Teamkonto, Saison 2026.')
on conflict (name) do nothing;

insert into public.team_drivers (team_id, name)
select t.id, d.name
from (values
  ('Alpine', 'Pierre Gasly'), ('Alpine', 'Franco Colapinto'),
  ('Aston Martin', 'Fernando Alonso'), ('Aston Martin', 'Lance Stroll'),
  ('Audi', 'Nico Hülkenberg'), ('Audi', 'Gabriel Bortoleto'),
  ('Cadillac', 'Sergio Pérez'), ('Cadillac', 'Valtteri Bottas'),
  ('Ferrari', 'Charles Leclerc'), ('Ferrari', 'Lewis Hamilton'),
  ('Haas', 'Esteban Ocon'), ('Haas', 'Oliver Bearman'),
  ('McLaren', 'Lando Norris'), ('McLaren', 'Oscar Piastri'),
  ('Mercedes', 'George Russell'), ('Mercedes', 'Kimi Antonelli'),
  ('Racing Bulls', 'Liam Lawson'), ('Racing Bulls', 'Arvid Lindblad'),
  ('Red Bull Racing', 'Max Verstappen'), ('Red Bull Racing', 'Isack Hadjar'),
  ('Williams', 'Alexander Albon'), ('Williams', 'Carlos Sainz')
) as d(team_name, name)
join public.teams t on t.name = d.team_name
where not exists (select 1 from public.team_drivers x where x.team_id = t.id and x.name = d.name);

insert into public.journal_entries(team_id, season_id, category, description, amount_cents, source_type, source_id)
select t.id, s.id, 'Startkapital', 'Einmaliges F1-Teamkonto Saison 2026', 2500000000,
  'f1_2026_opening', t.id
from public.teams t cross join public.seasons s
where s.name = 'ZFC Saison 2026'
  and t.name in ('Alpine', 'Aston Martin', 'Audi', 'Cadillac', 'Ferrari', 'Haas', 'McLaren', 'Mercedes', 'Racing Bulls', 'Red Bull Racing', 'Williams')
on conflict (team_id, source_type, source_id, category, description) do nothing;

insert into public.league_journal_entries(season_id, team_id, category, description, amount_cents, source_type, source_id)
select s.id, t.id, 'Startkapital', 'Startkapital an F1-Teamkonto 2026 ausgegeben', -2500000000,
  'f1_2026_opening', t.id
from public.teams t cross join public.seasons s
where s.name = 'ZFC Saison 2026'
  and t.name in ('Alpine', 'Aston Martin', 'Audi', 'Cadillac', 'Ferrari', 'Haas', 'McLaren', 'Mercedes', 'Racing Bulls', 'Red Bull Racing', 'Williams')
on conflict (source_type, source_id, category, description) do nothing;

insert into public.hq_offers (offer_key, city, country, country_code, tier, latitude, longitude, purchase_price_cents, upkeep_per_race_cents) values
  ('athens', 'Athen', 'Griechenland', 'GR', 'basis', 37.983800, 23.727500, 200000000, 3000000),
  ('lisbon', 'Lissabon', 'Portugal', 'PT', 'basis', 38.722300, -9.139300, 200000000, 3000000),
  ('warsaw', 'Warschau', 'Polen', 'PL', 'basis', 52.229700, 21.012200, 200000000, 3000000),
  ('cologne', 'Köln', 'Deutschland', 'DE', 'standard', 50.937500, 6.960300, 400000000, 6000000),
  ('barcelona', 'Barcelona', 'Spanien', 'ES', 'standard', 41.387400, 2.168600, 400000000, 6000000),
  ('milan', 'Mailand', 'Italien', 'IT', 'standard', 45.464200, 9.190000, 400000000, 6000000),
  ('london', 'London', 'Großbritannien', 'GB', 'premium', 51.507200, -0.127600, 650000000, 9500000),
  ('paris', 'Paris', 'Frankreich', 'FR', 'premium', 48.856600, 2.352200, 650000000, 9500000),
  ('zurich', 'Zürich', 'Schweiz', 'CH', 'premium', 47.376900, 8.541700, 650000000, 9500000),
  ('monaco', 'Monaco', 'Monaco', 'MC', 'prestige', 43.738400, 7.424600, 900000000, 14000000),
  ('dubai', 'Dubai', 'VAE', 'AE', 'prestige', 25.204800, 55.270800, 900000000, 14000000),
  ('singapore', 'Singapur', 'Singapur', 'SG', 'prestige', 1.352100, 103.819800, 900000000, 14000000)
on conflict (offer_key) do nothing;

insert into public.sponsor_templates (template_key, display_name, slot, description, guaranteed_cents, per_race_cents, first_tranche_cents, second_tranche_cents, once_after_round, required_hq_tier, required_marketing_cents, terms) values
  ('nexora-standard', 'Nexora Global', 'main', 'Virtuelles Beispielangebot. 3 Mio. zum Vertragsbeginn und 3 Mio. nach Runde 8.', 600000000, 0, 300000000, 300000000, null, null, 0, '{"kind":"split","second_round":8}'::jsonb),
  ('main-secure', 'Sicherer Hauptsponsor', 'main', '5 Mio. einmalig, ohne Ergebnisziel.', 500000000, 0, 500000000, 0, null, null, 0, '{"kind":"single"}'::jsonb),
  ('main-performance', 'Leistungshauptsponsor', 'main', '6 Mio. garantiert plus bis zu 1 Mio. Top-5-Bonus.', 600000000, 0, 300000000, 300000000, null, null, 0, '{"kind":"performance","bonus_cents":100000000,"team_top_n":5}'::jsonb),
  ('main-premium', 'Premium-Hauptsponsor', 'main', '8 Mio. in vier Raten; Premium-/Prestige-HQ und 1,6 Mio. Marketing erforderlich.', 800000000, 0, 200000000, 200000000, null, 'premium', 160000000, '{"kind":"quarterly","rounds":[0,4,8,12]}'::jsonb),
  ('apex-race', 'Apex Performance', 'race', 'Virtuelles Standard-Rennsponsorangebot.', 0, 22000000, 0, 0, null, null, 0, '{"kind":"race","one_driver_percent":50}'::jsonb),
  ('small-race', 'Kleiner Rennsponsor', 'race', '150.000 € je Rennen bei mindestens einem gestarteten Fahrer.', 0, 15000000, 0, 0, null, null, 0, '{"kind":"race","min_starters":1}'::jsonb),
  ('large-race', 'Großer Rennsponsor', 'race', '300.000 € je Rennen, wenn beide Fahrer starten.', 0, 30000000, 0, 0, null, null, 0, '{"kind":"race","min_starters":2}'::jsonb),
  ('vector-technical', 'Vector Systems', 'technical', 'Virtuelles Technikpartnerangebot.', 0, 12000000, 0, 0, null, null, 0, '{"kind":"technical","min_starters":1}'::jsonb),
  ('horizon-regional', 'Horizon Partners', 'regional', 'Virtuelles Regionalpartnerangebot; einmalig nach Runde 4.', 80000000, 0, 80000000, 0, 4, null, 0, '{"kind":"once"}'::jsonb),
  ('results-race', 'Ergebnissponsor', 'race', '100.000 € bei mindestens einem Starter plus 150.000 € je Teampodium.', 0, 10000000, 0, 0, null, null, 0, '{"kind":"results","podium_bonus_cents":15000000}'::jsonb)
on conflict (template_key) do nothing;

insert into public.races (season_id, round_number, name, country, country_code, latitude, longitude, race_date, published)
select s.id, r.round_number, r.name, r.country, r.country_code, r.latitude, r.longitude, r.race_date, false
from public.seasons s
cross join (values
  (1, 'Australien', 'Australien', 'AU', -37.850000::numeric, 144.970000::numeric, date '2026-03-08'),
  (2, 'Bahrain', 'Bahrain', 'BH', 26.030000, 50.510000, date '2026-03-15'),
  (3, 'Saudi-Arabien', 'Saudi-Arabien', 'SA', 21.630000, 39.100000, date '2026-03-29'),
  (4, 'Miami', 'USA', 'US', 25.960000, -80.240000, date '2026-05-03'),
  (5, 'Imola', 'Italien', 'IT', 44.340000, 11.720000, date '2026-05-17'),
  (6, 'Monaco', 'Monaco', 'MC', 43.740000, 7.420000, date '2026-05-24'),
  (7, 'Spanien', 'Spanien', 'ES', 41.570000, 2.260000, date '2026-06-07'),
  (8, 'Österreich', 'Österreich', 'AT', 47.220000, 14.760000, date '2026-06-21'),
  (9, 'Großbritannien', 'Großbritannien', 'GB', 52.070000, -1.020000, date '2026-07-05'),
  (10, 'Belgien', 'Belgien', 'BE', 50.440000, 5.970000, date '2026-07-19'),
  (11, 'Niederlande', 'Niederlande', 'NL', 52.390000, 4.540000, date '2026-08-23'),
  (12, 'Italien', 'Italien', 'IT', 45.620000, 9.280000, date '2026-09-06'),
  (13, 'Singapur', 'Singapur', 'SG', 1.290000, 103.860000, date '2026-09-20'),
  (14, 'Baku', 'Aserbaidschan', 'AZ', 40.370000, 49.850000, date '2026-10-04'),
  (15, 'Mexiko', 'Mexiko', 'MX', 19.400000, -99.090000, date '2026-10-25'),
  (16, 'Abu Dhabi', 'VAE', 'AE', 24.470000, 54.600000, date '2026-11-29')
) as r(round_number, name, country, country_code, latitude, longitude, race_date)
where s.name = 'ZFC Saison 2026'
on conflict (season_id, round_number) do nothing;