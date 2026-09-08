import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { useManagedLocalDraftTracking } from '../src/hooks/useManagedLocalDraftTracking.js';
import { buildLocalDocumentState } from '../src/services/localDocumentState.js';
import { createLocalDocumentDraftStore, LOCAL_DOCUMENT_DRAFT_DB_NAME } from '../src/services/localDocumentDraftStore.js';

const idA = 'local:00000000-0000-4000-8000-000000000001';
const idB = 'local:00000000-0000-4000-8000-000000000002';
const fileFor = (localId = idA, bytes = 'original bytes') => Object.assign(
  new File([`%PDF-1.7\n${bytes}\n%%EOF`], 'draft.pdf', { type: 'application/pdf' }),
  { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: 1 },
);
const snapshot = (file, marks = []) => buildLocalDocumentState({
  pdfId: file.localId, annotationsByPage: { 1: { objects: marks.map(id => ({ id, type: 'rect' })) } },
});
const marksOf = state => JSON.parse(state.entries[`annotationsByPage_${state.pdfId}`])['1'].objects.map(mark => mark.id);

function trackedStore(t, gate = null) {
  const factory = new IDBFactory();
  const opened = []; const transactions = []; const writers = []; const captures = []; const unsettled = [];
  const store = createLocalDocumentDraftStore({ indexedDB: { open(...args) {
    opened.push(args[0]);
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result; const transaction = db.transaction.bind(db);
      db.transaction = (...args) => { transactions.push(args); return transaction(...args); };
    });
    return request;
  } } });
  const createWriter = file => {
    const real = store.createWriter(file);
    const record = { file, real, sealed: false };
    writers.push(record);
    return {
      capture(state) {
        const capture = { file, state, marks: marksOf(state) };
        captures.push(capture);
        const pending = gate ? Promise.resolve().then(() => gate(capture, captures.length)).then(() => real.capture(state)) : real.capture(state);
        unsettled.push(pending); pending.catch(() => {});
        return pending;
      },
      seal() { record.sealed = true; return real.seal(); },
    };
  };
  // Registered before mount cleanup; close is called explicitly by mount after
  // retired hook writers have drained, never while their IDB work is pending.
  const settle = async () => {
    for (let count = 0; count < 20; count++) {
      const length = unsettled.length;
      await Promise.allSettled(unsettled);
      await new Promise(resolve => setImmediate(resolve));
      if (unsettled.length === length) return;
    }
    assert.fail('draft cleanup did not settle');
  };
  return { store, createWriter, opened, transactions, writers, captures, settle };
}

function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

async function mount(t, tracked, initialRows) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const restore = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => prior ? Object.defineProperty(globalThis, key, prior) : delete globalThis[key]);
  }
  const listeners = { pagehide: new Set(), visibilitychange: new Set() };
  const listenerAdds = { pagehide: 0, visibilitychange: 0 };
  for (const [target, name] of [[window, 'pagehide'], [document, 'visibilitychange']]) {
    const add = target.addEventListener.bind(target); const remove = target.removeEventListener.bind(target);
    target.addEventListener = (event, listener, ...rest) => {
      if (event === name) { listenerAdds[name]++; listeners[name].add(listener); }
      return add(event, listener, ...rest);
    };
    target.removeEventListener = (event, listener, ...rest) => {
      if (event === name) listeners[name].delete(listener);
      return remove(event, listener, ...rest);
    };
  }
  const apis = new Map(); const errors = [];
  function Harness({ row }) {
    const api = useManagedLocalDraftTracking({ createWriter: tracked.createWriter,
      onError: (error, file) => errors.push({ error, file }), ...row });
    apis.set(row.key, api);
    return React.createElement('div', { 'data-key': row.key }, api.error || 'no error');
  }
  const root = createRoot(document.getElementById('root'));
  let rows = initialRows; let unmounted = false;
  const render = async next => {
    rows = next;
    await act(async () => root.render(React.createElement(React.Fragment, null,
      rows.map(row => React.createElement(Harness, { key: row.key, row })))));
  };
  const update = async (key, changes) => render(rows.map(row => row.key === key ? { ...row, ...changes } : row));
  const tick = async duration => act(async () => { t.mock.timers.tick(duration); });
  const flush = async key => { let receipt; await act(async () => { receipt = await apis.get(key).flush(); }); return receipt; };
  const unmount = async () => {
    if (!unmounted) { unmounted = true; await act(async () => root.unmount()); }
  };
  t.after(async () => {
    await unmount();
    await act(async () => tracked.settle());
    assert.equal(listeners.pagehide.size, 0, 'all pagehide callbacks removed');
    assert.equal(listeners.visibilitychange.size, 0, 'all visibility callbacks removed');
    tracked.store.close(); dom.window.close(); restore.reverse().forEach(fn => fn());
  });
  await render(rows);
  return { apis, errors, listeners, listenerAdds, render, update, tick, flush, unmount };
}

