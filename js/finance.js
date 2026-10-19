function modal(title, body, onSubmit) {
  $("#modal").innerHTML =
    `<form id="dialogForm"><div class="row between"><h2>${title}</h2><button type="button" onclick="closeModal()" aria-label="Schließen">×</button></div>${body}<div class="actions"><button type="button" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Bestätigen</button></div></form>`;
  $("#dialogForm").onsubmit = (e) => {
    e.preventDefault();
    try {
      onSubmit(new FormData(e.target));
    } catch (err) {
      alert(err.message);
    }
  };
  $("#modal").showModal();
}
function closeModal() {
  $("#modal").close();
}
function needTeams() {
  if (!db.teams.length) {
    toast("Bitte zuerst ein Team anlegen.");
    return false;
  }
  return true;
}
function field(label, name, type = "text", value = "", extra = "") {
  return `<label>${label}</label><input name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
}
function teamField(value = "") {
  return `<label>Team</label><select name="team" required>${optionsTeams()}</select>`;
}
function newTeam() {
  modal(
    "Team anlegen",
    field("Teamname", "name", "text", "", 'required maxlength="80"') +
      field(
        "Teamchef / Teampräsident",
        "president",
        "text",
        "",
        'required maxlength="80"',
      ) +
      field("Discord-Kontakt", "discord", "text", "", 'maxlength="100"') +
      `<p>Einmaliges Startkapital: ${eur(db.settings.start)}. Teamkauf und HQ werden separat berechnet.</p>`,
    (f) => {
      const name = f.get("name").trim(),
        president = f.get("president").trim();
      if (!name || !president)
        throw Error("Name und Präsident sind erforderlich.");
      if (db.teams.some((t) => t.name.toLowerCase() === name.toLowerCase()))
        throw Error("Teamname existiert bereits.");
      const id = uid();
      db.teams.push({
        id,
        name,
        president,
        discord: f.get("discord").trim(),
        hq: null,
        setup: false,
        f1_2026: false,
        drivers: [],
      });
      entry(id, db.settings.start, "Startkapital", "Einmalige Kontoeröffnung");
      closeModal();
      commit("Team angelegt: " + name);
    },
  );
}
function editTeam(id) {
  const t = team(id);
  modal(
    "Teamdaten bearbeiten",
    field("Teamname", "name", "text", t.name, 'required maxlength="80"') +
      field(
        "Präsident",
        "president",
        "text",
        t.president,
        'required maxlength="80"',
      ) +
      field("Discord", "discord", "text", t.discord, 'maxlength="100"'),
    (f) => {
      const name = f.get("name").trim(),
        p = f.get("president").trim();
      if (!name || !p) throw Error("Pflichtfelder ausfüllen.");
      if (
        db.teams.some(
          (x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase(),
        )
      )
        throw Error("Name bereits belegt.");
      Object.assign(t, {
        name,
        president: p,
        discord: f.get("discord").trim(),
      });
      closeModal();
      commit("Teamdaten aktualisiert: " + name);
    },
  );
}
function setupTeam(id) {
  const t = team(id);
  if (t.setup) return;
  if (!confirm("Sieben Grundkostenrechnungen für " + t.name + " erstellen?"))
    return;
  // Sieben Rechnungen: Team, Teamlizenz, zwei Fahrerlizenzen separat, Anmeldung, Technik, Marketing.
  const lines = [
    ["Teamkauf", 12000000, "Teamübernahme"],
    ["Lizenzen", 1200000, "Teamlizenz"],
    ["Lizenzen", 200000, "Fahrerlizenz 1"],
    ["Lizenzen", 200000, "Fahrerlizenz 2"],
    ["Teilnahmegebühr", 1600000, "Saisonanmeldung"],
    ["Server und Technik", 480000, "Saison-Technikpaket"],
    ["Marketing", 800000, "Saison-Marketingpaket"],
  ];
  t.setupInvoices = lines.map(
    ([category, amount, note]) =>
      invoice(id, [{ category, amount, note }], note).id,
  );
  t.setup = true;
  commit("Grundkosten erstellt: " + t.name);
}
function newInvoice(id = "") {
  if (!needTeams()) return;
  modal(
    "Rechnung erstellen",
    teamField() +
      field("Betreff", "note", "text", "", 'required maxlength="200"') +
      `<label>Positionen – je Zeile: Kategorie; Beschreibung; Betrag</label><textarea name="lines" rows="5" required>Sonstiges; Verwaltungsleistung; 100000</textarea><p>Kategorien: ${categories.join(", ")}. Positive ganze Eurobeträge. Liga-Gebühr ${eur(db.settings.fee)} wird einmal ergänzt.</p>` +
      field("Zahlungsziel", "due", "date", plus(today(), 3), "required"),
    (f) => {
      const lines = f
        .get("lines")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          const parts = l.split(";");
          if (parts.length !== 3)
            throw Error("Format: Kategorie; Beschreibung; Betrag");
          const [category, note, v] = parts.map((x) => x.trim());
          const amount = Number(v);
          if (
            !categories.includes(category) ||
            !note ||
            !Number.isSafeInteger(amount) ||
            amount <= 0 ||
            amount > 1e9
          )
            throw Error("Position oder Betrag ungültig.");
          return { category, note, amount };
        });
      if (!lines.length) throw Error("Mindestens eine Position erforderlich.");
      invoice(f.get("team"), lines, f.get("note").trim(), f.get("due"));
      closeModal();
      commit("Rechnung erstellt");
    },
  );
  if (id) $("#dialogForm [name=team]").value = id;
}
function payInvoice(id) {
  const i = db.invoices.find((i) => i.id === id);
  if (!i || i.status !== "open") return;
  if (balance(i.team) < total(i))
    return alert("Kontostand reicht für diese Zahlung nicht aus.");
  if (!confirm(i.number + " über " + eur(total(i)) + " bezahlen?")) return;
  i.lines.forEach((l) =>
    entry(i.team, -l.amount, l.category, i.number + ": " + l.note, i.id),
  );
  if (i.fee)
    entry(i.team, -i.fee, "Liga-Gebühr", i.number + ": Rechnungsgebühr", i.id);
  i.status = "paid";
  i.paid = today();
  commit("Rechnung bezahlt: " + i.number);
}
function cancelInvoice(id) {
  const i = db.invoices.find((i) => i.id === id);
  if (!i || i.status === "cancelled") return;
  if (
    team(i.team)?.hqInvoice === id ||
    (team(i.team)?.setupInvoices || []).includes(id)
  )
    return alert(
      "Grundkosten und HQ-Käufe sind an die Startberechtigung gekoppelt und können in Version 1.0 nicht storniert werden. Andere Rechnungen können storniert oder rückgebucht werden.",
    );
  const reason = prompt("Begründung für Storno / Rückbuchung:");
  if (!reason?.trim()) return;
  if (i.status === "paid") {
    const entries = db.ledger.filter((l) => l.ref === id);
    entries.forEach((l) =>
      entry(
        i.team,
        -l.amount,
        l.category,
        "Storno " + i.number + ": " + reason,
        "reversal:" + id,
      ),
    );
  }
  i.status = "cancelled";
  i.reason = reason;
  commit("Rechnung storniert: " + i.number);
}
function showInvoice(id) {
  const i = db.invoices.find((x) => x.id === id);
  $("#modal").innerHTML =
    `<div class="row between"><h2>ZFC / ${esc(i.number)}</h2><button onclick="closeModal()">×</button></div><p>Virtuelle Ligarechnung · ${esc(db.settings.season)}</p><h3>${esc(team(i.team)?.name)}</h3><p>${esc(i.note)}<br>Erstellt: ${i.date} · Fällig: ${i.due}<br>Status: ${esc(i.status)}</p>${table(["Position", "Betrag"], i.lines.map((l) => `<tr><td>${esc(l.category)}<small>${esc(l.note)}</small></td><td>${eur(l.amount)}</td></tr>`).join("") + `<tr><td>Liga-Gebühr</td><td>${eur(i.fee)}</td></tr><tr><td><b>Gesamt</b></td><td><b>${eur(total(i))}</b></td></tr>`)}<div class="actions"><button onclick="window.print()">Drucken / PDF</button><button onclick="closeModal()">Schließen</button></div>`;
  $("#modal").showModal();
}
function newEntry(id = "") {
  if (!needTeams()) return;
  modal(
    "Manuelle Buchung",
    teamField() +
      `<label>Buchungsart</label><select name="direction"><option value="1">Einnahme / Gutschrift</option><option value="-1">Ausgabe / Korrektur (ohne Rechnung)</option></select><label>Kategorie</label><select name="category">${categories.map((c) => `<option>${c}</option>`).join("")}</select>` +
      field(
        "Betrag (€)",
        "amount",
        "number",
        "",
        'required min="1" max="1000000000" step="1"',
      ) +
      field(
        "Beschreibung / Begründung",
        "note",
        "text",
        "",
        'required maxlength="250"',
      ) +
      `<p>Für reguläre Ausgaben eine Rechnung erstellen. Diese direkte Buchung erhebt keine Liga-Gebühr.</p>`,
    (f) => {
      const amount = Number(f.get("amount")) * Number(f.get("direction"));
      if (amount < 0 && balance(f.get("team")) + amount < 0)
        throw Error("Kontostand nicht ausreichend.");
      entry(f.get("team"), amount, f.get("category"), f.get("note").trim());
      closeModal();
      commit("Manuelle Buchung erfasst");
    },
  );
  if (id) $("#dialogForm [name=team]").value = id;
}

function settingsSave(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  db.settings = {
    season: f.get("season").trim(),
    start: Number(f.get("start")),
    fee: Number(f.get("fee")),
  };
  commit("Saisoneinstellungen gespeichert");
}
