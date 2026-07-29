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

- `data/ticker.json` – Liveticker-Meldungen (`time`, `text`, optional `image` oder `images`: Bild-URL(s))
- `data/schedule.json` – Spielplan (`competition`, `player1`, `player2`, `round`, `time`, `court`)
- `data/results.json` – Ergebnisse (wie schedule.json, zusätzlich `score`)
- `data/reports.json` – Tagesberichte (`date`, `title`, `text`, optional `image` oder `images`: Bild-URL(s)).
  Pro Tag sind auch mehrere Berichte/Meldungen möglich (z. B. Vormittag und
  Nachmittag getrennt) – es gibt keine Beschränkung auf einen Eintrag je Datum.
- `data/menu.json` – Speiseplan (`day`, `items`: Liste von Gerichten). Jedes
  Gericht ist ein Objekt `{"name": "...", "image": "..."}` bzw. mit
  `"images": [...]` für mehrere Bilder – so ist die Zuordnung Bild↔Gericht
  eindeutig (ein Gericht kann auch ganz ohne Bild bleiben). Aus
  Kompatibilitätsgründen werden auch alte Einträge, bei denen `items` nur
  einfache Strings enthält (ohne Bild), weiterhin unterstützt.

Für Bilder bei Liveticker, Tagesberichten und je Gericht im Speiseplan gibt
es zwei Möglichkeiten:

- `"image": "..."` – genau ein Bild, volle Breite.
- `"images": [...]` – mehrere Bilder, Reihenfolge = Reihenfolge im Array.
  Jedes Bild kann als Objekt `{"src": "...", "width": 1}` bzw.
  `{"src": "...", "width": 2}` angegeben werden, um **pro Bild einzeln**
  festzulegen, ob es halbe (`1`) oder volle (`2`) Breite bekommt. Bilder mit
  halber Breite stehen nebeneinander, ein Bild mit voller Breite spannt die
  ganze Zeile – so lassen sich auch gemischte Layouts abbilden (z. B. ein
  großes Bild oben, zwei kleinere darunter). Auf sehr schmalen Screens
  erscheinen alle Bilder automatisch in voller Breite untereinander. Aus
  Kompatibilitätsgründen werden auch einfache Strings im Array (ohne
  `width`) noch unterstützt, ebenso das ältere, für die ganze Galerie
  geltende Feld `"columns"` (`1` = alle Bilder voll, `2`/fehlend = alle
  Bilder halb, sofern mehrere Bilder vorhanden sind). Bilder werden nie
  zugeschnitten, sie skalieren immer auf die volle Breite ihrer Spalte(n),
  die Höhe ergibt sich automatisch aus dem Bild.

Beide Felder sind optional. Fehlen sie, wird einfach kein Bild angezeigt –
bestehende Einträge ohne Bild funktionieren unverändert weiter.

In `admin.html` lassen sich alle Einträge (Liveticker, Tagesberichte,
Speiseplan) nicht nur löschen, sondern über "Bearbeiten" auch nachträglich
anpassen – vorhandene Bilder bleiben dabei erhalten, neue werden ergänzt.
Auch die Breite (voll/halb) und Reihenfolge der Bilder lassen sich dort
bequem per Klick einstellen (Pfeil-Buttons), ebenso bei bereits
veröffentlichten Einträgen. Beim Speiseplan gibt es dafür pro Gericht ein
eigenes Bildfeld ("+ Gericht hinzufügen"), damit klar ist, welches Bild zu
welchem Gericht gehört.

Eigene Fotos vom Turnier lassen sich einfach in `data/images/` hochladen
("Add file" → "Upload files") und dann per relativem Pfad eintragen, z. B.
`"image": "data/images/finale-2026.jpg"` bzw.
`"images": ["data/images/finale-2026-1.jpg", "data/images/finale-2026-2.jpg"]`.

Eigene Fotos vom Turnier lassen sich einfach in `data/images/` hochladen
("Add file" → "Upload files") und dann per relativem Pfad eintragen, z. B.
`"image": "data/images/finale-2026.jpg"`.

Während des Turniers reicht es, mir die Updates per Chat zu schicken – ich
aktualisiere die Dateien und du lädst die neue Version einfach erneut hoch
(oder ich übernehme das direkt, falls du mir Zugriff aufs Repo gibst).

## Automatische Aktualisierung von tennis.de

`data/schedule.json`, `data/results.json` und `data/entrants.json` (gemeldete
Spieler:innen je Konkurrenz) werden zusätzlich automatisch von der
tennis.de-Turnierseite übernommen. Ein GitHub-Actions-Workflow
(`.github/workflows/update-data.yml`) öffnet dazu alle 30 Minuten einen
unsichtbaren Browser, liest die Seite aus und committet Änderungen von
selbst.

**Wichtig, anders als ursprünglich angenommen:** Die Konkurrenzen-/
Meldeliste-Ansicht auf tennis.de ist NICHT ohne Login sichtbar – ein
ausgeloggter Besuch zeigt nur "Bitte logge dich ein ...". Der Scraper
braucht deshalb einen echten tennis.de-Account und loggt sich damit vor dem
Auslesen ein. Dafür müssen einmalig zwei Secrets im Repo hinterlegt werden:

1. Im Repo zu **Settings → Secrets and variables → Actions → New repository
   secret**.
2. Secret `TENNIS_DE_USERNAME` anlegen mit der E-Mail-Adresse/dem
   Benutzernamen des tennis.de-Accounts.
3. Secret `TENNIS_DE_PASSWORD` anlegen mit dem zugehörigen Passwort.

Diese Werte werden nur verschlüsselt bei GitHub gespeichert und ausschließlich
innerhalb des Workflows verwendet – sie tauchen in keinem Log auf. Ohne diese
beiden Secrets läuft der Workflow weiter fehlerfrei durch, findet aber keine
Daten (nur `entrants.json` wird dann leer geschrieben).

Manuell auslösen: im Repo unter "Actions" → "tennis.de Daten aktualisieren" →
"Run workflow".

Wichtig: Die Auslosung des MB-Cup erfolgt erst am 11.08.2026. Vorher liefert
der Scraper nur die Meldelisten (`entrants.json`); Paarungen und Ergebnisse
kommen automatisch dazu, sobald sie auf tennis.de erscheinen. Die genauen
Login-Feld-Selektoren in `scripts/scrape-tennis-de.js` sind nach bestem
Wissen geraten (kein direkter Zugriff auf die Login-Maske im ausgeloggten
Zustand möglich) – nach dem ersten Lauf mit gesetzten Secrets unbedingt
`data/scrape-debug.txt` und `data/scrape-debug.png` kontrollieren und bei
Bedarf anpassen.

## Einbindung in Wix

1. Im Wix-Editor eine neue Unterseite anlegen, z. B. "MB-Cup 2026".
2. Element hinzufügen → Einbetten → "Website einbetten" (iframe).
3. Als URL die GitHub-Pages-Adresse eintragen:
   `https://<dein-github-name>.github.io/mb-cup-2026/`
4. Größe des Elements auf volle Breite und ausreichende Höhe setzen
   (mobil mind. 800px, da die Seite selbst scrollt).
5. Speichern und veröffentlichen.

