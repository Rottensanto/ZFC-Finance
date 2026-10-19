begin;
select plan(32);

select is((select count(*)::integer from public.teams), 11, '2026 has eleven team accounts');
select is((select count(*)::integer from public.team_drivers), 22, 'every seeded team has two drivers');
select is((select count(*)::integer from public.races where season_id = (select id from public.seasons where name = 'ZFC Saison 2026')), 16, 'active 2026 season has sixteen rounds');
select is((select count(*)::integer from public.seasons where is_active), 1, 'exactly one season is active');
select is((select invoice_fee_cents from public.seasons where name = 'ZFC Saison 2026'), 800000::bigint, 'invoice fee defaults to 8000 EUR once per invoice');
select is((select count(*)::integer from public.journal_entries where source_type = 'f1_2026_opening'), 11, 'opening entries are idempotently seeded once per team');
select is((select sum(amount_cents)::bigint from public.journal_entries where source_type = 'f1_2026_opening'), 27500000000::bigint, 'opening capital is 25 million EUR per team');
select is((select sum(amount_cents)::bigint from public.league_journal_entries where source_type = 'f1_2026_opening'), -27500000000::bigint, 'consolidated league capital mirrors team openings');
select is((select count(*)::integer from public.sponsor_templates where slot = 'main' and is_active), 4, 'main sponsor templates are configurable examples');
select is((select count(*)::integer from public.hq_offers where tier = 'basis'), 3, 'basis HQ offers are seeded');
select is((select count(*)::integer from public.hq_offers where tier = 'prestige'), 3, 'prestige HQ offers are seeded');
select is((select count(*)::integer from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'invoice_status'), 5, 'invoice status includes drafts and overdue accounts');
select ok(not has_table_privilege('anon', 'public.journal_entries', 'select'), 'anonymous visitors cannot read the financial ledger');
select ok(not has_table_privilege('anon', 'public.invoices', 'select'), 'anonymous visitors cannot read private invoices');
select ok(has_table_privilege('anon', 'public.public_team_directory', 'select'), 'public team profiles remain readable');
select is((public.travel_cost((select id from public.hq_offers where offer_key = 'milan'), (select id from public.races where name = 'Imola'))->>'amount_cents')::bigint, 3000000::bigint, 'same-country travel rate takes precedence');
select is((select count(*)::integer from public.team_documents), 0, 'private team document metadata starts empty');

insert into auth.users (id, email, raw_user_meta_data) values
	('10000000-0000-0000-0000-000000000001', 'finance-test@example.invalid', '{"display_name":"Finance Test"}'),
	('10000000-0000-0000-0000-000000000002', 'visitor-test@example.invalid', '{"display_name":"Visitor Test"}');
update public.profiles set role = 'league_admin' where id = '10000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

do $$
declare
	v_team uuid;
	v_season uuid;
	v_invoice uuid;
	v_repeated_invoice uuid;
	v_team_purchase uuid;
	v_hq_invoice uuid;
	v_race uuid;
	v_sponsor uuid;
begin
	select id into strict v_season from public.seasons where is_active;
	v_team := public.create_team('Integration Fixture', 'Testkonto im Rollback-Test');
	insert into public.team_members(team_id, user_id, member_role)
		values (v_team, '10000000-0000-0000-0000-000000000001', 'president');
	v_invoice := public.create_invoice(v_team, v_season, 'Mehrpositionsprüfung', current_date + 2,
		'[{"category":"Sonstiges","description":"Position A","amount_cents":10000},{"category":"Sonstiges","description":"Position B","amount_cents":20000}]'::jsonb,
		true, 'integration-fee-test', null);
	v_repeated_invoice := public.create_invoice(v_team, v_season, 'Mehrpositionsprüfung', current_date + 2,
		'[{"category":"Sonstiges","description":"Position A","amount_cents":10000},{"category":"Sonstiges","description":"Position B","amount_cents":20000}]'::jsonb,
		true, 'integration-fee-test', null);
	if v_invoice <> v_repeated_invoice then raise exception 'Idempotency key returned a different invoice'; end if;
	perform public.pay_invoice(v_invoice);
	perform public.initialize_team_costs(v_team, current_date + 7);
	select i.id into strict v_team_purchase
		from public.invoices i join public.invoice_items ii on ii.invoice_id = i.id
		where i.team_id = v_team and ii.category = 'Teamkauf';
	perform public.pay_invoice(v_team_purchase);
	v_hq_invoice := public.reserve_hq(v_team, (select id from public.hq_offers where offer_key = 'milan'), current_date + 7);
	perform public.pay_invoice(v_hq_invoice);
	select id into strict v_race from public.races where name = 'Imola' and season_id = v_season;
	update public.races set race_date = current_date - 8 where id = v_race;
	perform public.create_race_invoices(v_race, array[v_team]);
	perform public.create_race_invoices(v_race, array[v_team]);
	perform public.set_race_starters(v_race, v_team, 2);
	select id into strict v_sponsor from public.sponsor_templates where template_key = 'apex-race';
	perform public.sign_sponsor_contract(v_team, v_sponsor);
	select id into strict v_sponsor from public.sponsor_templates where template_key = 'vector-technical';
	perform public.sign_sponsor_contract(v_team, v_sponsor);
	perform public.release_race_sponsor_claims(v_race);
	perform public.release_race_sponsor_claims(v_race);
