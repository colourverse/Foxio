# Foxio

Visual design feedback for any website. Pin comments to page elements, then triage them on a Kanban board.

## Install (developer mode)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `foxio/` folder.
3. Pin Foxio to the toolbar from the puzzle-piece menu.

No build step: the extension is plain JavaScript (Manifest V3).

## Using it

| Action | How |
| --- | --- |
| Turn Foxio on/off for a tab | Toolbar icon → **Start annotating**, or `Alt+Shift+F` |
| Comment on an element | Press `C` (or **Comment**), hover to highlight, click the element |
| Save a comment | **Save**, or `Ctrl/⌘+Enter` |
| Run a UX audit | `A`, the **Audit** button, or **Run UX audit** in the popup |
| Show/hide pins | `P`, or the eye button |
| Cancel | `Esc` |
| Open the board | **Board** in the on-page toolbar, or **Open the board** in the popup |

Each comment records:
- the element (CSS selector plus XPath fallback, and the click offset inside it)
- a cropped screenshot with the element outlined
- type (Issue / Suggestion / Question / Praise), priority, an optional usability heuristic, the viewport size, and the author

Pins stay attached to their elements through scrolling, resizing and navigation in single-page apps. Comments are scoped per page (origin and path; the query string and hash are ignored).

### UX audit (Phase 2, in progress)

**Audit** checks the current page against usability heuristics and accessibility basics. It shows a score and a list of findings, each with severity, heuristic, explanation and a suggested fix. Hover a finding to highlight its element. Tick the ones you want and click **Add to board**: each becomes a normal comment pinned to its element, with a screenshot, `source: 'audit'` and author "Foxio audit".

Re-running the audit skips findings already on the board and offers to mark findings that are no longer detected as **Done**. See [`docs/PHASE2.md`](docs/PHASE2.md) for the full list of checks and what's next.

### The board

- **Columns:** group by **Status** (Backlog → To do → In progress → Done) or by **Priority** (Critical → Low). Drag cards between columns to change that field, or within a column to reorder.
- **Filters:** site, page, priority, type, heuristic, source (people or audit), plus full-text search.
- **Card details:** click a card to edit it, reply, delete, or use **Show on page**. That opens the page, scrolls to the element and opens the comment.
- **Export / Import:** JSON includes everything, screenshots too, so you can share or back up. CSV is for spreadsheets. Importing merges by id, and the newer copy wins.

## Project layout

```
manifest.json          MV3 manifest
background.js          service worker: tab activation, screenshots, deep links, badge
lib/store.js           data layer (the only file that touches storage)
lib/heuristics.js      Nielsen's 10 heuristics + Accessibility
content/audit/         Phase 2 audit: engine.js (runner, helpers, scoring) + rules.js
content/content.js     on-page overlay (shadow DOM): toolbar, picker, composer, pins
content/overlay.css    overlay styles
popup/                 toolbar popup
dashboard/             Kanban board (extension page)
docs/PHASE2.md         plan for the automated UX audit
```

## Storage and moving to a team backend

Data lives in `chrome.storage.local`, one key per comment, on the user's machine. That makes the board "central" for one person across every site. Teams can share through Export/Import for now.

To give a team one live board, re-implement the functions in `lib/store.js` (`all`, `forPage`, `get`, `create`, `update`, `addReply`, `remove`, `onChange`) against a backend such as Supabase (Postgres, auth, realtime and storage for screenshots). Nothing else needs to change. The record shape is documented in `create()`.
