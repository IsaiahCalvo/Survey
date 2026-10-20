import test from 'node:test';
import assert from 'node:assert/strict';

test('custom shortcut saves only a valid unused chord; reset restores the default', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
  try {
    const { assignShortcut, shortcutBinding, resetShortcut, eventChord } = await import('../src/utils/customKeyboardShortcuts.js?unit');
    assert.equal(assignShortcut('a', 'p').includes('already used'), true);
    assert.equal(assignShortcut('a', 'mod+w').includes('browser'), true);
    assert.equal(assignShortcut('a', 'b'), null);
    assert.equal(shortcutBinding('a'), 'b');
    assert.deepEqual(JSON.parse(values.get('survey:keyboard-shortcuts')), { a: 'b' });
    assert.equal(eventChord({ key: 'B', altKey: true, shiftKey: true }), 'alt+shift+b');
    assert.equal(eventChord({ key: 'Shift', shiftKey: true }), null);
    resetShortcut('a');
    assert.equal(shortcutBinding('a'), 'a');
    assert.deepEqual(JSON.parse(values.get('survey:keyboard-shortcuts')), {});
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
