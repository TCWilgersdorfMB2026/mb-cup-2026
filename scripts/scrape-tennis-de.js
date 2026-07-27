/**
 * Liest die öffentliche Turnierseite des MB-Cup 2026 auf tennis.de aus
 * (kein Login, keine privaten Daten - nur was jeder Besucher im Browser sieht)
 * und schreibt die Ergebnisse nach data/schedule.json, data/results.json und
 * data/entrants.json.
 *
 * Warum so kompliziert? tennis.de rendert die Turnierdaten in einem
 * eingebetteten Widget (widgets.tennis.de), das aus Sicherheitsgründen vom
 * Browser isoliert ist. Ein normaler HTTP-Request bekommt daher nur eine
 * leere Hülle. Mit einem echten (headless) Browser über Playwright sieht man
 * dagegen genau das, was auch ein Mensch sehen würde.
 *
 * WICHTIG: Diese Datei parst Text nach bestem Wissen anhand eines echten
 * Beispiel-Turniers. Sobald die Auslosung des MB-Cup (11.08.2026) steht,
 * unbedingt einmal den Lauf kontrollieren (siehe data/scrape-debug.txt) und
 * bei Bedarf die Regex-Muster weiter unten anpassen.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const TOURNAMENT_ID = '796221'; // 17. Wilgersdorfer LK-Turnier um den markenbaumarkt24-Cup
const DETAIL_URL = `https://www.tennis.de/spielen/spielbetrieb/turniersuche.html#detail/${TOURNAMENT_ID}`;
const DATA_DIR = path.join(__dirname, '..', 'data');

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2) + '\n');
}

async function acceptCookies(page) {
  const candidates = ['Ablehnen', 'Alle ablehnen', 'Nur essenzielle akzeptieren', 'Alle akzeptieren'];
  for (const text of candidates) {
    try {
      const btn = page.getByText(text, { exact: false }).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click({ timeout: 1500 });
        return;
      }
    } catch (e) {
      // weiter versuchen
    }
  }
}

async function getWidgetFrame(page) {
  for (let i = 0; i < 40; i++) {
    const frame = page.frames().find((f) => f.url().includes('widgets.tennis.de'));
    if (frame) return frame;
    await page.waitForTimeout(750);
  }
  const frameUrls = page.frames().map((f) => f.url());
  throw new Error(
    'Widget-Frame (widgets.tennis.de) nicht gefunden - hat sich tennis.de geändert? ' +
    'Gefundene Frames: ' + JSON.stringify(frameUrls)
  );
}

// Ein Turnierteilnehmer-Eintrag in der Meldeliste, z.B.:
// "1\nMüller Max\nDTB-ID 12345678\nTC Musterstadt\n12345678\nLK9,4 LK9,4"
function parseMeldeliste(text, competition) {
  const entrants = [];
  const re = /DTB-ID (\d+)\s*\n([^\n]+?)\s*\n\1\s*\nLK([\d.,]+)\s+LK([\d.,]+)/g;
  // Name und Verein stehen VOR "DTB-ID", daher brauchen wir einen Blick zurück im Text
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/^DTB-ID \d+$/.test(lines[i])) {
      const dtbId = lines[i].replace('DTB-ID ', '');
      const name = lines[i - 2] || '';
      const club = lines[i - 1] || '';
      const lkLine = lines[i + 2] || '';
      const lkMatch = lkLine.match(/LK([\d.,]+)\s+LK([\d.,]+)/);
      entrants.push({
        name,
        club,
        dtbId,
        lk: lkMatch ? lkMatch[1] : null,
      });
    }
  }
  return { competition, entrants };
}

// Best-effort-Parser für die Tableau-Ansicht (Bracket). Sucht nach
// Spieler-Zeilen im Format "LK9,4 - Nachname, Vorname, 1990 - Verein, WTV"
// und einer davorstehenden Zeile mit Satzergebnissen ("6:2 6:4").
function parseTableau(text, competition) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const playerLineRe = /LK[\d.,]+\s*-\s*([^,]+,\s*[^,]+),\s*\d{4}\s*-\s*([^,]+),\s*\w+/;
  const scoreRe = /^(\d+:\d+|Aufg\.|w\.o\.)(\s+(\d+:\d+|Aufg\.|w\.o\.))*$/;

  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    const m1 = lines[i].match(playerLineRe);
    if (!m1) continue;
    // Manche Zeilen enthalten zwei Spieler nebeneinander (zwei Tableau-Spalten
    // wurden beim Textauslesen zusammengefasst). Wir extrahieren alle Treffer.
    const allPlayers = [...lines[i].matchAll(new RegExp(playerLineRe, 'g'))];
    if (allPlayers.length < 2) continue;

    const player1 = allPlayers[0][1].trim();
    const player2 = allPlayers[1][1].trim();

    // Score-Zeile steht typischerweise in der Zeile direkt davor
    let score = null;
    if (i > 0 && scoreRe.test(lines[i - 1])) {
      score = lines[i - 1];
    }

    matches.push({
      competition,
      player1,
      player2,
      score,
      round: '',
      time: '',
      court: '',
    });
  }
  return matches;
}

async function scrapeCompetition(frame, index, competitionLabel) {
  const result = { entrants: null, matches: [] };

  // --- Meldeliste ---
  try {
    const meldelisteLinks = frame.getByText('Meldeliste', { exact: true });
    const count = await meldelisteLinks.count();
    if (index < count) {
      await meldelisteLinks.nth(index).click({ timeout: 5000 });
      await frame.waitForTimeout(1200);
      const text = await frame.locator('body').innerText();
      result.entrants = parseMeldeliste(text, competitionLabel);

      // zurück zur Übersicht
      const backCandidates = ['Zurück zum Turnier', 'Zurück zur Übersicht'];
      for (const t of backCandidates) {
        const back = frame.getByText(t, { exact: false }).first();
        if (await back.isVisible({ timeout: 1000 }).catch(() => false)) {
          await back.click({ timeout: 3000 });
          await frame.waitForTimeout(800);
          break;
        }
      }
    }
  } catch (e) {
    console.warn(`Meldeliste für "${competitionLabel}" konnte nicht gelesen werden:`, e.message);
  }

  // --- Ergebnisse / Tableau (nur vorhanden, wenn Auslosung erfolgt ist) ---
  try {
    const ergebnisLinks = frame.getByText('Hauptfeld', { exact: true }).or(frame.getByText('Tableau ansehen', { exact: false }));
    const count = await ergebnisLinks.count();
    if (index < count) {
      await ergebnisLinks.nth(index).click({ timeout: 5000 });
      await frame.waitForTimeout(1200);
      const text = await frame.locator('body').innerText();
      if (!text.includes('nicht verfügbar')) {
        result.matches = parseTableau(text, competitionLabel);
      }
      const back = frame.getByText('Zurück zur Übersicht', { exact: false }).first();
      if (await back.isVisible({ timeout: 1000 }).catch(() => false)) {
        await back.click({ timeout: 3000 });
        await frame.waitForTimeout(800);
      }
    }
  } catch (e) {
    console.warn(`Ergebnisse für "${competitionLabel}" konnten nicht gelesen werden:`, e.message);
  }

  return result;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    locale: 'de-DE',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });

  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('Öffne', DETAIL_URL);
  await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await acceptCookies(page);
  await page.waitForTimeout(3000);

  // Diagnose-Schnappschuss der äußeren Seite, damit wir bei einem Fehlschlag
  // sehen, was der Bot tatsächlich vorgefunden hat (z.B. Cookie-Banner,
  // Bot-Sperre, andere Seitenstruktur).
  try {
    const outerText = await page.locator('body').innerText();
    fs.writeFileSync(path.join(DATA_DIR, 'scrape-debug-outer.txt'), outerText);
    await page.screenshot({ path: path.join(DATA_DIR, 'scrape-debug.png'), fullPage: true });
  } catch (e) {
    console.warn('Konnte Diagnose-Schnappschuss nicht erstellen:', e.message);
  }

  let frame;
  try {
    frame = await getWidgetFrame(page);
  } catch (e) {
    console.error(e.message);
    writeJSON('entrants.json', readJSON('entrants.json', []));
    console.log('Kein Widget-Frame gefunden - siehe data/scrape-debug-outer.txt und data/scrape-debug.png.');
    await browser.close();
    return;
  }
  await frame.waitForSelector('text=Konkurrenzen', { timeout: 30000 }).catch(() => {});

  // Konkurrenzen-Übersicht als Text holen, um Namen/LK-Klassen den
  // Meldeliste-Buttons zuzuordnen (gleiche Reihenfolge wie im DOM).
  const overviewText = await frame.locator('body').innerText();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'scrape-debug.txt'), overviewText);

  const competitionBlocks = [
    ...overviewText.matchAll(/^(Herren|Damen)[^\n]*\n(KO|Spiralsystem|Round Robin)[^\n]*\nLK[\d.,\-]+/gm),
  ].map((m) => m[0].split('\n').join(' '));

  const meldelisteCount = await frame.getByText('Meldeliste', { exact: true }).count();
  console.log(`${meldelisteCount} Konkurrenzen mit Meldeliste gefunden.`);

  const allEntrants = [];
  const allMatches = [];

  for (let i = 0; i < meldelisteCount; i++) {
    const label = competitionBlocks[i] || `Konkurrenz ${i + 1}`;
    console.log(`(${i + 1}/${meldelisteCount}) ${label}`);
    const { entrants, matches } = await scrapeCompetition(frame, i, label);
    if (entrants) allEntrants.push(entrants);
    if (matches && matches.length) allMatches.push(...matches);
  }

  writeJSON('entrants.json', allEntrants);

  // Ergebnisse (mit Score) und Spielplan (ohne Score) trennen
  const results = allMatches.filter((m) => m.score && /\d:\d/.test(m.score));
  const schedule = allMatches.filter((m) => !m.score);

  if (results.length) writeJSON('results.json', results);
  if (schedule.length) writeJSON('schedule.json', schedule);

  console.log(`Fertig: ${allEntrants.length} Meldelisten, ${results.length} Ergebnisse, ${schedule.length} offene Paarungen.`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
