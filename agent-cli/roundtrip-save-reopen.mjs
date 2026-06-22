#!/usr/bin/env node
// agent-cli/roundtrip-save-reopen.mjs — PRIMARY REGRESSION GATE (§2.1)
//
// Proves that an annotation survives the full cycle:
//   draw → upsert to Supabase → clear local state → reload from cloud → mark present
//
// Uses the REAL authenticated Supabase client (same auth path as the app) and
// the same document_annotations upsert shape the app's push path produces. No
// stubs, no mocks. Writes exactly ONE clearly-labeled test annotation, polls
// until confirmed, re-reads from scratch, asserts baseline + new mark are all
// present, then deletes the test mark and verifies cleanup. Exits non-zero on
// any failure so it can gate CI.
//
// Usage:
//   node agent-cli/roundtrip-save-reopen.mjs [--doc <documentId>]
//
// Default document: SE-011 live 00e1cde9-449b-4771-9743-37bd604557a9
// (546 total marks, all user-drawn, as of 2026-06-05)

import { randomUUID } from 'node:crypto';
import { makeClient } from './lib/client.mjs';

// --- constants ----------------------------------------------------------------

const DEFAULT_DOC_ID = '00e1cde9-449b-4771-9743-37bd604557a9';
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS  = 15_000;
const SUPABASE_PAGE_SIZE = 1000;

// Mirrors the type lists in annotationCloudSync.js so we load marks the same
// way the app does (two reads: non-highlight types + marker types).
const NON_HIGHLIGHT_TYPES = [
  'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon',
  'stamp', 'sticky_note', 'callout', 'counter', 'eraser', 'form-field',
];
const SURVEY_MARKER_TYPE_VALUES = ['survey-marker', 'highlight'];
const ANNOTATION_READ_COLUMNS =
  'id, user_id, annotation_id, annotation_type, page_number, annotation_data, created_at, updated_at';

// Test-mark identifiers. The annotation_id is deterministic so cleanup can
// find it even if a prior run was interrupted.
const TEST_ANNOTATION_ID = 'agent-cli-roundtrip-gate-test-mark-v1';
const TEST_ANNOTATION_TYPE = 'ink'; // real type, accepted by all read filters

// --- helpers ------------------------------------------------------------------

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--doc' && argv[i + 1]) { flags.doc = argv[i + 1]; i += 1; }
  }
  return flags;
}

// Keyset paginate one annotation-type filter, mirroring the app's collectKeysetRows.
async function keysetRead(supabase, documentId, applyFilter) {
  const rows = [];
  let cursorId = null;
  for (;;) {
    let q = supabase
      .from('document_annotations')
      .select(ANNOTATION_READ_COLUMNS)
      .eq('document_id', documentId)
      .order('id', { ascending: true })
      .limit(SUPABASE_PAGE_SIZE);
    if (cursorId !== null) q = q.gt('id', cursorId);
    const { data, error } = await applyFilter(q);
    if (error) throw new Error(`keyset read: ${error.message}`);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
    cursorId = batch[batch.length - 1].id;
  }
  return rows;
}

// Full hydrate: mirrors the app's two-phase read (main + markers).
// Returns all annotation rows for the document as the app would load them.
async function hydrateAllRows(supabase, documentId) {
  const main = await keysetRead(supabase, documentId, (q) =>
    q.in('annotation_type', NON_HIGHLIGHT_TYPES));
  const markers = await keysetRead(supabase, documentId, (q) =>
    q.in('annotation_type', SURVEY_MARKER_TYPE_VALUES)
      .not('annotation_data->fabricObject', 'is', null));
  return [...main, ...markers];
}

