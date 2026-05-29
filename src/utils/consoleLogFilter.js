/**
 * consoleLogFilter.js — filters and trims captured console output before it is
 * saved with a report, dropping high-frequency render/zoom diagnostic lines.
 *
 * Exports shouldCaptureConsoleLine (keeps noisy lines only when __SAVE_VERBOSE_CONSOLE_LOGS
 * is set) and sanitizeConsoleLogText (strips noisy patterns, caps line/total length,
 * and preserves [LOCATE-DBG]/survey_locate_ lines ahead of the trim). Used by the
 * save-log path that bundles console output into saved diagnostics.
 */
const NOISY_LOG_PATTERNS = [
  /^\[SVG p\d+\] render\b/,
  /^\[SVG p\d+\] MOUNT\b/,
  /^\[SVG-RENDER\]/,
  /^\[SVG-Imported\b/,
  /^\[SVGPathRenderStats\]/,
  /^\[App-Debug p\d+\] PAL render\b/,
  /^\[CalloutGeom\b/,
  /^\[ZoomLive\b/,
  /^\[LineBboxDiag\]/,
  /^\[BboxScaleDiag\]/,
  /^\[GroupTransformDiag\]/,
  /^\[TextCursorParity\]/,
  /^\[CalloutEditEntryDiag\]/,
];

const DEFAULT_MAX_LINES = 450;
const DEFAULT_MAX_CHARS = 200_000;
const DEFAULT_MAX_LINE_CHARS = 4_000;

function isNoisyConsoleLine(line) {
  const text = String(line || '');
  return NOISY_LOG_PATTERNS.some((pattern) => pattern.test(text));
}

export function shouldCaptureConsoleLine(line, globals = null) {
  const text = String(line || '');
  if (!isNoisyConsoleLine(text)) return true;

  const state = globals || {};
  return state?.__SAVE_VERBOSE_CONSOLE_LOGS === true;
}

export function sanitizeConsoleLogText(text, options = {}) {
  const maxLines = Number.isFinite(options.maxLines) ? Math.max(1, options.maxLines) : DEFAULT_MAX_LINES;
  const maxChars = Number.isFinite(options.maxChars) ? Math.max(1, options.maxChars) : DEFAULT_MAX_CHARS;
  const maxLineChars = Number.isFinite(options.maxLineChars) ? Math.max(1, options.maxLineChars) : DEFAULT_MAX_LINE_CHARS;
  const source = String(text || '(no console output captured)');
  const filtered = [];
  let dropped = 0;

  for (const rawLine of source.split(/\r?\n/)) {
    if (isNoisyConsoleLine(rawLine)) {
      dropped += 1;
      continue;
    }
    const line = rawLine.length > maxLineChars
      ? `${rawLine.slice(0, maxLineChars)}... [truncated ${rawLine.length - maxLineChars} chars]`
      : rawLine;
    filtered.push(line);
  }

  if (dropped > 0) {
    filtered.unshift(`[SaveLog] filtered ${dropped} noisy console lines`);
  }

  // TEMP DIAGNOSTIC 2026-05-18 — locate centering logs can be pushed out of
  // saved logs by later PDF noise, so keep those lines ahead of the normal trim.
  const isLocateDiagnosticLine = (line) => (
    line.includes('[LOCATE-DBG]') ||
    line.includes('survey_locate_')
  );
  const locateDbgLines = filtered.filter(isLocateDiagnosticLine);
  const nonLocateLines = filtered.filter((l) => !isLocateDiagnosticLine(l));
  let output = [...locateDbgLines, ...nonLocateLines.slice(-maxLines)].join('\n');
  if (!output.trim()) {
    output = '(no console output captured)';
  }

  if (output.length > maxChars) {
    const marker = `\n[SaveLog] truncated console log to ${maxChars} chars`;
    output = `${output.slice(0, Math.max(0, maxChars - marker.length))}${marker}`;
  }

  return output;
}
