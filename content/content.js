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
  let audit = null; // { node, result, hoverEl, busy }

  // While the pointer is on a pin (or its open card), that pin stays where it is
  // on the page instead of following its element. Otherwise elements that move or
  // resize on :hover create a loop: pointer on pin -> element loses hover and moves
  // -> pin moves away -> pointer is over the element again -> it moves back.
  const lastPos = new Map(); // comment id or 'draft' -> last viewport position
  let frozenKey = null, frozenAt = null, unfreezeTimer = null;

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
        <button class="tb" data-act="audit" title="Run a UX audit of this page (A)">
          <svg viewBox="0 0 24 24"><path d="M12 3l2.2 5.3L20 9l-4.4 3.8L17 19l-5-3-5 3 1.4-6.2L4 9l5.8-.7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          <span>Audit</span>
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
      auditBtn: root.querySelector('[data-act="audit"]'),
      pinsBtn: root.querySelector('[data-act="pins"]')
    };

    root.addEventListener('click', onUIClick);
    root.addEventListener('pointerover', e => { const k = freezeKeyOf(e.target); if (k) freeze(k); });
    root.addEventListener('pointerout', e => {
      if (!frozenKey || freezeKeyOf(e.relatedTarget) === frozenKey) return;
      clearTimeout(unfreezeTimer);
      // Grace period so moving from a pin to its card (across the page) doesn't unfreeze.
      unfreezeTimer = setTimeout(() => { frozenKey = null; frozenAt = null; positionAll(); }, 300);
    });
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
    const guide = e.target.closest('[data-act="guide"]');
    if (guide) { send({ type: 'foxio:openGuide', id: guide.dataset.h || '' }); return; }
    const btn = e.target.closest('[data-act]');
    if (btn && el.toolbar.contains(btn)) {
      const act = btn.dataset.act;
      if (act === 'comment') setCommentMode(!commentMode);
      else if (act === 'audit') audit ? closeAudit() : runAudit();
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
    closeAudit();
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
    showHighlight(t);
  }

  function showHighlight(t) {
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
      else if (audit && !audit.busy) { closeAudit(); e.stopPropagation(); }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'c') { setCommentMode(!commentMode); e.preventDefault(); e.stopPropagation(); }
    else if (k === 'p') { togglePins(); e.preventDefault(); e.stopPropagation(); }
    else if (k === 'a' && !audit) { runAudit(); e.preventDefault(); e.stopPropagation(); }
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
    if (node === document.documentElement) return 'html';
    if (node === document.body) return 'body';
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

  // Anchor for an element we didn't click (audit findings): pin near its top-left corner.
  function anchorFor(node) {
    const r = node.getBoundingClientRect();
    const fake = { clientX: r.left + Math.min(10, r.width / 2), clientY: r.top + Math.min(10, r.height / 2) };
    return buildAnchor(node, fake, r);
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

  function freezeKeyOf(node) {
    if (!node || !root || !(node instanceof Node) || node.getRootNode() !== root) return null;
    const pin = node.closest && node.closest('.pin');
    if (pin) return pin.dataset.id;
    if (pop && pop.node.contains(node)) return pop.commentId || 'draft';
    return null;
  }

  function freeze(key) {
    clearTimeout(unfreezeTimer);
    if (key === frozenKey) return;
    const p = lastPos.get(key);
    frozenKey = p ? key : null;
    // Stored in document coordinates so a frozen pin still scrolls with the page.
    frozenAt = p ? { x: p.x + window.scrollX, y: p.y + window.scrollY } : null;
  }

  function posFor(key, anchor) {
    if (key === frozenKey && frozenAt) return { x: frozenAt.x - window.scrollX, y: frozenAt.y - window.scrollY, found: true, frozen: true };
    const p = resolveAnchor(anchor);
    lastPos.set(key, p);
    return p;
  }

  function positionAll() {
    if (!host || !active) return;
    const byId = new Map(comments.map(c => [c.id, c]));
    for (const n of el.pins.children) {
      const c = byId.get(n.dataset.id);
      if (!c) continue;
      const p = posFor(c.id, c.anchor);
      // Use the `translate` property, not `transform`: the hover `scale` would
      // otherwise multiply the offset and fling the pin away from the cursor.
      n.style.translate = `${p.x}px ${p.y}px`;
      if (!p.frozen) n.classList.toggle('lost', !p.found);
    }
    if (audit && audit.hoverEl) showHighlight(audit.hoverEl);
    if (pop) {
      let p = null;
      if (pop.commentId) { const c = byId.get(pop.commentId); if (c) p = posFor(c.id, c.anchor); }
      else if (pop.anchor) p = posFor('draft', pop.anchor);
      if (p) {
        placePop(pop.node, p.x, p.y);
        if (!pop.commentId) el.draftPin.style.translate = `${p.x}px ${p.y}px`;
      }
    }
  }

  // --------------------------------------------------------------- popovers
  function closePop() {
    // A removed node may never fire pointerout, so drop a frozen draft position here.
    if (frozenKey === 'draft') { frozenKey = null; frozenAt = null; }
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
      <p class="heur-hint" aria-live="polite"></p>
      <div class="actions">
        <span class="kbd">⌘/Ctrl + Enter to save</span>
        <button class="btn ghost" data-act="cancel">Cancel</button>
        <button class="btn primary" data-act="save">Save</button>
      </div>`;
    const ta = node.querySelector('textarea');
    let type = 'issue';
    const hint = node.querySelector('.heur-hint');
    const renderHint = () => {
      const h = HEUR.find(x => x.id === node.querySelector('[name="heuristic"]').value);
      hint.innerHTML = h
        ? `<b>${esc(h.name)}.</b> ${esc(h.desc)} <button class="link" data-act="guide" data-h="${h.id}">Guide \u2197</button>`
        : `Optional: tag the usability principle this relates to. <button class="link" data-act="guide">What do these mean? \u2197</button>`;
    };
    renderHint();
    node.querySelector('[name="heuristic"]').addEventListener('change', renderHint);
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
      ${h ? `<button class="heur" data-act="guide" data-h="${h.id}" title="${esc(h.desc)} \u2014 open the heuristics guide">${esc(h.name)} <span aria-hidden="true">\u2197</span></button>` : ''}
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

  // ------------------------------------------------------------- UX audit (Phase 2)
  function auditKey(f) { return f.ruleId + '|' + cssPath(f.el); }
  const isPageLevel = n => n === document.body || n === document.documentElement;

  function closeAudit() {
    if (!audit || audit.busy) return;
    audit.node.remove();
    audit = null;
    if (el.hl) el.hl.hidden = true;
    if (el.auditBtn) el.auditBtn.classList.remove('on');
  }

  async function runAudit() {
    await buildUI();
    if (!active) await activate();
    if (audit) closeAudit();
    setCommentMode(false);
    closePop();
    const AUD = globalThis.FoxioAudit;
    const result = AUD.run();
    if (result.errors.length) console.warn('[Foxio audit] rule errors:', result.errors);
    await loadComments();

    // Compare with open audit findings already on the board for this page.
    const openAudit = comments.filter(c => c.source === 'audit' && c.audit && c.status !== 'done');
    const known = new Set(openAudit.map(c => c.audit.key));
    result.findings.forEach(f => { f.key = auditKey(f); f.onBoard = known.has(f.key); });
    const foundKeys = new Set(result.findings.map(f => f.key));
    const ranRules = new Set(AUD.rules.map(r => r.id));
    // Only call a finding "fixed" when its rule ran and its list wasn't truncated.
    const fixed = openAudit.filter(c => ranRules.has(c.audit.rule) && !result.truncated[c.audit.rule] && !foundKeys.has(c.audit.key));

    const SEV = AUD.SEVERITY;
    const counts = { blocker: 0, major: 0, minor: 0, cosmetic: 0 };
    result.findings.forEach(f => counts[f.severity]++);
    const fresh = result.findings.filter(f => !f.onBoard);
    const scoreClass = result.score >= 85 ? 'good' : result.score >= 60 ? 'ok' : 'poor';
    const more = Object.values(result.truncated).reduce((a, b) => a + b, 0);

    const node = document.createElement('div');
    node.className = 'audit-panel';
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', 'UX audit results');
    node.innerHTML = `
      <div class="pop-head">
        <strong>UX audit</strong>
        <span class="muted">${result.findings.length} finding${result.findings.length === 1 ? '' : 's'} &middot; ${result.ruleCount} checks &middot; ${result.ms}ms</span>
        <button class="x" data-act="close" aria-label="Close">&times;</button>
      </div>
      <div class="ap-score">
        <div class="score ${scoreClass}" title="Heuristic score: 100 minus weighted findings">${result.score}</div>
        <div class="ap-counts">
          ${['blocker', 'major', 'minor', 'cosmetic'].filter(s => counts[s]).map(s => `<span class="sev sev-${s}">${counts[s]} ${SEV[s].label.toLowerCase()}</span>`).join('') || '<span class="muted">No issues found by the automated checks.</span>'}
          ${more ? `<div class="muted small">+${more} more similar issue${more > 1 ? 's' : ''} not listed</div>` : ''}
        </div>
      </div>
      ${fresh.length ? `
      <div class="ap-tools">
        <button class="link" data-act="all">Select all</button>
        <button class="link" data-act="none">Select none</button>
      </div>` : ''}
      <ol class="ap-list">
        ${result.findings.map((f, i) => {
          const h = HEUR.find(x => x.id === f.heuristic);
          return `
          <li class="finding${f.onBoard ? ' on-board' : ''}" data-i="${i}">
            <input type="checkbox" id="f${i}" ${f.onBoard ? 'disabled' : 'checked'}>
            <div class="f-main">
              <div class="f-top">
                <span class="sev sev-${f.severity}">${SEV[f.severity].label}</span>
                ${h ? `<button class="f-heur" data-act="guide" data-h="${h.id}" title="${esc(h.name)}: ${esc(h.desc)}">${esc(h.short)}</button>` : ''}
                ${f.onBoard ? '<span class="f-heur done">On board</span>' : ''}
                ${isPageLevel(f.el) ? '' : `<button class="locate" data-act="locate" title="Show on page" aria-label="Show on page">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                </button>`}
              </div>
              <label for="f${i}" class="f-title">${esc(f.title)}</label>
              <p class="f-detail">${esc(f.detail)}</p>
              <p class="f-fix"><b>Fix:</b> ${esc(f.suggestion)}</p>
            </div>
          </li>`;
        }).join('')}
      </ol>
      ${fixed.length ? `
      <label class="ap-fixed"><input type="checkbox" id="apFixed" checked>
        Mark ${fixed.length} earlier finding${fixed.length > 1 ? 's' : ''} as Done (no longer detected)</label>` : ''}
      <div class="actions">
        ${fresh.length ? '<label class="shots"><input type="checkbox" id="apShots" checked> Screenshots</label>' : ''}
        <span class="spacer"></span>
        <button class="btn ghost" data-act="close">Close</button>
        ${fresh.length || fixed.length ? '<button class="btn primary" data-act="accept"></button>' : ''}
      </div>`;

    root.appendChild(node);
    audit = { node, hoverEl: null, busy: false };
    el.auditBtn.classList.add('on');

    const acceptBtn = node.querySelector('[data-act="accept"]');
    const selected = () => result.findings.filter((f, i) => !f.onBoard && node.querySelector('#f' + i).checked);
    const fixedChosen = () => { const fx = node.querySelector('#apFixed'); return fx && fx.checked ? fixed : []; };
    const updateCount = () => {
      if (!acceptBtn) return;
      const n = selected().length, nf = fixedChosen().length;
      acceptBtn.textContent = n ? `Add ${n} to board` : nf ? `Mark ${nf} done` : 'Add to board';
      acceptBtn.disabled = !n && !nf;
    };
    updateCount();

    node.addEventListener('change', updateCount);
    node.addEventListener('mouseover', e => {
      if (!audit) return;
      const li = e.target.closest('.finding');
      const f = li && result.findings[+li.dataset.i];
      const target = f && f.el.isConnected && !isPageLevel(f.el) ? f.el : null;
      if (target === audit.hoverEl) return;
      audit.hoverEl = target;
      if (target) showHighlight(target); else el.hl.hidden = true;
    });
    node.addEventListener('mouseleave', () => { if (audit) { audit.hoverEl = null; el.hl.hidden = true; } });
    node.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]');
      if (!act || audit.busy) return;
      const a = act.dataset.act;
      if (a === 'close') closeAudit();
      else if (a === 'all' || a === 'none') {
        node.querySelectorAll('.finding:not(.on-board) input').forEach(c => { c.checked = a === 'all'; });
        updateCount();
      } else if (a === 'locate') {
        const f = result.findings[+act.closest('.finding').dataset.i];
        if (f.el.isConnected) { f.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); audit.hoverEl = f.el; }
      } else if (a === 'accept') {
        const shots = node.querySelector('#apShots');
        await acceptAudit(selected(), !!(shots && shots.checked), fixedChosen(), acceptBtn);
      }
    });
  }

  async function acceptAudit(list, withShots, fixedList, btn) {
    const SEV = globalThis.FoxioAudit.SEVERITY;
    const MAX_SHOTS = 20;
    const startY = window.scrollY;
    audit.busy = true;
    audit.node.classList.add('busy');
    btn.disabled = true;
    let added = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (!f.el.isConnected) continue;
        btn.textContent = `Adding ${i + 1} of ${list.length}…`;
        let screenshot = null;
        if (withShots && i < MAX_SHOTS && !isPageLevel(f.el)) {
          f.el.scrollIntoView({ block: 'center', behavior: 'instant' });
          host.style.visibility = 'hidden';
          await frame(); await frame();
          const r = f.el.getBoundingClientRect();
          const a = anchorFor(f.el);
          const res = await send({
            type: 'foxio:capture',
            rect: { x: r.left, y: r.top, w: r.width, h: r.height },
            point: { x: a.docX - window.scrollX, y: a.docY - window.scrollY },
            viewport: { w: window.innerWidth, h: window.innerHeight }
          });
          host.style.visibility = '';
          screenshot = res && res.dataUrl || null;
        }
        await S.create({
          url: location.href,
          pageTitle: document.title,
          anchor: anchorFor(f.el),
          viewport: { w: window.innerWidth, h: window.innerHeight },
          body: `${f.title}\n\n${f.detail}\n\nSuggested fix: ${f.suggestion}`,
          type: f.type,
          priority: f.priority,
          heuristic: f.heuristic,
          screenshot,
          author: 'Foxio audit',
          source: 'audit',
          audit: { rule: f.ruleId, key: f.key, severity: SEV[f.severity].label }
        });
        added++;
      }
      for (const c of fixedList) await S.update(c.id, { status: 'done' });
    } finally {
      host.style.visibility = '';
      window.scrollTo({ top: startY, behavior: 'instant' });
      audit.busy = false;
      closeAudit();
    }
    await loadComments();
    send({ type: 'foxio:changed' });
    const parts = [];
    if (added) parts.push(`Added ${added} finding${added > 1 ? 's' : ''} to the board`);
    if (fixedList.length) parts.push(`${fixedList.length} marked done`);
    toast(parts.join(' · '));
  }

  function toast(text) {
    if (!text) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    root.appendChild(t);
    setTimeout(() => t.remove(), 3200);
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
    if (m.type === 'foxio:audit') {
      activate().then(() => { runAudit(); reply({ ok: true }); });
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
