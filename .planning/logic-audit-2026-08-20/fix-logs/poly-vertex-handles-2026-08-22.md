# Polygon / polyline vertex handles — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After line/arrow `p1`/`p2`/`midpoint`, the next unique leftover is imported polygon/polyline single-click **vertex-N** chrome. S-03/S-04 only create Line/Arrow. E-01 only dragged shape bbox. No toolbar Polygon/PolyLine tool. This pass live-proved intended+break+edge. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group. Did **not** invent `.env.local`. Did **not** replay leftover-18, line handles, callout family, Keep active, Survey notes, page ctx, Survey module, thumbnail, Fit height, Bookmarks, Eraser/Counter, F3, Search, keyboard, swatches, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome, shape bbox resize (E-01).

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| S-03 / S-04 | Line/Arrow **create** + `p1`/`p2`/`midpoint`. Not polygon vertices. |
| E-01 Resize | Shape bbox `br/tl/tr/bl/mr/ml/mb`. Not `vertex-N`. |
| X-04 Import | `kal412` Square/Ink/Stamp/Redact mount. Stamp **unsupported**. No Polygon/PolyLine fixture. |
| Pickers handles | Presence of bbox chrome on creatable types. No poly vertices. |
| Export-scale leftovers | Export bake of imported vertices. Not live drag. |

## Hunt (independent catalog)

Inspected first (per this pass): polyline/polygon vertices, ellipse radii, rect-only extras, ink/pen vertex edit, image/stamp if a fixture already embeds them.

| Candidate | Verdict |
|---|---|
| Polygon / polyline `vertex-N` | **GAP.** `SVGAnnotationLayer` single-click dots; `useSVGInteraction` `mode: 'vertex'`. Import-only (`SUPPORTED_SUBTYPES` includes Polygon/PolyLine). |
| Ellipse radii | **Omitted.** No `rx`/`ry` handles. Ellipse uses generic bbox overlay (E-01 cluster). |
| Rect-only extras | Cloud + Cloud bump already proven. No rounded-corner chrome. |
| Ink / pen vertex edit | **Omitted.** Vertex mode is polygon/polyline only. |
| Image / stamp | `kal412` embeds Stamp; importer lists Stamp as **unsupported**. No create tool. No UL-03 pick. |

Callout mid-edge still omitted. Compile-hidden Print / Forms / Note / Group / stamp / measure / Extract / Link create unchanged.

## Source (before live)

Single-click on `type===polygon|polyline` shows one circle per `obj.points` (`handleId` `vertex-N`). Other points stay frozen. Rotated shapes compensate `left`/`top` so the world pivot does not drift. Handle `onPointerDown` **stopPropagation**, so Pen-armed still edits the handle. Zoom: `viewBox={0 0 width height}`. Double-click bbox mode exists (not this pass). This pass added `data-handle={vertex-N}` on those circles (same seam as line `midpoint`; no behavior change).

## Live-proved

Playwright `debug/scenarios/e2e-poly-vertex-handles.spec.mjs` **1 / 1 (4.2s)** on reused Vite `http://localhost:5173` + `?testPdf=e2e-poly-vertices.pdf`. Node `polyVertexHandles.test.mjs` **3 / 3**.

IDs: polygon A `5R` (4 verts) + polyline `6R` + polygon B `7R`. Handle count **4**.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| `vertex-0` drag | **pass** | Δx **40.05** Δy **28.03**. Other verts held. |
| Last-vertex drag | **pass** | Δx **−24.03** Δy **36.04**. Others held. |
| Polyline `vertex-1` | **pass** | Δx **32.04** Δy **−28.03**. Others held. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Pen armed | **pass** | Handle **still moved** (Δ **41.23**). Circles `stopPropagation`. |
| Nothing selected, empty-page drag | **pass** | Vertices unchanged. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo after vertex drag | **pass** | Ctrl+Z restored the pre-drag points. |
| Zoom then `vertex-0` | **pass** | `viewBox="0 0 612 792"`; still moved (Δ **17.41**). Others held. No JS zoom coord. |
| Second polygon | **pass** | Moving `7R` left `5R` unchanged. |

No `file.id`. No error boundary. SVG default (not `?renderer=canvas`). No product bug. Official `npm test` after the `SVGAnnotationLayer` seam: standing leftover `pageOperationsQueueMounted` (`Cannot find module '/tmp/utils/pageContextOps.js'`) — unrelated to this handle path; not loosened. Cap **8448** not loosened.

## Classification after this pass

- **GAP found and proven:** imported polygon/polyline **vertex-N** handles.
- **Omitted (not invented):** ellipse radii, ink vertex edit, stamp/image edit, callout mid-edge.
- **Do not re-claim unblocked GAP = 0.**
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/fixtures/e2e-poly-vertices.pdf` + `scripts/e2e-poly-vertices-fixture.mjs`
- `debug/scenarios/e2e-poly-vertex-handles.spec.mjs`
- `tests/polyVertexHandles.test.mjs`
- `src/components/SVGAnnotationLayer.jsx` (`data-handle={vertex-N}` seam only)
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
