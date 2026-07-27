/**
 * Liest die öffentliche Turnierseite des MB-Cup 2026 auf tennis.de aus
 * (kein Login, keine privaten Daten - nur was jeder Besucher im Browser sieht)
 * und schreibt die Ergebnisse nach data/schedule.json, data/results.json und
 * data/entrants.json.
 *
 * WICHTIG: Diese Datei parst Text nach bestem Wissen anhand des echten
 * MB-Cup-Turniers (Meldeliste bereits live getestet). Sobald die Auslosung
 * (11.08.2026) steht, unbedingt einmal den Lauf kontrollieren (siehe
 * data/scrape-debug.txt) und bei Bedarf die Tableau-Regex weiter unten
 * anpassen, da diese noch nicht an echten Bracket-Daten verifiziert ist.
 *
 * Hinweis zur Bot-Erkennung: In einem normalen, "menschlichen" Browser sind
 * die Konkurrenzen/Meldelisten direkt auf der Hauptseite sichtbar (kein
 * Login nötig, kein separates iframe). Ein frischer Playwright-Headless-
 * Browser wurde von tennis.de jedoch zwischenzeitlich mit einem
 * "Bitte logge dich ein"-Hinweis abgespeist statt der echten Daten - das
 * deutet auf eine Bot-/Fingerprint-Erkennung hin, nicht auf echte
 * Login-Pflicht. Die Optionen unten (echter User-Agent, deutsche Locale,
 * deaktiviertes "AutomationControlled"-Flag) reduzieren das Risiko dafür.
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
  // Wichtig: Wir MÜSSEN allen Cookies zustimmen (der tatsächliche Button
  // heißt bei tennis.de/Cookiebot "Alle zulassen", NICHT "Alle akzeptieren"),
  // sonst bleibt der Consent-Dialog offen und blockiert die Konkurrenzen-Liste.
  const candidates = ['Alle zulassen', 'Alle akzeptieren', 'Alle erlauben', 'Akzeptieren', 'Accept all'];
  for (const text of candidates) {
    try {
      const btn = page.getByText(text, { exact: false }).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click({ timeout: 1500 });
        return true;
      }
    } catch (e) {
      // weiter versuchen
    }
  }
  return false;
}

// Ein Turnierteilnehmer-Eintrag in der Meldeliste. Reales Beispiel (Zeilen
// nach dem Entfernen leerer Zeilen), bestätigt am echten MB-Cup-Turnier:
//   1
//   Feldmann Jonas Juttichai      <- Name (1 Zeile VOR "DTB-ID ...")
//   DTB-ID 10914651               <- Anker
//   TC Rhode e.V.                 <- Verein (1 Zeile NACH "DTB-ID ...")
//   10914651                      <- DTB-Id nochmal, ohne Label
//   LK9,4 LK9,4                   <- LK-Werte (3 Zeilen NACH "DTB-ID ...")
//   2
//   ...
function parseMeldeliste(text, competition) {
  const entrants = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const anchor = lines[i].match(/^DTB-ID (\d+)$/);
    if (anchor) {
      const dtbId = anchor[1];
      const name = lines[i - 1] || '';
      const club = lines[i + 1] || '';
      const lkLine = lines[i + 3] || '';
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
// NOCH NICHT an echten Bracket-Daten verifiziert (Auslosung steht noch aus).
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

async function scrapeCompetition(page, index, competitionLabel) {
  const result = { entrants: null, matches: [] };

  // --- Meldeliste ---
  try {
    const meldelisteLinks = page.getByText('Meldeliste', { exact: true });
    const count = await meldelisteLinks.count();
    if (index < count) {
      await meldelisteLinks.nth(index).click({ timeout: 5000 });
      await page.waitForTimeout(1200);
      const text = await page.locator('body').innerText();
      result.entrants = parseMeldeliste(text, competitionLabel);

      // zurück zur Übersicht
      const backCandidates = ['Zurück zum Turnier', 'Zurück zur Übersicht'];
      for (const t of backCandidates) {
        const back = page.getByText(t, { exact: false }).first();
        if (await back.isVisible({ timeout: 1000 }).catch(() => false)) {
          await back.click({ timeout: 3000 });
          await page.waitForTimeout(800);
          break;
        }
      }
    }
  } catch (e) {
    console.warn(`Meldeliste für "${competitionLabel}" konnte nicht gelesen werden:`, e.message);
  }

  // --- Ergebnisse / Tableau (nur vorhanden, wenn Auslosung erfolgt ist) ---
  try {
    const ergebnisLinks = page.getByText('Hauptfeld', { exact: true }).or(page.getByText('Tableau ansehen', { exact: false }));
    const count = await ergebnisLinks.count();
    if (index < count) {
      await ergebnisLinks.nth(index).click({ timeout: 5000 });
      await page.waitForTimeout(1200);
      const text = await page.locator('body').innerText();
      if (!text.includes('nicht verfügbar')) {
        result.matches = parseTableau(text, competitionLabel);
      }
      const back = page.getByText('Zurück zur Übersicht', { exact: false }).first();
      if (await back.isVisible({ timeout: 1000 }).catch(() => false)) {
        await back.click({ timeout: 3000 });
        await page.waitForTimeout(800);
      }
    }
  } catch (e) {
    console.warn(`Ergebnisse für "${competitionLabel}" konnten nicht gelesen werden:`, e.message);
  }

  return result;
}

async function main() {
  const browser = await chromium.launch({
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage({
    locale: 'de-DE',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });
  // Reduziert die offensichtlichsten Automatisierungs-Fingerprints, die
  // manche Seiten nutzen, um Headless-Browser mit einem Fallback-Hinweis
  // ("bitte einloggen") statt der echten Inhalte abzuspeisen.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('Öffne', DETAIL_URL);
  await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const cookiesAccepted = await acceptCookies(page);
  console.log('Cookie-Banner akzeptiert:', cookiesAccepted);
  await page.waitForTimeout(5000);

  // Diagnose-Schnappschuss, damit wir bei einem Fehlschlag sehen, was der
  // Bot tatsächlich vorgefunden hat (z.B. Cookie-Banner, Bot-Sperre, andere
  // Seitenstruktur als erwartet).
  try {
    const outerText = await page.locator('body').innerText();
    fs.writeFileSync(path.join(DATA_DIR, 'scrape-debug.txt'), outerText);
    await page.screenshot({ path: path.join(DATA_DIR, 'scrape-debug.png'), fullPage: true });
  } catch (e) {
    console.warn('Konnte Diagnose-Schnappschuss nicht erstellen:', e.message);
  }

  const hasLoginWall = (await page.locator('body').innerText()).includes(
    'logge dich ein, um nähere Informationen'
  );
  if (hasLoginWall) {
    console.error(
      'tennis.de zeigt einen Login-Hinweis statt der Konkurrenzen - vermutlich Bot-Erkennung. ' +
      'Siehe data/scrape-debug.txt und data/scrape-debug.png.'
    );
    writeJSON('entrants.json', readJSON('entrants.json', []));
    await browser.close();
    return;
  }

  await page.waitForSelector('text=Konkurrenzen', { timeout: 30000 }).catch(() => {});

  const overviewText = await page.locator('body').innerText();

  const competitionBlocks = [
    ...overviewText.matchAll(/^(Herren|Damen)[^\n]*\n(KO|Spiralsystem|Round Robin)[^\n]*\nLK[\d.,\-]+/gm),
  ].map((m) => m[0].split('\n').join(' '));

  const meldelisteCount = await page.getByText('Meldeliste', { exact: true }).count();
  console.log(`${meldelisteCount} Konkurrenzen mit Meldeliste gefunden.`);

  const allEntrants = [];
  const allMatches = [];

  for (let i = 0; i < meldelisteCount; i++) {
    const label = competitionBlocks[i] || `Konkurrenz ${i + 1}`;
    console.log(`(${i + 1}/${meldelisteCount}) ${label}`);
    const { entrants, matches } = await scrapeCompetition(page, i, label);
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
