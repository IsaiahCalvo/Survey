/**
 * annotationSyncType.js — decides whether a Fabric object is dispatchable to the
 * CRDT fan-out and resolves its annotation type.
 *
 * Exports CRDT_FAN_OUT_EXCLUDED_TYPES (highlight, survey-marker, callout — handled
 * by their own pipelines), getRawAnnotationTypeForFanOut, and
 * resolveCrdtFanOutAnnotationType (maps a Fabric object to a supported DB type via
 * fabricObjectToDbType, returning dispatchable + reason). Excludes survey-marker
 * and callout, which belong to the separate pipelines — see docs/ANNOTATION-CONTRACT.md.
 */
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
