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

// SECURITY: captured console output can be saved to disk AND pushed to a GitHub
// repo, so scrub credential-shaped strings before anything leaves the app. Any
// token/key/password that a log line, thrown error, or SDK diagnostic surfaces
// is replaced with a placeholder so it can never be committed.
const SECRET_PATTERNS = [
  // JSON Web Tokens — Supabase access/refresh tokens, service-role keys.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[REDACTED_JWT]'],
  // Authorization: Bearer <token>
  [/(bearer\s+)[A-Za-z0-9._~+/=-]{10,}/gi, '$1[REDACTED]'],
  // Provider secret keys: Stripe (sk_/pk_/rk_/whsec_), Brevo (xsmtpsib-/xkeysib-),
  // Supabase management (sbp_), generic long hex/base64 secrets.
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{6,}/g, '[REDACTED_KEY]'],
  [/\bwhsec_[A-Za-z0-9]{6,}/g, '[REDACTED_KEY]'],
  [/\bx(?:smtp|key)sib-[A-Za-z0-9-]{6,}/g, '[REDACTED_KEY]'],
  [/\bsbp_[A-Za-z0-9]{6,}/g, '[REDACTED_KEY]'],
  // access_token= / refresh_token= / api_key= / password= / secret= / token= pairs.
  [/((?:access_token|refresh_token|api[_-]?key|apikey|password|passwd|secret|token)\s*["'`]?\s*[:=]\s*["'`]?)[A-Za-z0-9._~+/=-]{6,}/gi, '$1[REDACTED]'],
];

// Replace any credential-shaped substrings in a single line/string.
export function redactSecrets(value) {
  let s = String(value ?? '');
  for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep);
  return s;
}

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
    const scrubbed = redactSecrets(rawLine);
    const line = scrubbed.length > maxLineChars
      ? `${scrubbed.slice(0, maxLineChars)}... [truncated ${scrubbed.length - maxLineChars} chars]`
      : scrubbed;
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
