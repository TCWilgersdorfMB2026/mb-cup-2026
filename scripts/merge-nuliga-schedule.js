#!/usr/bin/env node
/**
 * Ergaenzt data/schedule.json um Partien, die auf tennis.de noch keinen
 * Platz/keine Uhrzeit haben oder dort komplett fehlen, aber in den
 * nuLiga-Live-Daten (data/nuliga-live.json, siehe scrape-nuliga-live.js)
 * bereits mit Platz/Uhrzeit vorhanden sind.
 *
 * tennis.de bleibt die alleinige Quelle fuer die Meldeliste (LK, Verein,
 * DTB-ID) und fuer bereits abgeschlossene Ergebnisse - hier werden
 * ausschliesslich noch offene (unentschiedene) Partien ergaenzt, die im
 * Spielplan (schedule.json) auftauchen sollen. Bereits gespielte nuLiga-
 * Partien (mit winner/score) werden bewusst NICHT hierher uebernommen,
 * da schedule.json nur fuer den anstehenden Spielplan gedacht ist.
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
        if (!m.time && n.time) { m.time = n.time; filled++; }
        if (!m.court && n.court) { m.court = n.court; }
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
    console.log(`nuLiga-Merge: ${filled} Partie(n) ergaenzt, ${added} neue Partie(n) uebernommen, ${skippedPlatzhalter} Platzhalter uebersprungen, ${removedDupes} Duplikat(e) entfernt.`);
  } else {
    console.log(`nuLiga-Merge: keine Ergaenzungen noetig (${skippedPlatzhalter} Platzhalter uebersprungen).`);
  }
}

main();

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
* Verein/LK bleiben davon unberuehrt weiterhin ausschliesslich von
* tennis.de (entrants.json) - nuLiga liefert dafuer keine Daten.
*/
function mergeResults() {
  const RESULTS_PATH = path.join(DATA_DIR, 'results.json');
  const CONFIRMED_PATH = path.join(DATA_DIR, 'nuliga-confirmed-results.json');
  const results = readJson(RESULTS_PATH, []);
  const nuliga = readJson(NULIGA_PATH, []);
  const confirmed = readJson(CONFIRMED_PATH, []);
  const compMap = buildCompetitionMap();

  if (!Array.isArray(results)) {
    console.log('data/results.json ist kein Array - Ergebnis-Merge uebersprungen.');
    return;
  }

  const confirmedKeys = new Set(confirmed.map(entryKey));
  let neuBestaetigt = 0;
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
      if (confirmedKeys.has(key)) return;
      confirmed.push(entry);
      confirmedKeys.add(key);
      neuBestaetigt++;
    });
  }
  if (neuBestaetigt) {
    fs.writeFileSync(CONFIRMED_PATH, JSON.stringify(confirmed, null, 2) + '\n');
  }

  const existingKeys = new Set(results.filter((m) => m && m.player1 && m.player2).map(entryKey));
  let added = 0;
  confirmed.forEach((entry) => {
    const key = entryKey(entry);
    if (existingKeys.has(key)) return;
    results.push(entry);
    existingKeys.add(key);
    added++;
  });

  if (added || neuBestaetigt) {
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + '\n');
  }
  console.log(`nuLiga-Ergebnis-Merge: ${neuBestaetigt} neu dauerhaft bestaetigt, ${added} in results.json ergaenzt.`);
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

