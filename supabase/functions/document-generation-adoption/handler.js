import { createHash } from 'node:crypto';
import { createDocumentFirstGenerationAdoptionRequestHandler } from '../../../src/services/documentFirstGenerationAdoptionRequest.js';
import { prepareDocumentFirstGenerationAdoption } from '../../../src/services/documentFirstGenerationAdoptionTransform.js';
import { handleDocumentGenerationSource } from '../document-generation-source/handler.js';
import { handleDocumentGenerationSourceBytes } from '../document-generation-source-bytes/handler.js';
import { handleDocumentGenerationUpload } from '../document-generation-upload/handler.js';

const check = value => { if (!value) throw Object.assign(new Error('invalid receipt'), { code: '23514' }); };
const json = async response => {
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error('child request failed'), { code: value?.error?.code ?? '23514' });
  return value;
};
const child = (token, body, signal) => new Request('https://adoption.internal/', { method: 'POST', signal,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function bytesFrom(stream, expected, signal) {
  const reader = stream.getReader(), output = new Uint8Array(Number(expected)); let offset = 0;
  try {
    for (;;) {
      if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'temporarily_unavailable' });
      const { value, done } = await reader.read(); if (done) break;
      check(value instanceof Uint8Array && offset + value.byteLength <= output.byteLength);
      output.set(value, offset); offset += value.byteLength;
    }
    check(offset === output.byteLength); return output;
  } finally { try { reader.releaseLock(); } catch { /* pending read */ } }
}

// Kept separate so the lost-reply storage state has a direct regression test.
// `runUpload` always invokes the authenticated upload route; only that route
// may decide whether the durable object and operation still match.
export async function stageDocumentGenerationAdoptionUpload({ runUpload, putSignedUpload, signal, body, blob }) {
  let value = await runUpload(body);
  if (value.operation?.state === 'reserved') {
    // A signed PUT can commit while this edge invocation loses its verify
    // reply. Its durable operation then has an exact object but is still
    // reserved; retry verification without another PUT or signed URL.
    if (value.operation.object === null) {
      check(value.upload?.path && value.upload.token && value.upload.signedUrl);
      await putSignedUpload(value.upload, blob, { signal });
    }
    value = await runUpload({ action: 'verify', operation_id: body.operation_id });
  }
  check(value.operation?.state === 'verified'); return value.operation;
}

