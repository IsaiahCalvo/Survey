// Shared harness for the crdtBackfill Web Locks suites.
//
// 2026-09-15 — extracted from crdtBackfill.weblocks.test.mjs when its second
// case (the "loser tab short-circuits under 100ms" budget) moved out to
// crdtBackfillLoserLatency.test.mjs in the non-blocking CI perf lane. Both
// suites need the identical mocks, and two copies of a Web Locks mock would
// drift. Nothing here changed in the move.
//
// Deliberately NOT named *.test.mjs: scripts/run-node-tests.mjs collects test
// files by that suffix, so this module is never run as a suite of its own.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The production module under test — absent until Plan 30-02 lands. */
export const TARGET = resolve(__dirname, '../../crdtBackfill.js');

const REPO_ROOT = resolve(__dirname, '../../../../..');
const YJS_INSTALLED = existsSync(resolve(REPO_ROOT, 'node_modules/yjs/package.json'));

/** false when the suite can run; otherwise the reason it is skipped. */
export function skipReason() {
  if (!existsSync(TARGET)) return 'crdtBackfill.js not yet present (Plan 30-02)';
  if (!YJS_INSTALLED) return 'yjs not installed yet';
  return false;
}

// Web Locks API mock — production module reads navigator.locks.request(...).
// Mock: serializes by lock name. The first request to acquire a given name
// runs its callback; subsequent requests with mode:'exclusive' wait in a
// queue and run sequentially after the previous callback resolves.
export function makeWebLocksMock() {
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
export function makeSupabaseMock(rows) {
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
export function installMockNavigator(t, mockNavigator) {
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

/** The single annotation row both suites backfill. */
export function oneAnnotationRow() {
  return [{
    annotation_id: 'anno-A',
    user_id: 'alice',
    document_id: 'doc1',
    annotation_type: 'square',
    created_at: '2026-01-15T10:00:00Z',
    annotation_data: '{"left":0,"top":0}',
  }];
}
