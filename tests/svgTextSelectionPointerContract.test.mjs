import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getTextMarkupSelectionChrome } from '../src/utils/pdfTextMarkup.js';

const source = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');

test('Text Select leaves annotation hit targets inert so native PDF text receives the drag', () => {
  assert.match(source, /const isSelectTool = activeTool === 'select'/);
  assert.doesNotMatch(source, /const isSelectTool = \(activeTool === 'select' \|\| activeTool === 'text-select'\)/);
  assert.match(source, /activeTool !== 'text-select'\) \? 'auto' : 'none'/);
});

test('legacy text marks show a selection box while current marks show range handles', () => {
  assert.deepEqual(
    getTextMarkupSelectionChrome({ data: { type: 'text-markup', quads: [{}] } }),
    { hideBoundingBox: false, hideResizeHandles: true },
  );
  assert.deepEqual(
    getTextMarkupSelectionChrome({
      data: { type: 'text-markup', textRangeModel: { runs: [{ start: 0, end: 4 }] } },
    }),
    { hideBoundingBox: true, hideResizeHandles: false },
  );
});
