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
const NULIGA_TERMINLISTE_URL =
  process.env.NULIGA_TERMINLISTE_URL ||
  `https://wtv.liga.nu/cgi-bin/WebObjects/nuLigaDokumentTENDE.woa/wa/nuDokument?dokument=TournamentPlayersReportFOP&tournament=${TOURNAMENT_ID}&securitytoken=RP6o3s74L6YrIGbY0b2D3A%3D%3D&type=2&mode=0&showSponsorLogo=true`; // Oeffentlicher, unauthentifizierter Freigabe-Link fuer die Terminliste (kein nuLiga-Login noetig)
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

// Analysiert die Turnier-Übersichtsseite und liefert EIN Objekt pro
// "Meldeliste"-Link, in der exakten Dokument-Reihenfolge, in der sie auf der
// Seite erscheinen - inklusive Nebenrunden (Trostrunden), die KEINE eigene
// Herren/Damen-Kopfzeile haben, aber trotzdem eine eigene Meldeliste UND
// (meist) einen eigenen "Hauptfeld"/"Tableau ansehen"-Link besitzen.
//
// WICHTIG (Bug, gefunden beim Test gegen ein abgeschlossenes Turnier mit
// echten Klammern): Nicht jede Konkurrenz hat ein Tableau (kleine Felder
// unter 5 Meldungen z.B. haben oft nur eine Meldeliste, kein Hauptfeld).
// Die Reihenfolge der "Hauptfeld"-Links ist deshalb NICHT deckungsgleich mit
// der Reihenfolge der "Meldeliste"-Links - man darf NICHT einfach beide
// Listen mit demselben Index (nth(i)) verknüpfen, sonst landet man beim
// Tableau-Scraping regelmäßig bei der falschen Konkurrenz. Diese Funktion
// bestimmt deshalb für jede Meldeliste separat, ob (und an welcher Position
// innerhalb der Hauptfeld-Linkliste) ein Tableau existiert.
//
// Format auf tennis.de je Konkurrenz (Leerzeilen entfernt):
//   Herren Einzel        <- Kategorie (fehlt bei Nebenrunden)
//   KO                   <- Format (fehlt bei Nebenrunden)
//   LK 1,0-25,0          <- LK-Bereich (fehlt bei Nebenrunden)
//   ...
//   Meldeliste           <- Anker, den wir suchen
//   Zulassungsliste      <- optional
//   Termine              <- optional
//   Hauptfeld            <- nur vorhanden, wenn Auslosung erfolgt ist
function parseOverviewBlocks(overviewText) {
  const lines = overviewText.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks = [];
  let currentLabel = null;
  let labelUsed = false;
  let hauptfeldCounter = 0;
  let termineCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const isCategory = /^(Herren|Damen)\b/.test(lines[i]);
    const isFormat = /^(KO|Spiralsystem|Round Robin)$/.test(lines[i + 1] || '');
    const isLk = /^LK\s*[\d.,\-]+/.test(lines[i + 2] || '');
    if (isCategory && isFormat && isLk) {
      currentLabel = `${lines[i]} ${lines[i + 1]} ${lines[i + 2]}`;
      labelUsed = false;
    }

    if (lines[i] === 'Meldeliste') {
      // Nach vorne schauen (bis zur nächsten Meldeliste/Kategorie), ob ein
      // Hauptfeld-/Tableau-Link bzw. ein Termine-Link zu DIESER Konkurrenz
      // gehört. Beides ist optional und unabhängig voneinander vorhanden.
      let hasHauptfeld = false;
      let hasTermine = false;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        if (lines[j] === 'Meldeliste') break;
        const nextIsCategory =
          /^(Herren|Damen)\b/.test(lines[j]) && /^(KO|Spiralsystem|Round Robin)$/.test(lines[j + 1] || '');
        if (nextIsCategory) break;
        if (lines[j] === 'Hauptfeld' || /^Tableau ansehen/.test(lines[j])) {
          hasHauptfeld = true;
        }
        if (lines[j] === 'Termine') {
          hasTermine = true;
        }
      }

      let label = null;
      if (currentLabel && !labelUsed) {
        label = currentLabel;
        labelUsed = true;
      } else if (currentLabel) {
        label = `${currentLabel} (Nebenrunde)`;
      }

      blocks.push({
        label,
        hauptfeldIndex: hasHauptfeld ? hauptfeldCounter : null,
        termineIndex: hasTermine ? termineCounter : null,
      });
      if (hasHauptfeld) hauptfeldCounter += 1;
      if (hasTermine) termineCounter += 1;
    }
  }
  return blocks;
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

