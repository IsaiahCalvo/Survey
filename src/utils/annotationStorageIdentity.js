const storageKeys = new WeakMap();

function defaultAnnotationIdFactory(object) {
  const prefix = String(object?.type || 'annotation').toLowerCase() || 'annotation';
  return `${prefix}-${crypto.randomUUID()}`;
}

function canonicalizeLegacyStorageKey(object, storageKey) {
  if (!storageKey || !String(storageKey).startsWith('\u0000')) return null;
  const prefix = String(object?.type || 'annotation').toLowerCase() || 'annotation';
  const encodedKey = Array.from(String(storageKey))
    .map((character) => character.codePointAt(0).toString(16).padStart(4, '0'))
    .join('');
  return `legacy-${prefix}-${encodedKey}`;
}

export function normalizeAnnotationIdentity(
  object,
  {
    idFactory = defaultAnnotationIdFactory,
    claimedIds = new Set(),
  } = {},
) {
  if (!object || typeof object !== 'object') {
    return { object, storageKey: null, changed: false };
  }
  const data = object.data && typeof object.data === 'object' && !Array.isArray(object.data)
    ? object.data
    : {};
  const candidate =
    data.id
    ?? data.annoId
    ?? object.id
    ?? object.annotationId
    ?? object.pdfAnnotationId
    ?? null;
  const candidateId = candidate != null && String(candidate) ? String(candidate) : null;
  const cachedKey = getAnnotationStorageKey(object);
  const cachedCanonical = cachedKey
    ? (
      String(cachedKey).startsWith('\u0000')
        ? canonicalizeLegacyStorageKey(object, cachedKey)
        : String(cachedKey)
    )
    : null;
  const duplicate = candidateId != null && claimedIds.has(candidateId);
  let storageKey = cachedCanonical || candidateId;
  if (!storageKey || (!cachedCanonical && duplicate)) {
    storageKey = cachedCanonical && !claimedIds.has(cachedCanonical)
      ? cachedCanonical
      : String(idFactory(object));
  }
  claimedIds.add(storageKey);

  const needsDataObject = object.data !== data;
  const needsCanonicalId = data.id == null || String(data.id) !== storageKey;
  const needsDuplicateProvenance = duplicate && data.legacyDuplicateId == null;
  const changed = needsDataObject || needsCanonicalId || needsDuplicateProvenance;
  const normalized = changed
    ? {
      ...object,
      data: {
        ...data,
        ...(needsDuplicateProvenance ? { legacyDuplicateId: candidateId } : {}),
        id: storageKey,
      },
    }
    : object;
  setAnnotationStorageKey(object, storageKey);
  setAnnotationStorageKey(normalized, storageKey);
  return { object: normalized, storageKey, changed };
}

export function normalizeByPageAnnotationIdentities(byPage, options = {}) {
  const claimedIds = new Set();
  let changed = false;
  const normalizedByPage = {};
  for (const [pageKey, page] of Object.entries(byPage || {})) {
    const objects = Array.isArray(page?.objects) ? page.objects : [];
    let pageChanged = false;
    const normalizedObjects = objects.map((object) => {
      const normalized = normalizeAnnotationIdentity(object, {
        ...options,
        claimedIds,
      });
      if (normalized.changed) pageChanged = true;
      return normalized.object;
    });
    if (pageChanged) {
      changed = true;
      normalizedByPage[pageKey] = { ...page, objects: normalizedObjects };
    } else {
      normalizedByPage[pageKey] = page;
    }
  }
  return {
    byPage: changed ? normalizedByPage : byPage,
    changed,
  };
}

export function materializeCanvasObjectIdentities(canvas, options = {}) {
  const claimedIds = new Set();
  canvas?.getObjects?.().forEach((object) => {
    if (!object || object.excludeFromExport === true) return;
    const normalized = normalizeAnnotationIdentity(object, {
      ...options,
      claimedIds,
    });
    if (!normalized.changed || !normalized.object?.data) return;
    if (typeof object.set === 'function') {
      object.set({ data: normalized.object.data });
    } else {
      object.data = normalized.object.data;
    }
  });
  return canvas;
}

export function setAnnotationStorageKey(object, key) {
  if (object && typeof object === 'object' && key != null) {
    storageKeys.set(object, String(key));
  }
  return object;
}

export function getAnnotationStorageKey(object) {
  return object && typeof object === 'object'
    ? (storageKeys.get(object) ?? null)
    : null;
}

/**
 * Assign storage keys while preserving occurrence positions when a render list
 * mixes materialized objects (WeakMap key present) with freshly-cloned objects.
 * Every object advances its visible-id/id-less occurrence lane even when its
 * existing durable key wins.
 */
export function createAnnotationStorageKeyResolver() {
  const idOccurrences = new Map();

  return (object, pageNumber, embeddedId) => {
    const knownStorageKey = getAnnotationStorageKey(object);
    let fallbackStorageKey;

    if (embeddedId != null && String(embeddedId)) {
      const identity = String(embeddedId);
      const occurrence = idOccurrences.get(identity) || 0;
      idOccurrences.set(identity, occurrence + 1);
      fallbackStorageKey = occurrence === 0
        ? identity
        : `\u0000duplicate:${identity}:${Number(pageNumber)}:${occurrence}`;
    } else {
      const normalized = normalizeAnnotationIdentity(object);
      fallbackStorageKey = normalized.storageKey;
    }

    const storageKey = embeddedId == null
      ? fallbackStorageKey
      : (knownStorageKey ?? fallbackStorageKey);
    setAnnotationStorageKey(object, storageKey);
    return storageKey;
  };
}
