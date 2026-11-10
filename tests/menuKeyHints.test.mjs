import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MENU_KEY_CHORDS, menuKeyHint } from '../src/utils/menuKeyHints.js';
import { documentedChords } from '../src/utils/keyboardShortcuts.js';

test('menu keys print like the shortcuts sheet', () => {
  assert.equal(menuKeyHint('cut'), 'Ctrl+X');
  assert.equal(menuKeyHint('bringToFront'), 'Ctrl+Shift+]');
  assert.equal(menuKeyHint('delete'), 'Delete');
  assert.equal(menuKeyHint('copy', { isMac: true }), '⌘+C');
  assert.equal(menuKeyHint('lock'), null);
});

test('a rebound key shows the new key', () => {
  assert.equal(menuKeyHint('duplicate', { binding: (c) => (c === 'mod+d' ? 'mod+shift+d' : c) }), 'Ctrl+Shift+D');
});

test('every menu key is a key the sheet documents', () => {
  const sheet = new Set(documentedChords());
  for (const [key, chord] of Object.entries(MENU_KEY_CHORDS)) assert.ok(sheet.has(chord), `${key}: ${chord}`);
});

test('the mark menu prints the key on rows and in the icon hints', () => {
  const src = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  assert.match(src, /isFeatureOn\('menu-keys'\)/);
  assert.match(src, /\{keyCap\(sub\.key\)\}/);
  assert.match(src, /tipFor\(it\.label, it\.key\)/);
});
