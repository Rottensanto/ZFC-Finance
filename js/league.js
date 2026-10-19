function buyHQ(hid) {
  if (!needTeams()) return;
  const h = HQS.find((h) => h.id === hid);
  modal(
    "HQ kaufen: " + h.city,
    teamField() +
      `<p>Kaufpreis: ${eur(h.price)} + ${eur(db.settings.fee)} Gebühr.<br>Unterhalt: ${eur(h.upkeep)} pro Rennen. Kein Umzug in Version 1.0.</p>`,
    (f) => {
      const t = team(f.get("team"));
      if (t.hq) throw Error("Dieses Team besitzt bereits ein HQ.");
      if (available(t.id) < h.price + db.settings.fee)
        throw Error("Verfügbares Budget reicht nicht aus.");
      const i = invoice(
        t.id,
        [{ category: "HQ", amount: h.price, note: "HQ " + h.city }],
        "HQ-Kauf " + h.city,
      );
      t.hq = h.id;
      t.hqInvoice = i.id;
      closeModal();
      commit("HQ reserviert und Rechnung erstellt: " + t.name);
    },
  );
}
function signSponsor(sid) {
  if (!needTeams()) return;
  const s = SPONSORS.find((s) => s.id === sid);
  modal(
    "Sponsor: " + s.name,
    teamField() +
      field("Vertragsbeginn", "date", "date", today(), "required") +
      `<p>${s.desc}<br>Alle Auszahlungen sieben Tage später. Maximal ein Vertrag je Sponsorart pro Team und Saison.</p>`,
    (f) => {
      const tid = f.get("team"),
        date = f.get("date");
      if (db.contracts.some((c) => c.team === tid && c.sponsor === sid))
        throw Error("Sponsorplatz bereits belegt.");
      if (db.rounds.some((r) => r.released.includes(tid)))
        throw Error("Verträge bitte vor der ersten Rennfreigabe abschließen.");
      if (date > db.rounds[0].date)
        throw Error(
          "Vertragsbeginn muss spätestens am ersten Renntermin liegen.",
        );
      const c = { id: uid(), team: tid, sponsor: sid, date };
      db.contracts.push(c);
      if (s.mode === "split")
        claim(tid, 3000000, s.name + " · Rate 1", date, c.id + ":1");
      closeModal();
      commit("Sponsorvertrag abgeschlossen");
    },
  );
}
function editRound(id) {
  const r = db.rounds.find((x) => x.id === id);
  if (r.billed.length || r.released.length)
    return alert("Bereits abgerechnete / freigegebene Rennen sind gesperrt.");
  modal(
    "Rennen bearbeiten",
    field("Bezeichnung", "name", "text", r.name, 'required maxlength="100"') +
      field(
        "Land (wie HQ-Land schreiben)",
        "country",
        "text",
        r.country,
        'required maxlength="80"',
      ) +
      field("Renndatum", "date", "date", r.date, "required") +
      field(
        "Breitengrad",
        "lat",
        "number",
        r.lat,
        'required min="-90" max="90" step="0.0001"',
      ) +
      field(
        "Längengrad",
        "lon",
        "number",
        r.lon,
        'required min="-180" max="180" step="0.0001"',
      ),
    (f) => {
      r.name = f.get("name").trim();
      r.country = f.get("country").trim();
      r.date = f.get("date");
      r.lat = Number(f.get("lat"));
      r.lon = Number(f.get("lon"));
      closeModal();
      commit("Renntermin aktualisiert");
    },
  );
}
function ready(t) {
  return (
    t.setup &&
    t.hq &&
    (t.setupInvoices || []).every(
      (id) => db.invoices.find((i) => i.id === id)?.status === "paid",
    ) &&
    db.invoices.find((i) => i.id === t.hqInvoice)?.status === "paid"
  );
}
function billRound(id) {
  const r = db.rounds.find((x) => x.id === id),
    eligible = db.teams.filter((t) => ready(t) && !r.billed.includes(t.id));
  if (!eligible.length)
    return alert(
      "Keine neuen berechtigten Teams. Erst HQ und alle Grundkosten bezahlen.",
    );
  if (!confirm("Rennrechnung für " + eligible.length + " Teams erstellen?"))
    return;
  eligible.forEach((t) => {
    const h = hq(t);
    invoice(
      t.id,
      [
        { category: "Teilnahmegebühr", note: r.name, amount: 180000 },
        { category: "Rennveranstaltung", note: r.name, amount: 120000 },
        { category: "Streckenmiete", note: r.name, amount: 160000 },
        {
          category: "HQ",
          note: "HQ-Unterhalt " + h.city,
          amount: h.upkeep,
        },
        {
          category: "Reisekosten",
          note: h.city + " → " + r.name,
          amount: travel(t, r),
        },
        { category: "Sonstiges", note: "Rennbetrieb", amount: 25000 },
      ],
      "R" + r.number + " · " + r.name,
      plus(r.date, -3),
    );
    r.billed.push(t.id);
  });
  commit("Rennrechnungen erstellt: " + r.name);
}
function releaseRound(id) {
  const r = db.rounds.find((x) => x.id === id);
  if (r.date > today())
    return alert("Rennen kann erst am Renntag oder danach freigegeben werden.");
  const eligible = db.teams.filter(
    (t) => r.billed.includes(t.id) && !r.released.includes(t.id),
  );
  if (!eligible.length)
    return alert(
      "Keine neuen Teams zur Freigabe. Zuerst Rennrechnung erstellen.",
    );
  modal(
    "Sponsoransprüche freigeben",
    `<p>R${r.number} · ${esc(r.name)}. Nur teilnehmende Teams auswählen. Kürzungen anschließend unter Auszahlungen prüfen.</p>${eligible.map((t) => `<label><input type="checkbox" name="teams" value="${t.id}" checked> ${esc(t.name)}</label>`).join("")}`,
    (f) => {
      const ids = f.getAll("teams");
      if (!ids.length) throw Error("Mindestens ein Team auswählen.");
      ids.forEach((tid) => {
        db.contracts
          .filter((c) => c.team === tid)
          .forEach((c) => {
            const s = SPONSORS.find((s) => s.id === c.sponsor);
            if (s.mode === "race")
              claim(
                tid,
                s.amount,
                s.name + " · R" + r.number,
                r.date,
                c.id + ":r" + r.number,
              );
            if (s.mode === "split" && r.number === 8)
              claim(tid, 3000000, s.name + " · Rate 2", r.date, c.id + ":2");
            if (s.mode === "once" && r.number === 4)
              claim(tid, s.amount, s.name, r.date, c.id + ":once");
          });
        r.released.push(tid);
      });
      closeModal();
      commit("Sponsoransprüche freigegeben: " + r.name);
    },
  );
}
function editClaim(id) {
  const c = db.claims.find((c) => c.id === id);
  if (c.status !== "pending") return;
  modal(
    "Anspruch prüfen",
    field(
      "Auszahlungsbetrag (€)",
      "amount",
      "number",
      c.amount,
      'required min="0" max="1000000000" step="1"',
    ) +
      field(
        "Begründung / Prüfung",
        "note",
        "text",
        c.review || "",
        'required maxlength="250"',
      ) +
      `<p>Fälligkeit ${c.due} · Auszahlung ab ${c.pay}. Veränderte Beträge werden im Protokoll dokumentiert.</p>`,
    (f) => {
      const old = c.amount;
      c.amount = Number(f.get("amount"));
      c.review = f.get("note").trim();
      if (!c.review) throw Error("Begründung erforderlich.");
      closeModal();
      commit(
        "Anspruch geprüft: " +
          eur(old) +
          " → " +
          eur(c.amount) +
          " · " +
          c.review,
      );
    },
  );
}
function settle(id) {
  const c = db.claims.find((c) => c.id === id);
  if (!c || c.status !== "pending" || c.pay > today()) return;
  if (!confirm(eur(c.amount) + " an " + team(c.team).name + " auszahlen?"))
    return;
  entry(c.team, c.amount, "Sponsoring", c.note, c.id);
  c.status = "received";
  c.received = today();
  commit("Sponsorenauszahlung gebucht");
}
function settleDue() {
  const list = db.claims.filter(
    (c) => c.status === "pending" && c.pay <= today(),
  );
  if (!list.length) return toast("Keine fälligen Auszahlungen.");
  if (
    !confirm(
      list.length +
        " geprüfte Ansprüche über " +
        eur(list.reduce((a, c) => a + c.amount, 0)) +
        " auszahlen?",
    )
  )
    return;
  list.forEach((c) => {
    entry(c.team, c.amount, "Sponsoring", c.note, c.id);
    c.status = "received";
    c.received = today();
  });
  commit("Fällige Sponsorenauszahlungen gebucht");
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
