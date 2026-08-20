// MB-Cup 2026 – Turnierseite
// Lädt Daten aus /data/*.json und rendert sie. Läuft komplett clientseitig,
// kein Server nötig. Aktualisierung erfolgt, indem die JSON-Dateien im
// Repo überschrieben werden (siehe README).

const REFRESH_MS = 60 * 1000; // alle 60 Sekunden neu laden

function qs(id) { return document.getElementById(id); }

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

  // Formatiert das Speiseplan-"Tag"-Feld: seit Umstellung auf <input type="date">
  // in admin.html kommt hier ein ISO-Datum (YYYY-MM-DD) an, das wir wie
  // "Donnerstag, 30.07." darstellen. Aeltere Eintraege, die noch als freier
  // Text gespeichert wurden, werden unveraendert angezeigt.
  function fmtDay(day) {
        if (!day) return '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
        const d = new Date(day + 'T00:00:00');
        if (isNaN(d)) return day;
        return d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
  }
async function loadJSON(path) {
  try {
    const res = await fetch(path + '?t=' + Date.now());
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    console.warn('Konnte', path, 'nicht laden:', e);
    return null;
  }
}

// Liest ein oder mehrere Bilder aus einem Eintrag: entweder "images": [...]
// (mehrere Bilder, jedes optional als {src, width} mit width 1 = halbe
// Breite oder 2 = volle Breite - ältere Einträge mit einfachen Strings
// und/oder dem alten Feld "columns" werden weiterhin unterstützt) oder
// "image": "..." (ein einzelnes Bild, weiterhin unterstützt, immer volle
// Breite). Liefert immer ein Array von {src, width}, ggf. leer.
function imagesOf(entry) {
  if (Array.isArray(entry.images) && entry.images.length) {
    // Fallback-Breite für ältere Einträge ohne pro-Bild-Breite: aus dem
    // alten Feld "columns" ableiten (columns:1 = alle Bilder voll,
    // sonst/Standard = alle Bilder halb, wenn mehrere Bilder vorhanden).
    const fallbackWidth = entry.columns === 1 ? 2 : (entry.images.length > 1 ? 1 : 2);
    return entry.images.map((img) => {
      if (typeof img === 'string') return { src: img, width: fallbackWidth };
      const w = (img.width === 1 || img.width === 2) ? img.width : fallbackWidth;
      return { src: img.src, width: w };
    });
  }
  if (entry.image) return [{ src: entry.image, width: 2 }];
  return [];
}

// Baut eine kleine Bildergalerie in der Reihenfolge des "images"-Arrays.
// Die Breite (voll oder halb) ist pro Bild frei wählbar (siehe admin.html).
// Bilder werden nie zugeschnitten, sondern skalieren auf die volle Breite
// ihrer Spalte(n).
function galleryHtml(entry) {
  const imgs = imagesOf(entry);
  if (!imgs.length) return '';
  return `<div class="gallery">${imgs.map(({ src, width }) => `<img src="${escapeHtml(src)}" alt="" loading="lazy" class="w-${width}">`).join('')}</div>`;
}

function renderTicker(items) {
  const el = qs('ticker-list');
  if (!items || !items.length) { el.innerHTML = '<p class="empty">Noch keine Meldungen.</p>'; return; }
  const sorted = [...items].sort((a, b) => new Date(b.time) - new Date(a.time));
  el.innerHTML = sorted.map(it => `
    <div class="ticker-item">
      <span class="time">${fmtTime(it.time)}</span>${escapeHtml(it.text)}
      ${galleryHtml(it)}
    </div>`).join('');
}

// Reihenfolge, in der Runden innerhalb einer Konkurrenz angezeigt werden.
// Unbekannte/leere Rundennamen (z.B. bei Konkurrenzen ohne Tableau) landen
// einfach ans Ende, statt den Sortiervorgang zu verwirren.
const ROUND_ORDER = ['Runde 1', 'Sechzehntelfinale', 'Achtelfinale', 'Viertelfinale', 'Halbfinale', 'Finale'];

function namesMatch(a, b) {
  return (a || '').trim() && (a || '').trim() === (b || '').trim();
}

// Sucht die LK eines Spielers in den Meldelisten (state.entrants). Namen aus
// Spielplan/Ergebnissen kommen im Format "Nachname, Vorname" von tennis.de,
// Namen aus den Meldelisten (und manuellen Live-Eintraegen) im Format
// "Nachname Vorname" - deshalb wird zusaetzlich ohne Komma verglichen.
function findEntrant(rawName) {
  const name = (rawName || '').trim();
  if (!name) return null;
  const withoutComma = name.replace(/,\s*/, ' ');
  for (const block of state.entrants) {
    const hit = (block.entrants || []).find((p) => p.name === name || p.name === withoutComma);
    if (hit) return hit;
  }
  return null;
}

