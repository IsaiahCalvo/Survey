// KAL-652 polish, batch 4 (2026-11-17): faults found by looking at each screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Share dialog field names are labels, not text a drag selects', () => {
  assert.match(read('src/home/ShareModal.jsx'), /const fieldLabel = \{[^}]*userSelect: 'none'/);
});

test('Archive header lines up with the other hub pages: its search field gives the row baseline', () => {
  const css = read('src/home/hub.css');
  assert.match(css, /\.survey-hub \.archive-desktop-search > \.hub-search \{\s*align-self: baseline;/);
});
