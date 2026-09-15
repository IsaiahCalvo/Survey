import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendReviewedDocumentDefinitionRevision,
  captureDocumentDefinitionHistoryReference,
  captureReviewedDocumentDefinitionRevision,
  captureReviewedDocumentDefinitionSnapshot,
  createDocumentDefinitionRevisionHistory,
  readDocumentDefinitionRevision,
  restoreDocumentDefinitionHistoryReference,
} from '../src/services/documentDefinitionRevisionHistory.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_DOCUMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEMPLATE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OPERATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

const modules = ({ label = 'Door condition', archived = false } = {}) => [{
  id: 'module-doors',
  name: 'Doors',
  categories: [{
    id: 'category-doors',
    name: 'Door checks',
    checklist: [{
      id: 'check-door-condition',
      text: label,
      ...(archived ? {
        archived: true,
        archivedAt: '2026-09-15T12:00:00Z',
        lastKnownLabel: 'Door condition',
      } : {}),
    }],
  }],
}];

const entities = ({ name = 'Door', id = 'entity-door' } = {}) => [{
  id,
  name,
  color: '#112233',
  opacity: 0.35,
  borderColor: null,
  borderOpacity: null,
  matchFill: false,
}];

const acceptedSurvey = {
  status: 'accepted',
  version: 1,
  documentId: DOCUMENT_ID,
  definitionRevision: 1,
  source: {
    templateId: TEMPLATE_ID,
    templateUpdatedAt: '2026-09-14T12:00:00Z',
    structureSha256: SHA_A,
  },
  seed: { operationId: OPERATION_ID, requestSha256: SHA_B },
  modules: modules(),
};

const acceptedCatalog = {
  status: 'accepted',
  version: 1,
  documentId: DOCUMENT_ID,
  catalogRevision: 1,
  source: {
    templateId: TEMPLATE_ID,
    templateUpdatedAt: '2026-09-14T12:00:00Z',
    entitiesSha256: SHA_C,
  },
  seed: { operationId: OPERATION_ID, requestSha256: SHA_D },
  entities: entities(),
};

const reviewedSnapshot = (overrides = {}) => captureReviewedDocumentDefinitionSnapshot({
  documentId: DOCUMENT_ID,
  surveySource: {
    templateId: TEMPLATE_ID,
    templateUpdatedAt: '2026-09-15T12:00:00Z',
    structureSha256: SHA_B,
  },
  surveyTemplate: { modules: modules({ label: 'Door condition (new)', archived: true }) },
  entitySource: {
    templateId: TEMPLATE_ID,
    templateUpdatedAt: '2026-09-15T12:00:00Z',
    entitiesSha256: SHA_D,
  },
  entityTemplate: { entities: entities({ name: 'Door (new)' }) },
  ...overrides,
});

test('history restore reads the exact old definition after a reviewed append-only upgrade', async () => {
  const history = await createDocumentDefinitionRevisionHistory({
    actorId: ACTOR_ID,
    surveyDefinition: acceptedSurvey,
    entityCatalog: acceptedCatalog,
  });
  const reference = captureDocumentDefinitionHistoryReference({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    semanticIds: [
      { kind: 'checklistItem', id: 'check-door-condition' },
      { kind: 'entity', id: 'entity-door' },
    ],
  });
  const review = captureReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    reviewedAt: '2026-09-15T13:00:00Z',
    snapshot: reviewedSnapshot(),
  });
  const upgraded = await appendReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    expectedCurrentRevision: history.currentRevision,
    expectedCurrentDigest: history.currentDigest,
    review,
  });

  assert.equal(upgraded.currentRevision, 2);
  assert.equal(history.currentRevision, 1);
  assert.equal(history.revisions.length, 1);
  assert.equal(reference.definitionRevision, 1);
  assert.equal(reference.definitionDigest, history.currentDigest);
  assert.equal(readDocumentDefinitionRevision(upgraded, 1).surveyDefinition.modules[0]
    .categories[0].checklist[0].text, 'Door condition');
  assert.equal(readDocumentDefinitionRevision(upgraded, 2).surveyDefinition.modules[0]
    .categories[0].checklist[0].text, 'Door condition (new)');

  const restored = restoreDocumentDefinitionHistoryReference({
    history: upgraded,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    reference,
  });
  assert.equal(restored.definitionRevision, 1);
  assert.equal(restored.semanticValues[0].value.text, 'Door condition');
  assert.equal(restored.semanticValues[1].value.name, 'Door');
});

