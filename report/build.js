// Builds a self-contained HTML report (one file: styles, script, logo, data and
// screenshots inlined) that anyone can open in a browser without Foxio.
(function (g) {
  const S = g.FoxioStore;
  const HEUR = g.FoxioHeuristics;

  const text = path => fetch(chrome.runtime.getURL(path)).then(r => r.text());
  const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function dataUrl(path) {
    const blob = await (await fetch(chrome.runtime.getURL(path))).blob();
    return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  }

  // Replace only the first occurrence, so inserted content can never be re-substituted.
  function put(tpl, key, value) {
    const i = tpl.indexOf(key);
    return i < 0 ? tpl : tpl.slice(0, i) + value + tpl.slice(i + key.length);
  }

  function toReportComment(c, includeShots) {
    const a = c.anchor || {};
    return {
      id: c.id, number: c.number, url: c.url, pageKey: c.pageKey, site: c.site, pageTitle: c.pageTitle,
      body: c.body, type: c.type, priority: c.priority, status: c.status, heuristic: c.heuristic,
      author: c.author, createdAt: c.createdAt, order: c.order, source: c.source,
      replies: (c.replies || []).map(r => ({ author: r.author, body: r.body, createdAt: r.createdAt })),
      anchorText: a.text || '', selector: a.selector || '', viewport: c.viewport || null,
      screenshot: includeShots ? c.screenshot || null : null
    };
  }

  function defaultTitle(comments) {
    const sites = [...new Set(comments.map(c => c.site))];
    return sites.length === 1 ? `Design feedback: ${sites[0]}` : `Design feedback: ${sites.length} sites`;
  }

  async function build({ comments, title, preparedBy, includeShots, includeDone, view }) {
    const list = comments.filter(c => includeDone || c.status !== 'done');
    const [tpl, css, js, logo] = await Promise.all([
      text('report/report-template.html'), text('report/report.css'), text('report/report.js'), dataUrl('icons/icon48.png')
    ]);
    const data = {
      app: 'foxio', version: 1, generatedAt: Date.now(),
      title: title || defaultTitle(list), preparedBy: preparedBy || '',
      view: view === 'board' ? 'board' : 'list', includeDone: !!includeDone,
      statuses: S.STATUSES, priorities: S.PRIORITIES, types: S.TYPES,
      heuristics: HEUR.map(h => ({ id: h.id, num: h.num, short: h.short, name: h.name, desc: h.desc, why: h.why, refs: h.refs })),
      comments: list.map(c => toReportComment(c, includeShots))
    };
    // Safe inside <script type="application/json">: no "</script>" or line separators can break out.
    const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
    const json = JSON.stringify(data).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');

    let html = tpl.split('__LOGO__').join(logo);
    html = put(html, '__TITLE__', escHtml(data.title));
    html = put(html, '/*__CSS__*/', css);
    html = put(html, '/*__JS__*/', js.replace(/<\/script/gi, '<\\/script'));
    html = put(html, '__DATA__', json);
    return { html, count: list.length, title: data.title };
  }

  function fileName(title) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'report';
    return `foxio-${slug}-${new Date().toISOString().slice(0, 10)}.html`;
  }

  g.FoxioReport = { build, defaultTitle, fileName };
})(globalThis);
