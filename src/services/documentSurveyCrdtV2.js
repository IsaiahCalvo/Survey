import * as Y from 'yjs';

export const ANNOTATION_CONTENT_MODEL_LEGACY = 1;
export const SURVEY_CRDT_CONTENT_MODEL_VERSION = 2;

export const SURVEY_V2_ROOTS = Object.freeze({
  meta: 'surveyV2Meta',
  markerLifecycle: 'surveyMarkerLifecycle',
  markerGroups: 'surveyMarkerGroups',
  checklistResponses: 'surveyChecklistResponses',
  spaceLifecycle: 'surveySpaceLifecycle',
  spaceGroups: 'surveySpaceGroups',
  pageLifecycle: 'surveySpacePageLifecycle',
  pageGroups: 'surveySpacePageGroups',
  regionLifecycle: 'surveyRegionLifecycle',
  regionGroups: 'surveyRegionGroups',
  orders: 'surveyOrders',
});

const MODEL_KEY = 'contentModelVersion';
const LIVE = 'live';
const DELETED = 'deleted';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function invalid(message) {
  throw Object.assign(new Error(`Survey collaboration state is invalid: ${message}`), {
    code: 'SURVEY_CRDT_V2_INVALID',
  });
}

function mismatch(message = 'The annotation content model does not match this operation.') {
  throw Object.assign(new Error(message), { code: 'ANNOTATION_CONTENT_MODEL_MISMATCH' });
}

function cloneJson(value, ancestors = new Set(), budget = { nodes: 0 }, depth = 0) {
  budget.nodes += 1;
  if (budget.nodes > 250_000 || depth > 64) invalid('JSON value exceeds the survey limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)) invalid('JSON value required');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype
    && Object.getPrototypeOf(value) !== null) invalid('plain JSON object required');
  ancestors.add(value);
  const next = Array.isArray(value) ? [] : {};
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value) && keys.length !== value.length + 1) invalid('dense JSON array required');
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !own(descriptor, 'value')) {
      invalid('plain JSON property required');
    }
    Object.defineProperty(next, key, {
      value: cloneJson(descriptor.value, ancestors, budget, depth + 1), enumerable: true,
      writable: true, configurable: true,
    });
  }
  ancestors.delete(value);
  return next;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function mergeOwn(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    Object.defineProperty(target, key, {
      value: cloneJson(value), enumerable: true, writable: true, configurable: true,
    });
  }
  return target;
}

// lib0's JSON decoder assigns object keys through normal property writes. A
// raw `__proto__` key would become an object's prototype instead of data, so
// every user key is prefixed in durable group values and restored on read.
function encodeStoredJson(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(encodeStoredJson);
  const encoded = {};
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(encoded, `:${key}`, {
      value: encodeStoredJson(item), enumerable: true, writable: true, configurable: true,
    });
  }
  return encoded;
}

function decodeStoredJson(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decodeStoredJson);
  const decoded = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key.startsWith(':')) invalid('malformed encoded survey value');
    Object.defineProperty(decoded, key.slice(1), {
      value: decodeStoredJson(item), enumerable: true, writable: true, configurable: true,
    });
  }
  return decoded;
}

function storedData(value) {
  if (!record(value) || Object.keys(value).length !== 1 || !own(value, 'json')) {
    invalid('malformed survey group value');
  }
  return decodeStoredJson(value.json);
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const tuple = (...parts) => JSON.stringify(parts.map(part => String(part)));
function untuple(value, length) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { invalid('malformed storage key'); }
  if (!Array.isArray(parsed) || parsed.length !== length
    || parsed.some(part => typeof part !== 'string' || !part)) invalid('malformed storage key');
  return parsed;
}

function identifier(value, label) {
  const normalized = typeof value === 'number' ? String(value) : value;
  if (typeof normalized !== 'string' || !normalized || normalized.length > 256) invalid(`${label} required`);
  return normalized;
}

function incarnation(value) {
  if (!record(value) || !UUID.test(value.incarnationId)
    || (value.state !== LIVE && value.state !== DELETED)
    || Object.keys(value).some(key => key !== 'incarnationId' && key !== 'state')) {
    invalid('malformed lifecycle');
  }
  return value;
}

