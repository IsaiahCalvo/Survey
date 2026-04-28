// src/components/collab/__tests__/StorageFailureBanner.syncQueueStuck.test.mjs
// Phase 30 Wave 0 scaffold (Plan 30-01) — runs as test.skip until Plan 30-05
// adds the `sync_queue_stuck` copy variant + 'Some changes haven't saved yet'
// heading + 'Retry now' action to src/components/collab/StorageFailureBanner.jsx.
//
// Validates AC-9 banner copy contract:
//   - heading: "Some changes haven't saved yet"
//   - body matches CONTEXT.md UI-SPEC verbatim
//   - action link: "Retry now"
//   - dismiss button with aria-label="Dismiss banner"
//
// Why source-grep instead of JSX render: node:test cannot load .jsx files
// directly (loader extension limitation, same as tests/calloutRenderer.test.mjs).
// Plan 14-01 precedent: assert against the source string contract, with the
// data-spec helper carrying the user-visible literals. For Plan 30-05 the
// banner literals live in COPY / HEADING_BY_CODE / SECONDARY_BY_CODE maps —
// reading the source file as text and grepping for the locked strings is the
// same contract the JSX renderer ships at runtime.
//
// Per-test existsSync skip-guard pattern (Phase 27/28/29 precedent).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TARGET = resolve(__dirname, '../StorageFailureBanner.jsx');

// Inner skip helper: file exists today (Phase 27) but the sync_queue_stuck
// variant only lands in Plan 30-05.
function syncQueueStuckPresent() {
  if (!existsSync(TARGET)) return false;
  const src = readFileSync(TARGET, 'utf8');
  return src.includes("'sync_queue_stuck'") || src.includes('"sync_queue_stuck"');
}

test(
  "StorageFailureBanner sync_queue_stuck #1: renders heading 'Some changes haven't saved yet' when code='sync_queue_stuck'",
  { skip: !existsSync(TARGET) ? 'StorageFailureBanner.jsx missing' : (!syncQueueStuckPresent() ? 'sync_queue_stuck variant not yet added (Plan 30-05)' : false) },
  async () => {
    const src = readFileSync(TARGET, 'utf8');
    // The heading literal must live in HEADING_BY_CODE map under the
    // sync_queue_stuck key. Match the locked exact string.
    assert.ok(
      src.includes("Some changes haven't saved yet"),
      "expected exact heading 'Some changes haven't saved yet' in StorageFailureBanner.jsx"
    );
  }
);

test(
  'StorageFailureBanner sync_queue_stuck #2: renders body matching CONTEXT.md UI-SPEC verbatim',
  { skip: !existsSync(TARGET) ? 'StorageFailureBanner.jsx missing' : (!syncQueueStuckPresent() ? 'sync_queue_stuck variant not yet added (Plan 30-05)' : false) },
  async () => {
    const src = readFileSync(TARGET, 'utf8');
    // Body copy locked from CONTEXT.md — single line, no truncation.
    // Plan 30-05 places this literal in the COPY map under the sync_queue_stuck key.
    const expectedBodyFragment = "A few of your recent edits are still trying to save";
    assert.ok(
      src.includes(expectedBodyFragment),
      `expected sync_queue_stuck body to contain '${expectedBodyFragment}'`
    );
    assert.ok(
      src.includes("they'll keep retrying in the background"),
      "expected sync_queue_stuck body to contain '...they'll keep retrying in the background.'"
    );
  }
);

test(
  "StorageFailureBanner sync_queue_stuck #3: renders action link 'Retry now'",
  { skip: !existsSync(TARGET) ? 'StorageFailureBanner.jsx missing' : (!syncQueueStuckPresent() ? 'sync_queue_stuck variant not yet added (Plan 30-05)' : false) },
  async () => {
    const src = readFileSync(TARGET, 'utf8');
    // The action label 'Retry now' is already used by the 'blocked' Phase 27
    // and 'transport_offline' Phase 28 codes — for sync_queue_stuck the same
    // literal must appear in the COPY map's action field.
    assert.ok(
      src.includes("'Retry now'") || src.includes('"Retry now"'),
      "expected action label 'Retry now' in StorageFailureBanner.jsx COPY map"
    );
    // Sanity check: sync_queue_stuck and Retry now appear in same source file
    // (this is a presence check, not an order check; render path wires them).
    const idx = src.indexOf("sync_queue_stuck");
    assert.ok(idx >= 0, 'sync_queue_stuck present');
  }
);

test(
  "StorageFailureBanner sync_queue_stuck #4: existing dismiss button with aria-label='Dismiss banner' applies (NOT permission_revoked)",
  { skip: !existsSync(TARGET) ? 'StorageFailureBanner.jsx missing' : (!syncQueueStuckPresent() ? 'sync_queue_stuck variant not yet added (Plan 30-05)' : false) },
  async () => {
    const src = readFileSync(TARGET, 'utf8');
    // Phase 27 ships aria-label="Dismiss banner" on the × dismiss button.
    // The render gate `showDismiss = code !== 'permission_revoked'` must
    // remain unchanged so sync_queue_stuck inherits the standard dismiss.
    // We assert the literal aria-label still exists AND the gate string is
    // unchanged (no new code joins the no-dismiss carve-out).
    assert.ok(
      src.includes('aria-label="Dismiss banner"'),
      'expected aria-label="Dismiss banner" still present (inherited Phase 27 contract)'
    );
    assert.ok(
      src.includes("code !== 'permission_revoked'"),
      "expected no-dismiss gate to remain restricted to 'permission_revoked' only"
    );
  }
);
