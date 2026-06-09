// src/services/excelSyncStatus.js
//
// One small, plain-English vocabulary for Excel ↔ Survey Marker sync status, plus the
// "tone" (and colors) each status should read as in the UI. Before this, the status banner
// only knew "failed = red, everything else = blue", so a warning ("Close Excel first",
// "needs your choice") looked identical to a success ("Synced"). This module gives the UI a
// single source for the words AND the color, so every surface stays consistent.
//
// Keep LABELS in plain English — the surveyor reads them, not a developer.

export const SYNC_TONE = Object.freeze({
  INFO: 'info',
  SUCCESS: 'success',
  WARN: 'warn',
  ERROR: 'error'
});

// Canonical statuses the app can be in, with the short label the user sees.
export const SYNC_STATUS = Object.freeze({
  SAVED: { key: 'saved', label: 'Saved', tone: SYNC_TONE.SUCCESS },
  SYNCED: { key: 'synced', label: 'Synced', tone: SYNC_TONE.SUCCESS },
  SYNCING: { key: 'syncing', label: 'Syncing…', tone: SYNC_TONE.INFO },
  NO_CHANGES: { key: 'no-changes', label: 'No changes found', tone: SYNC_TONE.INFO },
  NEEDS_SYNC: { key: 'needs-sync', label: 'Needs sync', tone: SYNC_TONE.WARN },
  NEEDS_CHOICE: { key: 'needs-choice', label: 'Needs your choice', tone: SYNC_TONE.WARN },
  CLOSE_EXCEL: { key: 'close-excel', label: 'Close Excel first', tone: SYNC_TONE.WARN },
  QUEUED: { key: 'queued', label: 'Queued until safe', tone: SYNC_TONE.WARN },
  CANCELLED: { key: 'cancelled', label: 'Sync cancelled', tone: SYNC_TONE.INFO },
  FAILED: { key: 'failed', label: 'Sync failed', tone: SYNC_TONE.ERROR }
});

// Tone → colors for a status banner (text, background, border).
export const SYNC_TONE_COLORS = Object.freeze({
  [SYNC_TONE.INFO]: { color: '#3498db', background: 'rgba(52, 152, 219, 0.1)', border: '1px solid rgba(52, 152, 219, 0.3)' },
  [SYNC_TONE.SUCCESS]: { color: '#2ecc71', background: 'rgba(46, 204, 113, 0.1)', border: '1px solid rgba(46, 204, 113, 0.3)' },
  [SYNC_TONE.WARN]: { color: '#e0a106', background: 'rgba(224, 161, 6, 0.12)', border: '1px solid rgba(224, 161, 6, 0.35)' },
  [SYNC_TONE.ERROR]: { color: '#e74c3c', background: 'rgba(231, 76, 60, 0.1)', border: '1px solid rgba(231, 76, 60, 0.3)' }
});

/**
 * Best-effort tone for a free-text status message, so existing transient messages color
 * correctly without threading a tone everywhere. Order matters: error first, then warn,
 * then success, else info.
 * @param {string} message
 * @returns {string} a SYNC_TONE value
 */
export const syncMessageTone = (message) => {
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  if (!text) return SYNC_TONE.INFO;
  if (/(failed|error|couldn.t|can.t|unable)/.test(text)) return SYNC_TONE.ERROR;
  if (/(close excel|needs? your choice|queued|needs sync|looks older|no sync stamp|sync skipped)/.test(text)) return SYNC_TONE.WARN;
  if (/(synced|saved|complete|up to date)/.test(text)) return SYNC_TONE.SUCCESS;
  return SYNC_TONE.INFO;
};

/** The banner colors for a free-text message (convenience over syncMessageTone). */
export const syncMessagePresentation = (message) => SYNC_TONE_COLORS[syncMessageTone(message)];

/** "N need your choice" — the standard plain phrasing for review counts. */
export const needsChoiceSuffix = (count) =>
  count > 0 ? ` · ${count} need your choice` : '';
