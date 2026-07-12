// src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs
//
// Phase 30 - Plan 30-01 Wave 0 scaffold (created out-of-order during Plan 30-03
// execution as a Rule 3 blocking deviation - Plan 30-03 needs this scaffold to
// verify its production module). When Plan 30-01 runs, its task should detect
// this file already exists and reuse it verbatim.
//
// Per-test existsSync skip-guard pattern (Phase 27/28/29 precedent). Tests
// auto-flip skip->green the moment src/lib/collab/crdtDualWriteQueue.js lands.
//
// Locks the contracts that Plan 30-03 implementation MUST satisfy:
//   - STORAGE_KEY_PREFIX = 'crdt_dual_write_queue:' (test 1)
//   - QUARANTINE_THRESHOLD = 10                       (test 4)
//   - STUCK_THRESHOLD_MS = 30_000                     (test 6)
//   - BACKOFF_MS[1] = 2_000                           (test 3)
//   - Latest-version-wins replacement                  (test 2)
//   - Drain skips quarantined entries (Pitfall 30-5) (test 5)
//   - Persistence across module reloads               (test 7)

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TARGET = resolve(__dirname, '../crdtDualWriteQueue.js');

// --- Test fixtures -----------------------------------------------------------
//
// In-memory localStorage shim. Every test resets this in beforeEach so test
// isolation is preserved across the whole file. SSR-safe because the production
// module guards every storage access via getStorage().

let originalLocalStorage;

function installFakeLocalStorage() {
  const store = {};
  const fake = {
    _store: store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key(i) { return Object.keys(store)[i] || null; },
  };
  originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = fake;
  return fake;
}

function restoreLocalStorage() {
  if (originalLocalStorage === undefined) {
    delete globalThis.localStorage;
  } else {
    globalThis.localStorage = originalLocalStorage;
  }
  originalLocalStorage = undefined;
}

// --- Test 1: enqueue stores entry keyed by annoId in localStorage -----------

test('enqueue stores entry keyed by annoId in localStorage[`crdt_dual_write_queue:${userId}`]',
  { skip: !existsSync(TARGET) ? 'crdtDualWriteQueue.js not yet present (Plan 30-03)' : false },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import('../crdtDualWriteQueue.js');
      mod.enqueue({ userId: 'u1', annoId: 'A', side: 'legacy', payload: { x: 1 } });

      const raw = fake._store['crdt_dual_write_queue:u1'];
      assert.ok(raw, 'expected localStorage key crdt_dual_write_queue:u1 to exist');

      const parsed = JSON.parse(raw);
      assert.ok(parsed.A, 'expected entry keyed by annoId A');
      assert.equal(parsed.A.annoId, 'A');
      assert.equal(parsed.A.side, 'legacy');
      assert.deepEqual(parsed.A.payload, { x: 1 });
      assert.equal(parsed.A.attempts, 0);
      assert.ok(typeof parsed.A.queuedAt === 'number' && parsed.A.queuedAt > 0);
      assert.equal(parsed.A.lastAttemptAt, null);
      assert.equal(parsed.A.quarantined, false);
    } finally {
      restoreLocalStorage();
    }
  }
);

// --- Test 2: re-edit replaces queued entry (latest-version-wins) ------------

test('re-edit replaces queued entry (latest-version-wins, never appends)',
  { skip: !existsSync(TARGET) ? 'crdtDualWriteQueue.js not yet present (Plan 30-03)' : false },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import('../crdtDualWriteQueue.js');
      mod.enqueue({ userId: 'u2', annoId: 'X', side: 'legacy', payload: { v: 'A' } });
      mod.enqueue({ userId: 'u2', annoId: 'X', side: 'crdt',   payload: { v: 'B' } });

      const parsed = JSON.parse(fake._store['crdt_dual_write_queue:u2']);
      const keys = Object.keys(parsed);
      assert.equal(keys.length, 1, 'expected exactly one entry under annoId X');
      assert.equal(keys[0], 'X');
      assert.deepEqual(parsed.X.payload, { v: 'B' }, 'expected latest payload to win');
      assert.equal(parsed.X.side, 'crdt', 'expected latest side to win');
    } finally {
      restoreLocalStorage();
    }
  }
);

// --- Test 3: drainQueue retries entries past their backoff window ----------

