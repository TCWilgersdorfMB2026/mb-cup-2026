(function () {
  var REFRESH_MS = 20000;
  var RELOAD_MS = 30 * 60 * 1000;
  var COURTS = ['Platz 1', 'Platz 2', 'Platz 3', 'Platz 4'];

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

  function matchCardHtml(m) {
    return (
      '<div class="match-card">' +
        '<span class="court-badge">' + escapeHtml(m.court) + '</span>' +
        '<div class="meta-top">' +
          '<div class="competition">' + escapeHtml(m.competition) + '</div>' +
          '<div class="round">' + escapeHtml(m.round) + '</div>' +
        '</div>' +
        '<div class="players">' +
          '<div class="player">' + escapeHtml(m.player1) + '</div>' +
          '<div class="vs">vs.</div>' +
          '<div class="player">' + escapeHtml(m.player2) + '</div>' +
        '</div>' +
        '<div class="match-meta"><span>' + escapeHtml(m.time) + '</span></div>' +
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

  function renderMatches(matches, isDemo) {
    var container = qs('matches');
    qs('demo-badge').hidden = !isDemo;

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
    return Promise.all([loadJSON('data/schedule.json'), loadJSON('data/results.json')]).then(function (arr) {
      var schedule = arr[0] || [];
      var results = arr[1] || [];
      var finishedKeys = {};
      results.forEach(function (r) {
        if (r.winner) finishedKeys[matchKey(r)] = true;
      });
      var now = new Date();
      var live = schedule.filter(function (m) {
        var t = parseDeTime(m.time);
        if (!t) return false;
        return t <= now && !finishedKeys[matchKey(m)];
      });
      if (live.length > 0) {
        renderMatches(live, false);
        finishLastUpdated(now);
        return null;
      }
      return loadJSON('data/live-demo.json').then(function (demo) {
        renderMatches(demo || [], true);
        finishLastUpdated(now);
      });
    });
  }

  renderClock();
  setInterval(renderClock, 1000);
  refresh();
  setInterval(refresh, REFRESH_MS);
  setTimeout(function () { location.reload(); }, RELOAD_MS);
})();

