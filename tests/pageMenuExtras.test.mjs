// Nightly 'page-menu-extras' (Drawboard PDF Pro push 2026-11-12): the page
// right-click gains Select all text, Unlock all and Move page up / down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { availableActions, buildCanvasPageItems, runPageMenuAction } from '../src/sidebar/pageMenuItems.js';
import { lockedMarksOnPage } from '../src/utils/markLock.js';

const rowKeys = (items) => items.filter((i) => !i.separator && !i.header).map((i) => i.key);
const noop = () => {};

test('the extras show only when the host passes their handlers', () => {
  const base = { selectAll: noop, pasteInPlace: noop, setScale: noop };
  assert.deepEqual(rowKeys(buildCanvasPageItems({ available: availableActions(base) })), ['selectAllMarks', 'pasteInPlace', 'setScale']);
  const items = buildCanvasPageItems({ available: availableActions({ ...base, selectText: noop, unlockAll: noop }) });
  assert.deepEqual(rowKeys(items), ['selectAllMarks', 'selectAllText', 'unlockAll', 'pasteInPlace', 'setScale']);
  assert.equal(items.find((i) => i.key === 'unlockAll').disabled, true);
  const locked = buildCanvasPageItems({ available: availableActions({ ...base, selectText: noop, unlockAll: noop }), canUnlockAll: true });
  assert.equal(locked.find((i) => i.key === 'unlockAll').disabled, false);
  // Read-only keeps Select all and Select all text (neither edits).
  const ro = buildCanvasPageItems({ available: availableActions({ ...base, selectText: noop, unlockAll: noop }), readOnly: true });
  assert.deepEqual(rowKeys(ro), ['selectAllMarks', 'selectAllText']);
});

test('the extras dispatch with the page number', () => {
  const calls = [];
  const handlers = { selectText: (p) => calls.push(['text', p]), unlockAll: (p) => calls.push(['unlock', p]), move: (p, d) => calls.push(['move', p, d]) };
  runPageMenuAction('selectAllText', 3, handlers);
  runPageMenuAction('unlockAll', 3, handlers);
  runPageMenuAction('moveDown', 3, handlers);
  runPageMenuAction('moveUp', 3, handlers);
  assert.deepEqual(calls, [['text', 3], ['unlock', 3], ['move', 3, 1], ['move', 3, -1]]);
});

test('lockedMarksOnPage splits marks and callouts', () => {
  const objects = [
    { data: { id: 'a' } },
    { data: { id: 'b', lockedBy: 'u1' } },
    { data: { id: 'c', type: 'callout', lockedBy: 'u1' } },
    { data: { id: 'd', type: 'callout' } },
  ];
  assert.deepEqual(lockedMarksOnPage(objects), { indices: [1], calloutIds: ['c'], any: true });
  assert.deepEqual(lockedMarksOnPage(null), { indices: [], calloutIds: [], any: false });
});

test('the viewer passes the extras only under the flag', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(src, /const \[pageMenuExtrasEnabled\] = useState\(\(\) => isFeatureOn\('page-menu-extras'\)\);/);
  assert.match(src, /\.\.\.\(pageMenuExtrasEnabled \? \{\n\s+move: \(page, offset\) =>/);
  const flags = readFileSync(new URL('../src/featureFlags.js', import.meta.url), 'utf8');
  assert.match(flags, /'page-menu-extras': Object\.freeze\(\{[^}]*stage: 'beta'/);
});
