/**
 * pdfAppAnnotationMetadata.js — serializes/parses the app's own annotation metadata
 * embedded in exported PDFs (the "survey-app-annotation" and "SurveyAppLayerState" blobs).
 *
 * Exports build/serialize/parse/applyPdfAppAnnotationMetadata for per-object round-trip
 * (style, geometry, ownership, data allowlists) and build/serialize/parsePdfAppLayerStateMetadata
 * plus readSurveyMarkerLayer for the document-level layer state. Handles the legacy
 * highlightAnnotations → surveyMarkers rename on both read and write.
 * Part of the separate survey-marker pipeline — see docs/ANNOTATION-CONTRACT.md.
 */
import { SURVEY_MARKER_TYPE, isSurveyMarkerType } from './surveyMarkerType.js';

export const PDF_APP_ANNOTATION_METADATA_KEY = 'SurveyAppAnnotation';
export const PDF_APP_ANNOTATION_SUBJECT = 'survey-app-annotation';
export const PDF_APP_ANNOTATION_METADATA_VERSION = 1;
export const PDF_APP_LAYER_STATE_KEY = 'SurveyAppLayerState';
export const PDF_APP_LAYER_STATE_VERSION = 1;
const DEFAULT_METADATA_ARRAY_LIMIT = 500;
// Exact annotation geometry is source data, not a preview. Truncating a long
// path silently changes its final endpoint after PDF export/reimport.
const GEOMETRY_METADATA_ARRAY_LIMIT = Number.POSITIVE_INFINITY;

const DATA_ALLOWLIST = [
  'id',
  'type',
  'tool',
  'annoId',
  'annotationId',
  'source',
  'sourceType',
  'isSurveyHighlight',
  'isSurveyMarker',
  'pdfInkRenderMode',
  'pdfStrokeHairline',
  'pdfInkSourceGeometry',
  'pdfInkPresentationGeometry',
  'groupId',
  'pdfAppearanceCompositeId',
  'pdfAppearanceSourceAnnotationId',
  'pdfAppearanceLayerIndex',
  'pdfAppearancePaintOperationIndex',
  'pdfAppearanceLayerKind',
  'inkGeometrySpace',
  'inkGeometryOrigin',
  'pdfLineEndings',
  'pdfIntent',
  'pdfCalloutPoints',
  'createdAt',
  'updatedAt',
  'arrowheadStyle',
  'lineEnding1',
  'lineEnding2',
  'pdfCloudIntensity',
  'pdfCloudPathD',
];

const STYLE_KEYS = [
  'fill',
  'stroke',
  'strokeWidth',
  'strokeDashArray',
  'strokeLineCap',
  'strokeLineJoin',
  'strokeUniform',
  'opacity',
  'backgroundColor',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'textAlign',
  'verticalAlign',
  'underline',
  'linethrough',
  'lineHeight',
  'charSpacing',
  'fillRule',
  'globalCompositeOperation',
  'rx',
  'ry',
];

const GEOMETRY_KEYS = [
  'left',
  'top',
  'width',
  'height',
  'radius',
  'rx',
  'ry',
  'scaleX',
  'scaleY',
  'angle',
  'flipX',
  'flipY',
  'skewX',
  'skewY',
  'originX',
  'originY',
  'pathOffset',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'path',
  'cmds',
  'polygons',
  'paperCenterline',
  'paperCenterlineRuns',
  'sourceWidth',
  'paperInkGeometry',
  'paperEraserGeometry',
  'paperSourceStroke',
  'paperEraserCuts',
  'paperEraserBaseTransform',
  'inkGeometrySpace',
  'inkGeometryOrigin',
  'text',
  'lineEnding1',
  'lineEnding2',
  'arrowheadStyle',
];

const OWNER_KEYS = [
  'authorId',
  'authorName',
  'ownerId',
  'ownerName',
  'createdBy',
  'createdByName',
  'updatedBy',
  'userId',
];

