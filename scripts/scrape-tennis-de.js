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
 * Hinweis zum Login: Die Konkurrenzen-/ Meldeliste-Ansicht dieser
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

// Entscheidet anhand des Kurzname-Labels aus der Ergebnis-Zelle, wer ein
// Match gewonnen hat - oder ob das Match schlicht noch nicht entschieden ist.
//
// WICHTIG (Bug behoben, gefunden am MB-Cup 2026 VOR Turnierbeginn, als noch
// keine einzige Partie gespielt war): Solange ein Match noch nicht gespielt
// ist, füllt tennis.de die Ergebnis-Zelle im Tableau nicht mit einem
// Sieger-Kurznamen, sondern häufig schon mit dem geplanten Termin
// (z.B. "15.08. 12:00"). So ein Termin-String passt NIE auf das erwartete
// Kurzname-Format "Nachname, X." - parseShortName() gibt dafür also `null`
// zurück. Der alte Code ist in diesem Fall trotzdem auf
// "if (!winner) winner = s1;" zurückgefallen und hat damit JEDE noch offene
// Partie fälschlich als von Spieler 1 gewonnen ausgegeben (100% der
// "Ergebnisse" hatten dadurch winner === player1, quer durch alle
// Konkurrenzen und Runden - das war das Signal, an dem der Bug erkannt
// wurde). Diese Funktion "rät" deshalb nie mehr: kann kein Kurzname
// zugeordnet werden, ist das Match schlicht offen (return null).
function resolveWinner(label, s1, s2) {
    if (!label) return null;
    const short = parseShortName(label);
    if (!short) {
          return null;
    }
    if (fullNameMatchesShort(s1.fullName, short)) return s1;
    if (fullNameMatchesShort(s2.fullName, short)) return s2;
    console.warn(
          `Sieger-Kurzname "${label}" passt zu keinem der beiden Spieler (${s1.fullName} / ${s2.fullName}) - ` +
            'Partie wird als noch offen behandelt.'
        );
    return null;
}

// Erkennt, ob ein "score"-String tatsächlich ein Satz-Ergebnis ist (z.B.
// "6:2, 6:4") und nicht etwa ein Termin-String wie "15.08. 12:00", der
// zufällig ebenfalls ein "Zahl:Zahl"-Muster enthält (die Uhrzeit). Echte
// Tennis-Satzergebnisse enthalten nie einen Punkt (Datumstrennzeichen).
function isRealScore(score) {
    return typeof score === 'string' && /\d+\s*:\s*\d+/.test(score) && !/\d{1,2}\.\d{1,2}\./.test(score);
}

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

  const round1Pairs = buildRound1Pairs(rows);
    if (round1Pairs.length < 1) return [];

  const matches = [];
    let participants = [];
    const roundLabelR1 = roundNames[0];
    let roundIncomplete = false;

  for (const { s1, s2, entries } of round1Pairs) {
        if (s1.isBye || s2.isBye) {
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
        const winner = resolveWinner(label, s1, s2);

      if (!winner) {
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
                const winner = resolveWinner(label, p1, p2);

          if (!winner) {
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

function parseTermineRow(row) {
    const lines = row.flatMap((cell) => cell.split('\n').map((l) => l.trim())).filter(Boolean);
    const full = lines.join(' ');
    const dateMatch = full.match(/\b(\d{2}\.\d{2}\.\d{4})\b/);
    const timeMatch = full.match(/\b(\d{1,2}:\d{2})\b/);
    const courtMatch = full.match(/\bPlatz\s*\S+/i) || full.match(/\bPA\s*\d+\S*/);
    return {
          lines,
          date: dateMatch ? dateMatch[1] : '',
          time: timeMatch ? timeMatch[1] : '',
          court: courtMatch ? courtMatch[0] : '',
    };
}

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

async function scrapeCompetition(page, meldelisteIndex, hauptfeldIndex, termineIndex, competitionLabel) {
    const result = { entrants: null, matches: [] };

  try {
        const meldelisteLinks = page.getByText('Meldeliste', { exact: true });
        const count = await meldelisteLinks.count();
        if (meldelisteIndex < count) {
                await meldelisteLinks.nth(meldelisteIndex).click({ timeout: 5000 });
                await page.waitForTimeout(1200);
                const text = await page.locator('body').innerText();
                result.entrants = parseMeldeliste(text, competitionLabel);

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
          await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(3000);
    }

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

  // Ergebnisse (mit echtem Satz-Score) und Spielplan (ohne Score) trennen.
  // WICHTIG (siehe resolveWinner()/isRealScore() oben): dank des Fixes dort
  // haben noch nicht entschiedene Partien bereits winner:null/score:null,
  // isRealScore() ist hier nur noch eine zusätzliche Absicherung, damit auf
  // keinen Fall ein Termin-String (z.B. "15.08. 12:00") als echtes Ergebnis
  // durchrutscht.
  const results = allMatches.filter((m) => m.winner && m.score && m.score !== 'Freilos' && isRealScore(m.score));
    const schedule = allMatches.filter((m) => !m.winner || !m.score || m.score === 'Freilos' || !isRealScore(m.score));

  writeJSON(`${FILE_PREFIX}results.json`, results);
    writeJSON(`${FILE_PREFIX}schedule.json`, schedule);

  console.log(`Fertig: ${allEntrants.length} Meldelisten, ${results.length} Ergebnisse, ${schedule.length} offene Paarungen.`);

  await browser.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
