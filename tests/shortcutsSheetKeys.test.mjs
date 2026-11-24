// Keyboard shortcuts sheet: keys, not a long form (KAL-652, batch 25).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/components/KeyboardShortcutsOverlay.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/KeyboardShortcutsOverlay.css', import.meta.url), 'utf8');

test('the sheet wears the panel fill every dialog card wears', () => {
  assert.match(jsx, /background: 'var\(--surface-2\)',\s*borderRadius: BORDERS\.radius\.dialog/);
  assert.doesNotMatch(jsx, /background: COLORS\.background\.secondary/);
});

test('a key is as wide as its keys, on the field grey, with a quiet edge', () => {
  assert.match(css, /width: auto;\s*min-width: 44px;/);
  assert.doesNotMatch(css, /width: 132px/);
  assert.match(css, /\.shortcut-key-field \{[^}]*border: 1px solid var\(--border\);[^}]*background: var\(--hover\);/);
  assert.match(jsx, /size=\{Math\.max\(3, /, 'sized to its keys where field-sizing is missing');
});

test('listening shows a 2px accent edge, and a press still shows over it', () => {
  assert.match(css, /\.shortcut-key-field:focus:not\(:active\) \{ border-color: var\(--accent\); box-shadow: 0 0 0 1px var\(--accent\);/);
});

test('plain words: rows read as body text, and the hint says what to do', () => {
  assert.match(jsx, /To change a shortcut, click it, then press the new keys\./);
  assert.match(jsx, /className="shortcut-row-label"\s*style=\{\{\s*fontSize: TYPOGRAPHY\.fontSize\.md,\s*color: 'var\(--text-2\)',/);
});
