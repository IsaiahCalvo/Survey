import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const PRELOAD_SOURCE = readFileSync(
  new URL('../src/preload.js', import.meta.url),
  'utf8'
);

function loadElectronApi() {
  let exposedApi = null;
  let saveSnapshotInvocations = 0;
  let nowMs = 1000;
  let resolveSnapshot;
  const snapshotResult = new Promise((resolve) => {
    resolveSnapshot = resolve;
  });

  const ipcRenderer = {
    invoke(channel) {
      if (channel === 'logs:saveSnapshot') {
        saveSnapshotInvocations += 1;
        return snapshotResult;
      }
      return Promise.resolve({ ok: true });
    },
    on() {},
    removeListener() {},
    send() {},
  };

  vm.runInNewContext(PRELOAD_SOURCE, {
    require(moduleName) {
      assert.equal(moduleName, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld(_name, api) {
            exposedApi = api;
          },
        },
        ipcRenderer,
      };
    },
    console,
    Date: { now: () => nowMs },
    setTimeout,
    clearTimeout,
  });

  return {
    api: exposedApi,
    getInvocationCount: () => saveSnapshotInvocations,
    advanceTime: (milliseconds) => {
      nowMs += milliseconds;
    },
    resolveSnapshot,
  };
}

test('near-simultaneous Save Log triggers share one local snapshot write', async () => {
  const harness = loadElectronApi();
  const first = harness.api.saveLogSnapshot({ summary: { triggeredBy: 'shortcut' } });
  const duplicate = harness.api.saveLogSnapshot({ summary: { triggeredBy: 'menu' } });

  assert.equal(
    harness.getInvocationCount(),
    1,
    'shortcut and menu triggers must not invoke logs:saveSnapshot twice'
  );

  harness.resolveSnapshot({ ok: true, dir: '/tmp/Logs/one-snapshot' });
  assert.deepEqual(await first, await duplicate);

  const immediateRetry = harness.api.saveLogSnapshot({
    summary: { triggeredBy: 'duplicate-event' },
  });
  assert.equal(
    harness.getInvocationCount(),
    1,
    'an immediate follow-up event must reuse the just-completed snapshot'
  );
  assert.deepEqual(await immediateRetry, { ok: true, dir: '/tmp/Logs/one-snapshot' });

  harness.advanceTime(1001);
  const laterSave = harness.api.saveLogSnapshot({
    summary: { triggeredBy: 'new-user-action' },
  });
  assert.equal(
    harness.getInvocationCount(),
    2,
    'a later Save Log action must create a fresh snapshot'
  );
  assert.deepEqual(await laterSave, { ok: true, dir: '/tmp/Logs/one-snapshot' });
});

test('a failed snapshot response is still deduped during the event window', async () => {
  const harness = loadElectronApi();
  const failedSave = harness.api.saveLogSnapshot({
    summary: { triggeredBy: 'shortcut' },
  });

  harness.resolveSnapshot({ ok: false, error: 'disk unavailable' });
  assert.deepEqual(await failedSave, { ok: false, error: 'disk unavailable' });

  const duplicate = harness.api.saveLogSnapshot({
    summary: { triggeredBy: 'menu' },
  });
  assert.equal(
    harness.getInvocationCount(),
    1,
    'a duplicate event must not retry immediately after a failed response'
  );
  assert.deepEqual(await duplicate, { ok: false, error: 'disk unavailable' });

  harness.advanceTime(1001);
  const laterRetry = harness.api.saveLogSnapshot({
    summary: { triggeredBy: 'new-user-action' },
  });
  assert.equal(
    harness.getInvocationCount(),
    2,
    'a later user action must be allowed to retry a failed snapshot'
  );
  assert.deepEqual(await laterRetry, { ok: false, error: 'disk unavailable' });
});
