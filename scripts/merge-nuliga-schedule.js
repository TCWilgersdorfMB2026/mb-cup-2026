#!/usr/bin/env node
/**
 * nuLiga ist die massgebliche Quelle fuer den aktuellen Turnierstand:
 * Termin/Platz einer Partie im Spielplan (data/schedule.json) und wer
 * eine Partie gewonnen hat samt Ergebnis (data/results.json) - sobald
 * nuLiga (data/nuliga-live.json, siehe scrape-nuliga-live.js) dazu Daten
 * liefert, haben diese Vorrang vor tennis.de.
 *
 * tennis.de bleibt weiterhin die alleinige Quelle fuer die Meldeliste
 * (LK, Verein, DTB-ID, siehe entrants.json) und dient hier nur noch als
 * Fallback: Termin/Platz/Ergebnis aus dem tennis.de-Tableau werden
 * verwendet, solange nuLiga zu einer Partie noch nichts zeigt (z.B. weil
 * die Partie dort noch nicht auftaucht, oder bei einem Ausfall des
 * nuLiga-Scrapers) - sobald nuLiga Daten zu dieser Partie liefert, wird
 * die tennis.de-Angabe ueberschrieben bzw. ersetzt.
 *
 * Die Live-Anzeige (live-display.html / assets/live.js) nutzt weiterhin
 * ausschliesslich nuLiga direkt und ist von diesem Merge unabhaengig.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCHEDULE_PATH = path.join(DATA_DIR, 'schedule.json');
const NULIGA_PATH = path.join(DATA_DIR, 'nuliga-live.json');
const RESULTS_PATH = path.join(DATA_DIR, 'results.json');

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function normName(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pairKey(a, b) {
  return [normName(a), normName(b)].sort().join('||');
}

function normComp(s) {
  return (s || '').replace(/\bKO\s+/g, '').replace(/LK\s+/g, 'LK').replace(/\s+/g, ' ').trim();
}

function buildCompetitionMap() {
  const lists = [readJson(SCHEDULE_PATH, []), readJson(RESULTS_PATH, [])];
  const map = new Map();
  lists.forEach((list) => {
    (list || []).forEach((m) => {
      if (!m || !m.competition || m.source) return;
      const key = normComp(m.competition);
      if (!map.has(key)) map.set(key, m.competition);
    });
  });
  return map;
}


function entryKey(m) {
  return [m.competition || '', m.round || '', m.player1 || '', m.player2 || ''].join('||');
}

function compPairKey(m) {
  return [normComp(m.competition || ''), pairKey(m.player1, m.player2)].join('||');
}

function main() {
  const schedule = readJson(SCHEDULE_PATH, []);
  const nuliga = readJson(NULIGA_PATH, []);
  const compMap = buildCompetitionMap();

  if (!Array.isArray(schedule)) {
    console.log('data/schedule.json ist kein Array - Merge uebersprungen.');
    return;
  }
  if (!Array.isArray(nuliga) || !nuliga.length) {
    console.log('Keine nuLiga-Daten gefunden - kein Merge noetig.');
    return;
  }

  const byPair = new Map();
  schedule.forEach((m) => {
    if (!m || !m.player1 || !m.player2) return;
    const key = pairKey(m.player1, m.player2);
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(m);
  });

  let filled = 0;
  let added = 0;
  let skippedPlatzhalter = 0;

  nuliga.forEach((n) => {
    if (!n || !n.player1 || !n.player2) return; // Freilos/Platzhalter ohne beide Gegner ueberspringen
    if (n.winner) return; // bereits abgeschlossen - gehoert nicht in den offenen Spielplan
    if (!n.time && !n.court) return; // ohne Platz/Zeit bringt der Eintrag hier nichts

    // nuLiga zeigt fuer noch nicht feststehende Paarungen manchmal
    // Platzhalter wie "Spieler A / Spieler B" (= "Sieger aus einer noch
    // offenen Partie"). Solche Platzhalter enthalten "/" im Namen und
    // sind KEINE echten, bestaetigten Spielernamen - diese duerfen nicht
    // als eigene Partie in den Spielplan uebernommen werden.
    if (n.player1.includes('/') || n.player2.includes('/')) {
      skippedPlatzhalter++;
      return;
    }

    const key = pairKey(n.player1, n.player2);
    const matches = byPair.get(key);

    if (matches && matches.length) {
      matches.forEach((m) => {
        // nuLiga ist die massgebliche Quelle fuer Termin/Platz einer
        // bereits vorhandenen Spielplan-Partie - ein vorhandener
        // tennis.de-Wert wird ueberschrieben, sobald nuLiga eine
        // abweichende/aktuellere Angabe liefert (nicht nur, wenn er
        // komplett fehlt). tennis.de bleibt nur so lange massgeblich,
        // wie nuLiga zu dieser Partie noch nichts zeigt.
        let aktualisiert = false;
        if (n.time && m.time !== n.time) { m.time = n.time; aktualisiert = true; }
        if (n.court && m.court !== n.court) { m.court = n.court; aktualisiert = true; }
        if (aktualisiert) filled++;
      });
    } else {
      const newEntry = {
        competition: compMap.get(normComp(n.competition)) || n.competition || '',
        round: n.round || '',
        player1: n.player1,
        player2: n.player2,
        winner: null,
        score: null,
        time: n.time || '',
        court: n.court || '',
        source: 'nuliga-merge',
      };
      schedule.push(newEntry);
      byPair.set(key, [newEntry]); // verhindert Duplikate innerhalb desselben Laufs
      added++;
    }
  });

  // Sicherheitsnetz: exakte Duplikate (gleiche Konkurrenz/Runde/Spieler)
  // koennen nicht doppelt im Spielplan stehen.
  const seen = new Set();
  const deduped = schedule.filter((m) => {
    const k = entryKey(m);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const removedDupes = schedule.length - deduped.length;

  if (filled || added || removedDupes) {
    fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(deduped, null, 2) + '\n');
    console.log(`nuLiga-Merge: ${filled} Partie(n) mit nuLiga-Termin/Platz aktualisiert, ${added} neue Partie(n) uebernommen, ${skippedPlatzhalter} Platzhalter uebersprungen, ${removedDupes} Duplikat(e) entfernt.`);
  } else {
    console.log(`nuLiga-Merge: keine Ergaenzungen noetig (${skippedPlatzhalter} Platzhalter uebersprungen).`);
  }
}

main();

// Konkurrenz-Runden-Reihenfolge, um zu erkennen, ob eine offene Spielplan-
// Paarung durch eine sichere, aus nuLiga ablesbare Erkenntnis "Spieler ist
// dort schon weiter" ueberholt (superseded) ist. Eigene Kopie der Liste
// aus assets/app.js (ROUND_ORDER) - dieses Skript laeuft serverseitig unter
// Node und hat keinen Zugriff auf den Browser-Code.
const ROUND_ORDER = ['Runde 1', '1. Runde', 'Sechzehntelfinale', 'Achtelfinale', 'Viertelfinale', 'Halbfinale', 'Finale'];
function roundIdx(r) { return ROUND_ORDER.indexOf(r || ''); }

/**
 * Entfernt aus data/schedule.json offene (noch nicht entschiedene)
 * Paarungen, bei denen einer der beiden Spieler laut nuLiga
 * (data/nuliga-live.json) bereits in einer SPAETEREN Runde derselben
 * Konkurrenz auftaucht - egal ob diese spaetere Partie schon entschieden
 * ist oder selbst noch offen ist. Ein Spieler kann nicht gleichzeitig in
 * zwei Runden aktiv sein: eine fruehere, noch offene Paarung ist in diesem
 * Fall ein veralteter tennis.de-Tableau-Eintrag (typischerweise, weil der
 * Gegner kampflos/durch Aufgabe weitergekommen ist und tennis.de die
 * Ur-Partie nie als beendet markiert hat).
 *
 * Ersetzt die bisherige Praxis, jeden Einzelfall manuell als
 * "removedSchedule"-Regel in data/match-overrides.json einzutragen (siehe
 * dort: Wagner/Nies, Schmelzeisen/Hussing) - solche Faelle werden ab jetzt
 * automatisch erkannt und bereinigt, unabhaengig vom genauen Spielernamen.
 */
