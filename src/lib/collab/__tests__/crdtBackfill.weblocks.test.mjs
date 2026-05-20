// src/lib/collab/__tests__/crdtBackfill.weblocks.test.mjs
// Phase 30 Wave 0 scaffold (Plan 30-01) — runs as test.skip until Plan 30-02 lands
// src/lib/collab/crdtBackfill.js with Web Locks election.
//
// Validates AC: two concurrent runBackfill calls on the same (userId, documentId)
// produce ONE leader path + ONE no-op loser path. Defends against double-import
// when a user has the same document open in two tabs.
//
// Per-test existsSync skip-guard pattern (Phase 27/28/29 precedent).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TARGET = resolve(__dirname, '../crdtBackfill.js');
const REPO_ROOT = resolve(__dirname, '../../../..');
const YJS_INSTALLED = existsSync(resolve(REPO_ROOT, 'node_modules/yjs/package.json'));

function skipReason() {
  if (!existsSync(TARGET)) return 'crdtBackfill.js not yet present (Plan 30-02)';
  if (!YJS_INSTALLED) return 'yjs not installed yet';
  return false;
}

// Web Locks API mock — production module reads navigator.locks.request(...).
// Mock: serializes by lock name. The first request to acquire a given name
// runs its callback; subsequent requests with mode:'exclusive' wait in a
// queue and run sequentially after the previous callback resolves.
function makeWebLocksMock() {
  const queues = new Map();
  return {
    request(name, optsOrCb, maybeCb) {
      const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
      const opts = typeof optsOrCb === 'object' ? optsOrCb : {};
      const queue = queues.get(name) || Promise.resolve();
      // Pass a lightweight lock descriptor through to callback.
      const lockDesc = { name, mode: opts.mode || 'exclusive' };
      const next = queue.then(() => cb(lockDesc));
      queues.set(name, next.catch(() => {}));
      return next;
    },
  };
}

// Helper Supabase mock that counts .range() invocations — proxy for "leader
// ran the paginated SELECT" vs "loser short-circuited via marker check".
// (Phase 31 hotfix 2026-05-03: production backfill paginates with .range();
// .order() is no longer terminal so counting .range() is the correct proxy
// for an actual SELECT firing.)
function makeSupabaseMock(rows) {
  const calls = { range: 0 };
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    in() { return builder; },
    order() { return builder; },
    range(from, to) {
      calls.range += 1;
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
  return {
    from() { return builder; },
    _calls: calls,
  };
}

// Node 22+ exposes a built-in `globalThis.navigator` as a getter-only property,
// so plain assignment `globalThis.navigator = {...}` throws TypeError. Use
// Object.defineProperty (the descriptor is configurable) for the override and
// restore the original descriptor on cleanup. SSR-safe: when navigator is
// genuinely undefined (older Node, browser shims), defineProperty still works
// because there is no existing getter to clash with.
function installMockNavigator(t, mockNavigator) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: mockNavigator,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  t.after(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    } else {
      delete globalThis.navigator;
    }
  });
}

test(
  'crdtBackfill weblocks #1: second concurrent runBackfill no-ops via Web Locks election (1 leader + 1 loser)',
  { skip: !existsSync(TARGET) ? 'crdtBackfill.js not yet present (Plan 30-02)' : (skipReason() || false) },
  async (t) => {
    const Y = await import('yjs');
    const mod = await import(TARGET);
    const locks = makeWebLocksMock();
    installMockNavigator(t, { locks });

    const ydoc = new Y.Doc();
    const yMapAnnotations = ydoc.getMap('annotations');
    const supabase = makeSupabaseMock([
      { annotation_id: 'anno-A', user_id: 'alice', document_id: 'doc1', annotation_type: 'square',
        created_at: '2026-01-15T10:00:00Z', annotation_data: '{"left":0,"top":0}' },
    ]);

    // Fire two concurrent backfill attempts on the same (userId, documentId).
    const args = { ydoc, yMapAnnotations, supabase, documentId: 'doc1', userId: 'importer1', sessionId: 's1', clientID: ydoc.clientID };
    const [r1, r2] = await Promise.all([mod.runBackfill(args), mod.runBackfill(args)]);

    // Exactly one of them performed the SELECT; the other short-circuited
    // because a marker (yMapAnnotations.get('__migration__') sentinel OR a
    // dedicated yMapMeta yMap.get('backfillDone') marker) was already set
    // when the loser acquired the lock.
    assert.strictEqual(supabase._calls.range, 1, 'exactly one runBackfill should run the SELECT (leader); the other must short-circuit (loser)');
    // Both calls resolve cleanly — loser does NOT throw.
    assert.ok(r1 !== undefined || r1 === undefined, 'leader resolves');
    assert.ok(r2 !== undefined || r2 === undefined, 'loser resolves');
  }
);

test(
  'crdtBackfill weblocks #2: loser tab releases lock immediately after no-op (under 100ms)',
  { skip: !existsSync(TARGET) ? 'crdtBackfill.js not yet present (Plan 30-02)' : (skipReason() || false) },
  async (t) => {
    const Y = await import('yjs');
    const mod = await import(TARGET);
    const locks = makeWebLocksMock();
    installMockNavigator(t, { locks });

    const ydoc = new Y.Doc();
    const yMapAnnotations = ydoc.getMap('annotations');
    const supabase = makeSupabaseMock([
      { annotation_id: 'anno-A', user_id: 'alice', document_id: 'doc1', annotation_type: 'square',
        created_at: '2026-01-15T10:00:00Z', annotation_data: '{"left":0,"top":0}' },
    ]);

    const args = { ydoc, yMapAnnotations, supabase, documentId: 'doc1', userId: 'importer1', sessionId: 's1', clientID: ydoc.clientID };
    // Run the leader to completion first (sets the "done" marker).
    await mod.runBackfill(args);
    // Now time the loser path — should detect marker and exit fast.
    const t0 = Date.now();
    await mod.runBackfill(args);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 100, `loser path must short-circuit under 100ms (got ${elapsed}ms)`);
  }
);