function jsonSafe(value, depth = 0, arrayLimit = DEFAULT_METADATA_ARRAY_LIMIT) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth > 8) return null;

  if (Array.isArray(value)) {
    return value.slice(0, arrayLimit).map((entry) => jsonSafe(entry, depth + 1, arrayLimit));
  }

  if (typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (typeof entry === 'function') return;
      out[key] = jsonSafe(entry, depth + 1, arrayLimit);
    });
    return out;
  }

  return null;
}

function pick(source, keys, arrayLimit = DEFAULT_METADATA_ARRAY_LIMIT) {
  const out = {};
  keys.forEach((key) => {
    if (source?.[key] !== undefined) {
      out[key] = jsonSafe(source[key], 0, arrayLimit);
    }
  });
  return out;
}

function pickData(data) {
  if (!data || typeof data !== 'object') return {};
  const out = {};
  DATA_ALLOWLIST.forEach((key) => {
    if (data[key] !== undefined) {
      const isGeometryCarrier = (
        key === 'pdfInkSourceGeometry'
        || key === 'pdfInkPresentationGeometry'
      );
      out[key] = jsonSafe(
        data[key],
        0,
        isGeometryCarrier ? GEOMETRY_METADATA_ARRAY_LIMIT : DEFAULT_METADATA_ARRAY_LIMIT,
      );
    }
  });
  return out;
}

function resolveAppType(fabricObj, item = {}) {
  // Survey markers (formerly "surveyMarkers") — write the new type name; reading
  // still works via isSurveyMarkerType which accepts both old and new values.
  if (isSurveyMarkerType(item.type) || isSurveyMarkerType(fabricObj?.exportType)) {
    return SURVEY_MARKER_TYPE;
  }
  if (fabricObj?.data?.type && fabricObj.data.type !== 'counter') return fabricObj.data.type;
  if (fabricObj?.tool === 'arrow') return 'arrow';
  return fabricObj?.exportType || fabricObj?.type || item.type || null;
}

export function buildPdfAppAnnotationMetadata(fabricObj, item = {}) {
  if (!fabricObj || typeof fabricObj !== 'object') return null;
  if (fabricObj?.data?.type === 'counter') return null;
  if (item.type === 'callout' || fabricObj.type === 'callout' || fabricObj?.data?.type === 'callout') return null;

  const id = item.id || fabricObj.id || fabricObj.data?.id || fabricObj.annotationId || null;
  const appType = resolveAppType(fabricObj, item);
  if (!id || !appType) return null;

  const pageNumber = Number(item.pageNumber ?? fabricObj.pageNumber);
  const data = pickData(fabricObj.data);
  const style = pick(fabricObj, STYLE_KEYS);
  const geometry = pick(fabricObj, GEOMETRY_KEYS, GEOMETRY_METADATA_ARRAY_LIMIT);
  const ownership = {
    ...pick(fabricObj, OWNER_KEYS),
    ...pick(fabricObj.meta, OWNER_KEYS),
    ...pick(fabricObj.data, OWNER_KEYS),
  };

  return {
    app: 'SurveyApp',
    kind: PDF_APP_ANNOTATION_SUBJECT,
    version: PDF_APP_ANNOTATION_METADATA_VERSION,
    id,
    type: appType,
    appType,
    fabricType: fabricObj.type || item.fabricType || null,
    pdfExportType: item.type || fabricObj.exportType || fabricObj.type || null,
    pageNumber: Number.isFinite(pageNumber) ? pageNumber : null,
    moduleId: item.moduleId ?? fabricObj.moduleId ?? fabricObj.spaceId ?? null,
    regionId: item.regionId ?? fabricObj.regionId ?? null,
    spaceId: item.spaceId ?? fabricObj.spaceId ?? null,
    layer: fabricObj.layer ?? item.layer ?? null,
    source: item.source || fabricObj.source || null,
    flags: {
      tool: fabricObj.tool || null,
      exportType: fabricObj.exportType || null,
      // New name written going forward; legacy PDFs carry isSurveyHighlight —
      // both are kept in DATA_ALLOWLIST so old blobs still parse correctly.
      isSurveyMarker: isSurveyMarkerType(item.type) || isSurveyMarkerType(fabricObj.exportType),
      lineEnding1: fabricObj.lineEnding1 || fabricObj.data?.lineEnding1 || null,
      lineEnding2: fabricObj.lineEnding2 || fabricObj.data?.lineEnding2 || null,
      arrowheadStyle: fabricObj.arrowheadStyle || fabricObj.data?.arrowheadStyle || null,
    },
    ...(Object.keys(data).length > 0 ? { data } : {}),
    ...(Object.keys(style).length > 0 ? { style } : {}),
    ...(Object.keys(geometry).length > 0 ? { geometry } : {}),
    ...(Object.keys(ownership).length > 0 ? { ownership } : {}),
  };
}

