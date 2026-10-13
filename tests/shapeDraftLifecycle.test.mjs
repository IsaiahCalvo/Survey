/**
 * Shape drafts (owner desktop pass, 2026-10-02).
 *
 * 1. Holding the mouse still mid-draw must never wipe the shape. The cause was
 *    PDFViewer's annotation-overlay watchdog: when the page you draw on had no
 *    marks yet, it checked a marked page scrolled out of the mounted window,
 *    found no layer there, and remounted every page's layer every 5 s.
 * 2. Every shape preview is the real mark (commit builder + committed
 *    renderer) — no dashed placeholder.
 * 3. Line and Arrow accept click-move-click as well as press-drag-release.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildLineCommitJSON,
  buildPolyShapeCommitJSON,
} from '../src/utils/annotationCreationCommit.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const viewer = read('../src/PDFViewer.jsx');
const layer = read('../src/components/SVGAnnotationLayer.jsx');

test('overlay watchdog only checks pages in the mounted window and never recovers mid-draft', () => {
  const start = viewer.indexOf('const annotationOverlayWatchdogRef = useRef(');
  assert.ok(start > 0, 'watchdog not found');
  const body = viewer.slice(start, start + 5000);
  assert.match(body, /pdfjsMountedPagesRef\.current/);
  assert.match(body, /isLivePage\(Number\(key\)\)/);
  assert.match(body, /\.shape-creation-preview, \.poly-creation-preview, \.freehand-creation-preview/);
});

test('creation previews render the commit JSON, never a dashed placeholder', () => {
  const previews = layer.slice(layer.indexOf('{shapeCreation && (shapeCreation.tool === \'rect\''), layer.indexOf('{shapeCreation && shapeCreation.tool === \'survey-marker\''));
  assert.ok(previews.length > 0);
  assert.doesNotMatch(previews, /strokeDasharray="5,5"/);
  assert.match(previews, /buildBoundaryShapeCommitJSON\(/);
  assert.match(previews, /buildLineCommitJSON\(/);
  assert.match(previews, /buildPolyShapeCommitJSON\(/);
  // The line/arrow draft group stays mounted even before it has length, so
  // the watchdog guard above can see a click-placed line waiting.
  assert.match(previews, /className="shape-creation-preview"\s+data-shape-draft-mode/);
});

test('line and arrow take click-move-click; rect and ellipse stay drag-only', () => {
  assert.match(layer, /const CLICK_PLACE_SHAPE_TOOLS = \['line', 'arrow'\];/);
  assert.match(layer, /const CLICK_PLACE_MAX_TRAVEL_PX = 4;/);
  // Escape cancels a shape draft; a tool switch drops a draft of another tool.
  assert.match(layer, /const shapeDraftActive = /);
  assert.match(layer, /shapeCreationRef\.current\.tool !== activeTool/);
});

test('the preview builders carry the real look: dash style, arrowheads, polygon fill', () => {
  const line = buildLineCommitJSON({
    tool: 'arrow', id: 'p', start: { x: 0, y: 0 }, end: { x: 40, y: 10 },
    strokeColor: '#ff0000', strokeOpacity: 100, strokeWidth: 2,
    arrowheadStyle: 'solid-triangle', lineBorderStyle: 'dashed',
  });
  assert.deepEqual(line.strokeDashArray, [6, 4]);
  assert.equal(line.data.arrowheadStyle, 'solid-triangle');
  assert.equal(line.tool, 'arrow');

  const run = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 20 }];
  const polygon = buildPolyShapeCommitJSON({
    tool: 'polygon', id: 'p', points: run, strokeColor: '#ff0000', strokeOpacity: 100,
    fillColor: '#00ff00', fillOpacity: 50, strokeWidth: 2, lineBorderStyle: 'dotted',
  });
  assert.deepEqual(polygon.strokeDashArray, [2, 4]);
  assert.notEqual(polygon.fill, 'transparent');
  const polyline = buildPolyShapeCommitJSON({
    tool: 'polyline', id: 'p', points: run.slice(0, 2), strokeColor: '#ff0000', strokeOpacity: 100,
    fillColor: '#00ff00', fillOpacity: 50, strokeWidth: 2, lineBorderStyle: 'solid',
  });
  assert.equal(polyline.fill, 'transparent');
});
