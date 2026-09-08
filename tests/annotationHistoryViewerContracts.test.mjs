import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const VIEWER_SOURCE = readFileSync(
  new URL('../src/PDFViewer.jsx', import.meta.url),
  'utf8',
);

test('viewer preserves cloud owner authority and threads explicit local context when recording and replaying history', () => {
  const ownerScopedCalls = VIEWER_SOURCE.match(
    /filterAnnotationHistoryActionByOwner\(\s*action,\s*viewerId,\s*documentOwnerId,\s*managedLocalEditingContext,\s*\)/g,
  ) || [];
  assert.equal(ownerScopedCalls.length, 2);
});

test('missing callout snapshot or planner cancels instead of deleting outside history', () => {
  const calloutStart = VIEWER_SOURCE.indexOf('const handleDeleteSelectedCallouts');
  const calloutEnd = VIEWER_SOURCE.indexOf('\n  const handleBeginBatchDelete', calloutStart);
  const calloutCommitSource = VIEWER_SOURCE.slice(calloutStart, calloutEnd);

  assert.match(
    calloutCommitSource,
    /if \(typeof requestBulkDelete !== 'function'\) \{\s*settleEraseRequest\(false\);\s*return;/,
  );
  assert.match(
    calloutCommitSource,
    /if \(snapshotObjects\.length === 0\) \{\s*settleEraseRequest\(false\);\s*return;/,
  );
  assert.doesNotMatch(
    calloutCommitSource,
    /snapshotObjects\.length === 0[\s\S]*?runDelete\(\)/,
  );
});

test('viewer materializes serialized canonical ids before the first history baseline', () => {
  const normalizationIndex = VIEWER_SOURCE.indexOf(
    'normalizeByPageAnnotationIdentities(initialAnnotationsByPage)',
  );
  const stateIndex = VIEWER_SOURCE.indexOf(
    'setAnnotationsByPage(initialAnnotationsByPage)',
    normalizationIndex,
  );
  const savedBaselineIndex = VIEWER_SOURCE.indexOf(
    'savedAnnotationsByPageRef.current = initialAnnotationsByPage',
    normalizationIndex,
  );

  assert.ok(normalizationIndex > -1);
  assert.ok(stateIndex > normalizationIndex);
  assert.ok(savedBaselineIndex > normalizationIndex);
});

test('viewer materializes current and incoming pages before every history diff', () => {
  const saveStart = VIEWER_SOURCE.indexOf('const handleSaveAnnotations = useCallback');
  const saveEnd = VIEWER_SOURCE.indexOf('\n  // R2.2 Slice 3:', saveStart);
  const saveSource = VIEWER_SOURCE.slice(saveStart, saveEnd);

  assert.match(
    saveSource,
    /identityNormalizedCurrentAnnotations = normalizeByPageAnnotationIdentities\(\{/,
  );
  assert.match(
    saveSource,
    /identityNormalizedIncomingAnnotations = normalizeByPageAnnotationIdentities\(\{/,
  );
  assert.match(
    saveSource,
    /markEditedImportedPdfAnnotationsOnPage\(\s*identityNormalizedIncomingAnnotations,\s*identityNormalizedCurrentAnnotations,/,
  );
  assert.ok(
    saveSource.indexOf('identityNormalizedCurrentAnnotations')
      < saveSource.indexOf('buildPreciseAnnotationHistoryAction'),
  );
  assert.ok(
    saveSource.indexOf('identityNormalizedIncomingAnnotations')
      < saveSource.indexOf('buildPreciseAnnotationHistoryAction'),
  );
});

test('legacy undo and redo clear the checkpoint hash before the next action', () => {
  const undoStart = VIEWER_SOURCE.indexOf('const handleUndo = useCallback');
  const redoStart = VIEWER_SOURCE.indexOf('const handleRedo = useCallback', undoStart);
  const undoSource = VIEWER_SOURCE.slice(undoStart, redoStart);
  const redoEnd = VIEWER_SOURCE.indexOf('const handleUndoRef', redoStart);
  const redoSource = VIEWER_SOURCE.slice(redoStart, redoEnd);

  assert.match(
    undoSource,
    /setRedoHistory\(redoHistoryRef\.current\);\s*\/\/ A new action after Undo[\s\S]*?lastCheckpointHashRef\.current = null;/,
  );
  assert.match(
    redoSource,
    /setUndoHistory\(undoHistoryRef\.current\);\s*lastCheckpointHashRef\.current = null;/,
  );
});
