function blobDownload(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function download() {
  blobDownload(
    JSON.stringify(db, null, 2),
    "zfc-finance-" + today() + ".json",
    "application/json",
  );
}
function csv() {
  const safe = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const rows = [
    ["Datum", "Team", "Kategorie", "Beschreibung", "Betrag EUR"],
    ...db.ledger.map((l) => [
      l.date,
      team(l.team)?.name,
      l.category,
      l.note,
      l.amount,
    ]),
  ];
  blobDownload(
    "\uFEFF" + rows.map((r) => r.map(safe).join(";")).join("\r\n"),
    "zfc-journal-" + today() + ".csv",
    "text/csv;charset=utf-8",
  );
}
// Strict backup validator: reject malformed IDs, links, money and derived states.
function validate(d) {
  const fail = () => {
    throw Error("Ungültige oder inkonsistente ZFC-Sicherungsdatei.");
  };
  if (!d || d.version !== 1 || !d.settings) fail();
  const money = (n) => Number.isSafeInteger(n) && Math.abs(n) <= 1e12;
  const str = (s) => typeof s === "string" && s.length < 10000;
  const date = (s) =>
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !isNaN(new Date(s + "T12:00:00Z"));
  if (
    !str(d.settings.season) ||
    !money(d.settings.start) ||
    d.settings.start < 0 ||
    !money(d.settings.fee) ||
    d.settings.fee < 0
  )
    fail();
  const arrays = [
    "teams",
    "invoices",
    "ledger",
    "contracts",
    "claims",
    "audit",
    "rounds",
  ];
  arrays.forEach((k) => {
    if (!Array.isArray(d[k]) || d[k].length > 100000) fail();
    const ids = new Set();
    d[k].forEach((x) => {
      if (!x || !str(x.id) || !x.id || ids.has(x.id)) fail();
      ids.add(x.id);
    });
  });
  const tids = new Set(d.teams.map((t) => t.id));
  d.teams.forEach((t) => {
    if (
      !str(t.name) ||
      !str(t.president) ||
      !str(t.discord) ||
      typeof t.setup !== "boolean" ||
      (t.f1_2026 !== undefined && typeof t.f1_2026 !== "boolean") ||
      (t.drivers !== undefined &&
        (!Array.isArray(t.drivers) ||
          t.drivers.length > 2 ||
          t.drivers.some((driver) => !str(driver)))) ||
      (t.hq !== null && !HQS.some((h) => h.id === t.hq))
    )
      fail();
    if (
      t.setup &&
      (!Array.isArray(t.setupInvoices) ||
        t.setupInvoices.length !== 7 ||
        t.setupInvoices.some(
          (id) => !d.invoices.some((i) => i.id === id && i.team === t.id),
        ))
    )
      fail();
    if (
      t.hq &&
      !d.invoices.some(
        (i) =>
          i.id === t.hqInvoice && i.team === t.id && i.status !== "cancelled",
      )
    )
      fail();
  });
  d.invoices.forEach((i) => {
    if (
      !tids.has(i.team) ||
      !str(i.number) ||
      !str(i.note) ||
      !date(i.date) ||
      !date(i.due) ||
      !money(i.fee) ||
      i.fee < 0 ||
      !["open", "paid", "cancelled"].includes(i.status) ||
      !Array.isArray(i.lines) ||
      !i.lines.length
    )
      fail();
    i.lines.forEach((l) => {
      if (!str(l.category) || !str(l.note) || !money(l.amount) || l.amount <= 0)
        fail();
    });
  });
  d.ledger.forEach((l) => {
    if (
      !tids.has(l.team) ||
      !money(l.amount) ||
      !date(l.date) ||
      !str(l.category) ||
      !str(l.note) ||
      !str(l.ref)
    )
      fail();
  });
  const slots = new Set();
  d.contracts.forEach((c) => {
    const slot = c.team + ":" + c.sponsor;
    if (
      !tids.has(c.team) ||
      !SPONSORS.some((s) => s.id === c.sponsor) ||
      !date(c.date) ||
      slots.has(slot)
    )
      fail();
    slots.add(slot);
  });
  d.claims.forEach((c) => {
    if (
      !tids.has(c.team) ||
      !money(c.amount) ||
      c.amount < 0 ||
      !str(c.note) ||
      !str(c.ref) ||
      !date(c.due) ||
      c.pay !== plus(c.due, 7) ||
      !["pending", "received"].includes(c.status)
    )
      fail();
  });
  d.rounds.forEach((r) => {
    if (
      !str(r.name) ||
      !str(r.country) ||
      !date(r.date) ||
      !Number.isInteger(r.number) ||
      r.number < 1 ||
      !Number.isFinite(r.lat) ||
      Math.abs(r.lat) > 90 ||
      !Number.isFinite(r.lon) ||
      Math.abs(r.lon) > 180
    )
      fail();
    ["billed", "released"].forEach((k) => {
      if (
        !Array.isArray(r[k]) ||
        new Set(r[k]).size !== r[k].length ||
        r[k].some((id) => !tids.has(id))
      )
        fail();
    });
  });
  d.audit.forEach((a) => {
    if (!str(a.time) || !str(a.action)) fail();
  });
  return d;
}
