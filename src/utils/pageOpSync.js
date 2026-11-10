// Page operations in two windows (Nightly flag 'page-op-sync').
//
// A page operation (rotate, delete, insert, move, duplicate, paste) rewrites
// the PDF bytes in Storage, while the turned / remapped marks reach the other
// open viewers live through the shared document. Without a signal those
// viewers keep showing their old bytes under the new marks, and a page change
// made there works on stale bytes. So the writer stamps the shared document
// (PDF_FILE_VERSION_META_KEY in utils/pagePresentation.js):
//   pending: true   - at the page change, in the same tick as its marks
//   pending: false  - once the new bytes are saved, with their path and sha
// Another viewer refuses page changes while a stamp is pending, and reloads
// the PDF when a saved stamp names bytes it does not have. A pending stamp
// that is never resolved (the writer closed mid-save) stops blocking after
// PAGE_OP_BLOCK_MS.

export const PAGE_OP_SYNC_FLAG = 'page-op-sync';
export const PAGE_OP_BLOCK_MS = 30_000;
export const PAGE_OP_BLOCKED_MESSAGE = 'Pages are being changed in another window.';

export function newPdfVersionToken() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  return `pv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Mirror / reset change only how a page is shown (the shared page
// presentation), and a rollback puts back state whose bytes never changed.
const NO_BYTE_TYPES = new Set(['presentation', 'rollback']);

/** True when committing `operation` means new PDF bytes will be saved. */
export function operationRewritesPdf(operation) {
  if (!operation || typeof operation !== 'object') return false;
  if (operation.type === 'batch') return (operation.operations || []).some(operationRewritesPdf);
  return typeof operation.type === 'string' && !NO_BYTE_TYPES.has(operation.type);
}

// `batch` names one run of page changes between two saves; its stamps carry
// every change of that run so far, so a later stamp of the same run replaces
// an earlier one, and a new run adds to it.
export function pendingPdfVersion({ writer, token = newPdfVersionToken(), at = Date.now(), operations = null, batch = null }) {
  return { writer: String(writer), token, pending: true, filePath: null, contentSha256: null, at, operations: operations || null, batch: batch || null };
}

export function savedPdfVersion({ writer, token = newPdfVersionToken(), filePath, contentSha256, at = Date.now(), operations = null, batch = null }) {
  return {
    writer: String(writer), token, pending: false,
    filePath: filePath || null, contentSha256: contentSha256 || null, at,
    operations: operations || null, batch: batch || null,
  };
}

// The page changes a stamp carries, so another window can move a mark it
// drew on the old pages (before its reload) the same way: turned with its
// page, or onto the page's new number (R4-C N6b). Only small, plain steps
// travel; an Undo of a delete carries a whole page state and is left out.
const STAMP_OP_TYPES = new Set(['rotate', 'insert', 'delete', 'move', 'reorder', 'duplicate', 'copy', 'batch']);
export const STAMP_OPERATIONS_MAX_CHARS = 8_000;
export function stampableOperation(operation) {
  // An Undo of a delete puts the page back with its old marks; for marks
  // drawn elsewhere that is a page added after `afterPage` (R5 N6e).
  if (operation?.type === 'restore' && Number.isInteger(Number(operation.afterPage))) {
    return { type: 'insert', afterPage: Number(operation.afterPage) };
  }
  if (operation?.type === 'batch' && (operation.operations || []).some((step) => step?.type === 'restore')) {
    const steps = (operation.operations || []).map((step) => stampableOperation(step));
    return steps.every(Boolean) ? stampableOperation({ type: 'batch', operations: steps }) : null;
  }
  if (!operation || typeof operation !== 'object' || !STAMP_OP_TYPES.has(operation.type)) return null;
  if (operation.type === 'batch' && !(operation.operations || []).every((step) => stampableOperation(step))) return null;
  try {
    const text = JSON.stringify(operation);
    return text.length <= STAMP_OPERATIONS_MAX_CHARS ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * Moves the marks `ids` (drawn here on the pages as they were before
 * `operations`) the way those page changes moved every other mark.
 * `transform` is transformPageState. Returns { [page]: objects } for each
 * page whose list changes, or null when nothing moves.
 */
export function reframeMarks(annotationsByPage, ids, operations, transform) {
  if (!ids || ids.size === 0 || !Array.isArray(operations) || operations.length === 0) return null;
  const byPage = annotationsByPage || {};
  const picked = {};
  for (const [page, value] of Object.entries(byPage)) {
    const objects = (Array.isArray(value?.objects) ? value.objects : []).filter((obj) => ids.has(obj?.data?.id));
    if (objects.length) picked[page] = { objects };
  }
  if (Object.keys(picked).length === 0) return null;
  let model = {
    annotationsByPage: picked, surveyMarkers: {}, annotations: {}, pageNames: {},
    pageTransformations: {}, bookmarks: [], spaces: [], regionOverlayDisabled: new Map(),
  };
  for (const operation of operations) model = transform(model, operation);
  const changed = {};
  const take = (page) => {
    if (!changed[page]) changed[page] = (Array.isArray(byPage[page]?.objects) ? byPage[page].objects : []).filter((obj) => !ids.has(obj?.data?.id));
    return changed[page];
  };
  for (const page of Object.keys(picked)) take(page);
  for (const [page, value] of Object.entries(model.annotationsByPage || {})) {
    take(page).push(...(Array.isArray(value?.objects) ? value.objects : []));
  }
  return changed;
}

/** The write failed and was rolled back: nothing changed, stop blocking. */
export function clearedPdfVersion({ writer, token = newPdfVersionToken(), at = Date.now() }) {
  return savedPdfVersion({ writer, token, filePath: null, contentSha256: null, at });
}

export function normalizePdfVersion(value) {
  if (!value || typeof value !== 'object' || !value.writer || !value.token) return null;
  return {
    writer: String(value.writer),
    token: String(value.token),
    pending: value.pending === true,
    filePath: typeof value.filePath === 'string' && value.filePath ? value.filePath : null,
    contentSha256: typeof value.contentSha256 === 'string' && value.contentSha256 ? value.contentSha256 : null,
    at: Number.isFinite(Number(value.at)) && value.at != null ? Number(value.at) : null,
    operations: Array.isArray(value.operations) ? value.operations.filter((op) => op && typeof op === 'object') : null,
    batch: typeof value.batch === 'string' && value.batch ? value.batch : null,
  };
}

/**
 * The page changes another window made since this one last reloaded, in
 * order (R5 N6d). `frame.batches` maps each run to its latest list; a stamp
 * without a run name (an older client) stands alone. Null when one of them
 * could not travel, so nothing is moved rather than moved wrong.
 */
export function noteFramePageChanges(frame, version) {
  const next = frame || { made: new Set(), batches: new Map() };
  if (!next.batches) next.batches = new Map();
  next.batches.set(version?.batch || `token:${version?.token}`, Array.isArray(version?.operations) ? version.operations : null);
  return next;
}
export function framePageChanges(frame) {
  if (!frame?.batches?.size) return null;
  const out = [];
  for (const ops of frame.batches.values()) {
    if (!Array.isArray(ops)) return null;
    out.push(...ops);
  }
  return out;
}

export const IDLE_REMOTE_PDF_STATE = Object.freeze({ blockedUntil: 0, pendingToken: null, awaitSha: null });

/**
 * A stamp seen in the shared document. Returns the next state and what to do:
 *   'ignore'  - this viewer's own stamp, or not a stamp
 *   'block'   - refuse page changes until the bytes are saved
 *   'reload'  - load `version.filePath` (bytes this viewer does not have);
 *               page changes stay refused until remotePdfLoaded
 *   'unblock' - nothing to load (a rollback, or bytes this viewer has)
 */
export function remotePdfVersionStep(state, value, {
  writer, currentSha = null, now = Date.now(), timeoutMs = PAGE_OP_BLOCK_MS,
} = {}) {
  const current = state || IDLE_REMOTE_PDF_STATE;
  const version = normalizePdfVersion(value);
  if (!version || version.writer === String(writer)) return { state: current, action: 'ignore', version };
  if (version.pending) {
    // The writer's clock dates the stamp: one written long ago (left behind
    // by a closed window, read late) blocks no longer than its own window.
    const age = version.at != null ? Math.max(0, now - version.at) : 0;
    const blockedUntil = now + Math.max(0, timeoutMs - age);
    if (blockedUntil <= now) return { state: IDLE_REMOTE_PDF_STATE, action: 'unblock', version };
    return { state: { blockedUntil, pendingToken: version.token, awaitSha: null }, action: 'block', version };
  }
  if (version.filePath && version.contentSha256 && version.contentSha256 !== currentSha) {
    return {
      state: { blockedUntil: now + timeoutMs, pendingToken: null, awaitSha: version.contentSha256 },
      action: 'reload',
      version,
    };
  }
  return { state: IDLE_REMOTE_PDF_STATE, action: 'unblock', version };
}

export function isPageOpBlocked(state, now = Date.now()) {
  return Boolean(state && (state.pendingToken || state.awaitSha) && state.blockedUntil > now);
}

/** The viewer opened bytes with `sha`: a reload waiting for them is done. */
export function remotePdfLoaded(state, sha) {
  if (!state?.awaitSha || !sha || state.awaitSha !== sha) return state || IDLE_REMOTE_PDF_STATE;
  return IDLE_REMOTE_PDF_STATE;
}

/**
 * The tab's file for bytes another viewer saved: the same document (id,
 * project, owner) as a cloud file the viewer streams or downloads from
 * `filePath`. Never the old bytes (a page-edited File carries them), and no
 * load-failure markers.
 */
export function remotePdfFileDescriptor(current, { filePath, contentSha256 }) {
  const own = {};
  for (const [key, value] of Object.entries(current || {})) {
    if (typeof value === 'function' || key.startsWith('__') || key === 'size') continue;
    own[key] = value;
  }
  const next = {
    ...own,
    name: current?.name ?? own.name,
    filePath,
    supabaseFilePath: filePath,
    contentSha256: contentSha256 || null,
  };
  if ('file_path' in own) next.file_path = filePath;
  if ('content_sha256' in own) next.content_sha256 = contentSha256 || null;
  return next;
}
