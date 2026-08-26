/**
 * PDF Annotation System using pdf-lib Low-Level API
 * Manually creates PDF annotations following PDF 1.7 specification
 * Compatible with Adobe Acrobat and all PDF readers
 */

import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import { deepClone } from './deepClone.js';
import {
  PDF_COUNTER_METADATA_KEY,
  PDF_COUNTER_SUBJECT,
  serializePdfCounterMetadata,
} from './pdfCounterMetadata.js';
import {
  PDF_CALLOUT_METADATA_KEY,
  PDF_CALLOUT_SUBJECT,
  serializePdfCalloutMetadata,
} from './pdfCalloutMetadata.js';
import {
  PDF_APP_ANNOTATION_METADATA_KEY,
  PDF_APP_ANNOTATION_SUBJECT,
  PDF_APP_LAYER_STATE_KEY,
  buildPdfAppLayerStateMetadata,
  serializePdfAppLayerStateMetadata,
  serializePdfAppAnnotationMetadata,
} from './pdfAppAnnotationMetadata.js';
import {
  applyFormFieldValuesToPdfDoc,
  collectFormFieldValues,
  isFormFieldObject,
} from './pdfFormFieldExport.js';
import {
  pdfDefaultAppearanceFontName,
  pdfStandardFontGroup,
  flattenedTextBlockOffset,
  flattenedTextInlineOffset,
  pdfFreeTextQuadding,
  resolveCalloutBoxFill,
  resolveTextboxBoxFill,
  wrapFlattenedTextLines,
} from './annotationStyleCatalog.js';
import { isSurveyMarkerType } from './surveyMarkerType.js';
import {
  ANNOTATION_VISIBILITY_SCOPE,
  getAnnotationVisibilityScope,
  getSpaceIdForRegionFromSpaces,
} from './annotationVisibilityRules.js';
import {
  commandsToPolygonSet,
  normalizeMultiPolygon,
} from './paperAnnotationGeometry.js';
import { normalizeOperationalInkPath } from './inkPathNormalization.js';
// KAL-405 — single-tap ink dots. Same detection rule and circle geometry the
// PDF importer uses, so a mark that renders on screen also lands in the file.
import {
  buildInkDotPathCommands,
  degenerateInkTapCenters,
  inkDotCollapseThreshold,
} from './inkTapDot.js';
import { createInkPathAffine } from './inkGeometryTransform.js';
// Callout leader arrowheads export via the SAME shared spec the arrow tool,
// SVG renderer, and canvas painter consume — one home for the head math
// (buildArrowheadRenderSpec in lineRenderHelpers.js). Pure JS, Node-safe.
import { ARROWHEAD_STYLES, buildArrowheadRenderSpec, calloutLineDashArray } from './lineRenderHelpers.js';
import { buildCloudPathCommands } from './pdfAnnotationImporter.js';
import { getCounterLabelLayout } from './counterGeometry.js';
import { getLineEndpoints } from './svgBoundingBox.js';

const pdfExportDebug = (...args) => {
  if (typeof window === 'undefined' || window.__PDF_EXPORT_DEBUG !== true) return;
  try { console.debug(...args); } catch { /* ignore debug logging failures */ }
};

const EXPORTABLE_FABRIC_TYPES = new Set([
  'path',
  'rect',
  'circle',
  // 'ellipse' is the imported rotated-ellipse form (Drawboard-style tilt
  // recovered from the /AP matrix at import). Missing from this set until
  // 2026-07-17, so an EDITED imported rotated ellipse was skipped
  // 'unsupported-type' and the exported file silently kept the stale native
  // shape (or lost it once the native dict was removed).
  'ellipse',
  'polygon',
  'polyline',
  'line',
  'textbox',
  'text',
  'i-text',
]);

const emptyExportCounts = () => ({
  totalObjectsConsidered: 0,
  objectsExported: 0,
  objectsSkipped: 0,
  pdfAnnotationsAdded: 0,
  importedNativeCopiesSkipped: 0,
  editedImportedCopiesExported: 0,
  editedImportedNativeCopiesRemoved: 0,
  editedImportedNativeCopiesRemoveMisses: 0,
  deletedImportedNativeCopiesRemoved: 0,
  deletedImportedNativeCopiesRemoveMisses: 0,
  byScope: {},
  byType: {},
  bySource: {},
  byRegion: {},
  bySpace: {},
  bySurvey: {},
  skippedByReason: {},
  skipped: [],
});

const increment = (target, key) => {
  const resolvedKey = key === null || key === undefined || key === '' ? 'none' : String(key);
  target[resolvedKey] = (target[resolvedKey] || 0) + 1;
};

const getObjectExportType = (obj) => {
  if (obj?.data?.type === 'counter') return 'counter';
  if (obj?.exportType) return obj.exportType;
  return obj?.type?.toLowerCase?.() || 'unknown';
};

const getObjectScope = (obj) => getAnnotationVisibilityScope({
  moduleId: obj?.moduleId ?? obj?.spaceId ?? null,
  regionId: obj?.regionId ?? null,
});

const getObjectId = (obj, fallback = null) => (
  obj?.id ||
  obj?.data?.id ||
  obj?.annotationId ||
  obj?.pdfAnnotationId ||
  fallback
);

const isPdfImportedObject = (obj) => Boolean(obj?.isPdfImported || obj?.pdfAnnotationId);

const isEditedPdfImportedObject = (obj) => (
  isPdfImportedObject(obj)
  && (
    obj?.pdfImportedEditState === 'edited'
    || obj?.data?.pdfImportedEditState === 'edited'
  )
);

const getPdfAppearanceCompositeId = (obj) => (
  obj?.data?.pdfAppearanceCompositeId
  || obj?.pdfAppearanceCompositeId
  || null
);

const getPrintableRegularScope = (obj) => {
  const hasModule = obj?.moduleId !== null && obj?.moduleId !== undefined;
  const hasSpace = obj?.spaceId !== null && obj?.spaceId !== undefined;
  const hasRegion = obj?.regionId !== null && obj?.regionId !== undefined;

  if (hasRegion && (hasModule || hasSpace)) return ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION;
  if (hasRegion) return ANNOTATION_VISIBILITY_SCOPE.REGION;
  if (hasSpace) return 'space';
  if (hasModule) return ANNOTATION_VISIBILITY_SCOPE.SURVEY;
  return ANNOTATION_VISIBILITY_SCOPE.CANVAS;
};

const clonePlain = (value) => deepClone(value);

// UX 2026-07-17 (print contract, investigated for the survey-marker print
// question): this builder feeds the "Print PDF with annotations…" path and is
// deliberately scoped to REGULAR (canvas-scope) viewer annotations only —
// what the user sees with no survey/space/region context active. Survey
// Markers are survey content, so they are excluded here BY DESIGN, together
// with all survey/space/region-scoped shapes and callouts (see the
// 'printable regular annotation filter excludes survey highlights' regression
// test). The surveyMarkers argument exists so diagnostics can report how many
// markers were excluded; the returned payload always carries an empty map.
// If survey printing is ever added, include ALL survey-scoped content
// (markers + shapes + callouts) in one coherent change, not markers alone.
// Note: callers (PDFViewer print path, tests) also pass `spaces`; it is
// intentionally not destructured — region scope is derived from each object's
// own regionId, so no region→space mapping is needed for this filter.
//
// KAL-91 (print parity with the export path's P1 policy): an EDITED imported
// copy is the annotation's current truth, so it passes this filter and
// flattens into the print; its stale native original is suppressed by the
// print writer (savePDFWithFlattenedRegularAnnotationsForPrint). UNEDITED
// imported copies stay excluded — their native annot already prints.
export function buildPrintableRegularAnnotationPayload({
  annotationsByPage = {},
  callouts = [],
  surveyMarkers = {},
} = {}) {
  const diagnostics = {
    included: {
      fabric: 0,
      callouts: 0,
      counters: 0,
      editedImportedCopies: 0,
    },
    excluded: {
      fabric: 0,
      callouts: 0,
      counters: 0,
      surveyMarkers: Object.keys(surveyMarkers || {}).length,
      importedPdfNativePreserved: 0,
    },
    excludedByScope: {
      survey: 0,
      region: 0,
      space: 0,
      'survey-region': 0,
    },
  };
  const printableAnnotationsByPage = {};

  // Same composite pre-pass as buildPdfExportAnnotationPlan: editing ONE
  // member of a pdfAppearanceCompositeId group makes the whole group the
  // replacement (the native appearance is a single annot).
  const editedAppearanceCompositeIds = new Set();
  Object.values(annotationsByPage || {}).forEach((pageData) => {
    (Array.isArray(pageData?.objects) ? pageData.objects : []).forEach((obj) => {
      const compositeId = getPdfAppearanceCompositeId(obj);
      if (compositeId && isEditedPdfImportedObject(obj)) {
        editedAppearanceCompositeIds.add(compositeId);
      }
    });
  });
  const isEditedImportedReplacement = (obj) => {
    if (isEditedPdfImportedObject(obj)) return true;
    const compositeId = getPdfAppearanceCompositeId(obj);
    return Boolean(
      isPdfImportedObject(obj)
      && compositeId
      && editedAppearanceCompositeIds.has(compositeId)
    );
  };

  const recordExcludedScope = (scope) => {
    if (scope !== ANNOTATION_VISIBILITY_SCOPE.CANVAS) {
      diagnostics.excludedByScope[scope] = (diagnostics.excludedByScope[scope] || 0) + 1;
    }
  };

  Object.entries(annotationsByPage || {}).forEach(([pageKey, pageData]) => {
    const objects = Array.isArray(pageData?.objects) ? pageData.objects : [];
    const printableObjects = [];

    objects.forEach((obj) => {
      const isCounter = obj?.data?.type === 'counter';
      if (obj?.annotationId) {
        diagnostics.excluded.surveyMarkers += 1;
        return;
      }
      const editedImportedReplacement = isEditedImportedReplacement(obj);
      if (isPdfImportedObject(obj) && !editedImportedReplacement) {
        diagnostics.excluded.importedPdfNativePreserved += 1;
        return;
      }

      const scope = getPrintableRegularScope(obj);
      if (scope !== ANNOTATION_VISIBILITY_SCOPE.CANVAS) {
        diagnostics.excluded.fabric += 1;
        if (isCounter) diagnostics.excluded.counters += 1;
        recordExcludedScope(scope);
        return;
      }

      diagnostics.included.fabric += 1;
      if (isCounter) diagnostics.included.counters += 1;
      if (editedImportedReplacement) diagnostics.included.editedImportedCopies += 1;
      printableObjects.push(clonePlain(obj));
    });

    if (printableObjects.length > 0) {
      printableAnnotationsByPage[pageKey] = {
        ...(pageData || {}),
        objects: printableObjects,
      };
    }
  });

  const printableCallouts = [];
  (Array.isArray(callouts) ? callouts : []).forEach((callout) => {
    const scope = getPrintableRegularScope(callout);
    if (scope !== ANNOTATION_VISIBILITY_SCOPE.CANVAS) {
      diagnostics.excluded.callouts += 1;
      recordExcludedScope(scope);
      return;
    }
    diagnostics.included.callouts += 1;
    printableCallouts.push(clonePlain(callout));
  });

  return {
    annotationsByPage: printableAnnotationsByPage,
    callouts: printableCallouts,
    surveyMarkers: {},
    diagnostics,
  };
}

const applyAppAnnotationMetadataToDict = (annotationDict, options = {}) => {
  if (!annotationDict || !options.appAnnotationMetadataJson) return;
  annotationDict.NM = PDFString.of(options.appAnnotationMetadata?.id || options.name || `survey-app-annotation-${Date.now()}`);
  annotationDict.Subj = PDFString.of(PDF_APP_ANNOTATION_SUBJECT);
  annotationDict[PDF_APP_ANNOTATION_METADATA_KEY] = PDFString.of(options.appAnnotationMetadataJson);
};

const applyAppLayerStateMetadataToPdf = (pdfDoc, payload) => {
  const json = serializePdfAppLayerStateMetadata(payload);
  if (!pdfDoc || !json) return false;
  pdfDoc.catalog.set(PDFName.of(PDF_APP_LAYER_STATE_KEY), PDFString.of(json));
  return true;
};

const makeSkipDetail = ({ source, pageNumber, id, type, scope, reason }) => ({
  source,
  pageNumber,
  id: id || null,
  type,
  scope,
  reason,
});

const recordConsidered = (diagnostics, item) => {
  diagnostics.totalObjectsConsidered += 1;
  increment(diagnostics.byScope, item.scope);
  increment(diagnostics.byType, item.type);
  increment(diagnostics.bySource, item.source);
  if (item.regionId) increment(diagnostics.byRegion, item.regionId);
  if (item.spaceId) increment(diagnostics.bySpace, item.spaceId);
  if (item.moduleId || item.spaceId) increment(diagnostics.bySurvey, item.moduleId || item.spaceId);
};

const recordSkip = (diagnostics, item, reason) => {
  diagnostics.objectsSkipped += 1;
  increment(diagnostics.skippedByReason, reason);
  diagnostics.skipped.push(makeSkipDetail({ ...item, reason }));
};

const normalizeSurveyMarkerBounds = (surveyMarker) => {
  const bounds = surveyMarker?.bounds || surveyMarker?.pdfCoordinates || surveyMarker || {};
  const left = Number(bounds.x ?? bounds.left);
  const top = Number(bounds.y ?? bounds.top);
  const width = Number(bounds.width ?? (Number(bounds.right) - Number(bounds.left)));
  const height = Number(bounds.height ?? (Number(bounds.bottom) - Number(bounds.top)));

  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return { left, top, width, height };
};

const surveyMarkerToFabricRect = (surveyMarker, annotationId) => {
  const bounds = normalizeSurveyMarkerBounds(surveyMarker);
  if (!bounds) return null;
  return {
    type: 'rect',
    exportType: 'survey-marker',
    annotationId,
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    fill: surveyMarker?.color || '#FFFF00',
    opacity: surveyMarker?.opacity ?? 0.3,
    moduleId: surveyMarker?.moduleId ?? surveyMarker?.spaceId ?? null,
    spaceId: surveyMarker?.spaceId ?? null,
    regionId: surveyMarker?.regionId ?? null,
  };
};

const calloutToExportObject = (callout, pageSize) => {
  if (!callout || !pageSize) return null;
  const width = Number(pageSize.width) || 0;
  const height = Number(pageSize.height) || 0;
  if (width <= 0 || height <= 0) return null;

  const textBoxPosition = callout.textBoxPosition || callout.textBox || {};
  return {
    type: 'callout',
    exportType: 'callout',
    id: callout.id || callout.annotationId || null,
    pageNumber: callout.pageNumber,
    moduleId: callout.moduleId ?? callout.spaceId ?? null,
    spaceId: callout.spaceId ?? null,
    regionId: callout.regionId ?? null,
    isPdfImported: callout.isPdfImported === true,
    pdfAnnotationId: callout.pdfAnnotationId || null,
    arrowTip: {
      x: Number(callout.arrowTip?.x ?? 0) * width,
      y: Number(callout.arrowTip?.y ?? 0) * height,
    },
    knee: {
      x: Number(callout.knee?.x ?? callout.arrowTip?.x ?? 0) * width,
      y: Number(callout.knee?.y ?? callout.arrowTip?.y ?? 0) * height,
    },
    textBox: {
      left: Number(textBoxPosition.x ?? 0) * width,
      top: Number(textBoxPosition.y ?? 0) * height,
      width: Math.max(18, Number(callout.textBoxWidth ?? callout.textBox?.width ?? 0.1) * width),
      height: Math.max(18, Number(callout.textBoxHeight ?? callout.textBox?.height ?? 0.05) * height),
    },
    originalCallout: callout,
    text: callout.text || '',
    style: callout.style || {},
  };
};

// UX 2026-07-17 (legacy arrow export): old saved documents store arrows as
// fabric GROUPS (a line child + optional triangle 'arrowHead' child — the
// exact shape renderArrow in svgAnnotationRenderers.jsx draws on screen and
// drawFlattenedObject already recurses for print). 'group' is not in
// EXPORTABLE_FABRIC_TYPES, so these arrows rendered on screen and printed but
// were silently DROPPED from PDF export as 'unsupported-type'. Map that one
// legacy shape onto the modern arrow form (type 'line' + ClosedArrow ending)
// so it rides the existing Line writer. Deliberately narrow: requires a line
// child with finite endpoints, so arbitrary groups (and callout/counter
// composites, which never reach here as bare groups) stay unexported.
const legacyArrowGroupToLine = (obj) => {
  if (String(obj?.type || '').toLowerCase() !== 'group') return null;
  if (obj?.data?.type === 'counter') return null;
  const children = Array.isArray(obj.objects) ? obj.objects : [];
  // fabric 7 toObject() capitalizes child types ('Line', 'Triangle') while
  // legacy fabric-5 saves store lowercase — compare lowercased (CLAUDE.md
  // 2026-07-08 gotcha), mirroring renderArrow's childType helper.
  const childType = (child) => String(child?.type || '').toLowerCase();
  const lineChild = children.find((child) => (
    child
    && childType(child) === 'line'
    && [child.x1, child.y1, child.x2, child.y2].every((value) => Number.isFinite(Number(value)))
  ));
  if (!lineChild) return null;
  const hasArrowHead = children.some((child) => (
    child && (child.name === 'arrowHead' || childType(child) === 'triangle')
  ));
  const left = Number(obj.left) || 0;
  const top = Number(obj.top) || 0;
  const { objects: _children, ...rest } = obj;
  return {
    ...rest,
    type: 'line',
    // Fold group left/top into world x1..y2, then zero the fabric bbox.
    // createLineAnnotation / drawFlattenedLine use getLineEndpoints
    // (left+width/2 + x1). Leaving the group left here double-offsets /L.
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    x1: left + Number(lineChild.x1),
    y1: top + Number(lineChild.y1),
    x2: left + Number(lineChild.x2),
    y2: top + Number(lineChild.y2),
    stroke: obj.stroke || lineChild.stroke || '#000000',
    strokeWidth: obj.strokeWidth || lineChild.strokeWidth || 2,
    ...(hasArrowHead ? { lineEnding2: 'ClosedArrow' } : {}),
  };
};

