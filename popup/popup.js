(async () => {
  const S = globalThis.FoxioStore;
  const $ = id => document.getElementById(id);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const supported = tab && /^(https?|file):/.test(tab.url || '');

  const settings = await S.getSettings();
  $('author').value = settings.author;
  $('author').addEventListener('change', e => S.saveSettings({ author: e.target.value.trim() }));

  const all = await S.all();
  $('total').textContent = all.length;

  if (supported) {
    const u = new URL(tab.url);
    $('site').textContent = (u.hostname || 'local file') + u.pathname;
    const key = S.pageKeyOf(tab.url);
    $('open').textContent = all.filter(c => c.pageKey === key && c.status !== 'done').length;
    const { active } = await chrome.runtime.sendMessage({ type: 'foxio:tabState', tabId: tab.id });
    $('toggle').textContent = active ? 'Stop annotating' : 'Start annotating';
  } else {
    $('site').textContent = 'This page can’t be annotated';
    $('toggle').disabled = true;
    $('audit').disabled = true;
  }

  $('toggle').addEventListener('click', async () => {
    if (!settings.author && $('author').value.trim()) await S.saveSettings({ author: $('author').value.trim() });
    const res = await chrome.runtime.sendMessage({ type: 'foxio:toggleTab', tabId: tab.id });
    if (res && res.error) { $('error').textContent = res.error; $('error').hidden = false; return; }
    window.close();
  });
  $('audit').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'foxio:auditTab', tabId: tab.id });
    if (res && res.error) { $('error').textContent = res.error; $('error').hidden = false; return; }
    window.close();
  });
  $('board').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'foxio:openBoard' });
    window.close();
  });
})();
