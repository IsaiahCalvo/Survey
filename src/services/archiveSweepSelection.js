// src/services/archiveSweepSelection.js — KAL-431.
//
// The 30-day Archive auto-cleanup decides WHICH archived rows are due for a
// permanent purge. That decision is the dangerous part of the job (it deletes
// user data), so it lives here as pure, unit-testable code rather than only as
// SQL buried inside a cron function.
//
// This module is the executable specification of the selection rules that
// `public.sweep_expired_archives()` implements in
// supabase/migrations/20260811000000_kal431_archive_purge_sweep.sql.
// tests/archiveSweepSelection.test.mjs pins the rules; the Postgres harness at
// scripts/test-archive-purge-sweep-postgres.mjs proves the SQL agrees with them
// against a real database and the real purge RPCs.
//
// UX intent: a user who deletes something gets a full retention window to change
// their mind, and NEVER loses a document that still belongs to something they
// can still see. Everything below is biased toward keeping data: when a row is
// ambiguous we skip it (and say why) rather than delete it.

/** Order matters: projects purge first so their children go with them. */
export const SWEEP_KINDS = Object.freeze(['project', 'document', 'template']);

/**
 * Why an expired row was deliberately NOT purged this run. These strings are
 * surfaced in the run log so an operator can tell "nothing was due" apart from
 * "something was due but we refused to touch it".
 */
export const SKIP_REASONS = Object.freeze({
  /** Child of an archived project: the project's purge takes it as one group. */
  DEFERRED_TO_PROJECT_GROUP: 'deferred_to_project_group',
  /**
   * Some project row is still this document's parent. We defer for ANY surviving
   * parent, not just a live one: an archived project whose archive_group_id was
   * lost (a hand-run backfill on the hand-managed production DB) would otherwise
   * let its children purge individually and leave the project standing empty.
   */
  PARENT_PROJECT_SURVIVES: 'parent_project_survives',
  /**
   * The project still contains a NON-archived document. KAL-426's
   * purge_archived_project deletes children by project_id with no owner or
   * archived filter, so purging would destroy a live document — possibly a
   * collaborator's. Held back rather than risked.
   */
  PROJECT_HOLDS_LIVE_DOCUMENT: 'project_holds_live_document',
  /** Repeated purge failures: quarantined so it cannot starve healthy rows. */
  QUARANTINED: 'quarantined_after_repeated_failure',
  /** Due, allowed, but past this run's batch cap. The next run picks it up. */
  OVER_BATCH_LIMIT: 'over_batch_limit',
});

export const DEFAULT_BATCH_LIMIT = 50;
export const MAX_BATCH_LIMIT = 500;
/** Failed attempts before an item is quarantined out of selection. */
export const MAX_PURGE_ATTEMPTS = 5;

const toTime = (value) => {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * A row is expired when it is genuinely archived AND its retention window has
 * closed. Both columns are required: the purge RPCs refuse a row that is not
 * archived ('not_archived'), and a NULL expiry means "no window recorded", which
 * we treat as never-due rather than immediately-due.
 */
const isExpired = (row, nowMs) => {
  if (!row) return false;
  if (toTime(row.user_archived_at) === null) return false;
  const expires = toTime(row.user_archive_expires_at);
  return expires !== null && expires <= nowMs;
};

/**
 * Clamp an operator-supplied batch size. A sweep must always be bounded so one
 * bad row cannot wedge the job forever and a huge backlog cannot blow up a
 * single transaction — the next run continues where this one stopped.
 */
export function normalizeBatchLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_BATCH_LIMIT;
  return Math.min(Math.floor(n), MAX_BATCH_LIMIT);
}

/**
 * Decide what a single sweep run should purge.
 *
 * @param {object} input
 * @param {Date|string|number} input.now              Run timestamp.
 * @param {Array}  [input.projects]                   Archived-or-live project rows.
 * @param {Array}  [input.documents]                  Archived-or-live document rows.
 * @param {Array}  [input.templates]                  Archived-or-live template rows.
 * @param {number} [input.limit]                      Max items to purge this run.
 * @param {Array}  [input.failures]                   Rows of archive_purge_failures:
 *                                                    {kind, item_id, attempts}.
 * @returns {{due: Array, skipped: Array, limit: number, expiredCount: number}}
 */
