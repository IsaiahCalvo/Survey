import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { createDocumentGenerationAdoptionHandler } from '../supabase/functions/document-generation-adoption/handler.js';
import { materializeAnnotationGenerationState } from '../src/services/annotationGenerationState.js';
import { createAdoptionHandlerFixture } from './helpers/adoptionHandlerFixture.mjs';

const read = async (handler, fixture, body) => {
  const response = await handler(fixture.request(body));
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  return value;
};

test('the composed adoption handler keeps one actor and five operation IDs through preview, confirm, and publish retry', async () => {
  const fixture = await createAdoptionHandlerFixture();
  const handler = createDocumentGenerationAdoptionHandler(fixture.options);
  const { actorUserId, documentId, adoptionOperationId, sourceId,
    candidateOperationId, archiveOperationIds } = fixture.identity;
  assert.equal(new Set([adoptionOperationId, sourceId, candidateOperationId,
    ...archiveOperationIds]).size, 5);
  const previewBody = { action: 'preview', document_id: documentId,
    adoption_operation_id: adoptionOperationId, source_id: sourceId,
    candidate_operation_id: candidateOperationId, archive_operation_ids: archiveOperationIds };

  const preview = await read(handler, fixture, previewBody);
  assert.equal(preview.state, 'review');
  assert.deepEqual({ actor: preview.actor_user_id, document: preview.document_id,
    adoption: preview.adoption_operation_id, source: preview.source_id,
    candidate: preview.candidate_operation_id, archives: preview.offered_archive_operation_ids },
  { actor: actorUserId, document: documentId, adoption: adoptionOperationId,
    source: sourceId, candidate: candidateOperationId, archives: archiveOperationIds });
  assert.equal(fixture.calls.source.every(call => call.args[0] === actorUserId
    && call.args[1].source_id === sourceId && call.args[2] === 1), true);
  assert.equal(fixture.calls.sourceBytes.filter(call => ['getV2', 'claimV2', 'recordV2'].includes(call.name))
    .every(call => call.args[0] === actorUserId && call.args[1] === sourceId), true);

  const confirmed = await read(handler, fixture, { action: 'confirm',
    adoption_operation_id: adoptionOperationId, review_sha256: preview.review_sha256 });
  assert.equal(confirmed.state, 'confirmed');
  const published = await read(handler, fixture, { action: 'publish',
    adoption_operation_id: adoptionOperationId, review_sha256: preview.review_sha256 });
  assert.equal(published.state, 'published');

  const prepare = fixture.calls.rpc.find(call => call.name === 'prepare_document_first_generation_adoption_service_v1');
  const review = fixture.calls.rpc.find(call => call.name === 'create_document_first_generation_adoption_review_service_v1');
  assert.deepEqual({ actor: review.params.p_actor_user_id, document: review.params.p_document_id,
    adoption: review.params.p_adoption_operation_id, source: review.params.p_source_id,
    candidate: review.params.p_candidate_operation_id, archives: review.params.p_archive_operation_ids },
  { actor: actorUserId, document: documentId, adoption: adoptionOperationId,
    source: sourceId, candidate: candidateOperationId, archives: archiveOperationIds });
  assert.deepEqual(Object.keys(prepare.params).sort(),
    ['p_actor_user_id', 'p_adoption_operation_id', 'p_operation', 'p_plan']);
  assert.equal(prepare.params.p_actor_user_id, actorUserId);
  assert.equal(prepare.params.p_adoption_operation_id, adoptionOperationId);
  assert.deepEqual(prepare.params.p_operation, { type: 'rotate', page: 1, delta: 0 });
  assert.equal(prepare.params.p_plan.version, 3);
  assert.equal(prepare.params.p_plan.contentModelVersion, 2);
  assert.equal(prepare.params.p_plan.aggregateAdmissionVersion, 1);
  assert.equal(prepare.params.p_plan.source.generationId, null);
  assert.equal(prepare.params.p_plan.source.contentModelVersion, 1);
  const checked = new Y.Doc();
  Y.applyUpdate(checked, Buffer.from(prepare.params.p_plan.baseline_base64, 'base64'));
  const checkedState = JSON.stringify(materializeAnnotationGenerationState(checked, 2));
  checked.destroy();
  assert.equal(checkedState.includes('private-book'), false);
  assert.equal(checkedState.includes('must-not-survive'), false);

  const beginCalls = fixture.calls.upload.filter(call => ['beginArchiveV2', 'beginV3'].includes(call.name));
  assert.deepEqual(beginCalls.map(call => call.args[1].operation_id),
    [archiveOperationIds[0], candidateOperationId]);
  assert.equal(beginCalls.every(call => call.args[0] === 'actor-token'
    && call.args[1].source_id === sourceId && call.args[2] === 1), true);
  assert.equal(fixture.calls.upload.filter(call => call.name === 'claim')
    .every(call => call.args[0] === actorUserId), true);
  assert.equal(fixture.calls.puts.length, 2);
  assert.deepEqual(fixture.calls.puts.map(call => call.bytes.byteLength),
    [fixture.pdfBytes.byteLength, fixture.pdfBytes.byteLength]);
  assert.equal(fixture.calls.puts.every(call => Buffer.from(call.bytes).equals(Buffer.from(fixture.pdfBytes))), true);

  const status = await read(handler, fixture, { action: 'status', adoption_operation_id: adoptionOperationId });
  const retry = await read(handler, fixture, { action: 'publish',
    adoption_operation_id: adoptionOperationId, review_sha256: preview.review_sha256 });
  assert.deepEqual(status, published);
  assert.deepEqual(retry, published);
  assert.equal(fixture.calls.upload.filter(call => ['beginArchiveV2', 'beginV3'].includes(call.name)).length, 2);
  assert.equal(fixture.calls.puts.length, 2);
  assert.equal(fixture.calls.rpc.filter(call => call.name === 'prepare_document_first_generation_adoption_service_v1').length, 1);
  assert.equal(fixture.calls.rpc.filter(call => call.name === 'publish_document_first_generation_adoption_service_v1').length, 1);
  assert.equal(fixture.calls.auth.every(token => token === 'actor-token'), true);
  assert.equal(fixture.calls.rpc.every(call => call.params.p_actor_user_id === actorUserId), true);
  assert.equal(fixture.calls.source.every(call => call.args[0] === actorUserId), true);
  assert.equal(fixture.calls.sourceBytes.filter(call => ['getV2', 'claimV2', 'recordV2'].includes(call.name))
    .every(call => call.args[0] === actorUserId), true);
});
