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

function renderTicker(items) {
  const el = qs('ticker-list');
  if (!items || !items.length) { el.innerHTML = '<p class="empty">Noch keine Meldungen.</p>'; return; }
  const sorted = [...items].sort((a, b) => new Date(b.time) - new Date(a.time));
  el.innerHTML = sorted.map(it => `
    <div class="ticker-item">
      <span class="time">${fmtTime(it.time)}</span>${escapeHtml(it.text)}
    </div>`).join('');
}

// Reihenfolge, in der Runden innerhalb einer Konkurrenz angezeigt werden.
// Unbekannte/leere Rundennamen (z.B. bei Konkurrenzen ohne Tableau) landen
// einfach ans Ende, statt den Sortiervorgang zu verwirren.
const ROUND_ORDER = ['Sechzehntelfinale', 'Achtelfinale', 'Viertelfinale', 'Halbfinale', 'Finale'];

function namesMatch(a, b) {
  return (a || '').trim() && (a || '').trim() === (b || '').trim();
}

// Hält die zuletzt geladenen Daten und die aktuell im Dropdown gewählte
// Konkurrenz, damit ein Refresh (alle 60s) die Auswahl der Person nicht
// zurücksetzt und das Dropdown nicht bei jedem Tick neu aufgebaut werden muss.
const state = { schedule: [], results: [], entrants: [], selectedCompetition: null };

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
    if (c.competition && !seen.has(c.competition)) {
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
function bracketBoxHtml(m) {
  const p1Wins = m.played && namesMatch(m.player1, m.winner);
  const p2Wins = m.played && namesMatch(m.player2, m.winner);
  return `
    <div class="bracket-box">
      <div class="bracket-player${p1Wins ? ' winner' : ''}">${escapeHtml(m.player1 || '')}</div>
      <div class="bracket-player${p2Wins ? ' winner' : ''}">${escapeHtml(m.player2 || '')}</div>
      ${m.played ? `<div class="bracket-score">${escapeHtml(m.score || '')}</div>` : '<div class="bracket-pending">Noch offen</div>'}
      ${m.court ? `<div class="bracket-meta bracket-court">${escapeHtml(m.court)}</div>` : ''}
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

  let cells = '';
  columns.forEach((roundName, colIdx) => {
    const col = colIdx + 1;
    cells += `<div class="bracket-col-header" style="grid-column:${col};grid-row:1;">${escapeHtml(roundName)}</div>`;

    if (roundName === 'Sieger') {
      cells += `
        <div class="bracket-match bracket-champion" style="grid-column:${col};grid-row:2 / span ${totalSubrows};">
          <div class="bracket-box winner-box">${escapeHtml(finaleMatches[0].winner)}</div>
        </div>`;
      return;
    }

    const rowUnit = Math.pow(2, colIdx + 1);
    byRound.get(roundName).forEach((m, i) => {
      const rowStart = i * rowUnit + 2;
      cells += `
        <div class="bracket-match" style="grid-column:${col};grid-row:${rowStart} / span ${rowUnit};">
          ${bracketBoxHtml(m)}
        </div>`;
    });
  });

  return `
    <div class="bracket-scroll">
      <div class="bracket-grid" style="grid-template-columns:repeat(${columns.length}, minmax(150px, 1fr)); grid-template-rows:auto repeat(${totalSubrows}, minmax(26px, 1fr));">
        ${cells}
      </div>
    </div>`;
}

// Rendert die aktuell im Dropdown gewählte Konkurrenz: Turnierbaum, wenn
// bereits Paarungen existieren, sonst die gemeldeten Spieler:innen aus der
// Meldeliste (Auslosung steht noch aus).
function renderCompetitionDetail() {
  const el = qs('spiele-list');
  if (!state.selectedCompetition) {
    el.innerHTML = '<p class="empty">Wird vor Turnierstart eingepflegt.</p>';
    return;
  }
  const matches = [
    ...state.results.filter((m) => m.competition === state.selectedCompetition).map((m) => ({ ...m, played: true })),
    ...state.schedule.filter((m) => m.competition === state.selectedCompetition).map((m) => ({ ...m, played: false })),
  ];
  if (matches.length) {
    el.innerHTML = renderBracket(matches);
    return;
  }
  const entrantBlock = state.entrants.find((c) => c.competition === state.selectedCompetition);
  if (entrantBlock && entrantBlock.entrants.length) {
    el.innerHTML = `
      <p class="hint">Auslosung steht noch aus – gemeldete Spieler:innen:</p>
      <ul>${entrantBlock.entrants.map((p) => `<li>${escapeHtml(p.name || '')}${p.club ? ' · ' + escapeHtml(p.club) : ''}${p.lk ? ' · LK' + escapeHtml(p.lk) : ''}</li>`).join('')}</ul>`;
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

// Baut EINE Zeile der Spielplan-Übersicht: Platz und Uhrzeit vorne (Platz
// immer in eigener Zeile zuerst), dann Konkurrenz/Runde, Paarung und
// Ergebnis bzw. "Noch offen".
function scheduleRowHtml(m) {
  const p1Wins = m.played && namesMatch(m.player1, m.winner);
  const p2Wins = m.played && namesMatch(m.player2, m.winner);
  const timePart = m._date
    ? m._date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
    : '';
  return `
    <div class="schedule-row">
      <div class="schedule-when">
        ${m.court ? `<div class="schedule-court">${escapeHtml(m.court)}</div>` : ''}
        ${timePart
          ? `<div class="schedule-time">${escapeHtml(timePart)}</div>`
          : '<div class="schedule-time schedule-time-empty">Zeit offen</div>'}
      </div>
      <div class="schedule-match">
        <div class="schedule-comp">${escapeHtml(m.competition || '')}${m.round ? ' · ' + escapeHtml(m.round) : ''}</div>
        <div class="schedule-players">
          <span${p1Wins ? ' class="winner"' : ''}>${escapeHtml(m.player1 || '')}</span> –
          <span${p2Wins ? ' class="winner"' : ''}>${escapeHtml(m.player2 || '')}</span>
        </div>
        ${m.played ? `<div class="schedule-score">${escapeHtml(m.score || '')}</div>` : '<div class="schedule-pending">Noch offen</div>'}
      </div>
    </div>`;
}

// Rendert den eigenständigen "Spielplan"-Tab: ALLE Begegnungen ALLER
// Konkurrenzen zusammen, chronologisch nach Tag und Uhrzeit gruppiert - im
// Gegensatz zum "Ergebnisse"-Tab, der pro Konkurrenz einen Turnierbaum zeigt.
function renderSpielplanOverview() {
  const el = qs('spielplan-list');
  if (!el) return;

  const all = [
    ...state.results.map((m) => ({ ...m, played: true })),
    ...state.schedule.map((m) => ({ ...m, played: false })),
  ].map((m) => ({ ...m, _date: parseTerminDate(m.time) }));

  if (!all.length) {
    el.innerHTML = '<p class="empty">Wird vor Turnierstart eingepflegt.</p>';
    return;
  }

  const withDate = all.filter((m) => m._date).sort((a, b) => a._date - b._date);
  const withoutDate = all.filter((m) => !m._date);

  const byDay = new Map();
  for (const m of withDate) {
    const dayKey = m._date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(m);
  }

  let html = '';
  for (const [day, matches] of byDay) {
    html += `<div class="schedule-day"><h3 class="schedule-date">${escapeHtml(day)}</h3><div class="schedule-rows">${matches.map(scheduleRowHtml).join('')}</div></div>`;
  }
  if (withoutDate.length) {
    html += `<div class="schedule-day"><h3 class="schedule-date">Termin noch offen</h3><div class="schedule-rows">${withoutDate.map(scheduleRowHtml).join('')}</div></div>`;
  }
  el.innerHTML = html;
}

function renderReports(items) {
  const el = qs('berichte-list');
  if (!items || !items.length) { el.innerHTML = '<p class="empty">Der erste Tagesbericht folgt nach Turnierstart.</p>'; return; }
  const sorted = [...items].sort((a, b) => new Date(b.date) - new Date(a.date));
  el.innerHTML = sorted.map(r => `
    <div class="report-item">
      <h3>${escapeHtml(r.title || '')}</h3>
      <div class="date">${fmtTime(r.date)}</div>
      <p>${escapeHtml(r.text || '')}</p>
    </div>`).join('');
}

function renderMenu(days) {
  const el = qs('speiseplan-list');
  if (!days || !days.length) { el.innerHTML = '<p class="empty">Speiseplan wird noch veröffentlicht.</p>'; return; }
  el.innerHTML = days.map(d => `
    <div class="menu-day">
      <h3>${escapeHtml(d.day || '')}</h3>
      <ul>${(d.items || []).map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
    </div>`).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function refreshAll() {
  const [ticker, schedule, results, reports, menu, entrants] = await Promise.all([
    loadJSON('data/ticker.json'),
    loadJSON('data/schedule.json'),
    loadJSON('data/results.json'),
    loadJSON('data/reports.json'),
    loadJSON('data/menu.json'),
    loadJSON('data/entrants.json'),
  ]);
  renderTicker(ticker);
  renderSpielplanErgebnisse(schedule, results, entrants);
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

setupTabs();
setupCompetitionSelect();
refreshAll();
setInterval(refreshAll, REFRESH_MS);