export function buildPdfExportAnnotationPlan({
  annotationsByPage = {},
  callouts = [],
  surveyMarkers = {},
  pageSizes = {},
  spaces = [],
} = {}) {
  const diagnostics = emptyExportCounts();
  const items = [];
  const editedAppearanceCompositeIds = new Set();
  Object.values(annotationsByPage || {}).forEach((pageData) => {
    (Array.isArray(pageData?.objects) ? pageData.objects : []).forEach((obj) => {
      const compositeId = getPdfAppearanceCompositeId(obj);
      if (compositeId && isEditedPdfImportedObject(obj)) {
        editedAppearanceCompositeIds.add(compositeId);
      }
    });
  });

  const consider = (item, obj) => {
    recordConsidered(diagnostics, item);
    // KAL-441: a value typed into the PDF's OWN form field is not an app
    // annotation — it is written straight into the document's AcroForm by
    // applyFormFieldValuesToPdfDoc, so it must not also be drawn as a shape.
    if (isFormFieldObject(obj)) {
      recordSkip(diagnostics, item, 'form-field-value-written-to-acroform');
      return;
    }
    const appearanceCompositeId = getPdfAppearanceCompositeId(obj);
    const editedImportedReplacement = (
      isEditedPdfImportedObject(obj)
      || (
        isPdfImportedObject(obj)
        && appearanceCompositeId
        && editedAppearanceCompositeIds.has(appearanceCompositeId)
      )
    );

    if (!pageSizes[String(item.pageNumber)] && !pageSizes[item.pageNumber]) {
      recordSkip(diagnostics, item, 'missing-page-size');
      return;
    }

    if (item.source === 'survey-marker') {
      recordSkip(diagnostics, item, 'survey-marker-export-excluded');
      return;
    }

    if (item.scope !== ANNOTATION_VISIBILITY_SCOPE.CANVAS) {
      recordSkip(diagnostics, item, 'scoped-annotation-export-excluded');
      return;
    }

    if (isPdfImportedObject(obj) && !editedImportedReplacement) {
      diagnostics.importedNativeCopiesSkipped += 1;
      recordSkip(diagnostics, item, 'imported-pdf-native-preserved');
      return;
    }

    if (editedImportedReplacement) {
      diagnostics.editedImportedCopiesExported += 1;
    }

    if (item.source === 'fabric' && obj?.annotationId) {
      recordSkip(diagnostics, item, 'legacy-survey-marker-rendered-from-marker-state');
      return;
    }

    if (!EXPORTABLE_FABRIC_TYPES.has(item.fabricType) && item.type !== 'callout' && !isSurveyMarkerType(item.type)) {
      recordSkip(diagnostics, item, 'unsupported-type');
      return;
    }

    diagnostics.objectsExported += 1;
    items.push({
      ...item,
      object: obj,
      editedImportedReplacement,
      appearanceCompositeId,
    });
  };

  Object.entries(annotationsByPage || {}).forEach(([pageKey, pageData]) => {
    const pageNumber = Number.parseInt(pageKey, 10);
    const objects = Array.isArray(pageData?.objects) ? pageData.objects : [];
    objects.forEach((rawObj, index) => {
      // UX 2026-07-17: legacy arrow groups export as their modern line form;
      // every other object passes through untouched (see legacyArrowGroupToLine).
      const obj = legacyArrowGroupToLine(rawObj) || rawObj;
      const scope = getObjectScope(obj);
      const regionId = obj?.regionId ?? null;
      const derivedSpaceId = regionId ? getSpaceIdForRegionFromSpaces(regionId, spaces) : null;
      const type = getObjectExportType(obj);
      consider({
        source: 'fabric',
        pageNumber,
        id: getObjectId(obj, `fabric-${pageNumber}-${index}`),
        type,
        fabricType: obj?.type?.toLowerCase?.() || 'unknown',
        scope,
        moduleId: obj?.moduleId ?? obj?.spaceId ?? null,
        regionId,
        spaceId: obj?.spaceId ?? derivedSpaceId ?? null,
      }, obj);
    });
  });

  Object.entries(surveyMarkers || {}).forEach(([annotationId, surveyMarker]) => {
    const pageNumber = Number(surveyMarker?.pageNumber || 1);
    const obj = surveyMarkerToFabricRect(surveyMarker, annotationId);
    const scope = getObjectScope(obj || surveyMarker);
    const regionId = surveyMarker?.regionId ?? null;
    const derivedSpaceId = regionId ? getSpaceIdForRegionFromSpaces(regionId, spaces) : null;
    const item = {
      source: 'survey-marker',
      pageNumber,
      id: annotationId,
      type: 'survey-marker',
      fabricType: 'rect',
      scope,
      moduleId: surveyMarker?.moduleId ?? surveyMarker?.spaceId ?? null,
      regionId,
      spaceId: surveyMarker?.spaceId ?? derivedSpaceId ?? null,
    };
    if (!obj) {
      recordConsidered(diagnostics, item);
      recordSkip(diagnostics, item, 'invalid-highlight-bounds');
      return;
    }
    consider(item, obj);
  });

  (Array.isArray(callouts) ? callouts : []).forEach((callout, index) => {
    const pageNumber = Number(callout?.pageNumber || 1);
    const pageSize = pageSizes[String(pageNumber)] || pageSizes[pageNumber];
    const obj = calloutToExportObject(callout, pageSize);
    const scope = getObjectScope(callout);
    const regionId = callout?.regionId ?? null;
    const derivedSpaceId = regionId ? getSpaceIdForRegionFromSpaces(regionId, spaces) : null;
    const item = {
      source: 'callout',
      pageNumber,
      id: getObjectId(callout, `callout-${index}`),
      type: 'callout',
      fabricType: 'callout',
      scope,
      moduleId: callout?.moduleId ?? callout?.spaceId ?? null,
      regionId,
      spaceId: callout?.spaceId ?? derivedSpaceId ?? null,
    };
    if (!obj) {
      recordConsidered(diagnostics, item);
      recordSkip(diagnostics, item, 'invalid-callout-geometry');
      return;
    }
    consider(item, obj);
  });

  return {
    contract: {
      version: 1,
      defaultScope: 'regular-viewer-annotations-only',
      includedScopes: [ANNOTATION_VISIBILITY_SCOPE.CANVAS],
      excludedScopes: [
        ANNOTATION_VISIBILITY_SCOPE.SURVEY,
        ANNOTATION_VISIBILITY_SCOPE.REGION,
        ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION,
      ],
      importedPdfNativeHandling: 'preserve-unedited-native-annots-skip-unedited-imported-copies-export-edited-imported-copies',
      visibilityHandling: 'export-regular-viewer-annotations-only-exclude-survey-spaces-regions',
    },
    items,
    diagnostics,
  };
}

/**
 * Convert hex color to RGB object for pdf-lib
 */
const hexToRGB = (hex) => {
  if (typeof hex === 'string') {
    const rgba = hex.match(/rgba?\(\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)/i);
    if (rgba) {
      return rgb(
        Math.max(0, Math.min(255, Number(rgba[1]))) / 255,
        Math.max(0, Math.min(255, Number(rgba[2]))) / 255,
        Math.max(0, Math.min(255, Number(rgba[3]))) / 255
      );
    }
  }
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return rgb(
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255
    );
  }
  return rgb(0, 0, 0);
};

const pdfNumberText = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  if (numeric === 0) return '0';
  const shortest = String(numeric);
  if (!/[eE]/.test(shortest)) return shortest;

  // PDF content streams do not formally accept exponent notation. Expand
  // JavaScript's shortest round-trippable representation into plain decimal
  // instead of rounding tiny/huge authored coordinates to fixed places.
  const [coefficient, exponentText] = shortest.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const negative = coefficient.startsWith('-');
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const dot = unsigned.indexOf('.');
  const digits = unsigned.replace('.', '');
  const decimalIndex = (dot >= 0 ? dot : unsigned.length) + exponent;
  let expanded;
  if (decimalIndex <= 0) {
    expanded = `0.${'0'.repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    expanded = `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  } else {
    expanded = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  }
  return negative ? `-${expanded}` : expanded;
};

const paintAlpha = (paint, opacity = 1) => {
  const rgba = typeof paint === 'string'
    ? paint.match(/rgba\(\s*[+-]?\d*\.?\d+\s*,\s*[+-]?\d*\.?\d+\s*,\s*[+-]?\d*\.?\d+\s*,\s*([+-]?\d*\.?\d+)\s*\)/i)
    : null;
  const paintOpacity = rgba ? Number(rgba[1]) : 1;
  const objectOpacity = Number.isFinite(Number(opacity)) ? Number(opacity) : 1;
  return Math.max(0, Math.min(1, paintOpacity * objectOpacity));
};

const isFilledPaperInk = (fabricObj) => Boolean(
  fabricObj?.paperInkGeometry
  || fabricObj?.paperEraserGeometry
  || (
    Array.isArray(fabricObj?.polygons)
    && fabricObj.polygons.length > 0
    && fabricObj.fill
    && fabricObj.fill !== 'none'
    && fabricObj.fill !== 'transparent'
    && Number(fabricObj.strokeWidth || 0) === 0
  )
);

const paperInkPolygons = (fabricObj) => {
  const persisted = normalizeMultiPolygon(fabricObj?.polygons);
  if (persisted.length) return persisted;
  return commandsToPolygonSet(normalizeOperationalInkPath(fabricObj?.path), { fill: true });
};

const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const pathCoordinateBounds = (path, polygons = [], centerline = []) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x, y) => {
    const numericX = Number(x);
    const numericY = Number(y);
    if (!Number.isFinite(numericX) || !Number.isFinite(numericY)) return;
    minX = Math.min(minX, numericX);
    minY = Math.min(minY, numericY);
    maxX = Math.max(maxX, numericX);
    maxY = Math.max(maxY, numericY);
  };
  for (const command of normalizeOperationalInkPath(path)) {
    for (let index = 1; index + 1 < command.length; index += 2) {
      include(command[index], command[index + 1]);
    }
  }
  if (!Number.isFinite(minX)) {
    for (const polygon of normalizeMultiPolygon(polygons)) {
      for (const ring of polygon) {
        for (const point of ring) include(point?.[0], point?.[1]);
      }
    }
  }
  if (!Number.isFinite(minX)) {
    for (const point of centerline || []) include(point?.x, point?.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
};

// Match SVGAnnotationLayer's path transform exactly:
// translate(left/top) → rotate around the scaled path-bounds center →
// scale → translate(-pathOffset). PDF writers bake this transform once into
// page-space coordinates because /InkList has no equivalent Fabric transform.
export const createInkPageTransform = (fabricObj, path, polygons = [], centerline = []) => {
  const affine = createInkPathAffine(fabricObj, path, { polygons, centerline });
  const point = (x, y) => {
    const transformed = affine.point(finiteNumber(x), finiteNumber(y));
    return [transformed.x, transformed.y];
  };
  return {
    ...affine,
    point,
  };
};

export const transformInkPath = (path, transform) => (
  normalizeOperationalInkPath(path).map((command) => {
  if (!Array.isArray(command) || command.length === 0) return command;
  const transformed = [command[0]];
  for (let index = 1; index + 1 < command.length; index += 2) {
    transformed.push(...transform.point(command[index], command[index + 1]));
  }
  return transformed;
  })
);

const transformInkPolygons = (polygons, transform) => (
  normalizeMultiPolygon(polygons).map((polygon) => polygon.map((ring) => (
    ring.map(([x, y]) => transform.point(x, y))
  )))
);

const multiplyInkMatrices = (left, right) => {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
};

const unionInkBounds = (left, right) => {
  if (!left) return right;
  if (!right) return left;
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
};

const operationalCurveMetrics = (path) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let current = null;
  let subpathStart = null;
  let subpathFirstTangent = null;
  let previousEndTangent = null;
  let subpathSegments = 0;
  const joins = [];
  const endpoints = [];

  const include = (point) => {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  };
  const hasCorner = (incoming, outgoing) => {
    if (!incoming || !outgoing) return false;
    const normalized = (vector) => {
      const scale = Math.max(Math.abs(vector[0]), Math.abs(vector[1]));
      if (scale === 0) return null;
      const x = vector[0] / scale;
      const y = vector[1] / scale;
      const length = Math.hypot(x, y);
      return length > 0 && Number.isFinite(length)
        ? [x / length, y / length]
        : null;
    };
    const incomingUnit = normalized(incoming);
    const outgoingUnit = normalized(outgoing);
    if (!incomingUnit || !outgoingUnit) return true;
    const cross = incomingUnit[0] * outgoingUnit[1]
      - incomingUnit[1] * outgoingUnit[0];
    const dot = incomingUnit[0] * outgoingUnit[0]
      + incomingUnit[1] * outgoingUnit[1];
    return (
      Math.abs(cross) > Number.EPSILON * 128
      || dot <= 0
    );
  };
  const finishOpenSubpath = () => {
    if (subpathSegments > 0 && subpathStart && current) {
      endpoints.push(subpathStart, current);
    }
  };
  const beginSegment = (startTangent) => {
    if (subpathSegments > 0 && hasCorner(previousEndTangent, startTangent)) {
      joins.push(current);
    }
    if (subpathSegments === 0) subpathFirstTangent = startTangent;
    subpathSegments += 1;
  };
  const nonzeroTangent = (...candidates) => (
    candidates.find((candidate) => (
      Array.isArray(candidate)
      && Math.hypot(candidate[0], candidate[1]) > 0
    )) || [0, 0]
  );
  const directionBetween = (from, to) => {
    const direct = [to[0] - from[0], to[1] - from[1]];
    if (direct.every(Number.isFinite)) return direct;
    const scale = Math.max(
      Math.abs(from[0]),
      Math.abs(from[1]),
      Math.abs(to[0]),
      Math.abs(to[1]),
      Number.MIN_VALUE,
    );
    return [
      to[0] / scale - from[0] / scale,
      to[1] / scale - from[1] / scale,
    ];
  };
  const lerpNumber = (from, to, t) => {
    const direct = (1 - t) * from + t * to;
    if (Number.isFinite(direct)) return direct;
    const scale = Math.max(Math.abs(from), Math.abs(to), Number.MIN_VALUE);
    return ((1 - t) * (from / scale) + t * (to / scale)) * scale;
  };
  const lerpPoint = (from, to, t) => [
    lerpNumber(from[0], to[0], t),
    lerpNumber(from[1], to[1], t),
  ];
  const quadraticPoint = (p0, p1, p2, t) => (
    lerpPoint(lerpPoint(p0, p1, t), lerpPoint(p1, p2, t), t)
  );
  const cubicPoint = (p0, p1, p2, p3, t) => {
    const p01 = lerpPoint(p0, p1, t);
    const p12 = lerpPoint(p1, p2, t);
    const p23 = lerpPoint(p2, p3, t);
    return lerpPoint(lerpPoint(p01, p12, t), lerpPoint(p12, p23, t), t);
  };
  const includeQuadraticAxis = (p0, p1, p2, axis) => {
    const scale = Math.max(
      Math.abs(p0[axis]),
      Math.abs(p1[axis]),
      Math.abs(p2[axis]),
      Number.MIN_VALUE,
    );
    const v0 = p0[axis] / scale;
    const v1 = p1[axis] / scale;
    const v2 = p2[axis] / scale;
    const d0 = v1 - v0;
    const d1 = v2 - v1;
    const denominator = d1 - d0;
    if (denominator === 0) return;
    const t = -d0 / denominator;
    if (t <= 0 || t >= 1) return;
    include(quadraticPoint(p0, p1, p2, t));
  };
  const derivativeRoots = (a, b, c) => {
    const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Number.MIN_VALUE);
    const aa = a / scale;
    const bb = b / scale;
    const cc = c / scale;
    if (Math.abs(aa) <= Number.EPSILON * 64) {
      return Math.abs(bb) <= Number.EPSILON * 64 ? [] : [-cc / bb];
    }
    const discriminant = bb * bb - 4 * aa * cc;
    if (discriminant < 0) return [];
    const root = Math.sqrt(Math.max(0, discriminant));
    return [(-bb + root) / (2 * aa), (-bb - root) / (2 * aa)];
  };
  const includeCubicAxis = (p0, p1, p2, p3, axis) => {
    const scale = Math.max(
      Math.abs(p0[axis]),
      Math.abs(p1[axis]),
      Math.abs(p2[axis]),
      Math.abs(p3[axis]),
      Number.MIN_VALUE,
    );
    const v0 = p0[axis] / scale;
    const v1 = p1[axis] / scale;
    const v2 = p2[axis] / scale;
    const v3 = p3[axis] / scale;
    const d0 = v1 - v0;
    const d1 = v2 - v1;
    const d2 = v3 - v2;
    for (const t of derivativeRoots(
      d0 - 2 * d1 + d2,
      2 * (d1 - d0),
      d0,
    )) {
      if (t <= 0 || t >= 1 || !Number.isFinite(t)) continue;
      include(cubicPoint(p0, p1, p2, p3, t));
    }
  };

  for (const command of path || []) {
    const op = String(command?.[0] || '').toUpperCase();
    if (op === 'M') {
      finishOpenSubpath();
      current = [finiteNumber(command[1]), finiteNumber(command[2])];
      subpathStart = current;
      subpathFirstTangent = null;
      previousEndTangent = null;
      subpathSegments = 0;
      include(current);
    } else if (op === 'L' && current) {
      const end = [finiteNumber(command[1]), finiteNumber(command[2])];
      const tangent = directionBetween(current, end);
      beginSegment(tangent);
      include(end);
      previousEndTangent = tangent;
      current = end;
    } else if (op === 'Q' && current) {
      const control = [finiteNumber(command[1]), finiteNumber(command[2])];
      const end = [finiteNumber(command[3]), finiteNumber(command[4])];
      const chord = directionBetween(current, end);
      const startTangent = nonzeroTangent(
        directionBetween(current, control),
        chord,
      );
      const endTangent = nonzeroTangent(
        directionBetween(control, end),
        chord,
      );
      beginSegment(startTangent);
      includeQuadraticAxis(current, control, end, 0);
      includeQuadraticAxis(current, control, end, 1);
      include(end);
      previousEndTangent = endTangent;
      current = end;
    } else if (op === 'C' && current) {
      const control1 = [finiteNumber(command[1]), finiteNumber(command[2])];
      const control2 = [finiteNumber(command[3]), finiteNumber(command[4])];
      const end = [finiteNumber(command[5]), finiteNumber(command[6])];
      const chord = directionBetween(current, end);
      const startTangent = nonzeroTangent(
        directionBetween(current, control1),
        directionBetween(current, control2),
        chord,
      );
      const endTangent = nonzeroTangent(
        directionBetween(control2, end),
        directionBetween(control1, end),
        chord,
      );
      beginSegment(startTangent);
      includeCubicAxis(current, control1, control2, end, 0);
      includeCubicAxis(current, control1, control2, end, 1);
      include(end);
      previousEndTangent = endTangent;
      current = end;
    } else if (op === 'Z' && current && subpathStart) {
      const tangent = directionBetween(current, subpathStart);
      if (Math.hypot(tangent[0], tangent[1]) > 0) {
        beginSegment(tangent);
        previousEndTangent = tangent;
        current = subpathStart;
      }
      if (hasCorner(previousEndTangent, subpathFirstTangent)) joins.push(subpathStart);
      subpathSegments = 0;
      previousEndTangent = null;
      subpathFirstTangent = null;
    }
  }
  finishOpenSubpath();
  return Number.isFinite(minX)
    ? {
        bounds: { minX, minY, maxX, maxY },
        joins,
        endpoints,
      }
    : null;
};

const transformedPaperSourceBounds = (source, matrix) => {
  if (
    !source
    || !Array.isArray(matrix)
    || matrix.length !== 6
    || !matrix.every(Number.isFinite)
  ) return null;
  const operationalPath = (
    Array.isArray(source.operationalPath) && source.operationalPath.length > 0
      ? source.operationalPath
      : normalizeOperationalInkPath(source.path)
  );
  if (!operationalPath.length) return null;
  const [a, b, c, d, e, f] = matrix;
  const pagePath = operationalPath.map((command) => {
    if (!Array.isArray(command) || command.length < 2) return command;
    const next = [command[0]];
    for (let index = 1; index + 1 < command.length; index += 2) {
      const x = finiteNumber(command[index]);
      const y = finiteNumber(command[index + 1]);
      next.push(
        a * x + c * y + e,
        b * x + d * y + f,
      );
    }
    return next;
  });
  const metrics = operationalCurveMetrics(pagePath);
  if (!metrics) return null;
  const controlBounds = pathCoordinateBounds(pagePath);
  const roundOutward = (value, { padX = 0, padY = 0 } = {}) => {
    let { minX, minY, maxX, maxY } = value;
    const xScale = Math.max(
      Math.abs(minX),
      Math.abs(maxX),
      Number.MIN_VALUE,
    );
    const yScale = Math.max(
      Math.abs(minY),
      Math.abs(maxY),
      Number.MIN_VALUE,
    );
    const minNormal = 2 ** -1022;
    if (controlBounds && xScale < minNormal) {
      minX = Math.min(minX, controlBounds.minX - padX);
      maxX = Math.max(maxX, controlBounds.maxX + padX);
    }
    if (controlBounds && yScale < minNormal) {
      minY = Math.min(minY, controlBounds.minY - padY);
      maxY = Math.max(maxY, controlBounds.maxY + padY);
    }
    const guardedXScale = Math.max(Math.abs(minX), Math.abs(maxX), Number.MIN_VALUE);
    const guardedYScale = Math.max(Math.abs(minY), Math.abs(maxY), Number.MIN_VALUE);
    const guardX = Math.max(
      Number.MIN_VALUE,
      guardedXScale * Number.EPSILON * 16,
    );
    const guardY = Math.max(
      Number.MIN_VALUE,
      guardedYScale * Number.EPSILON * 16,
    );
    return {
      minX: minX - guardX,
      minY: minY - guardY,
      maxX: maxX + guardX,
      maxY: maxY + guardY,
    };
  };
  if (source.paintMode === 'fill') return roundOutward(metrics.bounds);
  let bounds = metrics.bounds;

  const halfWidth = Math.max(0, Number(source.strokeWidth) || 0) / 2;
  const cap = String(source.strokeLineCap || 'round').toLowerCase();
  const join = String(source.strokeLineJoin || 'round').toLowerCase();
  const rowScaleX = Math.hypot(a, c);
  const rowScaleY = Math.hypot(b, d);
  const basePadX = halfWidth * rowScaleX;
  const basePadY = halfWidth * rowScaleY;
  bounds = {
    minX: bounds.minX - basePadX,
    minY: bounds.minY - basePadY,
    maxX: bounds.maxX + basePadX,
    maxY: bounds.maxY + basePadY,
  };
  const includePointPad = (point, factor) => {
    if (!point) return;
    bounds = unionInkBounds(bounds, {
      minX: point[0] - basePadX * factor,
      minY: point[1] - basePadY * factor,
      maxX: point[0] + basePadX * factor,
      maxY: point[1] + basePadY * factor,
    });
  };
  if (cap === 'square') {
    if (
      Array.isArray(source.strokeDashArray)
      && source.strokeDashArray.length > 0
    ) {
      const extraFactor = Math.SQRT2 - 1;
      bounds = {
        minX: bounds.minX - basePadX * extraFactor,
        minY: bounds.minY - basePadY * extraFactor,
        maxX: bounds.maxX + basePadX * extraFactor,
        maxY: bounds.maxY + basePadY * extraFactor,
      };
    } else {
      for (const endpoint of metrics.endpoints) includePointPad(endpoint, Math.SQRT2);
    }
  }
  if (join === 'miter') {
    const miterLimit = Math.max(1, Number(source.strokeMiterLimit) || 10);
    for (const point of metrics.joins) includePointPad(point, miterLimit);
  }
  return roundOutward(bounds, { padX: basePadX, padY: basePadY });
};

