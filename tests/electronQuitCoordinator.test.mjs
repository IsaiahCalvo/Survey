import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQuitCoordinator, DEFAULT_FALLBACK_MS } from '../src/electron/quitCoordinator.cjs';

const electronMain = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/electron-main.js'),
  'utf8',
);

test('P2-11 wiring: electron-main quits on saveComplete, not a 5s hang', () => {
  assert.match(electronMain, /createQuitCoordinator/);
  assert.match(electronMain, /quitCoordinator\.markSaveComplete\(\)/);
  assert.doesNotMatch(electronMain, /actual quit happens via timeout/);
  assert.doesNotMatch(electronMain, /setTimeout\(checkAndQuit, 5000\)/);
});

function makeCoordinator() {
  const timers = [];
  let quitCount = 0;
  const coordinator = createQuitCoordinator({
    fallbackMs: 50,
    schedule: (fn, ms) => {
      const id = timers.length + 1;
      timers.push({ id, fn, ms });
      return id;
    },
    clearSchedule: (id) => {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx >= 0) timers.splice(idx, 1);
    },
    onQuit: () => { quitCount += 1; },
  });
  return { coordinator, timers, getQuitCount: () => quitCount };
}

test('P2-11 intended: saveComplete quits immediately without waiting for the fallback', () => {
  const { coordinator, timers, getQuitCount } = makeCoordinator();
  const win = { isDestroyed: () => false };
  const decision = coordinator.beginQuit({ windows: [win] });
  assert.equal(decision.preventDefault, true);
  assert.equal(timers.length, 1);
  const result = coordinator.markSaveComplete();
  assert.equal(result.quit, true);
  assert.equal(getQuitCount(), 1);
  assert.equal(timers.length, 0);
});

test('P2-11 break: a second saveComplete after quit is a no-op', () => {
  const { coordinator, getQuitCount } = makeCoordinator();
  coordinator.beginQuit({ windows: [{ isDestroyed: () => false }] });
  coordinator.markSaveComplete();
  const again = coordinator.markSaveComplete();
  assert.equal(again.quit, false);
  assert.equal(getQuitCount(), 1);
});

test('P2-11 break: saveComplete before beginQuit does not quit', () => {
  const { coordinator, getQuitCount } = makeCoordinator();
  const result = coordinator.markSaveComplete();
  assert.equal(result.quit, false);
  assert.equal(getQuitCount(), 0);
});

test('P2-11 edge: zero windows quits immediately', () => {
  const { coordinator, getQuitCount, timers } = makeCoordinator();
  const decision = coordinator.beginQuit({ windows: [] });
  assert.equal(decision.committed, true);
  assert.equal(getQuitCount(), 1);
  assert.equal(timers.length, 0);
});

test('P2-11 edge: two windows wait for both saveCompletes; fallback still exists', () => {
  const { coordinator, timers, getQuitCount } = makeCoordinator();
  coordinator.beginQuit({
    windows: [{ isDestroyed: () => false }, { isDestroyed: () => false }],
  });
  assert.equal(coordinator.markSaveComplete().quit, false);
  assert.equal(getQuitCount(), 0);
  assert.equal(coordinator.markSaveComplete().quit, true);
  assert.equal(getQuitCount(), 1);
  assert.equal(timers.length, 0);
});

test('P2-11 edge: fallback quits if a renderer never reports saveComplete', () => {
  const { coordinator, timers, getQuitCount } = makeCoordinator();
  coordinator.beginQuit({ windows: [{ isDestroyed: () => false }] });
  assert.equal(getQuitCount(), 0);
  timers[0].fn();
  assert.equal(getQuitCount(), 1);
  assert.ok(DEFAULT_FALLBACK_MS > 5000);
});
