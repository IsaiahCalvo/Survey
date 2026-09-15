import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentDefinitionRevisionCache } from '../src/services/documentDefinitionRevisionCache.js';

const id = n => `f1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACTOR = id(1);
const OTHER_ACTOR = id(2);
const DOCUMENT = id(3);
const OTHER_DOCUMENT = id(4);
const TEMPLATE = id(5);
const OPERATION = id(6);
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const UPDATED = '2026-09-15T12:00:00Z';
const ROOTS = Object.freeze([{ kind:'module', id:'module-old' }]);
const ARCHIVES = Object.freeze([
  { kind:'module', id:'module-old' },
  { kind:'category', id:'category-old' },
  { kind:'checklistItem', id:'check-old' },
]);
const PRIOR_ARCHIVE = Object.freeze({ kind:'checklistItem', id:'check-prior' });

const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
  : JSON.stringify(value);
const digest = async value => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

async function currentReceipt(archivedSemanticIds = []) {
  const content = { version:1, documentId:DOCUMENT, definitionRevision:1,
    surveyDefinition:{ source:{ templateId:TEMPLATE, templateUpdatedAt:UPDATED,
      structureSha256:SHA_A }, modules:[{ id:'module-old', name:'Old module', categories:[{
        id:'category-old', name:'Old category', checklist:[{ id:'check-old', text:'Old check' },
          { id:'check-prior', text:'Prior check' }],
      }] }] },
    entityCatalog:{ source:{ templateId:TEMPLATE, templateUpdatedAt:UPDATED,
      entitiesSha256:SHA_B }, entities:[] }, archivedSemanticIds };
  return { status:'accepted', ...content, definitionDigest:await digest(content),
    review:{ reviewedAt:UPDATED, operationId:null, requestSha256:null } };
}

async function reviewedV2(currentArchives = []) {
  const current = await currentReceipt(currentArchives);
  const cumulative = [...currentArchives, ...ARCHIVES];
  return { status:'reviewed', version:2, actorUserId:ACTOR, documentId:DOCUMENT,
    currentReceipt:current,
    wire:{ status:'preview', version:2, documentId:DOCUMENT,
      current:{ definitionRevision:1, definitionDigest:current.definitionDigest },
      sourceModes:{ survey:'keep', entity:'keep' },
      surveyDefinition:current.surveyDefinition, entityCatalog:current.entityCatalog,
      retirement:{ requestedRoots:ROOTS, retiredSemanticIds:ARCHIVES,
        autoRetainedRoots:[], archivedSemanticIds:cumulative },
      review:{ operationId:OPERATION, requestSha256:SHA_B,
        archivedSemanticIds:[], retiredSemanticRoots:ROOTS } },
    expectedArchivedSemanticIds:cumulative };
}

test('a V2 retirement review survives actor/document-scoped durable intent recovery', async t => {
  const indexedDB = new IDBFactory();
  const first = createDocumentDefinitionRevisionCache({ indexedDB, dbName:'retirement-v2-intent' });
  const review = await reviewedV2();
  const reserved = await first.reserveIntent(ACTOR, DOCUMENT, review);
  assert.equal(reserved.created, true);
  assert.equal(reserved.row.review.version, 2);
  first.close();

  const cold = createDocumentDefinitionRevisionCache({ indexedDB, dbName:'retirement-v2-intent' });
  t.after(() => cold.close());
  assert.equal(await cold.getIntent(OTHER_ACTOR, DOCUMENT), null);
  assert.equal(await cold.getIntent(ACTOR, OTHER_DOCUMENT), null);
  const recovered = await cold.getIntent(ACTOR, DOCUMENT);
  assert.deepEqual(recovered.review, review);
  assert.deepEqual(recovered.review.wire.review.archivedSemanticIds, [],
    'the durable request keeps exact input choices, not the cumulative archive set');
  assert.deepEqual(recovered.review.expectedArchivedSemanticIds, ARCHIVES);
});

test('retirement-required discovery cannot create a durable intent', async t => {
  const cache = createDocumentDefinitionRevisionCache({ indexedDB:new IDBFactory(),
    dbName:'retirement-discovery-no-intent' });
  t.after(() => cache.close());
  const current = await currentReceipt();
  const discovery = { status:'retirement-required', version:2, documentId:DOCUMENT,
    current:{ definitionRevision:1, definitionDigest:current.definitionDigest },
    sourceModes:{ survey:'keep', entity:'keep' }, removedRoots:[], autoRetainedRoots:[], review:null };
  await assert.rejects(cache.reserveIntent(ACTOR, DOCUMENT, discovery), {
    code:'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
  });
  assert.equal(await cache.getIntent(ACTOR, DOCUMENT), null);
});

test('V2 cache rejects cumulative archives that differ from the reviewed server proof', async t => {
  const cache = createDocumentDefinitionRevisionCache({ indexedDB:new IDBFactory(),
    dbName:'retirement-v2-bad-union' });
  t.after(() => cache.close());
  const review = await reviewedV2();
  review.expectedArchivedSemanticIds = ARCHIVES.slice(0, 2);
  await assert.rejects(cache.reserveIntent(ACTOR, DOCUMENT, review), {
    code:'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
  });
  assert.equal(await cache.getIntent(ACTOR, DOCUMENT), null);
});

test('V2 cache rejects jointly tampered expected and wire archives that omit an old archive', async t => {
  const cache = createDocumentDefinitionRevisionCache({ indexedDB:new IDBFactory(),
    dbName:'retirement-v2-old-archive' });
  t.after(() => cache.close());
  const review = await reviewedV2([PRIOR_ARCHIVE]);
  review.wire.retirement.archivedSemanticIds = structuredClone(ARCHIVES);
  review.expectedArchivedSemanticIds = structuredClone(ARCHIVES);
  await assert.rejects(cache.reserveIntent(ACTOR, DOCUMENT, review), {
    code:'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
  });
  assert.equal(await cache.getIntent(ACTOR, DOCUMENT), null);
});

test('V2 cache rejects changed canonical content on a keep side', async t => {
  const cache = createDocumentDefinitionRevisionCache({ indexedDB:new IDBFactory(),
    dbName:'retirement-v2-keep-tamper' });
  t.after(() => cache.close());
  const review = await reviewedV2();
  review.wire.entityCatalog = { ...review.wire.entityCatalog,
    entities:[{ id:'entity-added', name:'Added', color:'#112233',
      opacity:0.5, borderColor:null, borderOpacity:null, matchFill:false }] };
  await assert.rejects(cache.reserveIntent(ACTOR, DOCUMENT, review), {
    code:'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
  });
  assert.equal(await cache.getIntent(ACTOR, DOCUMENT), null);
});