function removeSupersededSchedule() {
  const schedule = readJson(SCHEDULE_PATH, []);
  const nuliga = readJson(NULIGA_PATH, []);
  if (!Array.isArray(schedule) || !schedule.length) return;
  if (!Array.isArray(nuliga) || !nuliga.length) return;

  const compMap = buildCompetitionMap();

  // Hoechste Runde, die ein Spieler laut nuLiga in einer Konkurrenz bereits
  // erreicht hat (Platzhalter-Paarungen mit "/" im Namen werden ignoriert,
  // da sie keine echten Spieler sind).
  const reached = new Map(); // key: competition||spieler -> hoechster roundIdx

  nuliga.forEach((n) => {
    if (!n || !n.player1 || !n.player2) return;
    if (n.player1.includes('/') || n.player2.includes('/')) return;
    const competition = compMap.get(normComp(n.competition)) || n.competition || '';
    const r = roundIdx(n.round);
    if (r === -1) return;
    [n.player1, n.player2].forEach((p) => {
      const key = competition + '||' + normName(p);
      const prev = reached.get(key);
      if (prev === undefined || r > prev) reached.set(key, r);
    });
  });

  const filtered = schedule.filter((m) => {
    if (!m || m.winner) return true; // nur offene Paarungen pruefen
    if (!m.player1 || !m.player2) return true; // Freilos-Platzhalter unangetastet lassen
    const mIdx = roundIdx(m.round);
    if (mIdx === -1) return true;
    for (const p of [m.player1, m.player2]) {
      const key = m.competition + '||' + normName(p);
      const r = reached.get(key);
      if (r !== undefined && r > mIdx) return false; // Spieler ist laut nuLiga schon weiter - Eintrag veraltet
    }
    return true;
  });

  const removed = schedule.length - filtered.length;
  if (removed) {
    fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(filtered, null, 2) + '\n');
    console.log(`Automatische Bereinigung: ${removed} veraltete Spielplan-Paarung(en) entfernt (Spieler laut nuLiga bereits in spaeterer Runde).`);
  } else {
    console.log('Automatische Bereinigung: keine veralteten Spielplan-Paarungen gefunden.');
  }
}
removeSupersededSchedule();

