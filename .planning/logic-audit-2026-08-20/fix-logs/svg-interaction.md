# svg-interaction — P1-05, P1-06, P1-08, P1-29

Date: 2026-08-20
Bucket: `svg-interaction`
Allowlist: `src/hooks/useSVGInteraction.js` + matching tests
Did not edit: `SVGAnnotationLayer.jsx`, `PDFViewer.jsx`, ISSUE-INVENTORY / FEATURE-MATRIX / FIX-LOG

---

### P1-05 — Multi-select rotate/resize displaces lines
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/hooks/useSVGInteraction.js` (`applyGroupLineWorldTransform`, group-rotate + group-resize line branches)
- Intended behavior confirmed: a fabric-contract line `(100,100)→(150,140)` (`left/top/width/height` + center-relative `x1..y2`) round-trips through `getLineEndpoints` + pack. Group-rotate 90° around `(100,100)` lands world endpoints at `(100,100)` and `(60,150)`, not the `x1+left` displacement. Group-resize ×2 from `(100,100)` lands `(100,100)`→`(200,180)`.
- Break / adversarial attempts: the pre-fix `x1 + left` path is asserted *not* equal to `getLineEndpoints` (width/2 offset). Write-back is fabric-packed so a later `getLineEndpoints` agrees with the renderer.
- Edges covered: intended fabric contract; grouped rotate; grouped resize.
- Test command + result: `node --test tests/svgInteractionFixes.test.mjs` → 6/6 pass.
- Remaining risk: live grouped-line rotate was not driven in the running app this wave (helper + hook wiring only). Legacy absolute-coord imported lines (`left/width` both 0) already match `getLineEndpoints` and are unchanged.

### P1-06 — Resize/rotate/move commits by stale index
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/hooks/useSVGInteraction.js` (`annotationId` on drag start, `resolveAnnotationIndexById` at pointermove + pointerup, try/finally drag reset, group member `id`)
- Intended behavior confirmed: resolve-by-id finds the moved slot (`'other'` at index 1). After the captured id is deleted, resolve returns `-1` even when index 0 is occupied by a different shape — commit no-ops. Pointerup wraps the commit in try/finally so a throw or vanished target cannot leave the tool stuck in resize/rotate.
- Break / adversarial attempts: missing id (legacy) still falls back to the live index if occupied; out-of-range fallback → `-1`. Resize/rotate/endpoint/midpoint commits skip `onSaveAnnotations` when the resolved object is gone.
- Edges covered: re-resolve hit; stale-id no-op; legacy fallback.
- Test command + result: `node --test tests/svgInteractionFixes.test.mjs` → 6/6 pass.
- Remaining risk: id-less annotations still commit by frozen index. Group-rotate/resize save `ds.currentAnnotations` from the last live frame — a delete between last move and pointerup is skipped per-member during the frame, but the clone is not rebuilt from live state on commit. PDFViewer undo/collab index bugs outside this hook are unchanged.

### P1-08 — Undo retargets selection to a different shape
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/hooks/useSVGInteraction.js` (`selectedStableIdsRef` + remap effect; `captureSelectionStableIds` / `remapSelectionByStableIds`)
- Intended behavior confirmed: selecting index 1 (`id:'b'`) then splicing out the preceding object remaps selection to index 0. Deleting `b` itself clears the set. Implemented in the hook (cannot call `setPendingSvgSelection` without editing PDFViewer).
- Break / adversarial attempts: gone ids drop; `data.id` is accepted as a fallback stable id. Id-less selections keep the old bounds-check-only path.
- Edges covered: index shift after undo-create; clear after undo-delete of the selected shape.
- Test command + result: `node --test tests/svgInteractionFixes.test.mjs` → 6/6 pass.
- Remaining risk: remap runs on every `annotations` identity change, including live drag commits — skipped while `dragStateRef.active`. Objects without `id` / `data.id` cannot rematch after a splice. PDFViewer still does not remap `pendingSvgSelection` (out of allowlist).

### P1-29 — Shift+marquee replaces callout selection (Alt-subtract no-op)
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/hooks/useSVGInteraction.js` (`unionIdSet` / `subtractIdSet` at marquee pointerup)
- Intended behavior confirmed: Shift unions `call-a` + `call-b` (dedupes). Alt subtracts `call-a` from that set. Union with an empty current set still yields the hit ids.
- Break / adversarial attempts: `undefined` current set treated as empty; duplicate incoming ids do not double-add.
- Edges covered: Shift union; Alt subtract; empty-current union.
- Test command + result: `node --test tests/svgInteractionFixes.test.mjs` → 6/6 pass.
- Remaining risk: parent must keep passing live `selectedCalloutIds` (already a hook prop). No Playwright marquee gesture this wave.

---

## Summary

| ID | Status |
|---|---|
| P1-05 | fixed |
| P1-06 | fixed |
| P1-08 | fixed |
| P1-29 | fixed |

Files changed:
- `src/hooks/useSVGInteraction.js`
- `tests/svgInteractionFixes.test.mjs` (new)

Tests: `node --test tests/svgInteractionFixes.test.mjs` — 6 passed.
