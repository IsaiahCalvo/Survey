import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { isExpectedElectronAnalyticsEntry, isTrustedElectronAnalyticsSender } = require('../src/electronAnalyticsBridge.js');
const appPath = path.resolve('/Applications/Survey.app/Contents/Resources/app.asar');
const expectedFile = pathToFileURL(path.join(appPath, 'dist', 'index.html')).href;

test('packaged analytics accepts only the exact app entry, never arbitrary file URLs', () => {
  assert.equal(isExpectedElectronAnalyticsEntry({ senderUrl: expectedFile, development: false, appPath, platform: 'darwin' }), true);
  assert.equal(isExpectedElectronAnalyticsEntry({ senderUrl: 'file:///tmp/attacker.html', development: false, appPath, platform: 'darwin' }), false);
  assert.equal(isExpectedElectronAnalyticsEntry({ senderUrl: `${expectedFile}/attacker`, development: false, appPath, platform: 'darwin' }), false);
});

test('analytics IPC also requires identity with the main window webContents', () => {
  const main = {};
  const base = {
    mainWebContents: main,
    senderUrl: expectedFile,
    development: false,
    appPath,
    platform: 'darwin',
  };
  assert.equal(isTrustedElectronAnalyticsSender({ ...base, senderWebContents: main }), true);
  assert.equal(isTrustedElectronAnalyticsSender({ ...base, senderWebContents: {} }), false);
});

test('development analytics accepts only the configured Vite entry', () => {
  const base = { development: true, devPort: '5173', appPath, platform: 'darwin' };
  assert.equal(isExpectedElectronAnalyticsEntry({ ...base, senderUrl: 'http://localhost:5173/' }), true);
  assert.equal(isExpectedElectronAnalyticsEntry({ ...base, senderUrl: 'http://127.0.0.1:5173/index.html#state' }), true);
  assert.equal(isExpectedElectronAnalyticsEntry({ ...base, senderUrl: 'http://localhost:5174/' }), false);
  assert.equal(isExpectedElectronAnalyticsEntry({ ...base, senderUrl: 'https://surveytool.app/' }), false);
});