/**
* Uebernimmt von nuLiga als beendet gemeldete Partien (winner/score
* gesetzt) DAUERHAFT in data/results.json - im Gegensatz zur alten
* "vorlaeufig"-Logik werden diese Eintraege nicht mehr bei jedem Lauf
* verworfen und aus den aktuellen nuLiga-Daten neu aufgebaut.
*
* Grund: scrape-tennis-de.js (laeuft VOR diesem Skript, siehe
* update-data.yml) schreibt results.json bei JEDEM Lauf komplett neu
* aus dem tennis.de-Tableau - ein rein "vorlaeufiger" nuLiga-Eintrag
* wuerde sonst schon vor dem naechsten Merge-Lauf wieder verschwinden,
* sobald tennis.de das Ergebnis noch nicht selbst nachgezogen hat.
*
* Deshalb werden von nuLiga bestaetigte Ergebnisse zusaetzlich in
* data/nuliga-confirmed-results.json gesammelt - dieser Speicher wird
* nur ergaenzt, nie von scrape-tennis-de.js ueberschrieben, und bleibt
* damit ueber beliebig viele Pipeline-Laeufe hinweg erhalten. Bei jedem
* Lauf wird zunaechst aus nuliga-live.json neu dazugekommenes in diesen
* Speicher aufgenommen und anschliessend alles daraus, was noch nicht
* in results.json steht, dort ergaenzt (kein "vorlaeufig"-Flag mehr -
* das Ergebnis gilt sofort als endgueltig).
*
* nuLiga gilt dabei als massgeblich: ein von tennis.de gemeldetes Ergebnis
* fuer dieselbe Paarung (gleiche Konkurrenz + Spielerpaar, unabhaengig von
* ggf. abweichender Rundenbezeichnung) wird verworfen, sobald nuLiga
* dieselbe Partie bestaetigt hat - tennis.de bleibt nur so lange
* massgeblich, wie nuLiga zu dieser Paarung noch keine Bestaetigung hat
* (z.B. bei einem Ausfall des nuLiga-Scrapers). Aendert sich ein bereits
* von nuLiga bestaetigtes Ergebnis nachtraeglich (z.B. Korrektur), wird
* der bestehende Eintrag in results.json entsprechend aktualisiert.
*
* Verein/LK bleiben davon unberuehrt weiterhin ausschliesslich von
* tennis.de (entrants.json) - nuLiga liefert dafuer keine Daten.
*/
function mergeResults() {
  const RESULTS_PATH = path.join(DATA_DIR, 'results.json');
  const CONFIRMED_PATH = path.join(DATA_DIR, 'nuliga-confirmed-results.json');
  let results = readJson(RESULTS_PATH, []);
  const nuliga = readJson(NULIGA_PATH, []);
  const confirmed = readJson(CONFIRMED_PATH, []);
  const compMap = buildCompetitionMap();

  if (!Array.isArray(results)) {
    console.log('data/results.json ist kein Array - Ergebnis-Merge uebersprungen.');
    return;
  }

  // Map statt reinem Set, damit eine nachtraegliche Korrektur eines bereits
  // bestaetigten Ergebnisses (z.B. falscher Score wurde von nuLiga
  // spaeter berichtigt) erkannt und im Speicher aktualisiert wird - ein
  // reiner Vorhanden-Check auf entryKey (ohne Score/Sieger) wuerde das
  // sonst uebersehen, weil sich entryKey bei einer Korrektur nicht
  // aendert.
  const confirmedMap = new Map(confirmed.map((entry) => [entryKey(entry), entry]));
  let neuBestaetigt = 0;
  let nachtraeglichKorrigiert = 0;
  if (Array.isArray(nuliga)) {
    nuliga.forEach((n) => {
      if (!n || !n.player1 || !n.player2 || !n.winner) return;
      if (n.player1.includes('/') || n.player2.includes('/')) return;
      const competition = compMap.get(normComp(n.competition)) || n.competition || '';
      const entry = {
        competition,
        round: n.round || '',
        player1: n.player1,
        player2: n.player2,
        winner: n.winner,
        score: n.score || '',
        time: n.time || '',
        court: n.court || '',
        source: 'nuliga-live',
      };
      const key = entryKey(entry);
      const existing = confirmedMap.get(key);
      if (!existing) {
        confirmed.push(entry);
        confirmedMap.set(key, entry);
        neuBestaetigt++;
      } else if (
        existing.score !== entry.score || existing.winner !== entry.winner ||
        existing.time !== entry.time || existing.court !== entry.court
      ) {
        Object.assign(existing, entry);
        nachtraeglichKorrigiert++;
      }
    });
  }
  if (neuBestaetigt || nachtraeglichKorrigiert) {
    fs.writeFileSync(CONFIRMED_PATH, JSON.stringify(confirmed, null, 2) + '\n');
  }

  // nuLiga ist massgeblich: ein tennis.de-Ergebnis fuer dieselbe Paarung
  // (Konkurrenz + Spielerpaar) wird verworfen, sobald nuLiga diese Partie
  // bestaetigt hat. Eigene, in einem frueheren Lauf eingefuegte
  // nuliga-live-Eintraege werden hier nicht angefasst.
  const confirmedPairKeys = new Set(confirmed.map(compPairKey));
  let ersetzt = 0;
  results = results.filter((m) => {
    if (!m || !m.player1 || !m.player2) return true;
    if (m.source === 'nuliga-live') return true;
    if (confirmedPairKeys.has(compPairKey(m))) { ersetzt++; return false; }
    return true;
  });

  let added = 0;
  let aktualisiert = 0;
  confirmed.forEach((entry) => {
    const key = entryKey(entry);
    const idx = results.findIndex((m) => m && entryKey(m) === key);
    if (idx === -1) {
      results.push(entry);
      added++;
    } else if (
      results[idx].source === 'nuliga-live' &&
      (results[idx].score !== entry.score || results[idx].winner !== entry.winner ||
        results[idx].time !== entry.time || results[idx].court !== entry.court)
    ) {
      results[idx] = entry;
      aktualisiert++;
    }
  });

  if (added || neuBestaetigt || ersetzt || aktualisiert) {
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + '\n');
  }
  console.log(`nuLiga-Ergebnis-Merge: ${neuBestaetigt} neu dauerhaft bestaetigt, ${nachtraeglichKorrigiert} nachtraeglich korrigiert, ${ersetzt} abweichende tennis.de-Eintraege durch nuLiga ersetzt, ${added} in results.json ergaenzt, ${aktualisiert} aktualisiert.`);
}
mergeResults();

