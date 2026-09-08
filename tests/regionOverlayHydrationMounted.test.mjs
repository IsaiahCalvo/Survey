import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useRegionOverlayVisibility } from '../src/hooks/useRegionOverlayVisibility.js';

test('region visibility hydrates before writes and isolates document transitions and stale setters', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const first = '{"region1":true}';
  const second = '{"region2":true}';
  localStorage.setItem('regionOverlayStates_first', first);
  localStorage.setItem('regionOverlayStates_second', second);
  let current, update;
  function Probe({ pdfId, reader = null }) {
    [current, update] = useRegionOverlayVisibility(pdfId, reader);
    return React.createElement('output', null, JSON.stringify(Object.fromEntries(current)));
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
  await act(async () => root.render(React.createElement(Probe, { pdfId: null })));
  await act(async () => root.render(React.createElement(Probe, { pdfId: 'first' })));
  assert.equal(localStorage.getItem('regionOverlayStates_first'), first);
  assert.equal(current.get('region1'), true);
  const stale = update;
  await act(async () => root.render(React.createElement(Probe, { pdfId: 'second' })));
  assert.equal(localStorage.getItem('regionOverlayStates_first'), first);
  assert.equal(localStorage.getItem('regionOverlayStates_second'), second);
  assert.deepEqual([...current], [['region2', true]]);
  await act(async () => stale(new Map([['wrong', true]])));
  assert.equal(localStorage.getItem('regionOverlayStates_second'), second);
  await act(async () => update(previous => new Map([...previous, ['region3', true]])));
  assert.equal(localStorage.getItem('regionOverlayStates_second'), '{"region2":true,"region3":true}');
  assert.equal(localStorage.getItem('regionOverlayStates_first'), first);
  await act(async () => root.render(React.createElement(Probe, { pdfId: null })));
  assert.deepEqual([...current], []);
  assert.equal(localStorage.getItem('regionOverlayStates_first'), first);
  await act(async () => root.render(React.createElement(Probe, { pdfId: 'first' })));
  await act(async () => stale(new Map([['old-open', true]])));
  assert.equal(localStorage.getItem('regionOverlayStates_first'), first, 'an earlier open stays stale after returning to its ID');
  const reader = Object.freeze({ getItem: key => key === 'regionOverlayStates_first' ? '{"canonical":true}' : null });
  await act(async () => root.render(React.createElement(Probe, { pdfId: 'first', reader })));
  assert.deepEqual([...current], [['canonical', true]]);
  await act(async () => update(new Map([['current-local-edit', true]])));
  assert.equal(localStorage.getItem('regionOverlayStates_first'), first, 'managed reader never writes over legacy recovery values');
  const nextReader = Object.freeze({ getItem: () => '{"remapped":true}' });
  await act(async () => root.render(React.createElement(Probe, { pdfId: 'first', reader: nextReader })));
  assert.deepEqual([...current], [['remapped', true]], 'new file revision reads new canonical page state');
  assert.equal(localStorage.getItem('regionOverlayStates_first'), first);
});
