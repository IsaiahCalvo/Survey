# PLAN — GOAL-2 slice 1: palette unification (KAL-56 + KAL-70 remainder + KAL-71)

_Scheduled autonomous session 2026-07-07. Governing directive: GOAL-autonomous-post-launch.md
work item 2. Decision already made by Isaiah (2026-07-02, settled): the viewer's cool
blue-gray chrome adopts the home hub's warm dark-and-gold identity; pull REAL values from
the hub's existing token source, not invented ones. Never push; commit local; DONE-AWAITING-PUSH._

## Scope of this slice

- **KAL-56** — shared token layer + global accent swap (blue → gold) + surface-gray
  reconciliation + primary-button unification + font-stack unification + `docs/ui/design-tokens.md`.
- **KAL-70 remainder** — `.btn-active` blue → gold (styles.css:1289) + the popup glyph
  mini-button accent sites (covered by the global sweep). Items 3+4 of that ticket were
  already done per the 2026-06-11 board audit.
- **KAL-71** — right rail: page number static gold; zoom % muted at rest → gold on
  hover/focus (~150ms); page-prev/next buttons 24→28 to match zoom buttons. Ticket items
  3+4 (fit-mode chevron overlap, page-dot line-height) are conditional
  "only-if-pixel-identical" fixes requiring 1.25× OS-scaling verification — **deferred
  with in-code comments**, exactly as the ticket's skip clause allows.
- **KAL-294** — same direction ("bring viewer toward homepage look"); the palette/font
  part of it is satisfied by this slice; density/spacing part stays open.
- **NOT this slice:** KAL-73 (spinner unification) and KAL-64 (icon system) — next slices.

## Ground truth discovered (2026-07-07, drives the design)

1. **The tickets' visual-contract prototypes (`prototype-before-after.html`,
   `prototype-loading.html`) no longer exist in the repo.** The tickets contain the full
   written contract (exact hexes, treatment rules); the text governs. Same situation as
   KAL-58's dead mockup, where the GOAL doc says proceed on the written decision.
2. **`src/App.css` is DEAD** — imported nowhere (no JS import, no `@import`, not in
   index.html). Its `:root` variables (`--bg-primary`, `--accent-primary`, …) never load;
   every `var(--x, #fallback)` in component CSS renders its **fallback literal** today.
   `src/index.css` is likewise unreferenced. Several component CSS comments call App.css
   "locked variables" — stale.
3. **Live style sources:** `src/styles.css` (global, imported by main.jsx),
   `src/home/hub.css` (scoped to `.survey-hub`), per-component `.css` files
   (var-with-fallback pattern), `src/theme.js` (JS constants, imported by 12+ modal/panel
   files), and many inline `style={{}}` literals.
4. **Hub token reals** (`src/home/hub.css` `.survey-hub` block): ink-900 `#0d0f14`,
   ink-800 `#12151c`, ink-700 `#181c24`, ink-600 `#1f2430`, ink-500 `#2a3140`,
   ink-400 `#3a4252`, ink-300 `#5a6473`, ink-200 `#8d96a6`; bone-100 `#f4f1ea`,
   bone-200 `#e8e2d4`, bone-300 `#c9c3b4`; gold `#d8a84e`, gold-soft `#b6904a`,
   gold-bg `#2a2218`.
5. **Blue accent inventory:** 179 case-insensitive `#4A90E2` sites in 31 src files
   (+ related `#357abd`/`#3A7BC8`/`rgba(74,144,226,…)`). A 37-agent classification pass
   (workflow `wf_d5d42901-0e3`) labels every site CHROME (swap) vs CANVAS_CONTENT (keep:
   annotation strokes, fabric defaults, selection handles, marquee, collaborator
   outlines — explicit KAL-56 out-of-scope) vs NON_UI. The implementation fan-out works
   strictly from that classified list; CANVAS_CONTENT and `src/prototype/` are untouched.
6. **Cool-gray surface literals** (`#1E1E1E #252525 #2b2b2b #2d2d2d #3a3a3a`): ~240 sites,
   heaviest in sidebar panels, SurveySpacesRail, PDFSidebar, AppShell, styles.css,
   AuthModal.css, PrintPanel.css. Same classification gate applies (e.g. FabricEditCanvas
   gray sites are likely canvas UI — follow the classification).