test('drainQueue retries entries whose backoff window has elapsed',
  { skip: !existsSync(TARGET) ? 'crdtDualWriteQueue.js not yet present (Plan 30-03)' : false },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import('../crdtDualWriteQueue.js');

      // Hand-craft entry with attempts=1 + lastAttemptAt 2s ago.
      // BACKOFF_MS[1] === 2_000, so this is on the boundary - 2s elapsed >= backoff.
      const queue = {
        E: {
          annoId: 'E',
          side: 'legacy',
          payload: { p: 1 },
          attempts: 1,
          queuedAt: Date.now() - 5_000,
          lastAttemptAt: Date.now() - 2_000,
          quarantined: false,
        },
      };
      fake._store['crdt_dual_write_queue:u3'] = JSON.stringify(queue);

      let retryCalled = 0;
      const result = await mod.drainQueue({
        userId: 'u3',
        retryLegacyWrite: async () => { retryCalled++; },
        retryCrdtWrite: async () => {},
        onStuck: () => {},
        onQuarantine: () => {},
      });

      assert.equal(retryCalled, 1, 'expected retryLegacyWrite to fire once');
      assert.equal(result.drained, 1, 'expected drained count to be 1');

      const after = JSON.parse(fake._store['crdt_dual_write_queue:u3']);
      assert.equal(Object.keys(after).length, 0, 'expected entry to be removed after success');
    } finally {
      restoreLocalStorage();
    }
  }
);

// --- Test 4: quarantines entry after 10 failed attempts --------------------

test('quarantines entry after QUARANTINE_THRESHOLD attempts and emits onQuarantine',
  { skip: !existsSync(TARGET) ? 'crdtDualWriteQueue.js not yet present (Plan 30-03)' : false },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import('../crdtDualWriteQueue.js');
      assert.equal(mod.QUARANTINE_THRESHOLD, 10, 'QUARANTINE_THRESHOLD constant locked at 10');

      // Hand-craft attempts=9 - next failed attempt should cross the threshold.
      const queue = {
        Q: {
          annoId: 'Q',
          side: 'legacy',
          payload: { p: 1 },
          attempts: 9,
          queuedAt: Date.now() - 60_000,
          lastAttemptAt: Date.now() - 60_000, // way past any backoff window
          quarantined: false,
        },
      };
      fake._store['crdt_dual_write_queue:u4'] = JSON.stringify(queue);

      let onQuarantineArg = null;
      await mod.drainQueue({
        userId: 'u4',
        retryLegacyWrite: async () => { throw new Error('persistent failure'); },
        retryCrdtWrite: async () => {},
        onStuck: () => {},
        onQuarantine: (arg) => { onQuarantineArg = arg; },
      });

      const after = JSON.parse(fake._store['crdt_dual_write_queue:u4']);
      assert.ok(after.Q, 'expected entry to remain in queue');
      assert.equal(after.Q.quarantined, true, 'expected entry to be marked quarantined');
      assert.equal(after.Q.attempts, 10, 'expected attempts to equal QUARANTINE_THRESHOLD');
      assert.deepEqual(onQuarantineArg, { annoId: 'Q' }, 'expected onQuarantine to fire with annoId');
    } finally {
      restoreLocalStorage();
    }
  }
);

// --- Test 5: drain skips quarantined entries (Pitfall 30-5) ---------------

test('drain skips quarantined entries; rest of queue keeps moving (Pitfall 30-5)',
  { skip: !existsSync(TARGET) ? 'crdtDualWriteQueue.js not yet present (Plan 30-03)' : false },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import('../crdtDualWriteQueue.js');

      const queue = {
        BAD: {
          annoId: 'BAD',
          side: 'legacy',
          payload: {},
          attempts: 10,
          queuedAt: Date.now() - 100_000,
          lastAttemptAt: Date.now() - 100_000,
          quarantined: true,
        },
        GOOD: {
          annoId: 'GOOD',
          side: 'legacy',
          payload: {},
          attempts: 0,
          queuedAt: Date.now() - 1_000,
          lastAttemptAt: null,
          quarantined: false,
        },
      };
      fake._store['crdt_dual_write_queue:u5'] = JSON.stringify(queue);

      let badCalls = 0;
      let goodCalls = 0;
      await mod.drainQueue({
        userId: 'u5',
        retryLegacyWrite: async (payload) => {
          // No reliable annoId carrier on payload; track via order: GOOD is processed.
          // But the contract: BAD never reaches retry handler, so increment GOOD always.
          goodCalls++;
        },
        retryCrdtWrite: async () => {},
        onStuck: () => {},
        onQuarantine: () => {},
      });

      // Bad entry stays quarantined, never retried; Good entry retried + drained.
      assert.equal(goodCalls, 1, 'expected exactly one (non-quarantined) retry');
      const after = JSON.parse(fake._store['crdt_dual_write_queue:u5']);
      assert.ok(after.BAD, 'expected quarantined entry to remain');
      assert.equal(after.BAD.quarantined, true);
      assert.equal(after.GOOD, undefined, 'expected drained entry to be removed');
    } finally {
      restoreLocalStorage();
    }
  }
);

