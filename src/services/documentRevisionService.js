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

import { supabase, isSupabaseAvailable } from '../supabaseClient';
import { upsertFabricAnnotation } from './annotationCloudSync.js';

function requireCloudRevisions(label) {
  if (!isSupabaseAvailable()) {
    throw new Error(`${label}: cloud revisions unavailable`);
  }
}

function throwIfError(label, error) {
  if (!error) return;
  const err = new Error(`${label}: ${error.message}`);
  err.code = error.code;
  err.details = error.details;
  err.hint = error.hint;
  throw err;
}

/**
 * Push the live canvas into `document_annotations` so `kal48_create_revision`
 * snapshots the marks the user actually sees (Y.Doc / WAL), not an empty
 * legacy table.
 *
 * @param {string} documentId
 * @param {Record<string|number, { objects?: object[] }>} annotationsByPage
 * @param {string} userId
 * @returns {Promise<number>} number of objects flushed
 */
export async function flushLiveAnnotationsForRevision(documentId, annotationsByPage, userId) {
  if (!documentId) throw new Error('flushLiveAnnotationsForRevision: documentId required');
  requireCloudRevisions('flushLiveAnnotationsForRevision');
  if (!userId) throw new Error('flushLiveAnnotationsForRevision: userId required');
  let flushed = 0;
  for (const [pageKey, page] of Object.entries(annotationsByPage || {})) {
    const pageNumber = Number.parseInt(pageKey, 10);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) continue;
    for (const obj of page?.objects || []) {
      if (!obj) continue;
      const { error } = await upsertFabricAnnotation(obj, {
        documentId,
        userId,
        pageNumber,
      });
      throwIfError('flushLiveAnnotationsForRevision', error);
      flushed += 1;
    }
  }
  return flushed;
}

/**
 * @param {string} documentId
 * @param {{ label?: string|null, origin?: 'manual'|'sign-off' }} [opts]
 * @returns {Promise<object>} the inserted document_revisions row
 */
export async function createRevision(documentId, opts = {}) {
  if (!documentId) throw new Error('createRevision: documentId required');
  requireCloudRevisions('createRevision');
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
  if (!documentId || !isSupabaseAvailable()) return [];
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
  requireCloudRevisions('getRevision');
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
  requireCloudRevisions('restoreRevision');
  const { data, error } = await supabase.rpc('kal48_restore_revision', {
    p_revision_id: revisionId,
  });
  throwIfError('restoreRevision', error);
  return data;
}

