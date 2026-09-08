// Diagnostic reproductions, NOT acceptance tests. Prints unresolved failures in
// the committed unscoped baseline and the working scoped implementation.
// No real browser, storage, credentials, or cloud: real Yjs + in-memory fake IDB.
// Run from the repo root: node debug/legacy-ydoc-lifecycle-known-gaps.mjs
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { attachLifecycle } from '../src/lib/collab/ydocLifecycle.js';
import { attachStorageFailureDetector } from '../src/lib/collab/storageFailureDetector.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 300; i++) { if (check()) return; await pause(5); }
  throw new Error('diagnostic setup failed to settle');
}
const fixture = await readFile(new URL('../tests/legacyYDocScopedLifecycle.test.mjs', import.meta.url), 'utf8');
const setupSource = fixture.slice(fixture.indexOf('function setup(t)'), fixture.indexOf("test('scope keys"));
const baselineCommit = 'ff15dfa70a8d472b4277f5b5b7a29af55e774827';
const baselineSource = execFileSync('git', ['show', `${baselineCommit}:src/lib/collab/ydocLifecycle.js`], { encoding: 'utf8' })
  .replace(/^import .*;$/gm, '').replace('export function attachLifecycle', 'function attachLifecycle');
const baseline = new Function('IndexeddbPersistence', 'Y', 'attachStorageFailureDetector',
  `${baselineSource}; return attachLifecycle;`)(IndexeddbPersistence, Y, attachStorageFailureDetector);

for (const [name, attach] of [['committed-unscoped', baseline], ['working-scoped', attachLifecycle]]) {
  const setup = new Function('Y', 'IDBFactory', 'IDBKeyRange', 'attachLifecycle', `${setupSource}; return setup;`)
    (Y, IDBFactory, IDBKeyRange, name === 'committed-unscoped'
      ? (doc, id, options) => attach(doc, id, { onStorageState: options.onStorageState }) : attach);
  {
    const cleanup = [];
    const env = setup({ after: (fn) => cleanup.push(fn) });
    try {
      const a = env.open('last-edit');
      await until(a.ready);
      const b = env.open('last-edit');
      await pause(10);
      b.doc.getMap('annotations').set('last-edit', 'unsent');
      await Promise.all([b.handle.detach(), a.handle.detach()]);
      const cold = env.open('last-edit');
      await until(cold.ready);
      console.log(JSON.stringify({ implementation: name, knownGap: 'concurrent-detach-before-delivery',
        followerMemory: b.doc.getMap('annotations').get('last-edit'),
        persistedAfterDetach: cold.doc.getMap('annotations').get('last-edit') ?? null }));
    } finally { for (const fn of cleanup) await fn(); }
  }
  {
    const cleanup = [];
    const env = setup({ after: (fn) => cleanup.push(fn) });
    const originalOpen = env.factory.open.bind(env.factory);
    let release;
    env.factory.open = (...args) => {
      const request = originalOpen(...args);
      Object.defineProperty(request, 'onsuccess', { configurable: true, set(handler) {
        request.addEventListener('success', (event) => { release = () => handler(event); }, { once: true });
      } });
      return request;
    };
    try {
      const a = env.open('blocked-open');
      await until(() => Boolean(release));
      env.factory.open = originalOpen;
      let detached = false;
      const retiring = a.handle.detach().then(() => { detached = true; });
      const b = env.open('blocked-open');
      await pause(80);
      console.log(JSON.stringify({ implementation: name, knownGap: 'unsettled-open-holds-lock',
        detached, oldRole: a.handle.role(), newRole: b.handle.role(), newReady: b.ready() }));
      release();
      release = null;
      await retiring;
    } finally {
      env.factory.open = originalOpen;
      release?.();
      for (const fn of cleanup) await fn();
    }
  }
}
