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
 * Hinweis zum Login: Die Konkurrenzen-/Meldeliste-Ansicht dieser
 * Turnierseite ist auf tennis.de tatsächlich NUR für eingeloggte Accounts
 * sichtbar (bestätigt) - ein ausgeloggter Aufruf zeigt einen
 * "Information"-Dialog ("Bitte logge dich ein, um nähere Informationen zum
 * Turnier sehen zu können.") mit eigenem Login-Button. loginIfNeeded() loggt
 * sich deshalb mit den Secrets TENNIS_DE_USERNAME/TENNIS_DE_PASSWORD ein,
 * bevor die Konkurrenzen ausgelesen werden.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// TEST_TOURNAMENT_ID erlaubt es, den Scraper testweise gegen ein ANDERES
// (bereits abgeschlossenes) Turnier laufen zu lassen, z.B. um die
// Tableau-/Ergebnis-Parser-Logik an echten Bracket-Daten zu prüfen, ohne die
// echten MB-Cup-2026-Datendateien zu überschreiben. Ist die Variable gesetzt,
// werden alle Ausgabedateien mit "test-" vorangestellt geschrieben
// (test-entrants.json usw.) statt der echten entrants.json/schedule.json/
// results.json. Der reguläre 30-Minuten-Cron setzt diese Variable nie.
const TOURNAMENT_ID = process.env.TEST_TOURNAMENT_ID || '796221'; // Standard: 17. Wilgersdorfer LK-Turnier um den markenbaumarkt24-Cup
const FILE_PREFIX = process.env.TEST_TOURNAMENT_ID ? 'test-' : '';
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
  // WICHTIG: Cookiebot rendert seinen Consent-Dialog in einem eigenen,
  // cross-origin iframe (consentcdn.cookiebot.com) - NICHT direkt im
  // Haupt-DOM. page.getByText(...) auf der Hauptseite findet den Button
  // "Alle zulassen" deshalb nie, der Klick geht ins Leere, und der Banner
  // bleibt offen und blockiert die Konkurrenzen-Liste dahinter.
  const candidates = ['Alle zulassen', 'Alle akzeptieren', 'Alle erlauben', 'Akzeptieren', 'Accept all'];

  for (let i = 0; i < 10; i++) {
    const cookieFrame = page.frames().find((f) => f.url().includes('cookiebot.com'));
    if (cookieFrame) {
      for (const text of candidates) {
        try {
          const btn = cookieFrame.getByText(text, { exact: false }).first();
          if (await btn.isVisible({ timeout: 1000 })) {
            await btn.click({ timeout: 1000 });
            return true;
          }
        } catch (e) {
          // weiter versuchen
        }
      }
    }
    await page.waitForTimeout(500);
  }

  // Fallback, falls der Banner doch mal direkt im Haupt-DOM landet.
  for (const text of candidates) {
    try {
      const btn = page.getByText(text, { exact: false }).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click({ timeout: 1000 });
        return true;
      }
    } catch (e) {
      // weiter versuchen
    }
  }
  return false;
}

// Loggt sich bei tennis.de ein, falls TENNIS_DE_USERNAME/TENNIS_DE_PASSWORD
// als Umgebungsvariablen (GitHub-Secrets) gesetzt sind. Die Konkurrenzen-
///Meldeliste-Daten sind nur für eingeloggte Accounts sichtbar - ohne Login
// zeigt tennis.de stattdessen "Bitte logge dich ein ...".
// HINWEIS: Die genauen Feld-/Button-Selektoren sind nach bestem Wissen
// geraten (kein Zugriff auf die Login-Maske im ausgeloggten Zustand möglich,
// ohne die echte Vereinssitzung zu gefährden). Bei Bedarf anhand von
// data/scrape-debug.png nach einem Fehlschlag anpassen.
async function loginIfNeeded(page) {
  const username = process.env.TENNIS_DE_USERNAME;
  const password = process.env.TENNIS_DE_PASSWORD;
  if (!username || !password) {
    console.log('TENNIS_DE_USERNAME/TENNIS_DE_PASSWORD nicht gesetzt - überspringe Login.');
    return false;
  }

  try {
    // tennis.de zeigt beim ausgeloggten Aufruf dieser Turnierseite einen
    // "Information"-Dialog ("Bitte logge dich ein, um nähere Informationen
    // zum Turnier sehen zu können.") mit einem EIGENEN Login-Button. Dieser
    // Dialog liegt als Overlay über dem Header und fängt Klicks auf den
    // Header-Login-Link ab (Playwright-Fehler: "... subtree intercepts
    // pointer events"). Deshalb zuerst gezielt den Button IM Dialog suchen,
    // erst danach (Fallback) den Header-Link.
    const dialogLoginBtn = page.locator('[role="dialog"]').getByText('Login', { exact: true }).first();
    const headerLoginBtn = page.getByText('Login', { exact: true }).first();

    let loginTrigger = null;
    if (await dialogLoginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      loginTrigger = dialogLoginBtn;
    } else if (await headerLoginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      loginTrigger = headerLoginBtn;
    } else {
      console.log('Kein "Login"-Button sichtbar - evtl. bereits eingeloggt oder anderer Seitenaufbau.');
      return false;
    }
    await loginTrigger.click({ timeout: 5000 });
    await page.waitForTimeout(1500);

    const emailInput = page
      .locator('input[type="email"], input[name*="user" i], input[name*="mail" i], input[type="text"]')
      .first();
    const passwordInput = page.locator('input[type="password"]').first();

    await emailInput.waitFor({ timeout: 10000 });
    await emailInput.fill(username);
    await passwordInput.waitFor({ timeout: 10000 });
    await passwordInput.fill(password);

    const submitBtn = page.getByRole('button', { name: /login|anmelden/i }).first();
    if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await submitBtn.click({ timeout: 5000 });
    } else {
      await passwordInput.press('Enter');
    }

    await page.waitForTimeout(3000);
    const loggedIn = await page
      .getByText('Logout', { exact: false })
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    console.log('Login erfolgreich:', loggedIn);
    return loggedIn;
  } catch (e) {
    console.warn('Login fehlgeschlagen:', e.message);
    return false;
  }
}

