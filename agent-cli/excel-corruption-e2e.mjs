#!/usr/bin/env node
// agent-cli/excel-corruption-e2e.mjs — ENGINE-LAYER proof of the Stage 0 Excel
// data-loss guard, against the REAL Supabase backend on throwaway documents.
// SCOPE: this proves the durable engine + reconcile guard ONLY. The live app is
// NOT fixed until the PDFViewer Excel-import path is wired to call the guard
// (it still uses the default local origin today). See HANDOFF-excel-sync.md.
//
// The bug: a Survey Marker placed in the app but not yet exported to Excel is
// silently destroyed on the next open, because the Excel import reconciles the
// durable survey-marker map with a dict that omits it — deleting the key from the
// authoritative Y.Doc. This harness drives the SAME durable engine the app uses
// (openAnnotationDoc → applySurveyMarkers → drain → flushSnapshot → cold reopen)
// and proves, end-to-end through the cloud:
//
//   CONTROL  — a destructive (origin 'local') reconcile that omits a marker DOES
//              delete it on reopen. This reproduces the bug and proves the test
//              actually exercises the deletion path.
//   FIX      — an Excel import (origin 'excel-import') that omits the same marker
//              is ADDITIVE: the marker SURVIVES a cold reopen.
//   GUARD    — a destructive reconcile with the marker in `protectedIds` keeps it
//              (shields app-created-not-yet-exported markers even on a local sync).
//   PATCH    — an Excel import still adds new markers and updates existing ones.
//
// Usage: node agent-cli/excel-corruption-e2e.mjs [--keep]

import { makeClient } from './lib/client.mjs';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';

