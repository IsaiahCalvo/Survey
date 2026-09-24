#!/usr/bin/env node
// agent-cli — a headless command-line tool for driving and measuring the Survey
// app's backend the way the real app does, so an AI agent (or a developer) can
// verify changes WITHOUT clicking through the Electron GUI.
//
// This is step one of "optimize the app for AI agents": a testing/measurement
// surface that is meant to grow into a full agent-facing API (read + annotate).
//
// Usage:
//   node agent-cli/index.mjs docs [--limit N] [--mode user|service]
//   node agent-cli/index.mjs open <documentId> [--mode user|service]
//   node agent-cli/index.mjs help
//
// 'open' reproduces the app's annotation hydrate read (keyset pagination +
// the same column projection + the same two type filters) and reports exactly
// how long opening that document's markings takes and why — the number we are
// trying to drive toward "instant".

import { gzipSync, gunzipSync } from 'node:zlib';
import * as Y from 'yjs';
import { makeClient } from './lib/client.mjs';
import { measureOpen } from './lib/pdfOpen.mjs';

// --- bytea <-> bytes helpers (PostgREST returns/accepts bytea as '\x<hex>') ---
function bytesToPgHex(u8) {
  let hex = '';
  for (let i = 0; i < u8.length; i += 1) hex += u8[i].toString(16).padStart(2, '0');
  return `\\x${hex}`;
}
function pgHexToBytes(str) {
  const hex = str.startsWith('\\x') ? str.slice(2) : str;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// --- mirror of the app's durable read (src/services/annotationCloudSync.js) ---
// Reimplemented here because the app's source runs under Vite (ESM) and cannot
// be imported by plain Node. Keep in sync if the app's read shape changes.
const SUPABASE_PAGE_SIZE = 1000;
const ANNOTATION_READ_COLUMNS =
  'id, user_id, annotation_id, annotation_type, page_number, annotation_data, created_at, updated_at';
const NON_HIGHLIGHT_TYPES = [
  'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon',
  'stamp', 'sticky_note', 'callout', 'counter', 'eraser', 'form-field',
];
const SURVEY_MARKER_TYPE_VALUES = ['survey-marker', 'highlight'];

// Keyset (seek) pagination loop — mirrors collectKeysetRows. Returns rows plus
// the per-round-trip timings so we can see the sequential cost.
async function collectKeyset(fetchPage) {
  const rows = [];
  const reads = [];
  let cursorId = null;
  for (;;) {
    const t0 = performance.now();
    const { data, error } = await fetchPage(cursorId);
    const ms = performance.now() - t0;
    if (error) return { rows, reads, error };
    const batch = data || [];
    reads.push({ ms: Math.round(ms), count: batch.length });
    rows.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
    cursorId = batch[batch.length - 1].id;
  }
  return { rows, reads, error: null };
}

function readPhase(supabase, documentId, applyFilters) {
  return collectKeyset((cursorId) => {
    let q = supabase
      .from('document_annotations')
      .select(ANNOTATION_READ_COLUMNS)
      .eq('document_id', documentId)
      .order('id', { ascending: true })
      .limit(SUPABASE_PAGE_SIZE);
    if (cursorId !== null) q = q.gt('id', cursorId);
    return applyFilters(q);
  });
}

// --- arg parsing -------------------------------------------------------------
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i += 1; }
      else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

const NAME_FIELDS = ['name', 'title', 'file_name', 'filename', 'original_name', 'display_name'];
function pickName(row) {
  for (const f of NAME_FIELDS) if (typeof row[f] === 'string' && row[f]) return row[f];
  return '(unnamed)';
}

// --- commands ----------------------------------------------------------------
async function cmdDocs(flags) {
  const limit = Number(flags.limit) || 20;
  const { supabase, who } = await makeClient(flags.mode);
  console.log(`# documents (as ${who})\n`);
  const { data, error } = await supabase.from('documents').select('*').limit(limit);
  if (error) throw new Error(error.message);
  if (!data?.length) { console.log('(none visible)'); return; }
  for (const row of data) {
    const sealed = row.cutover_completed_at ? 'sealed' : 'pre-cutover';
    console.log(`${row.id}  [${sealed.padEnd(11)}]  ${pickName(row)}`);
  }
  console.log(`\n${data.length} document(s).`);
}

