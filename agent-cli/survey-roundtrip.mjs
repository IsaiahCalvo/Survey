#!/usr/bin/env node
// agent-cli/survey-roundtrip.mjs — PROOF #1 (LOSSLESS roundtrip).
//
// Reads the REAL Survey Marker set for a document EXACTLY as the app's legacy
// hydrate does (mirror of getDocumentAnnotations + the real
// mapSurveyMarkerRowToLocalAnnotation mapper), then runs that exact map +
// surveyMeta through the SAME gzip JSON path snapshotStore uses — by importing
// the REAL writeByPageSnapshot / readByPageSnapshot — against an IN-MEMORY
// supabase stub. The real doc_yjs_state row is NEVER read or written.
//
// Then it deserializes and asserts the reconstructed surveyMarkers map is
// DEEP-EQUAL to the source (every id, page, geometry, fields) and count is
// preserved.
//
// Usage: node agent-cli/survey-roundtrip.mjs <documentId> [--mode user|service]

import { makeClient } from './lib/client.mjs';
import { mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';
import { SURVEY_MARKER_TYPE_VALUES } from '../src/utils/surveyMarkerType.js';
import { writeByPageSnapshot, readByPageSnapshot } from '../src/lib/collab/snapshotStore.js';

const PAGE_SIZE = 1000;

function isSurveyMarkerType(t) { return t === 'survey-marker' || t === 'highlight'; }
function isLegacyFabricSurveyMarkerRow(row) {
  return isSurveyMarkerType(row?.annotation_type) && !!row?.annotation_data?.fabricObject;
}

// In-memory supabase stub. Implements ONLY the two chains snapshotStore uses:
//   write: .from('doc_yjs_state').upsert(rowObj, opts)
//   read:  .from('doc_yjs_state').select(cols).eq('document_id', id).maybeSingle()
// Stores rows in a JS Map keyed by document_id. Cannot touch the real DB.
function makeScratchStore() {
  const rows = new Map();
  let writes = 0;
  let reads = 0;
  return {
    stats: () => ({ writes, reads, rowCount: rows.size }),
    from(table) {
      if (table !== 'doc_yjs_state') throw new Error(`scratch stub only handles doc_yjs_state, got ${table}`);
      return {
        upsert(rowObj /*, opts */) {
          writes += 1;
          rows.set(rowObj.document_id, { ...rowObj });
          return Promise.resolve({ error: null });
        },
        select(/* cols */) {
          let docId = null;
          const api = {
            eq(col, val) { if (col === 'document_id') docId = val; return api; },
            maybeSingle() {
              reads += 1;
              const r = rows.get(docId);
              return Promise.resolve({ data: r ? { state: r.state, encoding_version: r.encoding_version } : null, error: null });
            },
          };
          return api;
        },
      };
    },
  };
}

// Deep structural equality with an ordered diff path (no lib).
function deepEqual(a, b, path, diffs) {
  if (a === b) return true;
  if (typeof a !== typeof b) { diffs.push(`${path}: type ${typeof a} !== ${typeof b}`); return false; }
  if (a === null || b === null) { diffs.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); return false; }
  if (typeof a !== 'object') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    diffs.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    return false;
  }
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr !== bArr) { diffs.push(`${path}: array/object mismatch`); return false; }
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) {
    diffs.push(`${path}: key set differs [${aKeys}] vs [${bKeys}]`);
    return false;
  }
  let ok = true;
  for (const k of aKeys) {
    if (!deepEqual(a[k], b[k], `${path}.${k}`, diffs)) ok = false;
    if (diffs.length > 20) break;
  }
  return ok;
}

