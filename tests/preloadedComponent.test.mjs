import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { act, createElement, createRef, forwardRef, Suspense, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';

import { preloadedComponent, retryingLazy } from '../src/utils/preloadedComponent.js';

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

async function withDom(run) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await run(dom.window.document.getElementById('root'), dom.window);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
}

const Failed = ({ error, retry }) => createElement('button', { onClick: retry }, `failed: ${error.message}`);
const inSuspense = (Viewer, label) => createElement(Suspense, { fallback: 'loading' }, createElement(Viewer, { label }));

test('retryingLazy: a rejected import shows the failure in place, and the next open fetches again', async () => {
  // Before: plain React.lazy cached the rejected import, so after one failed
  // download (offline / stale deploy) the viewer threw on every later open
  // until the page was reloaded.
  let attempts = 0;
  const Viewer = retryingLazy(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Failed to fetch dynamically imported module');
    return { default: Real };
  }, Failed);

  await withDom(async (container) => {
    const open = async () => {
      const root = createRoot(container);
      await act(async () => root.render(inSuspense(Viewer, 'doc')));
      return root;
    };

    let root = await open();
    assert.equal(container.textContent, 'failed: Failed to fetch dynamically imported module', 'no crash, a calm failure in place');
    assert.equal(attempts, 1);

    // Re-rendering the open screen does not hammer the network while offline.
    await act(async () => root.render(inSuspense(Viewer, 'doc 2')));
    assert.equal(attempts, 1);

    // Close the file and open it again: a fresh fetch, which now succeeds.
    await act(async () => root.unmount());
    root = await open();
    assert.equal(attempts, 2);
    assert.equal(container.innerHTML, '<b>doc</b>');
    await act(async () => root.unmount());

    // Once loaded, later opens reuse the module.
    root = await open();
    assert.equal(attempts, 2);
    await act(async () => root.unmount());
  });
});

test('retryingLazy: tapping the failure fetches again without closing', async () => {
  let attempts = 0;
  const Viewer = retryingLazy(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
    return { default: Real };
  }, Failed);

  await withDom(async (container, win) => {
    const root = createRoot(container);
    await act(async () => root.render(inSuspense(Viewer, 'doc')));
    assert.equal(container.textContent, 'failed: offline');
    await act(async () => {
      container.querySelector('button').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(attempts, 2);
    assert.equal(container.innerHTML, '<b>doc</b>');
    await act(async () => root.unmount());
  });
});

test('AppShell: a rail chunk that fails to download does not stop the viewer opening', () => {
  const source = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('const loadPDFViewerModule = ');
  const block = source.slice(start, source.indexOf(']).then(', start));
  assert.match(block, /PDFSidebarChunk\.load\(\)\.catch\(\(\) => null\)/);
  assert.match(block, /SurveySpacesRailChunk\.load\(\)\.catch\(\(\) => null\)/);
  assert.match(source, /const PDFViewer = retryingLazy\(/, 'the viewer chunk uses the retrying lazy, not React.lazy');
});
