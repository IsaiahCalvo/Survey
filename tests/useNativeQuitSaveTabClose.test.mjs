import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useNativeQuitSave } from '../src/hooks/useNativeQuitSave.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function until(check) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(check(), 'expected close stage was not reached');
}
async function mount(t, { native = false, participant } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const state = { replies: [], saved: [] };
  if (native) window.electronAPI = {
    onBeforeQuit: callback => { state.receive = callback; return () => { state.unsubscribed = true; }; },
    notifySaveComplete: reply => state.replies.push(reply),
  };
  const tabs = [{ id: 'a', actorUserId: 'actor', file: {} }];
  function Probe() {
    const [value, setValue] = useState('old');
    const hook = useNativeQuitSave(tabs);
    state.hook = hook;
    useEffect(() => hook.register('a', participant || {
      saveLocal: async () => { state.saved.push(value); return { saved: true, revision: value }; },
      getRevision: () => value,
    }), [hook.register, value]);
    return React.createElement('input', { defaultValue: 'old', onBlur: event => setValue(event.target.value) });
  }
  const root = createRoot(document.getElementById('root'));
  let unmounted = false;
  state.unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()); } };
  t.after(async () => {
    await state.unmount(); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  await act(async () => root.render(React.createElement(Probe)));
  return state;
}

test('browser tab close flushes focused input before save and releases its own inert state', async t => {
  const state = await mount(t);
  const input = document.querySelector('input');
  input.attachEvent = () => {}; input.detachEvent = () => {};
  input.focus(); input.value = 'last typed value';
  let result;
  await act(async () => { result = await state.hook.prepareTabClose('a'); });
  assert.equal(result.saved, true);
  assert.deepEqual(state.saved, ['last typed value']);
  assert.notEqual(document.documentElement.inert, true);
  document.documentElement.inert = true;
  assert.equal((await state.hook.prepareTabClose('a')).saved, true);
  assert.equal(document.documentElement.inert, true, 'preexisting inert owner is preserved');
});

test('browser close vetoes a live pointer or text edit before any save', async t => {
  const state = await mount(t);
  document.dispatchEvent(new window.Event('pointerdown'));
  const pointer = await state.hook.prepareTabClose('a');
  assert.equal(pointer.saved, false); assert.match(pointer.reason, /Finish/);
  document.dispatchEvent(new window.Event('pointercancel'));
  const overlay = document.createElement('div'); overlay.dataset.textEditOverlay = 'true'; document.body.append(overlay);
  const text = await state.hook.prepareTabClose('a');
  assert.equal(text.saved, false); assert.match(text.reason, /Finish/);
  assert.deepEqual(state.saved, []);
  assert.notEqual(document.documentElement.inert, true);
  overlay.remove();
  assert.equal((await state.hook.prepareTabClose('a')).saved, true);
});

test('superseding manual close cannot release the newer close freeze', async t => {
  const waits = []; const signals = [];
  const receipt = {};
  const state = await mount(t, { participant: {
    saveLocal: async () => ({ saved: true, revision: 'r' }), getRevision: () => 'r',
    prepareClose: async () => receipt, isCloseCurrent: value => value === receipt,
    validateClose: (_, { signal }) => { const wait = deferred(); waits.push(wait); signals.push(signal); return wait.promise; },
  } });
  const first = state.hook.prepareTabClose('a'); await until(() => waits.length === 1);
  const second = state.hook.prepareTabClose('a'); await until(() => waits.length === 2);
  assert.equal((await first).saved, false);
  assert.equal(signals[0].aborted, true);
  assert.equal(document.documentElement.inert, true);
  waits[1].resolve(true);
  assert.equal((await second).saved, true);
  assert.notEqual(document.documentElement.inert, true);
  waits[0].resolve(true);
});

test('native quit supersedes a pending manual close but retains its own freeze until cancel', async t => {
  const waits = []; const signals = [];
  const receipt = {};
  const state = await mount(t, { native: true, participant: {
    saveLocal: async () => ({ saved: true, revision: 'r' }), getRevision: () => 'r',
    prepareClose: ({ signal }) => { const wait = deferred(); waits.push(wait); signals.push(signal); return wait.promise; },
    validateClose: async () => true, isCloseCurrent: value => value === receipt,
  } });
  const manual = state.hook.prepareTabClose('a'); await until(() => waits.length === 1);
  state.receive({ quitAttemptId: 1, generation: 1, phase: 'prepare' });
  await until(() => waits.length === 2);
  assert.equal((await manual).saved, false);
  assert.equal(signals[0].aborted, true);
  assert.equal(document.documentElement.inert, true);
  waits[1].resolve(receipt);
  await until(() => state.replies.some(reply => reply.phase === 'prepare'));
  state.receive({ quitAttemptId: 1, generation: 1, phase: 'cancel' });
  assert.notEqual(document.documentElement.inert, true);
  waits[0].resolve(receipt);
});

test('unmount aborts a pending browser proof, unlocks and rejects retained close callbacks', async t => {
  let signal;
  const wait = deferred(); const receipt = {};
  const state = await mount(t, { participant: {
    saveLocal: async () => ({ saved: true, revision: 'r' }), getRevision: () => 'r',
    prepareClose: async () => receipt, isCloseCurrent: value => value === receipt,
    validateClose: (_, options) => { signal = options.signal; return wait.promise; },
  } });
  const retained = state.hook.prepareTabClose;
  const closing = retained('a'); await until(() => signal);
  assert.equal(document.documentElement.inert, true);
  await state.unmount();
  assert.equal(signal.aborted, true);
  assert.equal((await closing).saved, false);
  assert.notEqual(document.documentElement.inert, true);
  assert.equal((await retained('a')).saved, false);
  wait.resolve(true);
});

test('manual tab close cannot replace an active or already-confirmed native quit proof', async t => {
  const state = await mount(t, { native: true });
  state.receive({ quitAttemptId: 1, generation: 1, phase: 'prepare' });
  await until(() => state.replies.some(reply => reply.phase === 'prepare'));
  assert.equal((await state.hook.prepareTabClose('a')).saved, false);
  assert.deepEqual(state.saved, ['old']);
  assert.equal(document.documentElement.inert, true);
  state.receive({ quitAttemptId: 1, generation: 1, phase: 'confirm' });
  await until(() => state.replies.some(reply => reply.phase === 'confirm'));
  assert.equal(state.hook.confirmedRef.current, true);
  assert.equal((await state.hook.prepareTabClose('a')).saved, false);
  assert.deepEqual(state.saved, ['old']);
  assert.equal(state.hook.confirmedRef.current, true);
  state.receive({ quitAttemptId: 1, generation: 1, phase: 'cancel' });
  assert.equal((await state.hook.prepareTabClose('a')).saved, true);
  assert.notEqual(document.documentElement.inert, true);
});
