# Pages context menu dismiss — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `27ea9639` Style/Width dismiss.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Style/Width dismiss (`39da34c8` / `27ea9639`). Pages apply (Rotate / Insert / Delete / Duplicate / Move) already dedicated. This leftover is Pages **thumbnail context dismiss** on a page click while a creation tool is armed. Overlay lists Esc as Close dialogs/cancel. Distinct from leftover-18 / X-01 / remapped-after-CW / Fit apply / Fit dismiss / Style/Width dismiss / Select caret / Home / Close tab.

**Product:** PagesPanel listened for bubble `mousedown`. SVG `onPointerDown` `preventDefault`s while Rectangle (and other create tools) are armed, which suppresses the compatibility mousedown — so a page click never closed Pages context. Last hunt opened Pages **after Eraser** (SVG `pointer-events: none`) and could not see it. Listener is now capture `pointerdown`. Page-surface dismiss is consumed so it does not start a rubber-band (same contract as AppShell exclusive layer). Escape already closed. Annotation context menu had the same swallowed-mousedown listener; switched in the same pass. 390 already had a pointerdown scrim.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay remapped-after-CW, Ctrl+2 / Ctrl+M, menu Fit height / Ctrl+0 / Ctrl+1, Fit dismiss, Style/Width dismiss, rail Previous/Next, keyboard letters, toolbar click-to-arm, or Home/Close tab.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Style / Width / Fit dismiss | **Exhausted / do not replay.** |
| Select caret arm-then-toggle | **Already proved.** |
| Rectangle/Ellipse create-path | **Already proved** (`e2e-shape-live-create`). |
| Font / Arrowhead popovers | Triggers **0** with those tools in this chrome (exclusive layer already pointerdown). |
| Eraser / Highlighter caret / File menu / Excel actions | **0.** |
| Search Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments | **0.** |
| Official stale contracts | leftover-18 Node **12 / 12**. Isolated 8448 standing. No new stale official contract. |
| 390 Zoom-and-fit / default Style | **Already proved / 0.** Document tools **0** this hunt. |
| Hub Documents More / Account | Already dedicated. Escape closes More. |
| **Pages context page-click dismiss while Rectangle armed** | **This pass.** Live hunt before the fix: Pages context stayed **1** after page click. After: **0.** |

## Live-proved

Playwright `debug/scenarios/e2e-pages-context-menu-dismiss.spec.mjs` **2 / 2 (6.7s)** on Playwright Vite `http://localhost:5173`. Hunt `e2e-after-style-width-independent-hunt.spec.mjs` **1 / 1 (4.6s)** post-fix. Focused Node `pagesContextMenuDismiss` + leftover18 **15 / 15**.

| Slice | Intended / break / edge |
|---|---|
| Intended Escape | `?testPdf=clickable-link-test.pdf` 1400×900. Rectangle armed. Pages context opens Rotate. Escape closes. |
| Intended click-outside | Page click closes. No invented rect (`marksBefore` held). Second Escape invents **0**. |
| Break keyboard | Space stays pan (`dataset.spacePan` armed); Pages context stays closed. |
| Break invent / hub | hubPreview Pages / Draw **0**. |
| Edge search fixture | `text-search-glyph-lab.pdf` page click closes Pages context; `file.id` null; viewBox **`0 0 612 792`**. |
| Edge 390 | Desktop Fit options **0**. Zoom and fit options stays. Page 1 actions / default Pages context **0** or page click closes. viewBox **`0 0 612 792`**. `file.id` null. |

Hunt live counts: Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments **0**. `file.id` null. Pages context after page click **0**. Eraser caret / Excel actions / File menu **0**.

Product edit: `src/sidebar/PagesPanel.jsx` + `src/hooks/useAnnotationContextMenu.jsx` — capture `pointerdown` + consume page-surface dismiss. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `src/sidebar/PagesPanel.jsx` (capture `pointerdown` + page-surface consume)
- `src/hooks/useAnnotationContextMenu.jsx` (same contract)
- `debug/scenarios/e2e-pages-context-menu-dismiss.spec.mjs`
- `debug/scenarios/e2e-after-style-width-independent-hunt.spec.mjs`
- `tests/pagesContextMenuDismiss.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
