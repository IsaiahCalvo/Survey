// supabase/functions/archive-purge-sweep/r2CopySweep.js
//
// Removes the Cloudflare R2 copies of stored PDFs that were deleted or moved in
// Supabase Storage (docs/PDF-R2.md). A trigger on storage.objects queues each
// such path in public.pdf_r2_deletes (migration 20261028090000); this deletes
// the R2 key, then the queue row. A row queued again while this ran keeps its
// newer queued_at and is not cleared.
//
// Deleting a copy whose path came back to life is harmless: pdf-file-url makes
// a new copy the next time it is opened. Off (nothing read) when R2 is not
// configured. Plain JS with the client and R2 calls injected for node tests
// (tests/pdfR2.test.mjs). Best-effort: failures are counted, never thrown.
import { deleteObject, putBucketCors, r2KeyForDocument } from '../_shared/r2.js';

export const R2_COPY_SWEEP_LIMIT = 500;

const messageOf = (err) => (err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err));

/**
 * @param {any} supabase - a service-role supabase-js client.
 * @param {any} config - r2ConfigFromEnv(...) or null (then nothing is read).
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - count only; delete nothing.
 * @param {number} [options.limit]
 * @param {(event: string, fields?: Record<string, unknown>) => void} [options.log] - content-free logger.
 * @param {(config: any, key: string) => Promise<void>} [options.remove]
 * @returns {Promise<{enabled: boolean, found: number, removed: number, failed: number, errors: string[]}>}
 */
export async function sweepR2Copies(supabase, config, { dryRun = false, limit = R2_COPY_SWEEP_LIMIT, log = () => {}, remove = deleteObject } = {}) {
  const summary = { enabled: Boolean(config), found: 0, removed: 0, failed: 0, errors: [] };
  if (!config) return summary;

  const { data, error } = await supabase
    .from('pdf_r2_deletes')
    .select('path, queued_at')
    .order('queued_at', { ascending: true })
    .limit(limit);
  if (error) {
    summary.errors.push(`list_failed: ${messageOf(error)}`);
    log('r2_sweep_list_failed', { message: messageOf(error) });
    return summary;
  }
  const rows = data ?? [];
  summary.found = rows.length;
  if (dryRun) return summary;

  for (const row of rows) {
    try {
      await remove(config, r2KeyForDocument(row.path));
    } catch (err) {
      summary.failed += 1;
      if (summary.errors.length < 10) summary.errors.push(messageOf(err));
      continue;
    }
    // The copy is gone, so its bytes leave the free-tier ledger (r2_reserve).
    const { error: ledgerError } = await supabase.from('pdf_r2_copies').delete().eq('path', row.path);
    if (ledgerError) log('r2_sweep_ledger_failed', { message: messageOf(ledgerError) });
    const { error: clearError } = await supabase
      .from('pdf_r2_deletes')
      .delete()
      .eq('path', row.path)
      .eq('queued_at', row.queued_at);
    if (clearError) {
      summary.failed += 1;
      if (summary.errors.length < 10) summary.errors.push(`clear_failed: ${messageOf(clearError)}`);
      continue;
    }
    summary.removed += 1;
  }
  if (summary.failed) log('r2_sweep_failures', { failed: summary.failed });
  return summary;
}

/**
 * Sets the R2 bucket's CORS rule the app's cross-origin range reads need.
 * Every run re-applies it, so a bucket made or changed by hand heals by the
 * next day, and the answer shows the R2 secrets work. One Class A operation,
 * reserved under the free-tier cap like every other R2 call.
 * @param {any} supabase - a service-role supabase-js client.
 * @param {any} config - r2ConfigFromEnv(...) or null.
 * @param {object} [options]
 * @param {boolean} [options.dryRun]
 * @param {(event: string, fields?: Record<string, unknown>) => void} [options.log]
 * @param {(config: any) => Promise<void>} [options.put]
 * @returns {Promise<string>} 'off' | 'dry_run' | 'set' | 'over_budget' | 'failed: …'
 */
export async function ensureR2Cors(supabase, config, { dryRun = false, log = () => {}, put = putBucketCors } = {}) {
  if (!config) return 'off';
  if (dryRun) return 'dry_run';
  const { data, error } = await supabase.rpc('r2_reserve', { p_class_a: 1, p_class_b: 0 });
  if (error) {
    log('r2_cors_reserve_failed', { message: messageOf(error) });
    return `failed: ${messageOf(error)}`;
  }
  if (data !== true) return 'over_budget';
  try {
    await put(config);
    return 'set';
  } catch (err) {
    log('r2_cors_failed', { message: messageOf(err) });
    return `failed: ${messageOf(err)}`;
  }
}