test('hydration and clean rerenders never create a writer or copy PDF bytes', async t => {
  const tracked = trackedStore(t); const file = fileFor();
  const mounted = await mount(t, tracked, [{ key: 'a', file, snapshot: snapshot(file), ready: false, dirty: false }]);
  await mounted.update('a', { snapshot: snapshot(file, ['hydrated']), ready: true });
  await mounted.tick(1000);
  assert.equal(await mounted.flush('a'), null);
  assert.equal(tracked.writers.length, 0);
  assert.deepEqual(tracked.opened, [], 'clean hydration has no disk access');
});

test('first dirty capture has a fixed 150ms deadline and coalesces the latest edit', async t => {
  const tracked = trackedStore(t); const file = fileFor();
  const mounted = await mount(t, tracked, [{ key: 'a', file, snapshot: snapshot(file), ready: true, dirty: false }]);
  await mounted.update('a', { snapshot: snapshot(file, ['one']), dirty: true });
  await mounted.tick(80);
  await mounted.update('a', { snapshot: snapshot(file, ['two']) });
  await mounted.tick(69);
  assert.equal(tracked.captures.length, 0);
  await mounted.tick(1);
  assert.deepEqual(tracked.captures.map(item => item.marks), [['two']], 'later renders cannot postpone the first deadline');
  await mounted.flush('a');
  const [row] = await tracked.store.listDrafts();
  const reopened = await tracked.store.readDraft(row.sessionId, { expectedSequence: row.sequence });
  assert.deepEqual(marksOf(reopened.state), ['two']);
  assert.equal(await reopened.file.text(), await file.text());
  assert.deepEqual([...new Set(tracked.opened)], [LOCAL_DOCUMENT_DRAFT_DB_NAME], 'drafts never open the canonical PDF database');
  assert.equal(tracked.transactions.filter(([names, mode]) => mode === 'readwrite' && names.includes('pdfBytes')).length, 1);
});

test('undo to empty clean state supersedes queued and already persisted recovery marks', async t => {
  const tracked = trackedStore(t); const file = fileFor();
  const mounted = await mount(t, tracked, [{ key: 'a', file, snapshot: snapshot(file, ['first']), ready: true, dirty: true }]);
  await mounted.update('a', { snapshot: snapshot(file), dirty: false });
  await mounted.tick(150); await mounted.flush('a');
  assert.deepEqual(tracked.captures.map(item => item.marks), [[]], 'undo before the deadline never persists stale marks');
  await mounted.update('a', { snapshot: snapshot(file, ['next']), dirty: true });
  await mounted.flush('a');
  await mounted.update('a', { snapshot: snapshot(file), dirty: false });
  await mounted.tick(150); await mounted.flush('a');
  const [row] = await tracked.store.listDrafts();
  assert.deepEqual(marksOf((await tracked.store.readDraft(row.sessionId, { expectedSequence: row.sequence })).state), []);
  assert.equal(tracked.writers.length, 1);
  assert.equal(tracked.transactions.filter(([names, mode]) => mode === 'readwrite' && names.includes('pdfBytes')).length, 1, 'later state captures do not copy PDF bytes');
});

