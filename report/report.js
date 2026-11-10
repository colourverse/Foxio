// Foxio shareable report. Runs standalone (no extension): reads the JSON
// embedded in #foxio-data and renders a list view, a board view, a detail
// dialog and a heuristics glossary. Everything from the data is escaped.
(function () {
  'use strict';
  var D = JSON.parse(document.getElementById('foxio-data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var safeUrl = function (u) { return /^(https?|file):/i.test(String(u || '')) ? String(u) : '#'; };
  var safeImg = function (u) { return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(String(u || '')) ? u : ''; };
  var byId = function (list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; };
  var label = function (list, id) { var o = byId(list, id); return o ? o.label : id; };
  var PRIO_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  var fmtDate = function (t) { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };
  var pathOf = function (c) { try { var u = new URL(c.url); return (u.hostname || 'file') + u.pathname; } catch (e) { return c.url; } };

  var comments = D.comments.slice();
  var state = { view: /^#board/.test(location.hash) ? 'board' : /^#list/.test(location.hash) ? 'list' : (D.view || 'list'),
    q: '', page: '', priority: '', status: '' };

  // ---------------------------------------------------------------- header + summary
  document.title = D.title;
  $('title').textContent = D.title;
  $('meta').textContent = [D.preparedBy ? 'Prepared by ' + D.preparedBy : '', fmtDate(D.generatedAt),
    comments.length + ' comment' + (comments.length === 1 ? '' : 's')].filter(Boolean).join(' · ');

  function countBy(key) {
    var m = {};
    comments.forEach(function (c) { var k = c[key] || ''; m[k] = (m[k] || 0) + 1; });
    return m;
  }
  (function summary() {
    var open = comments.filter(function (c) { return c.status !== 'done'; }).length;
    var prio = countBy('priority');
    var heur = countBy('heuristic');
    var heurRows = D.heuristics.map(function (h) { return { h: h, n: heur[h.id] || 0 }; })
      .filter(function (r) { return r.n; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
    var max = heurRows.length ? heurRows[0].n : 1;
    var html = '<div class="stat"><b>' + open + '</b><span>open</span></div>' +
      D.priorities.map(function (p) {
        return '<div class="stat"><b>' + (prio[p.id] || 0) + '</b><span><span class="chip prio p-' + esc(p.id) + '">' + esc(p.label) + '</span></span></div>';
      }).join('');
    if (heurRows.length) {
      html += '<div class="stat wide"><span>Most common heuristics</span><ul class="bars">' + heurRows.map(function (r) {
        return '<li><a class="name" href="#g-' + esc(r.h.id) + '">' + esc(r.h.name) + '</a><span>' + r.n + '</span>' +
          '<span class="bar"><i style="width:' + Math.round(r.n / max * 100) + '%"></i></span></li>';
      }).join('') + '</ul></div>';
    }
    $('summary').innerHTML = html;
  })();

  // ---------------------------------------------------------------- filters
  function fill(sel, allLabel, opts) {
    sel.innerHTML = '<option value="">' + esc(allLabel) + '</option>' + opts.map(function (o) {
      return '<option value="' + esc(o.id) + '">' + esc(o.label) + '</option>';
    }).join('');
  }
  var pages = [];
  comments.forEach(function (c) { if (!pages.some(function (p) { return p.id === c.pageKey; })) pages.push({ id: c.pageKey, label: pathOf(c) }); });
  fill($('fPage'), 'All pages', pages);
  $('fPage').hidden = pages.length < 2;
  fill($('fPriority'), 'Any priority', D.priorities);
  var statuses = D.statuses.filter(function (s) { return comments.some(function (c) { return c.status === s.id; }); });
  fill($('fStatus'), 'Any status', statuses);

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return comments.filter(function (c) {
      return (!state.page || c.pageKey === state.page) && (!state.priority || c.priority === state.priority) &&
        (!state.status || c.status === state.status) &&
        (!q || [c.body, c.url, c.pageTitle, c.author, c.anchorText].concat((c.replies || []).map(function (r) { return r.body; }))
          .join(' ').toLowerCase().indexOf(q) !== -1);
    });
  }

  // ---------------------------------------------------------------- pieces
  function heurChip(c) {
    var h = byId(D.heuristics, c.heuristic);
    return h ? '<a class="chip heur" href="#g-' + esc(h.id) + '" title="' + esc(h.desc) + '">' + esc(h.short) + '</a>' : '';
  }
  function chips(c) {
    return '<span class="chip prio p-' + esc(c.priority) + '">' + esc(label(D.priorities, c.priority)) + '</span>' +
      '<span class="chip type t-' + esc(c.type) + '">' + esc(label(D.types, c.type)) + '</span>' +
      '<span class="chip status st-' + esc(c.status) + '">' + esc(label(D.statuses, c.status)) + '</span>' +
      (c.source === 'audit' ? '<span class="chip type">Automated audit</span>' : '') + heurChip(c);
  }
  function numBadge(c) { return '<span class="num p-' + esc(c.priority) + '">' + esc(c.number) + '</span>'; }
  function replies(c) {
    return (c.replies || []).length ? '<ul class="replies">' + c.replies.map(function (r) {
      return '<li><b>' + esc(r.author) + '</b> <span class="muted">' + esc(fmtDate(r.createdAt)) + '</span><br>' + esc(r.body) + '</li>';
    }).join('') + '</ul>' : '';
  }

  // ---------------------------------------------------------------- views
  function renderList(list) {
    var groups = [];
    list.slice().sort(function (a, b) {
      return (PRIO_RANK[a.priority] - PRIO_RANK[b.priority]) || (a.number - b.number);
    }).forEach(function (c) {
      var g = null;
      for (var i = 0; i < groups.length; i++) if (groups[i].key === c.pageKey) g = groups[i];
      if (!g) { g = { key: c.pageKey, first: c, items: [] }; groups.push(g); }
      g.items.push(c);
    });
    return groups.map(function (g) {
      return '<section class="page-group"><div class="page-head"><h2>' + esc(g.first.pageTitle || pathOf(g.first)) + '</h2>' +
        '<a href="' + esc(safeUrl(g.first.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(pathOf(g.first)) + '</a>' +
        '<span class="muted">' + g.items.length + ' comment' + (g.items.length === 1 ? '' : 's') + '</span></div>' +
        g.items.map(function (c) {
          var img = safeImg(c.screenshot);
          return '<article class="item' + (img ? '' : ' no-shot') + (c.status === 'done' ? ' is-done' : '') + '">' +
            '<div><div class="item-top">' + numBadge(c) + chips(c) + '</div>' +
            '<p class="body">' + esc(c.body) + '</p>' +
            '<div class="item-meta"><span>' + esc(c.author) + ' · ' + esc(fmtDate(c.createdAt)) + '</span>' +
            (c.anchorText ? '<span>On <q>' + esc(c.anchorText.slice(0, 80)) + '</q></span>' : '') + '</div>' +
            replies(c) + '</div>' +
            (img ? '<button type="button" class="shot-btn" data-id="' + esc(c.id) + '" aria-label="Enlarge screenshot for comment ' + esc(c.number) + '"><img src="' + img + '" alt="Screenshot of the commented element" loading="lazy"></button>' : '') +
            '</article>';
        }).join('') + '</section>';
    }).join('');
  }

  function renderBoard(list) {
    var cols = D.statuses.filter(function (s) { return D.includeDone || s.id !== 'done'; });
    return '<div class="board">' + cols.map(function (s) {
      var items = list.filter(function (c) { return c.status === s.id; }).sort(function (a, b) { return a.order - b.order; });
      return '<section class="col" aria-label="' + esc(s.label) + '"><h2>' + esc(s.label) + '<span class="n">' + items.length + '</span></h2>' +
        (items.map(function (c) {
          var img = safeImg(c.screenshot);
          return '<button type="button" class="card" data-id="' + esc(c.id) + '">' +
            '<span class="card-top"><span class="chip prio p-' + esc(c.priority) + '">' + esc(label(D.priorities, c.priority)) + '</span>' +
            '<span class="chip type t-' + esc(c.type) + '">' + esc(label(D.types, c.type)) + '</span><span class="n">#' + esc(c.number) + '</span></span>' +
            (img ? '<img class="thumb" src="' + img + '" alt="" loading="lazy">' : '') +
            '<span class="card-body">' + esc(c.body) + '</span>' +
            '<span class="path">' + esc(pathOf(c)) + '</span></button>';
        }).join('') || '<p class="col-empty">Nothing here</p>') + '</section>';
    }).join('') + '</div>';
  }

  function render() {
    var list = filtered();
    document.querySelectorAll('.seg button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === state.view);
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === state.view);
    });
    $('showing').textContent = list.length === comments.length ? 'Showing all ' + list.length + ' comments' : 'Showing ' + list.length + ' of ' + comments.length + ' comments';
    $('view').innerHTML = !list.length ? '<div class="empty">No comments match these filters.</div>'
      : state.view === 'board' ? renderBoard(list) : renderList(list);
  }

  // ---------------------------------------------------------------- detail dialog
  var lastFocus = null;
  function openDetail(id) {
    var c = byId(comments, id);
    if (!c) return;
    var img = safeImg(c.screenshot);
    lastFocus = document.activeElement;
    var dlg = $('detail');
    dlg.innerHTML = '<div class="detail-inner"><div class="detail-head">' + numBadge(c) + chips(c) +
      '<button type="button" class="close" aria-label="Close">×</button></div>' +
      (img ? '<img src="' + img + '" alt="Screenshot of the commented element">' : '') +
      '<p class="body">' + esc(c.body) + '</p>' +
      '<dl><dt>Page</dt><dd><a href="' + esc(safeUrl(c.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(c.pageTitle || c.url) + '</a></dd>' +
      '<dt>By</dt><dd>' + esc(c.author) + ', ' + esc(fmtDate(c.createdAt)) + '</dd>' +
      (c.anchorText ? '<dt>Element</dt><dd>“' + esc(c.anchorText) + '”</dd>' : '') +
      (c.selector ? '<dt>Selector</dt><dd><code>' + esc(c.selector) + '</code></dd>' : '') +
      (c.viewport ? '<dt>Viewport</dt><dd>' + esc(c.viewport.w) + ' × ' + esc(c.viewport.h) + '</dd>' : '') +
      '</dl>' + replies(c) + '</div>';
    dlg.querySelector('.close').onclick = function () { dlg.close(); };
    dlg.showModal();
    dlg.querySelector('.close').focus();
  }
  $('detail').addEventListener('close', function () { if (lastFocus) lastFocus.focus(); });
  $('detail').addEventListener('click', function (e) {
    if (e.target === $('detail')) $('detail').close(); // click on backdrop
    if (e.target.closest('a.heur')) $('detail').close();
  });

  // ---------------------------------------------------------------- glossary
  (function glossary() {
    var used = D.heuristics.filter(function (h) { return comments.some(function (c) { return c.heuristic === h.id; }); });
    if (!used.length) { $('glossary').hidden = true; return; }
    $('glossary').innerHTML = '<h2 id="glossary-h">Heuristics referenced</h2>' +
      '<p class="muted">Comments are tagged with the usability principle they relate to.</p><dl>' +
      used.map(function (h) {
        return '<div id="g-' + esc(h.id) + '"><dt><span class="badge">' + esc(h.num) + '</span>' + esc(h.name) + '</dt>' +
          '<dd>' + esc(h.desc) + ' ' + esc(h.why || '') +
          (h.refs && h.refs[0] ? ' <a href="' + esc(safeUrl(h.refs[0].url)) + '" target="_blank" rel="noopener noreferrer">Source</a>' : '') + '</dd></div>';
      }).join('') + '</dl>';
  })();

  // ---------------------------------------------------------------- wiring
  document.querySelector('.seg').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    state.view = b.getAttribute('data-view');
    history.replaceState(null, '', '#' + state.view);
    render();
  });
  $('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  [['fPage', 'page'], ['fPriority', 'priority'], ['fStatus', 'status']].forEach(function (p) {
    $(p[0]).addEventListener('change', function (e) { state[p[1]] = e.target.value; render(); });
  });
  $('view').addEventListener('click', function (e) {
    var t = e.target.closest('.card, .shot-btn');
    if (t) openDetail(t.getAttribute('data-id'));
  });
  $('print').addEventListener('click', function () { window.print(); });
  // Printing always uses the list view, which paginates well.
  var viewBeforePrint = null;
  window.addEventListener('beforeprint', function () { if (state.view !== 'list') { viewBeforePrint = state.view; state.view = 'list'; render(); } });
  window.addEventListener('afterprint', function () { if (viewBeforePrint) { state.view = viewBeforePrint; viewBeforePrint = null; render(); } });

  render();
})();
