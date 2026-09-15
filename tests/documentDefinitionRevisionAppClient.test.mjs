import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentDefinitionRevisionAppClient } from '../src/services/documentDefinitionRevisionAppClient.js';

const ACTOR_A = '11111111-1111-4111-8111-111111111111';
const ACTOR_B = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';

test('normal app client binds the fresh bearer and rejects a silent SDK actor switch', async () => {
  let actor = ACTOR_A;
  let token = 'token-a';
  let listener = null;
  const request = {};
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: actor }, access_token: token } } }),
      onAuthStateChange: callback => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    },
    rpc(name, args) {
      request.name = name;
      request.args = args;
      const builder = {
        setHeader(key, value) { request[key] = value; return builder; },
        abortSignal(signal) { request.signal = signal; return builder; },
        retry(value) { request.retry = value; return builder; },
        then(resolve, reject) {
          actor = ACTOR_B;
          token = 'token-b';
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const appClient = createDocumentDefinitionRevisionAppClient({ client, enabled: true,
    getActorUserId: () => ACTOR_A,
    isCurrent: ({ actorUserId, documentId }) => actorUserId === ACTOR_A && documentId === DOCUMENT_ID });
  await assert.rejects(appClient.readCurrent({ documentId: DOCUMENT_ID }), error => {
    assert.equal(error.code, 'DOCUMENT_DEFINITION_REVISION_STALE');
    return true;
  });
  assert.equal(request.name, 'read_document_definition_revision');
  assert.equal(request.Authorization, 'Bearer token-a');
  assert.equal(request.retry, false);
  assert.equal(request.signal.aborted, true);
  assert.equal(typeof listener, 'function');
});

test('definition subscription uses a unique scoped documents channel and wakes after join and updates', () => {
  const topics = [];
  const channels = [];
  const removed = [];
  const client = {
    channel(topic) {
      topics.push(topic);
      const channel = {
        handler: null,
        status: null,
        on(type, filter, handler) {
          assert.equal(type, 'postgres_changes');
          assert.deepEqual(filter, { event: 'UPDATE', schema: 'public', table: 'documents',
            filter: `id=eq.${DOCUMENT_ID}` });
          channel.handler = handler;
          return channel;
        },
        subscribe(callback) { channel.status = callback; return channel; },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel(channel) { removed.push(channel); },
  };
  const appClient = createDocumentDefinitionRevisionAppClient({ client, enabled: true,
    getActorUserId: () => ACTOR_A,
    isCurrent: ({ actorUserId, documentId }) => actorUserId === ACTOR_A && documentId === DOCUMENT_ID });
  const wakes = [];
  const first = appClient.subscribeCurrent({ documentId: DOCUMENT_ID,
    onInvalidate: () => wakes.push('first') });
  const second = appClient.subscribeCurrent({ documentId: DOCUMENT_ID,
    onInvalidate: () => wakes.push('second') });

  assert.notEqual(topics[0], topics[1]);
  assert.match(topics[0], new RegExp(`^document-definition:${DOCUMENT_ID}:`));
  channels[0].status('SUBSCRIBED');
  channels[0].status('SUBSCRIBED');
  channels[0].handler({ new: { id: DOCUMENT_ID, untrusted: 'ignored' } });
  assert.deepEqual(wakes, ['first', 'first', 'first']);

  first();
  first();
  second();
  assert.deepEqual(removed, [channels[0], channels[1]]);
});

test('definition subscription removes once and rejects callbacks after abort or actor change', () => {
  let actor = ACTOR_A;
  const channels = [];
  const removed = [];
  const client = {
    channel() {
      const channel = {
        on(_type, _filter, handler) { channel.handler = handler; return channel; },
        subscribe(callback) { channel.status = callback; return channel; },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel(channel) { removed.push(channel); },
  };
  const appClient = createDocumentDefinitionRevisionAppClient({ client, enabled: true,
    getActorUserId: () => actor,
    isCurrent: ({ actorUserId, documentId }) => actorUserId === ACTOR_A
      && documentId === DOCUMENT_ID });
  const wakes = [];
  const controller = new AbortController();
  const disposeFirst = appClient.subscribeCurrent({ documentId: DOCUMENT_ID,
    signal: controller.signal, onInvalidate: () => wakes.push('first') });
  channels[0].status('SUBSCRIBED');
  controller.abort();
  channels[0].handler({ new: { id: DOCUMENT_ID } });
  channels[0].status('SUBSCRIBED');
  disposeFirst();
  assert.deepEqual(wakes, ['first']);
  assert.deepEqual(removed, [channels[0]]);

  actor = ACTOR_A;
  appClient.subscribeCurrent({ documentId: DOCUMENT_ID,
    onInvalidate: () => wakes.push('second') });
  actor = ACTOR_B;
  channels[1].handler({ new: { id: DOCUMENT_ID } });
  channels[1].status('SUBSCRIBED');
  assert.deepEqual(wakes, ['first']);
  assert.deepEqual(removed, [channels[0], channels[1]]);
});

test('definition subscription cleans up a channel when setup fails', () => {
  const removed = [];
  const channel = {
    on() { return channel; },
    subscribe() { throw new Error('subscribe failed'); },
  };
  const client = {
    channel: () => channel,
    removeChannel(value) { removed.push(value); },
  };
  const appClient = createDocumentDefinitionRevisionAppClient({ client, enabled: true,
    getActorUserId: () => ACTOR_A,
    isCurrent: ({ actorUserId, documentId }) => actorUserId === ACTOR_A
      && documentId === DOCUMENT_ID });
  assert.throws(() => appClient.subscribeCurrent({ documentId: DOCUMENT_ID,
    onInvalidate() {} }), /subscribe failed/);
  assert.deepEqual(removed, [channel]);
});

test('definition subscription fails closed when a later scope check throws', () => {
  let scopeThrows = false;
  let handler;
  const removed = [];
  const channel = {
    on(_type, _filter, callback) { handler = callback; return channel; },
    subscribe() { return channel; },
  };
  const client = { channel: () => channel, removeChannel(value) { removed.push(value); } };
  const appClient = createDocumentDefinitionRevisionAppClient({ client, enabled: true,
    getActorUserId: () => ACTOR_A,
    isCurrent: () => { if (scopeThrows) throw new Error('scope unavailable'); return true; } });
  let wakes = 0;
  appClient.subscribeCurrent({ documentId: DOCUMENT_ID, onInvalidate: () => { wakes++; } });
  scopeThrows = true;
  assert.doesNotThrow(() => handler({ new: { id: DOCUMENT_ID } }));
  assert.equal(wakes, 0);
  assert.deepEqual(removed, [channel]);
});

test('definition subscription rejects disabled and non-string identity inputs before channel setup', () => {
  let channelCalls = 0;
  const client = { channel() { channelCalls++; }, removeChannel() {} };
  const make = (enabled, actor) => createDocumentDefinitionRevisionAppClient({ client, enabled,
    getActorUserId: () => actor, isCurrent: () => true });
  assert.throws(() => make(false, ACTOR_A).subscribeCurrent({ documentId: DOCUMENT_ID,
    onInvalidate() {} }), error => error.code === 'DOCUMENT_DEFINITION_REVISION_INPUT');
  assert.throws(() => make(true, { toString: () => ACTOR_A }).subscribeCurrent({
    documentId: DOCUMENT_ID, onInvalidate() {},
  }), error => error.code === 'DOCUMENT_DEFINITION_REVISION_INPUT');
  assert.throws(() => make(true, ACTOR_A).subscribeCurrent({
    documentId: { toString: () => DOCUMENT_ID }, onInvalidate() {},
  }), error => error.code === 'DOCUMENT_DEFINITION_REVISION_INPUT');
  assert.equal(channelCalls, 0);
});

test('synchronous stale join removes the abort listener and channel exactly once', () => {
  let scopeCurrent = true;
  let added = 0;
  let removedListener = 0;
  let missingListenerRemovals = 0;
  let listenerRegistered = false;
  const signal = {
    aborted: false,
    addEventListener() { added++; listenerRegistered = true; },
    removeEventListener() {
      if (!listenerRegistered) { missingListenerRemovals++; return; }
      listenerRegistered = false;
      removedListener++;
    },
  };
  const channel = {
    on() { return channel; },
    subscribe(callback) {
      scopeCurrent = false;
      callback('SUBSCRIBED');
      return channel;
    },
  };
  const removed = [];
  const client = { channel: () => channel, removeChannel(value) { removed.push(value); } };
  const appClient = createDocumentDefinitionRevisionAppClient({ client, enabled: true,
    getActorUserId: () => ACTOR_A, isCurrent: () => scopeCurrent });
  const dispose = appClient.subscribeCurrent({ documentId: DOCUMENT_ID, signal,
    onInvalidate: () => assert.fail('stale join must not wake') });
  dispose();
  assert.equal(added, 1);
  assert.equal(removedListener, 1);
  assert.equal(missingListenerRemovals, 0);
  assert.equal(listenerRegistered, false);
  assert.deepEqual(removed, [channel]);
});

test('synchronous abort while creating the channel still removes that channel once', () => {
  const controller = new AbortController();
  let onCalls = 0;
  const channel = { on() { onCalls++; return channel; }, subscribe() { return channel; } };
  const removed = [];
  const client = {
    channel() { controller.abort(); return channel; },
    removeChannel(value) { removed.push(value); },
  };
  const appClient = createDocumentDefinitionRevisionAppClient({ client, enabled: true,
    getActorUserId: () => ACTOR_A, isCurrent: () => true });
  const dispose = appClient.subscribeCurrent({ documentId: DOCUMENT_ID,
    signal: controller.signal, onInvalidate: () => assert.fail('aborted setup must not wake') });
  dispose();
  assert.equal(onCalls, 0);
  assert.deepEqual(removed, [channel]);
});
