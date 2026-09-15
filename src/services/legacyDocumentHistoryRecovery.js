const STORAGE_KEY = 'survey_document_history_events_v1';
const MAX_RAW_BYTES = 2_000_000;
const MAX_BUCKETS = 100;
const MAX_ROWS_PER_BUCKET = 500;
const MAX_TOTAL_ROWS = 2_000;
const MAX_ROW_BYTES = 512_000;
const MAX_PAYLOAD_BYTES = 384_000;
const MAX_DEPTH = 32;
const MAX_NODES = 20_000;
const MAX_ARRAY_LENGTH = 10_000;
const MAX_STRING_CHARS = 262_144;
const POISON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const codedError = (code, message) => Object.assign(new Error(message), { code });
const validText = (value, max = 512) => typeof value === 'string' && value.length > 0
  && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const byteLength = value => new TextEncoder().encode(value).length;
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

function requireAuthorization(authorized, authorizationToken) {
  if (authorized !== true || !validText(authorizationToken, 512)) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_AUTHORIZATION_REQUIRED',
      'Confirm that you are allowed to inspect this older local history.');
  }
}

async function sha256(value) {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw codedError('LEGACY_DOCUMENT_HISTORY_DIGEST_UNAVAILABLE',
      'Older local history cannot be checked safely in this browser.');
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function readRaw(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    throw codedError('LEGACY_DOCUMENT_HISTORY_STORAGE_UNAVAILABLE',
      'Older local history storage is not available.');
  }
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    throw codedError('LEGACY_DOCUMENT_HISTORY_READ_FAILED',
      'Older local history could not be read. It was left unchanged.');
  }
}

function inspectTree(value, label) {
  let nodes = 0;
  let stringChars = 0;
  const visit = (current, depth) => {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) {
      throw codedError('LEGACY_DOCUMENT_HISTORY_VALUE_TOO_COMPLEX', `${label} is too complex to recover safely.`);
    }
    if (typeof current === 'string') {
      stringChars += current.length;
      if (stringChars > MAX_STRING_CHARS || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(current)) {
        throw codedError('LEGACY_DOCUMENT_HISTORY_VALUE_INVALID', `${label} contains invalid text.`);
      }
      return;
    }
    if (current === null || typeof current === 'number' || typeof current === 'boolean') {
      if (typeof current === 'number' && !Number.isFinite(current)) {
        throw codedError('LEGACY_DOCUMENT_HISTORY_VALUE_INVALID', `${label} contains an invalid number.`);
      }
      return;
    }
    if (Array.isArray(current)) {
      if (current.length > MAX_ARRAY_LENGTH) {
        throw codedError('LEGACY_DOCUMENT_HISTORY_VALUE_TOO_COMPLEX', `${label} contains an oversized list.`);
      }
      current.forEach(item => visit(item, depth + 1));
      return;
    }
    if (!plainObject(current)) {
      throw codedError('LEGACY_DOCUMENT_HISTORY_VALUE_INVALID', `${label} contains an invalid value.`);
    }
    for (const key of Object.keys(current)) {
      if (POISON_KEYS.has(key) || !validText(key, 256)) {
        throw codedError('LEGACY_DOCUMENT_HISTORY_VALUE_INVALID', `${label} contains an unsafe field.`);
      }
      visit(current[key], depth + 1);
    }
  };
  visit(value, 0);
}

function validRestoreAction(action, type) {
  if (!plainObject(action) || action.type !== type) return false;
  const matchesOptionalId = (object, field, expected) => !Object.hasOwn(object, field)
    || (validText(object[field], 1024) && object[field] === expected);
  const normalizedPage = value => {
    if (value === null) return null;
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) return undefined;
    const page = Number(value);
    return Number.isSafeInteger(page) && page >= 1 ? page : undefined;
  };
  const matchesOptionalPage = (object, field, expected) => !Object.hasOwn(object, field)
    || (normalizedPage(object[field]) !== undefined && normalizedPage(object[field]) === normalizedPage(expected));
  if (type === 'fabric:create') return validText(action.annotationId)
    && normalizedPage(action.pageNumber) !== undefined && normalizedPage(action.pageNumber) !== null
    && matchesOptionalId(action, 'storageKey', action.annotationId)
    && plainObject(action.annotation)
    && matchesOptionalId(action.annotation, 'id', action.annotationId)
    && matchesOptionalId(action.annotation, 'annotationId', action.annotationId)
    && matchesOptionalId(action.annotation, 'pdfAnnotationId', action.annotationId)
    && (!Object.hasOwn(action.annotation, 'data') || !plainObject(action.annotation.data)
      || (matchesOptionalId(action.annotation.data, 'id', action.annotationId)
        && matchesOptionalId(action.annotation.data, 'annoId', action.annotationId)))
    && matchesOptionalPage(action.annotation, 'pageNumber', action.pageNumber)
    && matchesOptionalPage(action.annotation, 'pageId', action.pageNumber);
  if (type === 'callout') return validText(action.calloutId) && plainObject(action.callout)
    && validText(action.callout.id, 1024) && action.callout.id === action.calloutId
    && matchesOptionalPage(action.callout, 'pageNumber', action.pageNumber)
    && (!Object.hasOwn(action, 'pageNumber') || normalizedPage(action.pageNumber) !== undefined);
  if (type === 'surveyMarker') return validText(action.markerId) && plainObject(action.surveyMarker)
    && matchesOptionalId(action.surveyMarker, 'id', action.markerId)
    && matchesOptionalPage(action.surveyMarker, 'pageNumber', action.pageNumber)
    && (!Object.hasOwn(action, 'pageNumber') || normalizedPage(action.pageNumber) !== undefined);
  if (type === 'region') return validText(action.regionId) && validText(action.spaceId) && plainObject(action.region)
    && validText(action.region.regionId, 1024) && action.region.regionId === action.regionId
    && matchesOptionalPage(action.region, 'pageId', action.pageNumber)
    && (!Object.hasOwn(action, 'pageNumber') || normalizedPage(action.pageNumber) !== undefined);
  if (type === 'space') return validText(action.spaceId) && plainObject(action.space)
    && validText(action.space.id, 1024) && action.space.id === action.spaceId;
  return false;
}

