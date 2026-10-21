// Lets an outside AI agent that is already let in (Survey OAuth token with a
// client_id) show who it is with an AgentID id_token from AgentMail. Survey
// checks the token and records the agent's id and its owner next to that
// grant, so the person sees it on /agent-link. It never grants access: only
// the person's Allow does that.
//   GET  -> what to use when signing in to AgentID (client_id, redirect_uri, scope)
//   POST { id_token } -> checks it and records it
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { agentClientId } from '../_shared/agentSession.ts';
import {
  AGENTID_CLIENT_ID, AGENTID_JWKS_URL, AGENTID_REDIRECT_URI, AGENTID_SCOPE, agentIdRecord, verifyAgentIdToken,
} from '../_shared/agentIdToken.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

let jwksCache: { at: number; value: unknown } | null = null;
async function fetchJwks() {
  if (jwksCache && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.value;
  const res = await fetch(AGENTID_JWKS_URL);
  if (!res.ok) throw new Error('AgentID keys unavailable');
  jwksCache = { at: Date.now(), value: await res.json() };
  return jwksCache.value;
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  const clientId = agentClientId(authHeader);
  if (!clientId) return json({ error: 'Only an AI agent signed in to Survey can do this.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const { data: { user }, error } = await createClient(supabaseUrl, anonKey).auth.getUser(
    (authHeader || '').replace(/^Bearer\s+/i, ''),
  );
  if (error || !user) return json({ error: 'Unauthorized' }, 401);

  if (req.method === 'GET') {
    return json({ agentid_client_id: AGENTID_CLIENT_ID, redirect_uri: AGENTID_REDIRECT_URI, scope: AGENTID_SCOPE });
  }
  if (req.method !== 'POST') return json({ error: 'Use GET or POST' }, 405);

  let idToken = '';
  try { idToken = String((await req.json())?.id_token || ''); } catch { /* checked below */ }
  const claims = await verifyAgentIdToken(idToken, { fetchJwks })
    .catch((e: unknown) => (e instanceof Error ? e : new Error('invalid')));
  if (claims instanceof Error) return json({ error: `AgentID token not accepted: ${claims.message}` }, 400);

  const record = agentIdRecord(claims);
  const service = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { error: saveError } = await service.from('agent_identities').upsert(
    { user_id: user.id, client_id: clientId, ...record, verified_at: new Date().toISOString() },
    { onConflict: 'user_id,client_id' },
  );
  if (saveError) return json({ error: 'Could not record it. Try again.' }, 500);
  return json({ recorded: true, agent: record.agentid_sub, owner_email: record.owner_email });
});
