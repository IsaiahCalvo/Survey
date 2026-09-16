// The stopwatch half of the crdtBackfill Web Locks election (Phase 30).
//
// WHY IT LIVES IN ITS OWN FILE (2026-09-15)
// -----------------------------------------
// This case asserts on elapsed wall-clock time and nothing else, and it used to
// sit in crdtBackfill.weblocks.test.mjs — a file that runs in a BLOCKING CI test
// shard. A 100ms budget is TIGHTER than the 250ms one that read 341.6ms on CI run
// 34094848036 and held a production deploy behind runner weather, so it was the
// sharpest remaining edge in the blocking path. It now runs in the informational
// perf lane (scripts/ci-perf-tests.mjs), where a red reading reports rather than
// vetoes, and tests/ciBlockingPathWallClockBudgets.test.mjs guards the boundary.
//
// Nothing was relaxed to get here: the budget is still 100ms, scaled only by
// perfBudgetMs() inside the lane exactly like every other budget there, and the
// election correctness it was bundled with stayed blocking in the original file.
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perfBudgetMs } from '../../../../scripts/ci-perf-tests.mjs';
import {
  TARGET,
  skipReason,
  makeWebLocksMock,
  makeSupabaseMock,
  installMockNavigator,
  oneAnnotationRow,
} from './helpers/crdtBackfillHarness.mjs';

/** The loser must detect the marker and get out, not re-read anything. */
const LOSER_SHORT_CIRCUIT_MS = 100;

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
    const supabase = makeSupabaseMock(oneAnnotationRow());

    const args = { ydoc, yMapAnnotations, supabase, documentId: 'doc1', userId: 'importer1', sessionId: 's1', clientID: ydoc.clientID };
    // Run the leader to completion first (sets the "done" marker).
    await mod.runBackfill(args);
    // Now time the loser path — should detect marker and exit fast.
    const t0 = Date.now();
    await mod.runBackfill(args);
    const elapsed = Date.now() - t0;
    assert.ok(
      elapsed < perfBudgetMs(LOSER_SHORT_CIRCUIT_MS),
      `loser path must short-circuit under ${perfBudgetMs(LOSER_SHORT_CIRCUIT_MS)}ms (got ${elapsed}ms)`,
    );
  }
);
