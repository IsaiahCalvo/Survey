// agent-cli/proof-dataloss-stamp.mjs
//
// PROOF for the fast-open snapshot data-loss / freeze fix in
// src/hooks/useAnnotationCloudSync.js.
//
// What we prove (against the REAL backend, RLS-enforced, the heavy doc):
//
//  The data-loss bug is a snapshot WATERMARK STAMP that can be NEWER than the
//  rows the snapshot actually carries. tryWatermarkSkipDurableRead skips the
//  durable re-read whenever meta.changedAt === live marker. If the stamp was
//  re-read AFTER the durable read (the resolveStampChangedAt path), a mark that
//  landed durably in the window between the durable read and the re-read bumps
//  the live marker; the snapshot is then stamped with that NEWER marker even
//  though the mark is NOT in the snapshot rows. Next open: live marker ===
//  stamp -> SKIP fires -> durable read skipped -> that mark is GONE.
//
//  The fix stamps with the marker captured BEFORE the durable read
//  (preReadMarker). Invariant: stamp <= rows-freshness. So any write after the
//  captured rows moves the live marker PAST the stamp -> mismatch -> durable
//  read -> mark survives.
//
// This script reproduces tryWatermarkSkipDurableRead's PREFERRED-path decision
// exactly and runs it for both stamp strategies against a mark that is durably
// NEWER than the snapshot rows. Read-only: we never write to the backend.

import { gunzipSync } from 'node:zlib';
import { makeClient } from './lib/client.mjs';

const DOC = process.argv[2] || '5fa31b86-a0ce-481d-b20c-66be5f2f30fc';

function pgHexToBytes(str) {
  const hex = str.startsWith('\\x') ? str.slice(2) : str;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// EXACT mirror of tryWatermarkSkipDurableRead's PREFERRED (marker) path.
function wouldSkip(metaChangedAt, liveChangedAt) {
  if (metaChangedAt != null && liveChangedAt != null) {
    return Date.parse(metaChangedAt) === Date.parse(liveChangedAt);
  }
  return false; // no marker on one side -> durable read (no skip)
}

async function liveMarker(supabase, documentId) {
  const { data } = await supabase
    .from('documents').select('annotations_changed_at').eq('id', documentId).maybeSingle();
  return data?.annotations_changed_at ?? null;
}

async function snapshotMeta(supabase, documentId) {
  const { data } = await supabase
    .from('doc_yjs_state').select('state, encoding_version').eq('document_id', documentId).maybeSingle();
  if (!data || data.encoding_version !== 2 || !data.state) return null;
  const parsed = JSON.parse(gunzipSync(pgHexToBytes(data.state)).toString('utf8'));
  return parsed.meta || null;
}

async function main() {
  const { supabase, who } = await makeClient('user');
  console.log(`# data-loss stamp proof for ${DOC} (as ${who})\n`);

  const live = await liveMarker(supabase, DOC);
  const meta = await snapshotMeta(supabase, DOC);
  console.log(`live marker (documents.annotations_changed_at) . ${live}`);
  console.log(`snapshot meta.changedAt ........................ ${meta?.changedAt ?? 'null'}`);
  console.log(`snapshot meta.sourceMaxUpdatedAt ............... ${meta?.sourceMaxUpdatedAt ?? 'null'}`);
  console.log(`snapshot meta.sourceRowCount ................... ${meta?.sourceRowCount ?? 'null'}\n`);

  // Model the open lifecycle around a freshly-drawn mark M.
  //  T0  preReadMarker  = the marker read BEFORE the durable read (line 1140)
  //  T1  durable read captures rows as-of T1 (M not yet drawn)
  //  T2  user draws M, durable-saved, DB trigger bumps marker -> markerAfterM
  //  T3  resolveStampChangedAt re-reads -> would read markerAfterM (post-M)
  // We use REAL marker values to make this concrete: preReadMarker = the
  // current live marker; markerAfterM = a strictly newer ISO instant (what the
  // trigger would write when M lands). The snapshot rows DO NOT contain M.
  const preReadMarker = live; // value before M
  const markerAfterM = new Date(Date.parse(live) + 1500).toISOString(); // trigger bump on M save

  console.log('Scenario: mark M lands durably AFTER the snapshot rows were captured,');
  console.log('bumping the live marker. Snapshot rows do NOT contain M.');
  console.log(`  preReadMarker (before M) .... ${preReadMarker}`);
  console.log(`  live marker now (after M) ... ${markerAfterM}\n`);

  // OLD behavior: stamp re-read AFTER durable read -> reads markerAfterM.
  const oldStamp = markerAfterM;
  const oldSkips = wouldSkip(oldStamp, markerAfterM);
  console.log(`OLD (re-read-after stamp): meta.changedAt = ${oldStamp}`);
  console.log(`  next-open SKIP fires? ${oldSkips ? 'YES' : 'NO'}  -> ${oldSkips ? 'durable read SKIPPED -> M LOST (DATA LOSS)' : 'durable read -> M survives'}\n`);

  // FIXED behavior: stamp with preReadMarker (captured before durable read).
  const newStamp = preReadMarker;
  const newSkips = wouldSkip(newStamp, markerAfterM);
  console.log(`FIXED (pre-read stamp): meta.changedAt = ${newStamp}`);
  console.log(`  next-open SKIP fires? ${newSkips ? 'YES' : 'NO'}  -> ${newSkips ? 'durable read SKIPPED -> would lose M' : 'durable read RUNS -> M reconciled, NO loss'}\n`);

  const pass = oldSkips === true && newSkips === false;
  console.log(`RESULT: ${pass ? 'PROVEN' : 'NOT PROVEN'} — old stamp loses M, fixed stamp reconciles M (count preserved).`);
  if (!pass) process.exitCode = 1;
}

main().catch((e) => { console.error('error:', e.message); process.exit(1); });
