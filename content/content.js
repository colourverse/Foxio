// Foxio on-page overlay: toolbar, element picker, comment composer and pins.
// All UI lives in a closed-off shadow root so page styles can't leak in.
(() => {
  if (window.top !== window || window.__foxioLoaded) return;
  window.__foxioLoaded = true;

  const S = globalThis.FoxioStore;
  const HEUR = globalThis.FoxioHeuristics;
  const FOX = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 12l16 12h12l16-12-2 22c-1 11-10 20-20 22-10-2-19-11-20-22z" fill="#FF6A13"/><path d="M18 36c4 1 9 4 14 12 5-8 10-11 14-12-2 9-8 15-14 17-6-2-12-8-14-17z" fill="#fff"/><circle cx="24" cy="33" r="3" fill="#1d1b22"/><circle cx="40" cy="33" r="3" fill="#1d1b22"/><path d="M29 46h6l-3 4z" fill="#1d1b22"/></svg>';

  let host = null, root = null, el = {};
  let active = false, commentMode = false, showPins = true;
  let comments = [], settings = { author: '' };
  let pop = null; // { node, commentId?, anchor?, point? }
  let ticker = null, rafQueued = false, lastHref = location.href;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isOurs = e => !!host && e.composedPath().includes(host);
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const send = msg => chrome.runtime.sendMessage(msg).catch(() => null);
  const author = () => settings.author || 'Anonymous';

  // ------------------------------------------------------------------ UI shell
  async function buildUI() {
    if (host) return;
    host = document.createElement('foxio-overlay');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block;';
    root = host.attachShadow({ mode: 'open' });
    const css = await fetch(chrome.runtime.getURL('content/overlay.css')).then(r => r.text());
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = `
      <div class="pins"></div>
      <div class="hl" hidden><span class="hl-tag"></span></div>
      <div class="draft-pin" hidden>+</div>
      <div class="hint" hidden>Click any element to comment on it &middot; <kbd>Esc</kbd> to cancel</div>
      <div class="toolbar" role="toolbar" aria-label="Foxio">
        <span class="brand" title="Foxio">${FOX}</span>
        <button class="tb" data-act="comment" title="Add a comment (C)">
          <svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 7v6M9 10h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span>Comment</span>
        </button>
        <button class="tb" data-act="pins" title="Show / hide pins (P)">
          <svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
          <span class="count">0</span>
        </button>
        <button class="tb" data-act="board" title="Open the Foxio board">
          <svg viewBox="0 0 24 24"><rect x="3" y="4" width="5" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10" y="4" width="5" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="17" y="4" width="4" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          <span>Board</span>
        </button>
        <button class="tb icon" data-act="close" title="Close Foxio (Alt+Shift+F)">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>`;
    el = {
      pins: root.querySelector('.pins'),
      hl: root.querySelector('.hl'),
      hlTag: root.querySelector('.hl-tag'),
      draftPin: root.querySelector('.draft-pin'),
      hint: root.querySelector('.hint'),
      toolbar: root.querySelector('.toolbar'),
      count: root.querySelector('.count'),
      commentBtn: root.querySelector('[data-act="comment"]'),
      pinsBtn: root.querySelector('[data-act="pins"]')
    };

    root.addEventListener('click', onUIClick);
    // Keep our own interactions from reaching the page's handlers.
    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress', 'input', 'focusin']
      .forEach(t => host.addEventListener(t, e => e.stopPropagation()));

    document.documentElement.appendChild(host);

    // Crosshair cursor while picking. Constructable sheets aren't blocked by page CSP.
    try {
      const pageSheet = new CSSStyleSheet();
      pageSheet.replaceSync('html.foxio-picking, html.foxio-picking * { cursor: crosshair !important; }');
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat([pageSheet]);
    } catch (e) {}
  }

  function onUIClick(e) {
    const btn = e.target.closest('[data-act]');
    if (btn && el.toolbar.contains(btn)) {
      const act = btn.dataset.act;
      if (act === 'comment') setCommentMode(!commentMode);
      else if (act === 'pins') togglePins();
      else if (act === 'board') send({ type: 'foxio:openBoard' });
      else if (act === 'close') deactivate();
      return;
    }
    const pin = e.target.closest('.pin');
    if (pin) openViewer(pin.dataset.id);
  }

  // ------------------------------------------------------------- activation
  async function activate(focusId) {
    await buildUI();
    settings = await S.getSettings();
    if (!active) {
      active = true;
      host.style.display = 'block';
      addPageListeners();
      ticker = setInterval(tick, 700);
      send({ type: 'foxio:setActive', active: true });
    }
    await loadComments();
    if (focusId) focusComment(focusId);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    setCommentMode(false);
    closePop();
    clearInterval(ticker);
    removePageListeners();
    if (host) host.style.display = 'none';
    send({ type: 'foxio:setActive', active: false });
  }

  function setCommentMode(on) {
    commentMode = on;
    if (!host) return;
    el.commentBtn.classList.toggle('on', on);
    el.hint.hidden = !on;
    if (!on) el.hl.hidden = true;
    document.documentElement.classList.toggle('foxio-picking', on);
    if (on) closePop();
  }

  function togglePins() {
    showPins = !showPins;
    el.pinsBtn.classList.toggle('off', !showPins);
    renderPins();
  }

  // ------------------------------------------------------------ page events
  const listeners = [
    ['mousemove', onMove], ['click', onPick], ['pointerdown', blockWhilePicking],
    ['mousedown', blockWhilePicking], ['mouseup', blockWhilePicking], ['pointerup', blockWhilePicking],
    ['dblclick', blockWhilePicking], ['keydown', onKey], ['scroll', schedulePosition], ['resize', schedulePosition]
  ];
  function addPageListeners() { listeners.forEach(([t, f]) => window.addEventListener(t, f, true)); }
  function removePageListeners() { listeners.forEach(([t, f]) => window.removeEventListener(t, f, true)); }

  function onMove(e) {
    if (!commentMode || isOurs(e)) { if (el.hl) el.hl.hidden = true; return; }
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    const r = t.getBoundingClientRect();
    Object.assign(el.hl.style, { transform: `translate(${r.left}px, ${r.top}px)`, width: r.width + 'px', height: r.height + 'px' });
    el.hlTag.textContent = describe(t) + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    el.hl.classList.toggle('tag-below', r.top < 24);
    el.hl.hidden = false;
  }

  function blockWhilePicking(e) {
    if (!commentMode || isOurs(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onPick(e) {
    if (!commentMode || isOurs(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.target && e.target.nodeType === 1) startDraft(e.target, e);
  }

  function onKey(e) {
    const t = e.composedPath()[0];
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (e.key === 'Escape') {
      if (pop) { closePop(); e.stopPropagation(); }
      else if (commentMode) { setCommentMode(false); e.stopPropagation(); }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'c') { setCommentMode(!commentMode); e.preventDefault(); e.stopPropagation(); }
    else if (k === 'p') { togglePins(); e.preventDefault(); e.stopPropagation(); }
  }

  function schedulePosition() {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => { rafQueued = false; positionAll(); });
  }

  function tick() {
    if (location.href !== lastHref) { // SPA navigation
      const changedPage = S.pageKeyOf(location.href) !== S.pageKeyOf(lastHref);
      lastHref = location.href;
      if (changedPage) { closePop(); loadComments(); }
    }
    positionAll();
  }

  // -------------------------------------------------------------- anchoring
  function describe(node) {
    let s = node.tagName.toLowerCase();
    if (node.id) s += '#' + node.id;
    else if (typeof node.className === 'string' && node.className.trim()) {
      s += '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return s;
  }

  function cssPath(node) {
    if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) return '#' + CSS.escape(node.id);
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur.id && document.querySelectorAll('#' + CSS.escape(cur.id)).length === 1) {
        parts.unshift('#' + CSS.escape(cur.id));
        break;
      }
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function xPath(node) {
    const parts = [];
    for (let cur = node; cur && cur.nodeType === 1; cur = cur.parentNode) {
      let i = 1;
      for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.tagName === cur.tagName) i++;
      parts.unshift(cur.tagName.toLowerCase() + '[' + i + ']');
    }
    return '/' + parts.join('/');
  }

  function buildAnchor(node, e, r) {
    return {
      selector: cssPath(node),
      xpath: xPath(node),
      offsetX: r.width ? (e.clientX - r.left) / r.width : 0,
      offsetY: r.height ? (e.clientY - r.top) / r.height : 0,
      docX: e.clientX + window.scrollX,
      docY: e.clientY + window.scrollY,
      tag: node.tagName.toLowerCase(),
      label: describe(node),
      text: (node.innerText || node.getAttribute('alt') || node.getAttribute('aria-label') || node.value || '').trim().replace(/\s+/g, ' ').slice(0, 140)
    };
  }

  function findAnchorEl(a) {
    let n = null;
    try { n = document.querySelector(a.selector); } catch (e) {}
    if (!n && a.xpath) {
      try { n = document.evaluate(a.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch (e) {}
    }
    return n;
  }

  function resolveAnchor(a) {
    const n = a && findAnchorEl(a);
    if (n) {
      const r = n.getBoundingClientRect();
      if (r.width || r.height) return { x: r.left + r.width * a.offsetX, y: r.top + r.height * a.offsetY, found: true, node: n };
    }
    if (!a) return { x: -100, y: -100, found: false };
    return { x: a.docX - window.scrollX, y: a.docY - window.scrollY, found: false };
  }

  // ------------------------------------------------------------------- pins
  async function loadComments() {
    comments = await S.forPage(location.href);
    if (!host) return;
    el.count.textContent = comments.filter(c => c.status !== 'done').length;
    renderPins();
    if (pop && pop.commentId && !comments.some(c => c.id === pop.commentId)) closePop();
  }

  function renderPins() {
    if (!host) return;
    if (!showPins) { el.pins.innerHTML = ''; return; }
    const ids = new Set(comments.map(c => c.id));
    Array.from(el.pins.children).forEach(n => { if (!ids.has(n.dataset.id)) n.remove(); });
    for (const c of comments) {
      let n = el.pins.querySelector(`[data-id="${c.id}"]`);
      if (!n) {
        n = document.createElement('button');
        n.dataset.id = c.id;
        el.pins.appendChild(n);
      }
      n.className = `pin prio-${c.priority}${c.status === 'done' ? ' done' : ''}${c.source === 'audit' ? ' audit' : ''}`;
      n.textContent = c.status === 'done' ? '✓' : c.number;
      n.title = `#${c.number} ${c.body.slice(0, 90)}`;
      n.setAttribute('aria-label', `Comment ${c.number}: ${c.body.slice(0, 90)}`);
    }
    positionAll();
  }

  function positionAll() {
    if (!host || !active) return;
    const byId = new Map(comments.map(c => [c.id, c]));
    for (const n of el.pins.children) {
      const c = byId.get(n.dataset.id);
      if (!c) continue;
      const p = resolveAnchor(c.anchor);
      n.style.transform = `translate(${p.x}px, ${p.y}px)`;
      n.classList.toggle('lost', !p.found);
    }
    if (pop) {
      let p = null;
      if (pop.commentId) { const c = byId.get(pop.commentId); if (c) p = resolveAnchor(c.anchor); }
      else if (pop.anchor) p = resolveAnchor(pop.anchor);
      if (p) {
        placePop(pop.node, p.x, p.y);
        if (!pop.commentId) el.draftPin.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
    }
  }

  // --------------------------------------------------------------- popovers
  function closePop() {
    if (pop) pop.node.remove();
    pop = null;
    if (el.draftPin) el.draftPin.hidden = true;
    if (el.pins) el.pins.querySelectorAll('.pin.selected').forEach(p => p.classList.remove('selected'));
  }

  function placePop(node, x, y) {
    const w = node.offsetWidth || 340, h = node.offsetHeight || 300, m = 12;
    let left = x + 22, top = y - 20;
    if (left + w > window.innerWidth - m) left = x - w - 22;
    if (left < m) left = Math.max(m, Math.min(window.innerWidth - w - m, x - w / 2));
    top = Math.max(m, Math.min(window.innerHeight - h - m, top));
    node.style.transform = `translate(${left}px, ${top}px)`;
  }

  function showPop(node, extra) {
    closePop();
    root.appendChild(node);
    pop = Object.assign({ node }, extra);
    positionAll();
  }

  const opt = (list, sel) => list.map(o => `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${esc(o.label || o.name)}</option>`).join('');

  async function startDraft(node, e) {
    const r = node.getBoundingClientRect();
    const anchor = buildAnchor(node, e, r);
    const point = { x: e.clientX, y: e.clientY };
    setCommentMode(false);

    // Hide the overlay while we screenshot so it doesn't end up in the image.
    host.style.visibility = 'hidden';
    await frame(); await frame();
    const shot = await send({
      type: 'foxio:capture',
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      point,
      viewport: { w: window.innerWidth, h: window.innerHeight }
    });
    host.style.visibility = '';
    openComposer(anchor, shot && shot.dataUrl || null);
  }

  function openComposer(anchor, screenshot) {
    const node = document.createElement('div');
    node.className = 'pop composer';
    node.innerHTML = `
      <div class="pop-head">
        <strong>New feedback</strong>
        <span class="target" title="${esc(anchor.selector)}">${esc(anchor.label)}</span>
        <button class="x" data-act="cancel" aria-label="Cancel">&times;</button>
      </div>
      ${screenshot ? `<img class="shot" src="${screenshot}" alt="Screenshot of the selected element">` : ''}
      <textarea rows="4" placeholder="What should change here, and why?"></textarea>
      <div class="chips" role="radiogroup" aria-label="Type">
        ${S.TYPES.map((t, i) => `<button class="chip${i === 0 ? ' on' : ''}" data-type="${t.id}" role="radio" aria-checked="${i === 0}">${t.label}</button>`).join('')}
      </div>
      <div class="grid">
        <label>Priority<select name="priority">${opt(S.PRIORITIES, 'medium')}</select></label>
        <label>Heuristic<select name="heuristic"><option value="">None</option>${HEUR.map(h => `<option value="${h.id}" title="${esc(h.desc)}">${esc(h.short)}</option>`).join('')}</select></label>
      </div>
      <div class="actions">
        <span class="kbd">⌘/Ctrl + Enter to save</span>
        <button class="btn ghost" data-act="cancel">Cancel</button>
        <button class="btn primary" data-act="save">Save</button>
      </div>`;
    const ta = node.querySelector('textarea');
    let type = 'issue';
    node.addEventListener('click', ev => {
      const chip = ev.target.closest('.chip');
      if (chip) {
        type = chip.dataset.type;
        node.querySelectorAll('.chip').forEach(c => { c.classList.toggle('on', c === chip); c.setAttribute('aria-checked', c === chip); });
        return;
      }
      const act = ev.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'cancel') closePop();
      if (act.dataset.act === 'save') save();
    });
    ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); save(); } });

    async function save() {
      const body = ta.value.trim();
      if (!body) { ta.classList.add('invalid'); ta.focus(); return; }
      node.querySelector('[data-act="save"]').disabled = true;
      await S.create({
        url: location.href,
        pageTitle: document.title,
        anchor,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        body,
        type,
        priority: node.querySelector('[name="priority"]').value,
        heuristic: node.querySelector('[name="heuristic"]').value || null,
        screenshot,
        author: author()
      });
      closePop();
      await loadComments();
      send({ type: 'foxio:changed' });
    }

    showPop(node, { anchor });
    el.draftPin.hidden = false;
    setTimeout(() => ta.focus(), 0);
  }

  function openViewer(id) {
    const c = comments.find(x => x.id === id);
    if (!c) return;
    const h = HEUR.find(x => x.id === c.heuristic);
    const type = S.TYPES.find(t => t.id === c.type);
    const node = document.createElement('div');
    node.className = 'pop viewer';
    node.innerHTML = `
      <div class="pop-head">
        <span class="num prio-${c.priority}">${c.number}</span>
        <strong>${esc(type ? type.label : c.type)}</strong>
        <span class="muted">${esc(c.author)} &middot; ${timeAgo(c.createdAt)}</span>
        <button class="x" data-act="close" aria-label="Close">&times;</button>
      </div>
      <p class="body">${esc(c.body)}</p>
      ${h ? `<span class="heur" title="${esc(h.desc)}">${esc(h.name)}</span>` : ''}
      ${c.source === 'audit' ? '<span class="heur audit">Automated audit</span>' : ''}
      ${(c.replies || []).length ? `<ul class="replies">${c.replies.map(r => `<li><b>${esc(r.author)}</b> <span class="muted">${timeAgo(r.createdAt)}</span><br>${esc(r.body)}</li>`).join('')}</ul>` : ''}
      <div class="grid">
        <label>Status<select name="status">${opt(S.STATUSES, c.status)}</select></label>
        <label>Priority<select name="priority">${opt(S.PRIORITIES, c.priority)}</select></label>
      </div>
      <textarea rows="2" placeholder="Reply…"></textarea>
      <div class="actions">
        <button class="btn danger" data-act="delete">Delete</button>
        <span class="spacer"></span>
        <button class="btn ghost" data-act="board">Open in board</button>
        <button class="btn primary" data-act="reply">Reply</button>
      </div>`;
    node.addEventListener('change', async ev => {
      const name = ev.target.name;
      if (name === 'status' || name === 'priority') {
        await S.update(c.id, { [name]: ev.target.value });
        await loadComments();
        send({ type: 'foxio:changed' });
      }
    });
    node.addEventListener('click', async ev => {
      const act = ev.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'close') closePop();
      else if (a === 'board') send({ type: 'foxio:openBoard', focus: c.id });
      else if (a === 'delete') {
        if (!confirm(`Delete comment #${c.number}?`)) return;
        await S.remove(c.id);
        closePop();
        await loadComments();
        send({ type: 'foxio:changed' });
      } else if (a === 'reply') {
        const ta = node.querySelector('textarea');
        if (!ta.value.trim()) return ta.focus();
        await S.addReply(c.id, author(), ta.value);
        await loadComments();
        openViewer(c.id);
      }
    });
    showPop(node, { commentId: c.id });
    const pinNode = el.pins.querySelector(`[data-id="${c.id}"]`);
    if (pinNode) pinNode.classList.add('selected');
  }

  function focusComment(id) {
    const c = comments.find(x => x.id === id);
    if (!c) return;
    const n = findAnchorEl(c.anchor);
    if (n) n.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else window.scrollTo({ top: c.anchor.docY - window.innerHeight / 2, behavior: 'smooth' });
    setTimeout(() => openViewer(id), 450);
  }

  function timeAgo(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
    const d = Math.round(h / 24); if (d < 30) return d + 'd ago';
    return new Date(t).toLocaleDateString();
  }

  // ------------------------------------------------------------- wiring
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m.type === 'foxio:toggle') {
      (active ? Promise.resolve(deactivate()) : activate()).then(() => reply({ active }));
      return true;
    }
    if (m.type === 'foxio:focus') {
      activate(m.id).then(() => reply({ ok: true }));
      return true;
    }
  });

  S.onChange(() => {
    if (!active) return;
    S.getSettings().then(s => { settings = s; });
    loadComments();
  });

  send({ type: 'foxio:hello' }).then(r => { if (r && r.active) activate(r.focusId); });
})();