test('upgrade uses exact current revision and digest CAS inputs', async () => {
  const history = await createDocumentDefinitionRevisionHistory({
    actorId: ACTOR_ID,
    surveyDefinition: acceptedSurvey,
    entityCatalog: acceptedCatalog,
  });
  const review = captureReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    reviewedAt: '2026-09-15T13:00:00Z',
    snapshot: reviewedSnapshot(),
  });
  const append = overrides => appendReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    expectedCurrentRevision: history.currentRevision,
    expectedCurrentDigest: history.currentDigest,
    review,
    ...overrides,
  });

  await assert.rejects(append({ expectedCurrentRevision: 2 }), error =>
    error.code === 'DOCUMENT_DEFINITION_REVISION_CONFLICT');
  await assert.rejects(append({ expectedCurrentDigest: 'f'.repeat(64) }), error =>
    error.code === 'DOCUMENT_DEFINITION_REVISION_CONFLICT');
});

test('archived semantic IDs remain valid in both old and new revisions', async () => {
  const history = await createDocumentDefinitionRevisionHistory({
    actorId: ACTOR_ID,
    surveyDefinition: acceptedSurvey,
    entityCatalog: acceptedCatalog,
  });
  const review = captureReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    reviewedAt: '2026-09-15T13:00:00Z',
    snapshot: reviewedSnapshot(),
    archivedSemanticIds: [{ kind: 'checklistItem', id: 'check-door-condition' }],
  });
  const upgraded = await appendReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    expectedCurrentRevision: 1,
    expectedCurrentDigest: history.currentDigest,
    review,
  });

  assert.deepEqual(readDocumentDefinitionRevision(upgraded, 2).archivedSemanticIds,
    [{ kind: 'checklistItem', id: 'check-door-condition' }]);
  assert.equal(readDocumentDefinitionRevision(upgraded, 1).surveyDefinition.modules[0]
    .categories[0].checklist[0].archived, undefined);
  assert.equal(readDocumentDefinitionRevision(upgraded, 2).surveyDefinition.modules[0]
    .categories[0].checklist[0].archived, true);
});

test('upgrade rejects reuse of a historical semantic ID under a new parent', async () => {
  const history = await createDocumentDefinitionRevisionHistory({
    actorId: ACTOR_ID,
    surveyDefinition: acceptedSurvey,
    entityCatalog: acceptedCatalog,
  });
  const movedItemSnapshot = reviewedSnapshot({
    surveyTemplate: {
      modules: [{
        id: 'module-doors',
        name: 'Doors',
        categories: [
          { id: 'category-doors', name: 'Door checks', checklist: [] },
          { id: 'category-other', name: 'Other checks', checklist: modules()[0].categories[0].checklist },
        ],
      }],
    },
  });
  const review = captureReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    reviewedAt: '2026-09-15T13:00:00Z',
    snapshot: movedItemSnapshot,
  });

  await assert.rejects(appendReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    expectedCurrentRevision: 1,
    expectedCurrentDigest: history.currentDigest,
    review,
  }), error => error.code === 'DOCUMENT_DEFINITION_SEMANTIC_ID_REUSED');
});

test('upgrade rejects deletion of a semantic ID used by old document state', async () => {
  const history = await createDocumentDefinitionRevisionHistory({
    actorId: ACTOR_ID,
    surveyDefinition: acceptedSurvey,
    entityCatalog: acceptedCatalog,
  });
  const snapshot = reviewedSnapshot({
    surveyTemplate: {
      modules: [{ id: 'module-doors', name: 'Doors', categories: [
        { id: 'category-doors', name: 'Door checks', checklist: [] },
      ] }],
    },
  });
  const review = captureReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    reviewedAt: '2026-09-15T13:00:00Z',
    snapshot,
  });

  await assert.rejects(appendReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    expectedCurrentRevision: 1,
    expectedCurrentDigest: history.currentDigest,
    review,
  }), error => error.code === 'DOCUMENT_DEFINITION_SEMANTIC_ID_REMOVED');
});