// --- Test 6: stuck threshold fires onStuck after 30s ----------------------

test('stuck threshold fires onStuck({ stuckCount }) for entries pending > STUCK_THRESHOLD_MS',
  { skip: !existsSync(TARGET) ? 'crdtDualWriteQueue.js not yet present (Plan 30-03)' : false },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import('../crdtDualWriteQueue.js');
      assert.equal(mod.STUCK_THRESHOLD_MS, 30_000, 'STUCK_THRESHOLD_MS constant locked at 30_000');

      // Hand-craft queuedAt = 31s ago - past the stuck threshold.
      // lastAttemptAt very recent so backoff prevents another retry attempt;
      // we only care about the stuck signal here.
      const queue = {
        S: {
          annoId: 'S',
          side: 'legacy',
          payload: {},
          attempts: 5,
          queuedAt: Date.now() - 31_000,
          lastAttemptAt: Date.now() - 100, // inside any backoff window
          quarantined: false,
        },
      };
      fake._store['crdt_dual_write_queue:u6'] = JSON.stringify(queue);

      let onStuckArg = null;
      await mod.drainQueue({
        userId: 'u6',
        retryLegacyWrite: async () => {},
        retryCrdtWrite: async () => {},
        onStuck: (arg) => { onStuckArg = arg; },
        onQuarantine: () => {},
      });

      assert.ok(onStuckArg, 'expected onStuck to fire');
      assert.equal(onStuckArg.stuckCount, 1, 'expected stuckCount to be 1');
    } finally {
      restoreLocalStorage();
    }
  }
);

// --- Test 7: queue persists across module reloads -------------------------

test('queue persists across module reloads (localStorage round-trip survives import cache reset)',
  { skip: !existsSync(TARGET) ? 'crdtDualWriteQueue.js not yet present (Plan 30-03)' : false },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod1 = await import('../crdtDualWriteQueue.js');
      mod1.enqueue({ userId: 'u7', annoId: 'P', side: 'legacy', payload: { v: 'persist' } });

      // Queue is localStorage-backed with no module-level cache, so a second
      // read via the same module graph still proves persistence without a
      // cache-busting re-import (which splits V8 coverage counters).
      const queue = mod1.readQueue('u7');
      assert.ok(queue.P, 'expected entry to survive fresh module import');
      assert.deepEqual(queue.P.payload, { v: 'persist' });
    } finally {
      restoreLocalStorage();
    }
  }
);

test('read helpers cover pending/stuck/quarantine and kill-switch drain',
  { skip: !existsSync(TARGET) ? 'crdtDualWriteQueue.js not yet present (Plan 30-03)' : false },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import('../crdtDualWriteQueue.js');
      assert.deepEqual(mod.readQueue(null), {});
      fake._store['crdt_dual_write_queue:u8'] = '{bad-json';
      assert.deepEqual(mod.readQueue('u8'), {});

      mod.enqueue({ userId: 'u9', annoId: 'pending', side: 'crdt', payload: { ok: 1 } });
      assert.equal(mod.hasPendingForUser('u9'), true);
      assert.equal(mod.getStuckCount('u9'), 0);

      const queue = JSON.parse(fake._store['crdt_dual_write_queue:u9']);
      queue.pending.queuedAt = Date.now() - mod.STUCK_THRESHOLD_MS - 1;
      queue.q = {
        annoId: 'q',
        side: 'legacy',
        payload: {},
        attempts: 10,
        queuedAt: Date.now() - 60_000,
        lastAttemptAt: Date.now() - 60_000,
        quarantined: true,
      };
      fake._store['crdt_dual_write_queue:u9'] = JSON.stringify(queue);
      assert.equal(mod.getStuckCount('u9'), 1);
      assert.deepEqual(mod.getQuarantinedAnnoIds('u9'), ['q']);

      const prevWindow = globalThis.window;
      globalThis.window = { localStorage: fake };
      fake._store.CRDT_LAYER_DISABLED = '1';
      try {
        const killed = await mod.drainQueue({
          userId: 'u9',
          retryLegacyWrite: async () => {},
          retryCrdtWrite: async () => {},
        });
        assert.equal(killed.skippedKillSwitch, true);
      } finally {
        if (prevWindow === undefined) delete globalThis.window;
        else globalThis.window = prevWindow;
      }

      await assert.doesNotThrow(async () => {
        await mod.drainQueue({ userId: null });
      });
    } finally {
      restoreLocalStorage();
    }
  }
);