// Liest die Tableau-Ansicht (Bracket) STRUKTURIERT aus dem DOM aus, nicht aus
// geflachtem innerText. Die Bracket-Darstellung ist eine echte HTML-Tabelle
// mit einer Spalte pro Runde (z.B. "Achtelfinale", "Viertelfinale",
// "Halbfinale", "Finale", "Sieger"). Verifiziert am kompletten, bereits
// abgeschlossenen 16. Wilgersdorfer LK-Turnier (Herren Einzel Hauptfeld,
// 16er-Tableau, ID 713418) - alle 15 Matches (8 Achtelfinale + 4 Viertelfinale
// + 2 Halbfinale + 1 Finale) inkl. korrektem Sieger und Score von Hand UND
// programmatisch nachgerechnet.
async function extractTableauTable(page) {
  return page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    const table = tables.find((t) =>
      /Achtelfinale|Viertelfinale|Halbfinale|Finale|Sechzehntelfinale/.test(t.textContent)
    );
    if (!table) return null;
    const trs = Array.from(table.querySelectorAll('tr'));
    if (trs.length < 2) return null;
    const headers = Array.from(trs[0].children).map((th) => th.textContent.trim());
    const rows = trs.slice(1).map((tr) => Array.from(tr.children).map((td) => td.textContent.trim()));
    return { headers, rows };
  });
}

const FULL_PLAYER_RE = /LK([\d.,]+)\s*-\s*([^,]+),\s*([^,]+),\s*(\d{4})\s*-\s*(.+)$/;

function parseShortName(label) {
  const m = label.match(/^([^,]+),\s*([A-ZÄÖÜ])\.?$/);
  if (!m) return null;
  return { surname: m[1].trim(), initial: m[2] };
}

function fullNameMatchesShort(fullName, short) {
  if (!short) return false;
  const parts = fullName.split(',');
  const surname = parts[0].trim();
  const firstname = (parts[1] || '').trim();
  return surname === short.surname && firstname[0] === short.initial;
}

// tableData = { headers, rows } von extractTableauTable(). Jede weitere
// Rundenspalte (nach der ersten, den Teilnehmern) enthält abwechselnd
// [Kurzname-des-Siegers, Ergebnis] für jedes Match der VORHERIGEN Runde -
// z.B. steht das Ergebnis eines Achtelfinale-Matches in der
// "Viertelfinale"-Spalte. Wir verarbeiten deshalb Spalte für Spalte und
// reichen die jeweiligen Sieger als Teilnehmer der nächsten Runde weiter.
// Gruppiert die Runde-1-Rohzeilen paarweise: eine "Slot"-Zeile ist eine
// Zeile, in der die Runde-1-Spalte (Index 1) gefüllt ist - entweder ein
// echter Spieler ODER "[Rast]" (Freilos). Alle Zeilen ZWISCHEN Slot A und
// Slot B eines Paares gehören zu diesem Duell (dort steht - falls
// vorhanden - dessen Ergebnis-Kurzform).
//
// WICHTIG (Bug behoben): Vorher wurden "[Rast]"-Zeilen beim Aufbau von
// "participants" stillschweigend übersprungen. Das hat nicht nur dazu
// geführt, dass Freilos-Spieler komplett aus schedule.json verschwanden,
// sondern auch alle NACHFOLGENDEN Paarungen um die Anzahl der übersprungenen
// Freilose verschoben - z.B. wurden zwei Spieler, die beide nur ein Freilos
// hatten und sich in Wirklichkeit noch gar nicht gegenüberstanden (z.B.
// Weber/Ballion im MB-Cup 2026), fälschlich als "Runde 1"-Gegner mit
// erfundenem Sieger ausgegeben. Diese paarweise Gruppierung anhand der
// tatsächlichen Zeilenposition verhindert das, weil Freilose als echter
// Slot (nur ohne Namen) mitgezählt werden statt entfernt zu werden.
function buildRound1Pairs(rows) {
  const pairs = [];
  let pendingSlot = null;
  let pendingEntries = [];
  for (const row of rows) {
    const cell = row[1];
    let slot = null;
    if (cell) {
      const m = cell.match(FULL_PLAYER_RE);
      if (m) {
        slot = { lk: m[1], fullName: `${m[2].trim()}, ${m[3].trim()}`, club: m[5].trim() };
      } else if (/\[Rast\]/.test(cell)) {
        slot = { isBye: true };
      }
    }
    // Ergebnis-Spalte IMMER prüfen, auch wenn diese Zeile selbst schon den
    // zweiten Slot enthält - bei einem entschiedenen Match stehen Kurzname
    // des Siegers und Ergebnis-Score oft NICHT in einer eigenen Zwischen-
    // zeile, sondern das Ergebnis steht in derselben Zeile wie Slot B (am
    // echten, abgeschlossenen Referenzturnier 713418 verifiziert - vorher
    // wurde dieser Fall übersehen und das Ergebnis ging verloren).
    if (pendingSlot && row[2]) {
      pendingEntries.push(row[2]);
    }
    if (slot) {
      if (!pendingSlot) {
        pendingSlot = slot;
        pendingEntries = [];
      } else {
        pairs.push({ s1: pendingSlot, s2: slot, entries: pendingEntries });
        pendingSlot = null;
        pendingEntries = [];
      }
    }
  }
  return pairs;
}

