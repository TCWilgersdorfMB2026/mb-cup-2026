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
function roundRank(round) {
  const i = ROUND_ORDER.indexOf(round || '');
  return i === -1 ? ROUND_ORDER.length : i;
}

function namesMatch(a, b) {
  return (a || '').trim() && (a || '').trim() === (b || '').trim();
}

function renderMatchCard(m) {
  const p1Wins = m.played && namesMatch(m.player1, m.winner);
  const p2Wins = m.played && namesMatch(m.player2, m.winner);
  const metaParts = [m.round, m.time ? fmtTime(m.time) : '', m.court ? 'Platz ' + m.court : ''].filter(Boolean);
  return `
    <div class="card match-card">
      <div class="match-players">
        <div class="player${p1Wins ? ' winner' : ''}">${escapeHtml(m.player1 || '')}${p1Wins ? '<span class="winner-badge">Sieger</span>' : ''}</div>
        <div class="player${p2Wins ? ' winner' : ''}">${escapeHtml(m.player2 || '')}${p2Wins ? '<span class="winner-badge">Sieger</span>' : ''}</div>
      </div>
      ${m.played ? `<div class="score">${escapeHtml(m.score || '')}</div>` : '<div class="pending">Noch offen</div>'}
      ${metaParts.length ? `<div class="meta">${metaParts.map(escapeHtml).join(' · ')}</div>` : ''}
    </div>`;
}

// Zeigt Spielplan (offene Paarungen) UND Ergebnisse (entschiedene Matches)
// zusammen in einer Ansicht, pro Konkurrenz gruppiert und nach Runde
// sortiert - so sieht man auf einen Blick den kompletten Turnierverlauf
// einer Konkurrenz statt zwischen zwei Tabs hin- und herspringen zu müssen.
// Konkurrenzen, für die es noch keine einzige Paarung gibt (Auslosung steht
// noch aus, oder die Konkurrenz hat gar kein Tableau), zeigen stattdessen
// die gemeldeten Spieler:innen aus der Meldeliste.
function renderSpielplanErgebnisse(schedule, results, entrants) {
  const el = qs('spiele-list');
  const all = [
    ...(results || []).map((m) => ({ ...m, played: true })),
    ...(schedule || []).map((m) => ({ ...m, played: false })),
  ];

  const byCompetition = new Map();
  for (const m of all) {
    const key = m.competition || '';
    if (!byCompetition.has(key)) byCompetition.set(key, []);
    byCompetition.get(key).push(m);
  }

  if (!byCompetition.size && (!entrants || !entrants.length)) {
    el.innerHTML = '<p class="empty">Wird vor Turnierstart eingepflegt.</p>';
    return;
  }

  const matchSections = [...byCompetition.entries()].map(([competition, matches]) => {
    matches.sort((a, b) => roundRank(a.round) - roundRank(b.round));
    return `
      <div class="comp-group">
        <div class="comp">${escapeHtml(competition)}</div>
        <div class="card-list">${matches.map(renderMatchCard).join('')}</div>
      </div>`;
  });

  // Konkurrenzen, die noch gar keine Paarung haben (Auslosung steht noch
  // aus), zeigen stattdessen ihre Meldeliste.
  const entrantSections = (entrants || [])
    .filter((c) => !byCompetition.has(c.competition))
    .map((c) => `
      <div class="comp-group">
        <div class="comp">${escapeHtml(c.competition || '')}</div>
        <p class="hint">Auslosung steht noch aus – gemeldete Spieler:innen:</p>
        <ul>${(c.entrants || []).map((p) => `<li>${escapeHtml(p.name || '')}${p.club ? ' · ' + escapeHtml(p.club) : ''}${p.lk ? ' · LK' + escapeHtml(p.lk) : ''}</li>`).join('')}</ul>
      </div>`);

  el.innerHTML = matchSections.join('') + entrantSections.join('');
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

setupTabs();
refreshAll();
setInterval(refreshAll, REFRESH_MS);
