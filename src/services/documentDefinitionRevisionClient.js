import { captureReviewedDocumentDefinitionSnapshot } from './documentDefinitionRevisionHistory.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_REVISION = 9007199254740991;
const KINDS = new Set(['module', 'category', 'checklistItem', 'entity']);

export class DocumentDefinitionRevisionClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocumentDefinitionRevisionClientError';
    this.code = code;
  }
}

const fail = (code, message) => new DocumentDefinitionRevisionClientError(code, message);
const check = (value, code = 'DOCUMENT_DEFINITION_REVISION_INPUT',
  message = 'The document definition request is invalid.') => {
  if (!value) throw fail(code, message);
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const uuid = value => typeof value === 'string' && UUID.test(value);
const sha = value => typeof value === 'string' && SHA256.test(value);
const revisionNumber = value => Number.isSafeInteger(value) && value >= 1 && value <= MAX_REVISION;
const timestamp = value => typeof value === 'string' && RFC3339.test(value)
  && Number.isFinite(Date.parse(value));
const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
  : JSON.stringify(value);

async function digest(value, cryptoImpl = globalThis.crypto) {
  check(cryptoImpl?.subtle, 'DOCUMENT_DEFINITION_REVISION_UNAVAILABLE',
    'Document definition revisions are not available in this browser.');
  const result = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',
    new TextEncoder().encode(stable(value))));
  return [...result].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function copySemanticId(value) {
  check(exact(value, ['kind', 'id']) && KINDS.has(value.kind)
    && typeof value.id === 'string' && value.id.length >= 1 && value.id.length <= 128);
  return Object.freeze({ kind: value.kind, id: value.id });
}

function copySemanticIds(values) {
  check(Array.isArray(values) && values.length <= 10304);
  const copied = values.map(copySemanticId);
  const keys = copied.map(value => `${value.kind}:${value.id}`);
  check(new Set(keys).size === keys.length);
  return Object.freeze(copied);
}

function copyRetirementEntry(value) {
  check(exact(value, ['kind', 'id', 'parentId', 'label']) && KINDS.has(value.kind)
    && typeof value.id === 'string' && value.id.length >= 1 && value.id.length <= 128
    && (value.parentId === null || (typeof value.parentId === 'string'
      && value.parentId.length >= 1 && value.parentId.length <= 128))
    && typeof value.label === 'string' && value.label.length <= 1024,
  'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
  'The document definition retirement proof is invalid.');
  return Object.freeze({ kind:value.kind, id:value.id, parentId:value.parentId, label:value.label });
}

function copyRetirementRoots(values) {
  check(Array.isArray(values) && values.length <= 10304,
    'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
    'The document definition retirement proof is invalid.');
  const roots = values.map(value => {
    check(exact(value, ['kind', 'id', 'parentId', 'label', 'subtree'])
      && Array.isArray(value.subtree) && value.subtree.length >= 1
      && value.subtree.length <= 10304,
    'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
    'The document definition retirement proof is invalid.');
    const root = copyRetirementEntry({ kind:value.kind, id:value.id,
      parentId:value.parentId, label:value.label });
    const subtree = Object.freeze(value.subtree.map(copyRetirementEntry));
    check(root.kind === subtree[0].kind && root.id === subtree[0].id
      && root.parentId === subtree[0].parentId && root.label === subtree[0].label,
    'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
    'The document definition retirement proof is invalid.');
    return Object.freeze({ ...root, subtree });
  });
  const keys = roots.map(value => semanticIdKey(value));
  check(new Set(keys).size === keys.length,
    'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
    'The document definition retirement proof is invalid.');
  return Object.freeze(roots);
}

function copySnapshot(value, documentId) {
  check(exact(value, ['surveyDefinition', 'entityCatalog'])
    && exact(value.surveyDefinition, ['source', 'modules'])
    && exact(value.entityCatalog, ['source', 'entities']),
  'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
  'The document definition revision is invalid.');
  try {
    return captureReviewedDocumentDefinitionSnapshot({
      documentId,
      surveySource: value.surveyDefinition.source,
      surveyTemplate: { modules: value.surveyDefinition.modules },
      entitySource: value.entityCatalog.source,
      entityTemplate: { entities: value.entityCatalog.entities },
    });
  } catch {
    throw fail('DOCUMENT_DEFINITION_REVISION_INTEGRITY',
      'The document definition revision is invalid.');
  }
}

