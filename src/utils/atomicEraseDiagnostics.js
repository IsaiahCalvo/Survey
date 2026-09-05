function polygonVertexCount(polygons) {
  return (polygons || []).reduce((polygonTotal, polygon) => (
    polygonTotal + (polygon || []).reduce(
      (ringTotal, ring) => ringTotal + (ring?.length || 0),
      0,
    )
  ), 0);
}

const MAX_ATOMIC_ERASE_DIAGNOSTICS = 20;

export function isAtomicEraseGeometryAuditEnabled(host, devMode) {
  return devMode === true && host?.__ERASER_GEOMETRY_AUDIT === true;
}

export function collectAtomicEraseAuditTargets({
  enabled,
  mode,
  targets,
  radius,
  getAnnotationId,
  toPagePolygons,
}) {
  if (!enabled || mode !== 'partial') return [];
  return (targets || [])
    .filter((target) => String(target.before?.type || '').toLowerCase() === 'path')
    .map((target) => ({
      storageKey: target.storageKey,
      annotationId: getAnnotationId(target.before),
      before: toPagePolygons(target.before, radius),
      after: target.operation === 'delete' ? [] : (target.after?.polygons || []),
    }));
}

const cloneDiagnosticValue = (value) => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

function ensureAtomicEraseDiagnosticStore(host) {
  if (!host || typeof host !== 'object') return null;
  if (!host.__eraserDiagnostics || !Array.isArray(host.__eraserDiagnostics.entries)) {
    host.__eraserDiagnostics = { version: 1, entries: [] };
  }
  host.__exportEraserDiagnostics = () => cloneDiagnosticValue(
    host.__eraserDiagnostics.entries,
  );
  return host.__eraserDiagnostics;
}

export function recordAtomicEraseDiagnostic(host, entry) {
  const store = ensureAtomicEraseDiagnosticStore(host);
  if (!store) return null;
  const record = {
    recordedAt: new Date().toISOString(),
    ...entry,
  };
  store.entries.push(record);
  if (store.entries.length > MAX_ATOMIC_ERASE_DIAGNOSTICS) {
    store.entries.splice(0, store.entries.length - MAX_ATOMIC_ERASE_DIAGNOSTICS);
  }
  return record;
}

export function updateAtomicEraseDiagnostic(host, mutationId, patch) {
  const store = ensureAtomicEraseDiagnosticStore(host);
  if (!store) return null;
  const record = [...store.entries].reverse().find(
    (entry) => String(entry.mutationId) === String(mutationId),
  );
  if (!record) return null;
  Object.assign(record, patch);
  return record;
}

export function summarizeGeometryAudit(audit) {
  return {
    storageKey: audit.storageKey,
    annotationId: audit.annotationId,
    areas: audit.areas,
    violations: audit.violations,
    geometryErrors: audit.geometryErrors,
    vertices: {
      before: polygonVertexCount(audit.before),
      contact: polygonVertexCount(audit.contact),
      contactedInk: polygonVertexCount(audit.contactedInk),
      after: polygonVertexCount(audit.after),
      removed: polygonVertexCount(audit.removed),
      added: polygonVertexCount(audit.added),
      removedOutsideContact: polygonVertexCount(audit.removedOutsideContact),
      retainedInsideContact: polygonVertexCount(audit.retainedInsideContact),
    },
    violationSampleCounts: {
      addedInk: audit.violationSamples?.addedInk?.length || 0,
      removedOutsideContact: audit.violationSamples?.removedOutsideContact?.length || 0,
      retainedInsideContact: audit.violationSamples?.retainedInsideContact?.length || 0,
    },
  };
}

export function summarizeAtomicEraseDebugIntent(intent) {
  const points = intent.gesture?.points || [];
  return {
    mutationId: intent.mutationId,
    pageNumber: intent.pageNumber,
    gesture: {
      mode: intent.gesture?.mode,
      radius: intent.gesture?.radius,
      pointCount: points.length,
      start: points[0] || null,
      end: points.at(-1) || null,
    },
    targets: intent.targets,
    result: intent.result,
    geometryAudits: intent.geometryAudits,
    timing: intent.timing,
  };
}
