#!/usr/bin/env node
// agent-cli/import-once-roundtrip.mjs — proves the EMBEDDED-IMPORT-ONCE fix
// against the real Supabase backend, reproducing the exact bug the user hit:
//
//   "I had drawn a pen stroke on an earlier version. On re-open the pen stroke
//    came back but the embedded annotations on pages 6-11 did NOT import."
//
// Root cause (fixed): embedded import was gated on the live mark count being
// zero, so a single user stroke silently suppressed the import forever. The fix
// gates import on the durable per-document marker documents.embedded_import_completed_at
// instead, and merges imported marks ALONGSIDE existing ones with stable ids.
//
// This drives the same data-layer operations PDFViewer's import effect performs
// (read marker → applyByPage merge → stamp marker), headlessly against the real
// backend, and asserts:
//   1. With a pen stroke already present, the pages 6-11 import STILL runs.
//   2. Both the pen stroke AND the 6-11 marks survive a cold reopen.
//   3. The durable marker makes a second open skip import (no duplication).
//   4. Hard-delete cascades the op-log + snapshot away.
//
// Usage: node agent-cli/import-once-roundtrip.mjs [--keep]

import { makeClient } from './lib/client.mjs';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';

function freshHandle(opts, actorUserId) {
  return openAnnotationDoc({ ...opts, actorUserId, doc: new Y.Doc() });
}

