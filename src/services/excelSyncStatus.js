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

// Live Sync gate refusals (Amendment 2026-06-08(b)): why the Live Sync toggle
// won't turn on yet. Keyed by the reason codes from
// src/services/liveSyncEligibility.js (LIVE_SYNC_GATE_REASON). Plain English —
// the surveyor reads these on the toggle tooltip and the sync banner.
export const LIVE_SYNC_GATE_STATUS = Object.freeze({
  'eligible': { key: 'eligible', label: 'Live Sync available', tone: SYNC_TONE.SUCCESS },
  'checking': { key: 'checking', label: 'Checking Live Sync availability…', tone: SYNC_TONE.INFO },
  'not-linked': { key: 'not-linked', label: 'Link an Excel workbook first to use Live Sync', tone: SYNC_TONE.INFO },
  'local-file': { key: 'local-file', label: 'Live Sync works with OneDrive and SharePoint workbooks only', tone: SYNC_TONE.INFO },
  'not-signed-in': { key: 'not-signed-in', label: 'Sign in with your Microsoft work account to turn on Live Sync', tone: SYNC_TONE.WARN },
  'legacy-reconnect': { key: 'legacy-reconnect', label: 'Reconnect your Microsoft account in Account Settings to turn on Live Sync', tone: SYNC_TONE.WARN },
  'personal-account': { key: 'personal-account', label: 'Live Sync needs a Microsoft 365 work or school account — import and export still work', tone: SYNC_TONE.WARN },
  'unconfirmed-business': { key: 'unconfirmed-business', label: 'Not confirmed as a work OneDrive or SharePoint file yet — try again in a moment', tone: SYNC_TONE.WARN }
});

/** Gate verdict reason code → plain-English status (safe fallback: unconfirmed). */
export const liveSyncGateStatus = (reasonCode) =>
  LIVE_SYNC_GATE_STATUS[reasonCode] || LIVE_SYNC_GATE_STATUS['unconfirmed-business'];

// "Verify Live Sync" probe verdicts (src/services/liveSyncVerification.js).
// The probe's first three steps reuse the gate vocabulary above; these cover
// the live workbook steps (open / read / sync stamp) plus the overall verdict.
// Wording is tuned so syncMessageTone colors each banner honestly.
export const LIVE_SYNC_VERIFY_STATUS = Object.freeze({
  'idle': { key: 'idle', label: 'Check this workbook is ready for live sync (read-only)', tone: SYNC_TONE.INFO },
  'ready': { key: 'ready', label: 'Live sync ready — this workbook can sync in real time', tone: SYNC_TONE.SUCCESS },
  'verifying': { key: 'verifying', label: 'Checking live sync, step by step…', tone: SYNC_TONE.INFO },
  'auth-expired': { key: 'auth-expired', label: 'Microsoft sign-in expired — reconnect your Microsoft account in Account Settings, then verify again', tone: SYNC_TONE.WARN },
  'workbook-open-failed': { key: 'workbook-open-failed', label: 'Couldn’t open the Excel workbook for live sync — check the file still exists, then verify again', tone: SYNC_TONE.ERROR },
  'workbook-read-failed': { key: 'workbook-read-failed', label: 'Couldn’t read the Excel workbook — try verifying again in a moment', tone: SYNC_TONE.ERROR },
  'no-sync-stamp': { key: 'no-sync-stamp', label: 'This workbook has no sync stamp yet — push to Excel once, then verify again', tone: SYNC_TONE.WARN },
  'stale-workbook': { key: 'stale-workbook', label: 'This Excel file looks older than your latest export — pull from Excel to review it first', tone: SYNC_TONE.WARN }
});

// Plain-English names for the probe's ordered steps (tooltips / details).
export const LIVE_SYNC_VERIFY_STEP_LABELS = Object.freeze({
  'sign-in': 'Microsoft sign-in',
  'work-account': 'Work or school account',
  'business-file': 'Business OneDrive or SharePoint file',
  'workbook-open': 'Workbook opens for live sync',
  'workbook-read': 'Workbook contents readable',
  'sync-stamp': 'Sync stamp check'
});

/**
 * Verify verdict code → plain-English status. Probe-specific codes first, then
 * the slice-1 gate refusals (the probe's steps 1–3 reuse those codes), then the
 * safe fallback.
 */
export const liveSyncVerifyStatus = (verdictCode) =>
  LIVE_SYNC_VERIFY_STATUS[verdictCode]
    || LIVE_SYNC_GATE_STATUS[verdictCode]
    || LIVE_SYNC_GATE_STATUS['unconfirmed-business'];

