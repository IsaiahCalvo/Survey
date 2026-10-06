// src/services/annotationCheckpointOffload.js
//
// Main-thread side of the checkpoint worker (2026-10-06). Runs the pure
// checkpoint functions (annotationCheckpointCore.js) in a Web Worker when one
// is available, and on this thread otherwise (tests, no Worker, a worker that
// fails to start, errors or stops answering). Same output either way.
//
// The worker keeps one "mirror" per open document: a copy of the sync
// layer's accepted document, fed the same updates in the same order. A
// checkpoint then costs the main thread one message instead of encoding,
// gzipping and hex-encoding the whole document (~0.1-0.3 s on Package 2).

import {
  checkpointCoveredUpdates,
  prepareCheckpointUpload,
} from './annotationCheckpointCore.js';

// A request waits behind every mirror update posted before it; a very big
// open's first update can take the worker seconds on a slow phone.
const REQUEST_TIMEOUT_MS = 60_000;

let worker = null;
let workerBroken = false;
let workerFactory = null; // tests only
let nextRequestId = 1;
let nextMirrorId = 1;
const pending = new Map();

function defaultWorkerFactory() {
  return new Worker(new URL('../workers/annotationCheckpointWorker.js', import.meta.url), { type: 'module' });
}

function retireWorker(reason) {
  workerBroken = true;
  const retired = worker;
  worker = null;
  try { retired?.terminate?.(); } catch { /* noop */ }
  const error = new Error(reason || 'checkpoint worker failed');
  error.workerUnavailable = true;
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
}

function getWorker() {
  if (workerBroken) return null;
  if (worker) return worker;
  const factory = workerFactory || (typeof Worker !== 'undefined' ? defaultWorkerFactory : null);
  if (!factory) return null;
  try {
    worker = factory();
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data?.requestId);
      if (!entry) return;
      pending.delete(data.requestId);
      clearTimeout(entry.timer);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
    };
    // A worker that cannot load (CSP, old WebView) or dies is retired for
    // good; every caller falls back to this thread.
    worker.onerror = (event) => retireWorker(event?.message || 'checkpoint worker failed');
    worker.onmessageerror = () => retireWorker('checkpoint worker message failed');
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function request(target, message, transfer = []) {
  return new Promise((resolve, reject) => {
    const requestId = nextRequestId;
    nextRequestId += 1;
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      // Stuck: retire it (rejects this and every other waiting request).
      retireWorker('checkpoint worker did not answer');
    }, REQUEST_TIMEOUT_MS);
    timer?.unref?.(); // never keeps a Node test process alive
    pending.set(requestId, { resolve, reject, timer });
    try {
      target.postMessage({ ...message, requestId }, transfer);
    } catch (error) {
      pending.delete(requestId);
      clearTimeout(timer);
      reject(error);
    }
  });
}

/** A private copy whose buffer can be transferred. */
function ownCopy(u8) {
  return new Uint8Array(u8);
}

// ---- the accepted-document mirror -------------------------------------------

/**
 * A mirror for one document's accepted state, or null when there is no
 * worker (the caller then encodes on this thread, as before).
 */
export function createCheckpointMirror() {
  const target = getWorker();
  if (!target) return null;
  const id = `mirror-${nextMirrorId}`;
  nextMirrorId += 1;
  return { id, worker: target, applied: 0, broken: false };
}

function mirrorUsable(mirror) {
  if (!mirror || mirror.broken) return false;
  if (mirror.worker !== worker) { mirror.broken = true; return false; }
  return true;
}

/** Call right after the same bytes were applied to the accepted document. */
export function applyToCheckpointMirror(mirror, update) {
  if (!mirrorUsable(mirror)) return;
  const copy = ownCopy(update);
  mirror.applied += 1;
  try {
    mirror.worker.postMessage({ op: 'mirror-apply', mirrorId: mirror.id, update: copy }, [copy.buffer]);
  } catch {
    breakCheckpointMirror(mirror);
  }
}

/** The mirror no longer matches (or is no longer wanted): stop using it. */
export function breakCheckpointMirror(mirror) {
  if (!mirror || mirror.broken) return;
  mirror.broken = true;
  try { mirror.worker?.postMessage({ op: 'mirror-drop', mirrorId: mirror.id }); } catch { /* gone */ }
}

/**
 * Start a checkpoint from the mirror NOW: the worker encodes the mirror as it
 * is after every update posted so far, i.e. the accepted document at this
 * instant (`expectedVector` is that document's state vector, checked there).
 * Resolves to { update, hex, gzippedLength, stateVector }; null when there is
 * no usable mirror. Rejects when the worker fails: the caller then breaks the
 * mirror and encodes on this thread.
 */