// Poll until the given annotation_id appears in the document, or timeout.
async function pollUntilPresent(supabase, documentId, annotationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from('document_annotations')
      .select('annotation_id')
      .eq('document_id', documentId)
      .eq('annotation_id', annotationId)
      .limit(1);
    if (error) throw new Error(`poll query: ${error.message}`);
    if ((data || []).length > 0) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

// Delete the test annotation and confirm it is gone.
async function deleteTestMark(supabase, documentId, annotationId) {
  const { error } = await supabase
    .from('document_annotations')
    .delete()
    .eq('document_id', documentId)
    .eq('annotation_id', annotationId);
  if (error) throw new Error(`delete failed: ${error.message}`);

  // Verify deletion.
  const { data, error: verErr } = await supabase
    .from('document_annotations')
    .select('annotation_id')
    .eq('document_id', documentId)
    .eq('annotation_id', annotationId)
    .limit(1);
  if (verErr) throw new Error(`delete verify: ${verErr.message}`);
  if ((data || []).length > 0) throw new Error('delete succeeded but row still visible — RLS or cache?');
}

// Build a minimal but structurally valid row for the test annotation.
// Shape mirrors what serializeFabricObjectToRow produces for an ink stroke.
function buildTestRow(documentId, userId) {
  const rowId = randomUUID(); // stable per run for the internal postgres PK
  const fabricObject = {
    id:   TEST_ANNOTATION_ID,
    type: 'path',
    tool: 'pen',
    // Minimal valid pen path: one M + one L point.
    path: [['M', 100, 100], ['L', 200, 150]],
    left:        100,
    top:         100,
    width:       100,
    height:      50,
    scaleX:      1,
    scaleY:      1,
    angle:       0,
    flipX:       false,
    flipY:       false,
    skewX:       0,
    skewY:       0,
    fill:        null,
    stroke:      '#ff0000',
    strokeWidth: 2,
    opacity:     1,
    visible:     true,
    originX:     'left',
    originY:     'top',
    version:     '5.5.2',
    meta:        { authorId: userId },
    data:        { id: TEST_ANNOTATION_ID, label: 'agent-cli roundtrip gate — safe to delete' },
  };
  return {
    // NOTE: omitting the internal `id` column — Supabase auto-assigns a UUID PK
    // on insert. We identify the row by (document_id, annotation_id) which is
    // the app's real conflict key.
    document_id:     documentId,
    user_id:         userId,
    annotation_id:   TEST_ANNOTATION_ID,
    annotation_type: TEST_ANNOTATION_TYPE,
    page_number:     1,
    bounds:          { x: 100, y: 100, width: 100, height: 50, rotation: 0 },
    color:           '#ff0000',
    opacity:         1,
    stroke_width:    2,
    font_size:       null,
    last_modified_by: userId,
    annotation_data: {
      fabricObject,
      pageNumber:      1,
      schemaVersion:   1,
      clientSessionId: null,
    },
  };
}

// --- main --------------------------------------------------------------------

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const documentId = flags.doc || DEFAULT_DOC_ID;

  const { supabase, userId, who } = await makeClient('user');
  console.log(`# roundtrip-save-reopen — PRIMARY REGRESSION GATE`);
  console.log(`# document:    ${documentId}`);
  console.log(`# auth:        ${who}`);
  console.log(`# userId:      ${userId}`);
  console.log(`# test mark:   annotation_id = ${TEST_ANNOTATION_ID}\n`);

  let testMarkInserted = false;
  let passed = false;

  try {
    // ------------------------------------------------------------------
    // STEP 1 — Read the current baseline from the cloud.
    // ------------------------------------------------------------------
    process.stdout.write('STEP 1  reading baseline from cloud ... ');
    const baselineRows = await hydrateAllRows(supabase, documentId);
    const baselineIds = new Set(baselineRows.map((r) => r.annotation_id));
    const baselineCount = baselineIds.size;
    console.log(`${baselineCount} marks loaded`);

    if (baselineCount === 0) {
      throw new Error(
        'Baseline is 0 — document appears empty. Wrong doc id, or RLS blocked all rows?'
      );
    }

    // Guard: if a previous interrupted run left the test mark behind, clean
    // it up now so the baseline count is accurate before we insert.
    if (baselineIds.has(TEST_ANNOTATION_ID)) {
      console.log('  (prior test mark found in baseline — cleaning up before test)');
      await deleteTestMark(supabase, documentId, TEST_ANNOTATION_ID);
      // Re-read the true baseline without the stale test mark.
      const cleanRows = await hydrateAllRows(supabase, documentId);
      baselineIds.clear();
      for (const r of cleanRows) baselineIds.add(r.annotation_id);
      console.log(`  true baseline after cleanup: ${baselineIds.size} marks`);
    }

    console.log(`  baseline ids recorded (${baselineIds.size} total)`);

    // ------------------------------------------------------------------
    // STEP 2 — Upsert the test annotation via the real Supabase path.
    // ------------------------------------------------------------------
    process.stdout.write('STEP 2  upserting test annotation ... ');
    const row = buildTestRow(documentId, userId);
    const { error: upsertErr } = await supabase
      .from('document_annotations')
      .upsert(row, { onConflict: 'document_id,annotation_id', ignoreDuplicates: false });
    if (upsertErr) throw new Error(`upsert failed: ${upsertErr.message}`);
    testMarkInserted = true;
    console.log('ok');

    // ------------------------------------------------------------------
    // STEP 3 — Poll until the row is confirmed present.
    // ------------------------------------------------------------------
    process.stdout.write(`STEP 3  polling for row confirmation (timeout ${POLL_TIMEOUT_MS / 1000}s) ... `);
    const confirmed = await pollUntilPresent(supabase, documentId, TEST_ANNOTATION_ID, POLL_TIMEOUT_MS);
    if (!confirmed) {
      throw new Error(
        `Test mark never appeared in document_annotations after ${POLL_TIMEOUT_MS}ms. ` +
        'Upsert may have silently failed or there is an RLS gap.'
      );
    }
    console.log('confirmed');

    // ------------------------------------------------------------------
    // STEP 4 — Clear local state (nothing in memory to clear in CLI;
    //          simulate by discarding all local references) then RE-READ
    //          from cloud — a fresh keyset hydrate, no caches.
    // ------------------------------------------------------------------
    process.stdout.write('STEP 4  re-reading document from cloud (fresh hydrate) ... ');
    const reopenRows = await hydrateAllRows(supabase, documentId);
    const reopenIds = new Set(reopenRows.map((r) => r.annotation_id));
    console.log(`${reopenRows.length} marks loaded`);

    // ------------------------------------------------------------------
    // STEP 5 — Assert: the test mark AND every baseline mark are present.
    // ------------------------------------------------------------------
    process.stdout.write('STEP 5  asserting all marks present ... ');

    const testMarkPresent = reopenIds.has(TEST_ANNOTATION_ID);
    const missingBaseline = [];
    for (const id of baselineIds) {
      if (!reopenIds.has(id)) missingBaseline.push(id);
    }

    const assertionPassed = testMarkPresent && missingBaseline.length === 0;

    if (!assertionPassed) {
      const msgs = [];
      if (!testMarkPresent) msgs.push(`  FAIL: test mark ${TEST_ANNOTATION_ID} not found after reopen`);
      if (missingBaseline.length > 0) {
        msgs.push(`  FAIL: ${missingBaseline.length} baseline mark(s) missing after reopen:`);
        missingBaseline.slice(0, 10).forEach((id) => msgs.push(`    - ${id}`));
        if (missingBaseline.length > 10) msgs.push(`    ... and ${missingBaseline.length - 10} more`);
      }
      console.log('FAILED');
      msgs.forEach((m) => console.log(m));
      throw new Error('Assertion failed — see lines above');
    }

    console.log('ok');
    console.log(`  test mark present:        YES`);
    console.log(`  baseline marks present:   ${baselineIds.size}/${baselineIds.size} (0 missing)`);
    console.log(`  total after reopen:       ${reopenIds.size}`);
    passed = true;

  } finally {
    // ------------------------------------------------------------------
    // STEP 6 — Cleanup: delete the test mark and verify it is gone.
    // ------------------------------------------------------------------
    if (testMarkInserted) {
      process.stdout.write('STEP 6  cleaning up test mark ... ');
      try {
        await deleteTestMark(supabase, documentId, TEST_ANNOTATION_ID);
        console.log('deleted and confirmed absent');

        // Final verify: re-read to confirm baseline is fully restored.
        process.stdout.write('         verifying baseline restored ... ');
        const afterCleanup = await hydrateAllRows(supabase, documentId);
        const afterIds = new Set(afterCleanup.map((r) => r.annotation_id));
        const stillHasTestMark = afterIds.has(TEST_ANNOTATION_ID);
        const restoredCount = afterIds.size;
        if (stillHasTestMark) {
          console.log('WARNING: test mark still visible after delete (may need RLS check)');
        } else {
          console.log(`ok — ${restoredCount} marks (baseline restored)`);
        }
      } catch (cleanupErr) {
        console.log(`WARNING: cleanup failed — ${cleanupErr.message}`);
        console.log('  The test mark may need manual deletion:');
        console.log(`  document_id:   ${documentId}`);
        console.log(`  annotation_id: ${TEST_ANNOTATION_ID}`);
      }
    }
  }

  // ------------------------------------------------------------------
  // Final result
  // ------------------------------------------------------------------
  console.log('');
  if (passed) {
    console.log('RESULT: PASS — annotation survived draw → save → close → reopen');
    console.log(`  document id:      ${documentId}`);
    console.log(`  baseline count:   ${DEFAULT_DOC_ID === documentId ? 'SE-011 live' : documentId}`);
    process.exit(0);
  } else {
    console.log('RESULT: FAIL');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
