// Foxio audit rules. Each maps to a heuristic id from lib/heuristics.js.
(function (g) {
  const A = g.FoxioAudit;
  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';

  // ------------------------------------------------------------ contrast
  A.register({
    id: 'text-contrast', name: 'Text contrast', heuristic: 'a11y',
    run(ctx) {
      const groups = new Map(); // one finding per colour pair
      for (const el of ctx.els) {
        const text = ctx.ownText(el);
        if (!text || !/[\p{L}\p{N}]/u.test(text) || !ctx.isVisible(el)) continue;
        const cs = getComputedStyle(el);
        const fg = ctx.parseColor(cs.color);
        const bg = ctx.backgroundOf(el);
        if (!fg || !bg) continue;
        const color = fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 } : fg;
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
        const need = large ? 3 : 4.5;
        const ratio = ctx.contrast(color, bg);
        if (ratio >= need) continue;
        const key = ctx.hex(color) + '/' + ctx.hex(bg);
        const grp = groups.get(key);
        if (grp) { grp.count++; continue; }
        groups.set(key, { el, ratio, need, color, bg, count: 1, text });
      }
      return [...groups.values()].map(x => ({
        el: x.el,
        severity: x.ratio < 3 ? 'major' : 'minor',
        title: `Low text contrast (${x.ratio.toFixed(2)}:1)`,
        detail: `${ctx.describe(x.el)} uses ${ctx.hex(x.color)} on ${ctx.hex(x.bg)}. WCAG AA requires ${x.need}:1 for this text size.` +
          (x.count > 1 ? ` ${x.count - 1} other element${x.count > 2 ? 's use' : ' uses'} the same colours.` : ''),
        suggestion: 'Darken the text or lighten the background until the ratio meets AA.'
      }));
    }
  });

  // ------------------------------------------------------------ images
  A.register({
    id: 'img-alt', name: 'Image alternative text', heuristic: 'a11y',
    run(ctx) {
      return Array.from(document.querySelectorAll('img:not([alt]), input[type="image"]:not([alt])'))
        .filter(el => ctx.isVisible(el) && el.getAttribute('role') !== 'presentation' && el.getAttribute('aria-hidden') !== 'true' && !el.getAttribute('aria-label'))
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; })
        .map(el => ({
          el, severity: 'major',
          title: 'Image is missing alt text',
          detail: `Screen-reader users get the file name (${(el.getAttribute('src') || '').split('/').pop().slice(0, 60) || 'no src'}) or nothing at all.`,
          suggestion: 'Add alt text describing the image’s purpose, or alt="" if it is purely decorative.'
        }));
    }
  });

  // ------------------------------------------------------------ control names
  A.register({
    id: 'control-name', name: 'Buttons and links have names', heuristic: 'a11y',
    run(ctx) {
      return Array.from(document.querySelectorAll('button, a[href], [role="button"], input[type="submit"], input[type="button"]'))
        .filter(el => ctx.isVisible(el) && !ctx.accessibleName(el))
        .map(el => ({
          el, severity: 'major',
          title: `${el.tagName === 'A' ? 'Link' : 'Button'} has no accessible name`,
          detail: 'It is announced as just “button” or “link”, so assistive-technology users can’t tell what it does. Usually an icon-only control.',
          suggestion: 'Add visible text, or an aria-label describing the action (e.g. aria-label="Close").'
        }));
    }
  });

  // ------------------------------------------------------------ form labels
  A.register({
    id: 'form-label', name: 'Form fields are labelled', heuristic: 'a11y',
    run(ctx) {
      const out = [];
      document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea')
        .forEach(el => {
          if (!ctx.isVisible(el)) return;
          const labelled = (el.labels && Array.from(el.labels).some(l => l.textContent.trim())) ||
            (el.getAttribute('aria-label') || '').trim() || el.getAttribute('aria-labelledby') || (el.getAttribute('title') || '').trim();
          if (labelled) return;
          const ph = (el.getAttribute('placeholder') || '').trim();
          out.push(ph ? {
            el, severity: 'minor', heuristic: 'h6',
            title: 'Placeholder used as the only label',
            detail: `The field’s only hint is the placeholder “${ph.slice(0, 50)}”, which disappears as soon as someone types, so users must remember what the field was for.`,
            suggestion: 'Add a persistent visible <label>; keep the placeholder for an example value if useful.'
          } : {
            el, severity: 'major',
            title: 'Form field has no label',
            detail: 'Nothing tells users (sighted or not) what to enter here.',
            suggestion: 'Add a visible <label for="…"> associated with the field.'
          });
        });
      return out;
    }
  });

  // ------------------------------------------------------------ target size
  A.register({
    id: 'target-size', name: 'Touch target size', heuristic: 'a11y',
    run(ctx) {
      const groups = new Map(); // siblings in one container (e.g. a nav) become one finding
      document.querySelectorAll(INTERACTIVE).forEach(el => {
        if (!ctx.isVisible(el)) return;
        const r = el.getBoundingClientRect();
        if (r.width >= 24 && r.height >= 24) return;
        // WCAG exception: links inside a sentence of text.
        if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') {
          const p = el.parentElement;
          if (p && (p.innerText || '').trim().length > (el.innerText || '').trim().length + 20) return;
        }
        const parent = el.parentElement || el;
        const grp = groups.get(parent);
        if (grp) { grp.count++; grp.minDim = Math.min(grp.minDim, r.width, r.height); return; }
        groups.set(parent, { el, r, count: 1, minDim: Math.min(r.width, r.height) });
      });
      return [...groups.values()].map(({ el, r, count, minDim }) => ({
        el: count > 1 ? el.parentElement : el,
        severity: minDim < 16 ? 'major' : 'minor',
        title: count > 1
          ? `${count} small tap targets (e.g. ${Math.round(r.width)}×${Math.round(r.height)}px)`
          : `Small tap target (${Math.round(r.width)}×${Math.round(r.height)}px)`,
        detail: (count > 1 ? `${count} controls here, starting with ${ctx.describe(el)}, are` : `${ctx.describe(el)} is`) +
          ` below the 24×24px minimum (WCAG 2.2) and well under the recommended 44×44px, so ${count > 1 ? 'they are' : 'it is'} easy to miss on touch screens.`,
        suggestion: 'Increase padding or the hit area (min-height / min-width: 44px) without necessarily changing the visual size.'
      }));
    }
  });

  // ------------------------------------------------------------ headings
  A.register({
    id: 'headings', name: 'Heading structure', heuristic: 'h4',
    run(ctx) {
      const hs = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"][aria-level]')).filter(ctx.isVisible);
      const level = h => h.getAttribute('aria-level') ? +h.getAttribute('aria-level') : +h.tagName[1];
      const out = [];
      const h1s = hs.filter(h => level(h) === 1);
      if (!h1s.length) out.push({
        el: hs[0] || document.body, severity: 'minor', heuristic: 'a11y',
        title: 'Page has no main heading (h1)',
        detail: 'Without an h1, users of screen readers and people skimming can’t confirm what this page is about.',
        suggestion: 'Mark the page’s main title up as a single <h1>.'
      });
      if (h1s.length > 1) out.push({
        el: h1s[1], severity: 'cosmetic',
        title: `${h1s.length} competing h1 headings`,
        detail: 'Multiple top-level headings dilute the page’s hierarchy.',
        suggestion: 'Keep one h1 for the page title and demote the others to h2.'
      });
      let prev = 0;
      for (const h of hs) {
        const l = level(h);
        if (prev && l > prev + 1) out.push({
          el: h, severity: 'minor',
          title: `Heading level skips from h${prev} to h${l}`,
          detail: `${ctx.describe(h)} breaks the outline, which makes the structure harder to navigate by heading.`,
          suggestion: `Use h${prev + 1} here (style it however you like with CSS).`
        });
        prev = l;
      }
      return out;
    }
  });

  // ------------------------------------------------------------ primary action
  A.register({
    id: 'primary-action', name: 'Clear primary action', heuristic: 'h8',
    run(ctx) {
      const fold = window.innerHeight;
      const cands = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"], a[class*="btn"], a[class*="button"], a[class*="cta"]'))
        .filter(el => {
          if (!ctx.isVisible(el)) return false;
          const r = el.getBoundingClientRect();
          return r.top + window.scrollY < fold && r.width >= 40 && r.height >= 18 && (ctx.accessibleName(el) || '').length > 1;
        });
      if (!cands.length) return [];
      const scoreOf = el => {
        const own = ctx.parseColor(getComputedStyle(el).backgroundColor);
        const behind = el.parentElement ? ctx.backgroundOf(el.parentElement) : null;
        if (!own || own.a < 0.5 || !behind) return 0;
        return ctx.contrast(own, behind);
      };
      const scored = cands.map(el => ({ el, c: scoreOf(el), area: el.offsetWidth * el.offsetHeight }));
      if (scored.some(s => s.c >= 3)) return [];
      const best = scored.sort((a, b) => b.c - a.c || b.area - a.area)[0];
      return [{
        el: best.el, severity: 'major', heuristic: 'h8',
        title: 'No visually dominant primary action above the fold',
        detail: `None of the ${cands.length} button${cands.length > 1 ? 's' : ''} visible on load stands out from its background (best is ${ctx.describe(best.el)} at ${best.c ? best.c.toFixed(2) + ':1' : 'no fill'}). Users have to hunt for the main next step.`,
        suggestion: 'Give the single most important action a solid, high-contrast fill (at least 3:1 against its surroundings) and make secondary actions visibly quieter.'
      }];
    }
  });

  // ------------------------------------------------------------ navigation size
  A.register({
    id: 'nav-size', name: 'Navigation size', heuristic: 'h8',
    run(ctx) {
      const out = [];
      document.querySelectorAll('nav, [role="navigation"]').forEach(nav => {
        if (!ctx.isVisible(nav) || nav.parentElement.closest('nav, [role="navigation"]')) return;
        const links = Array.from(nav.querySelectorAll('a[href], button')).filter(ctx.isVisible);
        if (links.length > 9) out.push({
          el: nav, severity: links.length > 14 ? 'major' : 'minor', heuristic: 'h8',
          title: `Navigation shows ${links.length} items at once`,
          detail: 'Long menus increase decision time (Hick’s law) and make it harder to find the most important destinations.',
          suggestion: 'Group items into fewer top-level categories (5–7), move secondary links to a footer or “More” menu.'
        });
      });
      return out;
    }
  });

  // ------------------------------------------------------------ link text
  const VAGUE = /^(click here|here|read more|more|learn more|details|link|this|go|continue reading|find out more)\.?$/i;
  A.register({
    id: 'vague-links', name: 'Descriptive link text', heuristic: 'h2',
    run(ctx) {
      return Array.from(document.querySelectorAll('a[href]'))
        .filter(a => ctx.isVisible(a) && VAGUE.test((a.innerText || '').trim()) && !a.getAttribute('aria-label') && !a.getAttribute('aria-labelledby'))
        .map(a => ({
          el: a, severity: 'minor', heuristic: 'h2',
          title: `Vague link text “${a.innerText.trim()}”`,
          detail: 'Out of context (in a links list or when scanning), users can’t tell where this goes.',
          suggestion: 'Describe the destination, e.g. “Read the pricing FAQ” instead of “Read more”.'
        }));
    }
  });

  // ------------------------------------------------------------ readability
  A.register({
    id: 'readability', name: 'Readable body text', heuristic: 'h8',
    run(ctx) {
      const small = new Map(), long = [];
      for (const el of ctx.els) {
        const text = ctx.ownText(el);
        if (text.length < 30 || !ctx.isVisible(el)) continue;
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        if (size < 12) {
          const k = Math.round(size * 10) / 10;
          if (!small.has(k)) small.set(k, { el, n: 0 });
          small.get(k).n++;
        }
        if (/^(P|LI|DD|BLOCKQUOTE)$/.test(el.tagName) && text.length > 200) {
          const chars = el.clientWidth / (size * 0.5);
          if (chars > 100) long.push({ el, chars });
        }
      }
      const out = [...small].map(([size, x]) => ({
        el: x.el, severity: 'minor', heuristic: 'a11y',
        title: `Body text set at ${size}px`,
        detail: `${x.n} block${x.n > 1 ? 's' : ''} of text use${x.n > 1 ? '' : 's'} a font smaller than 12px, which is hard to read for many people, especially on mobile.`,
        suggestion: 'Use at least 16px for body copy and 12px for fine print.'
      }));
      if (long.length) out.push({
        el: long[0].el, severity: 'cosmetic',
        title: `Lines are too long (~${Math.round(long[0].chars)} characters)`,
        detail: `${long.length} paragraph${long.length > 1 ? 's run' : ' runs'} past the comfortable 50–75 characters per line, so readers lose their place.`,
        suggestion: 'Constrain text columns with max-width: 65ch or similar.'
      });
      return out;
    }
  });

  // ------------------------------------------------------------ page level
  A.register({
    id: 'page-setup', name: 'Page language and zoom', heuristic: 'a11y',
    run() {
      const out = [];
      const anchor = document.body || document.documentElement;
      if (!(document.documentElement.getAttribute('lang') || '').trim()) out.push({
        el: anchor, severity: 'minor',
        title: 'Page language is not declared',
        detail: 'Screen readers can pick the wrong pronunciation and browsers can’t offer correct translation or hyphenation.',
        suggestion: 'Add a lang attribute, e.g. <html lang="en">.'
      });
      const vp = document.querySelector('meta[name="viewport"]');
      const content = vp ? (vp.getAttribute('content') || '').toLowerCase() : '';
      const max = /maximum-scale\s*=\s*([\d.]+)/.exec(content);
      if (/user-scalable\s*=\s*(no|0)/.test(content) || (max && parseFloat(max[1]) < 2)) out.push({
        el: anchor, severity: 'major',
        title: 'Pinch-zoom is disabled',
        detail: 'The viewport meta tag prevents users from zooming, which blocks people with low vision (WCAG 1.4.4).',
        suggestion: 'Remove user-scalable=no and maximum-scale from the viewport meta tag.'
      });
      if (!vp) out.push({
        el: anchor, severity: 'minor', heuristic: 'h4',
        title: 'No responsive viewport meta tag',
        detail: 'Mobile browsers will render this page zoomed out at desktop width.',
        suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.'
      });
      return out;
    }
  });
})(globalThis);
