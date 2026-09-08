/**
 * KAL-429 — archive, restore and permanent-delete operations for a WHOLE project.
 *
 * A project and everything inside it is one recoverable Archive item. The
 * project row and each of its documents share one `archive_group_id` and one
 * 30-day expiry, written by a single SECURITY DEFINER RPC so the operation is
 * all-or-nothing: there is no window in which the project is archived but its
 * documents are not.
 *
 * The project action also ADOPTS any document the user had already archived on
 * its own — that document is reset into the project group and picks up the
 * project's fresh expiry, so it stops being separately restorable and comes back
 * with the project instead.
 *
 * Ownership is enforced in the database (`projects.user_id = auth.uid()`), so a
 * collaborator whose role is 'owner' still cannot archive, restore or delete.
 */

import { supabase } from '../supabaseClient';
import { purgeAnnotationDoc } from './annotationDocSync';
import { normalizeProjectItem } from './archiveContract';

const PROJECT_ARCHIVE_COLUMNS =
  'id, user_id, name, user_archived_at, user_archive_expires_at, user_archived_by, archive_group_id';

function messageForReason(reason) {
  switch (reason) {
    case 'not_found':
      return 'That project no longer exists.';
    case 'not_owner':
      return 'Only the owner of this project can do that.';
    case 'not_archived':
      return 'That project is not in Archive.';
    default:
      return 'The project could not be updated.';
  }
}

async function callArchiveRpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[KAL-429] ${fn} failed:`, error);
    return { success: false, error: error.message };
  }
  if (!data || data.ok !== true) {
    const reason = data?.reason || 'unknown';
    return { success: false, reason, error: messageForReason(reason) };
  }
  return { success: true, data };
}

/**
 * Archive the project and every document in it as one group.
 * Idempotent: a repeated call reports the existing group and expiry instead of
 * re-stamping a new 30-day window.
 */
export async function archiveProject(projectId) {
  if (!projectId) return { success: false, error: 'No project selected.' };
  return callArchiveRpc('archive_project', { p_project_id: projectId });
}

/**
 * One action returns the project, every grouped document and all their markups.
 * Collaborator rows and roles were never touched while archived, so prior access
 * comes back on its own the moment the archive columns clear.
 */
export async function restoreProject(projectId) {
  if (!projectId) return { success: false, error: 'No project selected.' };
  return callArchiveRpc('restore_project', { p_project_id: projectId });
}

/**
 * Delete an archived project and every grouped child forever.
 *
 * The RPC removes the documents and the project in one transaction (cascade
 * clears every child table) and reports the stored PDF paths that no surviving
 * document row still references. Only those are unlinked — a path shared with a
 * duplicate upload elsewhere in the account is kept.
 */
export async function deleteProjectForever(projectId) {
  if (!projectId) return { success: false, error: 'No project selected.' };

  const result = await callArchiveRpc('purge_archived_project', { p_project_id: projectId });
  if (!result.success) return result;

  const orphanedPaths = result.data?.orphaned_paths || [];
  if (orphanedPaths.length > 0) {
    try {
      const { error } = await supabase.storage.from('documents').remove(orphanedPaths);
      if (error) console.warn('[KAL-429] stored PDFs not removed:', error);
    } catch (err) {
      console.warn('[KAL-429] stored PDF removal threw:', err);
    }
  }

  // The transaction can detach surviving foreign-owned documents. Only its
  // DELETE RETURNING receipt authorizes clearing their local durable state.
  // Old servers or malformed receipts must keep local copies, not infer IDs.
  const deletedIds = result.data?.deleted_document_ids;
  const validReceipt = Array.isArray(deletedIds) && deletedIds.every(id => typeof id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  let localCleanupDeferred = !validReceipt;
  if (!validReceipt) console.warn('[KAL-429] local durable copies kept: missing or invalid deletion receipt');
  const childIds = validReceipt ? [...new Set(deletedIds)] : [];
  // A local-cache hiccup must not report the committed project delete as failed.
  for (const childId of childIds) {
    try {
      await purgeAnnotationDoc(childId);
    } catch (err) {
      localCleanupDeferred = true;
      console.warn('[KAL-429] local durable copy not purged:', childId, err);
    }
  }

  return { success: true, data: result.data, ...(localCleanupDeferred ? { localCleanupDeferred: true } : {}) };
}

/**
 * Every project currently in the owner's Archive, as normalized items with
 * their descriptive child documents attached.
 */
export async function listArchivedProjects(userId, { documentRows = null, now = Date.now() } = {}) {
  if (!userId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_ARCHIVE_COLUMNS)
    .eq('user_id', userId)
    .not('user_archived_at', 'is', null)
    .order('user_archived_at', { ascending: false });

  if (error) {
    console.error('[KAL-429] listArchivedProjects failed:', error);
    return { data: [], error };
  }

  const projects = data || [];

  // Callers that already hold the archived-document rows pass them in so the
  // Archive screen resolves in one round of queries instead of two per project.
  let children = documentRows;
  if (!children) {
    const groupIds = projects.map((project) => project.archive_group_id).filter(Boolean);
    if (groupIds.length === 0) children = [];
    else {
      const { data: childData, error: childError } = await supabase
        .from('documents')
        // Keep in step with the documents select in archiveService.loadArchive —
        // that query duplicates this column list. file_path is what lets an
        // expanded project's child rows render their real page thumbnail, and
        // the two user_archive_* columns fill their Archived / Days remaining
        // cells; drop either and the child row silently shows a placeholder.
        .select('id, name, project_id, file_path, file_size, archive_group_id, user_archived_at, user_archive_expires_at')
        .in('archive_group_id', groupIds);
      if (childError) {
        console.error('[KAL-429] archived project children failed:', childError);
        return { data: [], error: childError };
      }
      children = childData || [];
    }
  }

  const byGroup = new Map();
  for (const child of children) {
    if (!child.archive_group_id) continue;
    if (!byGroup.has(child.archive_group_id)) byGroup.set(child.archive_group_id, []);
    byGroup.get(child.archive_group_id).push(child);
  }

  return {
    rows: projects,
    data: projects.map((project) => normalizeProjectItem(
      project,
      byGroup.get(project.archive_group_id) || [],
      { now },
    )),
    error: null,
  };
}
