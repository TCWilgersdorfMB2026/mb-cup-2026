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

## Einbindung in Wix

1. Im Wix-Editor eine neue Unterseite anlegen, z. B. "MB-Cup 2026".
2. Element hinzufügen → Einbetten → "Website einbetten" (iframe).
3. Als URL die GitHub-Pages-Adresse eintragen:
   `https://<dein-github-name>.github.io/mb-cup-2026/`
4. Größe des Elements auf volle Breite und ausreichende Höhe setzen
   (mobil mind. 800px, da die Seite selbst scrollt).
5. Speichern und veröffentlichen.

