// tests/phase31/cutoverHydrate.test.mjs
// Phase 31 Wave 0 scaffold (Plan 31-01) — locks contracts for Plan 31-04.
//
// Defends Phase 31 lean-variant scope item #4 — "Hydrate from CRDT. When a
// doc's cutover_completed_at is set, open the doc by reading from the Y.Doc
// snapshot (Phase 27 doc_yjs_state table) instead of querying
// document_annotations. Legacy reads stay available for cold-open of
// un-cutover docs (so existing data still loads on the first post-cutover
// open)."
//
// Plan 31-04 ships:
//   - cutover-aware branch in useAnnotationCloudSync.js hydrate effect
//   - YDocProvider.jsx wires the cutover_completed_at flag into the hook
//
// useAnnotationCloudSync.js exists today (Phase 21+). The grep tests below
// run against the existing file; they ship RED today and auto-flip green
// when Plan 31-04 lands the cutover branch. Same red→green pattern Phase 30
// used for its Wave 0 scaffolds.
//
// Skip-guard pattern: per-test existsSync (Phase 27/28/29/30 precedent).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOOK_PATH = path.resolve(__dirname, '../../src/hooks/useAnnotationCloudSync.js');
const HOOK_SKIP = !existsSync(HOOK_PATH)
  ? 'src/hooks/useAnnotationCloudSync.js missing'
  : false;

describe('hydrate path branches on cutover_completed_at (Plan 31-04)', () => {
  it('hook source contains cutover_completed_at literal', { skip: HOOK_SKIP }, () => {
    const source = readFileSync(HOOK_PATH, 'utf8');
    assert.match(
      source,
      /cutover_completed_at/,
      'useAnnotationCloudSync.js must reference the cutover_completed_at flag (Plan 31-04 contract)',
    );
  });

  it('hook source still references loadAllNonHighlightAnnotations for the legacy fallback path', { skip: HOOK_SKIP }, () => {
    const source = readFileSync(HOOK_PATH, 'utf8');
    // CRITICAL: Plan 31-04 must NOT delete the legacy hydrate path. It MUST
    // stay as the fallback for cold-open of un-cutover docs (so existing
    // data still loads on the first post-cutover open before the backfill
    // marker is set). This invariant is the entire reason the lean-variant
    // accepts deferring `document_annotations` deletion to Phase 32.
    assert.ok(
      source.includes('loadAllNonHighlightAnnotations'),
      'legacy fallback (loadAllNonHighlightAnnotations) must stay — required for cold-open of un-cutover docs',
    );
  });

  it('hydrate effect reads from Y.Doc when cutover_completed_at is set', { skip: HOOK_SKIP }, () => {
    const source = readFileSync(HOOK_PATH, 'utf8');
    // Within ~500 chars of a cutover_completed_at reference, source must
    // contain the literal `getMap` (Y.Doc snapshot read) OR a useYDoc
    // reference (importing the Y.Doc context). The contract is "when the
    // timestamp is set, hydrate reads from Y.Doc instead of from the legacy
    // SELECT." Either pattern satisfies — Plan 31-04 owns the exact phrasing.
    const proximity = /cutover_completed_at[\s\S]{0,500}getMap|getMap[\s\S]{0,500}cutover_completed_at|cutover_completed_at[\s\S]{0,500}useYDoc|useYDoc[\s\S]{0,500}cutover_completed_at/;
    assert.match(
      source,
      proximity,
      'hydrate path must read from Y.Doc (getMap or useYDoc) when cutover_completed_at is set — found no Y.Doc read within 500 chars of the literal',
    );
  });
});
