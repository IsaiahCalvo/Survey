import { fabricObjectToDbType } from '../services/annotationTypeSerializers.js';

export const CRDT_FAN_OUT_EXCLUDED_TYPES = new Set(['highlight', 'survey-marker', 'callout']);

export function getRawAnnotationTypeForFanOut(fabricObj) {
  return fabricObj?.data?.annotationType
    || fabricObj?.data?.type
    || fabricObj?.tool
    || fabricObj?.type
    || 'unknown';
}

export function resolveCrdtFanOutAnnotationType(fabricObj, supportedDbTypes) {
  const explicitType = fabricObj?.data?.annotationType;
  if (CRDT_FAN_OUT_EXCLUDED_TYPES.has(explicitType)) {
    return {
      dispatchable: false,
      annotationType: explicitType,
      rawType: getRawAnnotationTypeForFanOut(fabricObj),
      reason: explicitType,
    };
  }

  const dbType = fabricObjectToDbType(fabricObj);
  if (
    dbType
    && (!Array.isArray(supportedDbTypes) || supportedDbTypes.includes(dbType))
    && !CRDT_FAN_OUT_EXCLUDED_TYPES.has(dbType)
  ) {
    return {
      dispatchable: true,
      annotationType: dbType,
      rawType: getRawAnnotationTypeForFanOut(fabricObj),
      reason: 'supported',
    };
  }

  if (CRDT_FAN_OUT_EXCLUDED_TYPES.has(dbType)) {
    return {
      dispatchable: false,
      annotationType: dbType,
      rawType: getRawAnnotationTypeForFanOut(fabricObj),
      reason: dbType,
    };
  }

  return {
    dispatchable: false,
    annotationType: dbType || explicitType || fabricObj?.type || 'unknown',
    rawType: getRawAnnotationTypeForFanOut(fabricObj),
    reason: 'unsupported-type',
  };
}
