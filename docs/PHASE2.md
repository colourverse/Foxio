# Phase 2: Automated UX audit

Goal: one click runs a heuristic audit of the current page. Each finding becomes a normal Foxio comment that is pinned to its element, tagged with a heuristic, and dropped into Backlog, ready to triage alongside human feedback.

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