const polygonBounds = (polygons) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of normalizeMultiPolygon(polygons)) {
    for (const ring of polygon) {
      for (const point of ring) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
};

const createFilledPaperInkAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  const localPolygons = paperInkPolygons(fabricObj);
  const transform = createInkPageTransform(
    fabricObj,
    fabricObj?.path,
    localPolygons,
    fabricObj?.paperCenterline,
  );
  const polygons = transformInkPolygons(localPolygons, transform);
  const appearancePath = transformInkPath(fabricObj?.path, transform);
  const polygonGeometryBounds = polygonBounds(polygons);
  const appearancePathBounds = pathCoordinateBounds(appearancePath);
  const paperSource = fabricObj?.paperSourceStroke;
  const hasAnalyticPaperSource = Boolean(
    Array.isArray(paperSource?.path)
    && paperSource.path.length > 0
    && Array.isArray(paperSource?.matrix)
    && paperSource.matrix.length === 6
    && Array.isArray(fabricObj?.paperEraserCuts)
    && fabricObj.paperEraserCuts.length > 0
  );
  const sourcePageMatrix = hasAnalyticPaperSource
    ? multiplyInkMatrices(transform.matrix, paperSource.matrix)
    : null;
  const sourceBounds = hasAnalyticPaperSource
    ? transformedPaperSourceBounds(paperSource, sourcePageMatrix)
    : null;
  const bounds = unionInkBounds(
    unionInkBounds(polygonGeometryBounds, appearancePathBounds),
    sourceBounds,
  );
  if (!bounds) return null;

  const width = Math.max(0, bounds.maxX - bounds.minX);
  const height = Math.max(0, bounds.maxY - bounds.minY);
  const sourceIsFill = hasAnalyticPaperSource && paperSource.paintMode === 'fill';
  const sourcePath = hasAnalyticPaperSource
    ? (
        Array.isArray(paperSource.operationalPath)
        && paperSource.operationalPath.length > 0
          ? paperSource.operationalPath
          : normalizeOperationalInkPath(paperSource.path)
      )
    : [];
  const sourcePaint = hasAnalyticPaperSource
    ? (
        fabricObj.fill
        || (sourceIsFill ? paperSource.fill : paperSource.stroke)
      )
    : (fabricObj.fill || fabricObj.stroke || '#000000');
  const color = hexToRGB(sourcePaint || '#000000');
  const alpha = paintAlpha(sourcePaint, fabricObj.opacity);
  const useMultiply = fabricObj.globalCompositeOperation === 'multiply'
    || fabricObj.tool === 'highlighter';
  const needsGraphicsState = alpha < 0.99999 || useMultiply;
  const content = ['q'];
  if (needsGraphicsState) content.push('/GS0 gs');
  content.push(
    `${pdfNumberText(color.red)} ${pdfNumberText(color.green)} ${pdfNumberText(color.blue)} ${
      hasAnalyticPaperSource && !sourceIsFill ? 'RG' : 'rg'
    }`,
  );

  if (hasAnalyticPaperSource) {
    const pageCuts = transformInkPolygons(fabricObj.paperEraserCuts, transform);
    content.push(`0 0 ${pdfNumberText(width)} ${pdfNumberText(height)} re`);
    for (const polygon of pageCuts) {
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 3) continue;
        const end = (
          ring.length > 1
          && ring[0][0] === ring.at(-1)[0]
          && ring[0][1] === ring.at(-1)[1]
        ) ? ring.length - 1 : ring.length;
        content.push(
          `${pdfNumberText(ring[0][0] - bounds.minX)} `
          + `${pdfNumberText(bounds.maxY - ring[0][1])} m`,
        );
        for (let index = 1; index < end; index += 1) {
          content.push(
            `${pdfNumberText(ring[index][0] - bounds.minX)} `
            + `${pdfNumberText(bounds.maxY - ring[index][1])} l`,
          );
        }
        content.push('h');
      }
    }
    content.push('W*', 'n');

    const [a, b, c, d, e, f] = sourcePageMatrix;
    content.push(
      `${pdfNumberText(a)} ${pdfNumberText(-b)} `
      + `${pdfNumberText(c)} ${pdfNumberText(-d)} `
      + `${pdfNumberText(e - bounds.minX)} ${pdfNumberText(bounds.maxY - f)} cm`,
    );
    if (!sourceIsFill) {
      content.push(`${pdfNumberText(Math.max(0, Number(paperSource.strokeWidth) || 0))} w`);
      const cap = String(paperSource.strokeLineCap || 'round').toLowerCase();
      const join = String(paperSource.strokeLineJoin || 'round').toLowerCase();
      content.push(`${cap === 'round' ? 1 : cap === 'square' ? 2 : 0} J`);
      content.push(`${join === 'round' ? 1 : join === 'bevel' ? 2 : 0} j`);
      content.push(`${pdfNumberText(Math.max(1, Number(paperSource.strokeMiterLimit) || 10))} M`);
      const dash = Array.isArray(paperSource.strokeDashArray)
        ? paperSource.strokeDashArray.map((value) => Math.max(0, Number(value) || 0))
        : [];
      content.push(
        `[${dash.map(pdfNumberText).join(' ')}] `
        + `${pdfNumberText(Number(paperSource.strokeDashOffset) || 0)} d`,
      );
    }

    let cursor = null;
    let subpathStart = null;
    for (const command of sourcePath) {
      if (command[0] === 'M') {
        cursor = [finiteNumber(command[1]), finiteNumber(command[2])];
        subpathStart = cursor;
        content.push(`${pdfNumberText(cursor[0])} ${pdfNumberText(cursor[1])} m`);
      } else if (command[0] === 'L' && cursor) {
        cursor = [finiteNumber(command[1]), finiteNumber(command[2])];
        content.push(`${pdfNumberText(cursor[0])} ${pdfNumberText(cursor[1])} l`);
      } else if (command[0] === 'Q' && cursor) {
        const control = [finiteNumber(command[1]), finiteNumber(command[2])];
        const end = [finiteNumber(command[3]), finiteNumber(command[4])];
        const control1 = [
          cursor[0] + (2 / 3) * (control[0] - cursor[0]),
          cursor[1] + (2 / 3) * (control[1] - cursor[1]),
        ];
        const control2 = [
          end[0] + (2 / 3) * (control[0] - end[0]),
          end[1] + (2 / 3) * (control[1] - end[1]),
        ];
        content.push(
          `${pdfNumberText(control1[0])} ${pdfNumberText(control1[1])} `
          + `${pdfNumberText(control2[0])} ${pdfNumberText(control2[1])} `
          + `${pdfNumberText(end[0])} ${pdfNumberText(end[1])} c`,
        );
        cursor = end;
      } else if (command[0] === 'C' && cursor) {
        const end = [finiteNumber(command[5]), finiteNumber(command[6])];
        content.push(
          `${pdfNumberText(command[1])} ${pdfNumberText(command[2])} `
          + `${pdfNumberText(command[3])} ${pdfNumberText(command[4])} `
          + `${pdfNumberText(end[0])} ${pdfNumberText(end[1])} c`,
        );
        cursor = end;
      } else if (command[0] === 'Z') {
        content.push('h');
        cursor = subpathStart;
      }
    }
    content.push(
      sourceIsFill
        ? (paperSource.fillRule === 'evenodd' ? 'f*' : 'f')
        : 'S',
    );
  } else if (appearancePath.length > 0) {
    const toFormX = (x) => finiteNumber(x) - bounds.minX;
    const toFormY = (y) => bounds.maxY - finiteNumber(y);
    let cursor = null;
    let subpathStart = null;
    for (const command of appearancePath) {
      if (command[0] === 'M') {
        cursor = [toFormX(command[1]), toFormY(command[2])];
        subpathStart = cursor;
        content.push(`${pdfNumberText(cursor[0])} ${pdfNumberText(cursor[1])} m`);
      } else if (command[0] === 'L' && cursor) {
        cursor = [toFormX(command[1]), toFormY(command[2])];
        content.push(`${pdfNumberText(cursor[0])} ${pdfNumberText(cursor[1])} l`);
      } else if (command[0] === 'Q' && cursor) {
        const control = [toFormX(command[1]), toFormY(command[2])];
        const end = [toFormX(command[3]), toFormY(command[4])];
        const control1 = [
          cursor[0] + (2 / 3) * (control[0] - cursor[0]),
          cursor[1] + (2 / 3) * (control[1] - cursor[1]),
        ];
        const control2 = [
          end[0] + (2 / 3) * (control[0] - end[0]),
          end[1] + (2 / 3) * (control[1] - end[1]),
        ];
        content.push(
          `${pdfNumberText(control1[0])} ${pdfNumberText(control1[1])} `
          + `${pdfNumberText(control2[0])} ${pdfNumberText(control2[1])} `
          + `${pdfNumberText(end[0])} ${pdfNumberText(end[1])} c`,
        );
        cursor = end;
      } else if (command[0] === 'C' && cursor) {
        const end = [toFormX(command[5]), toFormY(command[6])];
        content.push(
          `${pdfNumberText(toFormX(command[1]))} ${pdfNumberText(toFormY(command[2]))} `
          + `${pdfNumberText(toFormX(command[3]))} ${pdfNumberText(toFormY(command[4]))} `
          + `${pdfNumberText(end[0])} ${pdfNumberText(end[1])} c`,
        );
        cursor = end;
      } else if (command[0] === 'Z') {
        content.push('h');
        cursor = subpathStart;
      }
    }
  } else {
    for (const polygon of polygons) {
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 3) continue;
        content.push(`${pdfNumberText(ring[0][0] - bounds.minX)} ${pdfNumberText(bounds.maxY - ring[0][1])} m`);
        const end = ring.length > 1
          && ring[0][0] === ring[ring.length - 1][0]
          && ring[0][1] === ring[ring.length - 1][1]
          ? ring.length - 1
          : ring.length;
        for (let index = 1; index < end; index += 1) {
          content.push(`${pdfNumberText(ring[index][0] - bounds.minX)} ${pdfNumberText(bounds.maxY - ring[index][1])} l`);
        }
        content.push('h');
      }
    }
  }
  if (!hasAnalyticPaperSource) {
    content.push(fabricObj?.fillRule === 'nonzero' ? 'f' : 'f*');
  }
  content.push('Q');

  const resources = {};
  if (needsGraphicsState) {
    resources.ExtGState = {
      GS0: {
        Type: 'ExtGState',
        ca: alpha,
        CA: alpha,
        ...(useMultiply ? { BM: 'Multiply' } : {}),
      },
    };
  }
  const appearance = pdfDoc.context.flateStream(`${content.join('\n')}\n`, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, width, height],
    Resources: resources,
  });
  const appearanceRef = pdfDoc.context.register(appearance);

  const useCenterlineFallback = !fabricObj.paperEraserGeometry
    && Array.isArray(fabricObj.paperCenterline)
    && fabricObj.paperCenterline.length > 0;
  const fallbackPaths = useCenterlineFallback
    ? [fabricObj.paperCenterline.map((point) => transform.point(point.x, point.y))]
    : polygons.flatMap((polygon) => polygon);
  const inkListArray = pdfDoc.context.obj(fallbackPaths.map((path) => (
    path.flatMap(([x, y]) => [PDFNumber.of(x), PDFNumber.of(pageHeight - y)])
  )));
  const fallbackWidth = useCenterlineFallback
    ? Number(fabricObj.sourceWidth || 1) * transform.strokeScale
    : 0;
  const annotationDict = {
    Type: 'Annot',
    Subtype: 'Ink',
    Rect: [
      bounds.minX,
      pageHeight - bounds.maxY,
      bounds.maxX,
      pageHeight - bounds.minY,
    ],
    InkList: inkListArray,
    C: [color.red, color.green, color.blue],
    CA: alpha,
    Border: [0, 0, fallbackWidth],
    AP: pdfDoc.context.obj({ N: appearanceRef }),
    Contents: PDFString.of(''),
    P: page.ref,
  };
  if (options.name) annotationDict.NM = PDFString.of(String(options.name));
  applyAppAnnotationMetadataToDict(annotationDict, options);
  return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
};

/**
 * KAL-405 — turn a PDF-imported pen TAP into the filled dot a pen actually
 * leaves behind, so it survives export. Returns a shallow clone shaped like
 * native filled paper ink, or null when the object is not a tap.
 *
 * Scoped to PDF-IMPORTED ink on purpose (provenance fields, which the
 * exporter is explicitly allowed to read — renderers and editors are not).
 * Strokes drawn inside Survey are never rewritten by this path.
 *
 * The circle is centred on the tap point in the object's OWN local path
 * coordinates and left/top are untouched: the path-bounds centre is therefore
 * unchanged, so the ink affine places the dot exactly where the tap was.
 */
const importedInkTapDotObject = (fabricObj, localPathData) => {
  const isPdfImportedInk = (
    (fabricObj?.isPdfImported === true || fabricObj?.data?.isPdfImported === true)
    && (
      fabricObj?.pdfAnnotationType === 'Ink'
      || fabricObj?.data?.pdfAnnotationType === 'Ink'
    )
  );
  if (!isPdfImportedInk) return null;

  const strokeWidth = Number(fabricObj?.strokeWidth);
  // Diameter = the pen width, matching how every reference viewer renders the
  // round cap of a zero-length stroke. A hairline pen still leaves one unit.
  const diameter = Number.isFinite(strokeWidth) && strokeWidth > 0 ? strokeWidth : 1;
  const centers = degenerateInkTapCenters(
    localPathData,
    inkDotCollapseThreshold(diameter),
  );
  if (!centers || centers.length === 0) return null;

  const radius = diameter / 2;
  const path = [];
  for (const center of centers) {
    path.push(...buildInkDotPathCommands(center.x, center.y, radius));
  }
  // Colour comes straight from the source annotation — no backdrop-dependent
  // transform, no "boost" that assumes a white page.
  const paint = fabricObj?.fill && fabricObj.fill !== 'none' && fabricObj.fill !== 'transparent'
    ? fabricObj.fill
    : (fabricObj?.stroke && fabricObj.stroke !== 'transparent' ? fabricObj.stroke : '#000000');
  return {
    ...fabricObj,
    path,
    polygons: null,
    fill: paint,
    stroke: 'transparent',
    strokeWidth: 0,
    paperInkGeometry: 'v1',
  };
};

/**
 * Convert Fabric.js path to PDF Ink annotation
 */
export const createInkAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    if (isFilledPaperInk(fabricObj)) {
      return createFilledPaperInkAnnotation(pdfDoc, page, fabricObj, pageHeight, options);
    }
    const localPathData = normalizeOperationalInkPath(fabricObj.path);
    if (!localPathData || localPathData.length === 0) {
      return null;
    }
    // KAL-405 export mirror — single-tap ink dots.
    // Import now substitutes a filled circle for an imported pen tap, so the
    // normal case reaches this function already flagged as filled paper ink
    // and returns above. This guard covers the leftovers: annotations saved
    // BEFORE the import fix, and any imported tap whose polygon derivation
    // failed. Without it a zero-travel /InkList would be written straight
    // back out — geometry that paints nothing — so the dot would show on
    // screen and still be missing from the exported PDF.
    const importedInkDot = importedInkTapDotObject(fabricObj, localPathData);
    if (importedInkDot) {
      return createFilledPaperInkAnnotation(
        pdfDoc,
        page,
        importedInkDot,
        pageHeight,
        options,
      );
    }
    const transform = createInkPageTransform(fabricObj, localPathData);
    const pathData = transformInkPath(localPathData, transform);

    // Build InkList - array of arrays of coordinates
    const inkList = [];
    let currentPath = [];
    let currentPathStart = null;

    pathData.forEach(cmd => {
      const command = cmd[0];
      if (command === 'M') {
        // Move - start new path if we have points
        if (currentPath.length > 0) {
          inkList.push(currentPath);
          currentPath = [];
        }
        // Add point (flip Y coordinate for PDF)
        currentPath.push(cmd[1], pageHeight - cmd[2]);
        currentPathStart = [cmd[1], pageHeight - cmd[2]];
      } else if (command === 'L') {
        // Line - add point
        currentPath.push(cmd[1], pageHeight - cmd[2]);
      } else if (command === 'Q') {
        // Quadratic bezier - use end point
        currentPath.push(cmd[3], pageHeight - cmd[4]);
      } else if (command === 'C') {
        // Cubic bezier - use end point
        currentPath.push(cmd[5], pageHeight - cmd[6]);
      } else if (command === 'Z' && currentPathStart) {
        const lastX = currentPath[currentPath.length - 2];
        const lastY = currentPath[currentPath.length - 1];
        if (lastX !== currentPathStart[0] || lastY !== currentPathStart[1]) {
          currentPath.push(...currentPathStart);
        }
      }
    });

    // Add final path
    if (currentPath.length > 0) {
      inkList.push(currentPath);
    }

    if (inkList.length === 0) {
      return null;
    }

    // Calculate bounding rect
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pathData.forEach(cmd => {
      const command = cmd[0];
      if (command === 'M' || command === 'L') {
        minX = Math.min(minX, cmd[1]);
        maxX = Math.max(maxX, cmd[1]);
        minY = Math.min(minY, pageHeight - cmd[2]);
        maxY = Math.max(maxY, pageHeight - cmd[2]);
      } else if (command === 'Q') {
        minX = Math.min(minX, cmd[1], cmd[3]);
        maxX = Math.max(maxX, cmd[1], cmd[3]);
        minY = Math.min(minY, pageHeight - cmd[2], pageHeight - cmd[4]);
        maxY = Math.max(maxY, pageHeight - cmd[2], pageHeight - cmd[4]);
      } else if (command === 'C') {
        minX = Math.min(minX, cmd[1], cmd[3], cmd[5]);
        maxX = Math.max(maxX, cmd[1], cmd[3], cmd[5]);
        minY = Math.min(minY, pageHeight - cmd[2], pageHeight - cmd[4], pageHeight - cmd[6]);
        maxY = Math.max(maxY, pageHeight - cmd[2], pageHeight - cmd[4], pageHeight - cmd[6]);
      }
    });

    // Get color
    const color = hexToRGB(fabricObj.stroke || '#000000');

    // Create InkList PDF array
    const inkListArray = pdfDoc.context.obj(
      inkList.map(path => path.map(coord => PDFNumber.of(coord)))
    );

    // UX 2026-07-17 (item 3, thin-stroke ink /AP): bake a stroked appearance
    // stream so thin pen strokes render identically in every viewer instead
    // of leaving each reader to improvise from /InkList (which drops the
    // bezier smoothing and cap/join style). Mirrors the filled-paper-ink
    // writer's form construction, but strokes the real M/L/Q/C path.
    //
    // GOTCHA (form-space flip — same trap as createFilledPaperInkAnnotation,
    // see also the drawSvgPath origin GOTCHAs below): the form's content is
    // authored in y-up form space relative to the /BBox origin, so app-space
    // (y-down) points map via (appMaxY - y) — do NOT pre-flip with getPdfY
    // (that lands the stroke outside the BBox because it flips around the
    // PAGE height, not the annotation's own bounds).
    const isPdfStrokeHairline = (
      fabricObj?.pdfStrokeHairline === true
      || fabricObj?.data?.pdfStrokeHairline === true
    );
    const localStrokeWidth = isPdfStrokeHairline
      ? 0
      : (Number(fabricObj.strokeWidth) || 1);
    const strokeWidth = isPdfStrokeHairline
      ? 0
      : localStrokeWidth * transform.strokeScale;
    const alpha = paintAlpha(fabricObj.stroke, fabricObj.opacity);
    // Keep the complete affine matrix in the appearance stream. Baking only
    // the centerline plus one scalar width loses nonuniform resize geometry.
    // The conservative max-axis pad prevents that transformed stroke from
    // clipping while leaving /BBox and /Rect at a 1:1 mapping.
    const pad = isPdfStrokeHairline
      ? 0.5
      : localStrokeWidth * transform.maxScale / 2;
    const appMinX = minX;
    const appMaxY = pageHeight - minY; // largest app-space (y-down) y
    const [a, b, c, d, e, f] = transform.matrix;
    const formMatrix = [
      a,
      -b,
      c,
      -d,
      e - appMinX + pad,
      appMaxY - f + pad,
    ];
    const n = pdfNumberText;
    const apContent = ['q'];
    if (alpha < 0.99999) apContent.push('/GS0 gs');
    const cap = String(fabricObj.strokeLineCap || 'round').toLowerCase();
    const join = String(fabricObj.strokeLineJoin || 'round').toLowerCase();
    const capCode = cap === 'butt' ? 0 : (cap === 'square' ? 2 : 1);
    const joinCode = join === 'miter' ? 0 : (join === 'bevel' ? 2 : 1);
    const dash = Array.isArray(fabricObj.strokeDashArray)
      ? fabricObj.strokeDashArray.map((value) => Math.max(0, finiteNumber(value)))
      : [];
    apContent.push(
      `${n(color.red)} ${n(color.green)} ${n(color.blue)} RG`,
      `${n(localStrokeWidth)} w`,
      `${capCode} J`,
      `${joinCode} j`,
      ...(joinCode === 0
        ? [`${n(Math.max(1, finiteNumber(fabricObj.strokeMiterLimit, 10)))} M`]
        : []),
      ...(dash.length
        ? [`[${dash.map(n).join(' ')}] ${n(finiteNumber(fabricObj.strokeDashOffset))} d`]
        : []),
      `${formMatrix.map(n).join(' ')} cm`,
    );
    let formCursor = null;
    let formSubpathStart = null;
    localPathData.forEach((cmd) => {
      const command = cmd[0];
      if (command === 'M') {
        formCursor = [finiteNumber(cmd[1]), finiteNumber(cmd[2])];
        formSubpathStart = formCursor;
        apContent.push(`${n(formCursor[0])} ${n(formCursor[1])} m`);
      } else if (command === 'L' && formCursor) {
        formCursor = [finiteNumber(cmd[1]), finiteNumber(cmd[2])];
        apContent.push(`${n(formCursor[0])} ${n(formCursor[1])} l`);
      } else if (command === 'Q' && formCursor) {
        // PDF has no quadratic operator — exact cubic elevation of the
        // quadratic. The appearance matrix transforms the resulting cubic.
        const qx = finiteNumber(cmd[1]);
        const qy = finiteNumber(cmd[2]);
        const ex = finiteNumber(cmd[3]);
        const ey = finiteNumber(cmd[4]);
        const c1x = formCursor[0] + (2 / 3) * (qx - formCursor[0]);
        const c1y = formCursor[1] + (2 / 3) * (qy - formCursor[1]);
        const c2x = ex + (2 / 3) * (qx - ex);
        const c2y = ey + (2 / 3) * (qy - ey);
        apContent.push(`${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(ex)} ${n(ey)} c`);
        formCursor = [ex, ey];
      } else if (command === 'C' && formCursor) {
        const ex = finiteNumber(cmd[5]);
        const ey = finiteNumber(cmd[6]);
        apContent.push(
          `${n(cmd[1])} ${n(cmd[2])} ${n(cmd[3])} ${n(cmd[4])} ${n(ex)} ${n(ey)} c`,
        );
        formCursor = [ex, ey];
      } else if (command === 'Z' && formCursor) {
        apContent.push('h');
        formCursor = formSubpathStart;
      }
    });
    apContent.push('S', 'Q');

    const apResources = {};
    if (alpha < 0.99999) {
      apResources.ExtGState = { GS0: { Type: 'ExtGState', ca: alpha, CA: alpha } };
    }
    const appearance = pdfDoc.context.flateStream(`${apContent.join('\n')}\n`, {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [
        0,
        0,
        Math.max(0, (maxX - minX) + 2 * pad),
        Math.max(0, (maxY - minY) + 2 * pad),
      ],
      Resources: apResources,
    });
    const appearanceRef = pdfDoc.context.register(appearance);

    // Create annotation dictionary following PDF spec. /Rect is inflated by
    // the half-stroke pad to match the appearance BBox 1:1 (viewers map the
    // transformed BBox onto /Rect — a mismatch would rescale the stroke).
    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Ink',
      Rect: [minX - pad, minY - pad, maxX + pad, maxY + pad],
      InkList: inkListArray,
      C: [color.red, color.green, color.blue],
      Border: [0, 0, strokeWidth],
      AP: pdfDoc.context.obj({ N: appearanceRef }),
      Contents: PDFString.of(''),
      P: page.ref, // Reference to page
    };

    if (options.name) annotationDict.NM = PDFString.of(String(options.name));
    applyAppAnnotationMetadataToDict(annotationDict, options);

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating ink annotation:', e);
    return null;
  }
};

