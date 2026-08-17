import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import useModalFocusTrap from '../src/home/useModalFocusTrap.js';

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 24));

function Harness() {
  const [open, setOpen] = useState(false);
  const modalRef = useRef(null);
  const closeRef = useRef(null);
  useModalFocusTrap({ active: open, containerRef: modalRef, initialFocusRef: closeRef, onClose: () => setOpen(false) });
  return React.createElement(React.Fragment, null,
    React.createElement('button', { type: 'button', id: 'opener', onClick: () => setOpen(true) }, 'Open'),
    open && React.createElement('div', { ref: modalRef, role: 'dialog', tabIndex: -1 },
      React.createElement('button', { type: 'button', ref: closeRef, id: 'close', onClick: () => setOpen(false) }, 'Close'),
      React.createElement('button', { type: 'button', id: 'last' }, 'Last'),
    ),
    React.createElement('button', { type: 'button', id: 'outside' }, 'Outside'),
  );
}

function NestedHarness() {
  const [outerOpen, setOuterOpen] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);
  const outerRef = useRef(null);
  const outerCloseRef = useRef(null);
  const innerRef = useRef(null);
  const innerCloseRef = useRef(null);
  const innerOpenerRef = useRef(null);
  useModalFocusTrap({ active: outerOpen, containerRef: outerRef, initialFocusRef: outerCloseRef, onClose: () => setOuterOpen(false) });
  useModalFocusTrap({ active: innerOpen, containerRef: innerRef, initialFocusRef: innerCloseRef, returnFocusRef: innerOpenerRef, onClose: () => setInnerOpen(false) });
  return React.createElement(React.Fragment, null,
    React.createElement('button', { type: 'button', id: 'outer-opener', onClick: () => setOuterOpen(true) }, 'Open outer'),
    outerOpen && React.createElement('div', { ref: outerRef, role: 'dialog', 'aria-modal': 'true', id: 'outer-dialog', tabIndex: -1 },
      React.createElement('button', { type: 'button', ref: outerCloseRef, id: 'outer-close', onClick: () => setOuterOpen(false) }, 'Close outer'),
      React.createElement('button', { type: 'button', ref: innerOpenerRef, id: 'inner-opener', onClick: () => setInnerOpen(true) }, 'Open inner'),
    ),
    innerOpen && React.createElement('div', { ref: innerRef, role: 'dialog', 'aria-modal': 'true', id: 'inner-dialog', tabIndex: -1 },
      React.createElement('button', { type: 'button', ref: innerCloseRef, id: 'inner-close', onClick: () => setInnerOpen(false) }, 'Close inner'),
      React.createElement('button', { type: 'button', id: 'inner-last' }, 'Inner last'),
    ),
  );
}

test('modal trap focuses Close, cycles Tab, closes on Escape, and restores opener', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', { configurable: true, value() { return [{ width: 10, height: 10 }]; } });

  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Harness)));
    const opener = document.getElementById('opener');
    opener.focus();
    await act(async () => opener.click());
    await act(nextFrame);
    assert.equal(document.activeElement.id, 'close');

    document.getElementById('outside').focus();
    assert.equal(document.activeElement.id, 'close', 'outside focus is redirected into the active modal');

    const nestedListbox = document.createElement('div');
    nestedListbox.setAttribute('role', 'listbox');
    nestedListbox.setAttribute('data-modal-focus-layer', 'true');
    const nestedOption = document.createElement('button');
    nestedOption.id = 'nested-option';
    nestedListbox.append(nestedOption);
    document.body.append(nestedListbox);
    nestedOption.focus();
    assert.equal(document.activeElement.id, 'nested-option', 'portalled nested layer owns its focus');
    await act(async () => nestedOption.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.ok(document.querySelector('[role="dialog"]'), 'nested layer owns the first Escape');
    nestedListbox.remove();
    document.getElementById('close').focus();

    document.getElementById('last').focus();
    await act(async () => document.getElementById('last').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    assert.equal(document.activeElement.id, 'close');

    await act(async () => document.getElementById('close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    await act(nextFrame);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement.id, 'opener');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.KeyboardEvent;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});

test('only the topmost nested modal traps focus and handles Escape', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', { configurable: true, value() { return [{ width: 10, height: 10 }]; } });

  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(NestedHarness)));
    const outerOpener = document.getElementById('outer-opener');
    outerOpener.focus();
    await act(async () => outerOpener.click());
    await act(nextFrame);
    assert.equal(document.activeElement.id, 'outer-close');

    const innerOpener = document.getElementById('inner-opener');
    innerOpener.focus();
    await act(async () => innerOpener.click());
    await act(nextFrame);
    assert.equal(document.activeElement.id, 'inner-close');

    document.getElementById('outer-close').focus();
    assert.equal(document.activeElement.id, 'inner-close', 'underlay modal cannot take focus while nested modal is open');

    await act(async () => document.getElementById('inner-close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    await act(nextFrame);
    assert.equal(document.getElementById('inner-dialog'), null);
    assert.ok(document.getElementById('outer-dialog'));
    assert.equal(document.activeElement.id, 'inner-opener');

    await act(async () => document.getElementById('inner-opener').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    await act(nextFrame);
    assert.equal(document.getElementById('outer-dialog'), null);
    assert.equal(document.activeElement.id, 'outer-opener');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.KeyboardEvent;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