function formatPlayerName(rawName) {
  const name = (rawName || '').trim();
  if (!name) return name;
  const commaIdx = name.indexOf(',');
  if (commaIdx !== -1) {
    const last = name.slice(0, commaIdx).trim();
    const first = name.slice(commaIdx + 1).trim();
    return first ? last + ', ' + first : last;
  }
  const spaceIdx = name.indexOf(' ');
  if (spaceIdx === -1) return name;
  const last = name.slice(0, spaceIdx).trim();
  const first = name.slice(spaceIdx + 1).trim();
  return last + ', ' + first;
}

// tennis.de zeigt fuer eine Turnierbaum-Position, deren Gegner noch nicht
// feststeht (weil die zufuehrende Partie noch offen ist), manchmal einen
// Platzhalter-Text wie "Kamyab, Taymas / Hartmann, Nils" anstelle eines
// echten Namens (Bedeutung: "Sieger aus dieser noch offenen Partie"). Der
// nuLiga-Merge hat dagegen einen eigenen Schutz (siehe skippedPlatzhalter in
// scripts/merge-nuliga-schedule.js), direkt von tennis.de gescrapte
// Tableau-Eintraege aber nicht - dort landet der Platzhalter-Text 1:1 als
// (scheinbar dritter/vierter) Spielername in schedule.json. Diese Erkennung
// laeuft daher zusaetzlich beim Rendern und greift unabhaengig davon, ob
// bzw. wie oft tennis.de diesen Platzhalter liefert.
function isPendingPlaceholder(name) {
  return /\S\s*\/\s*\S/.test((name || '').trim());
}

function playerHtml(rawName) {
  const raw = rawName || '';
  if (isPendingPlaceholder(raw)) {
    return '<span class="pending-placeholder">Gegner steht noch nicht fest</span>';
  }
  const entrant = findEntrant(raw);
  const lk = entrant && entrant.lk;
  const club = entrant && entrant.club;
  let html = escapeHtml(formatPlayerName(raw)) + (lk ? ' (LK ' + escapeHtml(lk) + ')' : '');
  if (club) html += '<span class="player-club">' + escapeHtml(club) + '</span>';
  return html;
}

// Hält die zuletzt geladenen Daten und die aktuell im Dropdown gewählte
// Konkurrenz, damit ein Refresh (alle 60s) die Auswahl der Person nicht
// zurücksetzt und das Dropdown nicht bei jedem Tick neu aufgebaut werden muss.
const state = {
  schedule: [],
  results: [],
  entrants: [],
  selectedCompetition: null,
  selectedScheduleDay: null,
  scheduleDays: null,
  scheduleWithoutDate: [],
  resultsView: 'list',
};

// Liefert die Namen ALLER Konkurrenzen, die entweder Paarungen (Tableau)
// oder zumindest eine Meldeliste haben - in der Reihenfolge, in der sie
// zuerst auftauchen.
function listCompetitions() {
  const seen = new Set();
  const names = [];
  for (const m of [...state.results, ...state.schedule]) {
    if (m.competition && !seen.has(m.competition)) {
      seen.add(m.competition);
      names.push(m.competition);
    }
  }
  for (const c of state.entrants) {
    if (c.competition && (c.entrants || []).length && !seen.has(c.competition)) {
      seen.add(c.competition);
      names.push(c.competition);
    }
  }
  return names;
}

// Baut EIN Match-Kästchen im Tableau-Stil (wie tennis.de): beide Spielernamen
// übereinander, Sieger:in fett, Ergebnis darunter bzw. "Noch offen", plus
// Datum/Uhrzeit/Platz (falls vom Ausrichter in tennis.de hinterlegt - sonst
// bleibt diese Zeile einfach weg, keine Pflichtangabe).
function formatScore(raw) {
  const s = (raw || '').trim();
  if (!s) return s;
  return s.split(/\s+/).join(', ');
}

function bracketBoxHtml(m) {
const isFreilos = m.score === 'Freilos';
const p1Wins = (m.played || isFreilos) && namesMatch(m.player1, m.winner);
const p2Wins = m.played && namesMatch(m.player2, m.winner);
let resultHtml;
if (isFreilos) {
resultHtml = '<div class="bracket-freilos">Freilos – kommt kampflos weiter</div>';
} else if (m.played) {
resultHtml = `<div class="bracket-score">${escapeHtml(formatScore(m.score || ''))}</div>`;
} else {
resultHtml = '<div class="bracket-pending">Noch offen</div>';
}
const vorlaeufigHtml = '';
return `
<div class="bracket-box">
<div class="bracket-player${p1Wins ? ' winner' : ''}">${playerHtml(m.player1)}</div>
${m.player2 ? `<div class="bracket-player${p2Wins ? ' winner' : ''}">${playerHtml(m.player2)}</div>` : ''}
${resultHtml}
${vorlaeufigHtml}
${m.court ? `<div class="bracket-meta bracket-court">${displayCourt(m)}</div>` : ''}
${m.time ? `<div class="bracket-meta bracket-time">${escapeHtml(m.time)}</div>` : ''}
</div>`;
}

