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

test('Keyboard shortcuts sheet: key fields share one class with hover and pressed looks and the UI font', () => {
  const jsx = read('src/components/KeyboardShortcutsOverlay.jsx');
  const css = read('src/components/KeyboardShortcutsOverlay.css');
  assert.match(jsx, /import '\.\/KeyboardShortcutsOverlay\.css';/);
  assert.match(jsx, /className="shortcut-key-field"/);
  assert.doesNotMatch(jsx, /width: '132px'/, 'the field is styled by its class, not inline');
  // Keys the app owns sit in the same slot, in the same type, not bare monospace words.
  assert.match(jsx, /<kbd className="shortcut-key-fixed">\{keys\.join\(' \+ '\)\}<\/kbd>/);
  assert.match(jsx, /className="hub-btn hub-btn--tertiary" aria-label=\{`Reset shortcut/);
  assert.match(css, /font-family: var\(--font-ui\);/);
  assert.match(css, /\.shortcut-key-field:hover:not\(:focus\):not\(:active\) \{ background: var\(--hover\); \}/);
  assert.match(css, /\.shortcut-key-field:active \{ background: var\(--pressed\); \}/);
});
