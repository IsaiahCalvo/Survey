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

  let output = filtered.slice(-maxLines).join('\n');
  if (!output.trim()) {
    output = '(no console output captured)';
  }

  if (output.length > maxChars) {
    const marker = `\n[SaveLog] truncated console log to ${maxChars} chars`;
    output = `${output.slice(0, Math.max(0, maxChars - marker.length))}${marker}`;
  }

  return output;
}