export function createDocumentGenerationAdoptionHandler(options) {
  const { enabled, getUser, serviceClients, privateRpc, putSignedUpload } = options;
  const rpc = async (name, params, signal) => {
    const result = await privateRpc(name, params, { signal });
    if (result.error) throw Object.assign(new Error('rpc failed'), { code: result.error.code });
    return result.data;
  };
  const actorUser = (actor, token) => async received => received === token ? { id: actor } : null;
  const invoke = async (handler, token, actor, body, deps, signal) => json(await handler(child(token, body, signal), {
    ...deps, enabled: true, getUser: actorUser(actor, token), contentModelVersion: 1,
  }));
  async function capture(actor, token, identity, signal) {
    await invoke(handleDocumentGenerationSource, token, actor, { action: 'begin', source_id: identity.sourceId,
      document_id: identity.documentId, generation_id: null }, serviceClients.source, signal);
    const captures = new Map();
    const byteDeps = { ...serviceClients.sourceBytes,
      async openStream(descriptor, innerSignal) {
        const bytes = await bytesFrom(await serviceClients.sourceBytes.openStream(descriptor, innerSignal),
          descriptor.byte_length, innerSignal);
        captures.set(descriptor.id, bytes);
        return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
      } };
    const verified = await invoke(handleDocumentGenerationSourceBytes, token, actor,
      { action: 'verify', source_id: identity.sourceId }, byteDeps, signal);
    const proof = verified.attestation;
    check(proof?.state === 'verified' && Array.isArray(proof.objects) && proof.objects.length >= 1 && proof.objects.length <= 2);
    for (const descriptor of proof.objects) if (!captures.has(descriptor.id)) {
      const bytes = await bytesFrom(await serviceClients.sourceBytes.openStream(descriptor, signal), descriptor.byte_length, signal);
      check(createHash('sha256').update(bytes).digest('hex') === descriptor.content_sha256);
      captures.set(descriptor.id, bytes);
    }
    const envelope = await rpc('read_document_generation_transform_source_v2', {
      p_actor_user_id: actor, p_source_id: identity.sourceId, p_content_model_version: 1,
    }, signal);
    const prepared = await prepareDocumentFirstGenerationAdoption({ actorUserId: actor,
      documentId: identity.documentId, adoptionOperationId: identity.adoptionOperationId,
      sourceId: identity.sourceId, candidateOperationId: identity.candidateOperationId,
      archiveOperationIds: identity.archiveOperationIds, envelope,
      objects: proof.objects.map(item => ({ id: item.id, version: item.version, bytes: captures.get(item.id) })) });
    for (const bytes of captures.values()) bytes.fill(0);
    return { prepared, proof };
  }
  async function stage(actor, token, signal, body, blob) {
    const runUpload = requestBody => invoke(handleDocumentGenerationUpload, token, actor, requestBody,
      { ...serviceClients.upload, sourceBoundEnabled: true, archiveEnabled: true }, signal);
    return stageDocumentGenerationAdoptionUpload({ runUpload, putSignedUpload, signal, body, blob });
  }
  const status = ({ actorUserId, input, signal }) => rpc('read_document_first_generation_adoption_service_v1', {
    p_actor_user_id: actorUserId, p_adoption_operation_id: input.adoption_operation_id,
  }, signal);
  return createDocumentFirstGenerationAdoptionRequestHandler({ enabled, getUser, status,
    confirm: ({ actorUserId, input, signal }) => rpc('confirm_document_first_generation_adoption_service_v1', {
      p_actor_user_id: actorUserId, p_adoption_operation_id: input.adoption_operation_id,
      p_review_sha256: input.review_sha256,
    }, signal),
    preview: async ({ actorUserId: actor, accessToken: token, input, signal }) => {
      const existing = await status({ actorUserId: actor, input, signal });
      if (existing?.state !== 'missing') return existing;
      const identity = { documentId: input.document_id, adoptionOperationId: input.adoption_operation_id,
        sourceId: input.source_id, candidateOperationId: input.candidate_operation_id,
        archiveOperationIds: input.archive_operation_ids };
      const { prepared } = await capture(actor, token, identity, signal);
      try {
        return await rpc('create_document_first_generation_adoption_review_service_v1', {
          p_actor_user_id: actor, p_document_id: identity.documentId,
          p_adoption_operation_id: identity.adoptionOperationId, p_source_id: identity.sourceId,
          p_candidate_operation_id: identity.candidateOperationId, p_archive_operation_ids: identity.archiveOperationIds,
          p_canonical_annotations: prepared.canonicalAnnotations,
          p_sidecar_entity_policy: prepared.sidecarEntityPolicy,
        }, signal);
      } finally { prepared.candidate.bytes.fill(0); }
    },
    publish: async ({ actorUserId: actor, accessToken: token, input, signal }) => {
      const saved = await status({ actorUserId: actor, input, signal });
      if (saved?.state === 'published') return saved;
      check(saved?.state === 'confirmed' && saved.review_sha256 === input.review_sha256);
      const identity = { documentId: saved.document_id, adoptionOperationId: saved.adoption_operation_id,
        sourceId: saved.source_id, candidateOperationId: saved.candidate_operation_id,
        archiveOperationIds: saved.offered_archive_operation_ids };
      const { prepared, proof } = await capture(actor, token, identity, signal);
      check(prepared.canonicalAnnotations.baseline_sha256 === saved.canonical_annotations.baseline_sha256);
      for (let index = 0; index < proof.objects.length; index++) {
        const item = proof.objects[index], bytes = await bytesFrom(
          await serviceClients.sourceBytes.openStream(item, signal), item.byte_length, signal);
        await stage(actor, token, signal, { action: 'begin-archive', operation_id: identity.archiveOperationIds[index],
          source_id: identity.sourceId, source_object_id: item.id },
        new Blob([bytes], { type: item.kind === 'pdf' ? 'application/pdf' : 'application/json' }));
        bytes.fill(0);
      }
      const candidateBytes = prepared.candidate.bytes;
      await stage(actor, token, signal, { action: 'begin', operation_id: identity.candidateOperationId,
        source_id: identity.sourceId, purpose: 'candidate-pdf', content_sha256: prepared.candidate.contentSha256,
        byte_length: prepared.candidate.byteLength }, new Blob([candidateBytes], { type: 'application/pdf' }));
      candidateBytes.fill(0);
      await rpc('prepare_document_first_generation_adoption_service_v1', {
        p_actor_user_id: actor, p_adoption_operation_id: identity.adoptionOperationId,
        p_operation: prepared.plan.operation, p_plan: prepared.plan }, signal);
      return rpc('publish_document_first_generation_adoption_service_v1', {
        p_actor_user_id: actor, p_adoption_operation_id: identity.adoptionOperationId,
        p_review_sha256: input.review_sha256 }, signal);
    },
  });
}
