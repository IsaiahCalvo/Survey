// Owner 2026-10-26: the stray "white border" on buttons is the focus ring
// Chrome lights on a clicked button once any key is pressed. Rings show only
// while the keyboard is moving focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { focusSourceFromKey, installFocusRingSource, resetFocusRingSourceForTests } from '../src/utils/focusRingSource.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Tab is the keyboard; arrows only when they move focus; shortcuts say nothing', () => {
  assert.equal(focusSourceFromKey({ key: 'Tab' }), 'keyboard');
  assert.equal(focusSourceFromKey({ key: 'Tab', shiftKey: true }), 'keyboard');
  assert.equal(focusSourceFromKey({ key: 'ArrowDown' }), 'maybe-keyboard');
  for (const key of ['v', 'Delete', 'Escape', 'Enter', ' ', 'z']) assert.equal(focusSourceFromKey({ key }), null, key);
  assert.equal(focusSourceFromKey({ key: 'z', ctrlKey: true }), null);
  assert.equal(focusSourceFromKey({ key: 'Tab', ctrlKey: true }), null, 'Ctrl+Tab switches tabs, not focus');
});

function fakeWindow() {
  const handlers = {};
  const attrs = {};
  const timers = [];
  const doc = {
    activeElement: 'canvas',
    documentElement: { getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; } },
  };
  return {
    attrs, doc, timers,
    document: doc,
    addEventListener: (type, fn) => { handlers[type] = fn; },
    setTimeout: (fn) => { timers.push(fn); },
    fire: (type, event = {}) => handlers[type](event),
    flush: () => { while (timers.length) timers.shift()(); },
  };
}

test('a press turns rings off; a shortcut keeps them off; Tab turns them on', () => {
  resetFocusRingSourceForTests();
  const win = fakeWindow();
  installFocusRingSource(win);
  win.fire('pointerdown');
  assert.equal(win.attrs['data-focus-ring'], 'pointer');
  win.fire('keydown', { key: 'Delete' });
  win.flush();
  assert.equal(win.attrs['data-focus-ring'], 'pointer');
  // An arrow that pans the page (focus stays put) is not keyboard navigation.
  win.fire('keydown', { key: 'ArrowRight' });
  win.flush();
  assert.equal(win.attrs['data-focus-ring'], 'pointer');
  // An arrow that walks a menu moves focus: rings on.
  win.fire('keydown', { key: 'ArrowDown' });
  win.doc.activeElement = 'menu-row-2';
  win.flush();
  assert.equal(win.attrs['data-focus-ring'], 'keyboard');
  win.fire('pointerdown');
  win.fire('keydown', { key: 'Tab' });
  assert.equal(win.attrs['data-focus-ring'], 'keyboard');
});

test('the stylesheet hides rings in pointer mode, never on text fields, and the app installs it', () => {
  const states = read('src/styles/states.css');
  assert.match(states, /html\[data-focus-ring='pointer'\] :focus-visible:not\(textarea, select, \[contenteditable\], \[contenteditable\] \*, input:not\(/);
  assert.match(states, /\{\s*outline: none !important;\s*\}/);
  assert.match(read('src/main.jsx'), /installFocusRingSource\(window\)/);
});
