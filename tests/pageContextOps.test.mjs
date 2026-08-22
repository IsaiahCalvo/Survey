import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cssForPageTransform,
  resetPageTransform,
  resolvePagePaste,
  togglePageMirror,
} from '../src/utils/pageContextOps.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Mirror V toggles scaleY; Reset deletes the page transform', () => {
  const afterV = togglePageMirror({}, 2, 'vertical');
  assert.equal(afterV[2].mirrorV, true);
  assert.equal(afterV[2].mirrorH, false);
  assert.equal(cssForPageTransform(afterV[2]), 'scaleY(-1)');

  const afterAgain = togglePageMirror(afterV, 2, 'vertical');
  assert.equal(afterAgain[2].mirrorV, false);
  assert.equal(cssForPageTransform(afterAgain[2]), 'none');

  const reset = resetPageTransform(togglePageMirror({}, 1, 'vertical'), 1);
  assert.equal(reset[1], undefined);
  assert.equal(cssForPageTransform(reset[1]), 'none');
});

test('Page paste: copy inserts after target; cut same-page clears clipboard', () => {
  assert.deepEqual(
    resolvePagePaste({ sourcePageNumber: 1, targetPageNumber: 3, pasteType: 'copy' }),
    {
      kind: 'mutate',
      operation: { type: 'copy', source: 1, afterPage: 3 },
      clearClipboard: false,
    },
  );
  assert.deepEqual(
    resolvePagePaste({ sourcePageNumber: 2, targetPageNumber: 2, pasteType: 'cut' }),
    { kind: 'clear-clipboard' },
  );
  assert.deepEqual(
    resolvePagePaste({ sourcePageNumber: 1, targetPageNumber: 3, pasteType: 'cut' }),
    {
      kind: 'mutate',
      operation: { type: 'move', from: 1, to: 3 },
      clearClipboard: true,
    },
  );
  assert.deepEqual(
    resolvePagePaste({ sourcePageNumber: 4, targetPageNumber: 1, pasteType: 'cut' }),
    {
      kind: 'mutate',
      operation: { type: 'move', from: 4, to: 2 },
      clearClipboard: true,
    },
  );
  assert.deepEqual(resolvePagePaste({ targetPageNumber: 1, pasteType: 'copy' }), { kind: 'ignore' });
  assert.deepEqual(resolvePagePaste({ sourcePageNumber: 1, targetPageNumber: 2 }), { kind: 'ignore' });
});

test('PagesPanel + usePageOperations wire Mirror V / Reset / Cut / Copy / Paste; Extract is absent', () => {
  const panel = read('src/sidebar/PagesPanel.jsx');
  assert.match(panel, /Mirror vertically/);
  assert.match(panel, /handleMirrorVertical/);
  assert.match(panel, /onMirrorPage\(pageNumber, 'vertical'\)/);
  assert.match(panel, />\s*Reset\s*</);
  assert.match(panel, /handleReset/);
  assert.match(panel, /handleCut/);
  assert.match(panel, /handleCopy/);
  assert.match(panel, /handlePaste/);
  assert.doesNotMatch(panel, /Extract/);

  const hook = read('src/hooks/usePageOperations.js');
  assert.match(hook, /togglePageMirror/);
  assert.match(hook, /resetPageTransform/);
  assert.match(hook, /resolvePagePaste/);
  assert.match(hook, /setClipboardType\('cut'\)/);
  assert.match(hook, /setClipboardType\('copy'\)/);
});
