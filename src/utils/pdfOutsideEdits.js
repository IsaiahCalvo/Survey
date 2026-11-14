/**
 * pdfOutsideEdits.js: notice when a mark Survey exported was changed in
 * another PDF app (Adobe Acrobat, Bluebeam, Drawboard...) and let that
 * change win when the file comes back (2026-11-14, Acrobat round trip).
 *
 * Survey writes its own copy of each mark's style and shape into the PDF
 * (the /SurveyAppAnnotation blob, pdfAppAnnotationMetadata.js) so a Survey
 * export reimports exactly. Other apps keep that private key but never
 * update it: in the real Acrobat test a mark turned blue and another moved
 * 60 pt, yet both came back red and in the old spot, because the stale blob
 * beat the PDF's own /C and /Rect. Acrobat deletions were lost too when the
 * edited file went back in as a new version.
 *
 * The export now stamps `written` into each blob: the /Rect, colours, border
 * width, a hash of /Contents and the /M date exactly as Survey wrote them,
 * plus `snap`, a hash of the mark's style and shape in Survey at that time.
 * On import, a /Rect, colour, width or text that no longer matches means
 * another app changed it, and that part comes from the PDF itself while
 * everything else (id, survey, layer, Survey-only data) still comes from the
 * blob. Files exported before this have no `written`: a /M date (Survey never
 * wrote one) marks them as touched, and the colour, text and simple box
 * shapes are compared with the blob directly.
 *
 * Acrobat rewrites /Rect in whole points on any edit (98.75 -> 99), so the
 * box check allows a point of drift; colours allow 0.01 per channel.
 *
 * Pure JS (no pdf-lib import); the Node test runner imports it directly.
 */
import { pdfAppAnnotationSnapshot } from './pdfAppAnnotationMetadata.js';

export { OUTSIDE_EDIT_STALE_DATA_KEYS } from './pdfAppAnnotationMetadata.js';

export const OUTSIDE_EDIT_RECT_TOLERANCE = 1.01;
export const OUTSIDE_EDIT_COLOR_TOLERANCE = 0.01;
export const OUTSIDE_EDIT_WIDTH_TOLERANCE = 0.05;
// Legacy files: how far a box may sit from the blob's before it counts as
// moved (the native rebuild of a box differs from Survey's by about half a
// stroke).
const LEGACY_BOX_TOLERANCE = 2;
const TEXT_TYPES = new Set(['textbox', 'i-text', 'text', 'freetext']);
const LEGACY_BOX_TYPES = new Set(['rect', 'ellipse', 'circle', 'textbox', 'i-text', 'text']);

