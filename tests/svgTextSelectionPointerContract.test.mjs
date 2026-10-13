import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getTextMarkupSelectionChrome } from '../src/utils/pdfTextMarkup.js';

const source = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');

test('Text Select enables annotation selection but leaves the blank SVG surface inert for native text drags', () => {
  // 2026-10-02 (Drawboard rule 3/4): the same gate also opens while a press
  // on the selection is in hand under another tool (selectionGrabArmed), so
  // the pin stops at the select-family half of the condition.
  assert.match(source, /const isSelectTool = \(activeTool === 'select' \|\| activeTool === 'text-select'/);
  assert.match(source, /activeTool !== 'text-select' \|\| textSelectManipulationArmed \|\| interactionState !== 'idle'/);
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

test('text-markup range resize keeps capture on the stable SVG and has a window release fallback', () => {
  const interactionSource = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(interactionSource, /svgRef\.current\?\.setPointerCapture\?\.\(e\.pointerId\)/);
  assert.match(interactionSource, /activeTextRangeDrag\?\.mode === 'text-markup-horizontal'/);
  assert.match(interactionSource, /window\.addEventListener\('pointerup', onInteractionWindowPointerUp, true\)/);
});
