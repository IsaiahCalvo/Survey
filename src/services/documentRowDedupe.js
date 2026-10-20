// src/services/documentRowDedupe.js
//
// KAL-267 content-addressed document identity, as ONE function every path that
// creates a document row goes through (normal upload and, since KAL-443, the
// copy-into-project path): the same bytes (content_sha256) for the same person
// in the same project are ONE document. A matching row — even an archived one,
// which is un-archived — is reused instead of inserting a duplicate.
//
// That includes a row the person moved to Archive (user_archived_at set): the
// unique index below covers those rows too, so a second row cannot be inserted
// beside it. Landing silently on the hidden row would leave the upload / copy
// invisible in Documents, so the row is first restored through restore_document
// — the one restore path, which also clears the purge expiry.
//
// The database enforces the same rule with the unique index
// documents_user_project_sha_uidx (user_id, COALESCE(project_id, nil), sha);
// two near-simultaneous creates can both miss the lookup, and the loser's
// insert then fails with 23505 — a dedupe hit, answered with the winner's row.
//
// Pure: no React, no app singletons. The caller passes its Supabase client.

const findSameContentRow = (supabase, userId, sha, projectId) => {
  let lookup = supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .eq('content_sha256', sha)
    .limit(1);
  lookup = (projectId == null)
    ? lookup.is('project_id', null)
    : lookup.eq('project_id', projectId);
  return lookup.maybeSingle();
};

// Bring a matched row back into Documents: out of the person's Archive (via
// the restore RPC) and off the `archived` flag, as before.
const reviveRow = async (supabase, row) => {
  let current = row;
  if (current.user_archived_at) {
    const { data: restored, error: restoreErr } = await supabase
      .rpc('restore_document', { p_document_id: current.id });
    if (restoreErr) throw restoreErr;
    if (!restored || restored.ok !== true) {
      // 'project_child': the whole project is in Archive - restore it there.
      const error = new Error(restored?.reason === 'project_child'
        ? 'This file is in an archived project. Restore the project from Archive first.'
        : 'This file is in Archive and could not be restored.');
      error.reason = restored?.reason || 'unknown';
      throw error;
    }
    current = {
      ...current,
      user_archived_at: null,
      user_archive_expires_at: null,
      user_archived_by: null,
      archive_group_id: null,
    };
  }
  if (current.archived) {
    const { data: revived, error: reviveErr } = await supabase
      .from('documents')
      .update({ archived: false, updated_at: new Date().toISOString() })
      .eq('id', current.id)
      .select()
      .single();
    if (reviveErr) throw reviveErr;
    return revived;
  }
  return current;
};

/**
 * Create a documents row, or reuse the existing row with the same content in
 * the same project.
 *
 * @param {{
 *   supabase: object,
 *   userId: string,
 *   documentData: object,            // the row; content_sha256 opts into dedupe
 *   provenance?: object,             // stamped under documentData (caller wins)
 *   isNotFoundError?: (error: any) => boolean,
 * }} args
 * @returns {Promise<{ row: object, reused: boolean }>}
 */
export async function createOrReuseDocumentRow({
  supabase,
  userId,
  documentData,
  provenance = {},
  isNotFoundError = () => false,
}) {
  const sha = documentData?.content_sha256;
  const projectId = documentData?.project_id ?? null;
  if (sha) {
    const { data: existing, error: lookupErr } = await findSameContentRow(supabase, userId, sha, projectId);
    if (lookupErr && !isNotFoundError(lookupErr)) throw lookupErr;
    if (existing) return { row: await reviveRow(supabase, existing), reused: true };
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      user_id: userId,
      ...provenance,
      ...documentData,
    })
    .select()
    .single();

  // KAL-267: two near-simultaneous uploads of identical bytes can both pass
  // the SELECT dedup check above; the loser's insert then trips the unique
  // content-hash index (23505). That's a dedup HIT, not a failure — fetch
  // and reuse the winner's row.
  if (error && error.code === '23505' && sha) {
    const { data: winner, error: retryErr } = await findSameContentRow(supabase, userId, sha, projectId);
    if (!retryErr && winner) return { row: await reviveRow(supabase, winner), reused: true };
  }

  if (error) throw error;
  return { row: data, reused: false };
}
