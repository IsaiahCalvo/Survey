// KAL-369: drive the REAL src/electron-main.js IPC handlers (with a stub
// `electron`, see tests/helpers/electronMainIpcHarness.cjs) and check the
// three desktop guards end to end: app-window-only IPC, the link-aware file
// allowlist, and the diagnostics-only folder clear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = path.join(repo, 'tests', 'helpers', 'electronMainIpcHarness.cjs');
const env = { ...process.env };
delete env.NODE_ENV; // the packaged-app rules (file:// app page)
const run = spawnSync(process.execPath, [harness, repo], { encoding: 'utf8', env, timeout: 60_000 });
const results = Object.fromEntries(
  run.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => {
    const { name, value } = JSON.parse(line);
    return [name, value];
  }),
);

test('the harness loaded electron-main and ran every probe', () => {
  assert.equal(run.status, 0, run.stderr);
  assert.equal(Object.keys(results).length, 15, run.stdout);
});

test('privileged IPC is refused before the app window exists and for other senders', () => {
  assert.deepEqual(results['beforeWindow:os:getHomeDir'], { served: false, code: 'EPERM' });
  assert.deepEqual(results['beforeWindow:msauth:status'], { served: false, code: 'EPERM' });
  assert.deepEqual(results['navigatedAway:os:getHomeDir'], { served: false, code: 'EPERM' });
});

test('the app page in the main window is still served', () => {
  assert.equal(results['appPage:os:getHomeDir'].served, true);
  assert.equal(typeof results['appPage:os:getHomeDir'].value, 'string');
});

test('fs:clearDir empties TestLogs but refuses the app folder and userData', () => {
  assert.equal(results['clearDir:TestLogs'].served, true);
  assert.equal(results['clearDir:TestLogs:emptied'], true);
  assert.deepEqual(results['clearDir:appFolder'], { served: false, code: 'EPERM' });
  assert.equal(results['clearDir:appFolder:kept'], true);
  assert.deepEqual(results['clearDir:userData'], { served: false, code: 'EPERM' });
});

test('a link inside userData cannot read or plant files outside the trusted roots', () => {
  assert.deepEqual(results['readFile:viaLink'], { served: false, code: 'EPERM' });
  assert.deepEqual(results['writeFile:viaLink'], { served: false, code: 'EPERM' });
  assert.equal(results['writeFile:viaLink:created'], false);
});

test('ordinary reads and writes inside a trusted root still work', () => {
  assert.deepEqual(results['readFile:plain'], { served: true, value: 'fine' });
  assert.equal(results['writeFile:plain'].served, true);
  assert.equal(results['writeFile:plain:content'], 'hi');
});