test('a slow pending capture retains only the newest next snapshot without overlap', async t => {
  const held = deferred(); t.after(() => held.resolve());
  const tracked = trackedStore(t, (_capture, count) => count === 1 ? held.promise : undefined);
  const file = fileFor();
  const mounted = await mount(t, tracked, [{ key: 'a', file, snapshot: snapshot(file, ['first']), ready: true, dirty: true }]);
  await mounted.tick(150);
  await mounted.update('a', { snapshot: snapshot(file, ['middle']) });
  await mounted.update('a', { snapshot: snapshot(file, ['latest']) });
  await mounted.tick(2000);
  assert.deepEqual(tracked.captures.map(item => item.marks), [['first']], 'do not start another capture while the writer is pending');
  await act(async () => held.resolve());
  await mounted.flush('a');
  assert.deepEqual(tracked.captures.map(item => item.marks), [['first'], ['latest']]);
  const [row] = await tracked.store.listDrafts();
  assert.deepEqual(marksOf((await tracked.store.readDraft(row.sessionId, { expectedSequence: row.sequence })).state), ['latest']);
});

test('same local ID with a new File keeps retired bytes and latest pending state in separate writer sessions', async t => {
  const held = deferred(); t.after(() => held.resolve());
  const tracked = trackedStore(t, (_capture, count) => count === 1 ? held.promise : undefined);
  const oldFile = fileFor(idA, 'old page bytes'); const newFile = fileFor(idA, 'new page bytes'); newFile.localRevision = 7;
  const mounted = await mount(t, tracked, [{ key: 'a', file: oldFile, snapshot: snapshot(oldFile, ['old-first']), ready: true, dirty: true }]);
  await mounted.tick(150);
  await mounted.update('a', { snapshot: snapshot(oldFile, ['old-last']) });
  await mounted.update('a', { file: newFile, snapshot: snapshot(newFile, ['new']), dirty: true });
  await mounted.tick(150);
  await mounted.flush('a');
  await act(async () => held.resolve());
  await act(async () => tracked.settle());
  const rows = await tracked.store.listDrafts();
  assert.equal(rows.length, 2);
  const drafts = await Promise.all(rows.map(row => tracked.store.readDraft(row.sessionId, { expectedSequence: row.sequence })));
  const old = drafts.find(draft => draft.metadata.baseCanonicalRevision === 1);
  const current = drafts.find(draft => draft.metadata.baseCanonicalRevision === 7);
  assert.deepEqual(marksOf(old.state), ['old-last']); assert.match(await old.file.text(), /old page bytes/);
  assert.deepEqual(marksOf(current.state), ['new']); assert.match(await current.file.text(), /new page bytes/);
  assert.notEqual(old.metadata.fileId, current.metadata.fileId);
  assert.ok(tracked.writers.find(writer => writer.file === oldFile).sealed);
  assert.equal(mounted.apis.get('a').error, null, 'retired completion cannot change the active file status');
});

test('unmount drains the last queued snapshot without waiting for its timer', async t => {
  const tracked = trackedStore(t); const file = fileFor();
  const mounted = await mount(t, tracked, [{ key: 'a', file, snapshot: snapshot(file, ['queued']), ready: true, dirty: true }]);
  await mounted.update('a', { snapshot: snapshot(file, ['last']) });
  assert.equal(tracked.captures.length, 0);
  await mounted.unmount(); await tracked.settle();
  assert.deepEqual(tracked.captures.map(item => item.marks), [['last']]);
  assert.ok(tracked.writers[0].sealed);
  const [row] = await tracked.store.listDrafts();
  assert.deepEqual(marksOf((await tracked.store.readDraft(row.sessionId, { expectedSequence: row.sequence })).state), ['last']);
});

