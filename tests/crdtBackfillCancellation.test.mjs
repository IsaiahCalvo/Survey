import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { runBackfill } from '../src/lib/collab/crdtBackfill.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const row = (n) => ({ annotation_id: `annotation-${n}`, user_id: 'original-author',
  annotation_type: 'square', created_at: '2026-01-01T00:00:00Z',
  annotation_data: { fabricObject: { type: 'rect', left: n, top: 2, width: 3, height: 4 }, pageNumber: 1 } });

function setup(t, { gateAt, sealed = false, rows = [row(1)] } = {}) {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const navigator = {};
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });
  const ydoc = new Y.Doc();
  const gate = deferred(), entered = deferred();
  const calls = { metadata: 0, count: 0, page: 0, seal: 0, signals: [] };
  const boundary = async (kind, result) => {
    calls[kind]++;
    if (kind === gateAt) { entered.resolve(); await gate.promise; }
    return result;
  };
  const supabase = { from(table) {
    let count = false, write = false;
    const query = {
      select(_columns, options) { count = !!options?.head; return query; },
      eq() { return query; }, in() { return query; }, order() { return query; },
      update() { write = true; return query; },
      abortSignal(signal) { calls.signals.push(signal); return query; },
      maybeSingle: () => boundary('metadata', { data: { cutover_completed_at: sealed ? '2026-01-01' : null }, error: null }),
      range: (from, to) => boundary('page', { data: rows.slice(from, to + 1), error: null }),
      then(resolve, reject) {
        assert.ok(write || count, `unexpected terminal query ${table}`);
        return boundary(write ? 'seal' : 'count', write ? { error: null } : { count: 80, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  let current = true;
  const controller = new AbortController();
  const args = { ydoc, supabase, documentId: crypto.randomUUID(), userId: 'actor-a',
    isCurrent: () => current, signal: controller.signal };
  t.after(() => {
    gate.resolve();
    ydoc.destroy();
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  });
  return { args, ydoc, calls, gate, entered, navigator, controller, retire: () => { current = false; } };
}

function cancelled(result) {
  assert.equal(result.ranAs, 'cancelled');
  assert.equal(result.cancelled, true);
  assert.equal(result.cutoverCompleted, false);
}

test('already retired backfill performs no reads and creates no document maps', async (t) => {
  const h = setup(t);
  h.retire();
  cancelled(await runBackfill(h.args));
  assert.equal(h.ydoc.share.size, 0);
  assert.equal(h.calls.page, 0);
});

for (const boundary of ['metadata', 'count', 'page']) {
  test(`retirement during ${boundary} await stops import, markers, and cutover`, async (t) => {
    const h = setup(t, { gateAt: boundary, sealed: boundary === 'count',
      ...(boundary === 'page' ? { rows: Array.from({ length: 1001 }, (_, i) => row(i)) } : {}),
    });
    if (boundary === 'count') for (let i = 0; i < 80; i++) h.ydoc.getMap('annotations').set(`existing-${i}`, i);
    const before = Y.encodeStateAsUpdate(h.ydoc);
    const running = runBackfill({ ...h.args, markCutoverComplete: boundary !== 'page' });
    await h.entered.promise;
    h.retire();
    h.gate.resolve();
    cancelled(await running);
    assert.deepEqual(Y.encodeStateAsUpdate(h.ydoc), before);
    assert.equal(h.calls.seal, 0);
    if (boundary === 'page') assert.equal(h.calls.page, 1, 'retirement prevents fetching the second page');
  });
}

test('caller AbortSignal removes a queued Web Lock without importing', async (t) => {
  const h = setup(t);
  h.navigator.locks = { request(_name, options) {
    assert.equal(options.signal, h.controller.signal);
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('retired', 'AbortError')), { once: true });
    });
  } };
  const running = runBackfill(h.args);
  h.controller.abort();
  cancelled(await running);
  assert.equal(h.calls.page, 0);
  assert.equal(h.ydoc.share.size, 0);
});

test('a late Web Lock grant checks scope again before any import', async (t) => {
  const h = setup(t);
  h.navigator.locks = { async request(_name, _options, grant) {
    await h.gate.promise;
    return grant();
  } };
  const running = runBackfill(h.args);
  h.retire();
  h.gate.resolve();
  cancelled(await running);
  assert.equal(h.calls.page, 0);
  assert.equal(h.ydoc.share.size, 0);
});

test('an already aborted signal alone cancels before document or network work', async (t) => {
  const h = setup(t);
  h.controller.abort();
  cancelled(await runBackfill({ ...h.args, isCurrent: undefined }));
  assert.equal(h.ydoc.share.size, 0);
  assert.equal(h.calls.metadata + h.calls.page, 0);
});

test('retirement in a row origin callback cannot mutate that row or write the done marker', async (t) => {
  const h = setup(t);
  const result = await runBackfill({ ...h.args, existingHydrateRows: [row(1)],
    originPayloadFactory({ userId }) {
      if (userId === 'original-author') h.retire();
      return Object.freeze({ source: 'crdt-backfill', userId });
    },
  });
  cancelled(result);
  assert.equal(h.ydoc.getMap('annotations').size, 0);
  assert.equal(h.ydoc.getMap('meta').size, 0);
});

test('retirement after a committed batch keeps those rows but stops the next batch and done marker', async (t) => {
  const rows = Array.from({ length: 150 }, (_, i) => row(i));
  const h = setup(t);
  h.ydoc.on('afterTransaction', (transaction) => {
    if (transaction.origin?.source === 'crdt-backfill') h.retire();
  });
  cancelled(await runBackfill({ ...h.args, existingHydrateRows: rows }));
  assert.equal(h.ydoc.getMap('annotations').size, 100, 'already committed first batch is preserved');
  assert.equal(h.ydoc.getMap('annotations').has('annotation-100'), false);
  assert.equal(h.ydoc.getMap('meta').has('backfill_done:actor-a'), false);
  assert.equal(h.calls.seal, 0);
});

test('retirement when the done marker commits prevents starting the cloud seal', async (t) => {
  const h = setup(t);
  h.ydoc.getMap('meta').observe(() => h.retire());
  cancelled(await runBackfill({ ...h.args, existingHydrateRows: [row(1)], markCutoverComplete: true }));
  assert.equal(h.ydoc.getMap('annotations').size, 1);
  assert.ok(h.ydoc.getMap('meta').get('backfill_done:actor-a'), 'a marker committed before retirement is not rolled back');
  assert.equal(h.calls.seal, 0);
});

test('retirement during an already sent seal never returns a successful seal', async (t) => {
  const h = setup(t, { gateAt: 'seal' });
  const running = runBackfill({ ...h.args, existingHydrateRows: [row(1)], markCutoverComplete: true });
  await h.entered.promise;
  h.retire();
  h.gate.resolve();
  cancelled(await running);
  assert.equal(h.calls.seal, 1, 'the earlier request is not undone or retried');
  assert.equal(h.calls.signals.at(-1), h.controller.signal);
  assert.equal(h.ydoc.getMap('annotations').size, 1);
});

test('scope retirement before closing-origin creation prevents the closing callback', async (t) => {
  const h = setup(t);
  let origins = 0;
  h.ydoc.on('afterTransaction', (transaction) => {
    if (transaction.origin?.source === 'crdt-backfill') h.retire();
  });
  cancelled(await runBackfill({ ...h.args, existingHydrateRows: [row(1)],
    originPayloadFactory({ userId }) { origins++; return { source: 'crdt-backfill', userId }; },
  }));
  assert.equal(origins, 2, 'only the batch and first row origins run before retirement');
});

test('abort during the local hydration grace wait does not continue into count or import', async (t) => {
  const h = setup(t, { sealed: true });
  const running = runBackfill({ ...h.args, markCutoverComplete: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.controller.abort();
  cancelled(await running);
  assert.equal(h.calls.count + h.calls.page + h.calls.seal, 0);
  assert.equal(h.ydoc.getMap('meta').size, 0);
});

test('a current caller with a signal preserves normal import and successful seal behavior', async (t) => {
  const h = setup(t);
  const result = await runBackfill({ ...h.args, markCutoverComplete: true });
  assert.equal(result.ranAs, 'leader');
  assert.equal(result.imported, 1);
  assert.equal(result.cutoverCompleted, true);
  assert.equal(h.calls.seal, 1);
});

test('a rejected lock after predicate-only retirement returns cancellation, not a stale failure', async (t) => {
  const h = setup(t);
  h.navigator.locks = { async request() { await h.gate.promise; throw new Error('lock was interrupted'); } };
  const running = runBackfill({ ...h.args, signal: undefined });
  h.retire();
  h.gate.resolve();
  cancelled(await running);
  assert.equal(h.calls.page, 0);
});