async function main() {
  const documentId = process.argv[2];
  const modeFlag = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'user';
  if (!documentId) throw new Error('usage: node agent-cli/survey-roundtrip.mjs <documentId> [--mode user|service]');

  const { supabase, who } = await makeClient(modeFlag);
  console.log(`# survey-roundtrip ${documentId} (as ${who})`);
  console.log('# reads REAL markers; serialize/deserialize via REAL snapshotStore into an IN-MEMORY stub.');
  console.log('# the real doc_yjs_state row is never touched.\n');

  // (1) Read the REAL markers exactly like getDocumentAnnotations.
  // KAL-282 (2026-08-19): keyset pagination on the primary key, mirroring the
  // app. The old `.range()` loop ordered by the NON-UNIQUE `page_number`, so
  // rows could be skipped or double-counted across window boundaries — which
  // would corrupt the ground-truth count this roundtrip harness exists to
  // report.
  const rawRows = [];
  let cursorId = null;
  for (;;) {
    let query = supabase
      .from('document_annotations')
      .select('*')
      .eq('document_id', documentId)
      .in('annotation_type', SURVEY_MARKER_TYPE_VALUES)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (cursorId !== null) query = query.gt('id', cursorId);
    const { data, error } = await query;
    if (error) throw new Error(`survey read page (after ${cursorId ?? 'start'}): ${error.message}`);
    const batch = data || [];
    rawRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    cursorId = batch[batch.length - 1].id;
  }
  const filtered = rawRows.filter((r) => !isLegacyFabricSurveyMarkerRow(r));

  // Build the EXACT surveyMarkers map the app paints (real mapper).
  const sourceMap = {};
  for (const row of filtered) {
    const local = mapSurveyMarkerRowToLocalAnnotation(row);
    if (!local?.annotationId) continue;
    sourceMap[local.annotationId] = local;
  }
  const sourceCount = Object.keys(sourceMap).length;

  // (2) Resolve the live change marker for the surveyMeta watermark.
  const { data: docRow, error: docErr } = await supabase
    .from('documents')
    .select('annotations_changed_at')
    .eq('id', documentId)
    .maybeSingle();
  if (docErr) throw new Error(`documents read: ${docErr.message}`);
  const liveChangedAt = docRow?.annotations_changed_at ?? null;
  const surveyMeta = { changedAt: liveChangedAt, count: sourceCount };

  console.log(`raw rows fetched ....... ${rawRows.length}`);
  console.log(`fabric rows dropped .... ${rawRows.length - filtered.length}`);
  console.log(`source map count ....... ${sourceCount}  ← GROUND TRUTH`);
  console.log(`live changedAt ......... ${liveChangedAt ?? 'null'}`);

  // (3) Serialize through the REAL writeByPageSnapshot (survey half), survey-only
  //     write (byPage=null) → exactly the self-heal call shape in PDFViewer.jsx.
  const store = makeScratchStore();
  const w = await writeByPageSnapshot(documentId, null, null, store, null, sourceMap, surveyMeta);
  if (!w?.ok) throw new Error(`writeByPageSnapshot did not report ok: ${JSON.stringify(w)}`);
  console.log(`\ngzip blob written ...... ${w.compressedBytes} bytes (encoding_version 2)`);

  // (4) Deserialize through the REAL readByPageSnapshot.
  const back = await readByPageSnapshot(documentId, store);
  if (!back) throw new Error('readByPageSnapshot returned null on the scratch row');
  const reconMap = back.surveyMarkers;
  const reconMeta = back.surveyMeta;
  const reconCount = reconMap ? Object.keys(reconMap).length : 0;

  // (5) Deep-equality assertions.
  // The snapshot path serializes via JSON.stringify, which by spec OMITS object
  // keys whose value is literally `undefined` (an absent key and a key set to
  // `undefined` are indistinguishable in JS — they carry no information). So the
  // correct lossless test is against the source map's OWN JSON projection: every
  // value JSON can represent must survive byte-for-byte. We compare the recon
  // against `JSON.parse(JSON.stringify(sourceMap))` (the canonical JSON image),
  // and SEPARATELY report how many keys were undefined-only (dropped) so the
  // reader can see nothing meaningful was lost.
  const sourceJsonImage = JSON.parse(JSON.stringify(sourceMap));
  let undefinedKeyCount = 0;
  for (const id of Object.keys(sourceMap)) {
    const o = sourceMap[id];
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) if (o[k] === undefined) undefinedKeyCount += 1;
    }
  }
  const diffs = [];
  const mapEqual = deepEqual(sourceJsonImage, reconMap, 'surveyMarkers', diffs);
  console.log(`undefined-valued keys in source (JSON-omitted, no info) ... ${undefinedKeyCount}`);
  const metaDiffs = [];
  const metaEqual = deepEqual(surveyMeta, reconMeta, 'surveyMeta', metaDiffs);
  const countPreserved = sourceCount === reconCount && (reconMeta?.count === sourceCount);

  console.log(`reconstructed count .... ${reconCount}`);
  console.log(`reconstructed meta ..... ${JSON.stringify(reconMeta)}`);
  console.log(`stub stats ............. ${JSON.stringify(store.stats())}  (writes/reads to SCRATCH only)`);
  console.log('');
  console.log(`DEEP-EQUAL map ......... ${mapEqual ? 'PASS' : 'FAIL'}`);
  console.log(`DEEP-EQUAL meta ........ ${metaEqual ? 'PASS' : 'FAIL'}`);
  console.log(`COUNT preserved ........ ${countPreserved ? 'PASS' : 'FAIL'} (${sourceCount} === ${reconCount})`);
  if (!mapEqual) console.log('map diffs (first 20):\n  ' + diffs.slice(0, 20).join('\n  '));
  if (!metaEqual) console.log('meta diffs:\n  ' + metaDiffs.join('\n  '));

  const allPass = mapEqual && metaEqual && countPreserved && sourceCount > 0;
  console.log(`\nROUNDTRIP RESULT ....... ${allPass ? 'LOSSLESS ✓' : 'NOT LOSSLESS ✗'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });
