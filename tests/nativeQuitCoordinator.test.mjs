import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createNativeQuitCoordinator } = require('../src/electron/nativeQuitCoordinator.cjs');

function harness(participants = [{ id: 1, generation: 1 }, { id: 2, generation: 3 }]) {
  const state = { sent: [], exits: [], failures: [], timers: new Map() };
  let timerId = 0;
  const coordinator = createNativeQuitCoordinator({
    send: (id, message) => state.sent.push({ id, ...message }),
    onReady: (action) => state.exits.push(action),
    onFailure: (error) => state.failures.push(error),
    setTimer: (callback) => { state.timers.set(++timerId, callback); return timerId; },
    clearTimer: (id) => state.timers.delete(id),
  });
  return { state, coordinator,
    start: (action = 'quit') => coordinator.request(participants, action),
    reply: (id, phase, saved = true, extra = {}) => {
      const request = state.sent.findLast((entry) => entry.id === id && entry.phase !== 'cancel');
      return coordinator.report(id, { ...request, phase, saved, tabIds: [`tab-${id}`], ...extra });
    },
    expire: () => [...state.timers.values()].forEach((callback) => callback()),
  };
}

test('all editor windows must prepare and confirm; repeated quit and duplicate replies do not skip a window', () => {
  const h = harness();
  h.start(); h.start();
  assert.equal(h.state.sent.length, 2);
  h.reply(1, 'prepare'); h.reply(1, 'prepare');
  assert.equal(h.state.exits.length, 0);
  h.reply(2, 'prepare');
  assert.equal(h.state.sent.filter((x) => x.phase === 'confirm').length, 2);
  h.reply(1, 'confirm');
  assert.equal(h.state.exits.length, 0);
  h.reply(2, 'confirm');
  assert.deepEqual(h.state.exits, ['quit']);
  assert.equal(h.state.timers.size, 0);
});

test('no response or known pending save times out without exiting; late success stays inert', () => {
  for (const pending of [false, true]) {
    const h = harness(); h.start();
    if (pending) h.reply(1, 'pending');
    h.expire();
    assert.equal(h.state.failures.length, 1);
    assert.equal(h.state.exits.length, 0);
    h.reply(1, 'prepare'); h.reply(2, 'prepare');
    assert.equal(h.state.exits.length, 0);
    assert.equal(h.state.sent.filter((x) => x.phase === 'cancel').length, 2);
  }
});

test('wrong sender, old generation and old attempt cannot acknowledge a save', () => {
  const h = harness(); h.start();
  h.reply(99, 'prepare');
  h.reply(1, 'prepare', true, { generation: 999 });
  h.reply(2, 'prepare', true, { quitAttemptId: -1 });
  assert.equal(h.state.sent.length, 2);
  h.expire();
  assert.equal(h.state.exits.length, 0);
});

test('failed, changed-tab and invalidated-window results cancel the whole attempt', () => {
  for (const mode of ['failed', 'tabs', 'reload']) {
    const h = harness(); h.start();
    if (mode === 'failed') h.reply(1, 'prepare', false);
    if (mode === 'reload') h.coordinator.invalidate(1);
    if (mode === 'tabs') {
      h.reply(1, 'prepare'); h.reply(2, 'prepare');
      h.reply(1, 'confirm', true, { tabIds: ['different-tab'] });
    }
    assert.equal(h.state.failures.length, 1);
    assert.equal(h.state.exits.length, 0);
  }
});

test('retry after cancellation uses a fresh attempt and empty editor list is safe', () => {
  const h = harness(); h.start();
  const old = h.state.sent[0];
  h.reply(1, 'prepare', false);
  h.start('update');
  h.coordinator.report(1, { ...old, saved: false });
  h.reply(1, 'prepare'); h.reply(2, 'prepare');
  h.reply(1, 'confirm'); h.reply(2, 'confirm');
  assert.deepEqual(h.state.exits, ['update']);
  const empty = harness([]); empty.start('close');
  assert.deepEqual(empty.state.exits, ['close']);
});

test('a deferred updater error cancels its confirmed attempt but not another exit', () => {
  const h = harness(); h.start({ kind: 'update' });
  h.reply(1, 'prepare'); h.reply(2, 'prepare'); h.reply(1, 'confirm'); h.reply(2, 'confirm');
  assert.equal(h.coordinator.failConfirmedUpdate(), true);
  assert.equal(h.state.sent.filter((entry) => entry.phase === 'cancel').length, 2);
  assert.equal(h.coordinator.failConfirmedUpdate(), false);
  h.start({ kind: 'quit' });
  assert.equal(h.coordinator.failConfirmedUpdate(), false);
});
