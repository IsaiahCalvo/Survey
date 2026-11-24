// Documents: Shared by me / Shared with me / tag / search empty lists
// (KAL-652, batch 17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/home/DocumentsLedger.jsx', import.meta.url), 'utf8');

test('an empty list is a full empty state with a way out, not a grey line', () => {
  assert.ok(!src.includes('filteredEmpty'), 'the one-line notice is gone');
  assert.equal((src.match(/<EmptyState \{\.\.\.emptyNotice\} \/>/g) || []).length, 2, 'desktop and phone');
  assert.match(src, /line: 'Nothing shared yet'/);
  assert.match(src, /line: 'Nothing shared with you yet'/);
  assert.match(src, /secondaryLabel: 'Show all files', onSecondary: \(\) => pickHomeView\('all'\)/);
  assert.match(src, /secondaryLabel: 'Clear search', onSecondary: \(\) => setSearch\(''\)/);
  assert.match(src, /secondaryLabel: 'Clear filters'/);
});

test('a view with nothing in it drops the chips and column heads it cannot use', () => {
  assert.match(src, /const viewIsEmpty = sharedViewsOn && homeView !== 'all' && viewCounts\[homeView\] === 0;/);
  assert.match(src, /reviewOn && mapped\.length > 0 && !viewIsEmpty && \(\s*<ReviewChips/);
  assert.match(src, /registerOn && mapped\.length > 0 && !viewIsEmpty && \(\s*<RegisterChips/);
  assert.match(src, /\{!viewIsEmpty && <div className=\{gridClass\}/);
});
