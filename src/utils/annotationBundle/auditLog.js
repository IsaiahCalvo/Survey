// audit-log.json for the review bundle (KAL-410).
//
// Source: the document's History rows (document_history_events, plus the
// device's not-yet-uploaded copies), the same rows the History panel shows.
// Each row is read through the History panel's own describeHistoryRow, so the
// log and the panel always agree on who did what to which mark and when.
// The row's raw payload (full mark geometry, restore data) is left out: the
// marks themselves are in annotations.xfdf.

import { describeHistoryRow, historyRowKey } from '../historyFeed.js';

export const AUDIT_LOG_FORMAT = 'survey-annotation-audit-log';
export const AUDIT_LOG_VERSION = 1;

// The server prunes History rows after 60 days (see documentHistoryService),
// so the log can only cover that window.
export const HISTORY_RETENTION_DAYS = 60;

const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

export function auditEventFromRow(row) {
  const d = describeHistoryRow(row);
  return {
    at: iso(d.ms),
    actor: { id: d.actorId, name: d.actorName === 'Someone' ? null : d.actorName },
    action: d.kind,
    change: d.status,
    markType: d.typeKey || null,
    markIds: d.markIds,
    page: Number.isFinite(d.page) ? d.page : null,
    eventType: row?.event_type || null,
    source: row?.source || null,
    summary: row?.summary || null,
    id: historyRowKey(row),
  };
}

/**
 * @param {object} args
 * @param {object[]} args.rows        History rows, any order
 * @param {object} args.document      { name, id, sourceSha256 }
 * @param {string} args.exportedAt    ISO time of the export
 * @param {object} [args.marks]       what annotations.xfdf holds, by kind
 * @param {boolean} [args.historyAvailable] false when History could not be read
 */
export function buildAuditLog({ rows = [], document = {}, exportedAt, marks = null, historyAvailable = true }) {
  const events = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object')
    .map(auditEventFromRow)
    .sort((a, b) => (a.at || '').localeCompare(b.at || '') || String(a.id).localeCompare(String(b.id)));
  let note;
  if (!historyAvailable) note = 'History could not be read when this was exported, so no changes are listed.';
  else if (!events.length) note = 'No changes are recorded for this document.';
  else note = `Changes saved in History. History keeps the last ${HISTORY_RETENTION_DAYS} days.`;
  return {
    format: AUDIT_LOG_FORMAT,
    version: AUDIT_LOG_VERSION,
    exportedAt,
    document: {
      name: document.name || null,
      id: document.id || null,
      sourceSha256: document.sourceSha256 || null,
    },
    coverage: {
      events: events.length,
      from: events[0]?.at || null,
      to: events[events.length - 1]?.at || null,
      historyAvailable,
      retentionDays: HISTORY_RETENTION_DAYS,
      note,
    },
    marks,
    events,
  };
}
