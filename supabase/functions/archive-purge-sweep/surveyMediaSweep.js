// supabase/functions/archive-purge-sweep/surveyMediaSweep.js
//
// The server-side fallback for survey media (photos, videos, recordings in the
// `survey-media` bucket) whose document row no longer exists.
//
// "Delete forever" on the client purges the document first and then removes
// only the caller's OWN uploads (src/services/surveyMediaPurge.js): once the
// row is gone the survey_media_delete storage policy no longer lets the
// document's owner remove a collaborator's upload. The same happens to media
// of documents removed by this scheduled sweep, account deletion, or any other
// row delete. Those objects would otherwise stay stored forever, charged to
// the uploader's quota.
//
// public.list_orphaned_survey_media(p_limit) (service_role only, migration
// 20261001131413) names them; this removes them through the Storage API, which
// drops both the metadata row and the stored bytes (deleting storage.objects
// rows in SQL would strand the bytes).
//
// Plain JS with no Deno APIs and the client injected, so node tests run it for
// real with a stub client (tests/archivePurgeSweepSurveyMedia.test.mjs).
// Best-effort by design: a listing or storage failure is reported in the
// result, never thrown, so it can never fail the archive sweep run.

export const SURVEY_MEDIA_BUCKET = 'survey-media';
// Objects listed per run. The SQL clamps p_limit to 1..1000 again.
export const MEDIA_SWEEP_LIMIT = 500;
// Storage removes are chunked like the PDF unlink.
export const MEDIA_REMOVE_CHUNK = 100;

const UUID_PREFIX = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\//;

/** The document id an object name belongs to (first path folder), or null. */
export const mediaDocumentId = (name) => {
  const match = UUID_PREFIX.exec(String(name ?? ''));
  return match ? match[1].toLowerCase() : null;
};

const messageOf = (err) => (err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err));

/**
 * @param {object} supabase - a service-role supabase-js client.
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - list and count only; remove nothing.
 * @param {number} [options.limit]
 * @param {(event: string, fields?: Record<string, unknown>) => void} [options.log] - content-free logger.
 * @returns {Promise<{found: number, removed: number, failed: number, skipped_live: number, errors: string[]}>}
 */
export async function sweepOrphanedSurveyMedia(supabase, { dryRun = false, limit = MEDIA_SWEEP_LIMIT, log = () => {} } = {}) {
  const summary = { found: 0, removed: 0, failed: 0, skipped_live: 0, errors: [] };

  let rows;
  try {
    const { data, error } = await supabase.rpc('list_orphaned_survey_media', { p_limit: limit });
    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
  } catch (err) {
    summary.errors.push(`list_failed: ${messageOf(err)}`);
    log('media_list_failed', { message: messageOf(err) });
    return summary;
  }

  const names = [...new Set(rows
    .map((row) => (row && typeof row.name === 'string' ? row.name : ''))
    .filter((name) => mediaDocumentId(name) !== null))];
  summary.found = names.length;
  if (names.length === 0 || dryRun) return summary;

  for (let i = 0; i < names.length; i += MEDIA_REMOVE_CHUNK) {
    const chunk = names.slice(i, i + MEDIA_REMOVE_CHUNK);
    try {
      // Re-check immediately before deleting, like the PDF unlink: only media
      // whose document row is still absent is removed. Cannot prove it -> skip.
      const docIds = [...new Set(chunk.map(mediaDocumentId))];
      const { data: live, error: checkError } = await supabase
        .from('documents')
        .select('id')
        .in('id', docIds);
      if (checkError) {
        summary.failed += chunk.length;
        summary.errors.push(`recheck_failed: ${checkError.message}`);
        log('media_recheck_failed', { chunk_size: chunk.length, message: checkError.message });
        continue;
      }
      const liveIds = new Set((live ?? []).map((row) => String(row.id).toLowerCase()));
      const safeToRemove = chunk.filter((name) => !liveIds.has(mediaDocumentId(name)));
      if (safeToRemove.length < chunk.length) {
        summary.skipped_live += chunk.length - safeToRemove.length;
        log('media_skipped_live', { count: chunk.length - safeToRemove.length });
      }
      if (safeToRemove.length === 0) continue;

      const { data: removed, error: rmError } = await supabase.storage
        .from(SURVEY_MEDIA_BUCKET)
        .remove(safeToRemove);
      if (rmError) {
        summary.failed += safeToRemove.length;
        summary.errors.push(rmError.message);
        log('media_chunk_failed', { chunk_size: safeToRemove.length, message: rmError.message });
      } else {
        summary.removed += Array.isArray(removed) ? removed.length : safeToRemove.length;
      }
    } catch (err) {
      // A thrown network error isolates to this chunk; the next one still runs.
      summary.failed += chunk.length;
      summary.errors.push(messageOf(err));
      log('media_chunk_failed', { chunk_size: chunk.length, message: messageOf(err) });
    }
  }
  return summary;
}
