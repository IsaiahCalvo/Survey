import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBrowserPrintLayout } from '../src/utils/browserPrintLayout.js';

test('browser print keeps one sheet per rendered PDF page and names each landscape sheet', () => {
  const layout = buildBrowserPrintLayout([
    { pageNumber: 1, widthPt: 612, heightPt: 792, src: 'data:image/png;base64,one' },
    { pageNumber: 2, widthPt: 792, heightPt: 612, src: 'data:image/png;base64,two' },
    { pageNumber: 3, widthPt: 420, heightPt: 595, src: 'data:image/png;base64,three' },
  ]);

  assert.equal(layout.pages.length, 3);
  assert.match(layout.pageCss, /@page \{ size: auto; margin: 0; \}/);
  assert.match(layout.pageCss, /@page landscape-2 \{ size: landscape; margin: 0; \}/);
  assert.equal(layout.pages[0].pageName, null);
  assert.equal(layout.pages[1].pageName, 'landscape-2');
  assert.equal(layout.pages[2].pageName, null);
});

test('browser print drops invalid pages instead of emitting clipped sheets', () => {
  const layout = buildBrowserPrintLayout([
    { pageNumber: 1, widthPt: 0, heightPt: 792, src: 'bad' },
    { pageNumber: 2, widthPt: 612, heightPt: 792, src: '' },
    { pageNumber: 3, widthPt: 612, heightPt: 792, src: 'ok' },
  ]);
  assert.deepEqual(layout.pages.map((page) => page.pageNumber), [3]);
});
