import "../styles.css";
import {
  createPrivateDocument,
  exportFinanceBackup,
  getPrivateDocumentUrl,
  loadFinanceWorkspace,
  loadLanding,
  loadProfile,
  loadTeamAccount,
  loadTeamPortal,
  rpc,
} from "./lib/api.js";
import { errorMessage, escapeHtml as e, money, date, csvCell } from "./lib/format.js";
import { backendReady, supabase } from "./lib/supabase.js";

const app = document.querySelector("#app");
const sessionControls = document.querySelector("#session-controls");
const state = { session: null, user: null, profile: null, loading: false, search: "" };

const link = (path, label, className = "") => `<a class="${className}" href="#/${path}">${label}</a>`;
const button = (action, label, className = "", attributes = "") =>
  `<button type="button" class="${className}" data-action="${action}" ${attributes}>${label}</button>`;
const status = (value) => {
  const labels = { draft: "Entwurf", open: "Offen", overdue: "Überfällig", paid: "Bezahlt", cancelled: "Storniert", pending: "Ausstehend", approved: "Freigegeben", withheld: "Zurückgestellt" };
  const tone = value === "paid" || value === "approved" ? "green" : value === "overdue" || value === "cancelled" ? "red" : "";
  return `<span class="tag ${tone}">${e(labels[value] || value)}</span>`;
};
const currentRoute = () => decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/");
const isStaff = () => ["league_admin", "finance_manager"].includes(state.profile?.role);
const isAdmin = () => state.profile?.role === "league_admin";
const isPresident = () => state.profile?.role === "team_president";

function toast(message, bad = false) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.toggle("bad-toast", bad);
  element.hidden = false;
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => (element.hidden = true), 5000);
}

function renderHeader() {
  sessionControls.innerHTML = state.user
    ? `<span class="user-label">${e(state.profile?.display_name || state.user.email)}</span>${link("portal", "Mein Portal", "button")}${isStaff() ? link("admin", "Verwaltung", "button") : ""}<button type="button" class="quiet" data-action="sign-out">Abmelden</button>`
    : `${link("login", "Anmelden", "button quiet")}${link("signup", "Konto erstellen", "button primary")}`;
}

function pageTitle(eyebrow, title, description, actions = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${e(eyebrow)}</p><h1>${e(title)}</h1><p class="page-description">${e(description)}</p></div><div class="row">${actions}</div></div>`;
}

function setupBanner() {
  return `<section class="setup-banner"><span class="tag amber">Backend nicht konfiguriert</span><h2>Gemeinsame Ligadatenbank verbinden</h2><p>Diese Installation zeigt keine lokalen Finanz-Demodaten. Lege ein Supabase-Projekt an, trage URL und öffentlichen Publishable-/Anon-Key in <code>.env</code> ein und wende die Migrationen an.</p><code>npm run db:push</code></section>`;
}

function publicHome(data) {
  const teams = data?.teams || [];
  return `<section class="hero"><div class="hero-copy"><p class="eyebrow">Zenith Formula Championship · Saison 2026</p><h1>Eine Liga.<br><span>Klare Zahlen.</span></h1><p>Teamverwaltung, Rechnungen, Rennkosten und Sponsorverträge in einer gemeinsamen Ligawirtschaft. Alle Beträge sind virtuelle Ligawährung.</p><div class="row">${state.user ? link("portal", "Zum Teamportal", "button primary") : link("signup", "Teampräsident werden", "button primary")}${link("market", "HQ- und Sponsorenmarkt", "button")}</div><p class="fine-print">Keine echten Zahlungen. Öffentliche Profile zeigen keine Kontostände.</p></div><div class="hero-ledger"><div class="ledger-top"><span>ZFC / FINANCE OFFICE</span><span class="status-dot">SYSTEM AKTIV</span></div><div class="ledger-line"><span>Teamkonten</span><b>${teams.length || 11}</b></div><div class="ledger-line"><span>Saisonrennen</span><b>16</b></div><div class="ledger-line"><span>Startkapital / Team</span><b>25 Mio. €</b></div><div class="ledger-rule"></div><p>Jede Buchung revisionsfähig.<br>Jeder Zugriff rollenbasiert.</p></div></section><section class="public-section"><div class="section-heading"><div><p class="eyebrow">Das Grid</p><h2>Teams der Saison 2026</h2></div>${link("teams", "Alle Teamprofile →")}</div>${teams.length ? `<div class="team-directory">${teams.map((team, index) => `<a class="directory-row" href="#/team/${team.id}"><span class="directory-number">${String(index + 1).padStart(2, "0")}</span><span><b>${e(team.name)}</b><small>${(team.drivers || []).map((driver) => e(driver.name)).join(" · ") || "Teamprofil"}</small></span><span class="directory-hq">${e(team.hq_city || "HQ offen")}</span><span class="directory-arrow">↗</span></a>`).join("")}</div>` : `<p class="empty-state">Öffentliche Teamprofile erscheinen hier, sobald Supabase eingerichtet ist.</p>`}</section><section class="public-market-strip"><div><p class="eyebrow">Ligamarkt</p><h2>Standort und Partnerschaften</h2><p>HQ-Angebote und virtuelle, konfigurierbare Sponsorenmodelle.</p></div>${link("market", "Markt öffnen →", "button")}</section>${!backendReady ? setupBanner() : ""}`;
}

function authPage(signup = false) {
  if (!backendReady) return `${pageTitle("Zugang", signup ? "Konto erstellen" : "Anmelden", "Die Supabase-Verbindung ist noch nicht eingerichtet.")}${setupBanner()}`;
  return `${pageTitle("Zugang", signup ? "Konto erstellen" : "Anmelden", signup ? "Registriere dich mit deiner Liga-E-Mail-Adresse." : "Melde dich mit deinem Liga-Konto an.")}<form class="form-panel narrow" data-form="${signup ? "signup" : "login"}">${signup ? `<label>Anzeigename<input name="displayName" autocomplete="name" required maxlength="100"></label>` : ""}<label>E-Mail<input name="email" type="email" autocomplete="email" required></label><label>Passwort<input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" required minlength="10"></label>${signup ? `<p class="fine-print">Nach der Bestätigung deiner E-Mail kann die Liga-Administration dir ein Team und eine Rolle zuordnen. Die Registrierung vergibt keine Rechte.</p>` : ""}<button class="primary" type="submit">${signup ? "Konto anlegen" : "Sicher anmelden"}</button></form>`;
}