function nextIncarnation(createId) {
  const value = createId();
  if (!UUID.test(value)) invalid('incarnation factory must return a UUID');
  return value.toLowerCase();
}

function defaultCreateId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') invalid('UUID source unavailable');
  return globalThis.crypto.randomUUID();
}

function maps(doc) {
  if (!(doc instanceof Y.Doc) || doc.isDestroyed) invalid('live Y.Doc required');
  return Object.fromEntries(Object.entries(SURVEY_V2_ROOTS).map(([key, name]) => [key, doc.getMap(name)]));
}

export function readSurveyCrdtContentModelVersion(doc) {
  const value = maps(doc).meta.get(MODEL_KEY);
  return value === undefined ? ANNOTATION_CONTENT_MODEL_LEGACY : value;
}

function requireV2(doc) {
  if (readSurveyCrdtContentModelVersion(doc) !== SURVEY_CRDT_CONTENT_MODEL_VERSION) mismatch();
}

const MARKER_GROUP_FIELDS = Object.freeze({
  identity: ['annotationId', 'id', 'name', 'moduleId', 'moduleName', 'categoryId', 'categoryName'],
  placement: ['pageNumber', 'bounds', 'spaceId', 'regionId', 'angle', 'annotationData', 'visibilityScope'],
  entity: ['entityId', 'entityName', 'entityColor', 'color', 'opacity', 'needsEntity', 'entityDefinitionRevision', 'entityCatalogRevision'],
  notes: ['note', 'notes'],
  audit: ['changedBy', 'changedDate', 'excelSync', 'excelRowIndex', 'excelItemIdentity', 'exportedAt',
    'version', 'supabaseId', 'lastSyncedAt', 'userId', 'lastModifiedBy'],
});
const MARKER_KNOWN_FIELDS = new Set([
  ...Object.values(MARKER_GROUP_FIELDS).flat(),
  'checklistResponses',
]);

