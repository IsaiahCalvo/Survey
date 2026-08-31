import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBrowserPrintLayout } from '../src/utils/browserPrintLayout.js';

test('browser print keeps one sheet per rendered PDF page with its own size', () => {
  const layout = buildBrowserPrintLayout([
    { pageNumber: 1, widthPt: 612, heightPt: 792, src: 'data:image/png;base64,one' },
    { pageNumber: 2, widthPt: 792, heightPt: 612, src: 'data:image/png;base64,two' },
    { pageNumber: 3, widthPt: 420, heightPt: 595, src: 'data:image/png;base64,three' },
  ]);

  assert.equal(layout.pages.length, 3);
  assert.deepEqual(layout.pages.map((page) => page.pageName), [
    'survey-print-page-1',
    'survey-print-page-2',
    'survey-print-page-3',
  ]);
  assert.match(layout.pageCss, /@page survey-print-page-1 \{ size: 612pt 792pt; margin: 0; \}/);
  assert.match(layout.pageCss, /@page survey-print-page-2 \{ size: 792pt 612pt; margin: 0; \}/);
  assert.match(layout.pageCss, /@page survey-print-page-3 \{ size: 420pt 595pt; margin: 0; \}/);
});

test('browser print drops invalid pages instead of emitting clipped sheets', () => {
  const layout = buildBrowserPrintLayout([
    { pageNumber: 1, widthPt: 0, heightPt: 792, src: 'bad' },
    { pageNumber: 2, widthPt: 612, heightPt: 792, src: '' },
    { pageNumber: 3, widthPt: 612, heightPt: 792, src: 'ok' },
  ]);
  assert.deepEqual(layout.pages.map((page) => page.pageNumber), [3]);
});
