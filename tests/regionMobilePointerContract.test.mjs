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

test('mobile Region subtools expose persistent Select mode', () => {
  assert.match(
    MOBILE_CHROME_SOURCE,
    /label="Select region"[\s\S]{0,180}?setToolType\?\.\('move'\)/,
  );
  assert.match(REGION_SOURCE, /canDelete: selectedRegionIds\.size > 0/);
  assert.match(REGION_SOURCE, /deleteSelected: handleDeleteSelected/);
  assert.match(
    MOBILE_CHROME_SOURCE,
    /name: 'Delete'|>Delete<|Delete<\/button>/,
  );
});
