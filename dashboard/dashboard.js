(() => {
  const S = globalThis.FoxioStore;
  const HEUR = globalThis.FoxioHeuristics;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const label = (list, id) => (list.find(x => x.id === id) || {}).label || id;

  const state = {
    comments: [],
    settings: { author: '' },
    groupBy: localStorage.getItem('foxio.groupBy') || 'status',
    f: { q: '', site: '', page: '', priority: '', type: '', heur: '', source: '' },
    openId: null
  };

  // ------------------------------------------------------------- loading
  async function load() {
    state.comments = await S.all();
    state.settings = await S.getSettings();
    if (document.activeElement !== $('author')) $('author').value = state.settings.author;
    renderFilters();
    render();
    if (state.openId) {
      const inDrawer = $('drawer').contains(document.activeElement);
      if (!state.comments.some(c => c.id === state.openId)) closeDrawer();
      else if (!inDrawer) renderDrawer();
    }
  }

  function filtered() {
    const { q, site, page, priority, type, heur, source } = state.f;
    const needle = q.trim().toLowerCase();
    return state.comments.filter(c =>
      (!site || c.site === site) &&
      (!page || c.pageKey === page) &&
      (!priority || c.priority === priority) &&
      (!type || c.type === type) &&
      (!heur || c.heuristic === heur) &&
      (!source || (c.source || 'manual') === source) &&
      (!needle || [c.body, c.url, c.pageTitle, c.author, (c.anchor || {}).text, ...(c.replies || []).map(r => r.body)]
        .join(' ').toLowerCase().includes(needle)));
  }

  // ------------------------------------------------------------- filters
  function fillSelect(sel, allLabel, options, value) {
    sel.innerHTML = `<option value="">${allLabel}</option>` +
      options.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
    sel.value = options.some(o => o.id === value) ? value : '';
  }

  function renderFilters() {
    const sites = [...new Set(state.comments.map(c => c.site))].sort();
    fillSelect($('fSite'), 'All sites', sites.map(s => ({ id: s, label: s })), state.f.site);
    state.f.site = $('fSite').value;
    const pages = new Map();
    state.comments.filter(c => !state.f.site || c.site === state.f.site).forEach(c => {
      let path = c.pageKey;
      try { path = new URL(c.pageKey).pathname; } catch (e) {}
      pages.set(c.pageKey, (state.f.site ? '' : c.site) + path);
    });
    fillSelect($('fPage'), 'All pages', [...pages].map(([id, l]) => ({ id, label: l })).sort((a, b) => a.label.localeCompare(b.label)), state.f.page);
    state.f.page = $('fPage').value;
    fillSelect($('fPriority'), 'Any priority', S.PRIORITIES, state.f.priority);
    fillSelect($('fType'), 'Any type', S.TYPES, state.f.type);
    fillSelect($('fHeur'), 'Any heuristic', HEUR.map(h => ({ id: h.id, label: h.short })), state.f.heur);
    fillSelect($('fSource'), 'People & audit', [{ id: 'manual', label: 'People only' }, { id: 'audit', label: 'Audit only' }], state.f.source);
  }

  // ------------------------------------------------------------- board
  function columns() {
    return state.groupBy === 'priority' ? S.PRIORITIES : S.STATUSES;
  }

  function render() {
    const list = filtered();
    const open = state.comments.filter(c => c.status !== 'done');
    $('stats').innerHTML = `
      <span><b>${open.length}</b> open</span>
      <span><b>${open.filter(c => c.priority === 'critical').length}</b> critical</span>
      <span><b>${state.comments.length - open.length}</b> done</span>`;
    $('empty').hidden = state.comments.length > 0;
    $('board').hidden = state.comments.length === 0;
    document.querySelectorAll('#groupBy button').forEach(b => b.classList.toggle('on', b.dataset.v === state.groupBy));

    $('board').innerHTML = columns().map(col => {
      const items = list.filter(c => c[state.groupBy] === col.id).sort((a, b) => a.order - b.order);
      return `
        <section class="col col-${col.id}" aria-label="${esc(col.label)}">
          <header><span class="dot"></span><h2>${esc(col.label)}</h2><span class="n">${items.length}</span></header>
          <div class="col-list" data-value="${col.id}">
            ${items.map(card).join('') || '<p class="col-empty">Drop cards here</p>'}
          </div>
        </section>`;
    }).join('');
  }

  function card(c) {
    const h = HEUR.find(x => x.id === c.heuristic);
    let path = c.url;
    try { const u = new URL(c.url); path = (u.hostname || 'file') + u.pathname; } catch (e) {}
    const secondary = state.groupBy === 'priority'
      ? `<span class="status st-${c.status}">${esc(label(S.STATUSES, c.status))}</span>`
      : `<span class="prio p-${c.priority}">${esc(label(S.PRIORITIES, c.priority))}</span>`;
    return `
      <article class="card${c.status === 'done' ? ' is-done' : ''}" draggable="true" data-id="${c.id}" tabindex="0"
               aria-label="#${c.number} ${esc(c.body.slice(0, 80))}">
        <div class="card-top">
          ${secondary}
          <span class="type t-${c.type}">${esc(label(S.TYPES, c.type))}</span>
          ${c.source === 'audit' ? `<span class="type t-audit" title="Automated audit${c.audit && c.audit.severity ? ' \u00b7 ' + c.audit.severity : ''}">Audit</span>` : ''}
          <span class="num">#${c.number}</span>
        </div>
        ${c.screenshot ? `<img class="thumb" src="${c.screenshot}" alt="" loading="lazy">` : ''}
        <p class="card-body">${esc(c.body)}</p>
        ${h ? `<span class="heur" title="${esc(h.name)}">${esc(h.short)}</span>` : ''}
        <div class="card-meta">
          <span class="path" title="${esc(c.url)}">${esc(path)}</span>
          ${(c.replies || []).length ? `<span title="Replies">\u{1F4AC} ${c.replies.length}</span>` : ''}
          <span title="${new Date(c.createdAt).toLocaleString()}">${timeAgo(c.createdAt)}</span>
        </div>
      </article>`;
  }

  // ------------------------------------------------------------- drag & drop
  let dragId = null;
  const ph = document.createElement('div');
  ph.className = 'placeholder';

  $('board').addEventListener('dragstart', e => {
    const c = e.target.closest('.card');
    if (!c) return;
    dragId = c.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    ph.style.height = c.offsetHeight + 'px';
    requestAnimationFrame(() => c.classList.add('dragging'));
  });
  $('board').addEventListener('dragend', () => {
    dragId = null;
    ph.remove();
    document.querySelectorAll('.dragging, .drop-target').forEach(n => n.classList.remove('dragging', 'drop-target'));
  });
  $('board').addEventListener('dragover', e => {
    const list = e.target.closest('.col-list');
    if (!list || !dragId) return;
    e.preventDefault();
    document.querySelectorAll('.drop-target').forEach(n => n !== list && n.classList.remove('drop-target'));
    list.classList.add('drop-target');
    const cards = [...list.querySelectorAll('.card:not(.dragging)')];
    const after = cards.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (after) list.insertBefore(ph, after); else list.appendChild(ph);
  });
  $('board').addEventListener('drop', async e => {
    const list = e.target.closest('.col-list');
    if (!list || !dragId) return;
    e.preventDefault();
    const order = orderAt(ph);
    const id = dragId;
    ph.remove();
    await S.update(id, { [state.groupBy]: list.dataset.value, order });
  });

  // Fractional ordering: place the card between its new neighbours.
  function orderAt(placeholder) {
    const byId = id => state.comments.find(c => c.id === id);
    const sib = (n, dir) => { while ((n = n[dir]) && !(n.classList.contains('card') && !n.classList.contains('dragging'))); return n; };
    const prev = sib(placeholder, 'previousElementSibling');
    const next = sib(placeholder, 'nextElementSibling');
    const a = prev && byId(prev.dataset.id), b = next && byId(next.dataset.id);
    if (a && b) return (a.order + b.order) / 2;
    if (a) return a.order + 1;
    if (b) return b.order - 1;
    return 0;
  }

  // ------------------------------------------------------------- drawer
  $('board').addEventListener('click', e => {
    const c = e.target.closest('.card');
    if (c) openDrawer(c.dataset.id);
  });
  $('board').addEventListener('keydown', e => {
    const c = e.target.closest('.card');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDrawer(c.dataset.id); }
  });

  function openDrawer(id) {
    state.openId = id;
    renderDrawer();
    $('drawer').hidden = false;
    $('scrim').hidden = false;
    history.replaceState(null, '', '?focus=' + id);
    $('drawer').querySelector('.close').focus();
  }

  function closeDrawer() {
    const id = state.openId;
    state.openId = null;
    $('drawer').hidden = true;
    $('scrim').hidden = true;
    history.replaceState(null, '', location.pathname);
    const cardEl = id && document.querySelector(`.card[data-id="${id}"]`);
    if (cardEl) cardEl.focus();
  }
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.openId) closeDrawer(); });

  const options = (list, sel) => list.map(o => `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${esc(o.label)}</option>`).join('');

  function renderDrawer() {
    const c = state.comments.find(x => x.id === state.openId);
    if (!c) return;
    const a = c.anchor || {};
    $('drawer').innerHTML = `
      <div class="dr-head">
        <span class="num big p-${c.priority}">#${c.number}</span>
        <div class="dr-title">
          <a href="${esc(c.url)}" target="_blank" rel="noopener" title="${esc(c.url)}">${esc(c.pageTitle || c.url)}</a>
          <span>${esc(c.author)} &middot; ${new Date(c.createdAt).toLocaleString()}</span>
        </div>
        <button class="close" aria-label="Close">&times;</button>
      </div>
      ${c.screenshot ? `<a href="${c.screenshot}" target="_blank" class="shot-link"><img class="dr-shot" src="${c.screenshot}" alt="Screenshot of the commented element"></a>` : ''}
      <label class="field">Feedback<textarea id="drBody" rows="4">${esc(c.body)}</textarea></label>
      <div class="dr-grid">
        <label class="field">Status<select data-field="status">${options(S.STATUSES, c.status)}</select></label>
        <label class="field">Priority<select data-field="priority">${options(S.PRIORITIES, c.priority)}</select></label>
        <label class="field">Type<select data-field="type">${options(S.TYPES, c.type)}</select></label>
        <label class="field">Heuristic<select data-field="heuristic"><option value="">None</option>${options(HEUR.map(h => ({ id: h.id, label: h.name })), c.heuristic)}</select></label>
      </div>
      <dl class="dr-meta">
        <dt>Element</dt><dd><code>${esc(a.selector || '—')}</code></dd>
        ${a.text ? `<dt>Text</dt><dd>“${esc(a.text)}”</dd>` : ''}
        ${c.viewport ? `<dt>Viewport</dt><dd>${c.viewport.w} × ${c.viewport.h}</dd>` : ''}
      </dl>
      <div class="dr-actions">
        <button class="btn primary" id="drOpen">Show on page ↗</button>
        <span class="spacer"></span>
        <button class="btn danger" id="drDelete">Delete</button>
      </div>
      <h3>Replies</h3>
      <ul class="dr-replies">
        ${(c.replies || []).map(r => `<li><b>${esc(r.author)}</b> <span>${timeAgo(r.createdAt)}</span><p>${esc(r.body)}</p></li>`).join('') || '<li class="none">No replies yet.</li>'}
      </ul>
      <textarea id="drReply" rows="2" placeholder="Write a reply…"></textarea>
      <button class="btn" id="drReplyBtn">Reply</button>`;

    const d = $('drawer');
    d.querySelector('.close').onclick = closeDrawer;
    let t;
    $('drBody').addEventListener('input', e => {
      clearTimeout(t);
      const v = e.target.value;
      t = setTimeout(() => v.trim() && S.update(c.id, { body: v.trim() }), 400);
    });
    d.querySelectorAll('select[data-field]').forEach(s => s.addEventListener('change', () =>
      S.update(c.id, { [s.dataset.field]: s.value || null })));
    $('drOpen').onclick = () => chrome.runtime.sendMessage({ type: 'foxio:openComment', id: c.id });
    $('drDelete').onclick = async () => {
      if (!confirm(`Delete comment #${c.number}? This can't be undone.`)) return;
      await S.remove(c.id);
    };
    $('drReplyBtn').onclick = async () => {
      const v = $('drReply').value.trim();
      if (!v) return $('drReply').focus();
      await S.addReply(c.id, state.settings.author || 'Anonymous', v);
      $('drReply').value = '';
      document.activeElement.blur();
    };
  }

  // ------------------------------------------------------------- header actions
  $('author').addEventListener('change', e => S.saveSettings({ author: e.target.value.trim() }));

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  $('exportJson').onclick = () => download(`foxio-${stamp()}.json`,
    JSON.stringify({ app: 'foxio', version: 1, exportedAt: Date.now(), comments: filtered() }, null, 2), 'application/json');

  $('exportCsv').onclick = () => {
    const cols = ['number', 'status', 'priority', 'type', 'heuristic', 'body', 'url', 'site', 'author', 'createdAt', 'replies', 'selector'];
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = filtered().map(c => [c.number, label(S.STATUSES, c.status), label(S.PRIORITIES, c.priority), label(S.TYPES, c.type),
      (HEUR.find(h => h.id === c.heuristic) || {}).name || '', c.body, c.url, c.site, c.author,
      new Date(c.createdAt).toISOString(), (c.replies || []).length, (c.anchor || {}).selector].map(cell).join(','));
    download(`foxio-${stamp()}.csv`, [cols.join(','), ...rows].join('\n'), 'text/csv');
  };

  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.comments;
      if (!Array.isArray(list)) throw new Error('No comments found in this file.');
      const r = await S.importMany(list);
      alert(`Imported ${r.added} new and ${r.updated} updated comments.`);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };

  // ------------------------------------------------------------- filters wiring
  $('q').addEventListener('input', e => { state.f.q = e.target.value; render(); });
  [['fSite', 'site'], ['fPage', 'page'], ['fPriority', 'priority'], ['fType', 'type'], ['fHeur', 'heur'], ['fSource', 'source']].forEach(([id, k]) =>
    $(id).addEventListener('change', e => {
      state.f[k] = e.target.value;
      if (k === 'site') { state.f.page = ''; renderFilters(); }
      render();
    }));
  $('groupBy').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    state.groupBy = b.dataset.v;
    localStorage.setItem('foxio.groupBy', state.groupBy);
    render();
  });

  function timeAgo(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    const m = Math.round(s / 60); if (m < 60) return m + 'm';
    const h = Math.round(m / 60); if (h < 24) return h + 'h';
    const d = Math.round(h / 24); if (d < 30) return d + 'd';
    return new Date(t).toLocaleDateString();
  }

  // ------------------------------------------------------------- boot
  S.onChange(load);
  load().then(() => {
    const focus = new URLSearchParams(location.search).get('focus');
    if (focus && state.comments.some(c => c.id === focus)) openDrawer(focus);
  });
})();
