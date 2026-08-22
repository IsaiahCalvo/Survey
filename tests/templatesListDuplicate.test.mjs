import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-templates-list-duplicate.spec.mjs
// Unique leftover after New category / category Duplicate / module Delete:
// template-list Duplicate (`duplicateTemplates` / `{name} copy`).
// Distinct from module Duplicate, category Duplicate, leftover-18 export.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('duplicateTemplates mints {name} copy with new module/category/item/entity ids', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const duplicateTemplates = (ids) => {');
  assert.ok(start > 0, 'duplicateTemplates');
  const block = editor.slice(start, editor.indexOf('const DEFAULT_ROLES', start));
  assert.match(block, /name: `\$\{t\.name\} copy`/);
  assert.match(block, /id: newId\('t'\)/);
  assert.match(block, /id: newId\('m'\)/);
  assert.match(block, /id: newId\('c'\)/);
  assert.match(block, /id: newId\('i'\)/);
  assert.match(block, /const id = newId\('e'\)/);
  assert.match(block, /markEdited\(\)/);
  assert.doesNotMatch(block, /onExportSpaceCSV/);
  assert.doesNotMatch(block, /file\.id/);
  assert.doesNotMatch(block, /Copy to Spaces/);
  assert.doesNotMatch(block, /__e2eDuplicateTemplates/);
});

test('list Duplicate leftover is duplicateTemplates, not module or category Duplicate', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  assert.match(editor, /onClick=\{\(\) => \{ if \(visibleSelCount\) \{ duplicateTemplates\(visibleSelectedIds\); setSelTpls\(new Set\(\)\); \} \}\}/);
  assert.match(editor, /disabled=\{!visibleSelCount\} style=\{miniButtonStyle\(\{ borderColor: 'var\(--rule-strong\)', color: 'var\(--ink-soft\)', disabled: !visibleSelCount \}\)\}>Duplicate<\/button>/);
  assert.match(editor, /\{ label: 'Copy', onClick: \(\) => duplicateTemplates\(new Set\(\[t\.id\]\)\) \}/);

  const modStart = editor.indexOf('const duplicateModules = (ids) => {');
  assert.ok(modStart > 0, 'duplicateModules is a distinct leftover already proven');
  const catStart = editor.indexOf('const duplicateCategories = (ids) => {');
  assert.ok(catStart > 0, 'duplicateCategories is a distinct leftover already proven');
  assert.notEqual(modStart, editor.indexOf('const duplicateTemplates = (ids) => {'));
  assert.notEqual(catStart, editor.indexOf('const duplicateTemplates = (ids) => {'));
});

test('hubPreview seeds Security Walk-Through and wires onSaveTemplates without leftover-18', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /id: 't1', name: 'Security Walk-Through'/);
  assert.match(preview, /id: 'm1', name: 'Installation Phase'/);
  assert.match(preview, /id: 'c1', name: 'Cameras'/);
  assert.match(preview, /id: 't2', name: 'MEP As-Built Markup'/);
  assert.match(preview, /onSaveTemplates=\{setTemplates\}/);
  assert.doesNotMatch(preview, /onExportSpaceCSV/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /file\.id/);
});
