// KAL-48 — Document revision (snapshot) service.
//
// Wraps the four Postgres RPCs that implement first-class revisions:
//   * kal48_create_revision(document_id, label, origin?)
//   * kal48_list_revisions(document_id)
//   * kal48_get_revision(revision_id)
//   * kal48_restore_revision(revision_id)
//
// The shape returned by kal48_list_revisions uses `revision_*` keys to dodge
// an OUT-column naming collision with the underlying table (`created_by`
// shadowed the table column). The wrapper here re-keys those into the natural
// shape callers expect, so the UI doesn't have to know about that workaround.
//
// All functions short-circuit on missing inputs and translate Supabase
// errors into thrown Error objects so callers can `try / catch` instead of
// inspecting `{ data, error }`.

import { supabase } from '../supabaseClient';

function throwIfError(label, error) {
  if (!error) return;
  const err = new Error(`${label}: ${error.message}`);
  err.code = error.code;
  err.details = error.details;
  err.hint = error.hint;
  throw err;
}

/**
 * @param {string} documentId
 * @param {{ label?: string|null, origin?: 'manual'|'sign-off' }} [opts]
 * @returns {Promise<object>} the inserted document_revisions row
 */
export async function createRevision(documentId, opts = {}) {
  if (!documentId) throw new Error('createRevision: documentId required');
  const label = opts.label ?? null;
  const origin = opts.origin || 'manual';
  const { data, error } = await supabase.rpc('kal48_create_revision', {
    p_document_id: documentId,
    p_label: label,
    p_origin: origin,
  });
  throwIfError('createRevision', error);
  return data;
}

/**
 * @param {string} documentId
 * @returns {Promise<Array<{
 *   id: string,
 *   documentId: string,
 *   revisionNumber: number,
 *   label: string|null,
 *   origin: string,
 *   createdBy: string|null,
 *   createdAt: string,
 *   annotationCount: number,
 *   surveyItemCount: number,
 * }>>}
 */
export async function listRevisions(documentId) {
  if (!documentId) return [];
  const { data, error } = await supabase.rpc('kal48_list_revisions', {
    p_document_id: documentId,
  });
  throwIfError('listRevisions', error);
  return (data || []).map((r) => ({
    id: r.revision_id,
    documentId: r.revision_document_id,
    revisionNumber: r.revision_number,
    label: r.revision_label,
    origin: r.revision_origin,
    createdBy: r.revision_created_by,
    createdAt: r.revision_created_at,
    annotationCount: r.revision_annotation_count,
    surveyItemCount: r.revision_survey_item_count,
  }));
}

/**
 * @param {string} revisionId
 * @returns {Promise<object>} document_revisions row including snapshot_json
 */
export async function getRevision(revisionId) {
  if (!revisionId) throw new Error('getRevision: revisionId required');
  const { data, error } = await supabase.rpc('kal48_get_revision', {
    p_revision_id: revisionId,
  });
  throwIfError('getRevision', error);
  return data;
}

/**
 * Restore a prior revision. Owner-only. Creates a NEW auto revision
 * ("Auto: pre-restore of vN") capturing the current live state BEFORE
 * overwriting it with the snapshot. Returns the auto revision so callers can
 * surface it to the user ("Your previous work was saved as v3").
 *
 * @param {string} revisionId
 * @returns {Promise<object>} the auto pre-restore revision row
 */
export async function restoreRevision(revisionId) {
  if (!revisionId) throw new Error('restoreRevision: revisionId required');
  const { data, error } = await supabase.rpc('kal48_restore_revision', {
    p_revision_id: revisionId,
  });
  throwIfError('restoreRevision', error);
  return data;
}

export default {
  createRevision,
  listRevisions,
  getRevision,
  restoreRevision,
};
