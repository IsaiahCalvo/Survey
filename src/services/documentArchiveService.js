/**
 * KAL-428 — archive, restore and permanent-delete operations for ONE document.
 *
 * Ownership is enforced in the database, not here: every call goes through a
 * SECURITY DEFINER RPC from 20260802000000_kal426_user_archive_foundation.sql
 * that asserts `documents.user_id = auth.uid()`. Editors, viewers and
 * collaborator-'owner's therefore fail even if they bypass the screen and call
 * the RPC directly. The checks below are only for a fast, friendly message.
 *
 * Archiving keeps the PDF, every markup, the history, the collaboration record
 * and both the cloud and local references untouched for 30 days — the operation
 * writes nothing but the four user-Archive columns.
 */

import { supabase } from '../supabaseClient';
import { pdfByteCache } from './pdfByteCache.js';
import { purgeAnnotationDoc } from './annotationDocSync';
import { normalizeDocumentItem } from './archiveContract';
import { removeSurveyMediaForDocument } from './surveyMediaService.js';

// file_size and page_count feed the Archive preview pane, which mirrors the
// Documents ledger's preview: you should be able to tell WHICH file you are
// about to restore or destroy without leaving Archive.
const DOCUMENT_ARCHIVE_COLUMNS =
  'id, user_id, name, project_id, file_path, file_size, page_count, user_archived_at, user_archive_expires_at, user_archived_by, archive_group_id';

/** Turn an RPC `reason` into copy the hub can show verbatim. */
function messageForReason(reason, noun = 'document') {
  switch (reason) {
    case 'not_found':
      return `That ${noun} no longer exists.`;
    case 'not_owner':
      return `Only the owner of this ${noun} can do that.`;
    case 'not_archived':
      return `That ${noun} is not in Archive.`;
    case 'project_child':
      return 'This document is part of an archived project. Restore the project instead.';
    default:
      return `The ${noun} could not be updated.`;
  }
}

/**
 * Shared RPC wrapper. Never throws — the hub renders whatever comes back, and a
 * transport failure has to read the same as a refusal.
 */
async function callArchiveRpc(fn, args, noun) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[KAL-428] ${fn} failed:`, error);
    return { success: false, error: error.message };
  }
  if (!data || data.ok !== true) {
    const reason = data?.reason || 'unknown';
    return { success: false, reason, error: messageForReason(reason, noun) };
  }
  return { success: true, data };
}

/**
 * Move one document into the owner's Archive for 30 days.
 * Idempotent: archiving an already-archived document reports success and leaves
 * the original expiry alone rather than silently extending it.
 */
export async function archiveDocument(documentId) {
  if (!documentId) return { success: false, error: 'No document selected.' };
  return callArchiveRpc('archive_document', { p_document_id: documentId }, 'document');
}

/**
 * Return one document to the project it came from.
 * `project_id` was never cleared, so restore is purely a matter of clearing the
 * user-Archive columns. The plan-limit `archived` flag is deliberately not
 * touched — a document archived by a Free-tier downgrade must stay that way.
 */
export async function restoreDocument(documentId) {
  if (!documentId) return { success: false, error: 'No document selected.' };
  return callArchiveRpc('restore_document', { p_document_id: documentId }, 'document');
}

/**
 * Delete one archived document forever.
 *
 * Order matters and mirrors the proven full-delete path: the database row goes
 * first (ON DELETE CASCADE clears marks, history, snapshots, revisions, invites,
 * collaborators, presence and the Excel-sync tables), then the stored PDF, then
 * the local durable copy. Storage is content-addressed and shared between
 * duplicate uploads, so the RPC reports which paths no surviving document row
 * references and only those are unlinked — matching the existing rule that an
 * object we cannot PROVE is unshared is kept.
 *
 * Both follow-up steps are best-effort: the row is already gone, so a storage or
 * IndexedDB hiccup must not report the delete as failed.
 */
export async function deleteDocumentForever(documentId) {
  if (!documentId) return { success: false, error: 'No document selected.' };

  const result = await callArchiveRpc('purge_archived_document', { p_document_id: documentId }, 'document');
  if (!result.success) return result;

  const orphanedPaths = result.data?.orphaned_paths || [];
  if (orphanedPaths.length > 0) {
    try {
      const { error } = await supabase.storage.from('documents').remove(orphanedPaths);
      if (error) console.warn('[KAL-428] stored PDF not removed:', error);
    } catch (err) {
      console.warn('[KAL-428] stored PDF removal threw:', err);
    }
  }
  // w36: this device's cached copy of a file nobody references any more.
  for (const path of orphanedPaths) void pdfByteCache().removePath(path);

  // Survey media (best-effort, never throws): removes what this user uploaded;
  // anything else is swept server-side (list_orphaned_survey_media).
  await removeSurveyMediaForDocument(documentId);

  try {
    await purgeAnnotationDoc(documentId);
  } catch (err) {
    console.warn('[KAL-428] local durable copy not purged:', err);
  }

  return { success: true, data: result.data };
}

/**
 * Every document currently in the owner's Archive, as normalized items.
 * Rows carrying an archive_group_id belong to an archived project and are
 * returned as-is — buildArchiveItems() folds them into their project group.
 */
export async function listArchivedDocuments(userId, { projectNamesById = {}, now = Date.now() } = {}) {
  if (!userId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('documents')
    .select(DOCUMENT_ARCHIVE_COLUMNS)
    .eq('user_id', userId)
    .not('user_archived_at', 'is', null)
    .order('user_archived_at', { ascending: false });

  if (error) {
    console.error('[KAL-428] listArchivedDocuments failed:', error);
    return { data: [], error };
  }

  const rows = data || [];
  return {
    rows,
    data: rows.map((row) => normalizeDocumentItem(row, {
      projectName: row.project_id ? (projectNamesById[row.project_id] || null) : null,
      now,
    })),
    error: null,
  };
}
