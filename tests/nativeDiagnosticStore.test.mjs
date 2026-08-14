import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acknowledgeNativeAnalyticsEvents,
  claimNativeAnalyticsEvents,
  createNativeDiagnosticPersistenceGate,
  loadNativeDiagnosticState,
  mergeNativeDiagnosticStates,
  saveNativeDiagnosticState,
} from '../mobile-expo/src/nativeDiagnosticStore.js';

const memoryStorage = (initial = null) => {
  let value = initial;
  return {
    async getItem() { return value; },
    async setItem(_key, next) { value = next; },
    value: () => value,
  };
};

test('native diagnostics persist bounded, privacy-safe crash context across shell reloads', async () => {
  const storage = memoryStorage();
  await saveNativeDiagnosticState(storage, {
    diagnostics: Array.from({ length: 30 }, (_, index) => ({
      event: 'pinch_commit',
      detail: { page: index, filename: `private-${index}.pdf`, email: 'owner@example.com' },
      timestamp: index,
    })),
    pendingEvents: Array.from({ length: 12 }, (_, index) => ({
      id: `event-${index}`,
      event: 'survey_webview_process_terminated',
      properties: { source: 'ios-content-process', token: 'secret' },
    })),
    recoveries: Array.from({ length: 10 }, (_, index) => index),
  });

  const loaded = await loadNativeDiagnosticState(storage);
  assert.equal(loaded.diagnostics.length, 24);
  assert.equal(loaded.pendingEvents.length, 8);
  assert.equal(loaded.recoveries.length, 8);
  assert.equal(JSON.stringify(loaded).includes('private-'), false);
  assert.equal(JSON.stringify(loaded).includes('owner@example.com'), false);
  assert.equal(JSON.stringify(loaded).includes('secret'), false);
});

test('corrupt native diagnostic storage fails closed to an empty state', async () => {
  assert.deepEqual(await loadNativeDiagnosticState(memoryStorage('{not json')), {
    diagnostics: [],
    pendingEvents: [],
    recoveries: [],
  });
});

test('Expo crash events survive a simulated reload until the web collector acknowledges them', async () => {
  const storage = memoryStorage();
  const crash = {
    id: 'native-crash-1',
    event: 'survey_webview_process_terminated',
    properties: { source: 'ios-content-process', email: 'owner@example.com' },
  };
  const diagnostic = {
    id: 'native-diagnostic-2',
    event: 'survey_pdf_zoom_diagnostic',
    properties: { source: 'expo-webview' },
  };

  await saveNativeDiagnosticState(storage, { pendingEvents: [crash, diagnostic] });
  const afterProcessReload = await loadNativeDiagnosticState(storage);
  assert.deepEqual(afterProcessReload.pendingEvents.map(({ id }) => id), [
    'native-crash-1',
    'native-diagnostic-2',
  ]);
  assert.equal(JSON.stringify(afterProcessReload).includes('owner@example.com'), false);

  const afterAck = acknowledgeNativeAnalyticsEvents(afterProcessReload.pendingEvents, ['native-crash-1']);
  assert.deepEqual(afterAck.map(({ id }) => id), ['native-diagnostic-2']);
  await saveNativeDiagnosticState(storage, { pendingEvents: afterAck });

  const afterSecondReload = await loadNativeDiagnosticState(storage);
  assert.deepEqual(afterSecondReload.pendingEvents.map(({ id }) => id), ['native-diagnostic-2']);
});

test('repeated shell-ready delivery claims each persisted crash once per WebView document', () => {
  const pending = [
    { id: 'crash-1', event: '$exception' },
    { id: 'crash-2', event: 'survey_webview_process_terminated' },
  ];
  const inFlight = new Set();
  assert.deepEqual(claimNativeAnalyticsEvents(pending, inFlight).map(({ id }) => id), ['crash-1', 'crash-2']);
  assert.deepEqual(claimNativeAnalyticsEvents(pending, inFlight), []);

  // A replacement WebView is a new delivery document and may retry events that
  // did not receive an acknowledgement before the process died.
  inFlight.clear();
  assert.deepEqual(claimNativeAnalyticsEvents(pending, inFlight).map(({ id }) => id), ['crash-1', 'crash-2']);
});

test('delayed hydration and concurrent persistence cannot overwrite stored or live diagnostics', async () => {
  let releaseRead;
  const delayedRead = new Promise((resolve) => { releaseRead = resolve; });
  let releaseFirstWrite;
  const firstWriteBlocked = new Promise((resolve) => { releaseFirstWrite = resolve; });
  const writes = [];
  let writeCount = 0;
  const storage = {
    async getItem() { return delayedRead; },
    async setItem(_key, value) {
      writeCount += 1;
      if (writeCount === 1) await firstWriteBlocked;
      writes.push(JSON.parse(value));
    },
  };
  const gate = createNativeDiagnosticPersistenceGate(storage);
  let live = { pendingEvents: [{ id: 'live-before-hydration', event: '$exception' }] };

  const hydration = loadNativeDiagnosticState(storage);
  void gate.persist(() => live);
  assert.equal(writes.length, 0, 'writes stay blocked until AsyncStorage hydration merges');
  releaseRead(JSON.stringify({
    pendingEvents: [{ id: 'persisted-crash', event: 'survey_webview_process_terminated' }],
  }));
  live = mergeNativeDiagnosticStates(await hydration, live);
  void gate.markHydrated();
  live = mergeNativeDiagnosticStates(live, {
    pendingEvents: [{ id: 'live-during-set', event: '$exception' }],
  });
  void gate.persist(() => live);
  releaseFirstWrite();
  await gate.flush();

  assert.deepEqual(writes.at(-1).pendingEvents.map(({ id }) => id), [
    'persisted-crash',
    'live-before-hydration',
    'live-during-set',
  ]);
});
