import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createNativeQuitCoordinator } = require('../src/electron/nativeQuitCoordinator.cjs');
const source = await readFile(new URL('../src/electron-main.js', import.meta.url), 'utf8');
const start = source.indexOf('function restoreNativeQuitMenu()');
const end = source.indexOf("app.on('window-all-closed'", start);
assert.ok(start >= 0 && end > start);

function lifecycle() {
  const appHandlers = new Map();
  const ipcHandlers = new Map();
  const state = { quits: 0, updates: 0, watchersClosed: 0, prevented: 0, timers: new Map(), messages: [], errors: [] };
  const app = { on: (event, handler) => appHandlers.set(event, handler), whenReady: () => ({ then() {} }), quit: () => { state.quits++; } };
  const window = (id) => {
    const handlers = new Map();
    const frame = {};
    let destroyed = false;
    const win = {
      on: (name, fn) => handlers.set(name, fn), once: (name, fn) => handlers.set(name, fn),
      isDestroyed: () => destroyed,
      webContents: { id, mainFrame: frame,
        on: (name, fn) => handlers.set(name, fn),
        send: (name, payload) => state.messages.push({ id, name, ...payload }),
      },
      close() { let blocked = false; handlers.get('close')?.({ preventDefault: () => { blocked = true; } });
        if (!blocked) { destroyed = true; handlers.get('closed')?.(); } },
      emit: (name) => handlers.get(name)?.(),
    };
    return win;
  };
  const windows = [window(1), window(2)];
  let timer = 0;
  const api = Function('app', 'ipcMain', 'fileWatchers', 'console', 'Menu', 'dialog', 'surveyMainWindow',
    'nativeEditorWindows', 'allowedNativeCloseIds', 'nativeExitAllowed', 'nativeQuitMenu', 'autoUpdater',
    'createNativeQuitCoordinator', `${source.slice(start, end)}\nreturn { registerNativeEditorWindow, requestNativeExit };`)(
    app, { on: (name, fn) => ipcHandlers.set(name, fn) },
    new Map([['watcher', { close: () => { state.watchersClosed++; } }]]), { warn() {} },
    { getApplicationMenu: () => ({}), setApplicationMenu() {} },
    { showMessageBox: (...args) => { state.errors.push(args.at(-1)); return Promise.resolve(); } }, windows[0],
    new Map(), new Set(), false, null, { quitAndInstall: () => { state.updates++; } },
    (options) => createNativeQuitCoordinator({ ...options,
      setTimer: (callback) => { state.timers.set(++timer, callback); return timer; },
      clearTimer: (id) => state.timers.delete(id),
    }),
  );
  windows.forEach(api.registerNativeEditorWindow);
  return { state, windows, api,
    quit: () => appHandlers.get('before-quit')({ preventDefault: () => { state.prevented++; } }),
    report: (id, saved = true, frame = null, override = {}) => {
      const win = windows.find((entry) => entry.webContents.id === id);
      const request = state.messages.findLast((entry) => entry.id === id && entry.phase !== 'cancel');
      ipcHandlers.get('app:saveComplete')({ sender: win.webContents, senderFrame: frame || win.webContents.mainFrame },
        { ...request, saved, tabIds: [`tab-${id}`], ...override });
    },
    expire: () => [...state.timers.values()].forEach((callback) => callback()),
  };
}

test('real main-process quit blocks repeated requests and exits only after every prepare and confirm', () => {
  const h = lifecycle(); h.quit(); h.quit();
  assert.equal(h.state.prevented, 2);
  assert.equal(h.state.messages.length, 2);
  h.report(1); h.report(2); h.report(1);
  assert.equal(h.state.quits, 0);
  h.report(2);
  assert.equal(h.state.quits, 1);
  assert.equal(h.state.watchersClosed, 1);
});

test('failure and timeout keep the app open, show a native error, and ignore late replies', () => {
  for (const timeout of [true, false]) {
    const h = lifecycle(); h.quit();
    if (timeout) h.expire(); else h.report(1, false);
    h.report(2); h.report(1);
    assert.equal(h.state.quits, 0);
    assert.equal(h.state.watchersClosed, 0);
    assert.equal(h.state.errors.length, 1);
    assert.equal(h.state.errors[0].buttons[0], 'Keep open');
  }
});

test('main-frame sender and renderer generation are required', () => {
  const h = lifecycle(); h.quit();
  h.report(1, true, {});
  h.report(2, true, null, { generation: 999 });
  assert.equal(h.state.messages.length, 2);
  h.expire();
  assert.equal(h.state.quits, 0);
});

test('window close saves only its editor, while updater restart saves every editor first', () => {
  const h = lifecycle(); h.windows[0].close();
  assert.equal(h.windows[0].isDestroyed(), false);
  assert.equal(h.state.messages.length, 1);
  h.report(1); h.report(1);
  assert.equal(h.windows[0].isDestroyed(), true);
  assert.equal(h.windows[1].isDestroyed(), false);
  const update = lifecycle(); update.api.requestNativeExit({ kind: 'update' });
  assert.equal(update.state.updates, 0);
  update.report(1); update.report(2); update.report(1); update.report(2);
  assert.equal(update.state.updates, 1);
  assert.equal((source.match(/autoUpdater\.quitAndInstall\(/g) || []).length, 1, 'all updater callers use the preflight');
});

test('renderer reload cancels a pending quit; a later retry uses its new generation', () => {
  const h = lifecycle(); h.quit(); h.windows[0].emit('did-start-loading');
  assert.equal(h.state.errors.length, 1);
  assert.equal(h.state.quits, 0);
  h.quit(); h.report(1); h.report(2); h.report(1); h.report(2);
  assert.equal(h.state.quits, 1);
});
