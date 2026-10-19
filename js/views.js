function render() {
  const [page, accountId] = (location.hash.slice(1) || "front").split("/");
  let html = "";
  if (page === "front") {
    html = `<section class="hero"><div><div class="eyebrow">Zenith Formula Championship</div><h1>Race for glory.<br><span style="color:var(--mint)">Build your legacy.</span></h1><p>Ein Team. Ein Hauptquartier. Deine Entscheidungen. Die wirtschaftliche Heimat der ZFC – von der ersten Übernahme bis zur nächsten Meisterschaft.</p><div class="row"><a class="button primary" href="#home">Finance Office öffnen ↗</a><a class="button" href="#market">Marktplatz entdecken</a></div><p style="font-size:12px">Virtuelle Teamwirtschaft · 16 Rennen · Ein gemeinsames Regelmodell</p></div><div class="hero-art"><span class="tag green">SEASON FINANCE</span><p>Dein Startkapital</p><div class="bigmoney">${eur(db.settings.start)}</div><div class="track"></div><div class="row between"><span>Strategie abseits der Strecke</span><span class="success">ZFC / 01</span></div></div></section><div class="grid"><div class="card"><div class="eyebrow">01 / Ownership</div><h2>Dein Team. Deine Verantwortung.</h2><p>Team kaufen, Präsidenten ernennen und den finanziellen Grundstein legen.</p><a href="#teams">Teams verwalten →</a></div><div class="card"><div class="eyebrow">02 / Partnerships</div><h2>Partner für die nächste Saison.</h2><p>Vier Sponsorplätze mit klaren Verträgen und sieben Tagen Auszahlungsverzug.</p><a href="#market">Sponsoren ansehen →</a></div><div class="card"><div class="eyebrow">03 / Finance</div><h2>Jede Entscheidung zählt.</h2><p>Rechnungen, Zahlungsfreigaben und ein nachvollziehbares Buchungsjournal.</p><a href="#invoices">Zur Rechnungsverwaltung →</a></div></div><div class="notice">Diese Version arbeitet lokal in deinem Browser. Es gibt noch keine Benutzeranmeldung oder gemeinsame Live-Datenbank. Die Beispiel-Sponsoren sind virtuelle Angebote.</div>`;
  } else if (page === "account" && team(accountId)) {
    html = `<div class="tabs">${views.map((v) => `<a class="${v[0] === "teams" ? "active" : ""}" href="#${v[0]}">${v[1]}</a>`).join("")}</div>`;
    html += accountPage(accountId);
  } else {
    html = `<div class="tabs">${views.map((v) => `<a class="${v[0] === page ? "active" : ""}" href="#${v[0]}">${v[1]}</a>`).join("")}</div>`;
    const pages = {
      home: dashboard,
      teams: teamsPage,
      invoices: invoicesPage,
      ledger: ledgerPage,
      market: marketPage,
      calendar: calendarPage,
      claims: claimsPage,
      settings: settingsPage,
    };
    html += (pages[page] || dashboard)();
  }
  $("#app").innerHTML = html;
  document
    .querySelectorAll("header nav a")
    .forEach((a) =>
      a.classList.toggle(
        "active",
        a.hash === "#" + (page === "account" ? "teams" : page),
      ),
    );
  if ($("#teamFilter")) {
    $("#teamFilter").value = selected;
    $("#teamFilter").onchange = (e) => {
      selected = e.target.value;
      render();
    };
    $("#search").value = query;
    $("#search").oninput = (e) => {
      query = e.target.value;
      const pos = e.target.selectionStart;
      render();
      $("#search").focus();
      $("#search").setSelectionRange(pos, pos);
    };
  }
}
function dashboard() {
  const cash = db.teams.reduce((a, t) => a + balance(t.id), 0),
    pending = db.invoices.filter((i) => i.status === "open");
  return (
    top(
      "Das Finanzcockpit.",
      "Alle Teams, Verpflichtungen und nächsten Schritte an einem Ort.",
      `<button onclick="download()">↓ JSON sichern</button><button class="primary" onclick="newInvoice()">+ Rechnung</button>`,
    ) +
    `<div class="notice">Lokaler Verwaltungsmodus · Änderungen werden in diesem Browser gespeichert. Für Teamarbeit auf mehreren Geräten ist ein Backend erforderlich.</div><div class="stats">${stat("Teamvermögen gesamt", eur(cash), db.teams.length + " registrierte Teams")}${stat("Offene Rechnungen", eur(pending.reduce((a, i) => a + total(i), 0)), pending.length + " Rechnungen")}${stat("Ausstehende Einnahmen", eur(db.claims.filter((c) => c.status === "pending").reduce((a, c) => a + c.amount, 0)), "Noch nicht verfügbar")}${stat("Liga-Gebühren bezahlt", eur(db.invoices.filter((i) => i.status === "paid").reduce((a, i) => a + i.fee, 0)), "In Teamabbuchungen enthalten")}</div><div class="split"><section><h2>Teamübersicht</h2>${table(["Team / Präsident", "Kontostand", "Verfügbar"], db.teams.map((t) => `<tr><td><b>${esc(t.name)}</b><small>${esc(t.president)}</small></td><td>${eur(balance(t.id))}</td><td class="${available(t.id) < 0 ? "bad" : "success"}">${eur(available(t.id))}</td></tr>`).join(""))}</section><section class="card"><div class="eyebrow">Aktivitätsprotokoll</div><h2>Zuletzt im Office</h2>${
      db.audit
        .slice(0, 7)
        .map(
          (a) =>
            `<p style="border-bottom:1px solid var(--line);padding-bottom:10px"><small>${esc(new Date(a.time).toLocaleString("de-DE"))}</small><br><span style="color:white">${esc(a.action)}</span></p>`,
        )
        .join("") || "<p>Beginne mit einem neuen Team.</p>"
    }<a href="#settings">Regeln & Datensicherung →</a></section></div>`
  );
}
function teamsPage() {
  return (
    top(
      "Teams & Konten",
      "Elf F1-Konten der Saison 2026 mit getrennten Salden und Finanzübersichten.",
      `<button class="primary" onclick="newTeam()">+ Team anlegen</button>`,
    ) +
    `<div class="grid">${db.teams.map((t) => `<article class="card"><div class="row between"><span class="tag">${t.f1_2026 ? "F1 2026" : "TEAMKONTO"}</span><button onclick="editTeam('${t.id}')">Bearbeiten</button></div><h2 style="margin-top:15px">${esc(t.name)}</h2><p>${t.drivers?.length ? `Fahrer: ${t.drivers.map(esc).join(" · ")}<br>` : ""}HQ: ${esc(hq(t)?.city || "Noch nicht gekauft")}<br>Discord: ${esc(t.discord || "—")}</p><div class="bigmoney" style="font-size:30px">${eur(balance(t.id))}</div><p>Offene Rechnungen: ${eur(open(t.id))}<br>Verfügbar: <b class="${available(t.id) < 0 ? "bad" : "success"}">${eur(available(t.id))}</b><br>Offene Einnahmen: ${eur(receivable(t.id))}</p><div class="row"><a class="button primary" href="#account/${t.id}">Finanzkonto öffnen →</a><button onclick="newInvoice('${t.id}')">Rechnung</button></div></article>`).join("")}</div>`
  );
}
function accountPage(id) {
  const t = team(id);
  const teamInvoices = db.invoices
    .filter((i) => i.team === id)
    .slice()
    .reverse();
  const teamLedger = db.ledger
    .filter((l) => l.team === id)
    .slice()
    .reverse();
  const teamClaims = db.claims
    .filter((c) => c.team === id)
    .slice()
    .reverse();
  const teamContracts = db.contracts.filter((c) => c.team === id);
  const income = teamLedger
    .filter((l) => l.amount > 0)
    .reduce((sum, l) => sum + l.amount, 0);
  const expenses = -teamLedger
    .filter((l) => l.amount < 0)
    .reduce((sum, l) => sum + l.amount, 0);
  return (
    top(
      `${t.name} · Finanzkonto`,
      "Kontostand, Verpflichtungen, Buchungen und Sponsoreneinnahmen dieses Teams.",
      `<a class="button" href="#teams">← Alle Teams</a><button onclick="newEntry('${id}')">+ Buchung</button><button class="primary" onclick="newInvoice('${id}')">+ Rechnung</button>`,
    ) +
    `<div class="notice">${t.drivers?.length ? `Fahrer 2026: ${t.drivers.map(esc).join(" · ")} · ` : ""}Hauptquartier: ${esc(hq(t)?.city || "Noch nicht gekauft")} · Saisonstart: ${eur(db.settings.start)}</div><div class="stats">${stat("Kontostand", eur(balance(id)), "Gebuchte Einnahmen abzüglich Ausgaben")}${stat("Verfügbar", eur(available(id)), "Nach offenen Rechnungen")}${stat("Einnahmen", eur(income), "Gebuchte Gutschriften")}${stat("Ausgaben", eur(expenses), "Gebuchte Abbuchungen")}${stat("Offene Rechnungen", eur(open(id)), teamInvoices.filter((i) => i.status === "open").length + " offen")}${stat("Ausstehende Sponsorzahlungen", eur(receivable(id)), "Noch nicht gebucht")}</div><div class="row" style="margin-bottom:20px">${!t.setup ? `<button onclick="setupTeam('${id}')">Grundkosten erstellen</button>` : ""}${!t.hq ? `<a class="button" href="#market">HQ auswählen</a>` : `<span class="tag green">HQ: ${esc(hq(t)?.city || "")}</span>`}<a class="button" href="#claims">Alle Auszahlungen</a><a class="button" href="#ledger">Gesamtjournal</a></div><div class="split"><section><h2>Rechnungen</h2>${table(["Nummer", "Betreff", "Fällig", "Betrag", "Status", "Aktion"], teamInvoices.map((i) => `<tr><td>${esc(i.number)}</td><td>${esc(i.note)}</td><td>${esc(i.due)}</td><td>${eur(total(i))}</td><td>${status(i.status, i.status === "open" && i.due < today())}</td><td><button onclick="showInvoice('${i.id}')">Details</button>${i.status === "open" ? ` <button onclick="payInvoice('${i.id}')">Bezahlen</button>` : ""}</td></tr>`).join(""))}</section><section class="card"><h2>Sponsorverträge</h2>${table(
      ["Partner", "Typ", "Beginn"],
      teamContracts
        .map((c) => {
          const sponsor = SPONSORS.find((s) => s.id === c.sponsor);
          return `<tr><td>${esc(sponsor?.name || c.sponsor)}</td><td>${esc(sponsor?.type || "")}</td><td>${esc(c.date)}</td></tr>`;
        })
        .join(""),
    )}</section></div><section style="margin-top:28px"><h2>Buchungsjournal</h2>${table(
      ["Datum", "Kategorie", "Beschreibung", "Betrag"],
      teamLedger
        .slice(0, 30)
        .map(
          (l) =>
            `<tr><td>${esc(l.date)}</td><td>${esc(l.category)}</td><td>${esc(l.note)}</td><td class="${l.amount >= 0 ? "success" : "bad"}">${eur(l.amount)}</td></tr>`,
        )
        .join(""),
    )}</section><section style="margin-top:28px"><h2>Sponsoransprüche</h2>${table(["Anspruch", "Fällig", "Auszahlbar ab", "Betrag", "Status / Aktion"], teamClaims.map((c) => `<tr><td>${esc(c.note)}</td><td>${esc(c.due)}</td><td>${esc(c.pay)}</td><td>${eur(c.amount)}</td><td>${status(c.status)}${c.status === "pending" ? ` <button onclick="editClaim('${c.id}')">Prüfen</button> <button onclick="settle('${c.id}')" ${c.pay > today() ? "disabled" : ""}>Auszahlen</button>` : ""}</td></tr>`).join(""))}</section>`
  );
}
function invoicesPage() {
  return (
    top(
      "Rechnungsverwaltung",
      "Eine Liga-Gebühr pro Rechnung. Zahlungen werden genau einmal ins Journal übernommen.",
      `<button onclick="window.print()">Drucken</button><button class="primary" onclick="newInvoice()">+ Rechnung erstellen</button>`,
    ) +
    filterbar() +
    table(
      [
        "Nummer / Betreff",
        "Team",
        "Fällig",
        "Betrag inkl. Gebühr",
        "Status",
        "Aktion",
      ],
      db.invoices
        .filter((i) =>
          matches(i.team, i.number + " " + i.note + " " + team(i.team)?.name),
        )
        .slice()
        .reverse()
        .map(
          (i) =>
            `<tr><td><b>${esc(i.number)}</b><small>${esc(i.note)}</small></td><td>${esc(team(i.team)?.name)}</td><td>${esc(i.due)}</td><td>${eur(total(i))}</td><td>${status(i.status, i.status === "open" && i.due < today())}</td><td><button onclick="showInvoice('${i.id}')">Details</button> ${i.status === "open" ? `<button onclick="payInvoice('${i.id}')">Bezahlen</button> <button onclick="cancelInvoice('${i.id}')">Storno</button>` : i.status === "paid" ? `<button onclick="cancelInvoice('${i.id}')">Rückbuchen</button>` : ""}</td></tr>`,
        )
        .join(""),
    )
  );
}
function status(s, late = false) {
  return `<span class="tag ${s === "paid" || s === "received" ? "green" : late ? "red" : ""}">${late ? "Überfällig" : { open: "Offen", paid: "Bezahlt", cancelled: "Storniert", pending: "Ausstehend", received: "Ausgezahlt" }[s] || s}</span>`;
}
function ledgerPage() {
  return (
    top(
      "Buchungsjournal",
      "Gebuchte Einnahmen und Ausgaben. Korrekturen bleiben als Gegenbuchung sichtbar.",
      `<button onclick="csv()">↓ CSV</button><button class="primary" onclick="newEntry()">+ Buchung</button>`,
    ) +
    filterbar() +
    table(
      ["Datum", "Team", "Kategorie", "Beschreibung", "Betrag"],
      db.ledger
        .filter((l) => matches(l.team, l.note + " " + l.category))
        .slice()
        .reverse()
        .map(
          (l) =>
            `<tr><td>${l.date}</td><td>${esc(team(l.team)?.name)}</td><td>${esc(l.category)}</td><td>${esc(l.note)}</td><td class="${l.amount >= 0 ? "success" : "bad"}">${eur(l.amount)}</td></tr>`,
        )
        .join(""),
    )
  );
}
function marketPage() {
  return (
    top(
      "Der ZFC-Marktplatz",
      "Hauptquartiere erwerben und Sponsorenverträge für dein Team abschließen.",
    ) +
    `<h2>HQ-Standorte</h2><div class="grid">${HQS.map((h) => `<div class="card"><span class="tag">${h.tier}</span><h2 style="margin-top:15px">${h.city}</h2><p>${h.country}<br>Unterhalt: ${eur(h.upkeep)} / Rennen<br>Reisen werden vom Standort berechnet.</p><h3>${eur(h.price)}</h3><button onclick="buyHQ('${h.id}')">HQ kaufen</button></div>`).join("")}</div><h2 style="margin-top:35px">Sponsorenangebote</h2><p>Virtuelle Verträge. Je ein Vertrag pro Kategorie und Team. Keine automatische Garantie für Teilnahmebedingungen.</p><div class="grid">${SPONSORS.map((s) => `<div class="card"><span class="tag green">${s.type}</span><h2 style="margin-top:15px">${s.name}</h2><p>${s.desc}</p><p>Auszahlung immer 7 Tage nach Fälligkeit.</p><button onclick="signSponsor('${s.id}')">Vertrag abschließen</button></div>`).join("")}</div><h2 style="margin-top:35px">Aktive Verträge</h2>${table(
      ["Team", "Sponsor", "Kategorie", "Vertragsbeginn"],
      db.contracts
        .map((c) => {
          const s = SPONSORS.find((s) => s.id === c.sponsor);
          return `<tr><td>${esc(team(c.team)?.name)}</td><td>${esc(s.name)}</td><td>${s.type}</td><td>${c.date}</td></tr>`;
        })
        .join(""),
    )}`
  );
}
function calendarPage() {
  return (
    top(
      "Rennkalender",
      "Bearbeitbare Beispieltermine. Rennrechnungen und Sponsoransprüche werden je Team nur einmal erzeugt.",
    ) +
    `<div class="notice">Vor dem Saisonbeginn die Termine bearbeiten. Rennfreigabe erst nach Prüfung der Teilnahme und Sponsorbedingungen ausführen. Rechnungs- und Anspruchsdaten bleiben nach Erstellung unverändert.</div>` +
    table(
      [
        "Runde",
        "Veranstaltung",
        "Datum",
        "Rennrechnung",
        "Sponsoransprüche",
        "Kalender",
      ],
      db.rounds
        .map(
          (r) =>
            `<tr><td>${String(r.number).padStart(2, "0")}</td><td><b>${esc(r.name)}</b><small>${esc(r.country)}</small></td><td>${r.date}</td><td><button onclick="billRound('${r.id}')">Erstellen (${r.billed.length})</button></td><td><button onclick="releaseRound('${r.id}')">Freigeben (${r.released.length})</button></td><td><button onclick="editRound('${r.id}')">Bearbeiten</button></td></tr>`,
        )
        .join(""),
    )
  );
}
function claimsPage() {
  return (
    top(
      "Sponsorenauszahlungen",
      "Fälligkeit und Auszahlung sind getrennt. Eine Auszahlung ist frühestens nach sieben Tagen möglich.",
      `<button class="primary" onclick="settleDue()">Fällige Beträge auszahlen</button>`,
    ) +
    filterbar() +
    table(
      [
        "Team",
        "Anspruch",
        "Fällig laut Vertrag",
        "Auszahlbar ab",
        "Betrag",
        "Status / Aktion",
      ],
      db.claims
        .filter((c) => matches(c.team, c.note))
        .slice()
        .reverse()
        .map(
          (c) =>
            `<tr><td>${esc(team(c.team)?.name)}</td><td>${esc(c.note)}</td><td>${c.due}</td><td>${c.pay}</td><td>${eur(c.amount)}</td><td>${status(c.status)} ${c.status === "pending" ? `<button onclick="editClaim('${c.id}')">Prüfen</button> <button onclick="settle('${c.id}')" ${c.pay > today() ? "disabled" : ""}>Auszahlen</button>` : ""}</td></tr>`,
        )
        .join(""),
    )
  );
}
function settingsPage() {
  return (
    top(
      "System & Datensicherung",
      "Einstellungen gelten für neue Vorgänge. Bestehende Rechnungen und Buchungen bleiben unverändert.",
    ) +
    `<div class="split"><section class="card"><h2>Saisoneinstellungen</h2><form onsubmit="settingsSave(event)"><label>Saisonname</label><input name="season" value="${esc(db.settings.season)}" required maxlength="100"><label>Startkapital pro neuem Team (€)</label><input name="start" type="number" min="0" max="1000000000" step="1" value="${db.settings.start}" required><label>Liga-Gebühr je neuer Rechnung (€)</label><input name="fee" type="number" min="0" max="1000000" step="1" value="${db.settings.fee}" required><div class="actions"><button class="primary">Speichern</button></div></form></section><section class="card"><h2>Daten mitnehmen</h2><p>JSON enthält den vollständigen Datenstand. CSV exportiert das Buchungsjournal. Vor einem Import wird ein Sicherungsexport angeboten.</p><div class="row"><button onclick="download()">JSON exportieren</button><button onclick="$('#importFile').click()">JSON importieren</button><button onclick="csv()">Journal als CSV</button></div><p class="bad">Ein Import ersetzt den lokalen Datenstand. Dateien nur aus vertrauenswürdigen Quellen importieren.</p></section></div><section class="card help" style="margin-top:20px"><h2>So arbeitet ihr mit dem System</h2><ol><li>Team anlegen: 25 Mio. € Startkapital werden einmalig als Eröffnung gebucht.</li><li>Grundkosten erstellen: Teamkauf, Lizenzen, Anmeldung, Technik und Marketing – sieben Rechnungen. HQ folgt als achte Rechnung.</li><li>HQ kaufen: Der Standort ist reserviert; Rennbetrieb wird erst nach Zahlung der HQ- und Grundkostenrechnungen freigeschaltet.</li><li>Sponsoren abschließen: Hauptsponsorrate 1 wird geplant; weitere Ansprüche entstehen nach Rennfreigaben.</li><li>Kalender prüfen, Rennrechnungen erzeugen und bezahlen. Die Rechnung enthält HQ-Unterhalt und entfernungsabhängige Reise.</li><li>Sponsoransprüche nach Prüfung freigeben. Kürzungen und Begründungen vor Auszahlung über „Prüfen“ dokumentieren.</li><li>Preisgeld, Saisonprämien und weitere Einnahmen als Buchung erfassen. Teamprämien als Rechnung erstellen.</li><li>JSON regelmäßig exportieren. Änderungen auf anderen Geräten werden in dieser Version nicht synchronisiert.</li></ol><h2>Für die Weiterentwicklung auf GitHub</h2><p>Diese Datei benötigt keine Bibliotheken und läuft auf GitHub Pages. Für gemeinsamen Betrieb: Datenmodell in eine Datenbank übertragen, serverseitige Transaktionen und Rollen (Liga-Admin, Finanzverwaltung, Teampräsident) ergänzen. Eine Frontend-Rollenauswahl ist kein Zugriffsschutz. Keine Passwörter oder API-Schlüssel in diese Datei schreiben.</p><p>Das Journal ist innerhalb der Oberfläche ohne Löschfunktion; Browserdaten und JSON-Dateien sind technisch veränderbar. Diese Version ist deshalb keine revisionssichere Mehrbenutzer-Buchhaltung.</p><h2>Finanzmodell</h2><p>Startkapital 25 Mio. € · Team 12 Mio. € · Teamlizenz 1,2 Mio. € · Fahrer je 200.000 € · Anmeldung 1,6 Mio. € · Technik 480.000 € · Marketing 800.000 €. Pro Rennen: Teilnahme 180.000 €, Veranstaltung 120.000 €, Strecke 160.000 €, Sonstiges 25.000 €, HQ und Reise variabel. Teamprämienbudget 1,2 Mio. € manuell abrechnen. HQs sind pro Team verfügbar, keine exklusiven Grundstücke. Virtuelle Euro; keine echte Zahlungsabwicklung.</p></section>`
  );
}