// Rendert eine Konkurrenz als Turnierbaum (Spalte pro Runde), analog zur
// tennis.de-Tableau-Ansicht. Nutzt CSS Grid mit exakter Zeilen-Zentrierung:
// ein Match in Runde r (0-indiziert) an Position i belegt "Sub-Zeilen"
// [i * 2^(r+1) + 1 .. + 2^(r+1)] - das entspricht immer genau der Zeilen-
// spanne seiner beiden Vorrunden-Matches, dadurch steht jede Box exakt
// mittig zwischen ihren beiden Zubringer-Matches. Setzt voraus, dass die
// erste angezeigte Runde ein sauberes 2er-Potenz-Tableau ohne Freilose ist
// (bei den bisher getesteten Konkurrenzen der Fall).
function renderBracket(matches) {
  const byRound = new Map();
  for (const m of matches) {
    const r = m.round || '';
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(m);
  }
  const roundsPresent = ROUND_ORDER.filter((r) => byRound.has(r));
  if (!roundsPresent.length) {
    return '<p class="empty">Für diese Konkurrenz liegen noch keine Paarungen vor.</p>';
  }

  const firstRoundCount = byRound.get(roundsPresent[0]).length;
  const totalSubrows = firstRoundCount * 2;

  const finaleMatches = byRound.get('Finale');
  const finaleDone = finaleMatches && finaleMatches.length === 1 && finaleMatches[0].winner;
  const columns = finaleDone ? [...roundsPresent, 'Sieger'] : roundsPresent;

  // Baut fuer jede Runde/Spalte einen eigenen HTML-Block. Die Reihenfolge, in
  // der diese Bloecke am Ende zusammengefuegt werden, bestimmt (in der
  // Liste-Ansicht, die per CSS zu einem einfachen vertikalen Block wird, siehe
  // .bracket-grid { display: block; } in style.css) die sichtbare Reihenfolge
  // von oben nach unten - deshalb wird die Blockliste vor dem Zusammenfuegen
  // umgedreht, damit die juengste Runde (Sieger/Finale) oben steht und Runde 1
  // unten. Die grid-column/-row-Werte je Block bleiben unveraendert (Struktur-
  // Index), sie werden in der Liste-Ansicht ohnehin ignoriert.
  const blocks = columns.map((roundName, colIdx) => {
    const col = colIdx + 1;
    let block = `<div class="bracket-col-header" style="grid-column:${col};grid-row:1;">${escapeHtml(roundName)}</div>`;

    if (roundName === 'Sieger') {
      block += `
        <div class="bracket-match bracket-champion" style="grid-column:${col};grid-row:2 / span ${totalSubrows};">
          <div class="bracket-box winner-box">${playerHtml(finaleMatches[0].winner)}</div>
        </div>`;
      return block;
    }

    const rowUnit = Math.pow(2, colIdx + 1);
    byRound.get(roundName).forEach((m, i) => {
      const rowStart = i * rowUnit + 2;
      block += `
        <div class="bracket-match" style="grid-column:${col};grid-row:${rowStart} / span ${rowUnit};">
          ${bracketBoxHtml(m)}
        </div>`;
    });
    return block;
  });

  const cells = blocks.slice().reverse().join('');

  return `
    <div class="bracket-wide">
      <div class="bracket-grid" style="grid-template-columns:repeat(${columns.length}, minmax(0, 1fr)); grid-template-rows:auto repeat(${totalSubrows}, minmax(26px, 1fr));">
        ${cells}
      </div>
    </div>`;
}
// Wimbledon-artige Turnierbaum-Ansicht: Runden als Spalten nebeneinander mit
// echten Verbindungslinien zwischen den Runden. Nur ueber den
// Liste/Turnierbaum-Umschalter erreichbar (Umschalter selbst ist per CSS auf
// Desktop beschraenkt, siehe @media in style.css).
function renderBracketTree(matches) {
  const byRound = new Map();
  for (const m of matches) {
    const r = m.round || '';
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(m);
  }
  const roundsPresent = ROUND_ORDER.filter((r) => byRound.has(r));
  if (!roundsPresent.length) {
    return '<p class="empty">Für diese Konkurrenz liegen noch keine Paarungen vor.</p>';
  }

  // Ab der ersten vorhandenen Runde wird die komplette restliche Kette bis zum
  // Finale angezeigt - auch wenn spaetere Runden noch nicht ausgelost/terminiert
  // sind. So ist die gesamte Turnierbaum-Struktur von Anfang an sichtbar; die
  // noch offenen Felder werden erst nach und nach mit echten Paarungen befuellt,
  // sobald tennis.de sie veroeffentlicht.
  const firstRoundCount = byRound.get(roundsPresent[0]).length;
  const totalSubrows = firstRoundCount * 2;

  // Wie viele Runden braucht es von der ersten angezeigten Runde bis zum
  // Finale? Das ergibt sich rein rechnerisch aus der Anzahl an Partien in
  // dieser ersten Runde (inkl. Freilose) - NICHT aus der Position von
  // roundsPresent[0] in ROUND_ORDER. Grund: tennis.de nennt die zuerst
  // gespielte Runde einer Konkurrenz immer "Runde 1", unabhaengig davon, wie
  // gross das Tableau tatsaechlich ist (ein 16er-Tableau startet also
  // ebenfalls bei "Runde 1" und geht danach direkt zum "Achtelfinale" weiter -
  // ganz ohne "Sechzehntelfinale" dazwischen). Ohne diese Korrektur wuerde bei
  // kleineren Tableaus faelschlich eine zusaetzliche, nie eintretende
  // Zwischenrunde eingefuegt, deren Kaestchen dauerhaft "Paarung / Termin /
  // Spielort noch offen" zeigen wuerden - selbst wenn das Turnier in
  // Wahrheit schon viel weiter ist.
  const finaleIdx = ROUND_ORDER.indexOf('Finale');
  const roundsNeeded = finaleIdx === -1 ? 1 : Math.round(Math.log2(firstRoundCount)) + 1;
  const laterCount = Math.max(0, roundsNeeded - 1);
  const roundsFull = finaleIdx === -1
    ? roundsPresent
    : [roundsPresent[0], ...ROUND_ORDER.slice(Math.max(0, finaleIdx - laterCount + 1), finaleIdx + 1).filter((r) => r !== roundsPresent[0])];

  const finaleMatches = byRound.get('Finale');
  const finaleDone = finaleMatches && finaleMatches.length === 1 && finaleMatches[0].winner;

  const columns = [...roundsFull, 'Sieger'];

  const colTemplate = columns
    .map((_, idx) => (idx === 0 ? 'minmax(380px, 1fr)' : '28px minmax(380px, 1fr)'))
    .join(' ');

  let cells = '';
  columns.forEach((roundName, colIdx) => {
    const col = colIdx === 0 ? 1 : colIdx * 2 + 1;
    const connectorCol = col - 1;
    const rowUnit = Math.pow(2, colIdx + 1);

    cells += `<div class="bt-col-header" style="grid-column:${col};grid-row:1;">${escapeHtml(roundName === 'Sieger' ? roundName : roundName)}</div>`;

    if (roundName === 'Sieger') {
      if (colIdx > 0) {
        cells += `<div class="bt-connector" style="grid-column:${connectorCol};grid-row:2 / span ${totalSubrows};"></div>`;
      }
      if (finaleDone) {
        cells += `
          <div class="bt-match bt-champion" style="grid-column:${col};grid-row:2 / span ${totalSubrows};">
            <div class="bracket-box winner-box">${escapeHtml(finaleMatches[0].winner)}</div>
          </div>`;
      } else {
        cells += `
          <div class="bt-match bt-champion" style="grid-column:${col};grid-row:2 / span ${totalSubrows};">
            <div class="bracket-box bt-placeholder">Sieger steht noch nicht fest</div>
          </div>`;
      }
      return;
    }

    const roundMatches = byRound.get(roundName);
    const expectedCount = Math.max(1, firstRoundCount / Math.pow(2, colIdx));

    if (colIdx > 0) {
      for (let i = 0; i < expectedCount; i++) {
        const rowStart = i * rowUnit + 2;
        cells += `<div class="bt-connector" style="grid-column:${connectorCol};grid-row:${rowStart} / span ${rowUnit};"></div>`;
      }
    }

    if (roundMatches && roundMatches.length) {
      roundMatches.forEach((m, i) => {
        const rowStart = i * rowUnit + 2;
        cells += `
          <div class="bt-match" style="grid-column:${col};grid-row:${rowStart} / span ${rowUnit};">
            ${bracketBoxHtml(m)}
          </div>`;
      });
    } else {
      for (let i = 0; i < expectedCount; i++) {
        const rowStart = i * rowUnit + 2;
        cells += `
          <div class="bt-match" style="grid-column:${col};grid-row:${rowStart} / span ${rowUnit};">
            <div class="bracket-box bt-placeholder">Paarung / Termin / Spielort noch offen</div>
          </div>`;
      }
    }
  });

  return `
    <div class="bt-wrap">
      <button type="button" class="bt-scroll-btn bt-scroll-left" aria-label="Turnierbaum nach links scrollen">&#8249;</button>
      <button type="button" class="bt-scroll-btn bt-scroll-right" aria-label="Turnierbaum nach rechts scrollen">&#8250;</button>
      <div class="bt-scroll">
        <div class="bt-grid" style="grid-template-columns:${colTemplate}; grid-template-rows:auto repeat(${totalSubrows}, minmax(34px, 1fr));">
          ${cells}
        </div>
      </div>
    </div>`;
}

