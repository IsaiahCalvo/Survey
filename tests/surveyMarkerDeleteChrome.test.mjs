import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Survey-marker overlay delete leftover after placed handle drag.
// Live proof: debug/scenarios/e2e-survey-marker-delete.spec.mjs
// Not E-04 rect Backspace, not counter-series Delete, not rail list Delete.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('overlay Delete Survey Marker is Select-only and hidden without a selection', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /aria-label="Delete Survey Marker"/);
  assert.match(layer, /isSelectTool && selectedSurveyMarkerDeleteBounds && typeof onDeleteSurveyMarker === 'function'/);
  assert.match(layer, /className="survey-marker-touch-delete"/);
  assert.match(layer, /deleteSelectedSurveyMarker\(\)/);
  assert.match(layer, /onDeleteSurveyMarker\?\.\(selectedSurveyMarkerId\)/);
  const deleteSelected = layer.slice(
    layer.indexOf('const deleteSelectedSurveyMarker = useCallback'),
    layer.indexOf('useEffect(() => {\n    if (!isSelectTool || !selectedSurveyMarkerId) return;'),
  );
  assert.match(deleteSelected, /if \(!selectedSurveyMarkerId\) return;/);
  assert.doesNotMatch(deleteSelected, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(deleteSelected, /data-counter-nubbin-handle/);
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
});

test('Select-mode Backspace/Delete remove the selected marker and skip focused inputs', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const keyStart = layer.indexOf('if (!isSelectTool || !selectedSurveyMarkerId) return;');
  const keyBlock = layer.slice(keyStart, keyStart + 900);
  assert.match(keyBlock, /e\.key !== 'Delete' && e\.key !== 'Backspace'/);
  assert.match(keyBlock, /el\.tagName === 'INPUT'/);
  assert.match(keyBlock, /el\.tagName === 'TEXTAREA'/);
  assert.match(keyBlock, /el\.isContentEditable === true/);
  assert.match(keyBlock, /deleteSelectedSurveyMarker\(\)/);
  assert.match(keyBlock, /window\.addEventListener\('keydown', handleKeyDown, true\)/);
});

test('PDFViewer overlay delete routes through handleSurveyMarkerDeleted + undo checkpoint', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const handleDeleteSurveyMarker = useCallback\(\(annotationId\) => \{/);
  assert.match(viewer, /handleSurveyMarkerDeleted\(savedSurveyMarker\.pageNumber, savedSurveyMarker\.bounds, annotationId\)/);
  assert.match(viewer, /addHistoryCheckpoint\('highlight:delete'/);
  assert.match(viewer, /onDeleteSurveyMarker=\{handleDeleteSurveyMarker\}/);
  assert.match(viewer, /canCommitSurveyMarkerErase\(\{/);
  assert.doesNotMatch(
    viewer.slice(
      viewer.indexOf('const handleDeleteSurveyMarker = useCallback'),
      viewer.indexOf('const handleEraseIntent = useCallback'),
    ),
    /data-counter-nubbin-handle/,
  );
});
