// Pure stuck / quarantine / pending view of the live annotation outbox.
//
// Replaces the Phase 30 crdtDualWriteQueue localStorage helpers. The live
// retry system is annotationDocOutbox (fed by annotationDocSync). This module
// only reads record lists — it never enqueues, drains, or writes.

export const STUCK_THRESHOLD_MS = 30_000;

const TERMINAL_STATUSES = new Set([
  'rejected',
  'integrity-error',
  'dependency-error',
]);

export const EMPTY_OUTBOX_RETRY = Object.freeze({
  stuckCount: 0,
  quarantinedAnnoIds: [],
  hasPending: false,
  pendingDocumentIds: Object.freeze([]),
});

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || ''));
}

function recordId(record) {
  return record?.key || record?.annoId || null;
}

function queuedAgeMs(record, now) {
  const queuedAt = Number(record?.queuedAt);
  // Missing queuedAt means the record survived a reload before timestamps
  // were stamped — treat it as already past the stuck threshold.
  if (!Number.isFinite(queuedAt) || queuedAt <= 0) return STUCK_THRESHOLD_MS + 1;
  return now - queuedAt;
}

/**
 * Summarize live outbox rows for the stuck banner, quarantine overlay, and
 * per-document tab dots.
 *
 * @param {object} args
 * @param {object[]} [args.pending]
 * @param {object[]} [args.quarantined]
 * @param {number} [args.now]
 * @returns {{
 *   stuckCount: number,
 *   quarantinedAnnoIds: string[],
 *   hasPending: boolean,
 *   pendingDocumentIds: string[],
 * }}
 */
export function summarizeOutboxRetry({
  pending = [],
  quarantined = [],
  now = Date.now(),
} = {}) {
  const quarantinedAnnoIds = [];
  const quarantinedKeys = new Set();

  const addQuarantine = (record) => {
    const id = recordId(record);
    if (!id || quarantinedKeys.has(id)) return;
    quarantinedKeys.add(id);
    quarantinedAnnoIds.push(id);
  };

  for (const record of quarantined) addQuarantine(record);
  for (const record of pending) {
    if (isTerminalStatus(record?.status) || record?.quarantined === true) {
      addQuarantine(record);
    }
  }

  const pendingDocumentIds = new Set();
  let stuckCount = 0;

  for (const record of pending) {
    const id = recordId(record);
    if (!id) continue;
    if (record?.quarantined === true || isTerminalStatus(record?.status)) continue;
    if (quarantinedKeys.has(id)) continue;
    pendingDocumentIds.add(record.documentId);
    if (queuedAgeMs(record, now) > STUCK_THRESHOLD_MS) stuckCount += 1;
  }

  return {
    stuckCount,
    quarantinedAnnoIds,
    hasPending: pendingDocumentIds.size > 0,
    pendingDocumentIds: [...pendingDocumentIds].filter(Boolean),
  };
}