// The legacy row mapper owns a few optional keys whose JSON meaning is
// "absent" but represents that as an enumerable `undefined`. Remove only
// those audited top-level marker keys before strict JSON cloning. Unknown
// undefined values, accessors, symbols, sparse arrays and nested invalid data
// still fail in cloneJson.
function markerProjectionJson(value) {
  if (!record(value)) return value;
  const result = {};
  for (const markerKey of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, markerKey);
    if (typeof markerKey !== 'string' || !descriptor?.enumerable || !own(descriptor, 'value')) {
      invalid('plain JSON property required');
    }
    const marker = descriptor.value;
    if (!record(marker)) {
      Object.defineProperty(result, markerKey, descriptor);
      continue;
    }
    const normalized = {};
    for (const field of Reflect.ownKeys(marker)) {
      const fieldDescriptor = Object.getOwnPropertyDescriptor(marker, field);
      if (typeof field !== 'string' || !fieldDescriptor?.enumerable
        || !own(fieldDescriptor, 'value')) invalid('plain JSON property required');
      if (MARKER_KNOWN_FIELDS.has(field) && fieldDescriptor.value === undefined) continue;
      Object.defineProperty(normalized, field, fieldDescriptor);
    }
    Object.defineProperty(result, markerKey, {
      value: normalized, enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

function splitMarker(marker, markerId) {
  if (!record(marker)) invalid('marker must be an object');
  if (!Number.isSafeInteger(Number(marker.pageNumber)) || Number(marker.pageNumber) < 1
    || !record(marker.bounds)) invalid('marker placement required');
  const groups = {};
  for (const [name, fields] of Object.entries(MARKER_GROUP_FIELDS)) {
    const group = {};
    for (const field of fields) {
      // Existing row mappers use `entityColor: undefined` to mean that the
      // optional JSON field is absent. Preserve JSON object semantics for the
      // audited fields only; an unknown undefined extension remains invalid.
      if (own(marker, field) && marker[field] !== undefined) group[field] = cloneJson(marker[field]);
    }
    if (Object.keys(group).length) groups[name] = group;
  }
  groups.identity = { ...(groups.identity || {}), annotationId: marker.annotationId ?? markerId };
  const extensions = {};
  for (const [field, value] of Object.entries(marker)) {
    if (!MARKER_KNOWN_FIELDS.has(field)) {
      if (/(?:token|linkedexcel|onedrive|sharepoint|workbook|graph)/i.test(field)) {
        invalid('private workbook fields cannot enter shared survey state');
      }
      Object.defineProperty(extensions, field, {
        value: cloneJson(value), enumerable: true, writable: true, configurable: true,
      });
    }
  }
  if (Object.keys(extensions).length) groups.extensions = extensions;
  groups.shape = { checklistResponses: own(marker, 'checklistResponses') };
  if (own(marker, 'checklistResponses') && !record(marker.checklistResponses)) {
    invalid('marker checklist responses must be an object');
  }
  const checklist = record(marker.checklistResponses) ? cloneJson(marker.checklistResponses) : {};
  return { groups, checklist };
}

function markerEntries(doc) {
  const store = maps(doc);
  const out = {};
  const groupsByOwner = new Map();
  store.markerGroups.forEach((value, key) => {
    const [markerId, markerIncarnation, group] = untuple(key, 3);
    const owner = tuple(markerId, markerIncarnation);
    if (!groupsByOwner.has(owner)) groupsByOwner.set(owner, new Map());
    groupsByOwner.get(owner).set(group, value);
  });
  const checklistByOwner = new Map();
  store.checklistResponses.forEach((value, key) => {
    const [markerId, markerIncarnation, responseId] = untuple(key, 3);
    const owner = tuple(markerId, markerIncarnation);
    if (!checklistByOwner.has(owner)) checklistByOwner.set(owner, new Map());
    checklistByOwner.get(owner).set(responseId, value);
  });
  store.markerLifecycle.forEach((rawLife, markerId) => {
    const life = incarnation(rawLife);
    if (life.state !== LIVE) return;
    const marker = {};
    const owner = tuple(markerId, life.incarnationId);
    const ownedGroups = groupsByOwner.get(owner) || new Map();
    for (const [group, value] of ownedGroups) {
      if (group !== 'shape') mergeOwn(marker, storedData(value));
    }
    const checklistResponses = {};
    for (const [responseId, value] of checklistByOwner.get(owner) || []) {
      Object.defineProperty(checklistResponses, responseId, {
        value: storedData(value), enumerable: true, writable: true, configurable: true,
      });
    }
    if (storedData(ownedGroups.get('shape') || { json: { ':checklistResponses': false } }).checklistResponses === true
      || Object.keys(checklistResponses).length) {
      marker.checklistResponses = checklistResponses;
    }
    Object.defineProperty(out, markerId, {
      value: marker, enumerable: true, writable: true, configurable: true,
    });
  });
  return out;
}

function liveIds(lifecycle, prefix = []) {
  const ids = [];
  lifecycle.forEach((rawLife, key) => {
    const parts = prefix.length ? untuple(key, prefix.length + 1) : [key];
    if (prefix.some((part, index) => parts[index] !== part)) return;
    if (incarnation(rawLife).state === LIVE) ids.push(parts.at(-1));
  });
  return ids;
}

function orderedIds(order, live) {
  const remaining = new Set(live);
  const result = [];
  for (const id of Array.isArray(order) ? order : []) {
    const normalized = String(id);
    if (remaining.delete(normalized)) result.push(normalized);
  }
  return [...result, ...[...remaining].sort()];
}

function spaceEntries(doc) {
  const store = maps(doc);
  const result = [];
  const indexGroups = (map, tupleSize, ownerSize) => {
    const index = new Map();
    map.forEach((value, key) => {
      const parts = untuple(key, tupleSize);
      const owner = tuple(...parts.slice(0, ownerSize));
      if (!index.has(owner)) index.set(owner, []);
      index.get(owner).push([parts, value]);
    });
    return index;
  };
  const spaceGroups = indexGroups(store.spaceGroups, 3, 2);
  const pageGroups = indexGroups(store.pageGroups, 5, 4);
  const regionGroups = indexGroups(store.regionGroups, 7, 6);
  const pagesBySpace = new Map();
  store.pageLifecycle.forEach((value, key) => {
    const [spaceId, spaceIncarnation, pageId] = untuple(key, 3);
    const owner = tuple(spaceId, spaceIncarnation);
    if (!pagesBySpace.has(owner)) pagesBySpace.set(owner, new Map());
    pagesBySpace.get(owner).set(pageId, value);
  });
  const regionsByPage = new Map();
  store.regionLifecycle.forEach((value, key) => {
    const [spaceId, spaceIncarnation, pageId, pageIncarnation, regionId] = untuple(key, 5);
    const owner = tuple(spaceId, spaceIncarnation, pageId, pageIncarnation);
    if (!regionsByPage.has(owner)) regionsByPage.set(owner, new Map());
    regionsByPage.get(owner).set(regionId, value);
  });
  const spaceIds = orderedIds(store.orders.get('spaces'), liveIds(store.spaceLifecycle));
  for (const spaceId of spaceIds) {
    const spaceLife = incarnation(store.spaceLifecycle.get(spaceId));
    const space = {};
    const spaceOwner = tuple(spaceId, spaceLife.incarnationId);
    for (const [, value] of spaceGroups.get(spaceOwner) || []) mergeOwn(space, storedData(value));
    space.id = space.id ?? spaceId;
    const pagePrefix = [spaceId, spaceLife.incarnationId];
    const pageLives = pagesBySpace.get(tuple(...pagePrefix)) || new Map();
    const pageIds = orderedIds(
      store.orders.get(tuple('pages', ...pagePrefix)),
      [...pageLives].filter(([, life]) => incarnation(life).state === LIVE).map(([id]) => id),
    );
    space.assignedPages = pageIds.map(pageId => {
      const pageLife = incarnation(pageLives.get(pageId));
      const page = {};
      const pageOwner = tuple(spaceId, spaceLife.incarnationId, pageId, pageLife.incarnationId);
      for (const [, value] of pageGroups.get(pageOwner) || []) mergeOwn(page, storedData(value));
      page.pageId = page.pageId ?? (/^-?\d+$/.test(pageId) ? Number(pageId) : pageId);
      const regionPrefix = [spaceId, spaceLife.incarnationId, pageId, pageLife.incarnationId];
      const regionLives = regionsByPage.get(tuple(...regionPrefix)) || new Map();
      const regionIds = orderedIds(
        store.orders.get(tuple('regions', ...regionPrefix)),
        [...regionLives].filter(([, life]) => incarnation(life).state === LIVE).map(([id]) => id),
      );
      page.regions = regionIds.map(regionId => {
        const regionLife = incarnation(regionLives.get(regionId));
        const region = {};
        const regionOwner = tuple(...regionPrefix, regionId, regionLife.incarnationId);
        for (const [, value] of regionGroups.get(regionOwner) || []) mergeOwn(region, storedData(value));
        region.regionId = region.regionId ?? regionId;
        return region;
      });
      return page;
    });
    result.push(space);
  }
  return result;
}

export function materializeSurveyCrdtV2(doc) {
  requireV2(doc);
  return freeze(cloneJson({
    version: SURVEY_CRDT_CONTENT_MODEL_VERSION,
    surveyMarkers: markerEntries(doc),
    spaces: spaceEntries(doc),
  }));
}

function planSet(operations, map, key, value) {
  const copy = cloneJson(value);
  if (!same(map.get(key), copy)) operations.push({ map, key, value: copy });
}

function planDataSet(operations, map, key, value) {
  planSet(operations, map, key, { json: encodeStoredJson(cloneJson(value)) });
}

function planDelete(operations, map, key) {
  if (map.has(key)) operations.push({ map, key });
}

function commitPlan(doc, operations, origin) {
  if (!operations.length) return false;
  doc.transact(() => {
    for (const operation of operations) {
      if (own(operation, 'value')) operation.map.set(operation.key, operation.value);
      else operation.map.delete(operation.key);
    }
  }, origin);
  return true;
}

function applyMarkerProjection(doc, before, desired, { origin, createId }) {
  if (!record(desired)) invalid('survey marker projection must be an object');
  const store = maps(doc);
  const operations = [];
  const desiredPlans = [];
  const desiredIds = new Set(Object.keys(desired).map(id => identifier(id, 'marker id')));
  for (const [rawId, marker] of Object.entries(desired)) {
    const markerId = identifier(rawId, 'marker id');
    const priorLife = store.markerLifecycle.get(markerId);
    const life = priorLife && incarnation(priorLife).state === LIVE
      ? incarnation(priorLife)
      : { incarnationId: nextIncarnation(createId), state: LIVE };
    desiredPlans.push({ markerId, life, split: splitMarker(marker, markerId) });
  }
  for (const markerId of Object.keys(before)) {
    if (desiredIds.has(markerId)) continue;
    const life = incarnation(store.markerLifecycle.get(markerId));
    planSet(operations, store.markerLifecycle, markerId, { ...life, state: DELETED });
  }
  const groupNames = [...Object.keys(MARKER_GROUP_FIELDS), 'extensions', 'shape'];
  for (const { markerId, life, split } of desiredPlans) {
    planSet(operations, store.markerLifecycle, markerId, life);
    for (const group of groupNames) {
      const key = tuple(markerId, life.incarnationId, group);
      if (own(split.groups, group)) planDataSet(operations, store.markerGroups, key, split.groups[group]);
      else planDelete(operations, store.markerGroups, key);
    }
    const priorChecklist = record(before[markerId]?.checklistResponses)
      ? before[markerId].checklistResponses : {};
    for (const responseId of Object.keys(priorChecklist)) {
      const normalized = identifier(responseId, 'checklist response id');
      if (!own(split.checklist, responseId)) {
        planDelete(operations, store.checklistResponses, tuple(markerId, life.incarnationId, normalized));
      }
    }
    for (const [responseId, response] of Object.entries(split.checklist)) {
      planDataSet(operations, store.checklistResponses,
        tuple(markerId, life.incarnationId, identifier(responseId, 'checklist response id')), response);
    }
  }
  return operations;
}

function normalizedMarkerProjection(desired) {
  const result = {};
  for (const [rawId, marker] of Object.entries(desired)) {
    const markerId = identifier(rawId, 'marker id');
    const split = splitMarker(marker, markerId);
    const next = {};
    for (const [group, value] of Object.entries(split.groups)) {
      if (group !== 'shape') mergeOwn(next, value);
    }
    if (split.groups.shape.checklistResponses) next.checklistResponses = cloneJson(split.checklist);
    Object.defineProperty(result, markerId, {
      value: next, enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

function spaceHeader(space, spaceId) {
  if (!record(space)) invalid('space must be an object');
  const value = {};
  for (const [key, item] of Object.entries(space)) if (key !== 'assignedPages') {
    Object.defineProperty(value, key, {
      value: cloneJson(item), enumerable: true, writable: true, configurable: true,
    });
  }
  if (!own(value, 'id')) value.id = spaceId;
  return value;
}

function pageHeader(page, pageId) {
  if (!record(page)) invalid('assigned page must be an object');
  const value = {};
  for (const [key, item] of Object.entries(page)) if (key !== 'regions') {
    Object.defineProperty(value, key, {
      value: cloneJson(item), enumerable: true, writable: true, configurable: true,
    });
  }
  if (!own(value, 'pageId')) value.pageId = pageId;
  return value;
}

function regionValue(region, regionId) {
  if (!record(region)) invalid('region must be an object');
  const value = cloneJson(region);
  if (!own(value, 'regionId')) value.regionId = regionId;
  return value;
}

function planLifecycle(operations, map, prefix, beforeIds, desiredIds, createId) {
  const desiredSet = new Set(desiredIds);
  for (const id of beforeIds) {
    if (desiredSet.has(id)) continue;
    const key = prefix.length ? tuple(...prefix, id) : id;
    const life = incarnation(map.get(key));
    planSet(operations, map, key, { ...life, state: DELETED });
  }
  const lives = new Map();
  for (const id of desiredIds) {
    const key = prefix.length ? tuple(...prefix, id) : id;
    const prior = map.get(key);
    const life = prior && incarnation(prior).state === LIVE
      ? incarnation(prior) : { incarnationId: nextIncarnation(createId), state: LIVE };
    planSet(operations, map, key, life);
    lives.set(id, life);
  }
  return lives;
}

function applySpaceProjection(doc, before, desired, { origin, createId }) {
  if (!Array.isArray(desired)) invalid('spaces projection must be an array');
  const store = maps(doc);
  const operations = [];
  const beforeById = new Map(before.map(space => [identifier(space?.id, 'space id'), space]));
  const beforeIds = [...beforeById.keys()];
  const desiredPlans = desired.map(space => ({
    space,
    spaceId: identifier(space?.id, 'space id'),
    header: spaceHeader(space, identifier(space?.id, 'space id')),
  }));
  const desiredIds = desiredPlans.map(plan => plan.spaceId);
  if (new Set(desiredIds).size !== desiredIds.length) invalid('duplicate space id');
  const spaceLives = planLifecycle(operations, store.spaceLifecycle, [], beforeIds, desiredIds, createId);
  planSet(operations, store.orders, 'spaces', desiredIds);
  for (const plan of desiredPlans) {
      const { space, spaceId } = plan;
      const spaceLife = spaceLives.get(spaceId);
      planDataSet(operations, store.spaceGroups, tuple(spaceId, spaceLife.incarnationId, 'definition'), plan.header);
      const priorSpace = beforeById.get(spaceId);
      const beforePages = Array.isArray(priorSpace?.assignedPages) ? priorSpace.assignedPages : [];
      const pages = Array.isArray(space.assignedPages) ? space.assignedPages : [];
      if (space.assignedPages != null && !Array.isArray(space.assignedPages)) invalid('assignedPages must be an array');
      const beforePagesById = new Map(beforePages.map(page => [identifier(page?.pageId, 'page id'), page]));
      const beforePageIds = [...beforePagesById.keys()];
      const pagePlans = pages.map(page => ({ page, pageId: identifier(page?.pageId, 'page id'),
        header: pageHeader(page, identifier(page?.pageId, 'page id')) }));
      const pageIds = pagePlans.map(pagePlan => pagePlan.pageId);
      if (new Set(pageIds).size !== pageIds.length) invalid('duplicate assigned page id');
      const pagePrefix = [spaceId, spaceLife.incarnationId];
      const pageLives = planLifecycle(operations, store.pageLifecycle, pagePrefix, beforePageIds, pageIds, createId);
      planSet(operations, store.orders, tuple('pages', ...pagePrefix), pageIds);
      for (const pagePlan of pagePlans) {
        const { page, pageId } = pagePlan;
        const pageLife = pageLives.get(pageId);
        planDataSet(operations, store.pageGroups,
          tuple(spaceId, spaceLife.incarnationId, pageId, pageLife.incarnationId, 'definition'),
          pagePlan.header);
        const priorPage = beforePagesById.get(pageId);
        const beforeRegions = Array.isArray(priorPage?.regions) ? priorPage.regions : [];
        const regions = Array.isArray(page.regions) ? page.regions : [];
        if (page.regions != null && !Array.isArray(page.regions)) invalid('regions must be an array');
        const beforeRegionIds = beforeRegions.map(region => identifier(region?.regionId, 'region id'));
        const regionPlans = regions.map(region => ({
          regionId: identifier(region?.regionId, 'region id'),
          value: regionValue(region, identifier(region?.regionId, 'region id')),
        }));
        const regionIds = regionPlans.map(regionPlan => regionPlan.regionId);
        if (new Set(regionIds).size !== regionIds.length) invalid('duplicate region id');
        const regionPrefix = [spaceId, spaceLife.incarnationId, pageId, pageLife.incarnationId];
        const regionLives = planLifecycle(operations, store.regionLifecycle, regionPrefix, beforeRegionIds, regionIds, createId);
        planSet(operations, store.orders, tuple('regions', ...regionPrefix), regionIds);
        for (const regionPlan of regionPlans) {
          const { regionId } = regionPlan;
          const regionLife = regionLives.get(regionId);
          planDataSet(operations, store.regionGroups,
            tuple(...regionPrefix, regionId, regionLife.incarnationId, 'definition'),
            regionPlan.value);
        }
      }
    }
  return operations;
}

function normalizedSpaceProjection(desired) {
  return desired.map(space => {
    const spaceId = identifier(space?.id, 'space id');
    const next = spaceHeader(space, spaceId);
    const pages = Array.isArray(space.assignedPages) ? space.assignedPages : [];
    if (space.assignedPages != null && !Array.isArray(space.assignedPages)) invalid('assignedPages must be an array');
    next.assignedPages = pages.map(page => {
      const pageId = identifier(page?.pageId, 'page id');
      const nextPage = pageHeader(page, pageId);
      const regions = Array.isArray(page.regions) ? page.regions : [];
      if (page.regions != null && !Array.isArray(page.regions)) invalid('regions must be an array');
      nextPage.regions = regions.map(region => {
        const regionId = identifier(region?.regionId, 'region id');
        return regionValue(region, regionId);
      });
      return nextPage;
    });
    return next;
  });
}

function update(doc, kind, updater, options = {}) {
  requireV2(doc);
  const current = materializeSurveyCrdtV2(doc);
  const previous = kind === 'markers' ? current.surveyMarkers : current.spaces;
  const input = cloneJson(previous);
  const desired = typeof updater === 'function' ? updater(input) : updater;
  if (desired === undefined) invalid('survey updater must return a value');
  const createId = options.createId || defaultCreateId;
  const origin = options.origin || 'local';
  const copiedDesired = cloneJson(kind === 'markers' ? markerProjectionJson(desired) : desired);
  const nextMarkers = kind === 'markers'
    ? normalizedMarkerProjection(copiedDesired) : current.surveyMarkers;
  const nextSpaces = kind === 'spaces'
    ? normalizedSpaceProjection(copiedDesired) : current.spaces;
  // Validate the complete normalized result before the accepted Y.Doc changes.
  const next = freeze(cloneJson({ version: 2, surveyMarkers: nextMarkers, spaces: nextSpaces }));
  const operations = kind === 'markers'
    ? applyMarkerProjection(doc, previous, copiedDesired, { origin, createId })
    : applySpaceProjection(doc, previous, copiedDesired, { origin, createId });
  const changed = commitPlan(doc, operations, origin);
  return freeze({ changed, surveyMarkers: next.surveyMarkers, spaces: next.spaces });
}

export function updateSurveyMarkersV2(doc, updater, options = {}) {
  return update(doc, 'markers', updater, options);
}

export function updateSurveySpacesV2(doc, updater, options = {}) {
  return update(doc, 'spaces', updater, options);
}

export function initializeSurveyCrdtV2(doc, {
  surveyMarkers = {}, spaces = [], origin = 'survey-v2-init',
  createId = defaultCreateId,
} = {}) {
  const store = maps(doc);
  const current = store.meta.get(MODEL_KEY);
  if (current !== undefined) mismatch('Survey collaboration state is already initialized.');
  if (Object.values(SURVEY_V2_ROOTS).some(name => name !== SURVEY_V2_ROOTS.meta
    && doc.getMap(name).size > 0)) {
    mismatch('Orphan survey collaboration state must not be initialized.');
  }
  if (doc.getMap('surveyMarkers').size > 0 || doc.getMap('annoMeta').has('spaces')) {
    mismatch('Legacy survey state must be transformed before v2 initialization.');
  }
  const copiedMarkers = cloneJson(markerProjectionJson(surveyMarkers));
  const copiedSpaces = cloneJson(spaces);
  const next = freeze(cloneJson({
    version: 2,
    surveyMarkers: normalizedMarkerProjection(copiedMarkers),
    spaces: normalizedSpaceProjection(copiedSpaces),
  }));
  const operations = [
    { map: store.meta, key: MODEL_KEY, value: SURVEY_CRDT_CONTENT_MODEL_VERSION },
    ...applyMarkerProjection(doc, {}, copiedMarkers, { origin, createId }),
    ...applySpaceProjection(doc, [], copiedSpaces, { origin, createId }),
  ];
  commitPlan(doc, operations, origin);
  return next;
}
