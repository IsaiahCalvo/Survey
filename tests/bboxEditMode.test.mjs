import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Double-click / mobile-strip bbox edit leftover after vertex-N and
// line p1/p2/midpoint. Live proof: debug/scenarios/e2e-bbox-edit-mode.spec.mjs
// Rect/ellipse already own single-click bbox (E-01). Ellipse radii / ink
// vertices / stamp / poly create are omitted.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop double-click maps poly/line/counter to editType bbox; rect/path skip', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const isCounter = annotationData\?\.data\?\.type === 'counter'/);
  assert.match(viewer, /if \(annotationType === 'path'\)/);
  assert.match(viewer, /edit SKIPPED — stroke type=/);
  assert.match(viewer, /if \(!isCounter && \(annotationType === 'rect' \|\| annotationType === 'circle' \|\| annotationType === 'ellipse' \|\| annotationType === 'triangle'\)\)/);
  assert.match(viewer, /edit SKIPPED — non-counter shape/);
  assert.match(
    viewer,
    /if \(isCounter \|\| annotationType === 'line' \|\| annotationType === 'polygon' \|\| annotationType === 'polyline' \|\| isLegacyGroupArrow\(annotationData\)\) \{\s*editType = 'bbox';/,
  );
  assert.match(viewer, /edit SKIPPED — unhandled type=/);
});

test('SVG layer swaps type-specific chrome for SVGSelectionOverlay in bbox mode; Esc exits', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const hook = read('src/hooks/useSVGInteraction.js');

  assert.match(layer, /const isBboxEditMode = editingAnnotationIndex != null && editingAnnotationEditType === 'bbox'/);
  assert.match(layer, /const lineInBboxMode = isLineType && isBeingEditedNow && editingAnnotationEditType === 'bbox'/);
  assert.match(layer, /const polyInBboxMode = isPolyShape && isBeingEditedNow && editingAnnotationEditType === 'bbox'/);
  assert.match(layer, /const counterInBboxMode = editIsCounter && isBeingEditedNow && editingAnnotationEditType === 'bbox'/);
  assert.match(layer, /if \(isLineType && !lineInBboxMode\)/);
  assert.match(layer, /if \(isPolyShape && !polyInBboxMode\)/);
  assert.match(layer, /if \(editIsCounter && !counterInBboxMode\)/);
  assert.match(layer, /if \(e\.key === 'Escape' && typeof onRequestExitEdit === 'function'\)/);
  assert.match(read('src/PDFViewer.jsx'), /Clear edit state when switching to drawing\/eraser tools/);
  assert.match(read('src/PDFViewer.jsx'), /if \(activeTool === 'pen' \|\| activeTool === 'highlighter'/);
  assert.match(layer, /if \(selectedIds\.has\(editingAnnotationIndex\)\) return;/);
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /data-handle=["']rx["']/);
  assert.doesNotMatch(hook, /handleId === 'rx'|handleId === 'ry'/);
  assert.match(hook, /onRequestEditMode\(index, annotation\.type\)/);
});

test('390 strip publishes Resize and rotate for line/polygon/polyline/counter only', () => {
  const viewer = read('src/PDFViewer.jsx');
  const chrome = read('src/mobile/MobilePdfViewerChrome.jsx');
  const overlay = read('src/components/SVGSelectionOverlay.jsx');

  assert.match(viewer, /const handleEnterBBoxEditFromStrip = useCallback/);
  assert.match(viewer, /if \(!isCounter && type !== 'line' && type !== 'polygon' && type !== 'polyline' && !isLegacyGroupArrow\(annot\)\) return;/);
  assert.match(viewer, /editType: 'bbox'/);
  assert.match(viewer, /canEnterBBoxEdit: !!\(selectedToolbarAnnotation && \(\(\) => \{/);
  assert.match(chrome, /aria-label="Resize and rotate"/);
  assert.match(chrome, /onClick=\{api\.onEnterBBoxEdit\}/);
  assert.match(overlay, /data-resize-handle=\{id\}/);
  assert.match(overlay, /data-rotation-handle="mtr"/);
  assert.doesNotMatch(viewer, /editType: 'bbox'[\s\S]{0,80}ellipse/);
});
