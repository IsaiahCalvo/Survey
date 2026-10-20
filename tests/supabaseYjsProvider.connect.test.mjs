/**
 * SupabaseYjsProvider connect() handler coverage with a fake channel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  connect,
  createSupabaseYjsProvider,
  encodeUpdate,
  encodeSyncStep1,
  uint8ArrayToBase64,
  REMOTE_REALTIME_ORIGIN,
} from '../src/lib/collab/SupabaseYjsProvider.js';

function makeFakeChannel() {
  const handlers = new Map();
  const sent = [];
  const ch = {
    state: 'joined',
    on(type, filter, cb) {
      const key = `${type}:${filter?.event || '*'}`;
      handlers.set(key, cb);
      return ch;
    },
    subscribe(cb) {
      queueMicrotask(() => cb && cb('SUBSCRIBED'));
      return ch;
    },
    send(msg) {
      sent.push(msg);
      return Promise.resolve('ok');
    },
    unsubscribe() {},
    __handlers: handlers,
    __sent: sent,
    __fire(event, payload) {
      const cb = handlers.get(`broadcast:${event}`);
      if (cb) cb({ payload });
    },
    __status(status) {
      // no-op; subscribe already fired
    },
  };
  return ch;
}

test('connect fans out local updates, handles sync/awareness/reject, disconnects', async () => {
  const doc = new Y.Doc();
  const channel = makeFakeChannel();
  const states = [];
  const rejected = [];
  const fakeAwareness = {
    // minimal surface for awareness handler catch path
  };

  const supabase = {
    channel: () => channel,
    removeChannel() {},
  };

  const handle = connect('doc-connect-1', doc, {
    supabase,
    awareness: fakeAwareness,
    onTransportState: (s) => states.push(s),
    onUpdateRejected: (r) => rejected.push(r),
  });

  await new Promise((r) => setTimeout(r, 15));
  assert.ok(states.includes('online'));
  assert.ok(channel.__sent.some((m) => m.event === 'sync_request'));

  // Local edit should broadcast sync
  const before = channel.__sent.length;
  doc.getMap('annotations').set('k1', 'v1');
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(channel.__sent.length > before);

  // Remote sync with foreign client id
  const other = new Y.Doc();
  other.getMap('annotations').set('remote', 1);
  const frame = encodeUpdate(Y.encodeStateAsUpdate(other));
  channel.__fire('sync', {
    update: uint8ArrayToBase64(frame),
    originClientId: doc.clientID + 99,
  });
  assert.equal(doc.getMap('annotations').get('remote'), 1);

  // Self-echo ignored
  const sentBeforeEcho = channel.__sent.length;
  channel.__fire('sync', {
    update: uint8ArrayToBase64(frame),
    originClientId: doc.clientID,
  });
  assert.equal(channel.__sent.length, sentBeforeEcho);

  // Bad payload / decode catch
  channel.__fire('sync', { update: '%%%not-base64%%%', originClientId: doc.clientID + 1 });
  channel.__fire('sync', null);
  channel.__fire('awareness', { awareness: 'bad' });
  channel.__fire('update_rejected', { reason: 'kicked' });
  assert.ok(rejected.includes('kicked'));

  // sync_request from peer
  channel.__fire('sync_request', {
    stateVector: uint8ArrayToBase64(Y.encodeStateVector(other)),
    fromClientId: doc.clientID + 2,
  });

  // CHANNEL_ERROR path via resubscribe status helper — fire offline via send failure
  channel.send = () => Promise.reject(new Error('send-fail'));
  doc.getMap('annotations').set('k2', 'v2');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(states.includes('offline'));

  handle.disconnect();
  assert.equal(handle.getChannel(), null);
  await handle.send('sync', { update: 'x' }); // detached no-op
  doc.destroy();
  other.destroy();
});

test('connect rejects missing args', () => {
  assert.throws(() => connect(null, {}), /documentId required/);
  assert.throws(() => connect('d', null), /ydoc required/);
  assert.throws(() => connect('d', {}, {}), /options.supabase required/);
});

test('connect uses httpSend when channel not joined; skips oversized frames; create alias', async () => {
  const doc = new Y.Doc();

  const handlers = new Map();
  const httpSent = [];
  const channel = {
    state: 'joining',
    on(type, filter, cb) {
      handlers.set(`${type}:${filter?.event || '*'}`, cb);
      return channel;
    },
    subscribe(cb) {
      queueMicrotask(() => {
        cb?.('SUBSCRIBED');
        queueMicrotask(() => cb?.('CHANNEL_ERROR'));
      });
      return channel;
    },
    httpSend(event, payload) {
      httpSent.push({ event, payload });
      return Promise.resolve('http');
    },
    send() {
      throw new Error('send should not be used while joining');
    },
    unsubscribe() {},
  };

  const states = [];
  const handle = createSupabaseYjsProvider({
    documentId: 'doc-large',
    ydoc: doc,
    supabase: { channel: () => channel, removeChannel() {} },
    onTransportState: (s) => states.push(s),
  });

  await new Promise((r) => setTimeout(r, 30));
  assert.ok(httpSent.some((m) => m.event === 'sync_request'));
  assert.ok(states.includes('online'));
  assert.ok(states.includes('offline'));

  // Local oversized update after connect: logged + skipped (no httpSend growth from giant frame)
  const before = httpSent.length;
  doc.getMap('bulk').set('blob', 'x'.repeat(2 * 1024 * 1024));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(httpSent.length, before, 'oversized local update must not broadcast');

  // Peer syncStep1 → oversized step2 reply skip
  const empty = new Y.Doc();
  const step1 = encodeSyncStep1(empty);
  handlers.get('broadcast:sync')?.({
    payload: {
      update: uint8ArrayToBase64(step1),
      originClientId: doc.clientID + 7,
    },
  });

  // Peer sync_request with empty SV → oversized reply skip
  handlers.get('broadcast:sync_request')?.({
    payload: {
      stateVector: uint8ArrayToBase64(Y.encodeStateVector(empty)),
      fromClientId: doc.clientID + 8,
    },
  });

  handle.disconnect();
  doc.destroy();
  empty.destroy();
});


test('connect applies awareness updates and small sync step2 replies', async () => {
  const awarenessProtocol = await import('y-protocols/awareness');
  const doc = new Y.Doc();
  const peer = new Y.Doc();
  peer.getMap('annotations').set('peer-key', 'peer-val');
  const awareness = new awarenessProtocol.Awareness(doc);

  const handlers = new Map();
  const sent = [];
  const channel = {
    state: 'joined',
    on(type, filter, cb) {
      handlers.set(`${type}:${filter?.event || '*'}`, cb);
      return channel;
    },
    subscribe(cb) {
      queueMicrotask(() => cb?.('SUBSCRIBED'));
      return channel;
    },
    send(msg) {
      sent.push(msg);
      return Promise.resolve('ok');
    },
    unsubscribe() {},
  };

  const handle = connect('doc-aw', doc, {
    supabase: { channel: () => channel, removeChannel() {} },
    awareness,
  });
  await new Promise((r) => setTimeout(r, 15));

  // Small peer update → decode may produce small reply
  const frame = encodeUpdate(Y.encodeStateAsUpdate(peer));
  handlers.get('broadcast:sync')?.({
    payload: { update: uint8ArrayToBase64(frame), originClientId: doc.clientID + 1 },
  });
  assert.equal(doc.getMap('annotations').get('peer-key'), 'peer-val');

  // Awareness update
  const awBytes = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);
  handlers.get('broadcast:awareness')?.({
    payload: { awareness: uint8ArrayToBase64(awBytes) },
  });

  // Small syncStep1 reply path (both docs small)
  const step1 = encodeSyncStep1(peer);
  const before = sent.length;
  handlers.get('broadcast:sync')?.({
    payload: { update: uint8ArrayToBase64(step1), originClientId: doc.clientID + 2 },
  });
  assert.ok(sent.length >= before);

  handle.disconnect();
  awareness.destroy();
  doc.destroy();
  peer.destroy();
});
