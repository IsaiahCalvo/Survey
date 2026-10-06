// src/services/annotationCheckpointCore.js
//
// The heavy, pure parts of an annotation checkpoint (2026-10-06, owner: "move
// big-document checkpoint work off the main thread"). Data in, data out: no
// DOM, no window, no React, no network. The same functions run
//   * in the checkpoint Web Worker (src/workers/annotationCheckpointWorker.js),
//   * on the main thread as the fallback (tests, no Worker, a failed worker),
//   * and could run in a native app's JS engine (only Yjs, typed arrays and,
//     for gzip, CompressionStream / DecompressionStream are needed).
//
// What a stored checkpoint is (unchanged): Y.encodeStateAsUpdate of the
// accepted document, gzipped, written as Postgres bytea hex text ('\x…').
//
// The "mirror": a copy of the sync layer's accepted document that lives in
// the worker. Every update the main thread applies to its accepted document
// is applied to the mirror too, in the same order. Applying the same updates
// in the same order to two documents built the same way gives the same
// document, so encoding the mirror gives exactly the bytes encoding the
// accepted document would (tests/annotationCheckpointWorker.test.mjs checks
// this byte for byte). The main thread then only has to say "now" (a message,
// sent in the same tick it reads at_seq) instead of encoding ~20 MB itself.

import * as Y from 'yjs';
import { createDetachedYDoc } from '../lib/collab/ydocRegistry.js';

// ---- bytes <-> Postgres bytea hex text -------------------------------------
// Table-driven (2026-10-06, test plan 68): a checkpoint is several MB; the
// per-byte toString/padStart/parseInt versions cost 30-130 ms per checkpoint.
const HEX_DIGIT_CODES = new TextEncoder().encode('0123456789abcdef');
const HEX_VALUE_BY_CODE = (() => {
  const table = new Uint8Array(128);
  for (let i = 0; i < 10; i += 1) table[48 + i] = i;
  for (let i = 0; i < 6; i += 1) { table[97 + i] = 10 + i; table[65 + i] = 10 + i; }
  return table;
})();
const HEX_TEXT_DECODER = new TextDecoder();

export function bytesToPgHex(u8) {
  const out = new Uint8Array(2 + u8.length * 2);
  out[0] = 92; // backslash
  out[1] = 120; // x
  for (let i = 0, j = 2; i < u8.length; i += 1, j += 2) {
    out[j] = HEX_DIGIT_CODES[u8[i] >> 4];
    out[j + 1] = HEX_DIGIT_CODES[u8[i] & 15];
  }
  return HEX_TEXT_DECODER.decode(out);
}

export function pgHexToBytes(str) {
  if (str instanceof Uint8Array) return str;
  const hex = (typeof str === 'string' && str.startsWith('\\x')) ? str.slice(2) : (str || '');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0, j = 0; i < out.length; i += 1, j += 2) {
    out[i] = (HEX_VALUE_BY_CODE[hex.charCodeAt(j) & 127] << 4) | HEX_VALUE_BY_CODE[hex.charCodeAt(j + 1) & 127];
  }
  return out;
}

