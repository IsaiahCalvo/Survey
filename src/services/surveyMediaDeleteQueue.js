/**
 * surveyMediaDeleteQueue.js - media files whose removal from storage failed,
 * kept so they are removed later instead of being forgotten.
 *
 * Codex review (release PR, 2026-10-13): removing a photo from a Survey
 * Marker drops the note's reference first and then deletes the stored file.
 * When that delete failed (no connection, storage hiccup) the error was only
 * logged: the file's path was lost, nothing retried, the server's orphan
 * finder (list_orphaned_survey_media) cannot see it while the document still
 * exists, and it kept counting against the uploader's storage quota.
 *
 * Now a failed delete is written to a small per-user list in localStorage and
 * retried when the app starts, when the device comes back online, and after a
 * later media upload / removal succeeds. An entry is dropped when the file is
 * removed or is already gone, and when storage says this user may not remove
 * it ('forbidden': only the uploader or the document's owner may - see the
 * survey_media_delete policy). A forbidden file is left for its uploader or
 * the document owner; once a document is gone, the server's orphan sweep
 * (archive-purge-sweep -> list_orphaned_survey_media) removes whatever media
 * is left. "Delete forever" only queues the caller's own uploads
 * (surveyMediaPurge.js).
 *
 * localStorage can be missing or throw (private mode, quota, previews); every
 * access is guarded, and without it this degrades to the old log-only
 * behaviour.
 */
import { deleteSurveyMediaPaths, getSurveyMediaUserId } from './surveyMediaService.js';

const KEY_PREFIX = 'surveyMedia.pendingDeletes.v1:';
// A bound so a pathological loop can never fill localStorage.
export const SURVEY_MEDIA_DELETE_QUEUE_MAX = 500;

let storageOverride = null;
let deletePathsOverride = null;
/** Test seam: a Storage-like object (getItem / setItem / removeItem). */
export function __setSurveyMediaDeleteQueueForTests({ storage = null, deletePaths = null } = {}) {
  storageOverride = storage;
  deletePathsOverride = deletePaths;
  inFlight.clear();
}