test('failed capture keeps the newest pending snapshot, reports error, and succeeds on explicit retry', async t => {
  const held = deferred(); t.after(() => held.resolve());
  const tracked = trackedStore(t, (_capture, count) => count === 1 ? held.promise : undefined);
  const file = fileFor();
  const mounted = await mount(t, tracked, [{ key: 'a', file, snapshot: snapshot(file, ['old']), ready: true, dirty: true }]);
  await mounted.tick(150);
  await mounted.update('a', { snapshot: snapshot(file, ['newest']) });
  await act(async () => held.reject(new DOMException('Recovery disk full', 'QuotaExceededError')));
  assert.equal(mounted.apis.get('a').error, 'Recovery disk full');
  assert.match(document.body.textContent, /Recovery disk full/);
  assert.equal(mounted.errors.length, 1); assert.equal(mounted.errors[0].file, file);
  await mounted.tick(1000);
  assert.equal(tracked.captures.length, 1, 'a full disk must not cause automatic retry spinning');
  await act(async () => mounted.apis.get('a').retry());
  assert.deepEqual(tracked.captures.map(item => item.marks), [['old'], ['newest']]);
  assert.equal(mounted.apis.get('a').error, null);
  const [row] = await tracked.store.listDrafts();
  assert.deepEqual(marksOf((await tracked.store.readDraft(row.sessionId, { expectedSequence: row.sequence })).state), ['newest']);
});

test('discarded draft tombstones stay deleted while retry and a later edit each rotate to a new writer', async t => {
  const unhandled = [];
  const recordUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', recordUnhandled);
  t.after(() => process.removeListener('unhandledRejection', recordUnhandled));
  const tracked = trackedStore(t); const file = fileFor();
  const mounted = await mount(t, tracked, [{ key: 'a', file, snapshot: snapshot(file, ['original']), ready: true, dirty: true }]);
  await mounted.tick(150); await mounted.flush('a');
  const [original] = await tracked.store.listDrafts();
  await tracked.store.discardDraft(original.sessionId, { expectedSequence: original.sequence });
  assert.deepEqual(await tracked.store.listDrafts(), []);

  await mounted.update('a', { snapshot: snapshot(file, ['after-discard']) });
  await mounted.tick(150); await act(async () => tracked.settle());
  assert.equal(mounted.errors.at(-1).error.code, 'discarded');
  assert.match(mounted.apis.get('a').error, /discarded/i);
  assert.equal(tracked.writers.length, 1, 'detecting a tombstone does not immediately spin up a retry');
  const capturesAfterFailure = tracked.captures.length;
  await mounted.tick(1000);
  assert.equal(tracked.captures.length, capturesAfterFailure, 'discard error must not cause automatic retry spinning');
  assert.deepEqual(await tracked.store.listDrafts(), [], 'old session stays discarded before explicit retry');

  await act(async () => mounted.apis.get('a').retry());
  assert.equal(mounted.apis.get('a').error, null);
  const [retried] = await tracked.store.listDrafts();
  assert.ok(retried);
  assert.notEqual(retried.sessionId, original.sessionId);
  assert.notEqual(retried.fileId, original.fileId);
  assert.equal(tracked.writers.length, 2);
  const recovered = await tracked.store.readDraft(retried.sessionId, { expectedSequence: retried.sequence });
  assert.deepEqual(marksOf(recovered.state), ['after-discard']);
  assert.equal(await recovered.file.text(), await file.text());
  await assert.rejects(tracked.store.readDraft(original.sessionId, { expectedSequence: original.sequence }), { code: 'discarded' });

  // Exercise the other allowed recovery path: a new edit after detecting a
  // second tombstone, without calling the explicit retry API.
  await tracked.store.discardDraft(retried.sessionId, { expectedSequence: retried.sequence });
  await mounted.update('a', { snapshot: snapshot(file, ['stale-after-second-discard']) });
  await mounted.tick(150); await act(async () => tracked.settle());
  assert.equal(mounted.errors.at(-1).error.code, 'discarded');
  assert.match(mounted.apis.get('a').error, /discarded/i);
  assert.deepEqual(await tracked.store.listDrafts(), []);
  await mounted.update('a', { snapshot: snapshot(file, ['latest-after-second-discard']) });
  await mounted.tick(149);
  assert.equal(tracked.writers.length, 2, 'new edit keeps the normal bounded capture deadline');
  await mounted.tick(1); await mounted.flush('a');
  const remaining = await tracked.store.listDrafts();
  assert.equal(remaining.length, 1);
  assert.equal(tracked.writers.length, 3);
  assert.notEqual(remaining[0].sessionId, retried.sessionId);
  assert.notEqual(remaining[0].sessionId, original.sessionId);
  assert.deepEqual(marksOf((await tracked.store.readDraft(remaining[0].sessionId, { expectedSequence: remaining[0].sequence })).state), ['latest-after-second-discard']);
  assert.equal(mounted.apis.get('a').error, null);
  for (const discarded of [original, retried]) {
    await assert.rejects(tracked.store.readDraft(discarded.sessionId, { expectedSequence: discarded.sequence }), { code: 'discarded' });
  }
  await mounted.unmount(); await tracked.settle();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(unhandled, [], 'failed and retired captures must not leak unhandled rejections');
});

