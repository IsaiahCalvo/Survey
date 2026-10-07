// Owner 2026-10-06 (smooth zoom at every level): while a gesture moves the
// page, pages that already show a bitmap are not redrawn (they sharpen once it
// stops); during a pinch nothing draws (src/utils/pageRasterQueue.js kinds).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { comparePageRasterPriority, createPageRasterQueue } from '../src/utils/pageRasterQueue.js';

const CONTAINER = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// A frame scheduler the test steps by hand.
const manualFrames = () => {
  const queued = [];
  return { schedule: (fn) => { queued.push(fn); }, flush: () => { const run = queued.splice(0); run.forEach((fn) => fn()); return run.length; } };
};

test('on screen first, then a blank page before a soft one, then the nearest page', () => {
  const order = { isVisible: (i) => i < 4, focusIndex: () => 0 };
  const jobs = [[3, 'sharpen'], [2, 'fill'], [9, 'fill'], [1, 'prefetch'], [0, 'sharpen']];
  jobs.sort((a, b) => comparePageRasterPriority(a[0], b[0], order, a[1], b[1]));
  assert.deepEqual(jobs, [[2, 'fill'], [0, 'sharpen'], [3, 'sharpen'], [1, 'prefetch'], [9, 'fill']]);
});

test('while the page moves, a blank page still draws but a soft page waits', async () => {
  let moving = true;
  const queue = createPageRasterQueue({ isHeld: (kind) => moving && kind !== 'fill' });
  const started = [];
  const soft = queue.request(0, { kind: 'sharpen' }); soft.ready.then(() => started.push('sharpen 0'));
  const blank = queue.request(1, { kind: 'fill' }); blank.ready.then(() => started.push('fill 1'));
  await tick();
  assert.deepEqual(started, ['fill 1']);
  blank.release();
  await tick();
  assert.deepEqual(started, ['fill 1'], 'nothing else may start while it moves');
  moving = false;
  queue.pump(); // the viewer pumps once the page has been still for a moment
  await tick();
  assert.deepEqual(started, ['fill 1', 'sharpen 0']);
  soft.release();
});

test('a pinch holds every kind; the turn starts when the fingers lift', async () => {
  let pinching = true;
  const queue = createPageRasterQueue({ isHeld: () => pinching });
  let started = false;
  const t = queue.request(2, { kind: 'fill' });
  t.ready.then(() => { started = true; });
  await tick();
  assert.equal(started, false);
  pinching = false;
  queue.pump();
  await tick();
  assert.equal(started, true);
  t.release();
});

test('a draw already running pauses at its next slice and resumes after the gesture', async () => {
  let moving = false;
  const frames = manualFrames();
  const queue = createPageRasterQueue({ isHeld: (kind) => moving && kind !== 'fill', schedule: frames.schedule });
  const t = queue.request(0, { kind: 'sharpen' });
  await t.ready;
  assert.equal(t.claim(), true);
  let slices = 0;
  const slice = () => { slices += 1; };
  t.continue(slice);
  assert.equal(frames.flush(), 1, 'not moving: the next slice runs next frame');
  assert.equal(slices, 1);
  moving = true;
  t.continue(slice);
  assert.equal(frames.flush(), 0, 'moving: the slice is held');
  assert.equal(slices, 1);
  moving = false;
  queue.pump();
  assert.equal(frames.flush(), 1, 'still again: it resumes where it paused');
  assert.equal(slices, 2);
  t.release();
});

test('a held draw gives way to a page that has nothing on screen', async () => {
  let moving = false;
  const queue = createPageRasterQueue({ isHeld: (kind) => moving && kind !== 'fill', schedule: () => {} });
  let stopped = 0;
  const soft = queue.request(0, { kind: 'sharpen', onPreempt: () => { stopped += 1; } });
  await soft.ready;
  soft.claim();
  moving = true;
  soft.continue(() => {});
  const blank = queue.request(5, { kind: 'fill' });
  assert.equal(stopped, 1, 'the paused sharpen is stopped');
  let blankStarted = false;
  blank.ready.then(() => { blankStarted = true; });
  soft.release();
  await tick();
  assert.equal(blankStarted, true);
  blank.release();
});

test('a prefetch gives way to any page that can draw', async () => {
  const queue = createPageRasterQueue({ isVisible: () => false });
  let stopped = 0;
  const ahead = queue.request(7, { kind: 'prefetch', onPreempt: () => { stopped += 1; } });
  await ahead.ready;
  queue.request(8, { kind: 'sharpen' });
  assert.equal(stopped, 1);
  ahead.release();
});

test('the viewer holds soft pages while moving and every draw during a pinch', () => {
  assert.match(CONTAINER, /isHeld: \(kind\) => gestureHoldsRasterRef\.current\(kind\)/);
  assert.match(CONTAINER, /if \(zoomInteractionRef\.current \|\| mobileTouchRef\.current\?\.mode === 'pinch'\) return true;/);
  assert.match(CONTAINER, /return moving && kind !== 'fill';/);
  // and pumps the line once the page is still
  assert.match(CONTAINER, /if \(gestureHoldsRasterRef\.current\(\)\) \{ scheduleRasterQuietPump\(\); return; \}/);
});
