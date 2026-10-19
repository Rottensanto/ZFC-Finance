export const eurosToCents = (amount) => {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Betrag muss nicht negativ und endlich sein.");
  return Math.round((value + Number.EPSILON) * 100);
};

export const invoiceTotal = (itemsCents, feeCents) =>
  itemsCents.reduce((sum, amount) => sum + BigInt(amount), 0n) + BigInt(feeCents);

export const availableBudget = ({ balanceCents, openInvoicesCents, unbilledReservationsCents = 0n }) =>
  BigInt(balanceCents) - BigInt(openInvoicesCents) - BigInt(unbilledReservationsCents);

export const travelCostCents = ({ distanceKm, sameCountry, upkeepIgnored = false }) => {
  if (sameCountry) return 3_000_000;
  if (distanceKm <= 1_500) return 5_000_000;
  if (distanceKm <= 3_500) return 9_000_000;
  if (distanceKm <= 7_000) return 14_000_000;
  return 20_000_000;
};

export const addCalendarDays = (isoDate, days) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
};

export const sponsorPayoutDate = (dueDate) => addCalendarDays(dueDate, 7);

export const standardInvoiceFeeCents = 800_000;

export const referenceSeason = Object.freeze({
  capitalCents: 2_500_000_000,
  hqPriceCents: 400_000_000,
  teamPurchaseCents: 1_200_000_000,
  teamLicenseCents: 120_000_000,
  regularDriverLicensesCents: 40_000_000,
  registrationCents: 160_000_000,
  technologyCents: 48_000_000,
  marketingCents: 80_000_000,
  raceFeesCents: 16 * 18_000_000,
  raceOperationsCents: 16 * 12_000_000,
  trackRentCents: 16 * 16_000_000,
  hqUpkeepCents: 16 * 6_000_000,
  travelCents: 16 * 9_000_000,
  miscCents: 16 * 2_500_000,
  staffBonusCents: 120_000_000,
  invoiceCount: 28,
});

export const referenceSeasonTotals = () => {
  const r = referenceSeason;
  const baseCosts = r.teamPurchaseCents + r.hqPriceCents + r.teamLicenseCents +
    r.regularDriverLicensesCents + r.registrationCents + r.technologyCents + r.marketingCents;
  const operating = r.raceFeesCents + r.raceOperationsCents + r.trackRentCents +
    r.hqUpkeepCents + r.travelCents + r.miscCents + r.staffBonusCents;
  return {
    setupCents: baseCosts + 8 * standardInvoiceFeeCents,
    operationsCents: operating + 20 * standardInvoiceFeeCents,
    feesCents: r.invoiceCount * standardInvoiceFeeCents,
    totalExpensesCents: baseCosts + operating + r.invoiceCount * standardInvoiceFeeCents,
    immediatePostSetupCents: r.capitalCents - baseCosts - 8 * standardInvoiceFeeCents,
    plannedIncomeCents: 1_224_000_000 + 400_000_000 + 200_000_000,
    expectedEndingCents: r.capitalCents + 1_824_000_000 - baseCosts - operating - r.invoiceCount * standardInvoiceFeeCents,
  };
};

export const racePrizeCents = (position, resultStatus) => {
  if (resultStatus !== "classified" || position == null) return 0;
  if (position === 1) return 70_000_000;
  if (position === 2) return 55_000_000;
  if (position === 3) return 45_000_000;
  if (position === 4) return 35_000_000;
  if (position === 5) return 30_000_000;
  if (position === 6) return 25_000_000;
  if (position === 7) return 22_000_000;
  if (position === 8) return 19_000_000;
  if (position === 9) return 16_000_000;
  if (position === 10) return 13_000_000;
  if (position <= 15) return 7_000_000;
  return 3_000_000;
};

export const seasonPrizeCents = (position) =>
  ({ 1: 500_000_000, 2: 400_000_000, 3: 320_000_000, 4: 260_000_000, 5: 200_000_000,
    6: 170_000_000, 7: 140_000_000, 8: 110_000_000, 9: 90_000_000, 10: 70_000_000 })[position] ?? 0;

export const sponsorRacePayoutCents = ({ rateCents, slot, startedDrivers, requiredStarters, oneDriverPercent }) => {
  if (startedDrivers <= 0 || requiredStarters > startedDrivers) return 0;
  if (oneDriverPercent && startedDrivers === 1) return Math.floor(rateCents * oneDriverPercent / 100);
  if (slot === "technical" && startedDrivers <= 0) return 0;
  return rateCents;
};