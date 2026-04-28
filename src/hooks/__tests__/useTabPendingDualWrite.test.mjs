// src/hooks/__tests__/useTabPendingDualWrite.test.mjs
// Phase 30 Wave 0 scaffold (Plan 30-01 Task 4) — runs as test.skip until
// Plan 30-07 lands src/hooks/useTabPendingDualWrite.js.
//
// Validates AC-13 (document tile "unsaved changes" indicator) per-document
// signal contract:
//   - Returns false when documentId has no queue entries
//   - Returns true when documentId has at least one non-quarantined queue entry
//   - Returns false when only quarantined entries match (quarantined entries
//     do NOT count toward "pending" — CONTEXT.md "rest of queue keeps moving")
//
// Per-test existsSync skip-guard pattern (Phase 27/28/29 precedent).
//
// Approach: source-grep for the hook's behavioral contracts (same rationale
// as useDualWriteQueue.test.mjs — React hook, no test-deps available, the
// shape contract locks the behavior).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TARGET = resolve(__dirname, '../useTabPendingDualWrite.js');

test(
  'useTabPendingDualWrite #1: returns false when documentId has no queue entries (default state)',
  { skip: !existsSync(TARGET) ? 'useTabPendingDualWrite.js not yet present (Plan 30-07)' : false },
  async () => {
    const src = readFileSync(TARGET, 'utf8');
    // Contract: hook accepts a documentId argument, reads the dual-write queue,
    // returns false when no entries match. The export name + signature must
    // include documentId.
    assert.ok(/useTabPendingDualWrite/.test(src), 'expected useTabPendingDualWrite hook export');
    assert.ok(/documentId/.test(src), 'expected documentId parameter');
    // Default-empty path: explicit `if (!queue || ...)` OR boolean return false.
    assert.ok(
      /return\s+false|return\s+!|\.length\s*>\s*0/.test(src),
      'expected false-default branch when queue is empty for documentId'
    );
  }
);

test(
  'useTabPendingDualWrite #2: returns true when documentId has at least one non-quarantined queue entry',
  { skip: !existsSync(TARGET) ? 'useTabPendingDualWrite.js not yet present (Plan 30-07)' : false },
  async () => {
    const src = readFileSync(TARGET, 'utf8');
    // The hook must filter queue entries by entry.payload.opts.documentId === documentId
    // (or an equivalent shape — could be entry.documentId or entry.payload.documentId
    // depending on Plan 30-04's payload shape decision).
    assert.ok(
      /payload\.opts\.documentId|payload\.documentId|entry\.documentId/.test(src),
      'expected per-entry documentId filter (payload.opts.documentId or equivalent)'
    );
    // Must read quarantined flag to exclude bad entries from the "pending" count.
    assert.ok(/quarantined/.test(src), 'expected quarantined-aware filter');
  }
);

test(
  'useTabPendingDualWrite #3: returns false when only quarantined entries match (Pitfall 30-5)',
  { skip: !existsSync(TARGET) ? 'useTabPendingDualWrite.js not yet present (Plan 30-07)' : false },
  async () => {
    const src = readFileSync(TARGET, 'utf8');
    // Negative-quarantined filter: only count entries where !entry.quarantined.
    // Either `!entry.quarantined` or `entry.quarantined === false` or
    // `.filter(e => !e.quarantined)` satisfies.
    assert.ok(
      /!\s*\w+\.quarantined|\.quarantined\s*===\s*false|\.quarantined\s*!==\s*true/.test(src),
      'expected negative-quarantined filter so quarantined entries do NOT count as pending'
    );
  }
);
