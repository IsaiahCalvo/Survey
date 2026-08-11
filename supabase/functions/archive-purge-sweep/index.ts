// supabase/functions/archive-purge-sweep/index.ts
//
// KAL-431 — the scheduled half of the 30-day Archive auto-cleanup.
//
// The dangerous work (deciding which rows are due, purging them through the
// owner-enforced purge_archived_* RPCs, per-item failure isolation, the run log)
// all lives in the `public.sweep_expired_archives` SQL function. This function
// is the trusted scheduled caller that does the ONE thing SQL cannot: unlink the
// stored PDF objects that the purge left unreferenced.
//
// Why storage is not done in SQL: the purge RPCs deliberately only report
// `orphaned_paths` — the file_paths no surviving document row points at — and
// leave the unlink to the caller, exactly as the client services do
// (src/services/documentArchiveService.js). Deleting rows from storage.objects
// in SQL would drop the metadata but strand the S3 bytes forever, which defeats
// the point of a cleanup job. The Storage API removes both.
//
// This function is MACHINE-invoked (Supabase Cron / pg_cron). It is not part of
// any user flow: it authenticates a shared secret, never an end user, and holds
// no per-user session. See docs/KAL-431-archive-auto-cleanup.md before enabling.

import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

const corsHeaders = {
  // ⚠️ INTENTIONAL — do NOT tighten to an origin allowlist (false positive if an
  // audit flags it). Same bundle ships to web + Electron prod (file:// → Origin:
  // null) + Capacitor iOS/Android; an allowlist CORS-breaks email/Excel/payments
  // on desktop+mobile, and Electron would then need Origin:null allowed — the very
  // hole tightening tries to close. Bearer-token auth (not cookies) ⇒ '*' is
  // non-exploitable. Why: CLAUDE.md "DO NOT BREAK" + HANDOFF-post-launch-hardening.md
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Content-free structured log. NEVER log document names, owners or file bytes —
// counts and ids only, so the run is auditable without leaking user content.
const log = (event: string, fields: Record<string, unknown> = {}) => {
  try {
    console.log(JSON.stringify({ fn: 'archive-purge-sweep', event, ...fields }));
  } catch {
    /* logging must never throw */
  }
};

/**
 * Constant-time within a length class. The early length check does leak the
 * secret's LENGTH, which is acceptable here: both credentials are
 * fixed-length, high-entropy machine secrets, so length is not the unknown.
 */
const secretsMatch = (a: string, b: string): boolean => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const STORAGE_BUCKET = 'documents';
// Storage removes are chunked so one huge backlog cannot blow the request up.
const UNLINK_CHUNK = 100;

// Mirrors normalizeBatchLimit / MAX_BATCH_LIMIT in
// src/services/archiveSweepSelection.js. Kept in sync by hand because Deno
// cannot import from src/; the SQL clamps again as the real backstop.
const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 500;
const normalizeBatchLimit = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_BATCH_LIMIT;
  return Math.min(Math.floor(n), MAX_BATCH_LIMIT);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const cronSecret = Deno.env.get('ARCHIVE_PURGE_CRON_SECRET') ?? '';

  if (!serviceKey || !supabaseUrl) {
    log('misconfigured', { has_url: Boolean(supabaseUrl), has_key: Boolean(serviceKey) });
    return json({ ok: false, error: 'misconfigured' }, 500);
  }

  // ── Auth: machine callers only ──────────────────────────────────────────
  // This endpoint permanently deletes user data, so it accepts exactly two
  // credentials: the service-role key, or a dedicated cron secret. There is no
  // end-user path in — an authenticated user's JWT is NOT sufficient.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const headerSecret = (req.headers.get('x-cron-secret') ?? '').trim();
  const authorized =
    secretsMatch(bearer, serviceKey) ||
    (cronSecret !== '' && (secretsMatch(headerSecret, cronSecret) || secretsMatch(bearer, cronSecret)));

  if (!authorized) {
    log('unauthorized');
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let batchLimit = DEFAULT_BATCH_LIMIT;
  let dryRun = false;
  try {
    const body = await req.json();
    if (body && typeof body === 'object') {
      if (body.limit !== undefined) batchLimit = normalizeBatchLimit(body.limit);
      // A GENUINE rehearsal: dry_run is passed through to the SQL, which reports
      // exactly what it would purge and deletes nothing. It must never be a
      // half-measure — an operator reaching for "dry run" is trying to avoid
      // deleting anything at all.
      dryRun = body.dry_run === true;
    }
  } catch {
    /* no body is fine — defaults apply */
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startedAt = Date.now();
  log('sweep_start', { batch_limit: batchLimit, dry_run: dryRun });

  const { data, error } = await supabase.rpc('sweep_expired_archives', {
    p_limit: batchLimit,
    p_dry_run: dryRun,
  });

  if (error) {
    log('sweep_failed', { code: error.code, message: error.message });
    return json({ ok: false, error: 'sweep_failed', detail: error.message }, 500);
  }

  const result = (data ?? {}) as Record<string, unknown>;

  if (result.skipped_lock === true) {
    log('sweep_stood_down', { run_id: result.run_id });
    return json({ ok: true, skipped_lock: true, run_id: result.run_id });
  }

  const orphanedPaths = Array.isArray(result.orphaned_paths)
    ? (result.orphaned_paths as string[]).filter((p) => typeof p === 'string' && p.length > 0)
    : [];

  log('sweep_committed', {
    run_id: result.run_id,
    projects_purged: result.projects_purged,
    documents_purged: result.documents_purged,
    templates_purged: result.templates_purged,
    failed: result.failed,
    skipped: result.skipped,
    orphaned_count: orphanedPaths.length,
  });

  // ── Unlink stored PDFs the purge left unreferenced ──────────────────────
  // Best-effort by design: the database rows are already gone and committed. A
  // storage failure must not fail the run — it leaves a stray object, which the
  // logged path list makes recoverable, whereas retrying the purge would not.
  let unlinked = 0;
  const unlinkErrors: string[] = [];
  const failedPaths: string[] = [];

  if (orphanedPaths.length > 0 && !dryRun) {
    for (let i = 0; i < orphanedPaths.length; i += UNLINK_CHUNK) {
      const chunk = orphanedPaths.slice(i, i + UNLINK_CHUNK);

      // Re-check immediately before deleting. Uploads are content-addressed and
      // deduped, so between the sweep committing and this call the same user can
      // re-upload an identical PDF and land a LIVE row back on the very path we
      // are about to remove. Dropping any path that has come back to life costs
      // one query and prevents deleting the bytes of a live document.
      const { data: revived, error: checkError } = await supabase
        .from('documents')
        .select('file_path')
        .in('file_path', chunk);

      if (checkError) {
        // Cannot prove the paths are still unreferenced — skip rather than risk
        // deleting a live document's bytes. The paths stay in the run log.
        unlinkErrors.push(`recheck_failed: ${checkError.message}`);
        failedPaths.push(...chunk);
        log('unlink_recheck_failed', { chunk_size: chunk.length, message: checkError.message });
        continue;
      }

      const stillReferenced = new Set((revived ?? []).map((r) => r.file_path));
      const safeToRemove = chunk.filter((p) => !stillReferenced.has(p));
      if (stillReferenced.size > 0) {
        log('unlink_skipped_revived', { count: stillReferenced.size });
      }
      if (safeToRemove.length === 0) continue;

      const { data: removed, error: rmError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(safeToRemove);
      if (rmError) {
        unlinkErrors.push(rmError.message);
        failedPaths.push(...safeToRemove);
        log('unlink_chunk_failed', { chunk_size: safeToRemove.length, message: rmError.message });
      } else {
        unlinked += Array.isArray(removed) ? removed.length : safeToRemove.length;
      }
    }
  }

  // Record what Storage actually did, so a stranded object is visible in the run
  // log instead of silently lost. Best-effort: the purge is already committed.
  if (!dryRun && result.run_id) {
    const { error: writeBackError } = await supabase
      .from('archive_purge_runs')
      .update({
        storage_unlinked_at: new Date().toISOString(),
        unlinked_count: unlinked,
        unlink_failed_paths: failedPaths,
      })
      .eq('id', result.run_id);
    if (writeBackError) log('writeback_failed', { message: writeBackError.message });
  }

  log('sweep_done', {
    run_id: result.run_id,
    unlinked,
    unlink_errors: unlinkErrors.length,
    stranded: failedPaths.length,
    duration_ms: Date.now() - startedAt,
  });

  return json({
    ok: true,
    run_id: result.run_id,
    batch_limit: result.batch_limit,
    projects_purged: result.projects_purged,
    documents_purged: result.documents_purged,
    templates_purged: result.templates_purged,
    failed: result.failed,
    skipped: result.skipped,
    over_limit: result.over_limit,
    orphaned_paths: orphanedPaths.length,
    unlinked,
    unlink_errors: unlinkErrors,
    stranded_paths: failedPaths.length,
    dry_run: dryRun,
    duration_ms: Date.now() - startedAt,
  });
});
