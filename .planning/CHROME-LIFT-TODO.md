Written: 2026-05-13 16:00

# Chrome Lift — TODO Checklist

Loop contract is in `.planning/HANDOFF-chrome-lift.md`. Pick the topmost unchecked item. Verification commands per-item are inline. When a commit passes verification, check the item off here. When blocked after one retry, leave it unchecked and append `<!-- skipped: <reason> -->`.

## Phase A — Bottom Toolbar Lift

The bottom toolbar lives inside `PDFViewer`'s return in `src/App.jsx` starting at the `<div ref={bottomToolbarRef}>` block (around line 36568 at the time of writing). It carries: Pan / Select, Draw category (pen, highlighter), Shapes (rect, ellipse), Text, Survey-mode tools, color picker, stroke width, eraser size, zoom controls (in / out / reset / manual %), page navigation (prev / page input / total / next). It references roughly twenty-five state values and handlers.

Approach: extract the entire bottom-toolbar JSX into a stable component (either inline in `App.jsx` or a new file under `src/components/`). Define a single big props/api object. PDFViewer publishes the api via `onBottomToolbarApiChange` when `isActive`. App renders the component inside a new `#chrome-bottom-host` div, hidden on the home tab.

- [x] **A1. Enumerate the api.** Read the entire current bottom toolbar JSX and list every distinct state value, handler, and ref it touches. Write the list as a comment block at the new component's definition site so future readers can audit it. Verification: the comment exists and matches what the JSX uses (no missing reference, no extra unused field).

- [x] **A2. Create the component shell.** Define `BottomToolbar(props)` either inline near the top of `App.jsx` or in `src/components/BottomToolbar.jsx`. Initially have it return `null`. Verification: `npx vite build 2>&1 | tail -5` ends with `✓ built`.

- [x] **A3. Move the JSX.** Move the bottom-toolbar JSX (currently in PDFViewer) into `BottomToolbar`. Replace every direct state/handler reference with `props.<name>`. Keep the original JSX in PDFViewer commented out for one commit so a `git diff` is reviewable. Verification: build passes; visually nothing is different yet (component is defined but not yet rendered).

- [x] **A4. Add App-level host + state + publish wiring.** Add `<div id="chrome-bottom-host" ...>` in `App.jsx` below the flex:1 area (or wherever the bottom rail belongs visually). Add `const [bottomToolbarApi, setBottomToolbarApi] = useState(null)`. Pass `onBottomToolbarApiChange={setBottomToolbarApi}` to PDFViewer. Render `{bottomToolbarApi && <BottomToolbar {...bottomToolbarApi} />}` inside the host. Verification: build passes; host appears at the bottom when a PDF tab is active, hidden on home.

- [x] **A5. Publish from PDFViewer.** Add a `useEffect` in PDFViewer that, when `isActive`, calls `onBottomToolbarApiChange(...)` with the full api object. Critical: place this useEffect AFTER ALL the values in its deps array are declared in the function body. If you hit a `ReferenceError` or `TypeError` on first render, the effect is above one of its dependencies — move it lower. Verification: build passes, `npm test` baseline holds, dev-server console shows no error after opening a PDF.

- [x] **A6. Remove the now-dead JSX from PDFViewer.** Delete the commented-out bottom toolbar JSX in PDFViewer. Update the toolbar-height measurement code that used `bottomToolbarRef.current` so it queries `document.getElementById('chrome-bottom-host')` instead (mirror what was done for the top bar — search for `chrome-top-host` to find the measurement code). Verification: `awk '/^function PDFViewer\b/,/^function App\b|^export default function App\b/' src/App.jsx | grep -c "ref={bottomToolbarRef}"` returns **0** (the ref is no longer attached inside PDFViewer); `grep -c "Annotation Toolbar Footer" src/App.jsx` returns **0 or 1** (the labelled block is either gone or now lives only in the BottomToolbar component file); build passes; test baseline holds.

