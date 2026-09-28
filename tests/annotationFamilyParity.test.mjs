// w52 (2026-09-28) — "annotations are annotations": shared-path fixes found by
// the capability audit (docs/ANNOTATION-CAPABILITY-MATRIX.md). Pure helpers
// are tested directly; PDFViewer wiring is pinned by source assertions (the
// repo's pattern for the 35k-line viewer node --test cannot import).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mintPastedCloneIdentity } from '../src/utils/pasteCloneIdentity.js';
import { applyPasteScope } from '../src/utils/annotationCreationCommit.js';
import { isPdfStampProxy } from '../src/utils/pdfStampProxy.js';

const VIEWER = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const sliceFrom = (source, marker, length = 6000) => {
  const start = source.indexOf(marker);
  assert.ok(start > -1, `${marker} present`);
  return source.slice(start, start + length);
};

test('a pasted imported stamp is still a stamp (it used to vanish on paste)', () => {
  const stamp = {
    type: 'image',
    src: 'data:image/png;base64,AAAA',
    left: 1, top: 2, width: 10, height: 10,
    isPdfImported: true,
    pdfAnnotationId: 'native-1',
    pdfAnnotationType: 'Stamp',
    data: { id: 'src', pdfAnnotationType: 'Stamp' },
  };
  assert.equal(isPdfStampProxy(stamp), true);
  const clone = mintPastedCloneIdentity(JSON.parse(JSON.stringify(stamp)), 'fresh');
  assert.equal(isPdfStampProxy(clone), true, 'still renders as a stamp');
  assert.equal(clone.isPdfImported, undefined, 'import provenance still stripped');
  assert.equal(clone.pdfAnnotationId, undefined);
  assert.equal(clone.data.id, 'fresh');
  // Other imported shapes still lose their subtype (unchanged).
  const square = mintPastedCloneIdentity({ type: 'rect', pdfAnnotationType: 'Square', data: { id: 's' } }, 'x');
  assert.equal(square.pdfAnnotationType, undefined);
});

test('a pasted mark takes the scope of where it lands', () => {
  const fromModule = { type: 'rect', moduleId: 'm-old', data: { id: 'a' } };
  assert.deepEqual(
    applyPasteScope({ ...fromModule }, { selectedModuleId: null, stampRegionId: false, activeRegionId: null }),
    { type: 'rect', data: { id: 'a' } },
    'pasted on the plain canvas: no longer in the old module',
  );
  const regionMark = { type: 'rect', regionId: 'r-keep', data: { id: 'c' } };
  assert.equal(
    applyPasteScope({ ...regionMark }, { selectedModuleId: null, stampRegionId: false, activeRegionId: 'r-a' }).regionId,
    'r-keep',
    'no region stamped where it lands: keeps its own region',
  );
  const intoModule = applyPasteScope({ type: 'rect', data: { id: 'b' } }, {
    selectedModuleId: 'm-new', stampRegionId: true, activeRegionId: 'r-new',
  });
  assert.equal(intoModule.moduleId, 'm-new');
  assert.equal(intoModule.regionId, 'r-new');
});

test('viewer: shape paste and callout paste both apply the landing scope', () => {
  const paste = sliceFrom(VIEWER, 'const pasteAnnotationAt = useCallback', 9000);
  assert.equal((paste.match(/applyPasteScope\(/g) || []).length, 2, 'multi + single paste');
  const calloutPaste = sliceFrom(VIEWER, 'const calloutPasteScope = pasteScopeRef.current', 400);
  assert.match(calloutPaste, /applyPasteScope\(newCallout, calloutPasteScope\)/);
});

test('viewer: Cmd+X runs the same own-mark gate as the menu Cut', () => {
  const cut = sliceFrom(VIEWER, 'const handleCutAnnotation = useCallback', 2000);
  assert.match(cut, /!canModify\(\{ annotation: obj, viewerId: cutViewerId, documentOwnerId \}\)\) return;/);
  assert.ok(cut.indexOf('canModify(') < cut.indexOf('setClipboardAnnotation('), 'gate before the clipboard/splice');
});