export function validateDocumentDefinitionRevisionPreview(value, documentId = null) {
  check(exact(value, ['status', 'version', 'documentId', 'current',
    'surveyDefinition', 'entityCatalog', 'review'])
    && value.status === 'preview' && value.version === 1 && uuid(value.documentId)
    && (!documentId || value.documentId === documentId)
    && exact(value.current, ['definitionRevision', 'definitionDigest'])
    && revisionNumber(value.current.definitionRevision) && sha(value.current.definitionDigest)
    && exact(value.review, ['operationId', 'requestSha256', 'archivedSemanticIds'])
    && uuid(value.review.operationId) && sha(value.review.requestSha256),
  'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
  'The document definition review proof is invalid.');
  const snapshot = copySnapshot({ surveyDefinition:value.surveyDefinition,
    entityCatalog:value.entityCatalog }, value.documentId);
  return Object.freeze({
    status: 'preview',
    version: 1,
    documentId: value.documentId,
    current: Object.freeze({ definitionRevision:value.current.definitionRevision,
      definitionDigest:value.current.definitionDigest }),
    surveyDefinition: snapshot.surveyDefinition,
    entityCatalog: snapshot.entityCatalog,
    review: Object.freeze({ operationId:value.review.operationId,
      requestSha256:value.review.requestSha256,
      archivedSemanticIds:copySemanticIds(value.review.archivedSemanticIds) }),
  });
}

export function validateDocumentDefinitionRevisionPreviewV2(value, documentId = null) {
  check(plain(value) && value.version === 2 && uuid(value.documentId)
    && (!documentId || value.documentId === documentId)
    && exact(value.current, ['definitionRevision', 'definitionDigest'])
    && revisionNumber(value.current.definitionRevision) && sha(value.current.definitionDigest)
    && exact(value.sourceModes, ['survey', 'entity'])
    && ['keep', 'replace'].includes(value.sourceModes.survey)
    && ['keep', 'replace'].includes(value.sourceModes.entity),
  'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
  'The document definition retirement proof is invalid.');
  const current = Object.freeze({ definitionRevision:value.current.definitionRevision,
    definitionDigest:value.current.definitionDigest });
  const sourceModes = Object.freeze({ ...value.sourceModes });
  if (value.status === 'retirement-required') {
    check(exact(value, ['status', 'version', 'documentId', 'current', 'sourceModes',
      'removedRoots', 'autoRetainedRoots', 'review']) && value.review === null,
    'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
    'The document definition retirement proof is invalid.');
    return Object.freeze({ status:'retirement-required', version:2,
      documentId:value.documentId, current, sourceModes,
      removedRoots:copyRetirementRoots(value.removedRoots),
      autoRetainedRoots:copyRetirementRoots(value.autoRetainedRoots), review:null });
  }
  check(value.status === 'preview'
    && exact(value, ['status', 'version', 'documentId', 'current', 'sourceModes',
      'surveyDefinition', 'entityCatalog', 'retirement', 'review'])
    && exact(value.retirement, ['requestedRoots', 'retiredSemanticIds',
      'autoRetainedRoots', 'archivedSemanticIds'])
    && exact(value.review, ['operationId', 'requestSha256', 'archivedSemanticIds',
      'retiredSemanticRoots'])
    && uuid(value.review.operationId) && sha(value.review.requestSha256),
  'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
  'The document definition retirement proof is invalid.');
  const snapshot = copySnapshot({ surveyDefinition:value.surveyDefinition,
    entityCatalog:value.entityCatalog }, value.documentId);
  return Object.freeze({ status:'preview', version:2, documentId:value.documentId,
    current, sourceModes, surveyDefinition:snapshot.surveyDefinition,
    entityCatalog:snapshot.entityCatalog,
    retirement:Object.freeze({
      requestedRoots:copySemanticIds(value.retirement.requestedRoots),
      retiredSemanticIds:copySemanticIds(value.retirement.retiredSemanticIds),
      autoRetainedRoots:copyRetirementRoots(value.retirement.autoRetainedRoots),
      archivedSemanticIds:copySemanticIds(value.retirement.archivedSemanticIds),
    }),
    review:Object.freeze({ operationId:value.review.operationId,
      requestSha256:value.review.requestSha256,
      archivedSemanticIds:copySemanticIds(value.review.archivedSemanticIds),
      retiredSemanticRoots:copySemanticIds(value.review.retiredSemanticRoots) }),
  });
}

