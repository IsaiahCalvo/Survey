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
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TARGET = resolve(__dirname, '../crdtDualWriteQueue.js');

const SKIP_REASON = !existsSync(TARGET)
  ? 'crdtDualWriteQueue.js not yet present (Plan 30-03)'
  : false;

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
  { skip: SKIP_REASON },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import(TARGET);
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
  { skip: SKIP_REASON },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import(TARGET);
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
  { skip: SKIP_REASON },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import(TARGET);

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
  { skip: SKIP_REASON },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import(TARGET);
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
  { skip: SKIP_REASON },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import(TARGET);

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
  { skip: SKIP_REASON },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod = await import(TARGET);
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
  { skip: SKIP_REASON },
  async () => {
    const fake = installFakeLocalStorage();
    try {
      const mod1 = await import(TARGET);
      mod1.enqueue({ userId: 'u7', annoId: 'P', side: 'legacy', payload: { v: 'persist' } });

      // Force fresh module load via cache-busting query string. Real "app close"
      // is irrelevant to Node's import cache; what matters is that the module
      // reads from localStorage on every readQueue call (no in-memory state).
      const mod2 = await import(`${TARGET}?reload=${Date.now()}`);
      const queue = mod2.readQueue('u7');
      assert.ok(queue.P, 'expected entry to survive fresh module import');
      assert.deepEqual(queue.P.payload, { v: 'persist' });
    } finally {
      restoreLocalStorage();
    }
  }
);
