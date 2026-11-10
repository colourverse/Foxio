// Foxio data layer. Classic script (no modules) so the same file works in the
// service worker (importScripts), content scripts and extension pages.
//
// Each comment is stored under its own key ("comment:<id>") in
// chrome.storage.local so concurrent edits from different tabs never clobber
// one another. To move to a shared backend later, re-implement this file's
// public API against a server and keep the callers unchanged.
(function (g) {
  const PREFIX = 'comment:';
  const SETTINGS_KEY = 'settings';

  const STATUSES = [
    { id: 'backlog', label: 'Backlog' },
    { id: 'todo', label: 'To do' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'done', label: 'Done' }
  ];
  const PRIORITIES = [
    { id: 'critical', label: 'Critical' },
    { id: 'high', label: 'High' },
    { id: 'medium', label: 'Medium' },
    { id: 'low', label: 'Low' }
  ];
  const TYPES = [
    { id: 'issue', label: 'Issue' },
    { id: 'suggestion', label: 'Suggestion' },
    { id: 'question', label: 'Question' },
    { id: 'praise', label: 'Praise' }
  ];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Comments belong to a page: origin + path, ignoring query string and hash.
  function pageKeyOf(url) {
    try {
      const u = new URL(url);
      return u.origin + (u.pathname.replace(/\/+$/, '') || '/');
    } catch (e) {
      return String(url);
    }
  }

  async function all() {
    const items = await chrome.storage.local.get(null);
    return Object.keys(items).filter(k => k.startsWith(PREFIX)).map(k => items[k]);
  }

  async function forPage(url) {
    const key = pageKeyOf(url);
    return (await all()).filter(c => c.pageKey === key).sort((a, b) => a.number - b.number);
  }

  async function get(id) {
    const k = PREFIX + id;
    return (await chrome.storage.local.get(k))[k] || null;
  }

  async function create(data) {
    const now = Date.now();
    const pageKey = pageKeyOf(data.url);
    const existing = (await all()).filter(c => c.pageKey === pageKey);
    const number = existing.reduce((m, c) => Math.max(m, c.number || 0), 0) + 1;
    let site = '';
    try { site = new URL(data.url).hostname || 'local file'; } catch (e) {}
    const c = {
      id: uid(),
      number,
      createdAt: now,
      updatedAt: now,
      url: data.url,
      pageKey,
      site,
      pageTitle: data.pageTitle || '',
      anchor: data.anchor || null,
      viewport: data.viewport || null,
      body: (data.body || '').trim(),
      type: data.type || 'issue',
      priority: data.priority || 'medium',
      status: data.status || 'backlog',
      heuristic: data.heuristic || null,
      order: -now, // newest first within a column
      screenshot: data.screenshot || null,
      author: data.author || 'Anonymous',
      source: data.source || 'manual', // 'manual' | 'audit' (Phase 2)
      audit: data.audit || null, // { rule, key } for audit findings, used to dedupe re-runs
      replies: []
    };
    await chrome.storage.local.set({ [PREFIX + c.id]: c });
    return c;
  }

  async function update(id, patch) {
    const c = await get(id);
    if (!c) return null;
    const next = Object.assign({}, c, patch, { id: c.id, updatedAt: Date.now() });
    await chrome.storage.local.set({ [PREFIX + id]: next });
    return next;
  }

  async function addReply(id, author, body) {
    const c = await get(id);
    if (!c) return null;
    const replies = (c.replies || []).concat([{ id: uid(), author, body: body.trim(), createdAt: Date.now() }]);
    return update(id, { replies });
  }

  async function remove(id) {
    await chrome.storage.local.remove(PREFIX + id);
  }

  async function removeMany(ids) {
    if (ids.length) await chrome.storage.local.remove(ids.map(id => PREFIX + id));
  }

  // Put deleted comments back exactly as they were (used by Undo).
  async function restore(list) {
    const out = {};
    list.forEach(c => { out[PREFIX + c.id] = c; });
    if (list.length) await chrome.storage.local.set(out);
  }

  // Merge comments from an export file. Existing ids are replaced when the
  // imported copy is newer.
  async function importMany(list) {
    const current = new Map((await all()).map(c => [c.id, c]));
    const out = {};
    let added = 0, updated = 0;
    for (const c of list) {
      if (!c || !c.id || !c.url) continue;
      const mine = current.get(c.id);
      if (!mine) { added++; out[PREFIX + c.id] = c; }
      else if ((c.updatedAt || 0) > (mine.updatedAt || 0)) { updated++; out[PREFIX + c.id] = c; }
    }
    if (Object.keys(out).length) await chrome.storage.local.set(out);
    return { added, updated };
  }

  async function getSettings() {
    const s = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
    return Object.assign({ author: '' }, s);
  }

  async function saveSettings(patch) {
    const s = Object.assign(await getSettings(), patch);
    await chrome.storage.local.set({ [SETTINGS_KEY]: s });
    return s;
  }

  function onChange(cb) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (Object.keys(changes).some(k => k.startsWith(PREFIX) || k === SETTINGS_KEY)) cb(changes);
    });
  }

  g.FoxioStore = {
    STATUSES, PRIORITIES, TYPES,
    uid, pageKeyOf, all, forPage, get, create, update, addReply, remove, removeMany, restore, importMany,
    getSettings, saveSettings, onChange
  };
})(globalThis);
