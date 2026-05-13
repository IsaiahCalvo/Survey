Written: 2026-05-13 19:40

# Handoff — Toolbar / Chrome Instant-Render Polish

## One-line wake-up

Make the strips around the PDF (top bar with survey button + undo/redo +
tabs, bottom toolbar, left tool rail) feel like fixed rails baked into
the app — they appear instantly at fixed dimensions on cold open with
zero loading / flicker / backend dependency. Only the PDF area itself
should "load."

## Why this matters

Today these strips are tied to React state and re-render on PDF mount,
producing a brief loading / flicker feel on every doc open. The user
flagged this 2026-05-04 and asked to defer it until after Phase 31
cutover paperwork closed. Phase 31 closed 2026-05-13. This is the
next-session focus.

The goal: the chrome should feel permanent, like the PDF panel slots
into a pre-built frame. The contrast the user wants is what you'd see in
Drawboard / Lumin / VS Code — the surrounding interface is always there
and never repaints when you switch files; only the content area shows
any loading state.

## What "done" looks like

- Open the app from a cold start → top bar, bottom toolbar, and left
  tool rail are visible at their final dimensions in the first paint
  with no spinner, no flash of unstyled content, no React-state-driven
  re-render. The center document area can show its own loading state;
  the chrome around it does not.
- Switch tabs / switch documents → the chrome stays put. No part of
  the toolbar strip flickers or repaints. Only the PDF area updates.
- Resize the window → the chrome adjusts its dimensions cleanly without
  re-mounting.
- The PDF area can stay empty / loading for as long as it needs without
  the chrome looking incomplete.

## Where to start

Three concrete things to investigate before writing any code:

1. **Map the current chrome render tree.** The top bar, bottom toolbar,
   and left rail almost certainly live as descendants of the per-doc
   PDFViewer tree today, so they unmount and remount on tab switch.
   The fix is structural: lift them out to App-level mounts so they're
   independent of the per-doc state tree. Find every render site for
   the survey button, tab strip, undo/redo buttons, tool picker, and
   trace where they sit in the JSX hierarchy.
2. **Find the state dependencies.** Each chrome region probably reads
   props that come from PDF / doc state. Identify which of those
   actually need to change between docs (probably very few — the
   undo/redo enabled state, the active tool) versus which are
   structural and can be hoisted.
3. **Look for a current "shell" component.** There may already be a
   thin App-level shell that wraps PDFViewer. If so, the chrome belongs
   in that shell, not inside PDFViewer. If not, this work creates one.

## Suggested approach (recommendation)

- Build a thin App-level shell that owns the three chrome regions and
  renders the PDF area as a child slot. The shell mounts once on app
  boot and never unmounts during normal use.
- Pass only the small set of dynamic state (enabled flags, active
  tool, tab list) into the chrome regions via context or a thin
  provider, NOT via the per-doc state tree.
- Set explicit fixed dimensions on each chrome region so the first
  paint hits the same layout the steady-state render will. No grid
  template based on per-doc data.
- Use the existing tab list state as the source of truth for the tab
  strip; the strip already lives in TabBar.jsx which is App-level —
  good. Verify it isn't subscribed to per-doc state that re-renders
  it on doc open.
- For the bottom toolbar and left rail, the goal is the same
  structural lift. The current implementations may have a lot of
  per-doc state seeping in via the tool picker; that state needs to
  move to App-level or to a small context that doesn't repaint the
  whole strip when a single tool's enabled state changes.

## Files likely in scope

- `src/App.jsx` — the App-level shell mount lives here, and the
  chrome regions need to lift to this level. Standing waiver
  applies; the user has accepted edits to App.jsx without per-edit
  approval since 2026-04-29.
- `src/TabBar.jsx` — already App-level; verify it's not re-rendering
  on per-doc state.
- Whichever components own the bottom toolbar (probably a Toolbar /
  ToolPicker / BottomToolbar component) and the left tool rail
  (probably a ToolRail / LeftToolbar component) — names are not yet
  audited; first task is to find them.
- Probably ZERO touches to:
  - `PageAnnotationLayer.jsx`, `SVGAnnotationLayer.jsx`,
    `FabricDrawingCanvas.jsx`, `FabricEraserCanvas.jsx`,
    `FabricEditCanvas.jsx` (Always-Protected, not chrome surfaces).
  - `package.json`, `vite.config.js`.

