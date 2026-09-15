import { randomUUID } from '../utils/randomUUIDPolyfill.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,18})$/;
const CONTRIBUTOR = new Set(['annotation-snapshot', 'annotation-wal',
  'document-annotations', 'legacy-yjs-annotations']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const uuid = value => typeof value === 'string' && UUID.test(value);
const sha = value => typeof value === 'string' && SHA.test(value);
const decimal = value => typeof value === 'string' && DECIMAL.test(value)
  && BigInt(value) <= 9223372036854775807n;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const error = (code, message) => Object.assign(new Error(message), { code });
const check = (value, code = 'DOCUMENT_FIRST_GENERATION_ADOPTION_PROTOCOL',
  message = 'The document upgrade response could not be verified.') => {
  if (!value) throw error(code, message);
};

function definitions(value) {
  check(exact(value, ['status', 'revision', 'content_sha256'])
    && ['absent', 'accepted'].includes(value.status));
  if (value.status === 'absent') check(value.revision === null && value.content_sha256 === null);
  else check(decimal(value.revision) && BigInt(value.revision) > 0n && sha(value.content_sha256));
  return Object.freeze({ ...value });
}

function annotations(value) {
  check(exact(value, ['version', 'policy', 'through_seq', 'baseline_sha256', 'contributors'])
    && value.version === 1 && value.policy === 'legacy-sql-v1'
    && decimal(value.through_seq) && sha(value.baseline_sha256)
    && Array.isArray(value.contributors));
  const contributors = [...value.contributors];
  check(contributors.every(item => CONTRIBUTOR.has(item))
    && new Set(contributors).size === contributors.length);
  const hasPrimary = contributors.includes('annotation-snapshot')
    || contributors.includes('annotation-wal');
  if (hasPrimary) check(!contributors.includes('document-annotations')
    && !contributors.includes('legacy-yjs-annotations'));
  return Object.freeze({ version: 1, policy: value.policy, through_seq: value.through_seq,
    baseline_sha256: value.baseline_sha256, contributors: Object.freeze(contributors) });
}

function typedObjects(values) {
  check(Array.isArray(values) && [1, 2].includes(values.length));
  const result = values.map((value, index) => {
    check(exact(value, ['kind', 'byte_length', 'content_sha256'])
      && value.kind === (index === 0 ? 'pdf' : 'sidecar')
      && decimal(value.byte_length) && BigInt(value.byte_length) > 0n
      && sha(value.content_sha256));
    return Object.freeze({ ...value });
  });
  return Object.freeze(result);
}

const BASE_KEYS = ['version', 'state', 'actor_user_id', 'owner_user_id', 'document_id',
  'adoption_operation_id', 'source_id', 'candidate_operation_id',
  'offered_archive_operation_ids', 'used_archive_operation_ids', 'review_sha256',
  'source_sql_sha256', 'wal_head', 'objects', 'canonical_annotations', 'entity_catalog',
  'survey_definition', 'expires_at'];

export function validateDocumentFirstGenerationAdoptionReceipt(value, expected = {}) {
  if (exact(value, ['version', 'state', 'actor_user_id', 'adoption_operation_id'])) {
    check(value.version === 1 && value.state === 'missing' && uuid(value.actor_user_id)
      && uuid(value.adoption_operation_id));
    if (expected.actorUserId) check(value.actor_user_id === expected.actorUserId);
    if (expected.adoptionOperationId) check(value.adoption_operation_id === expected.adoptionOperationId);
    return Object.freeze({ ...value });
  }
  check(object(value) && ['review', 'confirmed', 'published'].includes(value.state));
  const extra = value.state === 'review' ? [] : value.state === 'confirmed'
    ? ['confirmed_at'] : ['confirmed_at', 'generation_id', 'content_model_version', 'pdf',
      'legacy_sidecar_migration', 'published_at'];
  check(exact(value, [...BASE_KEYS, ...extra]) && value.version === 1
    && [value.actor_user_id, value.owner_user_id, value.document_id,
      value.adoption_operation_id, value.source_id, value.candidate_operation_id].every(uuid)
    && sha(value.review_sha256) && sha(value.source_sql_sha256) && decimal(value.wal_head)
    && iso(value.expires_at));
  if (expected.actorUserId) check(value.actor_user_id === expected.actorUserId);
  if (expected.documentId) check(value.document_id === expected.documentId);
  if (expected.adoptionOperationId) check(value.adoption_operation_id === expected.adoptionOperationId);
  if (expected.sourceId) check(value.source_id === expected.sourceId);
  if (expected.candidateOperationId) check(value.candidate_operation_id === expected.candidateOperationId);
  const offered = value.offered_archive_operation_ids;
  const used = value.used_archive_operation_ids;
  check(Array.isArray(offered) && offered.length === 2 && offered.every(uuid)
    && new Set(offered).size === 2 && Array.isArray(used) && [1, 2].includes(used.length)
    && used.every((id, index) => id === offered[index]));
  if (expected.archiveOperationIds) check(JSON.stringify(offered) === JSON.stringify(expected.archiveOperationIds));
  const objects = typedObjects(value.objects);
  check(objects.length === used.length);
  const canonical = annotations(value.canonical_annotations);
  const entityCatalog = definitions(value.entity_catalog);
  const surveyDefinition = definitions(value.survey_definition);
  const common = { ...value, offered_archive_operation_ids: Object.freeze([...offered]),
    used_archive_operation_ids: Object.freeze([...used]), objects,
    canonical_annotations: canonical, entity_catalog: entityCatalog,
    survey_definition: surveyDefinition };
  if (value.state !== 'review') check(iso(value.confirmed_at));
  if (value.state === 'published') {
    check(uuid(value.generation_id) && value.content_model_version === 2 && iso(value.published_at)
      && exact(value.pdf, ['byte_length', 'content_sha256'])
      && decimal(value.pdf.byte_length) && BigInt(value.pdf.byte_length) > 0n
      && sha(value.pdf.content_sha256)
      && value.pdf.byte_length === objects[0].byte_length
      && value.pdf.content_sha256 === objects[0].content_sha256
      && exact(value.legacy_sidecar_migration, ['version', 'state', 'origin'])
      && value.legacy_sidecar_migration.version === 2
      && value.legacy_sidecar_migration.state === 'archived'
      && exact(value.legacy_sidecar_migration.origin, ['mode', 'adoption_operation_id'])
      && value.legacy_sidecar_migration.origin.mode === 'legacy'
      && value.legacy_sidecar_migration.origin.adoption_operation_id === value.adoption_operation_id);
    common.pdf = Object.freeze({ ...value.pdf });
    common.legacy_sidecar_migration = Object.freeze({ version: 2, state: 'archived',
      origin: Object.freeze({ ...value.legacy_sidecar_migration.origin }) });
  }
  return Object.freeze(common);
}

export function createDocumentFirstGenerationAdoptionIds() {
  const ids = Array.from({ length: 5 }, () => randomUUID());
  check(new Set(ids).size === 5 && ids.every(uuid), 'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT');
  return Object.freeze({ adoptionOperationId: ids[0], sourceId: ids[1],
    candidateOperationId: ids[2], archiveOperationIds: Object.freeze(ids.slice(3)) });
}

const SAFE_HTTP = new Map([
  [400, 'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT'],
  [401, 'DOCUMENT_FIRST_GENERATION_ADOPTION_ACTOR_CHANGED'],
  [403, 'DOCUMENT_FIRST_GENERATION_ADOPTION_FORBIDDEN'],
  [409, 'DOCUMENT_FIRST_GENERATION_ADOPTION_CONFLICT'],
  [410, 'DOCUMENT_FIRST_GENERATION_ADOPTION_EXPIRED'],
  [503, 'DOCUMENT_FIRST_GENERATION_ADOPTION_UNAVAILABLE'],
]);

/** Bearer-bound HTTP adapter. The browser sends no actor, owner, plan, bytes,
 * generation, content-model, or Storage identity. */
export function createDocumentFirstGenerationAdoptionTransport({ supabaseUrl, publicKey,
  fetch: fetcher = globalThis.fetch, allowLoopback = false } = {}) {
  check(typeof supabaseUrl === 'string' && typeof publicKey === 'string'
    && publicKey.length > 0 && publicKey.length <= 16384 && typeof fetcher === 'function',
  'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT');
  let origin;
  try { origin = new URL(supabaseUrl); } catch { throw error('DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT', 'The upgrade service is unavailable.'); }
  check(!origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/'
    && (origin.protocol === 'https:' || (allowLoopback && origin.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))),
  'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT');
  const endpoint = new URL('/functions/v1/document-generation-adoption', origin).href;
  return async ({ body, accessToken, signal }) => {
    check(object(body) && typeof accessToken === 'string' && accessToken.length > 0
      && accessToken.length <= 16384 && !/[\s\u0000-\u001f\u007f]/.test(accessToken),
    'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT');
    const response = await fetcher(endpoint, { method: 'POST', redirect: 'error',
      credentials: 'omit', cache: 'no-store', signal,
      headers: { Authorization: `Bearer ${accessToken}`, apikey: publicKey,
        'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let result;
    try { result = await response.json(); } catch { throw error('DOCUMENT_FIRST_GENERATION_ADOPTION_PROTOCOL', 'The upgrade response could not be read.'); }
    if (!response.ok) {
      const code = SAFE_HTTP.get(response.status) || 'DOCUMENT_FIRST_GENERATION_ADOPTION_UNAVAILABLE';
      throw error(code, response.status === 409
        ? 'The document changed. Review the upgrade again.' : 'The document could not be upgraded.');
    }
    return result;
  };
}

export const documentFirstGenerationAdoptionBody = Object.freeze({
  preview(ids, documentId) {
    check(uuid(documentId) && ids && uuid(ids.adoptionOperationId) && uuid(ids.sourceId)
      && uuid(ids.candidateOperationId) && Array.isArray(ids.archiveOperationIds)
      && ids.archiveOperationIds.length === 2 && ids.archiveOperationIds.every(uuid),
    'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT');
    check(new Set([ids.adoptionOperationId, ids.sourceId, ids.candidateOperationId,
      ...ids.archiveOperationIds]).size === 5, 'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT');
    return Object.freeze({ action: 'preview', document_id: documentId,
      adoption_operation_id: ids.adoptionOperationId, source_id: ids.sourceId,
      candidate_operation_id: ids.candidateOperationId,
      archive_operation_ids: Object.freeze([...ids.archiveOperationIds]) });
  },
  confirm(operationId, reviewSha256) {
    check(uuid(operationId) && sha(reviewSha256), 'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT');
    return Object.freeze({ action: 'confirm', adoption_operation_id: operationId,
      review_sha256: reviewSha256 });
  },
  status(operationId) {
    check(uuid(operationId), 'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT');
    return Object.freeze({ action: 'status', adoption_operation_id: operationId });
  },
  publish(operationId, reviewSha256) {
    check(uuid(operationId) && sha(reviewSha256), 'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT');
    return Object.freeze({ action: 'publish', adoption_operation_id: operationId,
      review_sha256: reviewSha256 });
  },
});