/**
 * Create Square annotation (rectangle)
 */
const createSquareAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#000000');
    const fillColor = fabricObj.fill ? hexToRGB(fabricObj.fill) : null;

    const scaleX = Math.abs(Number(fabricObj.scaleX) || 1);
    const scaleY = Math.abs(Number(fabricObj.scaleY) || 1);
    const left = Number(fabricObj.left) || 0;
    const top = Number(fabricObj.top) || 0;
    const width = Math.max(0, (Number(fabricObj.width) || 0) * scaleX);
    const height = Math.max(0, (Number(fabricObj.height) || 0) * scaleY);
    if (![left, top, width, height, pageHeight].every(Number.isFinite)) return null;

    // Calculate bounds (flip Y for PDF coordinate system)
    const minX = left;
    const minY = pageHeight - (top + height);
    const maxX = left + width;
    const maxY = pageHeight - top;

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Square',
      Rect: [minX, minY, maxX, maxY],
      C: [color.red, color.green, color.blue],
      Border: [0, 0, fabricObj.strokeWidth || 1],
      Contents: PDFString.of(''),
      P: page.ref,
    };

    // Add fill color if present
    if (fillColor && fabricObj.fill !== 'transparent') {
      annotationDict.IC = [fillColor.red, fillColor.green, fillColor.blue];
    }

    const cloudIntensity = Number(
      fabricObj?.data?.pdfCloudIntensity ?? fabricObj?.cloudIntensity
    );
    const isCloud = Number.isFinite(cloudIntensity)
      || fabricObj?.cloudBorder
      || fabricObj?.borderEffect === 'cloudy';
    if (isCloud) {
      annotationDict.BE = pdfDoc.context.obj({
        S: PDFName.of('C'),
        I: PDFNumber.of(Math.max(1, Number.isFinite(cloudIntensity) ? cloudIntensity : 2)),
      });
    }

    applyAppAnnotationMetadataToDict(annotationDict, options);

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating square annotation:', e);
    return null;
  }
};

/**
 * Create Circle annotation (ellipse)
 */
const createCircleAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#000000');
    const fillColor = fabricObj.fill ? hexToRGB(fabricObj.fill) : null;
    const counterMetadataJson = options.counterMetadataJson || null;
    const counterMetadata = options.counterMetadata || null;

    const left = Number(fabricObj.left) || 0;
    const top = Number(fabricObj.top) || 0;
    const rawRadius = Number(fabricObj.radius) || 10;
    const scaleX = Math.abs(Number(fabricObj.scaleX) || 1);
    const scaleY = Math.abs(Number(fabricObj.scaleY) || 1);
    // Screen (renderEllipse) uses radius*|scaleX| / radius*|scaleY|.
    // Axis-aligned imported ovals store the aspect in scaleX/scaleY.
    const rx = rawRadius * scaleX;
    const ry = rawRadius * scaleY;
    // Counter pin body is circular (renderCounter / metadata use scaleX).
    const radius = rx;
    if (![left, top, rx, ry, pageHeight].every(Number.isFinite) || rx <= 0 || ry <= 0) {
      return null;
    }

    // Calculate bounds (flip Y for PDF coordinate system)
    const minX = left;
    const minY = pageHeight - (top + ry * 2);
    const maxX = left + rx * 2;
    const maxY = pageHeight - top;

    let counterAppearance = null;
    let counterRect = null;
    if (counterMetadataJson) {
      // Native /Circle viewers only paint the round body. Counters need an
      // explicit /AP stream so Preview/Acrobat also show the pin nub and the
      // centered number instead of a plain, unlabeled dot.
      const pointerAngle = Number(fabricObj?.data?.pointerAngle ?? 225);
      const angle = (pointerAngle * Math.PI) / 180;
      const tipDistance = radius + radius * 0.5;
      const centerX = left + radius;
      const centerY = top + radius;
      const tipX = centerX + Math.cos(angle) * tipDistance;
      const tipY = centerY + Math.sin(angle) * tipDistance;
      const tangentHalfAngle = Math.acos(radius / tipDistance);
      const t1x = centerX + Math.cos(angle + tangentHalfAngle) * radius;
      const t1y = centerY + Math.sin(angle + tangentHalfAngle) * radius;
      const t2x = centerX + Math.cos(angle - tangentHalfAngle) * radius;
      const t2y = centerY + Math.sin(angle - tangentHalfAngle) * radius;
      const pad = 1;
      const appMinX = Math.min(left, tipX) - pad;
      const appMaxX = Math.max(left + radius * 2, tipX) + pad;
      const appMinY = Math.min(top, tipY) - pad;
      const appMaxY = Math.max(top + radius * 2, tipY) + pad;
      const formWidth = appMaxX - appMinX;
      const formHeight = appMaxY - appMinY;
      const toX = (x) => x - appMinX;
      const toY = (y) => appMaxY - y;
      const cx = toX(centerX);
      const cy = toY(centerY);
      const k = 0.551784;
      const kr = k * radius;
      const n = pdfNumberText;
      const bodyColor = fillColor || color;
      const numberColor = hexToRGB(fabricObj?.data?.numberColor || '#ffffff');
      const label = String(counterMetadata?.displayNumber ?? counterMetadata?.number ?? '');
      const escapedLabel = label.replace(/([\\()])/g, '\\$1');
      const labelLayout = getCounterLabelLayout(radius, label);
      let fontSize = labelLayout.fontSize;
      // /F1 is Helvetica Bold; numeric glyphs are 0.556em wide. Keep an exact
      // appearance-stream guard in addition to the shared conservative layout.
      let approximateTextWidth = label.length * fontSize * 0.556;
      if (approximateTextWidth > labelLayout.maxWidth && approximateTextWidth > 0) {
        fontSize *= labelLayout.maxWidth / approximateTextWidth;
        approximateTextWidth = label.length * fontSize * 0.556;
      }
      const textX = cx - approximateTextWidth / 2;
      const textY = cy - fontSize * 0.34;
      const content = [
        'q',
        `${n(bodyColor.red)} ${n(bodyColor.green)} ${n(bodyColor.blue)} rg`,
        `${n(toX(tipX))} ${n(toY(tipY))} m`,
        `${n(toX(t1x))} ${n(toY(t1y))} l`,
        `${n(toX(t2x))} ${n(toY(t2y))} l h f`,
        `${n(cx + radius)} ${n(cy)} m`,
        `${n(cx + radius)} ${n(cy + kr)} ${n(cx + kr)} ${n(cy + radius)} ${n(cx)} ${n(cy + radius)} c`,
        `${n(cx - kr)} ${n(cy + radius)} ${n(cx - radius)} ${n(cy + kr)} ${n(cx - radius)} ${n(cy)} c`,
        `${n(cx - radius)} ${n(cy - kr)} ${n(cx - kr)} ${n(cy - radius)} ${n(cx)} ${n(cy - radius)} c`,
        `${n(cx + kr)} ${n(cy - radius)} ${n(cx + radius)} ${n(cy - kr)} ${n(cx + radius)} ${n(cy)} c h f`,
        'BT',
        `/F1 ${n(fontSize)} Tf`,
        `${n(numberColor.red)} ${n(numberColor.green)} ${n(numberColor.blue)} rg`,
        `1 0 0 1 ${n(textX)} ${n(textY)} Tm`,
        `(${escapedLabel}) Tj`,
        'ET',
        'Q',
      ];
      const fontRef = pdfDoc.context.register(pdfDoc.context.obj({
        Type: 'Font',
        Subtype: 'Type1',
        BaseFont: 'Helvetica-Bold',
        Encoding: 'WinAnsiEncoding',
      }));
      const appearance = pdfDoc.context.flateStream(`${content.join('\n')}\n`, {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: [0, 0, formWidth, formHeight],
        Resources: { Font: { F1: fontRef } },
      });
      const appearanceRef = pdfDoc.context.register(appearance);
      counterAppearance = pdfDoc.context.obj({ N: appearanceRef });
      counterRect = [appMinX, pageHeight - appMaxY, appMaxX, pageHeight - appMinY];
    }

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Circle',
      Rect: counterRect || [minX, minY, maxX, maxY],
      C: [color.red, color.green, color.blue],
      Border: [0, 0, counterAppearance ? 0 : (fabricObj.strokeWidth || 1)],
      ...(counterAppearance ? { AP: counterAppearance } : {}),
      Contents: PDFString.of(''),
      P: page.ref,
    };

    if (counterMetadataJson) {
      annotationDict.NM = PDFString.of(counterMetadata?.id || fabricObj.data?.id || fabricObj.id || `counter-${Date.now()}`);
      annotationDict.Subj = PDFString.of(PDF_COUNTER_SUBJECT);
      annotationDict.Contents = PDFString.of(String(counterMetadata?.displayNumber ?? counterMetadata?.number ?? ''));
      annotationDict[PDF_COUNTER_METADATA_KEY] = PDFString.of(counterMetadataJson);
    } else {
      applyAppAnnotationMetadataToDict(annotationDict, options);
    }

    // Add fill color if present
    if (fillColor && fabricObj.fill !== 'transparent') {
      annotationDict.IC = [fillColor.red, fillColor.green, fillColor.blue];
    }

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating circle annotation:', e);
    return null;
  }
};

/**
 * Create Circle annotation from a rotated ellipse ('ellipse' fabric type —
 * produced by importing a tilted Circle annotation whose rotation lives in
 * the /AP appearance matrix, see pdfAnnotationImporter's
 * computeAppearanceRotationTransform). This writer is that importer's exact
 * inverse: /Rect gets the axis-aligned bounds of the ROTATED ellipse, while
 * the /AP /N form keeps the UN-rotated oblong dims in /BBox and the tilt in
 * /Matrix — so Drawboard/Acrobat and our own re-import all reconstruct the
 * same tilted shape.
 *
 * GOTCHA (rotation sign + origin): fabric's `angle` is screen-CLOCKWISE in a
 * y-down frame; the /AP /Matrix rotation is CCW in PDF's y-up frame — the
 * SAME visual tilt, so matrixTheta = -fabricAngle (the importer recovers
 * fabricAngleDeg = -atan2(b, a)). The form's content stream draws in y-up
 * form space inside /BBox, so there is NO getPdfY flip inside the stream;
 * only /Rect is built in flipped page coordinates. Do not "fix" either sign.
 */
const createEllipseAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const rx = Math.abs(Number(fabricObj.rx) || 0) * Math.abs(Number(fabricObj.scaleX) || 1);
    const ry = Math.abs(Number(fabricObj.ry) || 0) * Math.abs(Number(fabricObj.scaleY) || 1);
    if (rx <= 0 || ry <= 0) return null;

    const left = Number(fabricObj.left) || 0;
    const top = Number(fabricObj.top) || 0;
    // Import set left = centerX - rx / top = centerY - ry, so the center is
    // recovered the same way regardless of tilt.
    const centerX = left + rx;
    const centerY = top + ry;
    const theta = (-(Number(fabricObj.angle) || 0) * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const halfW = Math.abs(rx * cos) + Math.abs(ry * sin);
    const halfH = Math.abs(rx * sin) + Math.abs(ry * cos);
    const pdfCenterY = pageHeight - centerY;

    const strokePaint = fabricObj.stroke || '#000000';
    const color = hexToRGB(strokePaint);
    const hasFill = fabricObj.fill && fabricObj.fill !== 'transparent';
    const fillColor = hasFill ? hexToRGB(fabricObj.fill) : null;
    const strokeWidth = Number(fabricObj.strokeWidth) || 1;
    const alpha = paintAlpha(strokePaint, fabricObj.opacity);

    // Un-rotated ellipse (center rx,ry radii rx,ry) as four cubic arcs in
    // form space; the /Matrix applies the tilt.
    const k = 0.551784;
    const kx = k * rx;
    const ky = k * ry;
    const n = pdfNumberText;
    const content = ['q'];
    if (alpha < 0.99999) content.push('/GS0 gs');
    content.push(`${n(color.red)} ${n(color.green)} ${n(color.blue)} RG`);
    if (fillColor) content.push(`${n(fillColor.red)} ${n(fillColor.green)} ${n(fillColor.blue)} rg`);
    content.push(`${n(strokeWidth)} w`);
    content.push(
      `${n(2 * rx)} ${n(ry)} m`,
      `${n(2 * rx)} ${n(ry + ky)} ${n(rx + kx)} ${n(2 * ry)} ${n(rx)} ${n(2 * ry)} c`,
      `${n(rx - kx)} ${n(2 * ry)} 0 ${n(ry + ky)} 0 ${n(ry)} c`,
      `0 ${n(ry - ky)} ${n(rx - kx)} 0 ${n(rx)} 0 c`,
      `${n(rx + kx)} 0 ${n(2 * rx)} ${n(ry - ky)} ${n(2 * rx)} ${n(ry)} c`,
      'h',
      fillColor ? 'B' : 'S',
      'Q',
    );

    const resources = {};
    if (alpha < 0.99999) {
      resources.ExtGState = { GS0: { Type: 'ExtGState', ca: alpha, CA: alpha } };
    }
    const appearance = pdfDoc.context.flateStream(`${content.join('\n')}\n`, {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [0, 0, 2 * rx, 2 * ry],
      Matrix: [cos, sin, -sin, cos, 0, 0],
      Resources: resources,
    });
    const appearanceRef = pdfDoc.context.register(appearance);

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Circle',
      Rect: [
        centerX - halfW,
        pdfCenterY - halfH,
        centerX + halfW,
        pdfCenterY + halfH,
      ],
      C: [color.red, color.green, color.blue],
      CA: alpha,
      Border: [0, 0, strokeWidth],
      AP: pdfDoc.context.obj({ N: appearanceRef }),
      Contents: PDFString.of(''),
      P: page.ref,
    };
    if (fillColor) {
      annotationDict.IC = [fillColor.red, fillColor.green, fillColor.blue];
    }
    applyAppAnnotationMetadataToDict(annotationDict, options);

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating ellipse annotation:', e);
    return null;
  }
};

// UX 2026-07-17 (subtype-preserving export for edited imports): an imported
// Highlight / Text (sticky note) / Caret is proxied in-app as a plain rect or
// polyline, so an EDITED copy used to collapse through the fabric-type switch
// into /Square or /PolyLine — the re-exported file lost the annotation's real
// identity (and the sticky note lost its /Contents text). These three writers
// re-emit the original subtype; everything else keeps the fabric-switch
// default. Geometry follows the shared page-space convention: /Rect is the
// y-flipped app-space bounds (same flip as every other writer here).

// Highlight → /Highlight with QuadPoints derived from the rect proxy, in the
// same Adobe order (TL, TR, BL, BR) the survey-marker writer uses.
const createImportedHighlightAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.fill || '#FFFF00');
    const left = Number(fabricObj.left) || 0;
    const top = Number(fabricObj.top) || 0;
    const width = (Number(fabricObj.width) || 0) * Math.abs(Number(fabricObj.scaleX) || 1);
    const height = (Number(fabricObj.height) || 0) * Math.abs(Number(fabricObj.scaleY) || 1);
    const minX = left;
    const minY = pageHeight - (top + height);
    const maxX = left + width;
    const maxY = pageHeight - top;

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: [
        minX, maxY,
        maxX, maxY,
        minX, minY,
        maxX, minY,
      ].map((value) => PDFNumber.of(value)),
      C: [color.red, color.green, color.blue],
      CA: paintAlpha(fabricObj.fill, fabricObj.opacity),
      Contents: PDFString.of(''),
      P: page.ref,
    };
    applyAppAnnotationMetadataToDict(annotationDict, options);
    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating imported highlight annotation:', e);
    return null;
  }
};

// Text (sticky note) → /Text preserving /Contents (the note body lives at
// data.noteText on the rect proxy, see convertTextToFabricNote) and the /Name
// note icon.
const createImportedTextNoteAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.fill || '#FFEB3B');
    const left = Number(fabricObj.left) || 0;
    const top = Number(fabricObj.top) || 0;
    const width = (Number(fabricObj.width) || 20) * Math.abs(Number(fabricObj.scaleX) || 1);
    const height = (Number(fabricObj.height) || 20) * Math.abs(Number(fabricObj.scaleY) || 1);

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [left, pageHeight - (top + height), left + width, pageHeight - top],
      C: [color.red, color.green, color.blue],
      CA: paintAlpha(fabricObj.fill, fabricObj.opacity),
      Name: PDFName.of(String(fabricObj?.data?.pdfNoteIcon || 'Note')),
      Contents: PDFString.of(String(fabricObj?.data?.noteText ?? '')),
      P: page.ref,
    };
    applyAppAnnotationMetadataToDict(annotationDict, options);
    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating imported text note annotation:', e);
    return null;
  }
};

