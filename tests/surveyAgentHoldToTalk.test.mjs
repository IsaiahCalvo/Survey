import test from 'node:test';
import assert from 'node:assert/strict';
import { createHoldToTalk } from '../src/agent/holdToTalk.js';

function rig() {
  const calls = [];
  let on = false;
  const states = [];
  const h = createHoldToTalk({
    start: () => { calls.push('start'); on = true; },
    stop: () => { calls.push('stop'); on = false; },
    cancel: () => { calls.push('cancel'); on = false; },
    recording: () => on,
    onChange: (s) => states.push(s),
  });
  return { h, calls, states };
}

test('hold to talk, let go to send', () => {
  const { h, calls } = rig();
  h.down(0, 0, 0);
  h.move(2, 1, 600);
  h.up(1500);
  assert.deepEqual(calls, ['start', 'stop']);
});

test('slide off while holding cancels; sliding back keeps it', () => {
  const { h, calls, states } = rig();
  h.down(0, 0, 0);
  h.move(0, -90, 500);
  assert.equal(states.at(-1).cancelling, true);
  h.up(900);
  assert.deepEqual(calls, ['start', 'cancel']);

  const second = rig();
  second.h.down(0, 0, 0);
  second.h.move(0, -90, 400);
  second.h.move(0, -10, 700);
  second.h.up(1200);
  assert.deepEqual(second.calls, ['start', 'stop']);
});

test('a quick tap starts, and the next tap sends', () => {
  const { h, calls } = rig();
  h.down(0, 0, 0);
  h.up(120);
  assert.deepEqual(calls, ['start']);
  h.down(0, 0, 3000);
  h.up(3100);
  assert.deepEqual(calls, ['start', 'stop']);
});

test('a press taken away by the browser drops what was said', () => {
  const { h, calls } = rig();
  h.down(0, 0, 0);
  h.abort();
  assert.deepEqual(calls, ['start', 'cancel']);
  assert.equal(h.pressing, false);
});
