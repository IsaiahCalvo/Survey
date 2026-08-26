# Hunt after selected-callout Fill swatch independence — 2026-08-26

## Leftover taken

**None.** Real hunt after tip `bcc9bead` / product `c22e7910`. Did not invent a leftover. Goal stays OPEN.

Did **not** replay selected-callout Fill swatch independence. Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, Square / Circle `/BS`, or a create-poly tool. HIGH-RISK files not touched. Did **not** stamp `file.id`.

## Hunt (live + source)

Prefer next live persist / create-path / view clamp / Select chrome leftover after selected-callout Fill swatch independence (`bcc9bead` / product `c22e7910`):

| Candidate | Live control | Verdict |
|---|---|---|
| **Selected-shape Fill vs Border swatch** | Color Fill / Border after Select | **already aligned** — Rect Fill 90 + Border 10 writes `fill` **0.90** / `stroke` **0.10**; Select disc **0.90** / ring **0.10** (not leftover **0.09**) |
| **Selected-textbox Fill vs Border** | Color Fill / Border first-create | **already aligned** — first box writes `backgroundColor` **0.90** / `stroke` **0.10**; object `opacity` stays **1** |
| Selected-callout Fill swatch × leftover Border | Color Fill after Select | **already landed** `c22e7910` — Fill uses `fillOpacityValue` only |
| Selected-callout Border swatch after Fill | Color Border after Select | **already aligned** — ring uses `borderOpacity` only |
| Selected-ellipse Fill vs Border | Color Fill / Border | **already aligned** — same `objectOpacity` × per-color rgba path as Rect |
| Other `selectedPreviewColors` multiplies | Select chrome | **not live** — path / line / counter use `objectOpacity` (typically 1) against already-independent rgba |
| Eraser-cut paper-ink Width | Width after Select | skip is intentional — restroke would restore erased bits |
| Imported outline Width (no centerline) | Width after Select | skip is intentional — no centerline to restroke |
| Callout CREATE-01 rubber-band color/width | in-drag preview | **not a leftover** — dashed 0.6 ghost is CREATE-01; commit already stamps live Color / Width |
| Font / B / I / size persist | Font chrome | **not live** — richTextEditor edit-only |
| Line `/AP` | Line | **not a leftover** — native Line has no `/AP` |
| leftover-18 human-gated | — | **not taken** |

Live probe before the receipt (`/?testPdf=clickable-link-test.pdf`): Rect Fill **90** + Border **10** wrote `rgba(255, 255, 255, 0.9)` / `rgba(255, 0, 0, 0.1)` / `opacity` **1**; Select Color disc `fillA` **0.90** and Border ring **0.10**. Textbox first-create wrote `backgroundColor` **0.90** / `stroke` **0.10**.

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent Line `/AP`. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** replay `pdfAnnotationsPdfLib.js` `/AP` writers. Did **not** restroke eraser-cut paper-ink or imported outlines without a centerline.

## Files

- `tests/afterCalloutFillSwatchIndependentHunt.test.mjs`
- `debug/scenarios/e2e-after-callout-fill-swatch-independent-hunt.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/after-callout-fill-swatch-independent-hunt-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-after-callout-fill-swatch-independent-hunt.spec.mjs` **2 / 2 (7.0s)**.

- Intended: Rect Fill **90** + Border **10** writes fill **0.90** + stroke **0.10**; Select Color disc stays **0.90** (not leftover **0.09**) and Border ring stays **0.10**; first Textbox after Fill **90** + Border **10** writes `backgroundColor` **0.90** + stroke **0.10**
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent; mobile Rectangle keeps Fill disc **0.90**

Node `afterCalloutFillSwatchIndependentHunt` proves selected-shape Fill 90 + Border 10 paints `rgba(..., 0.9)` not leftover `0.09`, textbox first-create Fill 90 / Border 10 stay independent, empty default Fill stays empty, isolated 8448 / 75/250 standing.

Focused Node `afterCalloutFillSwatchIndependentHunt` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Selected-shape Fill vs Border already independent — not a leftover
- Selected-textbox Fill vs Border already independent — not a leftover
- Selected-callout Fill swatch no longer multiplies leftover Border — not a leftover after `c22e7910`
- Selected-callout Color swatch floor 0.08 / 0.2 already aligned — not a leftover
- Selected paper-ink Width rebuild already aligned — not a leftover
- Eraser-cut paper-ink Width still patches `sourceWidth` only (restroke would restore erased bits) — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Callout CREATE-01 rubber-band stays a dashed 0.6 ghost — not a leftover
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- Line `/AP` — native Line has no `/AP`; do not invent
- Callout box Rotation — callouts have no live box Rotation; do not invent
- Counter pin Rotation — `lockRotation`; do not invent
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
