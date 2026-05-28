// src/services/surveyMarkerSyncDiag.js
//
// Survey marker cross-device sync diagnostic logger. Production-stripped, dev-only.
// Default: OFF. Enable temporarily with `window.__surveyMarkerSyncDiag = true`.
//
// Per project feedback rules:
//   - feedback_diagnostic_logs_must_identify_pdf — every line records the PDF
//     filename so the user can hand back one log and a single grep nails the
//     run. PDF name comes from `window.__currentPdfName` (mirrored by the
//     PDFViewer mount in App.jsx as part of the Phase 35 diag setup).
//   - feedback_diagnostic_log_depth — dump full object state at every
//     checkpoint. Each call site passes a `payload` with the complete decision
//     context (survey marker IDs, bounds, prior/current counts, deletions, render
//     source). One paste = one diagnosis.
//
// Surface taxonomy (used as the second `[surface]` token in the log prefix):
//   load.legacy        — documentAnnotationService.loadAnnotationsFromSupabase
//                        result counts + per-row decisions
//   subscribe.legacy   — legacy realtime subscribe insert/update/delete events
//                        with row payloads + skip reasons
//   push.delete-diff   — syncAnnotationsToSupabase prior-vs-current delete
//                        detection + cloud-delete result
//   push.upsert        — syncAnnotationsToSupabase upsert payload + result
//   render.survey      — SVGAnnotationLayer surveyMarkerElements memo
//                        rebuild — counts, IDs, visibility decisions
//   render.duplicate   — fired ONLY when the same survey marker ID appears in BOTH
//                        the survey-marker memo AND the main annotations
//                        render (Bug 1 detection). Logs the duplicate ID + both
//                        render-source payloads.

const isProd =
  typeof import.meta !== 'undefined' &&
  import.meta.env != null &&
  import.meta.env.MODE === 'production';

function isEnabled() {
  if (isProd) return false;
  if (typeof window === 'undefined') return false;
  return window.__surveyMarkerSyncDiag === true;
}

function pdfName() {
  if (typeof window === 'undefined') return 'unknown.pdf';
  return window.__currentPdfName || 'unknown.pdf';
}

/**
 * @param {string} surface  Surface taxonomy token, e.g. 'push.delete-diff'.
 * @param {object} payload  Full state snapshot for the decision.
 */
export function surveyMarkerSyncDiag(surface, payload = {}) {
  if (!isEnabled()) return;
  // eslint-disable-next-line no-console
  console.log(`[SURVEY-MARKER-SYNC][${surface}][pdf=${pdfName()}]`, payload);
}
