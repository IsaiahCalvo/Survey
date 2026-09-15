const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PREFIX = 'checkedDocumentViewStateV1:';
const MAX_RAW_CHARS = 2048;
const STATE_KEYS = ['pageNum', 'scale', 'scrollLeft', 'scrollMode', 'scrollTop', 'zoomMode'];
const SCOPE_KEYS = ['actorUserId', 'documentId', 'pdfGenerationId'];
const ZOOM_MODES = new Set(['fitPage', 'fitWidth', 'fitHeight', 'manual']);

const failure = (code, message) => Object.assign(new Error(message), { code });

function dataObject(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string')
    || [...ownKeys].sort().some((key, index) => key !== keys[index])) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function captureScope(input) {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    const ownKeys = Reflect.ownKeys(input);
    const hasStorage = ownKeys.includes('storage');
    const captured = dataObject(input, [...SCOPE_KEYS, ...(hasStorage ? ['storage'] : [])].sort());
    if (!captured || !SCOPE_KEYS.every(key => typeof captured[key] === 'string' && UUID.test(captured[key]))) throw new Error();
    return captured;
  } catch {
    throw failure('CHECKED_DOCUMENT_VIEW_STATE_INPUT', 'The document view scope is not valid.');
  }
}

function storageFor(scope, code) {
  let storage;
  try { storage = Object.hasOwn(scope, 'storage') ? scope.storage : globalThis.localStorage; } catch { /* unavailable */ }
  if (!storage || typeof storage.getItem !== 'function'
    || (code === 'CHECKED_DOCUMENT_VIEW_STATE_WRITE_FAILED'
      && typeof storage.setItem !== 'function')) {
    throw failure(code, 'The document view could not be stored on this device.');
  }
  return storage;
}

function keyFor(scope) {
  return `${PREFIX}${JSON.stringify([scope.actorUserId, scope.documentId, scope.pdfGenerationId])}`;
}

function normalizeState(value) {
  let state;
  try { state = dataObject(value, STATE_KEYS); } catch { /* invalid object */ }
  if (!state || !Number.isSafeInteger(state.pageNum) || state.pageNum < 1
    || typeof state.scale !== 'number' || !Number.isFinite(state.scale) || state.scale < 0.01 || state.scale > 40
    || !ZOOM_MODES.has(state.zoomMode) || state.scrollMode !== 'continuous'
    || !Number.isSafeInteger(state.scrollLeft) || !Number.isSafeInteger(state.scrollTop)) {
    throw failure('CHECKED_DOCUMENT_VIEW_STATE_INPUT', 'The document view state is not valid.');
  }
  return Object.freeze({ pageNum:state.pageNum,scale:Number(state.scale.toFixed(4)),zoomMode:state.zoomMode,
    scrollMode:'continuous',scrollLeft:state.scrollLeft === 0 ? 0 : state.scrollLeft,
    scrollTop:state.scrollTop === 0 ? 0 : state.scrollTop });
}

function parseEnvelope(raw, scope) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RAW_CHARS) throw new Error();
  const envelope = dataObject(JSON.parse(raw), ['actorUserId', 'documentId', 'pdfGenerationId', 'state', 'version']);
  if (!envelope || envelope.version !== 1 || envelope.actorUserId !== scope.actorUserId
    || envelope.documentId !== scope.documentId || envelope.pdfGenerationId !== scope.pdfGenerationId) throw new Error();
  return normalizeState(envelope.state);
}

export function readCheckedDocumentViewState(input) {
  const scope = captureScope(input);
  const storage = storageFor(scope, 'CHECKED_DOCUMENT_VIEW_STATE_READ_FAILED');
  let raw;
  try { raw = storage.getItem(keyFor(scope)); } catch {
    throw failure('CHECKED_DOCUMENT_VIEW_STATE_READ_FAILED', 'The saved document view could not be read.');
  }
  if (raw === null) return null;
  try { return parseEnvelope(raw, scope); } catch {
    throw failure('CHECKED_DOCUMENT_VIEW_STATE_READ_FAILED', 'The saved document view is not valid.');
  }
}

export function writeCheckedDocumentViewState(input, value) {
  const scope = captureScope(input);
  const storage = storageFor(scope, 'CHECKED_DOCUMENT_VIEW_STATE_WRITE_FAILED');
  const state = normalizeState(value), key = keyFor(scope);
  let previous;
  try {
    previous = storage.getItem(key);
    if (previous !== null) parseEnvelope(previous, scope);
  } catch {
    throw failure('CHECKED_DOCUMENT_VIEW_STATE_READ_FAILED', 'The saved document view is not valid.');
  }
  const raw = JSON.stringify({ version:1,actorUserId:scope.actorUserId,documentId:scope.documentId,
    pdfGenerationId:scope.pdfGenerationId,state });
  if (raw.length > MAX_RAW_CHARS) throw failure('CHECKED_DOCUMENT_VIEW_STATE_WRITE_FAILED', 'The document view is too large.');
  try {
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new Error();
  } catch {
    throw failure('CHECKED_DOCUMENT_VIEW_STATE_WRITE_FAILED', 'The document view could not be stored on this device.');
  }
  return state;
}
