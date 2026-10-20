import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

const corsHeaders = {
  // INTENTIONAL: agents call this from anywhere and auth with their own
  // Bearer token, never cookies. See CLAUDE.md CORS invariant.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_TTL_SECONDS = 3600;
const POLL_INTERVAL_SECONDS = 5;

function randomCode(length: number) {
  // 32 letters divide 256 evenly, so every letter is equally likely.
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function randomSecret(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const siteUrl = () => (Deno.env.get('SITE_URL') || 'https://surveytool.app').replace(/\/$/, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = String(body.action || '');

  if (action === 'start') {
    const agentName = String(body.agent_name || '').trim().slice(0, 80);
    if (!agentName) return json(400, { error: 'agent_name_required' });
    // Old unclaimed codes are useless; drop them so the table stays small.
    await admin.from('agent_links').delete()
      .eq('status', 'pending').lt('code_expires_at', new Date().toISOString());
    const deviceCode = randomSecret('sdc_');
    const userCode = randomCode(8);
    const { error } = await admin.from('agent_links').insert({
      agent_name: agentName,
      user_code: userCode,
      device_code_hash: await sha256(deviceCode),
    });
    if (error) return json(500, { error: 'could_not_start' });
    return json(200, {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${siteUrl()}/agent-link`,
      verification_uri_complete: `${siteUrl()}/agent-link?user_code=${userCode}`,
      expires_in: 600,
      interval: POLL_INTERVAL_SECONDS,
    });
  }

  if (action === 'token') {
    const deviceCode = String(body.device_code || '');
    if (!deviceCode) return json(400, { error: 'device_code_required' });
    const { data: link } = await admin.from('agent_links')
      .select('id, status, token_hash, code_expires_at, scopes')
      .eq('device_code_hash', await sha256(deviceCode))
      .maybeSingle();
    if (!link || link.status === 'revoked') return json(400, { error: 'access_denied' });
    if (link.status === 'pending') {
      if (new Date(link.code_expires_at) < new Date()) return json(400, { error: 'expired_token' });
      return json(400, { error: 'authorization_pending' });
    }
    // A device code buys one token; asking again cannot mint a second.
    if (link.token_hash) return json(400, { error: 'access_denied' });
    const token = randomSecret('sat_');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();
    const { data: issued, error } = await admin.from('agent_links')
      .update({ token_hash: await sha256(token), token_expires_at: expiresAt })
      .eq('id', link.id).eq('status', 'approved').is('token_hash', null)
      .select('id');
    if (error || !issued?.length) return json(400, { error: 'access_denied' });
    return json(200, {
      access_token: token,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      scope: (link.scopes || []).join(' '),
    });
  }

  if (action === 'whoami') {
    const match = (req.headers.get('Authorization') || '').match(/^Bearer\s+(sat_[0-9a-f]{64})$/);
    if (!match) return json(401, { error: 'invalid_token' });
    const { data: link } = await admin.from('agent_links')
      .select('user_id, agent_name, scopes, status, token_expires_at')
      .eq('token_hash', await sha256(match[1]))
      .maybeSingle();
    if (!link || link.status !== 'approved' || !link.token_expires_at
      || new Date(link.token_expires_at) < new Date()) {
      return json(401, { error: 'invalid_token' });
    }
    return json(200, {
      user_id: link.user_id,
      agent_name: link.agent_name,
      scopes: link.scopes,
      expires_at: link.token_expires_at,
    });
  }

  return json(400, { error: 'unknown_action' });
});
