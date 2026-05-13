export const PDF_APP_ANNOTATION_METADATA_KEY = 'SurveyAppAnnotation';
export const PDF_APP_ANNOTATION_SUBJECT = 'survey-app-annotation';
export const PDF_APP_ANNOTATION_METADATA_VERSION = 1;

const DATA_ALLOWLIST = [
  'id',
  'type',
  'tool',
  'annoId',
  'highlightId',
  'source',
  'sourceType',
  'isSurveyHighlight',
  'pdfInkRenderMode',
  'pdfLineEndings',
  'pdfIntent',
  'pdfCalloutPoints',
  'createdAt',
  'updatedAt',
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
  'lineHeight',
  'charSpacing',
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
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'path',
  'text',
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

function jsonSafe(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth > 4) return null;

  if (Array.isArray(value)) {
    return value.slice(0, 500).map((entry) => jsonSafe(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (typeof entry === 'function') return;
      out[key] = jsonSafe(entry, depth + 1);
    });
    return out;
  }

  return null;
}

function pick(source, keys) {
  const out = {};
  keys.forEach((key) => {
    if (source?.[key] !== undefined) {
      out[key] = jsonSafe(source[key]);
    }
  });
  return out;
}

function pickData(data) {
  if (!data || typeof data !== 'object') return {};
  const out = {};
  DATA_ALLOWLIST.forEach((key) => {
    if (data[key] !== undefined) out[key] = jsonSafe(data[key]);
  });
  return out;
}

function resolveAppType(fabricObj, item = {}) {
  if (item.type === 'highlight' || fabricObj?.exportType === 'highlight') return 'highlight';
  if (fabricObj?.data?.type && fabricObj.data.type !== 'counter') return fabricObj.data.type;
  if (fabricObj?.tool === 'arrow') return 'arrow';
  return fabricObj?.exportType || fabricObj?.type || item.type || null;
}

export function buildPdfAppAnnotationMetadata(fabricObj, item = {}) {
  if (!fabricObj || typeof fabricObj !== 'object') return null;
  if (fabricObj?.data?.type === 'counter') return null;
  if (item.type === 'callout' || fabricObj.type === 'callout' || fabricObj?.data?.type === 'callout') return null;

  const id = item.id || fabricObj.id || fabricObj.data?.id || fabricObj.highlightId || null;
  const appType = resolveAppType(fabricObj, item);
  if (!id || !appType) return null;

  const pageNumber = Number(item.pageNumber ?? fabricObj.pageNumber);
  const data = pickData(fabricObj.data);
  const style = pick(fabricObj, STYLE_KEYS);
  const geometry = pick(fabricObj, GEOMETRY_KEYS);
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
      isSurveyHighlight: item.type === 'highlight' || fabricObj.exportType === 'highlight',
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
    data,
    ...(metadata.moduleId ? { moduleId: metadata.moduleId } : {}),
    ...(metadata.regionId ? { regionId: metadata.regionId } : {}),
    ...(metadata.spaceId ? { spaceId: metadata.spaceId } : {}),
    ...(metadata.layer ? { layer: metadata.layer } : {}),
  };

  if (metadata.appType === 'highlight') {
    out.highlightId = metadata.id;
  }

  if (metadata.ownership && typeof metadata.ownership === 'object') {
    out.meta = {
      ...(fabricObj.meta || {}),
      ...metadata.ownership,
    };
  }

  return out;
}
