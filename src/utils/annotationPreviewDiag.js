/**
 * annotationPreviewDiag.js — opt-in, no-op-by-default diagnostics for annotation
 * gesture lifecycles (preview frames, commits, sync/backup writes).
 *
 * Enabled via window flag, localStorage, or ?annotationPreviewDiag=1. Exports
 * beginAnnotationGesture + per-event recorders (markPreviewFrame, pointerRelease,
 * recordCommit/SyncAttempt/SyncPush/BackupWrite/UndoRedo) and a settled summary.
 * Tracks state on window; designed to never affect annotation behavior.
 */
const FLAG_NAME = '__ANNOTATION_PREVIEW_DIAG';
const STATE_NAME = '__annotationPreviewDiagState';
const SUMMARY_DELAY_MS = 1400;
const RECENT_RELEASE_MS = 5000;

const now = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

export function isAnnotationPreviewDiagEnabled() {
  if (typeof window === 'undefined') return false;
  if (window[FLAG_NAME] === true) return true;
  try {
    if (window.localStorage?.getItem('annotation_preview_diag') === 'true') return true;
  } catch (_) {
    // ignore storage access failures
  }
  try {
    const params = new URLSearchParams(window.location?.search || '');
    return params.get('annotationPreviewDiag') === '1';
  } catch (_) {
    return false;
  }
}

function getState() {
  if (typeof window === 'undefined') return null;
  if (!window[STATE_NAME]) {
    window[STATE_NAME] = {
      seq: 0,
      gestures: new Map(),
      activeId: null,
      lastReleasedId: null,
    };
  }
  return window[STATE_NAME];
}

function log(message, payload) {
  if (!isAnnotationPreviewDiagEnabled()) return;
  try {
    console.log(`[PreviewDiag] ${message}`, payload || {});
  } catch (_) {
    // diagnostics must never affect annotation behavior
  }
}

function formatId(meta) {
  return meta?.annotationId ?? meta?.calloutId ?? meta?.annotationId ?? meta?.id ?? null;
}

function resolveGesture(gestureId = null) {
  const state = getState();
  if (!state) return null;
  if (gestureId && state.gestures.has(gestureId)) return state.gestures.get(gestureId);
  if (state.activeId && state.gestures.has(state.activeId)) return state.gestures.get(state.activeId);
  if (state.lastReleasedId && state.gestures.has(state.lastReleasedId)) {
    const recent = state.gestures.get(state.lastReleasedId);
    if (recent && now() - (recent.releasedAt || recent.startedAt) <= RECENT_RELEASE_MS) return recent;
  }
  return null;
}

function scheduleSummary(gesture) {
  if (!gesture || typeof window === 'undefined') return;
  if (gesture.summaryTimer) clearTimeout(gesture.summaryTimer);
  gesture.summaryTimer = window.setTimeout(() => {
    emitAnnotationGestureSummary(gesture.id, { reason: 'settled' });
  }, SUMMARY_DELAY_MS);
}

export function beginAnnotationGesture(meta = {}) {
  if (!isAnnotationPreviewDiagEnabled()) return null;
  const state = getState();
  if (!state) return null;
  const id = `gesture-${++state.seq}`;
  const gesture = {
    id,
    startedAt: now(),
    releasedAt: null,
    finished: false,
    previewFrames: 0,
    commits: 0,
    syncWritesDuringPointerDown: 0,
    syncDeferredDuringPointerDown: 0,
    syncPushesAfterRelease: 0,
    backupWritesDuringPointerDown: 0,
    backupWritesAfterRelease: 0,
    meta: { pointerDown: true, ...meta, annotationId: formatId(meta) },
    summaryTimer: null,
  };
  state.gestures.set(id, gesture);
  state.activeId = id;
  log('start', gesture.meta);
  return id;
}

export function updateAnnotationGesture(gestureId, meta = {}) {
  if (!isAnnotationPreviewDiagEnabled()) return;
  const gesture = resolveGesture(gestureId);
  if (!gesture) return;
  gesture.meta = { ...gesture.meta, ...meta, annotationId: formatId(meta) || gesture.meta.annotationId };
}

export function markAnnotationPreviewFrame(gestureId, detail = {}) {
  if (!isAnnotationPreviewDiagEnabled()) return;
  const gesture = resolveGesture(gestureId);
  if (!gesture) return;
  gesture.previewFrames += 1;
  if (gesture.previewFrames === 1 || gesture.previewFrames % 25 === 0) {
    log('preview', { id: gesture.id, frames: gesture.previewFrames, ...gesture.meta, ...detail });
  }
}

