import test from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarDays,
  availableBudget,
  eurosToCents,
  invoiceTotal,
  racePrizeCents,
  referenceSeasonTotals,
  seasonPrizeCents,
  sponsorPayoutDate,
  sponsorRacePayoutCents,
  travelCostCents,
} from "../src/lib/domain.js";
import { csvCell } from "../src/lib/format.js";

test("Geld wird als ganzzahlige Cent gespeichert", () => {
  assert.equal(eurosToCents("8000.00"), 800000);
  assert.equal(eurosToCents("0.01"), 1);
  assert.throws(() => eurosToCents(-0.01), RangeError);
  assert.equal(invoiceTotal([120000, 80000], 800000), 1000000n);
});

test("Referenzsaison entspricht den vorgegebenen Summen", () => {
  assert.deepEqual(referenceSeasonTotals(), {
    setupCents: 2054400000,
    operationsCents: 1152000000,
    feesCents: 22400000,
    totalExpensesCents: 3206400000,
    immediatePostSetupCents: 445600000,
    plannedIncomeCents: 1824000000,
    expectedEndingCents: 1117600000,
  });
});

test("Budget berücksichtigt Rechnungen und nur nicht fakturierte Reserven", () => {
  assert.equal(availableBudget({ balanceCents: 2500000000n, openInvoicesCents: 500000000n, unbilledReservationsCents: 100000000n }), 1900000000n);
  assert.equal(availableBudget({ balanceCents: 2500000000n, openInvoicesCents: 500000000n }), 2000000000n);
});

test("Reisekosten respektieren Landesregel und inklusive Distanzgrenzen", () => {
  assert.equal(travelCostCents({ sameCountry: true, distanceKm: 10000 }), 3000000);
  assert.equal(travelCostCents({ sameCountry: false, distanceKm: 1500 }), 5000000);
  assert.equal(travelCostCents({ sameCountry: false, distanceKm: 1500.01 }), 9000000);
  assert.equal(travelCostCents({ sameCountry: false, distanceKm: 3500 }), 9000000);
  assert.equal(travelCostCents({ sameCountry: false, distanceKm: 3500.01 }), 14000000);
  assert.equal(travelCostCents({ sameCountry: false, distanceKm: 7000 }), 14000000);
  assert.equal(travelCostCents({ sameCountry: false, distanceKm: 7000.01 }), 20000000);
});

test("Sponsorfrist zählt sieben Kalendertage über Monat, Jahr und DST-Wechsel", () => {
  assert.equal(sponsorPayoutDate("2026-01-28"), "2026-02-04");
  assert.equal(sponsorPayoutDate("2026-03-27"), "2026-04-03");
  assert.equal(sponsorPayoutDate("2026-10-23"), "2026-10-30");
  assert.equal(addCalendarDays("2026-12-28", 7), "2027-01-04");
});

test("Preisgeld gibt nur klassifizierten Ergebnissen einen Betrag", () => {
  assert.equal(racePrizeCents(1, "classified"), 70000000);
  assert.equal(racePrizeCents(15, "classified"), 7000000);
  assert.equal(racePrizeCents(16, "classified"), 3000000);
  assert.equal(racePrizeCents(1, "dnf"), 0);
  assert.equal(racePrizeCents(2, "disqualified"), 0);
});

test("Saisonprämien und Sponsorstarterbedingungen sind deterministisch", () => {
  assert.equal(seasonPrizeCents(1), 500000000);
  assert.equal(seasonPrizeCents(5), 200000000);
  assert.equal(seasonPrizeCents(11), 0);
  assert.equal(sponsorRacePayoutCents({ rateCents: 22000000, slot: "race", startedDrivers: 1, oneDriverPercent: 50 }), 11000000);
  assert.equal(sponsorRacePayoutCents({ rateCents: 30000000, slot: "race", startedDrivers: 1, requiredStarters: 2 }), 0);
  assert.equal(sponsorRacePayoutCents({ rateCents: 12000000, slot: "technical", startedDrivers: 0 }), 0);
});

test("CSV-Zellen schützen Tabellenkalkulationen vor Formelinjektion", () => {
  assert.equal(csvCell("=1+1"), `"'=1+1"`);
  assert.equal(csvCell("ZFC; Finance"), '"ZFC; Finance"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});