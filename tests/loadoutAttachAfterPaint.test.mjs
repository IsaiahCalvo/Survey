// Smoothness: opening a side panel (Pages, Search text) cost a ~60 ms frame,
// and ~24 ms of it was the Select button setting up its loadout animation
// inside the commit that built the panel: its first snapshot reads styles and
// boxes, and each read forced a style and layout pass of the new panel. The
// setup now runs once the panel has painted (afterPaint), where the same reads
// are free. Measured on a rail panel toggle: input-to-paint 64 -> 48 ms
// (Pages open), 72 -> 56 ms (Search text close).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterPaint } from '../src/utils/loadoutTransition.js';

function fakeWindow() {
  const frames = new Map();
  const timers = new Map();
  let next = 1;
  return {
    requestAnimationFrame: (fn) => { const id = next++; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (fn) => { const id = next++; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
    paint() { const run = [...frames.values()]; frames.clear(); run.forEach((fn) => fn(0)); },
    tick() { const run = [...timers.values()]; timers.clear(); run.forEach((fn) => fn()); },
  };
}

test('afterPaint runs after the next frame, in its own task', () => {
  const win = fakeWindow();
  const calls = [];
  afterPaint(() => calls.push('ran'), win);
  win.tick();
  assert.deepEqual(calls, [], 'not before the frame');
  win.paint();
  assert.deepEqual(calls, [], 'not inside the frame callback');
  win.tick();
  assert.deepEqual(calls, ['ran']);
});

test('afterPaint can be cancelled before the frame or before the task', () => {
  const win = fakeWindow();
  const calls = [];
  afterPaint(() => calls.push('a'), win)();
  win.paint(); win.tick();
  const cancel = afterPaint(() => calls.push('b'), win);
  win.paint();
  cancel();
  win.tick();
  assert.deepEqual(calls, []);
});

test('the Select button sets up its loadout animation after paint, not in the commit', () => {
  const source = readFileSync(new URL('../src/components/SectionIconButton.jsx', import.meta.url), 'utf8');
  const at = source.indexOf("const parent = head?.classList.contains('hub-section-head') ? head : own;");
  assert.ok(at > 0);
  const effect = source.slice(at, source.indexOf('}, [action]);', at));
  assert.match(effect, /const cancel = afterPaint\(attach\);/);
  assert.match(effect, /return \(\) => \{ cancel\(\); undo\?\.\(\); \};/);
  // Every style / box read lives inside the deferred attach.
  const beforeAttach = effect.slice(0, effect.indexOf('const attach = () => {'));
  assert.doesNotMatch(beforeAttach, /getComputedStyle|attachLoadoutTransition\(/);
});