// Verdrahtet die Scroll-Pfeil-Buttons oben links/rechts am Turnierbaum: ein
// Klick scrollt den Turnierbaum-Container (.bt-scroll) um ca. 80% seiner
// sichtbaren Breite nach links/rechts, damit man auf Desktop nicht per
// Trackpad/Scrollbalken durch viele Runden scrollen muss.
function setupBracketScrollButtons(container) {
  const wrap = container.querySelector('.bt-wrap');
  if (!wrap) return;
  const scrollEl = wrap.querySelector('.bt-scroll');
  const leftBtn = wrap.querySelector('.bt-scroll-left');
  const rightBtn = wrap.querySelector('.bt-scroll-right');
  if (!scrollEl || !leftBtn || !rightBtn) return;
  const amount = () => Math.max(240, scrollEl.clientWidth * 0.8);
  leftBtn.addEventListener('click', () => scrollEl.scrollBy({ left: -amount(), behavior: 'smooth' }));
  rightBtn.addEventListener('click', () => scrollEl.scrollBy({ left: amount(), behavior: 'smooth' }));
}

// Rendert die aktuell im Dropdown gewählte Konkurrenz: Turnierbaum, wenn
// bereits Paarungen existieren, sonst die gemeldeten Spieler:innen aus der
// Meldeliste (Auslosung steht noch aus).
function renderCompetitionDetail() {
  const el = qs('spiele-list');
  const viewToggle = qs('results-view-toggle');
  if (!state.selectedCompetition) {
    el.innerHTML = '<p class="empty">Wird vor Turnierstart eingepflegt.</p>';
    if (viewToggle) viewToggle.hidden = true;
    return;
  }
  const matches = [
    ...state.results.filter((m) => m.competition === state.selectedCompetition).map((m) => ({ ...m, played: true })),
    ...state.schedule.filter((m) => m.competition === state.selectedCompetition).map((m) => ({ ...m, played: false })),
  ];
  if (matches.length) {
    if (viewToggle) viewToggle.hidden = false;
    el.innerHTML = state.resultsView === 'bracket' ? renderBracketTree(matches) : renderBracket(matches);
    if (state.resultsView === 'bracket') setupBracketScrollButtons(el);
    return;
  }
  if (viewToggle) viewToggle.hidden = true;
  const entrantBlock = state.entrants.find((c) => c.competition === state.selectedCompetition);
  if (entrantBlock && entrantBlock.entrants.length) {
    el.innerHTML = `
      <p class="hint">Auslosung steht noch aus – gemeldete Spieler:innen:</p>
      <ul>${entrantBlock.entrants.map((p) => `<li>${escapeHtml(formatPlayerName(p.name || ''))}${p.club ? ' · ' + escapeHtml(p.club) : ''}${p.lk ? ' · LK' + escapeHtml(p.lk) : ''}</li>`).join('')}</ul>`;
    return;
  }
  el.innerHTML = '<p class="empty">Wird vor Turnierstart eingepflegt.</p>';
}

