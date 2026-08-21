# Fix log — logic audit 2026-08-20

Wave 1 and later. Append one entry per closed (or attempted) issue. Do not delete prior entries.

Status values: `fixed` · `partial` · `reverted` · `wontfix`

---

## Template

```
### <ID> — <title>
- Date:
- Status:
- Files changed:
- Intended behavior confirmed:
- Break / adversarial attempts:
- Edges covered:
- Test command + result:
- Remaining risk:
```

---

## Entries

### P1-01 — Line/arrow export and print at wrong page position
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/pdfAnnotationsPdfLib.js` (`createLineAnnotation`, `drawFlattenedLine`, group flatten offset, `legacyArrowGroupToLine`)
- Intended behavior confirmed: fabric-contract fixture (100,100)→(150,140) stored as center-relative x1..y2 now writes `/L [100, 100, 150, 60]` and print-flatten `m`/`l` at those page coords. Callout leaders with no left/top stay unshifted.
- Break / adversarial attempts: Infinity/NaN endpoints skipped (see P2-37). Legacy arrow groups strip left/top so getLineEndpoints does not double-offset. Group children no longer add parentLeft to x1..y2.
- Edges covered: absolute leaders; fabric bbox; legacy group mapper.
- Test command + result: `node --test tests/lineArrowExportPosition.test.mjs tests/calloutArrowheadExport.test.mjs tests/pdfAnnotationTextStyleAndArrowExport.test.mjs` → 43/43 pass (with sibling suites).
- Remaining risk: `createCircleAnnotation` (non-rotated) still does not multiply by scaleX/scaleY on **export** (print path is fixed). Visual Acrobat check of a live drawn arrow not run this wave.

### P1-02 — Arrowheads dropped on export
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/pdfAnnotationsPdfLib.js` (`resolveExportedLineEnding2`, `createLineAnnotation`, `drawFlattenedLine`)
- Intended behavior confirmed: all 6 `ARROWHEAD_STYLES` map to `/LE`; `tool:'arrow'` without style still exports ClosedArrow.
- Break / adversarial attempts: style `none` writes `/LE [None, None]` or omits a head on print; unknown style falls through without crashing.
- Edges covered: every style in `STYLE_TO_LE`; print flatten uses `buildArrowheadRenderSpec`.
- Test command + result: `tests/lineArrowExportPosition.test.mjs` + `tests/calloutArrowheadExport.test.mjs` pass.
- Remaining risk: third-party viewer fidelity of Slash/Butt degradations is by design.

### P1-03 — Cloud rectangle borders lost on export
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/pdfAnnotationsPdfLib.js` (`createSquareAnnotation` `/BE`, print-flatten scallops via `buildCloudPathCommands`), `src/utils/pdfAppAnnotationMetadata.js` (allowlist `pdfCloudIntensity`, `pdfCloudPathD`)
- Intended behavior confirmed: Square export writes `/BE /S /C` + intensity; print flatten emits curve ops not a plain box.
- Break / adversarial attempts: missing intensity falls back to 2 when cloudBorder/cloudy is set; non-cloud rects unchanged.
- Edges covered: intensity 3 export; intensity 2 print.
- Test command + result: `tests/lineArrowExportPosition.test.mjs` pass.
- Remaining risk: cloud print is an SVG-path approximation of `/BE`, not a native cloudy appearance stream. Re-import of `/BE` on Square was already correct.

### P1-04 — Printed circles/rects use pre-resize size
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/pdfAnnotationsPdfLib.js` (`drawFlattenedObject` multiplies width/height/rx/ry by |scaleX|/|scaleY|; `createSquareAnnotation` also applies scale)
- Intended behavior confirmed: rect 20×10 at scale 2×3 prints as 40×30 (cm origin 10,160 + path to 40,30).
- Break / adversarial attempts: scale default 1 unchanged; non-finite box skipped.
- Edges covered: rect + ellipse.
- Test command + result: `tests/lineArrowExportPosition.test.mjs` pass.
- Remaining risk: rotated ellipse export writer already scaled; non-rotated `createCircleAnnotation` export path not multiplied (print is).

### P2-37 — Non-finite geometry serialized as Infinity/NaN
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/pdfAnnotationsPdfLib.js` (line/square/callout-payload + flatten finite guards)
- Intended behavior confirmed: line with Infinity/NaN is skipped (`pdf-annotation-create-failed`); PDF bytes contain neither token.
- Break / adversarial attempts: hostile payload; callout payload with non-finite coords returns null.
- Edges covered: line writer + callout payload builder.
- Test command + result: `tests/lineArrowExportPosition.test.mjs` pass.
- Remaining risk: not every writer (ink/polygon/freetext) was given a new guard; flatten already used `getObjNumber`.

### P1-12 — Excel auto-sync jams undo
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/historyHelpers.js`
- Intended behavior confirmed: `excel:auto-sync` (and any `excel:` prefix) is now a legacy-lane reason, so handleUndo can pop it.
- Break / adversarial attempts: unrelated reasons (`zoom:fit`, empty) stay false.
- Edges covered: `excel:auto-sync`, `excel:manual-sync`.
- Test command + result: `node --test tests/historyStacks.test.mjs` pass.
- Remaining risk: no live PDFViewer undo sequence run this wave (whitelist-only fix matching survey-marker:/space:).

### P1-53 — Sync pill shows Offline during healthy saves
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/syncStatusViewModel.js`
- Intended behavior confirmed: `stage:'pending'` + queue 3 → Saving… (realistic producer input), not Offline.
- Break / adversarial attempts: queued/error/synced+queue still Offline; pending+0 still Saving.
- Edges covered: realistic pending+queue and the old pending+0 case.
- Test command + result: `node --test tests/syncStatusUi.test.mjs` pass.
- Remaining risk: none for the view-model; chip wiring unchanged.

### P1-37 — Font color opacity slider dead on desktop
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/AppShell.jsx` (`showOpacity={false}` on the font-color picker)
- Intended behavior confirmed: slider is hidden (matches mobile). `setFontColor` still has no alpha — that is now honest.
- Break / adversarial attempts: n/a (UI hide).
- Edges covered: desktop chrome only.
- Test command + result: no dedicated test (prop-only). Sibling suites green.
- Remaining risk: font-color alpha is still not implemented if product later wants it.

### P1-38 — Match Fill never selected when fill is translucent
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/components/CompactColorPicker.jsx`
- Intended behavior confirmed: selected ring compares `localOpacity` to `matchFillOpacity*100` (±1), not `>= 99`.
- Break / adversarial attempts: opaque match (100) still selected; hex mismatch still unselected.
- Edges covered: logic-only.
- Test command + result: no React mount test; change is a one-line predicate.
- Remaining risk: visual confirmation in the running picker not run.

### P1-39 — Hex field accepts garbage
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/pickerHex.js` (new), `src/components/CompactColorPicker.jsx`
- Intended behavior confirmed: only `/^#?[0-9a-fA-F]{6}$/` reaches `applyHex`/`onChange`. Non-hex keystrokes are stripped from the field.
- Break / adversarial attempts: `zzzzzz`, `#fff`, empty, `rgb(...)`, `#GG0000` rejected; `#FF0000` / `00ff80` accepted.
- Edges covered: listed above.
- Test command + result: `node --test tests/compactColorPickerHex.test.mjs` pass.
- Remaining risk: typing a partial hex still updates the local field display (`#ab`) until 6 valid digits; that does not persist.
