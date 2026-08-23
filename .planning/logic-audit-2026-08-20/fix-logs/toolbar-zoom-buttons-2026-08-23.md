# Rail / 390-More Zoom in/out click — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `117b0f1d` exclusive-layer pointerdown contract hunt.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after official exclusive-layer pointerdown align (`cfde5d64` / `117b0f1d`). Dismiss-family + official popover contract are exhausted. V-04 keyboard Ctrl++/− / Fit width already dedicated (`e2e-zoom-keyboard-fit-width`). UL-06 is the Zoom % field. Ctrl+wheel / Fit page / Fit height / Ctrl+2 / Ctrl+M already dedicated. Prior hunts deferred rail Zoom ± as “replay-adjacent” — same `zoomIn`/`zoomOut` as Ctrl++/−, but the **click** control was never intended+break+edge (parallel to rail Previous/Next vs V-05 keyboard). Distinct from leftover-18 / X-01 / remapped-after-CW / dismiss-family replay / Home tab / Close tab / tool-key / toolbar arm.

**Product:** none. Rail `onClick={api.zoomIn}` / `api.zoomOut` already call `clampScale(basis * 1.25)`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay dismiss-family menus or the just-aligned popover contract.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Dismiss-family menus | **Exhausted / do not replay.** |
| Official exclusive-layer popover contract | **Just aligned** (`cfde5d64`). Do not replay. |
| Rectangle/Ellipse create-path | **Already proved** (`e2e-shape-live-create`). |
| Text formatting / color pickers without rotate | T-03…T-07 / callout-formatting / pickers-every-swatch already dedicated. |
| Multi-select | V-02 dedicated. |
| Keyboard zoom / tool / page-nav | Exhausted (Ctrl+2 / Ctrl+M / Ctrl+0 / Ctrl+1 / P-04 / rail Prev-Next). |
| **Rail / 390-More Zoom in/out click** | **This pass.** Live named buttons; Node only had collapsed-rail *order* (`zoomRailControlOrder`). |

## Live-proved

Playwright `e2e-toolbar-zoom-buttons.spec.mjs` **2 / 2 (13.6s)** + hunt `e2e-after-exclusive-layer-independent-hunt.spec.mjs` **1 / 1 (8.1s)** on Playwright Vite `http://127.0.0.1:5173` (**3 / 3 (15.0s)**). Focused Node `toolbarZoomButtons` + leftover18 **15 / 15**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=clickable-link-test.pdf` 1400×900. Fit page **100%** → Zoom in **125%** (1.25 step); leaves Fit page; Zoom out lowers. viewBox **`0 0 612 792`**. `file.id` null. Rect `3c4e4568-…`. |
| Break desktop | Floor extra Zoom out stays **100%**; 4000% Zoom in clamps; Zoom % INPUT focused still applies the **click**; hubPreview Zoom in/out **0**. Hidden tools **0**. |
| Edge desktop | Page-1 rect survives; Pen-armed Zoom in invents **0**; 120-page Zoom in stays page **1**. Overlay lists keyboard Zoom in, not a rail-click row. |
| Edge 390 | More document options → Zoom in **318→398**; Zoom out shrinks. Rail Zoom in **0** until More. viewBox **`0 0 612 792`**. |
| Hunt | Zoom in/out **1**; 390 More **1** then Zoom in **1**; hub Copy-to-Spaces **0**; right rail **48** (`Expand Survey panel` observed, not this leftover); kal441 Forms create **0**. |

Product edit: none. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI checked.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `debug/scenarios/e2e-toolbar-zoom-buttons.spec.mjs`
- `debug/scenarios/e2e-after-exclusive-layer-independent-hunt.spec.mjs`
- `tests/toolbarZoomButtons.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
