import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { handleDocumentGenerationUpload } from './handler.js';

// Do not enable merely because a migration or unit test passed. The deployed
// standard-upload backend must use distinct physical version keys and preserve
// the accepted version when our final metadata guard rejects a replacement.
const enabled = Deno.env.get('SURVEY_GENERATION_STORAGE_CONTRACT') === 'versioned-standard-v1';
const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function client(key: string, signal: AbortSignal, token?: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => fetch(input, { ...init, signal }),
    },
  });
}
const caller = (token: string, signal: AbortSignal) => client(anonKey, signal, token);
const admin = (signal: AbortSignal) => client(serviceKey, signal);
async function rpc(connection: ReturnType<typeof client>, name: string, params: Record<string, unknown>) {
  const { data, error } = await connection.rpc(name, params);
  if (error) throw error;
  return data;
}

Deno.serve((request: Request) => handleDocumentGenerationUpload(request, {
  enabled: enabled && !!url && !!anonKey && !!serviceKey,
  getUser: async (token: string, signal: AbortSignal) => {
    const { data, error } = await caller(token, signal).auth.getUser(token);
    return error ? null : data.user;
  },
  begin: (token: string, input: Record<string, unknown>, signal: AbortSignal) => rpc(caller(token, signal),
    'begin_document_generation_upload', { p_document_id: input.document_id, p_operation_id: input.operation_id,
      p_content_sha256: input.content_sha256, p_byte_length: input.byte_length }),
  get: (token: string, operationId: string, signal: AbortSignal) => rpc(caller(token, signal),
    'get_document_generation_upload', { p_operation_id: operationId }),
  cancel: (token: string, operationId: string, signal: AbortSignal) => rpc(caller(token, signal),
    'cancel_document_generation_upload', { p_operation_id: operationId }),
  mint: async (path: string, signal: AbortSignal) => {
    const { data, error } = await admin(signal).storage.from('documents').createSignedUploadUrl(path, { upsert: false });
    if (error) throw error;
    return data;
  },
  claim: (actor: string, operationId: string, claimId: string, signal: AbortSignal) => rpc(admin(signal),
    'claim_document_generation_upload_verification', { p_actor_user_id: actor, p_operation_id: operationId,
      p_claim_id: claimId }),
  openStream: async (path: string, signal: AbortSignal) => {
    const { data, error } = await admin(signal).storage.from('documents').setHeader('Cache-Control', 'no-cache')
      .download(path, { cacheNonce: crypto.randomUUID() }, { cache: 'no-store', signal }).asStream();
    if (error) throw error;
    return data;
  },
  record: (actor: string, operationId: string, claimId: string, objectId: string, objectVersion: string,
    contentSha256: string, byteLength: string, signal: AbortSignal) => rpc(admin(signal),
    'record_document_generation_upload_verification', { p_actor_user_id: actor, p_operation_id: operationId,
      p_claim_id: claimId, p_object_id: objectId, p_object_version: objectVersion,
      p_content_sha256: contentSha256, p_byte_length: byteLength }),
  release: (actor: string, operationId: string, claimId: string, signal: AbortSignal) => rpc(admin(signal),
    'release_document_generation_upload_verification', { p_actor_user_id: actor, p_operation_id: operationId,
      p_claim_id: claimId }),
  reject: (actor: string, operationId: string, claimId: string, objectId: string, objectVersion: string,
    contentSha256: string, byteLength: string, signal: AbortSignal) => rpc(admin(signal),
    'reject_document_generation_upload_verification', { p_actor_user_id: actor, p_operation_id: operationId,
      p_claim_id: claimId, p_object_id: objectId, p_object_version: objectVersion,
      p_content_sha256: contentSha256, p_byte_length: byteLength }),
}));
