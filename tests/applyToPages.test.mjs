// KAL-720 (Nightly 'apply-to-pages'): Drawboard's Apply to Pages on the mark
// menu. A copy of the picked marks lands at the same spot on all pages or
// the pages typed; the page they came from is skipped; Survey Markers and
// text highlights stay on their page; every page lands in one undo step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { applyToPagesClipboard, applyToPagesTargets, applyToPagesToast } from '../src/utils/applyToPages.js';
import { buildFamilyClipboard, planFamilyPaste } from '../src/utils/familyClipboard.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('targets: all pages but the one the marks are on', () => {
  assert.deepEqual(applyToPagesTargets({ mode: 'all', pageCount: 5, sourcePage: 2 }), { pages: [1, 3, 4, 5], error: null });
  assert.equal(applyToPagesTargets({ mode: 'all', pageCount: 1, sourcePage: 1 }).error, 'This PDF has one page.');
});

test('targets: typed pages, sorted, once each, without the source page', () => {
  assert.deepEqual(applyToPagesTargets({ mode: 'pages', text: '8, 2-4, 3', pageCount: 10, sourcePage: 3 }).pages, [2, 4, 8]);
  assert.deepEqual(applyToPagesTargets({ mode: 'pages', text: '7-', pageCount: 9, sourcePage: 1 }).pages, [7, 8, 9]);
  assert.equal(applyToPagesTargets({ mode: 'pages', text: '3', pageCount: 10, sourcePage: 3 }).error, 'Name at least one page other than this one.');
  assert.equal(applyToPagesTargets({ mode: 'pages', text: '12', pageCount: 10, sourcePage: 1 }).error, 'This PDF has 10 pages.');
  assert.equal(applyToPagesTargets({ mode: 'pages', text: 'abc', pageCount: 10, sourcePage: 1 }).error, '"abc" is not a page or a range.');
  assert.equal(applyToPagesTargets({ mode: 'pages', text: '', pageCount: 10, sourcePage: 1 }).error, 'Type at least one page.');
});

test('clipboard: marks and callouts go; highlights and Survey Markers stay', () => {
  const clipboard = {
    items: [
      { kind: 'mark', object: { type: 'rect', data: { id: 'a' } } },
      { kind: 'mark', object: { type: 'rect', data: { id: 'b', type: 'text-markup' } } },
      { kind: 'callout', callout: { id: 'c' } },
      { kind: 'marker', entry: { bounds: {} } },
    ],
    extent: { left: 0, top: 0, width: 10, height: 10 },
  };
  const kept = applyToPagesClipboard(clipboard);
  assert.deepEqual(kept.items.map((item) => item.kind), ['mark', 'callout']);
  assert.equal(kept.extent, clipboard.extent);
  assert.equal(applyToPagesClipboard({ items: [clipboard.items[1], clipboard.items[3]] }), null);
  assert.equal(applyToPagesClipboard(null), null);
  assert.equal(applyToPagesToast(1), 'Put on 1 page');
  assert.equal(applyToPagesToast(12), 'Put on 12 pages');
});

test('a copy lands at the same spot with a new id on each page', () => {
  const rect = { type: 'rect', left: 40, top: 60, width: 100, height: 50, stroke: '#ff0000', data: { id: 'r1' } };
  const clipboard = applyToPagesClipboard(buildFamilyClipboard({ pageNumber: 1, objects: [rect], indices: [0] }));
  let n = 0;
  const ids = [2, 3].map((pageNumber) => {
    const plan = planFamilyPaste(clipboard, { objects: [], dx: 0, dy: 0, pageNumber, newId: () => `id-${(n += 1)}` });
    assert.equal(plan.objects.length, 1);
    assert.equal(plan.objects[0].left, 40);
    assert.equal(plan.objects[0].top, 60);
    return plan.newMarkIds[0];
  });
  assert.notEqual(ids[0], ids[1]);
  assert.ok(!ids.includes('r1'));
});

test('wiring: Nightly flag, menu row, one document transaction', () => {
  assert.equal(FEATURE_FLAGS['apply-to-pages']?.stage, 'beta');
  const menu = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  assert.match(menu, /item\('Apply to pages…', 'applyToPages'/);
  for (const sel of ['\\{ calloutIds: \\[ctx\\.calloutId\\] \\}', '\\{ indices: \\[ctx\\.annotationIndex\\] \\}', 'familySelection']) {
    assert.match(menu, new RegExp(`\\.\\.\\.applyPagesItems\\(${sel}\\)`));
  }
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /requestApplyToPages: applyToPagesOn && numPages > 1 \? requestApplyToPages : null/);
  assert.match(viewer, /action: 'apply-to-pages', applyWithoutOwnedStep: true/);
  assert.match(viewer, /<ApplyToPagesDialog/);
  const dialog = readFileSync(new URL('../src/components/ApplyToPagesDialog.jsx', import.meta.url), 'utf8');
  assert.match(dialog, /import DialogCard, \{ DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE \} from '\.\/DialogCard\.jsx';/);
});
