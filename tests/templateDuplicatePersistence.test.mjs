import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/home/TemplatesEditor.jsx', 'utf8');

test('template duplication persists immediately so mobile list copies cannot hide unsaved state', () => {
  const duplicateStart = source.indexOf('const duplicateTemplates =');
  const reorderStart = source.indexOf('const reorderTemplates =', duplicateStart);
  assert.ok(duplicateStart >= 0 && reorderStart > duplicateStart);
  const duplicate = source.slice(duplicateStart, reorderStart);
  assert.match(duplicate, /dispatchTemplatesSave/);
  assert.match(duplicate, /setDirty\(false\)/);
  assert.match(duplicate, /setDirty\(true\)/);
});

test('a duplicated template keeps its Smart fill tag shapes when it is first saved', () => {
  const start = source.indexOf('smartFillShapes: _oldShapes');
  assert.ok(start >= 0);
  const body = source.slice(start, start + 800);
  // No saved row yet (a duplicate): keep the shapes it was copied with.
  assert.match(body, /original\.id \? _oldShapes : r\.smartFillShapes/);
});
