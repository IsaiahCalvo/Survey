/**
 * KAL-427 — archive, restore and permanent-delete operations for a template.
 *
 * A template is recoverable as ONE complete object, never a partial shell. Every
 * entity, category, checklist item, setting and ordering choice lives inside the
 * `templates.config` JSONB blob, and the sharing records and invites live in
 * `template_collaborators` / `template_invites`. Archiving therefore writes only
 * the four user-Archive columns and touches nothing else, which is what makes
 * the archive→restore round trip lossless by construction.
 *
 * The per-checklist-item `archived` flag inside `config` is a completely
 * different, older feature (an author hiding one line item). It is never read or
 * written here, and restoring a template must leave it exactly as it was.
 *
 * Ownership is enforced in the database (`templates.user_id = auth.uid()`).
 */

import { supabase } from '../supabaseClient';
import { normalizeTemplateItem } from './archiveContract';

const TEMPLATE_ARCHIVE_COLUMNS =
  'id, user_id, name, user_archived_at, user_archive_expires_at, user_archived_by, archive_group_id';

function messageForReason(reason) {
  switch (reason) {
    case 'not_found':
      return 'That template no longer exists.';
    case 'not_owner':
      return 'Only the owner of this template can do that.';
    case 'not_archived':
      return 'That template is not in Archive.';
    default:
      return 'The template could not be updated.';
  }
}

async function callArchiveRpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[KAL-427] ${fn} failed:`, error);
    return { success: false, error: error.message };
  }
  if (!data || data.ok !== true) {
    const reason = data?.reason || 'unknown';
    return { success: false, reason, error: messageForReason(reason) };
  }
  return { success: true, data };
}

/**
 * Move a template into the owner's Archive for 30 days.
 * While archived it disappears for collaborators — the access helper returns
 * false for everyone except the permanent owner — but their rows stay stored.
 * Idempotent: a repeated call keeps the original expiry.
 */
export async function archiveTemplate(templateId) {
  if (!templateId) return { success: false, error: 'No template selected.' };
  return callArchiveRpc('archive_template', { p_template_id: templateId });
}

/**
 * Return the template exactly as it was, including prior collaborators and
 * their roles. Clears only the user-Archive columns.
 */
export async function restoreTemplate(templateId) {
  if (!templateId) return { success: false, error: 'No template selected.' };
  return callArchiveRpc('restore_template', { p_template_id: templateId });
}

/**
 * Delete an archived template and its owned child records forever.
 * The calling screen is responsible for confirming first (KAL-280 copy).
 * Templates own no stored files, so there is no storage step here.
 */
export async function deleteTemplateForever(templateId) {
  if (!templateId) return { success: false, error: 'No template selected.' };
  return callArchiveRpc('purge_archived_template', { p_template_id: templateId });
}

/** Every template currently in the owner's Archive, as normalized items. */
export async function listArchivedTemplates(userId, { now = Date.now() } = {}) {
  if (!userId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('templates')
    .select(TEMPLATE_ARCHIVE_COLUMNS)
    .eq('user_id', userId)
    .not('user_archived_at', 'is', null)
    .order('user_archived_at', { ascending: false });

  if (error) {
    console.error('[KAL-427] listArchivedTemplates failed:', error);
    return { data: [], error };
  }

  const rows = data || [];
  return {
    rows,
    data: rows.map((row) => normalizeTemplateItem(row, { now })),
    error: null,
  };
}
