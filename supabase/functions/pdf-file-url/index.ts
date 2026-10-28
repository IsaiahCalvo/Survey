// pdf-file-url: hands the app a short-lived Cloudflare R2 link for a stored PDF
// it may open, so repeat downloads stop costing Supabase egress. Supabase still
// decides who may open each file; the logic and its reasons are in
// ../_shared/pdfFileUrl.js, the R2 setup in docs/PDF-R2.md.
import { handlePdfFileUrl } from '../_shared/pdfFileUrl.js';
import { r2ConfigFromEnv } from '../_shared/r2.js';
import { parseBody, s } from '../_shared/inputSchema.js';

const corsHeaders = {
  // INTENTIONAL: this Bearer-authenticated function is called from web,
  // Electron file://, Expo, and Capacitor. See CLAUDE.md CORS invariant.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// Counts and outcomes only: never a path, a name or a user id.
const log = (event: string, fields: Record<string, unknown> = {}) => {
  try {
    console.log(JSON.stringify({ fn: 'pdf-file-url', event, ...fields }));
  } catch {
    /* logging must never throw */
  }
};

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

// Keeps the copy running after the answer is sent (Supabase's edge runtime);
// a plain Deno server (scripts/e2e-serve-functions.ts) just lets it run.
const background = (promise: Promise<unknown>) => {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(promise);
  else promise.catch(() => {});
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'missing_authorization' });
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !anonKey) return json(503, { error: 'misconfigured' });

  // Every Storage call carries the caller's own token, so Storage's access
  // rules decide; this function holds no key that could read past them.
  const asCaller = { Authorization: authHeader, apikey: anonKey };
  const storage = `${supabaseUrl}/storage/v1`;

  const parsed = parseBody({ path: s.string({ min: 1, max: 1024 }) }, await req.json().catch(() => null));
  if (!parsed.ok) return json(400, { error: 'invalid_request', detail: parsed.error });

  try {
    const result = await handlePdfFileUrl(parsed.value, {
      config: r2ConfigFromEnv((name: string) => Deno.env.get(name)),
      storageInfo: async (path: string) => {
        const res = await fetch(`${storage}/object/info/documents/${encodePath(path)}`, { headers: asCaller });
        if (!res.ok) {
          await res.body?.cancel();
          return { ok: false, status: res.status };
        }
        return { ok: true, status: res.status, data: await res.json() };
      },
      download: (path: string) => fetch(`${storage}/object/authenticated/documents/${encodePath(path)}`, {
        headers: asCaller,
      }),
      background,
      log,
    });
    return json(result.status, result.body);
  } catch (error) {
    log('failed', { message: String((error as Error)?.message ?? error) });
    return json(500, { error: 'failed' });
  }
});
