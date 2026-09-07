import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import * as Y from 'yjs';
import { attachLifecycle } from '../src/lib/collab/ydocLifecycle.js';

function fakeLocks() {
  const queues = new Map();
  const active = new Set();
  function pump(name) {
    if (active.has(name)) return;
    const next = queues.get(name)?.shift();
    if (!next) return;
    active.add(name);
    Promise.resolve().then(() => next.fn({ name })).then(next.resolve, next.reject).finally(() => {
      active.delete(name); pump(name);
    });
  }
  return {
    request(name, options, fn) {
      return new Promise((resolve, reject) => {
        const item = { fn, resolve, reject };
        if (options.signal?.aborted) { reject(options.signal.reason); return; }
        const queue = queues.get(name) ?? [];
        queues.set(name, queue); queue.push(item);
        options.signal?.addEventListener('abort', () => {
          const at = queue.indexOf(item);
          if (at < 0) return;
          queue.splice(at, 1); reject(options.signal.reason);
        }, { once: true });
        pump(name);
      });
    },
    pending: () => [...queues.values()].reduce((sum, queue) => sum + queue.length, 0),
  };
}
function browser(t) {
  const locks = fakeLocks();
  const groups = new Map();
  class Channel {
    constructor(name) { this.name = name; const group = groups.get(name) ?? new Set(); groups.set(name, group); group.add(this); }
    postMessage(data) {
      for (const target of groups.get(this.name)) if (target !== this) queueMicrotask(() => target.onmessage?.({ data }));
    }
    close() { groups.get(this.name).delete(this); this.onmessage = null; }
  }
  const replacements = { window: new EventTarget(), navigator: { locks }, BroadcastChannel: Channel, indexedDB: new IDBFactory(), IDBKeyRange };
  const restores = [];
  for (const [key, value] of Object.entries(replacements)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restores.push(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  locks.restore = () => restores.forEach((restore) => restore());
  return locks;
}
const tick = () => new Promise((done) => setTimeout(done, 5));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await tick(); }
  assert.ok(check(), 'condition did not settle');
}

test('detaching releases the persistence lock so reopening a PDF can save offline', async (t) => {
  const browserState = browser(t);
  const first = new Y.Doc();
  const firstStates = [];
  const old = attachLifecycle(first, 'reopen', { onStorageState: (state) => firstStates.push(state) });
  await until(() => firstStates.some((state) => state.code === 'ok'));
  first.getMap('annotations').set('a', 'saved');
  await tick();
  old.detach();
  const reopened = new Y.Doc();
  const states = [];
  const fresh = attachLifecycle(reopened, 'reopen', { onStorageState: (state) => states.push(state) });
  t.after(async () => { await Promise.all([old.detach(), fresh.detach()]); first.destroy(); reopened.destroy(); browserState.restore(); });
  await until(() => states.some((state) => state.code === 'ok'));
  assert.equal(reopened.getMap('annotations').get('a'), 'saved');
});

test('detaching a waiting tab cancels its queued Web Lock request', async (t) => {
  const locks = browser(t);
  const first = new Y.Doc();
  const second = new Y.Doc();
  const leader = attachLifecycle(first, 'waiting', {});
  const waiter = attachLifecycle(second, 'waiting', {});
  t.after(async () => { await Promise.all([leader.detach(), waiter.detach()]); first.destroy(); second.destroy(); locks.restore(); });
  await until(() => locks.pending() === 1);
  waiter.detach();
  await until(() => locks.pending() === 0);
});
