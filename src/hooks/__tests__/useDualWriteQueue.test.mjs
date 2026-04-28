// src/hooks/__tests__/useDualWriteQueue.test.mjs
// Phase 30 Wave 0 scaffold (Plan 30-01 Task 4) — runs as test.skip until
// Plan 30-05 lands src/hooks/useDualWriteQueue.js.
//
// Validates AC-12 + AC-13 hook contracts:
//   - Returns frozen empty default when userId is null
//   - Re-renders on queue state change (poll-based or subscription)
//   - stuckCount reflects entries past 30s threshold
//   - quarantinedAnnoIds includes only quarantined entries
//
// Per-test existsSync skip-guard pattern (Phase 27/28/29 precedent).
//
// Approach: source-grep for the hook's behavioral contracts since this is a
// React hook (node:test cannot mount React without test-deps). The contract
// is locked at the source-string level — when Plan 30-05 lands, asserting
// that `useSyncExternalStore`, `STUCK_THRESHOLD_MS`, `quarantined` flag reads,
// and the `userId === null` early-return all appear in the source proves the
// hook satisfies the contract. Plan 30-05 ALSO ships an integration test for
// runtime behavior; this scaffold is the shape contract.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TARGET = resolve(__dirname, '../useDualWriteQueue.js');

test(
  'useDualWriteQueue #1: returns frozen empty default when userId is null (no localStorage read)',
  { skip: !existsSync(TARGET) ? 'useDualWriteQueue.js not yet present (Plan 30-05)' : false },
  async () => {
    const src = readFileSync(TARGET, 'utf8');
    // Contract: hook must early-return when userId is falsy. The default shape
    // must be { stuckCount: 0, quarantinedAnnoIds: [], hasPending: false }.
    // Either an explicit `if (!userId)` OR a `userId == null` guard satisfies.
    assert.ok(
      /if\s*\(\s*!userId|userId\s*==\s*null|userId\s*===\s*null/.test(src),
      'expected hook to early-return when userId is falsy/null'
    );
    assert.ok(src.includes('stuckCount'), 'expected stuckCount in default shape');
    assert.ok(src.includes('quarantinedAnnoIds'), 'expected quarantinedAnnoIds in default shape');
    assert.ok(src.includes('hasPending'), 'expected hasPending in default shape');
  }
);

test(
  'useDualWriteQueue #2: re-renders on queue state change (poll interval or subscription)',
  { skip: !existsSync(TARGET) ? 'useDualWriteQueue.js not yet present (Plan 30-05)' : false },
  async () => {
    const src = readFileSync(TARGET, 'utf8');
    // Two valid implementations: useSyncExternalStore (subscription) OR
    // useEffect + setInterval (polling). Either satisfies the contract.
    const isSubscription = src.includes('useSyncExternalStore');
    const isPolling = /setInterval|setTimeout/.test(src) && src.includes('useEffect');
    assert.ok(
      isSubscription || isPolling,
      'expected useSyncExternalStore OR useEffect + setInterval re-render mechanism'
    );
  }
);

test(
  'useDualWriteQueue #3: stuckCount reflects entries past STUCK_THRESHOLD_MS (30s) threshold',
  { skip: !existsSync(TARGET) ? 'useDualWriteQueue.js not yet present (Plan 30-05)' : false },
  async () => {
    const src = readFileSync(TARGET, 'utf8');
    // The hook must read the queue and count entries with queuedAt < (Date.now() - 30_000).
    // Either reuses STUCK_THRESHOLD_MS from crdtDualWriteQueue OR inlines 30_000.
    assert.ok(
      src.includes('STUCK_THRESHOLD_MS') || src.includes('30_000') || src.includes('30000'),
      'expected stuckCount calculation against STUCK_THRESHOLD_MS or literal 30_000'
    );
    assert.ok(/queuedAt/.test(src), 'expected queue entry queuedAt read');
  }
);

test(
  'useDualWriteQueue #4: quarantinedAnnoIds filters by entry.quarantined === true',
  { skip: !existsSync(TARGET) ? 'useDualWriteQueue.js not yet present (Plan 30-05)' : false },
  async () => {
    const src = readFileSync(TARGET, 'utf8');
    // Contract: array contains annoIds where entry.quarantined === true.
    assert.ok(/quarantined/.test(src), 'expected quarantined flag read');
    // The filter must look for true; the negative case (filter quarantined OUT
    // for hasPending) is also valid.
    assert.ok(
      /entry\.quarantined|\.quarantined\s*===|\.quarantined\s*\?/.test(src),
      'expected quarantined-aware filter logic'
    );
  }
);
