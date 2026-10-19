$("#importFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw Error("Datei größer als 20 MB.");
    const data = validate(JSON.parse(await file.text()));
    if (
      !confirm(
        "Lokale Daten durch diese Sicherung ersetzen? Vorher wird die aktuelle Sicherung heruntergeladen.",
      )
    )
      return;
    download();
    db = data;
    selected = "";
    query = "";
    commit("Sicherung importiert");
  } catch (err) {
    alert("Import abgelehnt: " + err.message);
  } finally {
    e.target.value = "";
  }
};
window.addEventListener("hashchange", () => {
  selected = "";
  query = "";
  render();
});
window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    try {
      const newer = validate(JSON.parse(e.newValue));
      db = newer;
      render();
      toast("Daten aus anderem Tab aktualisiert.");
    } catch {
      toast("Externe lokale Änderung konnte nicht geladen werden.");
    }
  }
});
render();
