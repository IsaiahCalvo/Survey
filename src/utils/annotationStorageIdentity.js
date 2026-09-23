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

function getCanonicalAnnotationIdentityAuthorId(annotation) {
  return (
    annotation?.meta?.authorId
    ?? annotation?.authorId
    ?? annotation?.data?.authorId
    ?? annotation?.data?.userId
    ?? null
  );
}

function getAnnotationIdentityAuthorId(annotation) {
  return (
    getCanonicalAnnotationIdentityAuthorId(annotation)
    ?? annotation?.__meta?.authorId
    ?? null
  );
}

/**
 * Stamp the identity fields a locally-created annotation needs before its
 * first history checkpoint or Y.Doc write. Existing authors are write-once:
 * passing an already-attributed object never reassigns it to the current user.
 */
export function stampAnnotationCreationIdentity(annotation, { authorId = null } = {}) {
  if (!annotation || typeof annotation !== 'object') return annotation;
  const normalized = normalizeAnnotationIdentity(annotation);
  const object = normalized.object;
  const annotationId = normalized.storageKey;
  const canonicalAuthorId = getCanonicalAnnotationIdentityAuthorId(object);
  const existingAuthorId = getAnnotationIdentityAuthorId(object);
  const authorIdToStamp = existingAuthorId ?? authorId;
  const needsTopLevelId = annotationId != null && object.id == null;
  const needsAuthorStamp = canonicalAuthorId == null
    && typeof authorIdToStamp === 'string'
    && authorIdToStamp.length > 0;

  if (!needsTopLevelId && !needsAuthorStamp) return object;
  return {
    ...object,
    ...(needsTopLevelId ? { id: annotationId } : {}),
    ...(needsAuthorStamp
      ? { meta: { ...(object.meta || {}), authorId: authorIdToStamp } }
      : {}),
  };
}

/**
 * Canonical identity attributes used by the SVG wrapper and browser tests.
 */
export function getAnnotationRenderIdentity(annotation) {
  return {
    annotationId: (
      annotation?.data?.id
      ?? annotation?.data?.annoId
      ?? annotation?.id
      ?? annotation?.annotationId
      ?? ''
    ),
    authorId: getAnnotationIdentityAuthorId(annotation) ?? '',
  };
}

/**
 * Where the SELECTED annotation sits in its page's objects now, or -1.
 *
 * Hardening 2026-09-23 (second review): a selection is `{ annotationIndex,
 * annotation }` captured when it was picked (and refreshed after each of our
 * own edits). With an id it is found BY ID only - a stored index goes stale
 * as soon as a collaborator deletes an earlier object, and styling whatever
 * now sits there would edit the wrong mark. An object picked before it had an
 * id (legacy / not yet synced) has only its index, so the object there is
 * accepted only if it is the same object: the very reference, or the same
 * type, text, position, width and tilt (it may meanwhile have gained an id
 * from its first save - that is still the same object).
 */
export function findSelectedAnnotationIndex(objects, selection) {
  if (!Array.isArray(objects) || !selection) return -1;
  const snapshot = selection.annotation;
  const selectedId = getAnnotationRenderIdentity(snapshot).annotationId;
  if (selectedId !== '' && selectedId != null) {
    return objects.findIndex((candidate) => (
      getAnnotationRenderIdentity(candidate).annotationId === selectedId
    ));
  }
  const index = Number(selection.annotationIndex);
  if (!Number.isInteger(index) || index < 0 || index >= objects.length) return -1;
  const candidate = objects[index];
  if (!candidate || !snapshot) return -1;
  if (candidate === snapshot) return index;
  const near = (a, b) => {
    const x = Number(a) || 0;
    const y = Number(b) || 0;
    return Math.abs(x - y) <= 0.5;
  };
  const same = String(candidate.type || '').toLowerCase() === String(snapshot.type || '').toLowerCase()
    && String(candidate.text ?? '') === String(snapshot.text ?? '')
    && near(candidate.left, snapshot.left)
    && near(candidate.top, snapshot.top)
    && near(candidate.width, snapshot.width)
    && near(candidate.angle, snapshot.angle);
  return same ? index : -1;
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
