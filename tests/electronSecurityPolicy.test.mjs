import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import securityPolicy from '../src/electron/securityPolicy.cjs';

const {
  assertClearableDirectory,
  assertAtomicWriteTarget,
  assertTrustedIpcSender,
  allowedExcelOwnerNamesForDirectory,
  createTrustedIpcMain,
  isAllowedFilesystemPath,
  isAllowedExcelOwnerPath,
  isSameRedirectTarget,
  isSafeDiagnosticFileName,
  isTrustedAppUrl,
  parseDialogGrantStore,
  serializeDialogGrantStore,
} = securityPolicy;
const electronMainSource = readFileSync(new URL('../src/electron-main.js', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload.js', import.meta.url), 'utf8');
const pdfViewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const appShellSource = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('trusted app URL accepts the exact dev origin and rejects lookalikes', () => {
  const options = { isDevelopment: true, devPort: '5173', appPath: '/opt/Survey' };

  assert.equal(isTrustedAppUrl('http://localhost:5173/', options), true);
  assert.equal(isTrustedAppUrl('http://localhost:5173/invite/abc?mode=1#step', options), true);
  assert.equal(isTrustedAppUrl('http://localhost:5174/', options), false);
  assert.equal(isTrustedAppUrl('http://localhost.attacker.test:5173/', options), false);
  assert.equal(isTrustedAppUrl('https://localhost:5173/', options), false);
});

test('trusted app URL accepts only the packaged entry file', () => {
  const appPath = join('/opt', 'Survey');
  const entryUrl = pathToFileURL(join(appPath, 'dist', 'index.html')).href;
  const options = { isDevelopment: false, devPort: '5173', appPath };

  assert.equal(isTrustedAppUrl(`${entryUrl}?doc=1#page=2`, options), true);
  assert.equal(isTrustedAppUrl(pathToFileURL(join(appPath, 'dist', 'other.html')).href, options), false);
  assert.equal(isTrustedAppUrl('file://attacker/opt/Survey/dist/index.html', options), false);
  assert.equal(isTrustedAppUrl('https://login.microsoftonline.com/', options), false);
  assert.equal(isTrustedAppUrl('not a URL', options), false);
});

test('privileged IPC accepts only the trusted app main frame', () => {
  const options = { isDevelopment: true, devPort: '5173', appPath: '/opt/Survey' };
  const mainFrame = { url: 'http://localhost:5173/' };
  const trustedEvent = { sender: { mainFrame }, senderFrame: mainFrame };

  assert.doesNotThrow(() => assertTrustedIpcSender(trustedEvent, options));

  const untrustedFrame = { url: 'https://attacker.test/' };
  assert.throws(
    () => assertTrustedIpcSender({ sender: { mainFrame: untrustedFrame }, senderFrame: untrustedFrame }, options),
    (error) => error?.code === 'EPERM',
  );
  assert.throws(
    () => assertTrustedIpcSender({ sender: { mainFrame }, senderFrame: { url: mainFrame.url } }, options),
    (error) => error?.code === 'EPERM',
  );
  assert.throws(
    () => assertTrustedIpcSender({}, options),
    (error) => error?.code === 'EPERM',
  );
});

test('trusted IPC registration validates handle and on senders before invoking a handler', async () => {
  const registered = new Map();
  const rawIpcMain = {
    handle: (channel, handler) => registered.set(`handle:${channel}`, handler),
    on: (channel, handler) => registered.set(`on:${channel}`, handler),
  };
  const options = { isDevelopment: true, devPort: '5173', appPath: '/opt/Survey' };
  const trustedIpc = createTrustedIpcMain(rawIpcMain, () => options);
  const calls = [];
  trustedIpc.handle('fs:readFile', (_event, value) => { calls.push(value); return 'ok'; });
  trustedIpc.on('app:saveComplete', (_event, value) => { calls.push(value); });

  const frame = { url: 'http://localhost:5173/' };
  const trustedEvent = { sender: { mainFrame: frame }, senderFrame: frame };
  assert.equal(await registered.get('handle:fs:readFile')(trustedEvent, 'file.pdf'), 'ok');
  registered.get('on:app:saveComplete')(trustedEvent, 'saved');
  assert.deepEqual(calls, ['file.pdf', 'saved']);

  const externalFrame = { url: 'https://attacker.test/' };
  const externalEvent = { sender: { mainFrame: externalFrame }, senderFrame: externalFrame };
  await assert.rejects(
    registered.get('handle:fs:readFile')(externalEvent, 'secret'),
    (error) => error?.code === 'EPERM',
  );
  assert.doesNotThrow(() => registered.get('on:app:saveComplete')(externalEvent, 'forged'));
  assert.deepEqual(calls, ['file.pdf', 'saved']);
});

test('Electron main registers every app IPC channel through the trusted wrapper', () => {
  assert.match(electronMainSource, /createTrustedIpcMain/);
  assert.doesNotMatch(electronMainSource, /\bipcMain\.(?:handle|on)\(/);
  assert.match(
    electronMainSource,
    /registerMicrosoftAuthIpc\(\{ ipcMain: trustedIpcMain, app, shell, safeStorage \}\)/,
  );
});

test('main window prevents top-level navigation away from the trusted app URL', () => {
  assert.match(
    electronMainSource,
    /handleAppNavigation[\s\S]{0,300}!isTrustedAppUrl\(navigationUrl[\s\S]{0,150}event\.preventDefault\(\)/,
  );
  assert.match(electronMainSource, /win\.webContents\.on\('will-navigate', handleAppNavigation\)/);
});

test('main window applies the same trusted-app guard to redirect targets', () => {
  assert.match(electronMainSource, /win\.webContents\.on\('will-navigate', handleAppNavigation\)/);
  assert.match(electronMainSource, /win\.webContents\.on\('will-redirect', handleAppNavigation\)/);
});

test('OAuth callback matching compares exact scheme, host, port, and path', () => {
  const expected = 'http://localhost:5173/auth/callback';
  assert.equal(isSameRedirectTarget(`${expected}?code=abc`, expected), true);
  assert.equal(isSameRedirectTarget(`${expected}#access_token=abc`, expected), true);
  assert.equal(isSameRedirectTarget('http://localhost:5174/auth/callback?code=abc', expected), false);
  assert.equal(isSameRedirectTarget('http://localhost:5173/auth/callback.evil?code=abc', expected), false);
  assert.equal(isSameRedirectTarget('https://localhost:5173/auth/callback?code=abc', expected), false);
  assert.equal(isSameRedirectTarget('http://localhost.attacker.test:5173/auth/callback?code=abc', expected), false);
  assert.equal(isSameRedirectTarget('file:///Applications/Survey/index.html#access_token=abc', 'file:///Applications/Survey/index.html'), true);
});

test('isolated OAuth window uses exact callback matching instead of string prefixes', () => {
  assert.match(
    electronMainSource,
    /oauth:openWindow[\s\S]{0,2200}isSameRedirectTarget\(url, redirectUri\)/,
  );
  assert.doesNotMatch(electronMainSource, /url\.startsWith\(redirectUri\)/);
});

test('a native dialog grant authorizes exactly the selected file', () => {
  const options = {
    staticRoots: ['/app', '/home/user/OneDrive'],
    dialogFiles: ['/outside/customer/report.xlsx'],
  };

  assert.equal(isAllowedFilesystemPath('/outside/customer/report.xlsx', options), true);
  assert.equal(isAllowedFilesystemPath('/outside/customer/other.xlsx', options), false);
  assert.equal(isAllowedFilesystemPath('/outside/customer/report.xlsx.tmp', options), false);
  assert.equal(isAllowedFilesystemPath('/outside/customer/report.xlsx/child', options), false);
  assert.equal(isAllowedFilesystemPath('/app/cache/session.json', options), true);
  assert.equal(isAllowedFilesystemPath('/home/user/OneDrive/project/report.xlsx', options), true);
});

test('an exact Excel grant permits only its derived owner-file safety probe', () => {
  const dialogFiles = ['/outside/customer/report.xlsx'];

  assert.equal(isAllowedExcelOwnerPath('/outside/customer/~$report.xlsx', dialogFiles), true);
  assert.equal(isAllowedExcelOwnerPath('/outside/customer/~$other.xlsx', dialogFiles), false);
  assert.equal(isAllowedExcelOwnerPath('/outside/customer/report.xlsx.tmp', dialogFiles), false);
  assert.deepEqual(
    allowedExcelOwnerNamesForDirectory('/outside/customer', dialogFiles),
    ['~$report.xlsx'],
  );
  assert.deepEqual(allowedExcelOwnerNamesForDirectory('/outside', dialogFiles), []);
});

test('dialog grant persistence ignores the legacy parent-directory store', () => {
  assert.deepEqual(parseDialogGrantStore(JSON.stringify([
    '/outside/customer/report.xlsx',
    '/outside/customer',
  ])), []);
  assert.deepEqual(parseDialogGrantStore('{broken'), []);
  assert.deepEqual(parseDialogGrantStore(JSON.stringify({ version: 1, files: ['/outside/a.pdf'] })), []);
});

test('dialog grant persistence roundtrips only versioned absolute file paths', () => {
  const serialized = serializeDialogGrantStore([
    '/outside/customer/report.xlsx',
    '/outside/customer/report.xlsx',
    'relative.pdf',
    null,
  ]);

  assert.deepEqual(JSON.parse(serialized), {
    version: 2,
    files: ['/outside/customer/report.xlsx'],
  });
  assert.deepEqual(parseDialogGrantStore(serialized), ['/outside/customer/report.xlsx']);
});

test('recursive directory clearing is limited to an exact dedicated diagnostics directory', () => {
  const options = { clearableDirectories: ['/app/TestLogs'] };

  assert.doesNotThrow(() => assertClearableDirectory('/app/TestLogs', options));
  assert.throws(
    () => assertClearableDirectory('/app', options),
    (error) => error?.code === 'EPERM',
  );
  assert.throws(
    () => assertClearableDirectory('/app/TestLogs/archive', options),
    (error) => error?.code === 'EPERM',
  );
  assert.throws(
    () => assertClearableDirectory('/home/user/OneDrive', options),
    (error) => error?.code === 'EPERM',
  );
});

test('diagnostics filenames are flat safe basenames', () => {
  assert.equal(isSafeDiagnosticFileName('testlog-screenshot-eraser.png'), true);
  assert.equal(isSafeDiagnosticFileName('1.log'), true);
  assert.equal(isSafeDiagnosticFileName('../secret.txt'), false);
  assert.equal(isSafeDiagnosticFileName('nested/file.txt'), false);
  assert.equal(isSafeDiagnosticFileName('nested\\file.txt'), false);
  assert.equal(isSafeDiagnosticFileName(''), false);
});

test('atomic file writes reject a directory target before sibling files are created', () => {
  const root = mkdtempSync(join(tmpdir(), 'survey-atomic-target-'));
  const directoryTarget = join(root, 'report.pdf');
  const fileTarget = join(root, 'existing.pdf');
  const missingTarget = join(root, 'new.pdf');
  fs.mkdirSync(directoryTarget);
  fs.writeFileSync(fileTarget, 'pdf');

  try {
    assert.throws(
      () => assertAtomicWriteTarget(directoryTarget, fs),
      (error) => error?.code === 'EISDIR',
    );
    assert.doesNotThrow(() => assertAtomicWriteTarget(fileTarget, fs));
    assert.doesNotThrow(() => assertAtomicWriteTarget(missingTarget, fs));
    assert.equal(fs.existsSync(`${directoryTarget}.tmp`), false);
    assert.equal(fs.existsSync(`${directoryTarget}.bak`), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Electron filesystem handlers use the narrow policy and package it for production', () => {
  assert.match(electronMainSource, /isAllowedFilesystemPath\(/);
  assert.match(electronMainSource, /parseDialogGrantStore\(/);
  assert.match(electronMainSource, /serializeDialogGrantStore\(/);
  assert.match(
    electronMainSource,
    /fs:clearDir[\s\S]{0,250}assertClearableDirectory\(/,
  );
  assert.match(
    electronMainSource,
    /fs:writeFileAtomic[\s\S]{0,300}assertAtomicWriteTarget\(/,
  );
  assert.doesNotMatch(electronMainSource, /dialogAllowedPaths\.add\(path\.dirname/);
  assert.ok(packageJson.build.files.includes('src/electron/securityPolicy.cjs'));
});

test('diagnostics use one userData directory through narrow preload APIs', () => {
  assert.match(
    electronMainSource,
    /app\.getPath\('userData'\)[\s\S]{0,120}'Diagnostics'[\s\S]{0,80}'TestLogs'/,
  );
  assert.match(electronMainSource, /diagnostics:writeFile/);
  assert.match(preloadSource, /writeDiagnosticFile:/);
  assert.match(preloadSource, /clearDiagnostics:/);
  assert.doesNotMatch(preloadSource, /\bclearDir:/);
  assert.match(pdfViewerSource, /writeDiagnosticFile\(/);
  assert.match(appShellSource, /writeDiagnosticFile\(/);
  for (const source of [pdfViewerSource, appShellSource]) {
    assert.doesNotMatch(source, /\/Users\/isaiahcalvo\/Desktop\/Survey-BetaSafeS2/);
  }
});
