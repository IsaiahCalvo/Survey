import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { attachLifecycle } from '../src/lib/collab/ydocLifecycle.js';
import { getLegacyYDocScopeKey } from '../src/lib/collab/legacyYDocScope.js';

const pause = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await pause();
  }
  assert.ok(check(), 'condition did not settle');
}

function setup(t) {
  const groups = new Map();
  const sent = [];
  const pending = new Map();
  const held = new Set();
  function pump(name) {
    if (held.has(name)) return;
    const item = pending.get(name)?.shift();
    if (!item) return;
    held.add(name);
    Promise.resolve().then(() => item.callback({ name })).then(item.resolve, item.reject).finally(() => {
      held.delete(name);
      pump(name);
    });
  }
  const locks = {
    request(name, options, callback) {
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) return reject(options.signal.reason);
        const queue = pending.get(name) || [];
        pending.set(name, queue);
        const item = { callback, resolve, reject };
        queue.push(item);
        options.signal?.addEventListener('abort', () => {
          const index = queue.indexOf(item);
          if (index < 0) return;
          queue.splice(index, 1);
          reject(options.signal.reason);
        }, { once: true });
        pump(name);
      });
    },
  };
  let drop = () => false;
  class Channel {
    constructor(name) {
      this.name = name;
      this.closed = false;
      const group = groups.get(name) || new Set();
      groups.set(name, group);
      group.add(this);
    }
    postMessage(message) {
      if (this.closed) throw new Error('closed channel');
      const copied = structuredClone(message);
      sent.push({ name: this.name, message: copied });
      for (const peer of groups.get(this.name)) {
        if (peer === this || drop(copied, this, peer)) continue;
        queueMicrotask(() => {
          if (!peer.closed) peer.onmessage?.({ data: structuredClone(copied) });
        });
      }
    }
    close() { this.closed = true; groups.get(this.name).delete(this); }
  }
  const factory = new IDBFactory();
  const document = new EventTarget();
  document.hidden = false;
  const replacements = { window: new EventTarget(), document, navigator: { locks }, BroadcastChannel: Channel, indexedDB: factory, IDBKeyRange };
  const restores = [];
  for (const [key, value] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restores.push(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  const handles = [];
  const docs = [];
  function open(documentId = 'doc', actorUserId = 'actor', existingDoc = null) {
    const doc = existingDoc || new Y.Doc();
    docs.push(doc);
    const states = [];
    const roles = [];
    const handle = attachLifecycle(doc, documentId, {
      actorUserId,
      onStorageState: (state) => states.push(state),
      onRoleChange: (role) => roles.push(role),
    });
    handles.push(handle);
    return { doc, handle, states, roles, ready: () => states.some((state) => state.code === 'ok') };
  }
  t.after(async () => {
    await Promise.all(handles.map((handle) => handle.detach()));
    docs.forEach((doc) => doc.destroy());
    restores.forEach((restore) => restore());
  });
  return { open, factory, sent, groups, Channel, setDrop: (fn) => { drop = fn; }, pending };
}

test('scope keys encode each identity independently and reject absent/blank/non-string IDs', () => {
  assert.equal(getLegacyYDocScopeKey('doc:/% one', 'actor:/% two'), 'legacy-yjs:v1:doc%3A%2F%25%20one:actor%3A%2F%25%20two');
  assert.notEqual(getLegacyYDocScopeKey('a:b', 'c'), getLegacyYDocScopeKey('a', 'b:c'));
  for (const invalid of ['', '  ', null, undefined, 1, {}]) {
    assert.throws(() => getLegacyYDocScopeKey(invalid, 'actor'));
    assert.throws(() => getLegacyYDocScopeKey('doc', invalid));
  }
});

test('scoped actors use separate locks, channels and persisted databases', async (t) => {
  const env = setup(t);
  const a = env.open('same-doc', 'actor-a');
  const b = env.open('same-doc', 'actor-b');
  await until(() => a.ready() && b.ready());
  a.doc.getMap('annotations').set('private-a', 'A');
  b.doc.getMap('annotations').set('private-b', 'B');
  await pause();
  assert.equal(a.doc.getMap('annotations').has('private-b'), false);
  assert.equal(b.doc.getMap('annotations').has('private-a'), false);
  assert.equal(a.handle.role(), 'leader');
  assert.equal(b.handle.role(), 'leader');
  assert.deepEqual((await env.factory.databases()).map((db) => db.name).sort(), [
    getLegacyYDocScopeKey('same-doc', 'actor-a'), getLegacyYDocScopeKey('same-doc', 'actor-b'),
  ]);
  await Promise.all([a.handle.detach(), b.handle.detach()]);
  const coldB = env.open('same-doc', 'actor-b');
  await until(coldB.ready);
  assert.deepEqual(coldB.doc.getMap('annotations').toJSON(), { 'private-b': 'B' });
});

test('late follower receives history without another leader edit', async (t) => {
  const env = setup(t);
  const a = env.open();
  await until(a.ready);
  a.doc.getMap('annotations').set('old', { text: 'saved before follower' });
  await pause();
  const b = env.open();
  assert.equal(b.handle.role(), 'follower');
  assert.deepEqual(b.roles, ['follower']);
  await until(() => b.doc.getMap('annotations').has('old'));
  assert.deepEqual(b.doc.getMap('annotations').get('old'), { text: 'saved before follower' });
  assert.equal(b.handle.role(), 'follower');
});

test('follower pre-attach state reaches leader and survives a fresh IndexedDB reopen', async (t) => {
  const env = setup(t);
  const a = env.open();
  await until(a.ready);
  a.doc.getMap('annotations').set('leader-old', 1);
  const preexisting = new Y.Doc();
  preexisting.getMap('annotations').set('follower-unsent', 2);
  const b = env.open('doc', 'actor', preexisting);
  await until(() => a.doc.getMap('annotations').has('follower-unsent') && b.doc.getMap('annotations').has('leader-old'));
  await Promise.all([a.handle.detach(), b.handle.detach()]);
  const cold = env.open();
  await until(cold.ready);
  assert.deepEqual(cold.doc.getMap('annotations').toJSON(), { 'leader-old': 1, 'follower-unsent': 2 });
});

test('leader holds handshake requests until real IndexedDB hydration completes, even after retries end', async (t) => {
  const env = setup(t);
  const seed = env.open();
  await until(seed.ready);
  seed.doc.getMap('annotations').set('only-on-disk', 1);
  await seed.handle.detach();
  env.sent.length = 0;
  // Delay the real open request's delivery, not a mock persistence adapter.
  const originalOpen = env.factory.open.bind(env.factory);
  let releaseOpen = null;
  env.factory.open = (...args) => {
    const request = originalOpen(...args);
    Object.defineProperty(request, 'onsuccess', {
      configurable: true,
      set(handler) {
        request.addEventListener('success', (event) => {
          releaseOpen = () => handler(event);
        }, { once: true });
      },
    });
    return request;
  };
  try {
    const leader = env.open();
    await until(() => releaseOpen !== null);
    const leaderId = env.sent.find(({ message }) => message.type === 'sync-request').message.senderId;
    const preexisting = new Y.Doc();
    preexisting.getMap('annotations').set('only-on-follower', 2);
    const follower = env.open('doc', 'actor', preexisting);
    await pause(1100);
    assert.equal(leader.ready(), false);
    assert.equal(follower.doc.getMap('annotations').has('only-on-disk'), false);
    assert.equal(env.sent.some(({ message }) => message.senderId === leaderId && message.type === 'sync-response'), false);
    releaseOpen();
    releaseOpen = null;
    await until(() => leader.ready() && follower.doc.getMap('annotations').has('only-on-disk'));
    assert.equal(leader.doc.getMap('annotations').get('only-on-follower'), 2);
  } finally {
    env.factory.open = originalOpen;
    releaseOpen?.();
  }
});

test('a promoted follower hydrates storage and serves a later peer', async (t) => {
  const env = setup(t);
  const a = env.open();
  await until(a.ready);
  a.doc.getMap('annotations').set('history', 1);
  const b = env.open();
  await until(() => b.doc.getMap('annotations').has('history'));
  await a.handle.detach();
  await until(b.ready);
  assert.deepEqual(b.roles, ['follower', 'leader']);
  b.doc.getMap('annotations').set('after-promotion', 2);
  const c = env.open();
  await until(() => c.doc.getMap('annotations').has('after-promotion'));
  assert.deepEqual(c.doc.getMap('annotations').toJSON(), { history: 1, 'after-promotion': 2 });
});

test('malformed, wrong-scope, self and duplicate frames cannot mutate the doc twice', async (t) => {
  const env = setup(t);
  const a = env.open();
  await until(a.ready);
  const ownRequest = env.sent.find(({ message }) => message.type === 'sync-request');
  assert.ok(ownRequest);
  const injector = new env.Channel(ownRequest.name);
  t.after(() => injector.close());
  const foreign = new Y.Doc();
  t.after(() => foreign.destroy());
  foreign.getMap('annotations').set('injected', true);
  const valid = { ...ownRequest.message, type: 'update', senderId: 'peer', sequence: 1, update: Y.encodeStateAsUpdate(foreign) };
  for (const altered of [
    null, {}, { ...valid, protocol: 'other' }, { ...valid, version: 2 }, { ...valid, actorUserId: 'other' },
    { ...valid, documentId: 'other' }, { ...valid, senderId: '' },
    { ...valid, senderId: ownRequest.message.senderId }, { ...valid, sequence: 0 },
    { ...valid, update: [1, 2] }, { ...valid, update: new Uint8Array([255]) },
    { ...valid, recipientId: 'other' },
    { ...valid, type: 'sync-request', stateVector: new Uint8Array([255]) },
    { ...valid, type: 'sync-response', recipientId: ownRequest.message.senderId, requestSequence: 9999, stateVector: Y.encodeStateVector(foreign) },
  ]) injector.postMessage(altered);
  await pause();
  assert.equal(a.doc.getMap('annotations').size, 0);
  let updates = 0;
  a.doc.on('update', () => { updates += 1; });
  injector.postMessage(valid);
  injector.postMessage(valid);
  await until(() => a.doc.getMap('annotations').has('injected'));
  assert.equal(updates, 1);
});

test('wake repairs a dropped update including deletion history and retries stop', async (t) => {
  const env = setup(t);
  const a = env.open();
  await until(a.ready);
  a.doc.getMap('annotations').set('removed', 1);
  const b = env.open();
  await until(() => b.doc.getMap('annotations').has('removed'));
  env.setDrop(() => true);
  a.doc.getMap('annotations').delete('removed');
  a.doc.getMap('annotations').set('missed', 2);
  await pause(1400);
  const idleCount = env.sent.length;
  await pause(100);
  assert.equal(env.sent.length, idleCount, 'initial retries must stop');
  env.setDrop(() => false);
  window.dispatchEvent(new Event('online'));
  await until(() => !b.doc.getMap('annotations').has('removed') && b.doc.getMap('annotations').has('missed'));
  await pause(1400);
  const afterWake = env.sent.length;
  await pause(100);
  assert.equal(env.sent.length, afterWake, 'wake retries must stop');
});

test('detach cancels a follower election, wake callbacks and queued messages without destroying its data', async (t) => {
  const env = setup(t);
  const a = env.open();
  await until(a.ready);
  const b = env.open();
  const channel = [...env.groups.values()].flatMap((peers) => [...peers]).at(-1);
  const lateCallback = channel.onmessage;
  b.doc.getMap('annotations').set('pending', 'preserve');
  await b.handle.detach();
  const roles = [...b.roles];
  const states = [...b.states];
  lateCallback({ data: { type: 'update', update: new Uint8Array([255]) } });
  window.dispatchEvent(new Event('focus'));
  await a.handle.detach();
  await pause();
  assert.deepEqual(b.roles, roles);
  assert.deepEqual(b.states, states);
  assert.equal(b.doc.isDestroyed, false);
  assert.equal(b.doc.getMap('annotations').get('pending'), 'preserve');
  assert.equal([...env.pending.values()].flat().length, 0);
});

test('unscoped compatibility sends no full-state handshake and retains its old database name', async (t) => {
  const env = setup(t);
  const doc = new Y.Doc();
  const states = [];
  const handle = attachLifecycle(doc, 'unscoped-old', { onStorageState: (state) => states.push(state) });
  t.after(async () => { await handle.detach(); doc.destroy(); });
  await until(() => states.some((state) => state.code === 'ok'));
  doc.getMap('annotations').set('ambiguous-pending', 'do not import or remove');
  assert.ok((await env.factory.databases()).some((db) => db.name === 'unscoped-old'));
  assert.equal(env.sent.some(({ message }) => message.type === 'sync-request' || message.type === 'sync-response'), false);
  await handle.detach();
  const scoped = env.open('unscoped-old', 'actor');
  await until(scoped.ready);
  assert.equal(scoped.doc.getMap('annotations').size, 0, 'unscoped history must not enter scoped docs');
  const cold = new Y.Doc();
  const coldStates = [];
  const coldHandle = attachLifecycle(cold, 'unscoped-old', { onStorageState: (state) => coldStates.push(state) });
  t.after(async () => { await coldHandle.detach(); cold.destroy(); });
  await until(() => coldStates.some((state) => state.code === 'ok'));
  assert.equal(cold.getMap('annotations').get('ambiguous-pending'), 'do not import or remove');
});

test('synchronous retirement in promotion callback cannot open persistence afterwards', async (t) => {
  const env = setup(t);
  const doc = new Y.Doc();
  doc.getMap('annotations').set('pending', true);
  let handle;
  handle = attachLifecycle(doc, 'retired', {
    actorUserId: 'actor',
    onRoleChange: (role) => { if (role === 'leader') handle.detach(); },
  });
  t.after(async () => { await handle.detach(); doc.destroy(); });
  await until(() => handle.role() === 'leader');
  await handle.detach();
  assert.deepEqual(await env.factory.databases(), []);
  assert.equal(doc.getMap('annotations').get('pending'), true);
});

test('destroying a scoped leader closes its channel and releases election without explicit detach', async (t) => {
  const env = setup(t);
  const leader = env.open('deleted-leader');
  await until(leader.ready);
  const channel = [...env.groups.values()].flatMap((peers) => [...peers])[0];
  const senderId = env.sent[0].message.senderId;
  const follower = env.open('deleted-leader');
  leader.doc.destroy();
  assert.equal(channel.closed, true, 'destroy must synchronously seal the local channel');
  const sentBeforeWake = env.sent.filter(({ message }) => message.senderId === senderId).length;
  window.dispatchEvent(new Event('focus'));
  await until(follower.ready);
  await pause(1100);
  assert.equal(env.sent.filter(({ message }) => message.senderId === senderId).length, sentBeforeWake);
  await leader.handle.detach(); // repeated cleanup remains safe
});

test('destroying a scoped follower cancels queued promotion and rejects retained channel callbacks', async (t) => {
  const env = setup(t);
  const leader = env.open('deleted-follower');
  await until(leader.ready);
  const follower = env.open('deleted-follower');
  const channel = [...env.groups.values()].flatMap((peers) => [...peers]).at(-1);
  const receive = channel.onmessage;
  const request = env.sent.at(-1).message;
  const foreign = new Y.Doc();
  t.after(() => foreign.destroy());
  foreign.getMap('annotations').set('late', true);
  follower.doc.destroy();
  assert.equal(channel.closed, true);
  receive({ data: { ...request, type: 'update', senderId: 'late-peer', sequence: 100,
    update: Y.encodeStateAsUpdate(foreign) } });
  await leader.handle.detach();
  await pause();
  assert.deepEqual(follower.roles, ['follower']);
  assert.equal(follower.doc.getMap('annotations').has('late'), false);
  assert.equal([...env.pending.values()].flat().length, 0);
});

test('destroy during the initial role callback cannot open persistence or schedule sync', async (t) => {
  const env = setup(t);
  const doc = new Y.Doc();
  const handle = attachLifecycle(doc, 'destroy-on-role', {
    actorUserId: 'actor', onRoleChange: () => doc.destroy(),
  });
  t.after(() => handle.detach());
  await handle.detach();
  assert.deepEqual(await env.factory.databases(), []);
  assert.equal(env.sent.length, 0);
  assert.equal([...env.groups.values()].flatMap((peers) => [...peers]).length, 0);
});

test('an already destroyed scoped doc cannot acquire a lifecycle', async (t) => {
  const env = setup(t);
  const doc = new Y.Doc();
  doc.destroy();
  const handle = attachLifecycle(doc, 'already-destroyed', { actorUserId: 'actor' });
  assert.equal(handle.role(), 'unknown');
  await handle.detach();
  assert.deepEqual(await env.factory.databases(), []);
  assert.equal(env.groups.size, 0);
  assert.equal(env.pending.size, 0);
});
