import {
  captureTemplateSurveyDefinitionPreview,
  captureTemplateSurveyModules,
  validateDocumentSurveyDefinition,
} from './documentSurveyDefinition.js';
import {
  captureTemplateEntities,
  captureTemplateEntityPreview,
  validateDocumentEntityCatalog,
} from './documentEntityCatalog.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const KINDS = new Set(['module', 'category', 'checklistItem', 'entity']);

export class DocumentDefinitionRevisionHistoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocumentDefinitionRevisionHistoryError';
    this.code = code;
  }
}

const fail = (code, message) => new DocumentDefinitionRevisionHistoryError(code, message);
const check = (value, code = 'DOCUMENT_DEFINITION_REVISION_INVALID',
  message = 'The document definition revision is invalid.') => {
  if (!value) throw fail(code, message);
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
  : JSON.stringify(value);

async function sha256(value) {
  check(globalThis.crypto?.subtle, 'DOCUMENT_DEFINITION_REVISION_UNAVAILABLE',
    'Document definition history is not available in this browser.');
  const bytes = new TextEncoder().encode(stable(value));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function copySource(source, digestKey) {
  check(exact(source, ['templateId', 'templateUpdatedAt', digestKey]));
  const previewSource = {
    templateId: source.templateId,
    templateUpdatedAt: source.templateUpdatedAt,
    [digestKey]: source[digestKey],
  };
  return Object.freeze(previewSource);
}

function freezeSnapshot({ documentId, surveyDefinition, entityCatalog }) {
  return Object.freeze({
    version: 1,
    documentId,
    surveyDefinition: Object.freeze({
      source: surveyDefinition.source,
      modules: surveyDefinition.modules,
    }),
    entityCatalog: Object.freeze({
      source: entityCatalog.source,
      entities: entityCatalog.entities,
    }),
  });
}

function copyReviewedSnapshot(snapshot, documentId) {
  check(exact(snapshot, ['version', 'documentId', 'surveyDefinition', 'entityCatalog'])
    && snapshot.version === 1 && snapshot.documentId === documentId
    && exact(snapshot.surveyDefinition, ['source', 'modules'])
    && exact(snapshot.entityCatalog, ['source', 'entities']));
  const surveyDefinition = captureTemplateSurveyDefinitionPreview({
    status: 'preview',
    version: 1,
    documentId,
    source: snapshot.surveyDefinition.source,
    modules: snapshot.surveyDefinition.modules,
  }, documentId);
  const entityCatalog = captureTemplateEntityPreview({
    status: 'preview',
    version: 1,
    documentId,
    source: snapshot.entityCatalog.source,
    entities: snapshot.entityCatalog.entities,
  }, documentId);
  return freezeSnapshot({ documentId, surveyDefinition, entityCatalog });
}

export function captureReviewedDocumentDefinitionSnapshot({
  documentId,
  surveySource,
  surveyTemplate,
  entitySource,
  entityTemplate,
} = {}) {
  check(UUID.test(documentId || '') && plain(surveyTemplate) && plain(entityTemplate));
  const surveyPreview = captureTemplateSurveyDefinitionPreview({
    status: 'preview',
    version: 1,
    documentId,
    source: copySource(surveySource, 'structureSha256'),
    modules: captureTemplateSurveyModules(surveyTemplate),
  }, documentId);
  const entityPreview = captureTemplateEntityPreview({
    status: 'preview',
    version: 1,
    documentId,
    source: copySource(entitySource, 'entitiesSha256'),
    entities: captureTemplateEntities(entityTemplate.entities || entityTemplate.config?.entities || []),
  }, documentId);
  return freezeSnapshot({ documentId, surveyDefinition: surveyPreview, entityCatalog: entityPreview });
}

function snapshotFromAccepted(surveyDefinition, entityCatalog) {
  const documentId = surveyDefinition.documentId;
  return freezeSnapshot({
    documentId,
    surveyDefinition,
    entityCatalog,
  });
}

function semanticIndex(snapshot) {
  const entries = [];
  for (const module of snapshot.surveyDefinition.modules) {
    entries.push({ kind: 'module', id: module.id, parentId: null, value: module });
    for (const category of module.categories) {
      entries.push({ kind: 'category', id: category.id, parentId: module.id, value: category });
      for (const item of category.checklist) {
        entries.push({ kind: 'checklistItem', id: item.id, parentId: category.id, value: item });
      }
    }
  }
  for (const entity of snapshot.entityCatalog.entities) {
    entries.push({ kind: 'entity', id: entity.id, parentId: null, value: entity });
  }
  return new Map(entries.map(entry => [`${entry.kind}:${entry.id}`, entry]));
}

function copySemanticId(value) {
  check(exact(value, ['kind', 'id']) && KINDS.has(value.kind)
    && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128);
  return Object.freeze({ kind: value.kind, id: value.id });
}

async function makeRevision({ snapshot, definitionRevision, archivedSemanticIds }) {
  const content = Object.freeze({
    version: 1,
    documentId: snapshot.documentId,
    definitionRevision,
    surveyDefinition: snapshot.surveyDefinition,
    entityCatalog: snapshot.entityCatalog,
    archivedSemanticIds: Object.freeze(archivedSemanticIds),
  });
  return Object.freeze({ ...content, digest: await sha256(content) });
}

function assertScope(history, actorId, documentId) {
  check(plain(history));
  check(UUID.test(actorId || '') && UUID.test(documentId || ''));
  check(history.actorId === actorId && history.documentId === documentId,
    'DOCUMENT_DEFINITION_REVISION_SCOPE_MISMATCH',
    'The actor or document changed.');
}

export function captureReviewedDocumentDefinitionRevision({
  history,
  actorId,
  documentId,
  reviewedAt,
  snapshot,
  archivedSemanticIds = [],
} = {}) {
  assertScope(history, actorId, documentId);
  check(typeof reviewedAt === 'string' && Number.isFinite(Date.parse(reviewedAt)));
  check(Array.isArray(archivedSemanticIds));
  return Object.freeze({
    status: 'reviewed',
    version: 1,
    actorId,
    documentId,
    reviewedAt,
    expectedCurrentRevision: history.currentRevision,
    expectedCurrentDigest: history.currentDigest,
    snapshot: copyReviewedSnapshot(snapshot, documentId),
    archivedSemanticIds: Object.freeze(archivedSemanticIds.map(copySemanticId)),
  });
}

export async function createDocumentDefinitionRevisionHistory({
  actorId,
  surveyDefinition,
  entityCatalog,
} = {}) {
  check(UUID.test(actorId || ''));
  const survey = validateDocumentSurveyDefinition(surveyDefinition);
  const catalog = validateDocumentEntityCatalog(entityCatalog);
  check(survey.status === 'accepted' && catalog.status === 'accepted'
    && survey.documentId === catalog.documentId);
  const revision = await makeRevision({
    snapshot: snapshotFromAccepted(survey, catalog),
    definitionRevision: 1,
    archivedSemanticIds: [],
  });
  return Object.freeze({
    status: 'ready',
    version: 1,
    actorId,
    documentId: survey.documentId,
    currentRevision: 1,
    currentDigest: revision.digest,
    revisions: Object.freeze([revision]),
  });
}

export function readDocumentDefinitionRevision(history, definitionRevision) {
  check(plain(history) && Number.isSafeInteger(definitionRevision) && definitionRevision > 0);
  const revision = history.revisions?.find(value => value.definitionRevision === definitionRevision);
  check(revision, 'DOCUMENT_DEFINITION_REVISION_NOT_FOUND',
    'The requested document definition revision is not available.');
  return revision;
}

export async function appendReviewedDocumentDefinitionRevision({
  history,
  actorId,
  documentId,
  expectedCurrentRevision,
  expectedCurrentDigest,
  review,
} = {}) {
  assertScope(history, actorId, documentId);
  check(expectedCurrentRevision === history.currentRevision
    && expectedCurrentDigest === history.currentDigest && SHA256.test(expectedCurrentDigest || ''),
  'DOCUMENT_DEFINITION_REVISION_CONFLICT',
  'The document definition changed. Review it again.');
  check(exact(review, ['status', 'version', 'actorId', 'documentId', 'reviewedAt',
    'expectedCurrentRevision', 'expectedCurrentDigest', 'snapshot', 'archivedSemanticIds'])
    && review.status === 'reviewed' && review.version === 1
    && review.actorId === actorId && review.documentId === documentId,
  'DOCUMENT_DEFINITION_REVISION_SCOPE_MISMATCH',
  'The actor or document changed.');
  check(review.expectedCurrentRevision === expectedCurrentRevision
    && review.expectedCurrentDigest === expectedCurrentDigest,
  'DOCUMENT_DEFINITION_REVISION_CONFLICT',
  'The document definition changed. Review it again.');
  const reviewedSnapshot = copyReviewedSnapshot(review.snapshot, documentId);

  const current = readDocumentDefinitionRevision(history, history.currentRevision);
  const oldIndex = semanticIndex(current);
  const nextIndex = semanticIndex(reviewedSnapshot);
  for (const [key, oldEntry] of oldIndex) {
    const nextEntry = nextIndex.get(key);
    check(nextEntry, 'DOCUMENT_DEFINITION_SEMANTIC_ID_REMOVED',
      'A semantic ID used by document history cannot be removed.');
    check(nextEntry.parentId === oldEntry.parentId,
      'DOCUMENT_DEFINITION_SEMANTIC_ID_REUSED',
      'A semantic ID used by document history cannot be reused.');
  }

  const cumulative = new Map(current.archivedSemanticIds
    .map(value => [`${value.kind}:${value.id}`, value]));
  for (const raw of review.archivedSemanticIds) {
    const value = copySemanticId(raw);
    check(oldIndex.has(`${value.kind}:${value.id}`) && nextIndex.has(`${value.kind}:${value.id}`),
      'DOCUMENT_DEFINITION_ARCHIVE_INVALID',
      'Only a retained semantic ID can be archived.');
    cumulative.set(`${value.kind}:${value.id}`, value);
  }
  const revision = await makeRevision({
    snapshot: reviewedSnapshot,
    definitionRevision: history.currentRevision + 1,
    archivedSemanticIds: [...cumulative.values()],
  });
  return Object.freeze({
    ...history,
    currentRevision: revision.definitionRevision,
    currentDigest: revision.digest,
    revisions: Object.freeze([...history.revisions, revision]),
  });
}

export function captureDocumentDefinitionHistoryReference({
  history,
  actorId,
  documentId,
  definitionRevision = history?.currentRevision,
  semanticIds = [],
} = {}) {
  assertScope(history, actorId, documentId);
  const revision = readDocumentDefinitionRevision(history, definitionRevision);
  const index = semanticIndex(revision);
  const identities = semanticIds.map(copySemanticId).map(value => {
    const entry = index.get(`${value.kind}:${value.id}`);
    check(entry, 'DOCUMENT_DEFINITION_REVISION_NOT_FOUND',
      'A semantic ID is not present in this document definition revision.');
    return Object.freeze({ ...value, parentId: entry.parentId });
  });
  return Object.freeze({
    version: 1,
    documentId,
    definitionRevision,
    definitionDigest: revision.digest,
    semanticIds: Object.freeze(identities),
  });
}

export function restoreDocumentDefinitionHistoryReference({
  history,
  actorId,
  documentId,
  reference,
} = {}) {
  assertScope(history, actorId, documentId);
  check(exact(reference, ['version', 'documentId', 'definitionRevision', 'definitionDigest', 'semanticIds'])
    && reference.version === 1 && reference.documentId === documentId);
  const revision = readDocumentDefinitionRevision(history, reference.definitionRevision);
  check(reference.definitionDigest === revision.digest,
    'DOCUMENT_DEFINITION_REVISION_CONFLICT',
    'The historical document definition changed.');
  const index = semanticIndex(revision);
  const semanticValues = reference.semanticIds.map(identity => {
    check(exact(identity, ['kind', 'id', 'parentId']) && KINDS.has(identity.kind));
    const entry = index.get(`${identity.kind}:${identity.id}`);
    check(entry && entry.parentId === identity.parentId,
      'DOCUMENT_DEFINITION_SEMANTIC_ID_REUSED',
      'A historical semantic ID no longer has the same meaning.');
    return Object.freeze({
      kind: entry.kind,
      id: entry.id,
      parentId: entry.parentId,
      value: entry.value,
    });
  });
  return Object.freeze({
    version: 1,
    documentId,
    definitionRevision: revision.definitionRevision,
    definitionDigest: revision.digest,
    revision,
    semanticValues: Object.freeze(semanticValues),
  });
}
