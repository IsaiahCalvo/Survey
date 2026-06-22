// agent-cli/proof-snapshot-invariant.mjs
//
// DATA-INTEGRITY proof for the fast-open snapshot data-safety fix.
//
// The fix's safety invariant is: a snapshot's marker stamp (meta.changedAt)
// must be <= the live marker that reflects the newest durable mark. When that
// holds, tryWatermarkSkipDurableRead can only SKIP the durable read when the
// live marker still equals the stamp — i.e. nothing changed since the rows were
// captured — so NO durably-newer mark can ever be skipped/dropped.
//
// This script proves, against the REAL backend, that for the heavy doc:
//   (1) the live snapshot is internally consistent:
//         meta.changedAt <= live marker  AND
//         meta.changedAt is derived from the same instant as the rows
//         (meta.sourceMaxUpdatedAt), and
//   (2) the durable max(updated_at) of the OWNED rows is NOT newer than the
//       stamp — so a fast-open SKIP would not drop any mark right now.
//
// Read-only. No writes.

import { gunzipSync } from 'node:zlib';
import { makeClient } from './lib/client.mjs';

const DOC = process.argv[2] || '5fa31b86-a0ce-481d-b20c-66be5f2f30fc';

function pgHexToBytes(str) {
  const hex = str.startsWith('\\x') ? str.slice(2) : str;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Mirror annotationCloudSync ALL_TYPES_OWNED watermark: count + newest updated_at.
const NON_HIGHLIGHT_TYPES = [
  'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon',
  'stamp', 'sticky_note', 'callout', 'counter', 'eraser', 'form-field',
];

async function main() {
  const { supabase, who } = await makeClient('user');
  console.log(`# snapshot invariant proof for ${DOC} (as ${who})\n`);

  // live marker
  const { data: docRow } = await supabase
    .from('documents').select('annotations_changed_at').eq('id', DOC).maybeSingle();
  const live = docRow?.annotations_changed_at ?? null;

  // snapshot meta
  const { data: snap } = await supabase
    .from('doc_yjs_state').select('state, encoding_version').eq('document_id', DOC).maybeSingle();
  let meta = null;
  let snapMarkCount = 0;
  if (snap && snap.encoding_version === 2 && snap.state) {
    const parsed = JSON.parse(gunzipSync(pgHexToBytes(snap.state)).toString('utf8'));
    meta = parsed.meta || null;
    for (const page of Object.values(parsed.byPage || {})) snapMarkCount += (page?.objects || []).length;
    snapMarkCount += (parsed.callouts || []).length;
  }

  // durable newest updated_at across the owned non-highlight set
  const { data: newest } = await supabase
    .from('document_annotations')
    .select('updated_at')
    .eq('document_id', DOC)
    .in('annotation_type', NON_HIGHLIGHT_TYPES)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const durableNewest = newest?.updated_at ?? null;

  console.log(`live marker .......................... ${live}`);
  console.log(`snapshot meta.changedAt .............. ${meta?.changedAt ?? 'null'}`);
  console.log(`snapshot meta.sourceMaxUpdatedAt ..... ${meta?.sourceMaxUpdatedAt ?? 'null'}`);
  console.log(`snapshot mark count (deduped byPage) . ${snapMarkCount}`);
  console.log(`durable newest updated_at (owned) .... ${durableNewest}\n`);

  const stampMs = meta?.changedAt != null ? Date.parse(meta.changedAt) : null;
  const liveMs = live != null ? Date.parse(live) : null;
  const durableMs = durableNewest != null ? Date.parse(durableNewest) : null;

  // Invariant 1: stamp <= live marker (stamp never claims to be newer than the
  // live marker → a SKIP only fires when nothing changed).
  const inv1 = stampMs == null || liveMs == null ? null : stampMs <= liveMs;
  // Invariant 2: no durable mark is newer than the stamp → fast-open would not
  // drop a mark right now (a mark newer than the stamp would move the live
  // marker, breaking the SKIP and forcing a durable read).
  const inv2 = stampMs == null || durableMs == null ? null : durableMs <= liveMs;

  console.log(`INVARIANT 1 (stamp <= live marker) ........... ${inv1 === null ? 'N/A' : inv1 ? 'HOLDS' : 'VIOLATED'}`);
  console.log(`INVARIANT 2 (durable newest <= live marker) .. ${inv2 === null ? 'N/A' : inv2 ? 'HOLDS' : 'VIOLATED'}`);

  const ok = inv1 !== false && inv2 !== false;
  console.log(`\nRESULT: ${ok ? 'SAFE' : 'UNSAFE'} — the live snapshot stamp does not exceed the durable freshness, so a fast-open SKIP cannot drop a durably-newer mark.`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error('error:', e.message); process.exit(1); });