export function markAnnotationPointerRelease(gestureId, detail = {}) {
  if (!isAnnotationPreviewDiagEnabled()) return;
  const state = getState();
  const gesture = resolveGesture(gestureId);
  if (!state || !gesture) return;
  if (gesture.releasedAt) return;
  gesture.releasedAt = now();
  gesture.meta = { ...gesture.meta, pointerDown: false, ...detail };
  state.lastReleasedId = gesture.id;
  if (state.activeId === gesture.id) state.activeId = null;
  log('pointer release', { id: gesture.id, frames: gesture.previewFrames, ...gesture.meta });
  scheduleSummary(gesture);
}

export function recordAnnotationCommit(detail = {}) {
  if (!isAnnotationPreviewDiagEnabled()) return;
  const gesture = resolveGesture(detail.gestureId);
  if (gesture) {
    gesture.commits += 1;
    gesture.meta = { ...gesture.meta, ...detail, annotationId: formatId(detail) || gesture.meta.annotationId };
    log('final commit', { id: gesture.id, commits: gesture.commits, ...gesture.meta });
    scheduleSummary(gesture);
    return;
  }
  log('final commit', detail);
}

export function recordAnnotationSyncAttempt(detail = {}) {
  if (!isAnnotationPreviewDiagEnabled()) return;
  const gesture = resolveGesture();
  const count = Number.isFinite(detail.count) ? detail.count : 1;
  if (gesture && detail.pointerDown) {
    gesture.syncWritesDuringPointerDown += count;
    if (detail.deferred) gesture.syncDeferredDuringPointerDown += count;
  }
  if (detail.pointerDown || detail.deferred) {
    log('sync attempted while pointer down', {
      gestureId: gesture?.id || null,
      deferred: Boolean(detail.deferred),
      ...detail,
    });
  }
}

export function recordAnnotationSyncPush(detail = {}) {
  if (!isAnnotationPreviewDiagEnabled()) return;
  const gesture = resolveGesture();
  const count = Number.isFinite(detail.count) ? detail.count : 1;
  if (gesture) {
    if (gesture.releasedAt) {
      gesture.syncPushesAfterRelease += count;
    } else {
      gesture.syncWritesDuringPointerDown += count;
    }
    log('sync push', { gestureId: gesture.id, totalAfterRelease: gesture.syncPushesAfterRelease, ...detail });
    scheduleSummary(gesture);
    return;
  }
  log('sync push', detail);
}

export function recordAnnotationBackupWrite(detail = {}) {
  if (!isAnnotationPreviewDiagEnabled()) return;
  const gesture = resolveGesture();
  const count = Number.isFinite(detail.count) ? detail.count : 1;
  if (gesture) {
    if (gesture.releasedAt) {
      gesture.backupWritesAfterRelease += count;
    } else {
      gesture.backupWritesDuringPointerDown += count;
    }
    log('backup write', {
      gestureId: gesture.id,
      duringPointerDown: !gesture.releasedAt,
      totalDuringPointerDown: gesture.backupWritesDuringPointerDown,
      totalAfterRelease: gesture.backupWritesAfterRelease,
      ...detail,
    });
    scheduleSummary(gesture);
    return;
  }
  log('backup write', detail);
}

export function recordAnnotationUndoRedo(action, detail = {}) {
  if (!isAnnotationPreviewDiagEnabled()) return;
  log('undo-redo', { action, ...detail });
}

function emitAnnotationGestureSummary(gestureId = null, detail = {}) {
  if (!isAnnotationPreviewDiagEnabled()) return;
  const state = getState();
  const gesture = resolveGesture(gestureId);
  if (!state || !gesture || gesture.finished) return;
  if (gesture.summaryTimer) clearTimeout(gesture.summaryTimer);
  gesture.summaryTimer = null;
  gesture.finished = true;
  const action = gesture.meta?.action || gesture.meta?.type || 'gesture';
  const summary = `${action} started, ${gesture.previewFrames} preview frames, ${gesture.syncWritesDuringPointerDown} sync writes during drag, ${gesture.syncDeferredDuringPointerDown} sync deferrals during drag, ${gesture.backupWritesDuringPointerDown} backup writes during drag, ${gesture.commits} commit${gesture.commits === 1 ? '' : 's'} on release, ${gesture.syncPushesAfterRelease} sync push${gesture.syncPushesAfterRelease === 1 ? '' : 'es'} after release, ${gesture.backupWritesAfterRelease} backup write${gesture.backupWritesAfterRelease === 1 ? '' : 's'} after release`;
  log(`summary ${summary}`, {
    id: gesture.id,
    durationMs: Math.round((now() - gesture.startedAt) * 10) / 10,
    ...gesture.meta,
    ...detail,
  });
  window.setTimeout(() => {
    state.gestures.delete(gesture.id);
    if (state.lastReleasedId === gesture.id) state.lastReleasedId = null;
  }, 500);
}
