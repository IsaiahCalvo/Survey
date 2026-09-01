import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBrowserPrintLayout } from '../src/utils/browserPrintLayout.js';

test('browser print keeps one sheet per rendered PDF page under one uniform page rule', () => {
  const layout = buildBrowserPrintLayout([
    { pageNumber: 1, widthPt: 612, heightPt: 792, src: 'data:image/png;base64,one' },
    { pageNumber: 2, widthPt: 792, heightPt: 612, src: 'data:image/png;base64,two' },
    { pageNumber: 3, widthPt: 420, heightPt: 595, src: 'data:image/png;base64,three' },
  ]);

  assert.equal(layout.pages.length, 3);
  // One margin-less size:auto rule for the whole job (pdf.js's shipping
  // print pattern). Per-page named sizes overflowed into a phantom trailing
  // page on default paper and broke mixed-orientation pagination.
  assert.equal(layout.pageCss, '@page { size: auto; margin: 0; }');
  assert.ok(!/@page survey-print-page-/.test(layout.pageCss));
});

test('browser print drops invalid pages instead of emitting clipped sheets', () => {
  const layout = buildBrowserPrintLayout([
    { pageNumber: 1, widthPt: 0, heightPt: 792, src: 'bad' },
    { pageNumber: 2, widthPt: 612, heightPt: 792, src: '' },
    { pageNumber: 3, widthPt: 612, heightPt: 792, src: 'ok' },
  ]);
  assert.deepEqual(layout.pages.map((page) => page.pageNumber), [3]);
});