async function cmdOpen(documentId, flags) {
  if (!documentId) throw new Error('usage: open <documentId>');
  const { supabase, who } = await makeClient(flags.mode);
  console.log(`# opening ${documentId} (as ${who})\n`);

  const wallT0 = performance.now();
  const main = await readPhase(supabase, documentId, (q) => q.in('annotation_type', NON_HIGHLIGHT_TYPES));
  if (main.error) throw new Error(`main read: ${main.error.message}`);
  const markers = await readPhase(supabase, documentId, (q) =>
    q.in('annotation_type', SURVEY_MARKER_TYPE_VALUES).not('annotation_data->fabricObject', 'is', null));
  if (markers.error) throw new Error(`marker read: ${markers.error.message}`);
  const wallMs = Math.round(performance.now() - wallT0);

  const allReads = [...main.reads, ...markers.reads];
  const rows = [...main.rows, ...markers.rows];
  const pages = new Set(rows.map((r) => r.page_number));
  const distinctIds = new Set(rows.map((r) => r.annotation_id));
  const slowest = allReads.reduce((m, r) => Math.max(m, r.ms), 0);

  console.log(`markings loaded ........ ${rows.length}`);
  console.log(`distinct annotation ids  ${distinctIds.size}${distinctIds.size < rows.length ? `  ← ${rows.length - distinctIds.size} duplicate rows` : ''}`);
  console.log(`distinct pages ......... ${pages.size}`);
  console.log(`round-trips (sequential) ${allReads.length}  (main ${main.reads.length} + markers ${markers.reads.length})`);
  console.log(`slowest single read .... ${slowest} ms`);
  console.log(`TOTAL open time ........ ${wallMs} ms  ${wallMs > 3000 ? '← slow' : ''}`);
  console.log(`\nper round-trip: ${allReads.map((r) => `${r.ms}ms/${r.count}`).join('  ')}`);
}

async function readAllRows(supabase, documentId) {
  const main = await readPhase(supabase, documentId, (q) => q.in('annotation_type', NON_HIGHLIGHT_TYPES));
  if (main.error) throw new Error(`main read: ${main.error.message}`);
  const markers = await readPhase(supabase, documentId, (q) =>
    q.in('annotation_type', SURVEY_MARKER_TYPE_VALUES).not('annotation_data->fabricObject', 'is', null));
  if (markers.error) throw new Error(`marker read: ${markers.error.message}`);
  return [...main.rows, ...markers.rows];
}

const SNAP_COLS = 'document_id, through_seq, encoding_version, updated_at, state';

async function cmdSnapshot(documentId, flags) {
  if (!documentId) throw new Error('usage: snapshot <documentId> [--delete]');
  const { supabase, who } = await makeClient('service');
  if (flags.delete) {
    const { error } = await supabase.from('doc_yjs_state').delete().eq('document_id', documentId);
    if (error) throw new Error(error.message);
    console.log(`deleted snapshot for ${documentId}`);
    return;
  }
  console.log(`# snapshot slot for ${documentId} (as ${who})\n`);
  const { data, error } = await supabase.from('doc_yjs_state').select(SNAP_COLS).eq('document_id', documentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) { console.log('EMPTY — no snapshot stored (app still loads row-by-row).'); return; }
  const bytes = data.state ? pgHexToBytes(data.state).length : 0;
  console.log(`present — ${(bytes / 1024).toFixed(1)} KB, through_seq ${data.through_seq}, updated ${data.updated_at}`);
}

