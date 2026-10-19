"use strict";
// ZFC Finance Office. Buildless GitHub Pages frontend. No authentication/backend.
// All monetary amounts are whole virtual euros. Ledger entries are immutable;
// paid invoices are corrected via explicit reversal entries, never deletion.
const KEY = "zfc-finance-v1",
  $ = (s) => document.querySelector(s),
  uid = () => crypto.randomUUID();
const categories = [
  "Sponsoring",
  "Preisgeld",
  "Teilnahmegebühr",
  "Rennveranstaltung",
  "Streckenmiete",
  "Server und Technik",
  "Lizenzen",
  "Marketing",
  "Teamprämien",
  "Reisekosten",
  "Sonstiges",
  "Teamkauf",
  "HQ",
];
const HQS = [
  {
    id: "athens",
    city: "Athen",
    country: "Griechenland",
    tier: "Basis",
    price: 2000000,
    upkeep: 30000,
    lat: 37.98,
    lon: 23.73,
  },
  {
    id: "barcelona",
    city: "Barcelona",
    country: "Spanien",
    tier: "Standard",
    price: 4000000,
    upkeep: 60000,
    lat: 41.39,
    lon: 2.17,
  },
  {
    id: "cologne",
    city: "Köln",
    country: "Deutschland",
    tier: "Standard",
    price: 4000000,
    upkeep: 60000,
    lat: 50.94,
    lon: 6.96,
  },
  {
    id: "london",
    city: "London",
    country: "Großbritannien",
    tier: "Premium",
    price: 6500000,
    upkeep: 95000,
    lat: 51.51,
    lon: -0.13,
  },
  {
    id: "monaco",
    city: "Monaco",
    country: "Monaco",
    tier: "Prestige",
    price: 9000000,
    upkeep: 140000,
    lat: 43.74,
    lon: 7.42,
  },
];
const SPONSORS = [
  {
    id: "main",
    name: "Nexora Global",
    type: "Hauptsponsor",
    amount: 6000000,
    mode: "split",
    desc: "3 Mio. zum Vertragsbeginn + 3 Mio. nach Rennen 8.",
  },
  {
    id: "race",
    name: "Apex Performance",
    type: "Rennsponsor",
    amount: 220000,
    mode: "race",
    desc: "220.000 € je freigegebenem Rennen. Kürzungen manuell prüfen.",
  },
  {
    id: "tech",
    name: "Vector Systems",
    type: "Technikpartner",
    amount: 120000,
    mode: "race",
    desc: "120.000 € je freigegebenem Rennen.",
  },
  {
    id: "regional",
    name: "Horizon Partners",
    type: "Regionalpartner",
    amount: 800000,
    mode: "once",
    desc: "800.000 € nach Rennen 4.",
  },
];
const F1_TEAMS_2026 = [
  { name: "Alpine", drivers: ["Pierre Gasly", "Franco Colapinto"] },
  { name: "Aston Martin", drivers: ["Fernando Alonso", "Lance Stroll"] },
  { name: "Audi", drivers: ["Nico Hülkenberg", "Gabriel Bortoleto"] },
  { name: "Cadillac", drivers: ["Sergio Pérez", "Valtteri Bottas"] },
  { name: "Ferrari", drivers: ["Charles Leclerc", "Lewis Hamilton"] },
  { name: "Haas", drivers: ["Esteban Ocon", "Oliver Bearman"] },
  { name: "McLaren", drivers: ["Lando Norris", "Oscar Piastri"] },
  { name: "Mercedes", drivers: ["George Russell", "Kimi Antonelli"] },
  { name: "Racing Bulls", drivers: ["Liam Lawson", "Arvid Lindblad"] },
  { name: "Red Bull Racing", drivers: ["Max Verstappen", "Isack Hadjar"] },
  { name: "Williams", drivers: ["Alexander Albon", "Carlos Sainz"] },
];
const TRACKS = [
  ["Australien", "Australien", -37.85, 144.97],
  ["Bahrain", "Bahrain", 26.03, 50.51],
  ["Saudi-Arabien", "Saudi-Arabien", 21.63, 39.1],
  ["Miami", "USA", 25.96, -80.24],
  ["Imola", "Italien", 44.34, 11.72],
  ["Monaco", "Monaco", 43.74, 7.42],
  ["Spanien", "Spanien", 41.57, 2.26],
  ["Österreich", "Österreich", 47.22, 14.76],
  ["Großbritannien", "Großbritannien", 52.07, -1.02],
  ["Belgien", "Belgien", 50.44, 5.97],
  ["Niederlande", "Niederlande", 52.39, 4.54],
  ["Italien", "Italien", 45.62, 9.28],
  ["Singapur", "Singapur", 1.29, 103.86],
  ["Baku", "Aserbaidschan", 40.37, 49.85],
  ["Mexiko", "Mexiko", 19.4, -99.09],
  ["Abu Dhabi", "VAE", 24.47, 54.6],
];
const today = () =>
  new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/Bucharest",
  });
