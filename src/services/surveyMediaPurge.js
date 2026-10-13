/**
 * surveyMediaPurge.js - "delete forever" plus the clean-up of the document's
 * survey media (photos, videos, recordings).
 *
 * Order: the purge RPC (purge_archived_document / purge_archived_project) runs
 * FIRST. Media is only touched once it has succeeded.
 *
 * Codex review (release PR #811, 2026-10-13, P1): an earlier version removed
 * the media BEFORE the purge so the document's owner could still clear
 * collaborators' uploads. If the purge then failed (timeout, RPC error) the
 * archived document survived with its photos / videos / recordings already
 * gone for good. A purge that fails must leave the document whole.
 *
 * After a successful purge, the survey_media_delete storage policy (uploader
 * OR the document's owner, while the row exists) only lets the caller remove
 * their OWN uploads - the owner half can no longer match. So:
 *   - the caller removes what they uploaded;
 *   - a removal that failed for a retryable reason (offline, storage error)
 *     goes into the caller's retry queue (surveyMediaDeleteQueue) - these are
 *     paths the caller listed after the purge, i.e. their own uploads, which
 *     they can still remove later;
 *   - nothing the caller cannot remove is ever queued (a second Codex P1: other
 *     uploaders' paths queued under the caller were later dropped as
 *     forbidden / invisible). Other uploaders' objects, and anything this pass
 *     missed, are removed by the server sweep: the archive-purge-sweep Edge
 *     Function lists them with list_orphaned_survey_media (media whose
 *     document row no longer exists) and removes them with the service role.
 *
 * A document that still exists after the purge (e.g. restored between the
 * caller reading its row and the RPC running) is never touched: while its row
 * exists the owner could remove every collaborator's upload.
 */
import { getSurveyMediaUserId, removeSurveyMediaForDocument } from './surveyMediaService.js';
import { queueSurveyMediaDeletes } from './surveyMediaDeleteQueue.js';

/**
 * @param {object} args
 * @param {Array<{id}>} args.documents - the rows the purge will delete, read
 *   BEFORE the purge (afterwards they are gone).
 * @param {() => Promise<{success: boolean}>} args.purge - runs the purge RPC.
 * @param {(ids: string[]) => Promise<Set<string>>} [args.findSurvivingDocuments]
 *   - which of these ids still have a document row after the purge. Throwing
 *   skips the media pass (the server sweep only takes media of documents that
 *   are really gone). Omitted: every row is taken as purged.
 * @param {string|null} [args.userId] - the caller (defaults to the session user).
 * @returns the purge result, plus `media: { removed, queued }` on success.
 */
export async function purgeWithSurveyMedia({ documents = [], purge, findSurvivingDocuments = null, userId = null } = {}) {
  const result = await purge();
  if (!result?.success) return result;

  let rows = (documents || []).filter((row) => row?.id);
  if (rows.length > 0 && typeof findSurvivingDocuments === 'function') {
    try {
      const surviving = await findSurvivingDocuments(rows.map((row) => row.id));
      rows = rows.filter((row) => !surviving?.has?.(row.id));
    } catch (err) {
      console.warn('[survey media] could not confirm the purge; media left to the server sweep:', err);
      return { ...result, media: { removed: 0, queued: 0 } };
    }
  }

  let removed = 0;
  const retry = [];
  for (const row of rows) {
    // Lists only what this user can still see: their own uploads.
    const outcome = await removeSurveyMediaForDocument(row.id);
    removed += outcome.removed || 0;
    // Only retryable failures. A 'forbidden' path is not this user's to remove.
    for (const entry of outcome.outcome?.failed || []) if (entry?.path) retry.push(entry.path);
  }

  let queued = 0;
  if (retry.length > 0) {
    const uid = userId || await getSurveyMediaUserId();
    if (uid) {
      queueSurveyMediaDeletes(uid, retry, { code: 'purge-leftover' });
      queued = retry.length;
    }
  }
  return { ...result, media: { removed, queued } };
}

/**
 * `findSurvivingDocuments` for purgeWithSurveyMedia, backed by a Supabase
 * client: the ids that still have a `documents` row. Throws on a query error.
 */
export function survivingDocumentsFinder(client) {
  return async (ids) => {
    const { data, error } = await client.from('documents').select('id').in('id', ids);
    if (error) throw error;
    return new Set((data || []).map((row) => row.id));
  };
}
