// Bundle 1 break test (2026-11-10): a labelled measurement listed in the
// Markups panel as `17' 0" Room 101 · 17' 0"`: the row put the reading in
// bold in front of a caption that already held it. A caption with the
// reading reads as it is; the bold reading only leads when the row's words
// lack it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/sidebar/MarkupsPanel.jsx', import.meta.url), 'utf8');

test('a measurement row shows its reading once', () => {
  assert.match(src, /row\.measure\?\.text && !String\(row\.text \|\| ''\)\.includes\(row\.measure\.text\)/);
  assert.doesNotMatch(src, /row\.measure && row\.text !== row\.measure\.text/);
});
