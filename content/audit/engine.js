// Foxio audit engine (Phase 2, tier 1): deterministic DOM checks.
//
// A rule is { id, name, heuristic, run(ctx) } where run returns findings:
//   { el, severity: 'blocker'|'major'|'minor'|'cosmetic', title, detail, suggestion }
// Rules register themselves with FoxioAudit.register(rule) (see rules.js).
(function (g) {
  const rules = [];
  const MAX_PER_RULE = 8;
  const SEVERITY = {
    blocker: { priority: 'critical', label: 'Blocker', weight: 15 },
    major: { priority: 'high', label: 'Major', weight: 7 },
    minor: { priority: 'medium', label: 'Minor', weight: 3 },
    cosmetic: { priority: 'low', label: 'Cosmetic', weight: 1 }
  };
  const SEV_ORDER = ['blocker', 'major', 'minor', 'cosmetic'];

  // ---------------------------------------------------------------- helpers
  const OURS = 'FOXIO-OVERLAY';
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'OPTION', OURS]);

  function isVisible(el) {
    if (!el || el.nodeType !== 1 || el.tagName === OURS) return false;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Every visible element in the document, capped for very large pages.
  function elements(limit = 6000) {
    const out = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, {
      acceptNode: n => SKIP_TAGS.has(n.tagName) || n.closest('svg') && n.tagName !== 'svg'
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    for (let n = walker.currentNode; n && out.length < limit; n = walker.nextNode()) out.push(n);
    return out;
  }

  // Text directly inside the element (not in its children).
  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }

  function parseColor(s) {
    const m = /^rgba?\(([^)]+)\)$/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  const blend = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1
  });

  // Solid colour behind an element, or null when an image/gradient is involved
  // (we can't know the contrast then, so rules should stay quiet).
  function backgroundOf(el) {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parseColor(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
    return bg;
  }

  function luminance(c) {
    const ch = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }

  function contrast(a, b) {
    const l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

  function accessibleName(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(n => n.textContent).join(' ').trim();
      if (t) return t;
    }
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.labels && el.labels.length) {
      const t = Array.from(el.labels).map(l => l.textContent).join(' ').trim();
      if (t) return t;
    }
    const text = (el.innerText || '').trim();
    if (text) return text;
    const img = el.querySelector && el.querySelector('img[alt]:not([alt=""]), svg[aria-label], [role="img"][aria-label]');
    if (img) return img.getAttribute('alt') || img.getAttribute('aria-label');
    if (el.value && /^(submit|button|reset)$/.test(el.type)) return el.value;
    const title = el.getAttribute('title');
    return title ? title.trim() : '';
  }

  function describe(el) {
    if (el === document.documentElement || el === document.body) return 'this page';
    const t = (accessibleName(el) || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
    const tag = el.tagName.toLowerCase();
    return t ? `${tag} “${t.length > 50 ? t.slice(0, 50) + '…' : t}”` : `<${tag}>`;
  }

  const helpers = { isVisible, elements, ownText, parseColor, backgroundOf, contrast, hex, accessibleName, describe };

  // ---------------------------------------------------------------- engine
  function register(rule) { rules.push(rule); }

  function run() {
    const t0 = performance.now();
    const ctx = Object.assign({ els: elements() }, helpers);
    const findings = [];
    const truncated = {};
    const errors = [];
    for (const rule of rules) {
      let out = [];
      try { out = rule.run(ctx) || []; } catch (e) { errors.push(rule.id + ': ' + e.message); continue; }
      out.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
      if (out.length > MAX_PER_RULE) truncated[rule.id] = out.length - MAX_PER_RULE;
      out.slice(0, MAX_PER_RULE).forEach(f => findings.push(Object.assign({
        ruleId: rule.id,
        ruleName: rule.name,
        heuristic: f.heuristic || rule.heuristic,
        type: f.type || 'issue',
        priority: SEVERITY[f.severity].priority
      }, f)));
    }
    findings.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));

    // Score: weighted findings (plus a little for ones beyond the per-rule cap),
    // on a decaying curve so a page with many issues still ranks against worse ones.
    let penalty = findings.reduce((s, f) => s + SEVERITY[f.severity].weight, 0);
    for (const id in truncated) penalty += truncated[id] * SEVERITY.minor.weight * 0.5;
    const score = Math.round(100 * Math.exp(-penalty / 90));

    return { findings, truncated, errors, score, ruleCount: rules.length, ms: Math.round(performance.now() - t0) };
  }

  g.FoxioAudit = { register, run, rules, helpers, SEVERITY };
})(globalThis);
