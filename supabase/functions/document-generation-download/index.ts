import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { encodeSourceObjectPath } from '../document-generation-source-bytes/handler.js';
import { handleDocumentGenerationDownload } from './handler.js';

// No SQL migration or code deployment enables this endpoint on its own.
const enabled = Deno.env.get('SURVEY_GENERATION_DOWNLOAD') === 'checked-stream-v1'
  && Deno.env.get('SURVEY_GENERATION_STORAGE_CONTRACT') === 'versioned-standard-v1';
const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
function client(key: string, signal: AbortSignal, token?: string) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => fetch(input, { ...init, signal, redirect: 'error' }) } });
}
Deno.serve((request: Request) => handleDocumentGenerationDownload(request, {
  enabled: enabled && !!url && !!anonKey && !!serviceKey,
  getUser: async (token: string, signal: AbortSignal) => {
    const { data, error } = await client(anonKey, signal, token).auth.getUser(token);
    return error ? null : data.user;
  },
  readOpen: async (token: string, documentId: string, generationId: string, signal: AbortSignal) => {
    // The current user's JWT, never a service-role RPC, establishes authority.
    const { data, error } = await client(anonKey, signal, token).rpc('read_document_generation_open', {
      p_document_id: documentId, p_generation_id: generationId, p_include_snapshot: false,
    });
    if (error) throw error;
    return data;
  },
  readLegacySidecar: async (token: string, documentId: string, generationId: string, signal: AbortSignal) => {
    // The checked RPC requires the current owner and retained source provenance.
    const { data, error } = await client(anonKey, signal, token).rpc('read_document_generation_legacy_sidecar_archive_v1', {
      p_document_id: documentId, p_generation_id: generationId,
    });
    if (error) throw error;
    return data;
  },
  openStream: async (pdf: { bucket_id: string; path: string }, signal: AbortSignal) => {
    const { data, error } = await client(serviceKey, signal).storage.from(pdf.bucket_id)
      .setHeader('Cache-Control', 'no-cache')
      .download(encodeSourceObjectPath(pdf.path), { cacheNonce: crypto.randomUUID() }, { cache: 'no-store', signal }).asStream();
    if (error) throw error;
    return data;
  },
}));