test('viewer: a new text markup is stamped with the active Survey module / region scope', () => {
  const action = sliceFrom(VIEWER, 'const handleTextSelectionAction = useCallback', 12000);
  assert.match(action, /\.map\(\(mark\) => applyAnnotationCreationScope\(mark, \{/);
  assert.match(action, /stampRegionId: shouldStampActiveRegionId\(\{/);
});

test('viewer: a refused Survey Marker delete pushes no Undo step', () => {
  const del = sliceFrom(VIEWER, 'const handleSurveyMarkerDeleted = useCallback', 5000);
  const gate = del.indexOf('canCommitSurveyMarkerErase(');
  const checkpoint = del.indexOf("addHistoryCheckpoint('highlight:delete'");
  assert.ok(gate > -1 && checkpoint > -1);
  assert.ok(checkpoint > gate, 'checkpoint only after the ownership gate allowed the delete');
});

test('callouts: Cmd+C / Cmd+X use the menu handlers; Cut stays own-marks-only everywhere', () => {
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  const effect = sliceFrom(layer, 'the same four z-order hotkeys for ONE selected', 3500);
  assert.match(effect, /const handler = isCopy \? onCopyCallout : onCutCallout;/);
  assert.match(VIEWER, /onCopyCallout=\{handleCopyCallout\}/);
  assert.match(VIEWER, /onCutCallout=\{handleCutCallout\}/);
  const cut = sliceFrom(VIEWER, 'const handleCutCallout = useCallback', 900);
  assert.match(cut, /!canModify\(\{ annotation: callout, viewerId: user\.id, documentOwnerId: cutGateOwnerIdRef\.current \}\)\) return;/);
});

test('group right-click z-order moves selected callouts with the shapes (one shared helper)', () => {
  const menu = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  const reorder = sliceFrom(menu, 'const reorderAll = (direction) => {', 1800);
  assert.match(reorder, /reorderSelectionInStack\(page\.objects, \[\.\.\.sortedAsc, \.\.\.calloutSlots\], direction\)/);
  assert.match(VIEWER, /documentOwnerId,\n\s*selectedCalloutIds,\n\s*\}\)\}/);
});

test('eraser: callouts follow the same space-scope rule as every other mark', () => {
  const eraser = readFileSync(new URL('../src/components/FabricEraserCanvas.jsx', import.meta.url), 'utf8');
  const calloutLane = sliceFrom(eraser, 'const getPermittedCalloutHitIds = useCallback', 4000);
  assert.match(calloutLane, /if \(isOutsideEraseSpaceScope\(callout\)\) return false;/);
  const pageLane = sliceFrom(eraser, 'const getEraseBlockReason = useCallback', 6000);
  assert.match(pageLane, /if \(isOutsideEraseSpaceScope\(object\)\) return 'space-scope';/);
  // Untagged Survey Markers stay erasable inside a space (their layer treats
  // them as part of it); region-tagged ones follow the shared rule.
  assert.match(eraser, /if \(marker\?\.regionId != null && isOutsideEraseSpaceScope\(\{/);
});

test('arrow-key nudge leaves arrow keys to menus, sliders, tabs and dialogs', async () => {
  const { isTypingTarget } = await import('../src/utils/annotationFamilyRules.js');
  const inside = (selectorHit) => ({
    tagName: 'DIV',
    closest: (selector) => (selector.includes(selectorHit) ? {} : null),
  });
  assert.equal(isTypingTarget(inside('[role="slider"]')), true, 'colour slider');
  assert.equal(isTypingTarget(inside('[role="listbox"]')), true, 'dropdown');
  assert.equal(isTypingTarget(inside('[role="menu"]')), true, 'menu');
  assert.equal(isTypingTarget({ tagName: 'BUTTON', closest: () => null }), false, 'a plain button does not own arrows');
});

test('an exported edited stamp carries the app metadata every other writer adds', () => {
  const lib = readFileSync(new URL('../src/utils/pdfAnnotationsPdfLib.js', import.meta.url), 'utf8');
  const writer = sliceFrom(lib, 'const createStampAnnotation = ', 2600);
  assert.match(writer, /applyAppAnnotationMetadataToDict\(annotationDict, options\);/);
  assert.match(lib, /createStampAnnotation\(pdfDoc, page, obj, pageHeight, \{ \.\.\.appAnnotationOptions, stampImages \}\)/);
});
