# Style / Width menu dismiss — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `e6168568` Fit-options dismiss.  
**This-pass SHA:** `39da34c8` (capture pointerdown + consume).  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Fit-options dismiss (`e6168568`). Menu Style / Width **apply** catalogs already dedicated (`e2e-rect-ellipse-text-dash`, `e2e-shape-stroke-width-presets`). Color every-swatch already dedicated. This leftover is Style / Width / color **popup dismiss** on a page click while a creation tool is armed. Overlay lists Esc as Close dialogs/cancel. Distinct from leftover-18 / X-01 / remapped-after-CW / Fit apply / Fit dismiss / Select caret arm-then-toggle / Home / Close tab.

**Product:** AppShell's exclusive formatting layer listened for capture `mousedown`. SVG `onPointerDown` `preventDefault`s while Rectangle (and other create tools) are armed, which suppresses the compatibility mousedown — so a page click never closed Style / Width. Listener is now capture `pointerdown`. Page-surface dismiss is consumed so it does not start a rubber-band (same contract as CompactColorPicker `DismissBarrier`). Select caret already closed on page click (Select does not preventDefault). Radix `pointerdown-outside` stays bubble-phase and is still blocked by SVG `stopPropagation`; the exclusive layer is the dismiss path.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay remapped-after-CW, Ctrl+2 / Ctrl+M, menu Fit height / Ctrl+0 / Ctrl+1, Fit dismiss, rail Previous/Next, keyboard letters, toolbar click-to-arm, or Home/Close tab.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Fit options dismiss / apply | **Exhausted / do not replay.** |
| Select caret arm-then-toggle | **Already proved.** Dismiss on page click already worked (Select does not preventDefault). |
| Rectangle/Ellipse create-path | **Already proved** (`e2e-shape-live-create`). |
| Context-menu / page Insert-Delete-Reorder / History Restore / bookmark group-rename | **Already dedicated.** |
| Text B/I/U/S / pickers apply / Select All / Undo-Redo | **Already dedicated.** |
| File → Open / Export flavors | Open leftover-18 UL-03. Export is a single live button (no flavor menu). File menu **0**. Excel actions **0** until a template is chosen. |
| Eraser / Highlighter caret portals | **0** (chrome-lifted; Eraser type is AppShell Radix). |
| Search Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments | **0.** |
| Official stale contracts | leftover-18 Node **12 / 12**. Isolated 8448 standing. No new stale official contract. |
| 390 Zoom-and-fit Escape | **Already proved.** Default 390 Style trigger **0**. |
| **Style / Width page-click dismiss** | **This pass.** Live hunt before the fix: Style / Width stayed **1** after page click with Rectangle armed. After: **0**. |

## Live-proved

Playwright `debug/scenarios/e2e-style-width-menu-dismiss.spec.mjs` **2 / 2 (7.9s)** on Playwright Vite `http://localhost:5173`. Hunt `e2e-after-fit-options-independent-hunt.spec.mjs` **1 / 1 (5.2s)** post-fix. Focused Node `styleWidthMenuDismiss` + leftover18 **14 / 14**.

| Slice | Intended / break / edge |
|---|---|
| Intended Style Escape | `?testPdf=clickable-link-test.pdf` 1400×900. Rectangle armed. Style opens Solid / Dashed / Dotted / Cloud. Escape closes. |
| Intended Style click-outside | Page click closes. No invented rect (`marksBefore` held). Second Escape invents **0**. |
| Intended Width | Width presets open; Escape closes; page click closes; no invented rect. |
| Intended color | CompactColorPicker opens; page click closes; no invented rect. |
| Break keyboard | Space stays pan (`dataset.spacePan` armed); Style stays closed. |
| Break invent / hub | hubPreview Style / Draw **0**. |
| Edge search fixture | `text-search-glyph-lab.pdf` page click closes Style; `file.id` null; viewBox **`0 0 612 792`**. |
| Edge 390 | Desktop Style **0**. Zoom and fit options stays. Default Style trigger **0**. viewBox **`0 0 612 792`**. `file.id` null. |

Hunt live counts: Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments **0**. `file.id` null. Select caret page-click **0**. Style / Width after page click **0**. Eraser caret / Excel actions / File menu **0**.

Product edit: `src/AppShell.jsx` exclusive formatting layer only — capture `pointerdown` + consume page-surface dismiss. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `src/AppShell.jsx` (exclusive layer capture `pointerdown` + page-surface consume)
- `debug/scenarios/e2e-style-width-menu-dismiss.spec.mjs`
- `debug/scenarios/e2e-after-fit-options-independent-hunt.spec.mjs`
- `tests/styleWidthMenuDismiss.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
