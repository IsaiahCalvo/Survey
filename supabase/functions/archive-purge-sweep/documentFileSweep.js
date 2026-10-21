// supabase/functions/archive-purge-sweep/documentFileSweep.js
//
// Removes stored PDFs (`documents` bucket) that no document or template row
// points at: an upload whose row insert failed, a client unlink that never
// reached the server, a storage remove that failed after the purge. The purge
// paths unlink what they orphan; this catches what slipped past them.
//
// public.list_orphaned_document_files (service_role only, migration
// 20261021170000) names files older than a day with no row; each chunk is
// checked again right before the remove, because uploads are content-addressed
// and a re-upload can bring a path back to life between the listing and here.
//
// Plain JS with no Deno APIs and the client injected, so node tests run it with
// a stub client (tests/archivePurgeSweepDocumentFiles.test.mjs). Best-effort: a
// failure is counted and reported, never thrown.

export const DOCUMENT_FILES_BUCKET = 'documents';
export const DOCUMENT_FILE_SWEEP_LIMIT = 500;
export const DOCUMENT_FILE_REMOVE_CHUNK = 100;
// The SQL never lists anything younger than this either.
export const DOCUMENT_FILE_MIN_AGE_HOURS = 24;

// Only PDFs are ever removed. The bucket also holds survey-data sidecars
// ({projectId}/{documentId}_data.json) whose paths no column stores, so "no row
// points at it" says nothing about them. The SQL filters the same way.
export const isSweepablePdf = (name) => typeof name === 'string' && /\.pdf$/i.test(name);

const messageOf = (err) => (err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err));

async function referencedPaths(supabase, chunk) {
  const [docs, templates, excel] = await Promise.all([
    supabase.from('documents').select('file_path').in('file_path', chunk),
    supabase.from('templates').select('file_path').in('file_path', chunk),
    supabase.from('templates').select('linked_excel_path').in('linked_excel_path', chunk),
  ]);
  const error = docs.error || templates.error || excel.error;
  if (error) throw error;
  return new Set([
    ...(docs.data ?? []).map((r) => r.file_path),
    ...(templates.data ?? []).map((r) => r.file_path),
    ...(excel.data ?? []).map((r) => r.linked_excel_path),
  ]);
}

/**
 * @param {object} supabase - a service-role supabase-js client.
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - list and count only; remove nothing.
 * @param {number} [options.limit]
 * @param {(event: string, fields?: Record<string, unknown>) => void} [options.log] - content-free logger.
 * @returns {Promise<{found: number, bytes: number, removed: number, failed: number, skipped_live: number, errors: string[]}>}
 */
export async function sweepOrphanedDocumentFiles(supabase, { dryRun = false, limit = DOCUMENT_FILE_SWEEP_LIMIT, log = () => {} } = {}) {
  const summary = { found: 0, bytes: 0, removed: 0, failed: 0, skipped_live: 0, errors: [] };

  let rows;
  try {
    const { data, error } = await supabase.rpc('list_orphaned_document_files', {
      p_limit: limit,
      p_min_age_hours: DOCUMENT_FILE_MIN_AGE_HOURS,
    });
    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
  } catch (err) {
    summary.errors.push(`list_failed: ${messageOf(err)}`);
    log('files_list_failed', { message: messageOf(err) });
    return summary;
  }

  const byName = new Map();
  for (const row of rows) {
    if (row && isSweepablePdf(row.name)) byName.set(row.name, Number(row.size) || 0);
  }
  const names = [...byName.keys()];
  summary.found = names.length;
  summary.bytes = names.reduce((sum, name) => sum + byName.get(name), 0);
  if (names.length === 0 || dryRun) return summary;

  for (let i = 0; i < names.length; i += DOCUMENT_FILE_REMOVE_CHUNK) {
    const chunk = names.slice(i, i + DOCUMENT_FILE_REMOVE_CHUNK);
    try {
      let live;
      try {
        live = await referencedPaths(supabase, chunk);
      } catch (err) {
        // Cannot prove the files are unreferenced: skip, they stay listed.
        summary.failed += chunk.length;
        summary.errors.push(`recheck_failed: ${messageOf(err)}`);
        log('files_recheck_failed', { chunk_size: chunk.length, message: messageOf(err) });
        continue;
      }
      const safeToRemove = chunk.filter((name) => !live.has(name));
      if (safeToRemove.length < chunk.length) {
        summary.skipped_live += chunk.length - safeToRemove.length;
        log('files_skipped_live', { count: chunk.length - safeToRemove.length });
      }
      if (safeToRemove.length === 0) continue;

      const { data: removed, error: rmError } = await supabase.storage
        .from(DOCUMENT_FILES_BUCKET)
        .remove(safeToRemove);
      if (rmError) {
        summary.failed += safeToRemove.length;
        summary.errors.push(rmError.message);
        log('files_chunk_failed', { chunk_size: safeToRemove.length, message: rmError.message });
      } else {
        summary.removed += Array.isArray(removed) ? removed.length : safeToRemove.length;
      }
    } catch (err) {
      summary.failed += chunk.length;
      summary.errors.push(messageOf(err));
      log('files_chunk_failed', { chunk_size: chunk.length, message: messageOf(err) });
    }
  }
  return summary;
}