export async function validateDocumentDefinitionRevisionReceipt(value, documentId = null,
  cryptoImpl = globalThis.crypto) {
  check(exact(value, ['status', 'version', 'documentId', 'definitionRevision',
    'definitionDigest', 'surveyDefinition', 'entityCatalog', 'archivedSemanticIds', 'review'])
    && value.status === 'accepted' && value.version === 1 && uuid(value.documentId)
    && (!documentId || value.documentId === documentId)
    && revisionNumber(value.definitionRevision) && sha(value.definitionDigest)
    && exact(value.review, ['reviewedAt', 'operationId', 'requestSha256'])
    && timestamp(value.review.reviewedAt)
    && ((value.definitionRevision === 1 && value.review.operationId === null
      && value.review.requestSha256 === null)
      || (value.definitionRevision > 1 && uuid(value.review.operationId)
        && sha(value.review.requestSha256))),
  'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
  'The document definition revision receipt is invalid.');
  const snapshot = copySnapshot({ surveyDefinition:value.surveyDefinition,
    entityCatalog:value.entityCatalog }, value.documentId);
  const archivedSemanticIds = copySemanticIds(value.archivedSemanticIds);
  const content = Object.freeze({
    version: 1,
    documentId: value.documentId,
    definitionRevision: value.definitionRevision,
    surveyDefinition: snapshot.surveyDefinition,
    entityCatalog: snapshot.entityCatalog,
    archivedSemanticIds,
  });
  check(await digest(content, cryptoImpl) === value.definitionDigest,
    'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
    'The document definition revision digest does not match its content.');
  return Object.freeze({
    status: 'accepted',
    ...content,
    definitionDigest: value.definitionDigest,
    review: Object.freeze({ reviewedAt:value.review.reviewedAt,
      operationId:value.review.operationId, requestSha256:value.review.requestSha256 }),
  });
}

function mapRpcError(error) {
  if (error?.code === '42501' || [401, 403].includes(error?.status || error?.statusCode)) {
    return fail('DOCUMENT_DEFINITION_REVISION_FORBIDDEN',
      'You no longer have access to this document definition.');
  }
  if (error?.code === 'P0002') return fail('DOCUMENT_DEFINITION_REVISION_NOT_FOUND',
    'The document definition revision is not available.');
  if (['23505', '23514', '40001'].includes(error?.code)) {
    return fail('DOCUMENT_DEFINITION_REVISION_CONFLICT',
      'The document definition changed. Review it again.');
  }
  return fail('DOCUMENT_DEFINITION_REVISION_UNAVAILABLE',
    'The document definition revision could not be loaded.');
}

const same = (left, right) => stable(left) === stable(right);
const semanticIdKey = value => JSON.stringify([value.kind, value.id]);
const sameSemanticIdSet = (left, right) => {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right.map(semanticIdKey));
  return rightKeys.size === right.length && left.every(value => rightKeys.has(semanticIdKey(value)));
};
const combinedArchives = (current, added) => {
  const values = new Map([...current, ...added].map(value => [semanticIdKey(value), value]));
  return Object.freeze([...values.values()]);
};
const retirementRootIds = roots => roots.map(value => ({ kind:value.kind, id:value.id }));
const retirementSubtreeIds = roots => roots.flatMap(value => value.subtree
  .map(entry => ({ kind:entry.kind, id:entry.id })));