// Build ONE compact Yjs snapshot from the document's rows and store it. This is
// a representative-size proof of the fast path; the production compaction would
// encode the app's exact bridge Y.Map shape. Writes via service-role (the
// snapshot upsert policy explicitly anticipates the compaction job).
async function cmdCompact(documentId, flags) {
  if (!documentId) throw new Error('usage: compact <documentId>');
  const { supabase, who } = await makeClient(flags.mode === 'user' ? 'user' : 'service');
  console.log(`# compacting ${documentId} (as ${who})\n`);

  const rows = await readAllRows(supabase, documentId);
  const t0 = performance.now();
  // Build the SAME v2 format the app writes (src/lib/collab/snapshotStore.js):
  // gzipped JSON { byPage, callouts }, byPage grouped by page_number.
  const byPage = {};
  for (const r of rows) {
    const pg = r.page_number;
    if (!byPage[pg]) byPage[pg] = { version: '5.3.0', objects: [] };
    byPage[pg].objects.push(r.annotation_data);
  }
  const json = JSON.stringify({ byPage, callouts: [] });
  const state = gzipSync(Buffer.from(json, 'utf8'));
  const encodeMs = Math.round(performance.now() - t0);

  const w0 = performance.now();
  const { error } = await supabase.from('doc_yjs_state').upsert({
    document_id: documentId,
    state: bytesToPgHex(state),
    state_vector: '\\x',
    through_seq: 0,
    encoding_version: 2,
  }, { onConflict: 'document_id' });
  if (error) throw new Error(`upsert: ${error.message}`);
  const writeMs = Math.round(performance.now() - w0);

  console.log(`rows compacted ......... ${rows.length}`);
  console.log(`snapshot size .......... ${(state.length / 1024).toFixed(1)} KB compressed (raw ${(json.length / 1024).toFixed(1)} KB)`);
  console.log(`build time ............. ${encodeMs} ms`);
  console.log(`write time ............. ${writeMs} ms`);
}

// Build the SAME v2 snapshot the app writes (gzipped JSON { byPage, callouts },
// grouped by page_number) from the authoritative durable rows and upsert it.
// Shared by `compact` (single doc, with timings) and `sweep` (all docs).
async function buildAndStoreSnapshot(supabase, documentId) {
  const rows = await readAllRows(supabase, documentId);
  const byPage = {};
  for (const r of rows) {
    const pg = r.page_number;
    if (!byPage[pg]) byPage[pg] = { version: '5.3.0', objects: [] };
    byPage[pg].objects.push(r.annotation_data);
  }
  const json = JSON.stringify({ byPage, callouts: [] });
  const state = gzipSync(Buffer.from(json, 'utf8'));
  const { error } = await supabase.from('doc_yjs_state').upsert({
    document_id: documentId,
    state: bytesToPgHex(state),
    state_vector: '\\x',
    through_seq: 0,
    encoding_version: 2,
  }, { onConflict: 'document_id' });
  if (error) throw new Error(`upsert: ${error.message}`);
  return { rowCount: rows.length, sizeKb: state.length / 1024 };
}