// Extrahiert die Klartext-Bezeichnungen der Konkurrenzen aus der
// Turnier-Übersichtsseite. Format auf tennis.de (bestätigt am echten
// MB-Cup-Turnier, 3 aufeinanderfolgende Zeilen je Konkurrenz):
//   Herren Einzel
//   KO
//   LK 1,0-25,0
function extractCompetitionLabels(overviewText) {
  const lines = overviewText.split('\n').map((l) => l.trim()).filter(Boolean);
  const labels = [];
  for (let i = 0; i < lines.length; i++) {
    const isCategory = /^(Herren|Damen)\b/.test(lines[i]);
    const isFormat = /^(KO|Spiralsystem|Round Robin)$/.test(lines[i + 1] || '');
    const isLk = /^LK\s*[\d.,\-]+/.test(lines[i + 2] || '');
    if (isCategory && isFormat && isLk) {
      labels.push(`${lines[i]} ${lines[i + 1]} ${lines[i + 2]}`);
    }
  }
  return labels;
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
  await page.waitForTimeout(3000);

  const loggedIn = await loginIfNeeded(page);
  if (loggedIn) {
    // Nach dem Login die Turnierseite neu laden, damit die Konkurrenzen
    // sicher mit dem eingeloggten Zustand gerendert werden.
    await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
  }

  // Diagnose-Schnappschuss, damit wir bei einem Fehlschlag sehen, was der
  // Bot tatsächlich vorgefunden hat (z.B. Cookie-Banner, Bot-Sperre, andere
  // Seitenstruktur als erwartet).
  try {
    const outerText = await page.locator('body').innerText();
    fs.writeFileSync(path.join(DATA_DIR, `${FILE_PREFIX}scrape-debug.txt`), outerText);
    await page.screenshot({ path: path.join(DATA_DIR, `${FILE_PREFIX}scrape-debug.png`), fullPage: true });
  } catch (e) {
    console.warn('Konnte Diagnose-Schnappschuss nicht erstellen:', e.message);
  }

  const hasLoginWall = (await page.locator('body').innerText()).includes(
    'logge dich ein, um nähere Informationen'
  );
  if (hasLoginWall) {
    console.error(
      'tennis.de zeigt einen Login-Hinweis statt der Konkurrenzen - vermutlich Bot-Erkennung. ' +
      `Siehe data/${FILE_PREFIX}scrape-debug.txt und data/${FILE_PREFIX}scrape-debug.png.`
    );
    writeJSON(`${FILE_PREFIX}entrants.json`, readJSON(`${FILE_PREFIX}entrants.json`, []));
    await browser.close();
    return;
  }

  await page.waitForSelector('text=Konkurrenzen', { timeout: 30000 }).catch(() => {});

  const overviewText = await page.locator('body').innerText();

  const competitionBlocks = extractCompetitionLabels(overviewText);

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

  writeJSON(`${FILE_PREFIX}entrants.json`, allEntrants);

  // Ergebnisse (mit Score) und Spielplan (ohne Score) trennen
  const results = allMatches.filter((m) => m.score && /\d:\d/.test(m.score));
  const schedule = allMatches.filter((m) => !m.score);

  if (results.length) writeJSON(`${FILE_PREFIX}results.json`, results);
  if (schedule.length) writeJSON(`${FILE_PREFIX}schedule.json`, schedule);

  console.log(`Fertig: ${allEntrants.length} Meldelisten, ${results.length} Ergebnisse, ${schedule.length} offene Paarungen.`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
