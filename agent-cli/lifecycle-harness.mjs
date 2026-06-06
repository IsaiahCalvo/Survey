#!/usr/bin/env node
// agent-cli/lifecycle-harness.mjs — AUTONOMOUS ANNOTATION-LIFECYCLE HARNESS (Layer A: data truth)
//
// Drives the FULL annotation lifecycle end-to-end against the REAL Supabase
// backend, on a THROWAWAY document the harness creates and cleans up. ZERO user
// involvement. Reuses the real authenticated client (RLS enforced, same auth
// path as the app) and the same document_annotations row shape the app's push
// path produces. No stubs, no mocks, never touches a real survey.
//
// It walks each lifecycle step and prints a per-step ledger showing exactly
// where a mark lives (saved-to-db / survived-reopen / orphaned / cascade-gone),
// so when a mark is lost we can see the precise step it was lost at.
//
// Scenarios (run in order on one throwaway doc):
//   1. SAVE_REOPEN     — draw a user mark, save, fresh-reopen, assert present.
//   2. IMPORT_PERSIST  — push N embedded-import marks, reopen, assert all present.
//   3. DELETE_SOFT     — soft-archive (the app's real delete); marks must REMAIN
//                        in the DB (documents the orphan gap) and the doc must
//                        drop out of the active-docs filter.
//   4. REUSE_REOPEN    — un-archive (the content-recognition reuse path); every
//                        mark must still be present (no blank-duplicate spawn).
//   5. CLEANUP         — hard-delete the doc; annotations must cascade away.
//
// Exits non-zero on the first failed assertion so it can gate CI / a fix loop.
//
// Usage:
//   node agent-cli/lifecycle-harness.mjs [--keep] [--import-count N]
//     --keep          leave the throwaway doc in place (skip hard-delete) for inspection
//     --import-count  number of embedded-import marks to push in scenario 2 (default 8)

import { randomUUID } from 'node:crypto';
import { makeClient } from './lib/client.mjs';

// --- constants ----------------------------------------------------------------

const POLL_INTERVAL_MS = 400;
const POLL_TIMEOUT_MS   = 15_000;
const SUPABASE_PAGE_SIZE = 1000;

// Mirror annotationCloudSync.js so we hydrate exactly as the app does.
const NON_HIGHLIGHT_TYPES = [
  'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon',
  'stamp', 'sticky_note', 'callout', 'counter', 'eraser', 'form-field',
];
const SURVEY_MARKER_TYPE_VALUES = ['survey-marker', 'highlight'];
const ANNOTATION_READ_COLUMNS =
  'id, user_id, annotation_id, annotation_type, page_number, annotation_data, created_at, updated_at';

// --- tiny ledger ---------------------------------------------------------------

let failures = 0;
function step(label) { process.stdout.write(`  ${label} ... `); }
function ok(msg = 'ok') { console.log(msg); }
function check(passed, passMsg, failMsg) {
  if (passed) { console.log(`PASS — ${passMsg}`); }
  else { console.log(`FAIL — ${failMsg}`); failures += 1; }
  return passed;
}

// --- helpers ------------------------------------------------------------------

function parseArgs(argv) {
  const flags = { keep: false, importCount: 8 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--keep') flags.keep = true;
    else if (argv[i] === '--import-count' && argv[i + 1]) { flags.importCount = Number(argv[i + 1]) || 8; i += 1; }
  }
  return flags;
}

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

// Full fresh hydrate — exactly the app's two-phase read. Discards all caches.
async function hydrate(supabase, documentId) {
  const main = await keysetRead(supabase, documentId, (q) =>
    q.in('annotation_type', NON_HIGHLIGHT_TYPES));
  const markers = await keysetRead(supabase, documentId, (q) =>
    q.in('annotation_type', SURVEY_MARKER_TYPE_VALUES)
      .not('annotation_data->fabricObject', 'is', null));
  return [...main, ...markers];
}