export function requestMirrorCheckpoint(mirror, expectedVector, { asJsonBody = false } = {}) {
  if (!mirrorUsable(mirror)) return null;
  return request(mirror.worker, {
    op: 'mirror-checkpoint',
    mirrorId: mirror.id,
    expectedApplied: mirror.applied,
    expectedVector: expectedVector ? ownCopy(expectedVector) : null,
    asJsonBody,
  });
}

/**
 * Save into the device's annotation outbox (annotationDocOutbox
 * compactAccepted) from the worker, which opens the same IndexedDB database:
 * the multi-MB read of the stored copy and write of the new one then happen
 * there. `update`: the bytes to save (with `transfer`, moved: the caller must
 * not use them afterwards; else copied), or null to use the mirror as it is now (encoded only if a
 * compaction happens). Resolves to { compacted, merged }; null when there is
 * no usable mirror (the caller saves on this thread). Rejects on failure.
 */
export function compactAcceptedInWorker(mirror, {
  documentId,
  actorUserId,
  update = null,
  transfer = false,
  force = false,
  expectedIncarnation = 0,
  expectedVector = null,
  options = {},
}) {
  if (!mirrorUsable(mirror)) return null;
  const covered = options.covered
    ? {
      token: options.covered.token ?? null,
      checkpointUpdate: options.covered.checkpointUpdate ? ownCopy(options.covered.checkpointUpdate) : null,
      recordKeys: [...(options.covered.recordKeys || [])],
    }
    : undefined;
  const bytes = update instanceof Uint8Array ? update : null;
  return request(mirror.worker, {
    op: 'outbox-compact',
    mirrorId: mirror.id,
    expectedApplied: mirror.applied,
    expectedVector: expectedVector ? ownCopy(expectedVector) : null,
    documentId,
    actorUserId,
    update: bytes,
    force,
    expectedIncarnation,
    options: {
      covered,
      identity: options.identity ?? null,
      token: options.token,
      onlyIfCovered: Boolean(options.onlyIfCovered),
    },
  }, transfer && bytes && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? [bytes.buffer] : []);
}

// ---- stateless helpers (worker, else this thread) ----------------------------

/**
 * gzip + bytea hex + state vector of checkpoint bytes the caller already has.
 * Resolves to { hex, jsonBody, hexLength, gzippedLength, stateVector }: with
 * `asJsonBody` the worker returns jsonBody (the hex string's JSON text, as a
 * Blob) instead of hex; the main-thread fallback always returns hex.
 */
export async function prepareCheckpointUploadOffThread(update, { asJsonBody = false } = {}) {
  const target = getWorker();
  if (target) {
    const copy = ownCopy(update);
    try {
      return await request(target, { op: 'prepare', update: copy, asJsonBody }, [copy.buffer]);
    } catch { /* fall through to this thread */ }
  }
  // On this thread the hex string is built anyway: no JSON-bytes detour.
  return prepareCheckpointUpload(update, { withStateVector: false });
}

/** For each record update: does the checkpoint already hold all of it? */
export async function checkpointCoveredUpdatesOffThread(snapshotUpdate, updates, mapNames, snapshotVector = null) {
  const target = getWorker();
  if (target) {
    const snapshotCopy = ownCopy(snapshotUpdate);
    const updateCopies = updates.map((u) => (u ? ownCopy(u) : null));
    try {
      const result = await request(target, {
        op: 'covered',
        snapshotUpdate: snapshotCopy,
        updates: updateCopies,
        mapNames: [...mapNames],
        snapshotVector: snapshotVector ? ownCopy(snapshotVector) : null,
      }, [snapshotCopy.buffer, ...updateCopies.filter(Boolean).map((u) => u.buffer)]);
      if (Array.isArray(result?.covered) && result.covered.length === updates.length) return result.covered;
    } catch { /* fall through to this thread */ }
  }
  return checkpointCoveredUpdates(snapshotUpdate, updates, mapNames, snapshotVector);
}

// ---- tests -----------------------------------------------------------------------

/** Tests: use `factory()` as the worker (null = back to the default). */
export function __setCheckpointWorkerFactoryForTests(factory) {
  if (worker) retireWorker('reset for tests');
  workerFactory = factory || null;
  workerBroken = false;
  worker = null;
}

export function __checkpointWorkerStateForTests() {
  return { hasWorker: Boolean(worker), workerBroken, pending: pending.size };
}
