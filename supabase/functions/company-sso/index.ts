import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { isAgentSession, AGENT_REFUSED_MESSAGE } from '../_shared/agentSession.ts';
import { dohAnswerHasToken, METADATA_XML_MAX, readMetadataInput, signOnErrorText, txtRecordName } from '../_shared/companySso.js';
import { parseBody, s } from '../_shared/inputSchema.js';

// Company sign-in setup for the Enterprise company workspace, done by the
// company's own owner or admin with no help from us:
//   check-domain  look up the DNS line that proves they own the domain
//   connect       hand their SAML sign-on details to Supabase Auth for their
//                 proved domains (creates or updates the connection)
//   disconnect    remove the connection
// Only the caller's role is trusted, read through my_org_role() with their
// own token; every write uses the service role after that check.

const corsHeaders = {
  // INTENTIONAL: this Bearer-authenticated function is called from web,
  // Electron file://, Expo, and Capacitor. See CLAUDE.md CORS invariant.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const ACTIONS = new Set(['check-domain', 'connect', 'disconnect']);
const DOH_URL = Deno.env.get('COMPANY_SSO_DOH_URL') || 'https://cloudflare-dns.com/dns-query';

async function lookupTxt(name: string) {
  const url = `${DOH_URL}?name=${encodeURIComponent(name)}&type=TXT`;
  const res = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`DNS lookup answered ${res.status}`);
  return await res.json();
}

async function authAdmin(supabaseUrl: string, serviceKey: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/sso/providers${path}`, {
    method,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { msg: text }; }
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Missing authorization header' });
    if (isAgentSession(authHeader)) return json(403, { error: AGENT_REFUSED_MESSAGE });

    const UUID = /^[0-9a-f-]{36}$/i;
    const parsed = parseBody({
      action: s.enum([...ACTIONS]),
      orgId: s.string({ max: 36, pattern: UUID }),
      domainId: s.string({ max: 36, pattern: UUID, optional: true }),
      metadataUrl: s.string({ max: 2048, optional: true }),
      metadataXml: s.string({ max: METADATA_XML_MAX * 2, optional: true }), // readMetadataInput words the real limit
    }, await req.json().catch(() => null));
    if (!parsed.ok) return json(400, { error: 'Bad request' });
    const body = parsed.value as { action: string, orgId: string, domainId?: string, metadataUrl?: string, metadataXml?: string };
    const { action, orgId } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) return json(503, { error: 'Company sign-in setup is unavailable right now.' });

    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return json(401, { error: 'Unauthorized' });
    const { data: role } = await caller.rpc('my_org_role', { p_org: orgId });
    if (role !== 'owner' && role !== 'admin') return json(403, { error: 'Only an owner or admin can set up company sign-in.' });

    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const log = (act: string, label: string, details: Record<string, unknown> = {}) => admin.rpc('_org_log', {
      p_org: orgId, p_actor: user.id, p_action: act, p_target_type: 'sso', p_target_id: null,
      p_target_label: label, p_project: null, p_document: null, p_details: details,
    });
    const { data: org, error: orgError } = await admin.from('organizations')
      .select('id, sso_provider_id').eq('id', orgId).single();
    if (orgError || !org) return json(404, { error: 'Company not found.' });
    const provedDomains = async () => {
      const { data } = await admin.from('organization_domains').select('domain')
        .eq('organization_id', orgId).not('verified_at', 'is', null).order('domain');
      return (data || []).map((d: { domain: string }) => d.domain);
    };

    if (action === 'check-domain') {
      const domainId = body.domainId || '';
      const { data: row } = await admin.from('organization_domains')
        .select('id, domain, verification_token, verified_at').eq('id', domainId).eq('organization_id', orgId).maybeSingle();
      if (!row) return json(404, { error: 'Domain not found.' });
      if (row.verified_at) return json(200, { verified: true, domain: row.domain });

      let answer;
      try { answer = await lookupTxt(txtRecordName(row.domain)); } catch (err) {
        console.error('company-sso dns lookup failed', err instanceof Error ? err.message : String(err));
        return json(502, { error: 'Survey could not reach DNS just now. Try Check again in a minute.' });
      }
      if (!dohAnswerHasToken(answer, row.verification_token)) {
        return json(200, { verified: false, domain: row.domain });
      }
      const { error: upError } = await admin.from('organization_domains')
        .update({ verified_at: new Date().toISOString() }).eq('id', row.id);
      if (upError) {
        if (upError.code === '23505') return json(409, { error: `Another company has already proved it owns ${row.domain}.` });
        throw new Error(upError.message);
      }
      await log('domain.verified', row.domain);
      // An existing connection picks up the new domain at once.
      if (org.sso_provider_id) {
        const res = await authAdmin(supabaseUrl, serviceKey, 'PUT', `/${org.sso_provider_id}`, { domains: await provedDomains() });
        if (!res.ok) console.error('company-sso domain update failed', res.status, JSON.stringify(res.data));
      }
      return json(200, { verified: true, domain: row.domain });
    }

    if (action === 'connect') {
      const input = readMetadataInput(body);
      if (!input.ok) return json(400, { error: input.error });
      const domains = await provedDomains();
      if (domains.length === 0) return json(400, { error: 'Prove you own at least one email domain first.' });

      const payload = { ...input.value, domains };
      const res = org.sso_provider_id
        ? await authAdmin(supabaseUrl, serviceKey, 'PUT', `/${org.sso_provider_id}`, payload)
        : await authAdmin(supabaseUrl, serviceKey, 'POST', '', { type: 'saml', ...payload });
      if (!res.ok) {
        console.error('company-sso connect failed', res.status, JSON.stringify(res.data).slice(0, 500));
        return json(res.status >= 500 ? 502 : 409, { error: signOnErrorText(res.status, res.data) });
      }
      const providerId = res.data?.id || org.sso_provider_id;
      await admin.from('organizations')
        .update({ sso_provider_id: providerId, sso_connected_at: new Date().toISOString() }).eq('id', orgId);
      const entityId = res.data?.saml?.entity_id || null;
      await log(org.sso_provider_id ? 'sso.updated' : 'sso.connected', entityId || 'Company sign-in', { domains });
      return json(200, { connected: true, entityId, domains });
    }

    // disconnect
    if (org.sso_provider_id) {
      const res = await authAdmin(supabaseUrl, serviceKey, 'DELETE', `/${org.sso_provider_id}`);
      if (!res.ok && res.status !== 404) {
        console.error('company-sso disconnect failed', res.status, JSON.stringify(res.data).slice(0, 500));
        return json(502, { error: signOnErrorText(res.status, res.data) });
      }
      await admin.from('organizations').update({ sso_provider_id: null, sso_connected_at: null }).eq('id', orgId);
      await log('sso.disconnected', 'Company sign-in');
    }
    return json(200, { connected: false });
  } catch (error) {
    console.error('company-sso failed', error instanceof Error ? error.message : String(error));
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
});
