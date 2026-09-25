// w32 (2026-09-25): a stroke shows on other screens while it is drawn.
//
// Pins:
//   * the sender sends at most one message per LIVE_STROKE_INTERVAL_MS while
//     the pen moves, only the new points, nothing when it is still, and one
//     closing message (f / x) only if something went out;
//   * the receiver draws a ghost, joins lost messages straight, caps points
//     and ghosts, ignores its own writer and malformed messages;
//   * the ghost leaves once the finished mark is on the screen (preview or
//     row), on cancel, and after the timeouts; a late message cannot bring it
//     back;
//   * end to end through two doc handles: a v3 message becomes a ghost, the
//     finished stroke's preview removes it, nothing is ever written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_STROKE_ENDED_TTL_MS,
  LIVE_STROKE_IDLE_TTL_MS,
  LIVE_STROKE_INTERVAL_MS,
  LIVE_STROKE_MAX_GHOSTS,
  LIVE_STROKE_MAX_POINTS,
  __liveStrokesTest,
  applyRemoteLiveStroke,
  beginLiveStroke,
  getLiveStrokesForPage,
  markLiveStrokesLanded,
  setLiveStrokeSink,
  sweepLiveStrokes,
} from '../src/services/annotationLiveStrokes.js';
import { createCloud, openFor, settle, until } from './helpers/liveSyncFakeCloud.mjs';

function fakeClock() {
  let now = 1_000;
  const timers = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => { const timer = { at: now + ms, fn }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
    advance(ms) {
      now += ms;
      for (;;) {
        timers.sort((l, r) => l.at - r.at);
        if (!timers.length || timers[0].at > now) break;
        timers.shift().fn();
      }
    },
  };
}

const points = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ x: 10 + from + i, y: 20 + (from + i) / 3 }));

test('the sender streams new points at most every interval, nothing when still, and closes only what it opened', () => {
  __liveStrokesTest.reset();
  const sent = [];
  setLiveStrokeSink({ documentId: 'd', writerId: 'w1', send: (payload) => { sent.push(payload); return true; } });
  const clock = fakeClock();
  const live = beginLiveStroke({ documentId: 'd', id: 'stroke-1', page: 2, tool: 'pen', color: '#ff0000', width: 3 }, clock);
  const all = points(3);
  live.push(all);
  clock.advance(0);
  assert.equal(sent.length, 1, 'the first points go at once');
  assert.deepEqual(sent[0].pts.length, 6);
  assert.equal(sent[0].i, 0);
  // Many frames of moves inside one interval: one more message.
  for (let frame = 0; frame < 4; frame += 1) {
    all.push(...points(2, all.length));
    live.push(all);
    clock.advance(10);
  }
  assert.ok(LIVE_STROKE_INTERVAL_MS >= 125, 'at most 8 messages a second per drawing screen');
  clock.advance(LIVE_STROKE_INTERVAL_MS);
  assert.equal(sent.length, 2, 'coalesced to one message per interval');
  assert.equal(sent[1].i, 3, 'only the new points');
  assert.equal(sent[1].pts.length, 16);
  clock.advance(1_000);
  assert.equal(sent.length, 2, 'nothing while the pen is still');
  live.end(true, all);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].f, 1);
  assert.equal(sent[2].pts.length, 0);
  assert.ok(sent.every((m) => m.v === 3 && m.w === 'w1' && m.g === 'stroke-1' && m.p === 2));

  // A stroke finished before the first interval sends nothing at all (the
  // finished mark's preview covers it).
  const quiet = [];
  setLiveStrokeSink({ documentId: 'd', writerId: 'w1', send: (payload) => { quiet.push(payload); return true; } });
  const clock2 = fakeClock();
  const quick = beginLiveStroke({ documentId: 'd', id: 'quick', page: 1, tool: 'pen', color: '#000', width: 2 }, clock2);
  quick.end(true, points(4));
  assert.equal(quiet.length, 0);
  // No channel: no-op.
  __liveStrokesTest.reset();
  const none = beginLiveStroke({ documentId: 'd', id: 'x', page: 1, tool: 'pen' });
  none.push(points(5));
  none.end(true);
  assert.equal(none.sent(), 0);
});

