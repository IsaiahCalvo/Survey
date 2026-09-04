import { auditPartialEraseGeometry } from '../utils/paperAnnotationGeometry.js';
import { summarizeGeometryAudit } from '../utils/atomicEraseDiagnostics.js';

self.onmessage = ({ data }) => {
  const { mutationId, targets = [], eraserPoints, radius } = data || {};
  try {
    const geometryAudits = targets.map((target) => ({
      storageKey: target.storageKey,
      annotationId: target.annotationId,
      ...auditPartialEraseGeometry({
        before: target.before,
        after: target.after,
        eraserPoints,
        radius,
        captureLocations: true,
      }),
    }));
    self.postMessage({
      mutationId,
      geometryAudits,
      geometryAuditSummaries: geometryAudits.map(summarizeGeometryAudit),
    });
  } catch (error) {
    self.postMessage({
      mutationId,
      geometryAudits: [],
      error: String(error?.message || error),
    });
  }
};
