import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureManagedLocalEntityCatalog,
  createDocumentEntityCatalogClient,
  resolveDocumentEntityName,
  validateDocumentEntityCatalog,
  withDocumentEntities,
} from '../src/services/documentEntityCatalog.js';

const id = n => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const documentId = id(1);
const templateId = id(2);
const operationId = id(3);
const updatedAt = '2026-09-09T12:00:00.000Z';
const digest = 'a'.repeat(64);
const entity = (entityId, name, color = '#123456') => ({
  id: entityId,
  name,
  color,
  opacity: 0.7,
  borderColor: '#654321',
  borderOpacity: 0.4,
  matchFill: false,
});
const preview = (entities = [entity('owner', 'Owner')]) => ({
  status: 'preview', version: 1, documentId,
  source: { templateId, templateUpdatedAt: updatedAt, entitiesSha256: digest }, entities,
});
const accepted = (entities = preview().entities, seed = {
  operationId, requestSha256: 'b'.repeat(64),
}) => ({
  status: 'accepted', version: 1, documentId, catalogRevision: 1,
  source: { templateId, templateUpdatedAt: updatedAt, entitiesSha256: digest }, seed, entities,
});

test('cloud catalog needs a separate preview and adopt call and sends only the frozen review proof', async () => {
  const calls = [];
  const client = createDocumentEntityCatalogClient({ enabled: true,
    rpc: async (name, args) => {
      calls.push({ name, args: structuredClone(args) });
      if (name === 'read_document_entity_catalog') return { data: { status: 'unadopted', version: 1, documentId } };
      if (name === 'preview_document_entity_catalog_adoption') return { data: preview() };
      if (name === 'adopt_document_entity_catalog') return { data: accepted(preview().entities, {
        operationId: args.p_operation_id, requestSha256: args.p_request_sha256,
      }) };
      assert.fail(`unexpected RPC ${name}`);
    },
  });

  assert.equal((await client.read({ documentId })).status, 'unadopted');
  assert.equal(calls.length, 1, 'open/read must not seed the catalog');
  const reviewed = await client.preview({ documentId, templateId });
  assert.equal(calls.length, 2, 'preview must not seed the catalog');
  const result = await client.adopt({ preview: reviewed, operationId });
  assert.equal(result.status, 'accepted');
  assert.deepEqual(calls.map(call => call.name), [
    'read_document_entity_catalog',
    'preview_document_entity_catalog_adoption',
    'adopt_document_entity_catalog',
  ]);
  assert.deepEqual(Object.keys(calls[2].args).sort(), [
    'p_document_id', 'p_expected_entities_sha256', 'p_expected_template_updated_at',
    'p_operation_id', 'p_request_sha256', 'p_template_id',
  ]);
  assert.equal(calls[2].args.p_expected_template_updated_at, updatedAt);
  assert.equal(calls[2].args.p_expected_entities_sha256, digest);
  assert.ok(!Object.hasOwn(calls[2].args, 'entities'));
});

test('missing schema, disabled rollout, stale scope, and exact preview drift fail without adoption', async () => {
  let calls = 0;
  const disabled = createDocumentEntityCatalogClient({ enabled: false, rpc: async () => { calls++; } });
  await assert.rejects(disabled.read({ documentId }), { code: 'DOCUMENT_ENTITY_CATALOG_DISABLED' });
  assert.equal(calls, 0);

  const missing = createDocumentEntityCatalogClient({ enabled: true,
    rpc: async () => ({ error: { code: 'PGRST202' } }),
  });
  await assert.rejects(missing.read({ documentId }), { code: 'DOCUMENT_ENTITY_CATALOG_UNAVAILABLE' });

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(missing.preview({ documentId, templateId, signal: aborted.signal }), {
    code: 'DOCUMENT_ENTITY_CATALOG_STALE',
  });

  const drift = createDocumentEntityCatalogClient({ enabled: true,
    rpc: async name => name === 'adopt_document_entity_catalog'
      ? { error: { code: '40001' } }
      : { data: preview() },
  });
  const reviewed = await drift.preview({ documentId, templateId });
  await assert.rejects(drift.adopt({ preview: reviewed, operationId }), {
    code: 'DOCUMENT_ENTITY_CATALOG_CONFLICT',
  });

  for (const cause of [Object.assign(new Error('forbidden'), { code: '42501' }),
    Object.assign(new Error('forbidden'), { status: 403 })]) {
    const forbidden = createDocumentEntityCatalogClient({ enabled: true,
      rpc: async () => { throw cause; },
    });
    await assert.rejects(forbidden.read({ documentId }), {
      code: 'DOCUMENT_ENTITY_CATALOG_FORBIDDEN',
    });
  }
});

test('accepted catalog changes consumers without changing the template list or marker snapshots', () => {
  const legacy = [entity('legacy', 'Legacy')];
  const members = [entity('member', 'Member')];
  const template = Object.freeze({ id: templateId, entities: Object.freeze(legacy) });
  const marker = Object.freeze({ id: 'mark-1', entityId: 'legacy' });
  const before = structuredClone(marker);

  assert.equal(withDocumentEntities(template, { status: 'unadopted', version: 1, documentId }), template);
  const resolved = withDocumentEntities(template, validateDocumentEntityCatalog(accepted(members), documentId));
  assert.notEqual(resolved, template);
  assert.equal(resolved.entities[0].name, 'Member');
  assert.equal(template.entities[0].name, 'Legacy', 'template editing data stays unchanged');
  assert.deepEqual(marker, before, 'stored marker identity and style remain marker-owned');
  assert.equal(resolveDocumentEntityName('  MEMBER  ', resolved.entities).entity.id, 'member');
  assert.equal(resolveDocumentEntityName('Legacy', resolved.entities).status, 'unknown');
});

test('managed-local capture binds the accepted list to stable localId and template revision', async () => {
  const localId = `local:${id(9)}`;
  const catalog = await captureManagedLocalEntityCatalog({ localId, template: {
    id: 'local-template', updatedAt, entities: [entity('local-owner', 'Local Owner')],
  } });
  assert.equal(catalog.documentId, localId);
  assert.equal(catalog.sourceTemplateId, 'local-template');
  assert.equal(catalog.sourceTemplateUpdatedAt, updatedAt);
  assert.equal(catalog.entities[0].name, 'Local Owner');
  await assert.rejects(captureManagedLocalEntityCatalog({ localId: `local:${id(8)}`, template: {
    id: 'local-template', updatedAt: 'not-a-time', entities: [],
  } }), { code: 'DOCUMENT_ENTITY_CATALOG_INVALID' });
});
