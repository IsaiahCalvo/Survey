/**
 * The thumbnail staleness key.
 *
 * A cached thumbnail is "current" only when it was made from exactly what the
 * viewer would show on page 1 today: the same PDF bytes AND the same markup on
 * that page. The old cache was keyed by file identity alone, so two things
 * went stale forever (owner report 2026-09-23, "thumbnails that are just out
 * of date, and they don't update"):
 *   1. markup — thumbnails were the bare PDF page, so drawing on a document
 *      never changed its thumbnail;
 *   2. page edits — rotate / delete / reorder rewrite the PDF bytes IN PLACE
 *      at the same storage path (file_path is immutable, content_sha256 is not
 *      rewritten), so the file-identity key never moved.
 *
 * The signature folds in both. It is cheap (one pass over page 1's objects,
 * FNV-1a, no crypto), deterministic across devices for the same content, and
 * only computed when an edit has settled — never per keystroke or per stroke.
 */

const SIGNATURE_VERSION = 'v1';

function fnv1a(hash, text) {
  let h = hash >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// Keys that change with selection / editing state but never change the
// image (measured 2026-09-23: an undo re-adds hasBorders/hasControls on a
// callout's text box, which alone made an unchanged page look edited).
const VOLATILE_KEYS = new Set([
  'selected', 'selectable', 'evented', 'hoverCursor', 'moveCursor', 'dirty', '__lastRenderedAt',
  'hasBorders', 'hasControls', 'hasRotatingPoint', 'borderColor', 'cornerColor', 'cornerStyle',
  'cornerSize', 'transparentCorners', 'lockMovementX', 'lockMovementY', 'lockScalingX',
  'lockScalingY', 'lockRotation', 'editable', 'isEditing',
]);

// Callout projections inside `objects` are never painted (the painter draws
// callouts from the callouts list), so they are hashed there, not here.
const isPaintedObject = (object) => object?.data?.type !== 'callout';

// Key order is not content: an undo can rebuild an object with the same
// values in a different property order, which must not read as an edit.
function stableStringify(value) {
  return JSON.stringify(value, (key, inner) => {
    if (VOLATILE_KEYS.has(key)) return undefined;
    if (typeof inner === 'function') return undefined;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const sorted = {};
      for (const name of Object.keys(inner).sort()) sorted[name] = inner[name];
      return sorted;
    }
    return inner;
  });
}

/**
 * @param {object} args
 * @param {string} args.fileStamp     thumbCacheKey-style file identity
 * @param {object} [args.pdf]         { numPages, width, height, rotate, byteLength }
 *                                    — page-1 geometry plus the byte length, so an
 *                                    in-place page edit (rotate/delete/reorder)
 *                                    moves the key even though the path did not
 * @param {Array}  [args.objects]     page-1 markup objects as painted
 * @param {Array}  [args.callouts]    page-1 callouts as painted
 * @returns {string}
 */
export function computeThumbnailSignature({ fileStamp, pdf = null, objects = [], callouts = [] }) {
  let hash = 0x811c9dc5;
  hash = fnv1a(hash, String(fileStamp || ''));
  if (pdf) {
    hash = fnv1a(hash, `|${pdf.numPages || 0}|${Math.round(pdf.width || 0)}x${Math.round(pdf.height || 0)}|r${pdf.rotate || 0}|b${pdf.byteLength || 0}`);
  }
  const painted = objects.filter(isPaintedObject);
  hash = fnv1a(hash, `|o${painted.length}`);
  for (const object of painted) hash = fnv1a(hash, stableStringify(object) || '');
  hash = fnv1a(hash, `|c${callouts.length}`);
  for (const callout of callouts) hash = fnv1a(hash, stableStringify(callout) || '');
  return `${SIGNATURE_VERSION}:${hash.toString(36)}:${painted.length + callouts.length}`;
}

/**
 * Whether a cached entry already shows `signature`. A backfilled page-only
 * image (no signature) is never "current" for an open document — the viewer
 * replaces it with the marked-up capture on first settle.
 */
export function isThumbnailCurrent(entry, signature) {
  return Boolean(entry && typeof entry.url === 'string' && entry.signature && entry.signature === signature);
}