// Baut das Konkurrenzen-Dropdown auf (nur wenn sich die Liste geändert hat)
// und rendert danach die Detailansicht der ausgewählten Konkurrenz. Die
// Auswahl bleibt über einen Refresh hinweg erhalten, solange die Konkurrenz
// noch existiert.
function renderSpielplanErgebnisse(schedule, results, entrants) {
  state.schedule = schedule || [];
  state.results = results || [];
  state.entrants = entrants || [];

  const names = listCompetitions();
  const selectEl = qs('competition-select');

  if (!names.length) {
    selectEl.innerHTML = '<option value="">Keine Konkurrenzen</option>';
    state.selectedCompetition = null;
    renderCompetitionDetail();
  } else {
    if (!state.selectedCompetition || !names.includes(state.selectedCompetition)) {
      state.selectedCompetition = names[0];
    }
    selectEl.innerHTML = names
      .map((c) => `<option value="${escapeHtml(c)}"${c === state.selectedCompetition ? ' selected' : ''}>${escapeHtml(c)}</option>`)
      .join('');
    renderCompetitionDetail();
  }

  renderSpielplanOverview();
}

// Parst das Termin-Format, wie es der tennis.de-Scraper schreibt
// ("TT.MM.JJJJ" bzw. "TT.MM.JJJJ HH:MM Uhr") in ein sortierbares Date-Objekt.
// Liefert null, wenn kein Datum erkennbar ist (z.B. wenn tennis.de für diese
// Begegnung keinen Termin gepflegt hat).
function parseTerminDate(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min] = m;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd), hh ? Number(hh) : 0, min ? Number(min) : 0);
}

