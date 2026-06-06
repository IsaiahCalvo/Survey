#!/usr/bin/env node
// agent-cli/yjs-roundtrip.mjs — proves the REBUILT durable path end-to-end
// against the real Supabase backend, on a throwaway document.
//
// This is the new-architecture equivalent of roundtrip-save-reopen.mjs: it
// drives annotationDocSync (Y.Doc + append-only annotation_updates log +
// snapshot) exactly as the app will, headlessly (no indexeddb, no realtime),
// and asserts the marks survive a fresh reopen — including the exact scenario
// that vanished: marks on pages 6-11 plus a fresh stroke on page 11.
//
// Usage: node agent-cli/yjs-roundtrip.mjs [--keep]

import { makeClient } from './lib/client.mjs';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';

// Each simulated device gets its OWN Y.Doc so reopen is a true cold load from
// the cloud (not a shared in-memory doc). In the app, the registry supplies one
// doc per document; here we deliberately isolate per "device".
function freshHandle(opts) {
  return openAnnotationDoc({ ...opts, doc: new Y.Doc() });
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
function byPageFrom(spec) {
  // spec: { page: [id, id, ...] }
  const byPage = {};
  for (const [page, ids] of Object.entries(spec)) {
    byPage[page] = { objects: ids.map((id) => mark(id, Number(page))) };
  }
  return byPage;
}
function idsOf(byPage) {
  return Object.values(byPage)
    .flatMap((p) => (p.objects || []).map((o) => o.data.id))
    .sort();
}

async function main() {
  const keep = process.argv.includes('--keep');
  const { supabase, userId, who } = await makeClient('user');
  const runTag = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const docName = `_tmp-yjs-${runTag}.pdf`;

  console.log('# yjs-roundtrip — rebuilt durable path (Y.Doc + op-log + snapshot)');
  console.log(`# auth:      ${who}`);
  console.log(`# throwaway: ${docName}\n`);

  let documentId = null;
  try {
    // SETUP: throwaway documents row.
    const { data, error } = await supabase
      .from('documents')
      .insert({ user_id: userId, name: docName, file_path: `${userId}/yjs-rt/${runTag}.pdf`, file_size: 1024, page_count: 11, archived: false })
      .select('id').single();
    if (error) throw new Error(`doc insert: ${error.message}`);
    documentId = data.id;
    console.log(`SETUP  created ${documentId}\n`);

    // SCENARIO 1 — draw marks on pages 6-11, then a fresh stroke on page 11.
    console.log('SCENARIO 1  draw on pages 6-11 + fresh stroke on page 11 → reopen');
    const writer = await freshHandle({
      documentId, supabase, clientId: 'deviceA', enableLocal: false, enableRealtime: false,
    });
    writer.applyByPage(byPageFrom({ 6: ['p6'], 7: ['p7'], 8: ['p8'], 9: ['p9'], 10: ['p10'], 11: ['p11'] }));
    await writer.drain();
    // a separate, later stroke on page 11 (the user's exact test)
    writer.applyByPage(byPageFrom({ 6: ['p6'], 7: ['p7'], 8: ['p8'], 9: ['p9'], 10: ['p10'], 11: ['p11', 'fresh-stroke'] }));
    await writer.drain();
    await writer.flushSnapshot();
    await writer.destroy();

    // Reopen from a clean handle — loads snapshot + tail from the cloud only.
    const reader = await freshHandle({
      documentId, supabase, clientId: 'deviceA-reopen', enableLocal: false, enableRealtime: false,
    });
    const got = idsOf(reader.getByPage());
    await reader.destroy();
    check(JSON.stringify(got) === JSON.stringify(['fresh-stroke', 'p10', 'p11', 'p6', 'p7', 'p8', 'p9']),
      `all 7 marks (incl page-11 fresh stroke) survived reopen: ${got.join(', ')}`,
      `marks lost on reopen — got: ${got.join(', ')}`);

    // SCENARIO 2 — a second device sees the first device's marks via the log.
    console.log('\nSCENARIO 2  second device opens the same doc → sees everything');
    const deviceB = await freshHandle({
      documentId, supabase, clientId: 'deviceB', enableLocal: false, enableRealtime: false,
    });
    const bGot = idsOf(deviceB.getByPage());
    check(bGot.length === 7, `device B loaded all ${bGot.length} marks`, `device B saw ${bGot.length}/7`);

    // device B adds a mark; device A reopens and sees it (no lost update).
    deviceB.applyByPage(byPageFrom({ 6: ['p6'], 7: ['p7'], 8: ['p8'], 9: ['p9'], 10: ['p10'], 11: ['p11', 'fresh-stroke'], 12: ['fromB'] }));
    await deviceB.drain();
    await deviceB.destroy();

    const deviceA2 = await freshHandle({
      documentId, supabase, clientId: 'deviceA-again', enableLocal: false, enableRealtime: false,
    });
    const a2 = idsOf(deviceA2.getByPage());
    await deviceA2.destroy();
    check(a2.includes('fromB') && a2.length === 8,
      `device A reopened and merged device B's mark (${a2.length} total)`,
      `device A did not see device B's mark — got: ${a2.join(', ')}`);

    // SCENARIO 3 — delete the document removes all its log + snapshot rows.
    console.log('\nSCENARIO 3  hard-delete document → log + snapshot cascade away');
    await supabase.from('documents').delete().eq('id', documentId);
    const { data: leftUpdates } = await supabase.from('annotation_updates').select('seq').eq('document_id', documentId);
    const { data: leftSnap } = await supabase.from('annotation_snapshots').select('document_id').eq('document_id', documentId);
    documentId = null; // already deleted
    check((leftUpdates || []).length === 0 && (leftSnap || []).length === 0,
      'all op-log + snapshot rows cascade-deleted',
      `rows survived delete: ${(leftUpdates || []).length} updates, ${(leftSnap || []).length} snapshots`);

  } finally {
    if (documentId && !keep) {
      await supabase.from('documents').delete().eq('id', documentId).then(() => {}, () => {});
      console.log(`\nCLEANUP  removed ${documentId}`);
    }
  }

  console.log('');
  if (failures === 0) {
    console.log('RESULT: PASS — rebuilt durable path verified against the real backend');
    process.exit(0);
  } else {
    console.log(`RESULT: FAIL — ${failures} assertion(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(`\nFATAL: ${err.message}`); process.exit(1); });