// Caret → /Caret. The polyline proxy's chevron points are display-only; the
// caret's PDF identity is just its /Rect.
const createImportedCaretAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#FF0000');
    const left = Number(fabricObj.left) || 0;
    const top = Number(fabricObj.top) || 0;
    const points = Array.isArray(fabricObj.points) ? fabricObj.points : [];
    const pointsWidth = points.length ? Math.max(...points.map((p) => Number(p?.x) || 0)) : 0;
    const pointsHeight = points.length ? Math.max(...points.map((p) => Number(p?.y) || 0)) : 0;
    const width = (Number(fabricObj.width) || pointsWidth) * Math.abs(Number(fabricObj.scaleX) || 1);
    const height = (Number(fabricObj.height) || pointsHeight) * Math.abs(Number(fabricObj.scaleY) || 1);
    if (width <= 0 || height <= 0) return null;

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Caret',
      Rect: [left, pageHeight - (top + height), left + width, pageHeight - top],
      C: [color.red, color.green, color.blue],
      CA: paintAlpha(fabricObj.stroke, fabricObj.opacity),
      Contents: PDFString.of(''),
      P: page.ref,
    };
    applyAppAnnotationMetadataToDict(annotationDict, options);
    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating imported caret annotation:', e);
    return null;
  }
};

// The subtypes that get identity-preserving re-export when an imported copy
// was edited. Everything else (Square, Circle, Line, PolyLine, Polygon,
// FreeText, Ink…) already re-exports as its own subtype via the fabric switch.
const EDITED_IMPORT_SUBTYPE_WRITERS = {
  Highlight: createImportedHighlightAnnotation,
  Text: createImportedTextNoteAnnotation,
  Caret: createImportedCaretAnnotation,
};

/**
 * Create SurveyMarker annotation
 * Uses QuadPoints following Adobe's implementation (not PDF spec order)
 */
const createHighlightAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.fill || '#FFFF00');

    const left = fabricObj.left || 0;
    const top = fabricObj.top || 0;
    const width = fabricObj.width || 0;
    const height = fabricObj.height || 0;

    // Calculate bounds (flip Y for PDF coordinate system)
    const minX = left;
    const minY = pageHeight - (top + height);
    const maxX = left + width;
    const maxY = pageHeight - top;

    // QuadPoints: Adobe order is TopLeft, TopRight, BottomLeft, BottomRight
    // (not PDF spec order which is counter-clockwise)
    const quadPoints = [
      minX, maxY,  // Top-left
      maxX, maxY,  // Top-right
      minX, minY,  // Bottom-left
      maxX, minY   // Bottom-right
    ];

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'SurveyMarker',
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quadPoints.map(n => PDFNumber.of(n)),
      C: [color.red, color.green, color.blue],
      Contents: PDFString.of(''),
      P: page.ref,
    };

    applyAppAnnotationMetadataToDict(annotationDict, options);

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating highlight annotation:', e);
    return null;
  }
};

// Screen (renderPolygon / renderPolyline): world = left + scaleX*point.x
// when pathOffset is 0 (importer points are min-relative). Resize commits
// scaleX/scaleY and leaves points unbaked — export/print must apply scale.
const polygonWorldPoint = (obj, point) => {
  const sx = Math.abs(Number(obj?.scaleX) || 1);
  const sy = Math.abs(Number(obj?.scaleY) || 1);
  return {
    x: (Number(obj?.left) || 0) + sx * (Number(point?.x) || 0),
    y: (Number(obj?.top) || 0) + sy * (Number(point?.y) || 0),
  };
};

/**
 * Create Polygon annotation with optional cloud border effect
 */
const createPolygonAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#000000');
    const fillColor = fabricObj.fill ? hexToRGB(fabricObj.fill) : null;

    // Extract points from Fabric.js polygon
    const points = fabricObj.points || [];
    if (points.length < 3) {
      return null;
    }

    // Convert points to PDF coordinates (flip Y)
    const vertices = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    points.forEach(point => {
      const world = polygonWorldPoint(fabricObj, point);
      const x = world.x;
      const y = pageHeight - world.y;
      vertices.push(x, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Polygon',
      Rect: [minX, minY, maxX, maxY],
      Vertices: vertices.map(n => PDFNumber.of(n)),
      C: [color.red, color.green, color.blue],
      Border: [0, 0, fabricObj.strokeWidth || 1],
      Contents: PDFString.of(''),
      P: page.ref,
    };

    // Add fill color if present
    if (fillColor && fabricObj.fill !== 'transparent') {
      annotationDict.IC = [fillColor.red, fillColor.green, fillColor.blue];
    }

    // Add cloud border effect if specified
    if (fabricObj.cloudBorder || fabricObj.borderEffect === 'cloudy') {
      annotationDict.BE = pdfDoc.context.obj({
        S: PDFName.of('C'), // Cloudy
        I: PDFNumber.of(fabricObj.cloudIntensity || 2)
      });
      annotationDict.IT = PDFName.of('PolygonCloud');
    }

    applyAppAnnotationMetadataToDict(annotationDict, options);

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating polygon annotation:', e);
    return null;
  }
};

const createPolyLineAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#000000');
    const points = fabricObj.points || [];
    if (points.length < 2) {
      return null;
    }

    const vertices = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    points.forEach(point => {
      const world = polygonWorldPoint(fabricObj, point);
      const x = world.x;
      const y = pageHeight - world.y;
      vertices.push(x, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'PolyLine',
      Rect: [minX, minY, maxX, maxY],
      Vertices: vertices.map(n => PDFNumber.of(n)),
      C: [color.red, color.green, color.blue],
      Border: [0, 0, fabricObj.strokeWidth || 1],
      Contents: PDFString.of(''),
      P: page.ref,
    };

    applyAppAnnotationMetadataToDict(annotationDict, options);

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating polyline annotation:', e);
    return null;
  }
};

/**
 * Create Line annotation with optional callout
 */
const createLineAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#000000');

    // Fabric lines store center-relative x1..y2. World endpoints come from
    // getLineEndpoints (left+width/2 + x1). Using raw x1 here exported the
    // center-relative pair as /L — and after a group left/top offset that
    // is a double-miss, not a double-offset.
    const ep = getLineEndpoints(fabricObj);
    const x1 = Number(ep.x1) || 0;
    const y1 = Number(ep.y1) || 0;
    const x2 = Number(ep.x2) || 0;
    const y2 = Number(ep.y2) || 0;

    // Calculate bounds (flip Y for PDF coordinate system)
    const minX = Math.min(x1, x2);
    const minY = Math.min(pageHeight - y1, pageHeight - y2);
    const maxX = Math.max(x1, x2);
    const maxY = Math.max(pageHeight - y1, pageHeight - y2);

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Line',
      Rect: [minX, minY, maxX, maxY],
      L: [x1, pageHeight - y1, x2, pageHeight - y2],
      C: [color.red, color.green, color.blue],
      Border: [0, 0, fabricObj.strokeWidth || 1],
      Contents: PDFString.of(''),
      P: page.ref,
    };

    if (options.calloutMetadataJson) {
      annotationDict.NM = PDFString.of(options.name || `${options.calloutMetadata?.id || 'callout'}-${options.calloutMetadata?.part || 'line'}`);
      annotationDict.Subj = PDFString.of(PDF_CALLOUT_SUBJECT);
      annotationDict[PDF_CALLOUT_METADATA_KEY] = PDFString.of(options.calloutMetadataJson);
    } else {
      applyAppAnnotationMetadataToDict(annotationDict, options);
    }

    // Add line endings (arrows, etc.)
    const le2 = resolveExportedLineEnding2(fabricObj);
    if (fabricObj.lineEnding1 || le2) {
      const le1 = fabricObj.lineEnding1 || 'None';
      annotationDict.LE = [PDFName.of(le1), PDFName.of(le2 || 'None')];
    }

    // UX (2026-07-17, callout line style): dashed/dotted strokes export as a
    // /BS border-style dict (/S /D + /D dash array) so external viewers draw
    // the same dash pattern the app renders. Solid lines omit /BS entirely —
    // byte-identical to the pre-fix export.
    const dash = Array.isArray(fabricObj.strokeDashArray) && fabricObj.strokeDashArray.length > 0
      ? fabricObj.strokeDashArray.map((v) => Number(v) || 0)
      : null;
    if (dash) {
      annotationDict.BS = {
        Type: 'Border',
        W: fabricObj.strokeWidth || 1,
        S: PDFName.of('D'),
        D: dash,
      };
    }

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating line annotation:', e);
    return null;
  }
};

/**
 * Create FreeText annotation (text box)
 */
const createFreeTextAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.fill || '#000000');

    const left = fabricObj.left || 0;
    const top = fabricObj.top || 0;
    // Screen (renderText): box = width*|scaleX| × height*|scaleY|. Individual
    // SVG resize + text-edit commit bake scale to 1; group-resize (and leftover
    // fabric objects) leave scale unbaked. fontSize stays unscaled — same as
    // the renderer. Angle is not invented here (same as polygon).
    const width = (fabricObj.width || 100) * Math.abs(Number(fabricObj.scaleX) || 1);
    const height = (fabricObj.height || 20) * Math.abs(Number(fabricObj.scaleY) || 1);
    const text = fabricObj.text || '';
    const fontSize = fabricObj.fontSize || 12;

    // Calculate bounds (flip Y for PDF coordinate system)
    const minX = left;
    const minY = pageHeight - (top + height);
    const maxX = left + width;
    const maxY = pageHeight - top;

    // UX 2026-07-17 (text style export): the /DA string carries the GLYPH
    // color + font, so exported text keeps the color/bold/italic the user
    // picked on screen (previously hard-coded to black regular Helvetica).
    // Callers map callout {bold, italic} → fabric-native fontWeight/fontStyle
    // before reaching here. Underline/strikethrough CANNOT be expressed in a
    // /DA string (no PDF text-decoration operator) — they survive via the app
    // metadata round-trip and are drawn as real lines in the print-flatten
    // path (drawFlattenedText); Acrobat renders this annotation without them.
    const isBold = fabricObj.fontWeight === 'bold' || Number(fabricObj.fontWeight) >= 600;
    const isItalic = fabricObj.fontStyle === 'italic' || fabricObj.fontStyle === 'oblique';
    const daFont = pdfDefaultAppearanceFontName(fabricObj.fontFamily, { bold: isBold, italic: isItalic });
    const da = `${pdfNumberText(color.red)} ${pdfNumberText(color.green)} ${pdfNumberText(color.blue)} rg /${daFont} ${fontSize} Tf`;

    // UX 2026-07-17: /C on a FreeText annotation is the BACKGROUND/border
    // color per the PDF spec — NOT the glyph color (that lives in /DA above).
    // Live toolbar writes textbox Fill as backgroundColor (often rgba() from
    // composeColorForPatch). Opacity-0 / empty / transparent omit /C so the
    // exported box stays clear, matching the screen. Callout boxes pass the
    // already-resolved hex from resolveCalloutBoxFill.
    const boxFill = resolveTextboxBoxFill(fabricObj);
    const background = boxFill.visible ? hexToRGB(boxFill.hex) : null;

    // /Q quadding (PDF 12.7.4.3): 0 left, 1 center, 2 right. STYLE_KEYS
    // already keeps textAlign on our reimport; Acrobat/Preview read /Q.
    const annotationDict = {
      Type: 'Annot',
      Subtype: 'FreeText',
      Rect: [minX, minY, maxX, maxY],
      Contents: PDFString.of(text),
      DA: PDFString.of(da),
      Q: pdfFreeTextQuadding(fabricObj.textAlign),
      ...(background ? { C: [background.red, background.green, background.blue] } : {}),
      Border: [0, 0, 0], // No border for text boxes
      P: page.ref,
    };

    if (options.calloutMetadataJson) {
      annotationDict.NM = PDFString.of(options.name || `${options.calloutMetadata?.id || 'callout'}-${options.calloutMetadata?.part || 'text'}`);
      annotationDict.Subj = PDFString.of(PDF_CALLOUT_SUBJECT);
      annotationDict[PDF_CALLOUT_METADATA_KEY] = PDFString.of(options.calloutMetadataJson);
    } else {
      applyAppAnnotationMetadataToDict(annotationDict, options);
    }

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating freetext annotation:', e);
    return null;
  }
};

// UX (callout arrowhead export): map the app's 6 arrowhead styles onto the
// closest PDF /LE line-ending names so external viewers (Acrobat, Preview)
// draw a matching head on the exported callout leader line. This is the exact
// inverse of PageAnnotationLayer's PDF_LINE_ENDING_TO_ARROW_STYLE import map,
// keeping export→re-import stable. Documented degradations (PDF /LE has no
// richer vocabulary): OPEN_TRIANGLE → OpenArrow (PDF has no unfilled *closed*
// triangle ending; OpenArrow is what the importer maps back to OPEN_TRIANGLE)
// and V_SHAPE → Slash (OpenArrow already belongs to OPEN_TRIANGLE in the
// import map; Slash keeps the mapping bijective). The app's own re-import
// never reads /LE for callouts — style rides verbatim inside the callout
// metadata blob — so /LE is purely for third-party viewer fidelity.
const ARROWHEAD_STYLE_TO_PDF_LINE_ENDING = {
  [ARROWHEAD_STYLES.NONE]: 'None',
  [ARROWHEAD_STYLES.SOLID_TRIANGLE]: 'ClosedArrow',
  [ARROWHEAD_STYLES.OPEN_TRIANGLE]: 'OpenArrow',
  [ARROWHEAD_STYLES.OPEN_CIRCLE]: 'Circle',
  [ARROWHEAD_STYLES.V_SHAPE]: 'Slash',
  [ARROWHEAD_STYLES.HORIZONTAL_LINE]: 'Butt',
};

const resolveExportedLineEnding2 = (fabricObj) => {
  if (fabricObj?.lineEnding2) return fabricObj.lineEnding2;
  const style = fabricObj?.data?.arrowheadStyle
    ?? (fabricObj?.tool === 'arrow' ? ARROWHEAD_STYLES.SOLID_TRIANGLE : null);
  if (!style) return null;
  return ARROWHEAD_STYLE_TO_PDF_LINE_ENDING[style] || null;
};

// Default matches defaultCalloutStyle (Callout/types.js) and the SVG/canvas
// renderers: absent style → solid triangle, so legacy callouts keep their
// historical ClosedArrow export byte-for-byte.
const resolveCalloutArrowheadStyle = (style) => (
  style?.arrowheadStyle ?? ARROWHEAD_STYLES.SOLID_TRIANGLE
);

const createCalloutAnnotations = (pdfDoc, page, calloutObj, pageHeight) => {
  const refs = [];
  const style = calloutObj?.style || {};
  const stroke = style.borderColor || style.lineColor || '#1e293b';
  const strokeWidth = Math.max(1, Number(style.lineThickness || 2));
  const arrowTip = calloutObj?.arrowTip;
  const knee = calloutObj?.knee;
  const textBox = calloutObj?.textBox;

  if (!arrowTip || !knee || !textBox) return refs;

  const originalCallout = calloutObj.originalCallout || calloutObj;
  const pageNumber = calloutObj.pageNumber || originalCallout.pageNumber || null;
  const buildCalloutOptions = (part) => {
    const calloutMetadataJson = serializePdfCalloutMetadata(originalCallout, pageNumber, part);
    if (!calloutMetadataJson) return {};
    const calloutMetadata = JSON.parse(calloutMetadataJson);
    return {
      calloutMetadataJson,
      calloutMetadata,
      name: `${calloutMetadata.id}-${part}`,
    };
  };

  // UX (2026-07-17, callout line style): style.lineStyle maps to the shared
  // dash arrays (dashed [6,4] / dotted [2,4]) and rides to the exported Line
  // pieces as /BS dash dicts (createLineAnnotation). Solid/absent → null →
  // no /BS, byte-identical to the legacy export. The app's own re-import
  // never reads /BS for callouts — style rides verbatim in the metadata blob
  // — so /BS is purely for third-party viewer fidelity (same contract as the
  // arrowhead /LE mapping above).
  const leaderDash = calloutLineDashArray(style.lineStyle);

  const line1 = createLineAnnotation(pdfDoc, page, {
    type: 'line',
    x1: textBox.left,
    y1: textBox.top + textBox.height / 2,
    x2: knee.x,
    y2: knee.y,
    stroke,
    strokeWidth,
    ...(leaderDash ? { strokeDashArray: leaderDash } : {}),
  }, pageHeight, buildCalloutOptions('line1'));
  if (line1) refs.push(line1);

  const line2 = createLineAnnotation(pdfDoc, page, {
    type: 'line',
    x1: knee.x,
    y1: knee.y,
    x2: arrowTip.x,
    y2: arrowTip.y,
    stroke,
    strokeWidth,
    ...(leaderDash ? { strokeDashArray: leaderDash } : {}),
    // UX: honor the callout's picked arrowhead style in external viewers via
    // the closest /LE name (see ARROWHEAD_STYLE_TO_PDF_LINE_ENDING above).
    lineEnding2: ARROWHEAD_STYLE_TO_PDF_LINE_ENDING[resolveCalloutArrowheadStyle(style)]
      || 'ClosedArrow',
  }, pageHeight, buildCalloutOptions('line2'));
  if (line2) refs.push(line2);

  const textRef = createFreeTextAnnotation(pdfDoc, page, {
    type: 'textbox',
    left: textBox.left,
    top: textBox.top,
    width: textBox.width,
    height: textBox.height,
    text: calloutObj.text || '',
    fill: style.fontColor || '#1e293b',
    fontSize: style.fontSize || 14,
    // UX 2026-07-17: map callout {bold, italic} → fabric-native
    // fontWeight/fontStyle (ANNOTATION-CONTRACT.md addendum mapping) so the
    // exported FreeText /DA picks the matching Helvetica variant. Underline/
    // strikethrough have no /DA representation — see createFreeTextAnnotation.
    fontWeight: style.bold ? 'bold' : 'normal',
    fontStyle: style.italic ? 'italic' : 'normal',
    fontFamily: style.fontFamily,
    // Live toolbar writes style.fillColor / fillOpacity. backgroundColor is
    // only an import leftover — using it here dropped /C for every on-screen fill.
    backgroundColor: resolveCalloutBoxFill(style).hex,
    textAlign: style.textAlign,
  }, pageHeight, buildCalloutOptions('text'));
  if (textRef) refs.push(textRef);

  return refs;
};

const parsePdfAnnotationReference = (pdfAnnotationId) => {
  const match = String(pdfAnnotationId || '').trim().match(/^(\d+)R(\d*)$/i);
  if (!match) return null;
  const objectNumber = Number(match[1]);
  const generationNumber = match[2] ? Number(match[2]) : 0;
  if (
    !Number.isInteger(objectNumber)
    || objectNumber <= 0
    || !Number.isInteger(generationNumber)
    || generationNumber < 0
  ) {
    return null;
  }
  return { objectNumber, generationNumber };
};

const parsePdfJsSyntheticAnnotationId = (pdfAnnotationId) => {
  const match = String(pdfAnnotationId || '').trim().match(/^annot_p(\d+)_(\d+)$/i);
  if (!match) return null;
  const pageIndex = Number(match[1]);
  const directOccurrence = Number(match[2]);
  if (
    !Number.isInteger(pageIndex)
    || pageIndex < 0
    || !Number.isInteger(directOccurrence)
    || directOccurrence <= 0
  ) {
    return null;
  }
  return { pageIndex };
};

const PDF_NATIVE_ANNOTATION_IDENTITY_VERSION = 1;
const PDF_NATIVE_RECT_ROUNDING_FACTOR = 10_000;

const lookupPdfValue = (pdfDoc, value) => {
  try {
    return pdfDoc.context.lookup(value) || value;
  } catch {
    return value;
  }
};