// Formatiert ein Date als sortierbaren Tages-Schlüssel ("2026-07-30") bzw.
// als lesbares Label ("Donnerstag, 30.07.2026") für das Tages-Dropdown.
function dayKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function dayLabelOf(date) {
  return date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Baut EINE Zeile des Spielplans: Platz und Uhrzeit vorne (Platz immer in
// eigener Zeile zuerst), dann Konkurrenz/Runde und Paarung. Bewusst OHNE
// Ergebnis/Sieger - der Spielplan zeigt, wer wann wo spielt, nicht wer
// gewonnen hat (das steht im "Ergebnisse"-Tab).
function scheduleRowHtml(m) {
const timePart = m._date
? m._date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
: '';
const playersHtml = m.player2
? `
<div class="schedule-player">${playerHtml(m.player1)}</div>
<div class="schedule-player">${playerHtml(m.player2)}</div>`
: `
<div class="schedule-player">${playerHtml(m.player1)}</div>
<div class="schedule-freilos">Freilos – kommt kampflos weiter</div>`;
return `
<div class="schedule-row">
<div class="schedule-when">
${m.court ? `<div class="schedule-court">${displayCourt(m)}</div>` : ''}
${timePart
? `<div class="schedule-time">${escapeHtml(timePart)}</div>`
: '<div class="schedule-time schedule-time-empty">Zeit offen</div>'}
</div>
<div class="schedule-match">
<div class="schedule-comp">${escapeHtml(m.competition || '')}</div>
${m.round ? `<div class="schedule-round">${escapeHtml(m.round)}</div>` : ''}
<div class="schedule-players">${playersHtml}
</div>
</div>
</div>`;
}

// Baut das Tages-Dropdown für den "Spielplan"-Tab auf: eine Option pro Tag,
// an dem laut Termin gespielt wird, plus ggf. "Termin noch offen" für
// Begegnungen ohne Datum. Startet immer beim heutigen Tag (falls an diesem
// Tag gespielt wird) - andere Tage (vergangen oder zukünftig) sind nur über
// das Dropdown erreichbar, damit man nicht durchs ganze Turnier scrollen muss.
function renderSpielplanOverview() {
  const selectEl = qs('spielplan-day-select');
  const el = qs('spielplan-list');
  if (!el || !selectEl) return;

  const all = [...state.results, ...state.schedule].map((m) => ({ ...m, _date: parseTerminDate(m.time) }));
  const withDate = all.filter((m) => m._date);
  const withoutDate = all.filter((m) => !m._date);

  const byDay = new Map();
  for (const m of withDate) {
    const key = dayKeyOf(m._date);
    if (!byDay.has(key)) byDay.set(key, { label: dayLabelOf(m._date), matches: [] });
    byDay.get(key).matches.push(m);
  }
  state.scheduleDays = byDay;
  state.scheduleWithoutDate = withoutDate;

  const dayKeys = Array.from(byDay.keys()).sort();
  const options = dayKeys.map((k) => ({ value: k, label: byDay.get(k).label }));
  if (withoutDate.length) {
    options.push({ value: '__none__', label: 'Termin noch offen' });
  }

  if (!options.length) {
    selectEl.innerHTML = '';
    state.selectedScheduleDay = null;
    el.innerHTML = '<p class="empty">Wird vor Turnierstart eingepflegt.</p>';
    return;
  }

  const todayKey = dayKeyOf(new Date());
  if (!state.selectedScheduleDay || !options.some((o) => o.value === state.selectedScheduleDay)) {
    state.selectedScheduleDay = options.some((o) => o.value === todayKey) ? todayKey : options[0].value;
  }

  selectEl.innerHTML = options
    .map((o) => `<option value="${escapeHtml(o.value)}"${o.value === state.selectedScheduleDay ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
    .join('');

  renderScheduleDay();
}

// Rendert NUR die Begegnungen des im Dropdown gewählten Tages, sortiert
// nach Uhrzeit.
function isHomeCourt(m) {
  return m.court ? /^Platz\s*\d+$/.test(m.court.trim()) : false;
}
function courtNumberOf(m) {
  const match = m.court ? /Platz\s*(\d+)/.exec(m.court) : null;
  return match ? parseInt(match[1], 10) : 999;
}
function displayCourt(m) {
  if (!m.court) return '';
  const raw = isHomeCourt(m) ? `TC Wilgersdorf, ${m.court}` : m.court;
  return raw.split(/,\s*/).map(escapeHtml).join('<br>');
}
function renderScheduleDay() {
  const el = qs('spielplan-list');
  if (!el) return;
  const day = state.selectedScheduleDay;
  if (!day) { el.innerHTML = '<p class="empty">Wird vor Turnierstart eingepflegt.</p>'; return; }

  const matches = day === '__none__'
    ? (state.scheduleWithoutDate || [])
    : ((state.scheduleDays && state.scheduleDays.get(day)) ? state.scheduleDays.get(day).matches : []);
  const sorted = [...matches].sort((a, b) => {
    if (a._date && b._date) {
      const diff = a._date - b._date;
      if (diff !== 0) return diff;
    }
    // Bei gleicher Uhrzeit: zuerst alle TCW-Heimplaetze (Platz 1-4), danach
    // die Auswaertsplaetze (z.B. Ludwigseck, Platz 1-4) - jeweils aufsteigend
    // nach Platznummer sortiert.
    const homeDiff = (isHomeCourt(a) ? 0 : 1) - (isHomeCourt(b) ? 0 : 1);
    if (homeDiff !== 0) return homeDiff;
    return courtNumberOf(a) - courtNumberOf(b);
  });

  if (!sorted.length) {
    el.innerHTML = '<p class="empty">Für diesen Tag liegen keine Begegnungen vor.</p>';
    return;
  }
  el.innerHTML = `<div class="schedule-rows">${sorted.map(scheduleRowHtml).join('')}</div>`;
}

function renderReports(items) {
  const el = qs('berichte-list');
  if (!items || !items.length) { el.innerHTML = '<p class="empty">Der erste Tagesbericht folgt nach Turnierstart.</p>'; return; }
  const sorted = [...items].sort((a, b) => new Date(b.date) - new Date(a.date));
  el.innerHTML = sorted.map(r => `
    <div class="report-item">
      <h3>${escapeHtml(r.title || '')}</h3>
      <div class="date">${fmtTime(r.date)}</div>
      ${galleryHtml(r)}
      <p>${escapeHtml(r.text || '')}</p>
    </div>`).join('');
}

// Liest Name + Bilder ({src,width}) eines Speiseplan-Gerichts. Unterstützt
// weiterhin ältere Einträge, bei denen "items" nur Strings (ohne Bild)
// enthält.
function dishOf(item) {
  if (typeof item === 'string') return { name: item, images: [] };
  const name = item.name || '';
  if (Array.isArray(item.images) && item.images.length) {
    const images = item.images.map((img) => {
      if (typeof img === 'string') return { src: img, width: 2 };
      const w = (img.width === 1 || img.width === 2) ? img.width : 2;
      return { src: img.src, width: w };
    });
    return { name, images };
  }
  if (item.image) return { name, images: [{ src: item.image, width: 2 }] };
  return { name, images: [] };
}

function dishHtml(item) {
  const { name, images } = dishOf(item);
  const gallery = images.length
    ? `<div class="gallery">${images.map(({ src, width }) => `<img src="${escapeHtml(src)}" alt="" loading="lazy" class="w-${width}">`).join('')}</div>`
    : '';
  return `<li>${escapeHtml(name)}${gallery}</li>`;
}

function renderMenu(days) {
  const el = qs('speiseplan-list');
  if (!days || !days.length) { el.innerHTML = '<p class="empty">Speiseplan wird noch veröffentlicht.</p>'; return; }
  el.innerHTML = days.map(d => `
    <div class="menu-day">
      <h3>${escapeHtml(fmtDay(d.day))}</h3>
      <ul class="dish-list">${(d.items || []).map(dishHtml).join('')}</ul>
    </div>`).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Manuelle Korrekturen fuer Faelle, in denen der automatische tennis.de/
// nuLiga-Scrape veraltete oder falsche Paarungen liefert (z.B. weil ein
// Spieler nicht angetreten ist, oder weil nuLiga eine Finale-/Halbfinale-
// Platzhalter-Paarung mit bereits ausgeschiedenen Spieler:innen erzeugt).
// Wird bei JEDEM Laden aus data/match-overrides.json angewendet - ueberlebt
// also automatische Re-Scrapes, statt nur einmalig die JSON-Dateien zu
// patchen. Siehe data/match-overrides.json fuer die aktuell gepflegten
// Regeln; Eintraege koennen entfernt werden, sobald tennis.de/nuLiga die
// zugrunde liegenden Daten selbst korrekt fuehrt (dann greifen die Regeln
// einfach nicht mehr, da kein passender Eintrag mehr gefunden wird).
function applyMatchOverrides(schedule, results, overrides) {
  if (!overrides) return { schedule, results };

  const isMatch = (m, competition, round, p1, p2) => {
    if (m.competition !== competition || m.round !== round) return false;
    const a = (m.player1 || '').trim();
    const b = (m.player2 || '').trim();
    return (a === p1 && b === p2) || (a === p2 && b === p1);
  };

  let newSchedule = [...schedule];
  let newResults = [...results];

  for (const rule of overrides.resolvedMatches || []) {
    const { competition, round, player1, player2, winner, score } = rule;
    newSchedule = newSchedule.filter((m) => !isMatch(m, competition, round, player1, player2));
    const alreadyDecided = newResults.some((m) => isMatch(m, competition, round, player1, player2) && m.winner);
    if (!alreadyDecided) {
      newResults = newResults.filter((m) => !isMatch(m, competition, round, player1, player2));
      newResults = [...newResults, { competition, round, player1, player2, winner, score, time: '', court: '' }];
    }
  }

  for (const rule of overrides.eliminatedPlayers || []) {
    const { competition, player, afterRound } = rule;
    const afterIdx = ROUND_ORDER.indexOf(afterRound);
    newSchedule = newSchedule.filter((m) => {
      if (m.winner) return true; // reale Freilos-Eintraege unangetastet lassen
      if (m.competition !== competition) return true;
      const mIdx = ROUND_ORDER.indexOf(m.round || '');
      if (afterIdx === -1 || mIdx === -1 || mIdx <= afterIdx) return true;
      const isPlayer = namesMatch(m.player1, player) || namesMatch(m.player2, player);
      return !isPlayer;
    });
  }

    for (const rule of overrides.removedSchedule || []) {
    const { competition, round, player1, player2 } = rule;
    newSchedule = newSchedule.filter((m) => !isMatch(m, competition, round, player1, player2));
  }

  return { schedule: newSchedule, results: newResults };
}

async function refreshAll() {
  const [ticker, schedule, results, reports, menu, entrants, overrides] = await Promise.all([
    loadJSON('data/ticker.json'),
    loadJSON('data/schedule.json'),
    loadJSON('data/results.json'),
    loadJSON('data/reports.json'),
    loadJSON('data/menu.json'),
    loadJSON('data/entrants.json'),
    loadJSON('data/match-overrides.json'),
  ]);
  const corrected = applyMatchOverrides(schedule || [], results || [], overrides);
  renderTicker(ticker);
  renderSpielplanErgebnisse(corrected.schedule, corrected.results, entrants);
  renderReports(reports);
  renderMenu(menu);
  qs('last-updated').textContent = 'Zuletzt aktualisiert: ' + new Date().toLocaleTimeString('de-DE');
}

function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      qs(btn.dataset.tab).classList.add('active');
    });
  });
}

function setupCompetitionSelect() {
  qs('competition-select').addEventListener('change', (e) => {
    state.selectedCompetition = e.target.value;
    renderCompetitionDetail();
  });
}

function setupResultsViewToggle() {
  const toggle = qs('results-view-toggle');
  if (!toggle) return;
  const buttons = toggle.querySelectorAll('.view-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.resultsView = btn.dataset.view;
      buttons.forEach((b) => b.classList.toggle('active', b === btn));
      renderCompetitionDetail();
    });
  });
}

function setupSpielplanDaySelect() {
  const el = qs('spielplan-day-select');
  if (!el) return;
  el.addEventListener('change', (e) => {
    state.selectedScheduleDay = e.target.value;
    renderScheduleDay();
  });
}

setupTabs();
setupCompetitionSelect();
setupResultsViewToggle();
setupSpielplanDaySelect();
refreshAll();
setInterval(refreshAll, REFRESH_MS);

// Meldet die aktuelle Inhaltshöhe per postMessage ans einbettende
// Elternfenster (z.B. das Wix-iframe), damit die Einbettung dort dynamisch
// mitwachsen kann - man muss dann nicht mehr innerhalb der Box zusätzlich
// scrollen, sondern die ganze Wix-Seite (inkl. Footer) wächst mit. Läuft
// harmlos ins Leere, wenn die Seite gerade nicht eingebettet ist.
function reportHeightToParent() {
  if (window.parent === window) return; // nicht eingebettet, z.B. Vorschau-Seiten
  const h = document.documentElement.scrollHeight;
  window.parent.postMessage({ type: 'mbcup-resize', height: h }, '*');
}
window.addEventListener('load', reportHeightToParent);
window.addEventListener('resize', reportHeightToParent);
if (window.ResizeObserver) {
  new ResizeObserver(reportHeightToParent).observe(document.body);
} else {
  setInterval(reportHeightToParent, 1000);
}
