import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, createRef, forwardRef, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';

import { preloadedComponent } from '../src/utils/preloadedComponent.js';

const Real = ({ label }) => createElement('b', null, label);

test('renders nothing before its chunk arrives, then renders synchronously once loaded', async () => {
  let imports = 0;
  const chunk = preloadedComponent(async () => { imports += 1; return { default: Real }; });

  assert.equal(renderToStaticMarkup(createElement(chunk.Component, { label: 'x' })), '');

  const [a, b] = await Promise.all([chunk.load(), chunk.load()]);
  assert.equal(a, Real);
  assert.equal(b, Real);
  assert.equal(imports, 1, 'one fetch however many callers ask');

  assert.equal(renderToStaticMarkup(createElement(chunk.Component, { label: 'ready' })), '<b>ready</b>');
});

test('a failed fetch can be retried', async () => {
  let attempts = 0;
  const chunk = preloadedComponent(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
    return { default: Real };
  });
  await assert.rejects(chunk.load(), /offline/);
  assert.equal(await chunk.load(), Real);
  assert.equal(attempts, 2);
});

test('pick selects a named export', async () => {
  const chunk = preloadedComponent(async () => ({ Named: Real }), (m) => m.Named);
  assert.equal(await chunk.load(), Real);
});

test('passes a ref through to the loaded component (the rails expose their panel API by ref)', async () => {
  // Round 5: without this the phone dock's Pages button, Ctrl+F and the
  // Spaces chip found no panel API (React 18 drops a ref on a plain function).
  const Rail = forwardRef((props, ref) => {
    useImperativeHandle(ref, () => ({ togglePanel: (id) => `toggled ${id}` }));
    return createElement('i', null, 'rail');
  });
  const chunk = preloadedComponent(async () => ({ default: Rail }));
  await chunk.load();
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    const ref = createRef();
    const root = createRoot(dom.window.document.getElementById('root'));
    await act(async () => root.render(createElement(chunk.Component, { ref })));
    assert.equal(ref.current?.togglePanel('pages'), 'toggled pages');
    await act(async () => root.unmount());
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
