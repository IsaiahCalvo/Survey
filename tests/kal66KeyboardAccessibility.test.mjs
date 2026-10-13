// KAL-66 accessibility pass: the keyboard contracts added in this round.
//   - useMenuFocus: a menu opened from the keyboard takes focus, arrows move,
//     and focus returns to its button when it closes; mouse use is unchanged.
//   - one open-dialog stack for both trap hooks (useFocusTrap underneath a
//     useModalFocusTrap dialog must not pull focus out of the top one).
//   - useModalFocusTrap ignores a menu that is mounted but not on screen
//     (the hub's hidden "Go to" menu made Share ignore Tab and Escape).
//   - keyActivate helpers: Enter/Space act like a click, only on the element.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 30));

function installDom() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout: everything is "on screen" unless it is display:none.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value() { return this.closest('[hidden], [style*="display: none"]') ? [] : [{ width: 10, height: 10 }]; },
  });
  return () => {
    dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'Node', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  };
}

const key = (el, k, init = {}) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const pointer = () => window.dispatchEvent(new window.Event('pointerdown'));

test('useMenuFocus: keyboard-opened menu takes focus, arrows move, focus returns to the button', async () => {
  const restore = installDom();
  const { useMenuFocus } = await import('../src/hooks/useMenuFocus.js');
  function Menu() {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useMenuFocus(ref, open);
    return React.createElement(React.Fragment, null,
      React.createElement('button', { id: 'more', onClick: () => setOpen((v) => !v) }, 'More'),
      open && React.createElement('div', { ref, role: 'menu' },
        React.createElement('button', { id: 'a', role: 'menuitem' }, 'A'),
        React.createElement('button', { id: 'b', role: 'menuitemradio', 'aria-checked': 'true' }, 'B'),
        React.createElement('button', { id: 'c', role: 'menuitem', onClick: () => setOpen(false) }, 'C'),
      ),
      React.createElement('button', { id: 'after' }, 'After'),
    );
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Menu)));
    const more = document.getElementById('more');
    more.focus();
    key(more, 'Enter');
    await act(async () => more.click());
    await act(nextFrame);
    assert.equal(document.activeElement.id, 'b', 'the checked item takes focus');
    await act(async () => key(document.activeElement, 'ArrowDown'));
    assert.equal(document.activeElement.id, 'c');
    await act(async () => key(document.activeElement, 'ArrowDown'));
    assert.equal(document.activeElement.id, 'a', 'wraps to the first item');
    await act(async () => key(document.activeElement, 'End'));
    assert.equal(document.activeElement.id, 'c');
    // Picking an item closes the menu; its button gets focus back.
    key(document.activeElement, 'Enter');
    await act(async () => document.getElementById('c').click());
    await act(nextFrame);
    assert.equal(document.getElementById('a'), null);
    assert.equal(document.activeElement.id, 'more');

    // Mouse: nothing moves.
    pointer();
    document.body.focus();
    more.blur();
    await act(async () => more.click());
    await act(nextFrame);
    assert.notEqual(document.activeElement.id, 'b', 'a mouse open does not move focus');
    pointer();
    await act(async () => document.getElementById('c').click());
    await act(nextFrame);
    assert.notEqual(document.activeElement.id, 'more', 'a mouse close does not move focus');
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test('both trap hooks share one stack: the dialog underneath never takes focus from the top one', async () => {
  const restore = installDom();
  const { useFocusTrap } = await import('../src/hooks/useFocusTrap.js');
  const { default: useModalFocusTrap } = await import('../src/home/useModalFocusTrap.js');
  function Pair() {
    const [outer, setOuter] = useState(false);
    const [inner, setInner] = useState(false);
    const outerRef = useRef(null);
    const innerRef = useRef(null);
    useFocusTrap(outerRef, outer, { onEscape: () => setOuter(false) });
    useModalFocusTrap({ active: inner, containerRef: innerRef, onClose: () => setInner(false) });
    return React.createElement(React.Fragment, null,
      React.createElement('button', { id: 'open-outer', onClick: () => setOuter(true) }, 'Open'),
      outer && React.createElement('div', { ref: outerRef, role: 'dialog', 'aria-modal': 'true', id: 'outer' },
        React.createElement('button', { id: 'invite', onClick: () => setInner(true) }, 'Invite'),
        React.createElement('button', { id: 'outer-close' }, 'Close'),
      ),
      inner && React.createElement('div', { ref: innerRef, role: 'dialog', 'aria-modal': 'true', id: 'inner', tabIndex: -1 },
        React.createElement('button', { id: 'inner-first' }, 'First'),
        React.createElement('button', { id: 'inner-last' }, 'Last'),
      ),
    );
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Pair)));
    const opener = document.getElementById('open-outer');
    opener.focus();
    await act(async () => opener.click());
    await act(nextFrame);
    assert.equal(document.activeElement.id, 'invite');
    await act(async () => document.getElementById('invite').click());
    await act(nextFrame);
    assert.equal(document.activeElement.id, 'inner-first');
    // Tab from the inner dialog's last control wraps inside the inner dialog;
    // the outer (window/capture) trap must not pull it back to itself.
    document.getElementById('inner-last').focus();
    await act(async () => key(document.getElementById('inner-last'), 'Tab'));
    assert.equal(document.activeElement.id, 'inner-first');
    // Escape closes only the inner dialog.
    await act(async () => key(document.activeElement, 'Escape'));
    await act(nextFrame);
    assert.equal(document.getElementById('inner'), null);
    assert.ok(document.getElementById('outer'), 'the outer dialog stays open');
    await act(async () => key(document.activeElement, 'Escape'));
    await act(nextFrame);
    assert.equal(document.getElementById('outer'), null);
    assert.equal(document.activeElement.id, 'open-outer');
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test('useModalFocusTrap ignores a mounted but hidden menu (Share: Tab and Escape work)', async () => {
  const restore = installDom();
  const { default: useModalFocusTrap } = await import('../src/home/useModalFocusTrap.js');
  function Share() {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useModalFocusTrap({ active: open, containerRef: ref, onClose: () => setOpen(false) });
    return React.createElement(React.Fragment, null,
      // The hub's "Go to" menu: always mounted, display:none on desktop.
      React.createElement('div', { role: 'menu', style: { display: 'none' } }, React.createElement('button', null, 'Projects')),
      React.createElement('button', { id: 'share', onClick: () => setOpen(true) }, 'Share'),
      open && React.createElement('div', { ref, role: 'dialog', 'aria-modal': 'true', id: 'dlg', tabIndex: -1 },
        React.createElement('button', { id: 'close' }, 'Close'),
        React.createElement('button', { id: 'cancel' }, 'Cancel'),
      ),
    );
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Share)));
    const share = document.getElementById('share');
    share.focus();
    await act(async () => share.click());
    await act(nextFrame);
    document.getElementById('cancel').focus();
    await act(async () => key(document.getElementById('cancel'), 'Tab'));
    assert.equal(document.activeElement.id, 'close', 'Tab wraps inside the dialog');
    await act(async () => key(document.activeElement, 'Escape'));
    await act(nextFrame);
    assert.equal(document.getElementById('dlg'), null, 'Escape closes it');
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test('keyActivate: Enter and Space act like a click, only on the element itself', async () => {
  const { onActivateKey, clickableProps, checkboxProps } = await import('../src/utils/keyActivate.js');
  let hits = 0;
  const handler = onActivateKey(() => { hits += 1; });
  const self = {};
  const ev = (k, target = self) => ({ key: k, target, currentTarget: self, preventDefault() { this.prevented = true; } });
  const enter = ev('Enter');
  handler(enter);
  handler(ev(' '));
  handler(ev('a'));
  handler(ev('Enter', {}));
  assert.equal(hits, 2);
  assert.equal(enter.prevented, true);
  const props = clickableProps(() => {});
  assert.equal(props.role, 'button');
  assert.equal(props.tabIndex, 0);
  assert.equal(typeof props.onClick, 'function');
  const box = checkboxProps(true, () => {}, 'Select A');
  assert.deepEqual({ role: box.role, checked: box['aria-checked'], label: box['aria-label'], tab: box.tabIndex }, { role: 'checkbox', checked: true, label: 'Select A', tab: 0 });
  assert.equal(box.onClick, undefined, 'the click path stays with the caller');
});