const normalizePdfAnnotationSubtype = (value) => (
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

const readPdfNativeNumber = (pdfDoc, value) => {
  const resolved = lookupPdfValue(pdfDoc, value);
  try {
    if (typeof resolved?.asNumber === 'function') return resolved.asNumber();
    if (typeof resolved?.value === 'function') return resolved.value();
  } catch {
    return null;
  }
  const numeric = Number(resolved);
  return Number.isFinite(numeric) ? numeric : null;
};

const readPdfNativeNumberArray = (pdfDoc, value) => {
  const resolved = lookupPdfValue(pdfDoc, value);
  if (!resolved || typeof resolved.asArray !== 'function') return null;
  const numbers = resolved.asArray().map((entry) => readPdfNativeNumber(pdfDoc, entry));
  return numbers.every(Number.isFinite) ? normalizePdfNativeNumberArray(numbers) : null;
};

const readPdfNativeNestedNumberArrays = (pdfDoc, value) => {
  const resolved = lookupPdfValue(pdfDoc, value);
  if (!resolved || typeof resolved.asArray !== 'function') return null;
  const arrays = resolved.asArray().map((entry) => readPdfNativeNumberArray(pdfDoc, entry));
  return arrays.every(Array.isArray) ? arrays : null;
};

const decodePdfDictText = (pdfDoc, dict, key) => {
  try {
    return normalizePdfNativeAnnotationText(
      lookupPdfValue(pdfDoc, dict?.get?.(PDFName.of(key)))?.decodeText?.() || '',
    );
  } catch {
    return '';
  }
};

const buildPdfNativeAnnotationFingerprint = (pdfDoc, dict) => {
  if (!(dict instanceof PDFDict)) return null;
  const subtype = normalizePdfAnnotationSubtype(decodePdfDictText(pdfDoc, dict, 'Subtype'));
  const rect = normalizePdfNativeAnnotationRect(
    readPdfNativeNumberArray(pdfDoc, dict.get(PDFName.of('Rect'))),
  );
  if (!subtype || !rect) return null;
  const rawFlags = dict.get(PDFName.of('F'));
  const flags = normalizePdfNativeAnnotationFlags(
    rawFlags === undefined ? 0 : readPdfNativeNumber(pdfDoc, rawFlags),
  );
  if (flags === null) return null;
  return {
    subtype,
    rect,
    flags,
    nm: decodePdfDictText(pdfDoc, dict, 'NM'),
    contents: decodePdfDictText(pdfDoc, dict, 'Contents'),
    title: decodePdfDictText(pdfDoc, dict, 'T'),
    subject: decodePdfDictText(pdfDoc, dict, 'Subj'),
    quadPoints:
      readPdfNativeNumberArray(pdfDoc, dict.get(PDFName.of('QuadPoints'))) || [],
    inkList:
      readPdfNativeNestedNumberArrays(pdfDoc, dict.get(PDFName.of('InkList'))) || [],
    line: readPdfNativeNumberArray(pdfDoc, dict.get(PDFName.of('L'))) || [],
    vertices:
      readPdfNativeNumberArray(pdfDoc, dict.get(PDFName.of('Vertices'))) || [],
    calloutLine:
      readPdfNativeNumberArray(pdfDoc, dict.get(PDFName.of('CL'))) || [],
  };
};

const normalizePdfNativeAnnotationFingerprint = (fingerprint) => {
  if (!fingerprint || typeof fingerprint !== 'object') return null;
  const requiredKeys = [
    'subtype',
    'rect',
    'flags',
    'nm',
    'contents',
    'title',
    'subject',
    'quadPoints',
    'inkList',
    'line',
    'vertices',
    'calloutLine',
  ];
  if (requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(fingerprint, key))) {
    return null;
  }
  const subtype = normalizePdfAnnotationSubtype(fingerprint.subtype);
  const rect = normalizePdfNativeAnnotationRect(fingerprint.rect);
  const flags = normalizePdfNativeAnnotationFlags(fingerprint.flags);
  const quadPoints = normalizePdfNativeNumberArray(fingerprint.quadPoints);
  const inkList = normalizePdfNativeNestedNumberArrays(fingerprint.inkList);
  const line = normalizePdfNativeNumberArray(fingerprint.line);
  const vertices = normalizePdfNativeNumberArray(fingerprint.vertices);
  const calloutLine = normalizePdfNativeNumberArray(fingerprint.calloutLine);
  if (
    !subtype
    || !rect
    || flags === null
    || !quadPoints
    || !inkList
    || !line
    || !vertices
    || !calloutLine
  ) {
    return null;
  }
  return {
    subtype,
    rect,
    flags,
    nm: normalizePdfNativeAnnotationText(fingerprint.nm),
    contents: normalizePdfNativeAnnotationText(fingerprint.contents),
    title: normalizePdfNativeAnnotationText(fingerprint.title),
    subject: normalizePdfNativeAnnotationText(fingerprint.subject),
    quadPoints,
    inkList,
    line,
    vertices,
    calloutLine,
  };
};

const normalizePdfNativeAnnotationIdentity = (identity) => {
  if (!identity || Number(identity.v) !== PDF_NATIVE_ANNOTATION_IDENTITY_VERSION) {
    return null;
  }
  const pageNumber = Number(identity.pageNumber);
  const annotsIndex = Number(identity.annotsIndex);
  const fingerprint = normalizePdfNativeAnnotationFingerprint(identity.fingerprint);
  if (
    !Number.isInteger(pageNumber)
    || pageNumber <= 0
    || !Number.isInteger(annotsIndex)
    || annotsIndex < 0
    || !fingerprint
  ) {
    return null;
  }
  return {
    v: PDF_NATIVE_ANNOTATION_IDENTITY_VERSION,
    pageNumber,
    annotsIndex,
    fingerprint,
  };
};

const samePdfNativeAnnotationFingerprint = (left, right) => (
  JSON.stringify(left) === JSON.stringify(right)
);

const findMatchingNativePdfAnnotationIndices = (
  pdfDoc,
  annots,
  pdfAnnotationId,
  {
    pageIndex = null,
    pdfAnnotationType = null,
    pdfNativeAnnotationIdentity = null,
  } = {},
) => {
  if (!pdfDoc || !annots || !pdfAnnotationId || typeof annots.asArray !== 'function') {
    return [];
  }

  const annotationId = String(pdfAnnotationId).trim();
  const reference = parsePdfAnnotationReference(annotationId);
  const synthetic = parsePdfJsSyntheticAnnotationId(annotationId);
  const refs = annots.asArray();

  // pdf.js gives a direct dictionary (no indirect PDFRef and no /NM) a
  // runtime id such as `annot_p0_7`. Its suffix comes from a page-local
  // counter shared with images, masks, and patterns, so it is NOT a durable
  // annotation occurrence. Only an import-time native identity may remove a
  // direct dictionary; legacy synthetic ids fail closed.
  if (synthetic) {
    const identity = normalizePdfNativeAnnotationIdentity(pdfNativeAnnotationIdentity);
    if (
      !identity
      || Number(pageIndex) !== synthetic.pageIndex
      || identity.pageNumber !== Number(pageIndex) + 1
      || (
        pdfAnnotationType
        && normalizePdfAnnotationSubtype(pdfAnnotationType) !== identity.fingerprint.subtype
      )
    ) {
      return [];
    }
    const candidate = refs[identity.annotsIndex];
    if (!candidate || candidate instanceof PDFRef) return [];
    const dict = lookupPdfValue(pdfDoc, candidate);
    const fingerprint = buildPdfNativeAnnotationFingerprint(pdfDoc, dict);
    return samePdfNativeAnnotationFingerprint(fingerprint, identity.fingerprint)
      ? [identity.annotsIndex]
      : [];
  }

  const matches = [];
  for (let index = refs.length - 1; index >= 0; index -= 1) {
    const ref = refs[index];
    let dict = null;
    try {
      dict = lookupPdfValue(pdfDoc, ref);
    } catch {
      dict = null;
    }
    const name = decodePdfDictText(pdfDoc, dict, 'NM');
    const matchesReference = (
      reference !== null
      && ref instanceof PDFRef
      && ref.objectNumber === reference.objectNumber
      && ref.generationNumber === reference.generationNumber
    );
    // A syntactically valid pdf.js Ref id is an exact reference identity;
    // never let a coincidental /NM string broaden it to another dictionary.
    const matchesName = reference === null && name && name === annotationId;
    if (matchesReference || matchesName) {
      matches.push(index);
    }
  }
  // /NM is required to be page-unique by the PDF spec, but malformed files
  // exist. A legacy name-only tombstone cannot safely choose among duplicates.
  return reference === null && matches.length !== 1 ? [] : matches;
};

const applyNativePdfAnnotationRemovalPlan = ({
  pdfDoc,
  requests,
  exportDiagnostics,
}) => {
  const removalsByPage = new Map();
  const fieldsForKind = (kind) => (
    kind === 'deleted'
      ? {
          removed: 'deletedImportedNativeCopiesRemoved',
          misses: 'deletedImportedNativeCopiesRemoveMisses',
        }
      : {
          removed: 'editedImportedNativeCopiesRemoved',
          misses: 'editedImportedNativeCopiesRemoveMisses',
        }
  );

  for (const request of requests || []) {
    const fields = fieldsForKind(request.kind);
    const pageIndex = Number(request.pageNumber) - 1;
    if (
      !Number.isInteger(pageIndex)
      || pageIndex < 0
      || pageIndex >= pdfDoc.getPageCount()
    ) {
      exportDiagnostics[fields.misses] += 1;
      continue;
    }
    const page = pdfDoc.getPage(pageIndex);
    const annots = page.node.lookup(PDFName.of('Annots'));
    const indices = findMatchingNativePdfAnnotationIndices(
      pdfDoc,
      annots,
      request.pdfAnnotationId,
      {
        pageIndex,
        pdfAnnotationType: request.pdfAnnotationType,
        pdfNativeAnnotationIdentity: request.pdfNativeAnnotationIdentity,
      },
    );
    if (indices.length === 0) {
      exportDiagnostics[fields.misses] += 1;
      continue;
    }
    let pagePlan = removalsByPage.get(pageIndex);
    if (!pagePlan) {
      pagePlan = { annots, indices: new Map() };
      removalsByPage.set(pageIndex, pagePlan);
    }
    let newlyScheduled = 0;
    for (const index of indices) {
      if (!pagePlan.indices.has(index)) {
        pagePlan.indices.set(index, request.kind);
        newlyScheduled += 1;
      }
    }
    exportDiagnostics[fields.removed] += newlyScheduled;
  }

  for (const { annots, indices } of removalsByPage.values()) {
    [...indices.keys()]
      .sort((left, right) => right - left)
      .forEach((index) => annots.remove(index));
  }
};

const parsePdfDrawColor = (value, fallback = '#000000') => {
  if (value === null || value === undefined || value === '' || value === 'transparent') return null;
  const text = String(value || fallback).trim();
  const rgba = text.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return {
        color: rgb(
          Math.max(0, Math.min(255, parts[0])) / 255,
          Math.max(0, Math.min(255, parts[1])) / 255,
          Math.max(0, Math.min(255, parts[2])) / 255,
        ),
        opacity: Number.isFinite(parts[3]) ? Math.max(0, Math.min(1, parts[3])) : 1,
      };
    }
  }
  return { color: hexToRGB(text || fallback), opacity: 1 };
};

const getObjNumber = (obj, key, fallback = 0) => {
  const value = Number(obj?.[key]);
  return Number.isFinite(value) ? value : fallback;
};

const getPdfY = (pageHeight, appY) => pageHeight - appY;

// GOTCHA (drawSvgPath origin trap — see drawFlattenedArrowheadSpec): emits
// RAW app-space (y-down) coordinates; the drawSvgPath call site MUST pass
// origin {x: 0, y: pageHeight}. Pre-flipping with getPdfY here lands the
// whole stroke at negative device y (off-page) because drawSvgPath negates
// path y around its origin, which defaults to the page BOTTOM-left.
const fabricPathToSvgPath = (pathData) => {
  if (!Array.isArray(pathData) || pathData.length === 0) return '';
  const parts = [];
  pathData.forEach((cmd) => {
    const command = cmd?.[0];
    if (command === 'M' || command === 'L') {
      parts.push(`${command} ${Number(cmd[1]) || 0} ${Number(cmd[2]) || 0}`);
    } else if (command === 'Q') {
      parts.push(`Q ${Number(cmd[1]) || 0} ${Number(cmd[2]) || 0} ${Number(cmd[3]) || 0} ${Number(cmd[4]) || 0}`);
    } else if (command === 'C') {
      parts.push(`C ${Number(cmd[1]) || 0} ${Number(cmd[2]) || 0} ${Number(cmd[3]) || 0} ${Number(cmd[4]) || 0} ${Number(cmd[5]) || 0} ${Number(cmd[6]) || 0}`);
    }
  });
  return parts.join(' ');
};

const drawArrowHead = (page, { x1, y1, x2, y2, pageHeight, color, width }) => {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.max(6, width * 4);
  const tipX = x2;
  const tipY = getPdfY(pageHeight, y2);
  const leftX = x2 - size * Math.cos(angle - Math.PI / 7);
  const leftY = getPdfY(pageHeight, y2 - size * Math.sin(angle - Math.PI / 7));
  const rightX = x2 - size * Math.cos(angle + Math.PI / 7);
  const rightY = getPdfY(pageHeight, y2 - size * Math.sin(angle + Math.PI / 7));
  page.drawLine({ start: { x: tipX, y: tipY }, end: { x: leftX, y: leftY }, color, thickness: width });
  page.drawLine({ start: { x: tipX, y: tipY }, end: { x: rightX, y: rightY }, color, thickness: width });
};