function storage() {
  if (storageOverride) return storageOverride;
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

const keyFor = (userId) => `${KEY_PREFIX}${userId}`;

/** The queued entries for a user ({ path, queuedAt, attempts, lastCode }). */
export function readSurveyMediaDeleteQueue(userId) {
  if (!userId) return [];
  try {
    const raw = storage()?.getItem(keyFor(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry?.path === 'string' && entry.path) : [];
  } catch {
    return [];
  }
}

function writeQueue(userId, entries) {
  try {
    const store = storage();
    if (!store) return false;
    if (entries.length === 0) store.removeItem(keyFor(userId));
    else store.setItem(keyFor(userId), JSON.stringify(entries.slice(-SURVEY_MEDIA_DELETE_QUEUE_MAX)));
    return true;
  } catch {
    return false;
  }
}

/** Add paths to the user's queue (a path already queued is kept once). */
export function queueSurveyMediaDeletes(userId, paths, { code = null, now = Date.now() } = {}) {
  if (!userId) return false;
  const list = readSurveyMediaDeleteQueue(userId);
  const known = new Set(list.map((entry) => entry.path));
  let added = 0;
  for (const path of paths || []) {
    if (typeof path !== 'string' || !path || known.has(path)) continue;
    known.add(path);
    list.push({ path, queuedAt: now, attempts: 0, lastCode: code });
    added += 1;
  }
  if (added === 0) return true;
  return writeQueue(userId, list);
}

const inFlight = new Map(); // userId -> promise of the running retry

/**
 * Try every queued delete for the user once. Resolves to
 * { removed, forbidden, remaining }. One run per user at a time.
 */
export function retrySurveyMediaDeletes(userId) {
  if (!userId) return Promise.resolve({ removed: 0, forbidden: 0, remaining: 0 });
  if (inFlight.has(userId)) return inFlight.get(userId);
  const run = (async () => {
    const queued = readSurveyMediaDeleteQueue(userId);
    if (queued.length === 0) return { removed: 0, forbidden: 0, remaining: 0 };
    const deletePaths = deletePathsOverride || deleteSurveyMediaPaths;
    let outcome;
    try {
      outcome = await deletePaths(queued.map((entry) => entry.path));
    } catch {
      return { removed: 0, forbidden: 0, remaining: queued.length };
    }
    const failedCode = new Map((outcome?.failed || []).map((entry) => [entry.path, entry.code || null]));
    const forbidden = outcome?.forbidden || [];
    if (forbidden.length > 0) {
      console.info('[surveyMedia] left for the uploader or the document owner (no permission to remove):', forbidden);
    }
    // Only a definite answer drops an entry: removed, already gone, or not
    // allowed. Re-read first: another tab or a new failure may have added
    // entries meanwhile.
    const done = new Set([...(outcome?.deleted || []), ...(outcome?.gone || []), ...forbidden]);
    const latest = readSurveyMediaDeleteQueue(userId);
    const remaining = latest
      .filter((entry) => !done.has(entry.path))
      .map((entry) => (failedCode.has(entry.path)
        ? { ...entry, attempts: (entry.attempts || 0) + 1, lastCode: failedCode.get(entry.path) }
        : entry));
    writeQueue(userId, remaining);
    return {
      removed: (outcome?.deleted?.length || 0) + (outcome?.gone?.length || 0),
      forbidden: forbidden.length,
      remaining: remaining.length,
    };
  })().finally(() => inFlight.delete(userId));
  inFlight.set(userId, run);
  return run;
}

/**
 * Remove a note's stored file; if storage cannot be reached, keep its path in
 * the queue. Never throws. Resolves to 'deleted' | 'queued' | 'forbidden'.
 */
export async function deleteSurveyMediaOrQueue(ref, { userId = null } = {}) {
  if (!ref?.path) return 'deleted';
  const deletePaths = deletePathsOverride || deleteSurveyMediaPaths;
  let outcome;
  try {
    outcome = await deletePaths([ref.path]);
  } catch (error) {
    outcome = { deleted: [], gone: [], forbidden: [], failed: [{ path: ref.path, code: error?.code || 'delete-failed' }] };
  }
  const uid = userId || await getSurveyMediaUserId();
  if (outcome.failed?.length > 0) {
    console.warn('[surveyMedia] could not delete the file; will retry', outcome.failed[0]);
    queueSurveyMediaDeletes(uid, [ref.path], { code: outcome.failed[0].code });
    return 'queued';
  }
  if (outcome.forbidden?.length > 0) {
    // Not this user's upload, and not their document: the uploader or the
    // document owner can remove it ("delete forever" removes all of a
    // document's media); nothing more this device can do.
    console.info('[surveyMedia] file left for its uploader or the document owner:', ref.path);
    return 'forbidden';
  }
  // A media operation worked, so storage is reachable: retry older failures.
  void retrySurveyMediaDeletes(uid);
  return 'deleted';
}

/** After any successful media upload: storage is reachable, retry the queue. */
export function retrySurveyMediaDeletesSoon(userId = null) {
  void (async () => {
    const uid = userId || await getSurveyMediaUserId();
    if (uid && readSurveyMediaDeleteQueue(uid).length > 0) await retrySurveyMediaDeletes(uid);
  })().catch(() => {});
}

/**
 * App start: retry now and whenever the device comes back online. Returns a
 * cleanup function. Safe to call without a window (does nothing).
 */
export function startSurveyMediaDeleteRetry(userId) {
  if (!userId) return () => {};
  const run = () => {
    if (readSurveyMediaDeleteQueue(userId).length === 0) return;
    retrySurveyMediaDeletes(userId).catch(() => {});
  };
  run();
  const target = typeof window !== 'undefined' ? window : null;
  target?.addEventListener?.('online', run);
  return () => target?.removeEventListener?.('online', run);
}
