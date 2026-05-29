/**
 * textSearchDiag.js — lightweight diagnostic logger for the PDF text-search feature.
 *
 * Exports emitTextSearchDiag(event, detail) which appends a timestamped JSON line to a
 * capped (200-line) window.__textSearchDiagBuffer ring buffer and console.logs it, and
 * buildTextSearchDiagLogSection(limit) which formats the recent buffer for inclusion in
 * exported diagnostic/log dumps.
 */
const TEXT_SEARCH_DIAG_MAX_LINES = 200;

const getTextSearchDiagBuffer = () => {
  if (typeof window === 'undefined') return null;
  if (!Array.isArray(window.__textSearchDiagBuffer)) {
    window.__textSearchDiagBuffer = [];
  }
  return window.__textSearchDiagBuffer;
};

export const emitTextSearchDiag = (event, detail = {}) => {
  const payload = {
    at: new Date().toISOString(),
    ...detail
  };
  let line = `[TextSearchDiag] ${event}`;

  try {
    line = `${line} ${JSON.stringify(payload)}`;
  } catch {
    // Keep the event visible even if a caller passes a circular object.
  }

  const buffer = getTextSearchDiagBuffer();
  if (buffer) {
    buffer.push(line);
    if (buffer.length > TEXT_SEARCH_DIAG_MAX_LINES) {
      buffer.splice(0, buffer.length - TEXT_SEARCH_DIAG_MAX_LINES);
    }
  }

  try {
    console.log(line);
  } catch {
    // Ignore logging failures.
  }
};

export const buildTextSearchDiagLogSection = (limit = 80) => {
  const buffer = getTextSearchDiagBuffer();
  if (!buffer || buffer.length === 0) return '';

  const lines = buffer.slice(-Math.max(1, Number(limit) || 80));
  return [
    '',
    '===== Text Search Diagnostics =====',
    ...lines,
    '===== End Text Search Diagnostics ====='
  ].join('\n');
};
