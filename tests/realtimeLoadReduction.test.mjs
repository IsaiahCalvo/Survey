import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  computeRealtimeReconnectDelayMs,
  createVisibilityGatedSubscription,
  REALTIME_RECONNECT_BASE_MS,
  REALTIME_RECONNECT_MAX_MS,
  REALTIME_RECONNECT_HIDDEN_MAX_MS,
} from '../src/utils/realtimePolicy.js';
import { acquireMarkCommentsRealtime } from '../src/hooks/useMarkComments.js';
import { subscribeDocumentLockState } from '../src/services/documentLockService.js';

function createFakeDocument(initialState = 'visible') {
  const listeners = new Set();
  return {
    visibilityState: initialState,
    addEventListener(event, fn) {
      if (event === 'visibilitychange') listeners.add(fn);
    },
    removeEventListener(event, fn) {
      if (event === 'visibilitychange') listeners.delete(fn);
    },
    setVisibility(next) {
      this.visibilityState = next;
      for (const fn of [...listeners]) fn();
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

function createFakeRealtimeClient() {
  let nextId = 1;
  const channels = [];
  const removed = [];
  return {
    channels,
    removed,
    channel(name) {
      const ch = {
        id: nextId++,
        name,
        handlers: [],
        subscribed: false,
        on(type, filter, callback) {
          this.handlers.push({ type, filter, callback });
          return this;
        },
        subscribe() {
          this.subscribed = true;
          return this;
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) {
      removed.push(ch);
    },
  };
}

test('computeRealtimeReconnectDelayMs uses exponential backoff with jitter and higher hidden cap', () => {
  const neutral = () => 0.5;
  assert.equal(computeRealtimeReconnectDelayMs(1, { hidden: false, random: neutral }), 1_000);
  assert.equal(computeRealtimeReconnectDelayMs(2, { hidden: false, random: neutral }), 2_000);
  assert.equal(computeRealtimeReconnectDelayMs(3, { hidden: false, random: neutral }), 4_000);
  assert.equal(computeRealtimeReconnectDelayMs(7, { hidden: false, random: neutral }), REALTIME_RECONNECT_MAX_MS);
  assert.equal(computeRealtimeReconnectDelayMs(10, { hidden: false, random: neutral }), REALTIME_RECONNECT_MAX_MS);

  // Hidden tabs back off further to avoid hammering an overloaded DB in the background.
  assert.equal(computeRealtimeReconnectDelayMs(10, { hidden: true, random: neutral }), REALTIME_RECONNECT_HIDDEN_MAX_MS);

  // ±25% jitter bounds for attempt 4 (base 8000ms -> 6000..10000ms).
  const low = computeRealtimeReconnectDelayMs(4, { hidden: false, random: () => 0 });
  const high = computeRealtimeReconnectDelayMs(4, { hidden: false, random: () => 1 });
  assert.equal(low, 6_000);
  assert.equal(high, 10_000);
  assert.ok(computeRealtimeReconnectDelayMs(1, { hidden: false, random: () => 0 }) >= REALTIME_RECONNECT_BASE_MS);
});

test('createVisibilityGatedSubscription detaches after hidden grace period and resumes with refresh', async () => {
  const doc = createFakeDocument('visible');
  let subscribes = 0;
  let unsubscribes = 0;
  let resumes = 0;

  const gated = createVisibilityGatedSubscription({
    doc,
    hiddenGraceMs: 25,
    resumeJitterMs: 10,
    random: () => 0.5,
    subscribe: () => {
      subscribes += 1;
      return () => { unsubscribes += 1; };
    },
    onResume: () => { resumes += 1; },
  });

  assert.equal(subscribes, 1);
  assert.equal(unsubscribes, 0);
  assert.equal(gated.isSubscribed(), true);

  // Brief alt-tab (< grace) must not churn subscriptions.
  doc.setVisibility('hidden');
  await new Promise((r) => setTimeout(r, 8));
  doc.setVisibility('visible');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(subscribes, 1);
  assert.equal(unsubscribes, 0);
  assert.equal(resumes, 0);

  // Staying hidden past grace detaches the Realtime channel.
  doc.setVisibility('hidden');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(unsubscribes, 1);
  assert.equal(gated.isSubscribed(), false);

  // Returning to visible re-subscribes after jitter and triggers onResume catch-up.
  doc.setVisibility('visible');
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(subscribes, 2);
  assert.equal(resumes, 1);
  assert.equal(gated.isSubscribed(), true);

  gated.dispose();
  assert.equal(unsubscribes, 2);
  assert.equal(doc.listenerCount(), 0);
});

test('createVisibilityGatedSubscription defers subscribe when opened in a hidden tab', () => {
  const doc = createFakeDocument('hidden');
  let subscribes = 0;
  let resumes = 0;
  const gated = createVisibilityGatedSubscription({
    doc,
    hiddenGraceMs: 0,
    resumeJitterMs: 0,
    subscribe: () => {
      subscribes += 1;
      return () => {};
    },
    onResume: () => { resumes += 1; },
  });

  assert.equal(subscribes, 0);
  assert.equal(gated.isSubscribed(), false);

  doc.setVisibility('visible');
  assert.equal(subscribes, 1);
  assert.equal(resumes, 1);
  assert.equal(gated.isSubscribed(), true);
  gated.dispose();
});

test('acquireMarkCommentsRealtime deduplicates concurrent mounts onto one postgres_changes channel', () => {
  const client = createFakeRealtimeClient();
  const doc = createFakeDocument('visible');
  const seenA = [];
  const seenB = [];

  const releaseA = acquireMarkCommentsRealtime('doc-dedup', {
    client,
    doc,
    onRow: (row) => seenA.push(row.id),
  });
  const releaseB = acquireMarkCommentsRealtime('doc-dedup', {
    client,
    doc,
    onRow: (row) => seenB.push(row.id),
  });

  assert.equal(client.channels.length, 1);
  const handler = client.channels[0].handlers[0].callback;
  handler({ new: { id: 'c1', document_id: 'doc-dedup' } });
  assert.deepEqual(seenA, ['c1']);
  assert.deepEqual(seenB, ['c1']);

  // Releasing one mount keeps the shared channel open for the remaining mount.
  releaseA();
  assert.equal(client.removed.length, 0);
  handler({ new: { id: 'c2', document_id: 'doc-dedup' } });
  assert.deepEqual(seenA, ['c1']);
  assert.deepEqual(seenB, ['c1', 'c2']);

  // Releasing the last mount tears down the shared channel cleanly.
  releaseB();
  assert.equal(client.removed.length, 1);
});

test('supabaseClient configures jittered realtime reconnectAfterMs and PDFViewer/PagePinsHost gate inactive tabs', () => {
  const root = path.resolve(process.cwd());
  const supabaseClientSrc = fs.readFileSync(path.join(root, 'src/supabaseClient.js'), 'utf8');
  assert.match(supabaseClientSrc, /reconnectAfterMs:\s*\(tries\)\s*=>\s*computeRealtimeReconnectDelayMs\(tries\)/);

  const pagePinsSrc = fs.readFileSync(path.join(root, 'src/components/pins/PagePinsHost.jsx'), 'utf8');
  assert.match(pagePinsSrc, /useMarkComments\(documentId,\s*\{\s*enabled:\s*live\s*\}\)/);

  const pdfViewerSrc = fs.readFileSync(path.join(root, 'src/PDFViewer.jsx'), 'utf8');
  assert.match(pdfViewerSrc, /useDocumentPresenceList\(\{\s*\n\s*documentId:\s*pdfFile\?\.id \|\| null,\s*\n\s*enabled:\s*isActive && cloudSyncActive/);
  assert.match(pdfViewerSrc, /if \(!isActive \|\| !documentId \|\| !cloudSyncEnabled \|\| isDeviceDocumentId\(documentId\)\) return undefined;/);

  // Verify subscribeDocumentLockState still works cleanly with fake clients.
  const client = createFakeRealtimeClient();
  const unsub = subscribeDocumentLockState('doc-lock-test', () => {}, client);
  assert.equal(client.channels.length, 1);
  unsub();
  assert.equal(client.removed.length, 1);
});