end;
$$;

select is((select count(*)::integer from public.journal_entries where team_id = (select id from public.teams where name = 'Integration Fixture') and source_type = 'team_opening'), 1, 'new team opening capital posts exactly once');
select is((select amount_cents from public.journal_entries where team_id = (select id from public.teams where name = 'Integration Fixture') and source_type = 'team_opening'), 2500000000::bigint, 'new team receives the active season capital once');
select is((select count(*)::integer from public.invoices where team_id = (select id from public.teams where name = 'Integration Fixture') and idempotency_key = 'integration-fee-test'), 1, 'invoice idempotency prevents duplicate issuance');
select is((select subtotal_cents from public.invoices where team_id = (select id from public.teams where name = 'Integration Fixture') and idempotency_key = 'integration-fee-test'), 30000::bigint, 'two invoice positions sum exactly');
select is((select fee_cents from public.invoices where team_id = (select id from public.teams where name = 'Integration Fixture') and idempotency_key = 'integration-fee-test'), 800000::bigint, 'one invoice receives one fee regardless of item count');
select is((select total_cents from public.invoices where team_id = (select id from public.teams where name = 'Integration Fixture') and idempotency_key = 'integration-fee-test'), 830000::bigint, 'invoice total adds fee once');
select is((select status::text from public.invoices where team_id = (select id from public.teams where name = 'Integration Fixture') and idempotency_key = 'integration-fee-test'), 'paid', 'invoice payment is atomic and marks the invoice paid');
select is((select count(*)::integer from public.journal_entries where invoice_id = (select id from public.invoices where team_id = (select id from public.teams where name = 'Integration Fixture') and idempotency_key = 'integration-fee-test')), 3, 'two positions and one fee each create one journal entry');
select is(public.team_balance_cents((select id from public.teams where name = 'Integration Fixture')), 1298370000::bigint, 'paid invoice and start capital use cents exactly');
select is((select count(*)::integer from public.invoices i join public.invoice_items ii on ii.invoice_id = i.id where i.team_id = (select id from public.teams where name = 'Integration Fixture') and ii.category = 'Teamkauf'), 1, 'seven setup invoices include exactly one team purchase');
select is((select ownership_active::integer from public.teams where name = 'Integration Fixture'), 1, 'paid team purchase activates ownership');
select is((select h.offer_key from public.teams t join public.hq_offers h on h.id = t.active_hq_offer_id where t.name = 'Integration Fixture'), 'milan', 'HQ becomes active only after the reserved invoice is paid');
select is((select count(*)::integer from public.race_entries e join public.races r on r.id = e.race_id where e.team_id = (select id from public.teams where name = 'Integration Fixture') and r.name = 'Imola' and e.billed_invoice_id is not null), 1, 'race invoice is generated once per team and race');
select is((select amount_cents from public.invoice_items where invoice_id = (select e.billed_invoice_id from public.race_entries e join public.races r on r.id = e.race_id where e.team_id = (select id from public.teams where name = 'Integration Fixture') and r.name = 'Imola') and category = 'Reisekosten'), 3000000::bigint, 'race invoice snapshots same-country travel rate');
select is((select count(*)::integer from public.sponsor_claims c where c.team_id = (select id from public.teams where name = 'Integration Fixture') and c.origin_key like 'race:%:contract:%'), 2, 'repeated race release creates each sponsor claim only once');

select throws_ok(
	$$select public.pay_invoice((select id from public.invoices where team_id = (select id from public.teams where name = 'Integration Fixture') and idempotency_key = 'integration-fee-test'))$$,
	'P0001', 'Rechnung ist nicht zahlbar', 'repeated payment is rejected');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select throws_ok(
	$$select public.pay_invoice((select id from public.invoices where team_id = (select id from public.teams where name = 'Integration Fixture') and idempotency_key = 'integration-fee-test'))$$,
	'P0001', 'Zugriff verweigert', 'a different user cannot pay another team invoice');

select * from finish();
rollback;