/** FNV-1a, 32-bit, as 8 hex digits. */
export function fnv1aHex(text) {
  let hash = 0x811c9dc5;
  const str = String(text ?? '');
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Hash of a mark's style and shape in Survey (the parts the blob restores). */
export function markSnapshotHash(object) {
  const snapshot = pdfAppAnnotationSnapshot(object);
  return snapshot ? fnv1aHex(JSON.stringify(snapshot)) : null;
}

const finiteArray = (value) => (
  Array.isArray(value) && value.length > 0 && value.every((n) => Number.isFinite(Number(n)))
    ? value.map(Number)
    : null
);

const round4 = (n) => Math.round(n * 10000) / 10000;

/** /Contents as both sides compare it (apps differ on line ends and edges). */
export function normalizeContentsText(value) {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

/** A PDF date string (D:YYYYMMDDHHmmSSZ, UTC) for /M and /CreationDate. */
export function pdfDateString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// What other apps call each kind of mark in their comment lists (Acrobat
// and Drawboard both show /Subj); Survey used to write its private tag there.
const SUBJECT_BY_SUBTYPE = Object.freeze({
  Square: 'Rectangle',
  Circle: 'Ellipse',
  Line: 'Line',
  Ink: 'Pen',
  FreeText: 'Text Box',
  Polygon: 'Polygon',
  PolyLine: 'Polyline',
  Highlight: 'Highlight',
  Underline: 'Underline',
  StrikeOut: 'Strikethrough',
  Squiggly: 'Squiggly',
  Text: 'Note',
  Stamp: 'Stamp',
  Caret: 'Caret',
});

/** A readable /Subj for a Survey mark ("Rectangle", "Arrow", "Cloud"...). */
export function readableMarkSubject({ subtype = null, appType = null, hasCloudBorder = false } = {}) {
  const type = String(appType || '').toLowerCase();
  if (type === 'arrow') return 'Arrow';
  if (hasCloudBorder) return 'Cloud';
  if (type === 'highlighter' || type === 'highlight') return 'Highlight';
  if (type === 'survey-marker' || type === 'surveymarker') return 'Survey Marker';
  return SUBJECT_BY_SUBTYPE[String(subtype || '').replace(/^\//, '')] || 'Markup';
}

/**
 * The fingerprint the export stamps into a blob, from the values it wrote
 * into the annotation dict (all optional).
 */
export function buildWrittenFingerprint({
  rect = null,
  color = null,
  interiorColor = null,
  opacity = null,
  borderWidth = null,
  contents = null,
  modified = null,
  snap = null,
} = {}) {
  const out = {};
  const r = finiteArray(rect);
  if (r && r.length === 4) out.rect = r.map(round4);
  const c = finiteArray(color);
  if (c) out.c = c.map(round4);
  const ic = finiteArray(interiorColor);
  if (ic) out.ic = ic.map(round4);
  if (Number.isFinite(Number(opacity)) && opacity !== null) out.ca = round4(Number(opacity));
  if (Number.isFinite(Number(borderWidth)) && borderWidth !== null) out.bw = round4(Number(borderWidth));
  out.contents = fnv1aHex(normalizeContentsText(contents));
  if (typeof modified === 'string' && modified) out.m = modified;
  if (typeof snap === 'string' && snap) out.snap = snap;
  return out;
}

function rectsDiffer(a, b, tolerance = OUTSIDE_EDIT_RECT_TOLERANCE) {
  const ra = finiteArray(a);
  const rb = finiteArray(b);
  if (!ra || !rb || ra.length !== 4 || rb.length !== 4) return Boolean(ra) !== Boolean(rb);
  const norm = (r) => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
  const na = norm(ra);
  const nb = norm(rb);
  return na.some((v, i) => Math.abs(v - nb[i]) > tolerance);
}

function colorsDiffer(a, b, tolerance = OUTSIDE_EDIT_COLOR_TOLERANCE) {
  const ca = finiteArray(a);
  const cb = finiteArray(b);
  if (!ca && !cb) return false;
  if (!ca || !cb || ca.length !== cb.length) return true;
  return ca.some((v, i) => Math.abs(v - cb[i]) > tolerance);
}

function numbersDiffer(a, b, tolerance) {
  const has = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
  if (!has(a) && !has(b)) return false;
  if (!has(a) || !has(b)) return false; // an app dropping a default is not an edit
  return Math.abs(Number(a) - Number(b)) > tolerance;
}

function isTextType(metadata) {
  const types = [metadata?.fabricType, metadata?.appType, metadata?.pdfExportType]
    .map((t) => String(t || '').toLowerCase());
  return types.some((t) => TEXT_TYPES.has(t));
}

/** A PDF colour array (gray, RGB or CMYK, 0..1) as '#rrggbb', or null. */
export function pdfColorToHex(value) {
  const c = finiteArray(value);
  if (!c) return null;
  let rgb = null;
  if (c.length === 1) rgb = [c[0], c[0], c[0]];
  else if (c.length === 3) rgb = c;
  else if (c.length === 4) rgb = [0, 1, 2].map((i) => (1 - c[i]) * (1 - c[3]));
  if (!rgb) return null;
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** '#rrggbb', '#rgb' or 'rgb(a)(...)' as 0..1 channels, or null. */
export function cssColorToUnitRgb(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  let match = text.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (match) {
    const hex = match[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  }
  match = text.match(/^#([0-9a-f]{3})$/);
  if (match) return [...match[1]].map((ch) => parseInt(ch + ch, 16) / 255);
  match = text.match(/^rgba?\(([^)]+)\)$/);
  if (match) {
    const parts = match[1].split(',').map((p) => Number(p.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) return parts.slice(0, 3).map((n) => n / 255);
  }
  return null;
}

/**
 * Which parts of a Survey-exported mark another app changed, judged from the
 * PDF dict as it is now (`current`: { rect, color, interiorColor, opacity,
 * borderWidth, contents, modified }). Returns null when nothing changed, else
 * { geometry, stroke, fill, opacity, strokeWidth, text }: each part to take
 * from the PDF, holding the PDF's value ('#0000ff', 0.5, 'new words') since
 * an app may change /C or /Contents without redrawing the appearance the
 * native import reads. geometry is true, or 'compare' for a legacy file,
 * settled by resolveLegacyOutsideEdits once the native shape is known.
 */
export function detectOutsideEdits(metadata, current = {}) {
  if (!metadata || typeof metadata !== 'object') return null;
  const written = metadata.written && typeof metadata.written === 'object' ? metadata.written : null;
  const textType = isTextType(metadata);
  const edits = {};
  if (written) {
    if (written.rect && rectsDiffer(written.rect, current.rect)) edits.geometry = true;
    // A FreeText's /C is its box fill, not a stroke; its words' colour lives
    // in /DA, which Survey's blob keeps.
    if (!textType && written.c && colorsDiffer(written.c, current.color)) {
      edits.stroke = pdfColorToHex(current.color) || true;
    }
    if (written.ic && current.interiorColor && colorsDiffer(written.ic, current.interiorColor)) {
      edits.fill = pdfColorToHex(current.interiorColor) || true;
    }
    if (numbersDiffer(written.ca, current.opacity, OUTSIDE_EDIT_COLOR_TOLERANCE)) edits.opacity = Number(current.opacity);
    if (numbersDiffer(written.bw, current.borderWidth, OUTSIDE_EDIT_WIDTH_TOLERANCE)) edits.strokeWidth = Number(current.borderWidth);
    if (textType && typeof written.contents === 'string'
      && written.contents !== fnv1aHex(normalizeContentsText(current.contents))) {
      edits.text = normalizeContentsText(current.contents);
    }
  } else {
    // Exported before the fingerprint: only a file another app saved (it
    // added /M, which Survey never wrote) is checked, against the blob.
    if (!current.modified) return null;
    const style = metadata.style || {};
    const geometry = metadata.geometry || {};
    if (!textType && typeof style.stroke === 'string') {
      const blobColor = cssColorToUnitRgb(style.stroke);
      const pdfColor = finiteArray(current.color);
      if (blobColor && pdfColor && pdfColor.length === 3 && colorsDiffer(blobColor, pdfColor, 0.02)) {
        edits.stroke = pdfColorToHex(pdfColor);
      }
    }
    if (textType && typeof geometry.text === 'string' && typeof current.contents === 'string'
      && normalizeContentsText(current.contents) !== ''
      && normalizeContentsText(current.contents) !== normalizeContentsText(geometry.text)) {
      edits.text = normalizeContentsText(current.contents);
    }
    const fabricType = String(metadata.fabricType || '').toLowerCase();
    if (LEGACY_BOX_TYPES.has(fabricType)) edits.geometry = 'compare';
  }
  return Object.keys(edits).length > 0 ? edits : null;
}

function boxOf(object) {
  if (!object || typeof object !== 'object') return null;
  const scaleX = Number.isFinite(Number(object.scaleX)) ? Number(object.scaleX) : 1;
  const scaleY = Number.isFinite(Number(object.scaleY)) ? Number(object.scaleY) : 1;
  let width = Number(object.width);
  let height = Number(object.height);
  if (!Number.isFinite(width) && Number.isFinite(Number(object.rx))) width = Number(object.rx) * 2;
  if (!Number.isFinite(height) && Number.isFinite(Number(object.ry))) height = Number(object.ry) * 2;
  if (!Number.isFinite(width) && Number.isFinite(Number(object.radius))) width = Number(object.radius) * 2;
  if (!Number.isFinite(height) && Number.isFinite(Number(object.radius))) height = Number(object.radius) * 2;
  const left = Number(object.left);
  const top = Number(object.top);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  const w = width * scaleX;
  const h = height * scaleY;
  const centered = object.originX === 'center';
  const middle = object.originY === 'center';
  return {
    cx: centered ? left : left + w / 2,
    cy: middle ? top : top + h / 2,
    w,
    h,
  };
}

/**
 * Settle a legacy file's 'compare' geometry once the PDF's own shape is
 * converted (`nativeObject`): moved or resized past the tolerance means the
 * other app's shape wins. Returns the metadata to apply (unchanged when
 * there is nothing to settle).
 */
export function resolveLegacyOutsideEdits(metadata, nativeObject) {
  const edits = metadata?.outsideEdits;
  if (!edits || edits.geometry !== 'compare') return metadata;
  const next = { ...edits };
  delete next.geometry;
  const blob = boxOf({ ...(metadata.geometry || {}), originX: metadata.geometry?.originX, originY: metadata.geometry?.originY });
  const native = boxOf(nativeObject);
  if (blob && native) {
    const strokeWidth = Number(metadata.style?.strokeWidth) || 0;
    const tolerance = Math.max(LEGACY_BOX_TOLERANCE, strokeWidth * 1.5);
    const isText = isTextType(metadata);
    const moved = Math.abs(blob.cx - native.cx) > tolerance
      || (!isText && Math.abs(blob.cy - native.cy) > tolerance)
      || Math.abs(blob.w - native.w) > tolerance * 2
      || (!isText && Math.abs(blob.h - native.h) > tolerance * 2);
    if (moved) next.geometry = true;
  }
  const out = { ...metadata };
  if (Object.keys(next).length > 0) out.outsideEdits = next;
  else delete out.outsideEdits;
  return out;
}

/** The layer-state list of marks an export wrote: [{ id, page, snap }]. */
export function exportedMarkEntry(id, pageNumber, snap) {
  if (!id) return null;
  const page = Number(pageNumber);
  return { id: String(id), page: Number.isFinite(page) ? page : null, ...(snap ? { snap } : {}) };
}

/**
 * Nightly 'outside-edits': when a Survey-exported PDF comes back as a NEW
 * VERSION, its marks are already in the store (carried across) and the
 * once-only import used to skip every one of them. This plans what the file
 * should change on one page:
 *   * replace: a mark the other app changed (outsideEdits on its blob) whose
 *     Survey copy is unchanged since that export (same snapshot hash);
 *   * remove: a mark the export wrote (layer state `exportedMarks`) that is
 *     gone from the file, and whose Survey copy is unchanged since export.
 * A mark changed on both sides keeps Survey's copy (as before).
 *
 *   imported       stamped objects the importer read from this page
 *   current        the page's objects in the store
 *   exportedMarks  layer state entries for every page
 *   rawIds         every id the file's raw index lists on this page; a mark
 *                  still listed there (the converter just could not read it)
 *                  is never removed. null = unknown: nothing is removed.
 *   pageUnreadable the importer could not read this page at all: nothing
 *                  is removed.
 */
export function planOutsideEditReconcile({
  pageNumber,
  imported = [],
  current = [],
  exportedMarks = [],
  rawIds = null,
  pageUnreadable = false,
} = {}) {
  const page = Number(pageNumber);
  const currentById = new Map();
  (current || []).forEach((object) => {
    const id = object?.id || object?.data?.id;
    if (id) currentById.set(String(id), object);
  });
  const importedIds = new Set();
  const replace = new Map();
  (imported || []).forEach((object) => {
    const id = object?.id || object?.data?.id;
    if (!id) return;
    importedIds.add(String(id));
    const metadata = object?.data?.appAnnotationMetadata;
    const existing = currentById.get(String(id));
    if (!existing || !metadata?.outsideEdits) return;
    const snap = metadata.written?.snap;
    if (snap && markSnapshotHash(existing) === snap) replace.set(String(id), object);
  });
  const remove = new Set();
  const listed = Array.isArray(rawIds) ? new Set(rawIds.map(String)) : null;
  (listed && !pageUnreadable && Array.isArray(exportedMarks) ? exportedMarks : []).forEach((entry) => {
    if (!entry?.id || Number(entry.page) !== page) return;
    const id = String(entry.id);
    if (importedIds.has(id) || listed.has(id)) return;
    const existing = currentById.get(id);
    if (existing && entry.snap && markSnapshotHash(existing) === entry.snap) remove.add(id);
  });
  return { replace, remove };
}