test('two local hooks share one global lifecycle listener and both flush on hidden/pagehide', async t => {
  const tracked = trackedStore(t); const a = fileFor(); const b = fileFor(idB);
  const mounted = await mount(t, tracked, [
    { key: 'a', file: a, snapshot: snapshot(a, ['a']), ready: true, dirty: true },
    { key: 'b', file: b, snapshot: snapshot(b, ['b']), ready: true, dirty: true },
  ]);
  assert.deepEqual(mounted.listenerAdds, { pagehide: 1, visibilitychange: 1 });
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new window.Event('visibilitychange'));
  });
  assert.equal(tracked.captures.length, 0, 'visible lifecycle event does not capture');
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new window.Event('visibilitychange'));
  });
  await mounted.flush('a'); await mounted.flush('b');
  assert.deepEqual(tracked.captures.map(item => item.marks), [['a'], ['b']]);
  await mounted.update('a', { snapshot: snapshot(a, ['a-next']) });
  await mounted.update('b', { snapshot: snapshot(b, ['b-next']) });
  await act(async () => window.dispatchEvent(new window.Event('pagehide')));
  await mounted.flush('a'); await mounted.flush('b');
  assert.deepEqual(tracked.captures.map(item => item.marks), [['a'], ['b'], ['a-next'], ['b-next']]);
  await mounted.render([{ key: 'b', file: b, snapshot: snapshot(b, ['b-next']), ready: true, dirty: true }]);
  assert.equal(mounted.listeners.pagehide.size, 1);
  assert.equal(mounted.listeners.visibilitychange.size, 1);
  assert.deepEqual(mounted.listenerAdds, { pagehide: 1, visibilitychange: 1 });
});

test('cloud, ordinary files, mismatched snapshots, and unready local editors never capture', async t => {
  const tracked = trackedStore(t); const local = fileFor();
  const mounted = await mount(t, tracked, [
    { key: 'cloud', file: { ...local, id: 'cloud-document' }, snapshot: snapshot(local, ['cloud']), ready: true, dirty: true },
    { key: 'plain', file: new File(['%PDF-1.7'], 'plain.pdf'), snapshot: snapshot(local), ready: true, dirty: true },
    { key: 'mismatch', file: local, snapshot: snapshot(fileFor(idB), ['wrong-id']), ready: true, dirty: true },
    { key: 'unready', file: fileFor(idB), snapshot: snapshot(fileFor(idB), ['unready']), ready: false, dirty: true },
  ]);
  await mounted.tick(1000);
  await act(async () => window.dispatchEvent(new window.Event('pagehide')));
  for (const key of ['cloud', 'plain', 'mismatch', 'unready']) assert.equal(await mounted.flush(key), null);
  assert.equal(tracked.captures.length, 0);
  assert.equal(tracked.writers.length, 0);
  assert.deepEqual(tracked.opened, []);
});