function canRestore(row) {
  const action = row.payload?.restoreAction;
  const singles = {
    annotation_deleted:'fabric:create', callout_deleted:'callout', survey_marker_deleted:'surveyMarker',
    region_deleted:'region', space_deleted:'space',
  };
  if (Object.hasOwn(singles, row.event_type)) {
    const type = singles[row.event_type];
    if (!validRestoreAction(action, type)) return false;
    const targetFields = {
      'fabric:create':['annotationId','annotationId'], callout:['calloutId','calloutId'],
      surveyMarker:['markerId','annotationId'], region:['regionId','regionId'], space:['spaceId','spaceId'],
    };
    const [actionField, payloadField] = targetFields[type];
    const targetId = action[actionField];
    if (Object.hasOwn(row, 'annotation_id') && row.annotation_id !== targetId) return false;
    if (Object.hasOwn(row.payload, payloadField) && row.payload[payloadField] !== targetId) return false;
    const normalizedPage = value => {
      if (value === null) return null;
      if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) return undefined;
      const page = Number(value);
      return Number.isSafeInteger(page) && page >= 1 ? page : undefined;
    };
    for (const claimedPage of [
      Object.hasOwn(row, 'page_number') ? row.page_number : undefined,
      Object.hasOwn(row.payload, 'pageNumber') ? row.payload.pageNumber : undefined,
    ]) {
      if (claimedPage === undefined) continue;
      if (claimedPage === null) {
        if (Object.hasOwn(action, 'pageNumber') && action.pageNumber !== null) return false;
        continue;
      }
      if (!Object.hasOwn(action, 'pageNumber') || normalizedPage(claimedPage) === undefined
        || normalizedPage(claimedPage) !== normalizedPage(action.pageNumber)) return false;
    }
    return true;
  }
  if (row.event_type !== 'annotations_bulk_deleted') return false;
  const objects = row.payload?.objects;
  return Array.isArray(objects) && objects.length > 0 && objects.length <= 50
    && objects.every(item => plainObject(item) && plainObject(item.restoreAction)
      && ['fabric:create','callout','region'].some(type => validRestoreAction(item.restoreAction, type)));
}

function validateRow(source, bucketId, index) {
  const label = `History row ${index + 1} in ${bucketId}`;
  if (!plainObject(source)) throw codedError('LEGACY_DOCUMENT_HISTORY_ROW_INVALID', `${label} is invalid.`);
  const serialized = JSON.stringify(source);
  if (byteLength(serialized) > MAX_ROW_BYTES) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_ROW_TOO_LARGE', `${label} is too large to recover safely.`);
  }
  inspectTree(source, label);
  if (!validText(source.document_id, 256) || source.document_id !== bucketId
    || !validText(source.client_event_id || source.id, 1024)
    || !validText(source.event_type, 128)
    || !validText(source.summary, 4_000)
    || !plainObject(source.payload)) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_ROW_INVALID', `${label} does not match its history bucket.`);
  }
  if (byteLength(JSON.stringify(source.payload)) > MAX_PAYLOAD_BYTES) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_PAYLOAD_TOO_LARGE', `${label} has restore data that is too large.`);
  }
  if (source.page_number != null && (!Number.isSafeInteger(source.page_number) || source.page_number < 1)) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_ROW_INVALID', `${label} has an invalid page.`);
  }
  for (const field of ['id','user_id','source','annotation_id','occurred_at','created_at']) {
    if (source[field] != null && !validText(source[field], field.endsWith('_at') ? 128 : 1024)) {
      throw codedError('LEGACY_DOCUMENT_HISTORY_ROW_INVALID', `${label} has an invalid ${field}.`);
    }
  }
  for (const field of ['is_undoable','is_checkpoint','__local']) {
    if (source[field] != null && typeof source[field] !== 'boolean') {
      throw codedError('LEGACY_DOCUMENT_HISTORY_ROW_INVALID', `${label} has an invalid ${field}.`);
    }
  }
  const row = {
    id:source.id || source.client_event_id,
    document_id:source.document_id,
    user_id:source.user_id ?? null,
    client_event_id:source.client_event_id || source.id,
    event_type:source.event_type,
    source:source.source ?? null,
    page_number:source.page_number ?? null,
    annotation_id:source.annotation_id ?? null,
    summary:source.summary,
    payload:structuredClone(source.payload),
    is_undoable:source.is_undoable === true,
    is_checkpoint:source.is_checkpoint === true,
    occurred_at:source.occurred_at ?? source.created_at ?? null,
    created_at:source.created_at ?? source.occurred_at ?? null,
    __local:true,
  };
  return Object.freeze({ ...row, __legacyRecovery:true, __canRestore:canRestore(source) });
}

