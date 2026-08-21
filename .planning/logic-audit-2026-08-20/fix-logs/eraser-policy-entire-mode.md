# KB-1 leftover — entire-mode “bypass”

- Date: 2026-08-21
- Status: **intentional / already correct** (live product path)
- IDs: **KB-1** leftover only. ID stays **proven**. Goal stays open.
- Product files changed: **none**
- `fix-logs/eraser-policy.md` does not exist in this worktree (only `eraser-policy-verify.md` + `eraser-preview.md`).
- Did not apply SQL. Did not retry the 20 host-blocked leftovers. Did not invent a 30-day trash for P1-45. No commit.

## Verdict

**Not a remaining product bug.** Entire-mode all-hits on `erasePageAnnotations({ mode: 'entire' })` is the **geometry engine contract**. Product policy (topmost-only) lives in `planCanvasEraserHits` and is applied via `canErase` before the engine runs. A caller that skips the planner would over-delete; no live `src/` caller does that.

Do not move topmost ranking into `erasePageAnnotations` — that would be a refactor of a high-risk path. The engine stays all-hits; the canvas planner stays the filter.

## What the leftover actually is

REPORT / `known-bugs-deep-dive.json` Part 2 asked for topmost-only in entire (object-eraser) mode. That landed in `FabricEraserCanvas.jsx` (`planCanvasEraserHits`, `/* @@planCanvasEraserHits */`), not inside the engine.

`getEraserOperation`:

- `partial` + ink → `'partial'`
- `partial` + non-ink → `'skip'`
- `entire` / unknown → `'entire'` (atomic whole-delete *if selected*)

`erasePageAnnotations` in entire/`full` still iterates every permitted hit. Tests keep that contrast on purpose (`tests/fabricEraserCanvasPreview.test.mjs` “break: entire mode without topmost would delete both stacked rects”).

## Live callers (no bypass)

| Caller | Entire-mode path |
|---|---|
| `FabricEraserCanvas.applyEraserAndCommit` | Planner winners → `canErase` allowlist → engine |
| `annotationDocStore.intersectAnalyticEraserLanes` | `mode: 'partial'` only |
| `annotationDocStore.deriveWriterEraserLane` | Replays `erasePageAnnotations` only when `requestedMode === 'partial'` |
| `eraserPreviewPlan.planPageEraserPreview` | Thin wrapper; live canvas does not use it for entire-mode commit |

`PageAnnotationLayer.jsx` (legacy `?renderer=canvas`) does **not** call `erasePageAnnotations`. It has its own Fabric loop. `skip` now `continue`s. Entire mode there is still all-hits. That is the legacy canvas leftover, not a default-SVG product path, and was not edited here.

## Intended vs break vs edge

| Case | Result |
|---|---|
| **Intended — partial on stacked rects** | Engine + planner skip non-ink. Live: plan `empty` / `targetCount: 0`. Both rects remain. |
| **Intended — entire on one stack** | Planner picks the higher `objects[]` index. Live: plan `planned` / `targetCount: 1` / `kinds: shape`. Top deleted; bottom stays. |
| **Break — engine without planner** | `erasePageAnnotations({ mode: 'entire' })` deletes both stacked rects. Documented; not a live caller. |
| **Edge — long drag across offset stacks** | Per-sample union deletes the top of *each* region the stroke crosses (Part 2 spec). A swipe that leaves the overlap can take the exposed bottom. Nested/centered swipe does not. |
| **Edge — locked top** | Next permitted object below wins (`objectAllowed` filter). Node-covered. |
| **Edge — overlays** | Callouts outrank markers outrank `objects[]`. Node-covered. |

## Test evidence

Node (67 / 67):

```
node --test \
  tests/eraserPolicy.test.mjs \
  tests/eraserInkOnlyPartial.test.mjs \
  tests/fabricEraserCanvasPreview.test.mjs \
  tests/pageSpaceEraser.test.mjs \
  tests/eraserPreviewPlan.test.mjs
```

Includes: partial skip; entire engine all-hits; planner+`canErase` topmost-only; zoomGeneration + `preview.width / pageWidth` source asserts.

Vite 5173 `?testPdf=clickable-link-test.pdf` (reuse existing server, did not spawn/kill):

```
npx playwright test --config=debug/playwright.reuse-5173.config.mjs e2e-kb1-entire-mode.spec.mjs --reporter=line
```

**1 / 1 passed** (4.7s). Receipt:

- bottom `796fac2d-244e-42b6-b45b-c8956b29d82e`, top `0f92ed81-f75f-426d-9001-37ee9a3c5dcc`
- after partial: both present; plan `{ status: 'empty', targetCount: '0' }`
- after entire: top gone, bottom present; plan `{ status: 'planned', targetCount: '1', kinds: 'shape' }`

Prior window D-03 (entire topmost rect) / D-04 (partial ink bite) already on `E2E-STATUS.md`.

## What was not done

- No product diff (`FabricEraserCanvas.jsx` / `PageAnnotationLayer.jsx` / `pageSpaceEraser.js` untouched).
- No `npm test` / `graphify update` (no high-risk edit).
- Host-blocked E2E paths **unchanged** (do not retry): `X-01`, `X-05` cloud, `X-06` writeback, `U-04`, `A-01`, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06`, `P-01`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`, `UL-46`.
- SQL apply leftovers still unapplied (do not apply to prod Survey).

## Remaining risk (not a new ID)

- Hypothetical future caller of `erasePageAnnotations({ mode: 'entire' })` without a planner `canErase` filter still all-hits.
- Legacy PAL `?renderer=canvas` entire-mode is still all-hits.
- Goal stays open.
