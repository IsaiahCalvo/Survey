import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/electron-main.js', import.meta.url), 'utf8');
const start = source.indexOf('let isQuitting = false;');
const end = source.indexOf("app.on('window-all-closed'", start);
assert.ok(start >= 0 && end > start);

function lifecycle() {
  const appHandlers = new Map();
  const ipcHandlers = new Map();
  const state = { quits: 0, watchersClosed: 0, prevented: 0, timers: [], requests: 0, quitAttemptId: null };
  const app = {
    on: (event, handler) => appHandlers.set(event, handler),
    whenReady: () => ({ then() {} }),
    quit: () => { state.quits++; },
  };
  Function('app', 'ipcMain', 'BrowserWindow', 'fileWatchers', 'setTimeout', 'console', source.slice(start, end))(
    app,
    { on: (event, handler) => ipcHandlers.set(event, handler) },
    { getAllWindows: () => [1, 2].map(() => ({ isDestroyed: () => false, webContents: { send: (event, payload) => { state.requests++; state.quitAttemptId = payload.quitAttemptId; } } })) },
    new Map([['watcher', { close: () => { state.watchersClosed++; } }]]),
    callback => { state.timers.push(callback); },
    { warn() {} },
  );
  return {
    state,
    quit: () => appHandlers.get('before-quit')({ preventDefault: () => { state.prevented++; } }),
    report: (saved, quitAttemptId = state.quitAttemptId) => ipcHandlers.get('app:saveComplete')({}, { saved, quitAttemptId }),
    runTimers: () => { const timers = state.timers.splice(0); timers.forEach(callback => callback()); },
  };
}

test('any failed tab save cancels quit despite later successes and fallback timers', () => {
  const task = lifecycle();
  task.quit();
  task.report(false);
  task.report(true);
  task.runTimers();
  task.runTimers();
  assert.equal(task.state.quits, 0);
  assert.equal(task.state.watchersClosed, 0);
});

test('failure after grace timeout but before final quit still cancels quit', () => {
  const task = lifecycle();
  task.quit();
  task.runTimers();
  task.report(false);
  task.runTimers();
  assert.equal(task.state.quits, 0);
});

test('a later explicit retry succeeds; callbacks from failed attempt stay inert', () => {
  const task = lifecycle();
  task.quit();
  task.report(false);
  task.quit();
  task.report(true);
  task.runTimers();
  task.runTimers();
  assert.equal(task.state.requests, 4);
  assert.equal(task.state.prevented, 2);
  assert.equal(task.state.quits, 1);
  assert.equal(task.state.watchersClosed, 1);
});

test('successful save messages preserve the existing grace period', () => {
  const task = lifecycle();
  task.quit();
  task.report(true);
  assert.equal(task.state.quits, 0);
  task.runTimers();
  assert.equal(task.state.quits, 0);
  task.runTimers();
  assert.equal(task.state.quits, 1);
});

test('a delayed failure from a prior quit cannot cancel a later successful retry', () => {
  const task = lifecycle();
  task.quit();
  const oldAttempt = task.state.quitAttemptId;
  task.report(false);
  task.quit();
  task.report(false, oldAttempt);
  task.report(true);
  task.runTimers();
  task.runTimers();
  assert.equal(task.state.quits, 1);
});
