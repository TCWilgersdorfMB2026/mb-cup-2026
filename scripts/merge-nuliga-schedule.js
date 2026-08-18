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

function entryKey(m) {
  return [m.competition || '', m.round || '', m.player1 || '', m.player2 || ''].join('||');
}

function main() {
  const schedule = readJson(SCHEDULE_PATH, []);
  const nuliga = readJson(NULIGA_PATH, []);

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
        competition: n.competition || '',
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
* Ergaenzt data/results.json um bereits abgeschlossene Partien, die nuLiga
* schon als beendet meldet (winner/score gesetzt), tennis.de aber noch nicht
* hat. Hintergrund: nuLiga und tennis.de werden von derselben Person
* gepflegt, oft aber nicht zur exakt gleichen Zeit - je nachdem, was zuerst
* eingetragen wird, soll die Seite immer den aktuellsten bekannten Stand
* zeigen statt auf die jeweils andere Quelle zu warten.
*
* Solche Ergaenzungen werden klar als "source: nuliga-live" + "vorlaeufig:
* true" markiert (siehe assets/app.js, bracketBoxHtml), damit erkennbar
* bleibt, dass tennis.de dieses Ergebnis noch nicht selbst bestaetigt hat.
*
* Bei jedem Lauf werden zunaechst ALLE zuvor so ergaenzten Eintraege
* entfernt und aus den aktuellen nuLiga-Daten neu aufgebaut - ein
* vorlaeufiger Eintrag verschwindet dadurch automatisch von selbst,
* sobald scrape-tennis-de.js (das VOR diesem Skript laeuft, siehe
* update-data.yml) das echte Ergebnis von tennis.de in results.json
* geschrieben hat.
*/
function mergeResults() {
  const RESULTS_PATH = path.join(DATA_DIR, 'results.json');
  const results = readJson(RESULTS_PATH, []);
  const nuliga = readJson(NULIGA_PATH, []);
  if (!Array.isArray(results)) {
    console.log('data/results.json ist kein Array - Ergebnis-Merge uebersprungen.');
    return;
  }
  if (!Array.isArray(nuliga) || !nuliga.length) {
    return;
  }
  const officialKeys = new Set(
    results.filter((m) => m && m.player1 && m.player2 && !m.vorlaeufig).map(entryKey)
    );
  const base = results.filter((m) => !(m && m.vorlaeufig));
  let added = 0;
  nuliga.forEach((n) => {
    if (!n || !n.player1 || !n.player2 || !n.winner) return;
    if (n.player1.includes('/') || n.player2.includes('/')) return;
    const key = entryKey(n);
    if (officialKeys.has(key)) return;
    base.push({
      competition: n.competition || '',
      round: n.round || '',
      player1: n.player1,
      player2: n.player2,
      winner: n.winner,
      score: n.score || '',
      time: n.time || '',
      court: n.court || '',
      source: 'nuliga-live',
      vorlaeufig: true,
    });
    added++;
  });
  if (added || base.length !== results.length) {
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(base, null, 2) + '\n');
    console.log(`nuLiga-Ergebnis-Merge: ${added} vorlaeufige(s) Ergebnis(se) aus nuLiga uebernommen.`);
  } else {
    console.log('nuLiga-Ergebnis-Merge: keine Ergaenzungen noetig.');
  }
}
mergeResults();
