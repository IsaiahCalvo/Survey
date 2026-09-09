/**
 * pdfAnnotationImporter.js — reads native PDF annotations and converts them into
 * editable Fabric.js object specs for import into the app.
 *
 * Exports importAnnotationsFromPdf, convertPdfAnnotationToFabric, categorizeAnnotations,
 * extractAnnotationsFromPage, convertInkToFabricPath, pdfHasAnnotations, and
 * buildCloudPathCommands (scalloped revision-cloud edges, also reused by the SVG
 * renderer for live cloud resizing). Parses /AP appearance streams, DA/DS/RC text
 * styling, and recovers app-owned annotations via the counter/callout/app-annotation
 * metadata parsers.
 * Part of the separate callout pipeline — see docs/ANNOTATION-CONTRACT.md.
 */
import { makeInternalPenPathSpec } from './nativeShapeFactory.js';
// KAL-405 — single-tap ink dots. The detection rule and the circle geometry
// live in one shared module so import and export cannot drift apart.
// NOTE: these run only on PDF-imported ink; strokes drawn inside Survey never
// pass through convertInkToFabricPath, so a user-drawn stroke can never be
// rewritten into a dot here.
import {
  buildInkDotPathCommands,
  degenerateInkTapCenters,
  inkDotCollapseThreshold,
} from './inkTapDot.js';
import {
  hasSubstantiveClosedSubpath,
} from './svgPathAttrs.js';
import {
  filledOutlineCommandsToPolygonSet,
  intersectPolygonSets,
  normalizeMultiPolygon,
  polygonSetToCommands,
  styledStrokeCommandsToPolygonSet,
  translatePolygonSet,
} from './paperAnnotationGeometry.js';
import {
  normalizePdfLineEndings,
  normalizePdfNameToken,
  readPdfLibDashArray,
  readPdfLibNameArray,
  readPdfLibNumber,
  readPdfLibNumberArray,
  readPdfLibText,
  toUint8Array,
} from './pdfLibValueReaders.js';
import {
  PDF_COUNTER_METADATA_KEY,
  PDF_COUNTER_SUBJECT,
  parsePdfCounterMetadata,
} from './pdfCounterMetadata.js';
import {
  PDF_CALLOUT_METADATA_KEY,
  PDF_CALLOUT_SUBJECT,
  parsePdfCalloutMetadata,
} from './pdfCalloutMetadata.js';
import {
  PDF_APP_ANNOTATION_METADATA_KEY,
  PDF_APP_ANNOTATION_SUBJECT,
  PDF_APP_LAYER_STATE_KEY,
  applyPdfAppAnnotationMetadata,
  parsePdfAppLayerStateMetadata,
  parsePdfAppAnnotationMetadata,
} from './pdfAppAnnotationMetadata.js';
import {
  getPdfStampRotation,
  renderPdfStampAppearances,
} from './pdfStampProxy.js';
import { createTextMarkupAnnotation } from './pdfTextMarkup.js';
import { buildCloudPathCommands } from './pdfAnnotationAppearance.js';
export { buildCloudPathCommands } from './pdfAnnotationAppearance.js';

const pdfImportDebug = (...args) => {
  if (typeof window === 'undefined' || window.__PDF_IMPORT_DEBUG !== true) return;
  try { console.debug(...args); } catch { /* ignore debug logging failures */ }
};

/**
 * PDF Annotation Importer
 * Parses existing PDF annotations and converts them to Fabric.js objects
 * for editing within the application.
 *
 * Supported annotation types (will be imported as editable):
 * - Ink (pen strokes) → Fabric.js Path
 * - Highlight → Fabric.js Rect with fill
 * - FreeText (text boxes) → Fabric.js Textbox
 * - Square (rectangles) → Fabric.js Rect
 * - Circle (ellipses) → Fabric.js Circle
 * - Line / PolyLine / Polygon → Fabric.js Line/Polyline/Polygon
 * - Text notes / Caret / Underline / StrikeOut / Squiggly
 * - Stamp with /AP /N → locked PNG proxy
 *
 * Unsupported types (preserved but not imported):
 * - Stamp without /AP /N, Link, Widget, Popup, FileAttachment, Sound, Movie, etc.
 */

// Supported annotation subtypes that we can convert to Fabric.js
const SUPPORTED_SUBTYPES = [
  'Ink',
  'Highlight',
  'FreeText',
  'Square',
  'Circle',
  'Line',
  'PolyLine',
  'Polygon',
  'Text',
  'Underline',
  'StrikeOut',
  'Squiggly',
  'Caret',
  'Stamp'
];

// UX / INTENTIONAL BEHAVIOR (verified 2026-07-19, KAL-91): imported Underline /
// StrikeOut / Squiggly are the one deliberate exception to "every imported PDF
// annotation becomes a fully-native, freely-editable annotation." They render
// natively (visible, correct color/position) and can be selected + deleted, but
// they are LOCKED against move / scale / rotate (no handles). Why: text markup
// anchors to the WORDS it covers via /QuadPoints. The app has no text-run /
// word-geometry anchoring engine (pdf.js `getTextContent` is used for search and
// the text layer, but nothing binds an annotation to a word run), so a movable
// underline would silently detach from its text and become meaningless. Matches
// Acrobat / Bluebeam, which also make text-markup delete-and-redraw, not drag.
// The lock is enforced twice: here (import-time lock flags) AND at selection time
// in PageAnnotationLayer (lockSelectDeleteOnlyPdfMarkupObject), so it survives
// re-hydration. Do NOT unlock without first building a real word-geometry engine
// (a multi-session feature) — otherwise the markup drifts off its text.
const SELECT_DELETE_ONLY_TEXT_MARKUP_TYPES = new Set(['Underline', 'StrikeOut', 'Squiggly']);

const LINE_CAP_MAP = ['butt', 'round', 'square'];
const LINE_JOIN_MAP = ['miter', 'round', 'bevel'];
const PDF_NATIVE_ANNOTATION_IDENTITY_VERSION = 1;
const PDF_NATIVE_RECT_ROUNDING_FACTOR = 10_000;

let pdfLibPromise = null;

async function loadPdfLibCore() {
  if (!pdfLibPromise) {
    pdfLibPromise = import('pdf-lib');
  }
  return pdfLibPromise;
}

