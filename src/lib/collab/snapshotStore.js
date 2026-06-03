// src/lib/collab/snapshotStore.js
// Phase 32 — row-sourced annotation snapshot (the Figma-style fast open).
//
// Stores a document's DESERIALIZED annotationsByPage (+callouts) as ONE
// gzip-compressed JSON blob in doc_yjs_state, so opening reads a single blob
// instead of paginating thousands of document_annotations rows (proven via
// agent-cli: ~25 sequential reads / ~15-25s → 1 read / ~3s on the worst doc).
//
// SOURCE = the authoritative durable read result, NOT the Y.Doc. The Y.Doc can
// be incomplete for cutover-sealed docs (verified 2026-06-02: one doc held only
// ~3k of 22k marks), so a Y.Doc-sourced snapshot would under-paint. The durable
// rows are complete and carry correct page_number, so a row-sourced snapshot is
// both complete and correct — and it is built from data the open path already
// loaded, so producing it is free.
//
// encoding_version 2 = gzipped JSON { byPage, callouts }. (Version 1 was the
// raw Y.Doc-update experiment; the reader ignores anything that isn't 2.)

const SNAPSHOT_ENCODING_VERSION = 2;
const MAX_COMPRESSED_BYTES = 12 * 1024 * 1024;

async function gzipString(str) {
  const bytes = new TextEncoder().encode(str);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipToString(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

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

/**
 * Compute the freshness watermark for a row set: the number of rows the snapshot
 * was built from and the newest updated_at among them. Because every insert /
 * update stamps a strictly newer updated_at and every insert / delete changes the
 * count, a later (rowCount, maxUpdatedAt) pair that still matches PROVES the
 * durable rows are unchanged since the snapshot — so the open path can skip the
 * full re-read. Pure + cheap; computed from rows the durable read already holds.
 */
export function computeRowsWatermark(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let maxIso = null;
  let maxMs = -Infinity;
  for (const r of list) {
    const u = r?.updated_at;
    if (typeof u !== 'string') continue;
    const ms = Date.parse(u);
    if (Number.isFinite(ms) && ms > maxMs) { maxMs = ms; maxIso = u; }
  }
  return { rowCount: list.length, maxUpdatedAt: maxIso };
}

/**
 * True when a painted snapshot's embedded watermark still matches the live durable
 * watermark — i.e. nothing in document_annotations has changed since the snapshot
 * was built, so the ~25-trip durable re-read can be skipped safely.
 *
 * Hard requirements (any failure → false → fall back to the full durable read):
 *   - meta.calloutsComplete === true (app-written snapshots only; CLI snapshots
 *     omit callouts and must never trigger a skip)
 *   - live watermark present and error-free
 *   - row counts match
 *   - max updated_at match by INSTANT (parsed), tolerant of string formatting
 */
export function isSnapshotWatermarkCurrent(meta, live) {
  if (!meta || meta.calloutsComplete !== true) return false;
  if (!live || live.error) return false;
  if (typeof meta.sourceRowCount !== 'number' || typeof live.rowCount !== 'number') return false;
  if (meta.sourceRowCount !== live.rowCount) return false;
  const a = meta.sourceMaxUpdatedAt;
  const b = live.maxUpdatedAt;
  if (a == null && b == null) return true; // both empty → current
  if (a == null || b == null) return false;
  const am = Date.parse(a);
  const bm = Date.parse(b);
  if (!Number.isFinite(am) || !Number.isFinite(bm)) return false;
  return am === bm;
}

/**
 * Write the authoritative byPage (+callouts) as one compressed snapshot.
 * Fire-and-forget — callers MUST NOT await on a render/interaction path.
 *
 * `meta` (optional) embeds the freshness watermark INSIDE the gzip blob (no
 * schema change): { sourceMaxUpdatedAt, sourceRowCount, calloutsComplete }. The
 * reader hands it back so the open path can decide whether to skip the durable
 * re-read. Omitting meta keeps older/CLI snapshots byte-compatible (no skip).
 */
export async function writeByPageSnapshot(documentId, byPage, callouts, supabaseClient, meta = null) {
  try {
    if (!documentId || !supabaseClient || typeof CompressionStream === 'undefined') return { ok: false };
    const payload = { byPage: byPage || {}, callouts: callouts || [] };
    if (meta && typeof meta === 'object') payload.meta = meta;
    const json = JSON.stringify(payload);
    const compressed = await gzipString(json);
    if (compressed.length > MAX_COMPRESSED_BYTES) {
      // eslint-disable-next-line no-console
      console.info('[snapshotStore] snapshot over cap — skipped', { documentId, bytes: compressed.length });
      return { ok: false, compressedBytes: compressed.length };
    }
    const { error } = await supabaseClient
      .from('doc_yjs_state')
      .upsert({
        document_id: documentId,
        state: bytesToPgHex(compressed),
        state_vector: '\\x', // BYTEA NOT NULL — empty placeholder (unused for v2)
        through_seq: 0,
        encoding_version: SNAPSHOT_ENCODING_VERSION,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'document_id' });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[snapshotStore] write failed', { documentId, message: error.message });
      return { ok: false, error };
    }
    return { ok: true, compressedBytes: compressed.length };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[snapshotStore] write threw', err?.message);
    return { ok: false, error: err };
  }
}

/**
 * Read the snapshot for a document. Returns { byPage, callouts } or null when
 * absent / wrong version / unreadable (caller falls back to the durable read).
 */
export async function readByPageSnapshot(documentId, supabaseClient) {
  try {
    if (!documentId || !supabaseClient || typeof DecompressionStream === 'undefined') return null;
    const { data, error } = await supabaseClient
      .from('doc_yjs_state')
      .select('state, encoding_version')
      .eq('document_id', documentId)
      .maybeSingle();
    if (error || !data || data.encoding_version !== SNAPSHOT_ENCODING_VERSION || !data.state) return null;
    const json = await gunzipToString(pgHexToBytes(data.state));
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      byPage: parsed.byPage || {},
      callouts: Array.isArray(parsed.callouts) ? parsed.callouts : [],
      meta: (parsed.meta && typeof parsed.meta === 'object') ? parsed.meta : null,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[snapshotStore] read threw', err?.message);
    return null;
  }
}
