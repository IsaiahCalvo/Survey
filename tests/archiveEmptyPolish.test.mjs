// KAL-652 batch 24: an empty Archive shows only its empty state, and a list
// with no match offers a way back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../src/home/ArchiveScreen.jsx', import.meta.url), 'utf8');

test('an empty Archive drops the column heads, type filter and search', () => {
  assert.match(screen, /const archiveEmpty = !error && !loading && items\.length === 0;/);
  assert.match(screen, /actions=\{archiveEmpty \? null : headerActions\}/);
  assert.match(screen, /\{!archiveEmpty && <div style=\{\{ \.\.\.ledgerHeader,/);
  assert.match(screen, /description="Things you archive wait here for 30 days, so you can restore them\."/);
});

test('no match offers Clear search or Show all types, working on the first press', () => {
  assert.match(screen, /line="No archived items match your search" secondaryLabel="Clear search" onSecondary=\{\(\) => setSearch\(''\)\}/);
  assert.match(screen, /line="No archived items of this type" secondaryLabel="Show all types" onSecondary=\{\(\) => setFilter\('all'\)\}/);
  assert.match(screen, /dismissActionSelector="\.hub-empty-state button"/);
});