const semanticParentMap = snapshot => {
  const values = new Map();
  for (const module of snapshot.surveyDefinition.modules) {
    values.set(semanticIdKey({ kind:'module', id:module.id }), null);
    for (const category of module.categories) {
      values.set(semanticIdKey({ kind:'category', id:category.id }), module.id);
      for (const item of category.checklist) {
        values.set(semanticIdKey({ kind:'checklistItem', id:item.id }), category.id);
      }
    }
  }
  for (const entity of snapshot.entityCatalog.entities) {
    values.set(semanticIdKey({ kind:'entity', id:entity.id }), null);
  }
  return values;
};
const assertRetainedSemantics = (currentReceipt, wire) => {
  const before = semanticParentMap(currentReceipt);
  const after = semanticParentMap(wire);
  for (const [key, parentId] of before) check(after.has(key) && after.get(key) === parentId,
    'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
    'The document definition retirement candidate changed a historical identity.');
};

export async function validateDocumentDefinitionRevisionReviewV2(value, documentId = null,
  cryptoImpl = globalThis.crypto) {
  check(exact(value, ['status', 'version', 'actorUserId', 'documentId',
    'currentReceipt', 'wire', 'expectedArchivedSemanticIds'])
    && value.status === 'reviewed' && value.version === 2
    && uuid(value.actorUserId) && uuid(value.documentId)
    && (!documentId || value.documentId === documentId),
  'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
  'The document definition retirement review is invalid.');
  const currentReceipt = await validateDocumentDefinitionRevisionReceipt(
    value.currentReceipt, value.documentId, cryptoImpl);
  const wire = validateDocumentDefinitionRevisionPreviewV2(value.wire, value.documentId);
  check(wire.status === 'preview'
    && currentReceipt.definitionRevision === wire.current.definitionRevision
    && currentReceipt.definitionDigest === wire.current.definitionDigest
    && (wire.sourceModes.survey !== 'keep'
      || same(wire.surveyDefinition, currentReceipt.surveyDefinition))
    && (wire.sourceModes.entity !== 'keep'
      || same(wire.entityCatalog, currentReceipt.entityCatalog))
    && same(wire.retirement.requestedRoots, wire.review.retiredSemanticRoots),
  'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
  'The document definition retirement review changed.');
  assertRetainedSemantics(currentReceipt, wire);
  const before = semanticParentMap(currentReceipt);
  const after = semanticParentMap(wire);
  check(wire.review.archivedSemanticIds.every(value => before.has(semanticIdKey(value))
      && after.has(semanticIdKey(value)))
    && wire.retirement.archivedSemanticIds.every(value => after.has(semanticIdKey(value))),
  'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
  'The document definition retirement archive set changed.');
  const retiredKeys = new Set(wire.retirement.retiredSemanticIds.map(semanticIdKey));
  check(wire.retirement.requestedRoots.every(value => retiredKeys.has(semanticIdKey(value))),
    'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
    'The document definition retirement closure changed.');
  const autoIds = retirementSubtreeIds(wire.retirement.autoRetainedRoots);
  const expectedArchives = combinedArchives(combinedArchives(
    combinedArchives(currentReceipt.archivedSemanticIds, wire.review.archivedSemanticIds),
    wire.retirement.retiredSemanticIds), autoIds);
  check(sameSemanticIdSet(wire.retirement.archivedSemanticIds, expectedArchives)
    && sameSemanticIdSet(copySemanticIds(value.expectedArchivedSemanticIds), expectedArchives),
  'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
  'The document definition retirement archive set changed.');
  return Object.freeze({ status:'reviewed', version:2, actorUserId:value.actorUserId,
    documentId:value.documentId, currentReceipt, wire,
    expectedArchivedSemanticIds:wire.retirement.archivedSemanticIds });
}

function boundedRpc(rpc, name, args, signal, timeoutMs, beforeDispatch) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      controller.abort();
      finish(reject, fail('DOCUMENT_DEFINITION_REVISION_STALE',
        'The document or account changed.'));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once:true });
    timer = setTimeout(() => {
      controller.abort();
      finish(reject, fail('DOCUMENT_DEFINITION_REVISION_UNAVAILABLE',
        'The document definition request timed out. Its result is not confirmed.'));
    }, timeoutMs);
    Promise.resolve().then(() => {
      if (settled || controller.signal.aborted) return undefined;
      beforeDispatch();
      return rpc(name, args, { signal:controller.signal });
    })
      .then(value => finish(resolve, value), error => finish(reject, error));
  });
}

