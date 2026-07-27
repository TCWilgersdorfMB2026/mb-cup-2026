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

function renderMatches(containerId, items, showScore, entrants) {
  const el = qs(containerId);
  if (!items || !items.length) {
    if (!showScore && entrants && entrants.length) {
      el.innerHTML = `<p class="hint">Die Auslosung steht noch aus – hier schon mal die gemeldeten Spieler:innen je Konkurrenz.</p>` +
        entrants.map(c => `
          <div class="card">
            <div class="comp">${escapeHtml(c.competition || '')}</div>
            <ul>${(c.entrants || []).map(p => `<li>${escapeHtml(p.name || '')}${p.club ? ' · ' + escapeHtml(p.club) : ''}${p.lk ? ' · LK' + escapeHtml(p.lk) : ''}</li>`).join('')}</ul>
          </div>`).join('');
      return;
    }
    el.innerHTML = `<p class="empty">${showScore ? 'Noch keine Ergebnisse.' : 'Spielplan wird noch eingepflegt.'}</p>`;
    return;
  }
  el.innerHTML = items.map(m => `
    <div class="card">
      <div class="comp">${escapeHtml(m.competition || '')}</div>
      <div class="players">${escapeHtml(m.player1 || '')} vs. ${escapeHtml(m.player2 || '')}</div>
      ${showScore && m.score ? `<div class="score">${escapeHtml(m.score)}</div>` : ''}
      <div class="meta">${escapeHtml(m.round || '')} ${m.time ? '· ' + fmtTime(m.time) : ''} ${m.court ? '· Platz ' + escapeHtml(m.court) : ''}</div>
    </div>`).join('');
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
  renderMatches('spielplan-list', schedule, false, entrants);
  renderMatches('ergebnisse-list', results, true);
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
