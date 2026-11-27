import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getDocumentMaximumScale,
  MAX_RENDERED_PAGE_DIMENSION_PX,
} from '../src/utils/pdfZoomMath.js';
import { createZoomController } from '../src/utils/zoomController.js';
import {
  isClientPointNearRect,
  shouldArmTextSelectManipulation,
  TEXT_RANGE_HANDLE_POINTER_PADDING,
} from '../src/utils/selectionPointerOwnership.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// #1727 — Pen stroke across a comment pin at phone width has no gap
// ---------------------------------------------------------------------------
test('#1727: PagePinsLayer drops below SVGAnnotationLayer and disables pin presses during drawing tools', () => {
  const pinsSrc = read('src/components/pins/PagePinsLayer.jsx');
  const viewerSrc = read('src/PDFViewer.jsx');

  // Marking tools pass through to the SVG layer and drop pins below zIndex 100
  // so pen ink draws unbroken across a pin; interactive pin tools stay at 110.
  assert.match(pinsSrc, /export const pinLayerZIndex = \(activeTool\) => \(pinTakesPress\(activeTool\) \? 110 : 95\);/);
  assert.match(pinsSrc, /zIndex:\s*pinLayerZIndex\(activeTool\)/);
  assert.match(pinsSrc, /onPointerDown=\{passThrough \? undefined : onPress\}/);
  assert.match(pinsSrc, /onMouseDown=\{passThrough \? undefined : \(e\) => e\.stopPropagation\(\)\}/);
  assert.match(pinsSrc, /onClick=\{passThrough \? undefined : \(e\) => e\.stopPropagation\(\)\}/);
  // Draft pin also receives passThrough so switching to Pen mid-draft cannot catch ink.
  assert.match(pinsSrc, /anchor="draft"[\s\S]{0,220}passThrough=\{passThrough\}/);
  // SVGAnnotationLayer wrapper stays at zIndex 100 (between 95 and 110).
  assert.match(viewerSrc, /data-diag-svg-wrapper=\{pageNumber\}[\s\S]{0,800}zIndex:\s*100/);
});

// ---------------------------------------------------------------------------
// #1718 — Maximum zoom stops at a renderable ceiling on large sheets
// ---------------------------------------------------------------------------
test('#1718: getDocumentMaximumScale caps large architectural sheets to Chromium canvas dimension limit', () => {
  assert.equal(MAX_RENDERED_PAGE_DIMENSION_PX, 16384);

  // Arch E1 (42"x30" = 3024x2160 pt) caps around 542% so rendered width <= 16384 px
  // instead of zooming to 2846%-4000% (120,000+ px) and turning blank white.
  const archE1 = getDocumentMaximumScale({
    pageWidths: [3024],
    pageHeights: [2160],
  });
  assert.ok(archE1 * 3024 <= 16384 + 1e-6);
  assert.ok(archE1 > 5 && archE1 < 6);

  // Arch D (36"x24" = 2592x1728 pt) caps around 632%.
  const archD = getDocumentMaximumScale({
    pageWidths: [2592],
    pageHeights: [1728],
  });
  assert.ok(archD * 2592 <= 16384 + 1e-6);
  assert.ok(archD > 6 && archD < 7);

  // US Letter (612x792 pt) caps around 2069%.
  const letter = getDocumentMaximumScale({
    pageWidths: [612],
    pageHeights: [792],
  });
  assert.ok(letter * 792 <= 16384 + 1e-6);
  assert.ok(letter > 20 && letter < 21);

  // Small pages still respect the 40x desktop / 8x mobile platform cap.
  assert.equal(getDocumentMaximumScale({ pageWidths: [200], pageHeights: [200] }), 40);
  assert.equal(getDocumentMaximumScale({
    pageWidths: [612],
    pageHeights: [792],
    absoluteMaximumScale: 8,
  }), 8);

  // Empty page dimensions fall back cleanly to absoluteMaximumScale.
  assert.equal(getDocumentMaximumScale({ pageWidths: [], pageHeights: [] }), 40);
});

test('#1718: createZoomController clamps scale to dynamic getMaximumScale and viewer wires it', () => {
  let applied = null;
  const controller = createZoomController({
    initialManualScale: 1,
    getMinimumScale: () => 0.2,
    getMaximumScale: () => 5.4,
    setScale: (s) => { applied = s; },
    persistPreferences: () => {},
  });

  assert.equal(controller.setScale(40), 5.4);
  assert.equal(controller.getManualScale(), 5.4);
  assert.equal(applied, 5.4);
  assert.equal(controller.setScale(0.05), 0.2);

  const containerSrc = read('src/components/PdfjsViewerContainer.jsx');
  const viewerSrc = read('src/PDFViewer.jsx');
  assert.match(containerSrc, /function getMaximumScaleForLayout\(/);
  assert.match(containerSrc, /getMaximumScale:\s*\(\) => getMaximumScaleForLayout\(dimsPtRef\.current,\s*isMobileSurface\)/);
  assert.match(viewerSrc, /getMaximumScale:\s*\(\) => pdfjsViewerRef\.current\?\.getMaximumScale\?\.\(\) \|\| 40/);
});

// ---------------------------------------------------------------------------
// #1732 — Underlines on adjacent words stay separate annotations
// ---------------------------------------------------------------------------
test('#1732: text-drag markup tools disarm range-handle capture and mouse handle arming stays tight to visual pill', () => {
  assert.equal(shouldArmTextSelectManipulation({ activeTool: 'text-select', textDragModeActive: false }), true);
  assert.equal(shouldArmTextSelectManipulation({ activeTool: 'text-select', textDragModeActive: true }), false);
  assert.equal(shouldArmTextSelectManipulation({ activeTool: 'select', textDragModeActive: false }), false);

  // Visual handle pill at right edge of "STORAGE" (x=100..106) only arms within
  // TEXT_RANGE_HANDLE_POINTER_PADDING (4 px), leaving adjacent "103" (starting at x=114)
  // untouched so dragging "103" creates a second underline instead of stretching "STORAGE".
  assert.equal(TEXT_RANGE_HANDLE_POINTER_PADDING, 4);
  const visualPill = { left: 100, right: 106, top: 40, bottom: 56, width: 6, height: 16 };
  assert.equal(isClientPointNearRect(103, 48, visualPill, TEXT_RANGE_HANDLE_POINTER_PADDING), true);
  assert.equal(isClientPointNearRect(114, 48, visualPill, TEXT_RANGE_HANDLE_POINTER_PADDING), false);

  const layerSrc = read('src/components/SVGAnnotationLayer.jsx');
  const viewerSrc = read('src/PDFViewer.jsx');
  assert.match(layerSrc, /querySelectorAll\('\[data-text-range-handle-visual\]'\)/);
  assert.match(layerSrc, /shouldArmTextSelectManipulation\(\{\s*activeTool,\s*textDragModeActive\s*\}\)/);
  assert.match(viewerSrc, /textDragModeActive=\{textDragToolsOn && Boolean\(textHighlightMode\)\}/);
});
