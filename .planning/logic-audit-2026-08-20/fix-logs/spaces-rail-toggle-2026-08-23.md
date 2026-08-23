# Spaces rail toggle — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `8f8ee007` Expand Survey panel receipt.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Expand Survey panel (`8f8ee007` / `ae2016a4`). Last hunt counted left-rail **Spaces** and deferred it. Expand Survey and left-rail History Collapse/Expand sidebar stay dedicated. This leftover is the collapsed 48px left-rail **Spaces** tab (48 → 272 Spaces panel) + 390 Open spaces. Distinct from leftover-18 / X-01 / Space CSV / PDF Pages / survey Y/N/N-A / remapped-after-CW / dismiss-family / Expand Survey / Spaces card Expand / Survey/Spaces menu dismiss / Home / Close tab / tool-key / toolbar arm.

**Product:** collapsed left-rail Pages / Search text / Bookmarks / Spaces icons were missing `type="button"` (expanded tabs and Expand/Collapse sidebar already had it). Same hygiene class as the Expand Survey pass. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** invent survey Y/N/N-A or leftover-18 Space CSV / PDF Pages apply. Did **not** replay Expand/Collapse Survey.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** No `.env.local`; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Dismiss-family / Zoom ± / Home / tool-key / rail Prev-Next / Expand Survey | **Exhausted / do not replay.** |
| Left-rail Collapse/Expand sidebar | **Already dedicated** on History. Contrast-only this leftover (opens Pages, not Spaces). |
| Create-path without rotate / multi-select | Already dedicated (`e2e-shape-live-create` / `e2e-select-all-multi-select`). |
| Official stale contracts besides popover/8448 | Exclusive-layer popover aligned; isolated 8448 standing. Not replayed. |
| **Spaces rail toggle** | **This pass.** Compile-visible on width-48 left rail; never intended+break+edge as the panel switcher. |

## Live-proved

Playwright `e2e-spaces-rail-toggle.spec.mjs` **2 / 2** + hunt `e2e-after-expand-survey-independent-hunt.spec.mjs` **1 / 1** on Playwright Vite `http://localhost:5173` (**3 / 3 (16.3s)**). Focused Node `spacesRailToggle` + leftover18 **16 / 16**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=clickable-link-test.pdf` 1400×900. Collapse **0**; Spaces live; host **48** / panel **48** → Expand sidebar contrast hides Spaces heading; Spaces click → heading Spaces + No spaces yet + Create space; host **48** / panel **272**; Y/N **0**. Collapse sidebar restores Spaces icon. viewBox **`0 0 612 792`**. `file.id` null. |
| Break desktop | Escape / Space do not collapse. Already-open Spaces re-click stays panel **272**. Double-click Spaces stays expanded and invents **0** cards. hubPreview viewer Spaces panel / Create space **0**. Hidden tools **0**. |
| Edge desktop | Page-1 rect `6bb92936-…` survives; Pen-armed Spaces invents **0**; 120-page Spaces stays page **1**. Overlay lists B Toggle sidebar, not a Spaces chord. |
| Edge 390 | Open spaces (dock) opens No spaces yet + Create space; closer hides panel. viewBox **`0 0 612 792`**. |
| Hunt | Spaces live; after click panel **272** / host **48** + No spaces yet + Create space; Y/N **0**; Expand Survey counted not replayed; hub viewer Spaces panel **0**; 390 Open spaces live; kal441 Forms create **0**. |

Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `src/PDFSidebar.jsx`
- `debug/scenarios/e2e-spaces-rail-toggle.spec.mjs`
- `debug/scenarios/e2e-after-expand-survey-independent-hunt.spec.mjs`
- `tests/spacesRailToggle.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