7. **Fonts:** viewer long stack lives at `viewerShared.js:323` (`FONT_FAMILY`) and is the
   stack KAL-56 picks. hub.css line 35 uses a short Helvetica stack → hub adopts the long
   stack. (Fabric Textbox single-name-font rule is untouched — that's canvas, not chrome.)

## Token mapping (the taste decisions, locked here)

New file `src/styles/tokens.css`, imported in `src/main.jsx` immediately BEFORE
`./styles.css`. One `:root` block, two sections:

**Section A — new canonical tokens** (names per KAL-56 §goal-1, values = hub reals):

| Token | Value | Source |
|---|---|---|
| --brand-primary | #d8a84e | hub --gold |
| --brand-primary-hover | #b6904a | hub --gold-soft (ticket's invented #c89738 dropped per GOAL "real values" rule) |
| --brand-primary-ink | #1a1508 | dark ink for text on gold (hub CTA text; verify against hub.css .btn rule at build time, use its real value) |
| --brand-primary-bg | #2a2218 | hub --gold-bg (translucent gold-tint surfaces) |
| --surface-0 | #0d0f14 | hub --ink-900 (app background) |
| --surface-1 | #12151c | hub --ink-800 (cards, sidebars, rails) |
| --surface-2 | #181c24 | hub --ink-700 (modals, panels, inputs) |
| --surface-3 | #1f2430 | hub --ink-600 (elevated, hover rows) |
| --surface-4 | #2a3140 | hub --ink-500 (pressed/active fills, scrollbar thumbs) |
| --border-subtle | rgba(244,241,234,0.08) | bone at low alpha |
| --border-default | #2a3140 | hub --ink-500 |
| --border-strong | #3a4252 | hub --ink-400 |
| --text-primary | #f4f1ea | hub --bone-100 (ticket's #f3eee1 superseded by real value) |
| --text-secondary | #c9c3b4 | hub --bone-300 |
| --text-muted | #8d96a6 | hub --ink-200 (KAL-71's "#a8b0bf" is a prototype-derived near-match; real token wins, noted for Isaiah) |
| --danger | #DC3545 | unchanged per ticket |
| --danger-hover | #C82333 | existing theme.js value |
| --success | #28A745 | existing theme.js value |
| --focus-ring | #d8a84e | gold per ticket |
| --overlay-scrim | rgba(0,0,0,0.7) | existing |
| --font-primary | (viewerShared long stack) | KAL-56 §goal-5 |

**Section B — legacy var names, aliased** so every `var(--x, fallback)` in component CSS
flips without touching those files: `--bg-primary:var(--surface-0)`,
`--bg-secondary:var(--surface-2)`, `--bg-tertiary:var(--surface-3)`,
`--bg-hover:var(--surface-3)`, `--border-primary:var(--border-default)`,
`--border-secondary/--border-light:var(--border-subtle)`, `--text-dim:#5a6473`,
`--accent-primary/--accent-blue:var(--brand-primary)`, `--accent-red:var(--danger)`,
`--accent-red-hover:var(--danger-hover)`, `--shadow-md/--shadow-lg`: existing values.
(`--pp-*` PrintPanel tokens: PrintPanel is HELD per ponytail memory — define nothing;
PrintPanel.css keeps its own scoped block, updated only for raw blue/gray literals it
contains, per classification.)

**Accent treatment rule (unchanged, verbatim from live code):** selected/active =
color-only change to gold; no fill, no permanent outline; hover keeps the existing
soft outline flicker. `.btn-active` at styles.css:1289 keeps its exact structure —
only `#4A90E2` → `var(--brand-primary)`.

## Steps

1. **Wait for + persist the classification** (`wf_d5d42901-0e3`) to
   `.planning/design-polish/PALETTE-CLASSIFICATION.json`. Spot-check 10 sites by hand
   (5 CHROME, 5 CANVAS_CONTENT) before trusting it. Anything UNSURE → treat as KEEP
   (conservative) and list in the report.
2. **Create `src/styles/tokens.css`** (above) + import in main.jsx before styles.css.
3. **Delete `src/App.css` and `src/index.css`** (dead files, verified unreferenced;
   removes ~9 gray + blue definitions and the misleading "locked" comments; fallow-rule
   satisfied: real importer check done, gated on build+tests). Update the stale
   "locked CSS variables from src/App.css" comments in the 3 collab CSS files to point
   at tokens.css.
4. **styles.css sweep** — all CHROME-classified blue/gray/text literals → tokens
   (incl. `.btn-active`, `.btn-card`, focus borders, selected-row rules). Keep rule
   structure identical; values only. `.btn-primary` shared class: verify the hub's gold
   CTA styling and land the shared class in styles.css; migrate viewer/modal blue primary
   buttons onto it (or same tokens where a class swap would disturb layout).
5. **theme.js re-point** — accent.primary/primaryHover/primaryDark → gold set;
   background.* → surface tokens' hexes; border.focus → gold; text.primary → bone;
   modal.* blues → gold-tinted equivalents (rgba(216,168,78,…) at the same alphas);
   status.info stays functional-blue? NO — ticket says accent blue dies: info → gold.
   theme.js stays a plain JS constants file (inline styles can't read CSS vars cheaply);
   its values now mirror tokens.css, with a header comment pointing at tokens.css as
   source of truth.
6. **Component fan-out (workflow, one agent per file, CHROME sites only):** swap each
   classified site to the token (CSS files → `var(--…)`; JSX inline styles → import
   `COLORS` from theme.js where already imported, else literal hex matching the token
   value — smallest diff wins; high-risk files PDFViewer.jsx / PageAnnotationLayer.jsx get
   values-only edits, no structural change, no refactors). Danger-red variants
   (#cf6f6f/#f97373/#e74c3c) are NOT unified in this slice (KAL-72's dialog ticket owns
   destructive-red consistency) — blue/gray/bone only.
7. **KAL-71 specifics (AppShell.jsx right rail):** page-number input + page-count button
   (~lines 1080/1089) → static gold; zoom % element gets a styles.css class
   (`color: var(--text-muted); transition: color 150ms ease;` hover/focus-within → gold);
   page-prev/next 24×24 → 28×28 (same icon size inside); two deferred-item comments.
8. **hub.css font** — line 35 short stack → the long stack (same string as
   viewerShared FONT_FAMILY / tokens --font-primary).
9. **docs/ui/design-tokens.md** — token table, the accent treatment rule, the 500-word
   why (App.css dead, hub reals, substitutions vs prototype hexes noted).
10. **Gates:** `npx vite build` clean; `node scripts/run-node-tests.mjs` — baseline at
    session start to restate; expected ≥1845/1809/0/36 (flake-watch:
    annotationDocSyncDurability "stale snapshot" test — rerun solo if red).
    `grep -ri "4A90E2" src/ --exclude-dir=prototype` afterwards must return ONLY
    CANVAS_CONTENT/NON_UI-classified lines (checked mechanically against the JSON).
    Same for the 5 surface hexes: zero remaining in CHROME sites.
11. **Browser verification (agent-driven, dev server on port 5174):** screenshots of
    hub Documents tab, open PDF (top toolbar w/ active tool gold, right rail, left
    sidebar), survey panel, share modal, auth modal, confirm-delete modal, account
    settings; hub-vs-viewer side-by-side reads as one product. Verify page-number gold +
    zoom hover-gold live. Adversarial visual pass: one agent hunts for leftover blue/cool
    surfaces in the screenshots.
12. **Codex result review until converged; commit locally** (explicit paths staged, never
    `git add -A`), mark KAL-56/70/71 in vault board files (+ KAL-294 partial note),
    DONE-AWAITING-PUSH in GOAL log, baton update.

## Risks / invariants

- **Protected-file invariants untouched:** no zoomGeneration, no SVG viewBox logic, no
  canvas sizing, no fontFamily changes inside Fabric text (chrome-only edits). Standing
  waiver covers the high-risk files; edits are color-value-only.
- **The one genuinely risky move is defining legacy var names globally** (Section B):
  any element whose CSS said `var(--bg-secondary, #252525)` flips from cool to warm.
  That is the ticket's exact intent, but it also affects surfaces nobody screenshot-lists.
  Mitigation: the browser sweep in step 11 + Isaiah's own review before push.
- **Electron/Capacitor:** pure CSS/JS-constant changes; no runtime API differences.
- `#252525`-style hexes appearing inside canvas-rendering code (FabricEditCanvas etc.)
  are governed by classification, not blanket sed.