async function hydrateIds(supabase, documentId) {
  const rows = await hydrate(supabase, documentId);
  return new Set(rows.map((r) => r.annotation_id));
}

async function pollUntilCount(supabase, documentId, wantIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ids = await hydrateIds(supabase, documentId);
    if (wantIds.every((id) => ids.has(id))) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

// Build a document_annotations row mirroring serializeFabricObjectToRow for an
// ink stroke. `imported` tags it the way the embedded-PDF import path does.
function buildMarkRow(documentId, userId, annotationId, { imported = false } = {}) {
  const fabricObject = {
    id: annotationId,
    type: 'path',
    tool: 'pen',
    path: [['M', 100, 100], ['L', 200, 150]],
    left: 100, top: 100, width: 100, height: 50,
    scaleX: 1, scaleY: 1, angle: 0,
    flipX: false, flipY: false, skewX: 0, skewY: 0,
    fill: null, stroke: '#ff0000', strokeWidth: 2, opacity: 1,
    visible: true, originX: 'left', originY: 'top', version: '5.5.2',
    meta: { authorId: userId },
    data: { id: annotationId, isPdfImported: imported, label: 'lifecycle-harness mark — safe to delete' },
  };
  return {
    document_id: documentId,
    user_id: userId,
    annotation_id: annotationId,
    annotation_type: 'ink',
    page_number: 1,
    bounds: { x: 100, y: 100, width: 100, height: 50, rotation: 0 },
    color: '#ff0000',
    opacity: 1,
    stroke_width: 2,
    font_size: null,
    last_modified_by: userId,
    annotation_data: { fabricObject, pageNumber: 1, schemaVersion: 1, clientSessionId: null },
  };
}

async function upsertMarks(supabase, rows) {
  const { error } = await supabase
    .from('document_annotations')
    .upsert(rows, { onConflict: 'document_id,annotation_id', ignoreDuplicates: false });
  if (error) throw new Error(`upsert failed: ${error.message}`);
}

// --- main ---------------------------------------------------------------------

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const { supabase, userId, who } = await makeClient('user');

  const runTag = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const docName = `_tmp-lifecycle-${runTag}.pdf`;

  console.log('# annotation-lifecycle harness (Layer A — data truth)');
  console.log(`# auth:        ${who}`);
  console.log(`# userId:      ${userId}`);
  console.log(`# throwaway:   ${docName}\n`);

  let documentId = null;
  const userMarkId = `lh-user-${runTag}`;
  const importMarkIds = Array.from({ length: flags.importCount }, (_, i) => `lh-import-${runTag}-${i}`);

  try {
    // ---- SETUP: create a throwaway documents row (real insert, RLS-correct) --
    console.log('SETUP  create throwaway document');
    step('inserting documents row');
    {
      const { data, error } = await supabase
        .from('documents')
        .insert({
          user_id: userId,
          name: docName,
          file_path: `${userId}/lifecycle-harness/${runTag}.pdf`, // dummy — no storage object needed for DB-truth
          file_size: 1024,
          page_count: 1,
          archived: false,
        })
        .select('id')
        .single();
      if (error) throw new Error(`document insert: ${error.message}`);
      documentId = data.id;
    }
    ok(`created ${documentId}`);

    step('baseline hydrate (expect 0 marks)');
    {
      const ids = await hydrateIds(supabase, documentId);
      check(ids.size === 0, 'fresh doc has 0 marks', `expected 0, got ${ids.size}`);
    }

    // ---- SCENARIO 1: SAVE_REOPEN --------------------------------------------
    console.log('\nSCENARIO 1  draw → save → reopen');
    step('saving 1 user mark');
    await upsertMarks(supabase, [buildMarkRow(documentId, userId, userMarkId)]);
    ok();
    step('polling for confirmation');
    {
      const confirmed = await pollUntilCount(supabase, documentId, [userMarkId], POLL_TIMEOUT_MS);
      ok(confirmed ? 'confirmed' : 'TIMEOUT');
    }
    step('fresh reopen');
    {
      const ids = await hydrateIds(supabase, documentId);
      check(ids.has(userMarkId), 'user mark survived reopen', 'user mark missing after reopen');
    }

    // ---- SCENARIO 2: IMPORT_PERSIST -----------------------------------------
    console.log(`\nSCENARIO 2  embedded-import push (${importMarkIds.length} marks) → reopen`);
    step(`pushing ${importMarkIds.length} imported marks`);
    await upsertMarks(supabase, importMarkIds.map((id) => buildMarkRow(documentId, userId, id, { imported: true })));
    ok();
    step('fresh reopen');
    {
      const ids = await hydrateIds(supabase, documentId);
      const present = importMarkIds.filter((id) => ids.has(id)).length;
      check(present === importMarkIds.length,
        `all ${importMarkIds.length} imported marks survived reopen`,
        `only ${present}/${importMarkIds.length} imported marks present after reopen`);
    }

    const totalExpected = 1 + importMarkIds.length;

    // ---- SCENARIO 3: DELETE_SOFT (the app's real delete) --------------------
    console.log('\nSCENARIO 3  soft-delete (archived=true) → marks must REMAIN (orphan gap)');
    step('archiving document');
    {
      const { error } = await supabase.from('documents').update({ archived: true }).eq('id', documentId);
      if (error) throw new Error(`archive: ${error.message}`);
    }
    ok();
    step('re-reading annotations after soft-delete');
    {
      const ids = await hydrateIds(supabase, documentId);
      check(ids.size === totalExpected,
        `${ids.size} marks still in DB after soft-delete (orphaned — documents the known cascade gap)`,
        `expected ${totalExpected} orphaned marks, got ${ids.size}`);
    }
    step('confirming doc drops out of active-docs filter');
    {
      const { data, error } = await supabase
        .from('documents').select('id').eq('id', documentId).eq('archived', false);
      if (error) throw new Error(`active filter: ${error.message}`);
      check((data || []).length === 0,
        'archived doc is hidden from the active-docs list',
        'archived doc still appears in the active-docs list');
    }

    // ---- SCENARIO 4: REUSE_REOPEN (content-recognition reuse path) ----------
    console.log('\nSCENARIO 4  re-open same content (un-archive reuse) → all marks present');
    step('un-archiving document (reuse path)');
    {
      const { error } = await supabase.from('documents').update({ archived: false }).eq('id', documentId);
      if (error) throw new Error(`un-archive: ${error.message}`);
    }
    ok();
    step('fresh reopen');
    {
      const ids = await hydrateIds(supabase, documentId);
      check(ids.size === totalExpected,
        `all ${totalExpected} marks present after reuse-reopen (no blank-duplicate spawn)`,
        `expected ${totalExpected}, got ${ids.size}`);
    }

  } finally {
    // ---- CLEANUP / SCENARIO 5: hard-delete cascades annotations away --------
    if (documentId && !flags.keep) {
      console.log('\nCLEANUP  hard-delete throwaway doc → annotations cascade away');
      step('hard-deleting documents row');
      try {
        const { error } = await supabase.from('documents').delete().eq('id', documentId);
        if (error) throw new Error(error.message);
        ok();
        step('confirming annotations cascade-gone');
        const ids = await hydrateIds(supabase, documentId);
        check(ids.size === 0,
          'ON DELETE CASCADE removed all annotation rows',
          `${ids.size} annotation rows survived hard-delete (cascade broken?)`);
      } catch (e) {
        console.log(`WARNING — cleanup failed: ${e.message}`);
        console.log(`  manual cleanup: delete from documents where id = '${documentId}'`);
        failures += 1;
      }
    } else if (documentId && flags.keep) {
      console.log(`\nCLEANUP  --keep set; leaving ${documentId} (${docName}) in place.`);
    }
  }

  console.log('');
  if (failures === 0) {
    console.log('RESULT: PASS — full lifecycle verified end-to-end at the data layer');
    process.exit(0);
  } else {
    console.log(`RESULT: FAIL — ${failures} assertion(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
