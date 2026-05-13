export const PDF_COUNTER_METADATA_KEY = 'SurveyApp';
export const PDF_COUNTER_SUBJECT = 'survey-counter';
export const PDF_COUNTER_METADATA_VERSION = 1;

export function buildPdfCounterMetadata(fabricObj, pageNumber = null) {
  if (!fabricObj || fabricObj?.data?.type !== 'counter') return null;

  const data = fabricObj.data || {};
  const id = fabricObj.id || data.id || null;
  const radius = Math.abs(Number(fabricObj.radius) || 0) * Math.abs(Number(fabricObj.scaleX) || 1);
  const left = Number(fabricObj.left) || 0;
  const top = Number(fabricObj.top) || 0;
  const centerX = left + radius;
  const centerY = top + radius;
  const pointerAngle = data.pointerAngle ?? null;
  const pointerAngleRad = Number.isFinite(Number(pointerAngle)) ? (Number(pointerAngle) * Math.PI) / 180 : null;
  const tipDistance = radius + Math.max(5, radius * 0.5);

  return {
    app: 'SurveyApp',
    kind: PDF_COUNTER_SUBJECT,
    version: PDF_COUNTER_METADATA_VERSION,
    id,
    pageNumber: Number.isFinite(Number(pageNumber)) ? Number(pageNumber) : null,
    type: 'counter',
    number: data.displayNumber ?? data.number ?? null,
    displayNumber: data.displayNumber ?? data.number ?? null,
    color: fabricObj.fill || data.color || null,
    radius: Number.isFinite(radius) && radius > 0 ? radius : (Number(fabricObj.radius) || null),
    left,
    top,
    position: {
      left,
      top,
      centerX,
      centerY,
    },
    pointerAngle,
    pointer: {
      angle: pointerAngle,
      tipDistance,
      tipX: pointerAngleRad === null ? null : centerX + Math.cos(pointerAngleRad) * tipDistance,
      tipY: pointerAngleRad === null ? null : centerY + Math.sin(pointerAngleRad) * tipDistance,
    },
    series: {
      id: data.seriesId ?? null,
      name: data.seriesName ?? null,
      color: data.seriesColor ?? fabricObj.fill ?? data.color ?? null,
      start: data.seriesStart ?? null,
    },
    group: {
      id: data.groupId ?? data.counterGroupId ?? null,
      sequence: data.sequence ?? data.displayNumber ?? data.number ?? null,
    },
    data: {
      createdAt: data.createdAt ?? null,
      numberColor: data.numberColor ?? null,
      seriesId: data.seriesId ?? null,
      seriesName: data.seriesName ?? null,
      seriesColor: data.seriesColor ?? null,
      seriesStart: data.seriesStart ?? null,
      groupId: data.groupId ?? null,
      counterGroupId: data.counterGroupId ?? null,
      sequence: data.sequence ?? null,
    },
  };
}

export function serializePdfCounterMetadata(fabricObj, pageNumber = null) {
  const metadata = buildPdfCounterMetadata(fabricObj, pageNumber);
  return metadata ? JSON.stringify(metadata) : null;
}

export function parsePdfCounterMetadata(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;

  try {
    const parsed = JSON.parse(rawValue);
    if (
      parsed?.app === 'SurveyApp' &&
      parsed?.kind === PDF_COUNTER_SUBJECT &&
      parsed?.type === 'counter'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}