let failures = 0;
function check(pass, passMsg, failMsg) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${pass ? passMsg : failMsg}`);
  if (!pass) failures += 1;
  return pass;
}

const smMark = (id, page, extra = {}) => ({
  annotationId: id, pageNumber: page,
  bounds: { x: 1, y: 2, width: 10, height: 10 },
  categoryId: 'cat-1', moduleId: null, regionId: null,
  checklistResponses: {}, color: '#FFFF00', opacity: 0.3, ...extra,
});

async function main() {
  const keep = process.argv.includes('--keep');
  const { supabase, userId, who } = await makeClient('user');

  console.log('# excel-corruption-e2e — Stage 0 Excel data-loss fix vs the real backend');
  console.log(`# auth: ${who}\n`);

  const createdDocs = [];
  // Fresh throwaway document + its own isolated Y.Doc "device". A local reconcile
  // deletes every key not in the passed dict, so each scenario gets its own doc.
  async function newDoc(tag) {
    const runTag = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const name = `_tmp-excel-corruption-${tag}-${runTag}.pdf`;
    const { data, error } = await supabase
      .from('documents')
      .insert({ user_id: userId, name, file_path: `${userId}/excel-e2e/${runTag}.pdf`, file_size: 1024, page_count: 11, archived: false })
      .select('id').single();
    if (error) throw new Error(`doc insert (${tag}): ${error.message}`);
    createdDocs.push(data.id);
    return data.id;
  }
  function handle(documentId, clientId) {
    return openAnnotationDoc({ documentId, supabase, clientId, actorUserId: userId, enableLocal: false, enableRealtime: false, doc: new Y.Doc() });
  }
  // Seed two app-placed markers and persist them durably (write + snapshot + close).
  async function seedTwo(documentId) {
    const w = await handle(documentId, 'app-place');
    w.applySurveyMarkers({ sm1: smMark('sm1', 6), sm2: smMark('sm2', 11) });
    await w.drain();
    await w.flushSnapshot();
    await w.destroy();
  }
  // Cold reopen → read the durable survey-marker dict → close.
  async function reopenMarkers(documentId, clientId) {
    const r = await handle(documentId, clientId);
    const got = r.getSurveyMarkers();
    await r.destroy();
    return got || {};
  }

  try {
    // CONTROL — destructive (origin 'local') reconcile omitting sm2 drops it.
    console.log("CONTROL  destructive local reconcile that omits sm2 → sm2 is deleted (reproduces the bug path)");
    {
      const doc = await newDoc('control');
      await seedTwo(doc);
      const imp = await handle(doc, 'destructive-import');
      imp.applySurveyMarkers({ sm1: smMark('sm1', 6) }, { origin: 'local' }); // old behavior
      await imp.drain();
      await imp.flushSnapshot();
      await imp.destroy();
      const after = await reopenMarkers(doc, 'control-reopen');
      check(!after.sm2 && !!after.sm1,
        `confirmed the deletion path is real: sm2 dropped, sm1 kept (${Object.keys(after).join(', ') || 'empty'})`,
        `expected destructive reconcile to drop sm2 — got: ${JSON.stringify(Object.keys(after))}`);
    }

    // FIX — Excel import (origin 'excel-import') omitting sm2 is additive.
    console.log("\nFIX  excel-import reconcile that omits sm2 → sm2 SURVIVES a cold reopen");
    {
      const doc = await newDoc('fix');
      await seedTwo(doc);
      const imp = await handle(doc, 'excel-import');
      imp.applySurveyMarkers({ sm1: smMark('sm1', 6) }, { origin: 'excel-import' });
      await imp.drain();
      await imp.flushSnapshot();
      await imp.destroy();
      const after = await reopenMarkers(doc, 'fix-reopen');
      check(!!after.sm2 && !!after.sm1,
        `the un-exported marker survived the Excel import: ${Object.keys(after).sort().join(', ')}`,
        `DATA LOSS — sm2 was destroyed by the Excel import: ${JSON.stringify(Object.keys(after))}`);
    }

    // GUARD — protectedIds shields a marker even on a destructive local reconcile.
    console.log("\nGUARD  local reconcile with sm2 in protectedIds → sm2 SURVIVES");
    {
      const doc = await newDoc('guard');
      await seedTwo(doc);
      const imp = await handle(doc, 'guarded-local');
      imp.applySurveyMarkers({ sm1: smMark('sm1', 6) }, { origin: 'local', protectedIds: ['sm2'] });
      await imp.drain();
      await imp.flushSnapshot();
      await imp.destroy();
      const after = await reopenMarkers(doc, 'guard-reopen');
      check(!!after.sm2 && !!after.sm1,
        `protected app-created marker survived a local reconcile: ${Object.keys(after).sort().join(', ')}`,
        `protectedIds failed to shield sm2: ${JSON.stringify(Object.keys(after))}`);
    }

    // PATCH — excel-import still adds new + updates existing markers.
    console.log("\nPATCH  excel-import adds a new marker and updates an existing one");
    {
      const doc = await newDoc('patch');
      const w = await handle(doc, 'app-place-one');
      w.applySurveyMarkers({ sm1: smMark('sm1', 6, { checklistResponses: { q1: { selection: 'yes' } } }) });
      await w.drain(); await w.flushSnapshot(); await w.destroy();

      const imp = await handle(doc, 'excel-import-patch');
      imp.applySurveyMarkers({
        sm1: smMark('sm1', 6, { checklistResponses: { q1: { selection: 'no' } } }),
        sm2: smMark('sm2', 11),
      }, { origin: 'excel-import' });
      await imp.drain(); await imp.flushSnapshot(); await imp.destroy();

      const after = await reopenMarkers(doc, 'patch-reopen');
      check(
        after.sm1?.checklistResponses?.q1?.selection === 'no' && !!after.sm2,
        `excel-import updated sm1's answer and added sm2: ${Object.keys(after).sort().join(', ')}`,
        `excel-import patch incomplete — got: ${JSON.stringify(after)}`);
    }
  } finally {
    if (!keep) {
      for (const id of createdDocs) {
        await supabase.from('documents').delete().eq('id', id).then(() => {}, () => {});
      }
      console.log(`\nCLEANUP  removed ${createdDocs.length} throwaway document(s)`);
    } else {
      console.log(`\nKEPT  ${createdDocs.length} document(s): ${createdDocs.join(', ')}`);
    }
  }

  console.log('');
  if (failures === 0) {
    console.log('RESULT: PASS (ENGINE LAYER) — the durable reconcile can no longer destroy an un-exported');
    console.log('Survey Marker when called with origin=excel-import / protectedIds.');
    console.log('SCOPE: this proves the persistence engine + guard only. It does NOT prove the live app:');
    console.log('the PDFViewer Excel-import path still calls the reconcile with the default local origin,');
    console.log('so the app is NOT fixed until the Stage 0 viewer wiring lands (see HANDOFF-excel-sync.md).');
    process.exit(0);
  } else {
    console.log(`RESULT: FAIL — ${failures} assertion(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(`\nFATAL: ${err.message}`); process.exit(1); });