function publicTeams(data) {
  return `${pageTitle("Öffentlich", "Teamprofile", "Freigegebene Team- und Fahrerdaten. Finanzdaten bleiben privat.")}${(data?.teams || []).map((team) => `<article class="public-team-row"><div><p class="eyebrow">${team.ownership_active ? "Übernommen" : "Offen für Anfrage"}</p><h2>${e(team.name)}</h2><p>${e(team.public_description || "")}</p></div><div><b>${e(team.hq_city || "HQ nicht veröffentlicht")}</b><small>${e(team.hq_country || "")}</small></div><div>${(team.drivers || []).map((driver) => `<span class="tag">${e(driver.name)}</span>`).join(" ")}</div>${state.user && !team.ownership_active ? button("request-presidency", "Präsidentschaft anfragen", "button", `data-team-id="${team.id}"`) : ""}</article>`).join("") || `<p class="empty-state">Noch keine freigegebenen Teamprofile.</p>`}`;
}

function marketPage(data) {
  const market = data?.market;
  if (!market) return `${pageTitle("Ligamarkt", "HQ & Sponsoren", "Veröffentlichte Angebote der aktiven Saison.")}${setupBanner()}`;
  const tiers = ["basis", "standard", "premium", "prestige"];
  const offers = market.hq_offers || [];
  const sponsors = market.sponsors || [];
  return `${pageTitle("Saisonmarkt", "HQ & Sponsoren", "Angebote ansehen. Verpflichtende Käufe und Verträge werden dem eigenen Team zugeordnet.")}${tiers.map((tier) => `<section class="market-tier"><div class="section-heading"><div><p class="eyebrow">HQ-Kategorie</p><h2>${e(tier)}</h2></div></div><div class="offer-grid">${offers.filter((offer) => offer.tier === tier).map((offer) => `<article class="offer-row"><div><h3>${e(offer.city)}</h3><p>${e(offer.country)}</p></div><div><small>Kaufpreis</small><b>${money(offer.purchase_price_cents)}</b></div><div><small>Unterhalt / Rennen</small><b>${money(offer.upkeep_per_race_cents)}</b></div>${isPresident() ? button("reserve-hq", "Kauf anfragen", "button primary", `data-offer-id="${offer.id}"`) : ""}</article>`).join("") || `<p class="empty-state">Keine Angebote.</p>`}</div></section>`).join("")}<section class="market-tier"><div class="section-heading"><div><p class="eyebrow">Partnerschaften · virtuelle Beispielangebote</p><h2>Sponsoren</h2></div></div><div class="offer-grid">${sponsors.map((sponsor) => `<article class="sponsor-offer"><span class="tag">${e(sponsor.slot)}</span><h3>${e(sponsor.display_name)}</h3><p>${e(sponsor.description)}</p><div class="row between"><span>Garantiert</span><b>${money(sponsor.guaranteed_cents)}</b></div><div class="row between"><span>Je Rennen</span><b>${money(sponsor.per_race_cents)}</b></div>${sponsor.required_hq_tier ? `<small>Voraussetzung: ${e(sponsor.required_hq_tier)}-HQ</small>` : ""}${isPresident() ? button("sign-sponsor", "Vertrag bestätigen", "button", `data-template-id="${sponsor.id}"`) : ""}</article>`).join("")}</div></section>`;
}