export function serializePdfAppAnnotationMetadata(fabricObj, item = {}) {
  const metadata = buildPdfAppAnnotationMetadata(fabricObj, item);
  return metadata ? JSON.stringify(metadata) : null;
}

export function parsePdfAppAnnotationMetadata(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;

  try {
    const parsed = JSON.parse(rawValue);
    if (
      parsed?.app === 'SurveyApp' &&
      parsed?.kind === PDF_APP_ANNOTATION_SUBJECT &&
      parsed?.id &&
      parsed?.appType
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

export function applyPdfAppAnnotationMetadata(fabricObj, metadata) {
  if (!fabricObj || !metadata || metadata.kind !== PDF_APP_ANNOTATION_SUBJECT) {
    return fabricObj;
  }
  const style = metadata.style && typeof metadata.style === 'object' ? metadata.style : null;
  const geometry = metadata.geometry && typeof metadata.geometry === 'object' ? metadata.geometry : null;

  const data = {
    ...(fabricObj.data || {}),
    ...(metadata.data && typeof metadata.data === 'object' ? metadata.data : {}),
    id: metadata.id,
    type: metadata.appType,
    appAnnotationMetadata: metadata,
  };

  const out = {
    ...fabricObj,
    id: metadata.id,
    appAnnotationId: metadata.id,
    appAnnotationType: metadata.appType,
    pdfAnnotationSubject: PDF_APP_ANNOTATION_SUBJECT,
    tool: metadata.flags?.tool || (metadata.appType === 'arrow' ? 'arrow' : fabricObj.tool),
    data,
    ...(metadata.moduleId ? { moduleId: metadata.moduleId } : {}),
    ...(metadata.regionId ? { regionId: metadata.regionId } : {}),
    ...(metadata.spaceId ? { spaceId: metadata.spaceId } : {}),
    ...(metadata.layer ? { layer: metadata.layer } : {}),
  };

  if (style) {
    STYLE_KEYS.forEach((key) => {
      if (style[key] !== undefined) out[key] = jsonSafe(style[key]);
    });
  }

  if (geometry) {
    GEOMETRY_KEYS.forEach((key) => {
      if (geometry[key] !== undefined) {
        out[key] = jsonSafe(geometry[key], 0, GEOMETRY_METADATA_ARRAY_LIMIT);
      }
    });
  }

  if (metadata.flags?.lineEnding1 && out.lineEnding1 === undefined) {
    out.lineEnding1 = metadata.flags.lineEnding1;
  }
  if (metadata.flags?.lineEnding2 && out.lineEnding2 === undefined) {
    out.lineEnding2 = metadata.flags.lineEnding2;
  }
  if (metadata.flags?.arrowheadStyle && out.arrowheadStyle === undefined) {
    out.arrowheadStyle = metadata.flags.arrowheadStyle;
  }

  // Accept both new ('survey-marker') and legacy ('surveyMarker') appType values.
  if (isSurveyMarkerType(metadata.appType)) {
    out.annotationId = metadata.id;
    if (style?.fill !== undefined) out.fill = style.fill;
    if (style?.opacity !== undefined) out.opacity = style.opacity;
    if (style?.stroke !== undefined) out.stroke = style.stroke;
    if (style?.strokeWidth !== undefined) out.strokeWidth = style.strokeWidth;
  }

  if (metadata.ownership && typeof metadata.ownership === 'object') {
    out.meta = {
      ...(fabricObj.meta || {}),
      ...metadata.ownership,
    };
  }

  return out;
}

function cloneJson(value) {
  return jsonSafe(value);
}

function sanitizeSpacesForMetadata(spaces = []) {
  if (!Array.isArray(spaces)) return [];
  return cloneJson(spaces
    .filter((space) => space && typeof space === 'object')
    .map((space) => ({
      ...space,
      assignedPages: Array.isArray(space.assignedPages)
        ? space.assignedPages
          .filter((page) => page && typeof page === 'object')
          .map((page) => ({
            ...page,
            regions: Array.isArray(page.regions)
              ? page.regions.filter((region) => region && typeof region === 'object')
              : []
          }))
        : []
    })));
}

function hasScopedLayer(value) {
  return Boolean(
    value?.moduleId !== null && value?.moduleId !== undefined
    || value?.spaceId !== null && value?.spaceId !== undefined
    || value?.regionId !== null && value?.regionId !== undefined
  );
}

export function buildPdfAppLayerStateMetadata({
  documentId = null,
  exportId = null,
  annotationsByPage = {},
  callouts = [],
  // Accept both 'highlightAnnotations' (legacy callers) and 'surveyMarkers'
  // (new callers). highlightAnnotations kept for backward API compat.
  highlightAnnotations = {},
  surveyMarkers,
  spaces = [],
} = {}) {
  const scopedAnnotationsByPage = {};
  Object.entries(annotationsByPage || {}).forEach(([pageKey, pageData]) => {
    const objects = Array.isArray(pageData?.objects) ? pageData.objects : [];
    const scopedObjects = objects.filter((obj) => hasScopedLayer(obj) || obj?.annotationId);
    if (scopedObjects.length > 0) {
      scopedAnnotationsByPage[pageKey] = {
        ...(pageData || {}),
        objects: cloneJson(scopedObjects),
      };
    }
  });

  const scopedCallouts = (Array.isArray(callouts) ? callouts : []).filter((callout) => hasScopedLayer(callout));
  // Prefer the explicit surveyMarkers param if provided; fall back to the
  // legacy highlightAnnotations param so existing callers keep working.
  const markerSource = surveyMarkers !== undefined ? surveyMarkers : highlightAnnotations;
  const markers = markerSource && typeof markerSource === 'object'
    ? cloneJson(markerSource)
    : {};
  const normalizedSpaces = sanitizeSpacesForMetadata(spaces);

  const hasPayload = (
    Object.keys(scopedAnnotationsByPage).length > 0
    || scopedCallouts.length > 0
    || Object.keys(markers || {}).length > 0
    || normalizedSpaces.length > 0
  );

  if (!hasPayload && !documentId) return null;

  return {
    app: 'SurveyApp',
    kind: PDF_APP_LAYER_STATE_KEY,
    version: PDF_APP_LAYER_STATE_VERSION,
    documentId: documentId || null,
    exportId: exportId || null,
    exportedAt: new Date().toISOString(),
    layers: {
      scopedAnnotationsByPage,
      callouts: cloneJson(scopedCallouts),
      // New key — readers must also check legacy key via readSurveyMarkerLayer.
      surveyMarkers: markers || {},
      spaces: normalizedSpaces || [],
    },
  };
}

// Reads the survey-marker layer out of a parsed SurveyAppLayerState blob.
// New PDFs store it under layers.surveyMarkers; PDFs saved before the
// Survey Marker rename store it under layers.highlightAnnotations.
export function readSurveyMarkerLayer(parsed) {
  const layers = parsed && parsed.layers;
  if (!layers || typeof layers !== 'object') return {};
  if (layers.surveyMarkers && typeof layers.surveyMarkers === 'object') {
    return layers.surveyMarkers;
  }
  if (layers.highlightAnnotations && typeof layers.highlightAnnotations === 'object') {
    return layers.highlightAnnotations;
  }
  return {};
}

export function serializePdfAppLayerStateMetadata(payload) {
  return payload ? JSON.stringify(payload) : null;
}

export function parsePdfAppLayerStateMetadata(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;
  try {
    const parsed = JSON.parse(rawValue);
    if (
      parsed?.app === 'SurveyApp' &&
      parsed?.kind === PDF_APP_LAYER_STATE_KEY &&
      parsed?.version === PDF_APP_LAYER_STATE_VERSION &&
      parsed?.layers &&
      typeof parsed.layers === 'object'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}
