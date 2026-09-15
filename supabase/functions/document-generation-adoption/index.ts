import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { createDocumentGenerationAdoptionHandler } from './handler.js';

const enabled = Deno.env.get('SURVEY_FIRST_GENERATION_ADOPTION') === 'v1-explicit-owner-consent'
  && Deno.env.get('SURVEY_GENERATION_SOURCE_CAPTURE') === 'v1-metadata-only'
  && Deno.env.get('SURVEY_GENERATION_SOURCE_ARCHIVES') === 'v1-complete-source'
  && Deno.env.get('SURVEY_GENERATION_STORAGE_CONTRACT') === 'versioned-standard-v1';
const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
function client(key: string, signal: AbortSignal, token?: string) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => fetch(input, { ...init, signal }) } });
}
const caller = (token: string, signal: AbortSignal) => client(anonKey, signal, token);
const admin = (signal: AbortSignal) => client(serviceKey, signal);
async function rpc(connection: ReturnType<typeof client>, name: string, params: Record<string, unknown>) {
  const { data, error } = await connection.rpc(name, params); return { data, error };
}
const unwrap = async (value: Promise<{ data: unknown; error: unknown }>) => {
  const result = await value; if (result.error) throw result.error; return result.data;
};

Deno.serve(createDocumentGenerationAdoptionHandler({
  enabled: enabled && !!url && !!anonKey && !!serviceKey,
  getUser: async (token: string, signal: AbortSignal) => {
    const { data, error } = await caller(token, signal).auth.getUser(token); return error ? null : data.user;
  },
  privateRpc: (name: string, params: Record<string, unknown>, { signal }: { signal: AbortSignal }) =>
    rpc(admin(signal), name, params),
  putSignedUpload: async (upload: { path: string; token: string }, blob: Blob,
    { signal }: { signal: AbortSignal }) => {
    const { data, error } = await admin(signal).storage.from('documents')
      .uploadToSignedUrl(upload.path, upload.token, blob, { upsert: false });
    if (error) throw error; return data;
  },
  serviceClients: {
    source: {
      beginV2: (actor: string, input: Record<string, unknown>, _model: number, signal: AbortSignal) => unwrap(rpc(admin(signal),
        'begin_document_generation_source_v2', { p_actor_user_id: actor, p_document_id: input.document_id,
          p_source_id: input.source_id, p_generation_id: input.generation_id, p_content_model_version: 1 })),
    },
    sourceBytes: {
      getV2: (actor: string, sourceId: string, _model: number, signal: AbortSignal) => unwrap(rpc(admin(signal),
        'get_document_generation_source_v2', { p_actor_user_id: actor, p_source_id: sourceId,
          p_content_model_version: 1 })),
      claimV2: (actor: string, sourceId: string, claimId: string, _model: number, signal: AbortSignal) => unwrap(rpc(admin(signal),
        'claim_document_generation_source_bytes_v2', { p_actor_user_id: actor, p_source_id: sourceId,
          p_claim_id: claimId, p_content_model_version: 1 })),
      recordV2: (actor: string, sourceId: string, claimId: string, objects: unknown[], _model: number,
        signal: AbortSignal) => unwrap(rpc(admin(signal), 'record_document_generation_source_bytes_v2', {
          p_actor_user_id: actor, p_source_id: sourceId, p_claim_id: claimId, p_objects: objects,
          p_content_model_version: 1 })),
      release: (actor: string, sourceId: string, claimId: string, signal: AbortSignal) => unwrap(rpc(admin(signal),
        'release_document_generation_source_bytes', { p_actor_user_id: actor, p_source_id: sourceId, p_claim_id: claimId })),
      openStream: async (object: { path: string }, signal: AbortSignal) => {
        const { data, error } = await admin(signal).storage.from('documents').setHeader('Cache-Control', 'no-cache')
          .download(object.path, { cacheNonce: crypto.randomUUID() }, { cache: 'no-store', signal }).asStream();
        if (error) throw error; return data;
      },
    },
    upload: {
      beginV3: (token: string, input: Record<string, unknown>, _model: number, signal: AbortSignal) => unwrap(rpc(caller(token, signal),
        'begin_document_generation_upload_v3', { p_source_id: input.source_id, p_operation_id: input.operation_id,
          p_purpose: input.purpose, p_content_sha256: input.content_sha256, p_byte_length: input.byte_length,
          p_content_model_version: 1 })),
      beginArchiveV2: (token: string, input: Record<string, unknown>, _model: number, signal: AbortSignal) => unwrap(rpc(caller(token, signal),
        'begin_document_generation_source_archive_v2', { p_source_id: input.source_id, p_operation_id: input.operation_id,
          p_source_object_id: input.source_object_id, p_content_model_version: 1 })),
      get: (token: string, operationId: string, signal: AbortSignal) => unwrap(rpc(caller(token, signal),
        'get_document_generation_upload', { p_operation_id: operationId })),
      mint: async (path: string, signal: AbortSignal) => {
        const { data, error } = await admin(signal).storage.from('documents').createSignedUploadUrl(path, { upsert: false });
        if (error) throw error; return data;
      },
      claim: (actor: string, operationId: string, claimId: string, signal: AbortSignal) => unwrap(rpc(admin(signal),
        'claim_document_generation_upload_verification', { p_actor_user_id: actor, p_operation_id: operationId, p_claim_id: claimId })),
      openStream: async (path: string, signal: AbortSignal) => {
        const { data, error } = await admin(signal).storage.from('documents').setHeader('Cache-Control', 'no-cache')
          .download(path, { cacheNonce: crypto.randomUUID() }, { cache: 'no-store', signal }).asStream();
        if (error) throw error; return data;
      },
      record: (actor: string, operationId: string, claimId: string, objectId: string, objectVersion: string,
        contentSha256: string, byteLength: string, signal: AbortSignal) => unwrap(rpc(admin(signal),
        'record_document_generation_upload_verification', { p_actor_user_id: actor, p_operation_id: operationId,
          p_claim_id: claimId, p_object_id: objectId, p_object_version: objectVersion,
          p_content_sha256: contentSha256, p_byte_length: byteLength })),
      release: (actor: string, operationId: string, claimId: string, signal: AbortSignal) => unwrap(rpc(admin(signal),
        'release_document_generation_upload_verification', { p_actor_user_id: actor, p_operation_id: operationId, p_claim_id: claimId })),
      reject: (actor: string, operationId: string, claimId: string, objectId: string, objectVersion: string,
        contentSha256: string, byteLength: string, signal: AbortSignal) => unwrap(rpc(admin(signal),
        'reject_document_generation_upload_verification', { p_actor_user_id: actor, p_operation_id: operationId,
          p_claim_id: claimId, p_object_id: objectId, p_object_version: objectVersion,
          p_content_sha256: contentSha256, p_byte_length: byteLength })),
    },
  },
}));
