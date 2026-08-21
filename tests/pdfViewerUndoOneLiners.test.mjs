import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('P1-09: pushing a local-lane action also clears the legacy redo stack', () => {
  const start = VIEWER_SOURCE.indexOf('const pushLocalAnnotationHistoryAction = useCallback');
  assert.ok(start > -1, 'pushLocalAnnotationHistoryAction exists');
  const end = VIEWER_SOURCE.indexOf('const contentStyle = useMemo', start);
  const slice = VIEWER_SOURCE.slice(start, end > start ? end : start + 8000);
  // The function is declared AFTER contentStyle in current source; fall back
  // to a bounded window from the callback start.
  const body = VIEWER_SOURCE.slice(start, start + 6000);
  assert.match(body, /localAnnotationRedoRef\.current = \[\];/);
  assert.match(body, /redoHistoryRef\.current = \[\];/);
  assert.match(body, /setRedoHistory\(\[\]\);/);
  assert.match(body, /redoHistoryMetaRef\.current = \[\];/);
  const localClear = body.indexOf('localAnnotationRedoRef.current = [];');
  const legacyClear = body.indexOf('redoHistoryRef.current = [];');
  assert.ok(localClear > -1 && legacyClear > localClear, 'legacy redo clears after the local redo lane');
});

test('P1-13: embedded import deletes the dangling preview baseline after the skip save', () => {
  const start = VIEWER_SOURCE.indexOf("source: 'embedded-import-once'");
  assert.ok(start > -1, 'embedded import save exists');
  const window = VIEWER_SOURCE.slice(start, start + 800);
  assert.match(window, /previewBaselineByPageRef\.current\.delete\(String\(pageNumber\)\)/);
  assert.match(window, /checkpointPolicy: 'skip'/);
});

test('P1-49: search cache key includes pageMutationRevision', () => {
  assert.match(
    VIEWER_SOURCE,
    /\$\{pdfFile\?\.id \|\| 'local'\}:\$\{pdfId \|\| pdfFile\?\.name \|\| 'pdf'\}:\$\{numPages \|\| 0\}:\$\{pageMutationRevision\}/,
  );
  assert.match(VIEWER_SOURCE, /setPageMutationRevision\(\(revision\) => revision \+ 1\)/);
});

test('P1-18: page-structure commit remaps clipboardPage', () => {
  const start = VIEWER_SOURCE.indexOf('const commitPageStructureState = useCallback');
  const body = VIEWER_SOURCE.slice(start, start + 2200);
  assert.match(body, /remapClipboardPage\(prev, operation\)/);
});

test('P1-20: Cmd+Shift+D debug toggle is DEV-only', () => {
  const start = VIEWER_SOURCE.indexOf('const handleDebugShortcut');
  const window = VIEWER_SOURCE.slice(Math.max(0, start - 200), start + 400);
  assert.match(window, /import\.meta\.env\.DEV/);
});

test('P1-40: zoom digit keys route through handleZoomModeSelect', () => {
  assert.match(VIEWER_SOURCE, /handleZoomModeSelectRef\.current\?\.\(ZOOM_MODES\.FIT_PAGE\)/);
  assert.match(VIEWER_SOURCE, /handleZoomModeSelectRef\.current\?\.\(ZOOM_MODES\.FIT_WIDTH\)/);
  assert.match(VIEWER_SOURCE, /handleZoomModeSelectRef\.current\?\.\(ZOOM_MODES\.FIT_HEIGHT\)/);
});

test('P1-35: paste repeat offset uses live page size', () => {
  assert.match(VIEWER_SOURCE, /PASTE_REPEAT_OFFSET_PAGE_UNITS\) \/ \(pageSize\.width \|\| 612\)/);
  assert.match(VIEWER_SOURCE, /repeatOffsetX/);
  assert.match(VIEWER_SOURCE, /repeatOffsetY/);
});

test('P2-34: Home\/End and arrows change pages regardless of scroll mode', () => {
  assert.match(VIEWER_SOURCE, /e\.key === 'Home' && !isFormField/);
  assert.match(VIEWER_SOURCE, /goToPage\(numPages \|\| 1\)/);
  assert.doesNotMatch(
    VIEWER_SOURCE.slice(VIEWER_SOURCE.indexOf("e.key === 'Home'"), VIEWER_SOURCE.indexOf("e.key === 'Home'") + 500),
    /scrollMode === 'single'/,
  );
});

