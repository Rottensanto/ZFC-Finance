export const money = (cents = 0) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(Number(cents) / 100);

export const date = (value) =>
  value
    ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "Europe/Bucharest" }).format(
        new Date(`${value.slice(0, 10)}T12:00:00+02:00`),
      )
    : "–";

export const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });

export const csvCell = (value = "") => {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};

export const errorMessage = (error) => {
  const message = error?.message || "Unbekannter Fehler";
  if (/Zugriff verweigert|Berechtigung|permission denied/i.test(message)) {
    return "Für diese Aktion fehlen dir die erforderlichen Rechte.";
  }
  if (/Kontostand|Budget reicht/i.test(message)) {
    return "Das verfügbare Budget reicht für diese Buchung nicht aus.";
  }
  return message;
};