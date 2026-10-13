import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPEN_KEYBOARD_SHORTCUTS_EVENT,
  openKeyboardShortcuts,
  shouldToggleShortcutsSheet,
} from '../src/utils/keyboardShortcutsSheet.js';

// KAL-444: the shortcuts sheet opens inside a document, by "?" and by a
// visible button, and a "?" typed into a text field stays text.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const key = (over = {}) => ({ key: '?', shiftKey: true, target: { tagName: 'DIV' }, ...over });

test('a plain "?" on the page toggles the sheet', () => {
  assert.equal(shouldToggleShortcutsSheet(key(), { tagName: 'BODY' }), true);
  assert.equal(shouldToggleShortcutsSheet(key(), null), true);
});

test('a "?" typed into a text field never opens the sheet', () => {
  const fields = [
    { tagName: 'INPUT', type: 'text' }, // rename, Survey panel fields
    { tagName: 'INPUT', type: 'search' }, // search box
    { tagName: 'INPUT', type: '' }, // <input> with no type is text
    { tagName: 'TEXTAREA' }, // Fabric's hidden textarea, notes
    { tagName: 'DIV', isContentEditable: true }, // text box / callout editor
  ];
  for (const field of fields) {
    assert.equal(shouldToggleShortcutsSheet(key({ target: field }), null), false, `target ${JSON.stringify(field)}`);
    assert.equal(shouldToggleShortcutsSheet(key(), field), false, `focus ${JSON.stringify(field)}`);
  }
});

test('focus on a button or checkbox does not block the sheet', () => {
  assert.equal(shouldToggleShortcutsSheet(key(), { tagName: 'BUTTON' }), true);
  assert.equal(shouldToggleShortcutsSheet(key(), { tagName: 'INPUT', type: 'checkbox' }), true);
});

test('other keys, chords and IME composition do not toggle it', () => {
  assert.equal(shouldToggleShortcutsSheet(key({ key: '/' }), null), false);
  assert.equal(shouldToggleShortcutsSheet(key({ ctrlKey: true }), null), false);
  assert.equal(shouldToggleShortcutsSheet(key({ metaKey: true }), null), false);
  assert.equal(shouldToggleShortcutsSheet(key({ altKey: true }), null), false);
  assert.equal(shouldToggleShortcutsSheet(key({ isComposing: true }), null), false);
  assert.equal(shouldToggleShortcutsSheet(null, null), false);
});

test('the open helper sends the event the sheet listens for', () => {
  const sent = [];
  class FakeEvent { constructor(type) { this.type = type; } }
  openKeyboardShortcuts({ CustomEvent: FakeEvent, dispatchEvent: (e) => sent.push(e.type) });
  assert.deepEqual(sent, [OPEN_KEYBOARD_SHORTCUTS_EVENT]);
  assert.doesNotThrow(() => openKeyboardShortcuts(null));
});

test('the sheet uses the guarded handler, not the bare "?" listener', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.doesNotMatch(overlay, /useKeyPress\(\s*'\?'/);
  assert.match(overlay, /shouldToggleShortcutsSheet\(/);
  assert.match(overlay, /OPEN_KEYBOARD_SHORTCUTS_EVENT/);
});

test('the app mounts the sheet in the viewer too, not only on Home', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /<KeyboardShortcutsOverlay \/>/);
  assert.doesNotMatch(shell, /!isViewerVisible && <KeyboardShortcutsOverlay/);
});

test('the viewer rail has a visible Keyboard shortcuts button', () => {
  const rail = read('src/PDFSidebar.jsx');
  assert.match(rail, /aria-label="Keyboard shortcuts"/);
  assert.match(rail, /onClick=\{\(\) => openKeyboardShortcuts\(\)\}/);
});
