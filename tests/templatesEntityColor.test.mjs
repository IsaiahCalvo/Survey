import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-templates-entity-color.spec.mjs
// Unique leftover after Spaces space-card Delete: U-03 entity color
// (aria-label="Edit color" / setEntityColor / CompactColorPicker on roster).
// Distinct from viewer every-swatch, leftover-18 Space CSV / PDF Pages,
// and from already-proven template create/rename/delete.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('TemplatesEditor Edit color writes fill via setEntityColor', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const setEntityColor = (eid, color) => {');
  assert.ok(start > 0, 'setEntityColor');
  const block = editor.slice(start, editor.indexOf('const deleteEntities = (ids) => {', start));
  assert.match(block, /roster: t\.roster\.map\(\(r\) => \(r\.id === eid \? \{ \.\.\.r, color \} : r\)\)/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(block, /__e2eEntityColor/);

  assert.match(editor, /aria-label="Edit color"/);
  assert.match(editor, /data-entity-color-panel/);
  assert.match(editor, /setEntityColor\(r\.id, color\)/);
  assert.match(editor, /<CompactColorPicker/);
  assert.match(editor, /passthroughSelector="\[data-entity-editor-actions\] button"/);
  assert.match(editor, /data-entity-editor-actions/);
  assert.doesNotMatch(editor, /onExportSpaceCSV/);
  assert.doesNotMatch(editor, /Copy to Spaces/);
});

test('fill apply writes roleColors; Match Fill locks the border picker', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const applyAt = editor.indexOf('const applyColor = (color, opacity) => {');
  assert.ok(applyAt > 0, 'desktop applyColor');
  const apply = editor.slice(applyAt, editor.indexOf('return (', applyAt));
  assert.match(apply, /if \(isBorderMatched\) return;/);
  assert.match(apply, /if \(layer === 'border'\) \{\s*setBorderColors\(\{ \.\.\.borderColors, \[r\.id\]: \{ color, opacity \} \}\);/);
  assert.match(apply, /setRoleColors\(\{ \.\.\.roleColors, \[r\.id\]: \{ color, opacity \} \}\);/);
  assert.match(apply, /setEntityColor\(r\.id, color\);/);
  assert.match(apply, /markEdited\(\);/);

  assert.match(editor, /pointerEvents: isBorderMatched \? 'none' : 'auto'/);
  assert.match(editor, /<span style=\{\{ fontSize: 11, fontWeight: 600, color: match \? 'var\(--ink\)' : 'var\(--ink-soft\)' \}\}>Match fill<\/span>/);
  assert.match(editor, /setMatchFill\(\{ \.\.\.matchFill, \[r\.id\]: e\.target\.checked \}\)/);
});

test('entity color persists through richToTemplate and is distinct from leftover-18', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const richToTemplate = (r) => {');
  assert.ok(start > 0, 'richToTemplate');
  const block = editor.slice(start, editor.indexOf('const handleSaveTemplates = () => {', start));
  assert.match(block, /const fillColor = roleColors\[e\.id\]\?\.color \|\| e\.color \|\| '#8c8c8a';/);
  assert.match(block, /const fillOpacity = roleColors\[e\.id\]\?\.opacity \?\? e\.opacity \?\? 0\.35;/);
  assert.match(block, /color: fillColor,/);
  assert.match(block, /borderColor: bd\.color,/);
  assert.match(block, /matchFill: mf,/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);

  const shape = read('src/services/templateConfigShape.js');
  assert.match(shape, /export const toHex6 = \(color\) => \{/);
  assert.match(shape, /const m = \/rgba\?\\\(\\s\*\(\\d\+\)\[,\\s\]\+\(\\d\+\)\[,\\s\]\+\(\\d\+\)\/i\.exec\(c\);/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /\{ id: 'e1', name: 'GC', color: 'rgba\(216,168,78,0\.5\)' \}/);
  assert.match(preview, /onSaveTemplates=\{setTemplates\}/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
});
