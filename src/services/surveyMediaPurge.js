/**
 * surveyMediaPurge.js - "delete forever" with the document's survey media
 * removed while it can still be removed.
 *
 * Codex review (release PR, 2026-10-13): the media clean-up used to run AFTER
 * purge_archived_document / purge_archived_project had deleted the document
 * row. The survey_media_delete storage policy lets the uploader OR the
 * document's owner remove an object; once the row is gone the owner half can
 * never match, so the owner could only remove their own uploads and every
 * collaborator's photo / video / recording stayed stored, charged to that
 * collaborator's quota until a server sweep.
 *
 * Now, for each document the caller owns and has archived (exactly what the
 * purge RPC will delete for them), every media object is removed FIRST, then
 * the purge runs. A path that could not be removed is put in the caller's
 * retry queue (surveyMediaDeleteQueue) once the purge has succeeded - after
 * the purge only the caller's own uploads are still removable by them;
 * anything else is left to the server's orphan sweep
 * (list_orphaned_survey_media). If the purge itself fails, the document stays
 * and nothing is queued (a later "delete forever" runs this again).
 *
 * Documents the caller does not own (or that are not archived) get no
 * pre-purge pass: their media must not be touched before the RPC has decided.
 * After a successful purge they get the old pass (the caller's own uploads).
 */
import { getSurveyMediaUserId, removeSurveyMediaForDocument } from './surveyMediaService.js';
import { queueSurveyMediaDeletes } from './surveyMediaDeleteQueue.js';

/**
 * @param {object} args
 * @param {Array<{id, user_id, user_archived_at}>} args.documents - the rows the
 *   purge will delete, read BEFORE the purge (owner + archive state decide
 *   whether the media may be removed first).
 * @param {() => Promise<{success: boolean}>} args.purge - runs the purge RPC.
 * @param {string|null} [args.userId] - the caller (defaults to the session user).
 * @returns the purge result, plus `media: { removed, queued }`.
 */
export async function purgeWithSurveyMedia({ documents = [], purge, userId = null } = {}) {
  const uid = userId || await getSurveyMediaUserId();
  const rows = (documents || []).filter((row) => row?.id);
  const ownedArchived = rows.filter((row) => uid && row.user_id === uid && row.user_archived_at);
  const prePassed = new Set();
  const leftover = [];
  let removed = 0;

  for (const row of ownedArchived) {
    const outcome = await removeSurveyMediaForDocument(row.id);
    if (outcome.error) continue; // could not list: the post-purge pass tries again
    prePassed.add(row.id);
    removed += outcome.removed || 0;
    leftover.push(...(outcome.leftover || []));
  }

  const result = await purge();
  if (!result?.success) return result;

  // Rows not cleared before the purge: remove what this user uploaded (the
  // only media they can still remove once the row is gone).
  for (const row of rows) {
    if (prePassed.has(row.id)) continue;
    const outcome = await removeSurveyMediaForDocument(row.id);
    removed += outcome.removed || 0;
    leftover.push(...(outcome.leftover || []));
  }

  let queued = 0;
  if (leftover.length > 0 && uid) {
    // Some of these may now be impossible for this user to remove (another
    // editor's upload in a document that no longer exists): the retry then
    // finds them invisible / not allowed and drops them; the server's orphan
    // sweep owns them from there.
    queueSurveyMediaDeletes(uid, leftover, { code: 'purge-leftover' });
    queued = leftover.length;
  }
  return { ...result, media: { removed, queued } };
}
