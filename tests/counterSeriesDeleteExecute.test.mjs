import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { renumberCounters } from '../src/utils/counterNumbering.js';

// Source contracts for counter-series Delete execute.
// Live proof is debug/scenarios/e2e-counter-series-delete.spec.mjs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('renumberCounters fills gaps after deleting first / middle / last of a 3-pin series', () => {
  const pin = (id, n, createdAt) => ({
    type: 'circle',
    id,
    data: {
      type: 'counter',
      seriesId: 'series-a',
      seriesStart: 1,
      displayNumber: n,
      createdAt,
    },
  });

  const afterFirst = {
    1: { objects: [pin('b', 2, 2), pin('c', 3, 3)] },
  };
  renumberCounters(afterFirst);
  assert.deepEqual(
    afterFirst[1].objects.map((obj) => obj.data.displayNumber),
    [1, 2],
    'delete first: remaining 2,3 become 1,2',
  );

  const afterMiddle = {
    1: { objects: [pin('a', 1, 1), pin('c', 3, 3)] },
  };
  renumberCounters(afterMiddle);
  assert.deepEqual(
    afterMiddle[1].objects.map((obj) => obj.data.displayNumber),
    [1, 2],
    'delete middle: remaining 1,3 become 1,2',
  );

  const afterLast = {
    1: { objects: [pin('a', 1, 1), pin('b', 2, 2)] },
  };
  renumberCounters(afterLast);
  assert.deepEqual(
    afterLast[1].objects.map((obj) => obj.data.displayNumber),
    [1, 2],
    'delete last: remaining stay 1,2',
  );
});

test('pin context menu is Continue pin only; series menu Delete is whole-series + confirm', () => {
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(menu, /ctx\.kind === 'counter'/);
  assert.match(menu, /item\('Continue pin', 'continuePin'/);
  const counterBlock = menu.slice(
    menu.indexOf("ctx.kind === 'counter'"),
    menu.indexOf("ctx.kind === 'annotation'"),
  );
  assert.match(counterBlock, /Continue pin/);
  assert.doesNotMatch(counterBlock, /item\('Delete'/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /data-counter-series-context-menu/);
  assert.match(shell, /bottomToolbarApi\.onDeleteCounterSeries\?\.\(seriesId\)/);
  assert.match(shell, />\s*Delete\s*</);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /onDeleteCounterSeries: handleDeleteCounterSeriesFromToolbar/);
  assert.match(viewer, /mode: 'counter-series'/);
  assert.match(viewer, /buildCounterSeriesDeletionUpdates\(liveByPage, seriesId\)/);

  const modal = read('src/components/collab/ConfirmDeleteModal.jsx');
  assert.match(modal, /Delete \$\{plan\.seriesLabel \|\| 'this count'\}/);
  assert.match(modal, /Delete count/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /data-counter-series-delete/);
  assert.match(mobile, /aria-label=\{`Delete \$\{series\.label\}`\}/);
  assert.match(mobile, /api\.onDeleteCounterSeries\(series\.seriesId\)/);
  assert.match(mobile, /This count could not be deleted/);
});
