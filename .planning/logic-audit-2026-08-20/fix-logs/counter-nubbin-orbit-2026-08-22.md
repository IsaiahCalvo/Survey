# Counter nubbin / Shift-orbit — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After bbox edit mode, the named leftover is counter **nubbin handle** + **Shift-orbit**. Not Size/Start, not series Delete, not double-click bbox, not UL-31 Continue pin. Live-proved on `?testPdf=clickable-link-test.pdf`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices. Did **not** invent `.env.local`. Did **not** replay leftover-18, bbox mode, vertex-N, line handles, callout family, Keep active, Survey notes, page ctx, Survey module, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, Search, keyboard, swatches, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome, E-01.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| S-05 Counter | Place + Size + Start + series Delete + bbox mode. Receipt said “Nubbin / Shift-orbit not this pass.” |
| E-02 Rotation | Rect/ellipse mtr + Shift 45°. Not the counter nub. |
| E-01 / bbox mode | Double-click swaps nubbin chrome **away**. Not the nubbin drag itself. |
| Place overlay | Click-to-drop at default 225°. Place-time Shift-orbit unproven live. |

## Hunt (independent catalog)

Inspected first: SVG selection chrome, `useSVGInteraction` Shift-orbit, PDFViewer place-time Shift, 390 pause-to-orbit.

| Candidate | Verdict |
|---|---|
| Selection nubbin | **GAP.** Single-click chrome is one circle at the tip. Drag updates `data.pointerAngle`; body stays. |
| Shift-orbit on a committed pin | **GAP.** Shift+pointerdown freezes the tip; body orbits; `left`/`top` + `pointerAngle` commit. Shift without ~3px is a toggle. |
| Place-time Shift | **GAP.** Overlay Shift freezes the tip while the tool is armed. Same orbit math. |
| 390 pause-to-orbit | **Omitted in source.** Same SVG nubbin; no `Gesture.LongPress` / pause-orbit. |
| Ellipse radii / ink vertices / stamp edit | **Omitted.** Do not invent. |
| leftover-18 / Print / Forms / Note / Group / stamp / measure / Extract / Link create | Parked / compile-hidden. Not invented. |

## Source (before live)

- `SVGAnnotationLayer`: selected counter (not bbox) renders one grab circle on the tip (`radius + radius*0.5`, default 225°). Preview is live; **pointerup did not commit** — only deselect did. Comment already said one undo entry on pointerup.
- `useSVGInteraction`: Shift+down on a counter enters `mode: 'counter-orbit'` before multi-select toggle. Mid-move Shift swaps move↔orbit. Release Shift mid-orbit returns to move. Sub-3px Shift-click toggles selection.
- `PDFViewer`: place overlay Shift locks `tipX`/`tipY`; body orbits `tipDistance`. `[COUNTER WIP]` place helpers left untouched.
- 390: no distinct nubbin; same SVG handle.

## Product fix (min-viable)

`SVGAnnotationLayer` pointerup now calls `commitCounterHandlePreview` (`source: 'counter:rotate-commit'`). Targeting seam is `data-counter-nubbin-handle="true"` — **not** `data-handle={vertex-N}`. ViewBox contract unchanged.

## Live-proved

Playwright `debug/scenarios/e2e-counter-nubbin-orbit.spec.mjs` **1 / 1 (9.9s)** on reused Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf`. Node `counterNubbinOrbit.test.mjs` **3 / 3**.

IDs: pinA `014a17a2-…`, orbit pin `32334c7c-…`, pinB `beb7dc9f-…`, place-Shift `e1e13676-…`. Default svgAngle **−135** (= 225°). `__phase35GetAnnotationById` misses counters (`data.id` ≠ `obj.id`); geometry is the live `M`/`A` path.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Select + drag nubbin | **pass** | svgAngle Δ **110.138**; body held (Δleft/Δtop **0**). After deselect, path kept −24.86°. |
| Shift-drag orbit | **pass** | Body Δ **9.669**; angle Δ **26.620**; **tipDrift 0**. |
| Place-time Shift | **pass** | Stored svgAngle **−98.71** (≠ 225°). |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Empty-page drag, none selected | **pass** | Angle/body held; no new pin. |
| Shift without drag | **pass** | Toggle only; angle/body held. |
| Pen-armed page drag | **pass** | No orbit / no body move on the stored pin. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo after nubbin | **pass** | Ctrl+Z restored pre-drag angle/body. |
| Zoom then nubbin | **pass** | `viewBox="0 0 612 792"`; svgAngle Δ **8.586**. No JS zoom coord. |
| Second counter | **pass** | Growing pinB left pinA unchanged. |
| 390 same nubbin | **pass** | Handle count **1**; svgAngle Δ **94.083**. No pause-orbit. |

No `file.id`. No error boundary. SVG default. Cap **8448** not loosened.

## Classification after this pass

- **GAP found and proven:** counter nubbin + Shift-orbit (select + place-time).
- **Product bug fixed:** nubbin pointerup now persists `pointerAngle`.
- **Omitted (not invented):** ellipse radii, ink vertices, stamp edit, callout mid-edge, 390 pause-orbit.
- **Next unique leftover (not this pass):** survey-marker handle drag (named in the bbox hunt; not replayed). UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/components/SVGAnnotationLayer.jsx` (pointerup commit + `data-counter-nubbin-handle`)
- `debug/scenarios/e2e-counter-nubbin-orbit.spec.mjs`
- `tests/counterNubbinOrbit.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