## Acceptance criteria (Given/When/Then)

- **Given** a cold app start, **when** the app window first paints,
  **then** the top bar, bottom toolbar, and left tool rail are all
  visible at their final dimensions in the first paint with no
  spinner or flash of unstyled content on those regions.
- **Given** the user switches between two open document tabs,
  **when** the switch happens, **then** the chrome regions do not
  flicker / repaint / re-mount (React DevTools profiler shows the
  chrome components do not re-render during the tab switch).
- **Given** the user resizes the window, **when** the resize event
  fires, **then** the chrome regions adjust their dimensions cleanly
  without re-mounting and without a flash of stale content.
- **Given** a document is still loading its content (legacy hydrate
  or backfill in flight), **when** the user looks at the surrounding
  UI, **then** the chrome regions are fully responsive and look
  complete — only the center document area shows any loading state.

## DO NOT CHANGE

- `src/components/PageAnnotationLayer.jsx` — load-bearing PAL render loop.
- `src/components/SVGAnnotationLayer.jsx` — SVG viewBox owns zoom.
- `src/components/FabricDrawingCanvas.jsx` /
  `FabricEraserCanvas.jsx` / `FabricEditCanvas.jsx` —
  `zoomGeneration` signal contract is load-bearing.
- `package.json`, `vite.config.js` — infra.
- The Phase 31 cutover machinery
  (`useAnnotationCloudSync.js` hydrate branch, `crdtBackfill.js`,
  `crdtDualWriteQueue.js`, `crdtFeatureFlag.js`, `featureFlags.js`) —
  byte-correct; do not refactor.
- The three-lane undo system shipped 2026-05-13
  (`crdtUndoManager.js` + the local annotation history /
  legacyUndoHistory / yjsUndoStack wiring in `App.jsx`) — fragile;
  do not touch unless the toolbar work directly requires it.

## Open questions to flag before any code

1. **Tab strip vs full chrome lift.** Is `TabBar.jsx` already
   App-level and stable across doc switches today, or does it
   re-render on per-doc state? If stable, the lift only applies to
   the bottom toolbar + left rail. If unstable, it joins the lift.
2. **Survey button + undo/redo.** Those buttons read live state
   (survey progress, undo stack depth). Confirm whether the user
   wants the BUTTONS pre-rendered with the live state plugged in
   via context (no flicker on doc switch, state updates surgical),
   or the entire button surface pre-rendered as a static shell.
   Recommendation: live state via small context, surgical updates
   only. Ask the user if they want anything stronger.
3. **Cold-open spinner placement.** Today the app probably shows a
   single full-screen loading state during the first paint after
   login. Confirm with the user whether the chrome should appear
   BEFORE login or only after — recommendation is after login, so
   the auth gate stays as-is.

## Test plan

- **Unit:** none needed for the lift itself (it's structural). If
  small context providers get added, write 1–2 contract tests for
  their exposed shape.
- **Manual UAT:**
  1. Cold start the app from a quit state. Confirm the three chrome
     regions paint with no spinner / flash on them.
  2. Open the test PDF
     (`/Users/isaiahcalvo/Desktop/Package 2 - Rev 4 -- IC.pdf`).
     Confirm only the center area shows a loading state during
     hydrate; the chrome stays put.
  3. Open a second document in a new tab. Switch back and forth
     between the two tabs. Confirm the chrome does not flicker.
  4. Resize the window. Confirm the chrome adjusts cleanly with no
     mount/unmount or stale content.
- **Regression:** existing 640p/0f/6s test baseline stays green. No
  changes expected to the Phase 31 cutover surfaces.

## Reference

- User memory:
  `~/.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/feature_chrome_instant_render.md`
- Phase 31 close-out: `.planning/phases/31-migration-cutover-seal/31-VERIFICATION.md` + `31-RECONCILIATION.md`
- Test baseline at handoff: 640p / 0f / 6s (`npm test`).

## Resumption note

Run `/gsd:discuss-phase` to gather context first (recommended — this
work has open questions above that should be answered before plan
decomposition). Once the questions are resolved, `/gsd:plan-phase`
will decompose into wave-based plans.

The user's preference is plain-English communication, stepwise UAT,
and no per-edit waiver asks on the Always-Protected files (standing
waiver granted 2026-04-29).