export function selectDueArchiveItems({
  now,
  projects = [],
  documents = [],
  templates = [],
  failures = [],
  limit = DEFAULT_BATCH_LIMIT,
} = {}) {
  const nowMs = toTime(now) ?? Date.now();
  const batchLimit = normalizeBatchLimit(limit);

  const skipped = [];

  // Archive groups that an existing project row still owns. `archive_project`
  // stamps the project and every child document with the SAME archive_group_id
  // and the SAME expiry, so children look individually due — but purging one
  // directly would delete it while leaving the project row behind. The project's
  // own purge removes all of them atomically, so children defer to it.
  const projectGroupIds = new Set(
    projects.map((p) => p?.archive_group_id).filter(Boolean),
  );

  // ANY surviving project row protects its children — see PARENT_PROJECT_SURVIVES.
  const survivingProjectIds = new Set(projects.map((p) => p?.id).filter(Boolean));

  // Projects still holding a non-archived document cannot be purged safely.
  const projectsWithLiveDocs = new Set(
    documents
      .filter((d) => d?.project_id && toTime(d.user_archived_at) === null)
      .map((d) => d.project_id),
  );

  const quarantined = new Set(
    failures
      .filter((f) => Number(f?.attempts) >= MAX_PURGE_ATTEMPTS)
      .map((f) => `${f.kind}:${f.item_id}`),
  );

  const candidate = (kind, row) => ({
    kind,
    id: row.id,
    ownerId: row.user_id ?? null,
    expiresAt: row.user_archive_expires_at ?? null,
    expiresAtMs: toTime(row.user_archive_expires_at),
  });

  const eligible = [];

  /** Quarantine applies to every kind, so it is checked in one place. */
  const isQuarantined = (kind, id) => quarantined.has(`${kind}:${id}`);

  for (const project of projects) {
    if (!isExpired(project, nowMs)) continue;
    const item = candidate('project', project);

    if (projectsWithLiveDocs.has(project.id)) {
      skipped.push({ ...item, reason: SKIP_REASONS.PROJECT_HOLDS_LIVE_DOCUMENT });
      continue;
    }
    if (isQuarantined('project', project.id)) {
      skipped.push({ ...item, reason: SKIP_REASONS.QUARANTINED });
      continue;
    }
    eligible.push(item);
  }

  for (const doc of documents) {
    if (!isExpired(doc, nowMs)) continue;
    const item = candidate('document', doc);

    if (doc.archive_group_id && projectGroupIds.has(doc.archive_group_id)) {
      skipped.push({ ...item, reason: SKIP_REASONS.DEFERRED_TO_PROJECT_GROUP });
      continue;
    }
    if (doc.project_id && survivingProjectIds.has(doc.project_id)) {
      skipped.push({ ...item, reason: SKIP_REASONS.PARENT_PROJECT_SURVIVES });
      continue;
    }
    if (isQuarantined('document', doc.id)) {
      skipped.push({ ...item, reason: SKIP_REASONS.QUARANTINED });
      continue;
    }
    eligible.push(item);
  }

  for (const template of templates) {
    if (!isExpired(template, nowMs)) continue;
    const item = candidate('template', template);
    if (isQuarantined('template', template.id)) {
      skipped.push({ ...item, reason: SKIP_REASONS.QUARANTINED });
      continue;
    }
    eligible.push(item);
  }

  // Oldest expiry first so a backlog drains deterministically and no row can be
  // starved by newer arrivals. Kind is the tie-break: projects before documents
  // before templates, matching the order the SQL purges them in.
  const kindRank = (kind) => SWEEP_KINDS.indexOf(kind);
  eligible.sort(
    (a, b) =>
      (a.expiresAtMs ?? 0) - (b.expiresAtMs ?? 0) ||
      kindRank(a.kind) - kindRank(b.kind) ||
      String(a.id).localeCompare(String(b.id)),
  );

  const due = eligible.slice(0, batchLimit);
  for (const overflow of eligible.slice(batchLimit)) {
    skipped.push({ ...overflow, reason: SKIP_REASONS.OVER_BATCH_LIMIT });
  }

  return {
    due,
    skipped,
    limit: batchLimit,
    expiredCount: eligible.length + skipped.filter((s) => s.reason !== SKIP_REASONS.OVER_BATCH_LIMIT).length,
  };
}

/** Human-readable one-liner for the run log / edge-function output. */
export function summarizeSweepSelection(selection) {
  const counts = { project: 0, document: 0, template: 0 };
  for (const item of selection.due) counts[item.kind] += 1;
  return (
    `due=${selection.due.length} (projects=${counts.project} documents=${counts.document} ` +
    `templates=${counts.template}) skipped=${selection.skipped.length} limit=${selection.limit}`
  );
}
