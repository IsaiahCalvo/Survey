import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-templates-entity-opacity-border.spec.mjs
// Unique leftover after fill-only entity color: opacity slider/field +
// independent Border tab (not Match-fill lock-only). Distinct from viewer
// every-swatch and leftover-18 Space CSV / PDF Pages.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop applyColor writes fill opacity vs independent border', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const applyAt = editor.indexOf('const applyColor = (color, opacity) => {');
  assert.ok(applyAt > 0, 'desktop applyColor');
  const apply = editor.slice(applyAt, editor.indexOf('return (', applyAt));
  assert.match(apply, /if \(isBorderMatched\) return;/);
  assert.match(apply, /if \(layer === 'border'\) \{\s*setBorderColors\(\{ \.\.\.borderColors, \[r\.id\]: \{ color, opacity \} \}\);/);
  assert.match(apply, /setRoleColors\(\{ \.\.\.roleColors, \[r\.id\]: \{ color, opacity \} \}\);/);
  assert.match(apply, /setEntityColor\(r\.id, color\);/);
  assert.match(apply, /markEdited\(\);/);
  assert.doesNotMatch(apply, /onExportSpaceCSV/);
  assert.doesNotMatch(apply, /file\.id/);
  assert.doesNotMatch(apply, /__e2eEntityOpacity/);

  assert.match(editor, /\['fill', 'Fill'\], \['border', 'Border'\]/);
  assert.match(editor, /\{layer === 'border' && \(/);
});

test('richToTemplate round-trips fill opacity and unmatched border', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const richToTemplate = (r) => {');
  assert.ok(start > 0, 'richToTemplate');
  const block = editor.slice(start, editor.indexOf('const handleSaveTemplates = () => {', start));
  assert.match(block, /const fillOpacity = roleColors\[e\.id\]\?\.opacity \?\? e\.opacity \?\? 0\.35;/);
  assert.match(block, /opacity: fillOpacity,/);
  assert.match(block, /borderColor: bd\.color,/);
  assert.match(block, /borderOpacity: bd\.opacity,/);
  assert.match(block, /const bd = mf\s*\? \{ color: fillColor, opacity: fillOpacity \}\s*: \(borderColors\[e\.id\] \|\| \{/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /Copy to Spaces/);

  const seed = read('src/home/templatesEditorReload.js');
  assert.match(seed, /roleColors\[r\.id\] = \{ color: r\.color, opacity: r\.opacity \?\? 0\.35 \};/);
  assert.match(seed, /if \(r\.borderColor\) \{\s*borderColors\[r\.id\] = \{ color: r\.borderColor, opacity: r\.borderOpacity \?\? \(r\.opacity \?\? 0\.35\) \};/);
});

test('CompactColorPicker exposes opacity field used by the entity tabs', () => {
  const picker = read('src/components/CompactColorPicker.jsx');
  assert.match(picker, /aria-label="Opacity percentage"/);
  assert.match(picker, /onChange\(localHex, val \/ 100\)/);
  assert.match(picker, /OPACITY/);
  assert.match(picker, /showOpacity = true/);
  assert.doesNotMatch(picker, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(picker, /VITE_DEV_AUTO_LOGIN/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /\{ id: 'e1', name: 'GC', color: 'rgba\(216,168,78,0\.5\)' \}/);
  assert.match(preview, /onSaveTemplates=\{setTemplates\}/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
});
