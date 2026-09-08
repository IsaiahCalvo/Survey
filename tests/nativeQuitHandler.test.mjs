import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeQuitHandler } from '../src/services/nativeQuitHandler.js';
import { createQuitSaveRegistry } from '../src/services/quitSaveRegistry.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function setup() {
  const registry = createQuitSaveRegistry(() => [{ id: 'tab', file: null }]);
  const verification = deferred(); const receipt = {};
  let signal, released = 0, validates = 0;
  registry.register('tab', { saveLocal: async () => ({ saved: true, revision: 'r1' }), getRevision: () => 'r1',
    prepareClose: async () => receipt, isCloseCurrent: value => value === receipt,
    validateClose: (_value, options) => { validates++; signal = options.signal; return verification.promise; } });
  const sent = []; const confirmedRef = { current: false };
  const handler = createNativeQuitHandler({ registry, confirmedRef,
    send: value => sent.push(value), freeze: () => () => { released++; } });
  return { handler, sent, confirmedRef, verification, get signal() { return signal; },
    get released() { return released; }, get validates() { return validates; } };
}

test('native confirmation waits for real registry fresh proof and coalesces duplicate confirm IPC', async () => {
  const h = setup();
  const attempt = { quitAttemptId: 1, generation: 3 };
  await h.handler.receive({ ...attempt, phase: 'prepare' });
  assert.equal(h.sent.at(-1).saved, true);
  const confirming = h.handler.receive({ ...attempt, phase: 'confirm' });
  await h.handler.receive({ ...attempt, phase: 'confirm' });
  assert.equal(h.confirmedRef.current, false);
  assert.equal(h.sent.filter(item => item.phase === 'confirm').length, 0);
  h.verification.resolve(true);
  await confirming;
  assert.equal(h.validates, 1);
  assert.equal(h.sent.filter(item => item.phase === 'confirm').length, 1);
  assert.equal(h.sent.at(-1).saved, true);
  assert.equal(h.confirmedRef.current, true);
  h.handler.cancel();
});

test('cancel during awaited confirmation aborts proof and suppresses late acknowledgment', async () => {
  const h = setup(); const attempt = { quitAttemptId: 1, generation: 3 };
  await h.handler.receive({ ...attempt, phase: 'prepare' });
  const confirming = h.handler.receive({ ...attempt, phase: 'confirm' });
  await h.handler.receive({ ...attempt, phase: 'cancel' });
  assert.equal(h.signal.aborted, true);
  await confirming;
  h.verification.resolve(true);
  await Promise.resolve();
  assert.equal(h.sent.filter(item => item.phase === 'confirm').length, 0);
  assert.equal(h.confirmedRef.current, false);
  assert.equal(h.released, 1);
});

test('new native generation supersedes a pending confirm without adopting its success', async () => {
  const h = setup();
  await h.handler.receive({ quitAttemptId: 1, generation: 3, phase: 'prepare' });
  const confirming = h.handler.receive({ quitAttemptId: 1, generation: 3, phase: 'confirm' });
  await h.handler.receive({ quitAttemptId: 2, generation: 4, phase: 'prepare' });
  await confirming;
  h.verification.resolve(true);
  await Promise.resolve();
  assert.equal(h.sent.some(item => item.phase === 'confirm' && item.quitAttemptId === 1), false);
  assert.equal(h.confirmedRef.current, false);
  assert.equal(h.sent.at(-1).generation, 4);
  h.handler.cancel();
});
