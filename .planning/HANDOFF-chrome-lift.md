Written: 2026-05-13 16:00

# Autonomous Handoff — Chrome Lift (Bottom Toolbar + Left Tool Rail)

## Mission (one sentence)

Lift the bottom toolbar AND then the left tool rail in this Survey-BetaSafeS2 PDF annotation app to live at the App shell, so each strip stays mounted across PDF tab switches and renders at its final dimensions on cold open BEFORE the PDF area finishes loading. Match the pattern the top bar already uses (search the codebase for `UX 2026-05-13` comments — that's the working reference).

## Loop Contract

1. Read `.planning/CHROME-LIFT-TODO.md`.
2. Pick the **topmost unchecked** item (`- [ ]`).
3. Implement it.
4. Run the verification commands for that item (see Verification section). If they pass, commit and check the item off (`- [x]`).
5. If they fail and a fix isn't obvious, retry once with a different approach. If still failing, leave the item unchecked, append `<!-- skipped: <one-line reason> -->` on that line, and continue with the next item.
6. Repeat from step 1 until **every** item is either `- [x]` or has a `skipped` note. Then emit the literal completion token `<promise>CHROME-LIFT-COMPLETE</promise>` on its own line and stop.
7. On startup of every iteration: re-read `git log -5 --oneline` and the TODO file before doing anything. A fresh process must behave identically to a continued one.

## Why this work matters (don't skip the why)

Today these strips re-render when a PDF tab mounts. The user wants the chrome (top bar, bottom toolbar, left rail) to feel like fixed rails baked into the app — visible at final dimensions on first paint, never flickering on tab switch. Only the PDF area itself should "load." The top bar was lifted in this exact pattern on 2026-05-13 and now feels right; mirror that.

## Reference: how the top bar was lifted

Look in `src/App.jsx` for `UX 2026-05-13` comments. The shape is:

1. **App-level host div** inside the App return, between the TabBar and the flex:1 area. Has an id (`chrome-top-host`), `display: flex` when a PDF tab is active and `display: none` on the home tab, plus the chrome styling (background, border, padding).
2. **`isActive` prop on PDFViewer**, passed from the tabs.map as `isActive={isVisible}`.
3. **`onTopToolbarApiChange` callback prop** on PDFViewer. App stores the published api in `topToolbarApi` state.
4. **A useEffect inside PDFViewer**, placed AFTER all the values it references in its deps are declared (this is critical — the `const canUndo = ...` and `const handleUndo = useCallback(...)` declarations sit mid-function-body, and the publish effect crashed twice during the top-bar lift because it was placed above them and hit temporal-dead-zone errors). When `isActive` is true, it calls `onTopToolbarApiChange({ canUndo, canRedo, onUndo, onRedo, onSurveyToggle, surveyActive, surveyEnabled })`.
5. **App renders the buttons inside the host div**, reading from `topToolbarApi`. The original top bar JSX was removed from PDFViewer.
6. **Inactive tabs do NOT publish** — the gate is `if (!isActive || typeof onTopToolbarApiChange !== 'function') return;`. The currently active tab is always the source of truth.

Use the same shape for the bottom toolbar and the left rail.

## Gotchas from the top-bar lift (DON'T REPEAT THESE)

These cost real time during the top-bar lift on 2026-05-13. Read carefully before writing the bottom-toolbar / left-rail publish effects.

1. **Temporal dead zone, attempt 1.** The publish useEffect was first placed near the top of the PDFViewer function, in the area where refs are declared. Its deps array referenced `handleUndo` and `handleRedo`, which are `useCallback` declarations roughly 5,000-6,000 lines further down in the function body. JS const declarations are not hoisted — evaluating the deps array at render time threw a ReferenceError and the ErrorBoundary caught it. **Fix:** place the publish useEffect AFTER every dep is declared. For the bottom toolbar / left rail, this means scanning the entire PDFViewer function body for the latest declaration of any value the api references, and placing the publish effect below the last one.

2. **Temporal dead zone, attempt 2.** Moving the publish effect past the handler `useCallback` declarations was not enough — it still referenced `canUndo` and `canRedo`, which are plain `const` expressions evaluated mid-function-body, even further down. Same crash. **Fix:** place the publish effect past the `canUndo` / `canRedo` declarations as well. For the new effects, double-check derived `const` expressions (not just useCallbacks) in the deps array.

3. **PDFViewer wrapper height.** PDFViewer's outermost wrapper inside the function's main return had `height: '100vh'` even though its parent was already `flex: 1` inside another `100vh` ancestor. The 100vh wrapper had been silently overflowing its container by the tab-bar height (and any chrome host above it), with the overflow clipped. Adding the App-level top-bar host pushed the clipped region by another ~32px and would have pushed the bottom toolbar / status bar fully off-screen. **Fix during top-bar lift:** changed the wrapper to `height: '100%'`. For the bottom-toolbar / left-rail lift, the wrapper is already `height: '100%'` — don't touch it again.

4. **Portal-only "lift" is NOT enough.** The first attempt for the top bar wrapped its existing JSX in `createPortal` targeting a stable App-level host div. The host stayed mounted across tab switches, BUT the JSX inside still came from the per-PDFViewer render — so on tab switch the inner button DOM was rebuilt by React. The user reported it still felt like a re-render. **Conclusion:** the FULL lift (extract JSX to a stable App-level render, drive it from a published api) is required to make the strip feel built-in. Don't stop at the portal hack.

5. **Toolbar-height measurement code.** PDFViewer measures the chrome heights to position the survey panel and set the `--app-chrome-top` CSS variable. The measurement code originally read `topToolbarRef.current.getBoundingClientRect()`. After the lift, the ref points at nothing (the JSX it was attached to no longer renders inside PDFViewer). **Fix:** the measurement code now queries `document.getElementById('chrome-top-host')` instead. For the bottom-toolbar lift, do the same swap: replace `bottomToolbarRef.current` reads with `document.getElementById('chrome-bottom-host')`. The ref itself can stay declared — just nothing attaches to it inside PDFViewer.

6. **Custom hover tooltip dropped on the top-bar buttons.** The original Undo / Redo buttons used a per-PDFViewer `setTooltip` state to show a custom-styled hover label. Piping that through the api was awkward, so the lifted buttons now use the browser-native `title=` attribute. Visually different (native tooltip vs the dark custom one) but functional. The bottom toolbar has many more `setTooltip` call sites — pick one of: (a) ship `title=` everywhere for simplicity, or (b) hoist the tooltip floating div to the App shell and pass `(text, x, y) => setAppTooltip(...)` callbacks through the api. Either is fine; (a) is much less work. If the user complains the labels look different, switch to (b).

7. **Empty host on cold open.** When a PDF tab activates, the App-level host becomes visible BEFORE the active PDFViewer's first render commit publishes the api. For a few hundred milliseconds the host renders with no inner buttons. **Fix already in place for the top bar:** give the host its own chrome styling (background, border, padding, alignItems / gap for layout) so even when the inner content is briefly absent, the strip still looks like a real chrome rail. Do the same for the bottom-toolbar / left-rail host. Set a `min-height` matching the previous strip's height so it doesn't collapse to 0 during the gap.

8. **Don't trust HMR after a crash.** Vite HMR sometimes fails to recover after a React render error — the dev console shows the error from the previous edit even after the fix. After every fix, ask the user to do a full Cmd+R reload of the Electron window before declaring the fix worked. If you're not driving the UI yourself, ask the user to confirm via a save-log capture (`Cmd+Shift+L`) and read the newest folder under `Logs/`.

9. **Dropdowns / popovers anchored to toolbar buttons.** The bottom toolbar has anchored popups: the color picker opens above the color swatch, the zoom-menu dropdown opens above the zoom dropdown button, the draw / shapes / text / survey category pickers open above their parent buttons. After the lift, those buttons move from inside PDFViewer to inside the App-level host — but the popups currently render where they are declared (often inside PDFViewer, anchored via refs). Two safe options:
   - Keep the popup JSX where it is in PDFViewer; have it look up its anchor button via a stable `data-` attribute on the lifted button (e.g. `data-color-picker-anchor`) and read the bounding rect from there. PDFViewer no longer owns the button DOM, but the rect is queryable.
   - Lift the popup JSX up to the App shell as well, alongside the toolbar. Simpler but bigger refactor.
   The user does NOT need the dashed-box selection chrome around callouts (already documented in CLAUDE.md). Don't change the callout selection behavior.

10. **Click-outside dismiss handlers.** Several toolbar popups dismiss on outside click via a document-level pointer-down listener. After the lift, the popup's "inside" check (`event.target.closest('[data-zoom-menu]')` and similar) must still match the lifted DOM. Search for `closest(` in `src/App.jsx` to find these checks. If a popup starts dismissing the instant the user clicks its own button after the lift, the closest check is reading a selector that lives in the wrong place — fix it.

11. **The bottom toolbar's container uses `position: relative` with absolute children.** Inside the toolbar, the page navigation block (prev / page input / total / next) is `position: absolute` with `left: 8px` to pin to the bottom-left corner. The new App-level bottom host MUST have `position: relative` on its outer element so the absolute children anchor correctly. Same for any other absolute positioning inside the lifted toolbar.

## Git workflow (NON-NEGOTIABLE)

- Stay on the current branch (run `git branch --show-current` to confirm). Do NOT create a new branch, do NOT switch branches, do NOT merge anything during this work unless the user explicitly says to.
- Commit cadence: one logical change per commit. Commit message prefix: `chrome-lift(bottom): ...` or `chrome-lift(left): ...`. Use whatever co-author line is standard for the agent driving this work — do not impersonate another model.
- Do NOT push to remote unless the user explicitly tells you to push. Do NOT open a pull request unless the user explicitly tells you to.
- Do NOT use destructive operations (`git reset --hard`, `git push --force`, `git checkout --`, `git clean -f`, `git branch -D`). To undo a commit, use `git revert <sha>`.
- Do NOT skip pre-commit hooks (`--no-verify` is forbidden unless the user explicitly authorizes it). If a hook fails, investigate the root cause; never bypass.

## Dev server expectations

- The user typically has the dev server already running (Vite on port 5173, with Electron connected). Don't kill it. If you need a build verification, use `npx vite build` — it's a separate one-shot build that doesn't disturb the running dev server.
- If the dev server isn't running and you need it for HMR-driven UI testing, ask the user to start it via `npm run dev`. Don't start a background dev server yourself unless the user authorizes it.
- The user's save-log capture is your primary UI signal. After substantive changes ask them to open a PDF, switch tabs, hit `Cmd+Shift+L`, and you'll find the saved snapshot in the newest folder under `Logs/`.

## Expansion behaviors that MUST keep working

These are flagged separately because they are easy to break and easy to miss.

1. **Bottom toolbar category pickers expand upward.** Clicking the Draw category reveals pen / highlighter buttons above the Draw button. Clicking Shapes reveals rect / ellipse buttons above the Shapes button. Same for Text and Survey-mode tools. The dropdowns are absolutely positioned above the toolbar with their anchor coordinates derived from the button's bounding rect. After the lift, the button DOM lives in the App-level host but the dropdown panels may still live in PDFViewer. Either lift the dropdowns to App level alongside the toolbar, OR keep them in PDFViewer and have them look up their anchor button via a stable `data-` attribute on the lifted button. Both paths are acceptable. Test every category picker after the lift; they MUST still open in the right position relative to the button that triggered them.

2. **Left rail panels expand outward to the right.** The narrow icon column is the always-visible part of the rail. Clicking the pages / search / bookmarks / spaces icon expands a panel out to the right of the icon column. The panel has its own width and pushes the PDF area inward. After the lift, both the icon column AND the expanded panel must continue working. The `isLeftSidebarCollapsed` state may live in PDFViewer today — lift it to App level if needed so the rail's expanded width is decided at the App shell.

3. **Survey panel slides in from the right (transient — not part of the lift).** The Survey button toggles a 320px (or 48px collapsed) overlay on the right side of the screen. It is NOT a permanent chrome rail and does NOT need to be lifted to the App shell. HOWEVER: the survey panel's top and bottom edges anchor to the chrome heights via the `--app-chrome-top` CSS variable and the `toolbarHeights` state. The chrome-height measurement code in PDFViewer was updated during the top-bar lift to read the top host by id; the bottom-toolbar lift must do the same swap for the bottom host. If the survey panel ends up overlapping the bottom toolbar or floating with a gap above it after the lift, the height-measurement code is reading the wrong element — fix it.

4. **Zoom dropdown menu expands upward** from the zoom dropdown button. Same anchoring rules as the category pickers.

5. **Color picker opens above the color swatch** in the bottom toolbar. Same anchoring rules. Make sure the color swatch's click is not swallowed by the click-outside dismiss handler after the lift.

## Feature-parity gate (NON-NEGOTIABLE)

Before checking off any task in `.planning/CHROME-LIFT-TODO.md`, the agent must verify EVERY interactive control on the lifted strip works the same as before. The lift is not done until every single control is exercised at least once and confirmed working.

For the bottom toolbar, the controls to verify (one by one) are at minimum: Pan, Select, Draw category → pen, Draw category → highlighter, Shapes category → rect, Shapes category → ellipse, Text tool, Survey-mode tools (when survey panel is open), Eraser, color picker swatch grid, stroke-width input, eraser-size input, zoom-out, zoom-in, zoom percentage input, zoom dropdown menu (every preset), Reset (manual zoom), prev page, page-number input, next page, all hover tooltips, active-tool highlighting, disabled states for prev / next at the page boundaries.

For the left rail, the controls are at minimum: pages panel (open / close, scroll, click thumbnail to navigate, right-click context menu, drag to reorder, duplicate, delete, cut, copy, paste, rotate, mirror, reset), search panel (open / close, type query, navigate between matches, highlight on the PDF), bookmarks panel (open / close, create, rename, delete, reorder), spaces panel (open / close, create, rename, delete, reorder, region selection mode, CSV export, PDF export, page assign / rename / remove inside a space), sync chip (status text reflects state), presence row (shows other connected users), region overlay toggle, canvas annotation visibility toggle, survey annotation visibility toggle, collapse / expand the rail itself.

If any control breaks post-lift, fix it before moving on. If a control can't be reasonably tested without the user (e.g. cloud sync presence with a second user), explicitly ask the user to verify and wait for their confirmation before checking off.

## State + memory updates at completion

- Update `.planning/STATE.md` with one line under "Recent Decisions" describing the chrome lift completion (or partial completion with reasons).
- If a new gotcha worth remembering was discovered during this work, append it to `CLAUDE.md` under the "Gotchas & Lessons Learned" section. Same date-prefixed format the file already uses.
- Append a DECISION entry in today's PSMM session-moments file: what was lifted, what was skipped (and why), test baseline before / after.

## Critical guardrails (DO NOT VIOLATE)

- Do not edit `src/components/PageAnnotationLayer.jsx` or `src/components/SVGAnnotationLayer.jsx` (load-bearing per `CLAUDE.md`).
- Do not touch the `zoomGeneration` signal contract (`setZoomGeneration(prev => prev + 1)` must still fire at zoom-start in `beginSyncfusionScaleConfirmPending`).
- Do not change canvas container-aware sizing in any Fabric canvas.
- Do not modify any file under `src/components/RotationInputField*` or any `12-02` phase file.
- Keep commits small and atomic — one logical change per commit. Use commit message format: `chrome-lift(bottom): <what>` or `chrome-lift(left): <what>`.
- Do NOT skip pre-commit hooks. Do NOT `--no-verify`.
- Do NOT use `git reset --hard`, `git push --force`, or any destructive op without an explicit user instruction. If a fix needs to be rolled back, use `git revert <sha>` on the offending commit only.
- The repo's standing waiver lets you edit `src/App.jsx` without per-edit approval, but keep edits scoped to chrome lift work. Do not refactor unrelated code in the same commits.

## State-of-the-world facts the agent will need

- Working dir: `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2`
- Main file under edit: `src/App.jsx` (~1.3 MB — Babel will warn about size; ignore that warning).
- Dev server: `npm run dev` (port 5173 or 5174 if 5173 is busy). HMR is on. The user has Electron + the dev server already wired for hot reload.
- Build verification: `npx vite build` — must end with `✓ built`.
- Tests: `npm test`. Pre-task baseline is **640 passed, 0 failed, 6 skipped** (recorded 2026-05-13). Acceptance is "match or beat the baseline."
- The currently-deployed user-saved log folder: `Logs/` at the repo root. Newest dated folder = most recent user UAT capture; check it for JS errors after each major change.
- Auth: dev auto-login is configured. You should not need to log in.
- A PSMM session-moments file is auto-created at session start under `~/.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/YYYY-MM-DD.md`. Log a DECISION / CORRECTION / SHIFT / INSIGHT entry for every non-routine outcome.

## Verification commands (exact)

Before starting any work, capture the current baseline:
- `npm test 2>&1 | tail -8` and record the number of `pass` / `fail` / `skipped`. As of 2026-05-13 the baseline is **640 pass, 0 fail, 6 skipped**. Acceptance is "match or beat this baseline." If the baseline has drifted higher, use the new number.

After every commit, run all four checks. ALL FOUR must pass before the item is checked off.

1. `npx vite build 2>&1 | tail -5` — must end with `✓ built`. Pre-existing pdfjs `eval` warning and Babel 500KB size warning are allowed.
2. `npm test 2>&1 | tail -8` — pass count must match or beat baseline, fail must stay at 0. Any new failure = regression = revert this commit.
3. For the bottom toolbar lift, confirm the JSX moved out of PDFViewer:
   - `awk '/^function PDFViewer\b/,/^function App\b|^export default function App\b/' src/App.jsx | grep -c "ref={bottomToolbarRef}"` — must return **0** (the toolbar div with that ref no longer renders inside PDFViewer).
   - `awk '/^function PDFViewer\b/,/^function App\b|^export default function App\b/' src/App.jsx | grep -c "Annotation Toolbar Footer"` — must return **0** (the labelled JSX block is gone from PDFViewer).
4. For the left rail lift, confirm BOTH render sites are gone from PDFViewer:
   - `awk '/^function PDFViewer\b/,/^function App\b|^export default function App\b/' src/App.jsx | grep -c "<PDFSidebar"` — must return **0**.
   - `grep -c "<PDFSidebar" src/App.jsx` — must return **1** (only the App-level host renders it). NOTE: PDFViewer currently has TWO `<PDFSidebar>` sites — one for the loading state (around line 32015) and one for the fully wired state (around line 32739). BOTH must be removed during the lift.

Plus a UI smoke check (the agent must drive this through the user):

After every batch of changes that affect visible UI, ask the user to:
1. Hard-reload the app (Cmd+R in the Electron window).
2. Open at least two PDF tabs.
3. Switch back and forth between them at least once.
4. Switch to the home tab and confirm only the tab strip is visible (no top bar, no bottom bar, no left rail).
5. Hit `Cmd+Shift+L` to capture a save-log snapshot.

Then the agent runs:
- `ls -lt Logs/ | head -2` to find the newest dated folder.
- `grep -iE "error|exception|cannot|undefined|TypeError|ReferenceError" Logs/<newest>/console.log | grep -v 'console.warn\|Realtime send\|CloudSync\|subscribe status' | head -10` — must be empty.

The agent MUST NOT check off any acceptance item that depends on visible behavior without a user-confirmed save-log capture. The build and test pass alone are not enough — they prove the code compiles and unit tests pass, not that the UI works.

## Commit message format

- Prefix: `chrome-lift(bottom):` or `chrome-lift(left):` followed by a short imperative summary.
- Body: 1-2 sentences on what changed and why.
- Use whatever co-author line is standard for the agent driving this work (Codex / ChatGPT agent / Claude / etc.) — DO NOT impersonate another model.
- DO NOT skip pre-commit hooks. If a hook fails, investigate the root cause.

## Tasks

See `.planning/CHROME-LIFT-TODO.md` for the granular checklist. Update it as you progress.

## Completion summary

When all items are resolved (checked or skipped), write a summary to `.planning/HANDOFF-chrome-lift-result.md`:

- Test baseline before vs after
- Items completed
- Items skipped, with the reason
- Any new lessons learned worth promoting to `CLAUDE.md`
- The literal token `<promise>CHROME-LIFT-COMPLETE</promise>` on its own line at the bottom

Then stop.
