import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const REGION_SOURCE = fs.readFileSync(new URL('../src/RegionSelectionTool.jsx', import.meta.url), 'utf8');
const MOBILE_CHROME_SOURCE = fs.readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');

test('RegionSelectionTool uses one captured pointer stream for touch and mouse', () => {
  assert.match(REGION_SOURCE, /const activePointerIdRef = useRef\(null\)/);
  assert.match(REGION_SOURCE, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(REGION_SOURCE, /releasePointerCapture\?\.\(activePointerId\)/);
  assert.match(REGION_SOURCE, /onPointerDown: handleMouseDown/);
  assert.match(REGION_SOURCE, /onPointerMove: handleMouseMove/);
  assert.match(REGION_SOURCE, /onPointerUp: handleMouseUp/);
  assert.match(REGION_SOURCE, /onPointerCancel: handlePointerCancel/);
  assert.match(REGION_SOURCE, /touchAction: 'none'/);
  assert.doesNotMatch(REGION_SOURCE, /onMouseDown: handleMouseDown/);
  assert.doesNotMatch(REGION_SOURCE, /document\.addEventListener\('mousemove', handleDocumentMouseMoveCapture/);
});

test('every Region transform entry point starts from pointerdown', () => {
  assert.match(REGION_SOURCE, /onPointerDown=\{effectiveToolType === 'move' \? \(event\) => handleRegionPointerDown/);
  assert.match(REGION_SOURCE, /onPointerDown=\{\(event\) => handleRotatePointerDown/);
  assert.match(REGION_SOURCE, /onPointerDown=\{\(event\) => handleVertexPointerDown/);
  assert.match(REGION_SOURCE, /onPointerDown=\{\(event\) => handleResizePointerDown/);
  assert.doesNotMatch(REGION_SOURCE, /onMouseDown=\{effectiveToolType === 'move'/);
});

// Owner 2026-10-01 ("Spaces don't work on the phone: draw, select, move").
test('phone Region layer lets two fingers reach the PDF viewer and has finger-sized handles', () => {
  // The full-page layer is see-through to touches on the phone, so a pinch or
  // two-finger pan lands in the PDF scroller; the one-finger press is picked up
  // by the document capture listener instead.
  assert.match(REGION_SOURCE, /pointerEvents: \(activeTool === 'pan' \|\| mobileMode\) \? 'none' : 'auto'/);
  assert.match(REGION_SOURCE, /closest\?\.\('\.survey-pdfjs-viewer'\)/);
  // A second finger drops the half-drawn shape / puts a dragged area back.
  assert.match(REGION_SOURCE, /const PDFJS_PINCH_START_EVENT = 'survey-pdfjs-pinch-start'/);
  assert.match(REGION_SOURCE, /window\.addEventListener\(PDFJS_PINCH_START_EVENT, abandonTouchInteraction\)/);
  // The document listeners are bound once per session (latest handlers via a
  // ref), so a re-render mid-drag can no longer reset the drag.
  assert.match(REGION_SOURCE, /\}, \[active, targetElement, activeTool, mobileMode\]\);/);
  // 44px touch pads around the region handles.
  assert.match(REGION_SOURCE, /const TOUCH_HANDLE_HIT_PX = 44;/);
  assert.match(REGION_SOURCE, /data-handle-hit-pad="true"/);
  // Tap on an area with a draw tool armed selects it.
  assert.match(REGION_SOURCE, /gesture\.travelled <= TOUCH_TAP_SLOP_PX/);
});

test('phone hit-test helper finds the area under a finger', () => {
  const match = REGION_SOURCE.match(/const isPointInFlatPolygon = \(x, y, coords\) => \{[\s\S]*?\n\};/);
  assert.ok(match, 'isPointInFlatPolygon is defined');
  const isPointInFlatPolygon = new Function(`${match[0]}; return isPointInFlatPolygon;`)();
  const box = [10, 10, 110, 10, 110, 60, 10, 60];
  assert.equal(isPointInFlatPolygon(50, 30, box), true);
  assert.equal(isPointInFlatPolygon(5, 30, box), false);
  assert.equal(isPointInFlatPolygon(50, 70, box), false);
  const tri = [0, 0, 100, 0, 0, 100];
  assert.equal(isPointInFlatPolygon(20, 20, tri), true);
  assert.equal(isPointInFlatPolygon(80, 80, tri), false);
});

test('area editing uses the app\'s own Select (no second Select, no floating bar)', () => {
  // DELIBERATE ASSERTION CHANGE (owner 2026-10-01, Spaces toolbar): "We
  // shouldn't have two different Select tools." The separate "Select region"
  // rail chip is gone; the rail's Select arms the area Select while editing.
  assert.doesNotMatch(MOBILE_CHROME_SOURCE, /label="Select region"/);
  assert.match(
    MOBILE_CHROME_SOURCE,
    /if \(regionApi\) \{\s*regionApi\.setToolType\?\.\('move'\);/,
  );
  // And the desktop floating toolbar is gone from the tool itself.
  assert.doesNotMatch(REGION_SOURCE, /Region selection\n/);
  assert.doesNotMatch(REGION_SOURCE, />Additive<\/option>/);
  assert.match(REGION_SOURCE, /canDelete: selectedRegionIds\.size > 0/);
  assert.match(REGION_SOURCE, /deleteSelected: handleDeleteSelected/);
  assert.match(
    MOBILE_CHROME_SOURCE,
    /name: 'Delete'|>Delete<|Delete<\/button>/,
  );
});