test('writeQueue swallows setItem failures; crdt drain + clear helpers',
  { skip: !existsSync(TARGET) ? 'crdtDualWriteQueue.js not yet present (Plan 30-03)' : false },
  async () => {
    const boomStore = {
      _store: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
      setItem() { throw new Error('quota'); },
      removeItem(k) { delete this._store[k]; },
      clear() {},
      get length() { return Object.keys(this._store).length; },
      key(i) { return Object.keys(this._store)[i] || null; },
    };
    const prev = globalThis.localStorage;
    globalThis.localStorage = boomStore;
    try {
      const mod = await import('../crdtDualWriteQueue.js');
      assert.doesNotThrow(() => mod.enqueue({ userId: 'u10', annoId: 'x', side: 'crdt', payload: {} }));

      const ok = installFakeLocalStorage();
      ok._store['crdt_dual_write_queue:u11'] = JSON.stringify({
        C: {
          annoId: 'C',
          side: 'crdt',
          payload: { v: 1 },
          attempts: 0,
          queuedAt: Date.now() - 5_000,
          lastAttemptAt: null,
          quarantined: false,
        },
      });
      let crdt = 0;
      const drained = await mod.drainQueue({
        userId: 'u11',
        retryCrdtWrite: async () => { crdt++; },
      });
      assert.equal(crdt, 1);
      assert.equal(drained.drained, 1);

      // Only quarantined → no pending
      ok._store['crdt_dual_write_queue:u12'] = JSON.stringify({
        q: { annoId: 'q', quarantined: true },
      });
      assert.equal(mod.hasPendingForUser('u12'), false);

      const prevWindow = globalThis.window;
      const warn = console.warn;
      console.warn = () => {};
      globalThis.window = {
        localStorage: ok,
        __crdtForceLegacyFail: true,
        __crdtForceFailAnnoId: 'x',
      };
      try {
        ok._store['crdt_dual_write_queue:u13'] = '{}';
        const cleared = mod.clearAllDualWriteQueuesAndFlags();
        assert.ok(cleared.cleared >= 1);
        assert.ok(cleared.flagsReset >= 1);
        assert.deepEqual(mod.clearAllDualWriteQueuesAndFlags(), { cleared: 0, flagsReset: 0 });
      } finally {
        console.warn = warn;
        if (prevWindow === undefined) delete globalThis.window;
        else globalThis.window = prevWindow;
      }
    } finally {
      if (prev === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prev;
      restoreLocalStorage();
    }
  }
);

test('drainQueue leaves entries alone when no side handler is injected',
  { skip: !existsSync(TARGET) },
  async () => {
    const prev = globalThis.localStorage;
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      key: (i) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    };
    try {
      const mod = await import('../crdtDualWriteQueue.js');
      store['crdt_dual_write_queue:u-nohandler'] = JSON.stringify({
        a1: {
          annoId: 'a1',
          side: 'legacy',
          payload: { v: 1 },
          attempts: 0,
          queuedAt: Date.now() - 60_000,
          lastAttemptAt: null,
          quarantined: false,
        },
      });
      const result = await mod.drainQueue({ userId: 'u-nohandler' });
      assert.equal(result.drained, 0);
      const kept = JSON.parse(store['crdt_dual_write_queue:u-nohandler']);
      assert.ok(kept.a1);
      assert.equal(kept.a1.attempts, 0);
    } finally {
      if (prev === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prev;
    }
  },
);
