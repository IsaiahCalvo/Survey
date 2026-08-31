import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import BodyPortal from '../src/components/BodyPortal.js';

const rect = (x, y, width, height) => ({
  x,
  y,
  left: x,
  top: y,
  right: x + width,
  bottom: y + height,
  width,
  height,
  toJSON() { return this; },
});

test('mounted BodyPortal keeps a fixed picker at its viewport bounds under a transformed parent', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1500 });
  const originalGetBoundingClientRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.matches('[data-picker-probe]')) {
      const viewportLeft = Number.parseFloat(this.style.left);
      const capturedByTransform = this.closest('[data-transformed-parent]');
      const containingBlockOffset = capturedByTransform ? 816 : 0;
      return rect(viewportLeft + containingBlockOffset, 120, 286, 310);
    }
    return rect(0, 0, 0, 0);
  };

  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(
      React.createElement('div', {
        'data-transformed-parent': true,
        style: { transform: 'matrix(1, 0, 0, 1, 0, -14)' },
      }, React.createElement(BodyPortal, null,
        React.createElement('div', {
          'data-picker-probe': true,
          style: { position: 'fixed', left: '716.656px' },
        }),
      )),
    ));

    const picker = document.querySelector('[data-picker-probe]');
    const bounds = picker.getBoundingClientRect();
    assert.equal(picker.parentElement, document.body);
    assert.equal(bounds.x, 716.656);
    assert.ok(bounds.right <= window.innerWidth, `picker right edge ${bounds.right} must fit within ${window.innerWidth}`);
  } finally {
    await act(async () => root.unmount());
    dom.window.HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
