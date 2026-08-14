/**
 * Liest die LIVE-Turnierdaten direkt aus dem internen nuLiga/TENDE-System
 * (tende-apps.liga.nu, JSON-REST-Schnittstelle der Turnierverwaltung) aus
 * und schreibt sie nach data/nuliga-live.json.
 *
 * WICHTIG: Diese Datenquelle wird AUSSCHLIESSLICH von der Live-Anzeige
 * (live-display.html / assets/live.js) genutzt, weil hier laut Vereinsvorstand
 * die aktuellsten Daten liegen (laufend vom Turnierleiter waehrend des
 * Turniers gepflegt). Spielplan/Ergebnisse/Turnierbaum auf der Hauptseite
 * (index.html / assets/app.js) nutzen weiterhin ausschliesslich die
 * tennis.de-basierten Dateien aus scrape-tennis-de.js (schedule.json,
 * results.json, entrants.json) und werden von diesem Skript NICHT
 * angefasst.
 *
 * Datenquelle: https://tende-apps.liga.nu/cgi-bin/WebObjects/nuTurnierTENDE.woa/ra/tournaments/<TOURNAMENT_ID>/
 * Das ist dieselbe interne Turnierverwaltung, in der auch die Ergebnisse
 * erfasst werden (nur fuer eingeloggte Organisatoren sichtbar) - liefert
 * aber ALLE Spiele des gesamten Turniers als sauber strukturiertes JSON
 * (Spieler, Runde, Platz, Termin, Ergebnis), inklusive Auswaertsspielen bei
 * anderen Vereinen. Anders als der oeffentliche PDF-Tableau-Report
 * (TournamentMatchesReport2FOP auf wtv.liga.nu, dort schon fuer die
 * Terminliste genutzt) laesst sich dieses JSON verlustfrei einem einzelnen
 * Match zuordnen - der PDF-Fliesstext dagegen erlaubt keine verlaessliche
 * Zuordnung von Termin zu Spiel (mehrfach mit echten Bracket-Daten geprueft,
 * am 14.08.2026 verworfen).
 *
 * Ein Aufruf ohne gueltige Session leitet automatisch auf die nuLiga-ID-
 * Anmeldemaske (tende-id.liga.nu, OAuth2, Felder "Username"/"Password")
 * um - loginAndFetch() meldet sich deshalb mit einem eigenen nuLiga-Login
 * an (NULIGA_USERNAME/NULIGA_PASSWORD), getrennt vom tennis.de-Login
 * (TENNIS_DE_USERNAME/TENNIS_DE_PASSWORD). Die genauen Feld-Selektoren sind
 * nach bestem Wissen generisch gehalten (kein Zugriff auf die Login-Maske
 * im ausgeloggten Zustand moeglich, ohne die echte Vereinssitzung zu
 * gefaehrden) - bei einem Fehlschlag hilft data/nuliga-debug.png/.txt.
 *
 * Wir filtern hier auf Spiele am TC Wilgersdorf (Platz 1-4), da die
 * Live-Anzeige ohnehin ausschliesslich Heimspiele zeigt.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const TOURNAMENT_ID = process.env.TEST_TOURNAMENT_ID || '796221'; // 17. Wilgersdorfer LK-Turnier um den markenbaumarkt24-Cup
const DATA_URL = `https://tende-apps.liga.nu/cgi-bin/WebObjects/nuTurnierTENDE.woa/ra/tournaments/${TOURNAMENT_ID}/`;
const HOME_LOCATION_NAME = 'TC Wilgersdorf';
const DATA_DIR = path.join(__dirname, '..', 'data');

function writeJSON(file, data) {
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2) + '\n');
}

function pad(n) {
    return String(n).padStart(2, '0');
}

// nuLiga liefert Termine als ISO-Zeitstempel ohne Zeitzonen-Suffix (lokale
// Zeit) - Format an die "DD.MM.YYYY HH:MM Uhr"-Konvention von
// schedule.json/results.json angleichen, damit assets/live.js dieselbe
// parseDeTime()-Regex unveraendert weiterverwenden kann.
function formatDeDateTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
}

// nuLiga-Rundennamen kommen als interne Kurzformen ("½ F", "¼ F", "⅛ F",
// "1 .R", "Finale", "3. Pl.") - auf die im Rest der Seite genutzten
// deutschen Bezeichnungen abbilden.
function normalizeRoundName(raw) {
    const s = (raw || '').trim();
    if (/3\.\s*Pl/.test(s)) return 'Spiel um Platz 3';
    if (/½/.test(s)) return 'Halbfinale';
    if (/¼/.test(s)) return 'Viertelfinale';
    if (/⅛/.test(s)) return 'Achtelfinale';
    if (/1\/16|Sechzehntel/.test(s)) return 'Sechzehntelfinale';
    if (/Finale/.test(s)) return 'Finale';
    const rMatch = s.match(/^(\d+)\s*\.?\s*R/);
    if (rMatch) return `${rMatch[1]}. Runde`;
    return s.replace(/^"/, '').trim() || raw || '';
}

function formatPlayerName(person) {
    if (!person) return null;
    const last = (person.lastname || '').trim();
    const first = (person.firstname || '').trim();
    if (!last && !first) return null;
    return first ? `${last}, ${first}` : last;
}

// playersA/playersB sind Arrays (Einzel: 1 Eintrag, Doppel: 2) - Platzhalter
// (noch nicht ausgespielte Paarungen, "player: null") liefern hier bewusst
// null statt eines erfundenen Namens.
function playerLabel(playersSide) {
    if (!playersSide || !playersSide.length) return null;
    const names = playersSide
      .map((p) => (p && p.player ? formatPlayerName(p.player.person1) : null))
      .filter(Boolean);
    return names.length ? names.join(' / ') : null;
}

// Loggt sich bei nuLiga (tende-id.liga.nu, OAuth2) ein, falls DATA_URL ohne
// gueltige Session aufgerufen wird, und liefert das geparste JSON-Objekt der
// Turnierdaten zurueck.
async function loginAndFetch(page) {
    const username = process.env.NULIGA_USERNAME;
    const password = process.env.NULIGA_PASSWORD;

  await page.goto(DATA_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (/tende-id\.liga\.nu/.test(page.url())) {
        console.log('nuLiga verlangt Login - melde mich an...');
        if (!username || !password) {
                throw new Error('nuLiga-Login erforderlich, aber NULIGA_USERNAME/NULIGA_PASSWORD nicht gesetzt.');
        }
        const userInput = page.locator('input[type="text"], input[type="email"]').first();
        const passInput = page.locator('input[type="password"]').first();
        await userInput.waitFor({ timeout: 15000 });
        await userInput.fill(username);
        await passInput.waitFor({ timeout: 15000 });
        await passInput.fill(password);
        const submitBtn = page.getByRole('button', { name: /login|anmelden/i }).first();
        if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await submitBtn.click({ timeout: 5000 });
        } else {
                await passInput.press('Enter');
        }
        // Der OAuth2-Redirect nach dem Login landet auf .../wa/login?code=...,
      // NICHT automatisch wieder auf DATA_URL - deshalb die JSON-Schnittstelle
      // danach explizit erneut aufrufen (jetzt mit gueltiger Session).
      await page.waitForURL((u) => /tende-apps\.liga\.nu/.test(u.toString()), { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.goto(DATA_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  const bodyText = await page.locator('body').innerText();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
          const data = JSON.parse(bodyText);
          return data;
    } catch (e) {
          fs.writeFileSync(path.join(DATA_DIR, 'nuliga-debug.txt'), bodyText);
          try {
                  await page.screenshot({ path: path.join(DATA_DIR, 'nuliga-debug.png'), fullPage: true });
          } catch (e2) {
                  // Diagnose ist best-effort - ein Fehlschlag hier soll den eigentlichen
            // Fehler nicht verdecken.
          }
          throw new Error(
                  'Antwort von nuLiga war kein JSON - vermutlich Login fehlgeschlagen. Siehe data/nuliga-debug.txt/.png. Auszug: ' +
                    bodyText.slice(0, 300)
                );
    }
}

// Baut aus dem rohen nuLiga-Turnierobjekt (Felder: matches, courts, groups,
// locations) eine flache Liste im selben Schema wie schedule.json/
// results.json (competition, round, player1, player2, winner, score, time,
// court), gefiltert auf Heimspiele am TC Wilgersdorf.
function buildRecords(data) {
    const courtsById = new Map();
    (data.courts || []).forEach((c) => courtsById.set(c.id, c));
    const locationsById = new Map();
    (data.locations || []).forEach((l) => locationsById.set(l.id, l));
    const groupsById = new Map();
    (data.groups || []).forEach((g) => groupsById.set(g.groupId, g));
    const roundNameByRoundId = new Map();
    (data.groups || []).forEach((g) => {
          (g.rounds || []).forEach((r) => roundNameByRoundId.set(r.roundId, r.name));
    });

  const records = [];
    for (const m of data.matches || []) {
          const court = m.court && courtsById.get(m.court.id);
          if (!court) continue;
          const location = court.tournamentLocation && locationsById.get(court.tournamentLocation.id);
          if (!location || !location.name || location.name.indexOf(HOME_LOCATION_NAME) === -1) continue;

      const roundId = m.round && m.round.roundId;
          // roundId hat das Format "<groupId-Teil1>-<groupId-Teil2>-<Rundenindex>",
      // z.B. "1680627-0-2" - die ersten zwei Teile ergeben die groupId
      // ("1680627-0"), ueber die Konkurrenzname und Rundenname nachgeschlagen
      // werden.
      const groupId = roundId ? roundId.split('-').slice(0, 2).join('-') : null;
          const group = groupId ? groupsById.get(groupId) : null;
          const competition = group ? (group.name || '').trim() : '';
          const round = normalizeRoundName(roundId ? roundNameByRoundId.get(roundId) : '');

      const player1 = playerLabel(m.playersA);
          const player2 = playerLabel(m.playersB);
          const isFinished = !!m.isFinished;
          let winner = null;
          if (isFinished) {
                  if (m.matchWinner === 1) winner = player1;
                  else if (m.matchWinner === 2) winner = player2;
          }

      records.push({
              competition,
              round,
              player1,
              player2,
              winner,
              score: isFinished && m.result ? m.result : null,
              time: formatDeDateTime(m.scheduled),
              court: court.courtName,
      });
    }
    return records;
}

async function main() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ locale: 'de-DE' });

  console.log('Öffne', DATA_URL);
    const data = await loginAndFetch(page);
    const records = buildRecords(data);
    writeJSON('nuliga-live.json', records);
    console.log(`Fertig: ${records.length} Heimspiele aus nuLiga geschrieben.`);

  await browser.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
