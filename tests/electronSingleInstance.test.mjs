import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimSingleInstance, focusExistingWindow } from '../src/electron/singleInstance.cjs';

const electronMain = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/electron-main.js'),
  'utf8',
);

test('P2-36 wiring: electron-main claims the single-instance lock', () => {
  assert.match(electronMain, /claimSingleInstance/);
  assert.match(electronMain, /requestSingleInstanceLock/);
  assert.match(electronMain, /second-instance/);
  assert.match(electronMain, /focusExistingWindow/);
});

test('P2-36 intended: first process keeps the lock and does not quit', () => {
  let quitCalled = false;
  const result = claimSingleInstance({
    requestLock: () => true,
    quit: () => { quitCalled = true; },
  });
  assert.deepEqual(result, { gotLock: true, quitCalled: false });
  assert.equal(quitCalled, false);
});

test('P2-36 break: second process releases immediately', () => {
  let quitCalled = false;
  const result = claimSingleInstance({
    requestLock: () => false,
    quit: () => { quitCalled = true; },
  });
  assert.equal(result.gotLock, false);
  assert.equal(result.quitCalled, true);
  assert.equal(quitCalled, true);
});

test('P2-36 edge: missing requestLock fails closed without throwing', () => {
  const result = claimSingleInstance({});
  assert.equal(result.gotLock, false);
  assert.equal(result.quitCalled, false);
});

test('P2-36 intended: second-instance focuses a live window', () => {
  const calls = [];
  const win = {
    isDestroyed: () => false,
    isMinimized: () => false,
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
  assert.equal(focusExistingWindow(win), true);
  assert.deepEqual(calls, ['show', 'focus']);
});

test('P2-36 edge: destroyed or missing window is a no-op', () => {
  assert.equal(focusExistingWindow(null), false);
  assert.equal(focusExistingWindow({ isDestroyed: () => true }), false);
});

test('P2-36 edge: minimized window is restored before focus', () => {
  const calls = [];
  const win = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
  assert.equal(focusExistingWindow(win), true);
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
});
