// KAL-652 batch 34: the current sheet in the Sheets grid wears the same 2px
// accent frame as the current page in the Pages panel, not a heavy dark one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/sheets/sheetSet.css', import.meta.url), 'utf8');

test('the current sheet card has an accent frame and the selected fill on its name', () => {
  assert.match(css, /\.sheet-set-card\.is-current \{ border-color: var\(--accent\); box-shadow: 0 0 0 1px var\(--accent\);/);
  assert.match(css, /\.sheet-set-card\.is-current \.sheet-set-card__label \{ background: var\(--surface-3\); font-weight: 600; \}/);
  assert.doesNotMatch(css, /\.sheet-set-card\.is-current[^{]*\{[^}]*var\(--text-2\)/);
});