function parseTableau(tableData, competition) {
  if (!tableData) return [];
  const { headers, rows } = tableData;
  const roundNames = headers.slice(1);
  if (roundNames.length < 2) return [];

  // --- Runde 1: separat behandelt, weil hier (und nur hier) Freilose
  // ("[Rast]") auftreten können - Freilose gleichen die Teilnehmerzahl nur
  // in Runde 1 auf eine Zweierpotenz aus, ab Runde 2 gibt es keine mehr. ---
  const round1Pairs = buildRound1Pairs(rows);
  if (round1Pairs.length < 1) return [];

  const matches = [];
  let participants = [];
  const roundLabelR1 = roundNames[0];
  let roundIncomplete = false;

  for (const { s1, s2, entries } of round1Pairs) {
    if (s1.isBye || s2.isBye) {
      // Freilos: der andere Spieler kommt automatisch weiter, OHNE echtes
      // Match. Trotzdem als Spielplan-Eintrag aufnehmen (statt den Spieler
      // stillschweigend verschwinden zu lassen), damit z.B. Seed-1-Spieler
      // wie ein Freilos-Gewinner in Runde 1 sichtbar bleiben.
      const advancing = s1.isBye ? s2 : s1;
      if (advancing) {
        matches.push({
          competition,
          round: roundLabelR1,
          player1: advancing.fullName,
          player2: null,
          winner: advancing.fullName,
          score: 'Freilos',
          time: '',
          court: '',
        });
        participants.push(advancing);
      }
      continue;
    }

    const label = entries[0] || null;
    const score = entries[1] || null;

    if (!label) {
      // Dieses Match ist auf der Seite noch nicht entschieden (Turnier
      // läuft noch) - als Spielplan-Eintrag ohne Ergebnis aufnehmen, aber
      // NICHT als Teilnehmer der nächsten Runde weiterreichen, da wir noch
      // nicht wissen, wer gewinnt. Nachfolgende Runden können deshalb erst
      // in einem späteren Lauf ausgewertet werden.
      matches.push({
        competition,
        round: roundLabelR1,
        player1: s1.fullName,
        player2: s2.fullName,
        winner: null,
        score: null,
        time: '',
        court: '',
      });
      roundIncomplete = true;
      continue;
    }

    const short = parseShortName(label);
    let winner = null;
    if (short) {
      if (fullNameMatchesShort(s1.fullName, short)) winner = s1;
      else if (fullNameMatchesShort(s2.fullName, short)) winner = s2;
    }
    if (!winner) winner = s1; // Fallback, falls Kurzname nicht zuordenbar ist

    matches.push({
      competition,
      round: roundLabelR1,
      player1: s1.fullName,
      player2: s2.fullName,
      winner: winner.fullName,
      score,
      time: '',
      court: '',
    });
    participants.push(winner);
  }

  if (roundIncomplete) return matches;

  // --- Ab Runde 2 (Achtelfinale-Ergebnis-Spalte usw.): keine Freilose mehr
  // möglich, hier greift die ursprüngliche, an echten Bracket-Daten
  // verifizierte Index-Logik unverändert. ---
  for (let colIdx = 3; colIdx < headers.length; colIdx++) {
    const roundLabel = roundNames[colIdx - 2];
    const entries = [];
    for (const row of rows) {
      const cell = row[colIdx];
      if (cell) entries.push(cell);
    }

    const pairCount = Math.floor(participants.length / 2);
    const nextParticipants = [];
    let incomplete = false;
    for (let i = 0; i < pairCount; i++) {
      const p1 = participants[2 * i];
      const p2 = participants[2 * i + 1];
      if (!p1 || !p2) continue;

      const label = entries[2 * i] || null;
      const score = entries[2 * i + 1] || null;

      if (!label) {
        matches.push({
          competition,
          round: roundLabel,
          player1: p1.fullName,
          player2: p2.fullName,
          winner: null,
          score: null,
          time: '',
          court: '',
        });
        incomplete = true;
        continue;
      }

      const short = parseShortName(label);
      let winner = null;
      if (short) {
        if (fullNameMatchesShort(p1.fullName, short)) winner = p1;
        else if (fullNameMatchesShort(p2.fullName, short)) winner = p2;
      }
      if (!winner) winner = p1; // Fallback, falls Kurzname nicht zuordenbar ist

      matches.push({
        competition,
        round: roundLabel,
        player1: p1.fullName,
        player2: p2.fullName,
        winner: winner.fullName,
        score,
        time: '',
        court: '',
      });
      nextParticipants.push(winner);
    }
    participants = nextParticipants;
    if (incomplete) break;
  }

  return matches;
}

