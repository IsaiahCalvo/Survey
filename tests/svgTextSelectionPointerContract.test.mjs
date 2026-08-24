import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');

test('Text Select leaves annotation hit targets inert so native PDF text receives the drag', () => {
  assert.match(source, /const isSelectTool = activeTool === 'select'/);
  assert.doesNotMatch(source, /const isSelectTool = \(activeTool === 'select' \|\| activeTool === 'text-select'\)/);
  assert.match(source, /activeTool !== 'text-select'\) \? 'auto' : 'none'/);
});

test('selected text markup shows range handles without an outer bounding box', () => {
  assert.match(source, /hideBoundingBox=\{selectionObj\?\.data\?\.type === 'text-markup'/);
});
