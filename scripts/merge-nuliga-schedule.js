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

  // Bestehende tennis.de-Partien nach Spieler-Paar indizieren, damit wir
  // pro Paarung nachschauen koennen, ob (und mit welchem Stand) sie schon
  // im Spielplan steht. Die Reihenfolge player1/player2 kann zwischen den
  // Quellen abweichen, daher sortiert die Paar-Kennung beide Namen.
  const byPair = new Map();
  schedule.forEach((m) => {
    if (!m || !m.player1 || !m.player2) return;
    const key = pairKey(m.player1, m.player2);
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(m);
  });

  let filled = 0;
  let added = 0;

  nuliga.forEach((n) => {
    if (!n || !n.player1 || !n.player2) return; // Freilos/Platzhalter ohne beide Gegner ueberspringen
    if (n.winner) return; // bereits abgeschlossen - gehoert nicht in den offenen Spielplan
    if (!n.time && !n.court) return; // ohne Platz/Zeit bringt der Eintrag hier nichts

    const key = pairKey(n.player1, n.player2);
    const matches = byPair.get(key);

    if (matches && matches.length) {
      // Bereits bei tennis.de vorhanden - nur fehlende Platz-/Zeit-Angabe
      // ergaenzen, nichts ueberschreiben, was tennis.de schon selbst hat.
      matches.forEach((m) => {
        if (!m.time && n.time) { m.time = n.time; filled++; }
        if (!m.court && n.court) { m.court = n.court; }
      });
    } else {
      // Komplett neue Partie, die bei tennis.de (noch) nicht auftaucht -
      // aus nuLiga uebernehmen, damit sie im Spielplan nicht fehlt.
      schedule.push({
        competition: n.competition || '',
        round: n.round || '',
        player1: n.player1,
        player2: n.player2,
        winner: null,
        score: null,
        time: n.time || '',
        court: n.court || '',
        source: 'nuliga-merge',
      });
      added++;
    }
  });

  if (filled || added) {
    fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(schedule, null, 2) + '\n');
    console.log(`nuLiga-Merge: ${filled} Partie(n) ergaenzt, ${added} neue Partie(n) uebernommen.`);
  } else {
    console.log('nuLiga-Merge: keine Ergaenzungen noetig.');
  }
}

main();
