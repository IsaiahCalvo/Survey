/**
 * unsupportedAnnotationNotice.js — pure helpers that turn the importer's
 * unsupported-annotation counts (e.g. { Stamp: 2, Sound: 1 }) into the
 * friendly sentence shown by UnsupportedAnnotationsNotice.
 *
 * UX (owner-approved 2026-07-17): when an opened PDF contains annotation
 * types the app cannot display on screen (they are preserved in the file and
 * still included on export — just not rendered), we show one non-blocking,
 * dismissible toast per document open. Known types get plain-English names
 * ("2 stamps and 1 sound clip"); anything we can't name in plain English
 * falls into "N annotations of a type we don't recognize". No subtype
 * jargon may ever reach the UI. Types the app DOES render — even as
 * limited/locked proxies (sticky notes, underline/strikeout/squiggly text
 * markup) — never reach these counts and must never trigger the notice.
 */

// Plain-English names for native PDF annotation types the app does not
// display, except Redact which gets a visible warning overlay. [singular,
// plural]. Anything not listed here (Screen, PrinterMark,
// TrapNet, exotic/unknown subtypes) falls into the "don't recognize" bucket
// rather than leaking jargon into the UI.
// "Text" (sticky note) is normally imported and displayed as a note proxy, so
// it should never appear in the counts — the entry is a safety net so that if
// one ever does slip through, the user still reads "sticky note", not "Text".
export const FRIENDLY_SUBTYPE_NAMES = {
  Stamp: ['stamp', 'stamps'],
  Text: ['sticky note', 'sticky notes'],
  Sound: ['sound clip', 'sound clips'],
  Movie: ['video', 'videos'],
  RichMedia: ['embedded media item', 'embedded media items'],
  FileAttachment: ['attached file', 'attached files'],
  '3D': ['3D model', '3D models'],
  Watermark: ['watermark', 'watermarks'],
  Redact: ['redaction mark', 'redaction marks'],
};

/**
 * Summarize per-subtype counts into named parts + an unknown bucket.
 * @param {Object} counts - { [pdfSubtype]: number }
 * @returns {{ parts: string[], total: number }} parts are already
 *   pluralized phrases like "2 stamps"; the unknown bucket (if any) is last.
 */
export function summarizeUnsupportedCounts(counts) {
  const entries = Object.entries(counts || {})
    .filter(([, n]) => Number.isFinite(n) && n > 0);

  const known = [];
  let unknownAnnotations = 0;
  let unknownSubtypes = 0;

  entries.forEach(([subtype, n]) => {
    const names = FRIENDLY_SUBTYPE_NAMES[subtype];
    if (names) {
      known.push({ name: n === 1 ? names[0] : names[1], n });
    } else {
      unknownAnnotations += n;
      unknownSubtypes += 1;
    }
  });

  // Deterministic order: biggest counts first, ties alphabetical.
  known.sort((a, b) => (b.n - a.n) || a.name.localeCompare(b.name));

  const parts = known.map(({ n, name }) => `${n} ${name}`);
  if (unknownAnnotations > 0) {
    const noun = unknownAnnotations === 1 ? 'annotation' : 'annotations';
    const ofTypes = unknownSubtypes > 1 ? 'of types we don’t recognize' : 'of a type we don’t recognize';
    parts.push(`${unknownAnnotations} ${noun} ${ofTypes}`);
  }

  const total = known.reduce((sum, { n }) => sum + n, 0) + unknownAnnotations;
  return { parts, total };
}

function joinParts(parts) {
  if (parts.length <= 1) return parts[0] || '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * Build the full user-facing notice sentence, or null when there is nothing
 * to announce. Wording is owner-approved — change only with sign-off:
 *   "2 sticky notes and 1 stamp in this document aren't displayed. They're
 *    not deleted — they stay in the file and will still be included when you
 *    export."
 * @param {Object} counts - { [pdfSubtype]: number }
 * @returns {string|null}
 */
export function formatUnsupportedAnnotationNotice(counts) {
  const redactionCount = Number(counts?.Redact) > 0 ? Number(counts.Redact) : 0;
  const otherCounts = { ...(counts || {}) };
  delete otherCounts.Redact;
  const { parts, total } = summarizeUnsupportedCounts(otherCounts);
  const redactionMessage = redactionCount > 0
    ? `${redactionCount} redaction ${redactionCount === 1 ? 'mark is' : 'marks are'} shown with an outline. The covered text is still readable until the ${redactionCount === 1 ? 'redaction is' : 'redactions are'} applied. Exporting an annotated PDF does not apply ${redactionCount === 1 ? 'it' : 'them'}.`
    : '';
  if (total === 0) return redactionMessage || null;

  const list = joinParts(parts);
  let unsupportedMessage;
  if (total === 1) {
    unsupportedMessage = `${list} in this document isn’t displayed. It’s not deleted — it stays in the file and will still be included when you export.`;
  } else {
    unsupportedMessage = `${list} in this document aren’t displayed. They’re not deleted — they stay in the file and will still be included when you export.`;
  }
  return redactionMessage ? `${redactionMessage} ${unsupportedMessage}` : unsupportedMessage;
}
