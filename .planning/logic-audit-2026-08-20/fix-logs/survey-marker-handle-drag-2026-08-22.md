# Survey-marker handle drag — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After counter nubbin / Shift-orbit, the named leftover is **placed** survey-marker move / resize / rotate chrome. Not U-01 Walls stamp-create. Not Keep-active after-place. Not notes / module Next/Prev. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick. Did **not** invent `.env.local`. Did **not** replay leftover-18, nubbin / Shift-orbit, bbox mode, vertex-N, line handles, callout family, Keep-active after-place, Survey notes, Survey module, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, Search, keyboard, swatches, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome, U-01 Walls stamp create. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| U-01 Survey rail | Walls **stamp** + module Next/Prev + Keep after-place + notes. Not edit handles on a committed marker. |
| e2e-survey-marker | Place / persist / export-exclude / undo second. No move / resize / rotate. |
| E-01 / E-02 / E-03 | Rect/ellipse/text bbox + counter nubbin. Survey markers live in `surveyMarkers`, not `annotations.objects`. |
| Pickers handles | Presence of rect bbox. Not this overlay path. |

## Hunt (independent catalog)

Inspected first: `SVGAnnotationLayer` survey-marker edit chrome, `SVGSelectionOverlay`, `handleSurveyMarkerBoundsChange`.

| Candidate | Verdict |
|---|---|
| Body hit target | **GAP.** `data-survey-marker-hit-target` → `mode: 'move'`. Select-only. |
| 8 resize handles | **GAP.** Same overlay `tl/tr/bl/br/mt/mb/ml/mr` → `mode: 'resize'`. |
| `mtr` rotate | **GAP.** `data-rotation-handle="mtr"` → `mode: 'rotate'`. |
| `mt` vs rotation stem | **Product.** Stem hit stroke started on `mt` and ate the top pill. Clearance added. |
| 390 "Resize and rotate" strip | **Omitted.** `canEnterBBoxEdit` is counter/line/polygon/polyline only. Same SVG overlay. |
| Ellipse radii / ink vertices / stamp edit | **Omitted.** Do not invent. |
| leftover-18 / Print / Forms / Note / Group / stamp / measure / Extract / Link create | Parked / compile-hidden. Not invented. |

## Source (before live)

- `SVGAnnotationLayer`: selected marker renders `SVGSelectionOverlay`. Body pointerdown is move. Handle pointerdown is resize, or rotate when `handleId === 'mtr'`. `updateSurveyMarkerDrag(..., true)` on pointerup commits `x/y/width/height/angle` via `onUpdateSurveyMarkerBounds`. Group `pointerEvents` is Select-only; create path is `tool === 'survey-marker'`.
- `PDFViewer.handleSurveyMarkerBoundsChange`: history `survey-marker:${action}`; persists `bounds.angle`.
- 390: no distinct survey-marker handle strip. Sheet backdrop can eat Playwright mouse (same as Keep-active 390).

## Product fix (min-viable)

`SVGSelectionOverlay`: rotation stem **hit** line now starts above the `mt` pill by `hPillH/2 + stemHitWidth/2 + minGap`. Visual hairline still meets `mt`. Shared overlay — `mt` resize is hittable for every bbox consumer. Not `data-handle={vertex-N}`. Not `data-counter-nubbin-handle`. ViewBox contract unchanged.

## Live-proved

Playwright `debug/scenarios/e2e-survey-marker-handle-drag.spec.mjs` **1 / 1 (9.2s)** on reused Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyMarkerHandleDrag.test.mjs` **3 / 3**.

IDs: markerA `surveyMarker-f2278960-…`, markerB `surveyMarker-9d44957f-…`. Chrome `['tl','tr','bl','br','mt','mb','ml','mr']` + `mtr`. `viewBox="0 0 612 792"`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Body move | **pass** | dPos **91.331**; dw/dh/dAngle **0**. |
| `tl` | **pass** | Δw **44.054** Δh **32.039**. |
| `tr` | **pass** | Δw **52.064** Δh **32.039**. |
| `bl` | **pass** | Δw **44.054** Δh **40.049**. |
| `br` | **pass** | Δw **56.069** Δh **40.049**. |
| `mt` | **pass** | Δh **48.059** (stem gap). |
| `mb` | **pass** | Δh **44.054**. |
| `ml` | **pass** | Δw **52.064**. |
| `mr` | **pass** | Δw **56.069**. |
| `mtr` | **pass** | svgAngle Δ **48.602**; size held. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Empty-page drag, none selected | **pass** | Geom held; no new marker. |
| Pen-armed page drag | **pass** | Geom held; no new marker. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo after `br` | **pass** | Ctrl+Z restored pre-grow w/h. |
| Zoom then `br` | **pass** | `viewBox="0 0 612 792"`; Δw **30.720** Δh **20.480**. No JS zoom coord. |
| Keep-active on | **pass** | Flag on at place. Handle drag left count **2** (no third stamp). |
| Second marker isolated | **pass** | Growing B left A unchanged. |
| 390 | **pass** (chrome identity) | Same overlay; **0** `Resize and rotate` strip. Place via Playwright mouse/dispatch did not land (sheet backdrop — same as Keep-active 390). Desktop already dragged every handle. |

No `file.id`. No error boundary. SVG default. Cap **8448** not loosened (no high-risk edit). Official `npm test` not replayed.

## Classification after this pass

- **GAP found and proven:** placed survey-marker move / 8 resize / `mtr` rotate.
- **Product bug fixed:** rotation stem no longer covers `mt`.
- **Omitted (not invented):** ellipse radii, ink vertices, stamp edit, callout mid-edge, 390 pause-orbit / bbox strip for markers.
- **Next unique leftover (not this pass):** survey-marker **delete chrome** (`aria-label="Delete Survey Marker"` + Select-mode Backspace/Delete). Not E-04 rect Backspace. Not counter-series Delete. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/components/SVGSelectionOverlay.jsx` (stem hit clearance above `mt`)
- `debug/scenarios/e2e-survey-marker-handle-drag.spec.mjs`
- `tests/surveyMarkerHandleDrag.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