let failures = 0;
function check(pass, passMsg, failMsg) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${pass ? passMsg : failMsg}`);
  if (!pass) failures += 1;
  return pass;
}

function mark(id, page) {
  return { type: 'path', stroke: '#ff0000', data: { id }, pageNumber: page };
}
function idsOf(byPage) {
  return Object.values(byPage)
    .flatMap((p) => (p.objects || []).map((o) => o.data.id))
    .sort();
}

// Mirror of PDFViewer's import-once gate, operating on the durable handle. This
// is exactly what the viewer effect drives (read marker → import+merge → stamp).
async function runEmbeddedImportOnce(supabase, documentId, handle, importedByPage) {
  const { data: metaRow } = await supabase
    .from('documents')
    .select('embedded_import_completed_at')
    .eq('id', documentId)
    .maybeSingle();
  if (metaRow?.embedded_import_completed_at) {
    return { imported: false, reason: 'already-imported' };
  }
  // Merge imported marks alongside whatever is already in the store, keyed by id.
  const current = handle.getByPage();
  const merged = { ...current };
  for (const [page, pageData] of Object.entries(importedByPage)) {
    const existing = Array.isArray(merged[page]?.objects) ? merged[page].objects : [];
    const existingIds = new Set(existing.map((o) => o?.data?.id).filter(Boolean));
    const add = (pageData.objects || []).filter((o) => !existingIds.has(o?.data?.id));
    merged[page] = { ...(merged[page] || {}), objects: [...existing, ...add] };
  }
  handle.applyByPage(merged);
  await handle.drain();
  await supabase
    .from('documents')
    .update({ embedded_import_completed_at: new Date().toISOString() })
    .eq('id', documentId);
  return { imported: true };
}

async function main() {
  const keep = process.argv.includes('--keep');
  const { supabase, userId, who } = await makeClient('user');
  const runTag = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const docName = `_tmp-import-once-${runTag}.pdf`;

  console.log('# import-once-roundtrip — embedded-import-once fix (real backend)');
  console.log(`# auth:      ${who}`);
  console.log(`# throwaway: ${docName}\n`);

  // The "embedded marks" a PDF carries on pages 6-11.
  const embeddedByPage = {
    6: { objects: [mark('embed-p6', 6)] },
    7: { objects: [mark('embed-p7', 7)] },
    8: { objects: [mark('embed-p8', 8)] },
    9: { objects: [mark('embed-p9', 9)] },
    10: { objects: [mark('embed-p10', 10)] },
    11: { objects: [mark('embed-p11', 11)] },
  };

  let documentId = null;
  try {
    const { data, error } = await supabase
      .from('documents')
      .insert({ user_id: userId, name: docName, file_path: `${userId}/import-once/${runTag}.pdf`, file_size: 2048, page_count: 11, archived: false })
      .select('id, embedded_import_completed_at').single();
    if (error) throw new Error(`doc insert: ${error.message}`);
    documentId = data.id;
    console.log(`SETUP  created ${documentId}`);
    check(!data.embedded_import_completed_at, 'new document starts with no import marker', 'new doc unexpectedly already marked imported');

    // STEP 1 — user draws a pen stroke (the "earlier version" mark) BEFORE import.
    console.log('\nSTEP 1  user draws one pen stroke, before embedded import runs');
    const session1 = await freshHandle({ documentId, supabase, clientId: 'deviceA', enableLocal: false, enableRealtime: false }, userId);
    session1.applyByPage({ 1: { objects: [mark('user-pen-stroke', 1)] } });
    await session1.drain();
    check(idsOf(session1.getByPage()).length === 1, 'store has exactly the 1 user stroke', 'unexpected store contents after draw');

    // STEP 2 — embedded import runs WITH the stroke present (old bug: blocked).
    console.log('\nSTEP 2  embedded import runs while a user mark is already present');
    const r1 = await runEmbeddedImportOnce(supabase, documentId, session1, embeddedByPage);
    await session1.flushSnapshot();
    await session1.destroy();
    check(r1.imported === true, 'import ran despite the existing pen stroke (count gate is gone)', `import did NOT run: ${r1.reason}`);

    // STEP 3 — cold reopen: BOTH the pen stroke and pages 6-11 must be present.
    console.log('\nSTEP 3  cold reopen → pen stroke AND pages 6-11 both survive');
    const reopen = await freshHandle({ documentId, supabase, clientId: 'deviceA-reopen', enableLocal: false, enableRealtime: false }, userId);
    const got = idsOf(reopen.getByPage());
    await reopen.destroy();
    const expected = ['embed-p10', 'embed-p11', 'embed-p6', 'embed-p7', 'embed-p8', 'embed-p9', 'user-pen-stroke'];
    check(JSON.stringify(got) === JSON.stringify(expected),
      `all 7 marks present after reopen (pen stroke + 6-11): ${got.join(', ')}`,
      `WRONG set after reopen — got: ${got.join(', ')}`);

    // STEP 4 — second open re-runs the gate: marker is set → import skipped, no dupes.
    console.log('\nSTEP 4  second open → durable marker skips re-import (no duplication)');
    const session2 = await freshHandle({ documentId, supabase, clientId: 'deviceA-third', enableLocal: false, enableRealtime: false }, userId);
    const r2 = await runEmbeddedImportOnce(supabase, documentId, session2, embeddedByPage);
    const after = idsOf(session2.getByPage());
    await session2.destroy();
    check(r2.imported === false && r2.reason === 'already-imported', 'import correctly skipped on second open', `import re-ran unexpectedly: ${JSON.stringify(r2)}`);
    check(after.length === 7, `still exactly 7 marks (no duplication): ${after.length}`, `duplication detected: ${after.length} marks — ${after.join(', ')}`);

    // STEP 5 — delete cascades the op-log + snapshot away.
    console.log('\nSTEP 5  hard-delete → op-log + snapshot cascade away');
    await supabase.from('documents').delete().eq('id', documentId);
    const { data: leftUpdates } = await supabase.from('annotation_updates').select('seq').eq('document_id', documentId);
    const { data: leftSnap } = await supabase.from('annotation_snapshots').select('document_id').eq('document_id', documentId);
    documentId = null;
    check((leftUpdates || []).length === 0 && (leftSnap || []).length === 0,
      'op-log + snapshot rows cascade-deleted',
      `rows survived delete: ${(leftUpdates || []).length} updates, ${(leftSnap || []).length} snapshots`);

  } finally {
    if (documentId && !keep) {
      await supabase.from('documents').delete().eq('id', documentId).then(() => {}, () => {});
      console.log(`\nCLEANUP  removed ${documentId}`);
    }
  }

  console.log('');
  if (failures === 0) {
    console.log('RESULT: PASS — embedded-import-once fix verified against the real backend');
    process.exit(0);
  } else {
    console.log(`RESULT: FAIL — ${failures} assertion(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(`\nFATAL: ${err.message}`); process.exit(1); });
