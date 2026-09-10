import { Buffer } from 'node:buffer';

const CODES = new Set(['22003', '22023', '23505', '40001', '42501', '54000', '55000',
  '55P03', '57014', 'PGRST202', 'PGRST301', 'PGRST302', 'SG001', 'SG002', 'SG003', 'SG004']);

function safeError(value) {
  const code = CODES.has(value?.code) ? value.code : 'unconfirmed';
  return Object.assign(new Error(code), { code });
}

function retryableAuthError(value) {
  const status = value?.status;
  return value?.name === 'AuthRetryableFetchError' || status === 0 || status === 429
    || (Number.isInteger(status) && status >= 500);
}

function bytea(bytes) {
  if (!(bytes instanceof Uint8Array)) throw safeError(null);
  return `\\x${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex')}`;
}

async function rpc(connection, name, params) {
  let result;
  try { result = await connection.rpc(name, params); }
  catch (error) { throw safeError(error); }
  if (result?.error) throw safeError(result.error);
  return result?.data;
}

/** Production field adapter. Caller clients carry the verified bearer token;
 * service clients can reach only the service-role broker functions. */
export function createAnnotationGenerationAggregateSupabaseAdapter({ caller, service }) {
  if (typeof caller !== 'function' || typeof service !== 'function') throw safeError(null);
  return Object.freeze({
    async getUser(token, signal) {
      let result;
      try { result = await caller(token, signal).auth.getUser(token); }
      catch (error) { throw safeError(error); }
      if (result?.error) {
        if (retryableAuthError(result.error)) throw safeError(result.error);
        return null;
      }
      return result?.data?.user ?? null;
    },
    probe(actor, input, signal) {
      return rpc(service(signal), 'probe_annotation_generation_aggregate_receipt_service_v1', {
        p_actor_user_id: actor,
        p_document_id: input.documentId,
        p_generation_id: input.generationId,
        p_content_model_version: input.contentModelVersion,
        p_client_id: input.writerId,
        p_client_seq: input.clientSeq,
        p_data: bytea(input.update),
      });
    },
    readFixedCheckpoint(actor, input, signal) {
      return rpc(service(signal), 'read_annotation_generation_aggregate_checkpoint_service_v1', {
        p_actor_user_id: actor,
        p_document_id: input.documentId,
        p_generation_id: input.generationId,
        p_content_model_version: input.contentModelVersion,
      });
    },
    readFixedTailPage(token, input, signal) {
      return rpc(caller(token, signal), 'read_annotation_updates_v3', {
        p_document_id: input.documentId,
        p_generation_id: input.generationId,
        p_content_model_version: input.contentModelVersion,
        p_after_seq: input.afterSeq,
        p_through_seq: input.throughSeq,
        p_limit: input.limit,
      });
    },
    commit(actor, input, signal) {
      const source = input.sourceCheckpoint;
      const checkpoint = input.checkpoint;
      return rpc(service(signal), 'commit_annotation_generation_aggregate_service_v1', {
        p_actor_user_id: actor,
        p_document_id: input.documentId,
        p_generation_id: input.generationId,
        p_content_model_version: input.contentModelVersion,
        p_client_id: input.writerId,
        p_client_seq: input.clientSeq,
        p_data: bytea(input.update),
        p_expected_head: input.expectedHead,
        p_expected_checkpoint_at_seq: source.atSeq,
        p_expected_checkpoint_writer_id: source.writerId,
        p_expected_checkpoint_writer_epoch: source.writerEpoch,
        p_expected_checkpoint_encoding_version: source.encodingVersion,
        p_expected_checkpoint_sha256: source.snapshotSha256,
        p_result_checkpoint: checkpoint === null ? null : bytea(checkpoint.bytes),
        p_result_checkpoint_encoding_version: checkpoint === null ? null : checkpoint.encodingVersion,
      });
    },
  });
}
