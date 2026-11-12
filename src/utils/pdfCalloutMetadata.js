/**
 * pdfCalloutMetadata.js — serializes/parses callout annotation metadata embedded
 * in exported PDFs under the "survey-callout" subject.
 *
 * Exports build/serialize/parsePdfCalloutMetadata plus the PDF_CALLOUT_* key/subject/
 * version constants. Captures the full callout geometry (arrowTip, knee, textBox
 * position/size), text, style, and layer scoping (module/region/space/group ids)
 * so callouts round-trip through PDF export/import.
 * Part of the separate callout pipeline — see docs/ANNOTATION-CONTRACT.md.
 */
export const PDF_CALLOUT_METADATA_KEY = 'SurveyAppCallout';
export const PDF_CALLOUT_SUBJECT = 'survey-callout';
export const PDF_CALLOUT_METADATA_VERSION = 1;

const finiteOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizePoint = (point) => {
  if (!point || typeof point !== 'object') return null;
  const x = finiteOrNull(point.x);
  const y = finiteOrNull(point.y);
  return x === null || y === null ? null : { x, y };
};

export function buildPdfCalloutMetadata(callout, pageNumber = null, part = null) {
  if (!callout || typeof callout !== 'object') return null;

  const id = callout.id || callout.annotationId || null;
  const arrowTip = normalizePoint(callout.arrowTip);
  const knee = normalizePoint(callout.knee);
  const textBoxPosition = normalizePoint(callout.textBoxPosition || callout.textBox);
  const textBoxWidth = finiteOrNull(callout.textBoxWidth ?? callout.textBox?.width);
  const textBoxHeight = finiteOrNull(callout.textBoxHeight ?? callout.textBox?.height);

  if (!id || !arrowTip || !knee || !textBoxPosition || textBoxWidth === null || textBoxHeight === null) {
    return null;
  }

  return {
    app: 'SurveyApp',
    kind: PDF_CALLOUT_SUBJECT,
    version: PDF_CALLOUT_METADATA_VERSION,
    id,
    part: part || null,
    pageNumber: Number.isFinite(Number(pageNumber)) ? Number(pageNumber) : null,
    type: 'callout',
    text: callout.text || '',
    style: callout.style && typeof callout.style === 'object' ? callout.style : {},
    arrowTip,
    knee,
    textBoxPosition,
    textBoxWidth,
    textBoxHeight,
    moduleId: callout.moduleId ?? callout.spaceId ?? null,
    regionId: callout.regionId ?? null,
    spaceId: callout.spaceId ?? null,
    layer: callout.layer ?? null,
    groupId: callout.groupId ?? null,
  };
}

export function serializePdfCalloutMetadata(callout, pageNumber = null, part = null) {
  const metadata = buildPdfCalloutMetadata(callout, pageNumber, part);
  return metadata ? JSON.stringify(metadata) : null;
}

export function parsePdfCalloutMetadata(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;

  try {
    const parsed = JSON.parse(rawValue);
    if (
      parsed?.app === 'SurveyApp' &&
      parsed?.kind === PDF_CALLOUT_SUBJECT &&
      parsed?.type === 'callout' &&
      parsed?.id
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}
