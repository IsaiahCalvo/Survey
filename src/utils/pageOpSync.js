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

export function pendingPdfVersion({ writer, token = newPdfVersionToken(), at = Date.now() }) {
  return { writer: String(writer), token, pending: true, filePath: null, contentSha256: null, at };
}

export function savedPdfVersion({ writer, token = newPdfVersionToken(), filePath, contentSha256, at = Date.now() }) {
  return {
    writer: String(writer), token, pending: false,
    filePath: filePath || null, contentSha256: contentSha256 || null, at,
  };
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
  };
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
