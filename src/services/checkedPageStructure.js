import { transformPageState } from '../utils/pageAnnotationReindex.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LIMIT = 16 * 1024 * 1024;
const PREFIX = 'surveyCheckedPageStructureV1';
const fail = () => Object.assign(new Error('The checked page view state is invalid.'),
  { code: 'CHECKED_PAGE_STRUCTURE_INVALID' });
const check = value => { if (!value) throw fail(); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && UUID.test(value);
const empty = () => ({ items: {}, annotations: {}, pageNames: {}, bookmarks: [],
  pageTransformations: {}, activeSpaceId: null, regionOverlayDisabled: {} });

function ownJson(value) {
  const encoder = new TextEncoder(), budget = { left: LIMIT }, ancestors = new Set();
  const visit = (entry, depth) => {
    check(depth <= 64);
    budget.left -= typeof entry === 'string' ? encoder.encode(entry).byteLength + 2 : 8;
    check(budget.left >= 0);
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number') { check(Number.isFinite(entry)); return entry; }
    check(entry && typeof entry === 'object' && !ancestors.has(entry));
    const array = Array.isArray(entry), keys = Reflect.ownKeys(entry);
    check(array || [Object.prototype, null].includes(Object.getPrototypeOf(entry)));
    check(!array || keys.length === entry.length + 1);
    ancestors.add(entry); const result = array ? [] : {};
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      check(typeof key === 'string' && descriptor?.enumerable && Object.hasOwn(descriptor, 'value'));
      if (array) check(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < entry.length);
      budget.left -= encoder.encode(key).byteLength + 3; check(budget.left >= 0);
      Object.defineProperty(result, key, { value: visit(descriptor.value, depth + 1), enumerable: true,
        writable: true, configurable: true });
    }
    ancestors.delete(entry); return result;
  };
  const captured = visit(value, 0); check(object(captured)); return captured;
}

export function captureCheckedPageStructure(value) {
  check(object(value));
  const field = (key, fallback) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(!descriptor || (descriptor.enumerable && Object.hasOwn(descriptor, 'value')));
    return descriptor ? descriptor.value : fallback;
  };
  const rawRegion = field('regionOverlayDisabled', {});
  const region = rawRegion instanceof Map
    ? Object.fromEntries(Map.prototype.entries.call(rawRegion)) : rawRegion;
  const result = ownJson({
    items: field('items', {}) || {}, annotations: field('annotations', {}) || {},
    pageNames: field('pageNames', {}) || {}, bookmarks: field('bookmarks', []) || [],
    pageTransformations: field('pageTransformations', {}) || {},
    activeSpaceId: field('activeSpaceId', null) ?? null, regionOverlayDisabled: region || {},
  });
  check(object(result.items) && object(result.annotations) && object(result.pageNames)
    && Array.isArray(result.bookmarks) && object(result.pageTransformations)
    && (result.activeSpaceId === null || typeof result.activeSpaceId === 'string')
    && object(result.regionOverlayDisabled));
  return Object.freeze(result);
}

export function checkedPageStructureKey(actorUserId, documentId, generationId) {
  check(uuid(actorUserId) && uuid(documentId) && uuid(generationId));
  return `${PREFIX}:${actorUserId}:${documentId}:${generationId}`;
}

export function readCheckedPageStructure({ storage = globalThis.localStorage,
  actorUserId, documentId, generationId } = {}) {
  const key = checkedPageStructureKey(actorUserId, documentId, generationId);
  check(storage && typeof storage.getItem === 'function');
  const text = storage.getItem(key);
  if (text == null) return empty();
  check(typeof text === 'string' && new TextEncoder().encode(text).byteLength <= LIMIT);
  return captureCheckedPageStructure(JSON.parse(text));
}

export function saveCheckedPageStructure({ storage = globalThis.localStorage,
  actorUserId, documentId, generationId, state, ifAbsent = false } = {}) {
  const key = checkedPageStructureKey(actorUserId, documentId, generationId);
  check(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function');
  if (ifAbsent && storage.getItem(key) != null) return readCheckedPageStructure({ storage,
    actorUserId, documentId, generationId });
  const captured = captureCheckedPageStructure(state);
  storage.setItem(key, JSON.stringify(captured));
  return captured;
}

export function transformCheckedPageStructure(state, operation) {
  const captured = captureCheckedPageStructure(state);
  const transformed = transformPageState({ ...captured, annotationsByPage: {}, surveyMarkers: {},
    spaces: [], deletedPdfAnnotations: [], regionOverlayDisabled: new Map(
      Object.entries(captured.regionOverlayDisabled)),
  }, operation);
  return captureCheckedPageStructure(transformed);
}

export function emptyCheckedPageStructure() { return empty(); }
