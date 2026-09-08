import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

test('mounted preference save errors show once per error change and reset after recovery', async (t) => {
  const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const marker = source.indexOf('// Surface failed tool settings saves');
  const start = source.indexOf('useEffect(', marker);
  const end = source.indexOf('\n  }, [toolPreferencesSaveError]);', start);
  assert.ok(marker >= 0 && start > marker && end > start, 'execute the viewer error effect');
  assert.match(source.slice(source.indexOf('// Per-document, per-tool preferences hook'), marker), /saveError: toolPreferencesSaveError/);
  const effectSource = source.slice(start + 'useEffect('.length, end + '\n  }'.length);
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const originals = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const toasts = [];
  const showToast = (...args) => toasts.push(args);
  function Probe({ error }) {
    const effect = new Function('toolPreferencesSaveError', 'showToast', `return (${effectSource});`)(error, showToast);
    useEffect(effect, [error]);
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const render = (error) => act(async () => root.render(React.createElement(Probe, { error })));
  await render(null);
  assert.deepEqual(toasts, []);
  await render('Tool settings could not be saved locally.');
  await render('Tool settings could not be saved locally.');
  assert.deepEqual(toasts, [['Tool settings could not be saved locally.', 'error']]);
  await render(null);
  assert.equal(toasts.length, 1, 'recovery does not show an error');
  await render('Tool settings could not be saved locally.');
  assert.equal(toasts.length, 2, 'a new failed attempt after recovery is visible');
});
