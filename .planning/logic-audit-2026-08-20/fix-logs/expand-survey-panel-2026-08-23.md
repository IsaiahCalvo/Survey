# Expand Survey panel — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `fc0a99ce` Zoom in/out click receipt.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after rail / 390-More Zoom in/out click (`64b2241a` / `fc0a99ce`). Last hunt observed right rail **48** (`Expand Survey panel`) and deferred it. Left-rail Collapse/Expand sidebar is already dedicated on History (`e2e-history-sidebar-click-restore`). This leftover is the collapsed right-rail **Expand Survey panel** chevron (48 → 320 overlay; host flex stays 48) + Collapse Survey. Distinct from leftover-18 / X-01 / survey Y/N/N-A / X-06 writeback / remapped-after-CW / dismiss-family / Zoom buttons / Home / Close tab / tool-key / toolbar arm.

**Product:** Expand / Collapse / collapsed `Survey` icon are `type="button"` (left-rail already had this). Collapse ignores `event.detail > 1` so a double-click on Expand — same 35px header slot — does not immediately re-collapse. Mobile Open-survey close was a live bug: `markSurveySheetOpen` identity churn (`closing=true`) re-ran the `showSurveyPanel` / `expandRequestKey` effects, armed `ignoreNextSurveyHide`, and the 170ms close no-op'd — sheet stayed open. Those effects now depend only on the flag/key, matching `collapseRequestKey`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** invent survey Y/N/N-A seed or leftover-18 writeback. Did **not** replay Zoom buttons.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Dismiss-family / Zoom ± / Home / tool-key / rail Prev-Next | **Exhausted / do not replay.** |
| Left-rail Collapse/Expand sidebar | **Already dedicated** on History. Count-only this hunt. |
| Create-path without rotate / multi-select | Already dedicated (`e2e-shape-live-create` / `e2e-select-all-multi-select`). |
| Official stale contracts besides popover/8448 | Exclusive-layer popover just aligned; isolated 8448 standing. Not replayed. |
| **Expand Survey panel** | **This pass.** Compile-visible on width-48 rail; never intended+break+edge. |

## Live-proved

Playwright `e2e-expand-survey-panel.spec.mjs` **2 / 2** + hunt `e2e-after-zoom-buttons-independent-hunt.spec.mjs` **1 / 1** on Playwright Vite `http://127.0.0.1:5190` (**3 / 3 (13.6s)**). Focused Node `expandSurveyPanel` + leftover18 **16 / 16**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=clickable-link-test.pdf` 1400×900. Collapse **0**; Expand live; host **48** / panel **48** → Expand → Collapse live; host **48** / panel **320**; Choose survey template; Y/N **0**. Collapse restores Expand. viewBox **`0 0 612 792`**. `file.id` null. |
| Break desktop | Escape / Space do not collapse. Already-expanded Expand **0**. Double-click Expand stays expanded (`detail > 1`). hubPreview Expand/Collapse **0**. Hidden tools **0**. |
| Edge desktop | Page-1 rect survives; Pen-armed Expand invents **0**; 120-page Expand stays page **1**. Overlay omits Expand Survey. |
| Edge 390 | Open survey (dock) opens Choose survey template; Expand Survey **0** until then; closer hides picker. viewBox **`0 0 612 792`**. |
| Hunt | Expand Survey live; after click Collapse Survey + Choose survey template; Y/N **0**; left-rail Collapse/Expand sidebar counted not replayed; hub Expand **0**; 390 Open survey live; kal441 Forms create **0**. |

Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI checked.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `src/SurveySpacesRail.jsx`
- `debug/scenarios/e2e-expand-survey-panel.spec.mjs`
- `debug/scenarios/e2e-after-zoom-buttons-independent-hunt.spec.mjs`
- `tests/expandSurveyPanel.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