// UX (print flatten callout arrowhead): pdf-lib twin of paintArrowheadSpec
// (annotationCanvasPainter, canvas) and renderArrowheadFromSpec
// (svgAnnotationRenderers, SVG) — consumes the SAME buildArrowheadRenderSpec
// output, so the printed head is geometrically identical to the on-screen one
// for all 6 styles. Head size + coordinates are in page units, so the head
// scales with the page exactly like the rest of the annotation (locked zoom
// convention 2026-07-14).
// GOTCHA (verified by rasterizing a probe PDF, 2026-07-17): page.drawSvgPath
// negates path y (scale(1,-1)) relative to its origin, and the origin
// defaults to (0,0) at the page's BOTTOM-left — so passing pre-flipped
// getPdfY coordinates lands the path off-page. Filled/stroked triangle paths
// therefore draw with origin {x:0, y:pageHeight} and RAW app-space (y-down)
// coordinates; line/circle primitives use the normal getPdfY flip.
function drawFlattenedArrowheadSpec(page, spec, pageHeight) {
  if (!spec || spec.kind === 'none') return;
  const stroke = parsePdfDrawColor(spec.color || '#000000', '#000000');
  if (spec.kind === 'solidTriangle' || spec.kind === 'openTriangle') {
    // Same local triangle + rotation the shared spec's SVG transform encodes.
    const headSize = Math.max(8, (spec.sw || 0) * 3);
    const angleRad = ((spec.angleDeg || 0) * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const local = [
      [-headSize / 3, -headSize / 2],
      [(headSize * 2) / 3, 0],
      [-headSize / 3, headSize / 2],
    ];
    const pts = local.map(([lx, ly]) => [
      spec.tipX + (lx * cos) - (ly * sin),
      spec.tipY + (lx * sin) + (ly * cos),
    ]);
    const d = `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]} L ${pts[2][0]} ${pts[2][1]} Z`;
    if (spec.kind === 'solidTriangle') {
      page.drawSvgPath(d, {
        x: 0,
        y: pageHeight,
        color: stroke.color,
        opacity: stroke.opacity,
        borderWidth: 0,
      });
    } else {
      page.drawSvgPath(d, {
        x: 0,
        y: pageHeight,
        borderColor: stroke.color,
        borderOpacity: stroke.opacity,
        borderWidth: spec.polygon.strokeWidth,
      });
    }
  } else if (spec.kind === 'openCircle') {
    page.drawCircle({
      x: spec.circle.cx,
      y: getPdfY(pageHeight, spec.circle.cy),
      size: spec.circle.r,
      borderColor: stroke.color,
      borderOpacity: stroke.opacity,
      borderWidth: spec.circle.strokeWidth,
    });
  } else if (spec.kind === 'vShape') {
    const pts = String(spec.polyline.points).split(' ').map((pair) => pair.split(',').map(Number));
    for (let i = 1; i < pts.length; i += 1) {
      page.drawLine({
        start: { x: pts[i - 1][0], y: getPdfY(pageHeight, pts[i - 1][1]) },
        end: { x: pts[i][0], y: getPdfY(pageHeight, pts[i][1]) },
        color: stroke.color,
        opacity: stroke.opacity,
        thickness: spec.polyline.strokeWidth,
      });
    }
  } else if (spec.kind === 'horizontalLine') {
    page.drawLine({
      start: { x: spec.line.x1, y: getPdfY(pageHeight, spec.line.y1) },
      end: { x: spec.line.x2, y: getPdfY(pageHeight, spec.line.y2) },
      color: stroke.color,
      opacity: stroke.opacity,
      thickness: spec.line.strokeWidth,
    });
  }
}

const drawFlattenedLine = (page, obj, pageHeight) => {
  const stroke = parsePdfDrawColor(obj?.stroke || '#000000', '#000000') || parsePdfDrawColor('#000000');
  const width = Math.max(0.5, Number(obj?.strokeWidth) || 1);
  // Same contract as createLineAnnotation / group flatten: world from
  // getLineEndpoints so a parent left/top offset is applied once. Callout
  // leaders pass world x1..y2 with no left/width — center is 0 and this
  // is a no-op.
  const ep = getLineEndpoints(obj);
  const x1 = Number.isFinite(ep.x1) ? ep.x1 : getObjNumber(obj, 'x1');
  const y1 = Number.isFinite(ep.y1) ? ep.y1 : getObjNumber(obj, 'y1');
  const x2 = Number.isFinite(ep.x2) ? ep.x2 : getObjNumber(obj, 'x2');
  const y2 = Number.isFinite(ep.y2) ? ep.y2 : getObjNumber(obj, 'y2');
  // UX (2026-07-17, line style): honor a stored strokeDashArray so dashed /
  // dotted lines (and callout leader pieces, which pass the shared callout
  // dash) print with their on-screen pattern instead of flattening solid.
  const dash = Array.isArray(obj?.strokeDashArray) && obj.strokeDashArray.length > 0
    ? obj.strokeDashArray.map((v) => Number(v) || 0)
    : null;
  page.drawLine({
    start: { x: x1, y: getPdfY(pageHeight, y1) },
    end: { x: x2, y: getPdfY(pageHeight, y2) },
    color: stroke.color,
    thickness: width,
    opacity: stroke.opacity,
    ...(dash ? { dashArray: dash, dashPhase: 0 } : {}),
  });
  const ending2 = String(obj?.lineEnding2 || obj?.data?.lineEnding2 || '').toLowerCase();
  const isArrow = ending2.includes('arrow') || obj?.data?.annotationType === 'arrow' || obj?.tool === 'arrow';
  if (isArrow) drawArrowHead(page, { x1, y1, x2, y2, pageHeight, color: stroke.color, width });
};

// UX 2026-07-17 (print text style): pick the embedded Helvetica variant that
// matches what the user sees on screen. Understands both fabric-native fields
// (fontWeight/fontStyle on freetext objects) and the callout booleans
// (bold/italic) so both shapes print with their chosen weight/slant.
const pickFlattenedTextFont = (obj, fonts) => {
  if (!fonts || typeof fonts !== 'object') return fonts;
  const group = pdfStandardFontGroup(obj?.fontFamily);
  const familyFonts = fonts.byFamily?.[group] || fonts;
  if (!familyFonts || typeof familyFonts !== 'object' || !familyFonts.regular) return fonts;
  const isBold = obj?.fontWeight === 'bold' || Number(obj?.fontWeight) >= 600 || obj?.bold === true;
  const isItalic = obj?.fontStyle === 'italic' || obj?.fontStyle === 'oblique' || obj?.italic === true;
  if (isBold && isItalic) return familyFonts.boldOblique || familyFonts.bold || familyFonts.regular;
  if (isBold) return familyFonts.bold || familyFonts.regular;
  if (isItalic) return familyFonts.oblique || familyFonts.regular;
  return familyFonts.regular;
};

const drawFlattenedText = (page, obj, pageHeight, fonts) => {
  const fill = parsePdfDrawColor(obj?.fill || obj?.stroke || '#000000', '#000000') || parsePdfDrawColor('#000000');
  const left = getObjNumber(obj, 'left');
  const top = getObjNumber(obj, 'top');
  const scaleX = Math.abs(Number(obj?.scaleX) || 1);
  const scaleY = Math.abs(Number(obj?.scaleY) || 1);
  // Same box contract as createFreeTextAnnotation / renderText. fontSize is
  // not multiplied — group-resize grows the wrap box, not the glyphs.
  const height = Math.max(1, getObjNumber(obj, 'height', Number(obj?.fontSize) || 14) * scaleY);
  const fontSize = Math.max(4, Number(obj?.fontSize) || 12);
  const font = pickFlattenedTextFont(obj, fonts);
  const maxWidth = Math.max(1, getObjNumber(obj, 'width', 200) * scaleX);
  // Live toolbar writes Fill on backgroundColor. Flatten used to draw
  // glyphs only, so a user-picked box fill never printed.
  const boxFill = resolveTextboxBoxFill(obj);
  if (boxFill.visible) {
    const paint = parsePdfDrawColor(boxFill.paint, boxFill.hex);
    if (paint) {
      page.drawRectangle({
        x: left,
        y: getPdfY(pageHeight, top + height),
        width: maxWidth,
        height,
        color: paint.color,
        opacity: paint.opacity,
        borderWidth: 0,
      });
    }
  }
  // UX 2026-08-20: wrap + draw each line ourselves so underline/strikethrough
  // track every line (pdf-lib has no text-decoration operator). Line height
  // matches pdf-lib's default (font.heightAtSize).
  const wantsUnderline = obj?.underline === true;
  const wantsLinethrough = obj?.linethrough === true || obj?.strikethrough === true;
  const measure = (s) => {
    try {
      return font.widthOfTextAtSize(String(s || ''), fontSize);
    } catch {
      return maxWidth;
    }
  };
  const lines = wrapFlattenedTextLines(String(obj?.text || ''), { measure, maxWidth });
  const lineHeight = typeof font.heightAtSize === 'function'
    ? font.heightAtSize(fontSize)
    : fontSize * 1.2;
  const extraTop = flattenedTextBlockOffset(height, lines.length * lineHeight, obj?.verticalAlign);
  const baselineY = getPdfY(
    pageHeight,
    top + extraTop + Math.min(Math.max(1, height - extraTop), fontSize + 2),
  );
  const thickness = Math.max(0.5, fontSize / 14);
  lines.forEach((line, i) => {
    const y = baselineY - i * lineHeight;
    let lineWidth = 0;
    try {
      lineWidth = line ? Math.min(maxWidth, measure(line)) : 0;
    } catch {
      lineWidth = line ? maxWidth : 0;
    }
    const extraLeft = flattenedTextInlineOffset(maxWidth, lineWidth, obj?.textAlign);
    if (line) {
      page.drawText(line, {
        x: left + extraLeft,
        y,
        size: fontSize,
        font,
        color: fill.color,
        opacity: fill.opacity,
      });
    }
    if (!(wantsUnderline || wantsLinethrough)) return;
    if (!(lineWidth > 0)) return;
    const drawDecorationLine = (lineY) => page.drawLine({
      start: { x: left + extraLeft, y: lineY },
      end: { x: left + extraLeft + lineWidth, y: lineY },
      color: fill.color,
      thickness,
      opacity: fill.opacity,
    });
    if (wantsUnderline) drawDecorationLine(y - fontSize * 0.12);
    if (wantsLinethrough) drawDecorationLine(y + fontSize * 0.28);
  });
};

const drawFlattenedCounterLabel = (page, obj, pageHeight, font) => {
  const text = String(obj?.data?.displayNumber ?? '');
  if (!text) return;
  const radius = Math.max(1, (Number(obj?.radius) || 10) * Math.abs(Number(obj?.scaleX) || 1));
  const left = getObjNumber(obj, 'left');
  const top = getObjNumber(obj, 'top');
  const labelLayout = getCounterLabelLayout(radius, text);
  let fontSize = labelLayout.fontSize;
  let textWidth = font.widthOfTextAtSize(text, fontSize);
  if (textWidth > labelLayout.maxWidth && textWidth > 0) {
    fontSize *= labelLayout.maxWidth / textWidth;
    textWidth = font.widthOfTextAtSize(text, fontSize);
  }
  const fill = parsePdfDrawColor(obj?.data?.numberColor || '#ffffff', '#ffffff') || parsePdfDrawColor('#ffffff');
  page.drawText(text, {
    x: left + radius - textWidth / 2,
    y: getPdfY(pageHeight, top + radius + fontSize / 2 - 2),
    size: fontSize,
    font,
    color: fill.color,
    opacity: fill.opacity,
  });
};

const drawFlattenedCounterPin = (page, obj, pageHeight, font) => {
  const radius = Math.max(1, (Number(obj?.radius) || 14) * Math.abs(Number(obj?.scaleX) || 1));
  const left = getObjNumber(obj, 'left');
  const top = getObjNumber(obj, 'top');
  const centerX = left + radius;
  const centerY = top + radius;
  const color = parsePdfDrawColor(obj?.fill || obj?.data?.color || '#ef4444', '#ef4444') || parsePdfDrawColor('#ef4444');
  const pointerAngleDeg = obj?.data?.pointerAngle ?? 225;
  const angleRad = (Number(pointerAngleDeg) * Math.PI) / 180;
  const dirX = Math.cos(angleRad);
  const dirY = Math.sin(angleRad);
  const tipExtension = radius * 0.5;
  const tipDistance = radius + tipExtension;
  const tipX = centerX + dirX * tipDistance;
  const tipY = centerY + dirY * tipDistance;
  const tangentHalfAngle = Math.acos(radius / tipDistance);
  const t1Angle = angleRad + tangentHalfAngle;
  const t2Angle = angleRad - tangentHalfAngle;
  const t1x = centerX + Math.cos(t1Angle) * radius;
  const t1y = centerY + Math.sin(t1Angle) * radius;
  const t2x = centerX + Math.cos(t2Angle) * radius;
  const t2y = centerY + Math.sin(t2Angle) * radius;
  // GOTCHA (drawSvgPath origin trap — see drawFlattenedArrowheadSpec):
  // origin {x: 0, y: pageHeight} + RAW app-space (y-down) coordinates; the
  // default origin (page bottom-left) negates y and lands the pin off-page.
  // In this y-down frame the arc sweep flag is 1, matching the on-screen pin
  // path in counterGeometry.js (a pre-flipped y-up frame would need sweep 0).
  const d = [
    `M ${tipX} ${tipY}`,
    `L ${t1x} ${t1y}`,
    `A ${radius} ${radius} 0 1 1 ${t2x} ${t2y}`,
    'Z',
  ].join(' ');

  page.drawSvgPath(d, {
    x: 0,
    y: pageHeight,
    color: color.color,
    opacity: color.opacity ?? (Number.isFinite(Number(obj?.opacity)) ? Number(obj.opacity) : 1),
    borderWidth: 0,
  });
  drawFlattenedCounterLabel(page, obj, pageHeight, font);
  console.log('[PDFPrintFlatten] counter pin path flattened ' + JSON.stringify({
    id: obj?.id || obj?.data?.id || null,
    radius,
    pointerAngle: Number(pointerAngleDeg),
    displayNumber: obj?.data?.displayNumber ?? obj?.data?.number ?? null,
  }));
};

const drawFlattenedPolygon = (page, obj, pageHeight, closePath = true) => {
  const points = Array.isArray(obj?.points) ? obj.points : [];
  if (points.length < (closePath ? 3 : 2)) return false;
  // GOTCHA (drawSvgPath origin trap — see drawFlattenedArrowheadSpec):
  // origin {x: 0, y: pageHeight} + RAW app-space (y-down) coordinates; the
  // default origin (page bottom-left) negates y and lands the shape off-page.
  const d = points.map((point, index) => {
    const world = polygonWorldPoint(obj, point);
    return `${index === 0 ? 'M' : 'L'} ${world.x} ${world.y}`;
  }).join(' ') + (closePath ? ' Z' : '');
  const stroke = parsePdfDrawColor(obj?.stroke || '#000000', '#000000') || parsePdfDrawColor('#000000');
  const fill = closePath ? parsePdfDrawColor(obj?.fill, '#ffffff') : null;
  page.drawSvgPath(d, {
    x: 0,
    y: pageHeight,
    borderColor: stroke.color,
    borderWidth: Math.max(0.5, Number(obj?.strokeWidth) || 1),
    color: fill?.color,
    opacity: fill?.opacity ?? 1,
    borderOpacity: stroke.opacity,
  });
  return true;
};

const drawFlattenedObject = (page, obj, pageHeight, fonts, offset = { x: 0, y: 0 }) => {
  if (!obj || typeof obj !== 'object') return 0;
  if (Array.isArray(obj.objects)) {
    const parentLeft = Number(obj.left) || 0;
    const parentTop = Number(obj.top) || 0;
    // Offset only the bbox origin. Line x1..y2 stay center-relative so
    // getLineEndpoints (left+width/2 + x1) yields world coords. Adding
    // parentLeft to x1 here used to double-offset after the P1-01 fix.
    return obj.objects.reduce((sum, child) => sum + drawFlattenedObject(page, {
      ...child,
      left: (Number(child?.left) || 0) + parentLeft,
      top: (Number(child?.top) || 0) + parentTop,
    }, pageHeight, fonts, offset), 0);
  }
  const type = String(obj.type || '').toLowerCase();
  const shifted = offset.x || offset.y
    ? { ...obj, left: (Number(obj.left) || 0) + offset.x, top: (Number(obj.top) || 0) + offset.y }
    : obj;
  const stroke = parsePdfDrawColor(shifted?.stroke || '#000000', '#000000') || parsePdfDrawColor('#000000');
  const fill = parsePdfDrawColor(shifted?.fill, '#ffffff');
  const left = getObjNumber(shifted, 'left');
  const top = getObjNumber(shifted, 'top');
  const scaleX = Math.abs(Number(shifted?.scaleX) || 1);
  const scaleY = Math.abs(Number(shifted?.scaleY) || 1);
  const width = Math.max(0, getObjNumber(shifted, 'width') * scaleX);
  const height = Math.max(0, getObjNumber(shifted, 'height') * scaleY);
  const strokeWidth = Math.max(0.5, Number(shifted?.strokeWidth) || 1);
  if (![left, top, width, height, pageHeight].every(Number.isFinite)) return 0;

  if ((type === 'circle' || type === 'ellipse') && shifted?.data?.type === 'counter') {
    drawFlattenedCounterPin(page, shifted, pageHeight, fonts.bold);
    return 1;
  }

  if (type === 'path') {
    // Same affine as SVG / ink export (createInkPageTransform): after
    // move/scale/rotate the authored path stays local and left/top/scale/
    // angle/pathOffset carry the transform. Drawing raw commands printed
    // the unmoved stroke.
    const localPath = normalizeOperationalInkPath(shifted.path);
    const transform = createInkPageTransform(shifted, localPath);
    const path = fabricPathToSvgPath(transformInkPath(localPath, transform));
    if (!path) return 0;
    const inkStrokeWidth = Math.max(
      0.5,
      (Number(shifted?.strokeWidth) || 1)
        * (Number.isFinite(transform.strokeScale) ? transform.strokeScale : 1),
    );
    // GOTCHA (drawSvgPath origin trap — see drawFlattenedArrowheadSpec):
    // origin {x: 0, y: pageHeight} + RAW app-space (y-down) path coordinates.
    // The default origin (page bottom-left) negates y off-page.
    page.drawSvgPath(path, {
      x: 0,
      y: pageHeight,
      borderColor: stroke.color,
      borderWidth: inkStrokeWidth,
      borderOpacity: stroke.opacity,
    });
    return 1;
  }
  if (type === 'rect') {
    const cloudIntensity = Number(shifted?.data?.pdfCloudIntensity ?? shifted?.cloudIntensity);
    if (Number.isFinite(cloudIntensity) && width > 0 && height > 0) {
      const cloudCmds = buildCloudPathCommands(
        [
          { x: left, y: top },
          { x: left + width, y: top },
          { x: left + width, y: top + height },
          { x: left, y: top + height },
        ],
        cloudIntensity,
        strokeWidth,
      );
      const cloudPath = Array.isArray(cloudCmds) && cloudCmds.length > 0
        ? fabricPathToSvgPath(cloudCmds)
        : '';
      if (cloudPath) {
        page.drawSvgPath(cloudPath, {
          x: 0,
          y: pageHeight,
          color: fill?.color,
          opacity: fill?.opacity ?? (Number.isFinite(Number(shifted?.opacity)) ? Number(shifted.opacity) : undefined),
          borderColor: stroke.color,
          borderWidth: strokeWidth,
          borderOpacity: stroke.opacity,
        });
        return 1;
      }
    }
    // UX (2026-07-17, line style): dashed/dotted rect borders (incl. the
    // callout text box, which flattens through this branch) print with their
    // on-screen dash pattern instead of flattening solid.
    const rectDash = Array.isArray(shifted?.strokeDashArray) && shifted.strokeDashArray.length > 0
      ? shifted.strokeDashArray.map((v) => Number(v) || 0)
      : null;
    page.drawRectangle({
      x: left,
      y: getPdfY(pageHeight, top + height),
      width,
      height,
      borderColor: stroke.color,
      borderWidth: strokeWidth,
      color: fill?.color,
      opacity: fill?.opacity ?? (Number.isFinite(Number(shifted?.opacity)) ? Number(shifted.opacity) : undefined),
      borderOpacity: stroke.opacity,
      ...(rectDash ? { borderDashArray: rectDash, borderDashPhase: 0 } : {}),
    });
    return 1;
  }
  if (type === 'circle' || type === 'ellipse') {
    // P1-04 leftover: radius/rx/ry stay unbaked after resize. width/height
    // above are already *scale — do not reuse them as a radius fallback.
    const xScale = (
      Number(shifted?.rx) || Number(shifted?.radius) || (getObjNumber(shifted, 'width') / 2) || 10
    ) * scaleX;
    const yScale = (
      Number(shifted?.ry) || Number(shifted?.radius) || (getObjNumber(shifted, 'height') / 2) || 10
    ) * scaleY;
    page.drawEllipse({
      x: left + xScale,
      y: getPdfY(pageHeight, top + yScale),
      xScale,
      yScale,
      borderColor: stroke.color,
      borderWidth: strokeWidth,
      color: fill?.color,
      opacity: fill?.opacity ?? 1,
      borderOpacity: stroke.opacity,
    });
    return 1;
  }
  if (type === 'line') {
    drawFlattenedLine(page, shifted, pageHeight);
    return 1;
  }
  if (type === 'polygon') return drawFlattenedPolygon(page, shifted, pageHeight, true) ? 1 : 0;
  if (type === 'polyline') return drawFlattenedPolygon(page, shifted, pageHeight, false) ? 1 : 0;
  if (type === 'textbox' || type === 'text' || type === 'i-text') {
    // UX 2026-07-17: pass the whole fonts map so bold/italic text prints in
    // the matching Helvetica variant instead of always regular.
    drawFlattenedText(page, shifted, pageHeight, fonts);
    return 1;
  }
  return 0;
};

const drawFlattenedCallout = (page, calloutObj, pageHeight, fonts) => {
  if (!calloutObj) return 0;
  const style = calloutObj.style || {};
  const stroke = style.borderColor || style.lineColor || '#1e293b';
  const strokeWidth = Math.max(1, Number(style.lineThickness || 2));
  const arrowTip = calloutObj.arrowTip;
  const knee = calloutObj.knee;
  const textBox = calloutObj.textBox;
  if (!arrowTip || !knee || !textBox) return 0;
  // UX (2026-07-17, callout line style): style.lineStyle dashes line1/line2
  // AND the box border in print, mirroring the SVG renderer / canvas painter;
  // the arrowhead stays solid (same as the arrow tool). Absent → solid.
  const leaderDash = calloutLineDashArray(style.lineStyle);
  const leaderDashProps = leaderDash ? { strokeDashArray: leaderDash } : {};
  drawFlattenedLine(page, { type: 'line', x1: textBox.left, y1: textBox.top + textBox.height / 2, x2: knee.x, y2: knee.y, stroke, strokeWidth, ...leaderDashProps }, pageHeight);
  // UX (print flatten callout arrowhead): honor style.arrowheadStyle via the
  // shared arrow-tool spec — same default (solid triangle) and same line2
  // shortening the SVG renderer / canvas painter use, so print matches the
  // screen for every head style. Replaces the old hard-coded ClosedArrow.
  const arrowheadStyle = resolveCalloutArrowheadStyle(style);
  const arrowAngleDeg = (
    Math.atan2(arrowTip.y - knee.y, arrowTip.x - knee.x) * 180
  ) / Math.PI;
  const arrowheadSpec = buildArrowheadRenderSpec(
    arrowheadStyle, arrowTip.x, arrowTip.y, arrowAngleDeg, stroke, strokeWidth,
  );
  let line2EndX = arrowTip.x;
  let line2EndY = arrowTip.y;
  if (arrowheadStyle === ARROWHEAD_STYLES.SOLID_TRIANGLE
    || arrowheadStyle === ARROWHEAD_STYLES.OPEN_TRIANGLE) {
    // Shorten line2 into the back of the head so the tail doesn't poke
    // through the point — same formula as the SVG/canvas surfaces.
    const headSize = Math.max(8, strokeWidth * 3);
    const angleRad = (arrowAngleDeg * Math.PI) / 180;
    line2EndX = arrowTip.x - (headSize / 3) * Math.cos(angleRad);
    line2EndY = arrowTip.y - (headSize / 3) * Math.sin(angleRad);
  }
  drawFlattenedLine(page, { type: 'line', x1: knee.x, y1: knee.y, x2: line2EndX, y2: line2EndY, stroke, strokeWidth, ...leaderDashProps }, pageHeight);
  drawFlattenedArrowheadSpec(page, arrowheadSpec, pageHeight);
  drawFlattenedObject(page, {
    type: 'rect',
    left: textBox.left,
    top: textBox.top,
    width: textBox.width,
    height: textBox.height,
    stroke,
    strokeWidth,
    ...leaderDashProps,
    fill: resolveCalloutBoxFill(style).paint,
  }, pageHeight, fonts);
  drawFlattenedText(page, {
    type: 'textbox',
    left: textBox.left + 4,
    top: textBox.top + 4,
    width: Math.max(1, textBox.width - 8),
    height: Math.max(1, textBox.height - 8),
    text: calloutObj.text || '',
    fill: style.fontColor || '#1e293b',
    fontSize: style.fontSize || 14,
    // UX 2026-07-17: thread the callout text-style booleans through so the
    // printed callout text matches the on-screen bold/italic/underline/
    // strikethrough styling (mapped inside drawFlattenedText).
    bold: style.bold === true,
    italic: style.italic === true,
    underline: style.underline === true,
    strikethrough: style.strikethrough === true,
    fontFamily: style.fontFamily,
    textAlign: style.textAlign,
  }, pageHeight, fonts);
  return 1;
};

export const savePDFWithFlattenedRegularAnnotationsForPrint = async (
  pdfFile,
  annotationsByPage,
  pageSizes,
  options = {},
) => {
  const actionType = options?.actionType || 'pdf-print-flattened-regular-annotations';
  const documentId = options?.documentId || null;
  const arrayBuffer = await pdfFile.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const helvetica = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    // UX 2026-07-17: oblique variants embedded so italic / bold-italic text
    // annotations print with their on-screen slant (Bug: flatten always used
    // regular Helvetica for text, dropping weight and style).
    oblique: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    boldOblique: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const times = {
    regular: await pdfDoc.embedFont(StandardFonts.TimesRoman),
    bold: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
    oblique: await pdfDoc.embedFont(StandardFonts.TimesRomanItalic),
    boldOblique: await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic),
  };
  const courier = {
    regular: await pdfDoc.embedFont(StandardFonts.Courier),
    bold: await pdfDoc.embedFont(StandardFonts.CourierBold),
    oblique: await pdfDoc.embedFont(StandardFonts.CourierOblique),
    boldOblique: await pdfDoc.embedFont(StandardFonts.CourierBoldOblique),
  };
  const fonts = {
    ...helvetica,
    byFamily: { helvetica, times, courier },
  };
  // UX 2026-07-17: surveyMarkers stays an empty map here ON PURPOSE — Survey
  // Markers are excluded from this "regular annotations only" print flatten by
  // design (see the contract comment on buildPrintableRegularAnnotationPayload).
  // The caller already ran the payload builder once with the REAL markers map
  // so the exclusion counts land in options.printableDiagnostics; this inner
  // rebuild only re-filters the pre-filtered pages, and passing the real map
  // again would double-count exclusions without printing anything more.
  const printablePayload = buildPrintableRegularAnnotationPayload({
    annotationsByPage,
    callouts: options?.callouts || [],
    surveyMarkers: {},
  });
  const printableDiagnostics = options?.printableDiagnostics || printablePayload.diagnostics;
  let flattenedPrintAnnotationsAdded = 0;

  // KAL-91 — mirror of the export path's edited-replacement native
  // suppression: an imported object only reaches the printable payload when
  // it IS an edited replacement (unedited imported copies never pass the
  // payload filter), so its stale native original must not also print.
  // Removal is gated on the flatten actually succeeding for EVERY member of
  // the replacement (composite groups count all members) — never leave the
  // print showing neither version. Same request shape + resolver
  // (applyNativePdfAnnotationRemovalPlan) as savePDFWithAnnotationsPdfLib.
  const editedImportTrackers = new Map();
  const trackEditedImportDraw = (pageNumber, obj, drawnCount) => {
    if (!isPdfImportedObject(obj)) return;
    const compositeId = getPdfAppearanceCompositeId(obj);
    const key = compositeId
      ? `${pageNumber}:composite:${compositeId}`
      : `${pageNumber}:annot:${obj?.pdfAnnotationId}`;
    let tracker = editedImportTrackers.get(key);
    if (!tracker) {
      tracker = {
        expected: 0,
        drawn: 0,
        request: {
          kind: 'edited',
          pageNumber,
          pdfAnnotationId: obj?.pdfAnnotationId,
          pdfAnnotationType: obj?.pdfAnnotationType,
          pdfNativeAnnotationIdentity:
            obj?.data?.pdfNativeAnnotationIdentity
            || obj?.pdfNativeAnnotationIdentity
            || null,
        },
      };
      editedImportTrackers.set(key, tracker);
    }
    tracker.expected += 1;
    if (drawnCount > 0) tracker.drawn += 1;
  };

  Object.entries(printablePayload.annotationsByPage || {}).forEach(([pageKey, pageData]) => {
    const pageNumber = Number.parseInt(pageKey, 10);
    const pageIndex = pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) return;
    const page = pdfDoc.getPage(pageIndex);
    const fallbackSize = page.getSize();
    const pageSize = pageSizes[String(pageNumber)] || pageSizes[pageNumber] || fallbackSize;
    const pageHeight = Number(pageSize?.height) || fallbackSize.height;
    (Array.isArray(pageData?.objects) ? pageData.objects : []).forEach((obj) => {
      const drawnCount = drawFlattenedObject(page, obj, pageHeight, fonts);
      flattenedPrintAnnotationsAdded += drawnCount;
      trackEditedImportDraw(pageNumber, obj, drawnCount);
    });
  });

  (Array.isArray(printablePayload.callouts) ? printablePayload.callouts : []).forEach((callout, index) => {
    const pageNumber = Number(callout?.pageNumber || 1);
    const pageIndex = pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) return;
    const page = pdfDoc.getPage(pageIndex);
    const fallbackSize = page.getSize();
    const pageSize = pageSizes[String(pageNumber)] || pageSizes[pageNumber] || fallbackSize;
    const pageHeight = Number(pageSize?.height) || fallbackSize.height;
    const calloutObj = calloutToExportObject(callout, pageSize);
    if (calloutObj) flattenedPrintAnnotationsAdded += drawFlattenedCallout(page, calloutObj, pageHeight, fonts);
  });

  const editedImportDiagnostics = {
    editedImportedNativeCopiesRemoved: 0,
    editedImportedNativeCopiesRemoveMisses: 0,
    deletedImportedNativeCopiesRemoved: 0,
    deletedImportedNativeCopiesRemoveMisses: 0,
  };
  applyNativePdfAnnotationRemovalPlan({
    pdfDoc,
    requests: [...editedImportTrackers.values()]
      .filter((tracker) => tracker.drawn > 0 && tracker.drawn === tracker.expected)
      .map((tracker) => tracker.request),
    exportDiagnostics: editedImportDiagnostics,
  });

  const regularAnnotationsIncluded =
    (Number(printablePayload.diagnostics?.included?.fabric) || 0)
    + (Number(printablePayload.diagnostics?.included?.callouts) || 0);
  const scopedAnnotationsExcluded = Object.values(printableDiagnostics?.excludedByScope || {})
    .reduce((sum, count) => sum + (Number(count) || 0), 0);
  // KAL-441: printing with markup also starts from the ORIGINAL PDF bytes, so
  // without this the printed sheet showed empty form boxes even though the user
  // had filled them in on screen. The generated appearance streams are what a
  // printer renders, so writing the values is enough — no separate flatten.
  const formFieldDiagnostics = applyFormFieldValuesToPdfDoc(
    pdfDoc,
    collectFormFieldValues(annotationsByPage),
  );
  // See the export path: appearances are already regenerated by the writer.
  const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
  console.log('[PDFPrintFlatten] pdf bytes generated ' + JSON.stringify({
    actionType,
    documentId,
    pdfBytesGenerated: true,
    byteLength: pdfBytes?.length || pdfBytes?.byteLength || 0,
    flattenedPrintAnnotationsAdded,
    pdfFormFieldValuesConsidered: formFieldDiagnostics.formFieldValuesConsidered,
    pdfFormFieldValuesWritten: formFieldDiagnostics.formFieldValuesWritten,
    pdfFormFieldValuesSkipped: formFieldDiagnostics.formFieldValuesSkipped,
    pdfFormFieldSkipReasons: formFieldDiagnostics.formFieldSkipReasons,
    regularAnnotationsIncluded,
    scopedAnnotationsExcluded,
    editedImportedNativeCopiesRemoved: editedImportDiagnostics.editedImportedNativeCopiesRemoved,
    editedImportedNativeCopiesRemoveMisses: editedImportDiagnostics.editedImportedNativeCopiesRemoveMisses,
    printableDiagnostics,
  }));
  return pdfBytes;
};

