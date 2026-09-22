import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getMobileTextMarkupPresentation } from '../src/mobile/mobilePdfViewerModel.js';

const source = fs.readFileSync(
  new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url),
  'utf8',
);

/*
 * DELIBERATE ASSERTION CHANGE (2026-09-22, board 7 owner ruling). The Select
 * chip's split button, its caret and the pop-up list of the three modes are
 * gone: "NO pop-up. Tapping Select arms it and the top strip shows the Box /
 * Lasso / Text toggle." So the three-mode contract is now guarded where the
 * three modes live - the strip's segmented toggle - instead of in a menu that
 * no longer exists, and the chip is asserted to be a plain rail chip.
 */
test('mobile Select family keeps the stable three-mode contract in the strip', () => {
  assert.match(source, /ariaLabel="Selection mode"/);
  assert.match(source, /label: 'Box'[\s\S]{0,200}label: 'Lasso'[\s\S]{0,200}label: 'Text'/);
  assert.match(source, /getSelectFamilyTransition\(mode\)/);
  assert.doesNotMatch(source, /lasso-select'[\s\S]{0,80}disabled: true/);
});

test('mobile Select is a plain rail chip with no caret and no mode pop-up', () => {
  assert.doesNotMatch(source, /mobile-pdf-tools__select-family/);
  assert.doesNotMatch(source, /mobile-pdf-tools__select-caret/);
  assert.doesNotMatch(source, /mobile-select-mode-menu/);
  assert.doesNotMatch(source, /selectModeOpen/);
  assert.match(source, /label=\{getSelectFamilyLabel\(activeTool, bottomToolbarApi\?\.selectionMode\)\}/);
});

test('mobile text markup controls cover create and selected-mark editing state', () => {
  assert.equal(getMobileTextMarkupPresentation(null).active, false);
  assert.deepEqual(getMobileTextMarkupPresentation({
    activeTool: 'text-select',
    strokeColor: '#f4d35e',
    strokeOpacity: 30,
    textMarkupOverlapMode: 'uniform',
  }), {
    active: true,
    editingSelection: false,
    sharedToolbarActive: false,
    color: '#f4d35e',
    opacity: 30,
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
  assert.equal(liveSelection.opacity, 30);

  assert.equal(getMobileTextMarkupPresentation({ activeTool: 'select', contextTool: 'rect' }).active, false);
});

test('mobile text markup toolbar wires color, opacity, overlap, and the action-bar picker flag', () => {
  assert.match(source, /data-mobile-text-markup-controls=/);
  assert.match(source, /aria-label="Text markup color and opacity"/);
  assert.match(source, /api\.showAnnotationColorPicker/);
  assert.match(source, /api\.handleTextMarkupPaintChange\(hex, opacity\)/);
  assert.match(source, /api\.handleStrokeColorChange\?\.\(hex\)/);
  assert.match(source, /api\.handleStrokeOpacityChange\?\.\(/);
  assert.match(source, /minOpacity=\{0\.05\}/);
  assert.match(source, /ariaLabel="Highlight overlap mode"/);
  assert.match(source, /api\.setTextMarkupOverlapMode\?\.\(value\)/);
  /*
   * DELIBERATE ASSERTION CHANGE (2026-09-22, owner ruling: a selected mark's own
   * controls appear in the strip). The old shape asserted that
   * `sharedToolbarActive` returns the colour picker AND NO STRIP - so a selected
   * text markup was the one annotation kind that showed nothing on the phone,
   * while the desktop bar showed its colour row. The strip now renders in that
   * state too; what this line guards is unchanged and stronger: the markup row
   * still owns the shared colour picker.
   */
  assert.doesNotMatch(source, /if \(textMarkup\.sharedToolbarActive\) \{\s*return/);
  assert.match(source, /data-mobile-text-markup-controls[\s\S]*?api\.showAnnotationColorPicker && \(\s*<MobileColorPickerSurface/);
});
