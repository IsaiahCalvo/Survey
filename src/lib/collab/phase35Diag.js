// src/lib/collab/phase35Diag.js
// Phase 35 — UAT diagnostic logger.
//
// Production-stripped: when import.meta.env.MODE === 'production' the logger is
// a no-op (and the call sites tree-shake to nothing). In dev mode it activates
// automatically; user can hard-disable with `window.__phase35Diag = false`.
//
// Per project feedback rules:
//   - feedback_diagnostic_logs_must_identify_pdf — every line records the PDF
//     filename so the user can hand back one log and a single grep nails the
//     run. The PDF name is mirrored to `window.__currentPdfName` by the
//     PDFViewer mount in App.jsx.
//   - feedback_diagnostic_log_depth — dump full object state at every
//     checkpoint, not just a summary line. Each call site passes a `payload`
//     object with the complete decision context (viewerId, ownerId, role,
//     per-annotation breakdown, decision). One paste = one diagnosis.
//
// Surface taxonomy (used as the second `[surface]` token in the log prefix):
//   marquee.filter   — filterMarqueeHits in/out + per-annotation decisions
//   click.gate       — useSVGInteraction click hit-test gate decision
//   eraser.gate      — FabricEraserCanvas per-object erase loop decision
//   bulk.intercept   — handleRequestBulkDelete plan + modal trigger
//   bulk.confirm     — modal confirm/cancel events
//   undo.toast       — single + bulk undo toast enqueue/dismiss/undo
//   cleanup.audit    — YDocProvider residue audit decision
//   cleanup.banner   — StorageFailureBanner sync_residue_cleanup show/dismiss

// Vite injects import.meta.env at build time. Under `node --test` (Phase 27/28
// unit precedent) `import.meta.env` is undefined — guard the read so unit tests
// can import this module from any consumer without crashing.
const isProd =
  typeof import.meta !== 'undefined' &&
  import.meta.env != null &&
  import.meta.env.MODE === 'production';

function isEnabled() {
  if (isProd) return false;
  if (typeof window === 'undefined') return false;
  if (window.__phase35Diag === false) return false;
  return true;
}

function pdfName() {
  if (typeof window === 'undefined') return 'unknown.pdf';
  return window.__currentPdfName || 'unknown.pdf';
}

/**
 * @param {string} surface  Surface taxonomy token, e.g. 'marquee.filter'.
 * @param {object} payload  Full state snapshot for the gate decision.
 */
export function phase35Diag(surface, payload = {}) {
  if (!isEnabled()) return;
  // eslint-disable-next-line no-console
  console.log(`[PHASE35][${surface}][pdf=${pdfName()}]`, payload);
}
