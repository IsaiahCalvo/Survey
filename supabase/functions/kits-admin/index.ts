// Kits admin (/kits page): publish kits and give them to customer accounts.
// The caller must be signed in and on the /flags admin list (checked in the
// database with the caller's own token); only then does it use the service role.
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { BODY_SCHEMA, handleKitsAdmin } from '../_shared/kitsAdmin.js';
import { parseBody, readJsonBody } from '../_shared/inputSchema.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const authHeader = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authHeader)) return json({ error: 'Unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (error || !user) return json({ error: 'Unauthorized' }, 401);

  const parsed = parseBody(BODY_SCHEMA, await readJsonBody(req));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const payload = parsed.value;
  const service = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
  try {
    const { status, body } = await handleKitsAdmin(payload, { userClient, service });
    return json(body, status);
  } catch {
    return json({ error: 'Something went wrong.' }, 500);
  }
});
