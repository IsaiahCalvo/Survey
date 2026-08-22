# Line / arrow endpoint + midpoint handles — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. Callout mid-edge `textBox-mt/ml/mb/mr` **does not exist** (only `textBox-tl/tr/bl/br`). The unique leftover after that family is line/arrow single-click chrome: `p1` / `p2` / `midpoint`. S-03/S-04 only created the stroke. E-01 only dragged shape bbox `br/tl/tr/bl/mr/ml/mb`. Phase-15 smoke specs skip if the handle is missing. This pass live-proved intended+break+edge. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group. Did **not** invent `.env.local`. Did **not** replay leftover-18, callout family, Keep active, Survey notes, page ctx, Survey module, thumbnail, Fit height, Bookmarks, Eraser/Counter, F3, Search, keyboard, swatches, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| S-03 Line / S-04 Arrow | Live **create** drag-commit. Handles never grabbed. |
| E-01 Resize | Shape bbox `br/tl/tr/bl/mr/ml/mb`. Not line `p1`/`p2`/`midpoint`. |
| E-02 Rotation | Bbox rotate. Not endpoint/midpoint. |
| T-02 callout leftovers | `textBox-tl/tr/bl/br` + flip/knee-rollback. No mid-edge. Not line chrome. |
| Phase-15 smoke | `test.skip` if `circle[data-handle="midpoint"]` missing. Not this audit spec. |

## Hunt (independent catalog)

Sources: `SVGAnnotationLayer.jsx` single-click line chrome (`handleHandlePointerDown` `p1`/`p2`/`midpoint`); `useSVGInteraction.js` `mode: 'endpoint' | 'midpoint'`; `lineDragMath.js` 10px snap / preserve-midpoint; AppShell toolbars; pages menu Extract still missing-handler; compile-hidden Print / Forms / Note / Group / stamp / measure / Link create unchanged. No 768 tablet chrome. Callout has no `textBox-mt/ml/mb/mr`.

## Source (before live)

Single-click on a `type===line` (Line or Arrow) shows three circles — endpoints + a smaller midpoint. Midpoint drag writes `data.midpoint` (quadratic `<path Q>`). Release within **10 page-px** of the chord clears it (snap-to-straight). Endpoint drag moves that tip; the other tip stays. Handle `onPointerDown` **stopPropagation**, so Pen-armed still edits the handle. Zoom: `viewBox={0 0 width height}`. No callout mid-edge handles.

## Live-proved

Playwright `debug/scenarios/e2e-line-endpoint-midpoint.spec.mjs` **1 / 1 (5.9s)** on reused Vite `http://localhost:5173` + `?testPdf=text-search-glyph-lab.pdf`. Node `lineEndpointMidpointHandles.test.mjs` **3 / 3**.

IDs: line `a2c96590-…` + arrow `37f6a6cf-…` + second `fa56264b-…`. Handle count **3**.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| `p2` drag | **pass** | Δx **48.06** Δy **36.04**. `p1` held. |
| `p1` drag | **pass** | Δx **−36.04** Δy **28.03**. `p2` held. |
| Midpoint bend | **pass** | `data.midpoint.y` **325.7**; `<path>` with `Q`. Endpoints held. |
| Arrow same chrome | **pass** | `p2` Δx **40.05**; midpoint wrote a curve. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Snap-to-straight | **pass** | Midpoint dragged back onto the chord. `data.midpoint` cleared. |
| Pen armed | **pass** | Handle **still moved** (Δ **46.70**). Circles `stopPropagation`. |
| Nothing selected, empty-page drag | **pass** | Endpoints unchanged. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo after bend | **pass** | Ctrl+Z restored the pre-drag chord / no midpoint. |
| Zoom then `p2` | **pass** | `viewBox="0 0 612 792"`; `p2` still moved (Δ **21.30**). `p1` held. No JS zoom coord. |
| Second line | **pass** | Moving `second` left the first endpoints unchanged. |

No `file.id`. No error boundary. SVG default (not `?renderer=canvas`). No product bug. No high-risk edit. Cap **8448** not loosened.

## Classification after this pass

- **GAP found and proven:** line/arrow **p1 / p2 / midpoint** handles (bend + snap).
- **Do not re-claim unblocked GAP = 0.**
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).
- **Callout mid-edge:** omitted in source — not invented.

## Files

- `debug/scenarios/e2e-line-endpoint-midpoint.spec.mjs`
- `tests/lineEndpointMidpointHandles.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
