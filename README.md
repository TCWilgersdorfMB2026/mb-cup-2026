# MB-Cup 2026 – Turnierseite (TC Wilgersdorf)

Statische Seite für den markenbaumarkt24-Cup 2026. Läuft komplett ohne Server –
Liveticker, Spielplan, Ergebnisse, Tagesberichte und Speiseplan werden aus den
Dateien in `data/*.json` gelesen und alle 60 Sekunden neu geladen.

## Veröffentlichung mit GitHub Pages (kostenlos, ca. 5 Minuten)

1. Auf github.com kostenlosen Account anlegen (falls noch nicht vorhanden).
2. Neues Repository anlegen, z. B. `mb-cup-2026` (öffentlich).
3. Alle Dateien aus diesem Ordner per Drag & Drop hochladen
   ("Add file" → "Upload files").
4. Unter Settings → Pages: Branch `main`, Ordner `/root` auswählen, speichern.
5. Nach ca. 1 Minute ist die Seite erreichbar unter:
   `https://<dein-github-name>.github.io/mb-cup-2026/`

Diese URL wird anschließend per iframe in Wix eingebunden.

## Inhalte aktualisieren

Nur die JSON-Dateien in `data/` müssen ersetzt werden, das HTML bleibt
unverändert:

- `data/ticker.json` – Liveticker-Meldungen (`time`, `text`)
- `data/schedule.json` – Spielplan (`competition`, `player1`, `player2`, `round`, `time`, `court`)
- `data/results.json` – Ergebnisse (wie schedule.json, zusätzlich `score`)
- `data/reports.json` – Tagesberichte (`date`, `title`, `text`)
- `data/menu.json` – Speiseplan (`day`, `items`: Liste von Strings)

Während des Turniers reicht es, mir die Updates per Chat zu schicken – ich
aktualisiere die Dateien und du lädst die neue Version einfach erneut hoch
(oder ich übernehme das direkt, falls du mir Zugriff aufs Repo gibst).

## Automatische Aktualisierung von tennis.de

`data/schedule.json`, `data/results.json` und `data/entrants.json` (gemeldete
Spieler:innen je Konkurrenz) werden zusätzlich automatisch von der
öffentlichen tennis.de-Turnierseite übernommen. Ein GitHub-Actions-Workflow
(`.github/workflows/update-data.yml`) öffnet dazu alle 30 Minuten einen
unsichtbaren Browser, liest die sichtbare Seite aus und committet Änderungen
von selbst – dafür ist keine Anmeldung bei tennis.de nötig, es werden nur
öffentliche Daten gelesen.

Manuell auslösen: im Repo unter "Actions" → "tennis.de Daten aktualisieren" →
"Run workflow".

Wichtig: Die Auslosung des MB-Cup erfolgt erst am 11.08.2026. Vorher liefert
der Scraper nur die Meldelisten (`entrants.json`); Paarungen und Ergebnisse
kommen automatisch dazu, sobald sie auf tennis.de erscheinen. Da tennis.de
seine Turnierdaten in einem eingebetteten Widget mit unveröffentlichter
Struktur anzeigt, ist der Auswertungs-Code in `scripts/scrape-tennis-de.js`
nach bestem Wissen gebaut – nach der Auslosung lohnt sich ein kurzer Check
(Datei `data/scrape-debug.txt` zeigt den rohen ausgelesenen Text zur
Fehlersuche).

## Einbindung in Wix

1. Im Wix-Editor eine neue Unterseite anlegen, z. B. "MB-Cup 2026".
2. Element hinzufügen → Einbetten → "Website einbetten" (iframe).
3. Als URL die GitHub-Pages-Adresse eintragen:
   `https://<dein-github-name>.github.io/mb-cup-2026/`
4. Größe des Elements auf volle Breite und ausreichende Höhe setzen
   (mobil mind. 800px, da die Seite selbst scrollt).
5. Speichern und veröffentlichen.

