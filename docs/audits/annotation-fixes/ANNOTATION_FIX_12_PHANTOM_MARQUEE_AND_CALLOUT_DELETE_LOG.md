# Annotation Fix 12 - Phantom Marquee and Callout Blank Delete

Date: 2026-05-11
PDF: `SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf`
Document id from logs: `97f95b32-77b3-4834-a8fc-68f21543eb16`

## Files inspected

- `Logs/2026-05-11_20-42-17/console.log`
- `Logs/2026-05-11_20-42-17/network.json`
- `Logs/2026-05-11_20-37-14/console.log`
- `src/utils/marqueeSelection.js`
- `src/hooks/useSVGInteraction.js`
- `src/components/SVGAnnotationLayer.jsx`
- `src/App.jsx`
- `src/components/FabricEditCanvas.jsx`
- `src/utils/calloutEditAdapter.js`
- `src/hooks/useAnnotationCloudSync.js`

## Existing log evidence

Hydration for this document loaded 539/540 normal annotation rows, 3 callouts, and 1235 legacy fabric highlights. The relevant line is `Logs/2026-05-11_20-42-17/console.log:40`:

```text
scanned: { nonHighlight: 540, legacyFabricHighlights: 1235 }, calloutCount: 3
```

The old marquee path selected candidates directly from the page annotation objects:

- `Logs/2026-05-11_20-42-17/console.log:65`: index 33, type `rect`, `annotationId:null`, `authorId:null`, allowed by owner filtering.
- `Logs/2026-05-11_20-42-17/console.log:169`: indices 1 and 33 allowed.
- `Logs/2026-05-11_20-42-17/console.log:214`: many circles plus index 34 allowed.
- `Logs/2026-05-11_20-37-14/console.log:123`: indices 17, 23, 32 allowed.

The same session captured a renderer mismatch:

```text
Logs/2026-05-11_20-42-17/console.log:67
annotations=35 callouts=3 svgWrappers=1 svgElems=31 svgVisElems=31
```

Browser diagnostics on the exact PDF confirmed the mismatch:

- `window.__diagSVGFilterStats[1].inputCount === 35`
- `window.__diagSVGFilterStats[1].renderedCount === 31`
- dropped entries: index 29 `scopedRegionHidden`, indices 32, 33, 34 `surveyHighlightSkip`

The selected suspicious objects were:

| Index | Record summary |
| --- | --- |
| 1 | `circle`, id `counter-1777603008613-37br7msrz`, data type `counter`, fill `#ef4444`, stroke `#ffffff`, strokeWidth `1.5`, bbox from diagnostics `left 899.39 top 611.26 right 928.24 bottom 640.11`, rendered/selectable. |
| 17 | `circle`, id `counter-1777602947922-58jss69jm`, data type `counter`, fill `#ef4444`, stroke `#ffffff`, strokeWidth `1.5`, rendered/selectable. |
| 23 | `circle`, id `counter-1777602972809-mt2val9jc`, data type `counter`, fill `#ef4444`, stroke `#ffffff`, strokeWidth `1.5`, rendered/selectable. |
| 29 | `path`, id `3224c959-b9c7-4670-b586-bb53b0f5dfdf`, tool `pen`, stroke `#ff0000`, opacity `1`, visible `true`, regionId `1778529807030-00s47f1x5`; skipped by renderer because scoped region is hidden when no region/space is active. |
| 32 | `polygon`, highlightId `polygon-1777170708045-44pzc1xay`, fill/stroke `rgba(250, 50, 55, 0.301961)`; skipped by renderer as a survey-highlight carrier. |
| 33 | `rect`, highlightId `square-1777146996572-yy7jpep4u`, left `795.172`, top `221.073`, width `246.218`, height `200.151`, fill/stroke `rgba(250, 50, 55, 0.301961)`, strokeWidth `3`; skipped by renderer as a survey-highlight carrier. |
| 34 | `path`, highlightId `ink-1777147000442-ey1fn4img`, left `331.888`, top `530.359`, width `488.784`, height `175.690`, stroke `rgba(250, 50, 55, 1)`, strokeWidth `4.1`; skipped by renderer as a survey-highlight carrier. |

Callout deletion evidence:

- `Logs/2026-05-11_20-42-17/console.log:118`: Fabric edit commit for existing callout produced `text=""`, `isNewText=false`.
- `Logs/2026-05-11_20-42-17/console.log:120`: `callouts:delete-blank` checkpoint deleted `callout-ys5vk1icj-mom758re`.
- `Logs/2026-05-11_20-42-17/console.log:127-128`: callout Supabase delete started and succeeded for `callout-ys5vk1icj-mom758re`.
- `Logs/2026-05-11_20-42-17/console.log:146`: another existing Fabric edit commit produced `text=""`, `isNewText=false`.
- `Logs/2026-05-11_20-42-17/console.log:148`: `callouts:delete-blank` checkpoint deleted `callout-qo2f1f8hs-mom74xkf`.
- `Logs/2026-05-11_20-42-17/console.log:155,158`: callout Supabase delete started and succeeded for `callout-qo2f1f8hs-mom74xkf`.
- `Logs/2026-05-11_20-42-17/network.json:490-491`: real DELETE request for `callout-ys5vk1icj-mom758re`.
- `Logs/2026-05-11_20-42-17/network.json:508-509`: real DELETE request for `callout-qo2f1f8hs-mom74xkf`.

Current browser state after undo/restore showed all three callouts present. The two previously deleted callouts currently have `text:""`; the third has `text:"jhvj"`.

## Investigation findings before fix

### Phantom marquee

Marquee candidates came from `resolveMarqueeHits` in `src/utils/marqueeSelection.js`, which iterated every object in `annotations.objects`. It did not know which objects `SVGAnnotationLayer` actually rendered.

Those candidates were not the same exact list as the SVG DOM. `SVGAnnotationLayer` first filters annotations through layer/space/region/survey-highlight visibility rules and render dispatch, then renders only the filtered entries. Before the fix, `useSVGInteraction` passed the original `annotations` object to `resolveMarqueeHits`, so marquee could select objects that the SVG layer skipped.

Yes, marquee could select renderer-skipped annotations. On this PDF it selected:

- survey-highlight carrier records, especially index 33, that the annotation SVG renderer intentionally skipped;
- region-scoped object index 29 when the active region/space visibility state hid it;
- any other object still present in `annotations.objects` even if not rendered, unless the later owner filter removed it.

The old marquee path did not explicitly exclude malformed, invisible, opacity-0, no-stroke/no-fill, zero-size, off-page, or missing-id objects. Some malformed objects would miss only if bbox calculation failed. Missing ids were allowed by owner filtering when the viewer was the owner; this is why index 33 with no normal annotation id survived.

The selection box without normal handles is explained by selecting non-rendered/skipped objects. The selection state can contain annotation indexes that have no visible SVG element. Multi-select rendering then can produce a group union box, but per-object normal affordances are missing or visually meaningless because the selected members were not rendered as normal interactive SVG annotations.

### Callout vanish

The exact delete path was in `src/App.jsx` at the callout Fabric edit commit:

1. `FabricEditCanvas` emitted an edited Fabric group.
2. `fromFabricGroup` synthesized an updated callout.
3. The code checked `isBlankCalloutText(updatedCallout.text)`.
4. It unconditionally called `addHistoryCheckpoint('callouts:delete-blank')`, `markCalloutRemovalIntent`, and removed the callout from local state.
5. `useAnnotationCloudSync` diffed local state against Supabase state and issued DELETE requests for the removed callout ids.

The local deletion path caused the Supabase DELETE. Sync was behaving consistently with local state; it was not independently overreacting.

The deleted callouts were pre-existing in the hydrated callout set, not new unsaved blank callouts. Logs prove `isNewText=false` for both Fabric edit commits. The old blank-delete behavior did not distinguish new blank callouts from existing callouts whose edit commit temporarily yielded blank text.

The currently available logs prove the Fabric edit commit produced `text=""` for both vanished callouts, but they do not prove whether Fabric lost user-visible text or whether these two specific callouts were already blank boxes. The current restored state has both of those callouts blank. The important root cause is still proven: an existing persisted callout was allowed to be deleted solely because the edit commit synthesized blank text.

## Root causes

1. Marquee hit-testing used the raw annotation source array instead of the renderer's rendered/selectable set. This let hidden region objects and skipped survey-highlight carrier records become selection members.
2. Blank callout cleanup applied to existing persisted callouts. A transient or real blank edit commit on an existing callout removed the object from local state, and cloud sync correctly propagated that removal to Supabase.

## Diagnostics added

Permanent lightweight diagnostics were added for review/debug builds:

- `window.__renderedAnnotationRegistry[pageNumber]`: records rendered interactive annotation entries by original index and id/type/tool/region/space fields.
- `window.__marqueeHitDiagnostics`: records every marquee candidate decision with page number, annotation index, ids, type/tool/data type, bbox, fill/stroke/strokeWidth/opacity/visible, module/region/space, and include/exclude reason.
- `[CalloutBlankCommitDiag]`: logs callout id, whether the callout was newly created, original text, edited textbox text, synthesized text, resolved text, whether blank delete will run, and whether existing text was preserved.

