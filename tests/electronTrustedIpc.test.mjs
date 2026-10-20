// KAL-369: privileged desktop IPC is served only to the Survey app window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTrustedIpcMain } = require('../src/electron/trustedIpc.cjs');
const { isTrustedElectronAnalyticsSender } = require('../src/electronAnalyticsBridge.js');

function fakeIpcMain() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    handle(channel, fn) { handlers.set(channel, fn); },
    on(channel, fn) { listeners.set(channel, fn); },
    removeHandler(channel) { handlers.delete(channel); },
  };
}

const quietLogger = { warn() {} };
const appEvent = { trusted: true, senderFrame: { url: 'file:///app/dist/index.html' } };
const strangerEvent = { trusted: false, senderFrame: { url: 'https://evil.example/' } };

test('handle(): the app window gets the handler result', async () => {
  const raw = fakeIpcMain();
  const ipc = createTrustedIpcMain(raw, (event) => event.trusted, { logger: quietLogger });
  ipc.handle('fs:readFile', async (_event, p) => `read ${p}`);
  assert.equal(await raw.handlers.get('fs:readFile')(appEvent, '/x'), 'read /x');
});

test('handle(): any other sender is refused with EPERM and the handler never runs', async () => {
  const raw = fakeIpcMain();
  const warnings = [];
  const ipc = createTrustedIpcMain(raw, (event) => event.trusted, { logger: { warn: (m) => warnings.push(m) } });
  let ran = false;
  ipc.handle('fs:writeFile', () => { ran = true; });
  assert.throws(() => raw.handlers.get('fs:writeFile')(strangerEvent, {}), (err) => err.code === 'EPERM' && /fs:writeFile/.test(err.message));
  assert.equal(ran, false);
  assert.match(warnings[0], /refused fs:writeFile from https:\/\/evil\.example\//);
});

test('a throwing or non-true trust check fails closed', () => {
  const raw = fakeIpcMain();
  let ran = 0;
  createTrustedIpcMain(raw, () => { throw new Error('boom'); }, { logger: quietLogger }).handle('a', () => { ran += 1; });
  createTrustedIpcMain(raw, () => 'yes', { logger: quietLogger }).handle('b', () => { ran += 1; });
  assert.throws(() => raw.handlers.get('a')(appEvent), { code: 'EPERM' });
  assert.throws(() => raw.handlers.get('b')(appEvent), { code: 'EPERM' });
  assert.equal(ran, 0);
});

test('on(): messages from other senders are dropped, the app window gets through', () => {
  const raw = fakeIpcMain();
  const ipc = createTrustedIpcMain(raw, (event) => event.trusted, { logger: quietLogger });
  const seen = [];
  ipc.on('app:saveComplete', (_event, result) => seen.push(result));
  raw.listeners.get('app:saveComplete')(strangerEvent, 'forged');
  raw.listeners.get('app:saveComplete')(appEvent, 'real');
  assert.deepEqual(seen, ['real']);
});

test('it refuses to build without an ipcMain or a trust check', () => {
  assert.throws(() => createTrustedIpcMain(null, () => true), TypeError);
  assert.throws(() => createTrustedIpcMain(fakeIpcMain(), null), TypeError);
});

test('the app-window test electron-main uses accepts the app page and nothing else', () => {
  const main = { id: 'main' };
  const base = { mainWebContents: main, development: false, devPort: '5173', appPath: '/Apps/Survey.app/Contents/Resources/app.asar', platform: 'darwin' };
  const appUrl = 'file:///Apps/Survey.app/Contents/Resources/app.asar/dist/index.html#/doc';
  assert.equal(isTrustedElectronAnalyticsSender({ ...base, senderWebContents: main, senderUrl: appUrl }), true);
  // Same window, but it was navigated to another site.
  assert.equal(isTrustedElectronAnalyticsSender({ ...base, senderWebContents: main, senderUrl: 'https://accounts.example.com/login' }), false);
  // Another window (print / sign-in) loading the same file.
  assert.equal(isTrustedElectronAnalyticsSender({ ...base, senderWebContents: { id: 'other' }, senderUrl: appUrl }), false);
  // Main window gone (closed): nothing is trusted.
  assert.equal(isTrustedElectronAnalyticsSender({ ...base, mainWebContents: undefined, senderWebContents: undefined, senderUrl: appUrl }), false);
  // Dev server page.
  assert.equal(isTrustedElectronAnalyticsSender({ ...base, development: true, senderWebContents: main, senderUrl: 'http://localhost:5173/?testPdf=a.pdf' }), true);
  assert.equal(isTrustedElectronAnalyticsSender({ ...base, development: true, senderWebContents: main, senderUrl: 'http://localhost:5174/' }), false);
});

test('electron-main registers every IPC handler through the trusted wrapper', () => {
  const source = readFileSync(new URL('../src/electron-main.js', import.meta.url), 'utf8');
  assert.match(source, /const \{ app, BrowserWindow, ipcMain: electronIpcMain, /);
  assert.match(source, /const ipcMain = createTrustedIpcMain\(electronIpcMain, isTrustedAppIpcEvent\);/);
  // The raw Electron ipcMain is used for nothing else.
  assert.equal(source.match(/electronIpcMain/g).length, 2);
  // The trust check is the main-window + app-URL test analytics already used.
  const check = source.slice(source.indexOf('function isTrustedAppIpcEvent'), source.indexOf('const ipcMain = createTrustedIpcMain'));
  assert.match(check, /mainWebContents: surveyMainWindow\?\.webContents/);
  assert.match(check, /senderUrl: String\(event\?\.senderFrame\?\.url \|\| ''\)/);
  // Every registration below the wrapper goes through it, Microsoft sign-in included.
  assert.ok(source.indexOf('const ipcMain = createTrustedIpcMain') < source.indexOf("ipcMain.handle('updater:check'"));
  assert.match(source, /registerMicrosoftAuthIpc\(\{ ipcMain, app, shell, safeStorage \}\)/);
});

test('electron-main: allowlist follows links and clearDir only clears TestLogs', () => {
  const source = readFileSync(new URL('../src/electron-main.js', import.meta.url), 'utf8');
  const assertFn = source.slice(source.indexOf('function assertAllowedPath'), source.indexOf("ipcMain.handle('analytics:track'"));
  assert.match(assertFn, /isPathAllowed\(resolved, \{ entries: \[\.\.\.dialogAllowedPaths, \.\.\.buildAllowedRoots\(\)\] \}\)/);
  assert.doesNotMatch(assertFn, /resolved\.startsWith\(/);
  const clearDir = source.slice(source.indexOf("ipcMain.handle('fs:clearDir'"), source.indexOf("ipcMain.handle('screenshot:capturePage'"));
  assert.match(clearDir, /assertAllowedPath\(dirPath, \{ forWrite: true \}\);/);
  assert.match(clearDir, /isClearableDirectory\(dirPath, DIAGNOSTICS_CLEARABLE_DIRS\(\)\)/);
  assert.ok(clearDir.indexOf('isClearableDirectory') < clearDir.indexOf('rmSync'));
  assert.match(source, /const DIAGNOSTICS_CLEARABLE_DIRS = \(\) => \[path\.join\(app\.getAppPath\(\), 'TestLogs'\)\];/);
});
