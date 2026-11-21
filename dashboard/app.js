// Token Launch Radar — the page. Reads window.RADAR (written by main.ts),
// renders the board, filters it, and shows one protocol's detail view with
// its value breakdown and its farm plan (built by window.FARM, the same
// functions board.json was built with).
(function () {
  var R = window.RADAR;
  var rows = R.rows; // [rank, slug, name, cat, chains, tvl, chg, implied, ageDays, base, growth, ageMult]
  var live = R.live; // [slug, name, cat, tvl, mcap, chg]
  var state = { q: '', cat: '', chain: '', watch: false, sort: 'rank', view: 'board', sel: null };
  var watchSet = {};
  R.watchlist.forEach(function (s) { watchSet[s] = true; });

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 0 : 2).replace(/\.00$/, '') + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(c) { return c === null || c === undefined ? '—' : (c > 0 ? '+' : '') + c.toFixed(1) + '%'; }
  function age(a) { return a === null || a === undefined ? '—' : (a / 365.25).toFixed(1) + 'y'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  $('subtitle').textContent = R.board_size + ' pre-token protocols from the sealed DefiLlama snapshot of ' + R.as_of +
    ', ranked by implied launch value. ' + R.watchlist_size + ' on the house watchlist, ' + R.early_size + ' found below its floor.';
  $('badge-board').textContent = R.board_size + ' rows';
  $('badge-watch').textContent = R.watchlist_size + ' watchlist';
  $('badge-comps').textContent = R.comps + ' comps';
  $('asof').textContent = R.as_of;
  $('mver').textContent = R.model_version;
  $('foot').textContent = R.board_size + ' rows · ' + R.watchlist_size + ' watchlist · ' + R.early_size + ' early';
  var b = R.backtest;
  $('method-text').textContent =
    'A power-law fit on the snapshot\u2019s own traded protocols: ln(market cap) on ln(TVL) over ' + R.comps +
    ' core comps (exchanges, bridges and liquid-staking products left out), giving a = ' + R.fit_a + ', b = ' + R.fit_b + '. ' +
    'Growth multiplies by 1 + the 7-day TVL change clipped to −50…+100% over 200; age adds up to 15% for four years listed without a token. ' +
    'Leave-one-out on the ' + b.n + ' comps: median prediction within ' + b.median_factor + '×, ' + b.within_2x +
    '% within 2× — so every value below is a point estimate with a wide honest band, not a price.';

  function fillSelect(el, values) {
    values.forEach(function (v) {
      var o = document.createElement('option'); o.value = v; o.textContent = v; el.appendChild(o);
    });
  }
  fillSelect($('cat'), [...new Set(rows.map(function (r) { return r[3] || '(none)'; }))].sort());
  fillSelect($('chain'), [...new Set(rows.flatMap(function (r) { return r[4]; }))].sort());

  function filtered() {
    var list = rows.filter(function (r) {
      if (state.watch && !watchSet[r[1]]) return false;
      if (state.cat && (r[3] || '(none)') !== state.cat) return false;
      if (state.chain && r[4].indexOf(state.chain) === -1) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r[1].toLowerCase().indexOf(q) === -1 && r[2].toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });
    var k = state.sort;
    var key = { rank: 0, implied: 7, tvl: 5, growth: 6, age: 8 }[k];
    list.sort(function (a, c) {
      var d = (c[key] === null ? -1e18 : c[key]) - (a[key] === null ? -1e18 : a[key]);
      return k === 'rank' ? a[0] - c[0] : (d !== 0 ? d : a[0] - c[0]);
    });
    return list;
  }

  function renderBoard() {
    var tb = $('rows'); tb.innerHTML = '';
    var list = filtered();
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      if (state.sel === r[1]) tr.className = 'sel';
      tr.innerHTML =
        '<td>' + r[0] + '</td>' +
        '<td><strong>' + esc(r[2]) + '</strong><br><span class="slug">' + esc(r[1]) + '</span></td>' +
        '<td>' + esc(r[3] || '—') + '</td>' +
        '<td>' + r[4].slice(0, 3).map(function (c) { return '<span class="tag">' + esc(c) + '</span>'; }).join('') + (r[4].length > 3 ? '<span class="tag">+' + (r[4].length - 3) + '</span>' : '') + '</td>' +
        '<td class="num">' + money(r[5]) + '</td>' +
        '<td class="num ' + (r[6] > 0 ? 'up' : r[6] < 0 ? 'down' : '') + '">' + pct(r[6]) + '</td>' +
        '<td class="num"><strong>' + money(r[7]) + '</strong></td>' +
        '<td class="num">' + age(r[8]) + '</td>';
      tr.addEventListener('click', function () { showDetail(r[1]); });
      tb.appendChild(tr);
    });
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols shown';
  }

  function renderLive() {
    var tb = $('rows'); tb.innerHTML = '';
    live.forEach(function (p) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>—</td><td><strong>' + esc(p[1]) + '</strong><br><span class="slug">' + esc(p[0]) + '</span></td>' +
        '<td>' + esc(p[2] || '—') + '</td><td>—</td>' +
        '<td class="num">' + money(p[3]) + '</td>' +
        '<td class="num ' + (p[5] > 0 ? 'up' : p[5] < 0 ? 'down' : '') + '">' + pct(p[5]) + '</td>' +
        '<td class="num"><strong>' + money(p[4]) + '</strong> <span class="slug">mcap</span></td><td class="num">—</td>';
      tb.appendChild(tr);
    });
    $('count').textContent = live.length + ' largest traded protocols by market cap — shown apart, never ranked against the pre-token board';
  }

  function showDetail(slug) {
    state.sel = slug;
    var r = rows.find(function (x) { return x[1] === slug; });
    if (!r) return;
    var low = Math.round(r[7] / R.backtest.median_factor);
    var high = Math.round(r[7] * R.backtest.median_factor);
    var p = { slug: r[1], name: r[2], category: r[3], chains: r[4], tvl_usd: r[5] };
    var steps = window.FARM.farmStepsFor(p, r[8]);
    $('detail').hidden = false;
    $('detail').innerHTML =
      '<h2>#' + r[0] + ' — ' + esc(r[2]) + '</h2>' +
      '<p class="meta">' + esc(r[3] || 'Uncategorised') + ' · ' + r[4].map(esc).join(', ') + ' · listed ' + age(r[8]) + ' ago · TVL ' + money(r[5]) + ' · 7d ' + pct(r[6]) + '</p>' +
      '<h3>Why ' + money(r[7]) + '</h3>' +
      '<div class="math">implied = exp(a + b·ln TVL) × growth × age\n' +
      '        = exp(' + R.fit_a + ' + ' + R.fit_b + ' · ln ' + money(r[5]) + ') × ' + r[10].toFixed(2) + ' × ' + r[11].toFixed(2) + '\n' +
      '        = ' + money(r[9]) + ' × ' + r[10].toFixed(2) + ' × ' + r[11].toFixed(2) + '\n' +
      '        = ' + money(r[7]) + '   (honest band at the backtest median error: ' + money(low) + ' – ' + money(high) + ')</div>' +
      '<h3>How to farm it</h3><ol>' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="fine">This protocol records no token in the snapshot. The plan is a starting point: check the protocol\u2019s own pages before moving funds, and never pay to claim anything.</p>';
    renderBoard();
    $('detail').scrollIntoView({ behavior: 'auto', block: 'nearest' });
  }

  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  document.querySelectorAll('#board th').forEach(function (th) {
    th.addEventListener('click', function () {
      state.sort = th.getAttribute('data-k') === 'name' ? 'rank' : th.getAttribute('data-k');
      $('sort').value = state.sort; renderBoard();
    });
  });
  $('view-board').addEventListener('click', function () {
    state.view = 'board'; $('view-board').className = 'on'; $('view-live').className = ''; renderBoard();
  });
  $('view-live').addEventListener('click', function () {
    state.view = 'live'; $('view-live').className = 'on'; $('view-board').className = ''; renderLive();
  });
  // Deep links, so one view can be opened directly: #detail=<slug> shows a
  // protocol's detail, #cat=<category> and #chain=<chain> filter the board,
  // #watch=1 shows the watchlist only.
  var hash = new URLSearchParams((location.hash || '').slice(1));
  if (hash.get('cat')) { state.cat = hash.get('cat'); $('cat').value = state.cat; }
  if (hash.get('chain')) { state.chain = hash.get('chain'); $('chain').value = state.chain; }
  if (hash.get('watch') === '1') { state.watch = true; $('watch').checked = true; }
  renderBoard();
  if (hash.get('detail')) showDetail(hash.get('detail'));
})();
