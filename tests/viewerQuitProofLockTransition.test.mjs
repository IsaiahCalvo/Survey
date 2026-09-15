import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  const quitCloseChecksRef =');
const end = source.indexOf('\n  useEffect(() => {\n    if (!onRegisterQuitSave', start);
assert.ok(start > 0 && end > start);
const viewerProofHook = new Function('useRef', 'useLayoutEffect', 'effectiveDocumentLocked', 'yjsLocalCloseRequired',
  'yjsLocalCloseSession', 'quitSaveHandlerRef', 'saveLocalBeforeQuit', 'getQuitSaveBlockReason', 'getQuitSaveRevision',
  `${source.slice(start, end)}\nreturn quitSaveHandlerRef.current;`);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function mount(t, session, locked = false) {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = new Map();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  let current; let unmounted = false;
  function Probe({ session, locked }) {
    const handler = useRef(null);
    current = viewerProofHook(useRef, useLayoutEffect, locked, true, session, handler,
      () => ({ saved: true, revision: 'r' }), () => null, () => 'r');
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  const render = async (nextLocked = locked, nextSession = session) => {
    locked = nextLocked; session = nextSession;
    await act(async () => root.render(React.createElement(Probe, { session, locked })));
  };
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()); } };
  t.after(async () => {
    await unmount(); dom.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  await render();
  return { get current() { return current; }, render, unmount };
}

test('actual viewer proof records locked read-only mode and rejects a receipt after mode changes', async t => {
  const receipt = {}; const calls = [];
  const session = { prepareLocalClose: async options => { calls.push(options); return receipt; },
    isLocalCloseReceiptCurrent: value => value === receipt, validateLocalCloseReceipt: async () => true };
  const h = await mount(t, session, true);
  const proof = await h.current.prepareClose({});
  assert.equal(proof.readOnly, true);
  assert.equal(calls[0].readOnly, true);
  assert.equal(h.current.isCloseCurrent(proof), true);
  await h.render(false);
  assert.equal(h.current.isCloseCurrent(proof), false);
  assert.equal(await h.current.validateClose(proof, {}), false);
});

for (const phase of ['prepare', 'validate']) {
  test(`committed remote lock aborts pending ${phase} and denies late success`, async t => {
    const wait = deferred(); const receipt = {}; let received;
    const session = { prepareLocalClose: options => { if (phase === 'prepare') { received = options; return wait.promise; } return Promise.resolve(receipt); },
      isLocalCloseReceiptCurrent: value => value === receipt,
      validateLocalCloseReceipt: (_receipt, options) => { received = options; return wait.promise; } };
    const h = await mount(t, session);
    const proof = phase === 'validate' ? await h.current.prepareClose({}) : null;
    const operation = phase === 'prepare' ? h.current.prepareClose({}) : h.current.validateClose(proof, {});
    const rejected = assert.rejects(operation, /canceled/);
    assert.equal(received.signal.aborted, false);
    await h.render(true);
    assert.equal(received.signal.aborted, true, 'lock cleanup reaches storage AbortSignal');
    wait.resolve(phase === 'prepare' ? receipt : true);
    await rejected;
    if (proof) assert.equal(h.current.isCloseCurrent(proof), false);
  });
}

for (const cause of ['caller', 'session', 'unmount']) {
  test(`pending viewer close respects ${cause} cancellation`, async t => {
    const wait = deferred(); const controller = new AbortController(); let signal;
    const session = { prepareLocalClose: options => { signal = options.signal; return wait.promise; },
      isLocalCloseReceiptCurrent: () => true, validateLocalCloseReceipt: async () => true };
    const h = await mount(t, session);
    const operation = h.current.prepareClose({ signal: controller.signal });
    const rejected = assert.rejects(operation, /canceled/);
    if (cause === 'caller') controller.abort();
    if (cause === 'session') await h.render(false, { ...session });
    if (cause === 'unmount') await h.unmount();
    assert.equal(signal.aborted, true);
    wait.resolve({}); await rejected;
  });
}
