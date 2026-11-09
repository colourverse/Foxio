(async () => {
  const HEUR = globalThis.FoxioHeuristics;
  const S = globalThis.FoxioStore;
  const AUD = globalThis.FoxioAudit;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  document.getElementById('toc').innerHTML = HEUR.map(h =>
    `<li><a href="#${h.id}"><span class="badge sm">${esc(h.num)}</span>${esc(h.short)}</a></li>`).join('');

  const checksFor = id => (AUD ? AUD.rules : []).filter(r => r.covers.includes(id));

  function section(h) {
    const checks = checksFor(h.id);
    return `
      <section class="card" id="${h.id}" tabindex="-1">
        <div class="card-head">
          <span class="badge">${esc(h.num)}</span>
          <h2>${esc(h.name)}</h2>
        </div>
        <p class="summary">${esc(h.desc)}</p>
        <p>${esc(h.why)}</p>
        <div class="cols">
          <div>
            <h3>Look for</h3>
            <ul class="look">${h.lookFor.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          </div>
          <div>
            <h3>Do this</h3>
            <ul class="do">${h.doThis.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          </div>
        </div>
        <div class="examples">
          <div class="ex good"><span>Good</span><p>${esc(h.example.good)}</p></div>
          <div class="ex bad"><span>Avoid</span><p>${esc(h.example.bad)}</p></div>
        </div>
        <div class="meta">
          <div>
            <h3>Automated audit</h3>
            ${checks.length
              ? `<ul class="checks">${checks.map(r => `<li>${esc(r.name)}</li>`).join('')}</ul>`
              : '<p class="fine">Not checked automatically yet. This one needs human judgement, so leave a comment when you spot it.</p>'}
          </div>
          <div>
            <h3>On your board</h3>
            <p class="count" data-count="${h.id}">&hellip;</p>
          </div>
        </div>
        <p class="source">Source: ${h.refs.map(r => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>`).join(' &middot; ')}</p>
      </section>`;
  }

  document.getElementById('list').innerHTML = HEUR.map(section).join('');

  // Counts of comments tagged with each heuristic, linking to the filtered board.
  async function counts() {
    const all = await S.all();
    for (const h of HEUR) {
      const tagged = all.filter(c => c.heuristic === h.id);
      const open = tagged.filter(c => c.status !== 'done').length;
      const el = document.querySelector(`[data-count="${h.id}"]`);
      el.innerHTML = tagged.length
        ? `<b>${open}</b> open, ${tagged.length - open} done. <a href="../dashboard/dashboard.html?heur=${h.id}">View on board &rarr;</a>`
        : '<span class="fine">No comments tagged with this yet.</span>';
    }
  }
  counts();
  S.onChange(counts);

  // Highlight the section in the URL hash (links from the overlay and board).
  function focusHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const el = id && document.getElementById(id);
    document.querySelectorAll('.card.current').forEach(c => c.classList.remove('current'));
    document.querySelectorAll('.toc a.on').forEach(a => a.classList.remove('on'));
    if (!el) return;
    el.classList.add('current');
    const link = document.querySelector(`.toc a[href="#${id}"]`);
    if (link) link.classList.add('on');
    el.scrollIntoView({ block: 'start' });
    el.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', focusHash);
  focusHash();
})();
