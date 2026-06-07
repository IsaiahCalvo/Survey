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

    // SCENARIO 2b — callouts ride the document-level meta path (the SAME path
    // spaces + survey markers will use). Prove a callouts list survives a true
    // cold reopen from the cloud, exactly like annotations do.
    console.log('\nSCENARIO 2b  callouts (meta path) → reopen sees them');
    const calloutWriter = await freshHandle({
      documentId, supabase, clientId: 'deviceA-callouts', enableLocal: false, enableRealtime: false,
    });
    const calloutsList = [
      { id: 'co1', pageNumber: 6, anchor: { x: 10, y: 20 }, knee: { x: 30, y: 40 }, label: 'first' },
      { id: 'co2', pageNumber: 11, anchor: { x: 50, y: 60 }, knee: { x: 70, y: 80 }, label: 'second' },
    ];
    calloutWriter.setMeta('calloutsList', calloutsList);
    await calloutWriter.drain();
    await calloutWriter.flushSnapshot();
    await calloutWriter.destroy();

    const calloutReader = await freshHandle({
      documentId, supabase, clientId: 'deviceA-callouts-reopen', enableLocal: false, enableRealtime: false,
    });
    const gotCallouts = calloutReader.getMeta('calloutsList');
    await calloutReader.destroy();
    check(
      Array.isArray(gotCallouts) && gotCallouts.length === 2 &&
        gotCallouts.map((c) => c.id).sort().join(',') === 'co1,co2' &&
        gotCallouts.find((c) => c.id === 'co2')?.label === 'second',
      `both callouts survived cold reopen via the meta path: ${(gotCallouts || []).map((c) => c.id).join(', ')}`,
      `callouts lost on reopen — got: ${JSON.stringify(gotCallouts)}`);

    // SCENARIO 2c — spaces (with nested region polygons) ride the SAME meta path.
    // Proves the spaces migration: a document-level spaces array survives a true
    // cold reopen from the cloud, replacing the old localStorage + Storage sidecar.
    console.log('\nSCENARIO 2c  spaces + region polygons (meta path) → reopen sees them');
    const spaceWriter = await freshHandle({
      documentId, supabase, clientId: 'deviceA-spaces', enableLocal: false, enableRealtime: false,
    });
    const spacesArray = [
      {
        id: 'sp1', name: 'Floor 1',
        assignedPages: [
          {
            pageId: 6, label: 'Kitchen – Page 6', wholePageIncluded: false,
            showCanvasAnnotations: true, showSurveyAnnotations: true, showBackgroundAnnotations: true,
            regions: [
              { regionId: 'rg1', pageId: 6, shapeType: 'rectangular', operation: 'add', coordinates: [0, 0, 100, 0, 100, 100, 0, 100] },
            ],
          },
        ],
      },
      { id: 'sp2', name: 'Floor 2', assignedPages: [] },
    ];
    spaceWriter.setMeta('spaces', spacesArray);
    await spaceWriter.drain();
    await spaceWriter.flushSnapshot();
    await spaceWriter.destroy();

    const spaceReader = await freshHandle({
      documentId, supabase, clientId: 'deviceA-spaces-reopen', enableLocal: false, enableRealtime: false,
    });
    const gotSpaces = spaceReader.getMeta('spaces');
    await spaceReader.destroy();
    const region = gotSpaces?.[0]?.assignedPages?.[0]?.regions?.[0];
    check(
      Array.isArray(gotSpaces) && gotSpaces.length === 2 &&
        gotSpaces.map((s) => s.id).sort().join(',') === 'sp1,sp2' &&
        region?.regionId === 'rg1' && Array.isArray(region?.coordinates) && region.coordinates.length === 8,
      `both spaces + nested region polygon survived cold reopen: ${(gotSpaces || []).map((s) => s.name).join(', ')}`,
      `spaces lost on reopen — got: ${JSON.stringify(gotSpaces)}`);

    // SCENARIO 2d — survey markers (highlights) ride their own keyed map. They
    // are flat bbox+metadata records, NOT fabric objects. Prove a marker dict
    // (incl. a checklist response + entity link) survives a true cold reopen and
    // that an edit + delete reconcile minimally on the new engine.
    console.log('\nSCENARIO 2d  survey markers (keyed map) → reopen + edit + delete');
    const smWriter = await freshHandle({
      documentId, supabase, clientId: 'deviceA-survey', enableLocal: false, enableRealtime: false,
    });
    const smMark = (id, page, extra = {}) => ({
      annotationId: id, pageNumber: page,
      bounds: { x: 1, y: 2, width: 10, height: 10 },
      categoryId: 'cat-1', moduleId: null, regionId: null,
      checklistResponses: {}, color: '#FFFF00', opacity: 0.3, ...extra,
    });
    smWriter.applySurveyMarkers({
      sm1: smMark('sm1', 6, { checklistResponses: { q1: { selection: 'yes' } } }),
      sm2: smMark('sm2', 11, { entityId: 'ent-9', entityName: 'Unit A', entityColor: '#00aa00' }),
    });
    await smWriter.drain();
    await smWriter.flushSnapshot();
    await smWriter.destroy();

    const smReader = await freshHandle({
      documentId, supabase, clientId: 'deviceA-survey-reopen', enableLocal: false, enableRealtime: false,
    });
    const gotMarkers = smReader.getSurveyMarkers();
    const sm1ok = gotMarkers?.sm1?.checklistResponses?.q1?.selection === 'yes';
    const sm2ok = gotMarkers?.sm2?.entityId === 'ent-9' && gotMarkers?.sm2?.entityColor === '#00aa00';
    check(
      gotMarkers && Object.keys(gotMarkers).length === 2 && sm1ok && sm2ok,
      `both survey markers survived cold reopen with checklist + entity data intact`,
      `survey markers lost/mangled on reopen — got: ${JSON.stringify(gotMarkers)}`);

    // edit sm1, delete sm2 → reopen sees exactly that
    smReader.applySurveyMarkers({
      sm1: smMark('sm1', 6, { checklistResponses: { q1: { selection: 'no' } } }),
    });
    await smReader.drain();
    await smReader.flushSnapshot();
    await smReader.destroy();

    const smReader2 = await freshHandle({
      documentId, supabase, clientId: 'deviceA-survey-reopen2', enableLocal: false, enableRealtime: false,
    });
    const after = smReader2.getSurveyMarkers();
    await smReader2.destroy();
    check(
      after && Object.keys(after).length === 1 && after.sm1?.checklistResponses?.q1?.selection === 'no' && !after.sm2,
      `survey-marker edit + delete reconciled on reopen (sm1 edited, sm2 gone)`,
      `survey-marker edit/delete not reflected — got: ${JSON.stringify(after)}`);

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
