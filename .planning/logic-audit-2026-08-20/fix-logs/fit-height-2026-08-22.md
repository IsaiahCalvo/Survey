# Fit height — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

The 2026-08-21 exhausted receipt claimed unique unblocked GAP **0** after 390 Bookmarks. That claim is **false**. Fit height is a reachable menu control with its own `ZOOM_MODES.FIT_HEIGHT` path. Prior catalogs classified it as proven at **cluster** level (`UL-05` “Fit options live click”, V-04 Fit page + Fit width, 390 chrome Fit width only). No spec grepped `Fit height` / `FIT_HEIGHT` as a clicked option.

Did **not** invent `.env.local`. Did **not** replay 390 Bookmarks or Eraser Size. Did **not** invent Print / stamp / measure / Group / Extract / Note / Link create. No 768 tablet pass (`isNarrowShell` is `max-width: 720px` only).

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| V-04 Zoom | Toolbar Zoom in/out + **Fit page** + **Fit width**. No Fit height. |
| UL-05 Fit options | “live click” of the menu. `e2e-wave-remaining` clicks Fit page + Fit width only. |
| 390 chrome hit-targets | Header chevron → **Fit width** only. |
| search-result-click catalog | Dismissed Fit height as “UL-05 Fit options live click”. |
| `e2eUnlistedControls.test.mjs` | Constant `ZOOM_MODES.FIT_HEIGHT === 'fitHeight'` only. |
| Exhausted 2026-08-21 | Lumped under V-01…V-09 / UL-01…UL-46 cluster-proven. |

Product path is distinct: `PDFViewer.handleZoomModeSelect` uses `magnification.fitToPage()` / `fitToWidth()` for those modes, but **Fit height** computes `clampScale(wrapperH / realPageH)` then `magnification.zoomTo(...)`. On a 390×844 letter page, Fit height **≠** Fit page (Fit page collapses to Fit width).

## Hunt (other hinted candidates)

| Candidate | Verdict |
|---|---|
| **Fit height** | **This pass.** |
| Actual size | No `ZOOM_MODES` / menu label. Manual % is pinch/step result, filtered from both fit menus. |
| Rotate view | Not a viewer control. Print-panel rotate is compile-gated (`PRINT_PANEL_ENABLED=false`). Page rotate is UL-32. |
| Dark / light toggle | No theme switch in AppShell / mobile chrome / hubPreview. |
| Icon-only unnamed | Hub tabs named this wave (`aria-label={tab.label}`). Desktop rail tabs already named. Fit trigger is `Fit options` / `Zoom and fit options`. |
| 390 More overflow | Export + Zoom in/out (+ Capacitor Save log). Fit lives on the header chevron, not More. |
| Callout arrowhead | Same `AnnotationDropdown` as Arrow; pickers site 12 cited S-04 (6 styles). Not a second catalog. |
| Callout knee / leader | Canvas drag handle, not a toolbar control. T-02 + callout paste cover create/clone; not a discrete chrome GAP. |
| Lock / hide annotation | No local user control. Import lock flags only. Opacity is C-03. |
| Spaces / survey beyond dock | U-01 / U-02 + 390 dock presence. Cloud persist leftover-18. |
| Right-rail tabs | Survey panel U-01; zoom footer is this Fit height site on desktop. |
| leftover-18 | Still parked. No `.env.local`. |

## Live-proved

Playwright `debug/scenarios/e2e-fit-height.spec.mjs` **1 / 1 (6.9s)** on reused Vite `http://localhost:5173`. Node `tests/fitHeightZoom.test.mjs` **3 / 3**.

| Slice | Intended / break / edge |
|---|---|
| Intended 390 | `?testPdf=clickable-link-test.pdf` at 390×844. Fit height pageH **>** Fit page / Fit width by >8px. pageH fills wrapper (±24px). pageW and `scrollWidth` overflow (horizontal scroll). Option `aria-selected=true`. |
| Break re-click | Second Fit height stays (±4px). |
| Break absent | Menu has **3** options. No Actual size. No Rotate view. |
| Edge Zoom in | More → Zoom in leaves the height fill; Fit height restores pageH ≈ wrapH. |
| Edge armed + 120-page | `spike-120-pages.pdf`, Pen/Draw armed. Fit width then Fit height still fills height. |
| Desktop rail | 1400×900 Fit options → Fit height. `%` ≠ Fit width. `data-active=true` on Fit height. pageH fills wrapper (±36px). No Actual size / Rotate view rows. |

No product bug. No high-risk edit. Cap **8448 MiB / 75/250** not loosened. Official `npm test` leftover not replayed.

## Classification after this pass

- **GAP found and proven:** Fit height (was omitted / cluster-classified).
- **Do not re-claim unblocked GAP = 0.** Exhausted 2026-08-21 is falsified. This file does not stamp a new zero.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note, Group/Ungroup, stamp, measure, Extract, Link create).

## Files

- `tests/fitHeightZoom.test.mjs`
- `debug/scenarios/e2e-fit-height.spec.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/fix-logs/unblocked-catalog-exhausted-2026-08-21.md`
- this receipt

Goal stays open.
