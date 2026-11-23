// plot-job-file (KAL-581): short-lived R2 links for a shared Plot job's file.
// Plot asks for an upload link after it shares or saves a job, says when the
// upload landed, and asks for a download link to open a job shared from
// another computer. The rules and the ledger are in ../_shared/plotJobFile.js.
import { handlePlotJobFile } from '../_shared/plotJobFile.js';
import { plotR2Env } from '../_shared/plotJobFile.js';
import { deleteObject, headObject, presignGet, presignPut, putBucketCors, r2ConfigFromEnv } from '../_shared/r2.js';

const corsHeaders = {
  // INTENTIONAL: this Bearer-authenticated function is called from Plot on
  // the desktop (localhost) and on the web. See CLAUDE.md CORS invariant.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// Counts and outcomes only: never a key, a name or a user id.
const log = (event: string, fields: Record<string, unknown> = {}) => {
  try {
    console.log(JSON.stringify({ fn: 'plot-job-file', event, ...fields }));
  } catch {
    /* logging must never throw */
  }
};

const state: { corsSet?: boolean } = {};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'missing_authorization' });
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) return json(503, { error: 'misconfigured' });

  const rpc = async (name: string, args: unknown, asService: boolean) => {
    const key = asService ? serviceKey : anonKey;
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { Authorization: asService ? `Bearer ${serviceKey}` : authHeader, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`${name} ${res.status}`);
    return res.json();
  };

  const config = r2ConfigFromEnv(plotR2Env((name: string) => Deno.env.get(name)));
  try {
    const answer = await handlePlotJobFile({
      body: await req.json().catch(() => null),
      config,
      // The caller's own token: the Project's roles decide.
      roleOf: async (jobId: string) => (await rpc('plot_job_role', { p_id: jobId }, false)) ?? null,
      jobOf: async (jobId: string) => {
        const rows = (await rpc('plot_list_jobs', {}, false)) as Array<{ id: string; file_key: string | null; file_bytes: number | null }>;
        return rows.find((row) => row.id === jobId) ?? null;
      },
      // The service key only for the ledger.
      reserve: async (key: string | null, jobId: string, bytes: number, a: number, b: number) =>
        (await rpc('plot_r2_reserve', { p_key: key, p_job_id: jobId, p_bytes: bytes, p_class_a: a, p_class_b: b }, true)) === true,
      commit: async (jobId: string, key: string, bytes: number) =>
        ((await rpc('plot_r2_commit', { p_job_id: jobId, p_key: key, p_bytes: bytes }, true)) ?? []) as string[],
      r2: { presignPut, presignGet, headObject, deleteObject, putBucketCors },
      state,
    });
    log('answer', { status: answer.status, stored: (answer.body as { stored?: boolean }).stored ?? null, reason: (answer.body as { reason?: string; error?: string }).reason ?? (answer.body as { error?: string }).error ?? null });
    return json(answer.status, answer.body);
  } catch (error) {
    log('failed', { message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    // R2 or the ledger failed: Plot keeps the job on its computer.
    return json(200, { stored: false, reason: 'unavailable' });
  }
});