/**
 * Plain-English banner message for a Row ID writeback drain result — BOTH
 * drains share this vocabulary: the business-Graph single-cell writer
 * (src/services/rowIdGraphWriteback.js) and the local "Excel is closed" flush
 * (src/services/rowIdLocalWriteback.js) — Amendment 2026-06-08(b) step 3.
 * Returns null when there is nothing the surveyor needs to see: an empty queue,
 * the dormant master gate, or a setup that simply isn't live-writeback eligible
 * (those rows stay safely queued; the queue depth state is a later slice).
 * Wording is chosen so syncMessageTone colors it honestly: "synced" → success,
 * "close excel" / "queued" / "reconnect your Microsoft" → warn.
 * @param {{status:string, verified?:number, remaining?:number}|null} result
 * @returns {string|null}
 */
export const rowIdWritebackMessage = (result) => {
  if (!result || typeof result !== 'object') return null;
  const verified = Number.isInteger(result.verified) ? result.verified : 0;
  const remaining = Number.isInteger(result.remaining) ? result.remaining : 0;
  const rowIds = (n) => (n === 1 ? 'Row ID' : 'Row IDs');
  switch (result.status) {
    case 'completed':
      if (verified > 0) {
        return remaining > 0
          ? `${verified} ${rowIds(verified)} synced to Excel · ${remaining} still queued`
          : `${verified} ${rowIds(verified)} synced to Excel`;
      }
      return remaining > 0 ? `${remaining} ${rowIds(remaining)} queued until safe` : null;
    case 'stopped-verify-mismatch':
      return 'Could not confirm a Row ID write — kept queued until safe';
    case 'stopped-error':
      return 'Row ID write failed (file error) — kept queued until safe';
    case 'stopped-locked':
      return 'Excel is busy — Row IDs stay queued until safe';
    case 'auth-expired':
      return 'Reconnect your Microsoft account in Account Settings to finish writing Row IDs';
    case 'session-unavailable':
      return 'Live writeback unavailable right now — Row IDs stay queued until safe';
    // Local "Excel is closed" flush refusals (rowIdLocalWriteback.js):
    case 'excel-open':
      return 'Close Excel to finish writing Row IDs — they stay queued until safe';
    case 'unsafe-unknown':
      return 'Not sure Excel is closed — Row IDs stay queued until safe';
    case 'workbook-drifted':
    case 'drifted-during-flush':
      return 'The Excel file changed outside the app — Row IDs stay queued until safe';
    default:
      return null; // 'empty' | 'gate-off' | 'not-eligible' | 'no-document' | 'not-ready'
  }
};

// Tone -> colors for a status banner (text, background, border).
// UX 2026-09-17 (revision-2 palette, owner approved): this banner carried four
// colours of its own - a flat blue, a bright green, a yellow amber and an
// orange red - none of which appears anywhere else in the app. Informational is
// plain subtext, good news is the gold, and red stays the only colour that
// means trouble. The green the palette keeps belongs to the status DOT, and a
// banner is not a dot.
export const SYNC_TONE_COLORS = Object.freeze({
  [SYNC_TONE.INFO]: { color: 'var(--text-3)', background: 'var(--surface-2)', border: '1px solid var(--border)' },
  [SYNC_TONE.SUCCESS]: { color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-press)' },
  [SYNC_TONE.WARN]: { color: 'var(--warning)', background: 'var(--warning-soft)', border: '1px solid var(--warning)' },
  [SYNC_TONE.ERROR]: { color: 'var(--danger-text)', background: 'var(--danger-soft)', border: '1px solid var(--danger)' }
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
  if (/(close excel|needs? your choice|queued|needs sync|looks older|no sync stamp|sync skipped|sign in with|reconnect your microsoft|work or school account|not confirmed as a work)/.test(text)) return SYNC_TONE.WARN;
  if (/(synced|saved|complete|up to date|live sync ready)/.test(text)) return SYNC_TONE.SUCCESS;
  return SYNC_TONE.INFO;
};

/** The banner colors for a free-text message (convenience over syncMessageTone). */
export const syncMessagePresentation = (message) => SYNC_TONE_COLORS[syncMessageTone(message)];

/** "N need your choice" — the standard plain phrasing for review counts. */
export const needsChoiceSuffix = (count) =>
  count > 0 ? ` · ${count} need your choice` : '';
