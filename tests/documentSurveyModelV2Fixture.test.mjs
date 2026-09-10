import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentSurveyModelV2Fixture, MODEL2_FIXTURE_IDS } from '../src/dev/documentSurveyModelV2Fixture.js';
import { IDBFactory } from 'fake-indexeddb';
import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { createGenerationCollaborationSession } from '../src/lib/collab/generationCollaborationSession.js';
import { buildEraseIntent } from '../src/utils/annotationEraseTransaction.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('Fixture provider did not settle');
}

test('model 2 browser fixture issues a checked bundle and blocks out-of-scope RPCs', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: new Blob([
    new TextEncoder().encode('%PDF-1.4\n%%EOF\n'),
  ], { type: 'application/pdf' }) });
  t.after(() => backend.destroy());
  const bundle = await backend.read();
  assert.equal(bundle.documentId, MODEL2_FIXTURE_IDS.documentId);
  assert.equal(bundle.contentModelVersion, 2);
  assert.deepEqual(backend.inspect().markerIds, ['fixture-marker-left', 'fixture-marker-right']);
  assert.equal(backend.inspect().annotationId, 'fixture-ordinary-rect');
  assert.equal(backend.inspect().regionId, 'fixture-region');
  assert.deepEqual({ spaces: backend.inspect().spaceCount, pages: backend.inspect().assignedPageCount,
    regions: backend.inspect().regionCount, annotations: backend.inspect().annotationCount,
    baseline: backend.inspect().baselineSemanticMatch },
  { spaces: 1, pages: 1, regions: 1, annotations: 1, baseline: true });
  await assert.rejects(Promise.resolve(backend.client.rpc('unexpected_live_call', {
    p_document_id: MODEL2_FIXTURE_IDS.documentId,
    p_generation_id: MODEL2_FIXTURE_IDS.generationId,
    p_content_model_version: 2,
  })), /Live service blocked/);
  await assert.rejects(Promise.resolve(backend.client.rpc('read_annotation_snapshot_v3', {
    p_document_id: crypto.randomUUID(), p_generation_id: MODEL2_FIXTURE_IDS.generationId,
    p_content_model_version: 2,
  })), /Fixture scope rejected/);
});

test('fixture client opens the actual model 2 service with realtime enabled', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: new Blob([
    new TextEncoder().encode('%PDF-1.4\n%%EOF\n'),
  ], { type: 'application/pdf' }) });
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const doc = createDetachedYDoc();
  const bundle = await backend.read();
  const handle = await openAnnotationDoc({ documentId: MODEL2_FIXTURE_IDS.documentId,
    actorUserId: MODEL2_FIXTURE_IDS.actorUserId, pdfGenerationId: MODEL2_FIXTURE_IDS.generationId,
    checkedBundle: bundle, supabase: backend.client, outboxStore: outbox,
    enableLocal: false, doc, writerId: 'fixture-realtime-test',
    eraseEffectConsumer: async () => {} });
  t.after(async () => { await handle.destroy(); await outbox.close(); doc.destroy(); backend.destroy(); });
  assert.equal(handle.contentModelVersion, 2);
  assert.equal(handle.getSyncStatus().healthy, true);
  await backend.client.realtime.setAuth('fixture-local-token');
  await assert.rejects(backend.client.realtime.setAuth('unknown-token'), /auth rejected/);
  const runtime = createGenerationCollaborationSession({ checkedBundle: bundle,
    generationSession: handle, client: backend.client,
    getCurrentActorUserId: () => MODEL2_FIXTURE_IDS.actorUserId,
    isCurrentOpen: () => true, isActive: true,
    windowTarget: new EventTarget(), documentTarget: new EventTarget() });
  t.after(() => runtime.dispose());
  await until(() => runtime.getState().authorityStatus === 'confirmed');
  assert.equal(runtime.getState().docRole, 'owner');
  assert.equal(runtime.getState().accessRevoked, false);
  const marker = handle.getSurveyState().surveyMarkers['fixture-marker-left'];
  const erased = await handle.commitEraseIntent(buildEraseIntent({
    mutationId: 'fixture-realistic-erase', pageNumber: 1, renderer: 'svg',
    gesture: { points: [{ x: 90, y: 110 }], radius: 8, mode: 'whole' },
    surveyMarkerTargets: [{ markerId: 'fixture-marker-left', expectedMarker: marker }],
    sideEffects: [
      { type: 'trash', targetKey: 'fixture-marker-left', payload: { before: structuredClone(marker) } },
      { type: 'history', targetKey: 'fixture-marker-left', payload: { before: structuredClone(marker) } },
    ],
  }), { permissionContext: { mode: 'registered', viewerId: MODEL2_FIXTURE_IDS.actorUserId,
    documentOwnerId: MODEL2_FIXTURE_IDS.actorUserId }, validateSurveyTarget: () => true });
  assert.equal(erased.status, 'committed');
  let effectDrain;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    effectDrain = await handle.drainEraseOutbox();
    await tick(); await handle.drain();
    if (effectDrain.pending === 0) break;
  }
  assert.equal(effectDrain?.pending, 0);
  const reopenedBundle = await backend.read();
  assert.equal(reopenedBundle.publication.wal_head, '0');
  assert.ok(BigInt(backend.inspect().walHead) > 0n);
  assert.equal(runtime.getState().authorityStatus, 'confirmed');
  const reopenedOutbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const reopenedDoc = createDetachedYDoc();
  const reopened = await openAnnotationDoc({ documentId: MODEL2_FIXTURE_IDS.documentId,
    actorUserId: MODEL2_FIXTURE_IDS.actorUserId, pdfGenerationId: MODEL2_FIXTURE_IDS.generationId,
    checkedBundle: reopenedBundle, supabase: backend.client, outboxStore: reopenedOutbox,
    enableLocal: false, doc: reopenedDoc, writerId: 'fixture-reopen-test' });
  t.after(async () => { await reopened.destroy(); await reopenedOutbox.close(); reopenedDoc.destroy(); });
  assert.equal(reopened.getSurveyState().surveyMarkers['fixture-marker-left'], undefined);
});
