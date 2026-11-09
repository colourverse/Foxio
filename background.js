// Foxio service worker: per-tab activation state, screenshots, opening the
// board, and the toolbar badge.
importScripts('lib/heuristics.js', 'lib/store.js');

const S = globalThis.FoxioStore;
const BOARD_URL = chrome.runtime.getURL('dashboard/dashboard.html');
const CONTENT_FILES = ['lib/heuristics.js', 'lib/store.js', 'content/content.js'];

// ---- session state (survives service-worker restarts, cleared on browser exit)
async function getSession() {
  const { foxio } = await chrome.storage.session.get('foxio');
  return foxio || { active: {}, focus: {} };
}
async function setSession(s) {
  await chrome.storage.session.set({ foxio: s });
}

chrome.tabs.onRemoved.addListener(async tabId => {
  const s = await getSession();
  delete s.active[tabId];
  delete s.focus[tabId];
  await setSession(s);
});

// ---- messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, err => sendResponse({ error: String(err && err.message || err) }));
  return true;
});

async function handle(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  switch (msg.type) {
    case 'foxio:hello': {
      const s = await getSession();
      const res = { active: !!s.active[tabId], focusId: s.focus[tabId] || null };
      if (s.focus[tabId]) { delete s.focus[tabId]; await setSession(s); }
      return res;
    }
    case 'foxio:setActive': {
      const s = await getSession();
      if (msg.active) s.active[tabId] = true; else delete s.active[tabId];
      await setSession(s);
      return { ok: true };
    }
    case 'foxio:tabState': {
      const s = await getSession();
      return { active: !!s.active[msg.tabId] };
    }
    case 'foxio:toggleTab':
      return toggleTab(msg.tabId);
    case 'foxio:capture':
      return capture(sender.tab, msg);
    case 'foxio:openBoard':
      return openBoard(msg.focus);
    case 'foxio:openComment':
      return openComment(msg.id);
    case 'foxio:changed':
      if (sender.tab) updateBadge(sender.tab.id, sender.tab.url);
      return { ok: true };
  }
  return { error: 'unknown message ' + msg.type };
}

// ---- activation
async function toggleTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'foxio:toggle' });
  } catch (e) {
    // Tab was open before Foxio was installed/reloaded: inject and retry.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
      return await chrome.tabs.sendMessage(tabId, { type: 'foxio:toggle' });
    } catch (e2) {
      return { error: 'Foxio can’t run on this page (browser pages and the Web Store are off-limits).' };
    }
  }
}

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-foxio') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) toggleTab(tab.id);
});

// ---- board / deep links
async function openBoard(focus) {
  const url = BOARD_URL + (focus ? '?focus=' + encodeURIComponent(focus) : '');
  const [existing] = await chrome.tabs.query({ url: BOARD_URL + '*' });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true, url });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  return { ok: true };
}

async function openComment(id) {
  const c = await S.get(id);
  if (!c) return { error: 'Comment not found' };
  const tab = await chrome.tabs.create({ url: c.url });
  const s = await getSession();
  s.active[tab.id] = true;
  s.focus[tab.id] = id;
  await setSession(s);
  return { ok: true };
}

// ---- screenshots: capture the visible tab and crop around the element
async function capture(tab, { rect, point, viewport }) {
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(shot)).blob());
  const scale = bmp.width / viewport.w; // device pixel ratio as captured

  const pad = 48, minW = 560, minH = 340;
  let w = Math.min(Math.max(rect.w + pad * 2, minW), viewport.w);
  let h = Math.min(Math.max(rect.h + pad * 2, minH), viewport.h);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Centre on the element, but keep the click point inside the crop.
  const cx = rect.w + pad * 2 > w ? point.x : rect.x + rect.w / 2;
  const cy = rect.h + pad * 2 > h ? point.y : rect.y + rect.h / 2;
  const x = clamp(cx - w / 2, 0, viewport.w - w);
  const y = clamp(cy - h / 2, 0, viewport.h - h);

  const outW = Math.round(Math.min(w * scale, 1100));
  const k = outW / w;
  const outH = Math.round(h * k);
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, x * scale, y * scale, w * scale, h * scale, 0, 0, outW, outH);

  ctx.strokeStyle = '#FF6A13';
  ctx.lineWidth = 3;
  ctx.strokeRect((rect.x - x) * k, (rect.y - y) * k, rect.w * k, rect.h * k);

  const px = (point.x - x) * k, py = (point.y - y) * k;
  ctx.beginPath();
  ctx.arc(px, py, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#FF6A13';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  return { dataUrl: await blobToDataUrl(blob) };
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return 'data:' + blob.type + ';base64,' + btoa(bin);
}

// ---- badge: number of open comments on the current page
async function updateBadge(tabId, url) {
  if (!tabId || !url || !/^(https?|file):/.test(url)) {
    if (tabId) chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    return;
  }
  const open = (await S.forPage(url)).filter(c => c.status !== 'done').length;
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF6A13' }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: open ? String(open) : '' }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' || info.url) updateBadge(tabId, tab.url);
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) updateBadge(tabId, tab.url);
});
S.onChange(async () => {
  const tabs = await chrome.tabs.query({ active: true });
  tabs.forEach(t => updateBadge(t.id, t.url));
});