function plus(date, days) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function initial() {
  return {
    version: 1,
    settings: { season: "ZFC Saison 1", start: 25000000, fee: 8000 },
    teams: [],
    invoices: [],
    ledger: [],
    contracts: [],
    claims: [],
    audit: [],
    rounds: TRACKS.map((t, i) => ({
      id: uid(),
      name: t[0],
      country: t[1],
      lat: t[2],
      lon: t[3],
      date: plus(today(), 7 * (i + 1)),
      number: i + 1,
      billed: [],
      released: [],
    })),
  };
}
let db;
try {
  db = JSON.parse(localStorage.getItem(KEY)) || initial();
} catch {
  db = initial();
}
function ensureF12026Teams() {
  let changed = false;
  let added = 0;
  F1_TEAMS_2026.forEach(({ name, drivers }) => {
    const existing = db.teams.find(
      (t) =>
        t.name.toLocaleLowerCase("de-DE") === name.toLocaleLowerCase("de-DE"),
    );
    if (existing) {
      if (!existing.f1_2026 || !Array.isArray(existing.drivers)) {
        existing.f1_2026 = true;
        existing.drivers = drivers;
        changed = true;
      }
      return;
    }
    const id = uid();
    db.teams.push({
      id,
      name,
      president: "Teamkonto 2026",
      discord: "",
      hq: null,
      setup: false,
      f1_2026: true,
      drivers,
    });
    entry(id, db.settings.start, "Startkapital", "F1-Saison 2026");
    added += 1;
    changed = true;
  });
  if (added) audit(added + " F1-Teamkonten für 2026 angelegt");
  if (changed) save();
}
ensureF12026Teams();
let selected = "",
  query = "";
const eur = (n) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
const team = (id) => db.teams.find((t) => t.id === id),
  hq = (t) => HQS.find((h) => h.id === t.hq),
  balance = (id) =>
    db.ledger.filter((l) => l.team === id).reduce((a, l) => a + l.amount, 0);
const total = (i) => i.lines.reduce((a, l) => a + l.amount, 0) + i.fee;
const open = (id) =>
  db.invoices
    .filter((i) => i.team === id && i.status === "open")
    .reduce((a, i) => a + total(i), 0);
const available = (id) => balance(id) - open(id);
const receivable = (id) =>
  db.claims
    .filter((c) => c.team === id && c.status === "pending")
    .reduce((a, c) => a + c.amount, 0);
function audit(action) {
  db.audit.unshift({ id: uid(), time: new Date().toISOString(), action });
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(db));
}
function commit(action) {
  audit(action);
  try {
    save();
  } catch (e) {
    alert("Speichern fehlgeschlagen. Bitte sofort JSON exportieren.");
  }
  render();
  toast(action);
}
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").hidden = false;
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function entry(t, amount, category, note, ref = "") {
  db.ledger.push({
    id: uid(),
    team: t,
    amount,
    category,
    note,
    ref,
    date: today(),
  });
}
function invoice(t, lines, note, due = plus(today(), 3)) {
  const i = {
    id: uid(),
    number: "ZFC-" + String(db.invoices.length + 1).padStart(5, "0"),
    team: t,
    lines,
    fee: db.settings.fee,
    note,
    date: today(),
    due,
    status: "open",
  };
  db.invoices.push(i);
  return i;
}
function claim(t, amount, note, due, ref) {
  db.claims.push({
    id: uid(),
    team: t,
    amount,
    note,
    due,
    pay: plus(due, 7),
    status: "pending",
    ref,
  });
}
function travel(t, r) {
  const h = hq(t);
  if (!h) return null;
  if (h.country === r.country) return 30000;
  const rad = (n) => (n * Math.PI) / 180;
  const a =
    Math.sin(rad(r.lat - h.lat) / 2) ** 2 +
    Math.cos(rad(h.lat)) *
      Math.cos(rad(r.lat)) *
      Math.sin(rad(r.lon - h.lon) / 2) ** 2;
  const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return km <= 1500 ? 50000 : km <= 3500 ? 90000 : km <= 7000 ? 140000 : 200000;
}
function optionsTeams() {
  return db.teams
    .map((t) => `<option value="${t.id}">${esc(t.name)}</option>`)
    .join("");
}
const views = [
  ["home", "Übersicht"],
  ["teams", "Teams & Konten"],
  ["invoices", "Rechnungen"],
  ["ledger", "Buchungen"],
  ["market", "HQ & Sponsoren"],
  ["calendar", "Rennkalender"],
  ["claims", "Auszahlungen"],
  ["settings", "Einstellungen"],
];
function top(title, sub, actions = "") {
  return `<div class="row between lead"><div><div class="eyebrow">${esc(db.settings.season)} / Finance Office</div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="row">${actions}</div></div>`;
}
function table(headers, rows) {
  return `<div class="tablewrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="empty">Noch keine Einträge vorhanden.</td></tr>`}</tbody></table></div>`;
}
function stat(label, value, sub = "") {
  return `<div class="card stat"><small>${label}</small><strong class="money">${value}</strong><small>${sub}</small></div>`;
}
function filterbar() {
  return `<div class="toolbar"><select id="teamFilter" style="max-width:260px"><option value="">Alle Teams</option>${optionsTeams()}</select><input id="search" placeholder="Suchen …" aria-label="Einträge durchsuchen"></div>`;
}
function matches(id, text) {
  return (
    (!selected || id === selected) &&
    String(text).toLowerCase().includes(query.toLowerCase())
  );
}