function teamAccountView(account) {
  const { team, snapshot, invoices, journal, claims, contracts, reservations, documents } = account;
  const stats = [
    ["Kontostand", snapshot.balance_cents, "Tatsächlich gebucht"],
    ["Offene Rechnungen", snapshot.open_invoices_cents, "Ausgestellt, nicht bezahlt"],
    ["Offene Forderungen", snapshot.open_claims_cents, "Entstandene Ansprüche"],
    ["Reservierte Käufe", snapshot.reserved_purchases_cents, "Noch nicht in Rechnung"],
    ["Verfügbar", snapshot.available_cents, "Saldo abzüglich Rechnungen"],
  ];
  return `${pageTitle("Teamportal", team.name, "Privates Finanzkonto · Nur für dein Team und berechtigte Finanzrollen.", `<button type="button" data-action="export-team" data-team-id="${team.id}">CSV-Bericht</button>`)}<div class="stats">${stats.map(([label, cents, note]) => `<div class="stat"><small>${e(label)}</small><strong class="money">${money(cents)}</strong><small>${e(note)}</small></div>`).join("")}</div><section class="account-meta"><div><small>Eigentumsstatus</small><b>${team.ownership_active ? "Aktiv" : "Teamkauf noch nicht bezahlt"}</b></div><div><small>HQ</small><b>${e(team.hq_offers?.city || "Noch nicht aktiv")}</b></div><div><small>Discord-HQ</small><b>${e(team.discord_channel_name || "Nicht eingerichtet")}</b></div><div><small>Fahrer</small><b>${team.team_drivers.filter((driver) => driver.is_active).map((driver) => e(driver.name)).join(" · ") || "Noch nicht zugeordnet"}</b></div></section>${reservations.length ? `<section class="notice"><b>HQ-Anfragen</b>${reservations.map((reservation) => `<span>${e(reservation.hq_offers?.city || "HQ")} · ${status(reservation.status)}</span>`).join("")}</section>` : ""}<section class="workspace-section"><div class="section-heading"><div><p class="eyebrow">Verbindlichkeiten</p><h2>Rechnungen</h2></div>${button("print-invoices", "Drucken / PDF", "button")}</div>${invoiceTable(invoices, true)}</section><section class="workspace-section"><div class="section-heading"><div><p class="eyebrow">Forderungen</p><h2>Sponsor- und Preisgeldansprüche</h2></div></div>${claimsTable(claims)}</section><section class="split workspace-section"><div><div class="section-heading"><div><p class="eyebrow">Bewegungen</p><h2>Buchungsjournal</h2></div></div>${journalTable(journal)}</div><div><div class="section-heading"><div><p class="eyebrow">Verträge</p><h2>Sponsoren</h2></div></div>${contractsTable(contracts)}</div></section><section class="workspace-section"><div class="section-heading"><div><p class="eyebrow">Vertraulich</p><h2>Teamunterlagen</h2></div></div><form class="upload-row" data-form="upload-document" data-team-id="${team.id}"><input type="file" name="document" accept="application/pdf,image/png,image/jpeg,text/plain" required><button class="button" type="submit">Sicher hochladen</button><small>Privater Speicher, maximal 20 MB.</small></form>${documents.map((document) => `<div class="document-row"><span>${e(document.file_name)}</span><small>${date(document.created_at)}</small>${button("open-document", "Kurzlink öffnen", "quiet", `data-path="${e(document.storage_path)}"`)}</div>`).join("") || `<p class="empty-state">Noch keine Unterlagen.</p>`}</section>`;
}

function invoiceTable(invoices, canPay = false) {
  return `<div class="tablewrap"><table><thead><tr><th>Beleg</th><th>Datum / fällig</th><th>Positionen</th><th>Gebühr</th><th>Gesamt</th><th>Status</th><th></th></tr></thead><tbody>${invoices.map((invoice) => `<tr><td><b>${e(invoice.invoice_number)}</b><small>${e(invoice.title)}</small></td><td>${date(invoice.created_at)}<small>Fällig ${date(invoice.due_on)}</small></td><td>${money(invoice.subtotal_cents)}</td><td>${money(invoice.fee_cents)}</td><td><b>${money(invoice.total_cents)}</b></td><td>${status(invoice.status)}</td><td>${canPay && ["open", "overdue"].includes(invoice.status) ? button("pay-invoice", "Virtuell bezahlen", "button", `data-invoice-id="${invoice.id}"`) : ""}${isStaff() && invoice.status === "draft" ? button("issue-invoice", "Ausstellen", "quiet", `data-invoice-id="${invoice.id}"`) : ""}${isStaff() && ["open", "overdue", "paid"].includes(invoice.status) ? button("cancel-invoice", "Storno", "quiet danger", `data-invoice-id="${invoice.id}"`) : ""}<details><summary>Details</summary>${(invoice.invoice_items || []).map((item) => `<div class="invoice-line"><span>${e(item.category)} · ${e(item.description)}</span><b>${money(item.amount_cents)}</b></div>`).join("")}<small>Erstellt von ${e(invoice.created_by)} · Gebühr bei Ausstellung: ${money(invoice.fee_cents)}</small>${invoice.correction_reason ? `<p>${e(invoice.correction_reason)}</p>` : ""}</details></td></tr>`).join("") || `<tr><td colspan="7" class="empty-state">Keine Rechnungen.</td></tr>`}</tbody></table></div>`;
}

