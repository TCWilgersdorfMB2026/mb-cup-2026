(function () {
  var REFRESH_MS = 20000;
  var RELOAD_MS = 30 * 60 * 1000;
  var COURTS = ['Platz 1', 'Platz 2', 'Platz 3', 'Platz 4'];
  var MENU_REFRESH_MS = 5 * 60 * 1000;
  var ENTRANTS = [];

  function qs(id) { return document.getElementById(id); }

  function parseDeTime(str) {
    if (!str) return null;
    var m = str.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
    if (!m) return null;
    var d = m[1], mo = m[2], y = m[3], h = m[4], mi = m[5];
    return new Date(y + '-' + mo + '-' + d + 'T' + h + ':' + mi + ':00');
  }

  function matchKey(m) {
    return [m.competition, m.round, m.player1, m.player2].join('|');
  }

  function loadJSON(path) {
    return fetch(path + '?t=' + Date.now())
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  function renderClock() {
    var now = new Date();
    qs('clock-time').textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    qs('clock-date').textContent = now.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function escapeHtml(str) {
    var s = String(str == null ? '' : str);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Sucht die LK eines Spielers in den Meldelisten (ENTRANTS). Namen aus
  // Spielplan/Ergebnissen kommen im Format 'Nachname, Vorname' von tennis.de,
  // Namen aus Meldelisten/manuellen Live-Eintraegen im Format 'Nachname Vorname'.
  function findEntrant(rawName) {
    var name = (rawName || '').trim();
    if (!name) return null;
    var withoutComma = name.replace(/,\s*/, ' ');
    for (var i = 0; i < ENTRANTS.length; i++) {
      var list = ENTRANTS[i].entrants || [];
      for (var j = 0; j < list.length; j++) {
        if (list[j].name === name || list[j].name === withoutComma) return list[j];
      }
    }
    return null;
  }

  function playerHtml(rawName) {
    var raw = rawName || '';
    var entrant = findEntrant(raw);
    var lk = entrant && entrant.lk;
    var club = entrant && entrant.club;
    var html = escapeHtml(raw) + (lk ? ' (LK ' + escapeHtml(lk) + ')' : '');
    if (club) html += ' <span class="player-club">\u00b7 ' + escapeHtml(club) + '</span>';
    return html;
  }

  function matchTimeHtml(t) {
    var s = String(t == null ? '' : t);
    var m = s.match(/^(\d{2}\.\d{2}\.\d{4})\s+(.+)$/);
    if (!m) return '<div class="match-time">' + escapeHtml(s) + '</div>';
    return '<div class="match-time">' +
      '<span class="match-date">' + escapeHtml(m[1]) + '</span>' +
      '<span class="time-divider"></span>' +
      '<span class="match-clock">' + escapeHtml(m[2]) + '</span>' +
    '</div>';
  }

  function matchCardHtml(m) {
    return (
      '<div class="match-card">' +
        '<span class="court-badge">' + escapeHtml(m.court) + '</span>' +
        '<div class="meta-top">' +
          '<div class="competition">' + escapeHtml(m.competition) + (m.round ? ' \u00b7 ' + escapeHtml(m.round) : '') + '</div>' +
          (m.time ? matchTimeHtml(m.time) : '') +
        '</div>' +
        '<div class="players">' +
          '<div class="player">' + playerHtml(m.player1) + '</div>' +
          '<div class="player">' + playerHtml(m.player2) + '</div>' +
        '</div>' +
                '</div>'
    );
  }

  function emptyCardHtml(court) {
    return (
      '<div class="match-card match-card-empty">' +
        '<span class="court-badge">' + escapeHtml(court) + '</span>' +
        '<div class="court-empty">Keine Partie</div>' +
      '</div>'
    );
  }

function renderMatches(matches, badgeText) {
      var container = qs('matches');
      var badge = qs('demo-badge');
      if (badgeText) { badge.textContent = badgeText; badge.hidden = false; } else { badge.hidden = true; }

    var byCourt = {};
    (matches || []).forEach(function (m) {
      if (!byCourt[m.court]) byCourt[m.court] = m;
    });

    container.innerHTML = COURTS.map(function (court) {
      var m = byCourt[court];
      return m ? matchCardHtml(m) : emptyCardHtml(court);
    }).join('');
  }

  function finishLastUpdated(now) {
    qs('last-updated').textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function refresh() {
    return Promise.all([loadJSON('data/schedule.json'), loadJSON('data/results.json'), loadJSON('data/live-current.json'), loadJSON('data/entrants.json')]).then(function (arr) {
      var schedule = arr[0] || [];
      var results = arr[1] || [];
      var manual = arr[2] || [];
      ENTRANTS = arr[3] || [];
      var finishedKeys = {};
      results.forEach(function (r) {
        if (r.winner) finishedKeys[matchKey(r)] = true;
      });
      var now = new Date();
      var autoLive = schedule.filter(function (m) {
        var t = parseDeTime(m.time);
        if (!t) return false;
        return t <= now && !finishedKeys[matchKey(m)];
      });

      // tennis.de ist die Standardquelle; manuelle Eintraege aus admin.html
      // (live-current.json) ueberschreiben pro Platz, falls dort etwas hinterlegt ist.
      var byCourt = {};
      autoLive.forEach(function (m) { byCourt[m.court] = m; });
      (manual || []).forEach(function (m) { if (m && m.court) byCourt[m.court] = m; });

      var merged = COURTS.map(function (c) { return byCourt[c]; }).filter(function (m) { return !!m; });

      if (merged.length > 0) {
        renderMatches(merged, null);
        finishLastUpdated(now);
        return null;
      }

      return loadJSON('data/live-demo.json').then(function (demo) {
        renderMatches(demo || [], 'Beispieldaten');
        finishLastUpdated(now);
      });
    });
  }

  // ---- Speiseplan-Laufband ----
  function todayIso() {
    var d = new Date();
    var mo = String(d.getMonth() + 1);
    if (mo.length < 2) mo = '0' + mo;
    var da = String(d.getDate());
    if (da.length < 2) da = '0' + da;
    return d.getFullYear() + '-' + mo + '-' + da;
  }

  function loadMenuTicker() {
    loadJSON('data/menu.json').then(function (menu) {
      var bar = qs('menu-ticker');
      var content = qs('menu-ticker-content');
      if (!bar || !content) return;
      var today = todayIso();
      var entry = null;
      (menu || []).forEach(function (e) { if (e.day === today) entry = e; });
      var items = (entry && entry.items) ? entry.items : [];
      var names = items.map(function (it) {
        return typeof it === 'string' ? it : ((it && it.name) || '');
      }).filter(function (n) { return !!n; });
      if (!names.length) {
        bar.hidden = true;
        return;
      }
      var text = names.join('   \u2022   ');
      content.textContent = text + '   \u2022   ' + text;
      content.style.animationDuration = Math.max(18, text.length * 0.18) + 's';
      bar.hidden = false;
    });
  }

  renderClock();
  setInterval(renderClock, 1000);
  refresh();
  setInterval(refresh, REFRESH_MS);
  loadMenuTicker();
  setInterval(loadMenuTicker, MENU_REFRESH_MS);
  setTimeout(function () { location.reload(); }, RELOAD_MS);
})();