/**
 * Entfernt aus data/schedule.json alle Partien, die laut data/results.json
 * bereits entschieden sind (gleiche Spielerpaarung) - unabhaengig davon, ob
 * Konkurrenz/Runde exakt uebereinstimmen (Absicherung gegen abweichende
 * Rundenbezeichnungen zwischen nuLiga und tennis.de).
 *
 * Hintergrund/Bug, den das behebt: mergeResults() (oben) schreibt ein
 * vorlaeufiges Ergebnis nach results.json, sobald nuLiga eine Partie als
 * beendet meldet - entfernt aber die zugehoerige "noch offene" Partie
 * NICHT aus schedule.json. Ohne diese Bereinigung erscheint dieselbe
 * Paarung doppelt auf der Seite: einmal als (vorlaeufiges) Ergebnis,
 * einmal als noch offen mit ggf. veralteten Platz-/Zeitangaben von
 * tennis.de.
 */
function removeDecidedFromSchedule() {
  const schedule = readJson(SCHEDULE_PATH, []);
  const results = readJson(RESULTS_PATH, []);
  if (!Array.isArray(schedule) || !schedule.length) return;
  if (!Array.isArray(results) || !results.length) return;

  const decided = results.filter((m) => m && m.player1 && m.player2);
  const decidedEntryKeys = new Set(decided.map(entryKey));
  const decidedCompPairKeys = new Set(decided.map(compPairKey));

  const filtered = schedule.filter((m) => {
    if (!m) return true;
    if (decidedEntryKeys.has(entryKey(m))) return false;
    if (m.player1 && m.player2 && decidedCompPairKeys.has(compPairKey(m))) return false;
    return true;
  });

  const removed = schedule.length - filtered.length;
  if (removed) {
    fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(filtered, null, 2) + '\n');
    console.log(`Spielplan-Bereinigung: ${removed} bereits entschiedene Partie(n) aus schedule.json entfernt (Duplikat zu results.json).`);
  } else {
    console.log('Spielplan-Bereinigung: keine bereits entschiedenen Duplikate im Spielplan gefunden.');
  }
}
removeDecidedFromSchedule();