function journalTable(journal) {
  return `<div class="tablewrap"><table><thead><tr><th>Datum</th><th>Kategorie</th><th>Vorgang</th><th>Betrag</th></tr></thead><tbody>${journal.map((entry) => `<tr><td>${date(entry.created_at)}</td><td>${e(entry.category)}</td><td>${e(entry.description)}</td><td class="${entry.amount_cents < 0 ? "bad" : "success"}">${money(entry.amount_cents)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty-state">Noch keine Buchungen.</td></tr>`}</tbody></table></div>`;
}

function claimsTable(claims) {
  return `<div class="tablewrap"><table><thead><tr><th>Anspruch</th><th>Fällig</th><th>Auszahlbar ab</th><th>Betrag</th><th>Status</th><th></th></tr></thead><tbody>${claims.map((claim) => `<tr><td>${e(claim.description)}<small>${e(claim.category)}</small></td><td>${date(claim.due_on)}</td><td>${date(claim.payable_on)}</td><td>${money(claim.amount_cents)}</td><td>${status(claim.status)}</td><td>${isStaff() && claim.status === "pending" ? button("review-claim", "Prüfen", "quiet", `data-claim-id="${claim.id}" data-amount="${claim.amount_cents}"`) : ""}${isStaff() && claim.status === "approved" ? button("pay-claim", "Auszahlen", "button", `data-claim-id="${claim.id}"`) : ""}${claim.claim_reviews?.map((review) => `<small>${e(review.reason)} · ${money(review.previous_amount_cents)} → ${money(review.new_amount_cents)}</small>`).join("") || ""}</td></tr>`).join("") || `<tr><td colspan="6" class="empty-state">Keine Ansprüche.</td></tr>`}</tbody></table></div>`;
}

function contractsTable(contracts) {
  return `<div class="tablewrap"><table><thead><tr><th>Partner</th><th>Slot</th><th>Abschluss</th></tr></thead><tbody>${contracts.map((contract) => `<tr><td>${e(contract.sponsor_templates?.display_name || "Sponsor")}</td><td>${e(contract.slot)}</td><td>${date(contract.signed_at)}</td></tr>`).join("") || `<tr><td colspan="3" class="empty-state">Keine aktiven Verträge.</td></tr>`}</tbody></table></div>`;
}

function portalView(portal) {
  const { memberships, requests } = portal;
  return `${pageTitle("Persönlicher Bereich", "Mein Teamportal", "Dein Zugang zeigt ausschließlich Teams, denen du zugeordnet bist.")}${memberships.length ? memberships.map((membership) => `<article class="portal-team"><div><p class="eyebrow">${e(membership.member_role)}</p><h2>${e(membership.teams.name)}</h2><p>${membership.teams.ownership_active ? "Eigentum aktiviert" : "Teamkauf ausstehend"} · ${e(membership.teams.hq_offers?.city || "HQ offen")}</p></div>${link(`account/${membership.team_id}`, "Finanzkonto öffnen →", "button primary")}</article>`).join("") : `<div class="empty-panel"><h2>Noch kein Team zugeordnet</h2><p>Fordere in einem öffentlichen Teamprofil eine Teampräsidentschaft an. Die Liga-Administration prüft jede Zuordnung.</p>${link("teams", "Teamprofile ansehen", "button")}</div>`}${requests.length ? `<section class="workspace-section"><h2>Meine Anfragen</h2>${requests.map((request) => `<div class="request-row"><span>${e(request.teams.name)}</span>${status(request.status)}<small>${date(request.created_at)}</small></div>`).join("")}</section>` : ""}`;
}

function adminView(workspace) {
  if (!isStaff()) return `<section class="empty-panel"><h2>Kein Verwaltungszugriff</h2><p>Diese Datenbankaktion wird zusätzlich serverseitig geprüft.</p></section>`;
  const { dashboard, teams, requests, profiles, invoices, claims, races, season } = workspace;
  return `${pageTitle("Verwaltung · ${season.name}", "Finanzcockpit", "Ligaberichte und gemeinsame Finanzabläufe.", button("export-backup", "JSON-Backup", "button"))}<div class="stats">${statBox("Teamkonten", teams.length)}${statBox("Offene Rechnungen", dashboard.open_invoices)}${statBox("Überfällige Rechnungen", dashboard.overdue_invoices)}${statBox("Ausstehende Ansprüche", money(dashboard.pending_claims_cents))}${statBox("Eingenommene Gebühren", money(dashboard.fees_collected_cents))}</div><section class="admin-section"><div class="section-heading"><div><p class="eyebrow">Zuordnung</p><h2>Präsidentschaftsanfragen</h2></div></div>${requests.length ? requests.map((request) => `<div class="request-row"><span><b>${e(request.teams.name)}</b><small>${e(request.profiles?.display_name || request.profiles?.email || request.user_id)}</small></span>${button("approve-president", "Zuordnen", "button primary", `data-request-id="${request.id}"`)}${button("reject-president", "Ablehnen", "quiet danger", `data-request-id="${request.id}"`)}</div>`).join("") : `<p class="empty-state">Keine offenen Anfragen.</p>`}</section><section class="admin-section"><div class="section-heading"><div><p class="eyebrow">Buchhaltung</p><h2>Offene Rechnungen</h2></div><button class="button primary" data-action="new-invoice">Rechnung erstellen</button></div>${invoiceTable(invoices)}</section><section class="admin-section"><div class="section-heading"><div><p class="eyebrow">Auszahlungen</p><h2>Ansprüche prüfen</h2></div></div>${claimsTable(claims)}</section><section class="split admin-section"><div><h2>Teams</h2><div class="tablewrap"><table><thead><tr><th>Team</th><th>Eigentum</th><th>HQ</th><th>Aktion</th></tr></thead><tbody>${teams.map((team) => `<tr><td>${e(team.name)}</td><td>${team.ownership_active ? "Aktiv" : "Nicht aktiviert"}</td><td>${e(team.hq_offers?.city || "–")}</td><td>${button("team-costs", "Grundkosten", "quiet", `data-team-id="${team.id}"`)}${button("select-team-invoice", "Rechnung", "quiet", `data-team-id="${team.id}"`)}</td></tr>`).join("")}</tbody></table></div></div>${isAdmin() ? `<section><h2>Benutzerrollen</h2><div class="tablewrap"><table><thead><tr><th>Benutzer</th><th>Rolle</th><th></th></tr></thead><tbody>${profiles.map((profile) => `<tr><td>${e(profile.email)}</td><td><select aria-label="Rolle für ${e(profile.email)}" data-role-user="${profile.id}">${["public_visitor", "team_president", "finance_manager", "league_admin"].map((role) => `<option value="${role}" ${profile.role === role ? "selected" : ""}>${role}</option>`).join("")}</select></td><td>${button("save-role", "Speichern", "quiet", `data-user-id="${profile.id}"`)}</td></tr>`).join("")}</tbody></table></div><h2>Saison</h2><form class="inline-form" data-form="season-settings"><input name="seasonId" type="hidden" value="${season.id}"><label>Name<input name="name" value="${e(season.name)}" required></label><label>Rechnungsgebühr (€)<input name="fee" type="number" min="0" step="0.01" value="${Number(season.invoice_fee_cents) / 100}" required></label><label>Startkapital (€)<input name="capital" type="number" min="0" step="0.01" value="${Number(season.initial_capital_cents) / 100}" required></label><button class="button primary">Einstellungen speichern</button></form></section>` : `<p class="notice">Rollen- und Saisonverwaltung ist ausschließlich für Liga-Administratoren verfügbar.</p>`}</section><section class="admin-section"><div class="section-heading"><div><p class="eyebrow">Sportliche Wertungen</p><h2>Ergebnisse und Preisgeld</h2></div></div>${raceAdminForm(races)}</section><section class="admin-section"><h2>Teamkonten</h2>${teamReportTable(dashboard.teams || [])}<div class="tablewrap"><table><thead><tr><th>Team</th><th>Fahrer</th><th>Startende Fahrer</th></tr></thead><tbody>${races.map((race) => (race.race_entries || []).map((entry) => `<tr><td>${e(race.name)} · ${e(entry.teams?.name)}</td><td>${entry.started_drivers}</td><td>${button("set-starters", "Starterzahl", "quiet", `data-race-id="${race.id}" data-team-id="${entry.team_id}" data-starters="${entry.started_drivers}"`)}</td></tr>`).join("")).join("")}</tbody></table></div></section><section class="admin-section"><h2>Finanzaktionen</h2><form class="inline-form" data-form="create-team"><label>Neues Teamkonto<input name="name" required maxlength="80"></label><label>Öffentliche Beschreibung<input name="description" maxlength="500"></label><button class="button primary">Team und Startkapital anlegen</button></form></section>`;
}

function statBox(label, value) {
  return `<div class="stat"><small>${e(label)}</small><strong class="money">${e(value)}</strong></div>`;
}

function teamReportTable(teams) {
  return `<div class="tablewrap"><table><thead><tr><th>Team</th><th>Kontostand</th><th>Offene Rechnungen</th><th>Offene Forderungen</th><th>Verfügbar</th></tr></thead><tbody>${teams.map((team) => `<tr><td>${e(team.name)}</td><td>${money(team.balance_cents)}</td><td>${money(team.open_invoices_cents)}</td><td>${money(team.open_claims_cents)}</td><td>${money(Number(team.balance_cents) - Number(team.open_invoices_cents))}</td></tr>`).join("")}</tbody></table></div>`;
}

function raceAdminForm(races) {
  return `<div class="tablewrap"><table><thead><tr><th>Runde</th><th>Datum</th><th>Rechnungen</th><th>Ergebnisse</th><th>Freigabe</th></tr></thead><tbody>${races.map((race) => `<tr><td>${String(race.round_number).padStart(2, "0")} · ${e(race.name)}</td><td>${date(race.race_date)}</td><td>${button("race-invoices", "Erstellen", "quiet", `data-race-id="${race.id}"`)}</td><td><form class="race-result-form" data-form="race-results" data-race-id="${race.id}"><textarea name="results" rows="2" placeholder='[{"driver_id":"UUID","position":1,"status":"classified"}]' aria-label="Ergebnisse als JSON"></textarea><button class="quiet">Ergebnisse erfassen</button></form></td><td>${button("approve-results", "Preisgeld freigeben", "quiet", `data-race-id="${race.id}"`)}${button("release-claims", "Sponsoransprüche freigeben", "quiet", `data-race-id="${race.id}"`)}</td></tr>`).join("")}</tbody></table></div>`;
}

async function render() {
  renderHeader();
  if (!backendReady) {
    app.innerHTML = publicHome(null);
    return;
  }
  const [section, id] = currentRoute();
  try {
    if (section === "login" || section === "signup") {
      app.innerHTML = authPage(section === "signup");
    } else if (section === "team") {
      const data = await loadLanding();
      const profile = data.teams.find((team) => team.id === id);
      app.innerHTML = profile
        ? `${pageTitle("Öffentliches Profil", profile.name, profile.public_description || "Teamprofil der Zenith Formula Championship.")}${(profile.drivers || []).map((driver) => `<span class="tag">${e(driver.name)}</span>`).join(" ")}<p>Hauptquartier: ${e(profile.hq_city || "Nicht veröffentlicht")}</p>${state.user && !profile.ownership_active ? button("request-presidency", "Präsidentschaft anfragen", "button primary", `data-team-id="${id}"`) : ""}`
        : `<p class="empty-state">Teamprofil nicht gefunden.</p>`;
    } else if (section === "market") {
      app.innerHTML = marketPage(await loadLanding());
    } else if (section === "teams") {
      app.innerHTML = publicTeams(await loadLanding());
    } else if (section === "portal" && state.user) {
      app.innerHTML = portalView(await loadTeamPortal(state.user.id));
    } else if (section === "account" && state.user) {
      app.innerHTML = `<div class="loading-line">Finanzdaten sicher laden …</div>`;
      app.innerHTML = teamAccountView(await loadTeamAccount(id));
    } else if (section === "admin" && state.user && isStaff()) {
      app.innerHTML = `<div class="loading-line">Verwaltungsdaten sicher laden …</div>`;
      app.innerHTML = adminView(await loadFinanceWorkspace());
    } else {
      app.innerHTML = publicHome(await loadLanding());
    }
  } catch (error) {
    app.innerHTML = `<section class="empty-panel error-panel"><p class="eyebrow">Laden fehlgeschlagen</p><h2>Die Datenbank hat die Anfrage abgelehnt.</h2><p>${e(errorMessage(error))}</p><button class="button" data-action="refresh">Erneut versuchen</button></section>`;
  }
}

function busy(element, value) {
  element.disabled = value;
  element.setAttribute("aria-busy", String(value));
}

async function performAction(action, element) {
  if (!supabase) return;
  busy(element, true);
  try {
    if (action === "sign-out") {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      state.user = null;
      state.profile = null;
      location.hash = "#/";
    } else if (action === "refresh") {
      await render();
    } else if (action === "request-presidency") {
      await rpc("request_team_presidency", { p_team_id: element.dataset.teamId });
      toast("Anfrage eingereicht. Die Liga-Administration prüft sie.");
    } else if (action === "pay-invoice") {
      if (!confirm("Diese virtuelle Rechnung vollständig bezahlen?")) return;
      await rpc("pay_invoice", { p_invoice_id: element.dataset.invoiceId });
      toast("Virtuelle Zahlung gebucht.");
    } else if (action === "reserve-hq") {
      const offerId = element.dataset.offerId;
      const portal = await loadTeamPortal(state.user.id);
      const membership = portal.memberships.find((item) => item.member_role === "president");
      if (!membership) throw new Error("Kein eigenes Teamkonto gefunden.");
      await rpc("reserve_hq", { p_team_id: membership.team_id, p_offer_id: offerId, p_due_on: localDateAfter(7) });
      toast("HQ-Kauf als Rechnung reserviert. Aktiv wird das HQ nach Zahlung.");
    } else if (action === "sign-sponsor") {
      const portal = await loadTeamPortal(state.user.id);
      const membership = portal.memberships.find((item) => item.member_role === "president");
      if (!membership) throw new Error("Kein eigenes Teamkonto gefunden.");
      await rpc("sign_sponsor_contract", { p_team_id: membership.team_id, p_template_id: element.dataset.templateId });
      toast("Vertrag angenommen. Der Anspruch folgt den dokumentierten Vertragsbedingungen.");
    } else if (action === "print-invoices") {
      window.print();
    } else if (action === "open-document") {
      const url = await getPrivateDocumentUrl(element.dataset.path);
      window.open(url, "_blank", "noopener,noreferrer");
    } else if (action === "export-team") {
      await exportTeamCsv(element.dataset.teamId);
    } else if (action === "export-backup") {
      const backup = await exportFinanceBackup();
      downloadBlob(JSON.stringify(backup, null, 2), `zfc-backup-${localDateAfter(0)}.json`, "application/json");
    } else if (action === "approve-president" || action === "reject-president") {
      await rpc("review_team_presidency", { p_request_id: element.dataset.requestId, p_approve: action === "approve-president" });
      toast(action === "approve-president" ? "Präsidentschaft zugeordnet." : "Anfrage abgelehnt.");
    } else if (action === "team-costs") {
      if (!confirm("Sieben Grundkostenrechnungen einschließlich einmaligem Teamkauf ausstellen?")) return;
      await rpc("initialize_team_costs", { p_team_id: element.dataset.teamId, p_due_on: localDateAfter(7) });
      toast("Grundkostenrechnungen ausgestellt.");
    } else if (action === "new-invoice" || action === "select-team-invoice") {
      await invoiceDialog(action === "select-team-invoice" ? element.dataset.teamId : "");
      return;
    } else if (action === "issue-invoice") {
      await rpc("issue_invoice", { p_invoice_id: element.dataset.invoiceId });
      toast("Rechnung ausgestellt.");
    } else if (action === "cancel-invoice") {
      const reason = prompt("Begründung für Storno oder Gegenbuchung:");
      if (!reason?.trim()) return;
      await rpc("cancel_invoice", { p_invoice_id: element.dataset.invoiceId, p_reason: reason.trim() });
      toast("Rechnung storniert; bezahlte Positionen wurden gegengebucht.");
    } else if (action === "review-claim") {
      claimDialog(element.dataset.claimId, element.dataset.amount);
      return;
    } else if (action === "pay-claim") {
      await rpc("pay_sponsor_claim", { p_claim_id: element.dataset.claimId });
      toast("Freigegebener Anspruch ausgezahlt.");
    } else if (action === "save-role") {
      const selector = document.querySelector(`[data-role-user="${CSS.escape(element.dataset.userId)}"]`);
      await rpc("assign_user_role", { p_user_id: element.dataset.userId, p_role: selector.value });
      toast("Rolle aktualisiert.");
    } else if (action === "race-invoices") {
      await rpc("create_race_invoices", { p_race_id: element.dataset.raceId, p_team_ids: null });
      toast("Rennrechnungen erstellt. Bereits abgerechnete Teams wurden übersprungen.");
    } else if (action === "release-claims") {
      const count = await rpc("release_race_sponsor_claims", { p_race_id: element.dataset.raceId });
      toast(`${count} neue Sponsoransprüche freigegeben.`);
    } else if (action === "approve-results") {
      const count = await rpc("approve_race_results", { p_race_id: element.dataset.raceId });
      toast(`${count} neue Preisgeldansprüche freigegeben.`);
    } else if (action === "set-starters") {
      const amount = prompt("Zahl gestarteter Fahrer (0, 1 oder 2):", element.dataset.starters);
      if (amount === null) return;
      await rpc("set_race_starters", { p_race_id: element.dataset.raceId, p_team_id: element.dataset.teamId, p_started_drivers: Number(amount) });
      toast("Starterzahl aktualisiert.");
    }
    await render();
  } catch (error) {
    toast(errorMessage(error), true);
    await render();
  } finally {
    if (element?.isConnected) busy(element, false);
  }
}

function localDateAfter(days) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function downloadBlob(contents, fileName, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportTeamCsv(teamId) {
  const account = await loadTeamAccount(teamId);
  const rows = [["Datum", "Kategorie", "Vorgang", "Betrag Cent"], ...account.journal.map((entry) => [entry.created_at, entry.category, entry.description, entry.amount_cents])];
  downloadBlob(`\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`, `zfc-team-${teamId}-journal.csv`, "text/csv;charset=utf-8");
}

async function invoiceDialog(teamId = "") {
  const { data: availableTeams, error } = await supabase.from("teams").select("id,name").order("name");
  if (error) throw error;
  const teams = (availableTeams || []).map((team) => `<option value="${team.id}">${e(team.name)}</option>`).join("");
  const dialog = document.createElement("dialog");
  dialog.className = "app-dialog";
  dialog.innerHTML = `<form data-form="create-invoice"><div class="section-heading"><h2>Rechnung ausstellen</h2><button type="button" class="quiet" data-action="close-dialog">Schließen</button></div><label>Team<select name="teamId" required>${teams}</select></label><label>Titel<input name="title" required maxlength="200"></label><label>Zahlungsziel<input name="dueOn" type="date" required value="${localDateAfter(7)}"></label><label>Positionen · eine je Zeile: Kategorie | Beschreibung | Betrag in Euro<textarea name="items" rows="6" required placeholder="Sonstiges | Verwaltungsleistung | 100.00"></textarea></label><p class="fine-print">Die Datenbank ergänzt genau eine Gebühr je ausgestellter Rechnung. Entwürfe verursachen keine Gebühr.</p><button class="button primary">Ausstellen</button></form>`;
  app.append(dialog);
  if (teamId) dialog.querySelector('[name="teamId"]').value = teamId;
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

function claimDialog(claimId, initialAmount) {
  const dialog = document.createElement("dialog");
  dialog.className = "app-dialog";
  dialog.innerHTML = `<form data-form="review-claim" data-claim-id="${claimId}"><div class="section-heading"><h2>Anspruch prüfen</h2><button type="button" class="quiet" data-action="close-dialog">Schließen</button></div><label>Freizugebender Betrag in Euro<input name="amount" type="number" min="0" step="0.01" value="${Number(initialAmount) / 100}" required></label><label>Begründung<input name="reason" required minlength="3" maxlength="500"></label><button class="button primary">Freigeben</button></form>`;
  app.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

async function submitForm(form) {
  const data = new FormData(form);
  if (form.dataset.form === "login") {
    const { error } = await supabase.auth.signInWithPassword({ email: data.get("email"), password: data.get("password") });
    if (error) throw error;
    location.hash = "#/portal";
  } else if (form.dataset.form === "signup") {
    const { data: result, error } = await supabase.auth.signUp({
      email: data.get("email"),
      password: data.get("password"),
      options: { data: { display_name: data.get("displayName") } },
    });
    if (error) throw error;
    if (!result.session) toast("Konto erstellt. Bitte bestätige die E-Mail und melde dich anschließend an.");
    else toast("Konto erstellt. Die Liga-Administration kann jetzt eine Rolle zuordnen.");
  } else if (form.dataset.form === "upload-document") {
    const file = data.get("document");
    await createPrivateDocument(form.dataset.teamId, file, state.user.id);
    toast("Unterlage privat hochgeladen.");
  } else if (form.dataset.form === "create-invoice") {
    const items = String(data.get("items")).split("\n").filter((line) => line.trim()).map((line) => {
      const [category, description, euros] = line.split("|").map((part) => part.trim());
      const amount = Number(euros);
      if (!category || !description || !Number.isFinite(amount) || amount <= 0) throw new Error("Positionen bitte als Kategorie | Beschreibung | positiver Eurobetrag eingeben.");
      return { category, description, amount_cents: Math.round(amount * 100) };
    });
    const { data: season, error } = await supabase.from("seasons").select("id").eq("is_active", true).single();
    if (error) throw error;
    await rpc("create_invoice", {
      p_team_id: data.get("teamId"), p_season_id: season.id,
      p_title: String(data.get("title")).trim(), p_due_on: data.get("dueOn"),
      p_items: items, p_issue: true, p_idempotency_key: crypto.randomUUID(), p_correction_of: null,
    });
    form.closest("dialog")?.close();
    toast("Rechnung ausgestellt.");
  } else if (form.dataset.form === "review-claim") {
    await rpc("review_sponsor_claim", {
      p_claim_id: form.dataset.claimId,
      p_new_amount_cents: Math.round(Number(data.get("amount")) * 100),
      p_reason: String(data.get("reason")).trim(),
    });
    form.closest("dialog")?.close();
    toast("Anspruch geprüft und freigegeben.");
  } else if (form.dataset.form === "season-settings") {
    await rpc("update_season_settings", {
      p_season_id: data.get("seasonId"), p_name: String(data.get("name")).trim(),
      p_fee_cents: Math.round(Number(data.get("fee")) * 100),
      p_start_capital_cents: Math.round(Number(data.get("capital")) * 100),
    });
    toast("Saisoneinstellungen gespeichert; bestehende Rechnungen behalten ihre Gebühr.");
  } else if (form.dataset.form === "create-team") {
    await rpc("create_team", { p_name: String(data.get("name")).trim(), p_public_description: String(data.get("description")).trim() });
    toast("Teamkonto mit einmaligem Startkapital erstellt.");
  } else if (form.dataset.form === "race-results") {
    const results = JSON.parse(String(data.get("results")));
    await rpc("record_race_results", { p_race_id: form.dataset.raceId, p_results: results });
    toast("Ergebnisse gespeichert; noch nicht offiziell freigegeben.");
  }
  await render();
}

document.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  if (actionButton.dataset.action === "close-dialog") {
    actionButton.closest("dialog")?.close();
    return;
  }
  await performAction(actionButton.dataset.action, actionButton);
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const submitButton = form.querySelector("button[type=submit],button:not([type])");
  if (submitButton) busy(submitButton, true);
  try {
    await submitForm(form);
  } catch (error) {
    toast(errorMessage(error), true);
  } finally {
    if (submitButton?.isConnected) busy(submitButton, false);
  }
});

function onSession(session) {
  state.session = session;
  state.user = session?.user || null;
  state.profile = null;
  if (!state.user) {
    render();
    return;
  }
  loadProfile(state.user.id)
    .then((profile) => {
      state.profile = profile;
      render();
    })
    .catch((error) => {
      toast(errorMessage(error), true);
      render();
    });
}

window.addEventListener("hashchange", () => {
  state.search = "";
  render();
});

async function initialize() {
  if (backendReady) {
      supabase.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => onSession(session), 0);
      });
    const { data, error } = await supabase.auth.getSession();
    if (error) toast(errorMessage(error), true);
    onSession(data?.session || null);
  } else {
    render();
  }
}

initialize();