// Liest die "Termine"-Ansicht einer Konkurrenz strukturiert aus: eine Tabelle
// mit Kopfzeile "SP | Name / Platzanlage (PA) | Verein | LK | DR | Termin".
// Nutzt innerText statt textContent, damit Zeilenumbrüche INNERHALB einer
// Zelle (z.B. Name + Platzanlage in derselben Zelle) erhalten bleiben - sonst
// würden z.B. "Schmitt, Pascal" und "Platz 3" ohne Trennzeichen zu einem
// Wort verschmelzen.
//
// HINWEIS: Bei allen bisher geprüften Turnieren (auch dem kompletten,
// abgeschlossenen Test-Turnier 713418) war diese Tabelle leer - der
// Turnierausrichter hatte offenbar keine Termine/Plätze pro Spiel in
// tennis.de eingetragen. Die Parser-Logik unten ist deshalb nach bestem
// Wissen anhand der Spaltenüberschriften geschrieben, aber NICHT an echten
// befüllten Zeilen verifiziert. Sobald für den echten MB-Cup 2026 (oder ein
// anderes Turnier) tatsächlich Termine eingetragen werden, unbedingt einmal
// data/termine-debug.json bzw. data/test-termine-debug.json prüfen und die
// Zuordnungs-Heuristik in parseTermine() bei Bedarf nachschärfen.
async function extractTermineTable(page) {
  return page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    const table = tables.find((t) => /Termin/.test(t.textContent) && /Platzanlage|Verein/.test(t.textContent));
    if (!table) return null;
    const trs = Array.from(table.querySelectorAll('tr'));
    if (trs.length < 1) return null;
    const headers = Array.from(trs[0].children).map((th) => th.innerText.trim());
    const rows = trs.slice(1).map((tr) => Array.from(tr.children).map((td) => td.innerText.trim()));
    return { headers, rows };
  });
}

// Extrahiert aus einer Termine-Zeile (Array von Zellentexten, jede Zelle kann
// mehrzeilig sein) Datum, Uhrzeit und Platz sowie die Rohzeilen zum späteren
// Abgleich mit einem Spielernamen.
function parseTermineRow(row) {
  const lines = row.flatMap((cell) => cell.split('\n').map((l) => l.trim())).filter(Boolean);
  const full = lines.join(' ');
  const dateMatch = full.match(/\b(\d{2}\.\d{2}\.\d{4})\b/);
  const timeMatch = full.match(/\b(\d{1,2}:\d{2})\b/);
  // "Platz" ist case-insensitiv sicher (kollidiert mit keinem Namen), die
  // Abkürzung "PA" dagegen NUR groß schreiben matchen - sonst matcht sie
  // versehentlich als Teilstring in Namen wie "Pascal" oder "Paul".
  const courtMatch = full.match(/\bPlatz\s*\S+/i) || full.match(/\bPA\s*\d+\S*/);
  return {
    lines,
    date: dateMatch ? dateMatch[1] : '',
    time: timeMatch ? timeMatch[1] : '',
    court: courtMatch ? courtMatch[0] : '',
  };
}

