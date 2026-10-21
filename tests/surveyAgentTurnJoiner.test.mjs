import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnJoiner, joinTurnText } from '../src/agent/turnJoiner.js';

function fakeTimers() {
  let next = 1;
  const timers = new Map();
  return {
    setTimer: (fn) => { const id = next++; timers.set(id, fn); return id; },
    clearTimer: (id) => timers.delete(id),
    fire: async () => { const all = [...timers.values()]; timers.clear(); for (const fn of all) await fn(); },
    get pending() { return timers.size; },
  };
}

test('clips said with short pauses go out as one message', async () => {
  const t = fakeTimers();
  const turns = [];
  const j = createTurnJoiner({ onTurn: (parts) => turns.push(joinTurnText(parts)), ...t });
  j.hearing(true);
  j.hearing(false);
  j.add({ text: Promise.resolve('D-117') });
  assert.equal(t.pending, 1);
  // Talking again before the grace ends: hold.
  j.hearing(true);
  assert.equal(t.pending, 0);
  j.hearing(false);
  j.add({ text: 'is installed,' });
  j.hearing(true);
  j.hearing(false);
  j.add({ text: Promise.resolve('no power.') });
  await t.fire();
  assert.deepEqual(turns, ['D-117 is installed, no power.']);
  assert.equal(j.holding, 0);
});

test('a quiet moment after a clip sends it; empty and failed clips add nothing', async () => {
  const t = fakeTimers();
  const turns = [];
  const j = createTurnJoiner({ onTurn: (parts) => turns.push(parts), ...t });
  j.add({ text: Promise.reject(new Error('x')), clip: 'a' });
  j.add({ text: '', clip: 'b' });
  j.add({ text: 'yes', clip: 'c' });
  await t.fire();
  assert.equal(turns.length, 1);
  assert.equal(joinTurnText(turns[0]), 'yes');
  assert.deepEqual(turns[0].map((p) => p.clip), ['a', 'b', 'c']);
  j.add({ text: 'later' });
  await j.flush();
  assert.equal(turns.length, 2);
});

test('a turn too big for the server goes out before the next clip joins it', async () => {
  const t = fakeTimers();
  const turns = [];
  const j = createTurnJoiner({ onTurn: (parts) => turns.push(parts.map((p) => p.clip.name)), maxBytes: 100, ...t });
  j.add({ clip: { name: 'a', size: 60 } });
  j.add({ clip: { name: 'b', size: 30 } });
  j.add({ clip: { name: 'c', size: 30 } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(turns, [['a', 'b']]);
  await t.fire();
  assert.deepEqual(turns, [['a', 'b'], ['c']]);
});

test('clips join into one WAV with a short gap between them', async () => {
  const { encodeWav } = await import('../src/agent/voiceLoop.js');
  const { joinWavs } = await import('../src/agent/turnJoiner.js');
  const a = new Blob([encodeWav(new Float32Array(1600).fill(0.5), 16_000)], { type: 'audio/wav' });
  const b = new Blob([encodeWav(new Float32Array(800).fill(-0.5), 16_000)], { type: 'audio/wav' });
  const joined = new Uint8Array(await (await joinWavs([a, b])).arrayBuffer());
  const view = new DataView(joined.buffer);
  const samples = 1600 + 4000 + 800;
  assert.equal(view.getUint32(40, true), samples * 2);
  assert.equal(joined.length, 44 + samples * 2);
  assert.equal(view.getInt16(44, true) > 0, true);
  assert.equal(view.getInt16(44 + 1600 * 2 + 100, true), 0);
  assert.equal(view.getInt16(44 + (1600 + 4000) * 2, true) < 0, true);
  assert.equal(await joinWavs([a]), a);
});
