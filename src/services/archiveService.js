/**
 * The Archive screen's single entry point (KAL-426/427/428/429).
 *
 * The screen never talks to Supabase: it receives normalized Archive items and
 * calls `restoreArchiveItems` / `deleteArchiveItemsForever`. This module fans a
 * bulk selection out to the per-type services and reports, per item, what
 * succeeded and what did not — so a partial failure can be named in the toast
 * instead of collapsing into one "something went wrong".
 */

import { supabase } from '../supabaseClient';
import { buildArchiveItems } from './archiveContract';
import { runArchiveBulk } from './archiveBulk';
import { archiveDocument, restoreDocument, deleteDocumentForever } from './documentArchiveService';
import { archiveProject, restoreProject, deleteProjectForever } from './projectArchiveService';
import { archiveTemplate, restoreTemplate, deleteTemplateForever } from './templateArchiveService';

const RESTORE_BY_TYPE = {
  document: restoreDocument,
  project: restoreProject,
  template: restoreTemplate,
};

const DELETE_BY_TYPE = {
  document: deleteDocumentForever,
  project: deleteProjectForever,
  template: deleteTemplateForever,
};

const ARCHIVE_BY_TYPE = {
  document: archiveDocument,
  project: archiveProject,
  template: archiveTemplate,
};

/**
 * Load everything in the signed-in owner's Archive.
 *
 * All three reads are owner-scoped and run concurrently. Project children are
 * matched to their project by archive_group_id inside buildArchiveItems(), so a
 * document belonging to an archived project never also appears at top level.
 */
export async function loadArchive(userId, { now = Date.now() } = {}) {
  if (!userId) return { data: [], error: null };

  const [documentsRes, projectsRes, templatesRes, projectNamesRes] = await Promise.all([
    supabase
      .from('documents')
      // Keep in step with DOCUMENT_ARCHIVE_COLUMNS in documentArchiveService.js
      // and with the child-document select in projectArchiveService.js —
      // file_size and page_count feed the preview pane, and file_path is what
      // both the preview and a project's child rows render their page from.
      .select('id, user_id, name, project_id, file_path, file_size, page_count, user_archived_at, user_archive_expires_at, archive_group_id')
      .eq('user_id', userId)
      .not('user_archived_at', 'is', null),
    supabase
      .from('projects')
      .select('id, user_id, name, user_archived_at, user_archive_expires_at, archive_group_id')
      .eq('user_id', userId)
      .not('user_archived_at', 'is', null),
    supabase
      .from('templates')
      .select('id, user_id, name, user_archived_at, user_archive_expires_at, archive_group_id')
      .eq('user_id', userId)
      .not('user_archived_at', 'is', null),
    // Names for the "original project" column on a standalone archived document.
    // The project itself is usually still live, so this is a separate read.
    supabase.from('projects').select('id, name').eq('user_id', userId),
  ]);

  const firstError = documentsRes.error || projectsRes.error || templatesRes.error;
  if (firstError) {
    console.error('[KAL-426] loadArchive failed:', firstError);
    return { data: [], error: firstError };
  }

  const projectNamesById = {};
  for (const row of projectNamesRes.data || []) projectNamesById[row.id] = row.name;

  const items = buildArchiveItems({
    documents: documentsRes.data || [],
    projects: projectsRes.data || [],
    templates: templatesRes.data || [],
    projectNamesById,
    now,
  });

  return { data: await withCollaborators(items), error: null };
}

/**
 * Attach the people an archived item is shared with.
 *
 * The preview pane shows these as avatar glyphs so the user can see, before
 * they restore or destroy something, that it was not theirs alone. Only real
 * `status = 'active'` rows are attached — the pane deliberately shows nothing
 * for a solo item rather than inventing a "team of one" out of the owner.
 *
 * Two bulk reads (one per table) for the whole Archive, and a failure degrades
 * to no glyphs: collaborators are context, never a reason to fail the screen.
 */
async function withCollaborators(items) {
  const documentIds = items.filter((i) => i.type === 'document').map((i) => i.id);
  const projectIds = items.filter((i) => i.type === 'project').map((i) => i.id);
  if (!documentIds.length && !projectIds.length) return items;

  const [documentRes, projectRes] = await Promise.all([
    documentIds.length
      ? supabase.from('document_collaborators')
        .select('document_id, user_id, email, role')
        .in('document_id', documentIds)
        .eq('status', 'active')
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from('project_collaborators')
        .select('project_id, user_id, email, role')
        .in('project_id', projectIds)
        .eq('status', 'active')
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (documentRes.error) console.warn('[KAL-426] archive document collaborators failed:', documentRes.error);
  if (projectRes.error) console.warn('[KAL-426] archive project collaborators failed:', projectRes.error);

  const byItemId = new Map();
  const collect = (rows, key) => {
    for (const row of rows || []) {
      const id = row[key];
      if (!byItemId.has(id)) byItemId.set(id, []);
      byItemId.get(id).push({
        id: row.user_id,
        // The collaborator row stores the invited email; the hub shows the
        // local part as a name everywhere else (ProjectsFolderTree does the
        // same), because the private auth.users schema cannot be joined here.
        name: (row.email || '').split('@')[0] || 'Teammate',
        email: row.email || '',
        role: String(row.role || 'viewer').toLowerCase(),
      });
    }
  };
  collect(documentRes.data, 'document_id');
  collect(projectRes.data, 'project_id');

  return items.map((item) => (
    byItemId.has(item.id) ? { ...item, collaborators: byItemId.get(item.id) } : item
  ));
}

/** Restore a selection of top-level Archive items. */
export function restoreArchiveItems(items) {
  return runArchiveBulk(items, RESTORE_BY_TYPE, 'restored');
}

/** Permanently delete a selection of Archive items. Always confirmed first. */
export function deleteArchiveItemsForever(items) {
  return runArchiveBulk(items, DELETE_BY_TYPE, 'deleted');
}

/**
 * Move a selection INTO the Archive. Not wired to the hub's delete buttons yet —
 * that swap is KAL-432 — but the operation is complete and owner-enforced, and
 * the Archive screen's own verification path uses it.
 */
export function archiveItems(items) {
  return runArchiveBulk(items, ARCHIVE_BY_TYPE, 'archived');
}
