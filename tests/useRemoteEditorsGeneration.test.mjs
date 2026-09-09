import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';
import { YDocContext } from '../src/components/collab/YDocContext.js';
import { useRemoteEditors } from '../src/hooks/useRemoteEditors.js';

// No source rewriting: mount the actual hook, useYDoc and shared React context.
// Awareness is the only fake. It owns no timer, transport, or network resource.
function awareness(states = []) {
  const listeners = new Set();
  return {
    clientID: 1, states: new Map(states), listeners, adds: 0, removes: 0,
    getStates() { return this.states; },
    on(event, callback) { assert.equal(event, 'change'); this.adds++; listeners.add(callback); },
    off(event, callback) { assert.equal(event, 'change'); this.removes++; listeners.delete(callback); },
    emit() { for (const callback of [...listeners]) callback(); },
  };
}
const peer = (annotationId, name = 'Peer', id = 'actor-peer') => ({
  editingAnnotationId: annotationId, user: { id, name, colorSlot: 4 },
});
async function mount(t, value, { strict = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const saved = new Map();
  for (const [key, item] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: item });
  }
  const container = dom.window.document.getElementById('root'), root = createRoot(container);
  let current, closed = false;
  function Probe() {
    current = useRemoteEditors();
    return React.createElement('output', null, JSON.stringify([...current]));
  }
  const render = async next => {
    const probe = React.createElement(Probe);
    const tree = next === undefined ? probe : React.createElement(YDocContext.Provider, { value: next }, probe);
    await act(async () => { root.render(strict ? React.createElement(StrictMode, null, tree) : tree); });
  };
  const unmount = async () => {
    if (closed) return; closed = true;
    await act(async () => { root.unmount(); });
  };
  t.after(async () => {
    try { await unmount(); } finally {
      dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    }
  });
  await render(value);
  return { render, unmount, get editors() { return current; },
    rendered: () => JSON.parse(container.querySelector('output').textContent) };
}

test('generated awareness renders remote editing annotations with no legacy Y.Doc and ignores self', async t => {
  const a = awareness([[1, peer('self', 'Me')], [2, peer('shape-a')], [3, { user: { id: 'idle' } }]]);
  const h = await mount(t, { ydoc: null, generationAwarenessScope: 'doc:generation-a', getAwareness: () => a });
  assert.deepEqual(h.rendered(), [['shape-a', { userId: 'actor-peer', name: 'Peer', colorSlot: 4 }]]);
  assert.equal(h.editors.has('self'), false); assert.equal(a.listeners.size, 1);
  await act(async () => { a.states.set(2, peer('shape-b', 'Changed')); a.emit(); });
  assert.equal(h.editors.has('shape-a'), false); assert.equal(h.editors.get('shape-b').name, 'Changed');
  await act(async () => { a.states.delete(2); a.states.set(4, { editingAnnotationId: 'anonymous-peer' }); a.emit(); });
  assert.deepEqual(h.editors.get('anonymous-peer'), { userId: 'client-4', colorSlot: 1, name: 'collaborator' });
});

test('generation scope changes with a stable accessor detach old peers and clear unavailable awareness', async t => {
  const a = awareness([[2, peer('old-page')]]), b = awareness([[3, peer('new-page', 'New peer')]]);
  let active = a;
  const getAwareness = () => active;
  const h = await mount(t, { ydoc: null, generationAwarenessScope: 'scope-a', getAwareness });
  assert.equal(h.editors.has('old-page'), true);
  active = b; await h.render({ ydoc: null, generationAwarenessScope: 'scope-b', getAwareness });
  assert.equal(a.listeners.size, 0); assert.equal(b.listeners.size, 1);
  assert.equal(h.editors.has('old-page'), false); assert.equal(h.editors.has('new-page'), true);
  await act(async () => { a.states.set(2, peer('stale-event')); a.emit(); });
  assert.equal(h.editors.has('stale-event'), false);
  active = null; await h.render({ ydoc: null, generationAwarenessScope: 'scope-c', getAwareness });
  assert.equal(b.listeners.size, 0); assert.equal(h.editors.size, 0);
  // Reusing the same label after another generation still subscribes freshly.
  active = a; await h.render({ ydoc: null, generationAwarenessScope: 'scope-a', getAwareness });
  assert.equal(h.editors.has('stale-event'), true); assert.equal(a.listeners.size, 1);
  await h.render({ ydoc: null, generationAwarenessScope: null, getAwareness });
  assert.equal(h.editors.size, 0); assert.equal(a.listeners.size, 0);
});

test('absent context, scope, accessor, or awareness degrades to an empty map', async t => {
  const h = await mount(t, undefined);
  assert.equal(h.editors.size, 0);
  let reads = 0;
  await h.render({ ydoc: null, getAwareness: () => { reads++; return awareness([[2, peer('must-not-render')]]); } });
  assert.equal(h.editors.size, 0); assert.equal(reads, 0, 'unscoped awareness is not read');
  await h.render({ ydoc: null, generationAwarenessScope: 'scope-a' });
  assert.equal(h.editors.size, 0);
  await h.render({ ydoc: null, generationAwarenessScope: 'scope-a', getAwareness: () => null });
  assert.equal(h.editors.size, 0);
});

test('legacy Y.Doc still supplies peers and Strict Mode leaves no duplicate or leaked listeners', async t => {
  const doc = new Y.Doc(), a = awareness([[1, peer('self')], [2, peer('legacy-shape')]]);
  t.after(() => doc.destroy());
  const h = await mount(t, { ydoc: doc, getAwareness: () => a }, { strict: true });
  assert.equal(h.editors.has('legacy-shape'), true); assert.equal(h.editors.has('self'), false);
  assert.equal(a.listeners.size, 1); assert.equal(a.adds - a.removes, 1);
  await h.unmount(); assert.equal(a.listeners.size, 0); assert.equal(a.adds, a.removes);
  await act(async () => { a.states.set(3, peer('after-unmount')); a.emit(); });
  assert.equal(a.listeners.size, 0);
});
