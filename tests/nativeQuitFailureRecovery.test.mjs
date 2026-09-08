import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createNativeQuitHandler } from '../src/services/nativeQuitHandler.js';
import { createQuitSaveRegistry } from '../src/services/quitSaveRegistry.js';

const require = createRequire(import.meta.url);
const { createNativeQuitCoordinator } = require('../src/electron/nativeQuitCoordinator.cjs');

function harness() {
  const state = {
    requests: [], failures: [], ready: [], deliveryErrors: [], timers: new Map(), failExit: true,
  };
  const messages = [];
  let timerId = 0;
  const coordinator = createNativeQuitCoordinator({
    send: (id, request) => {
      state.requests.push({ id, ...request });
      messages.push({ id, request });
    },
    onReady: (action) => {
      state.ready.push(action);
      if (state.failExit) throw new Error('native exit failed');
    },
    onFailure: (reason) => state.failures.push(reason),
    setTimer: (callback) => { state.timers.set(++timerId, callback); return timerId; },
    clearTimer: (id) => state.timers.delete(id),
  });
  const renderers = new Map([101, 202].map((id) => {
    const tabs = [{ id: `tab-${id}`, file: {} }];
    const registry = createQuitSaveRegistry(() => tabs);
    registry.register(tabs[0].id, {
      saveLocal: async () => ({ saved: true, revision: `saved-${id}` }),
      getRevision: () => `saved-${id}`,
    });
    const renderer = { inert: false, freezes: 0, releases: 0, confirmedRef: { current: false } };
    renderer.handler = createNativeQuitHandler({
      registry,
      confirmedRef: renderer.confirmedRef,
      send: (reply) => coordinator.report(id, reply),
      freeze: () => {
        renderer.inert = true;
        renderer.freezes++;
        return () => { renderer.inert = false; renderer.releases++; };
      },
    });
    return [id, renderer];
  }));
  return {
    state, coordinator, renderers,
    start: (action) => coordinator.request([...renderers.keys()].map((id) => ({ id, generation: 1 })), action),
    async deliver() {
      // These are the actual renderer and main-process handlers; only the IPC
      // boundary is queued here. Surface uncaught callback failures as evidence.
      while (messages.length) {
        const { id, request } = messages.shift();
        try { await renderers.get(id).handler.receive(request); }
        catch (error) { state.deliveryErrors.push(error); }
      }
    },
  };
}

for (const kind of ['quit', 'close', 'update']) {
  test(`a failed ${kind} after confirmation cancels and unfreezes every renderer, then permits a fresh retry`, async () => {
    const h = harness();
    const action = { kind, id: 101 };
    assert.equal(h.start(action), true);
    await h.deliver();
    assert.equal(h.state.ready.length, 1, 'exit was attempted only after the real prepare/confirm flow');
    assert.equal(h.state.requests.filter((message) => message.phase === 'cancel').length, 2,
      'exit failure must send cancel to every confirmed renderer');
    assert.equal(h.state.failures.length, 1);
    assert.equal(h.state.deliveryErrors.length, 0, 'exit errors must be handled by the coordinator');
    assert.equal(h.coordinator.pending, false);
    assert.equal(h.state.timers.size, 0);
    for (const renderer of h.renderers.values()) {
      assert.equal(renderer.inert, false, 'the app must accept input after failed exit');
      assert.equal(renderer.confirmedRef.current, false, 'beforeunload protection must be restored');
      assert.equal(renderer.releases, 1);
    }
    const failedAttempt = h.state.requests[0].quitAttemptId;
    h.state.failExit = false;
    assert.equal(h.start(action), true);
    await h.deliver();
    assert.equal(h.state.ready.length, 2);
    assert.ok(h.state.requests.findLast((message) => message.phase === 'prepare').quitAttemptId > failedAttempt);
    for (const renderer of h.renderers.values()) {
      assert.equal(renderer.freezes, 2);
      assert.equal(renderer.confirmedRef.current, true);
      renderer.handler.cancel();
    }
  });
}

test('an exit error with no editor windows still reports failure instead of escaping', () => {
  const failures = [];
  const coordinator = createNativeQuitCoordinator({
    send: () => assert.fail('there are no editor windows'),
    onReady: () => { throw new Error('native exit failed'); },
    onFailure: (reason) => failures.push(reason),
  });
  assert.doesNotThrow(() => coordinator.request([], { kind: 'quit' }));
  assert.equal(failures.length, 1);
  assert.equal(coordinator.pending, false);
});
