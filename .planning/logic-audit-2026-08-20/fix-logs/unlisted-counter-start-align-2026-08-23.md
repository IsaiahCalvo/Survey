# UL Counter start + survey-marker stem contracts — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.**  
Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write.

Started from tip `cfe03180`. Distinct from leftover-18 / X-01 / rotate persist/handles product / form persist / max-update-depth / 103-ID `2026-08-23c` (not replayed).

## Contract 1 — UL Counter start

Official `npm test` fail-stopped `tests/e2eUnlistedControls.test.mjs` **16 / 17**: `aria-label="Counter start number"` in AppShell.

Live (`c3e4a7c1` / `03f5f2b4`): label + `disabled={locked}` live in `CounterStartNumberField.jsx`. AppShell + 390 `MobilePdfViewerChrome.jsx` mount `<CounterStartNumberField locked={startLocked} />`. Did **not** move the aria-label back into AppShell.

## Extra leftover — survey-marker stem

After UL went green, official fail-stopped `tests/surveyMarkerHandleDrag.test.mjs` **2 / 3** on always-above `const stemAttachY = handles.mt.y -`.

Live `SVGSelectionOverlay.jsx`: `stemSign` from `handles.mtr.y - handles.mt.y`, then `stemAttachY = handles.mt.y + stemSign * mtStemGap` (`placeRotationHandle` / clamp). Same stale-contract class. Did **not** change overlay / remappers / handles.

## Node

Focused UL + leftover18 + `counterControlsContract` + `counterSizeStartNumber` **36 / 36**.  
Focused UL + leftover18 + `surveyMarkerHandleDrag` **32 / 32**.

Official `npm test` after UL align: UL **17 / 17** (form-tools test **ok 9**); **566** files passed; then handle-drag **2 / 3**. After stem align: handle-drag **3 / 3**; remaining main files green. Isolated `annotationDocConcurrency` **103 / 103** + `partialEraseCurveLocality` **15 / 15**. Isolated `partialEraserComplexity` **9 / 10** — standing **11964.80 MiB > 8448.00 MiB**. Cap **8448** / 75/250 **not** loosened.

`graphify` CLI **absent**. No product edit. High-risk files untouched.

## Next leftover

Leftover-18 live hosts (first **X-01**). Goal stays **OPEN**.