function parseRaw(raw) {
  if (typeof raw !== 'string' || byteLength(raw) > MAX_RAW_BYTES) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_TOO_LARGE',
      'Older local history is too large to recover safely. It was left unchanged.');
  }
  let root;
  try { root = JSON.parse(raw); } catch {
    throw codedError('LEGACY_DOCUMENT_HISTORY_INVALID',
      'Older local history is malformed. It was left unchanged.');
  }
  if (!plainObject(root)) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_INVALID', 'Older local history has an invalid format.');
  }
  const bucketIds = Object.keys(root);
  if (bucketIds.length > MAX_BUCKETS) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_TOO_LARGE', 'Older local history has too many document groups.');
  }
  let totalRows = 0;
  const buckets = new Map();
  for (const bucketId of bucketIds) {
    if (POISON_KEYS.has(bucketId) || !validText(bucketId, 256) || !Object.hasOwn(root, bucketId)
      || !Array.isArray(root[bucketId]) || root[bucketId].length > MAX_ROWS_PER_BUCKET) {
      throw codedError('LEGACY_DOCUMENT_HISTORY_BUCKET_INVALID', 'An older local history document group is invalid.');
    }
    totalRows += root[bucketId].length;
    if (totalRows > MAX_TOTAL_ROWS) {
      throw codedError('LEGACY_DOCUMENT_HISTORY_TOO_LARGE', 'Older local history contains too many rows.');
    }
    buckets.set(bucketId, root[bucketId].map((row, index) => validateRow(row, bucketId, index)));
  }
  return buckets;
}

export async function inspectLegacyDocumentHistory({ authorized, authorizationToken, storage } = {}) {
  requireAuthorization(authorized, authorizationToken);
  const raw = readRaw(storage);
  if (raw == null) return Object.freeze({ status:'absent',version:1,buckets:[] });
  const buckets = parseRaw(raw);
  const inspectionDigest = await sha256(raw);
  const authorizationDigest = await sha256(`authorization:${authorizationToken}`);
  return Object.freeze({
    status:'ready', version:1, inspectionDigest, authorizationDigest,
    buckets:[...buckets].map(([bucketId, rows]) => Object.freeze({
      bucketId, rowCount:rows.length, recoverableRowCount:rows.filter(row => row.__canRestore).length,
    })),
  });
}

export async function selectLegacyDocumentHistoryBucket(inspection, {
  authorized, authorizationToken, storage, sourceBucketId,
  confirmedSourceBucketId, openLocalDocumentId, confirmedOpenLocalDocumentId,
} = {}) {
  requireAuthorization(authorized, authorizationToken);
  if (inspection?.status !== 'ready' || inspection.version !== 1
    || !validText(inspection.inspectionDigest, 64) || !validText(inspection.authorizationDigest, 64)
    || !validText(sourceBucketId, 256) || !validText(openLocalDocumentId, 256)
    || confirmedSourceBucketId !== sourceBucketId
    || confirmedOpenLocalDocumentId !== openLocalDocumentId) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_SELECTION_INVALID',
      'Confirm the open local PDF before selecting older history.');
  }
  if (await sha256(`authorization:${authorizationToken}`) !== inspection.authorizationDigest) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_AUTHORIZATION_CHANGED',
      'The older history inspection approval is no longer current.');
  }
  const raw = readRaw(storage);
  if (raw == null || await sha256(raw) !== inspection.inspectionDigest) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_INSPECTION_STALE',
      'Older local history changed. Inspect it again before selecting a document group.');
  }
  const buckets = parseRaw(raw);
  if (!buckets.has(sourceBucketId)) {
    throw codedError('LEGACY_DOCUMENT_HISTORY_BUCKET_INVALID', 'The selected history document group is not available.');
  }
  return Object.freeze({ status:'selected',version:1,sourceBucketId,
    documentId:openLocalDocumentId,rows:buckets.get(sourceBucketId) });
}
