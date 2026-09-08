import { normalizeCalloutsForSync } from '../utils/calloutSyncPayload.js';

// Verify only formats the current loader already restores. Never add a new
// write-only recovery format, or mistake a swallowed legacy write for success.
export function verifyLegacyQuitBackups({ storage, pdfId, cloudBacked, items, annotations,
  surveyMarkers, callouts, pageNames, bookmarks, spaces, activeSpaceId, pageTransformations }) {
  try {
    const matches = (key, expected) => {
      const raw = storage.getItem(key);
      return raw !== null && JSON.stringify(JSON.parse(raw)) === JSON.stringify(expected);
    };
    if (!matches(`pdfData_${pdfId}`, { items, annotations })) return false;
    if (!matches(`pdfSidebar_${pdfId}`, { pageNames, bookmarks, spaces, activeSpaceId, pageTransformations })) return false;
    if (!cloudBacked) {
      if (!matches(`surveyMarkers_${pdfId}`, surveyMarkers)) return false;
      if (!matches(`callouts_${pdfId}`, normalizeCalloutsForSync(callouts))) return false;
    }
    return true;
  } catch { return false; }
}