- [x] **A7. Behavior smoke — tab switch.** Read the newest folder under `Logs/`. The user should have run `Cmd+Shift+L` after opening two PDFs and switching tabs. Confirm no JS errors in that log. Confirm that on tab switch, the bottom toolbar's DOM nodes stay mounted (you can grep the log for repeated `mount`-style messages tied to bottom-toolbar refs to confirm). Verification: no errors in newest log; commit message references the log folder name.

- [x] **A8. Behavior smoke — cold open.** Cold-open behavior: the bottom strip should be visible at its final dimensions before the PDF area paints. Confirm the host has `display: flex` set the moment a PDF tab becomes active and is styled with the correct background / border so it looks like the chrome even if the inner component hasn't published its first api yet. If the host is briefly empty / has wrong dimensions, fix the host's styling. Verification: build passes, test baseline holds, host has min-height matching the previous toolbar height (~49px).

- [x] **A9. Session moment + reconciliation note.** Append a DECISION entry in today's session-moments file describing the lift approach + any deviations. If you skipped any sub-step above, capture the reason in the same entry. Verification: file exists, entry is present.

## Phase B — Left Tool Rail Lift

Only start Phase B after every item in Phase A is `[x]` or has a `skipped` note. Re-baseline `npm test` before starting Phase B; record the number in the first Phase B commit message.

The left rail is `<PDFSidebar>` — the second of the two render sites in `src/App.jsx`. It receives roughly **sixty** props from PDFViewer (page list / search / bookmarks / spaces / page operations / cloud sync state / presence / region selection / canvas + survey visibility toggles / scale / tab id). The lift is structurally identical to the bottom toolbar but with a much wider props object.

- [x] **B1. Enumerate the api.** List every prop `<PDFSidebar>` currently receives. Write it as a comment block at the App-level render site (or in the api state declaration) so the contract is auditable.

- [x] **B2. Add App-level host + state.** Add a host div (e.g. `<div id="chrome-left-host">`) in the right structural place — alongside the flex:1 area inside the App return, so the rail sits to the left of the PDF panel and is independent of which PDF is active. Add `const [leftRailApi, setLeftRailApi] = useState(null)`.

- [x] **B3. Wire publish callback.** Pass `onLeftRailApiChange={setLeftRailApi}` to PDFViewer. Add a publish `useEffect` in PDFViewer with the full api. Critical: place AFTER all dependency variables are declared in the function body (same TDZ rule as Phase A).

- [x] **B4. Render the rail at App level.** Inside the host div, render `{leftRailApi && <PDFSidebar {...leftRailApi} />}`. The rail's collapsed / expanded state may need its own App-level useState if PDFViewer previously owned it — if so, lift it up; if not, pass through the api.

- [x] **B5. Remove the now-duplicate renders from PDFViewer.** There are TWO `<PDFSidebar>` sites inside PDFViewer: one for the loading state (around line 32015 in the current file) and one for the fully wired state (around line 32739). BOTH must be removed. Anything inside PDFViewer that called `pdfSidebarRef.current` may need to read the App-level ref instead — search for `pdfSidebarRef` references and reconcile each one. After removal: `grep -c "<PDFSidebar" src/App.jsx` must return **1** (only the App-level host renders it).

- [x] **B6. Visual + behavioral smoke.** Read the newest `Logs/` folder. Confirm no errors. Confirm the rail stays put across tab switches and the home tab still hides it. Confirm page click / search / bookmark / space CRUD still work (the user can verify by clicking through them after a save-log capture).

- [x] **B7. Session moment + reconciliation note.** Append a DECISION entry in today's session-moments file. If anything was skipped (e.g. region selection still flickers because it owns its own state), capture exact reason.

## Final

- [ ] **Z1. Test baseline final check.** Run `npm test 2>&1 | tail -20` and record the numbers. Must be ≥ 640 passed / 0 failed / 6 skipped. If any new failure landed during this work, find which commit introduced it (`git bisect` if needed) and either fix or revert.

- [ ] **Z2. Write the result summary.** Create `.planning/HANDOFF-chrome-lift-result.md` per the "Completion summary" section in `.planning/HANDOFF-chrome-lift.md`. End with the literal completion token on its own line:

      <promise>CHROME-LIFT-COMPLETE</promise>