export function createDocumentDefinitionRevisionClient({
  rpc,
  enabled = false,
  getActorUserId,
  isCurrent,
  requestTimeoutMs = 60_000,
  cryptoImpl = globalThis.crypto,
} = {}) {
  check(typeof rpc === 'function' && typeof getActorUserId === 'function'
    && typeof isCurrent === 'function' && Number.isSafeInteger(requestTimeoutMs)
    && requestTimeoutMs > 0 && requestTimeoutMs <= 120_000 && cryptoImpl?.subtle);
  const current = (actorUserId, documentId, signal) => {
    check(signal?.aborted !== true, 'DOCUMENT_DEFINITION_REVISION_STALE',
      'The document or account changed.');
    let valid = false;
    try {
      valid = getActorUserId() === actorUserId
        && isCurrent({ actorUserId, documentId }) === true;
    } catch { /* fail closed */ }
    check(valid, 'DOCUMENT_DEFINITION_REVISION_STALE',
      'The document or account changed.');
  };
  const call = async (actorUserId, documentId, name, args, signal) => {
    check(enabled, 'DOCUMENT_DEFINITION_REVISION_DISABLED',
      'Shared document definition revisions are not enabled.');
    current(actorUserId, documentId, signal);
    let result;
    try {
      result = await boundedRpc(rpc, name, args, signal, requestTimeoutMs,
        () => current(actorUserId, documentId, signal));
    }
    catch (error) {
      if (error instanceof DocumentDefinitionRevisionClientError) throw error;
      if (signal?.aborted || error?.name === 'AbortError') {
        throw fail('DOCUMENT_DEFINITION_REVISION_STALE',
          'The document or account changed.');
      }
      throw mapRpcError(error);
    }
    current(actorUserId, documentId, signal);
    if (result?.error) throw mapRpcError(result.error);
    return result?.data;
  };
  const read = async ({ actorUserId, documentId, definitionRevision, signal }) => {
    const value = await call(actorUserId, documentId,
      'read_document_definition_revision', {
        p_document_id: documentId,
        p_definition_revision: definitionRevision ?? null,
      }, signal);
    const receipt = await validateDocumentDefinitionRevisionReceipt(value, documentId, cryptoImpl);
    current(actorUserId, documentId, signal);
    return receipt;
  };
  const start = (documentId, signal) => {
    const actorUserId = getActorUserId();
    check(uuid(actorUserId) && uuid(documentId));
    current(actorUserId, documentId, signal);
    return actorUserId;
  };
  return Object.freeze({
    async readCurrent({ documentId, signal } = {}) {
      const actorUserId = start(documentId, signal);
      return read({ actorUserId, documentId, definitionRevision:null, signal });
    },
    async readRevision({ documentId, definitionRevision, expectedDigest, signal } = {}) {
      const actorUserId = start(documentId, signal);
      check(revisionNumber(definitionRevision) && (expectedDigest == null || sha(expectedDigest)));
      const receipt = await read({ actorUserId, documentId, definitionRevision, signal });
      check(receipt.definitionRevision === definitionRevision
        && (expectedDigest == null || receipt.definitionDigest === expectedDigest),
      'DOCUMENT_DEFINITION_REVISION_CONFLICT',
      'The historical document definition changed.');
      return receipt;
    },
    async preview({ version = 1, documentId, surveyTemplateId, entityTemplateId,
      archivedSemanticIds = [], retiredSemanticRoots = [], operationId, signal } = {}) {
      const actorUserId = start(documentId, signal);
      check([1, 2].includes(version) && uuid(operationId));
      const archives = copySemanticIds(archivedSemanticIds);
      if (version === 2) {
        check((surveyTemplateId === null || uuid(surveyTemplateId))
          && (entityTemplateId === null || uuid(entityTemplateId)));
        const retirementRoots = copySemanticIds(retiredSemanticRoots);
        const currentReceipt = await read({ actorUserId, documentId,
          definitionRevision:null, signal });
        const wire = validateDocumentDefinitionRevisionPreviewV2(
          await call(actorUserId, documentId,
            'preview_document_definition_revision_upgrade_v2', {
              p_document_id:documentId,
              p_survey_template_id:surveyTemplateId,
              p_entity_template_id:entityTemplateId,
              p_archived_semantic_ids:archives,
              p_retired_semantic_roots:retirementRoots,
              p_operation_id:operationId,
            }, signal), documentId);
        const expectedModes = { survey:surveyTemplateId === null ? 'keep' : 'replace',
          entity:entityTemplateId === null ? 'keep' : 'replace' };
        check(wire.current.definitionRevision === currentReceipt.definitionRevision
          && wire.current.definitionDigest === currentReceipt.definitionDigest
          && same(wire.sourceModes, expectedModes),
        'DOCUMENT_DEFINITION_REVISION_CONFLICT',
        'The document definition changed. Review it again.');
        if (wire.status === 'retirement-required') return wire;
        check((surveyTemplateId === null
          ? same(wire.surveyDefinition, currentReceipt.surveyDefinition)
          : wire.surveyDefinition.source.templateId === surveyTemplateId)
          && (entityTemplateId === null
            ? same(wire.entityCatalog, currentReceipt.entityCatalog)
            : wire.entityCatalog.source.templateId === entityTemplateId)
          && wire.review.operationId === operationId
          && same(wire.review.archivedSemanticIds, archives)
          && same(wire.review.retiredSemanticRoots, retirementRoots)
          && same(wire.retirement.requestedRoots, retirementRoots),
        'DOCUMENT_DEFINITION_REVISION_CONFLICT',
        'The document definition changed. Review it again.');
        return validateDocumentDefinitionRevisionReviewV2({ status:'reviewed', version:2,
          actorUserId, documentId,
          currentReceipt, wire,
          expectedArchivedSemanticIds:wire.retirement.archivedSemanticIds },
        documentId, cryptoImpl);
      }
      check(uuid(surveyTemplateId) && uuid(entityTemplateId)
        && retiredSemanticRoots.length === 0);
      const currentReceipt = await read({ actorUserId, documentId,
        definitionRevision:null, signal });
      const wire = validateDocumentDefinitionRevisionPreview(await call(actorUserId, documentId,
        'preview_document_definition_revision_upgrade', {
          p_document_id:documentId,
          p_survey_template_id:surveyTemplateId,
          p_entity_template_id:entityTemplateId,
          p_archived_semantic_ids:archives,
          p_operation_id:operationId,
        }, signal), documentId);
      check(wire.current.definitionRevision === currentReceipt.definitionRevision
        && wire.current.definitionDigest === currentReceipt.definitionDigest
        && wire.surveyDefinition.source.templateId === surveyTemplateId
        && wire.entityCatalog.source.templateId === entityTemplateId
        && wire.review.operationId === operationId
        && same(wire.review.archivedSemanticIds, archives),
      'DOCUMENT_DEFINITION_REVISION_CONFLICT',
      'The document definition changed. Review it again.');
      return Object.freeze({
        status: 'reviewed',
        version: 1,
        actorUserId,
        documentId,
        currentReceipt,
        wire,
        expectedArchivedSemanticIds: combinedArchives(
          currentReceipt.archivedSemanticIds, wire.review.archivedSemanticIds),
      });
    },
    async apply({ review, signal } = {}) {
      if (review?.version === 2) {
        const actorUserId = getActorUserId();
        check(actorUserId === review?.actorUserId,
          'DOCUMENT_DEFINITION_REVISION_STALE', 'The document or account changed.');
        current(actorUserId, review?.documentId, signal);
        const ownedReview = await validateDocumentDefinitionRevisionReviewV2(
          review, review.documentId, cryptoImpl);
        current(actorUserId, ownedReview.documentId, signal);
        const wire = ownedReview.wire;
        const surveyReplace = wire.sourceModes.survey === 'replace';
        const entityReplace = wire.sourceModes.entity === 'replace';
        const receipt = await validateDocumentDefinitionRevisionReceipt(await call(actorUserId,
          ownedReview.documentId, 'apply_reviewed_document_definition_revision_v2', {
            p_document_id:ownedReview.documentId,
            p_expected_current_revision:wire.current.definitionRevision,
            p_expected_current_digest:wire.current.definitionDigest,
            p_survey_template_id:surveyReplace ? wire.surveyDefinition.source.templateId : null,
            p_expected_survey_template_updated_at:surveyReplace
              ? wire.surveyDefinition.source.templateUpdatedAt : null,
            p_expected_survey_structure_sha256:surveyReplace
              ? wire.surveyDefinition.source.structureSha256 : null,
            p_entity_template_id:entityReplace ? wire.entityCatalog.source.templateId : null,
            p_expected_entity_template_updated_at:entityReplace
              ? wire.entityCatalog.source.templateUpdatedAt : null,
            p_expected_entity_entities_sha256:entityReplace
              ? wire.entityCatalog.source.entitiesSha256 : null,
            p_archived_semantic_ids:wire.review.archivedSemanticIds,
            p_retired_semantic_roots:wire.review.retiredSemanticRoots,
            p_operation_id:wire.review.operationId,
            p_request_sha256:wire.review.requestSha256,
          }, signal), ownedReview.documentId);
        check(receipt.definitionRevision === wire.current.definitionRevision + 1
          && same(receipt.surveyDefinition, wire.surveyDefinition)
          && same(receipt.entityCatalog, wire.entityCatalog)
          && sameSemanticIdSet(receipt.archivedSemanticIds,
            wire.retirement.archivedSemanticIds)
          && receipt.review.operationId === wire.review.operationId
          && receipt.review.requestSha256 === wire.review.requestSha256,
        'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
        'The applied document definition does not match its review.');
        current(actorUserId, ownedReview.documentId, signal);
        return receipt;
      }
      check(exact(review, ['status', 'version', 'actorUserId', 'documentId',
        'currentReceipt', 'wire', 'expectedArchivedSemanticIds'])
        && review.status === 'reviewed' && review.version === 1
        && uuid(review.actorUserId) && uuid(review.documentId));
      const actorUserId = getActorUserId();
      check(actorUserId === review.actorUserId,
        'DOCUMENT_DEFINITION_REVISION_STALE', 'The document or account changed.');
      current(actorUserId, review.documentId, signal);
      const wire = validateDocumentDefinitionRevisionPreview(review.wire, review.documentId);
      const currentReceipt = await validateDocumentDefinitionRevisionReceipt(
        review.currentReceipt, review.documentId, cryptoImpl);
      current(actorUserId, review.documentId, signal);
      check(currentReceipt.definitionRevision === wire.current.definitionRevision
        && currentReceipt.definitionDigest === wire.current.definitionDigest,
      'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
      'The document definition review base changed.');
      const expectedArchives = combinedArchives(currentReceipt.archivedSemanticIds,
        wire.review.archivedSemanticIds);
      check(sameSemanticIdSet(copySemanticIds(review.expectedArchivedSemanticIds), expectedArchives),
        'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
        'The document definition review archive set changed.');
      const receipt = await validateDocumentDefinitionRevisionReceipt(await call(actorUserId,
        review.documentId, 'apply_reviewed_document_definition_revision', {
          p_document_id:review.documentId,
          p_expected_current_revision:wire.current.definitionRevision,
          p_expected_current_digest:wire.current.definitionDigest,
          p_survey_template_id:wire.surveyDefinition.source.templateId,
          p_expected_survey_template_updated_at:wire.surveyDefinition.source.templateUpdatedAt,
          p_expected_survey_structure_sha256:wire.surveyDefinition.source.structureSha256,
          p_entity_template_id:wire.entityCatalog.source.templateId,
          p_expected_entity_template_updated_at:wire.entityCatalog.source.templateUpdatedAt,
          p_expected_entity_entities_sha256:wire.entityCatalog.source.entitiesSha256,
          p_archived_semantic_ids:wire.review.archivedSemanticIds,
          p_operation_id:wire.review.operationId,
          p_request_sha256:wire.review.requestSha256,
        }, signal), review.documentId);
      check(receipt.definitionRevision === wire.current.definitionRevision + 1
        && same(receipt.surveyDefinition, wire.surveyDefinition)
        && same(receipt.entityCatalog, wire.entityCatalog)
        && sameSemanticIdSet(receipt.archivedSemanticIds, expectedArchives)
        && receipt.review.operationId === wire.review.operationId
        && receipt.review.requestSha256 === wire.review.requestSha256,
      'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
      'The applied document definition does not match its review.');
      current(actorUserId, review.documentId, signal);
      return receipt;
    },
  });
}
