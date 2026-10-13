// KAL-84: the axis-lock modifiers and the tab-strip move live in src/reorder/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { restrictToHorizontalAxis, restrictToVerticalAxis } from '../../src/reorder/axisLock.js';
import { moveItem } from '../../src/reorder/flatReorderUtils.js';

const transform = { x: 37, y: -12, scaleX: 1.05, scaleY: 0.98 };

test('restrictToHorizontalAxis pins y to 0 and keeps everything else', () => {
  assert.deepEqual(restrictToHorizontalAxis({ transform }), { x: 37, y: 0, scaleX: 1.05, scaleY: 0.98 });
});

test('restrictToVerticalAxis pins x to 0 and keeps everything else', () => {
  assert.deepEqual(restrictToVerticalAxis({ transform }), { x: 0, y: -12, scaleX: 1.05, scaleY: 0.98 });
});

test('the modifiers do not change the transform they were given', () => {
  const input = { ...transform };
  restrictToHorizontalAxis({ transform: input });
  restrictToVerticalAxis({ transform: input });
  assert.deepEqual(input, transform);
});

test('moveItem matches what the tab strip did with its own copy (same array back on a no-op)', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(moveItem(tabs, 2, 0).map((t) => t.id), ['c', 'a', 'b']);
  assert.deepEqual(moveItem(tabs, 0, 1).map((t) => t.id), ['b', 'a', 'c']);
  // TabBar returns early on `reordered === pdfTabs`, so these must be identity.
  assert.equal(moveItem(tabs, 1, 1), tabs);
  assert.equal(moveItem(tabs, -1, 1), tabs);
  assert.equal(moveItem(tabs, 0, 3), tabs);
});

test('no surface keeps its own copy of the helpers', () => {
  const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const files = ['src/TabBar.jsx', 'src/home/TemplatesEditor.jsx', 'src/sidebar/PagesPanel.jsx', 'src/reorder/SortableRearrangeList.jsx'];
  for (const file of files) {
    const src = read(file);
    assert.doesNotMatch(src, /const\s+restrict\w*Axis\s*=/, `${file} defines its own axis lock`);
    assert.doesNotMatch(src, /const\s+moveArrayItem\s*=/, `${file} defines its own move helper`);
    assert.match(src, /from '\.{1,2}\/(reorder\/)?axisLock\.js'/, `${file} should import the shared axis lock`);
  }
  assert.match(read('src/TabBar.jsx'), /import \{ moveItem \} from '\.\/reorder\/flatReorderUtils\.js'/);
});