## Code changed

- `src/utils/marqueeSelection.js`
  - Added `selectableAnnotationIndices` and `onCandidateDiagnostic`.
  - Skips annotations outside the rendered/selectable index set with reason `not-rendered-or-not-interactive`.

- `src/components/SVGAnnotationLayer.jsx`
  - Captures the filtered interactive annotation entries after renderer visibility filtering.
  - Publishes the rendered registry diagnostic.
  - Passes rendered/selectable indices to `useSVGInteraction`.

- `src/hooks/useSVGInteraction.js`
  - Passes rendered/selectable indices into marquee hit resolution.
  - Emits marquee candidate diagnostics.

- `src/utils/calloutBlankCommit.js`
  - New pure helper for blank-callout commit policy.
  - Existing callouts with blank synthesized commit preserve prior nonblank text.
  - Blank deletion is true only for newly-created blank callouts.

- `src/App.jsx`
  - Tracks newly-created callout ids.
  - Marks callout edit sessions with `isNewCallout`.
  - Runs `callouts:delete-blank` only for newly-created blank callouts.
  - Existing callouts no longer disappear when edit/dismiss produces blank text.
  - Existing nonblank callout text is preserved if Fabric synthesis returns blank during dismissal.

## Why the fix is safe

Marquee now selects only annotations that the same page renderer has already decided are visible and interactive. This aligns hit-testing with the DOM instead of adding a new independent visibility model.

Blank cleanup still exists for truly new unsaved blank callouts, so accidental empty callout creation can still be cleaned up. Existing persisted callouts are protected from deletion caused by a blank edit commit. Sync behavior is unchanged; it simply no longer receives a false local deletion for existing callouts.

## Focused tests

Command:

```bash
node --test tests/marqueeSelection.test.mjs tests/calloutBlankCommit.test.mjs tests/calloutEditAdapter.test.mjs
```

Result: passed, 32 tests. Node emitted only module-type warnings.

Added tests:

- `tests/marqueeSelection.test.mjs`: confirms non-rendered/non-selectable annotation indexes are skipped and diagnostically labeled.
- `tests/calloutBlankCommit.test.mjs`: confirms only new blank callouts are blank-deleted, existing blank commits are not deleted, and existing text is preserved on blank synthesis.

## Build

Command:

```bash
npm run build
```

Result: passed. Vite warnings were pre-existing categories: pdf.js eval warning, mixed dynamic/static import chunk warnings, and chunk-size warnings.

## Full test suite

Command:

```bash
npm test
```

Result: passed. TAP summary: 579 tests, 573 pass, 6 skipped, 0 failed. Node emitted existing module-type warnings.

## Manual browser verification

Dev server: `http://localhost:5174/` because `5173` was already in use.

Steps/results:

1. Opened the exact PDF and stayed on page 1.
2. Switched to Select mode.
3. Dragged a marquee over the previous phantom rectangle area for index 33.
4. Browser diagnostics showed:
   - `window.__renderedAnnotationRegistry[1].length === 31`
   - `window.__diagSVGFilterStats[1].inputCount === 35`
   - dropped: index 29 `scopedRegionHidden`, indices 32/33/34 `surveyHighlightSkip`
   - `window.__marqueeHitDiagnostics` recorded indices 29/32/33/34 as excluded with reason `not-rendered-or-not-interactive`
   - no selected annotation ids resulted from that phantom-area marquee.
5. Dragged a marquee over visible counter geometry. Diagnostics showed rendered counter entries were eligible and included by `window-contained`; skipped survey-highlight objects remained excluded.
6. Double-clicked the existing nonblank callout `callout-y1vltawo3-momawklj` with text `jhvj`, entered edit mode, dismissed it, and verified:
   - callout count stayed `3`
   - `callout-y1vltawo3-momawklj` still had text `jhvj`
   - no `callouts:delete-blank` logs appeared
   - no callouts vanished

No user annotations were intentionally deleted during verification.

## Remaining uncertainty

The available existing logs prove the vanished callouts were existing callouts and that Fabric committed blank text before deletion. They do not prove whether the two deleted callouts had visible nonblank text immediately before the faulty edit because the current restored state for those two ids is blank. The fix does not depend on that uncertainty: existing callouts must not be deleted merely because an edit/dismiss commit produces blank text.
