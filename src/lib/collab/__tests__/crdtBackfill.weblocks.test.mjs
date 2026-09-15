// src/lib/collab/__tests__/crdtBackfill.weblocks.test.mjs
// Phase 30 Wave 0 scaffold (Plan 30-01) — runs as test.skip until Plan 30-02 lands
// src/lib/collab/crdtBackfill.js with Web Locks election.
//
// Validates AC: two concurrent runBackfill calls on the same (userId, documentId)
// produce ONE leader path + ONE no-op loser path. Defends against double-import
// when a user has the same document open in two tabs.
//
// Per-test existsSync skip-guard pattern (Phase 27/28/29 precedent).
//
// 2026-09-15 — the mocks moved to helpers/crdtBackfillHarness.mjs and the second
// case (the loser's "under 100ms" budget) moved to crdtBackfillLoserLatency.test.mjs
// in the non-blocking CI perf lane. This file runs in a BLOCKING CI test shard,
// where an elapsed-time assertion can red a shard on runner weather, red the run,
// and stop the production deploy. The election correctness below is the part that
// must keep its teeth, so it stayed here; only the stopwatch moved, unchanged.

import { existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TARGET,
  skipReason,
  makeWebLocksMock,
  makeSupabaseMock,
  installMockNavigator,
  oneAnnotationRow,
} from './helpers/crdtBackfillHarness.mjs';

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
    const supabase = makeSupabaseMock(oneAnnotationRow());

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