test('the receiver draws a ghost, joins gaps, ignores itself and junk, and caps what it keeps', () => {
  __liveStrokesTest.reset();
  assert.deepEqual(getLiveStrokesForPage(1, 'other-doc'), [], 'another document never shows them');
  const base = { v: 3, w: 'other', g: 's1', p: 1, t: 'pen', c: '#123456', sw: 2 };
  assert.equal(applyRemoteLiveStroke('doc', { ...base, i: 0, pts: [1, 1, 2, 2] }), true);
  assert.equal(getLiveStrokesForPage(1, 'doc')[0].count, 2);
  // Message i=2 lost; i=4 arrives: joined straight.
  applyRemoteLiveStroke('doc', { ...base, i: 4, pts: [5, 5] });
  assert.deepEqual(getLiveStrokesForPage(1, 'doc')[0].points, [1, 1, 2, 2, 5, 5]);
  // A duplicate of an old batch adds nothing.
  applyRemoteLiveStroke('doc', { ...base, i: 0, pts: [1, 1, 2, 2] });
  assert.equal(getLiveStrokesForPage(1, 'doc')[0].count, 3);
  assert.equal(applyRemoteLiveStroke('doc', { ...base, g: 'mine', w: 'me', i: 0, pts: [1, 1, 2, 2] }, { ownWriterId: 'me' }), false);
  for (const junk of [
    { ...base, g: 'j1', i: 0, pts: [1, 2, 3] },
    { ...base, g: 'j2', i: 0, pts: [1, 'x'] },
    { ...base, g: 'j3', i: -1, pts: [1, 2] },
    { ...base, g: 'j4', t: 'rect', i: 0, pts: [1, 2] },
    { ...base, g: 'j5', p: 0, i: 0, pts: [1, 2] },
    { ...base, g: 'j6', v: 2, i: 0, pts: [1, 2] },
  ]) assert.equal(applyRemoteLiveStroke('doc', junk), false);
  assert.equal(applyRemoteLiveStroke('doc', { ...base, g: 'c1', c: 'url(javascript:x)', i: 0, pts: [1, 1, 2, 2] }), true);
  assert.equal(getLiveStrokesForPage(1, 'doc').find((s) => s.key.endsWith('c1')).color, '#000000', 'odd colours fall back');
  // Point cap.
  const many = [];
  for (let i = 0; i < 1200; i += 1) many.push(i, i);
  for (let batch = 0; batch < 10; batch += 1) {
    applyRemoteLiveStroke('doc', { ...base, g: 'long', i: batch * 600, pts: many.slice(0, 1200) });
  }
  assert.ok(getLiveStrokesForPage(1, 'doc').find((s) => s.key.endsWith('long')).count <= LIVE_STROKE_MAX_POINTS);
  // Ghost cap.
  for (let i = 0; i < LIVE_STROKE_MAX_GHOSTS + 10; i += 1) applyRemoteLiveStroke('doc', { ...base, g: `cap-${i}`, i: 0, pts: [1, 1, 2, 2] });
  assert.ok(__liveStrokesTest.ghosts().length <= LIVE_STROKE_MAX_GHOSTS);
  __liveStrokesTest.reset();
});

test('a ghost leaves when its mark lands, on cancel, and on timeouts; a late message cannot bring it back', async () => {
  __liveStrokesTest.reset();
  const base = { v: 3, w: 'other', p: 1, t: 'pen', c: '#123456', sw: 2 };
  applyRemoteLiveStroke('doc', { ...base, g: 'landed', i: 0, pts: [1, 1, 2, 2] }, { nowMs: 0 });
  applyRemoteLiveStroke('doc', { ...base, g: 'cancelled', i: 0, pts: [1, 1, 2, 2] }, { nowMs: 0 });
  applyRemoteLiveStroke('doc', { ...base, g: 'ended', i: 0, pts: [1, 1, 2, 2], f: 1 }, { nowMs: 0 });
  applyRemoteLiveStroke('doc', { ...base, g: 'idle', i: 0, pts: [1, 1, 2, 2] }, { nowMs: 0 });
  applyRemoteLiveStroke('doc', { ...base, g: 'cancelled', i: 2, pts: [], x: 1 }, { nowMs: 1 });
  assert.equal(getLiveStrokesForPage(1, 'doc').some((s) => s.key.endsWith('cancelled')), false);
  markLiveStrokesLanded('doc', (id) => id === 'landed', { nowMs: 10 });
  assert.ok(getLiveStrokesForPage(1, 'doc').some((s) => s.key.endsWith('landed')), 'kept one moment so the real mark paints first');
  sweepLiveStrokes(10 + 200);
  assert.equal(getLiveStrokesForPage(1, 'doc').some((s) => s.key.endsWith('landed')), false);
  assert.equal(applyRemoteLiveStroke('doc', { ...base, g: 'landed', i: 2, pts: [3, 3] }, { nowMs: 300 }), false, 'a late batch is ignored');
  // A sender that vanished mid-stroke: 10 s. A lifted pen whose mark has
  // not arrived: kept as long as a preview would be (20 s; the row may be
  // slow, review B).
  sweepLiveStrokes(LIVE_STROKE_IDLE_TTL_MS + 1);
  assert.equal(getLiveStrokesForPage(1, 'doc').some((s) => s.key.endsWith('idle')), false);
  assert.ok(getLiveStrokesForPage(1, 'doc').some((s) => s.key.endsWith('ended')));
  sweepLiveStrokes(LIVE_STROKE_ENDED_TTL_MS + 1);
  assert.equal(getLiveStrokesForPage(1, 'doc').length, 0);
  __liveStrokesTest.reset();
});

test('end to end: a v3 message becomes a ghost on the other screen, the finished stroke replaces it, nothing is written', async () => {
  __liveStrokesTest.reset();
  const documentId = 'live-stroke-e2e';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId);
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  await settle(20);
  // A stroke message as Alice's screen sends it while she draws.
  cloud.inject({ v: 3, w: 'alice-writer', g: 'stroke-9', p: 1, t: 'pen', c: '#ff0000', sw: 3, i: 0, pts: [1, 1, 5, 5, 9, 9] });
  assert.ok(await until(() => getLiveStrokesForPage(1, documentId).some((s) => s.key.endsWith('stroke-9'))), 'the ghost shows');
  assert.equal(bob.appendCalls, 0, 'a ghost is never written');
  a.applyByPage({
    1: {
      objects: [{
        type: 'path', path: [['M', 1, 1], ['L', 9, 9]], stroke: '#ff0000', strokeWidth: 3,
        data: { id: 'stroke-9', type: 'pen' },
      }],
    },
  });
  await a.drain();
  assert.ok(await until(() => getLiveStrokesForPage(1, documentId).length === 0, { timeoutMs: 2_000 }), 'the finished mark replaces the ghost');
  assert.equal(bob.appendCalls, 0);
  await Promise.all([a.destroy(), b.destroy()]);
  __liveStrokesTest.reset();
});
