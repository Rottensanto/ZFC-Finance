# ZFC Finance Office

## Projektstruktur

- `index.html`: Seitenstruktur und Einbindung der lokalen Assets.
- `styles.css`: Layout, Komponenten und responsive Darstellung.
- `js/data.js`: Saisonstammdaten, F1-2026-Teamkonten, Speicher und gemeinsame Finanzhelfer.
- `js/views.js`: Navigation, Dashboard, Teamliste und einzelne Finanzkonten.
- `js/finance.js`: Teams, Rechnungen, Buchungen und Saisoneinstellungen.
- `js/league.js`: HQs, Sponsoren, Rennkalender und Auszahlungen.
- `js/backup.js`: JSON-Import/-Export, CSV-Export und Sicherungsprüfung.
- `js/app.js`: Browserereignisse, Synchronisierung zwischen Tabs und App-Start.

## Lokal testen

Im Projektverzeichnis einen statischen HTTP-Server starten, zum Beispiel:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Anschließend `http://localhost:8000` öffnen. Daten werden im lokalen Browser gespeichert; für gemeinsame Konten über mehrere Geräte ist weiterhin ein Backend nötig.
