import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getMobileTextMarkupPresentation } from '../src/mobile/mobilePdfViewerModel.js';

const source = fs.readFileSync(
  new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url),
  'utf8',
);

test('mobile Select family keeps the stable three-mode contract', () => {
  assert.match(source, /SELECT_MODE_OPTIONS\.map/);
  assert.match(source, /chooseSelectMode\(option\.mode\)/);
  assert.doesNotMatch(source, /lasso-select'[\s\S]{0,80}disabled: true/);
});

test('mobile Select uses a split button and exposes its menu to touch and keyboard', () => {
  assert.match(source, /className="mobile-pdf-tools__select-family"/);
  assert.match(source, /aria-haspopup="menu"/);
  assert.match(source, /aria-controls="mobile-select-mode-menu"/);
  assert.match(source, /role="menuitemradio"/);
  assert.match(source, /getSelectModeMenuFocusIndex/);
  assert.match(source, /mode === 'text'[\s\S]{0,100}selectTool\('text-select'\)/);
});

test('mobile text markup controls cover create and selected-mark editing state', () => {
  assert.equal(getMobileTextMarkupPresentation(null).active, false);
  assert.deepEqual(getMobileTextMarkupPresentation({
    activeTool: 'text-select',
    strokeColor: '#f4d35e',
    strokeOpacity: 38,
    textMarkupOverlapMode: 'uniform',
  }), {
    active: true,
    editingSelection: false,
    sharedToolbarActive: false,
    color: '#f4d35e',
    opacity: 38,
    overlapMode: 'uniform',
  });

  const selected = getMobileTextMarkupPresentation({
    activeTool: 'select',
    contextTool: 'text-markup',
    strokeColor: '#000000',
    strokeOpacity: 100,
    selectedStrokeColor: 'rgba(74, 144, 226, 0.42)',
    textMarkupOverlapMode: 'unexpected',
  });
  assert.equal(selected.active, true);
  assert.equal(selected.editingSelection, true);
  assert.equal(selected.sharedToolbarActive, true);
  assert.equal(selected.color, 'rgba(74, 144, 226, 0.42)');
  assert.equal(selected.opacity, 42);
  assert.equal(selected.overlapMode, 'layered');

  const liveSelection = getMobileTextMarkupPresentation({
    activeTool: 'text-select',
    hasLiveTextSelection: true,
  });
  assert.equal(liveSelection.sharedToolbarActive, true);

  assert.equal(getMobileTextMarkupPresentation({ activeTool: 'select', contextTool: 'rect' }).active, false);
});

test('mobile text markup toolbar wires color, opacity, overlap, and the action-bar picker flag', () => {
  assert.match(source, /data-mobile-text-markup-controls=/);
  assert.match(source, /aria-label="Text markup color and opacity"/);
  assert.match(source, /api\.showAnnotationColorPicker/);
  assert.match(source, /api\.handleStrokeColorChange\?\.\(hex\)/);
  assert.match(source, /api\.handleStrokeOpacityChange\?\.\(/);
  assert.match(source, /minOpacity=\{0\.05\}/);
  assert.match(source, /ariaLabel="Highlight overlap mode"/);
  assert.match(source, /api\.setTextMarkupOverlapMode\?\.\(value\)/);
  assert.match(source, /if \(textMarkup\.sharedToolbarActive\) \{[\s\S]*?api\.showAnnotationColorPicker[\s\S]*?<MobileColorPickerSurface/);
});
