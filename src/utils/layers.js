// Markup layers (Drawboard-style Layers panel, behind the 'layers' flag).
//
// A mark names its layer in an optional `layerId` field. A mark with no
// layerId, or one naming a layer that no longer exists, belongs to the
// default layer - so data saved before layers existed, and marks whose layer
// was deleted, keep working without being rewritten. (The older `layer`
// field - 'native' / 'pdf-annotations' - is a separate source tag.)
//
// The layer list lives in the document's synced metadata under
// LAYERS_META_KEY as { layers: [{ id, name, visible }], pdfOpacity }.

export const LAYERS_META_KEY = 'annotationLayers';
export const DEFAULT_LAYER_ID = 'default';
export const DEFAULT_LAYER_NAME = 'Default layer';
const NAME_MAX = 80;

function clampOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

function cleanName(name, fallback) {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return text || fallback;
}

export function normalizeLayerState(value) {
  const input = value && typeof value === 'object' ? value : {};
  const seen = new Set();
  const layers = [];
  for (const raw of Array.isArray(input.layers) ? input.layers : []) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    layers.push({
      id,
      name: cleanName(raw.name, id === DEFAULT_LAYER_ID ? DEFAULT_LAYER_NAME : 'Layer'),
      visible: raw.visible !== false,
    });
  }
  if (!seen.has(DEFAULT_LAYER_ID)) {
    layers.unshift({ id: DEFAULT_LAYER_ID, name: DEFAULT_LAYER_NAME, visible: true });
  }
  return { layers, pdfOpacity: clampOpacity(input.pdfOpacity ?? 1) };
}

export const DEFAULT_LAYER_STATE = Object.freeze(normalizeLayerState(null));

export function nextLayerName(state) {
  const names = new Set(normalizeLayerState(state).layers.map((l) => l.name.toLowerCase()));
  for (let i = 1; ; i++) {
    const name = `Layer ${i}`;
    if (!names.has(name.toLowerCase())) return name;
  }
}

function newLayerId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `layer-${crypto.randomUUID()}`;
  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function addLayer(state, { name, id = newLayerId() } = {}) {
  const current = normalizeLayerState(state);
  const layer = { id: String(id), name: cleanName(name, nextLayerName(current)), visible: true };
  return { state: normalizeLayerState({ ...current, layers: [...current.layers, layer] }), layer };
}

export function renameLayer(state, id, name) {
  const current = normalizeLayerState(state);
  return {
    ...current,
    layers: current.layers.map((l) => (l.id === id ? { ...l, name: cleanName(name, l.name) } : l)),
  };
}

export function setLayerVisible(state, id, visible) {
  const current = normalizeLayerState(state);
  return { ...current, layers: current.layers.map((l) => (l.id === id ? { ...l, visible: !!visible } : l)) };
}

// The default layer cannot be deleted. Marks on a deleted layer fall back to
// the default layer (see resolveLayerId); nothing is rewritten.
export function deleteLayer(state, id) {
  const current = normalizeLayerState(state);
  if (id === DEFAULT_LAYER_ID) return current;
  return { ...current, layers: current.layers.filter((l) => l.id !== id) };
}

export function setPdfOpacity(state, opacity) {
  return { ...normalizeLayerState(state), pdfOpacity: clampOpacity(opacity) };
}

export function resolveActiveLayerId(state, id) {
  const current = normalizeLayerState(state);
  return current.layers.some((l) => l.id === id) ? id : DEFAULT_LAYER_ID;
}

export function resolveLayerId(object, state) {
  const id = object?.layerId;
  if (id == null || id === '') return DEFAULT_LAYER_ID;
  return normalizeLayerState(state).layers.some((l) => l.id === id) ? id : DEFAULT_LAYER_ID;
}

// Set of hidden layer ids, or null when every layer shows (the fast path).
export function hiddenLayerIdSet(state) {
  const current = normalizeLayerState(state);
  const hidden = current.layers.filter((l) => !l.visible).map((l) => l.id);
  if (hidden.length === 0) return null;
  const set = new Set(hidden);
  // Unknown / missing ids resolve to the default layer, so record the known
  // ids for that lookup.
  set.known = new Set(current.layers.map((l) => l.id));
  return set;
}

export function isOnHiddenLayer(object, hiddenSet) {
  if (!hiddenSet || hiddenSet.size === 0 || !object) return false;
  const raw = object.layerId;
  const id = raw == null || raw === '' || (hiddenSet.known && !hiddenSet.known.has(raw)) ? DEFAULT_LAYER_ID : raw;
  return hiddenSet.has(id);
}

function objectKey(object) {
  return object?.data?.id ?? object?.data?.annoId ?? object?.id ?? object?.annotationId ?? null;
}

// Marks in `nextObjects` whose id was not in `previousObjects` are new: put
// them on the active layer. Marks that already name a layer keep it. With the
// default layer active nothing changes (missing layerId already means default).
export function stampNewObjectsOnLayer(previousObjects, nextObjects, activeLayerId) {
  if (!Array.isArray(nextObjects) || !activeLayerId || activeLayerId === DEFAULT_LAYER_ID) return nextObjects;
  const before = new Set();
  for (const obj of Array.isArray(previousObjects) ? previousObjects : []) {
    const key = objectKey(obj);
    if (key != null) before.add(String(key));
  }
  let changed = false;
  const out = nextObjects.map((obj) => {
    if (!obj || typeof obj !== 'object' || obj.layerId != null) return obj;
    const key = objectKey(obj);
    if (key == null || before.has(String(key))) return obj;
    changed = true;
    return { ...obj, layerId: activeLayerId };
  });
  return changed ? out : nextObjects;
}

// Export copy of annotationsByPage / callouts without marks on hidden layers.
export function withoutHiddenLayers(annotationsByPage, hiddenSet) {
  if (!hiddenSet || hiddenSet.size === 0 || !annotationsByPage) return annotationsByPage;
  const out = {};
  for (const [page, data] of Object.entries(annotationsByPage)) {
    out[page] = data && Array.isArray(data.objects)
      ? { ...data, objects: data.objects.filter((obj) => !isOnHiddenLayer(obj, hiddenSet)) }
      : data;
  }
  return out;
}

export function calloutsWithoutHiddenLayers(callouts, hiddenSet) {
  if (!hiddenSet || hiddenSet.size === 0 || !Array.isArray(callouts)) return callouts;
  return callouts.filter((c) => !isOnHiddenLayer(c, hiddenSet));
}