test('P1-32: rotation-input saves coalesce on a shared interactionId', () => {
  assert.match(VIEWER_SOURCE, /source === 'object:modified' \|\| source === 'rotation-input'/);
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  const field = readFileSync(new URL('../src/components/RotationInputField.jsx', import.meta.url), 'utf8');
  assert.match(layer, /interactionId: rotationInteractionId/);
  assert.match(field, /rotation-input:\$\{annotationIndex\}/);
  // E2E-ADV-03: overlay wrapper is pointer-events:none; the pill must opt back in.
  assert.match(field, /pointerEvents:\s*'auto'/);
});

test('E2E-ADV-04: normal creates do not dual-write local and legacy undo lanes', () => {
  const start = VIEWER_SOURCE.indexOf('if (!shouldSkipCheckpointByPolicy && !shouldSkipCheckpointByInteraction)');
  assert.ok(start === -1, 'unconditional local+legacy dual-write must stay gone');
  const push = VIEWER_SOURCE.indexOf('pushLocalAnnotationHistoryAction(finalLocalHistoryAction)');
  assert.ok(push > -1, 'local lane still used for eraser/CRDT');
  const window = VIEWER_SOURCE.slice(Math.max(0, push - 400), push);
  assert.match(window, /isEraserCommit \|\| yjsDoc \|\| yjsUndoManager/);
});

test('P1-45: bookmark delete checkpoints a scoped history slice and restore applies it', () => {
  const del = VIEWER_SOURCE.indexOf('const handleBookmarkDelete = useCallback');
  assert.ok(del > -1, 'handleBookmarkDelete exists');
  const delBody = VIEWER_SOURCE.slice(del, del + 900);
  assert.match(delBody, /planBookmarkDelete\(bookmarksRef\.current, id\)/);
  assert.match(delBody, /addHistoryCheckpoint\(/);
  assert.match(delBody, /'bookmark:delete'/);
  assert.match(delBody, /applyBookmarkHistorySlice\(getHistorySnapshot\(\), plan\.previous\)/);
  assert.doesNotMatch(delBody, /idsToDelete/);

  const restore = VIEWER_SOURCE.indexOf('const restoreHistoryState = useCallback');
  const restoreBody = VIEWER_SOURCE.slice(restore, restore + 2200);
  assert.match(restoreBody, /historyStateHasBookmarks\(stateToRestore\)/);
  assert.match(restoreBody, /setBookmarks\(restoredBookmarks\)/);

  const undoAttach = VIEWER_SOURCE.indexOf('if (historyStateHasBookmarks(stateToRestore))');
  const redoAttach = VIEWER_SOURCE.indexOf('if (historyStateHasBookmarks(legacyRedoState))');
  assert.ok(undoAttach > -1 && redoAttach > -1, 'undo/redo attach the live bookmark slice to the opposite stack');
  const helpers = readFileSync(new URL('../src/utils/historyHelpers.js', import.meta.url), 'utf8');
  assert.match(helpers, /reason\.startsWith\('bookmark:'\)/);
});

test('P1-10: unscoped legacy undo/redo keep live annotations when CRDT is active', () => {
  assert.match(VIEWER_SOURCE, /scopeHistoryStateForCrdtRestore/);
  const undo = VIEWER_SOURCE.indexOf('const scopedStateToRestore = shouldScopeErase');
  const redo = VIEWER_SOURCE.indexOf('const scopedRedoState = shouldScopeErase');
  assert.ok(undo > -1 && redo > -1);
  const undoSlice = VIEWER_SOURCE.slice(undo, undo + 900);
  const redoSlice = VIEWER_SOURCE.slice(redo, redo + 900);
  assert.match(undoSlice, /yjsDoc \|\| yjsUndoManager/);
  assert.match(undoSlice, /scopeHistoryStateForCrdtRestore/);
  assert.match(redoSlice, /yjsDoc \|\| yjsUndoManager/);
  assert.match(redoSlice, /scopeHistoryStateForCrdtRestore/);
});