/**
 * Save PDF with embedded annotations using pdf-lib
 */
export const savePDFWithAnnotationsPdfLib = async (pdfFile, annotationsByPage, pageSizes, pdfFilePath = null, options = {}) => {
  try {
    const actionType = options?.actionType || (options?.returnBytes ? 'pdf-export' : 'legacy-pdf-save');
    const documentId = options?.documentId || null;
    const allowOriginalOverwrite = options?.allowOriginalOverwrite === true;
    let countersExported = 0;
    let counterMetadataFailures = 0;

    // Load PDF
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);

    let totalAnnotations = 0;
    const exportPlan = buildPdfExportAnnotationPlan({
      annotationsByPage,
      callouts: options?.callouts || [],
      surveyMarkers: options?.surveyMarkers || {},
      pageSizes,
      spaces: options?.spaces || [],
    });
    const exportDiagnostics = exportPlan.diagnostics;
    const appLayerState = buildPdfAppLayerStateMetadata({
      documentId,
      exportId: options?.exportId || `${documentId || 'local'}-${Date.now()}`,
      annotationsByPage,
      callouts: options?.callouts || [],
      surveyMarkers: options?.surveyMarkers || {},
      spaces: options?.spaces || [],
    });
    const appLayerStateEmbedded = applyAppLayerStateMetadataToPdf(pdfDoc, appLayerState);

    const deletedPdfAnnotations = [
      ...new Map(
        (Array.isArray(options?.deletedPdfAnnotations)
          ? options.deletedPdfAnnotations
          : [])
          .filter((entry) => entry?.pdfAnnotationId)
          .map((entry) => [
            `${Number(entry.pageNumber)}:${String(entry.pdfAnnotationId)}`,
            entry,
          ]),
      ).values(),
    ];
    // Native replacements are committed in three phases below:
    //   1. create every replacement ref without attaching it,
    //   2. remove tombstoned originals plus originals whose replacement
    //      creation succeeded, resolving against the ORIGINAL /Annots arrays,
    //   3. attach the successfully-created replacement refs.
    // This preserves a native original when its writer returns null/throws,
    // while still avoiding source-index drift and duplicate-/NM ambiguity.
    const nativeDeletionRemovalRequests = deletedPdfAnnotations.map((entry) => ({
      kind: 'deleted',
      pageNumber: Number(entry.pageNumber),
      pdfAnnotationId: entry.pdfAnnotationId,
      pdfAnnotationType: entry.pdfAnnotationType,
      pdfNativeAnnotationIdentity:
        entry.pdfNativeAnnotationIdentity
        || entry.data?.pdfNativeAnnotationIdentity
        || null,
    }));
    const successfulEditedNativeRemovalRequests = [];
    const pendingAnnotationRefs = [];
    const editedCompositeExpectedItemCounts = new Map();
    const successfulEditedCompositeItemCounts = new Map();
    const editedCompositeRemovalRequests = new Map();
    const compositeExportKeyForItem = (item) => (
      item?.editedImportedReplacement && item?.appearanceCompositeId
        ? `${Number(item.pageNumber)}:${String(item.appearanceCompositeId)}`
        : null
    );
    exportPlan.items.forEach((item) => {
      const compositeExportKey = compositeExportKeyForItem(item);
      if (!compositeExportKey) return;
      editedCompositeExpectedItemCounts.set(
        compositeExportKey,
        (editedCompositeExpectedItemCounts.get(compositeExportKey) || 0) + 1,
      );
    });

    exportPlan.items.forEach((item) => {
      const pageNumStr = String(item.pageNumber);
      const pageNumber = Number.parseInt(pageNumStr, 10) - 1; // Convert to 0-indexed
      const pageSize = pageSizes[pageNumStr] || pageSizes[item.pageNumber];
      const obj = item.object;

      if (!pageSize) {
        recordSkip(exportDiagnostics, item, 'missing-page-size-at-write');
        return;
      }

      if (pageNumber < 0 || pageNumber >= pdfDoc.getPageCount()) {
        recordSkip(exportDiagnostics, item, 'missing-pdf-page');
        return;
      }

      const page = pdfDoc.getPage(pageNumber);
      const pageHeight = pageSize.height;

      // Get or create Annots array
      let annots = page.node.lookup(PDFName.of('Annots'));
      if (!annots) {
        annots = pdfDoc.context.obj([]);
        page.node.set(PDFName.of('Annots'), annots);
      }

      let annotRef = null;
      let annotRefs = null;
      const objType = obj?.type?.toLowerCase?.() || item.fabricType || 'unknown';
      const isCounter = obj?.data?.type === 'counter';
      const appAnnotationMetadataJson = (!isCounter && item.type !== 'callout')
        ? serializePdfAppAnnotationMetadata(obj, item)
        : null;
      const appAnnotationOptions = appAnnotationMetadataJson
        ? {
            appAnnotationMetadataJson,
            appAnnotationMetadata: JSON.parse(appAnnotationMetadataJson),
            name: item.id || getObjectId(obj),
          }
        : {};

      // UX 2026-07-17 (subtype-preserving export for edited imports): when an
      // EDITED imported copy carries a native subtype whose in-app proxy is a
      // generic fabric shape (Highlight/Text/Caret), re-emit that subtype so
      // the re-exported file keeps the annotation's real identity. All other
      // objects fall through to the fabric-type switch below.
      const editedImportSubtypeWriter = item.editedImportedReplacement
        ? EDITED_IMPORT_SUBTYPE_WRITERS[obj?.pdfAnnotationType || obj?.data?.pdfAnnotationType]
        : null;

      if (editedImportSubtypeWriter) {
        annotRef = editedImportSubtypeWriter(pdfDoc, page, obj, pageHeight, appAnnotationOptions);
      } else switch (objType) {
        case 'path':
          annotRef = createInkAnnotation(pdfDoc, page, obj, pageHeight, appAnnotationOptions);
          break;
        case 'rect':
          // isSurveyMarkerType accepts both 'survey-marker' (new) and 'highlight' (legacy)
          if (isSurveyMarkerType(item.type)) {
            annotRef = createHighlightAnnotation(pdfDoc, page, obj, pageHeight, appAnnotationOptions);
          } else {
            annotRef = createSquareAnnotation(pdfDoc, page, obj, pageHeight, appAnnotationOptions);
          }
          break;
        case 'circle':
          if (isCounter) {
            const counterMetadataJson = serializePdfCounterMetadata(obj, Number.parseInt(pageNumStr, 10));
            if (counterMetadataJson) {
              countersExported++;
              annotRef = createCircleAnnotation(pdfDoc, page, obj, pageHeight, {
                counterMetadataJson,
                counterMetadata: JSON.parse(counterMetadataJson),
              });
            } else {
              counterMetadataFailures++;
              annotRef = createCircleAnnotation(pdfDoc, page, obj, pageHeight);
            }
          } else {
            annotRef = createCircleAnnotation(pdfDoc, page, obj, pageHeight, appAnnotationOptions);
          }
          break;
        case 'ellipse':
          // Imported rotated ellipse — /Circle with the tilt baked into the
          // /AP matrix (see createEllipseAnnotation). Was silently dropped
          // ('unsupported-type') before 2026-07-17.
          annotRef = createEllipseAnnotation(pdfDoc, page, obj, pageHeight, appAnnotationOptions);
          break;
        case 'polygon':
          annotRef = createPolygonAnnotation(pdfDoc, page, obj, pageHeight, appAnnotationOptions);
          break;
        case 'polyline':
          annotRef = createPolyLineAnnotation(pdfDoc, page, obj, pageHeight, appAnnotationOptions);
          break;
        case 'line':
          annotRef = createLineAnnotation(pdfDoc, page, obj, pageHeight, appAnnotationOptions);
          break;
        case 'textbox':
        case 'text':
        case 'i-text':
          annotRef = createFreeTextAnnotation(pdfDoc, page, obj, pageHeight, appAnnotationOptions);
          break;
        case 'callout':
          annotRefs = createCalloutAnnotations(pdfDoc, page, obj, pageHeight);
          break;
        default:
          break;
      }

      const refsToPush = Array.isArray(annotRefs) ? annotRefs : (annotRef ? [annotRef] : []);
      if (refsToPush.length > 0) {
        const compositeExportKey = compositeExportKeyForItem(item);
        pendingAnnotationRefs.push({
          annots,
          refs: refsToPush,
          item,
          compositeExportKey,
        });
        if (item.editedImportedReplacement) {
          const removalRequest = {
            kind: 'edited',
            pageNumber: Number(item.pageNumber),
            pdfAnnotationId: obj?.pdfAnnotationId,
            pdfAnnotationType: obj?.pdfAnnotationType,
            pdfNativeAnnotationIdentity:
              obj?.data?.pdfNativeAnnotationIdentity
              || obj?.pdfNativeAnnotationIdentity
              || null,
          };
          if (compositeExportKey) {
            successfulEditedCompositeItemCounts.set(
              compositeExportKey,
              (successfulEditedCompositeItemCounts.get(compositeExportKey) || 0) + 1,
            );
            if (!editedCompositeRemovalRequests.has(compositeExportKey)) {
              editedCompositeRemovalRequests.set(compositeExportKey, removalRequest);
            }
          } else {
            successfulEditedNativeRemovalRequests.push(removalRequest);
          }
        }
        totalAnnotations += refsToPush.length;
        exportDiagnostics.pdfAnnotationsAdded += refsToPush.length;
      } else {
        recordSkip(exportDiagnostics, item, 'pdf-annotation-create-failed');
      }
    });

    const completeEditedCompositeKeys = new Set();
    editedCompositeExpectedItemCounts.forEach((expectedCount, compositeExportKey) => {
      if (successfulEditedCompositeItemCounts.get(compositeExportKey) !== expectedCount) return;
      completeEditedCompositeKeys.add(compositeExportKey);
      const removalRequest = editedCompositeRemovalRequests.get(compositeExportKey);
      if (removalRequest) successfulEditedNativeRemovalRequests.push(removalRequest);
    });

    applyNativePdfAnnotationRemovalPlan({
      pdfDoc,
      requests: [
        ...nativeDeletionRemovalRequests,
        ...successfulEditedNativeRemovalRequests,
      ],
      exportDiagnostics,
    });
    pendingAnnotationRefs.forEach(({
      annots,
      refs,
      item,
      compositeExportKey,
    }) => {
      if (
        compositeExportKey
        && !completeEditedCompositeKeys.has(compositeExportKey)
      ) {
        totalAnnotations -= refs.length;
        exportDiagnostics.pdfAnnotationsAdded -= refs.length;
        recordSkip(exportDiagnostics, item, 'pdf-appearance-composite-incomplete');
        return;
      }
      refs.forEach((ref) => annots.push(ref));
    });

    // KAL-441: carry the values the user typed into the PDF's own form fields
    // into the exported document. Without this the export silently returned a
    // blank form. Fields stay editable and the value is baked into each
    // field's appearance stream (see pdfFormFieldExport for the reasoning).
    const formFieldDiagnostics = applyFormFieldValuesToPdfDoc(
      pdfDoc,
      collectFormFieldValues(annotationsByPage),
    );

    // Save the PDF. updateFieldAppearances is off because the form writer above
    // already regenerated appearances inside its own try/catch — letting save()
    // redo it would let one awkward field throw the whole export away.
    const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
    pdfExportDebug('[PDFImportedEditExport] summary ' + JSON.stringify({
      actionType,
      documentId,
      importedNativeCopiesSkipped: exportDiagnostics.importedNativeCopiesSkipped,
      editedImportedCopiesExported: exportDiagnostics.editedImportedCopiesExported,
      editedImportedNativeCopiesRemoved: exportDiagnostics.editedImportedNativeCopiesRemoved,
      editedImportedNativeCopiesRemoveMisses: exportDiagnostics.editedImportedNativeCopiesRemoveMisses,
      deletedImportedNativeCopiesRemoved: exportDiagnostics.deletedImportedNativeCopiesRemoved,
      deletedImportedNativeCopiesRemoveMisses: exportDiagnostics.deletedImportedNativeCopiesRemoveMisses,
      reason: 'Unedited native copies remain unless their durable deletion tombstone removes them; edited copies replace their matching native annotation.'
    }));
    console.log('[PDFSaveExport] pdf bytes generated ' + JSON.stringify({
      actionType,
      documentId,
      pdfBytesGenerated: true,
      byteLength: pdfBytes?.length || pdfBytes?.byteLength || 0,
      exportContract: exportPlan.contract,
      exportDiagnostics: {
        ...exportDiagnostics,
        pdfAnnotationsAdded: totalAnnotations,
      },
      appObjectsSeen: exportDiagnostics.totalObjectsConsidered,
      pdfAnnotationsAdded: totalAnnotations,
      annotationCountsByType: exportDiagnostics.byType,
      annotationCountsByScope: exportDiagnostics.byScope,
      annotationCountsBySource: exportDiagnostics.bySource,
      annotationSkippedByReason: exportDiagnostics.skippedByReason,
      embeddedPdfNativeAnnotationHandling: exportPlan.contract.importedPdfNativeHandling,
      appLayerStateEmbedded,
      appLayerStateSummary: appLayerState ? {
        documentId: appLayerState.documentId,
        exportId: appLayerState.exportId,
        scopedAnnotationPages: Object.keys(appLayerState.layers?.scopedAnnotationsByPage || {}).length,
        scopedCallouts: Array.isArray(appLayerState.layers?.callouts) ? appLayerState.layers.callouts.length : 0,
        surveyMarkers: Object.keys(appLayerState.layers?.surveyMarkers || {}).length,
        spaces: Array.isArray(appLayerState.layers?.spaces) ? appLayerState.layers.spaces.length : 0,
      } : null,
      importedAppAnnotationsSkipped: exportDiagnostics.skippedByReason['imported-pdf-native-preserved'] || 0,
      editedImportedAppAnnotationsExported: exportDiagnostics.editedImportedCopiesExported,
      editedImportedNativeAnnotationsRemoved: exportDiagnostics.editedImportedNativeCopiesRemoved,
      editedImportedNativeAnnotationRemoveMisses: exportDiagnostics.editedImportedNativeCopiesRemoveMisses,
      deletedImportedNativeAnnotationsRemoved: exportDiagnostics.deletedImportedNativeCopiesRemoved,
      deletedImportedNativeAnnotationRemoveMisses: exportDiagnostics.deletedImportedNativeCopiesRemoveMisses,
      pdfFormFieldValuesConsidered: formFieldDiagnostics.formFieldValuesConsidered,
      pdfFormFieldValuesWritten: formFieldDiagnostics.formFieldValuesWritten,
      pdfFormFieldValuesSkipped: formFieldDiagnostics.formFieldValuesSkipped,
      pdfFormFieldSkipReasons: formFieldDiagnostics.formFieldSkipReasons,
      pdfFormFieldAppearancesUpdated: formFieldDiagnostics.formFieldAppearancesUpdated,
      pdfFormFieldAppearanceError: formFieldDiagnostics.formFieldAppearanceError,
      pdfFormFieldHandling: 'acroform-values-written-fields-stay-editable',
      countersExported,
      counterMetadataMarker: PDF_COUNTER_SUBJECT,
      counterMetadataKeys: [PDF_COUNTER_METADATA_KEY, 'Subj', 'NM', 'Contents'],
      counterMetadataFailures,
      localFilesystemWrite: false,
      outputPath: null
    }));

    // UX 2026-04-22: When callers want the raw bytes back (e.g. the
    // Export Annotated PDF menu item), skip the file-write / download
    // branches and return the Uint8Array directly.
    if (options?.returnBytes) {
      return pdfBytes;
    }

    // Check if we're in Electron and have the original file path
    if (window.electronAPI && pdfFilePath) {
      if (!allowOriginalOverwrite) {
        throw new Error('Refusing to overwrite the original PDF path without explicit allowOriginalOverwrite=true');
      }
      // Save to original file location using atomic write (crash-safe)
      if (window.electronAPI.writeFileAtomic) {
        await window.electronAPI.writeFileAtomic(pdfFilePath, pdfBytes);
      } else {
        // Fallback to regular write if atomic not available
        await window.electronAPI.writeFile(pdfFilePath, pdfBytes);
      }
      console.log('[PDFSaveExport] local filesystem write complete ' + JSON.stringify({
        actionType,
        documentId,
        localFilesystemWrite: true,
        outputPath: pdfFilePath,
        byteLength: pdfBytes?.length || pdfBytes?.byteLength || 0
      }));
    } else {
      // Fallback: Download the file (browser mode or no file path)
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log('[PDFSaveExport] browser download triggered ' + JSON.stringify({
        actionType,
        documentId,
        localFilesystemWrite: false,
        outputPath: pdfFile.name || null,
        byteLength: pdfBytes?.length || pdfBytes?.byteLength || 0
      }));
    }

    return true;
  } catch (error) {
    console.error('Error saving PDF with annotations:', error);
    throw error;
  }
};
