// Nightly 'stamp-tool' (Drawboard Projects' Stamp, checked live 2026-11-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STAMP_BOX,
  STAMP_LINE_HEIGHT,
  STAMP_PRESETS,
  STAMP_PRESET_COLOUR,
  isStampPresetItem,
  stampPresetItems,
} from '../src/markLibrary/drawboardStamps.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { kindLabel, kindOfObject } from '../src/utils/selectionProperties.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test("Drawboard's twelve presets, in its order, with its line breaks", () => {
  assert.deepEqual(STAMP_PRESETS.map((p) => p.lines.join(' / ')), [
    'DRAFT ISSUE', 'FOR REVIEW', 'CHECK PRINT', 'PRELIMINARY / ISSUE', 'APPROVED', 'FOR INFORMATION / ONLY',
    'REVISE / AND RESUBMIT', 'REVISED', 'REJECTED', 'NOT FOR / CONSTRUCTION', 'FOR / CONSTRUCTION', 'AS-BUILT',
  ]);
});

test('each is a 120 x 60 pt box, 2 pt #FF4F68 border, 11 pt #FF4F68 words centred, lines 18 pt apart', () => {
  const items = stampPresetItems();
  assert.equal(items.length, 12);
  for (const item of items) {
    assert.ok(isStampPresetItem(item));
    const [entry] = item.payload.items;
    const o = entry.object;
    assert.equal(entry.kind, 'mark');
    assert.equal(o.type, 'Textbox');
    assert.equal(o.width, STAMP_BOX.width);
    assert.equal(o.height, STAMP_BOX.height);
    assert.equal(o.stroke, STAMP_PRESET_COLOUR);
    assert.equal(o.fill, STAMP_PRESET_COLOUR);
    assert.equal(o.strokeWidth, 2);
    assert.equal(o.fontSize, 11);
    assert.equal(o.fontFamily, 'Helvetica', 'one plain font name (fabric measuring rule)');
    assert.equal(o.textAlign, 'center');
    assert.equal(o.verticalAlign, 'middle');
    assert.ok(!o.backgroundColor, 'no fill');
    assert.deepEqual(item.payload.extent, { left: 0, top: 0, width: 120, height: 60 });
    assert.equal(o.data.stampPreset, item.id.split(':')[1]);
  }
  assert.ok(Math.abs(11 * STAMP_LINE_HEIGHT * 1.13 - 18) < 1e-9);
  assert.equal(kindLabel([kindOfObject(items[0].payload.items[0].object)]), 'Stamp');
});

test('a beta flag with its migration; Stamp in the desktop and phone Text group; placed by the library layer', () => {
  assert.equal(FEATURE_FLAGS['stamp-tool']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261110148000_stamp_tool_flag.sql'), /\('stamp-tool', 'off'/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /isFeatureOn\('stamp-tool'\) \? \[\{ id: 'stamp', label: 'Stamp', iconName: 'stamp', picker: true \}\]/);
  assert.match(viewer, /\(markLibraryEnabled \|\| stampToolEnabled\) && \(\s*<MarkLibraryPlacementLayer/);
  assert.match(read('src/mobile/MobilePdfViewerChrome.jsx'), /\{ id: 'stamp', label: 'Stamp', icon: 'stamp', flag: 'stamp-tool', picker: true \}/);
  assert.match(read('src/AppShell.jsx'), /<StampPickerCard enabled=\{Boolean\(isViewerVisible && isFeatureOn\('stamp-tool'\)\)\}/);
});