// Most-recent annotation change for a document — used to decide whether an
// existing snapshot is still fresh (snapshot updated at/after the latest row
// change → skip; older → refresh).
async function latestRowUpdatedAt(supabase, documentId) {
  const { data, error } = await supabase
    .from('document_annotations')
    .select('updated_at')
    .eq('document_id', documentId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.updated_at || null;
}

// Sweep ALL documents and pre-build a v2 snapshot for each so the FIRST open of
// any document is fast (the in-app reader only helps docs that already have a
// snapshot). Idempotent: skips docs whose snapshot is already current, refreshes
// stale ones, continues past per-doc errors. Default is a DRY RUN — pass
// --write to actually upsert. Service-role so it sees + writes every document.
async function cmdSweep(flags) {
  const { supabase, who } = await makeClient('service');
  const write = !!flags.write;
  const force = !!flags.force;
  const limit = Number(flags.limit) || 100000;
  console.log(`# snapshot sweep (as ${who})${write ? '' : '  [DRY RUN — pass --write to upsert]'}\n`);

  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, name, file_path')
    .limit(limit);
  if (error) throw new Error(error.message);
  if (!docs?.length) { console.log('(no documents visible)'); return; }

  const { data: snaps, error: snapErr } = await supabase
    .from('doc_yjs_state')
    .select('document_id, encoding_version, updated_at');
  if (snapErr) throw new Error(snapErr.message);
  const snapByDoc = new Map((snaps || []).map((s) => [s.document_id, s]));

  let built = 0; let refreshed = 0; let skipped = 0; let failed = 0;
  for (const doc of docs) {
    const id = doc.id;
    const name = pickName(doc);
    const snap = snapByDoc.get(id);
    try {
      if (snap && snap.encoding_version === 2 && !force) {
        const latest = await latestRowUpdatedAt(supabase, id);
        const fresh = !latest || (snap.updated_at && new Date(snap.updated_at) >= new Date(latest));
        if (fresh) { skipped += 1; console.log(`skip    ${id}  ${name}  (snapshot current)`); continue; }
      }
      const action = snap ? 'refresh' : 'build';
      if (!write) {
        if (snap) refreshed += 1; else built += 1;
        console.log(`would-${action.padEnd(7)} ${id}  ${name}`);
        continue;
      }
      const r = await buildAndStoreSnapshot(supabase, id);
      if (snap) refreshed += 1; else built += 1;
      console.log(`${action.padEnd(7)} ${id}  ${name}  ${r.rowCount} marks, ${r.sizeKb.toFixed(1)} KB`);
    } catch (e) {
      failed += 1;
      console.log(`FAIL    ${id}  ${name}  ${e.message}`);
    }
  }
  console.log(`\nbuilt ${built}  refreshed ${refreshed}  skipped ${skipped}  failed ${failed}  of ${docs.length} document(s).`);
  if (!write) console.log('(dry run — nothing written. Re-run with --write to apply.)');
}

async function cmdOpenFast(documentId, flags) {
  if (!documentId) throw new Error('usage: open-fast <documentId>');
  const { supabase, who } = await makeClient(flags.mode);
  console.log(`# fast-open ${documentId} via snapshot (as ${who})\n`);

  const t0 = performance.now();
  const { data, error } = await supabase.from('doc_yjs_state').select('state, encoding_version').eq('document_id', documentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) { console.log('no snapshot — run: compact ' + documentId); return; }
  const fetchMs = Math.round(performance.now() - t0);

  const m0 = performance.now();
  let count = 0;
  const pages = new Set();
  if (data.encoding_version === 2) {
    // App format: gzipped JSON { byPage, callouts }.
    const json = gunzipSync(pgHexToBytes(data.state)).toString('utf8');
    const parsed = JSON.parse(json);
    for (const [pg, page] of Object.entries(parsed.byPage || {})) {
      const n = (page?.objects || []).length;
      count += n;
      if (n) pages.add(pg);
    }
    count += (parsed.callouts || []).length;
  } else {
    // v1 experiment: raw Y.Doc update.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, gunzipSync(pgHexToBytes(data.state)));
    const map = doc.getMap('annotations');
    count = map.size;
    map.forEach((v) => pages.add(v?.p));
  }
  const materializeMs = Math.round(performance.now() - m0);
  const totalMs = Math.round(performance.now() - t0);

  console.log(`markings restored ...... ${count}  (format v${data.encoding_version})`);
  console.log(`distinct pages ......... ${pages.size}`);
  console.log(`round-trips ............ 1`);
  console.log(`fetch blob ............. ${fetchMs} ms`);
  console.log(`rebuild in memory ...... ${materializeMs} ms`);
  console.log(`TOTAL fast-open ........ ${totalMs} ms`);
}

// Reproduce + time the document-OPEN cost (the PDF binary side of loadPDF),
// NOT the annotation-list DB read. Times: storage download, blob->arrayBuffer,
// pdf.js getDocument, the all-pages getPage+getViewport page-size pass, the
// all-pages getAnnotations pass, and a pdf-lib raw-bytes parse. Pass a document
// id (looked up in `documents`) or --path <storagePath> to time bytes directly.
// Runs twice and reports the warm (second) run, since the first pays
// module-init + connection-warmup costs.
async function cmdOpenRender(documentId, flags) {
  const { supabase, who } = await makeClient(flags.mode);

  let filePath = typeof flags.path === 'string' ? flags.path : null;
  let docLabel = filePath || documentId;
  if (!filePath) {
    if (!documentId) throw new Error('usage: open-render <documentId> | open-render --path <storagePath>');
    const { data, error } = await supabase
      .from('documents')
      .select('id, name, file_path, file_size, page_count')
      .eq('id', documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`no document row for id ${documentId}`);
    if (!data.file_path) throw new Error(`document ${documentId} has no file_path`);
    filePath = data.file_path;
    docLabel = `${data.name} (${documentId})`;
    console.log(`# open-render ${docLabel} (as ${who})`);
    console.log(`storage path ........... ${filePath}`);
    console.log(`db file_size ........... ${data.file_size != null ? (data.file_size / (1024 * 1024)).toFixed(2) + ' MB' : '(unknown)'}`);
    console.log(`db page_count .......... ${data.page_count ?? '(unknown)'}\n`);
  } else {
    console.log(`# open-render --path ${filePath} (as ${who})\n`);
  }

  let result;
  const runs = Number(flags.runs) || 2;
  for (let i = 1; i <= runs; i += 1) {
    const wall0 = performance.now();
    result = await measureOpen(supabase, filePath);
    const wallMs = Math.round(performance.now() - wall0);
    const s = result.stages;
    const sum = s.downloadMs + s.blobToArrayBufferMs + s.getDocumentMs
      + s.pageSizesMs + s.getAnnotationsMs + s.pdfLibParseMs;
    const label = i < runs ? `run ${i} (cold)` : `run ${i} (WARM — reported)`;
    console.log(`--- ${label} ---`);
    console.log(`PDF size ............... ${(result.byteLength / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`pages (pdf.js) ......... ${result.numPages}  (pdf-lib ${result.pdfLibPageCount})`);
    console.log(`native PDF annotations . ${result.nativeAnnotationCount}  (pdf.js getAnnotations sum)`);
    console.log(`1. storage download .... ${s.downloadMs} ms`);
    console.log(`2. blob->arrayBuffer ... ${s.blobToArrayBufferMs} ms`);
    console.log(`3. getDocument (parse) . ${s.getDocumentMs} ms`);
    console.log(`4. all-page getPage+getViewport ... ${s.pageSizesMs} ms`);
    console.log(`5a. all-page getAnnotations ....... ${s.getAnnotationsMs} ms`);
    console.log(`5b. pdf-lib raw-bytes parse ....... ${s.pdfLibParseMs} ms`);
    console.log(`SUM of stages .......... ${sum} ms   (wall ${wallMs} ms)`);
    const stageList = [
      ['download', s.downloadMs],
      ['getDocument', s.getDocumentMs],
      ['getPage+getViewport', s.pageSizesMs],
      ['getAnnotations', s.getAnnotationsMs],
      ['pdf-lib parse', s.pdfLibParseMs],
    ].sort((a, b) => b[1] - a[1]);
    console.log(`dominant stage ......... ${stageList[0][0]} (${stageList[0][1]} ms)\n`);
  }
}

// DB-sync audit #1 — read-only probe that proves whether the marker fast-open
// SKIP would fire for a doc, WITHOUT mutating anything. Mirrors the real open
// path (src/hooks/useAnnotationCloudSync.js tryWatermarkSkipDurableRead):
//   - live marker  = documents.annotations_changed_at
//     (src/services/documentMetadataResolver.js META_COLUMNS / annotationsChangedAt)
//   - snapshot meta = the { meta } embedded in the gzipped doc_yjs_state blob,
//     read EXACTLY as src/lib/collab/snapshotStore.js readByPageSnapshot does
//     (select state+encoding_version, require encoding_version === 2, gunzip the
//     bytea hex, JSON.parse, take parsed.meta).
// Decision (the PREFERRED-PATH rule): SKIP fires only when meta.changedAt != null
// AND live marker != null AND Date.parse(meta.changedAt) === Date.parse(live).
// Otherwise NO — full durable read. We also surface WATERMARK_PROBE_MAX_ROWS and
// flag when meta.sourceRowCount > that cap, which is why the marker (not the
// count probe) is the only thing that can rescue a big doc.
const SNAPSHOT_ENCODING_VERSION = 2;
const WATERMARK_PROBE_MAX_ROWS = 5000;

async function cmdWatermark(documentId, flags) {
  if (!documentId) throw new Error('usage: watermark <documentId> [--mode user|service]');
  const { supabase, who } = await makeClient(flags.mode);
  console.log(`# watermark probe for ${documentId} (as ${who})\n`);

  // (1) live marker — documents.annotations_changed_at (single cheap read).
  const { data: docRow, error: docErr } = await supabase
    .from('documents')
    .select('annotations_changed_at')
    .eq('id', documentId)
    .maybeSingle();
  if (docErr) throw new Error(`documents read: ${docErr.message}`);
  const liveChangedAt = docRow ? (docRow.annotations_changed_at ?? null) : null;

  // (2) snapshot meta — read the doc_yjs_state blob the same way
  // readByPageSnapshot does, then extract parsed.meta.{changedAt,sourceRowCount}.
  const { data: snap, error: snapErr } = await supabase
    .from('doc_yjs_state')
    .select('state, encoding_version')
    .eq('document_id', documentId)
    .maybeSingle();
  if (snapErr) throw new Error(`doc_yjs_state read: ${snapErr.message}`);

  let meta = null;
  let snapNote = '';
  if (!snap) {
    snapNote = 'no doc_yjs_state row';
  } else if (snap.encoding_version !== SNAPSHOT_ENCODING_VERSION || !snap.state) {
    snapNote = `unreadable (encoding_version=${snap.encoding_version}, state=${snap.state ? 'present' : 'null'})`;
  } else {
    try {
      const json = gunzipSync(pgHexToBytes(snap.state)).toString('utf8');
      const parsed = JSON.parse(json);
      meta = (parsed && parsed.meta && typeof parsed.meta === 'object') ? parsed.meta : null;
      if (!meta) snapNote = 'snapshot present but carries no embedded meta (older/CLI snapshot)';
    } catch (e) {
      snapNote = `gunzip/parse failed: ${e.message}`;
    }
  }

  const metaChangedAt = meta && meta.changedAt != null ? meta.changedAt : null;
  const sourceRowCount =
    meta && typeof meta.sourceRowCount === 'number' ? meta.sourceRowCount : null;

  // Decision — mirror tryWatermarkSkipDurableRead's PREFERRED path exactly.
  const markerMatch =
    metaChangedAt != null && liveChangedAt != null
      ? Date.parse(metaChangedAt) === Date.parse(liveChangedAt)
      : false;
  const skip = markerMatch;

  let reason;
  if (skip) {
    reason = 'marker present on both sides and equal → marker fast-open SKIP fires';
  } else if (metaChangedAt == null) {
    reason = 'snapshot meta.changedAt is null → no marker to match → full durable read';
  } else if (liveChangedAt == null) {
    reason = 'live marker (documents.annotations_changed_at) is null → full durable read';
  } else {
    reason = 'marker present on both sides but mismatched → something changed → full durable read';
  }
  // Surface the count-probe cap: a big doc cannot fall back to the count probe.
  const tooBigForCountProbe =
    sourceRowCount != null && sourceRowCount > WATERMARK_PROBE_MAX_ROWS;

  console.log(`live marker (documents.annotations_changed_at) . ${liveChangedAt ?? 'null'}`);
  console.log(`snapshot meta.changedAt ........................ ${metaChangedAt ?? 'null'}${snapNote ? `  (${snapNote})` : ''}`);
  console.log(`snapshot meta.sourceRowCount ................... ${sourceRowCount ?? 'null'}`);
  console.log(`WATERMARK_PROBE_MAX_ROWS ....................... ${WATERMARK_PROBE_MAX_ROWS}`);
  if (tooBigForCountProbe) {
    console.log(`  ↑ sourceRowCount > cap → no cheap count-probe fallback; only the marker can rescue this doc`);
  }
  console.log(`\nwould the marker fast-open SKIP fire? .......... ${skip ? 'YES' : 'NO'}  (${reason})`);
}

// survey-read — mirror src/services/documentAnnotationService.js
// getDocumentAnnotations(documentId) EXACTLY so the returned row set matches what
// the app paints into `surveyMarkers`. This is the LEGACY Survey Marker hydrate
// that dominates open cost. Unlike `open` (a drifted keyset mirror that wrongly
// ADDS a fabricObject-not-null filter), this reproduces the real read:
//
//   .select('*')
//   .eq('document_id', id)
//   .in('annotation_type', ['survey-marker','highlight'])   // SURVEY_MARKER_TYPE_VALUES
//   .order('id', { ascending: true })
//   .gt('id', cursorId)                                      // keyset pagination
//   .limit(1000)
//   loop, cursor = last row id, until a short page (< 1000 rows)
//
// KAL-282 (2026-08-19): both the app and this mirror moved OFF offset
// pagination. `page_number` is not unique, so `.range()` over that ordering
// could skip or duplicate rows across window boundaries and this harness
// would then report a wrong ground-truth count.
//
// then DROP legacy fabric-carrying survey-marker rows in memory:
//   isSurveyMarkerType(annotation_type) && !!annotation_data?.fabricObject
//
// The post-drop count is the GROUND TRUTH the fix's snapshot guard must match.
const SURVEY_READ_PAGE_SIZE = 1000;

// Exact mirror of isSurveyMarkerType (src/utils/surveyMarkerType.js).
function isSurveyMarkerType(annotationType) {
  return annotationType === 'survey-marker' || annotationType === 'highlight';
}

// Exact mirror of isLegacyFabricSurveyMarkerRow (documentAnnotationService.js).
function isLegacyFabricSurveyMarkerRow(row) {
  return isSurveyMarkerType(row?.annotation_type) && !!row?.annotation_data?.fabricObject;
}

async function cmdSurveyRead(documentId, flags) {
  if (!documentId) throw new Error('usage: survey-read <documentId> [--mode user|service]');
  const { supabase, who } = await makeClient(flags.mode);
  console.log(`# survey-read ${documentId} (as ${who})`);
  console.log(`# mirrors getDocumentAnnotations(documentId) — the legacy Survey Marker hydrate\n`);

  const rows = [];
  const reads = [];
  const wallT0 = performance.now();
  let cursorId = null;
  for (;;) {
    const t0 = performance.now();
    let query = supabase
      .from('document_annotations')
      .select('*')
      .eq('document_id', documentId)
      .in('annotation_type', SURVEY_MARKER_TYPE_VALUES)
      .order('id', { ascending: true })
      .limit(SURVEY_READ_PAGE_SIZE);
    if (cursorId !== null) query = query.gt('id', cursorId);
    const { data, error } = await query;
    const ms = performance.now() - t0;
    if (error) throw new Error(`survey-read page (after ${cursorId ?? 'start'}): ${error.message}`);
    const batch = data || [];
    reads.push({ ms: Math.round(ms), count: batch.length });
    rows.push(...batch);
    if (batch.length < SURVEY_READ_PAGE_SIZE) break;
    cursorId = batch[batch.length - 1].id;
  }
  const wallMs = Math.round(performance.now() - wallT0);

  // Apply the SAME in-memory drop the app applies.
  const filteredRows = rows.filter((row) => !isLegacyFabricSurveyMarkerRow(row));
  const dropped = rows.length - filteredRows.length;
  const pages = new Set(filteredRows.map((r) => r.page_number));
  const slowest = reads.reduce((m, r) => Math.max(m, r.ms), 0);

  console.log(`raw rows fetched ....... ${rows.length}  (before fabric-carrying drop)`);
  console.log(`fabric rows dropped .... ${dropped}  (isLegacyFabricSurveyMarkerRow)`);
  console.log(`surveyMarkers painted .. ${filteredRows.length}  ← GROUND TRUTH rowCount`);
  console.log(`distinct pages ......... ${pages.size}`);
  console.log(`REST pages (round-trips) ${reads.length}`);
  console.log(`slowest single page .... ${slowest} ms`);
  console.log(`TOTAL read time ........ ${wallMs} ms  ${wallMs > 1000 ? '← dominant cost' : ''}`);
  console.log(`\nper REST page: ${reads.map((r) => `${r.ms}ms/${r.count}`).join('  ')}`);

  return { rowCount: filteredRows.length, rawRows: rows.length, dropped, restPages: reads.length, readMs: wallMs };
}

function cmdHelp() {
  console.log(`agent-cli — drive the Survey backend headlessly

  node agent-cli/index.mjs docs [--limit N] [--mode user|service]
      list documents you can see (sealed vs pre-cutover)

  node agent-cli/index.mjs open <documentId> [--mode user|service]
      reproduce + time the app's annotation load for one document

  node agent-cli/index.mjs survey-read <documentId> [--mode user|service]
      reproduce + time the LEGACY Survey Marker hydrate EXACTLY as the app's
      getDocumentAnnotations does: select('*'), .in('annotation_type',
      ['survey-marker','highlight']), order by id, keyset (id > cursor)
      pagination until a short page, then drop fabric-carrying rows in memory.
      Reports the post-drop rowCount (ground truth), wall-clock ms, REST pages.

  node agent-cli/index.mjs open-render <documentId> [--mode] [--runs N]
  node agent-cli/index.mjs open-render --path <storagePath>
      reproduce + time the document-OPEN cost (PDF binary side of loadPDF):
      download, getDocument parse, all-page getPage+getViewport, all-page
      getAnnotations, and a pdf-lib raw-bytes parse. Runs twice, reports warm.

  node agent-cli/index.mjs watermark <documentId> [--mode user|service]
      read-only: prove whether the marker fast-open SKIP would fire for a doc.
      Reads the live marker (documents.annotations_changed_at) and the snapshot's
      embedded meta (changedAt, sourceRowCount) from doc_yjs_state, then reports a
      YES/NO decision (YES only when both markers are present and equal).

  node agent-cli/index.mjs sweep [--write] [--force] [--limit N]
      pre-build a v2 snapshot for EVERY document so the first open is fast.
      idempotent: skips current snapshots, refreshes stale ones. DRY RUN unless
      --write is passed. --force rebuilds even fresh snapshots.

  --mode user     (default) sign in as the dev account, RLS enforced (real cost)
  --mode service  service-role key, RLS bypassed (baseline floor only)
`);
}

// --- main --------------------------------------------------------------------
async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0] || 'help';
  switch (cmd) {
    case 'docs': return cmdDocs(flags);
    case 'open': return cmdOpen(positional[1], flags);
    case 'survey-read': return cmdSurveyRead(positional[1], flags);
    case 'snapshot': return cmdSnapshot(positional[1], flags);
    case 'compact': return cmdCompact(positional[1], flags);
    case 'open-fast': return cmdOpenFast(positional[1], flags);
    case 'watermark': return cmdWatermark(positional[1], flags);
    case 'open-render': return cmdOpenRender(positional[1], flags);
    case 'sweep': return cmdSweep(flags);
    case 'help': default: return cmdHelp();
  }
}

main().catch((err) => {
  console.error(`\nerror: ${err.message}`);
  process.exit(1);
});
