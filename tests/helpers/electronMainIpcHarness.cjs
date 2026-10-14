// Loads the REAL src/electron-main.js with a stub `electron` module, then
// drives its IPC handlers the way a renderer would and prints one JSON line
// per probe. Run as a child process by tests/electronMainIpcGuard.test.mjs
// (KAL-369) so electron-main's timers and watchers die with the process.
//
// usage: node electronMainIpcHarness.cjs <repo root>
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');

const repo = process.argv[2];
const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'k369-app-'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'k369-userdata-'));
// Outside every trusted root (app, userData, tmp, OneDrive, CloudStorage).
const outside = fs.mkdtempSync(path.join(os.homedir(), '.k369-outside-'));

const noop = () => {};
// Permissive stand-in for any Electron object electron-main touches at load.
const loose = () => new Proxy(function stub() {}, {
  get: (_t, key) => {
    if (key === 'then' || typeof key === 'symbol') return undefined;
    if (key === 'toString' || key === 'valueOf') return () => '';
    return loose();
  },
  apply: () => loose(),
  construct: () => loose(),
});
const withFallback = (target) => new Proxy(target, {
  get: (t, key) => (key in t ? t[key] : (key === 'then' || typeof key === 'symbol' ? undefined : loose())),
});

const handlers = new Map();
const windows = [];
const app = withFallback({
  getAppPath: () => appPath,
  getPath: () => userData,
  isPackaged: false,
  whenReady: () => Promise.resolve(),
  on: noop,
  once: noop,
  getVersion: () => '0.0.0',
  getName: () => 'Survey',
  quit: noop,
});
function BrowserWindow() {
  const win = withFallback({ webContents: withFallback({ id: `wc-${windows.length}` }) });
  windows.push(win);
  return win;
}
BrowserWindow.getAllWindows = () => windows;
BrowserWindow.fromWebContents = () => null;
const electron = {
  app,
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on: noop, removeHandler: noop },
  BrowserWindow,
  dialog: loose(),
  shell: loose(),
  Menu: loose(),
  safeStorage: loose(),
};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return electron;
  if (request === 'electron-updater') return { autoUpdater: loose() };
  return originalLoad.call(this, request, ...rest);
};

const quiet = { log: console.log, warn: console.warn, error: console.error, info: console.info };
console.log = console.warn = console.error = console.info = noop;
require(path.join(repo, 'src', 'electron-main.js'));

const report = (name, value) => process.stdout.write(`${JSON.stringify({ name, value })}\n`);
async function outcome(fn) {
  try {
    const value = await fn();
    return { served: true, value: Buffer.isBuffer(value) ? value.toString('utf8') : value };
  } catch (error) {
    return { served: false, code: error?.code || null };
  }
}

(async () => {
  const stranger = { sender: { id: 'not-the-app' }, senderFrame: { url: 'https://evil.example/' } };
  report('beforeWindow:os:getHomeDir', await outcome(() => handlers.get('os:getHomeDir')(stranger)));
  report('beforeWindow:msauth:status', await outcome(() => handlers.get('msauth:status')(stranger)));

  await new Promise((resolve) => setTimeout(resolve, 100)); // whenReady -> createWindow
  const main = windows[0];
  const appPage = { sender: main.webContents, senderFrame: { url: `file://${path.join(appPath, 'dist', 'index.html')}` } };
  const navigatedAway = { sender: main.webContents, senderFrame: { url: 'https://accounts.example.com/' } };
  report('appPage:os:getHomeDir', await outcome(() => handlers.get('os:getHomeDir')(appPage)));
  report('navigatedAway:os:getHomeDir', await outcome(() => handlers.get('os:getHomeDir')(navigatedAway)));

  const testLogs = path.join(appPath, 'TestLogs');
  fs.mkdirSync(testLogs, { recursive: true });
  fs.writeFileSync(path.join(testLogs, 'old.log'), 'old');
  fs.writeFileSync(path.join(appPath, 'keep.txt'), 'keep');
  report('clearDir:TestLogs', await outcome(() => handlers.get('fs:clearDir')(appPage, testLogs)));
  report('clearDir:TestLogs:emptied', !fs.existsSync(path.join(testLogs, 'old.log')));
  report('clearDir:appFolder', await outcome(() => handlers.get('fs:clearDir')(appPage, appPath)));
  report('clearDir:appFolder:kept', fs.existsSync(path.join(appPath, 'keep.txt')));
  report('clearDir:userData', await outcome(() => handlers.get('fs:clearDir')(appPage, userData)));

  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(userData, 'escape'), 'dir');
  report('readFile:viaLink', await outcome(() => handlers.get('fs:readFile')(appPage, path.join(userData, 'escape', 'secret.txt'))));
  report('writeFile:viaLink', await outcome(() => handlers.get('fs:writeFile')(appPage, { path: path.join(userData, 'escape', 'planted.txt'), data: [1] })));
  report('writeFile:viaLink:created', fs.existsSync(path.join(outside, 'planted.txt')));
  fs.writeFileSync(path.join(userData, 'ok.txt'), 'fine');
  report('readFile:plain', await outcome(() => handlers.get('fs:readFile')(appPage, path.join(userData, 'ok.txt'))));
  report('writeFile:plain', await outcome(() => handlers.get('fs:writeFile')(appPage, { path: path.join(userData, 'sub', 'new.txt'), data: [104, 105] })));
  report('writeFile:plain:content', fs.readFileSync(path.join(userData, 'sub', 'new.txt'), 'utf8'));
})().catch((error) => {
  quiet.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const dir of [appPath, userData, outside]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { quiet.error(`cleanup ${dir}: ${error.message}`); }
  }
  process.exit();
});
