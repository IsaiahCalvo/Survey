import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFitPageWidth, resolveDocumentColumnWidth } from '../src/utils/pdfPageColumn.js';
import { computeFitScale } from '../src/utils/pageNavigationMath.js';

test('phone fits a portrait cover + landscape sheets to the widest page', () => {
  const w = resolveFitPageWidth({ phone: true, mode: 'fit', pageWidth: 612, widestPageWidth: 1224 });
  assert.equal(w, 1224);
  const viewportW = 354; const padX = 14;
  const scale = computeFitScale({ mode: 'fitPage', pageW: w, pageH: 792, viewportW, viewportH: 700, padX });
  // The widest sheet fits the viewer, so the column never overflows and every
  // page's left edge is on screen.
  assert.equal(resolveDocumentColumnWidth({ viewportWidth: viewportW, widestPageWidth: 1224 * scale, padX }), viewportW);
});

test('desktop and Fit height keep measuring the page you are on', () => {
  assert.equal(resolveFitPageWidth({ phone: false, mode: 'fit', pageWidth: 612, widestPageWidth: 1224 }), 612);
  assert.equal(resolveFitPageWidth({ phone: true, mode: 'fith', pageWidth: 612, widestPageWidth: 1224 }), 612);
  assert.equal(resolveFitPageWidth({ phone: true, mode: 'fitw', pageWidth: 1224, widestPageWidth: 612 }), 1224);
  assert.equal(resolveFitPageWidth({ phone: true, mode: 'fit', pageWidth: 612, widestPageWidth: 0 }), 612);
});