// Prüft, ob eine Termine-Zeile zu einem Spieler (Format "Nachname, Vorname",
// wie aus dem Tableau) gehört - über Nachname + (Vorname oder Vorname-Anfangs-
// buchstabe) im Zeilentext, da das genaue Namensformat der Termine-Tabelle
// noch nicht an echten Daten verifiziert werden konnte (siehe oben).
function termineRowMatchesPlayer(row, fullName) {
  const parts = fullName.split(',');
  const surname = parts[0].trim();
  const firstname = (parts[1] || '').trim();
  if (!surname) return false;
  return row.lines.some((line) => {
    if (!line.includes(surname)) return false;
    if (!firstname) return true;
    return line.includes(firstname) || (firstname[0] && line.includes(firstname[0]));
  });
}

// Ergänzt Datum/Uhrzeit/Platz in den Match-Objekten einer Konkurrenz anhand
// der Termine-Tabelle (falls vorhanden und befüllt). Verändert die matches
// NICHT, wenn keine passende Termine-Zeile gefunden wird - dann bleiben
// time/court einfach leer wie bisher (keine Verschlechterung ggü. vorher).
function mergeTermineIntoMatches(matches, termineRows) {
  if (!termineRows || !termineRows.length) return matches;
  for (const m of matches) {
    const rowFor = (name) => termineRows.find((row) => termineRowMatchesPlayer(row, name));
    const row = rowFor(m.player1) || rowFor(m.player2);
    if (row) {
      if (row.date) m.time = row.time ? `${row.date} ${row.time} Uhr` : row.date;
      if (row.court) m.court = row.court;
    }
  }
  return matches;
}