test('a review goes stale when another reviewed source wins the revision CAS', async () => {
  const history = await createDocumentDefinitionRevisionHistory({
    actorId: ACTOR_ID,
    surveyDefinition: acceptedSurvey,
    entityCatalog: acceptedCatalog,
  });
  const staleReview = captureReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    reviewedAt: '2026-09-15T13:00:00Z',
    snapshot: reviewedSnapshot(),
  });
  const winningReview = captureReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    reviewedAt: '2026-09-15T13:01:00Z',
    snapshot: reviewedSnapshot({
      surveySource: {
        templateId: TEMPLATE_ID,
        templateUpdatedAt: '2026-09-15T13:01:00Z',
        structureSha256: SHA_C,
      },
    }),
  });
  const changed = await appendReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    expectedCurrentRevision: 1,
    expectedCurrentDigest: history.currentDigest,
    review: winningReview,
  });

  await assert.rejects(appendReviewedDocumentDefinitionRevision({
    history: changed,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    expectedCurrentRevision: changed.currentRevision,
    expectedCurrentDigest: changed.currentDigest,
    review: staleReview,
  }), error => error.code === 'DOCUMENT_DEFINITION_REVISION_CONFLICT');
});

test('actor and document fences apply to review, append, and history restore', async () => {
  const history = await createDocumentDefinitionRevisionHistory({
    actorId: ACTOR_ID,
    surveyDefinition: acceptedSurvey,
    entityCatalog: acceptedCatalog,
  });
  const reference = captureDocumentDefinitionHistoryReference({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    semanticIds: [{ kind: 'entity', id: 'entity-door' }],
  });
  assert.throws(() => captureReviewedDocumentDefinitionRevision({
    history,
    actorId: OTHER_ACTOR_ID,
    documentId: DOCUMENT_ID,
    reviewedAt: '2026-09-15T13:00:00Z',
    snapshot: reviewedSnapshot(),
  }), error => error.code === 'DOCUMENT_DEFINITION_REVISION_SCOPE_MISMATCH');
  assert.throws(() => restoreDocumentDefinitionHistoryReference({
    history,
    actorId: ACTOR_ID,
    documentId: OTHER_DOCUMENT_ID,
    reference,
  }), error => error.code === 'DOCUMENT_DEFINITION_REVISION_SCOPE_MISMATCH');
  const review = captureReviewedDocumentDefinitionRevision({
    history,
    actorId: ACTOR_ID,
    documentId: DOCUMENT_ID,
    reviewedAt: '2026-09-15T13:00:00Z',
    snapshot: reviewedSnapshot(),
  });
  await assert.rejects(appendReviewedDocumentDefinitionRevision({
    history,
    actorId: OTHER_ACTOR_ID,
    documentId: DOCUMENT_ID,
    expectedCurrentRevision: 1,
    expectedCurrentDigest: history.currentDigest,
    review,
  }), error => error.code === 'DOCUMENT_DEFINITION_REVISION_SCOPE_MISMATCH');
});

test('review capture shares only accepted definition fields, never private template fields', () => {
  const snapshot = reviewedSnapshot({
    surveyTemplate: {
      privateOwnerToken: 'survey-secret',
      modules: modules(),
    },
    entityTemplate: {
      privateBillingPlan: 'entity-secret',
      entities: entities(),
    },
  });
  const encoded = JSON.stringify(snapshot);

  assert.equal(encoded.includes('survey-secret'), false);
  assert.equal(encoded.includes('entity-secret'), false);
  assert.deepEqual(Object.keys(snapshot.surveyDefinition), ['source', 'modules']);
  assert.deepEqual(Object.keys(snapshot.entityCatalog), ['source', 'entities']);
});
