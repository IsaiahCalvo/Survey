import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { encodeSourceObjectPath, handleDocumentGenerationSourceBytes } from './handler.js';

// The operator must verify physical-version and exact download-path behavior.
// Neither migration success nor metadata capture enables this byte verifier.
const enabled = Deno.env.get('SURVEY_GENERATION_SOURCE_CAPTURE') === 'v1-metadata-only'
  && Deno.env.get('SURVEY_GENERATION_STORAGE_CONTRACT') === 'versioned-standard-v1';
const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
function client(key: string, signal: AbortSignal, token?: string) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => fetch(input, { ...init, signal }) } });
}
async function rpc(name: string, actor: string, sourceId: string, signal: AbortSignal, extra = {}) {
  const { data, error } = await client(serviceKey, signal).rpc(`${name}_document_generation_source_bytes`,
    { p_actor_user_id: actor, p_source_id: sourceId, ...extra });
  if (error) throw error;
  return data;
}
Deno.serve((request: Request) => handleDocumentGenerationSourceBytes(request, {
  enabled: enabled && !!url && !!anonKey && !!serviceKey,
  getUser: async (token: string, signal: AbortSignal) => {
    const { data, error } = await client(anonKey, signal, token).auth.getUser(token);
    return error ? null : data.user;
  },
  get: (actor: string, sourceId: string, signal: AbortSignal) => rpc('get', actor, sourceId, signal),
  claim: (actor: string, sourceId: string, claimId: string, signal: AbortSignal) =>
    rpc('claim', actor, sourceId, signal, { p_claim_id: claimId }),
  record: (actor: string, sourceId: string, claimId: string, objects: unknown[], signal: AbortSignal) =>
    rpc('record', actor, sourceId, signal, { p_claim_id: claimId, p_objects: objects }),
  release: (actor: string, sourceId: string, claimId: string, signal: AbortSignal) =>
    rpc('release', actor, sourceId, signal, { p_claim_id: claimId }),
  openStream: async (object: { path: string }, signal: AbortSignal) => {
    const { data, error } = await client(serviceKey, signal).storage.from('documents').setHeader('Cache-Control', 'no-cache')
      .download(encodeSourceObjectPath(object.path), { cacheNonce: crypto.randomUUID() }, { cache: 'no-store', signal }).asStream();
    if (error) throw error;
    return data;
  },
}));
