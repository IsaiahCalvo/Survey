const STORAGE_PREFIXES = Object.freeze({
  annotations: 'annotationsByPage_',
  markers: 'surveyMarkers_',
  sidebar: 'pdfSidebar_',
  pdfData: 'pdfData_',
  callouts: 'callouts_',
});

export function exactStorageKeys(pdfId) {
  return Object.fromEntries(
    Object.entries(STORAGE_PREFIXES).map(([name, prefix]) => [name, `${prefix}${pdfId}`]),
  );
}

export async function addExactStorageCleanup(context, keys, runId) {
  await context.addInitScript(({ exactKeys, marker }) => {
    try {
      if (sessionStorage.getItem(marker) === 'done') return;
      Object.values(exactKeys).forEach((key) => localStorage.removeItem(key));
      sessionStorage.setItem(marker, 'done');
    } catch {
      // about:blank has an opaque origin; the script runs again on the Vite document.
    }
  }, { exactKeys: keys, marker: `mobileAnnotationHarnessCleanup:${runId}` });
}

function parseJson(raw, key) {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in localStorage key ${key}: ${error.message}`);
  }
}

export async function persistedSnapshot(page, keys) {
  const raw = await page.evaluate((exactKeys) => Object.fromEntries(
    Object.entries(exactKeys).map(([name, key]) => [name, localStorage.getItem(key)]),
  ), keys);
  const snapshot = Object.fromEntries(
    Object.entries(raw).map(([name, value]) => [name, parseJson(value, keys[name])]),
  );
  snapshot.annotationObjects = Object.values(snapshot.annotations || {})
    .flatMap((pageEntry) => Array.isArray(pageEntry?.objects) ? pageEntry.objects : []);
  return snapshot;
}

export function findPersistedAnnotation(annotationsByPage, id) {
  for (const pageEntry of Object.values(annotationsByPage || {})) {
    const found = pageEntry?.objects?.find((object) => (
      object?.id === id || object?.data?.id === id
    ));
    if (found) return found;
  }
  return null;
}

export function findPersistedCallout(callouts, id) {
  return Array.isArray(callouts) ? callouts.find((callout) => callout?.id === id) || null : null;
}

export async function waitForPersistedCallout(page, calloutsKey, id, timeoutMs = 10_000) {
  await page.waitForFunction(({ key, calloutId }) => {
    try {
      const callouts = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(callouts) && callouts.some((callout) => callout?.id === calloutId);
    } catch {
      return false;
    }
  }, { key: calloutsKey, calloutId: id }, { timeout: timeoutMs });
  const snapshot = await persistedSnapshot(page, { callouts: calloutsKey });
  return findPersistedCallout(snapshot.callouts, id);
}

export async function waitForPersistedAbsence(page, storageKey, id, kind = 'annotation', timeoutMs = 10_000) {
  await page.waitForFunction(({ key, objectId, objectKind }) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || (objectKind === 'callout' ? '[]' : '{}'));
      if (objectKind === 'callout') return !value.some((object) => object?.id === objectId);
      return !Object.values(value).some((entry) => (
        Array.isArray(entry?.objects) && entry.objects.some((object) => (
          object?.id === objectId || object?.data?.id === objectId
        ))
      ));
    } catch {
      return false;
    }
  }, { key: storageKey, objectId: id, objectKind: kind }, { timeout: timeoutMs });
}

export async function waitForPersistedAnnotation(page, annotationsKey, id, timeoutMs = 10_000) {
  await page.waitForFunction(({ key, annotationId }) => {
    try {
      const pages = JSON.parse(localStorage.getItem(key) || '{}');
      return Object.values(pages).some((entry) => (
        Array.isArray(entry?.objects) && entry.objects.some((object) => (
          object?.id === annotationId || object?.data?.id === annotationId
        ))
      ));
    } catch {
      return false;
    }
  }, { key: annotationsKey, annotationId: id }, { timeout: timeoutMs });
  const snapshot = await persistedSnapshot(page, { annotations: annotationsKey });
  return findPersistedAnnotation(snapshot.annotations, id);
}

export async function waitForPersistedAnnotationChange(
  page,
  annotationsKey,
  id,
  before,
  timeoutMs = 10_000,
) {
  const beforeJson = JSON.stringify(before);
  await page.waitForFunction(({ annotationId, expectedBefore, key }) => {
    try {
      const pages = JSON.parse(localStorage.getItem(key) || '{}');
      const object = Object.values(pages).flatMap((entry) => entry?.objects || [])
        .find((candidate) => (
          candidate?.id === annotationId || candidate?.data?.id === annotationId
        ));
      return Boolean(object && JSON.stringify(object) !== expectedBefore);
    } catch {
      return false;
    }
  }, { annotationId: id, expectedBefore: beforeJson, key: annotationsKey }, { timeout: timeoutMs });
  return waitForPersistedAnnotation(page, annotationsKey, id, timeoutMs);
}

export async function waitForPersistedCalloutChange(
  page,
  calloutsKey,
  id,
  before,
  timeoutMs = 10_000,
) {
  const beforeJson = JSON.stringify(before);
  await page.waitForFunction(({ calloutId, expectedBefore, key }) => {
    try {
      const callouts = JSON.parse(localStorage.getItem(key) || '[]');
      const object = callouts.find((candidate) => candidate?.id === calloutId);
      return Boolean(object && JSON.stringify(object) !== expectedBefore);
    } catch {
      return false;
    }
  }, { calloutId: id, expectedBefore: beforeJson, key: calloutsKey }, { timeout: timeoutMs });
  return waitForPersistedCallout(page, calloutsKey, id, timeoutMs);
}

const GEOMETRY_FIELDS = Object.freeze([
  'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
  'x1', 'y1', 'x2', 'y2', 'path', 'points', 'polygons',
]);

export function annotationGeometry(annotation) {
  if (!annotation) return {};
  return Object.fromEntries(GEOMETRY_FIELDS
    .filter((field) => annotation[field] !== undefined)
    .map((field) => [field, annotation[field]]));
}

export function calloutGeometry(callout) {
  if (!callout) return {};
  return Object.fromEntries([
    'pageNumber', 'arrowTip', 'knee', 'textBoxPosition', 'textBoxWidth', 'textBoxHeight',
  ].filter((field) => callout[field] !== undefined).map((field) => [field, callout[field]]));
}
