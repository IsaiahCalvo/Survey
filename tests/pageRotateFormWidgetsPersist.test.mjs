import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';
import { remapFormWidgetRect } from '../src/utils/pdfjsTextLayerViewport.js';

// Source contracts: form widgets persist after page CW via annotated
// export → ?testPdf= re-import. Live leftover-portrait remap is already
// pageRotateFormWidgets / e2e-page-rotate-form-widgets.
// Live proof: debug/scenarios/e2e-page-rotate-form-widgets-persist.spec.mjs
// Do not invent a Forms editor.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('baked CW still remaps widget fractions off leftover portrait', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const rotatedBytes = await mutatePdfPages(await source.save(), { type: 'rotate', page: 1, delta: 90 });
  assert.deepEqual(await peekDisplayedPageSize(rotatedBytes, 1), { width: 792, height: 612 });

  const leftoverVp = {
    width: 612,
    height: 792,
    convertToViewportPoint(x, y) { return [x, 792 - y]; },
  };
  const swappedVp = {
    width: 792,
    height: 612,
    convertToViewportPoint(x, y) { return [y, x]; },
  };
  const nameRect = [72, 510, 372, 538];
  const leftover = remapFormWidgetRect(nameRect, leftoverVp);
  const remapped = remapFormWidgetRect(nameRect, swappedVp);
  const leftoverCx = leftover.left + leftover.width / 2;
  const remappedCx = remapped.left + remapped.width / 2;
  assert.ok(Math.abs(leftoverCx / 100 - 0.363) < 0.02);
  assert.ok(Math.abs(remappedCx / 100 - leftoverCx / 100) > 0.15);
  assert.ok(remappedCx / 100 > 0.55);
});

test('live persist spec covers export re-import, leftover miss, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-form-widgets-persist.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /Export annotated PDF/);
  assert.match(spec, /_e2e-page-rotate-form-widgets-persist\.pdf/);
  assert.match(spec, /leftover portrait/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /createTextField|Forms editor|formDesigner/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('PdfjsFormLayer still remaps; no Forms create UI invented', () => {
  const layer = read('src/components/PdfjsFormLayer.jsx');
  assert.match(layer, /remapFormWidgetRect/);
  assert.doesNotMatch(layer, /createTextField|createCheckBox|formDesigner/);
});
