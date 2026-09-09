import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { handleDocumentGenerationSource } from './handler.js';

// Metadata-only preparation, off by default. Never a publication feature flag.
const enabled = Deno.env.get('SURVEY_GENERATION_SOURCE_CAPTURE') === 'v1-metadata-only';
const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
function client(key: string, signal: AbortSignal, token?: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => fetch(input, { ...init, signal }) },
  });
}
async function rpc(name: string, actor: string, input: Record<string, unknown>, signal: AbortSignal) {
  const params: Record<string, unknown> = { p_actor_user_id: actor, p_source_id: input.source_id };
  if (name === 'begin') Object.assign(params, { p_document_id: input.document_id, p_generation_id: input.generation_id });
  const { data, error } = await client(serviceKey, signal).rpc(`${name}_document_generation_source`, params);
  if (error) throw error;
  return data;
}
Deno.serve((request: Request) => handleDocumentGenerationSource(request, {
  enabled: enabled && !!url && !!anonKey && !!serviceKey,
  getUser: async (token: string, signal: AbortSignal) => {
    const { data, error } = await client(anonKey, signal, token).auth.getUser(token);
    return error ? null : data.user;
  },
  begin: (actor: string, input: Record<string, unknown>, signal: AbortSignal) => rpc('begin', actor, input, signal),
  get: (actor: string, input: Record<string, unknown>, signal: AbortSignal) => rpc('get', actor, input, signal),
  cancel: (actor: string, input: Record<string, unknown>, signal: AbortSignal) => rpc('cancel', actor, input, signal),
}));
