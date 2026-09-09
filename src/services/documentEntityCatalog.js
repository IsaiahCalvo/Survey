import { toHex6 } from './templateConfigShape.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_ID = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_ENTITIES = 256;

export class DocumentEntityCatalogError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocumentEntityCatalogError';
    this.code = code;
  }
}

const fail = (code, message) => new DocumentEntityCatalogError(code, message);
const check = (value, code = 'DOCUMENT_ENTITY_CATALOG_INVALID', message = 'The document entity list is invalid.') => {
  if (!value) throw fail(code, message);
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const asciiTrim = value => value.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, '');

// Keep this byte-for-byte aligned with the SQL helper: NFC, ASCII whitespace
// folding and ASCII case folding. Non-ASCII case remains distinct.
export const normalizeDocumentEntityName = value => String(value || '')
  .normalize('NFC')
  .replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, '')
  .replace(/[ \t\n\f\r]+/g, ' ')
  .replace(/[A-Z]/g, char => char.toLowerCase());

function normalizeTemplateEntity(value) {
  check(plain(value));
  const allowed = new Set(['id', 'name', 'role', 'color', 'opacity', 'borderColor',
    'borderOpacity', 'matchFill']);
  check(Object.keys(value).every(key => allowed.has(key)));
  const color = toHex6(value.color);
  const opacity = Number.isFinite(value.opacity) ? value.opacity : 0.35;
  const matchFill = value.matchFill === true;
  return { id: value.id, name: value.name || value.role, color, opacity,
    borderColor: value.borderColor ? toHex6(value.borderColor) : null,
    borderOpacity: Number.isFinite(value.borderOpacity) ? value.borderOpacity : null,
    matchFill };
}

