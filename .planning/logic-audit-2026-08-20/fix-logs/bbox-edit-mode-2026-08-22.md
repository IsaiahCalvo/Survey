# Double-click / 390-strip bbox edit mode — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After imported `vertex-N`, the named leftover is double-click **bbox edit mode** (uniform resize+rotate chrome) for polygon / polyline / line / arrow / counter. Not E-01 single-click rect bbox. Not S-03/S-04 `p1`/`p2`/`midpoint`. Not X-04 vertex-N. Live-proved on `?testPdf=e2e-poly-vertices.pdf`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / poly create / ellipse radii. Did **not** invent `.env.local`. Did **not** replay leftover-18, vertex-N, line handles, callout family, Keep active, Survey notes, page ctx, Survey module, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, Search, keyboard, swatches, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome, E-01 bbox resize.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| E-01 Resize | Rect/ellipse/text single-click `br/tl/…`. Not the type-specific → bbox **mode switch**. |
| S-03 / S-04 | Create + `p1`/`p2`/`midpoint`. Double-click bbox deferred. |
| X-04 vertex-N | Single-click imported vertices. Receipt said “Double-click bbox mode exists (not this pass).” |
| S-05 Counter | Pin / Size / Start / series Delete. Nubbin-only chrome; no bbox swap. |
| Pickers handles | Presence of bbox on creatable types. No dblclick entry. |
| Mobile strip Node | `mobileBBoxTransformEntry.test.mjs` is source-only. |

## Hunt (independent catalog)

Inspected first (per this pass): remaining handle modes, zoom extras, page-view extras, counter orbit, survey-marker handles.

| Candidate | Verdict |
|---|---|
| Double-click / 390-strip `editType='bbox'` | **GAP.** `PDFViewer` maps counter/line/polygon/polyline/legacy-arrow to bbox. Layer skips vertex/endpoint/nubbin chrome when `editingAnnotationEditType === 'bbox'`. |
| Ellipse radii | **Omitted.** Generic bbox only (E-01). Do not invent. |
| Ink / pen vertex edit | **Omitted.** Path double-click is an explicit no-op. |
| Counter nubbin / Shift-orbit | Separate leftover (not this pass). Nubbin is single-click chrome; orbit is Shift-drag. |
| Actual size / rotate-view / two-page | **Compile-hidden / enforced.** Fit menu hides `ZOOM_MODES.MANUAL`. `scrollMode` is forced `continuous`. |
| Callout mid-edge | Still omitted in source. |
| leftover-18 / Print / Forms / Note / Group / stamp / measure / Extract / Link create | Parked / compile-hidden. Not invented. |

## Source (before live)

Desktop: `onRequestEditMode` → `editType: 'bbox'` for counter / line / polygon / polyline / `isLegacyGroupArrow`. Rect / ellipse / path skip. Esc + deselect call `onRequestExitEdit`. Arming Pen/Highlighter/Eraser **clears** `editingAnnotation` (`PDFViewer` “Clear edit state when switching to drawing/eraser tools”).  
390: no reliable dblclick; `handleEnterBBoxEditFromStrip` + `aria-label="Resize and rotate"` when `canEnterBBoxEdit`. Overlay already has `data-resize-handle`. No `SVGAnnotationLayer` seam expansion.

## Live-proved

Playwright `debug/scenarios/e2e-bbox-edit-mode.spec.mjs` **1 / 1 (10.8s)** on reused Vite `http://localhost:5173` + `?testPdf=e2e-poly-vertices.pdf`. Node `bboxEditMode.test.mjs` **3 / 3**.

IDs: polygon A `5R`, polyline `6R`, polygon B `7R`, user line `386afdd7-…`, counter `a054df22-…`. Bbox handles **tl/tr/bl/br/mt/mb/ml/mr**.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Polygon dblclick → bbox + `br` grow | **pass** | Δw **49.997** Δh **37.998** dScaleX **0.278**. Vertex chrome hidden. |
| Polyline same | **pass** | Δw **41.997** Δh **29.998** dScaleX **0.234**. |
| Line endpoints → bbox | **pass** | Midpoint hidden; length Δ **46.054**. |
| Counter nubbin → bbox | **pass** | svgR Δ **32.517** (commit absorbs scale; dScale **0**). |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Pen armed | **pass** | Resize handles **gone**. Geometry unchanged (`penExitsBbox: true`). Not vertex-handle stopPropagation. |
| Empty-page drag | **pass** | Vertices/scale unchanged. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Esc exits bbox | **pass** | Vertex chrome restored; resize count 0. |
| Undo after bbox grow | **pass** | Ctrl+Z restored pre-drag geom. |
| Zoom then `br` | **pass** | `viewBox="0 0 612 792"`; still grew. No JS zoom coord. |
| Second polygon | **pass** | Growing `7R` left `5R` unchanged. |
| 390 Resize and rotate | **pass** | Strip visible after Line armed; click entered bbox (`['br']`). Properties strip covers the page — grow not asserted (desktop already grew). |

No `file.id`. No error boundary. SVG default. No product bug. No high-risk edit. Cap **8448** not loosened.

## Classification after this pass

- **GAP found and proven:** double-click / 390-strip **bbox edit mode**.
- **Omitted (not invented):** ellipse radii, ink vertex edit, stamp/image edit, callout mid-edge, counter nubbin/orbit (named leftover, not this pass).
- **Do not re-claim unblocked GAP = 0.**
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-bbox-edit-mode.spec.mjs`
- `tests/bboxEditMode.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
