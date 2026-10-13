import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { activateOnKey, isActivationKey, keyboardControlProps } from '../src/utils/keyboardActivation.js';

// KAL-66: clickable <div>/<span> rows, sort headers, select boxes and menu
// items get keyboardControlProps. Enter and Space must run the same click a
// mouse runs, keys typed into a nested field must stay that field's, and a
// disabled item must not be reachable with Tab.

function setupDom() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

const press = (el, key) => {
  const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
};

test('isActivationKey accepts Enter and Space only', () => {
  assert.equal(isActivationKey({ key: 'Enter' }), true);
  assert.equal(isActivationKey({ key: ' ' }), true);
  assert.equal(isActivationKey({ key: 'Spacebar' }), true);
  assert.equal(isActivationKey({ key: 'Tab' }), false);
  assert.equal(isActivationKey({ key: 'a' }), false);
  assert.equal(isActivationKey(null), false);
});

test('props: role, Tab stop, marker, aria-checked, disabled', () => {
  const plain = keyboardControlProps();
  assert.equal(plain.role, 'button');
  assert.equal(plain.tabIndex, 0);
  assert.equal(typeof plain.onKeyDown, 'function');
  assert.equal(plain['data-keyboard-control'], '');
  assert.equal('aria-checked' in plain, false);

  const box = keyboardControlProps(null, { role: 'checkbox', checked: 1 });
  assert.equal(box.role, 'checkbox');
  assert.equal(box['aria-checked'], true);
  assert.equal(keyboardControlProps(null, { role: 'radio', checked: false })['aria-checked'], false);

  const off = keyboardControlProps(null, { role: 'menuitem', disabled: true });
  assert.equal(off.tabIndex, -1);
  assert.equal(off.onKeyDown, undefined);
  assert.equal(off['aria-disabled'], 'true');
});

test('activateOnKey runs a given handler and prevents Space scrolling', () => {
  const calls = [];
  const handler = activateOnKey((e) => calls.push(e.key));
  const el = {};
  const make = (key) => ({ key, target: el, currentTarget: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  const space = make(' ');
  handler(space);
  handler(make('Enter'));
  handler(make('x'));
  assert.deepEqual(calls, [' ', 'Enter']);
  assert.equal(space.defaultPrevented, true);
});

test('enterOnly leaves Space to the viewer (hold Space to pan)', () => {
  const calls = [];
  const el = {};
  const make = (key) => ({ key, target: el, currentTarget: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  const { onKeyDown } = keyboardControlProps(() => calls.push('go'), { enterOnly: true });
  const space = make(' ');
  onKeyDown(space);
  assert.deepEqual(calls, []);
  assert.equal(space.defaultPrevented, false, 'Space is not swallowed');
  onKeyDown(make('Enter'));
  assert.deepEqual(calls, ['go']);
});

test('mounted: Enter and Space click the element; nested field keys do not', async () => {
  setupDom();
  const clicks = [];
  const boxClicks = [];
  function Row() {
    return React.createElement('div', { id: 'row', onClick: () => clicks.push('row'), ...keyboardControlProps() },
      React.createElement('input', { id: 'name', defaultValue: 'Tower A' }),
      React.createElement('span', {
        id: 'box',
        onClick: (e) => { e.stopPropagation(); boxClicks.push('box'); },
        ...keyboardControlProps(null, { role: 'checkbox', checked: false }),
      }),
    );
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Row)));
    const row = document.getElementById('row');
    assert.equal(row.getAttribute('role'), 'button');
    assert.equal(row.tabIndex, 0);

    await act(async () => press(row, 'Enter'));
    await act(async () => press(row, ' '));
    assert.deepEqual(clicks, ['row', 'row'], 'Enter and Space each click the row once');

    await act(async () => press(document.getElementById('name'), 'Enter'));
    await act(async () => press(document.getElementById('name'), ' '));
    assert.deepEqual(clicks, ['row', 'row'], 'typing in the rename field never opens the row');

    const box = document.getElementById('box');
    assert.equal(box.getAttribute('aria-checked'), 'false');
    await act(async () => press(box, ' '));
    assert.deepEqual(boxClicks, ['box'], 'Space toggles the select box');
    assert.deepEqual(clicks, ['row', 'row'], 'and does not also activate the row behind it');

    await act(async () => press(row, 'ArrowDown'));
    assert.deepEqual(clicks, ['row', 'row'], 'other keys pass through');
  } finally {
    await act(async () => root.unmount());
  }
});