// ---- gzip --------------------------------------------------------------------
// Gzip the checkpoint so heavy documents stay well under request-size limits
// (a many-thousand-mark Y.Doc compresses several-fold). Browsers, workers and
// Node 18+ have CompressionStream.
export async function gzipBytes(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipBytes(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---- one checkpoint --------------------------------------------------------

/** The checkpoint bytes of a document (what encodeSnapshot returns). */
export function encodeCheckpointUpdate(doc) {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Everything the upload and the bookkeeping after it need from the bytes:
 * the bytea hex text of the gzipped bytes (the RPC's p_snapshot), the gzipped
 * size (sizes later timeouts) and the bytes' state vector (which pending
 * records the checkpoint covers).
 */
//
// `asJsonBody`: instead of the hex string, its JSON text as a Blob
// (`jsonBody`, exactly what JSON.stringify writes for that string) plus its
// length (`hexLength`): the main thread then never holds (or copies) the
// multi-MB text; a Blob crosses postMessage by reference (see
// checkpointBodyFetch.js).
export async function prepareCheckpointUpload(update, { withStateVector = true, asJsonBody = false } = {}) {
  const gzipped = await gzipBytes(update);
  const hex = bytesToPgHex(gzipped);
  return {
    ...(asJsonBody
      ? { hex: null, jsonBody: new Blob([JSON.stringify(hex)]) }
      : { hex, jsonBody: null }),
    hexLength: hex.length,
    gzippedLength: gzipped.length,
    // A full parse of the bytes: free in the worker; on the main thread the
    // caller computes it only when it needs it.
    stateVector: withStateVector ? Y.encodeStateVectorFromUpdate(update) : null,
  };
}

function preparedTransfer(prepared) {
  return [prepared.stateVector?.buffer].filter(Boolean);
}

// ---- does a checkpoint stand in for a pending record? ----------------------

export function jsonValueEqual(left, right) {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

export function durableMapsEqual(leftDoc, rightDoc, mapNames) {
  for (const mapName of mapNames) {
    const left = leftDoc.getMap(mapName);
    const right = rightDoc.getMap(mapName);
    if (left.size !== right.size) return false;
    for (const [key, value] of left.entries()) {
      if (!right.has(key) || !jsonValueEqual(value, right.get(key))) return false;
    }
  }
  return true;
}

const COVERAGE_ORIGIN = 'hydrate';

/** Applying `update` on top of `snapshotUpdate` changes none of `mapNames`. */
export function snapshotSemanticallyCoversUpdate(snapshotUpdate, update, mapNames) {
  const before = createDetachedYDoc(`coverage-before:${Math.random().toString(36).slice(2)}`);
  const after = createDetachedYDoc(`coverage-after:${Math.random().toString(36).slice(2)}`);
  try {
    Y.applyUpdate(before, snapshotUpdate, COVERAGE_ORIGIN);
    Y.applyUpdate(after, snapshotUpdate, COVERAGE_ORIGIN);
    Y.applyUpdate(after, update, COVERAGE_ORIGIN);
    return durableMapsEqual(before, after, mapNames);
  } finally {
    try { before.destroy(); } catch { /* */ }
    try { after.destroy(); } catch { /* */ }
  }
}

/**
 * For each pending record update: is it fully inside the checkpoint? First
 * the cheap test (no struct of it is missing from the checkpoint's state
 * vector), then the semantic one. Same answers as the per-record loop in
 * annotationDocSync settleSnapshotCoveredRecords had.
 */
export function checkpointCoveredUpdates(snapshotUpdate, updates, mapNames, snapshotVector = null) {
  const vector = snapshotVector || Y.encodeStateVectorFromUpdate(snapshotUpdate);
  return updates.map((update) => {
    if (!update) return false;
    const missing = Y.diffUpdate(update, vector);
    if (Y.decodeUpdate(missing).structs.length > 0) return false;
    return snapshotSemanticallyCoversUpdate(snapshotUpdate, update, mapNames);
  });
}

// ---- the mirror ----------------------------------------------------------------

/** A mirror of an accepted document: the same constructor the sync layer uses. */
export function createCheckpointMirror(name = 'mirror') {
  return { doc: createDetachedYDoc(`checkpoint-mirror:${name}`), applied: 0 };
}

export function applyToCheckpointMirror(mirror, update) {
  mirror.applied += 1;
  Y.applyUpdate(mirror.doc, update, COVERAGE_ORIGIN);
}

function sameBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}

/**
 * Encode the mirror, after checking it holds what the main thread's accepted
 * document holds right now (same number of applied updates, same state
 * vector). A mismatch throws: the caller then encodes on the main thread.
 */
export function encodeCheckpointFromMirror(mirror, { expectedApplied, expectedVector }) {
  if (mirror.applied !== expectedApplied) {
    throw new Error(`checkpoint mirror out of step (${mirror.applied} of ${expectedApplied} updates)`);
  }
  if (expectedVector && !sameBytes(Y.encodeStateVector(mirror.doc), expectedVector)) {
    throw new Error('checkpoint mirror state vector differs');
  }
  return encodeCheckpointUpdate(mirror.doc);
}

// ---- one request, as the worker receives it --------------------------------
// `mirrors` is the worker's Map of mirror id -> mirror. Returns the reply and
// the buffers to transfer with it. Kept here (not in the worker file) so the
// whole protocol runs in plain Node tests too. `getOutbox` (injected by the
// worker; no storage code here) resolves to the annotation outbox the
// 'outbox-compact' request saves into.
export async function runCheckpointRequest(mirrors, request, { getOutbox = null } = {}) {
  const { op } = request || {};
  if (op === 'mirror-apply') {
    let mirror = mirrors.get(request.mirrorId);
    if (!mirror) {
      mirror = createCheckpointMirror(request.mirrorId);
      mirrors.set(request.mirrorId, mirror);
    }
    if (mirror.failed) return null;
    try {
      applyToCheckpointMirror(mirror, request.update);
    } catch (error) {
      // The main thread's apply of these bytes succeeded; this one did not.
      // The mirror is no longer a copy: refuse every later checkpoint.
      mirror.failed = String(error?.message || error);
    }
    return null; // fire and forget
  }
  if (op === 'mirror-drop') {
    const mirror = mirrors.get(request.mirrorId);
    try { mirror?.doc?.destroy(); } catch { /* */ }
    mirrors.delete(request.mirrorId);
    return null;
  }
  if (op === 'mirror-checkpoint') {
    const mirror = mirrors.get(request.mirrorId);
    if (!mirror) {
      if (request.expectedApplied === 0) {
        const empty = createCheckpointMirror(request.mirrorId);
        mirrors.set(request.mirrorId, empty);
        return runCheckpointRequest(mirrors, request);
      }
      throw new Error('checkpoint mirror missing');
    }
    if (mirror.failed) throw new Error(`checkpoint mirror failed: ${mirror.failed}`);
    const update = encodeCheckpointFromMirror(mirror, request);
    const prepared = await prepareCheckpointUpload(update, { asJsonBody: Boolean(request.asJsonBody) });
    return {
      reply: { update, ...prepared },
      transfer: [update.buffer, ...preparedTransfer(prepared)],
    };
  }
  if (op === 'prepare') {
    const prepared = await prepareCheckpointUpload(request.update, { asJsonBody: Boolean(request.asJsonBody) });
    return { reply: prepared, transfer: preparedTransfer(prepared) };
  }
  if (op === 'outbox-compact') {
    // The device's saved copy of the accepted state (annotationDocOutbox
    // compactAccepted, same rules): from given bytes, or from the mirror as
    // it is now (encoded only if a compaction actually happens).
    if (typeof getOutbox !== 'function') throw new Error('no outbox in this context');
    const outbox = await getOutbox();
    let snapshot = request.update || null;
    if (!snapshot) {
      const mirror = mirrors.get(request.mirrorId);
      if (!mirror) throw new Error('checkpoint mirror missing');
      if (mirror.failed) throw new Error(`checkpoint mirror failed: ${mirror.failed}`);
      const expected = { expectedApplied: request.expectedApplied, expectedVector: request.expectedVector };
      snapshot = () => encodeCheckpointFromMirror(mirror, expected);
    }
    const covered = request.options?.covered
      ? { ...request.options.covered, recordKeys: new Set(request.options.covered.recordKeys || []) }
      : undefined;
    const outcome = {};
    const compacted = await outbox.compactAccepted(
      request.documentId,
      request.actorUserId,
      snapshot,
      Boolean(request.force),
      request.expectedIncarnation,
      { ...(request.options || {}), covered, outcome },
    );
    return { reply: { compacted, merged: outcome.merged }, transfer: [] };
  }
  if (op === 'covered') {
    const covered = checkpointCoveredUpdates(
      request.snapshotUpdate,
      request.updates,
      request.mapNames,
      request.snapshotVector || null,
    );
    return { reply: { covered }, transfer: [] };
  }
  throw new Error(`unknown checkpoint request ${op}`);
}
