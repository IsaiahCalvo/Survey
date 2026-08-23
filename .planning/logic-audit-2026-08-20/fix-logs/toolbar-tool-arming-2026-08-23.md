# Toolbar click-to-arm (Rectangle / Ellipse) — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `f19910c2` overlay-listed P-04 tool-key arming.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after keyboard V/P/H/E/T/Q/L/A/C. Overlay omits Rectangle/Ellipse; `R`/`O` stay Select. Create-path clicks then draw are each tool's live-create spec. This leftover is category + sub-row **click-to-arm**.

**Product bug:** desktop Select caret sits on the 34×28 button center. A normal click opened the Selection mode menu (`stopPropagation`) and left **Pan** sticky. Keyboard `V` still armed Select. Eraser caret already called `setActiveTool` before toggling. Fix: Select caret arms `select` / `text-select` and closes the category dropdown, then toggles the menu.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh (no new product SHA). Did **not** replay remapped-after-CW, Ctrl+2 / Ctrl+M, rail Previous/Next, or keyboard letters. Did **not** invent measure / Note-Link / Forms / stamp / Group.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Remapped-after-CW catalog | **Exhausted / do not replay.** |
| Ctrl+2 Fit height / Ctrl+M MANUAL | **Already proved** at `7b86c22f`. |
| Rail Previous / Next click | **Already proved** at `ba953321`/`ed56e5ec`. |
| Overlay-listed P-04 letters | **Just proved** at `f19910c2`. ⇧V / Shift+E dedicated. R/O/S/I/G/N/F stay Select. |
| Search Match case / Whole word | **0.** Opened Search text; V-08 dedicated. |
| Comments / Forms / Print / Actual size / Measure / Group / Extract / Note-Link / Marquee zoom | **Compile-hidden.** Live counts **0**. |
| Layers / Attachments | **Compile-hidden.** Sidebar is Pages / Search text / Bookmarks / Spaces only. |
| Toolbar Zoom ± | **Replay-adjacent** after V-04 keyboard Ctrl++/−. Same `zoomIn`/`zoomOut`. |
| Export annotated PDF button | **Replay-adjacent** X-02 / leftover-18 export family. Chrome present; not this slice. |
| File → Open / Close | Open leftover-18 UL-03. Close tab already `e2e-tab-close`. |
| History besides Restore | A-07 dedicated click-restore / collapse. Filter chrome absent. |
| Text B/I/U/S without rotate | T-05 / callout-formatting / pickers-every-swatch already dedicated. |
| **Toolbar click-to-arm** | **This pass.** Rectangle / Ellipse have no letter. Distinct from keyboard arm and from create-then-draw. |

## Live-proved

Playwright `debug/scenarios/e2e-toolbar-tool-arming.spec.mjs` **2 / 2 (9.2s)** on reused Vite `http://localhost:5173`. Focused Node `toolbarToolArming` + leftover18 **15 / 15**.

| Slice | Intended / break / edge |
|---|---|
| Intended clicks | `?testPdf=clickable-link-test.pdf` 1400×900. Select (center/caret) leaves **Pan**; Draw+Pen; Highlighter; Eraser; Pen; Shapes Rectangle (re-click stays); Ellipse; Line; Arrow; Counter overlay; Text omits Note; Callout; Text tool; Pan dismisses overlay; Select. Clicks invent **0**. |
| Break invent / key contrast | `R` stays Select; Rectangle strip **0**. Note / Forms **0**. |
| Break hubPreview | `/?hubPreview=1` Draw / Rectangle **0**; clicks invent **0**; Counter overlay **0**. |
| Edge 390 | Document tools: Shapes→Rectangle/Ellipse; Draw→Pen; Select. Invent **0**. viewBox **`0 0 612 792`**. `file.id` null. |
| Edge viewBox | Desktop viewBox **`0 0 612 792`**; `file.id` null. |

Hunt live counts: Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments **0**. `file.id` null.

Product edit: `src/AppShell.jsx` Select caret only (not a high-risk file). Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not re-run (no high-risk touch). Cap **8448** / 75/250 not loosened. Isolated `partialEraserComplexity` 8448 standing. `chromeE2EContracts` `.ts` loader standing.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `src/AppShell.jsx` (Select caret arms tool; Eraser parity)
- `debug/scenarios/e2e-toolbar-tool-arming.spec.mjs`
- `tests/toolbarToolArming.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