// meldelisteIndex: Position dieser Konkurrenz in der Liste ALLER
// "Meldeliste"-Links (inkl. Nebenrunden) - für die Meldeliste selbst.
// hauptfeldIndex: Position dieser Konkurrenz in der (kürzeren, separaten)
// Liste der "Hauptfeld"/"Tableau ansehen"-Links, oder null, wenn diese
// Konkurrenz gar kein Tableau hat (z.B. zu wenige Meldungen). Siehe
// parseOverviewBlocks() für die Begründung, warum diese beiden Indizes NICHT
// identisch sind.
async function scrapeCompetition(page, meldelisteIndex, hauptfeldIndex, termineIndex, competitionLabel) {
  const result = { entrants: null, matches: [] };

  // --- Meldeliste ---
  try {
    const meldelisteLinks = page.getByText('Meldeliste', { exact: true });
    const count = await meldelisteLinks.count();
    if (meldelisteIndex < count) {
      await meldelisteLinks.nth(meldelisteIndex).click({ timeout: 5000 });
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

  // --- Ergebnisse / Tableau (nur vorhanden, wenn Auslosung erfolgt ist UND
  // diese Konkurrenz überhaupt ein Hauptfeld hat) ---
  if (hauptfeldIndex !== null) {
    try {
      const ergebnisLinks = page.getByText('Hauptfeld', { exact: true }).or(page.getByText('Tableau ansehen', { exact: false }));
      const count = await ergebnisLinks.count();
      if (hauptfeldIndex < count) {
        await ergebnisLinks.nth(hauptfeldIndex).click({ timeout: 5000 });
        await page.waitForTimeout(1200);
        const text = await page.locator('body').innerText();
        if (!text.includes('nicht verfügbar')) {
          const tableData = await extractTableauTable(page);
          result.matches = parseTableau(tableData, competitionLabel);
        }
        // Diagnose: die allererste Tableau-Seite eines Laufs immer
        // mitschreiben, damit man bei 0 gefundenen Ergebnissen sehen kann,
        // ob die Seite überhaupt wie erwartet aussieht (Klick hat geklappt,
        // aber die Tabelle nicht gefunden/anders aufgebaut ist).
        if (hauptfeldIndex === 0) {
          try {
            fs.writeFileSync(path.join(DATA_DIR, `${FILE_PREFIX}tableau-debug.txt`), text);
            const tableData = await extractTableauTable(page);
            fs.writeFileSync(
              path.join(DATA_DIR, `${FILE_PREFIX}tableau-debug.json`),
              JSON.stringify(tableData, null, 2) + '\n'
            );
            await page.screenshot({ path: path.join(DATA_DIR, `${FILE_PREFIX}tableau-debug.png`), fullPage: true });
          } catch (e) {
            console.warn('Konnte Tableau-Diagnose-Schnappschuss nicht erstellen:', e.message);
          }
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
  }

  // --- Termine (Datum/Uhrzeit/Platz je Spiel, falls vom Ausrichter in
  // tennis.de eingetragen) - optional, ergänzt nur time/court in den bereits
  // aus dem Tableau gewonnenen Matches, ohne sie sonst zu verändern. ---
  if (termineIndex !== null && result.matches.length) {
    try {
      const termineLinks = page.getByText('Termine', { exact: true });
      const count = await termineLinks.count();
      if (termineIndex < count) {
        await termineLinks.nth(termineIndex).click({ timeout: 5000 });
        await page.waitForTimeout(1200);
        let termineTable = await extractTermineTable(page);
        for (let retry = 0; retry < 4 && (!termineTable || !termineTable.rows.length); retry++) {
          await page.waitForTimeout(1000);
          termineTable = await extractTermineTable(page);
        }
        const termineRows = (termineTable ? termineTable.rows : []).map(parseTermineRow);
        mergeTermineIntoMatches(result.matches, termineRows);

        if (termineIndex === 0) {
          try {
            fs.writeFileSync(
              path.join(DATA_DIR, `${FILE_PREFIX}termine-debug.json`),
              JSON.stringify(termineTable, null, 2) + '\n'
            );
          } catch (e) {
            console.warn('Konnte Termine-Diagnose nicht schreiben:', e.message);
          }
        }

        const back = page.getByText('Zurück zum Turnier', { exact: false }).first();
        if (await back.isVisible({ timeout: 1000 }).catch(() => false)) {
          await back.click({ timeout: 3000 });
          await page.waitForTimeout(800);
        }
      }
    } catch (e) {
      console.warn(`Termine für "${competitionLabel}" konnten nicht gelesen werden:`, e.message);
    }
  }

  return result;
}

// Liest die Termine (Platz + Uhrzeit) direkt aus der offiziellen nuLiga-Terminliste
// (oeffentlicher PDF-Export ueber einen fest hinterlegten Freigabe-Link, KEIN Login
// noetig - ein Testlauf hat gezeigt, dass nuLiga fuer die Turnierverwaltung ein
// eigenes Login ("nuLiga ID") verlangt, das nichts mit den tennis.de-Zugangsdaten
// zu tun hat; der PDF-Export selbst ist aber oeffentlich abrufbar), da diese Angaben
// auf der oeffentlichen tennis.de-Turnierseite trotz vollstaendiger Erfassung durch
// den Turnierleiter nicht angezeigt werden (Luecke zwischen nuLiga und tennis.de,
// siehe Diagnose vom 12.08.2026).
async function fetchNuligaTerminMap(page) {
  try {
    const response = await page.context().request.get(NULIGA_TERMINLISTE_URL);
    if (!response.ok()) {
      console.warn('nuLiga: Terminliste-PDF konnte nicht geladen werden, Status', response.status());
      return null;
    }
    const buffer = await response.body();
    const pdfParse = require('pdf-parse');
    const parsed = await pdfParse(buffer);
    const raw = parsed.text;

    const cleaned = raw
      .replace(/^Turnier:.*$/gm, '')
      .replace(/^LK:.*$/gm, '')
      .replace(/^Bewerb:.*$/gm, '')
      .replace(/^Terminliste$/gm, '')
      .replace(/^(Damen|Herren)( \d+)? (Einzel|Doppel)$/gm, '')
      .replace(/^Hauptfeld$/gm, '')
      .replace(/^NameSetzungLK.*Termin$/gm, '')
      .replace(/^nu\s*\.?Dokument.*$/gm, '');

    const text = cleaned.replace(/\s+/g, ' ').trim();
    // pdf-parse fuegt an Zellengrenzen (Name|Setzung, Setzung|LK, Platz-Nr.|Datum)
    // KEINE Leerzeichen ein (anders als andere PDF-Text-Extraktoren) - die Regex
    // unten beruecksichtigt das: Setzung ist optional ohne Leerzeichen vor "LK",
    // und die Platz-Nummer wird nicht-gierig VOR dem folgenden TT.MM.-Datum gelesen.
    const WORD = "[A-ZÄÖÜ][A-Za-zÀ-ÿß'\\-#]*";
    const NAME = `(${WORD}(?:\\s${WORD}){0,2},\\s${WORD}(?:\\s${WORD}){0,2})`;
    const re = new RegExp(
      NAME + "\\d{0,2}LK[\\d,]+.*?Platz\\s*(\\d+?)(\\d{2})\\.(\\d{2})\\.\\s+(\\d{2}):(\\d{2})",
      'g'
    );

    const year = new Date().getFullYear();
    const map = new Map();
    let m;
    while ((m = re.exec(text)) !== null) {
      const [, name, platz, day, month, hh, mm] = m;
      map.set(name.trim(), {
        court: `Platz ${platz}`,
        time: `${day}.${month}.${year} ${hh}:${mm} Uhr`,
      });
    }
        return map;
  } catch (e) {
    console.warn('nuLiga-Terminliste konnte nicht geladen werden:', e.message);
    return null;
  }
}

function mergeNuligaTermine(matches, terminMap) {
  if (!terminMap || !terminMap.size) return;
  for (const m of matches) {
    const t = terminMap.get(m.player1) || terminMap.get(m.player2);
    if (t) {
      m.time = t.time;
      m.court = t.court;
    }
  }
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

  const overviewBlocks = parseOverviewBlocks(overviewText);

  const meldelisteCount = await page.getByText('Meldeliste', { exact: true }).count();
  console.log(`${meldelisteCount} Konkurrenzen mit Meldeliste gefunden.`);
  if (overviewBlocks.length !== meldelisteCount) {
    console.warn(
      `Warnung: parseOverviewBlocks() fand ${overviewBlocks.length} Blöcke, ` +
      `aber es gibt ${meldelisteCount} Meldeliste-Links. Zuordnung kann an dieser Stelle abweichen.`
    );
  }

  const allEntrants = [];
  const allMatches = [];

  for (let i = 0; i < meldelisteCount; i++) {
    const block = overviewBlocks[i] || {};
    const label = block.label || `Konkurrenz ${i + 1}`;
    const hauptfeldIndex = block.hauptfeldIndex ?? null;
    const termineIndex = block.termineIndex ?? null;
    console.log(
      `(${i + 1}/${meldelisteCount}) ${label}` +
      `${hauptfeldIndex === null ? ' [kein Tableau]' : ` [Tableau #${hauptfeldIndex}]`}` +
      `${termineIndex === null ? ' [keine Termine]' : ` [Termine #${termineIndex}]`}`
    );
    const { entrants, matches } = await scrapeCompetition(page, i, hauptfeldIndex, termineIndex, label);
    if (entrants) allEntrants.push(entrants);
    if (matches && matches.length) allMatches.push(...matches);
  }

  writeJSON(`${FILE_PREFIX}entrants.json`, allEntrants);

  // Ergebnisse (mit Score) und Spielplan (ohne Score) trennen
  // "Freilos"-Einträge (Spieler kommt ohne Spiel weiter) zählen NICHT als
  // Ergebnis mit Score, gehören aber weiterhin in den Spielplan, damit der
  // Spieler dort sichtbar bleibt statt komplett zu verschwinden.
    const nuligaTerminMap = await fetchNuligaTerminMap(page);
  mergeNuligaTermine(allMatches, nuligaTerminMap);

  const results = allMatches.filter((m) => m.score && m.score !== 'Freilos' && /\d:\d/.test(m.score));
  const schedule = allMatches.filter((m) => !m.score || m.score === 'Freilos');

  // WICHTIG: Immer schreiben, auch wenn leer - sonst bleibt beim Wechsel von
  // "hat Ergebnisse" zurück zu "keine Ergebnisse" (oder wenn die Datei vorher
  // nur einmal manuell mit Platzhalterdaten angelegt wurde) eine veraltete
  // Datei liegen, die die Seite fälschlich für aktuell hält.
  writeJSON(`${FILE_PREFIX}results.json`, results);
  writeJSON(`${FILE_PREFIX}schedule.json`, schedule);

  console.log(`Fertig: ${allEntrants.length} Meldelisten, ${results.length} Ergebnisse, ${schedule.length} offene Paarungen.`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