const normalizePdfNativeAnnotationSubtype = (value) => (
  String(value || '').trim().replace(/^\//, '').toLowerCase()
);

const normalizePdfNativeAnnotationText = (value) => (
  String(value || '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim()
);

const roundPdfNativeCoordinate = (value) => {
  const rounded = Math.round(Number(value) * PDF_NATIVE_RECT_ROUNDING_FACTOR)
    / PDF_NATIVE_RECT_ROUNDING_FACTOR;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const normalizePdfNativeAnnotationRect = (rect) => {
  const values = Array.from(rect || []).slice(0, 4).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return [
    roundPdfNativeCoordinate(Math.min(values[0], values[2])),
    roundPdfNativeCoordinate(Math.min(values[1], values[3])),
    roundPdfNativeCoordinate(Math.max(values[0], values[2])),
    roundPdfNativeCoordinate(Math.max(values[1], values[3])),
  ];
};

const normalizePdfNativeNumberArray = (values) => {
  if (values === null || values === undefined) return null;
  const normalized = Array.from(values).map((value) => roundPdfNativeCoordinate(value));
  return normalized.every(Number.isFinite) ? normalized : null;
};

const normalizePdfNativeNestedNumberArrays = (values) => {
  if (values === null || values === undefined) return null;
  const normalized = Array.from(values).map(normalizePdfNativeNumberArray);
  return normalized.every(Array.isArray) ? normalized : null;
};

const normalizePdfNativeAnnotationFlags = (value, fallback = 0) => {
  const numeric = value === null || value === undefined ? fallback : Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
};

const pdfNativeArraysEqual = (left, right) => (
  Array.isArray(left)
  && Array.isArray(right)
  && left.length === right.length
  && left.every((value, index) => (
    Array.isArray(value)
      ? pdfNativeArraysEqual(value, right[index])
      : value === right[index]
  ))
);

const normalizeRawQuadPointsForPdfJs = (quadPoints) => {
  if (
    !Array.isArray(quadPoints)
    || quadPoints.length === 0
    || quadPoints.length % 8 !== 0
  ) {
    return null;
  }
  const normalized = [];
  for (let index = 0; index < quadPoints.length; index += 8) {
    const quad = quadPoints.slice(index, index + 8);
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    normalized.push(minX, maxY, maxX, maxY, minX, minY, maxX, minY);
  }
  return normalizePdfNativeNumberArray(normalized);
};

const resolvePdfLibValue = (context, value) => {
  try {
    return context.lookup(value) || value;
  } catch {
    return value;
  }
};

const readResolvedPdfLibNumberArray = (context, value) => {
  const resolved = resolvePdfLibValue(context, value);
  if (!resolved || typeof resolved.asArray !== 'function') return null;
  const numbers = resolved.asArray().map((entry) => (
    readPdfLibNumber(resolvePdfLibValue(context, entry))
  ));
  return numbers.every(Number.isFinite) ? normalizePdfNativeNumberArray(numbers) : null;
};

const readResolvedPdfLibNestedNumberArrays = (context, value) => {
  const resolved = resolvePdfLibValue(context, value);
  if (!resolved || typeof resolved.asArray !== 'function') return null;
  const arrays = resolved.asArray().map((entry) => (
    readResolvedPdfLibNumberArray(context, entry)
  ));
  return arrays.every(Array.isArray) ? arrays : null;
};

const buildRawPdfNativeAnnotationFingerprint = ({
  context,
  dict,
  PDFName,
}) => {
  const subtype = normalizePdfNativeAnnotationSubtype(
    readPdfLibText(resolvePdfLibValue(context, dict.get(PDFName.of('Subtype')))),
  );
  const rect = normalizePdfNativeAnnotationRect(
    readResolvedPdfLibNumberArray(context, dict.get(PDFName.of('Rect'))),
  );
  if (!subtype || !rect) return null;

  const rawFlags = dict.get(PDFName.of('F'));
  const flags = normalizePdfNativeAnnotationFlags(
    rawFlags === undefined
      ? 0
      : readPdfLibNumber(resolvePdfLibValue(context, rawFlags)),
  );
  if (flags === null) return null;

  const text = (key) => normalizePdfNativeAnnotationText(
    readPdfLibText(resolvePdfLibValue(context, dict.get(PDFName.of(key)))) || '',
  );
  return {
    subtype,
    rect,
    flags,
    nm: text('NM'),
    contents: text('Contents'),
    title: text('T'),
    subject: text('Subj'),
    quadPoints:
      readResolvedPdfLibNumberArray(context, dict.get(PDFName.of('QuadPoints'))) || [],
    inkList:
      readResolvedPdfLibNestedNumberArrays(context, dict.get(PDFName.of('InkList'))) || [],
    line: readResolvedPdfLibNumberArray(context, dict.get(PDFName.of('L'))) || [],
    vertices:
      readResolvedPdfLibNumberArray(context, dict.get(PDFName.of('Vertices'))) || [],
    calloutLine:
      readResolvedPdfLibNumberArray(context, dict.get(PDFName.of('CL'))) || [],
  };
};

const optionalPdfJsText = (annotation, key, objectKey = null) => {
  if (typeof annotation?.[key] === 'string') {
    return normalizePdfNativeAnnotationText(annotation[key]);
  }
  if (objectKey && typeof annotation?.[objectKey]?.str === 'string') {
    return normalizePdfNativeAnnotationText(annotation[objectKey].str);
  }
  return null;
};

const buildPdfJsNativeAnnotationFingerprint = (annotation) => {
  const subtype = normalizePdfNativeAnnotationSubtype(annotation?.subtype);
  const rect = normalizePdfNativeAnnotationRect(annotation?.rect);
  const flags = normalizePdfNativeAnnotationFlags(annotation?.annotationFlags, 0);
  if (!subtype || !rect || flags === null) return null;
  return {
    subtype,
    rect,
    flags,
    // Current pdf.js exposes /Contents and /T through *Obj.str, but not /NM
    // or /Subj. Null means "not observable" during raw-candidate pairing.
    nm: optionalPdfJsText(annotation, 'nm'),
    contents: normalizePdfNativeAnnotationText(getAnnotationContents(annotation)),
    title: normalizePdfNativeAnnotationText(getAnnotationTitle(annotation)),
    subject: optionalPdfJsText(annotation, 'subject', 'subjectObj'),
    quadPoints: normalizePdfNativeNumberArray(annotation?.quadPoints),
    inkList: normalizePdfNativeNestedNumberArrays(annotation?.inkLists),
    line: normalizePdfNativeNumberArray(annotation?.lineCoordinates),
    vertices: normalizePdfNativeNumberArray(annotation?.vertices),
    calloutLine: normalizePdfNativeNumberArray(annotation?.calloutLine),
  };
};

const rawFingerprintMatchesPdfJsAnnotation = (raw, observed) => {
  if (!raw || !observed) return false;
  if (
    raw.subtype !== observed.subtype
    || raw.flags !== observed.flags
    || raw.contents !== observed.contents
    || raw.title !== observed.title
  ) {
    return false;
  }
  if (observed.nm !== null && raw.nm !== observed.nm) return false;
  if (observed.subject !== null && raw.subject !== observed.subject) return false;

  // pdf.js expands a Line /Rect by its border width; /L is the authoritative
  // geometry there. Other supported types retain the native /Rect.
  if (
    !(observed.subtype === 'line' && Array.isArray(observed.line))
    && !pdfNativeArraysEqual(raw.rect, observed.rect)
  ) {
    return false;
  }
  for (const key of ['quadPoints', 'inkList', 'line', 'vertices', 'calloutLine']) {
    if (observed[key] === null) continue;
    let comparableRaw = raw[key];
    if (key === 'quadPoints') {
      // pdf.js canonicalizes each valid quad to TL,TR,BL,BR and rejects
      // malformed lengths before exposing it.
      comparableRaw = normalizeRawQuadPointsForPdfJs(raw[key]);
    } else if (key === 'line') {
      // pdf.js exposes /L through Util.normalizeRect, losing endpoint order.
      comparableRaw = normalizePdfNativeAnnotationRect(raw[key]);
    }
    if (!pdfNativeArraysEqual(comparableRaw, observed[key])) {
      return false;
    }
  }
  return true;
};

const buildDirectPdfNativeAnnotationIdentities = (
  annotations,
  pageNumber,
  rawCandidates,
) => {
  const identities = new WeakMap();
  const expectedPageIndex = Number(pageNumber) - 1;
  const proposals = [];

  for (const annotation of annotations || []) {
    if (!annotation || typeof annotation !== 'object') continue;
    const syntheticId = String(annotation.id || '').trim()
      .match(/^annot_p(\d+)_(\d+)$/i);
    if (!syntheticId || Number(syntheticId[1]) !== expectedPageIndex) continue;
    const observed = buildPdfJsNativeAnnotationFingerprint(annotation);
    if (!observed) continue;
    const matches = (rawCandidates || []).filter((candidate) => (
      candidate?.pageNumber === Number(pageNumber)
      && rawFingerprintMatchesPdfJsAnnotation(candidate.fingerprint, observed)
    ));
    if (matches.length === 1) {
      proposals.push({ annotation, candidate: matches[0] });
    }
  }

  const claimsByIndex = new Map();
  for (const { candidate } of proposals) {
    claimsByIndex.set(
      candidate.annotsIndex,
      (claimsByIndex.get(candidate.annotsIndex) || 0) + 1,
    );
  }
  for (const { annotation, candidate } of proposals) {
    if (claimsByIndex.get(candidate.annotsIndex) !== 1) continue;
    identities.set(annotation, {
      v: PDF_NATIVE_ANNOTATION_IDENTITY_VERSION,
      pageNumber: Number(pageNumber),
      annotsIndex: candidate.annotsIndex,
      fingerprint: structuredClone(candidate.fingerprint),
    });
  }
  return identities;
};

const attachPdfNativeAnnotationIdentity = (fabricObj, identity) => {
  if (!fabricObj || !identity) return fabricObj;
  return {
    ...fabricObj,
    data: {
      ...(fabricObj.data || {}),
      pdfNativeAnnotationIdentity: identity,
    },
  };
};

function summarizePdfAnnotationForDiag(annotation, rawMetadata = null) {
  if (!annotation || typeof annotation !== 'object') return null;
  const subtype = annotation.subtype || rawMetadata?.subtype || null;
  const borderWidth = getBorderWidth(
    applyRawMetadataToAnnotation(annotation, rawMetadata),
    null,
    { allowExplicitZero: true }
  );
  return {
    id: annotation.id || annotation.name || null,
    subtype,
    rect: annotation.rect || null,
    color: toNumericArray(annotation.color || rawMetadata?.color) || null,
    strokeColor: toNumericArray(annotation.color || rawMetadata?.color) || null,
    fillColor: toNumericArray(annotation.interiorColor || rawMetadata?.interiorColor) || null,
    opacity: annotation.opacity ?? rawMetadata?.opacity ?? rawMetadata?.CA ?? null,
    fillOpacity: annotation.fillOpacity ?? rawMetadata?.fillOpacity ?? rawMetadata?.ca ?? null,
    borderStyle: {
      width: borderWidth,
      style: annotation.borderStyle?.style || rawMetadata?.borderStyleType || null,
      dashArray: toNumericArray(annotation.borderStyle?.dashArray || rawMetadata?.borderDashArray) || null,
    },
    vertices: normalizePdfPointList(annotation.vertices || rawMetadata?.vertices),
    inkLists: Array.isArray(annotation.inkLists)
      ? annotation.inkLists.map((list) => normalizePdfPointList(list))
      : [],
    appearance: {
      present: Boolean(annotation.hasAppearance || rawMetadata?.appearance),
      hasFill: rawMetadata?.appearance?.hasFill ?? null,
      hasStroke: rawMetadata?.appearance?.hasStroke ?? null,
      strokeWidth: rawMetadata?.appearance?.strokeWidth ?? null,
      strokeColor: rawMetadata?.appearance?.strokeColor || null,
      fillColor: rawMetadata?.appearance?.fillColor || null,
      bbox: rawMetadata?.appearance?.bbox || null,
      matrix: rawMetadata?.appearance?.matrix || null,
      pathCommandCount: Array.isArray(rawMetadata?.appearance?.path)
        ? rawMetadata.appearance.path.length
        : null,
    },
    title: getAnnotationTitle(annotation) || rawMetadata?.title || '',
    contents: getAnnotationContents(annotation) || rawMetadata?.contents || '',
    flags: annotation.annotationFlags ?? null,
    nativeAppearanceCouldRender: Boolean(annotation.hasAppearance || rawMetadata?.appearance),
  };
}

function resolveImportOutcome(fabricObj, sourceAnnotation, status, reason) {
  if (status === 'skipped') {
    return { importOutcome: 'skipped', importOutcomeReason: reason || 'not-imported' };
  }
  if (status === 'native-only') {
    return { importOutcome: 'fallback', importOutcomeReason: reason || 'native-layer-only' };
  }
  if (status === 'app-callout-piece-grouped') {
    return { importOutcome: 'sampled', importOutcomeReason: reason || 'app-callout-grouped' };
  }

  const subtype = sourceAnnotation?.subtype || fabricObj?.pdfAnnotationType || null;
  const inkSourceKind = fabricObj?.data?.pdfInkSourceGeometry?.kind || null;
  if (subtype === 'Ink' && inkSourceKind === 'ink-list') {
    return {
      importOutcome: 'fallback',
      importOutcomeReason: 'ink-list-polyline',
    };
  }
  if (subtype === 'Ink' && inkSourceKind === 'appearance-path') {
    return {
      importOutcome: 'sampled',
      importOutcomeReason: 'appearance-path',
    };
  }
  return {
    importOutcome: 'sampled',
    importOutcomeReason: 'editable-import',
  };
}

function summarizeFabricImportForDiag(fabricObj, sourceAnnotation = null, status = 'imported', reason = null) {
  const outcome = resolveImportOutcome(fabricObj, sourceAnnotation, status, reason);
  return {
    status,
    reason,
    ...outcome,
    rawId: sourceAnnotation?.id || sourceAnnotation?.name || fabricObj?.pdfAnnotationId || null,
    rawSubtype: sourceAnnotation?.subtype || fabricObj?.pdfAnnotationType || null,
    appId: fabricObj?.id || fabricObj?.annotationId || fabricObj?.pdfAnnotationId || null,
    appType: fabricObj?.type || null,
    selectable: fabricObj?.selectable ?? null,
    evented: fabricObj?.evented ?? null,
    stroke: fabricObj?.stroke ?? null,
    fill: fabricObj?.fill ?? null,
    opacity: fabricObj?.opacity ?? null,
    strokeWidth: fabricObj?.strokeWidth ?? null,
    pointCount: Array.isArray(fabricObj?.points) ? fabricObj.points.length : null,
    pathCommandCount: Array.isArray(fabricObj?.path) ? fabricObj.path.length : null,
    left: fabricObj?.left ?? null,
    top: fabricObj?.top ?? null,
    width: fabricObj?.width ?? null,
    height: fabricObj?.height ?? null,
    isPdfImported: fabricObj?.isPdfImported === true,
    pdfAnnotationId: fabricObj?.pdfAnnotationId || null,
    pdfAnnotationType: fabricObj?.pdfAnnotationType || null,
    savedToAppState: status === 'imported',
  };
}

export function buildPdfImportStatisticsSummary(diagnosticsByPage, options = {}) {
  const counts = { sampled: 0, fallback: 0, skipped: 0 };
  const byStatusMap = new Map();
  const bySubtypeMap = new Map();
  const reasonMaps = {
    sampled: new Map(),
    fallback: new Map(),
    skipped: new Map(),
  };
  const entries = Object.values(diagnosticsByPage || {}).flatMap((page) => (
    Array.isArray(page?.importedAnnotations) ? page.importedAnnotations : []
  ));

  entries.forEach((entry) => {
    const status = entry?.status || 'unknown';
    byStatusMap.set(status, (byStatusMap.get(status) || 0) + 1);

    let outcome = entry?.importOutcome;
    if (!Object.hasOwn(counts, outcome)) {
      if (status === 'native-only') outcome = 'fallback';
      else if (status === 'imported' || status === 'app-callout-piece-grouped') outcome = 'sampled';
      else outcome = 'skipped';
    }
    counts[outcome] += 1;

    const subtype = entry?.rawSubtype || 'Unknown';
    const subtypeCounts = bySubtypeMap.get(subtype) || {
      sampled: 0,
      fallback: 0,
      skipped: 0,
    };
    subtypeCounts[outcome] += 1;
    bySubtypeMap.set(subtype, subtypeCounts);

    const reason = (
      entry?.importOutcomeReason
      || entry?.reason
      || (outcome === 'sampled' ? 'editable-import' : 'unspecified')
    );
    const outcomeReasons = reasonMaps[outcome];
    outcomeReasons.set(reason, (outcomeReasons.get(reason) || 0) + 1);
  });

  return {
    marker: 'PDFImportStatistics',
    pdfName: options.pdfName || null,
    pageCount: Number(options.pageCount) || Object.keys(diagnosticsByPage || {}).length,
    diagnosticsOnly: options.diagnosticsOnly === true,
    total: entries.length,
    counts,
    byStatus: Object.fromEntries(byStatusMap),
    bySubtype: Object.fromEntries(bySubtypeMap),
    reasons: {
      sampled: Object.fromEntries(reasonMaps.sampled),
      fallback: Object.fromEntries(reasonMaps.fallback),
      skipped: Object.fromEntries(reasonMaps.skipped),
    },
  };
}

function isPotentiallyVisibleNativeAnnotation(annotation, rawMetadata = null) {
  const subtype = annotation?.subtype || rawMetadata?.subtype;
  if (!subtype || SILENT_IGNORE_SUBTYPES.includes(subtype)) return false;
  const isAppOwnedAnnotation = Boolean(
    rawMetadata?.appAnnotationMetadata ||
    rawMetadata?.counterMetadata ||
    rawMetadata?.calloutMetadata ||
    annotation?.appAnnotationMetadata ||
    annotation?.counterMetadata ||
    annotation?.calloutMetadata ||
    annotation?.subject === PDF_APP_ANNOTATION_SUBJECT ||
    annotation?.subject === PDF_COUNTER_SUBJECT ||
    annotation?.subject === PDF_CALLOUT_SUBJECT ||
    rawMetadata?.subject === PDF_APP_ANNOTATION_SUBJECT ||
    rawMetadata?.subject === PDF_COUNTER_SUBJECT ||
    rawMetadata?.subject === PDF_CALLOUT_SUBJECT
  );
  return Boolean(annotation?.hasAppearance || rawMetadata?.appearance || isAppOwnedAnnotation);
}

/**
 * Extract annotations from a PDF.js page
 * @param {PDFPageProxy} page - PDF.js page object
 * @returns {Promise<Array>} Array of annotation objects
 */
export async function extractAnnotationsFromPage(page) {
  return page.getAnnotations();
}

/**
 * Convert PDF color to hex string
 * Handles various color formats from different PDF creators
 * - Array with 0-1 range values (standard PDF)
 * - Array with 0-255 range values (some viewers)
 * - Object with numeric keys like {"0": 219, "1": 52, "2": 37} (Uint8ClampedArray serialized)
 */
function pdfColorToHex(colorInput, annotation = null) {
  // Try to get color from multiple possible locations
  let color = colorInput;

  // If no direct color, try annotation's color property
  if (!color && annotation) {
    color = annotation.color;
  }

  // Try borderColor as fallback
  if (!color && annotation?.borderColor) {
    color = annotation.borderColor;
  }

  // Default to black if no color found
  if (!color) {
    return '#000000';
  }

  // Handle object format like {"0": 219, "1": 52, "2": 37} (Uint8ClampedArray serialized)
  // This happens when PDF.js returns a typed array
  let r, g, b;

  if (typeof color === 'object' && !Array.isArray(color)) {
    // Object with numeric keys
    if ('0' in color && '1' in color && '2' in color) {
      r = color['0'];
      g = color['1'];
      b = color['2'];
    } else if (color.r !== undefined && color.g !== undefined && color.b !== undefined) {
      // Object with r, g, b keys
      r = color.r;
      g = color.g;
      b = color.b;
    } else {
      return '#000000';
    }
  } else if (Array.isArray(color) || (color && typeof color.length === 'number')) {
    // Array or array-like
    if (color.length === 0) {
      return '#000000';
    }

    // Handle grayscale (single value)
    if (color.length === 1) {
      const grayVal = color[0] > 1 ? color[0] : Math.round(color[0] * 255);
      const gray = grayVal.toString(16).padStart(2, '0');
      return `#${gray}${gray}${gray}`;
    }

    r = color[0];
    g = color[1];
    b = color[2];
  } else {
    return '#000000';
  }

  // Determine if values are in 0-1 range or 0-255 range
  // If any value is > 1, assume 0-255 range
  const isNormalized = r <= 1 && g <= 1 && b <= 1;

  if (isNormalized) {
    r = Math.round(r * 255);
    g = Math.round(g * 255);
    b = Math.round(b * 255);
  } else {
    r = Math.round(r);
    g = Math.round(g);
    b = Math.round(b);
  }

  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  return hex;
}

function clamp01(value, fallback = 1) {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeOpacityValue(value) {
  if (value === null || value === undefined || value === '') return null;

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  return clamp01(numeric, null);
}

function extractAnnotationOpacity(annotation, fallback = 1) {
  if (!annotation || typeof annotation !== 'object') {
    return fallback;
  }
  if (annotation._hasExplicitAnnotationOpacity === false) {
    return fallback;
  }

  const candidates = [
    annotation.opacity,
    annotation.alpha,
    annotation.ca,
    annotation.CA,
    annotation.fillAlpha,
    annotation.strokeAlpha
  ];

  for (const candidate of candidates) {
    const normalized = normalizeOpacityValue(candidate);
    if (normalized !== null) {
      return normalized;
    }
  }

  return fallback;
}

function getAppearancePaintOperation(appearance, paintKind) {
  if (!Array.isArray(appearance?.paintOperations)) return null;
  return appearance.paintOperations.find((operation) => operation?.[paintKind] === true) || null;
}

function resolveAnnotationPaintOpacity(annotation, appearance, paintKind, fallback = 1) {
  const operation = getAppearancePaintOperation(appearance, paintKind);
  const alphaKey = paintKind === 'fill' ? 'fillAlpha' : 'strokeAlpha';
  const explicitKey = `${alphaKey}Explicit`;
  if (operation?.[explicitKey] === true) {
    return normalizeOpacityValue(operation[alphaKey]) ?? fallback;
  }
  if (operation) {
    // A valid normal appearance is the painted result. If it does not set an
    // ExtGState alpha, PDF graphics state defaults to opaque; stale /CA or /ca
    // values outside the stream must not change that result.
    return operation?.blendMode === 'Multiply'
      ? 1
      : (normalizeOpacityValue(operation[alphaKey]) ?? fallback);
  }
  const declared = extractAnnotationOpacity(annotation, null);
  if (declared !== null && declared !== undefined) return declared;
  // Acrobat-style highlight: no /CA and no alpha, but the appearance stream
  // paints with /BM /Multiply. Acrobat shows that as full-strength colour
  // multiplied over the text (still legible), so match it rather than
  // washing it out with the app's translucent default.
  if (operation?.blendMode === 'Multiply') return 1;
  return fallback;
}

function hexToRgba(hex, alpha = 1) {
  if (typeof hex !== 'string' || !hex.startsWith('#')) return hex;

  const cleanHex = hex.slice(1);
  if (cleanHex.length !== 6) return hex;

  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  const a = clamp01(alpha, 1);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function getBorderWidth(annotation, fallback = 1, options = {}) {
  const { allowExplicitZero = false } = options;
  const rawWidth = annotation?.borderStyle?.width ?? annotation?.borderWidth;

  if (rawWidth === null || rawWidth === undefined || rawWidth === '') {
    return fallback;
  }

  const width = Number(rawWidth);
  if (!Number.isFinite(width) || width < 0) return fallback;
  if (width === 0 && !allowExplicitZero) return fallback;
  return width;
}

function getShapeFillHex(annotation) {
  if (!annotation || typeof annotation !== 'object') return null;

  // PDF creators vary across these fields; prefer explicit interior/fill values.
  const fillSource =
    annotation.interiorColor ??
    annotation.fillColor ??
    annotation.backgroundColor ??
    annotation.fill;

  if (!fillSource) return null;
  return pdfColorToHex(fillSource, annotation);
}

function getShapeFillColor(annotation) {
  const explicitFillHex = getShapeFillHex(annotation);
  const objectOpacity = extractAnnotationOpacity(annotation, 1);

  if (explicitFillHex) {
    return hexToRgba(explicitFillHex, objectOpacity);
  }

  return 'transparent';
}

export function getPdfWidgetVisualStyle(annotation) {
  if (annotation?.subtype !== 'Widget' || annotation?.checkBox !== true) return null;
  const borderWidth = getBorderWidth(annotation, 1, { allowExplicitZero: true });
  const fieldValue = String(annotation.fieldValue || 'Off');
  const exportValue = String(annotation.exportValue || 'Yes');
  return {
    backgroundColor: pdfColorToHex(annotation.backgroundColor || [1, 1, 1]),
    borderColor: pdfColorToHex(annotation.borderColor || annotation.color || [0, 0, 0]),
    borderWidth,
    checked: fieldValue !== 'Off' && fieldValue === exportValue,
  };
}

function getAnnotationTitle(annotation) {
  if (!annotation || typeof annotation !== 'object') {
    return '';
  }

  if (typeof annotation.title === 'string' && annotation.title.trim().length > 0) {
    return annotation.title.trim();
  }

  if (typeof annotation.titleObj?.str === 'string' && annotation.titleObj.str.trim().length > 0) {
    return annotation.titleObj.str.trim();
  }

  return '';
}

function getAnnotationContents(annotation) {
  if (!annotation || typeof annotation !== 'object') {
    return '';
  }

  if (typeof annotation.contents === 'string' && annotation.contents.trim().length > 0) {
    return annotation.contents.trim();
  }

  if (typeof annotation.contentsObj?.str === 'string' && annotation.contentsObj.str.trim().length > 0) {
    return annotation.contentsObj.str.trim();
  }

  return '';
}

function isAutoCadShxTextAnnotation(annotation) {
  if (!annotation || annotation.subtype !== 'Square') {
    return false;
  }

  const normalizedTitle = getAnnotationTitle(annotation).toLowerCase();
  if (!normalizedTitle.includes('autocad shx text')) {
    return false;
  }

  return true;
}

function convertAutoCadShxTextToFabricProxy(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  return {
    type: 'rect',
    left: viewportRect.left,
    top: viewportRect.top,
    width: viewportRect.width,
    height: viewportRect.height,
    fill: 'transparent',
    stroke: 'transparent',
    strokeWidth: 0,
    // Keep selectable to mirror Acrobat/Drawboard behavior, but hide transform handles.
    selectable: true,
    evented: true,
    hasControls: false,
    hasBorders: true,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    perPixelTargetFind: false,
    targetFindTolerance: 8,
    hoverCursor: 'text',
    data: {
      isAutoCadShxText: true,
      shxText: getAnnotationContents(annotation)
    },
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'AutoCAD SHX Text',
    layer: 'pdf-annotations'
  };
}

function isNearWhiteHexColor(hex) {
  if (typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) {
    return false;
  }

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  if (![r, g, b].every((value) => Number.isFinite(value))) {
    return false;
  }

  return r >= 245 && g >= 245 && b >= 245;
}

function parseDefaultAppearanceString(daValue) {
  if (typeof daValue !== 'string' || daValue.trim().length === 0) {
    return null;
  }

  const result = {};

  const rgbMatch = daValue.match(/([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+rg\b/i);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    if ([r, g, b].every((value) => Number.isFinite(value))) {
      result.fontColor = [r, g, b];
    }
  } else {
    const grayMatch = daValue.match(/([+-]?\d*\.?\d+)\s+g\b/i);
    if (grayMatch) {
      const gray = Number(grayMatch[1]);
      if (Number.isFinite(gray)) {
        result.fontColor = [gray, gray, gray];
      }
    }
  }

  const fontMatch = daValue.match(/\/([^\s]+)\s+([+-]?\d*\.?\d+)\s+Tf\b/i);
  if (fontMatch) {
    const fontName = fontMatch[1];
    const fontSize = Number(fontMatch[2]);
    if (fontName) {
      result.fontName = fontName;
    }
    if (Number.isFinite(fontSize) && fontSize > 0) {
      result.fontSize = fontSize;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// Acrobat's /RC rich-content XHTML can recolor specific runs of text via
// inline <span style="color:#xxxxxx">…</span>. When present, this span
// color overrides the DA/DS defaults for the text that's actually drawn.
// We take the color from the innermost (last) span style since that's
// what the painted text inherits. Also extract text-align so view/edit
// honor the author's alignment.
function parseRichContentFirstColor(rcValue) {
  if (typeof rcValue !== 'string' || rcValue.length === 0) return null;

  const matches = [...rcValue.matchAll(/style\s*=\s*"([^"]*)"/gi)];
  let lastHex = null;
  let textAlign = null;
  for (const m of matches) {
    const colorMatch = m[1].match(/color\s*:\s*#([0-9a-f]{6})/i);
    if (colorMatch) lastHex = colorMatch[1];
    const alignMatch = m[1].match(/text-align\s*:\s*(left|right|center|justify)/i);
    if (alignMatch) textAlign = alignMatch[1].toLowerCase();
  }

  const result = {};
  if (lastHex) {
    const r = parseInt(lastHex.slice(0, 2), 16) / 255;
    const g = parseInt(lastHex.slice(2, 4), 16) / 255;
    const b = parseInt(lastHex.slice(4, 6), 16) / 255;
    if ([r, g, b].every(Number.isFinite)) result.fontColor = [r, g, b];
  }
  if (textAlign) result.textAlign = textAlign;

  return Object.keys(result).length > 0 ? result : null;
}

function parseDefaultStyleString(dsValue) {
  if (typeof dsValue !== 'string' || dsValue.trim().length === 0) {
    return null;
  }

  const result = {};

  const colorMatch = dsValue.match(/color:\s*#([0-9a-f]{6})/i);
  if (colorMatch) {
    const hex = colorMatch[1];
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    result.fontColor = [r, g, b];
  }

  const fontSizeMatch = dsValue.match(/font-size:\s*([+-]?\d*\.?\d+)pt/i);
  if (fontSizeMatch) {
    const fontSize = Number(fontSizeMatch[1]);
    if (Number.isFinite(fontSize) && fontSize > 0) {
      result.fontSize = fontSize;
    }
  }

  const fontFamilyMatch = dsValue.match(/font-family:\s*([^;]+)/i);
  if (fontFamilyMatch) {
    const fontName = String(fontFamilyMatch[1] || '').trim();
    if (fontName) {
      result.fontName = fontName;
    }
  }

  const alignMatch = dsValue.match(/text-align\s*:\s*(left|right|center|justify)/i);
  if (alignMatch) {
    result.textAlign = alignMatch[1].toLowerCase();
  }

  return Object.keys(result).length > 0 ? result : null;
}

function toNumericArray(values) {
  if (!values) return null;

  if (Array.isArray(values)) {
    const numbers = values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    return numbers.length === values.length ? numbers : null;
  }

  if (ArrayBuffer.isView(values)) {
    return Array.from(values)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
  }

  if (typeof values === 'object') {
    const numericKeys = Object.keys(values)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));

    if (numericKeys.length === 0) return null;

    const numbers = numericKeys
      .map((key) => Number(values[key]))
      .filter((value) => Number.isFinite(value));

    return numbers.length === numericKeys.length ? numbers : null;
  }

  return null;
}

function coordinateArrayToPoints(values) {
  const points = [];
  if (!Array.isArray(values) || values.length < 2) return points;

  for (let i = 0; i < values.length - 1; i += 2) {
    const x = values[i];
    const y = values[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x, y });
  }

  return points;
}

function normalizePdfPointList(pointList) {
  if (!pointList) return [];

  if (Array.isArray(pointList) && pointList.length > 0) {
    const first = pointList[0];

    if (Number.isFinite(first)) {
      return coordinateArrayToPoints(pointList);
    }

    if (Array.isArray(first)) {
      return pointList
        .map((pair) => ({
          x: Number(pair?.[0]),
          y: Number(pair?.[1])
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    }

    if (typeof first === 'object') {
      return pointList
        .map((point) => ({
          x: Number(point?.x),
          y: Number(point?.y)
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  }

  const numeric = toNumericArray(pointList);
  return coordinateArrayToPoints(numeric);
}

function convertPdfPointListToViewportPoints(pointList, viewport, scale = 1) {
  const pdfPoints = normalizePdfPointList(pointList);
  if (pdfPoints.length === 0) return [];

  return pdfPoints.map((point) => convertPdfPointToViewport(point.x, point.y, viewport, scale));
}

function roundWithTolerance(value, tolerance = 1) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value / tolerance) * tolerance;
}

function extractCalloutTextBoxRectFromAppearance(annotation, viewport, scale = 1) {
  const path = annotation?._appearance?.path;
  if (!Array.isArray(path) || path.length === 0) {
    return null;
  }

  const subpaths = [];
  let current = [];

  const pushCurrent = (closed = false) => {
    if (current.length >= 3) {
      subpaths.push({ points: current.slice(), closed });
    }
    current = [];
  };

  path.forEach((segment) => {
    if (!Array.isArray(segment) || segment.length === 0) return;
    const cmd = segment[0];

    if (cmd === 'M') {
      if (current.length > 0) {
        pushCurrent(false);
      }
      current = [{ x: Number(segment[1]), y: Number(segment[2]) }];
      return;
    }

    if (cmd === 'L') {
      if (current.length === 0) return;
      current.push({ x: Number(segment[1]), y: Number(segment[2]) });
      return;
    }

    if (cmd === 'C') {
      if (current.length === 0) return;
      current.push({ x: Number(segment[5]), y: Number(segment[6]) });
      return;
    }

    if (cmd === 'Z') {
      pushCurrent(true);
    }
  });

  if (current.length > 0) {
    pushCurrent(false);
  }

  const rectangleCandidates = subpaths
    .filter((subpath) => subpath.closed && subpath.points.length >= 4)
    .map((subpath) => {
      const points = subpath.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      if (points.length < 4) return null;

      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const width = maxX - minX;
      const height = maxY - minY;
      if (!(width > 0 && height > 0)) return null;

      // Rectangle-like paths usually have ~2 unique Xs and ~2 unique Ys.
      const uniqueX = new Set(xs.map((value) => roundWithTolerance(value, 0.5)));
      const uniqueY = new Set(ys.map((value) => roundWithTolerance(value, 0.5)));
      const isRectLike = uniqueX.size <= 3 && uniqueY.size <= 3;
      if (!isRectLike) return null;

      return {
        minX,
        minY,
        maxX,
        maxY,
        area: width * height
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.area - a.area);

  if (rectangleCandidates.length === 0) {
    return null;
  }

  const best = rectangleCandidates[0];
  return convertPdfRectToViewportRect([best.minX, best.minY, best.maxX, best.maxY], viewport, scale);
}

function toRelativeFabricPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  const relativePoints = points.map((point) => ({
    x: point.x - minX,
    y: point.y - minY
  }));

  return {
    left: minX,
    top: minY,
    points: relativePoints
  };
}

function extractAnnotationDashArray(annotation) {
  // Per PDF spec (ISO 32000-2 §12.5.4), the /D dash array is only meaningful
  // when /S is /D. Upstream parsers (PDF.js, Pdfjs) sometimes surface a
  // leftover [3] on borderStyle.dash / borderDashArray for SOLID lines too
  // (confirmed on SE-011 Security Shop Drawing), which previously produced
  // spurious dashed rendering in FabricEraserCanvas and FabricEditCanvas.
  //
  // Strict gate: only return a dash array when we have explicit evidence that
  // /S is /D. If borderStyleType is missing or anything other than 'D', the
  // annotation is solid — return null and ignore any dash candidates.
  const rawBorderStyleType = annotation?.borderStyle?.style || annotation?.borderStyleType || '';
  const borderStyleType = rawBorderStyleType === 2
    ? '2'
    : normalizePdfNameToken(rawBorderStyleType);
  // PDF.js exposes AnnotationBorderStyleType.DASHED as numeric 2. Raw PDF
  // metadata uses the name D. Accept both forms so no-AP circles keep /BS /D.
  if (borderStyleType !== 'D' && borderStyleType !== '2') return null;

  const dashCandidates = [
    annotation?.borderDashArray,
    annotation?.borderStyle?.dashArray,
    annotation?.borderStyle?.dash,
    annotation?.dashArray
  ];

  for (const candidate of dashCandidates) {
    const numeric = toNumericArray(candidate);
    if (Array.isArray(numeric) && numeric.length > 0) {
      // Zero-length entries are valid (e.g. `[0 10]` with round caps paints
      // spaced dots). Only negative/invalid values or an all-zero pattern are
      // unusable under the PDF dash rules.
      if (
        numeric.every((value) => value >= 0)
        && numeric.some((value) => value > 0)
      ) {
        return numeric;
      }
    }
  }

  // /S is explicitly /D but no /D entry present: fall back to [3, 3].
  return [3, 3];
}

function decodeStreamBytesToLatin1(bytes) {
  if (!bytes || bytes.length === 0) return '';

  // Avoid stack overflow on large streams by chunking.
  const chunkSize = 0x8000;
  let result = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return result;
}

const PDF_IDENTITY_MATRIX = Object.freeze([1, 0, 0, 1, 0, 0]);

function isFinitePdfMatrix(value) {
  return (Array.isArray(value) || ArrayBuffer.isView(value))
    && value.length === 6
    && value.every((entry) => Number.isFinite(Number(entry)));
}

function applyPdfMatrixToPoint(matrix, x, y) {
  const source = isFinitePdfMatrix(matrix) ? matrix : PDF_IDENTITY_MATRIX;
  const [a, b, c, d, e, f] = source.map(Number);
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  };
}

// Compose two PDF matrices so the child transform runs first and the parent
// transform runs second: parent(child(point)). This matches Form /Matrix
// outside an appearance stream's local `cm` operations.
function composePdfMatrices(parent, child) {
  const [pa, pb, pc, pd, pe, pf] = parent;
  const [ca, cb, cc, cd, ce, cf] = child;
  return [
    pa * ca + pc * cb,
    pb * ca + pd * cb,
    pa * cc + pc * cd,
    pb * cc + pd * cd,
    pa * ce + pc * cf + pe,
    pb * ce + pd * cf + pf,
  ];
}

function createAppearanceToPdfMatrix(rectValue, bboxValue, matrixValue) {
  const matrix = isFinitePdfMatrix(matrixValue)
    ? Array.from(matrixValue, Number)
    : Array.from(PDF_IDENTITY_MATRIX);
  const rect = toNumericArray(rectValue);
  const bbox = toNumericArray(bboxValue);
  if (rect?.length !== 4 || bbox?.length !== 4) {
    return matrix;
  }

  const corners = [
    applyPdfMatrixToPoint(matrix, bbox[0], bbox[1]),
    applyPdfMatrixToPoint(matrix, bbox[2], bbox[1]),
    applyPdfMatrixToPoint(matrix, bbox[0], bbox[3]),
    applyPdfMatrixToPoint(matrix, bbox[2], bbox[3]),
  ];
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  const outer = minX === maxX || minY === maxY
    ? [1, 0, 0, 1, rect[0], rect[1]]
    : [
        (rect[2] - rect[0]) / (maxX - minX),
        0,
        0,
        (rect[3] - rect[1]) / (maxY - minY),
        rect[0] - minX * ((rect[2] - rect[0]) / (maxX - minX)),
        rect[1] - minY * ((rect[3] - rect[1]) / (maxY - minY)),
      ];

  // PDF.js begins an annotation with `outer`, then applies the Form /Matrix.
  // Content-stream `cm` operations are already baked into parsed path points.
  return composePdfMatrices(outer, matrix);
}

function pdfMatrixAreaScale(matrix) {
  if (!isFinitePdfMatrix(matrix)) return 1;
  const [a, b, c, d] = Array.from(matrix, Number);
  return Math.sqrt(Math.abs(a * d - b * c));
}

function pdfMatrixMaxSingularScale(matrix) {
  if (!isFinitePdfMatrix(matrix)) return 1;
  const [a, b, c, d] = Array.from(matrix, Number);
  const firstSquared = a * a + b * b;
  const secondSquared = c * c + d * d;
  const cross = a * c + b * d;
  const discriminant = Math.hypot(
    firstSquared - secondSquared,
    2 * cross,
  );
  const largestEigenvalue = (firstSquared + secondSquared + discriminant) / 2;
  const singular = Math.sqrt(Math.max(0, largestEigenvalue));
  return Number.isFinite(singular) && singular > 1e-15 ? singular : 1;
}

function curveToleranceForMatrix(matrix, viewportTolerance = 0.02) {
  return Math.max(
    Number.EPSILON * 128,
    viewportTolerance / pdfMatrixMaxSingularScale(matrix),
  );
}

function viewportAreaScale(viewport, scale = 1) {
  if (viewport && typeof viewport.convertToViewportPoint === 'function') {
    const [originX, originY] = viewport.convertToViewportPoint(0, 0);
    const [unitXX, unitXY] = viewport.convertToViewportPoint(1, 0);
    const [unitYX, unitYY] = viewport.convertToViewportPoint(0, 1);
    const determinant = (
      (unitXX - originX) * (unitYY - originY)
      - (unitXY - originY) * (unitYX - originX)
    );
    if (Number.isFinite(determinant)) {
      return Math.sqrt(Math.abs(determinant)) * Math.abs(Number(scale) || 1);
    }
  }
  return Math.abs(Number(scale) || 1);
}

function invertPdfMatrix(matrix) {
  if (!isFinitePdfMatrix(matrix)) return null;
  const [a, b, c, d, e, f] = Array.from(matrix, Number);
  const determinant = a * d - b * c;
  const linearScale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (
    !Number.isFinite(determinant)
    || linearScale === 0
    || Math.abs(determinant) <= (
      linearScale * linearScale * Number.EPSILON * 16
    )
  ) return null;
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

function transformPathCommands(commands, matrix) {
  return (commands || []).map((command) => {
    if (!Array.isArray(command) || command.length === 0 || command[0] === 'Z') {
      return Array.isArray(command) ? Array.from(command) : command;
    }
    const transformed = [command[0]];
    for (let index = 1; index + 1 < command.length; index += 2) {
      const point = applyPdfMatrixToPoint(matrix, command[index], command[index + 1]);
      transformed.push(point.x, point.y);
    }
    return transformed;
  });
}

function transformPolygonSet(polygons, matrix) {
  return normalizeMultiPolygon(polygons).map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => {
      const point = applyPdfMatrixToPoint(matrix, x, y);
      return [point.x, point.y];
    })
  )));
}

function rectanglePolygonSet(rectValue, matrix = PDF_IDENTITY_MATRIX) {
  const rect = toNumericArray(rectValue);
  if (rect?.length !== 4) return [];
  const corners = [
    [rect[0], rect[1]],
    [rect[2], rect[1]],
    [rect[2], rect[3]],
    [rect[0], rect[3]],
    [rect[0], rect[1]],
  ].map(([x, y]) => {
    const point = applyPdfMatrixToPoint(matrix, x, y);
    return [point.x, point.y];
  });
  return [[corners]];
}

function clonePolygonSet(polygons) {
  return normalizeMultiPolygon(polygons).map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => [x, y])
  )));
}

function parseAppearanceStream(content, options = {}) {
  if (!content || typeof content !== 'string') return null;

  // Keep arrays intact enough to read graphics-state operands such as
  // `[3 2] 1 d`. A whitespace split turns `[3` and `2]` into unknown
  // operators, which silently converted dashed authored appearances to solid.
  const tokens = (
    content.match(
      /%[^\r\n]*|\/[^\s[\]()<>/%]+|\[|\]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?|[^\s[\]()<>/%]+/g,
    ) || []
  ).filter((token) => !token.startsWith('%'));
  if (tokens.length === 0) return null;

  const operands = [];
  const arrayMarker = Object.freeze({ pdfArrayMarker: true });
  const path = [];
  const sourcePath = [];
  let currentPath = [];
  let currentSourcePath = [];
  let currentPoint = null;
  let sourceCurrentPoint = null;
  let strokeColor = options.initialGraphicsState?.strokeColor || null;
  let fillColor = options.initialGraphicsState?.fillColor || null;
  // PDF graphics-state defaults: 1-unit width, butt cap, miter join.
  // `0 w` remains a distinct, valid device-space hairline.
  let strokeWidth = options.initialGraphicsState?.strokeWidth ?? 1;
  let lineCap = options.initialGraphicsState?.lineCap || 'butt';
  let lineJoin = options.initialGraphicsState?.lineJoin || 'miter';
  let miterLimit = options.initialGraphicsState?.miterLimit ?? 10;
  let dashArray = Array.isArray(options.initialGraphicsState?.dashArray)
    ? Array.from(options.initialGraphicsState.dashArray, Number)
    : [];
  let dashPhase = Number(options.initialGraphicsState?.dashPhase) || 0;
  let strokeAlpha = Number.isFinite(options.initialGraphicsState?.strokeAlpha)
    ? Number(options.initialGraphicsState.strokeAlpha)
    : 1;
  let fillAlpha = Number.isFinite(options.initialGraphicsState?.fillAlpha)
    ? Number(options.initialGraphicsState.fillAlpha)
    : 1;
  let strokeAlphaExplicit = options.initialGraphicsState?.strokeAlphaExplicit === true;
  let fillAlphaExplicit = options.initialGraphicsState?.fillAlphaExplicit === true;
  let blendMode = options.initialGraphicsState?.blendMode || null;
  let hasStroke = false;
  let hasFill = false;
  let fillRule = null;
  let paintedStrokeColor = null;
  let paintedFillColor = null;
  let paintedStrokeWidth = null;
  let paintedLineCap = null;
  let paintedLineJoin = null;
  let paintedStrokeMatrix = null;
  let ctm = isFinitePdfMatrix(options.initialCtm)
    ? Array.from(options.initialCtm, Number)
    : Array.from(PDF_IDENTITY_MATRIX);
  const contentMatrices = [];
  const gstateStack = [];
  const paintOperations = [];
  let currentSubpathStart = null;
  let sourceSubpathStart = null;
  let pendingClipRule = null;
  let activeClip = clonePolygonSet(options.initialClip);
  const formBBoxClip = rectanglePolygonSet(options.bbox, ctm);
  let clipActive = options.initialClipActive === true || activeClip.length > 0;
  if (formBBoxClip.length > 0) {
    activeClip = clipActive
      ? intersectPolygonSets(activeClip, formBBoxClip)
      : formBBoxClip;
    clipActive = true;
  }
  let hasExplicitClip = options.hasExplicitClip === true;

  const consumeNumbers = (count) => {
    if (operands.length < count) return null;

    const raw = operands.slice(-count);
    if (!raw.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return null;
    }

    operands.length -= count;
    return raw;
  };

  const consumeName = () => {
    const value = operands.pop();
    return typeof value === 'string' && value.startsWith('/')
      ? value.slice(1)
      : null;
  };

  const closeCurrentSubpath = () => {
    if (currentPath.length === 0) return;
    if (currentPath[currentPath.length - 1][0] === 'Z') return;
    currentPath.push(['Z']);
    currentSourcePath.push(['Z']);
    if (currentSubpathStart) currentPoint = { ...currentSubpathStart };
    if (sourceSubpathStart) sourceCurrentPoint = { ...sourceSubpathStart };
  };

  const applyPendingClip = () => {
    if (!pendingClipRule || currentPath.length === 0) {
      pendingClipRule = null;
      return;
    }
    const nextClip = filledOutlineCommandsToPolygonSet(currentPath, {
      curveTolerance: Number.isFinite(options.curveTolerance)
        ? options.curveTolerance
        : 0.02,
      fillRule: pendingClipRule,
    });
    if (nextClip.length > 0) {
      activeClip = clipActive
        ? intersectPolygonSets(activeClip, nextClip)
        : nextClip;
      clipActive = true;
      hasExplicitClip = true;
    } else {
      activeClip = [];
      clipActive = true;
      hasExplicitClip = true;
    }
    pendingClipRule = null;
  };

  const consumeCurrentPath = ({ stroke = false, fill = false, rule = null } = {}) => {
    if (currentPath.length > 0) {
      path.push(...currentPath);
      sourcePath.push(...currentSourcePath);
      if (stroke || fill) {
        paintOperations.push({
          path: currentPath.map((command) => Array.from(command)),
          sourcePath: currentSourcePath.map((command) => Array.from(command)),
          stroke,
          fill,
          fillRule: rule,
          strokeColor: strokeColor ? Array.from(strokeColor) : null,
          fillColor: fillColor ? Array.from(fillColor) : null,
          strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth : null,
          lineCap,
          lineJoin,
          miterLimit,
          dashArray: Array.from(dashArray),
          dashPhase,
          strokeAlpha,
          fillAlpha,
          strokeAlphaExplicit,
          fillAlphaExplicit,
          blendMode,
          strokeMatrix: Array.from(ctm),
          clipPolygons: clonePolygonSet(activeClip),
          clipActive,
          hasExplicitClip,
        });
      }
    }
    if (stroke) {
      hasStroke = true;
      if (paintedStrokeColor === null && strokeColor !== null) {
        paintedStrokeColor = Array.from(strokeColor);
      }
      if (paintedStrokeWidth === null && Number.isFinite(strokeWidth)) {
        paintedStrokeWidth = strokeWidth;
      }
      if (paintedLineCap === null && lineCap !== null) paintedLineCap = lineCap;
      if (paintedLineJoin === null && lineJoin !== null) paintedLineJoin = lineJoin;
      if (paintedStrokeMatrix === null) paintedStrokeMatrix = Array.from(ctm);
    }
    if (fill) {
      hasFill = true;
      if (paintedFillColor === null && fillColor !== null) {
        paintedFillColor = Array.from(fillColor);
      }
      if (fillRule === null && rule !== null) fillRule = rule;
    }
    applyPendingClip();
    currentPath = [];
    currentSourcePath = [];
    currentPoint = null;
    sourceCurrentPoint = null;
    currentSubpathStart = null;
    sourceSubpathStart = null;
  };

  const discardCurrentPath = () => {
    applyPendingClip();
    currentPath = [];
    currentSourcePath = [];
    currentPoint = null;
    sourceCurrentPoint = null;
    currentSubpathStart = null;
    sourceSubpathStart = null;
  };

  for (const token of tokens) {
    if (token === '[') {
      operands.push(arrayMarker);
      continue;
    }
    if (token === ']') {
      const markerIndex = operands.lastIndexOf(arrayMarker);
      if (markerIndex >= 0) {
        const entries = operands.splice(markerIndex + 1);
        operands.pop();
        operands.push(entries);
      }
      continue;
    }
    const numeric = Number(token);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      operands.push(numeric);
      continue;
    }

    if (token.startsWith('/')) {
      operands.push(token);
      continue;
    }

    switch (token) {
      case 'm': {
        const values = consumeNumbers(2);
        if (!values) break;
        const [x, y] = values;
        const point = applyPdfMatrixToPoint(ctm, x, y);
        currentPath.push(['M', point.x, point.y]);
        currentSourcePath.push(['M', x, y]);
        currentPoint = point;
        sourceCurrentPoint = { x, y };
        currentSubpathStart = { ...point };
        sourceSubpathStart = { x, y };
        break;
      }
      case 'l': {
        const values = consumeNumbers(2);
        if (!values) break;
        const [x, y] = values;
        const point = applyPdfMatrixToPoint(ctm, x, y);
        currentPath.push(['L', point.x, point.y]);
        currentSourcePath.push(['L', x, y]);
        currentPoint = point;
        sourceCurrentPoint = { x, y };
        break;
      }
      case 'c': {
        const values = consumeNumbers(6);
        if (!values) break;
        const [x1, y1, x2, y2, x3, y3] = values;
        const p1 = applyPdfMatrixToPoint(ctm, x1, y1);
        const p2 = applyPdfMatrixToPoint(ctm, x2, y2);
        const p3 = applyPdfMatrixToPoint(ctm, x3, y3);
        currentPath.push(['C', p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]);
        currentSourcePath.push(['C', x1, y1, x2, y2, x3, y3]);
        currentPoint = p3;
        sourceCurrentPoint = { x: x3, y: y3 };
        break;
      }
      case 'v': {
        const values = consumeNumbers(4);
        if (!values || !currentPoint || !sourceCurrentPoint) break;
        const [x2, y2, x3, y3] = values;
        const p2 = applyPdfMatrixToPoint(ctm, x2, y2);
        const p3 = applyPdfMatrixToPoint(ctm, x3, y3);
        currentPath.push(['C', currentPoint.x, currentPoint.y, p2.x, p2.y, p3.x, p3.y]);
        currentSourcePath.push([
          'C',
          sourceCurrentPoint.x,
          sourceCurrentPoint.y,
          x2,
          y2,
          x3,
          y3,
        ]);
        currentPoint = p3;
        sourceCurrentPoint = { x: x3, y: y3 };
        break;
      }
      case 'y': {
        const values = consumeNumbers(4);
        if (!values) break;
        const [x1, y1, x3, y3] = values;
        const p1 = applyPdfMatrixToPoint(ctm, x1, y1);
        const p3 = applyPdfMatrixToPoint(ctm, x3, y3);
        currentPath.push(['C', p1.x, p1.y, p3.x, p3.y, p3.x, p3.y]);
        currentSourcePath.push(['C', x1, y1, x3, y3, x3, y3]);
        currentPoint = p3;
        sourceCurrentPoint = { x: x3, y: y3 };
        break;
      }
      case 'h': {
        closeCurrentSubpath();
        break;
      }
      case 're': {
        const values = consumeNumbers(4);
        if (!values) break;
        const [x, y, w, h] = values;
        const corners = [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ];
        corners.forEach(([cornerX, cornerY], index) => {
          const point = applyPdfMatrixToPoint(ctm, cornerX, cornerY);
          currentPath.push([index === 0 ? 'M' : 'L', point.x, point.y]);
          currentSourcePath.push([index === 0 ? 'M' : 'L', cornerX, cornerY]);
        });
        currentPath.push(['Z']);
        currentSourcePath.push(['Z']);
        currentPoint = applyPdfMatrixToPoint(ctm, x, y);
        sourceCurrentPoint = { x, y };
        currentSubpathStart = { ...currentPoint };
        sourceSubpathStart = { x, y };
        break;
      }
      case 'cm': {
        const values = consumeNumbers(6);
        if (!values) break;
        const matrix = values.map(Number);
        contentMatrices.push(Array.from(matrix));
        ctm = composePdfMatrices(ctm, matrix);
        break;
      }
      case 'w': {
        const values = consumeNumbers(1);
        if (!values) break;
        strokeWidth = values[0];
        break;
      }
      case 'J': {
        const values = consumeNumbers(1);
        if (!values) break;
        const capIndex = Math.trunc(values[0]);
        lineCap = LINE_CAP_MAP[capIndex] || null;
        break;
      }
      case 'j': {
        const values = consumeNumbers(1);
        if (!values) break;
        const joinIndex = Math.trunc(values[0]);
        lineJoin = LINE_JOIN_MAP[joinIndex] || null;
        break;
      }
      case 'M': {
        const values = consumeNumbers(1);
        if (!values) break;
        miterLimit = values[0];
        break;
      }
      case 'd': {
        const phase = operands.pop();
        const pattern = operands.pop();
        if (
          Array.isArray(pattern)
          && pattern.every((value) => typeof value === 'number' && Number.isFinite(value))
          && typeof phase === 'number'
          && Number.isFinite(phase)
        ) {
          dashArray = pattern.map((value) => Math.max(0, value));
          dashPhase = phase;
        }
        operands.length = 0;
        break;
      }
      case 'gs': {
        const name = consumeName();
        const ext = (
          name
          && typeof options.resolveExtGState === 'function'
        )
          ? options.resolveExtGState(name, options.resources)
          : null;
        if (ext) {
          if (Number.isFinite(ext.strokeWidth)) strokeWidth = ext.strokeWidth;
          if (ext.lineCap) lineCap = ext.lineCap;
          if (ext.lineJoin) lineJoin = ext.lineJoin;
          if (Number.isFinite(ext.miterLimit)) miterLimit = ext.miterLimit;
          if (Array.isArray(ext.dashArray)) dashArray = Array.from(ext.dashArray, Number);
          if (Number.isFinite(ext.dashPhase)) dashPhase = ext.dashPhase;
          if (Number.isFinite(ext.strokeAlpha)) {
            strokeAlpha = ext.strokeAlpha;
            strokeAlphaExplicit = true;
          }
          if (Number.isFinite(ext.fillAlpha)) {
            fillAlpha = ext.fillAlpha;
            fillAlphaExplicit = true;
          }
          if (ext.blendMode) blendMode = ext.blendMode;
        }
        operands.length = 0;
        break;
      }
      case 'RG': {
        const values = consumeNumbers(3);
        if (!values) break;
        strokeColor = values;
        break;
      }
      case 'G': {
        const values = consumeNumbers(1);
        if (!values) break;
        strokeColor = [values[0], values[0], values[0]];
        break;
      }
      case 'rg': {
        const values = consumeNumbers(3);
        if (!values) break;
        fillColor = values;
        break;
      }
      case 'g': {
        const values = consumeNumbers(1);
        if (!values) break;
        fillColor = [values[0], values[0], values[0]];
        break;
      }
      case 'S': {
        consumeCurrentPath({ stroke: true });
        break;
      }
      case 's': {
        closeCurrentSubpath();
        consumeCurrentPath({ stroke: true });
        break;
      }
      case 'f':
      case 'F': {
        consumeCurrentPath({ fill: true, rule: 'nonzero' });
        break;
      }
      case 'f*': {
        consumeCurrentPath({ fill: true, rule: 'evenodd' });
        break;
      }
      case 'B': {
        consumeCurrentPath({ stroke: true, fill: true, rule: 'nonzero' });
        break;
      }
      case 'B*': {
        consumeCurrentPath({ stroke: true, fill: true, rule: 'evenodd' });
        break;
      }
      case 'b': {
        closeCurrentSubpath();
        consumeCurrentPath({ stroke: true, fill: true, rule: 'nonzero' });
        break;
      }
      case 'b*': {
        closeCurrentSubpath();
        consumeCurrentPath({ stroke: true, fill: true, rule: 'evenodd' });
        break;
      }
      case 'W':
      case 'W*': {
        // The clipping operator modifies the clipping path only when the
        // current path is subsequently ended. It never paints geometry.
        pendingClipRule = token === 'W*' ? 'evenodd' : 'nonzero';
        operands.length = 0;
        break;
      }
      case 'n': {
        discardCurrentPath();
        break;
      }
      case 'Do': {
        const name = consumeName();
        const depth = Number(options.depth) || 0;
        const nested = (
          name
          && depth < 64
          && typeof options.resolveXObject === 'function'
        )
          ? options.resolveXObject(name, options.resources)
          : null;
        const ancestors = options.xObjectAncestors instanceof Set
          ? options.xObjectAncestors
          : new Set();
        if (
          !nested?.content
          || (nested.identity && ancestors.has(nested.identity))
        ) {
          operands.length = 0;
          break;
        }
        const childAncestors = new Set(ancestors);
        if (nested.identity) childAncestors.add(nested.identity);
        const nestedMatrix = isFinitePdfMatrix(nested.matrix)
          ? Array.from(nested.matrix, Number)
          : Array.from(PDF_IDENTITY_MATRIX);
        const child = parseAppearanceStream(nested.content, {
          bbox: nested.bbox,
          resources: nested.resources || options.resources,
          resolveXObject: options.resolveXObject,
          resolveExtGState: options.resolveExtGState,
          curveTolerance: options.curveTolerance,
          xObjectAncestors: childAncestors,
          depth: depth + 1,
          initialCtm: composePdfMatrices(ctm, nestedMatrix),
          initialClip: activeClip,
          initialClipActive: clipActive,
          hasExplicitClip,
          initialGraphicsState: {
            strokeColor,
            fillColor,
            strokeWidth,
            lineCap,
            lineJoin,
            miterLimit,
            dashArray,
            dashPhase,
            strokeAlpha,
            fillAlpha,
            strokeAlphaExplicit,
            fillAlphaExplicit,
            blendMode,
          },
        });
        if (child) {
          path.push(...(child.path || []).map((command) => Array.from(command)));
          sourcePath.push(...(child.sourcePath || []).map((command) => Array.from(command)));
          contentMatrices.push(nestedMatrix, ...(child.contentMatrices || []));
          for (const operation of child.paintOperations || []) {
            paintOperations.push(operation);
          }
          if (child.hasStroke) {
            hasStroke = true;
            paintedStrokeColor ??= child.strokeColor;
            paintedStrokeWidth ??= child.strokeWidth;
            paintedLineCap ??= child.lineCap;
            paintedLineJoin ??= child.lineJoin;
            paintedStrokeMatrix ??= child.strokeMatrix;
          }
          if (child.hasFill) {
            hasFill = true;
            paintedFillColor ??= child.fillColor;
            fillRule ??= child.fillRule;
          }
        }
        operands.length = 0;
        break;
      }
      case 'q': {
        // UX: 2026-04-19 — PDF graphics state save. Without this the text
        // painting sequence inside the rendered textbox ("0 G" for black
        // stroke before the text) overwrites the earlier real stroke color
        // set for the callout border, so the border was coming through as
        // black instead of red.
        gstateStack.push({
          strokeColor,
          fillColor,
          strokeWidth,
          lineCap,
          lineJoin,
          miterLimit,
          dashArray: Array.from(dashArray),
          dashPhase,
          strokeAlpha,
          fillAlpha,
          strokeAlphaExplicit,
          fillAlphaExplicit,
          blendMode,
          ctm: Array.from(ctm),
          activeClip: clonePolygonSet(activeClip),
          clipActive,
          hasExplicitClip,
        });
        operands.length = 0;
        break;
      }
      case 'Q': {
        const saved = gstateStack.pop();
        if (saved) {
          strokeColor = saved.strokeColor;
          fillColor = saved.fillColor;
          strokeWidth = saved.strokeWidth;
          lineCap = saved.lineCap;
          lineJoin = saved.lineJoin;
          miterLimit = saved.miterLimit;
          dashArray = saved.dashArray;
          dashPhase = saved.dashPhase;
          strokeAlpha = saved.strokeAlpha;
          fillAlpha = saved.fillAlpha;
          strokeAlphaExplicit = saved.strokeAlphaExplicit;
          fillAlphaExplicit = saved.fillAlphaExplicit;
          blendMode = saved.blendMode;
          ctm = saved.ctm;
          activeClip = saved.activeClip;
          clipActive = saved.clipActive;
          hasExplicitClip = saved.hasExplicitClip;
        }
        operands.length = 0;
        break;
      }
      default: {
        // Unknown operator; clear to avoid stale operands leaking into the next op.
        operands.length = 0;
        break;
      }
    }
  }

  if (path.length === 0) {
    return null;
  }

  return {
    path,
    sourcePath,
    contentMatrices,
    strokeWidth: paintedStrokeWidth ?? strokeWidth,
    strokeColor: paintedStrokeColor ?? strokeColor,
    fillColor: paintedFillColor ?? fillColor,
    lineCap: paintedLineCap ?? lineCap,
    lineJoin: paintedLineJoin ?? lineJoin,
    miterLimit,
    strokeMatrix: paintedStrokeMatrix,
    paintOperations,
    hasStroke,
    hasFill,
    fillRule,
  };
}

function lookupPdfResourceEntry(resourcesValue, category, name, context, PDFName) {
  if (!resourcesValue || !name) return null;
  try {
    const resources = context.lookup(resourcesValue) || resourcesValue;
    const categoryRef = resources?.get?.(PDFName.of(category));
    const categoryDict = categoryRef ? (context.lookup(categoryRef) || categoryRef) : null;
    const entryRef = categoryDict?.get?.(PDFName.of(name));
    return entryRef
      ? {
          value: context.lookup(entryRef) || entryRef,
          identity: entryRef,
        }
      : null;
  } catch {
    return null;
  }
}

function createAppearanceResourceResolvers(context, pdfLib) {
  const { PDFName, decodePDFRawStream } = pdfLib;

  const resolveXObject = (name, resourcesValue) => {
    const resource = lookupPdfResourceEntry(
      resourcesValue,
      'XObject',
      name,
      context,
      PDFName,
    );
    const stream = resource?.value;
    const streamDict = stream?.dict || stream;
    if (!stream || typeof streamDict?.get !== 'function') return null;
    const subtype = normalizePdfNameToken(
      readPdfLibText(streamDict.get(PDFName.of('Subtype'))),
    );
    if (subtype && subtype !== 'Form') return null;
    try {
      const decoded = decodePDFRawStream(stream).decode();
      return {
        content: decodeStreamBytesToLatin1(decoded),
        bbox: readPdfLibNumberArray(streamDict.get(PDFName.of('BBox'))),
        matrix: readPdfLibNumberArray(streamDict.get(PDFName.of('Matrix'))),
        resources: streamDict.get(PDFName.of('Resources')) || resourcesValue,
        identity: resource.identity,
      };
    } catch {
      return null;
    }
  };

  const resolveExtGState = (name, resourcesValue) => {
    const resource = lookupPdfResourceEntry(
      resourcesValue,
      'ExtGState',
      name,
      context,
      PDFName,
    );
    const state = resource?.value;
    if (!state || typeof state.get !== 'function') return null;
    const dashValue = state.get(PDFName.of('D'));
    const dashEntries = dashValue?.asArray?.();
    const dashArray = Array.isArray(dashEntries) && dashEntries.length > 0
      ? readPdfLibNumberArray(context.lookup(dashEntries[0]) || dashEntries[0])
      : null;
    const dashPhase = Array.isArray(dashEntries) && dashEntries.length > 1
      ? readPdfLibNumber(context.lookup(dashEntries[1]) || dashEntries[1])
      : null;
    const capIndex = readPdfLibNumber(state.get(PDFName.of('LC')));
    const joinIndex = readPdfLibNumber(state.get(PDFName.of('LJ')));
    const blendMode = normalizePdfNameToken(
      readPdfLibText(state.get(PDFName.of('BM'))),
    );
    return {
      strokeWidth: readPdfLibNumber(state.get(PDFName.of('LW'))),
      lineCap: Number.isFinite(capIndex) ? (LINE_CAP_MAP[Math.trunc(capIndex)] || null) : null,
      lineJoin: Number.isFinite(joinIndex) ? (LINE_JOIN_MAP[Math.trunc(joinIndex)] || null) : null,
      miterLimit: readPdfLibNumber(state.get(PDFName.of('ML'))),
      dashArray,
      dashPhase,
      strokeAlpha: readPdfLibNumber(state.get(PDFName.of('CA'))),
      fillAlpha: readPdfLibNumber(state.get(PDFName.of('ca'))),
      blendMode,
    };
  };

  return { resolveXObject, resolveExtGState };
}

function extractAppearanceMetadataForAnnotation(annotationDict, context, pdfLib) {
  const { PDFName, decodePDFRawStream } = pdfLib;
  const ap = annotationDict?.get?.(PDFName.of('AP'));
  if (!ap) return null;

  const apDict = context.lookup(ap);
  const normalAppearance = apDict?.get?.(PDFName.of('N'));
  if (!normalAppearance) return null;

  const stream = context.lookup(normalAppearance);
  if (!stream) return null;

  // UX 2026-04-22: extract /AP /N Form XObject /Matrix + /BBox so shape
  // converters (Square, Circle, Polygon) can recover rotation and true
  // unrotated dimensions. Drawboard (and others) rotate a shape by
  // tilting the appearance stream via /Matrix while leaving the outer
  // /Rect axis-aligned. Without reading /Matrix, a 182×147 rectangle
  // tilted 47° imports as a 231×231 axis-aligned square (its AABB).
  let matrix = null;
  let bbox = null;
  let rect = null;
  let resources = null;
  try {
    const streamDict = stream.dict || stream;
    if (streamDict && typeof streamDict.get === 'function') {
      matrix = readPdfLibNumberArray(streamDict.get(PDFName.of('Matrix')));
      bbox = readPdfLibNumberArray(streamDict.get(PDFName.of('BBox')));
      rect = readPdfLibNumberArray(annotationDict.get(PDFName.of('Rect')));
      resources = streamDict.get(PDFName.of('Resources'));
    }
  } catch {
    matrix = null;
    bbox = null;
    rect = null;
    resources = null;
  }

  let parsed = null;
  try {
    const decoded = decodePDFRawStream(stream).decode();
    const source = decodeStreamBytesToLatin1(decoded);
    const { resolveXObject, resolveExtGState } = createAppearanceResourceResolvers(
      context,
      pdfLib,
    );
    parsed = parseAppearanceStream(source, {
      bbox,
      resources,
      resolveXObject,
      resolveExtGState,
      curveTolerance: curveToleranceForMatrix(
        createAppearanceToPdfMatrix(rect, bbox, matrix),
      ),
    });
  } catch {
    parsed = null;
  }

  if (!parsed && !matrix && !bbox) return null;
  return {
    ...(parsed || {}),
    isFormXObject: true,
    ...(Array.isArray(matrix) && matrix.length === 6 ? { matrix } : {}),
    ...(Array.isArray(bbox) && bbox.length === 4 ? { bbox } : {}),
  };
}

async function buildRawAnnotationMetadataById(rawPdfBytes) {
  const bytes = toUint8Array(rawPdfBytes);
  if (!bytes) return null;

  try {
    const pdfLib = await loadPdfLibCore();
    const { PDFDocument, PDFName, ParseSpeeds } = pdfLib;
    // PERF/HANG (2026-07-17): pdf-lib's default parseSpeed (ParseSpeeds.Slow)
    // yields to the macrotask queue via nested setTimeout(0) every 100 parsed
    // objects. Browsers clamp/throttle nested timers (4ms foreground, up to
    // 1000ms+ for hidden/occluded tabs), so a many-object PDF (this 36-page
    // Drawboard package has ~3.4k top-level objects + 196 object streams)
    // turns into hundreds of throttled ticks and the load PROMISE NEVER
    // FINISHES in practice — the 20s load watchdog then kills the open.
    // ParseSpeeds.Fastest parses synchronously (no timer ticks): same file
    // parses in well under a second, and this runs behind the loading curtain.
    const rawPdfDoc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      parseSpeed: ParseSpeeds.Fastest,
    });
    const metadataById = new Map();
    const directCandidatesByPage = new Map();
    const rawAnnotationsByPage = new Map();

    rawPdfDoc.getPages().forEach((page, pageIndex) => {
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (!annots || typeof annots.asArray !== 'function') return;
      const pageNumber = pageIndex + 1;
      const directCandidates = [];
      const rawAnnotations = [];

      annots.asArray().forEach((annotRef, annotsIndex) => {
        const dict = rawPdfDoc.context.lookup(annotRef);
        if (!dict || typeof dict.get !== 'function') return;

        const subtype = readPdfLibText(dict.get(PDFName.of('Subtype')));
        if (!subtype) return;
        if (typeof annotRef?.objectNumber !== 'number') {
          const fingerprint = buildRawPdfNativeAnnotationFingerprint({
            context: rawPdfDoc.context,
            dict,
            PDFName,
          });
          if (fingerprint) {
            directCandidates.push({
              pageNumber,
              annotsIndex,
              fingerprint,
            });
          }
        }

        const referenceId = (
          typeof annotRef?.objectNumber === 'number'
            ? (
                Number(annotRef.generationNumber) > 0
                  ? `${annotRef.objectNumber}R${annotRef.generationNumber}`
                  : `${annotRef.objectNumber}R`
              )
            : null
        );
        const nameId = readPdfLibText(dict.get(PDFName.of('NM')));
        const idCandidates = [referenceId, nameId].filter(Boolean);
        rawAnnotations.push({
          subtype,
          ids: idCandidates,
          annotsIndex,
          flags: normalizePdfNativeAnnotationFlags(
            readPdfLibNumber(dict.get(PDFName.of('F'))),
            0,
          ) ?? 0,
        });
        if (idCandidates.length === 0) return;

        const rectValue = dict.get(PDFName.of('Rect'));
        const quadPointsValue = dict.get(PDFName.of('QuadPoints'));
        const rect = readPdfLibNumberArray(rectValue);
        const quadPoints = readPdfLibNumberArray(quadPointsValue);
        const color = readPdfLibNumberArray(dict.get(PDFName.of('C')));
        const lineColor = readPdfLibNumberArray(dict.get(PDFName.of('LineColor')));
        const interiorColor = readPdfLibNumberArray(dict.get(PDFName.of('IC')));
        const ca = readPdfLibNumber(dict.get(PDFName.of('ca')));
        const CA = readPdfLibNumber(dict.get(PDFName.of('CA')));
        const fillOpacity = readPdfLibNumber(dict.get(PDFName.of('FillOpacity')));
        const rotation = readPdfLibNumber(dict.get(PDFName.of('Rotate')));
        const intent = normalizePdfNameToken(readPdfLibText(dict.get(PDFName.of('IT'))));
        const lineEndings = normalizePdfLineEndings(readPdfLibNameArray(dict.get(PDFName.of('LE'))));
        const lineCoordinates = readPdfLibNumberArray(dict.get(PDFName.of('L')));
        const vertices = readPdfLibNumberArray(dict.get(PDFName.of('Vertices')));
        const calloutLine = readPdfLibNumberArray(dict.get(PDFName.of('CL')));
        const rectangleDifferences = readPdfLibNumberArray(dict.get(PDFName.of('RD')));
        // /Q quadding: 0 left, 1 center, 2 right (PDF spec 12.7.4.3)
        const quadding = readPdfLibNumber(dict.get(PDFName.of('Q')));
        const iconName = normalizePdfNameToken(readPdfLibText(dict.get(PDFName.of('Name'))));
        const state = readPdfLibText(dict.get(PDFName.of('State')));
        const stateModel = readPdfLibText(dict.get(PDFName.of('StateModel')));
        const daText = readPdfLibText(dict.get(PDFName.of('DA')));
        const dsText = readPdfLibText(dict.get(PDFName.of('DS')));
        const rcText = readPdfLibText(dict.get(PDFName.of('RC')));
        const contents = readPdfLibText(dict.get(PDFName.of('Contents')));
        const title = readPdfLibText(dict.get(PDFName.of('T')));
        const subject = readPdfLibText(dict.get(PDFName.of('Subj')));
        const surveyAppMetadataText = readPdfLibText(dict.get(PDFName.of(PDF_COUNTER_METADATA_KEY)));
        const counterMetadata = parsePdfCounterMetadata(surveyAppMetadataText);
        const surveyAppCalloutMetadataText = readPdfLibText(dict.get(PDFName.of(PDF_CALLOUT_METADATA_KEY)));
        const calloutMetadata = parsePdfCalloutMetadata(surveyAppCalloutMetadataText);
        const surveyAppAnnotationMetadataText = readPdfLibText(dict.get(PDFName.of(PDF_APP_ANNOTATION_METADATA_KEY)));
        const appAnnotationMetadata = parsePdfAppAnnotationMetadata(surveyAppAnnotationMetadataText);
        // UX: 2026-04-19 — DA/DS carry the *default* style; Acrobat embeds
        // per-span overrides in /RC (XHTML rich text). On this PDF's
        // "hello" callout DA/DS both say red but the inline <span>
        // recolors the word to green, which is what Acrobat paints.
        // Parse any inline color from RC and prefer it over DA/DS.
        const rcData = parseRichContentFirstColor(rcText);
        const quadAlign = quadding === 1 ? 'center' : quadding === 2 ? 'right' : quadding === 0 ? 'left' : null;
        const defaultAppearanceData = {
          ...(parseDefaultStyleString(dsText) || {}),
          ...(parseDefaultAppearanceString(daText) || {}),
          ...(quadAlign ? { textAlign: quadAlign } : {}),
          ...(rcData || {})
        };

        let borderWidth = null;
        let borderStyleType = null;
        let borderDashArray = null;
        const borderStyleRef = dict.get(PDFName.of('BS'));
        const borderStyle = borderStyleRef
          ? (rawPdfDoc.context.lookup(borderStyleRef) || borderStyleRef)
          : null;
        if (borderStyle && typeof borderStyle.get === 'function') {
          borderWidth = readPdfLibNumber(borderStyle.get(PDFName.of('W')));
          borderStyleType = normalizePdfNameToken(readPdfLibText(borderStyle.get(PDFName.of('S'))));
          borderDashArray = readPdfLibDashArray(borderStyle.get(PDFName.of('D')));
        }
        // UX 2026-04-21: /BE (Border Effect) carries the "cloudy border" flag
        // used by Drawboard, Bluebeam, Acrobat, and others for revision-cloud
        // rectangles/polygons. /BE/S = /C means cloudy edges; /BE/I is the
        // intensity (0-2, default 0 when the cloud is intended but no bump size
        // specified). Without this parse, cloud shapes imported as plain boxes.
        let borderEffect = null;
        const borderEffectRef = dict.get(PDFName.of('BE'));
        const borderEffectDict = borderEffectRef ? rawPdfDoc.context.lookup(borderEffectRef) : null;
        if (borderEffectDict && typeof borderEffectDict.get === 'function') {
          const beStyle = normalizePdfNameToken(readPdfLibText(borderEffectDict.get(PDFName.of('S'))));
          const beIntensity = readPdfLibNumber(borderEffectDict.get(PDFName.of('I')));
          if (beStyle) {
            borderEffect = {
              style: beStyle,
              intensity: Number.isFinite(beIntensity) ? beIntensity : (beStyle === 'C' ? 2 : 0),
            };
          }
        }

        const borderArrayRef = dict.get(PDFName.of('Border'));
        if (borderArrayRef && typeof borderArrayRef.asArray === 'function') {
          const borderArrayEntries = borderArrayRef.asArray();
          if (!Number.isFinite(borderWidth)) {
            const borderNumbers = borderArrayEntries
              .map((item) => readPdfLibNumber(item))
              .filter((value) => Number.isFinite(value));
            if (borderNumbers.length >= 3) {
              borderWidth = borderNumbers[2];
            }
          }
          if (!borderDashArray && borderArrayEntries.length >= 4) {
            const borderDashValue = rawPdfDoc.context.lookup(borderArrayEntries[3]) || borderArrayEntries[3];
            borderDashArray = readPdfLibDashArray(borderDashValue) || readPdfLibNumberArray(borderDashValue);
          }
        }

        const appearance = extractAppearanceMetadataForAnnotation(dict, rawPdfDoc.context, pdfLib);

        const metadata = {
          subtype,
          _rawRectPresent: rectValue !== undefined,
          _rawRect: rect,
          _rawQuadPointsPresent: quadPointsValue !== undefined,
          _rawQuadPoints: quadPoints,
          ...(color ? { color } : {}),
          ...(lineColor ? { lineColor } : {}),
          ...(interiorColor ? { interiorColor } : {}),
          ...(Number.isFinite(ca) ? { ca } : {}),
          ...(Number.isFinite(CA) ? { CA } : {}),
          ...(Number.isFinite(fillOpacity) ? { fillOpacity } : {}),
          ...(Number.isFinite(rotation) ? { rotation } : {}),
          ...(Number.isFinite(borderWidth) ? { borderWidth } : {}),
          ...(borderStyleType ? { borderStyleType } : {}),
          ...(borderDashArray ? { borderDashArray } : {}),
          ...(borderEffect ? { borderEffect } : {}),
          ...(intent ? { intent } : {}),
          ...(lineEndings ? { lineEndings } : {}),
          ...(lineCoordinates ? { lineCoordinates } : {}),
          ...(vertices ? { vertices } : {}),
          ...(calloutLine ? { calloutLine } : {}),
          ...(rectangleDifferences ? { rectangleDifferences } : {}),
          ...(iconName ? { iconName } : {}),
          ...(state ? { state } : {}),
          ...(stateModel ? { stateModel } : {}),
          ...(contents ? { contents } : {}),
          ...(title ? { title } : {}),
          ...(subject ? { subject } : {}),
          ...(surveyAppMetadataText ? { surveyAppMetadataText } : {}),
          ...(counterMetadata ? { counterMetadata } : {}),
          ...(surveyAppCalloutMetadataText ? { surveyAppCalloutMetadataText } : {}),
          ...(calloutMetadata ? { calloutMetadata } : {}),
          ...(surveyAppAnnotationMetadataText ? { surveyAppAnnotationMetadataText } : {}),
          ...(appAnnotationMetadata ? { appAnnotationMetadata } : {}),
          ...(daText ? { defaultAppearanceString: daText } : {}),
          ...(dsText ? { defaultStyleString: dsText } : {}),
          ...(Object.keys(defaultAppearanceData).length > 0 ? { defaultAppearanceData } : {}),
          ...(appearance ? { appearance } : {})
        };

        idCandidates.forEach((candidate) => {
          metadataById.set(candidate, metadata);
        });
      });
      directCandidatesByPage.set(pageNumber, directCandidates);
      rawAnnotationsByPage.set(pageNumber, rawAnnotations);
    });

    return { metadataById, directCandidatesByPage, rawAnnotationsByPage };
  } catch (error) {
    console.warn('Failed to parse raw PDF annotation metadata:', error);
    return null;
  }
}

async function readAppLayerStateFromPdf(rawPdfBytes) {
  if (!rawPdfBytes) return null;
  try {
    const pdfLib = await import('pdf-lib');
    const { PDFDocument, PDFName, ParseSpeeds } = pdfLib;
    // PERF/HANG (2026-07-17): ParseSpeeds.Fastest — see the twin comment in
    // buildRawAnnotationMetadataById. Default (Slow) tick-yields via nested
    // setTimeout(0), which browser timer throttling can stretch into a
    // never-resolving load on many-object PDFs.
    const rawPdfDoc = await PDFDocument.load(rawPdfBytes, {
      updateMetadata: false,
      ignoreEncryption: true,
      parseSpeed: ParseSpeeds.Fastest,
    });
    const raw = rawPdfDoc.catalog.get(PDFName.of(PDF_APP_LAYER_STATE_KEY));
    const text = readPdfLibText(raw);
    return parsePdfAppLayerStateMetadata(text);
  } catch (error) {
    console.warn('[PDFImport] app layer state metadata read failed:', error?.message || error);
    return null;
  }
}

function getRawAnnotationMetadataForAnnotation(annotation, metadataById) {
  if (!annotation || !metadataById || !(metadataById instanceof Map)) {
    return null;
  }

  const annotationId = String(annotation.id || '').trim();
  if (!annotationId) {
    return null;
  }

  return (
    metadataById.get(annotationId) ||
    metadataById.get(annotationId.replace(/\s+/g, '')) ||
    null
  );
}

function applyRawMetadataToAnnotation(annotation, rawMetadata) {
  if (!rawMetadata) return annotation;

  const borderStyle = {
    ...(annotation.borderStyle || {})
  };
  // UX 2026-04-22: pdf.js silently drops /BS/W for Line annotations whose
  // /Rect is degenerately thin on one axis (horizontal / vertical lines
  // have Rect height or width = /BS/W exactly), so imported H/V lines came
  // in at our fallback width of 1 while diagonal lines kept the real /BS/W
  // of 3. Prefer the raw PDF-dict width (via pdf-lib rawMetadata) when
  // present — same precedence we use for lineCoordinates and lineEndings.
  if (Number.isFinite(rawMetadata.borderWidth)) {
    borderStyle.width = rawMetadata.borderWidth;
  }
  if (rawMetadata.borderStyleType) {
    borderStyle.style = rawMetadata.borderStyleType;
  }
  if (
    !borderStyle.style &&
    Array.isArray(rawMetadata.borderDashArray) &&
    rawMetadata.borderDashArray.length > 0
  ) {
    borderStyle.style = 'D';
  }
  if (
    (!Array.isArray(borderStyle.dashArray) || borderStyle.dashArray.length === 0) &&
    Array.isArray(rawMetadata.borderDashArray) &&
    rawMetadata.borderDashArray.length > 0
  ) {
    borderStyle.dashArray = rawMetadata.borderDashArray;
  }

  // UX 2026-04-22: prefer raw PDF /LE over pdf.js's surfaced lineEndings.
  // pdf.js normalizes /L internally for some LineAnnotation flows (swapping
  // endpoints so the arrow-ending point is always listed second), which
  // decouples from the raw /LE and produces imported arrows pointing the
  // wrong direction. Trusting the raw PDF dict (via pdf-lib) keeps /L and
  // /LE in lockstep with what the authoring tool actually wrote.
  const normalizedLineEndings = normalizePdfLineEndings(
    rawMetadata.lineEndings || annotation.lineEndings
  );

  return {
    ...annotation,
    color: annotation.color || rawMetadata.color || annotation.color,
    lineColor: annotation.lineColor || rawMetadata.lineColor || annotation.lineColor,
    interiorColor: annotation.interiorColor || rawMetadata.interiorColor || annotation.interiorColor,
    borderStyle,
    // UX 2026-04-22: prefer raw /BS/W for the same pdf.js-drops-on-thin-rect
    // reason the borderStyle fix above handles. Falls back to pdf.js's
    // borderWidth only when raw isn't available.
    borderWidth: Number.isFinite(rawMetadata.borderWidth) ? rawMetadata.borderWidth : annotation.borderWidth,
    opacity:
      rawMetadata.opacity
      ?? rawMetadata.CA
      ?? rawMetadata.ca
      ?? annotation.opacity,
    ca: annotation.ca ?? rawMetadata.ca,
    CA: annotation.CA ?? rawMetadata.CA,
    fillOpacity: annotation.fillOpacity ?? rawMetadata.fillOpacity,
    _hasExplicitAnnotationOpacity: [
      rawMetadata.opacity,
      rawMetadata.CA,
      rawMetadata.ca,
      rawMetadata.fillOpacity,
    ].some(Number.isFinite),
    rotation: Number.isFinite(rawMetadata.rotation) ? rawMetadata.rotation : annotation.rotation,
    borderDashArray: annotation.borderDashArray || rawMetadata.borderDashArray || annotation.borderDashArray,
    borderStyleType: annotation.borderStyleType || rawMetadata.borderStyleType || annotation.borderStyleType,
    borderEffect: annotation.borderEffect || rawMetadata.borderEffect || null,
    lineEndings: normalizedLineEndings || annotation.lineEndings,
    // UX 2026-04-22: same reason as normalizedLineEndings above — prefer the
    // raw /L over pdf.js's potentially-reordered lineCoordinates so the two
    // stay in lockstep with what the PDF author wrote.
    lineCoordinates: rawMetadata.lineCoordinates || annotation.lineCoordinates,
    vertices: annotation.vertices || rawMetadata.vertices || annotation.vertices,
    calloutLine: annotation.calloutLine || rawMetadata.calloutLine || annotation.calloutLine,
    rectangleDifferences:
      annotation.rectangleDifferences || rawMetadata.rectangleDifferences || null,
    intent: annotation.intent || rawMetadata.intent || annotation.intent,
    name: annotation.name || rawMetadata.iconName || annotation.name,
    state: annotation.state || rawMetadata.state || annotation.state,
    stateModel: annotation.stateModel || rawMetadata.stateModel || annotation.stateModel,
    contents: annotation.contents || rawMetadata.contents || annotation.contents,
    title: annotation.title || rawMetadata.title || annotation.title,
    subject: annotation.subject || rawMetadata.subject || annotation.subject,
    surveyAppMetadataText: annotation.surveyAppMetadataText || rawMetadata.surveyAppMetadataText || annotation.surveyAppMetadataText,
    counterMetadata: annotation.counterMetadata || rawMetadata.counterMetadata || null,
    surveyAppCalloutMetadataText: annotation.surveyAppCalloutMetadataText || rawMetadata.surveyAppCalloutMetadataText || annotation.surveyAppCalloutMetadataText,
    calloutMetadata: annotation.calloutMetadata || rawMetadata.calloutMetadata || null,
    surveyAppAnnotationMetadataText: annotation.surveyAppAnnotationMetadataText || rawMetadata.surveyAppAnnotationMetadataText || annotation.surveyAppAnnotationMetadataText,
    appAnnotationMetadata: annotation.appAnnotationMetadata || rawMetadata.appAnnotationMetadata || null,
    defaultAppearanceData: {
      ...(annotation.defaultAppearanceData || {}),
      ...(rawMetadata.defaultAppearanceData || {})
    },
    defaultAppearanceString: annotation.defaultAppearanceString || rawMetadata.defaultAppearanceString || annotation.defaultAppearanceString,
    defaultStyleString: annotation.defaultStyleString || rawMetadata.defaultStyleString || annotation.defaultStyleString,
    _appearance: rawMetadata.appearance || annotation._appearance || null,
    _rawRectPresent: rawMetadata._rawRectPresent === true,
    _rawRect: rawMetadata._rawRect ?? null,
    _rawQuadPointsPresent: rawMetadata._rawQuadPointsPresent === true,
    _rawQuadPoints: rawMetadata._rawQuadPoints ?? null,
  };
}

function convertAppearancePathToFabricPath(
  pathCommands,
  viewport,
  scale = 1,
  formMatrix = null,
  formBBox = null,
  annotationRect = null,
  mapFormToAnnotation = false,
) {
  if (!Array.isArray(pathCommands) || pathCommands.length === 0) return null;

  const converted = [];
  const appearanceToPdf = mapFormToAnnotation
    ? createAppearanceToPdfMatrix(annotationRect, formBBox, formMatrix)
    : formMatrix;
  const transformPoint = (x, y) => {
    const point = applyPdfMatrixToPoint(appearanceToPdf, x, y);
    return convertPdfPointToViewport(point.x, point.y, viewport, scale);
  };

  pathCommands.forEach((segment) => {
    if (!Array.isArray(segment) || segment.length === 0) return;

    const cmd = segment[0];

    if (cmd === 'M' || cmd === 'L') {
      const point = transformPoint(segment[1], segment[2]);
      converted.push([cmd, point.x, point.y]);
      return;
    }

    if (cmd === 'Q') {
      const p1 = transformPoint(segment[1], segment[2]);
      const p2 = transformPoint(segment[3], segment[4]);
      converted.push(['Q', p1.x, p1.y, p2.x, p2.y]);
      return;
    }

    if (cmd === 'C') {
      const p1 = transformPoint(segment[1], segment[2]);
      const p2 = transformPoint(segment[3], segment[4]);
      const p3 = transformPoint(segment[5], segment[6]);
      converted.push(['C', p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]);
      return;
    }

    if (cmd === 'Z') {
      converted.push(['Z']);
    }
  });

  return converted.length > 0 ? converted : null;
}

function getPathCommandBounds(path) {
  if (!Array.isArray(path) || path.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const command of path) {
    if (!Array.isArray(command)) continue;
    for (let index = 1; index + 1 < command.length; index += 2) {
      const x = Number(command[index]);
      const y = Number(command[index + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return {
    left: minX,
    top: minY,
    right: maxX,
    bottom: maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getAppearancePathBounds(annotation, viewport, scale = 1) {
  const appearance = annotation?._appearance;
  const path = convertAppearancePathToFabricPath(
    appearance?.path,
    viewport,
    scale,
    appearance?.matrix,
    appearance?.bbox,
    annotation?.rect,
    appearance?.isFormXObject === true,
  );
  return getPathCommandBounds(path);
}

function getAppearanceStrokeWidth(annotation, viewport, scale = 1) {
  const appearance = annotation?._appearance;
  if (!Number.isFinite(appearance?.strokeWidth) || appearance.strokeWidth < 0) return null;
  const appearanceToPdf = appearance?.isFormXObject === true
    ? createAppearanceToPdfMatrix(annotation?.rect, appearance?.bbox, appearance?.matrix)
    : (isFinitePdfMatrix(appearance?.matrix)
        ? Array.from(appearance.matrix, Number)
        : Array.from(PDF_IDENTITY_MATRIX));
  const strokeCtm = isFinitePdfMatrix(appearance?.strokeMatrix)
    ? Array.from(appearance.strokeMatrix, Number)
    : Array.from(PDF_IDENTITY_MATRIX);
  return appearance.strokeWidth
    * pdfMatrixAreaScale(composePdfMatrices(appearanceToPdf, strokeCtm))
    * viewportAreaScale(viewport, scale);
}

/**
 * Convert PDF Ink annotation to Fabric.js Path data
 * PDF coordinates have origin at bottom-left, Fabric.js at top-left
 */
function convertPdfPointToViewport(x, y, viewport, scale = 1) {
  if (viewport && typeof viewport.convertToViewportPoint === 'function') {
    const [viewportX, viewportY] = viewport.convertToViewportPoint(x, y);
    return { x: viewportX * scale, y: viewportY * scale };
  }

  const pageHeight = Number.isFinite(viewport?.height) ? viewport.height : 0;
  return { x: x * scale, y: (pageHeight - y) * scale };
}

function convertPdfRectToViewportRect(rect, viewport, scale = 1) {
  if (!rect || rect.length < 4) {
    return null;
  }

  // pdf.js 6 exposes point conversion but no rectangle helper. Convert both
  // corners through the viewport so page rotation and non-zero CropBox origins
  // use the same transform as the rendered PDF page.
  const first = convertPdfPointToViewport(rect[0], rect[1], viewport, 1);
  const second = convertPdfPointToViewport(rect[2], rect[3], viewport, 1);
  const x1 = first.x;
  const y1 = first.y;
  const x2 = second.x;
  const y2 = second.y;

  const left = Math.min(x1, x2) * scale;
  const right = Math.max(x1, x2) * scale;
  const top = Math.min(y1, y2) * scale;
  const bottom = Math.max(y1, y2) * scale;

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function convertStampToImageProxy(annotation, viewport, scale, appearanceDataUrl) {
  if (!annotation?.hasAppearance || typeof appearanceDataUrl !== 'string') return null;
  const rect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const opacity = Number(annotation.CA ?? annotation.opacity ?? 1);
  const explicitRotation = Number(annotation.rotation);
  const hasExplicitRotation = Number.isFinite(explicitRotation) && explicitRotation !== 0;
  return {
    type: 'image',
    src: appearanceDataUrl,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    scaleX: 1,
    scaleY: 1,
    angle: getPdfStampRotation(annotation),
    opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1,
    selectable: true,
    evented: true,
    hasControls: false,
    hasBorders: true,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Stamp',
    layer: 'pdf-annotations',
    data: {
      // pdf.js applies the appearance stream's /Matrix while it paints the
      // PNG, but it does not apply the annotation dictionary's /Rotate.
      pdfStampAppearanceRotationBaked: !hasExplicitRotation,
    },
  };
}

const FILLED_PDF_INK_MODE = 'filled-outline';
const PDF_INK_SOURCE_GEOMETRY_VERSION = 1;

function clonePdfAppearancePath(path) {
  if (!Array.isArray(path)) return null;
  const cloned = path
    .filter((segment) => Array.isArray(segment) && segment.length > 0)
    .map((segment) => Array.from(segment));
  return cloned.length > 0 ? cloned : null;
}

function normalizePdfInkListsForSource(inkLists) {
  if (!Array.isArray(inkLists)) return [];
  const normalized = [];

  for (const inkList of inkLists) {
    if (!Array.isArray(inkList) && !ArrayBuffer.isView(inkList)) continue;
    const points = [];
    if (Array.isArray(inkList[0])) {
      for (const point of inkList) {
        const x = Number(point?.[0]);
        const y = Number(point?.[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
      }
    } else if (inkList[0] && typeof inkList[0] === 'object') {
      for (const point of inkList) {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
      }
    } else {
      for (let index = 0; index + 1 < inkList.length; index += 2) {
        const x = Number(inkList[index]);
        const y = Number(inkList[index + 1]);
        if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
      }
    }
    if (points.length > 0) normalized.push(points);
  }

  return normalized;
}

function translatePathCommands(commands, dx, dy) {
  return (commands || []).map((command) => {
    if (!Array.isArray(command) || command.length === 0) return command;
    if (command[0] === 'Z') return ['Z'];
    const translated = [command[0]];
    for (let index = 1; index < command.length; index += 2) {
      translated.push(command[index] + dx, command[index + 1] + dy);
    }
    return translated;
  });
}

const PDF_APPEARANCE_COMPANION_LAYERS = Symbol('pdfAppearanceCompanionLayers');

function polygonSetArea(polygons) {
  const ringArea = (ring) => {
    let area = 0;
    for (
      let index = 0, previous = ring.length - 1;
      index < ring.length;
      previous = index, index += 1
    ) {
      area += (
        Number(ring[previous]?.[0]) * Number(ring[index]?.[1])
        - Number(ring[index]?.[0]) * Number(ring[previous]?.[1])
      );
    }
    return Math.abs(area / 2);
  };
  return normalizeMultiPolygon(polygons).reduce((total, polygon) => (
    total
    + ringArea(polygon[0] || [])
    - polygon.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0)
  ), 0);
}

function polygonSetBounds(polygons) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of normalizeMultiPolygon(polygons)) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return Number.isFinite(minX)
    ? { minX, minY, maxX, maxY }
    : null;
}

function simpleStrokeHasNegligibleImplicitClip(operation) {
  if (
    operation?.clipActive !== true
    || operation?.hasExplicitClip === true
    || operation?.stroke !== true
    || operation?.fill === true
    || !(Number(operation?.strokeWidth) > 0)
  ) {
    return false;
  }
  const clip = normalizeMultiPolygon(operation.clipPolygons);
  if (clip.length !== 1 || clip[0].length !== 1) return false;
  const clipBounds = polygonSetBounds(clip);
  const ring = clip[0][0];
  if (
    !clipBounds
    || ring.length < 4
    || ring.some(([x, y]) => (
      (x !== clipBounds.minX && x !== clipBounds.maxX)
      || (y !== clipBounds.minY && y !== clipBounds.maxY)
    ))
  ) {
    return false;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const command of operation.path || []) {
    for (let index = 1; index + 1 < command.length; index += 2) {
      const x = Number(command[index]);
      const y = Number(command[index + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return false;
  const strokeMatrix = isFinitePdfMatrix(operation.strokeMatrix)
    ? Array.from(operation.strokeMatrix, Number)
    : Array.from(PDF_IDENTITY_MATRIX);
  const joinScale = operation.lineJoin === 'miter'
    ? Math.max(1, Number(operation.miterLimit) || 10)
    : 1;
  const extension = (
    Number(operation.strokeWidth) / 2
    * pdfMatrixMaxSingularScale(strokeMatrix)
    * joinScale
  );
  const overrun = Math.max(
    0,
    clipBounds.minX - (minX - extension),
    clipBounds.minY - (minY - extension),
    (maxX + extension) - clipBounds.maxX,
    (maxY + extension) - clipBounds.maxY,
  );
  // PDF writers round the path and Form BBox separately. A sub-0.1-point
  // mismatch is not a useful visual clip, but polygonizing it can be costly.
  return overrun <= 0.1;
}

function transformAppearancePolygonSetToViewport(
  polygons,
  appearanceToPdf,
  viewport,
  scale,
) {
  return normalizeMultiPolygon(polygons).map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => {
      const pdfPoint = applyPdfMatrixToPoint(appearanceToPdf, x, y);
      const point = convertPdfPointToViewport(pdfPoint.x, pdfPoint.y, viewport, scale);
      return [point.x, point.y];
    })
  )));
}

function createPdfToViewportMatrix(viewport, scale) {
  const origin = convertPdfPointToViewport(0, 0, viewport, scale);
  const xUnit = convertPdfPointToViewport(1, 0, viewport, scale);
  const yUnit = convertPdfPointToViewport(0, 1, viewport, scale);
  return [
    xUnit.x - origin.x,
    xUnit.y - origin.y,
    yUnit.x - origin.x,
    yUnit.y - origin.y,
    origin.x,
    origin.y,
  ];
}

function isSimilarityMatrix(matrix) {
  if (!isFinitePdfMatrix(matrix)) return false;
  const [a, b, c, d] = Array.from(matrix, Number);
  const firstLength = Math.hypot(a, b);
  const secondLength = Math.hypot(c, d);
  const scale = Math.max(firstLength, secondLength);
  return (
    firstLength > 0
    && secondLength > 0
    && Math.abs(firstLength - secondLength) <= scale * Number.EPSILON * 64
    && Math.abs(a * c + b * d)
      <= firstLength * secondLength * Number.EPSILON * 64
  );
}

function stableAppearanceSourceKey(annotation, appearance) {
  const explicit = String(annotation?.id || annotation?.name || '').trim();
  if (explicit) return explicit;
  const source = JSON.stringify({
    rect: toNumericArray(annotation?.rect),
    path: appearance?.sourcePath || appearance?.path || null,
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `anonymous-${(hash >>> 0).toString(36)}`;
}

function cloneInkSourceGeometry(sourceGeometry) {
  try {
    return structuredClone(sourceGeometry);
  } catch {
    return JSON.parse(JSON.stringify(sourceGeometry));
  }
}

function createFilledAppearanceLayer({
  annotation,
  appearance,
  sourceGeometry,
  kind,
  paintOperationIndex,
  layerIndex,
  paint,
  opacity,
  blendMode = null,
  worldPolygons,
  exactWorldPath = null,
  sourceWidth = 0,
  fillRule = 'evenodd',
}) {
  const bounds = polygonSetBounds(worldPolygons);
  if (!bounds) return null;
  const sourceKey = stableAppearanceSourceKey(annotation, appearance);
  const compositeId = `pdf-appearance:${sourceKey}`;
  const layerId = `${compositeId}:layer:${layerIndex}`;
  const localPolygons = translatePolygonSet(
    worldPolygons,
    -bounds.minX,
    -bounds.minY,
  );
  const localPath = exactWorldPath
    ? translatePathCommands(exactWorldPath, -bounds.minX, -bounds.minY)
    : polygonSetToCommands(localPolygons);
  const fill = hexToRgba(pdfColorToHex(paint, annotation), opacity);
  return {
    type: 'path',
    id: layerId,
    path: localPath,
    polygons: localPolygons,
    left: bounds.minX,
    top: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    fill,
    ...(blendMode === 'Multiply' ? { globalCompositeOperation: 'multiply' } : {}),
    stroke: 'transparent',
    strokeWidth: 0,
    fillRule: fillRule === 'nonzero' ? 'nonzero' : 'evenodd',
    paperInkGeometry: 'v1',
    sourceWidth: Math.max(0, Number(sourceWidth) || 0),
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    lockMovementX: false,
    lockMovementY: false,
    perPixelTargetFind: true,
    targetFindTolerance: 5,
    isPdfImported: true,
    pdfAnnotationId: annotation?.id,
    pdfAnnotationType: 'Ink',
    pdfInkRenderMode: FILLED_PDF_INK_MODE,
    inkGeometrySpace: 'local',
    data: {
      id: layerId,
      groupId: compositeId,
      inkGeometrySpace: 'local',
      pdfInkRenderMode: FILLED_PDF_INK_MODE,
      pdfInkSourceGeometry: cloneInkSourceGeometry(sourceGeometry),
      pdfAppearanceCompositeId: compositeId,
      pdfAppearanceSourceAnnotationId: annotation?.id || annotation?.name || null,
      pdfAppearanceLayerIndex: layerIndex,
      pdfAppearancePaintOperationIndex: paintOperationIndex,
      pdfAppearanceLayerKind: kind,
    },
    layer: 'pdf-annotations',
  };
}

function mergeCompatibleAppearanceLayers(layers) {
  if (!Array.isArray(layers) || layers.length < 2) return null;
  const signature = (layer) => JSON.stringify({
    fill: layer?.fill,
    stroke: layer?.stroke,
    strokeWidth: layer?.strokeWidth,
    fillRule: layer?.fillRule,
    globalCompositeOperation: layer?.globalCompositeOperation || null,
  });
  const expected = signature(layers[0]);
  if (!layers.every((layer) => signature(layer) === expected)) return null;

  const worldPath = [];
  const worldPolygons = [];
  for (const layer of layers) {
    worldPath.push(...translatePathCommands(layer.path, layer.left, layer.top));
    worldPolygons.push(...translatePolygonSet(layer.polygons, layer.left, layer.top));
  }
  const bounds = polygonSetBounds(worldPolygons);
  if (!bounds) return null;
  const first = layers[0];
  return {
    ...first,
    path: translatePathCommands(worldPath, -bounds.minX, -bounds.minY),
    polygons: translatePolygonSet(worldPolygons, -bounds.minX, -bounds.minY),
    left: bounds.minX,
    top: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    data: {
      ...(first.data || {}),
      pdfAppearanceLayerKind: 'composite',
      pdfAppearancePaintOperationIndexes: layers.map(
        (layer) => layer?.data?.pdfAppearancePaintOperationIndex,
      ),
    },
  };
}

function buildAppearancePaintLayers(
  annotation,
  appearance,
  viewport,
  scale,
  sourceGeometry,
) {
  const operations = Array.isArray(appearance?.paintOperations)
    ? appearance.paintOperations
    : [];
  if (operations.length === 0) return null;
  const appearanceToPdf = appearance?.isFormXObject === true
    ? createAppearanceToPdfMatrix(
        annotation?.rect,
        appearance?.bbox,
        appearance?.matrix,
      )
    : (
        isFinitePdfMatrix(appearance?.matrix)
          ? Array.from(appearance.matrix, Number)
          : Array.from(PDF_IDENTITY_MATRIX)
      );
  const pdfToViewport = createPdfToViewportMatrix(viewport, scale);
  const appearanceToViewport = composePdfMatrices(
    pdfToViewport,
    appearanceToPdf,
  );
  const soleOperation = operations.length === 1 ? operations[0] : null;
  if (
    soleOperation
    && (
      soleOperation.clipActive !== true
      || simpleStrokeHasNegligibleImplicitClip(soleOperation)
    )
  ) {
    const hasFill = soleOperation.fill === true;
    const hasStroke = soleOperation.stroke === true && Number(soleOperation.strokeWidth) > 0;
    if (hasFill !== hasStroke) {
      if (hasFill) return null;
      const strokeMatrix = isFinitePdfMatrix(soleOperation.strokeMatrix)
        ? Array.from(soleOperation.strokeMatrix, Number)
        : Array.from(PDF_IDENTITY_MATRIX);
      const effectiveStrokeMatrix = composePdfMatrices(
        appearanceToViewport,
        strokeMatrix,
      );
      if (
        isSimilarityMatrix(effectiveStrokeMatrix)
        && (!Array.isArray(soleOperation.dashArray) || soleOperation.dashArray.length === 0)
      ) {
        // The live Fabric path can represent this paint exactly. Avoid a
        // polygon union that would be discarded at the end of this function.
        return null;
      }
    }
  }
  const layers = [];
  let requiresMaterialization = operations.length > 1;

  const clippedGeometry = (geometry, operation) => {
    if (operation?.clipActive !== true) {
      return { geometry, changed: false };
    }
    const clipped = operation.clipPolygons?.length
      ? intersectPolygonSets(geometry, operation.clipPolygons)
      : [];
    const originalArea = polygonSetArea(geometry);
    const clippedArea = polygonSetArea(clipped);
    const tolerance = Math.max(
      Number.MIN_VALUE,
      Math.max(originalArea, clippedArea) * Number.EPSILON * 64,
    );
    return {
      geometry: clipped,
      changed: Math.abs(originalArea - clippedArea) > tolerance,
    };
  };

  operations.forEach((operation, paintOperationIndex) => {
    if (operation?.fill) {
      const rawFill = filledOutlineCommandsToPolygonSet(operation.path, {
        curveTolerance: curveToleranceForMatrix(appearanceToViewport),
        fillRule: operation.fillRule || 'nonzero',
      });
      const clipped = clippedGeometry(rawFill, operation);
      if (clipped.changed) requiresMaterialization = true;
      if (clipped.geometry.length > 0) {
        const worldPolygons = transformAppearancePolygonSetToViewport(
          clipped.geometry,
          appearanceToPdf,
          viewport,
          scale,
        );
        const exactWorldPath = clipped.changed
          ? null
          : convertAppearancePathToFabricPath(
              operation.path,
              viewport,
              scale,
              appearance?.matrix,
              appearance?.bbox,
              annotation?.rect,
              appearance?.isFormXObject === true,
            );
        const layer = createFilledAppearanceLayer({
          annotation,
          appearance,
          sourceGeometry,
          kind: 'fill',
          paintOperationIndex,
          layerIndex: layers.length,
          paint: operation.fillColor || annotation?.color,
          opacity: operation.fillAlphaExplicit === true
            ? (normalizeOpacityValue(operation.fillAlpha) ?? 1)
            : extractAnnotationOpacity(annotation, 1),
          blendMode: operation.blendMode,
          worldPolygons,
          exactWorldPath,
          fillRule: operation.fillRule || 'nonzero',
        });
        if (layer) layers.push(layer);
      }
    }

    if (operation?.stroke && Number(operation.strokeWidth) > 0) {
      const strokeMatrix = isFinitePdfMatrix(operation.strokeMatrix)
        ? Array.from(operation.strokeMatrix, Number)
        : Array.from(PDF_IDENTITY_MATRIX);
      const inverseStrokeMatrix = invertPdfMatrix(strokeMatrix);
      const userPath = inverseStrokeMatrix
        ? transformPathCommands(operation.path, inverseStrokeMatrix)
        : operation.path;
      const effectiveStrokeMatrix = composePdfMatrices(
        appearanceToViewport,
        strokeMatrix,
      );
      const userOutline = styledStrokeCommandsToPolygonSet(userPath, {
        strokeWidth: operation.strokeWidth,
        curveTolerance: curveToleranceForMatrix(effectiveStrokeMatrix),
        lineCap: operation.lineCap || 'butt',
        lineJoin: operation.lineJoin || 'miter',
        miterLimit: Math.max(1, Number(operation.miterLimit) || 10),
        dashArray: operation.dashArray,
        dashOffset: operation.dashPhase,
      });
      const rootOutline = inverseStrokeMatrix
        ? transformPolygonSet(userOutline, strokeMatrix)
        : userOutline;
      const clipped = clippedGeometry(rootOutline, operation);
      if (
        clipped.changed
        || !isSimilarityMatrix(effectiveStrokeMatrix)
        || (Array.isArray(operation.dashArray) && operation.dashArray.length > 0)
      ) {
        requiresMaterialization = true;
      }
      if (clipped.geometry.length > 0) {
        const worldPolygons = transformAppearancePolygonSetToViewport(
          clipped.geometry,
          appearanceToPdf,
          viewport,
          scale,
        );
        const layer = createFilledAppearanceLayer({
          annotation,
          appearance,
          sourceGeometry,
          kind: 'stroke',
          paintOperationIndex,
          layerIndex: layers.length,
          paint: operation.strokeColor || annotation?.color,
          opacity: operation.strokeAlphaExplicit === true
            ? (normalizeOpacityValue(operation.strokeAlpha) ?? 1)
            : extractAnnotationOpacity(annotation, 1),
          blendMode: operation.blendMode,
          worldPolygons,
          sourceWidth: (
            operation.strokeWidth
            * pdfMatrixAreaScale(composePdfMatrices(appearanceToPdf, strokeMatrix))
            * viewportAreaScale(viewport, scale)
          ),
          fillRule: 'evenodd',
        });
        if (layer) layers.push(layer);
      }
    }
  });

  if (layers.length > 1) requiresMaterialization = true;
  const mergedLayer = mergeCompatibleAppearanceLayers(layers);
  if (mergedLayer) return [mergedLayer];
  // An empty array is authoritative: the appearance contained supported paint
  // operations, but clipping removed every painted point. Keep that distinct
  // from null ("use the exact live-path representation") so a fully clipped
  // native annotation cannot reappear from its InkList fallback.
  return requiresMaterialization ? layers : null;
}

function getInkPathEndpoint(seg) {
  if (!Array.isArray(seg) || seg.length === 0) return null;
  if (seg[0] === 'M' || seg[0] === 'L') return { x: seg[1], y: seg[2] };
  if (seg[0] === 'Q') return { x: seg[3], y: seg[4] };
  if (seg[0] === 'C') return { x: seg[5], y: seg[6] };
  return null;
}

function distanceBetweenPoints(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pathSubpathsAreClosed(pathData, width, height) {
  if (!Array.isArray(pathData) || pathData.length === 0 || width <= 0 || height <= 0) {
    return false;
  }

  const closeThreshold = Math.max(0.75, Math.min(width, height) * 0.25);
  let start = null;
  let current = null;
  let hasDrawableSubpath = false;
  let currentClosed = false;

  const closeCurrent = () => {
    if (!start || !current || !hasDrawableSubpath) return true;
    return currentClosed || distanceBetweenPoints(start, current) <= closeThreshold;
  };

  for (const seg of pathData) {
    if (!Array.isArray(seg) || seg.length === 0) continue;

    if (seg[0] === 'M') {
      if (start && !closeCurrent()) return false;
      start = getInkPathEndpoint(seg);
      current = start;
      hasDrawableSubpath = false;
      currentClosed = false;
      continue;
    }

    if (seg[0] === 'Z') {
      currentClosed = true;
      current = start;
      continue;
    }

    const endpoint = getInkPathEndpoint(seg);
    if (endpoint) {
      current = endpoint;
      hasDrawableSubpath = true;
    }
  }

  return Boolean(start && hasDrawableSubpath && closeCurrent());
}

export function convertInkToFabricPath(annotation, viewport, scale = 1) {
  const appearance = annotation?._appearance || null;
  // Drawboard/Adobe use two Ink encodings in the wild: open /InkList
  // centerlines for normal strokes, and filled zero-width appearance
  // outlines for pressure strokes / colored marker dots. Use the /AP
  // geometry only for that filled-outline case; otherwise keep /InkList
  // so regular strokes remain editable centerlines.
  const hasInkList = Array.isArray(annotation.inkLists) && annotation.inkLists.length > 0;
  const borderWidth = getBorderWidth(annotation, 0);
  const appearancePathData = convertAppearancePathToFabricPath(
    appearance?.path,
    viewport,
    scale,
    appearance?.matrix,
    appearance?.bbox,
    annotation?.rect,
    appearance?.isFormXObject === true,
  );
  const useFilledAppearancePath =
    Array.isArray(appearancePathData) &&
    appearancePathData.length > 0 &&
    appearance?.hasFill === true;
  const inkStrokeCount = hasInkList
    ? annotation.inkLists.filter((list) => list && list.length > 0).length
    : 0;
  const appearanceSubpathCount = Array.isArray(appearancePathData)
    ? appearancePathData.filter((command) => command?.[0] === 'M').length
    : 0;
  const useStrokedAppearancePath =
    !useFilledAppearancePath &&
    Array.isArray(appearancePathData) &&
    appearancePathData.length > 0 &&
    appearance?.hasStroke === true &&
    (inkStrokeCount <= 1 || appearanceSubpathCount >= inkStrokeCount);
  const appearanceFillRule = appearance?.fillRule
    || (appearance?.isFormXObject === true ? 'nonzero' : 'evenodd');
  const isPdfStrokeHairline = (
    useStrokedAppearancePath
    && appearance?.hasStroke === true
    && Number(appearance?.strokeWidth) === 0
  );
  const sourceGeometry = {
    version: PDF_INK_SOURCE_GEOMETRY_VERSION,
    kind: useFilledAppearancePath || useStrokedAppearancePath || !hasInkList
      ? 'appearance-path'
      : 'ink-list',
    coordinateSpace: 'pdf',
    inkLists: normalizePdfInkListsForSource(annotation?.inkLists),
    appearancePath: clonePdfAppearancePath(appearance?.sourcePath || appearance?.path),
    appearanceContentMatrices: Array.isArray(appearance?.contentMatrices)
      ? appearance.contentMatrices.map((matrix) => Array.from(matrix))
      : [],
    appearancePaintOperations: Array.isArray(appearance?.paintOperations)
      ? appearance.paintOperations.map((operation) => ({
          sourcePath: clonePdfAppearancePath(operation?.sourcePath || operation?.path),
          path: clonePdfAppearancePath(operation?.path),
          stroke: operation?.stroke === true,
          fill: operation?.fill === true,
          fillRule: operation?.fillRule || null,
          strokeColor: toNumericArray(operation?.strokeColor),
          fillColor: toNumericArray(operation?.fillColor),
          strokeWidth: Number.isFinite(operation?.strokeWidth)
            ? operation.strokeWidth
            : null,
          lineCap: operation?.lineCap || null,
          lineJoin: operation?.lineJoin || null,
          miterLimit: Number.isFinite(operation?.miterLimit)
            ? operation.miterLimit
            : null,
          dashArray: Array.isArray(operation?.dashArray)
            ? Array.from(operation.dashArray, Number)
            : [],
          dashPhase: Number(operation?.dashPhase) || 0,
          strokeAlpha: Number.isFinite(operation?.strokeAlpha)
            ? operation.strokeAlpha
            : 1,
          fillAlpha: Number.isFinite(operation?.fillAlpha)
            ? operation.fillAlpha
            : 1,
          strokeAlphaExplicit: operation?.strokeAlphaExplicit === true,
          fillAlphaExplicit: operation?.fillAlphaExplicit === true,
          blendMode: operation?.blendMode || null,
          strokeMatrix: isFinitePdfMatrix(operation?.strokeMatrix)
            ? Array.from(operation.strokeMatrix, Number)
            : null,
          clipActive: operation?.clipActive === true,
          hasExplicitClip: operation?.hasExplicitClip === true,
          clipPolygons: clonePolygonSet(operation?.clipPolygons),
        }))
      : [],
    appearanceStrokeMatrix: isFinitePdfMatrix(appearance?.strokeMatrix)
      ? Array.from(appearance.strokeMatrix, Number)
      : null,
    appearanceMatrix: Array.isArray(appearance?.matrix) ? Array.from(appearance.matrix) : null,
    appearanceBBox: Array.isArray(appearance?.bbox) ? Array.from(appearance.bbox) : null,
    appearanceHasFill: appearance?.hasFill === true,
    appearanceHasStroke: appearance?.hasStroke === true,
    appearanceFillRule: appearance?.fillRule || null,
    borderWidth,
    appearanceStrokeWidth:
      Number.isFinite(appearance?.strokeWidth) ? appearance.strokeWidth : null,
  };
  let pathData = null;

  if (useFilledAppearancePath || useStrokedAppearancePath) {
    pathData = appearancePathData;
  } else if (hasInkList) {
    pathData = [];
    annotation.inkLists.forEach((inkList) => {
      // KAL-405: a single-point sub-stroke is a pen TAP, not junk. Keep it —
      // the degenerate-dot pass below turns it into a visible filled dot.
      // (Previously `length < 2` dropped [[x, y]] / [{x, y}] taps outright.)
      if (!inkList || inkList.length < 1) return;

      // inkList is an array of {x, y} points or flat [x1, y1, x2, y2...] array
      const points = [];

      if (Array.isArray(inkList[0])) {
        // Point pair array format [[x1, y1], [x2, y2], ...]
        inkList.forEach((point) => {
          if (!Array.isArray(point) || point.length < 2) return;
          points.push(convertPdfPointToViewport(point[0], point[1], viewport, scale));
        });
      } else if (typeof inkList[0] === 'object') {
        // Object format [{x, y}, ...]
        inkList.forEach((pt) => {
          if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') return;
          points.push(convertPdfPointToViewport(pt.x, pt.y, viewport, scale));
        });
      } else {
        // Flat number array
        for (let i = 0; i < inkList.length; i += 2) {
          if (typeof inkList[i] !== 'number' || typeof inkList[i + 1] !== 'number') continue;
          points.push(convertPdfPointToViewport(inkList[i], inkList[i + 1], viewport, scale));
        }
      }

      if (points.length === 0) {
        return;
      }

      // Preserve the authored InkList exactly. Visual smoothing must not
      // replace the annotation's editable geometry; a stroked /AP is chosen
      // above when the PDF provides an authoritative curved appearance.
      pathData.push(['M', points[0].x, points[0].y]);
      for (let index = 1; index < points.length; index += 1) {
        pathData.push(['L', points[index].x, points[index].y]);
      }
    });
  }

  if (!pathData || pathData.length === 0) {
    // Fall back to the /AP appearance path only when we truly have no raw
    // pen points — e.g. an Ink annotation that shipped without /InkList.
    pathData = appearancePathData;
  }

  if (!pathData || pathData.length === 0) {
    return null;
  }

  // UX 2026-04-21 (import-normalization bbox-drift fix): normalize the
  // just-assembled `pathData` from world/viewport coords to LOCAL coords
  // starting at (0, 0), and carry the world placement on left/top instead.
  //
  // Root cause: previously we returned path commands in absolute viewport
  // coords with no `left`/`top`. Fabric's resize handler then set `left`
  // to roughly pathMinX to keep the visual centered under the anchor,
  // which meant svgBoundingBox.getPathBBox Case 2 (absolute-coord path)
  // computed `offsetX + minX * scaleX` — double-counting the world
  // translation once in `left` and again in `minX`. Result: the selection
  // overlay drifted far from the visible stroke on resize. See the
  // 2026-04-21 diagnostic session (1.log) for the confirmed numbers:
  // left=423.35, minX=423.35, scaleX≈1.007 → bbox.left=849.80 WRONG.
  //
  // Matching how FabricDrawingCanvas stores internally-drawn pen strokes
  // (path:created handler zeroes left/top and Fabric normalizes path data
  // to start at 0,0 with pathOffset) lets Case 2 become `offsetX + 0 * sx
  // = offsetX` — the bbox tracks the visible geometry through resize.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const cmd of pathData) {
    for (let j = 1; j + 1 < cmd.length; j += 2) {
      const x = cmd[j];
      const y = cmd[j + 1];
      if (typeof x === 'number' && typeof y === 'number') {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (Number.isFinite(minX) && Number.isFinite(minY)) {
    for (const cmd of pathData) {
      for (let j = 1; j + 1 < cmd.length; j += 2) {
        if (typeof cmd[j] === 'number') cmd[j] -= minX;
        if (typeof cmd[j + 1] === 'number') cmd[j + 1] -= minY;
      }
    }
  }
  // `let` (not `const`) only so the KAL-405 single-tap dot pass below can
  // re-place the object once it substitutes circle geometry for a tap.
  let importedLeft = Number.isFinite(minX) ? minX : 0;
  let importedTop = Number.isFinite(minY) ? minY : 0;
  let importedWidth = Number.isFinite(maxX) && Number.isFinite(minX) ? maxX - minX : 0;
  let importedHeight = Number.isFinite(maxY) && Number.isFinite(minY) ? maxY - minY : 0;

  // An authoritative AP carries the paint that PDF viewers render. /C is
  // only a fallback and is frequently stale after edits in other PDF tools.
  // A mixed fill+stroke Ink AP converges to the filled-outline representation,
  // so its fill paint is the safe single-paint choice for Fabric.
  const appearancePaint = useFilledAppearancePath
    ? (appearance?.fillColor || annotation.color)
    : useStrokedAppearancePath
      ? (appearance?.strokeColor || annotation.color)
      : annotation.color;
  const strokeColorHex = pdfColorToHex(appearancePaint, annotation);
  const primaryPaintOperation = Array.isArray(appearance?.paintOperations)
    ? appearance.paintOperations.find((operation) => (
        useFilledAppearancePath ? operation?.fill : operation?.stroke
      ))
    : null;
  const strokeOpacity = resolveAnnotationPaintOpacity(
    annotation,
    appearance,
    useFilledAppearancePath ? 'fill' : 'stroke',
    1,
  );

  let strokeWidth = 0;
  if (isPdfStrokeHairline) {
    // PDF line width 0 is a device-space hairline, not a missing width and
    // not a request for the app's historical 0.9-unit fallback.
    strokeWidth = 0;
  } else if (
    Array.isArray(appearancePathData)
    && appearancePathData.length > 0
    && appearance?.hasStroke === true
    && Number.isFinite(appearance?.strokeWidth)
    && appearance.strokeWidth > 0
  ) {
    const appearanceToPdf = appearance?.isFormXObject === true
      ? createAppearanceToPdfMatrix(annotation?.rect, appearance?.bbox, appearance?.matrix)
      : (isFinitePdfMatrix(appearance?.matrix)
          ? Array.from(appearance.matrix, Number)
          : Array.from(PDF_IDENTITY_MATRIX));
    const strokeCtm = isFinitePdfMatrix(appearance?.strokeMatrix)
      ? Array.from(appearance.strokeMatrix, Number)
      : Array.from(PDF_IDENTITY_MATRIX);
    const effectiveStrokeMatrix = composePdfMatrices(appearanceToPdf, strokeCtm);
    // A Fabric path has one scalar width. The determinant/geometric-mean
    // scale preserves transformed stroke area and matches the main exporter's
    // strokeScale convention for nonuniform transforms.
    strokeWidth = (
      appearance.strokeWidth
      * pdfMatrixAreaScale(effectiveStrokeMatrix)
      * viewportAreaScale(viewport, scale)
    );
  } else if (borderWidth > 0) {
    // /BS/W is geometry truth. Visibility aids belong to hit targets, not
    // persisted rendering/export geometry.
    strokeWidth = borderWidth * scale;
  } else if (Number.isFinite(appearance?.strokeWidth) && appearance.strokeWidth > 0) {
    strokeWidth = appearance.strokeWidth * scale;
  } else {
    // Zero-width strokes with no fill fallback need a visible width for editability.
    strokeWidth = 0.9 * scale;
  }

  // KAL-405 — single-tap ink dots.
  // See the helper block above convertInkToFabricPath for the full rationale
  // and the threshold justification. In short: geometry with no travel paints
  // nothing, so an imported pen tap disappeared. We substitute the circle a
  // real pen leaves behind — diameter = the pen width, centred on the tap.
  // Colour and opacity are untouched (they come from the source annotation
  // via inkPaint below); no backdrop-dependent transform is applied.
  const inkDotDiameter = strokeWidth > 0
    ? strokeWidth
    // A hairline (/BS width 0) or fill-only ink still has to leave a mark;
    // one PDF unit is the device-hairline equivalent at 100% zoom.
    : Math.max(borderWidth * scale, scale);
  const inkTapCenters = inkDotDiameter > 0
    ? degenerateInkTapCenters(pathData, inkDotCollapseThreshold(inkDotDiameter))
    : null;
  const isImportedInkDot = Array.isArray(inkTapCenters) && inkTapCenters.length > 0;
  if (isImportedInkDot) {
    const radius = inkDotDiameter / 2;
    // `pathData` is already local (min at 0,0) with the world placement on
    // importedLeft/importedTop, so build the dots in that same local frame
    // and then re-normalize — the "path bounds == object bounds" contract
    // established by the 2026-04-21 bbox-drift fix must keep holding.
    const dotCommands = [];
    for (const center of inkTapCenters) {
      dotCommands.push(...buildInkDotPathCommands(center.x, center.y, radius));
    }
    const dotMinX = Math.min(...inkTapCenters.map((c) => c.x)) - radius;
    const dotMinY = Math.min(...inkTapCenters.map((c) => c.y)) - radius;
    const dotMaxX = Math.max(...inkTapCenters.map((c) => c.x)) + radius;
    const dotMaxY = Math.max(...inkTapCenters.map((c) => c.y)) + radius;
    pathData = translatePathCommands(dotCommands, -dotMinX, -dotMinY);
    importedLeft += dotMinX;
    importedTop += dotMinY;
    importedWidth = dotMaxX - dotMinX;
    importedHeight = dotMaxY - dotMinY;
  }

  // Filled-outline classification. Two real-world encodings land here:
  // 1. Zero-width /BS + closed outlines (Drawboard pressure ink, marker
  //    dots) — the strict pre-2026-07-17 check.
  // 2. THIN-stroked closed outlines (/BS width ~1 on pressure-ink outline
  //    geometry — same Drawboard export, different width convention). The
  //    renderer catches these via the same closed-subpath predicate. The
  //    predicate runs here so classification is made once without changing
  //    the source width or authored commands.
  const fillsClosedOutline =
    // KAL-405: a substituted tap dot IS a filled outline — the circle is the
    // mark, so it must be filled, never stroked (stroking a width-w circle
    // with a width-w pen would render a blob of twice the intended diameter).
    isImportedInkDot ||
    useFilledAppearancePath ||
    (
      !useStrokedAppearancePath
      && (
        (
          borderWidth <= 0
          && pathSubpathsAreClosed(pathData, importedWidth, importedHeight)
        )
        || (
          strokeWidth <= 1.1 * scale
          && hasSubstantiveClosedSubpath(pathData)
        )
      )
    );
  const inkPaint = hexToRgba(strokeColorHex, strokeOpacity);

  // Imported FILLED ink converges onto the native paper-ink representation at
  // import time: the exact authored live path plus polygons derived only for
  // clipping/hit-testing.
  // No centerline exists for these outlines, so paperCenterline is absent and
  // the export fallback stays outline-based (createFilledPaperInkAnnotation
  // already handles that: /AP filled polygons + polygon-ring /InkList).
  // Legacy and metadata-stripped rows also render their authored path directly.
  let nativeFilledOutline = null;
  if (fillsClosedOutline) {
    try {
      // Both /AP paths and /InkList coordinates are authored geometry. Import
      // must never infer replacement Catmull-Rom/ellipse curves: that changes
      // legacy shapes before the user edits them and makes a first erase bite
      // visibly angular. Derived polygons are clipping-only.
      const outlineCommands = pathData;
      const polygons = filledOutlineCommandsToPolygonSet(outlineCommands, {
        fillRule: useFilledAppearancePath
          ? appearanceFillRule
          : 'nonzero',
      });
      if (polygons.length > 0) {
        // Re-normalize derived clipping polygons to local coords. The native
        // contract is "path bounds == object bounds"
        // with left/top carrying the world placement (same convention as the
        // bbox-drift fix above).
        let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
        for (const polygon of polygons) {
          for (const ring of polygon) {
            for (const [px, py] of ring) {
              if (px < pMinX) pMinX = px;
              if (px > pMaxX) pMaxX = px;
              if (py < pMinY) pMinY = py;
              if (py > pMaxY) pMaxY = py;
            }
          }
        }
        if (Number.isFinite(pMinX) && Number.isFinite(pMinY)) {
          const localPolygons = translatePolygonSet(polygons, -pMinX, -pMinY);
          nativeFilledOutline = {
            polygons: localPolygons,
            // The polygon set is derived clipping geometry. Keep the authored
            // cubic/smoothed curve as the live render path so import does not
            // visibly replace it with the clipping mesh.
            path: translatePathCommands(outlineCommands, -pMinX, -pMinY),
            left: importedLeft + pMinX,
            top: importedTop + pMinY,
            width: pMaxX - pMinX,
            height: pMaxY - pMinY,
          };
        }
      }
    } catch (err) {
      // Import must never fail on geometry conversion — fall back to the
      // legacy filled-outline representation, which still renders correctly.
      console.warn('[PDFImport] filled-ink native convergence failed; keeping legacy outline:', err?.message || err);
    }
  }

  // Ink normally uses /InkList + /BS. Some editors instead author a filled
  // pressure-stroke outline in /AP; that appearance is authoritative when it
  // is valid. Both source forms are retained in pdfInkSourceGeometry.
  //
  // UX 2026-04-21 (import-normalization Chunk 2): the imported Ink Fabric
  // spec must be field-for-field identical to an internally-drawn pen
  // stroke — see src/utils/nativeShapeFactory.js#makeInternalPenPathSpec —
  // for every BEHAVIOR-gating field. Previously imported Ink set
  // strokeUniform:true while internal pen strokes left it undefined, which
  // the SVG renderer translated into vectorEffect="non-scaling-stroke" on
  // imports only. At 200% zoom that mismatch shows as a visible hairline
  // split on imports. We drop strokeUniform here (matching internal
  // behavior: scaled strokes). `isPdfImported` / `pdfAnnotationId` /
  // `pdfAnnotationType` are kept as provenance-only metadata — they must
  // never gate behavior in renderers, editors, or erasers. See
  // docs/superpowers/plans/2026-04-21-import-normalization-and-cloud-properties.md
  // for cross-chunk invariants.
  const result = {
    type: 'path',
    path: pathData,
    // UX 2026-04-21 (bbox-drift fix): left/top/width/height carry the
    // world placement after `pathData` is translated to local coords
    // (see normalization pass above). Without these, Fabric's resize
    // handler would re-derive left from path bounds and the selection
    // overlay would compute offsetX + minX*sx twice over.
    left: importedLeft,
    top: importedTop,
    width: importedWidth,
    height: importedHeight,
    stroke: fillsClosedOutline ? null : inkPaint,
    // KAL-405: a tap dot carries its size in the circle geometry itself, so
    // it must not also carry a pen width — that would double its rendered
    // diameter and make the exporter treat it as a stroked ink path.
    strokeWidth: isImportedInkDot ? 0 : strokeWidth,
    fill: fillsClosedOutline ? inkPaint : null,
    ...(primaryPaintOperation?.blendMode === 'Multiply'
      ? { globalCompositeOperation: 'multiply' }
      : {}),
    strokeLineCap: appearance?.lineCap || (useStrokedAppearancePath ? 'butt' : 'round'),
    strokeLineJoin: appearance?.lineJoin || (useStrokedAppearancePath ? 'miter' : 'round'),
    ...(Number.isFinite(primaryPaintOperation?.miterLimit)
      ? { strokeMiterLimit: primaryPaintOperation.miterLimit }
      : {}),
    ...((Array.isArray(primaryPaintOperation?.dashArray)
      && primaryPaintOperation.dashArray.length > 0)
      ? {
          strokeDashArray: Array.from(primaryPaintOperation.dashArray, Number),
          strokeDashOffset: Number(primaryPaintOperation.dashPhase) || 0,
        }
      : (() => {
          const dashArray = extractAnnotationDashArray(annotation);
          return dashArray ? { strokeDashArray: dashArray.map((value) => value * scale) } : {};
        })()),
    // strokeUniform intentionally omitted — matches internal pen-stroke
    // behavior (undefined). Do NOT reintroduce without removing the
    // matching field from makeInternalPenPathSpec + updating the parity
    // test in tests/pdfAnnotationNormalization.test.mjs.
    // Required Fabric.js properties for proper interaction
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    lockMovementX: false,
    lockMovementY: false,
    perPixelTargetFind: true,
    targetFindTolerance: 5,
    // Mark as imported from PDF — PROVENANCE ONLY. No code path may branch
    // on these. Exporter + debug tools read them; renderers/editors ignore.
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Ink',
    ...(isPdfStrokeHairline ? { pdfStrokeHairline: true } : {}),
    // KAL-405 provenance ONLY ("this arrived as a zero-travel pen tap and we
    // substituted the pen's round cap as a filled circle"). Export + debug
    // tooling read it; renderers/editors/erasers must never branch on it.
    ...(isImportedInkDot ? { pdfInkTapDot: true } : {}),
    inkGeometrySpace: 'local',
    data: {
      inkGeometrySpace: 'local',
      pdfInkSourceGeometry: sourceGeometry,
      ...(isPdfStrokeHairline ? { pdfStrokeHairline: true } : {}),
      ...(isImportedInkDot ? { pdfInkTapDot: true } : {}),
      ...(fillsClosedOutline ? { pdfInkRenderMode: FILLED_PDF_INK_MODE } : {}),
    },
    ...(fillsClosedOutline ? {
      // Provenance only ("this arrived as a filled-outline pressure stroke")
      // — export/debug tooling reads it; renderers must not branch on it for
      // converged objects (they ride the evenodd/polygons native branch).
      pdfInkRenderMode: FILLED_PDF_INK_MODE,
    } : {}),
    // Item-4 convergence: replace the legacy filled-outline fields with the
    // native paper-ink representation (see block above). Keeps provenance.
    ...(nativeFilledOutline ? {
      path: nativeFilledOutline.path,
      polygons: nativeFilledOutline.polygons,
      left: nativeFilledOutline.left,
      top: nativeFilledOutline.top,
      width: nativeFilledOutline.width,
      height: nativeFilledOutline.height,
      fill: inkPaint,
      stroke: 'transparent',
      strokeWidth: 0,
      fillRule: useFilledAppearancePath
        ? appearanceFillRule
        : 'evenodd',
      paperInkGeometry: 'v1',
    } : {}),
    layer: 'pdf-annotations'
  };

  // UX 2026-04-21: diagnostic log gated behind window.__INK_NORM_DIAG = true.
  // Dumps full import-vs-internal field parity at import time so the user
  // can reproduce a bug once, save the console log, and hand it back as a
  // single yes/no artifact. Zero-cost when the flag is off (default).
  if (typeof window !== 'undefined' && window.__INK_NORM_DIAG) {
    try {
      const internal = makeInternalPenPathSpec({
        stroke: result.stroke,
        strokeWidth: result.strokeWidth,
      });
      const behaviorKeys = ['type', 'fill', 'strokeUniform', 'strokeLineCap', 'strokeLineJoin'];
      const drift = behaviorKeys.filter((k) => result[k] !== internal[k]);
      const provenance = {
        isPdfImported: result.isPdfImported,
        pdfAnnotationId: result.pdfAnnotationId,
        pdfAnnotationType: result.pdfAnnotationType,
      };
      console.log(
        '[InkNormDiag import]',
        JSON.stringify(
          {
            pdfAnnotationId: result.pdfAnnotationId,
            drift,
            imported: behaviorKeys.reduce((o, k) => ((o[k] = result[k]), o), {}),
            internal: behaviorKeys.reduce((o, k) => ((o[k] = internal[k]), o), {}),
            provenance,
          },
          null,
          0
        )
      );
    } catch (err) {
      // Diagnostic path — never break import on logging failure.
      console.warn('[InkNormDiag import] log failed:', err);
    }
  }

  const appearanceLayers = annotation?.appAnnotationMetadata
    ? null
    : buildAppearancePaintLayers(
        annotation,
        appearance,
        viewport,
        scale,
        sourceGeometry,
      );
  if (Array.isArray(appearanceLayers)) {
    if (appearanceLayers.length === 0) return null;
    const [primary, ...companions] = appearanceLayers;
    if (companions.length > 0) {
      Object.defineProperty(primary, PDF_APPEARANCE_COMPANION_LAYERS, {
        value: companions,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
    return primary;
  }

  return result;
}

/**
 * Convert PDF Highlight annotation to Fabric.js Rect with fill
 */
function convertHighlightQuadPoints(annotation, viewport, scale = 1) {
  const values = toNumericArray(annotation?.quadPoints);
  if (!values || values.length === 0 || values.length % 8 !== 0) return [];
  const quads = [];
  for (let index = 0; index < values.length; index += 8) {
    const points = [];
    for (let offset = 0; offset < 8; offset += 2) {
      points.push(convertPdfPointToViewport(
        values[index + offset],
        values[index + offset + 1],
        viewport,
        scale,
      ));
    }
    if (points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
      quads.push({
        x1: points[0].x, y1: points[0].y,
        x2: points[1].x, y2: points[1].y,
        x3: points[2].x, y3: points[2].y,
        x4: points[3].x, y4: points[3].y,
      });
    }
  }
  return quads;
}

function convertSurveyMarkerToFabricRect(annotation, viewport, scale = 1, pageNumber = 1) {
  const quads = convertHighlightQuadPoints(annotation, viewport, scale);
  const appearance = annotation?._appearance;
  const appearanceFill = appearance?.hasFill === true ? appearance.fillColor : null;
  // The appearance wins when it names a colour. When it paints without one
  // (e.g. Acrobat's highlight AP paints through a nested form whose colour we
  // cannot see) fall back to /C — never to the PDF default black, which turned
  // the E2E Acrobat highlight into a black bar.
  const color = appearanceFill
    ? pdfColorToHex(appearanceFill)
    : pdfColorToHex(annotation.color || [1, 1, 0], annotation);
  const opacity = resolveAnnotationPaintOpacity(annotation, appearance, 'fill', 0.3);
  if (quads.length > 0) {
    const markup = createTextMarkupAnnotation({
      id: annotation.id || annotation.name || `pdf-highlight-${pageNumber}`,
      selectionGroupId: annotation.id || annotation.name || null,
      pageNumber,
      markupType: 'highlight',
      selectedText: getAnnotationContents(annotation),
      quads,
      color,
      opacity,
      overlapMode: 'layered',
    });
    if (markup) {
      return {
        ...markup,
        isPdfImported: true,
        pdfAnnotationId: annotation.id,
        pdfAnnotationType: 'Highlight',
        globalCompositeOperation: 'multiply',
        layer: 'pdf-annotations',
      };
    }
  }

  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  return {
    type: 'rect',
    left: viewportRect.left,
    top: viewportRect.top,
    width: viewportRect.width,
    height: viewportRect.height,
    fill: color,
    opacity,
    globalCompositeOperation: 'multiply',
    stroke: null,
    strokeWidth: 0,
    // Required Fabric.js properties for proper interaction
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    // Mark as imported from PDF
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Highlight',
    layer: 'pdf-annotations'
  };
}

/**
 * Convert PDF FreeText annotation to Fabric.js Textbox
 */
function convertFreeTextToFabricTextbox(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const text = annotation.contents || '';
  const calloutPoints = convertPdfPointListToViewportPoints(annotation.calloutLine, viewport, scale);
  const intent = normalizePdfNameToken(annotation.intent || '');
  const isCalloutIntent = intent === 'FreeTextCallout' || calloutPoints.length >= 2;

  const appearanceTextBoxRect = isCalloutIntent
    ? extractCalloutTextBoxRectFromAppearance(annotation, viewport, scale)
    : null;
  const targetRect = appearanceTextBoxRect || viewportRect;

  // UX diag (2026-04-18): log the raw PDF values + what we computed for
  // the callout textbox so the user can compare against Acrobat/Drawboard.
  // Only fires for callout-intent imports, once per annotation.
  if (isCalloutIntent) {
    try {
      const rawCL = annotation.calloutLine;
      const rawRect = annotation.rect;
      console.log('[CalloutImportDiag]', {
        id: annotation.id,
        text: (text || '').slice(0, 40),
        pageWidth: viewport?.width,
        pageHeight: viewport?.height,
        viewportScale: scale,
        rawRectPdf: rawRect,
        rawCLPdf: rawCL,
        appearanceTextBoxRectVp: appearanceTextBoxRect,
        viewportRect,
        targetRect,
        calloutPointsVp: calloutPoints,
        rectangleDifferences:
          annotation.rectangleDifferences || annotation._raw?.rectangleDifferences || null,
      });
    } catch (_e) {}
  }
  // UX: Phase 15 UAT-3 (2026-04-18) — TEXT_PADDING hoisted to the top of
  // the function because it's consumed both when building the data.pdf*
  // payload below AND when expanding the final top-level rect. Keep this
  // value in lockstep with svgAnnotationRenderers.TEXT_PADDING.
  const TEXT_PADDING = 6;
  // UX 2026-04-22: Drawboard FreeText convention — /DA carries the BORDER
  // color (the rg-op color, used by Drawboard when painting the box outline
  // because the annotation has no /C entry) while /DS carries the TEXT
  // color. Our merged defaultAppearanceData collapses them (the spread order
  // lets /DA silently overwrite /DS), which made the text box come in with
  // the border color painted as text, and a black border (fallback). Re-
  // parse /DA and /DS separately so color-resolution can tell them apart.
  const parsedDa = parseDefaultAppearanceString(annotation.defaultAppearanceString);
  const parsedDs = parseDefaultStyleString(annotation.defaultStyleString);
  const daFontColor = parsedDa?.fontColor || annotation.defaultAppearanceData?.fontColor;
  const daColorHex = daFontColor ? pdfColorToHex(daFontColor, annotation) : null;
  const dsColorHex = parsedDs?.fontColor ? pdfColorToHex(parsedDs.fontColor, annotation) : null;
  const lineColor = annotation.lineColor;
  const lineColorHex = lineColor ? pdfColorToHex(lineColor, annotation) : null;
  // UX: Phase 15 UAT-3 (2026-04-18) — only fall through to the black
  // default when the PDF actually omitted the top-level C entry. Acrobat
  // FreeTextCallout writes C = border color; losing that to a [0,0,0]
  // default when it exists would swap red borders to black.
  const annotationColorHex = annotation.color
    ? pdfColorToHex(annotation.color, annotation)
    : null;
  const appearance = annotation._appearance;
  const fallbackAppearanceColor = appearance?.hasStroke === true
    ? pdfColorToHex(appearance.strokeColor || annotation.color || [0, 0, 0])
    : null;
  // Text color: prefer /DS when it exists (Drawboard writes a distinct text
  // color there); fall through to /DA for Acrobat-style PDFs where /DS is
  // absent and /DA alone carries the text color.
  const textColor = dsColorHex
    || daColorHex
    || lineColorHex
    || annotationColorHex
    || fallbackAppearanceColor
    || '#000000';
  // Drawboard-style border fallback: when /DS and /DA carry DIFFERENT colors
  // (meaning /DS is the text color and /DA is reserved for the border), use
  // /DA as the border color. When /DS is missing or equal to /DA, /DA is
  // really just the text color and should NOT leak onto the border.
  const drawboardStyleBorder = !!dsColorHex && !!daColorHex && dsColorHex !== daColorHex;
  // UX: Phase 15 UAT-3 (2026-04-18) — prefer the spec-defined PDF color
  // entry (annotation.color = C) over the appearance-stream stroke color
  // for border. Acrobat sometimes writes both, with the appearance stream
  // carrying black (the line-drawing op used inside the AP stream
  // unrelated to the semantic border color). The C entry is authoritative
  // for the visible border — let it win.
  // UX: 2026-04-19 — for FreeTextCallouts Acrobat repurposes the /C
  // (annotation color) entry as the textbox *fill* color, not the border.
  // The painted stroke color from the appearance stream is authoritative
  // for the callout's border/arrow/lines. Prefer it when available, and
  // only fall back to /C when the stream didn't paint any stroke color.
  // For non-callout FreeText, keep the old precedence (C > AP stroke).
  let borderColor;
  if (appearance?.hasStroke === true) {
    borderColor = fallbackAppearanceColor;
  } else if (isCalloutIntent) {
    borderColor = lineColorHex
      || fallbackAppearanceColor
      || annotationColorHex
      || (drawboardStyleBorder ? daColorHex : null)
      || '#000000';
  } else {
    borderColor = lineColorHex
      || annotationColorHex
      || (drawboardStyleBorder ? daColorHex : null)
      || fallbackAppearanceColor
      || '#000000';
  }
  if (isCalloutIntent && isNearWhiteHexColor(borderColor)) {
    if (fallbackAppearanceColor && !isNearWhiteHexColor(fallbackAppearanceColor)) {
      borderColor = fallbackAppearanceColor;
    } else if (!isNearWhiteHexColor(textColor)) {
      borderColor = textColor;
    }
  }
  const fontSize = annotation.defaultAppearanceData?.fontSize || 12;
  const strokeWidth = getBorderWidth(annotation, 0, { allowExplicitZero: true });
  const dashArray = extractAnnotationDashArray(annotation);
  const fillHex = getShapeFillHex(annotation);
  // A callout's appearance also paints its filled arrowhead, so its generic
  // "has fill" cannot tell the box background from the arrowhead (the E2E
  // callout came in as a solid orange block). Callouts keep the /IC-only
  // rule; plain FreeText takes its box background from the appearance.
  const appearanceFillHex = !isCalloutIntent && appearance?.hasFill === true
    ? pdfColorToHex(appearance.fillColor || annotation.interiorColor || annotation.fillColor || [0, 0, 0])
    : null;
  const fillOpacity = appearanceFillHex
    ? resolveAnnotationPaintOpacity(annotation, appearance, 'fill', 1)
    : extractAnnotationOpacity(annotation, 1);
  // UX 2026-04-21: PDF spec — callout/textbox fill comes from /IC
  // (interior color) only. /C is the border/line color. The prior fallback
  // that painted /C as the textbox fill when /IC was missing was wrong and
  // caused Drawboard imports to get a red box because PDF.js was surfacing
  // the text's red color as annotation.color. When /IC is absent, the
  // textbox must stay clear — matching what Adobe Acrobat renders.
  const backgroundColor = appearanceFillHex || fillHex
    ? hexToRgba(appearanceFillHex || fillHex, fillOpacity)
    : 'transparent';

  const data = {
    ...(isCalloutIntent ? { pdfIntent: intent || 'FreeTextCallout' } : {}),
    ...(calloutPoints.length >= 2 ? { pdfCalloutPoints: calloutPoints } : {}),
    ...(appearanceTextBoxRect
      ? {
          // UX: 2026-04-19 — store the textbox rect as Acrobat drew it,
          // but grow the HEIGHT when the text would visibly wrap past
          // one line. Acrobat sometimes saves a one-line-tall box for
          // content that it then renders wrapped to 2+ lines; reading
          // it verbatim would clip the later lines. Width stays exact
          // so the knee-to-edge gap is preserved.
          pdfCalloutBoxRect: (() => {
            const rect = appearanceTextBoxRect;
            const fs = (annotation.defaultAppearanceData?.fontSize || 12) * scale;
            const lineH = fs * 1.31; // matches SVG renderer line-height
            const estCharWidth = fs * 0.55; // rough Helvetica avg
            const chars = String(text || '').length;
            const innerWidth = Math.max(1, rect.width);
            const wrappedLines = Math.max(1, Math.ceil((chars * estCharWidth) / innerWidth));
            const needed = wrappedLines * lineH;
            return {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: Math.max(rect.height, needed),
            };
          })(),
        }
      : {}),
    ...(isCalloutIntent
      ? {
          pdfCalloutStyle: {
            textColor,
            borderColor,
            backgroundColor,
            strokeWidth: strokeWidth * scale,
            ...(dashArray ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
            textAlign: annotation.defaultAppearanceData?.textAlign || null,
          }
        }
      : {})
  };

  // UX: Phase 15 UAT-3 (2026-04-18) — the SVG renderer insets text content
  // by TEXT_PADDING (hoisted above) on every side. PDF-stored rects are
  // sized to the text area exactly, so without expansion the padded
  // content would shrink by 2*PAD and text hugs the bottom. Expand the
  // stored rect by TEXT_PADDING on all sides so the border grows outward
  // and the inner text area matches the source. Applies to plain FreeText
  // AND callout-intent imports (both route through renderers that inset
  // by TEXT_PADDING). Plain FreeText additionally needs a small descender-
  // room bump for baseline-tight sources.
  const padLeft = targetRect.left - TEXT_PADDING;
  const padTop = targetRect.top - TEXT_PADDING;
  const padWidth = targetRect.width + 2 * TEXT_PADDING;
  const descenderRoom = isCalloutIntent ? 0 : (fontSize * scale) * 0.35;
  const padHeight = targetRect.height + 2 * TEXT_PADDING + descenderRoom;

  // UX 2026-04-22: when the source PDF rotated this text box via its /AP
  // appearance matrix (Drawboard stores tilted labels this way), recover
  // the tilt + un-rotated dimensions — same approach we use for Square/
  // Circle. Without this, the tilt was lost and /Rect (the AABB of the
  // rotated box) came through as an oversized axis-aligned box. Only
  // applies to plain FreeText; callouts have their own composite
  // positioning pipeline that shouldn't gain an angle on the textbox.
  const textBoxRotation = !isCalloutIntent
    ? computeAppearanceRotationTransform(annotation, scale)
    : null;
  if (textBoxRotation) {
    const unrotWidth = textBoxRotation.bboxWidth + 2 * TEXT_PADDING;
    const unrotHeight = textBoxRotation.bboxHeight + 2 * TEXT_PADDING + descenderRoom;
    const cx = viewportRect.left + viewportRect.width / 2;
    const cy = viewportRect.top + viewportRect.height / 2;
    return {
      type: 'textbox',
      left: cx - unrotWidth / 2,
      top: cy - unrotHeight / 2,
      width: unrotWidth,
      height: unrotHeight,
      angle: textBoxRotation.angleDeg,
      text: text,
      fill: textColor,
      stroke: strokeWidth > 0 ? borderColor : null,
      strokeWidth: strokeWidth * scale,
      ...(dashArray ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
      backgroundColor,
      fontSize: fontSize * scale,
      fontFamily: annotation.defaultAppearanceData?.fontName || 'Helvetica',
      ...(Object.keys(data).length > 0 ? { data } : {}),
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      isPdfImported: true,
      pdfAnnotationId: annotation.id,
      pdfAnnotationType: 'FreeText',
      layer: 'pdf-annotations'
    };
  }

  return {
    type: 'textbox',
    left: padLeft,
    top: padTop,
    width: padWidth,
    height: padHeight,
    text: text,
    fill: textColor,
    stroke: strokeWidth > 0 ? borderColor : null,
    strokeWidth: strokeWidth * scale,
    ...(dashArray ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
    backgroundColor,
    fontSize: fontSize * scale,
    fontFamily: annotation.defaultAppearanceData?.fontName || 'Helvetica',
    ...(Object.keys(data).length > 0 ? { data } : {}),
    // Required Fabric.js properties for proper interaction
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    // Mark as imported from PDF
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'FreeText',
    layer: 'pdf-annotations'
  };
}

function getAnnotationPolylinePoints(annotation, viewport, scale = 1) {
  const vertices = convertPdfPointListToViewportPoints(annotation.vertices, viewport, scale);
  if (vertices.length >= 2) {
    return vertices;
  }

  if (Array.isArray(annotation.lineCoordinates) && annotation.lineCoordinates.length >= 4) {
    const start = convertPdfPointToViewport(
      annotation.lineCoordinates[0],
      annotation.lineCoordinates[1],
      viewport,
      scale
    );
    const end = convertPdfPointToViewport(
      annotation.lineCoordinates[2],
      annotation.lineCoordinates[3],
      viewport,
      scale
    );
    return [start, end];
  }

  const rect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!rect) return [];

  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.bottom }
  ];
}

function convertPolyLineToFabricPolyline(annotation, viewport, scale = 1) {
  const points = getAnnotationPolylinePoints(annotation, viewport, scale);
  if (points.length < 2) {
    return null;
  }

  const relative = toRelativeFabricPoints(points);
  if (!relative) {
    return null;
  }

  const strokeColor = pdfColorToHex(annotation.color || [0, 0, 0], annotation);
  const strokeOpacity = extractAnnotationOpacity(annotation, 1);
  const strokeWidth = getBorderWidth(annotation, 1);
  const lineEndings = normalizePdfLineEndings(annotation.lineEndings);
  const dashArray = extractAnnotationDashArray(annotation);
  const intent = normalizePdfNameToken(annotation.intent || '');

  const data = {
    ...(lineEndings ? { pdfLineEndings: lineEndings } : {}),
    // /IC decides whether a ClosedArrow ending is filled or hollow.
    ...(Array.isArray(annotation.interiorColor) && annotation.interiorColor.length >= 3
      ? { pdfInteriorColor: pdfColorToHex(annotation.interiorColor, annotation) } : {}),
    ...(intent ? { pdfIntent: intent } : {})
  };

  return {
    type: 'polyline',
    left: relative.left,
    top: relative.top,
    points: relative.points,
    fill: 'transparent',
    stroke: hexToRgba(strokeColor, strokeOpacity),
    strokeWidth: strokeWidth * scale,
    ...(dashArray ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeUniform: true,
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    ...(Object.keys(data).length > 0 ? { data } : {}),
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'PolyLine',
    layer: 'pdf-annotations'
  };
}

function convertPolygonToFabricPolygon(annotation, viewport, scale = 1) {
  const points = convertPdfPointListToViewportPoints(annotation.vertices, viewport, scale);
  if (points.length < 3) {
    return null;
  }

  const relative = toRelativeFabricPoints(points);
  if (!relative) {
    return null;
  }

  const strokeColor = pdfColorToHex(annotation.color || [0, 0, 0], annotation);
  const strokeOpacity = extractAnnotationOpacity(annotation, 1);
  const fillColor = getShapeFillColor(annotation);
  const strokeWidth = getBorderWidth(annotation, 1, { allowExplicitZero: true });
  const dashArray = extractAnnotationDashArray(annotation);
  const hasVisibleStroke = strokeWidth > 0;
  const hasVisibleFill = fillColor !== 'transparent';
  const intent = normalizePdfNameToken(annotation.intent || '');

  if (!hasVisibleStroke && !hasVisibleFill) {
    return null;
  }

  // UX 2026-04-21: Cloud-polygon revision clouds arrive as /Subtype /Polygon
  // with /BE /S = /C. Reuse the same scalloped-edge builder as rectangles,
  // feeding it the already-relative polygon vertices.
  const cloudEffect = annotation.borderEffect?.style === 'C'
    ? (annotation.borderEffect || { style: 'C', intensity: 2 })
    : null;
  const cloudIntensity = cloudEffect ? (cloudEffect.intensity ?? 2) : null;
  const cloudPathD = cloudEffect
    ? buildCloudPathCommands(
        relative.points,
        cloudIntensity,
        strokeWidth * scale,
        scale,
        'polygon',
      )
    : null;

  const data = {
    ...(intent ? { pdfIntent: intent } : {}),
    ...(cloudPathD
      ? { pdfCloudPathD: cloudPathD, pdfCloudIntensity: cloudIntensity, pdfCloudUnitScale: scale }
      : {}),
  };

  return {
    type: 'polygon',
    left: relative.left,
    top: relative.top,
    points: relative.points,
    fill: fillColor,
    stroke: hasVisibleStroke ? hexToRgba(strokeColor, strokeOpacity) : null,
    strokeWidth: hasVisibleStroke ? strokeWidth * scale : 0,
    ...(dashArray && hasVisibleStroke ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeUniform: true,
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    ...(Object.keys(data).length > 0 ? { data } : {}),
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Polygon',
    layer: 'pdf-annotations'
  };
}

function convertTextToFabricNote(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const minSize = 14 * scale;
  const width = Math.max(viewportRect.width, minSize);
  const height = Math.max(viewportRect.height, minSize);
  const noteColor = pdfColorToHex(annotation.color || [1, 0.92, 0.23], annotation);
  const iconName = normalizePdfNameToken(annotation.name || '') || 'Note';

  return {
    type: 'rect',
    left: viewportRect.left,
    top: viewportRect.top,
    width,
    height,
    fill: hexToRgba(noteColor, 0.92),
    stroke: 'rgba(0, 0, 0, 0.4)',
    strokeWidth: Math.max(1, scale),
    strokeUniform: true,
    rx: Math.max(2, 3 * scale),
    ry: Math.max(2, 3 * scale),
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    hoverCursor: 'pointer',
    data: {
      type: 'note',
      pdfNoteGlyph: 'note',
      noteText: getAnnotationContents(annotation),
      pdfNoteIcon: iconName,
      ...(annotation.state ? { pdfState: annotation.state } : {}),
      ...(annotation.stateModel ? { pdfStateModel: annotation.stateModel } : {})
    },
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Text',
    layer: 'pdf-annotations'
  };
}

/**
 * Convert PDF Square annotation to Fabric.js Rect
 */
// UX 2026-04-22: derive a shape's rotation + true unrotated dimensions from
// its /AP /N Form XObject /Matrix and /BBox. Drawboard (and peers) bake a
// shape's tilt into the appearance-stream matrix while leaving the annotation's
// /Rect axis-aligned — so a 47° tilted rectangle imports as an axis-aligned
// square if you only look at /Rect. Returns null when the matrix is missing
// or effectively identity (i.e. no rotation); callers fall back to /Rect.
//
// Angle convention: /Matrix [a,b,c,d,e,f] = [cos θ, sin θ, -sin θ, cos θ, tx, ty]
// encodes a CCW rotation by θ in PDF's y-up space. Screen y is flipped, so the
// on-screen visual rotation is the negative of that — which matches Fabric's
// screen-clockwise convention: fabricAngleDeg = -atan2(b, a) * 180/π.
function computeAppearanceRotationTransform(annotation, scale = 1) {
  const matrix = annotation?._appearance?.matrix;
  const bbox = annotation?._appearance?.bbox;
  if (!Array.isArray(matrix) || matrix.length !== 6) return null;
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const [a, b, , d] = matrix;
  const EPS = 1e-3;
  if (Math.abs(a - 1) < EPS && Math.abs(b) < EPS && Math.abs(d - 1) < EPS) {
    // Identity (or near-identity) — no rotation baked into the appearance.
    return null;
  }
  const angleDeg = -Math.atan2(b, a) * 180 / Math.PI;
  const bboxWidth = Math.abs(bbox[2] - bbox[0]) * scale;
  const bboxHeight = Math.abs(bbox[3] - bbox[1]) * scale;
  if (!Number.isFinite(angleDeg) || bboxWidth <= 0 || bboxHeight <= 0) return null;
  return { angleDeg, bboxWidth, bboxHeight };
}

function convertSquareToFabricRect(annotation, viewport, scale = 1) {
  const rawViewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  const appearance = annotation?._appearance;
  const rotationTransform = computeAppearanceRotationTransform(annotation, scale);
  const cloudEffect = annotation.borderEffect?.style === 'C'
    ? (annotation.borderEffect || { style: 'C', intensity: 2 })
    : null;
  const cloudIntensity = cloudEffect ? (cloudEffect.intensity ?? 2) : null;
  const appearanceBounds = !cloudEffect && !rotationTransform
    && (appearance?.hasFill === true || appearance?.hasStroke === true)
    ? getAppearancePathBounds(annotation, viewport, scale)
    : null;
  const viewportRect = appearanceBounds || rawViewportRect;
  if (!viewportRect) {
    return null;
  }

  // UX 2026-04-22: if the source PDF rotated this rectangle via its /AP
  // appearance matrix (Drawboard / Acrobat both do this for tilted shapes),
  // recover the true tilt + un-rotated dimensions so the imported rect
  // matches what the authoring tool displayed. Rect.left/top is recentered
  // on the viewport /Rect midpoint so Fabric's rotation pivot (bbox center)
  // matches Drawboard's.
  const hasAppearancePaint = Boolean(
    appearance && (appearance.hasFill === true || appearance.hasStroke === true)
  );
  const strokeColor = pdfColorToHex(
    hasAppearancePaint && appearance.hasStroke === true
      ? (appearance.strokeColor || annotation.color || [0, 0, 0])
      : (annotation.color || [0, 0, 0]),
    hasAppearancePaint ? null : annotation,
  );
  const strokeOpacity = hasAppearancePaint
    ? resolveAnnotationPaintOpacity(annotation, appearance, 'stroke', 1)
    : extractAnnotationOpacity(annotation, 1);
  const appearanceFillHex = hasAppearancePaint && appearance.hasFill === true
    ? pdfColorToHex(appearance.fillColor || annotation.interiorColor || annotation.fillColor || [0, 0, 0])
    : null;
  const fillColor = appearanceFillHex
    ? hexToRgba(appearanceFillHex, resolveAnnotationPaintOpacity(annotation, appearance, 'fill', 1))
    : (hasAppearancePaint ? 'transparent' : getShapeFillColor(annotation));
  const appearanceStrokeWidth = hasAppearancePaint && appearance.hasStroke === true
    ? getAppearanceStrokeWidth(annotation, viewport, scale)
    : null;
  const strokeWidth = Number.isFinite(appearanceStrokeWidth)
    ? appearanceStrokeWidth / scale
    : getBorderWidth(annotation, 1, { allowExplicitZero: true });
  const appearanceDash = getAppearancePaintOperation(appearance, 'stroke')?.dashArray;
  const dashArray = hasAppearancePaint && Array.isArray(appearanceDash)
    ? appearanceDash
    : extractAnnotationDashArray(annotation);
  const hasVisibleStroke = hasAppearancePaint ? appearance.hasStroke === true && strokeWidth >= 0 : strokeWidth > 0;
  const hasVisibleFill = hasAppearancePaint ? appearance.hasFill === true : fillColor !== 'transparent';

  // Ignore shape annotations that are fully invisible in the source PDF.
  if (!hasVisibleStroke && !hasVisibleFill) {
    return null;
  }

  // UX 2026-04-21: If the source PDF marked this rectangle with the cloudy
  // border effect (/BE /S = /C), build a scalloped edge path so it renders
  // as a revision cloud instead of a plain box. Path is in local coords
  // (0,0 origin) so normal rect positioning/scaling works unchanged.
  const cloudInsets = cloudEffect && Array.isArray(annotation.rectangleDifferences)
    && annotation.rectangleDifferences.length === 4
    ? annotation.rectangleDifferences.map((value) => Math.max(0, Number(value) || 0) * scale)
    : [0, 0, 0, 0];
  const cloudPathD = cloudEffect
    ? buildCloudPathCommands(
        [
          { x: cloudInsets[0], y: cloudInsets[1] },
          { x: viewportRect.width - cloudInsets[2], y: cloudInsets[1] },
          { x: viewportRect.width - cloudInsets[2], y: viewportRect.height - cloudInsets[3] },
          { x: cloudInsets[0], y: viewportRect.height - cloudInsets[3] },
        ],
        cloudIntensity,
        strokeWidth * scale,
        scale,
        'rectangle',
      )
    : null;

  // If a rotation transform is present, use the un-rotated /BBox dimensions
  // and center the rect on the viewport /Rect midpoint. Otherwise fall back
  // to the existing axis-aligned behavior.
  const useRotation = !!rotationTransform;
  const outWidth = useRotation ? rotationTransform.bboxWidth : viewportRect.width;
  const outHeight = useRotation ? rotationTransform.bboxHeight : viewportRect.height;
  const outLeft = useRotation
    ? viewportRect.left + (viewportRect.width - outWidth) / 2
    : viewportRect.left;
  const outTop = useRotation
    ? viewportRect.top + (viewportRect.height - outHeight) / 2
    : viewportRect.top;

  return {
    type: 'rect',
    left: outLeft,
    top: outTop,
    width: outWidth,
    height: outHeight,
    ...(useRotation ? { angle: rotationTransform.angleDeg } : {}),
    fill: fillColor,
    stroke: hasVisibleStroke ? hexToRgba(strokeColor, strokeOpacity) : null,
    strokeWidth: hasVisibleStroke ? strokeWidth * scale : 0,
    ...(dashArray && hasVisibleStroke ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
    strokeUniform: true,
    // Required Fabric.js properties for proper interaction
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    ...(cloudPathD
      ? { data: {
          pdfCloudPathD: cloudPathD,
          pdfCloudIntensity: cloudIntensity,
          pdfCloudInsets: cloudInsets,
          pdfCloudUnitScale: scale,
        } }
      : {}),
    // Mark as imported from PDF
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Square',
    layer: 'pdf-annotations'
  };
}

/**
 * Convert PDF Circle annotation to Fabric.js Circle
 */
function convertCircleToFabricCircle(annotation, viewport, scale = 1) {
  const rawViewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!rawViewportRect) {
    return null;
  }

  const counterMetadata = annotation.counterMetadata || null;
  if (counterMetadata?.app === 'SurveyApp' && counterMetadata?.kind === PDF_COUNTER_SUBJECT) {
    const radiusFromMetadata = Number(counterMetadata.radius);
    const radius = Number.isFinite(radiusFromMetadata) && radiusFromMetadata > 0
      ? radiusFromMetadata * scale
      : Math.min(rawViewportRect.width, rawViewportRect.height) / 2;
    if (radius <= 0) {
      console.warn('[PDFCounterImport] counter metadata parse failed: invalid radius', {
        id: annotation.id,
        radius: counterMetadata.radius
      });
      return null;
    }

    const displayNumber = counterMetadata.displayNumber ?? counterMetadata.number ?? null;
    const color = counterMetadata.color || getShapeFillColor(annotation);
    // The PDF /Rect includes the counter pin nub so native viewers do not clip
    // its appearance. Restore the editable circle body from app metadata rather
    // than treating that larger appearance rectangle as the Fabric position.
    const metadataLeft = Number(counterMetadata.position?.left ?? counterMetadata.left);
    const metadataTop = Number(counterMetadata.position?.top ?? counterMetadata.top);
    const left = Number.isFinite(metadataLeft) ? metadataLeft * scale : rawViewportRect.left;
    const top = Number.isFinite(metadataTop) ? metadataTop * scale : rawViewportRect.top;
    const data = {
      type: 'counter',
      id: counterMetadata.id || annotation.id || undefined,
      ...(counterMetadata.data?.createdAt ? { createdAt: counterMetadata.data.createdAt } : {}),
      ...(counterMetadata.pointerAngle != null ? { pointerAngle: counterMetadata.pointerAngle } : {}),
      ...(displayNumber != null ? { displayNumber } : {}),
      ...(counterMetadata.series?.id != null ? { seriesId: counterMetadata.series.id } : {}),
      ...(counterMetadata.series?.name != null ? { seriesName: counterMetadata.series.name } : {}),
      ...(counterMetadata.series?.color != null ? { seriesColor: counterMetadata.series.color } : {}),
      ...(counterMetadata.series?.start != null ? { seriesStart: counterMetadata.series.start } : {}),
      ...(counterMetadata.group?.id != null ? { groupId: counterMetadata.group.id } : {}),
      ...(counterMetadata.group?.sequence != null ? { sequence: counterMetadata.group.sequence } : {}),
      ...(counterMetadata.data?.numberColor != null ? { numberColor: counterMetadata.data.numberColor } : {}),
    };

    return {
      type: 'circle',
      id: counterMetadata.id || annotation.id,
      left,
      top,
      radius,
      fill: color,
      stroke: '#ffffff',
      strokeWidth: 1.5 * scale,
      strokeUniform: true,
      hasControls: false,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      selectable: true,
      evented: true,
      data,
      isPdfImported: true,
      pdfAnnotationId: annotation.id,
      pdfAnnotationType: 'Circle',
      pdfAnnotationSubject: PDF_COUNTER_SUBJECT,
      layer: 'pdf-annotations'
    };
  }

  // UX 2026-04-22: recover tilt + true oblong dimensions from the /AP
  // appearance matrix when present. Drawboard tilts ellipses by baking a
  // rotation into the /AP /N /Matrix and storing the un-rotated (oblong)
  // radii in /AP /N /BBox — so an ellipse tilted 47° imports as a plain
  // circle without this path. Switches output to `type: 'ellipse'` with
  // rx/ry + angle so the SVG renderer draws it as Drawboard displayed it.
  const appearance = annotation?._appearance;
  const rotationTransform = computeAppearanceRotationTransform(annotation, scale);
  const appearanceBounds = !rotationTransform
    && (appearance?.hasFill === true || appearance?.hasStroke === true)
    ? getAppearancePathBounds(annotation, viewport, scale)
    : null;
  const viewportRect = appearanceBounds || rawViewportRect;
  const hasAppearancePaint = Boolean(
    appearance && (appearance.hasFill === true || appearance.hasStroke === true)
  );
  const strokeColor = pdfColorToHex(
    hasAppearancePaint && appearance.hasStroke === true
      ? (appearance.strokeColor || annotation.color || [0, 0, 0])
      : (annotation.color || [0, 0, 0]),
    hasAppearancePaint ? null : annotation,
  );
  const strokeOpacity = hasAppearancePaint
    ? resolveAnnotationPaintOpacity(annotation, appearance, 'stroke', 1)
    : extractAnnotationOpacity(annotation, 1);
  const appearanceFillHex = hasAppearancePaint && appearance.hasFill === true
    ? pdfColorToHex(appearance.fillColor || annotation.interiorColor || annotation.fillColor || [0, 0, 0])
    : null;
  const fillColor = appearanceFillHex
    ? hexToRgba(appearanceFillHex, resolveAnnotationPaintOpacity(annotation, appearance, 'fill', 1))
    : (hasAppearancePaint ? 'transparent' : getShapeFillColor(annotation));
  const appearanceStrokeWidth = hasAppearancePaint && appearance.hasStroke === true
    ? getAppearanceStrokeWidth(annotation, viewport, scale)
    : null;
  const strokeWidth = Number.isFinite(appearanceStrokeWidth)
    ? appearanceStrokeWidth / scale
    : getBorderWidth(annotation, 1, { allowExplicitZero: true });
  const appearanceDash = getAppearancePaintOperation(appearance, 'stroke')?.dashArray;
  const dashArray = hasAppearancePaint && Array.isArray(appearanceDash)
    ? appearanceDash
    : extractAnnotationDashArray(annotation);
  const hasVisibleStroke = hasAppearancePaint
    ? appearance.hasStroke === true && strokeWidth >= 0
    : strokeWidth > 0;
  const hasVisibleFill = hasAppearancePaint
    ? appearance.hasFill === true
    : fillColor !== 'transparent';
  if (!hasVisibleStroke && !hasVisibleFill) return null;

  if (rotationTransform) {
    const rx = rotationTransform.bboxWidth / 2;
    const ry = rotationTransform.bboxHeight / 2;
    if (rx <= 0 || ry <= 0) return null;
    const cx = viewportRect.left + viewportRect.width / 2;
    const cy = viewportRect.top + viewportRect.height / 2;
    return {
      type: 'ellipse',
      left: cx - rx,
      top: cy - ry,
      rx,
      ry,
      angle: rotationTransform.angleDeg,
      fill: fillColor,
      stroke: hasVisibleStroke ? hexToRgba(strokeColor, strokeOpacity) : null,
      strokeWidth: hasVisibleStroke ? strokeWidth * scale : 0,
      ...(dashArray && hasVisibleStroke ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
      strokeUniform: true,
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      isPdfImported: true,
      pdfAnnotationId: annotation.id,
      pdfAnnotationType: 'Circle',
      layer: 'pdf-annotations'
    };
  }

  // No rotation metadata — fall back to the existing axis-aligned path.
  const radius = Math.min(viewportRect.width, viewportRect.height) / 2;
  if (radius <= 0) {
    return null;
  }

  return {
    type: 'circle',
    left: viewportRect.left,
    top: viewportRect.top,
    radius: radius,
    fill: fillColor,
    stroke: hasVisibleStroke ? hexToRgba(strokeColor, strokeOpacity) : null,
    strokeWidth: hasVisibleStroke ? strokeWidth * scale : 0,
    ...(dashArray && hasVisibleStroke ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
    strokeUniform: true,
    // If it's an ellipse, store the original dimensions
    scaleX: viewportRect.width / (radius * 2),
    scaleY: viewportRect.height / (radius * 2),
    // Required Fabric.js properties for proper interaction
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    // Mark as imported from PDF
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Circle',
    layer: 'pdf-annotations'
  };
}

/**
 * Convert PDF Line annotation to Fabric.js Line
 */
function convertLineToFabricLine(annotation, viewport, scale = 1) {
  // Line coordinates: [x1, y1, x2, y2]
  const lineCoords = annotation.lineCoordinates;
  const lineEndings = normalizePdfLineEndings(annotation.lineEndings);

  // UX 2026-04-22: diagnostic log — prints exactly what pdf.js / raw-pdf
  // metadata hand us for this Line annotation so we can see if the coord
  // order or /LE array was reshuffled upstream. Gated behind
  // window.__LINE_IMPORT_DIAG = true.
  try {
    if (typeof window !== 'undefined' && window.__LINE_IMPORT_DIAG) {
      console.log('[LineImportDiag]', JSON.stringify({
        id: annotation.id,
        rawLineCoordinates: annotation.lineCoordinates,
        rawLineEndings: annotation.lineEndings,
        normalizedLineEndings: lineEndings,
        rect: annotation.rect,
        color: annotation.color,
      }));
    }
  } catch (_e) { /* diag must never throw */ }
  const dashArray = extractAnnotationDashArray(annotation);
  const intent = normalizePdfNameToken(annotation.intent || '');
  const calloutPoints = convertPdfPointListToViewportPoints(annotation.calloutLine, viewport, scale);
  // UX 2026-04-20: PDF Line annotations with a triangular line-ending
  // (OpenArrow / ClosedArrow and the R-prefixed reversed variants)
  // should import as the app's Arrow tool, not a plain line — otherwise
  // the imported shape loses its arrowhead on screen. Detection looks
  // at both LE slots (start, end); if only the START ending is the arrow
  // we swap endpoints so the rendered arrowhead lands where the PDF
  // author placed it. Non-arrow endings (Circle / Diamond / Butt / etc.)
  // still import as plain lines — those would need more work to
  // preserve fidelity and are out of scope.
  const ARROW_LE = new Set(['OpenArrow', 'ClosedArrow', 'ROpenArrow', 'RClosedArrow']);
  const startArrow = !!(lineEndings && ARROW_LE.has(lineEndings[0]));
  const endArrow = !!(lineEndings && ARROW_LE.has(lineEndings[1]));
  const detectedArrow = startArrow || endArrow;
  const data = {
    ...(lineEndings ? { pdfLineEndings: lineEndings } : {}),
    // /IC decides whether a ClosedArrow ending is filled or hollow.
    ...(Array.isArray(annotation.interiorColor) && annotation.interiorColor.length >= 3
      ? { pdfInteriorColor: pdfColorToHex(annotation.interiorColor, annotation) } : {}),
    ...(intent ? { pdfIntent: intent } : {}),
    ...(calloutPoints.length >= 2 ? { pdfCalloutPoints: calloutPoints } : {})
  };

  const strokeValue = hexToRgba(
    pdfColorToHex(annotation.color || [0, 0, 0], annotation),
    extractAnnotationOpacity(annotation, 1)
  );
  const strokeWidthValue = getBorderWidth(annotation, 1) * scale;

  if (!lineCoords || lineCoords.length < 4) {
    // Fallback to rect if no line coordinates
    const rect = annotation.rect;
    if (!rect || rect.length < 4) return null;

    const startRaw = convertPdfPointToViewport(rect[0], rect[1], viewport, scale);
    const endRaw = convertPdfPointToViewport(rect[2], rect[3], viewport, scale);
    const start = startRaw;
    const end = endRaw;

    return {
      type: 'line',
      ...(detectedArrow ? { tool: 'arrow' } : {}),
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      stroke: strokeValue,
      strokeWidth: strokeWidthValue,
      ...(dashArray ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
      strokeUniform: true,
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      ...(Object.keys(data).length > 0 ? { data } : {}),
      isPdfImported: true,
      pdfAnnotationId: annotation.id,
      pdfAnnotationType: 'Line',
      layer: 'pdf-annotations'
    };
  }

  const startRaw = convertPdfPointToViewport(lineCoords[0], lineCoords[1], viewport, scale);
  const endRaw = convertPdfPointToViewport(lineCoords[2], lineCoords[3], viewport, scale);
  const start = startRaw;
  const end = endRaw;

  return {
    type: 'line',
    ...(detectedArrow ? { tool: 'arrow' } : {}),
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    stroke: strokeValue,
    strokeWidth: strokeWidthValue,
    ...(dashArray ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
    strokeUniform: true,
    // Required Fabric.js properties for proper interaction
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    ...(Object.keys(data).length > 0 ? { data } : {}),
    // Mark as imported from PDF
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Line',
    layer: 'pdf-annotations'
  };
}

/**
 * Convert Underline/StrikeOut to Fabric.js Rect (thin rectangle)
 */
function convertUnderlineToFabricRect(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const height = Math.max(2 * scale, viewportRect.height * 0.1); // Thin line

  const color = pdfColorToHex(annotation.color || [1, 0, 0], annotation); // Default red
  const isSelectDeleteOnly = SELECT_DELETE_ONLY_TEXT_MARKUP_TYPES.has(annotation.subtype);

  // Position at bottom for underline, middle for strikeout
  const isStrikeOut = annotation.subtype === 'StrikeOut';
  const top = isStrikeOut
    ? viewportRect.top + (viewportRect.height / 2) - (height / 2)
    : viewportRect.top + viewportRect.height - height;

  return {
    type: 'rect',
    left: viewportRect.left,
    top: top,
    width: viewportRect.width,
    height: height,
    fill: color,
    stroke: null,
    strokeWidth: 0,
    // Required Fabric.js properties for proper interaction
    selectable: true,
    evented: true,
    hasControls: !isSelectDeleteOnly,
    hasBorders: true,
    lockMovementX: isSelectDeleteOnly,
    lockMovementY: isSelectDeleteOnly,
    lockScalingX: isSelectDeleteOnly,
    lockScalingY: isSelectDeleteOnly,
    lockRotation: isSelectDeleteOnly,
    // Mark as imported from PDF
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: annotation.subtype,
    layer: 'pdf-annotations'
  };
}

function convertSquigglyToFabricPath(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const width = Math.max(4 * scale, viewportRect.width);
  const minAmplitude = 0.45 * scale;
  const maxAmplitude = 1.35 * scale;
  const amplitude = Math.min(maxAmplitude, Math.max(minAmplitude, viewportRect.height * 0.045));
  const wavelength = Math.max(2.5 * scale, Math.min(3.5 * scale, viewportRect.height * 0.16));
  const segmentCount = Math.max(12, Math.ceil(width / (wavelength / 4)));
  const baseline = viewportRect.bottom - amplitude * 1.25;

  const points = [];
  for (let i = 0; i <= segmentCount; i += 1) {
    const t = i / segmentCount;
    const wave = Math.sin((t * width / wavelength) * Math.PI * 2);
    points.push({
      x: viewportRect.left + t * width,
      y: baseline + wave * amplitude
    });
  }

  const path = [];
  if (points.length > 0) {
    path.push(['M', points[0].x, points[0].y]);
    for (let i = 1; i < points.length; i += 1) {
      path.push(['L', points[i].x, points[i].y]);
    }
  }

  const strokeColor = pdfColorToHex(annotation.color || [1, 0, 0], annotation);
  const strokeOpacity = extractAnnotationOpacity(annotation, 1);
  const rawStrokeWidth = getBorderWidth(annotation, 1);
  const strokeWidth = Math.min(1.1 * scale, Math.max(0.6 * scale, rawStrokeWidth * 0.55 * scale));
  const isSelectDeleteOnly = SELECT_DELETE_ONLY_TEXT_MARKUP_TYPES.has(annotation.subtype);
  const internal = makeInternalPenPathSpec({
    stroke: hexToRgba(strokeColor, strokeOpacity),
    strokeWidth
  });

  return {
    ...internal,
    type: 'path',
    left: 0,
    top: 0,
    width,
    height: amplitude * 2,
    path,
    selectable: true,
    evented: true,
    hasControls: !isSelectDeleteOnly,
    hasBorders: true,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    perPixelTargetFind: true,
    targetFindTolerance: 5,
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Squiggly',
    layer: 'pdf-annotations'
  };
}

function convertCaretToFabricPolyline(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const width = Math.max(viewportRect.width, 12 * scale);
  const height = Math.max(viewportRect.height, 10 * scale);
  const strokeColor = pdfColorToHex(annotation.color || [1, 0, 0], annotation);
  const strokeOpacity = extractAnnotationOpacity(annotation, 1);
  const strokeWidth = Math.max(1, getBorderWidth(annotation, 1)) * scale;

  return {
    type: 'polyline',
    left: viewportRect.left,
    top: viewportRect.top,
    points: [
      { x: 0, y: height },
      { x: width / 2, y: 0 },
      { x: width, y: height }
    ],
    fill: 'transparent',
    stroke: hexToRgba(strokeColor, strokeOpacity),
    strokeWidth,
    strokeUniform: true,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Caret',
    layer: 'pdf-annotations'
  };
}

/**
 * Convert a single PDF annotation to Fabric.js object data
 * @param {Object} annotation - PDF.js annotation object
 * @param {Object} viewport - PDF.js page viewport (scale 1)
 * @param {number} scale - Scale factor (default 1)
 * @returns {Object|null} Fabric.js object data or null if unsupported
 */
export function convertPdfAnnotationToFabric(annotation, viewport, scale = 1, rawMetadata = null, options = {}) {
  const normalizedAnnotation = applyRawMetadataToAnnotation(annotation, rawMetadata);
  const subtype = normalizedAnnotation.subtype;
  const finish = (fabricObj) => {
    if (!fabricObj) return fabricObj;
    const metadata = normalizedAnnotation.appAnnotationMetadata;
    const primary = metadata
      ? applyPdfAppAnnotationMetadata(fabricObj, metadata)
      : fabricObj;
    const companions = fabricObj[PDF_APPEARANCE_COMPANION_LAYERS];
    if (!Array.isArray(companions) || companions.length === 0) return primary;

    // A PDF paint operation can require several editable filled layers (for
    // example `B`: fill, then stroke). They share source ownership/scope and a
    // group, but never an object/history id. Full app geometry/style metadata
    // is intentionally applied only to the primary; applying it to companions
    // would replace each distinct AP paint layer with the same geometry.
    const scopedCompanions = companions.map((companion) => {
      if (!metadata) return companion;
      return {
        ...companion,
        appAnnotationId: metadata.id,
        appAnnotationType: metadata.appType,
        ...(metadata.moduleId ? { moduleId: metadata.moduleId } : {}),
        ...(metadata.regionId ? { regionId: metadata.regionId } : {}),
        ...(metadata.spaceId ? { spaceId: metadata.spaceId } : {}),
        ...(metadata.layer ? { layer: metadata.layer } : {}),
        ...(metadata.ownership && typeof metadata.ownership === 'object'
          ? {
              meta: {
                ...(companion.meta || {}),
                ...metadata.ownership,
              },
            }
          : {}),
      };
    });
    const groupId = (
      primary?.data?.groupId
      || fabricObj?.data?.groupId
      || scopedCompanions[0]?.data?.groupId
    );
    const restoreLayerIdentity = (value, original) => ({
      ...value,
      id: original.id,
      data: {
        ...(value.data || {}),
        ...(groupId ? { groupId } : {}),
        id: original.data?.id || original.id,
        pdfAppearanceCompositeId:
          original.data?.pdfAppearanceCompositeId || groupId || null,
        pdfAppearanceSourceAnnotationId:
          original.data?.pdfAppearanceSourceAnnotationId
          || normalizedAnnotation.id
          || normalizedAnnotation.name
          || null,
        pdfAppearanceLayerIndex: original.data?.pdfAppearanceLayerIndex,
        pdfAppearancePaintOperationIndex:
          original.data?.pdfAppearancePaintOperationIndex,
        pdfAppearanceLayerKind: original.data?.pdfAppearanceLayerKind,
      },
    });
    const stablePrimary = restoreLayerIdentity(primary, fabricObj);
    const stableCompanions = scopedCompanions.map((value, index) => (
      restoreLayerIdentity(value, companions[index])
    ));
    Object.defineProperty(stablePrimary, PDF_APPEARANCE_COMPANION_LAYERS, {
      value: stableCompanions,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return stablePrimary;
  };

  switch (subtype) {
    case 'Ink':
      return finish(convertInkToFabricPath(normalizedAnnotation, viewport, scale));
    case 'Highlight':
      return finish(convertSurveyMarkerToFabricRect(
        normalizedAnnotation,
        viewport,
        scale,
        options.pageNumber || normalizedAnnotation.pageNumber || 1,
      ));
    case 'FreeText':
      return finish(convertFreeTextToFabricTextbox(normalizedAnnotation, viewport, scale));
    case 'Square':
      if (isAutoCadShxTextAnnotation(normalizedAnnotation)) {
        return finish(convertAutoCadShxTextToFabricProxy(normalizedAnnotation, viewport, scale));
      }
      return finish(convertSquareToFabricRect(normalizedAnnotation, viewport, scale));
    case 'Circle':
      return finish(convertCircleToFabricCircle(normalizedAnnotation, viewport, scale));
    case 'Line':
      return finish(convertLineToFabricLine(normalizedAnnotation, viewport, scale));
    case 'PolyLine':
      return finish(convertPolyLineToFabricPolyline(normalizedAnnotation, viewport, scale));
    case 'Polygon':
      return finish(convertPolygonToFabricPolygon(normalizedAnnotation, viewport, scale));
    case 'Text':
      return convertTextToFabricNote(normalizedAnnotation, viewport, scale);
    case 'Underline':
    case 'StrikeOut':
      return convertUnderlineToFabricRect(normalizedAnnotation, viewport, scale);
    case 'Squiggly':
      return convertSquigglyToFabricPath(normalizedAnnotation, viewport, scale);
    case 'Caret':
      return convertCaretToFabricPolyline(normalizedAnnotation, viewport, scale);
    case 'Stamp':
      return finish(convertStampToImageProxy(
        normalizedAnnotation,
        viewport,
        scale,
        options.stampAppearanceDataUrl,
      ));
    default:
      // Unsupported annotation type
      return null;
  }
}

// Annotation types the markup importer deliberately drops here because another
// subsystem owns them (so they are neither converted to a native shape nor
// counted by the unsupported-annotation notice):
//   - Link  → handled by PdfjsLinkLayer (clickable link overlay).
//   - Popup → the companion note bubble of a Text/markup annotation; never a
//             standalone visual.
//   - Widget → INTERACTIVE FORM FIELDS, owned end-to-end by the form-field
//             subsystem: PdfjsFormLayer renders each Widget via pdf.js's own
//             AnnotationLayer (renderForms:true) as a real HTML input (text /
//             checkbox / radio / choice); /ReadOnly widgets render disabled
//             automatically. Edits are captured (onFieldChange/Blur) and
//             persisted as `form-field` objects by usePdfjsFormFieldPersistence,
//             then seeded back into annotationStorage on reload. VERIFIED
//             2026-07-19 (KAL-91): a pdf-lib form PDF opened in the app rendered
//             all fields, accepted input, kept /ReadOnly disabled, and the typed
//             text + checkbox + radio selection SURVIVED a full save → reload →
//             reopen round-trip. So dropping Widget here is correct, not a gap.
const SILENT_IGNORE_SUBTYPES = ['Link', 'Popup', 'Widget'];

/**
 * Categorize annotations into supported and unsupported
 * @param {Array} annotations - Array of PDF.js annotations
 * @returns {Object} { supported: [], unsupported: [] }
 */
// PDF annotation /F bits that mean "never show this" (ISO 32000 12.5.3).
const PDF_ANNOTATION_FLAG_HIDDEN = 2;
const PDF_ANNOTATION_FLAG_NO_VIEW = 32;

export function isPdfAnnotationHiddenFromView(annotation) {
  const flags = Number(annotation?.annotationFlags);
  if (!Number.isInteger(flags)) return false;
  return Boolean(flags & (PDF_ANNOTATION_FLAG_HIDDEN | PDF_ANNOTATION_FLAG_NO_VIEW));
}

export function categorizeAnnotations(annotations) {
  const supported = [];
  const unsupported = [];

  annotations.forEach(annotation => {
    // UX: a mark the PDF itself flags Hidden or NoView must not appear on
    // screen (Acrobat hides it too), and the print copy strips it for screen
    // parity. It is not "unsupported" either, so no notice is raised.
    if (isPdfAnnotationHiddenFromView(annotation)) return;
    if (
      SUPPORTED_SUBTYPES.includes(annotation.subtype)
      && (annotation.subtype !== 'Stamp' || annotation.hasAppearance === true)
    ) {
      supported.push(annotation);
    } else if (annotation.subtype && !SILENT_IGNORE_SUBTYPES.includes(annotation.subtype)) {
      // Only report types that are truly unsupported (not common companion annotations)
      unsupported.push(annotation);
    }
  });

  return { supported, unsupported };
}

function isSaneImportedAnnotationGeometry(annotation, viewport) {
  const pageSpan = Math.max(
    1,
    Number(viewport?.width) || 0,
    Number(viewport?.height) || 0,
  );
  // Keep a wide off-page allowance, but tie it to the page. Fixed million-unit
  // caps let corrupt marks dwarf a normal page and reach saved app state.
  const coordinateLimit = pageSpan * 1_000;
  const sizeLimit = pageSpan * 100;
  const finiteAndBounded = (values) => (
    Array.from(values || []).every((value) => (
      Number.isFinite(Number(value)) && Math.abs(Number(value)) <= coordinateLimit
    ))
  );
  const rect = annotation?._rawRectPresent ? annotation._rawRect : annotation?.rect;
  if (!rect && annotation?._rawRectPresent !== true) {
    const alternate = annotation?.vertices || annotation?.lineCoordinates || annotation?.inkLists?.flat?.();
    return Boolean(alternate && alternate.length >= 4 && finiteAndBounded(alternate));
  }
  if (!rect || rect.length !== 4 || !finiteAndBounded(rect)) return false;
  const width = Math.abs(Number(rect[2]) - Number(rect[0]));
  const height = Math.abs(Number(rect[3]) - Number(rect[1]));
  if (width > sizeLimit || height > sizeLimit) return false;
  if (width === 0 && height === 0) {
    const alternate = annotation?.vertices || annotation?.lineCoordinates || annotation?.inkLists?.flat?.();
    const minimumPoints = annotation?.subtype === 'Ink' ? 2 : 4;
    if (!alternate || alternate.length < minimumPoints || !finiteAndBounded(alternate)) return false;
  }

  // pdf.js hands quadPoints over as [[{x,y} x4], ...]; the raw dictionary
  // form is a flat number array. Flatten both to numbers before checking.
  // pdf.js may also expose a flat Float32Array of numbers.
  const flattenQuadPoints = (input) => {
    const value = Array.isArray(input) ? input : (ArrayBuffer.isView(input) ? Array.from(input) : null);
    return (Array.isArray(value)
    ? value.flatMap((quad) => (
      Array.isArray(quad)
        ? quad.flatMap((point) => (point && typeof point === 'object' ? [point.x, point.y] : [point]))
        : (quad && typeof quad === 'object' ? [quad.x, quad.y] : [quad])
    ))
    : null);
  };
  const quadPointsValid = (value) => {
    const flat = flattenQuadPoints(value);
    return Array.isArray(flat) && flat.length > 0 && flat.length % 8 === 0 && finiteAndBounded(flat);
  };
  const candidates = [];
  if (annotation?._rawQuadPointsPresent) candidates.push(annotation._rawQuadPoints);
  if (annotation?.quadPoints != null) candidates.push(annotation.quadPoints);
  // Raw-twin pairing can hand a valid mark a malformed sibling's raw quads;
  // the mark is only corrupt when NO candidate geometry is usable.
  if (candidates.length > 0 && !candidates.some(quadPointsValid)) return false;
  return true;
}

function normalizeImportedAppCallout(metadata) {
  if (!metadata || metadata.kind !== PDF_CALLOUT_SUBJECT || metadata.type !== 'callout') {
    return null;
  }

  const point = (value) => {
    const x = Number(value?.x);
    const y = Number(value?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };

  const arrowTip = point(metadata.arrowTip);
  const knee = point(metadata.knee);
  const textBoxPosition = point(metadata.textBoxPosition);
  const textBoxWidth = Number(metadata.textBoxWidth);
  const textBoxHeight = Number(metadata.textBoxHeight);
  const pageNumber = Number(metadata.pageNumber);

  if (
    !metadata.id ||
    !arrowTip ||
    !knee ||
    !textBoxPosition ||
    !Number.isFinite(textBoxWidth) ||
    !Number.isFinite(textBoxHeight)
  ) {
    return null;
  }

  return {
    id: metadata.id,
    pageNumber: Number.isFinite(pageNumber) ? pageNumber : 1,
    arrowTip,
    knee,
    textBoxPosition,
    textBoxWidth,
    textBoxHeight,
    text: metadata.text || '',
    style: metadata.style && typeof metadata.style === 'object' ? metadata.style : {},
    ...(metadata.moduleId ? { moduleId: metadata.moduleId } : {}),
    ...(metadata.regionId ? { regionId: metadata.regionId } : {}),
    ...(metadata.spaceId ? { spaceId: metadata.spaceId } : {}),
    ...(metadata.layer ? { layer: metadata.layer } : {}),
    ...(metadata.groupId ? { groupId: metadata.groupId } : {}),
    isSelected: false,
    isPdfImported: true,
    pdfAnnotationId: metadata.id,
    pdfAnnotationType: 'SurveyAppCallout',
    pdfAnnotationSubject: PDF_CALLOUT_SUBJECT,
  };
}

/**
 * Import all annotations from a PDF document
 * @param {PDFDocumentProxy} pdfDoc - PDF.js document
 * @returns {Promise<Object>} { annotationsByPage: {}, unsupportedTypes: [], unsupportedCounts: {} }
 */
export async function importAnnotationsFromPdf(pdfDoc, options = {}) {
  const annotationsByPage = {};
  const calloutsByPage = {};
  const unsupportedTypes = new Set();
  const unsupportedCounts = {};
  const numPages = pdfDoc.numPages;
  const [rawAnnotationIndex, appLayerState] = await Promise.all([
    buildRawAnnotationMetadataById(options.rawPdfBytes),
    readAppLayerStateFromPdf(options.rawPdfBytes),
  ]);
  const rawMetadataById = rawAnnotationIndex?.metadataById || null;
  const rawDirectCandidatesByPage =
    rawAnnotationIndex?.directCandidatesByPage || new Map();
  const rawAnnotationsByPage = rawAnnotationIndex?.rawAnnotationsByPage || new Map();
  const diagnosticsByPage = {};
  const nativeLayerPolicyByPage = {};
  let counterAnnotationsImported = 0;
  let plainCirclesImported = 0;
  let counterMetadataParseFailures = 0;
  let appCalloutAnnotationsImported = 0;
  let appCalloutPiecesSkipped = 0;

  // Pages are independent: each writes only its own page-keyed slots, and the
  // cross-page counters/Set are commutative. Process pages concurrently (bounded
  // so a large doc does not spike pdf.js worker memory) instead of paying one
  // serial getPage+getAnnotations round-trip per page, then fold results in page
  // order so the returned maps are identical to the old sequential loop.
  const processPage = async (pageNum) => {
    const localUnsupported = new Set();
    const localUnsupportedCounts = new Map();
    const counts = {
      counterAnnotationsImported: 0,
      plainCirclesImported: 0,
      counterMetadataParseFailures: 0,
      appCalloutAnnotationsImported: 0,
      appCalloutPiecesSkipped: 0,
    };
    try {
      const page = await pdfDoc.getPage(pageNum);
      const rotation = Number.isFinite(Number(page.rotate)) ? Number(page.rotate) : 0;
      const viewport = page.getViewport({ scale: 1, rotation });

      const annotations = await extractAnnotationsFromPage(page);
      const observedAnnotationIds = new Set(annotations.flatMap((annotation) => (
        [annotation?.id, annotation?.name].filter(Boolean).map(String)
      )));
      const remainingObservedDirectBySubtype = new Map();
      annotations.forEach((annotation) => {
        if (!/^annot_p\d+_\d+$/i.test(String(annotation?.id || ''))) return;
        remainingObservedDirectBySubtype.set(
          annotation.subtype,
          (remainingObservedDirectBySubtype.get(annotation.subtype) || 0) + 1,
        );
      });
      const unreadableRawAnnotations = (rawAnnotationsByPage.get(pageNum) || []).filter((raw) => (
        raw?.subtype
        && !SILENT_IGNORE_SUBTYPES.includes(raw.subtype)
        && !(Number(raw.flags) & (PDF_ANNOTATION_FLAG_HIDDEN | PDF_ANNOTATION_FLAG_NO_VIEW))
        && Array.isArray(raw.ids)
        && (raw.ids.length > 0
          ? !raw.ids.some((id) => observedAnnotationIds.has(String(id)))
          : (() => {
              const remaining = remainingObservedDirectBySubtype.get(raw.subtype) || 0;
              if (remaining <= 0) return true;
              remainingObservedDirectBySubtype.set(raw.subtype, remaining - 1);
              return false;
            })())
      ));
      const directNativeIdentities = buildDirectPdfNativeAnnotationIdentities(
        annotations,
        pageNum,
        rawDirectCandidatesByPage.get(pageNum) || [],
      );
      const { supported: supportedRaw, unsupported } = categorizeAnnotations(annotations);
      const rawDiag = annotations.map((annotation) => {
        const rawMetadata = getRawAnnotationMetadataForAnnotation(annotation, rawMetadataById);
        return summarizePdfAnnotationForDiag(annotation, rawMetadata);
      }).filter(Boolean);

      // Track unsupported types + per-subtype counts. The counts feed the
      // user-facing "N stamps aren't displayed" notice, so dedupe by /NM id
      // (same Mac Preview duplicate-copy defense as the supported path below)
      // to count distinct annotations rather than Preview re-save copies.
      // NOTE: only genuinely-invisible types land here — anything the app
      // imports and renders (even as a locked proxy: sticky notes,
      // underline/strikeout/squiggly) goes through `supported` instead, and
      // Link/Popup/Widget companions are silently ignored upstream.
      const lastUnsupportedIndexById = new Map();
      unsupported.forEach((ann, index) => {
        const idKey = ann?.id || ann?.name || null;
        if (idKey) lastUnsupportedIndexById.set(idKey, index);
      });
      const uniqueUnsupported = unsupported.filter((ann, index) => {
        const idKey = ann?.id || ann?.name || null;
        return Boolean(
          ann?.subtype
          && (!idKey || lastUnsupportedIndexById.get(idKey) === index)
        );
      });
      uniqueUnsupported.forEach(ann => {
        localUnsupported.add(ann.subtype);
        localUnsupportedCounts.set(
          ann.subtype,
          (localUnsupportedCounts.get(ann.subtype) || 0) + 1
        );
      });

      // UX 2026-04-21: Cross-editor defense — Mac Preview (Quartz
      // PDFContext) writes a brand-new copy of every annotation on every
      // save via incremental updates, so a PDF opened / saved twice in
      // Preview arrives with each markup duplicated. PDF.js surfaces all
      // copies with identical /NM (unique-name) tags. Dedupe by /NM,
      // keeping the LAST occurrence (Preview's most recent revision comes
      // last in the page's /Annots array). Annotations without /NM (older
      // / hand-edited PDFs) always pass through — we can't safely match.
      const seenNM = new Map();
      supportedRaw.forEach((ann, idx) => {
        const nm = typeof ann?.annotationFlags === 'number' ? null : null;
        // PDF.js surfaces the /NM string as annotation.id in the standard
        // shape, but some versions expose annotation.name — check both.
        const key = ann?.id || ann?.name || null;
        if (key) seenNM.set(key, idx);
      });
      const supported = supportedRaw.filter((ann, idx) => {
        const key = ann?.id || ann?.name || null;
        if (!key) return true;
        return seenNM.get(key) === idx;
      });

      // Convert supported annotations to Fabric.js objects
      const fabricObjects = [];
      const appCalloutsById = new Map();
      const importedDiag = [];
      unreadableRawAnnotations.forEach((raw) => {
        localUnsupported.add(raw.subtype);
        localUnsupportedCounts.set(
          raw.subtype,
          (localUnsupportedCounts.get(raw.subtype) || 0) + 1,
        );
        importedDiag.push({
          ...summarizeFabricImportForDiag(null, null, 'skipped', 'pdfjs-annotation-not-readable'),
          rawId: raw.ids[0] || null,
          rawSubtype: raw.subtype,
          savedToAppState: false,
        });
      });
      const stampAnnotations = supported.filter((annotation) => annotation?.subtype === 'Stamp');
      let stampAppearanceDataUrls = new Map();
      if (stampAnnotations.length > 0 && !options.diagnosticsOnly) {
        try {
          const renderStampAppearances = options.renderStampAppearances || renderPdfStampAppearances;
          stampAppearanceDataUrls = await renderStampAppearances(page, stampAnnotations);
        } catch (error) {
          console.warn('Failed to render imported stamp appearances:', error);
        }
      }

      for (const annotation of supported) {
        try {
          const rawMetadata = getRawAnnotationMetadataForAnnotation(annotation, rawMetadataById);
          const normalized = applyRawMetadataToAnnotation(annotation, rawMetadata);
          if (!isSaneImportedAnnotationGeometry(normalized, viewport)) {
            localUnsupported.add(normalized.subtype || 'Unknown');
            localUnsupportedCounts.set(
              normalized.subtype || 'Unknown',
              (localUnsupportedCounts.get(normalized.subtype || 'Unknown') || 0) + 1,
            );
            importedDiag.push(summarizeFabricImportForDiag(
              null,
              annotation,
              'skipped',
              'invalid-annotation-geometry',
            ));
            continue;
          }
          if (
            normalized.calloutMetadata?.kind === PDF_CALLOUT_SUBJECT &&
            normalized.calloutMetadata?.type === 'callout'
          ) {
            const appCallout = normalizeImportedAppCallout(normalized.calloutMetadata);
            if (appCallout) {
              appCalloutsById.set(appCallout.id, appCallout);
              counts.appCalloutPiecesSkipped++;
              importedDiag.push({
                status: 'app-callout-piece-grouped',
                reason: 'survey-app-callout-metadata',
                importOutcome: 'sampled',
                importOutcomeReason: 'survey-app-callout-metadata',
                rawId: annotation?.id || annotation?.name || null,
                rawSubtype: annotation?.subtype || null,
                appId: appCallout.id,
                appType: 'callout',
                calloutPart: normalized.calloutMetadata.part || null,
                savedToAppState: true,
              });
              continue;
            }
          }
          const counterMetadataParseFailed = (
            normalized.subtype === 'Circle' &&
            normalized.subject === PDF_COUNTER_SUBJECT &&
            !normalized.counterMetadata
          );
          if (counterMetadataParseFailed) {
            counts.counterMetadataParseFailures++;
            console.warn('[PDFCounterImport] counter marker found but metadata was not parseable', {
              id: normalized.id || normalized.name || null,
              metadataKey: PDF_COUNTER_METADATA_KEY
            });
          }

          const converted = convertPdfAnnotationToFabric(
            annotation,
            viewport,
            1,
            rawMetadata,
            {
              stampAppearanceDataUrl: stampAppearanceDataUrls.get(annotation.id || annotation.name),
            },
          );
          const convertedObjects = converted
            ? [
                converted,
                ...(converted[PDF_APPEARANCE_COMPANION_LAYERS] || []),
              ]
            : [];
          const fabricObjectsForAnnotation = convertedObjects.map((fabricObject) => (
            attachPdfNativeAnnotationIdentity(
              fabricObject,
              directNativeIdentities.get(annotation),
            )
          ));
          const fabricObj = fabricObjectsForAnnotation[0] || null;
          if (fabricObj) {
            if (!options.diagnosticsOnly) {
              fabricObjects.push(...fabricObjectsForAnnotation);
            }
            if (fabricObj?.data?.type === 'counter') {
              counts.counterAnnotationsImported++;
            } else if (fabricObj?.pdfAnnotationType === 'Circle' || fabricObj?.type === 'circle') {
              counts.plainCirclesImported++;
            }
            const diagEntry = summarizeFabricImportForDiag(fabricObj, annotation);
            if (counterMetadataParseFailed) {
              diagEntry.importOutcome = 'fallback';
              diagEntry.importOutcomeReason = 'counter-metadata-unparseable';
            }
            importedDiag.push(diagEntry);
          } else {
            if (annotation?.subtype === 'Stamp') {
              localUnsupported.add('Stamp');
              localUnsupportedCounts.set(
                'Stamp',
                (localUnsupportedCounts.get('Stamp') || 0) + 1,
              );
              importedDiag.push(summarizeFabricImportForDiag(
                null,
                annotation,
                'native-only',
                'unsupported-renderable-native-annotation',
              ));
              continue;
            }
            importedDiag.push(summarizeFabricImportForDiag(null, annotation, 'skipped', 'converter-returned-null'));
            localUnsupported.add(annotation?.subtype || 'Unknown');
            localUnsupportedCounts.set(
              annotation?.subtype || 'Unknown',
              (localUnsupportedCounts.get(annotation?.subtype || 'Unknown') || 0) + 1,
            );
          }
        } catch (error) {
          console.error(
            `Error importing annotation ${annotation?.id || annotation?.name || '(unknown)'} from page ${pageNum}:`,
            error && (error.stack || error.message || error),
            error,
          );
          importedDiag.push({
            ...summarizeFabricImportForDiag(
              null,
              annotation,
              'skipped',
              'annotation-import-failed',
            ),
            errorName: error?.name || null,
            errorMessage: error?.message || String(error),
          });
          localUnsupported.add(annotation?.subtype || 'Unknown');
          localUnsupportedCounts.set(
            annotation?.subtype || 'Unknown',
            (localUnsupportedCounts.get(annotation?.subtype || 'Unknown') || 0) + 1,
          );
        }
      }

      uniqueUnsupported.forEach((annotation) => {
        const rawMetadata = getRawAnnotationMetadataForAnnotation(annotation, rawMetadataById);
        if (isPotentiallyVisibleNativeAnnotation(annotation, rawMetadata)) {
          importedDiag.push(summarizeFabricImportForDiag(null, annotation, 'native-only', 'unsupported-renderable-native-annotation'));
        } else {
          importedDiag.push(summarizeFabricImportForDiag(null, annotation, 'skipped', 'unsupported-nonrenderable-annotation'));
        }
      });

      const importedIds = new Set(importedDiag
        .filter((entry) => (
          (entry?.status === 'imported' || entry?.status === 'app-callout-piece-grouped') &&
          entry.rawId
        ))
        .map((entry) => entry.rawId));
      const renderableNative = [...supported, ...uniqueUnsupported].filter((annotation) => {
        const rawMetadata = getRawAnnotationMetadataForAnnotation(annotation, rawMetadataById);
        return isPotentiallyVisibleNativeAnnotation(annotation, rawMetadata);
      });
      const nativeOnly = renderableNative.filter((annotation) => !importedIds.has(annotation.id || annotation.name));
      const hideNativeLayer = renderableNative.length > 0 && nativeOnly.length === 0;

      const diag = {
        pageNumber: pageNum,
        rawAnnotations: rawDiag,
        importedAnnotations: importedDiag,
        nativeRenderableAnnotationIds: renderableNative.map((annotation) => annotation.id || annotation.name || null).filter(Boolean),
        nativeOnlyAnnotationIds: nativeOnly.map((annotation) => annotation.id || annotation.name || null).filter(Boolean),
      };
      const policy = {
        pageNumber: pageNum,
        hideNativeLayer,
        reason: hideNativeLayer
          ? 'all-renderable-native-annotations-imported-as-editable-app-annotations'
          : (renderableNative.length === 0
              ? 'no-renderable-native-annotations'
              : 'renderable-native-annotations-not-imported'),
        importedIds: Array.from(importedIds),
        nativeRenderableAnnotationIds: diag.nativeRenderableAnnotationIds,
        nativeOnlyAnnotationIds: diag.nativeOnlyAnnotationIds,
      };

      let annot = null;
      if (fabricObjects.length > 0) {
        annot = { objects: fabricObjects };
      }
      let callouts = null;
      if (appCalloutsById.size > 0) {
        const calloutEntries = Array.from(appCalloutsById.values());
        callouts = calloutEntries;
        counts.appCalloutAnnotationsImported += calloutEntries.length;
      }

      return { pageNum, annot, callouts, diag, policy, unsupported: localUnsupported, unsupportedCounts: localUnsupportedCounts, counts };
    } catch (error) {
      console.error(
        `Error importing annotations from page ${pageNum}:`,
        error && (error.stack || error.message || error),
        error
      );
      const readableRaw = (rawAnnotationsByPage.get(pageNum) || []).filter((raw) => (
        raw?.subtype
        && !SILENT_IGNORE_SUBTYPES.includes(raw.subtype)
        && !(Number(raw.flags) & (PDF_ANNOTATION_FLAG_HIDDEN | PDF_ANNOTATION_FLAG_NO_VIEW))
      ));
      const failedEntries = readableRaw.length > 0 ? readableRaw : [{ subtype: 'Page', ids: [] }];
      failedEntries.forEach((raw) => {
        localUnsupported.add(raw.subtype);
        localUnsupportedCounts.set(
          raw.subtype,
          (localUnsupportedCounts.get(raw.subtype) || 0) + 1,
        );
      });
      const pageFailures = failedEntries.map((raw) => ({
        ...summarizeFabricImportForDiag(null, null, 'skipped', 'page-import-failed'),
        rawId: raw.ids?.[0] || null,
        rawSubtype: raw.subtype,
        pageNumber: pageNum,
        errorName: error?.name || null,
        errorMessage: error?.message || String(error),
      }));
      return {
        pageNum,
        annot: null,
        callouts: null,
        diag: {
          pageNumber: pageNum,
          rawAnnotations: [],
          importedAnnotations: pageFailures,
          nativeRenderableAnnotationIds: [],
          nativeOnlyAnnotationIds: [],
        },
        policy: {
          pageNumber: pageNum,
          hideNativeLayer: false,
          reason: 'page-import-failed',
          importedIds: [],
          nativeRenderableAnnotationIds: [],
          nativeOnlyAnnotationIds: [],
        },
        unsupported: localUnsupported,
        unsupportedCounts: localUnsupportedCounts,
        counts: {
          counterAnnotationsImported: 0,
          plainCirclesImported: 0,
          counterMetadataParseFailures: 0,
          appCalloutAnnotationsImported: 0,
          appCalloutPiecesSkipped: 0,
        },
      };
    }
  };

  // Bounded fan-out: at most CONCURRENCY pages decode at once; a shared cursor
  // hands the next page to whichever worker frees up first.
  const CONCURRENCY = 8;
  const pageResults = new Array(numPages);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, numPages) }, async () => {
      while (cursor < numPages) {
        const idx = cursor++;
        pageResults[idx] = await processPage(idx + 1);
      }
    })
  );

  // Fold in strict page order so every map and counter is identical to the old
  // sequential loop (addition is commutative; order kept for determinism).
  for (const r of pageResults) {
    if (!r) continue;
    if (r.annot) annotationsByPage[r.pageNum] = r.annot;
    if (r.callouts) calloutsByPage[r.pageNum] = r.callouts;
    diagnosticsByPage[r.pageNum] = r.diag;
    nativeLayerPolicyByPage[r.pageNum] = r.policy;
    r.unsupported.forEach((t) => unsupportedTypes.add(t));
    r.unsupportedCounts.forEach((n, t) => {
      unsupportedCounts[t] = (unsupportedCounts[t] || 0) + n;
    });
    counterAnnotationsImported += r.counts.counterAnnotationsImported;
    plainCirclesImported += r.counts.plainCirclesImported;
    counterMetadataParseFailures += r.counts.counterMetadataParseFailures;
    appCalloutAnnotationsImported += r.counts.appCalloutAnnotationsImported;
    appCalloutPiecesSkipped += r.counts.appCalloutPiecesSkipped;
  }

  if (typeof window !== 'undefined') {
    window.__pdfEmbeddedAnnotationDiag = diagnosticsByPage;
    window.__pdfImportedAnnotationDiag = diagnosticsByPage;
    window.__nativePdfAnnotationLayerDiag = nativeLayerPolicyByPage;
  }

  const importStatistics = buildPdfImportStatisticsSummary(diagnosticsByPage, {
    pdfName: options.pdfName || (
      typeof window !== 'undefined' ? window.__currentPdfName : null
    ),
    pageCount: numPages,
    diagnosticsOnly: options.diagnosticsOnly,
  });
  if (typeof window !== 'undefined') {
    window.__pdfImportStatistics = importStatistics;
  }
  pdfImportDebug('[PDFImportStatistics] summary ' + JSON.stringify(importStatistics));

  pdfImportDebug('[PDFCounterImport] summary ' + JSON.stringify({
    marker: PDF_COUNTER_SUBJECT,
    metadataKey: PDF_COUNTER_METADATA_KEY,
    counterAnnotationsImported,
    plainCirclesImported,
    counterMetadataParseFailures,
    appCalloutMarker: PDF_CALLOUT_SUBJECT,
    appCalloutMetadataKey: PDF_CALLOUT_METADATA_KEY,
    appCalloutAnnotationsImported,
    appCalloutPiecesSkipped
  }));
  pdfImportDebug('[PDFAppLayerStateImport] summary ' + JSON.stringify({
    found: Boolean(appLayerState),
    documentId: appLayerState?.documentId || null,
    exportId: appLayerState?.exportId || null,
    scopedAnnotationPages: Object.keys(appLayerState?.layers?.scopedAnnotationsByPage || {}).length,
    scopedCallouts: Array.isArray(appLayerState?.layers?.callouts) ? appLayerState.layers.callouts.length : 0,
    // readSurveyMarkerLayer handles both new 'surveyMarkers' and legacy 'highlightAnnotations'
    surveyMarkers: Object.keys(
      appLayerState?.layers?.surveyMarkers ||
      appLayerState?.layers?.highlightAnnotations ||
      {}
    ).length,
    spaces: Array.isArray(appLayerState?.layers?.spaces) ? appLayerState.layers.spaces.length : 0,
  }));

  return {
    annotationsByPage,
    calloutsByPage,
    appLayerState,
    unsupportedTypes: Array.from(unsupportedTypes),
    // Per-subtype counts of genuinely-invisible native annotations
    // (e.g. { Stamp: 2, Sound: 1 }) — feeds the user-facing notice.
    unsupportedCounts,
    diagnosticsByPage,
    nativeLayerPolicyByPage,
    importStatistics
  };
}

/**
 * Cheap counts-only scan of annotation types the app cannot display.
 * Used on cloud-authoritative documents, where the full import (and its
 * pdf-lib raw-bytes parse) is skipped for perf but the user-facing
 * "N stamps aren't displayed" notice still needs per-subtype counts.
 * Only calls getAnnotations per page — no conversion, no raw-metadata parse.
 * Same classification as importAnnotationsFromPdf: supported/displayed types
 * and silently-ignored companions (Link/Popup/Widget) never count; duplicate
 * /NM ids (Mac Preview re-save copies) count once.
 * @param {PDFDocumentProxy} pdfDoc - PDF.js document
 * @returns {Promise<Object>} { [subtype]: count } e.g. { Stamp: 2 }
 */
export async function countUnsupportedAnnotations(pdfDoc) {
  const numPages = pdfDoc.numPages;
  const counts = {};
  const CONCURRENCY = 8;
  const pageResults = new Array(numPages);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, numPages) }, async () => {
      while (cursor < numPages) {
        const idx = cursor++;
        try {
          const page = await pdfDoc.getPage(idx + 1);
          const annotations = await extractAnnotationsFromPage(page);
          const { unsupported } = categorizeAnnotations(annotations);
          const localCounts = new Map();
          const seenIds = new Set();
          unsupported.forEach((ann) => {
            if (!ann.subtype) return;
            const idKey = ann?.id || ann?.name || null;
            if (idKey) {
              if (seenIds.has(idKey)) return;
              seenIds.add(idKey);
            }
            localCounts.set(ann.subtype, (localCounts.get(ann.subtype) || 0) + 1);
          });
          pageResults[idx] = localCounts;
        } catch {
          pageResults[idx] = null;
        }
      }
    })
  );
  for (const localCounts of pageResults) {
    if (!localCounts) continue;
    localCounts.forEach((n, t) => {
      counts[t] = (counts[t] || 0) + n;
    });
  }
  return counts;
}