function copyEntity(value) {
  check(exact(value, ['id', 'name', 'color', 'opacity', 'borderColor', 'borderOpacity', 'matchFill']));
  check(typeof value.id === 'string' && value.id === asciiTrim(value.id)
    && value.id.length > 0 && value.id.length <= 128);
  check(typeof value.name === 'string' && value.name === asciiTrim(value.name)
    && value.name.length > 0 && value.name.length <= 256);
  check(typeof value.color === 'string' && /^#[0-9a-f]{6}$/.test(value.color));
  check(Number.isFinite(value.opacity) && value.opacity >= 0 && value.opacity <= 1);
  check(value.borderColor === null || (typeof value.borderColor === 'string' && /^#[0-9a-f]{6}$/.test(value.borderColor)));
  check(value.borderOpacity === null || (Number.isFinite(value.borderOpacity)
    && value.borderOpacity >= 0 && value.borderOpacity <= 1));
  check(typeof value.matchFill === 'boolean');
  return Object.freeze({ id: value.id, name: value.name, color: value.color,
    opacity: value.opacity, borderColor: value.borderColor, borderOpacity: value.borderOpacity,
    matchFill: value.matchFill });
}

function copyEntities(values) {
  check(Array.isArray(values) && values.length <= MAX_ENTITIES);
  const entities = values.map(copyEntity);
  const ids = new Set();
  const names = new Set();
  for (const entity of entities) {
    const name = normalizeDocumentEntityName(entity.name);
    check(name && !ids.has(entity.id) && !names.has(name));
    ids.add(entity.id); names.add(name);
  }
  return Object.freeze(entities);
}

export const captureDocumentEntities = copyEntities;
export const captureTemplateEntities = values => {
  check(Array.isArray(values) && values.length <= MAX_ENTITIES);
  return copyEntities(values.map(normalizeTemplateEntity));
};

function copyPreview(value, documentId = null) {
  check(exact(value, ['status', 'version', 'documentId', 'source', 'entities'])
    && exact(value.source, ['templateId', 'templateUpdatedAt', 'entitiesSha256']));
  check(value.status === 'preview' && value.version === 1 && UUID.test(value.documentId || '')
    && (!documentId || value.documentId === documentId) && UUID.test(value.source.templateId || '')
    && iso(value.source.templateUpdatedAt) && SHA256.test(value.source.entitiesSha256 || ''));
  return Object.freeze({ status: 'preview', version: 1, documentId: value.documentId,
    source: Object.freeze({ templateId: value.source.templateId,
      templateUpdatedAt: value.source.templateUpdatedAt, entitiesSha256: value.source.entitiesSha256 }),
    entities: copyEntities(value.entities) });
}

export const captureTemplateEntityPreview = copyPreview;

export function validateDocumentEntityCatalog(value, documentId = null) {
  if (exact(value, ['status', 'version', 'documentId'])) {
    check(value.status === 'unadopted' && value.version === 1 && UUID.test(value.documentId || '')
      && (!documentId || value.documentId === documentId));
    return Object.freeze({ status: 'unadopted', version: 1, documentId: value.documentId });
  }
  check(exact(value, ['status', 'version', 'documentId', 'catalogRevision', 'source', 'seed', 'entities'])
    && exact(value.source, ['templateId', 'templateUpdatedAt', 'entitiesSha256'])
    && exact(value.seed, ['operationId', 'requestSha256']));
  check(value.status === 'accepted' && value.version === 1 && value.catalogRevision === 1
    && UUID.test(value.documentId || '') && (!documentId || value.documentId === documentId)
    && UUID.test(value.source.templateId || '') && iso(value.source.templateUpdatedAt)
    && SHA256.test(value.source.entitiesSha256 || '') && UUID.test(value.seed.operationId || '')
    && SHA256.test(value.seed.requestSha256 || ''));
  return Object.freeze({ status: 'accepted', version: 1, documentId: value.documentId,
    catalogRevision: 1, source: Object.freeze({ templateId: value.source.templateId,
      templateUpdatedAt: value.source.templateUpdatedAt, entitiesSha256: value.source.entitiesSha256 }),
    seed: Object.freeze({ operationId: value.seed.operationId, requestSha256: value.seed.requestSha256 }),
    entities: copyEntities(value.entities) });
}

export function validateManagedLocalEntityCatalog(value, localId = null) {
  check(exact(value, ['status', 'version', 'documentId', 'catalogRevision', 'sourceTemplateId',
    'sourceTemplateUpdatedAt', 'sourceEntitiesSha256', 'entities']));
  check(value.status === 'accepted' && value.version === 1 && value.catalogRevision === 1
    && LOCAL_ID.test(value.documentId || '')
    && (!localId || value.documentId === localId)
    && typeof value.sourceTemplateId === 'string' && value.sourceTemplateId.length > 0
    && value.sourceTemplateId.length <= 256
    && (value.sourceTemplateUpdatedAt === null || iso(value.sourceTemplateUpdatedAt))
    && SHA256.test(value.sourceEntitiesSha256 || ''));
  return Object.freeze({ status: 'accepted', version: 1, documentId: value.documentId,
    catalogRevision: 1, sourceTemplateId: value.sourceTemplateId,
    sourceTemplateUpdatedAt: value.sourceTemplateUpdatedAt,
    sourceEntitiesSha256: value.sourceEntitiesSha256, entities: copyEntities(value.entities) });
}

function stable(value) {
  return value && typeof value === 'object'
    ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
    : JSON.stringify(value);
}

async function sha256(value) {
  check(globalThis.crypto?.subtle, 'DOCUMENT_ENTITY_CATALOG_UNAVAILABLE',
    'Document entity lists are not available in this browser.');
  const bytes = new TextEncoder().encode(stable(value));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function documentEntityAdoptionIdentity(preview, operationId) {
  const owned = copyPreview(preview);
  check(UUID.test(operationId || ''));
  const request = { version: 1, documentId: owned.documentId,
    sourceTemplateId: owned.source.templateId,
    sourceTemplateUpdatedAt: owned.source.templateUpdatedAt,
    sourceEntitiesSha256: owned.source.entitiesSha256, operationId };
  return Object.freeze({ operationId, requestSha256: await sha256(request) });
}

export async function captureManagedLocalEntityCatalog({ localId, template } = {}) {
  check(LOCAL_ID.test(localId || '') && plain(template));
  const sourceTemplateId = template.supabaseId || template.id;
  const sourceTemplateUpdatedAt = template.updated_at || template.updatedAt || null;
  check(typeof sourceTemplateId === 'string' && sourceTemplateId.length > 0
    && sourceTemplateId.length <= 256
    && (sourceTemplateUpdatedAt === null || iso(sourceTemplateUpdatedAt)));
  const entities = captureTemplateEntities(template.entities || template.config?.entities || []);
  const sourceEntitiesSha256 = await sha256(entities);
  return validateManagedLocalEntityCatalog({ status: 'accepted', version: 1,
    documentId: localId, catalogRevision: 1, sourceTemplateId, sourceTemplateUpdatedAt,
    sourceEntitiesSha256, entities }, localId);
}

function rpcResult(value, error) {
  if (error) {
    if (error.code === '42501' || [401, 403].includes(error.status || error.statusCode)) {
      throw fail('DOCUMENT_ENTITY_CATALOG_FORBIDDEN', 'You no longer have access to this document entity list.');
    }
    const conflict = ['23505', '23514', '40001'].includes(error.code);
    throw fail(conflict ? 'DOCUMENT_ENTITY_CATALOG_CONFLICT' : 'DOCUMENT_ENTITY_CATALOG_UNAVAILABLE',
      conflict ? 'The document entity list changed. Review it again.' : 'The document entity list could not be loaded.');
  }
  return value;
}

/** A small adapter over the owner/member RPCs. It never accepts an entity list
 * for adoption: the server copies the exact template preview it issued. */
export function createDocumentEntityCatalogClient({ rpc, enabled = false } = {}) {
  check(typeof rpc === 'function');
  const available = () => check(enabled, 'DOCUMENT_ENTITY_CATALOG_DISABLED',
    'Shared document entity lists are not enabled.');
  const call = async (name, args, signal) => {
    available();
    check(signal?.aborted !== true, 'DOCUMENT_ENTITY_CATALOG_STALE', 'The document changed.');
    let result;
    try { result = await rpc(name, args, { signal }); }
    catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        throw fail('DOCUMENT_ENTITY_CATALOG_STALE', 'The document changed.');
      }
      return rpcResult(null, error || { code: 'transport_failed' });
    }
    check(signal?.aborted !== true, 'DOCUMENT_ENTITY_CATALOG_STALE', 'The document changed.');
    return rpcResult(result?.data, result?.error);
  };
  return Object.freeze({
    async read({ documentId, signal } = {}) {
      check(UUID.test(documentId || ''));
      return validateDocumentEntityCatalog(await call('read_document_entity_catalog', {
        p_document_id: documentId,
      }, signal), documentId);
    },
    async preview({ documentId, templateId, signal } = {}) {
      check(UUID.test(documentId || '') && UUID.test(templateId || ''));
      return copyPreview(await call('preview_document_entity_catalog_adoption', {
        p_document_id: documentId, p_template_id: templateId,
      }, signal), documentId);
    },
    async adopt({ preview, operationId, signal } = {}) {
      const owned = copyPreview(preview);
      const identity = await documentEntityAdoptionIdentity(owned, operationId);
      const requestSha256 = identity.requestSha256;
      const result = await call('adopt_document_entity_catalog', {
        p_document_id: owned.documentId, p_template_id: owned.source.templateId,
        p_expected_template_updated_at: owned.source.templateUpdatedAt,
        p_expected_entities_sha256: owned.source.entitiesSha256,
        p_operation_id: operationId, p_request_sha256: requestSha256,
      }, signal);
      const accepted = validateDocumentEntityCatalog(result, owned.documentId);
      check(accepted.status === 'accepted' && accepted.seed.operationId === operationId
        && accepted.seed.requestSha256 === requestSha256
        && accepted.source.templateId === owned.source.templateId
        && accepted.source.templateUpdatedAt === owned.source.templateUpdatedAt
        && accepted.source.entitiesSha256 === owned.source.entitiesSha256);
      return accepted;
    },
  });
}

export function resolveDocumentEntityName(name, entities) {
  const normalized = normalizeDocumentEntityName(name);
  if (!normalized) return Object.freeze({ status: 'empty', entity: null });
  check(Array.isArray(entities) && entities.length <= MAX_ENTITIES);
  const matches = entities.map(normalizeTemplateEntity).map(copyEntity)
    .filter(entity => normalizeDocumentEntityName(entity.name) === normalized);
  if (matches.length !== 1) return Object.freeze({ status: matches.length ? 'ambiguous' : 'unknown', entity: null });
  return Object.freeze({ status: 'matched', entity: matches[0] });
}

export function withDocumentEntities(template, catalog) {
  if (!template || typeof template !== 'object' || catalog?.status !== 'accepted') return template;
  return { ...template, entities: catalog.entities };
}
