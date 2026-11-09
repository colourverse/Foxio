# Phase 2: Automated UX audit

Goal: one click runs a heuristic audit of the current page. Each finding becomes a normal Foxio comment that is pinned to its element, tagged with a heuristic, and dropped into Backlog, ready to triage alongside human feedback.

## Status

| Milestone | State |
| --- | --- |
| 1. Rule engine + first rules | **Done**: 11 rules in `content/audit/rules.js` |
| 2. Audit UI (run, preview, accept) + dedupe/re-run | **Done** |
| 3. Remaining rules + per-site rule settings | Not started |
| 4. Backend + LLM tier (with team sync) | Not started |

### Rules shipped

| Rule id | Checks | Heuristic |
| --- | --- | --- |
| `text-contrast` | WCAG AA text contrast (4.5:1, 3:1 large); grouped per colour pair | a11y |
| `img-alt` | Images without `alt` | a11y |
| `control-name` | Buttons/links with no accessible name | a11y |
| `form-label` | Unlabelled fields; placeholder used as the only label | a11y / h6 |
| `target-size` | Targets under 24×24px; inline text links exempt; grouped per container | a11y |
| `headings` | Missing h1, multiple h1, skipped levels | h4 / a11y |
| `primary-action` | No button above the fold stands out (≥3:1 fill vs. background) | h8 |
| `nav-size` | Navigation with more than 9 visible items | h8 |
| `vague-links` | "Read more", "Click here", etc. | h2 |
| `readability` | Text under 12px; lines over ~100 characters | a11y / h8 |
| `page-setup` | Missing `lang`, zoom disabled, no viewport meta | a11y / h4 |

### How it behaves

- **Severity → priority:** blocker → Critical, major → High, minor → Medium, cosmetic → Low.
- **Caps:** at most 8 findings per rule. Extra ones count toward the score and show as "+N more".
- **Score:** `100 × e^(−penalty/90)`, where the penalty is weighted by severity. It's a relative signal, not a grade.
- **Dedupe:** each finding has a key `ruleId|cssSelector`, stored on the comment as `audit.key`. Re-runs skip keys that are already open on the board. Open audit comments whose key is no longer found are offered as "Mark done". This only happens if their rule ran and wasn't capped, so a capped list can't produce false "fixed" results.
- **Screenshots:** the page scrolls to each finding and captures it, up to 20 per run. Captures are throttled to stay under Chrome's limit of 2 per second, then the page scrolls back.
- **Adding a rule:** call `FoxioAudit.register({ id, name, heuristic, run(ctx) })` in `rules.js`. `ctx` provides `els`, `isVisible`, `ownText`, `backgroundOf`, `contrast`, `accessibleName` and `describe`.

### Known limits

- Contrast is skipped over background images and gradients, where the true background colour is unknown.
- Only the top frame is audited. Shadow DOM contents and iframes are not checked yet.
- Checks run on the current viewport size. Run again at mobile width to catch mobile-only issues.

## What Phase 1 already provides

- The comment record has `source: 'manual' | 'audit'`. Audit pins render square, and audit cards get an "Audit" badge.
- Every comment can carry a `heuristic` id from `lib/heuristics.js` (Nielsen's 10 plus `a11y`).
- Anchors (selector, XPath and offset), screenshots and `FoxioStore.create()` work the same for generated findings.

## Proposed architecture

```
popup / toolbar "Run audit"
        │
        ▼
content/audit/*.js   ── Tier 1: deterministic DOM rules (fast, offline, no false "opinions")
        │
        ├── Tier 2: LLM review (optional, needs API key or Foxio backend)
        │     inputs: viewport screenshot + simplified DOM outline + Tier 1 results
        │     output: JSON findings {selector, heuristic, severity, title, rationale, suggestion}
        ▼
dedupe (selector + rule id) → FoxioStore.create({source:'audit', ...}) → board
```

### Tier 1: rule engine (each rule is a small pure function returning findings)

| Rule | Heuristic | Signal |
| --- | --- | --- |
| Text contrast below 4.5:1 (3:1 for large text) | a11y, h8 | computed fg/bg colours |
| Images without `alt`; icon-only buttons without accessible name | a11y | DOM/ARIA |
| Inputs without a label | a11y, h6 | `<label for>`, `aria-label` |
| Tap targets under 24×24 px (WCAG 2.2) / 44 px recommended | a11y, h7 | bounding boxes |
| Primary CTA not visually dominant (low size/contrast vs. peers) | h8, h4 | button styles ranked |
| Inconsistent buttons (more than 3 distinct primary styles) | h4 | style clustering |
| Too many top-nav items (more than 7) | h8, h6 | nav link count |
| Form submit with no visible loading/disabled state | h1 | attributes on submit |
| Destructive buttons ("Delete", "Remove") without confirm pattern | h5 | text match |
| Placeholder-as-label, required fields not indicated | h5, h6 | DOM |
| Missing `lang`, skipped heading levels, multiple `h1` | a11y, h4 | DOM |
| Jargon / long paragraphs (readability score) | h2, h8 | text analysis |
| No search on content-heavy pages; no help/contact link | h10, h7 | DOM |
| Error messages that don't say how to fix | h9 | `aria-invalid` / `[role=alert]` text |

Severity maps to priority: blocker → Critical, major → High, minor → Medium, cosmetic → Low.

### Tier 2: LLM review

Use the Claude API (latest Sonnet-class model for cost/speed) with a structured JSON output schema. Send a viewport screenshot (already captured by `background.js`), a pruned DOM outline with stable selectors, and the Tier 1 findings so the model adds judgement instead of repeating rules. Do not call the API from the extension with a user-embedded key. Route it through a small backend, which is also where team sync would live.

### UX for audits

- "Run audit" in the popup and toolbar, with progress and a summary: "14 findings · 3 critical".
- Audit results can be previewed before they are added to the board (accept all / pick).
- Re-running dedupes against open audit findings for that page and auto-moves fixed ones to Done.
- Board filter: Source = Manual / Audit.

## Milestones

1. Rule engine + 6 highest-value rules (contrast, alt, labels, tap targets, headings, CTA dominance).
2. Audit UI (run, preview, accept) + dedupe/re-run.
3. Remaining rules + per-site rule settings.
4. Backend + LLM tier (with team sync).
