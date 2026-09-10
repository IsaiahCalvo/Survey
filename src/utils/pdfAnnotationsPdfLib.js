/**
 * PDF Annotation System using pdf-lib Low-Level API
 * Manually creates PDF annotations following PDF 1.7 specification
 * Compatible with Adobe Acrobat and all PDF readers
 */

import {
  BlendMode,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFRef,
  PDFString,
  LineCapStyle,
  StandardFonts,
  appendBezierCurve,
  appendQuadraticCurve,
  concatTransformationMatrix,
  closePath as closePathOperator,
  fill as fillOperator,
  degrees,
  drawObject,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  scale as scaleOperator,
  setFillingRgbColor,
  setGraphicsState,
  setLineJoin,
  translate as translateOperator,
} from 'pdf-lib';
import { renderPathToSvgAttrs } from './svgPathAttrs.js';
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
import { ARROWHEAD_STYLES, buildArrowheadRenderSpec, buildCurvedLineBody, calloutLineDashArray, insetOpenPolylinePoints, lineEndingBodyInset, resolveLineEndingStyles } from './lineRenderHelpers.js';
import { getCounterLabelLayout } from './counterGeometry.js';
import {
  adaptHighlight,
  adaptSquiggly,
  adaptStrikeOut,
  adaptUnderline,
  adaptLink,
  adaptRedact,
  getTextMarkupPageGeometry,
  viewportPointToPdfPoint,
} from './pdfNativeExport/adapters/textMarkup.js';
import { sanitizeUnappliedRedactionsForExport } from './pdfRedactionSafety.js';
import {
  buildStickyNoteGlyphSpec,
  getCloudPathBounds,
  isStickyNoteGlyphObject,
  resolveAnnotationCloudSpec,
  stickyNoteOutlineColor,
} from './pdfAnnotationAppearance.js';
// UX 2026-09-09: printed clouds come from the same resolver the screen uses.
import { cloudFillKnockoutRings, resolveCloudAnnotationGeometry } from './cloudAnnotationGeometry.js';
import { calculateCalloutConnection } from './calloutGeometry.js';
import { isPdfStampProxy, pngDataUrlToBytes } from './pdfStampProxy.js';

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

// Browser print must use the same app-side object the SVG layer paints. Keeping
// an untouched native annotation means print uses its /AP stream while the app
// hides that stream and paints the imported Fabric copy. Those two sources are
// allowed to differ (opacity, inset stroke, colour, and even authored state).
// Only replace types this flattener can draw. Other AP-only imports stay native
// until they have an app renderer and flattener.
const canFlattenImportedObjectForPrint = (obj) => {
  if (!isPdfImportedObject(obj)) return true;
  if (isPdfStampProxy(obj)) return true;
  if (obj?.data?.type === 'text-markup' && Array.isArray(obj?.data?.quads)) return true;
  if (Array.isArray(obj?.objects)) return obj.objects.length > 0;
  return EXPORTABLE_FABRIC_TYPES.has(String(obj?.type || '').toLowerCase());
};

const getPdfAppearanceCompositeId = (obj) => (
  obj?.data?.pdfAppearanceCompositeId
  || obj?.pdfAppearanceCompositeId
  || null
);

const clonePlain = (value) => deepClone(value);

// Print is an image of the app's annotation state, not a second export policy.
// Carry every canvas, survey, space, and region mark. Drawable imported copies
// are also the paint truth even when untouched; their native originals are
// removed only after the app copy flattened successfully.
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
      surveyMarkers: 0,
    },
    excluded: {
      fabric: 0,
      callouts: 0,
      counters: 0,
      surveyMarkers: 0,
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
  const surveyMarkerIds = new Set(Object.keys(surveyMarkers || {}).map(String));
  const calloutIds = new Set((Array.isArray(callouts) ? callouts : [])
    .map((callout) => getObjectId(callout))
    .filter(Boolean)
    .map(String));

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

  Object.entries(annotationsByPage || {}).forEach(([pageKey, pageData]) => {
    const objects = Array.isArray(pageData?.objects) ? pageData.objects : [];
    const printableObjects = [];

    objects.forEach((obj) => {
      const isCounter = obj?.data?.type === 'counter';
      const objectId = getObjectId(obj);
      const isProjectedCallout = (
        obj?.data?.type === 'callout'
        || obj?.type === 'callout'
        || obj?.exportType === 'callout'
      );
      // Callouts have their own source-of-truth list. The annotation layer may
      // also project one into by-page state for screen interaction; printing
      // both copies draws the leader twice.
      if (isProjectedCallout && objectId != null && calloutIds.has(String(objectId))) return;
      // Survey Markers can also have a canvas rect mirror for screen paint.
      // The marker map is the print source; flattening both would double its
      // opacity and make print darker than the screen.
      if (obj?.annotationId != null && surveyMarkerIds.has(String(obj.annotationId))) return;
      const editedImportedReplacement = isEditedImportedReplacement(obj);
      if (isPdfImportedObject(obj) && !canFlattenImportedObjectForPrint(obj)) {
        diagnostics.excluded.importedPdfNativePreserved += 1;
        return;
      }

      diagnostics.included.fabric += 1;
      if (isCounter) diagnostics.included.counters += 1;
      if (isPdfImportedObject(obj)) diagnostics.included.editedImportedCopies += 1;
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
    diagnostics.included.callouts += 1;
    printableCallouts.push(clonePlain(callout));
  });
  diagnostics.included.surveyMarkers = Object.keys(surveyMarkers || {}).length;

  return {
    annotationsByPage: printableAnnotationsByPage,
    callouts: printableCallouts,
    surveyMarkers: clonePlain(surveyMarkers || {}),
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
    // Same paint as the screen: dashed blue outline until an entity is
    // assigned (needsEntity), the marker's colour after.
    fill: surveyMarker?.needsEntity ? 'transparent' : (surveyMarker?.color || 'rgba(255,235,59,0.25)'),
    stroke: surveyMarker?.needsEntity ? '#4A90E2' : 'transparent',
    strokeWidth: surveyMarker?.needsEntity ? 2 : 0,
    strokeDashArray: surveyMarker?.needsEntity ? [5, 5] : undefined,
    globalCompositeOperation: 'multiply',
    opacity: surveyMarker?.opacity ?? 1,
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
    x1: left + Number(lineChild.x1),
    y1: top + Number(lineChild.y1),
    x2: left + Number(lineChild.x2),
    y2: top + Number(lineChild.y2),
    stroke: obj.stroke || lineChild.stroke || '#000000',
    strokeWidth: obj.strokeWidth || lineChild.strokeWidth || 2,
    // Legacy arrow groups: picked styles live in data and are resolved by
    // resolveLineEndingStyles; a head child with no recorded style is the old
    // default solid triangle.
    ...(obj?.data?.arrowheadStyle || obj?.data?.startArrowheadStyle
      ? {}
      : (hasArrowHead ? { lineEnding2: 'ClosedArrow' } : {})),
  };
};

export function buildPdfExportAnnotationPlan({
  annotationsByPage = {},
  callouts = [],
  surveyMarkers = {},
  pageSizes = {},
  spaces = [],
  // UX (owner ruling 2026-09-02): "Export annotated PDF" matches what the user
  // is looking at — regular markup as before PLUS the Survey Markers of the
  // module currently open in the template; other modules' markers stay out.
  activeModuleId = null,
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

    const isActiveModuleSurveyMarker = (
      item.source === 'survey-marker'
      && activeModuleId != null
      && (item.moduleId ?? null) === activeModuleId
    );
    if (item.source === 'survey-marker' && !isActiveModuleSurveyMarker) {
      recordSkip(diagnostics, item, 'survey-marker-export-excluded');
      return;
    }

    if (item.scope !== ANNOTATION_VISIBILITY_SCOPE.CANVAS && !isActiveModuleSurveyMarker) {
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

    const isTextMarkupGroup = item.fabricType === 'group' && obj?.data?.type === 'text-markup';
    if (!EXPORTABLE_FABRIC_TYPES.has(item.fabricType) && !isTextMarkupGroup && item.type !== 'callout' && !isSurveyMarkerType(item.type)) {
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
      includedScopes: activeModuleId != null
        ? [ANNOTATION_VISIBILITY_SCOPE.CANVAS, ANNOTATION_VISIBILITY_SCOPE.SURVEY]
        : [ANNOTATION_VISIBILITY_SCOPE.CANVAS],
      excludedScopes: [
        ...(activeModuleId != null ? [] : [ANNOTATION_VISIBILITY_SCOPE.SURVEY]),
        ANNOTATION_VISIBILITY_SCOPE.REGION,
        ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION,
      ],
      activeModuleId,
      importedPdfNativeHandling: 'preserve-unedited-native-annots-skip-unedited-imported-copies-export-edited-imported-copies',
      visibilityHandling: activeModuleId != null
        ? 'export-regular-viewer-annotations-plus-active-module-survey-markers'
        : 'export-regular-viewer-annotations-only-exclude-survey-spaces-regions',
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
 * UX 2026-09-09: /BE (Border Effect) is how the cloudy border round-trips. Every
 * shape writer that can carry the Cloud style writes the SAME dict the /Square
 * writer always did - /BE << /S /C /I <bump> >> - so exporting and re-importing
 * an ellipse, polygon or polyline cloud restores both the style and its bump
 * size instead of degrading to a plain outline.
 */
const applyCloudBorderEffectToDict = (pdfDoc, annotationDict, fabricObj) => {
  const cloud = resolveAnnotationCloudSpec(fabricObj);
  if (!cloud) return false;
  annotationDict.BE = pdfDoc.context.obj({
    S: PDFName.of('C'),
    I: PDFNumber.of(cloud.intensity),
  });
  return true;
};

// UX 2026-09-09: a cloud has to look the same in Acrobat, Preview, Chrome and
// poppler as it does on screen. Those viewers either ignore /BE or draw their
// own (different) scallops for it, so every cloud shape - rect, ellipse/circle
// (tilted or not), polygon, open polyline - ships an /AP /N form that paints
// the engine's exact crowns: the scalloped fill region first (nonzero, its own
// alpha), then the outline stroked with round caps and joins - the same two
// paints, in the same order, as the screen's CloudOutline and the flattener.
//
// The form is built in the shape's local, un-rotated frame (the engine frame,
// scale already baked in); /Matrix carries the tilt and /Rect is the page box
// of the ROTATED appearance box, so the viewer's BBox->Rect fit (PDF 32000
// 12.5.5) is a pure translation - never a hidden scale. Alpha is baked into
// the stream's ExtGState because a viewer must ignore /CA once an appearance
// stream exists (12.5.2); /CA is still written for viewers that regenerate.
// /BE + /I stay on the dict so our importer (and Acrobat) know the shape is a
// cloud and how big its bumps are, and /RD records the inset from the
// appearance box to the base rectangle/ellipse in that same local frame -
// which IS the spec's page-space definition whenever the shape is not tilted
// - so a re-import without our metadata rebuilds the base shape, not the
// inflated box.
const CLOUD_APPEARANCE_PAD = 1;

const cloudNumberText = (value) => pdfNumberText(Math.round(Number(value) * 1e4) / 1e4);

// Engine commands (absolute M/L/C/Z) -> content-stream operators through a
// point mapper (local frame -> form space).
const cloudCommandsToOperators = (commands, mapPoint) => {
  const lines = [];
  for (const [verb, ...values] of commands || []) {
    if (verb === 'Z') {
      lines.push('h');
      continue;
    }
    const operator = verb === 'M' ? 'm' : verb === 'L' ? 'l' : verb === 'C' ? 'c' : null;
    if (!operator) continue;
    const coords = [];
    for (let index = 0; index + 1 < values.length; index += 2) {
      const point = mapPoint(values[index], values[index + 1]);
      coords.push(cloudNumberText(point.x), cloudNumberText(point.y));
    }
    lines.push(`${coords.join(' ')} ${operator}`);
  }
  return lines;
};

// Per-run stroke operators: the studio (and the screen) paint one path per
// crown, so each run is its own `S`. A single multi-subpath `S` would paint
// the overlapping run junctions once (PDF 32000 11.7.4.4 treats one painting
// operation as one shape) and a translucent stroke would come out lighter
// there than on screen.
const cloudRunStrokeOperators = (geometry, mapPoint) => {
  const runs = Array.isArray(geometry.outlineRuns) && geometry.outlineRuns.length > 0
    ? geometry.outlineRuns
    : [geometry.outline];
  return runs.flatMap((run) => [...cloudCommandsToOperators(run, mapPoint), 'S']);
};

/**
 * Build the /AP /N form for a cloud annotation. Returns null when the object
 * is not a cloud (or paints nothing), so the caller keeps its plain path.
 *
 * FILL KNOCKOUT (2026-09-09, Drawboard parity): the fill is absent under the
 * whole stroke band, so a translucent stroke composites over the page, never
 * over its own fill, and fill alpha (ca) stays independent of stroke alpha
 * (CA). PDF has no mask-under-stroke primitive and its transparency tools
 * were probed and rejected: a knockout group (/K true) is ignored by pdf.js,
 * and a luminosity soft mask — Drawboard's SVG mask in PDF terms — is dropped
 * by Quartz inside annotation appearance streams (Preview showed the cloud
 * with NO fill at all; pdf.js additionally mis-rasterises /DeviceGray groups).
 * The knockout is therefore pure geometry (cloudFillKnockoutRings): the fill
 * region minus the union of every run's stroke capsules, painted with plain
 * even-odd fills that every viewer honours. It is exact to sampling precision
 * along the crowns and under the inward tails alike.
 *
 * @param {object} [options]
 * @param {object} [options.geometry]        pre-resolved cloud geometry
 * @param {string} [options.strokeFallback]  stroke paint when the object has none
 * @returns {{
 *   ref: PDFRef, rect: number[], rd: number[]|null,
 *   strokeAlpha: number, vertices: {x:number,y:number}[],
 *   matrix: number[]|null, bbox: number[], content: string,
 * }|null}
 */
const buildCloudAppearance = (pdfDoc, fabricObj, pageHeight, options = {}) => {
  const geometry = options.geometry
    || (resolveAnnotationCloudSpec(fabricObj) ? resolveCloudAnnotationGeometry(fabricObj) : null);
  if (!geometry) return null;
  const bounds = getCloudPathBounds(geometry.outline);
  if (!bounds) return null;
  const stroke = resolvedPdfPaint(fabricObj?.stroke, options.strokeFallback ?? 'transparent');
  const fill = geometry.fill ? resolvedPdfPaint(fabricObj?.fill, 'transparent') : null;
  const strokeWidth = stroke ? Math.max(0, Number(geometry.strokeWidth) || 0) : 0;
  const hasStroke = Boolean(stroke) && strokeWidth > 0;
  if (!hasStroke && !fill) return null;
  const objectOpacity = Number.isFinite(Number(fabricObj?.opacity))
    ? Math.max(0, Math.min(1, Number(fabricObj.opacity)))
    : 1;
  const strokeAlpha = hasStroke ? (stroke.opacity ?? 1) * objectOpacity : 1;
  const fillAlpha = fill ? (fill.opacity ?? 1) * objectOpacity : 1;
  const multiply = fabricObj?.globalCompositeOperation === 'multiply';
  const needsGraphicsState = strokeAlpha < 0.99999 || fillAlpha < 0.99999 || multiply;

  // Appearance box in the local frame: the crowns plus the round caps' half
  // stroke, plus a small anti-aliasing margin so no viewer clips the edge.
  const pad = strokeWidth / 2 + CLOUD_APPEARANCE_PAD;
  const box = {
    minX: bounds.minX - pad,
    minY: bounds.minY - pad,
    maxX: bounds.maxX + pad,
    maxY: bounds.maxY + pad,
  };
  const formWidth = box.maxX - box.minX;
  const formHeight = box.maxY - box.minY;
  if (!(formWidth > 0) || !(formHeight > 0)) return null;
  // Local frame is y-down (app space); form space is y-up inside /BBox.
  const toForm = (x, y) => ({ x: x - box.minX, y: box.maxY - y });
  const bbox = [0, 0, formWidth, formHeight];

  const n = pdfNumberText;
  const resources = {};
  if (needsGraphicsState) {
    resources.ExtGState = {
      GS0: {
        Type: 'ExtGState',
        CA: strokeAlpha,
        ca: fillAlpha,
        ...(multiply ? { BM: 'Multiply' } : {}),
      },
    };
  }
  const content = ['q'];
  if (needsGraphicsState) content.push('/GS0 gs');
  content.push('1 J 1 j');
  if (fill) {
    content.push(`${n(fill.color.red)} ${n(fill.color.green)} ${n(fill.color.blue)} rg`);
    const knockoutRings = hasStroke ? cloudFillKnockoutRings(geometry) : null;
    if (knockoutRings) {
      // Fill minus the stroke band: closed polygon rings (outer + holes),
      // painted even-odd so ring orientation cannot matter.
      for (const ring of knockoutRings) {
        ring.forEach((point, index) => {
          const mapped = toForm(point.x, point.y);
          content.push(`${cloudNumberText(mapped.x)} ${cloudNumberText(mapped.y)} ${index === 0 ? 'm' : 'l'}`);
        });
        content.push('h');
      }
      content.push('f*');
    } else {
      content.push(...cloudCommandsToOperators(geometry.fill, toForm), 'f');
    }
  }
  if (hasStroke) {
    content.push(`${n(stroke.color.red)} ${n(stroke.color.green)} ${n(stroke.color.blue)} RG`);
    content.push(`${n(strokeWidth)} w`);
    content.push(...cloudRunStrokeOperators(geometry, toForm));
  }
  content.push('Q');

  // fabric `angle` is screen-clockwise in y-down space; the same visual tilt
  // is a CCW rotation by -angle in PDF's y-up space (see createEllipseAnnotation).
  const angle = Number(geometry.angle) || 0;
  const theta = (-angle * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const matrix = angle ? [cos, sin, -sin, cos, 0, 0] : null;
  const contentText = `${content.join('\n')}\n`;
  const form = pdfDoc.context.flateStream(contentText, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: bbox,
    ...(matrix ? { Matrix: matrix } : {}),
    Resources: resources,
  });
  const ref = pdfDoc.context.register(form);

  // /Rect = page box of the appearance box rotated about the shape's pivot
  // (the AABB size is rotation-pivot independent, so it matches the viewer's
  // transformed /BBox exactly and the fit reduces to a translation).
  const toWorld = (point) => {
    const rotated = rotateAppPoint(point, geometry.pivot, angle);
    return { x: rotated.x + geometry.origin.x, y: rotated.y + geometry.origin.y };
  };
  const corners = [
    { x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY },
  ].map(toWorld);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const rect = [
    Math.min(...xs),
    pageHeight - Math.max(...ys),
    Math.max(...xs),
    pageHeight - Math.min(...ys),
  ];

  // /RD: [left, top, right, bottom] inset from the appearance box to the base
  // rectangle / ellipse box, in the local frame.
  let rd = null;
  if (geometry.kind === 'rectangle' || geometry.kind === 'ellipse') {
    const baseXs = geometry.points.map((point) => point.x);
    const baseYs = geometry.points.map((point) => point.y);
    rd = [
      Math.min(...baseXs) - box.minX,
      Math.min(...baseYs) - box.minY,
      box.maxX - Math.max(...baseXs),
      box.maxY - Math.max(...baseYs),
    ].map((value) => Math.max(0, value));
  }

  return {
    ref,
    rect,
    rd,
    strokeAlpha,
    vertices: geometry.points.map(toWorld),
    matrix,
    bbox,
    content: contentText,
  };
};

/**
 * Stamp a cloud annotation dict with its /AP, the matching /Rect (+ /RD, /CA)
 * and, for polygons/polylines, /Vertices from the same resolved geometry.
 * Returns the appearance (or null when the object is not a paintable cloud).
 */
const applyCloudAppearanceToDict = (pdfDoc, annotationDict, fabricObj, pageHeight) => {
  const appearance = buildCloudAppearance(pdfDoc, fabricObj, pageHeight);
  if (!appearance) return null;
  annotationDict.AP = pdfDoc.context.obj({ N: appearance.ref });
  annotationDict.Rect = appearance.rect;
  annotationDict.CA = appearance.strokeAlpha;
  if (appearance.rd) annotationDict.RD = appearance.rd;
  if (annotationDict.Vertices) {
    annotationDict.Vertices = appearance.vertices
      .flatMap((point) => [point.x, pageHeight - point.y])
      .map((value) => PDFNumber.of(value));
  }
  return appearance;
};

/**
 * Create Square annotation (rectangle)
 */
const createSquareAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#000000');
    const fillColor = fabricObj.fill ? hexToRGB(fabricObj.fill) : null;

    const left = fabricObj.left || 0;
    const top = fabricObj.top || 0;
    const width = fabricObj.width || 0;
    const height = fabricObj.height || 0;

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

    if (applyCloudBorderEffectToDict(pdfDoc, annotationDict, fabricObj)) {
      // A cloud rect paints its own scallops (see buildCloudAppearance); the
      // /Rect grows to the appearance box and /RD keeps the base rectangle.
      applyCloudAppearanceToDict(pdfDoc, annotationDict, fabricObj, pageHeight);
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

    const left = fabricObj.left || 0;
    const top = fabricObj.top || 0;
    const radius = fabricObj.radius || 10;

    // Calculate bounds (flip Y for PDF coordinate system)
    const minX = left;
    const minY = pageHeight - (top + radius * 2);
    const maxX = left + radius * 2;
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

    if (applyCloudBorderEffectToDict(pdfDoc, annotationDict, fabricObj)) {
      // Counters never resolve as clouds, so this only ever replaces the
      // viewer-drawn oval of a plain /Circle with the engine's scallops.
      applyCloudAppearanceToDict(pdfDoc, annotationDict, fabricObj, pageHeight);
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

    // UX 2026-09-09: a cloud ellipse's /AP paints the engine's scallops
    // (buildCloudAppearance) instead of this plain oval - same /Matrix tilt
    // convention, /Rect grown to the rotated appearance box.
    const cloudAppearance = buildCloudAppearance(pdfDoc, fabricObj, pageHeight);
    let appearanceRef = cloudAppearance?.ref || null;
    if (!appearanceRef) {
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
      appearanceRef = pdfDoc.context.register(appearance);
    }

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Circle',
      Rect: cloudAppearance ? cloudAppearance.rect : [
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
    if (cloudAppearance?.rd) annotationDict.RD = cloudAppearance.rd;
    applyCloudBorderEffectToDict(pdfDoc, annotationDict, fabricObj);
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

    // UX (owner ruling 2026-09-02): an exported Survey Marker must look the
    // way it does on screen in ANY viewer. /SurveyMarker is an app-private
    // subtype no viewer knows, so bake an appearance stream: a dashed blue
    // outline until an entity is assigned (needsEntity), the marker's colour
    // at its own alpha, multiplied, after.
    const dashedOutline = fabricObj.stroke && fabricObj.stroke !== 'transparent' && Number(fabricObj.strokeWidth) > 0;
    const alphaMatch = typeof fabricObj.fill === 'string'
      ? fabricObj.fill.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/i)
      : null;
    const fillAlpha = Math.max(0, Math.min(1, alphaMatch ? Number(alphaMatch[1]) : 1));
    let appearanceContent;
    let resources = {};
    if (dashedOutline) {
      const stroke = hexToRGB(fabricObj.stroke);
      const strokeWidth = Number(fabricObj.strokeWidth) || 2;
      const dash = Array.isArray(fabricObj.strokeDashArray) && fabricObj.strokeDashArray.length
        ? fabricObj.strokeDashArray.map((n) => pdfNumberText(n)).join(' ')
        : '5 5';
      const inset = strokeWidth / 2;
      appearanceContent = [
        'q',
        `${pdfNumberText(stroke.red)} ${pdfNumberText(stroke.green)} ${pdfNumberText(stroke.blue)} RG`,
        `${pdfNumberText(strokeWidth)} w`,
        `[${dash}] 0 d`,
        `${pdfNumberText(inset)} ${pdfNumberText(inset)} ${pdfNumberText(Math.max(0, width - strokeWidth))} ${pdfNumberText(Math.max(0, height - strokeWidth))} re`,
        'S',
        'Q',
      ].join('\n');
    } else {
      resources = { ExtGState: { GS0: { Type: 'ExtGState', ca: fillAlpha, CA: fillAlpha, BM: 'Multiply' } } };
      appearanceContent = [
        'q',
        '/GS0 gs',
        `${pdfNumberText(color.red)} ${pdfNumberText(color.green)} ${pdfNumberText(color.blue)} rg`,
        `0 0 ${pdfNumberText(width)} ${pdfNumberText(height)} re`,
        'f',
        'Q',
      ].join('\n');
    }
    const appearance = pdfDoc.context.flateStream(`${appearanceContent}\n`, {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [0, 0, width, height],
      Resources: resources,
    });
    const appearanceRef = pdfDoc.context.register(appearance);

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'SurveyMarker',
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quadPoints.map(n => PDFNumber.of(n)),
      C: dashedOutline
        ? (() => { const c = hexToRGB(fabricObj.stroke); return [c.red, c.green, c.blue]; })()
        : [color.red, color.green, color.blue],
      CA: dashedOutline ? 1 : fillAlpha,
      F: 4,
      AP: pdfDoc.context.obj({ N: appearanceRef }),
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

    const left = fabricObj.left || 0;
    const top = fabricObj.top || 0;

    // Convert points to PDF coordinates (flip Y)
    const vertices = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    points.forEach(point => {
      const x = left + point.x;
      const y = pageHeight - (top + point.y);
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
    if (applyCloudBorderEffectToDict(pdfDoc, annotationDict, fabricObj)) {
      annotationDict.IT = PDFName.of('PolygonCloud');
      // Scallops painted by the engine; /Vertices and /Rect come from the
      // same resolved geometry (scale/offset/tilt folded in).
      applyCloudAppearanceToDict(pdfDoc, annotationDict, fabricObj, pageHeight);
    } else if (fabricObj.cloudBorder || fabricObj.borderEffect === 'cloudy') {
      annotationDict.BE = pdfDoc.context.obj({
        S: PDFName.of('C'), // Cloudy
        I: PDFNumber.of(fabricObj.cloudIntensity || 2),
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

    const left = fabricObj.left || 0;
    const top = fabricObj.top || 0;
    const vertices = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    points.forEach(point => {
      const x = left + point.x;
      const y = pageHeight - (top + point.y);
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
    // A cloud polyline exports as /PolyLine + /BE cloudy; it draws rounded end
    // tails rather than arrowheads, so it writes no /LE (matching the screen).
    if (applyCloudBorderEffectToDict(pdfDoc, annotationDict, fabricObj)) {
      applyCloudAppearanceToDict(pdfDoc, annotationDict, fabricObj, pageHeight);
    } else {
      // Endings + interior colour round-trip for polylines too (imported
      // polylines with /LE used to re-export bare).
      applyLineEndingsToDict(annotationDict, fabricObj);
      applyLineEndingInteriorColor(annotationDict, fabricObj, color);
    }

    applyAppAnnotationMetadataToDict(annotationDict, options);

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating polyline annotation:', e);
    return null;
  }
};

// Interior colour on export (PDF 32000 §12.5.6.7): a filled triangle needs
// /IC or other viewers draw ClosedArrow hollow; an imported Circle / Diamond /
// Square that came in filled keeps its own interior colour. Hollow-only lines
// write no /IC (ruled 2026-09-04: never swing the defect the other way).
const applyLineEndingInteriorColor = (annotationDict, fabricObj, strokeColor) => {
  const { startStyle, endStyle, interiorColor } = resolveLineEndingStyles(fabricObj);
  if (startStyle === ARROWHEAD_STYLES.SOLID_TRIANGLE || endStyle === ARROWHEAD_STYLES.SOLID_TRIANGLE) {
    annotationDict.IC = [strokeColor.red, strokeColor.green, strokeColor.blue];
    return;
  }
  if (interiorColor) {
    const ic = hexToRGB(interiorColor);
    if (ic) annotationDict.IC = [ic.red, ic.green, ic.blue];
  }
};

const applyLineEndingsToDict = (annotationDict, fabricObj) => {
  const { startStyle, endStyle } = resolveLineEndingStyles(fabricObj);
  const le1 = ARROWHEAD_STYLE_TO_PDF_LINE_ENDING[startStyle] || 'None';
  const le2 = ARROWHEAD_STYLE_TO_PDF_LINE_ENDING[endStyle] || 'None';
  if (le1 !== 'None' || le2 !== 'None') annotationDict.LE = [PDFName.of(le1), PDFName.of(le2)];
};

/**
 * Create Line annotation with optional callout
 */
const createLineAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#000000');

    const x1 = fabricObj.x1 || 0;
    const y1 = fabricObj.y1 || 0;
    const x2 = fabricObj.x2 || 0;
    const y2 = fabricObj.y2 || 0;

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

    // Line endings: explicit lineEnding1/2 win; otherwise resolve them the way
    // the screen does (data.arrowheadStyle / startArrowheadStyle / tool arrow /
    // imported pdfLineEndings) so an app-drawn arrow round-trips as a standard
    // /LE pair and other viewers show the same heads. (Before 2026-09-02 an
    // app arrow exported with no /LE at all.)
    if (fabricObj.lineEnding1 || fabricObj.lineEnding2) {
      const le1 = fabricObj.lineEnding1 || 'None';
      const le2 = fabricObj.lineEnding2 || 'None';
      annotationDict.LE = [PDFName.of(le1), PDFName.of(le2)];
    } else {
      const { startStyle, endStyle } = resolveLineEndingStyles(fabricObj);
      const le1 = ARROWHEAD_STYLE_TO_PDF_LINE_ENDING[startStyle] || 'None';
      const le2 = ARROWHEAD_STYLE_TO_PDF_LINE_ENDING[endStyle] || 'None';
      if (le1 !== 'None' || le2 !== 'None') annotationDict.LE = [PDFName.of(le1), PDFName.of(le2)];
    }
    applyLineEndingInteriorColor(annotationDict, fabricObj, color);

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
    const width = fabricObj.width || 100;
    const height = fabricObj.height || 20;
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
    const daFont = isBold && isItalic
      ? 'Helvetica-BoldOblique'
      : isBold
        ? 'Helvetica-Bold'
        : isItalic
          ? 'Helvetica-Oblique'
          : 'Helv';
    const da = `${pdfNumberText(color.red)} ${pdfNumberText(color.green)} ${pdfNumberText(color.blue)} rg /${daFont} ${fontSize} Tf`;

    // UX 2026-07-17: /C on a FreeText annotation is the BACKGROUND/border
    // color per the PDF spec — NOT the glyph color (that lives in /DA above).
    // Only write it when the annotation really has a background (callout text
    // boxes pass style.backgroundColor); plain text annotations omit it so
    // the exported box stays transparent, matching the screen.
    const background = fabricObj.backgroundColor && fabricObj.backgroundColor !== 'transparent'
      ? hexToRGB(fabricObj.backgroundColor)
      : null;

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'FreeText',
      Rect: [minX, minY, maxX, maxY],
      Contents: PDFString.of(text),
      DA: PDFString.of(da),
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
// and V_SHAPE → OpenArrow (PDF 32000 §12.5.6.7 defines OpenArrow as "two
// short lines meeting at an acute angle" — exactly the V. It used to export as
// Slash; since 2026-09-03 Slash is drawn as a true slash, so a V exported as
// Slash would come back as the wrong shape — ruled: the file must never ask
// for a different shape than the one drawn). DIAMOND / SLASH export as
// themselves. The app's own re-import never reads /LE for callouts — style
// rides verbatim inside the callout metadata blob — so /LE is purely for
// third-party viewer fidelity.
const ARROWHEAD_STYLE_TO_PDF_LINE_ENDING = {
  [ARROWHEAD_STYLES.NONE]: 'None',
  [ARROWHEAD_STYLES.SOLID_TRIANGLE]: 'ClosedArrow',
  // Spec / Acrobat (ruled 2026-09-04): the hollow triangle is a ClosedArrow
  // with no interior colour; the filled one is a ClosedArrow with /IC.
  [ARROWHEAD_STYLES.OPEN_TRIANGLE]: 'ClosedArrow',
  [ARROWHEAD_STYLES.OPEN_CIRCLE]: 'Circle',
  [ARROWHEAD_STYLES.V_SHAPE]: 'OpenArrow',
  [ARROWHEAD_STYLES.HORIZONTAL_LINE]: 'Butt',
  [ARROWHEAD_STYLES.DIAMOND]: 'Diamond',
  [ARROWHEAD_STYLES.SLASH]: 'Slash',
  [ARROWHEAD_STYLES.SQUARE]: 'Square',
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
    backgroundColor: style.backgroundColor || null,
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

const exportAnnotationRefHasValidGeometry = (pdfDoc, page, ref) => {
  const dict = lookupPdfValue(pdfDoc, ref);
  if (!(dict instanceof PDFDict)) return false;
  const crop = page.getCropBox();
  const bounds = {
    minX: Number(crop.x), minY: Number(crop.y),
    maxX: Number(crop.x) + Number(crop.width),
    maxY: Number(crop.y) + Number(crop.height),
  };
  // A valid appearance can extend a few points past the page when a curve or
  // stroke touches an edge. Keep that small bleed, but reject the wild Rects
  // produced by broken transforms. Coordinate arrays below stay strict.
  const rectBleed = Math.max(Number(crop.width), Number(crop.height)) * 0.05;
  const rectWithinPage = (values) => (
    Array.isArray(values)
    && values.length === 4
    && values.every(Number.isFinite)
    && values[0] >= bounds.minX - rectBleed
    && values[1] >= bounds.minY - rectBleed
    && values[2] <= bounds.maxX + rectBleed
    && values[3] <= bounds.maxY + rectBleed
  );
  const rectTouchesPage = (values) => (
    Array.isArray(values)
    && values.length === 4
    && values.every(Number.isFinite)
    && values[2] >= bounds.minX
    && values[0] <= bounds.maxX
    && values[3] >= bounds.minY
    && values[1] <= bounds.maxY
  );
  const withinPage = (values) => (
    Array.isArray(values)
    && values.length % 2 === 0
    && values.every(Number.isFinite)
    && values.every((value, index) => (
      index % 2 === 0
        ? value >= bounds.minX && value <= bounds.maxX
        : value >= bounds.minY && value <= bounds.maxY
    ))
  );
  const rect = readPdfNativeNumberArray(pdfDoc, dict.get(PDFName.of('Rect')));
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) return false;
  if (rect[2] < rect[0] || rect[3] < rect[1]) return false;
  // 2026-09-09: /Rect is the APPEARANCE box. For a cloud that box is inflated
  // by the scallops (up to a full crown plus the round caps), so a max-Bump
  // cloud flush to the edge of an A5 / half-letter page used to fail the 5%
  // bleed and vanish from the export while the print path drew it. Judge the
  // BASE geometry instead: /Rect inset by /RD (Square / Circle / FreeText)
  // must sit on the page within the bleed; a dict that carries its own
  // coordinate arrays (Polygon / PolyLine / Line / Ink / markup) is judged by
  // those strict arrays below and its appearance box only has to touch the
  // page. Off-page garbage still fails: its base rect or its points are off.
  const rd = readPdfNativeNumberArray(pdfDoc, dict.get(PDFName.of('RD')));
  const baseRect = Array.isArray(rd) && rd.length === 4 && rd.every(Number.isFinite)
    ? [rect[0] + rd[0], rect[1] + rd[3], rect[2] - rd[2], rect[3] - rd[1]]
    : rect;
  const hasCoordinateArrays = ['QuadPoints', 'Vertices', 'CL', 'L', 'InkList']
    .some((key) => dict.get(PDFName.of(key)) !== undefined);
  if (hasCoordinateArrays ? !rectTouchesPage(rect) : !rectWithinPage(baseRect)) return false;

  const subtype = decodePdfDictText(pdfDoc, dict, 'Subtype');
  const line = readPdfNativeNumberArray(pdfDoc, dict.get(PDFName.of('L')));
  if (subtype === 'Line') {
    if (!withinPage(line) || line.length !== 4) return false;
    if (Math.hypot(line[2] - line[0], line[3] - line[1]) <= 0.01) return false;
  }
  for (const key of ['QuadPoints', 'Vertices', 'CL']) {
    const raw = dict.get(PDFName.of(key));
    if (raw !== undefined) {
      const values = readPdfNativeNumberArray(pdfDoc, raw);
      if (!withinPage(values)) return false;
    }
  }
  const inkListRaw = dict.get(PDFName.of('InkList'));
  if (inkListRaw !== undefined) {
    const strokes = readPdfNativeNestedNumberArrays(pdfDoc, inkListRaw);
    if (!Array.isArray(strokes) || strokes.some((stroke) => !withinPage(stroke))) return false;
  }
  return true;
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
    let indices = findMatchingNativePdfAnnotationIndices(
      pdfDoc,
      annots,
      request.pdfAnnotationId,
      {
        pageIndex,
        pdfAnnotationType: request.pdfAnnotationType,
        pdfNativeAnnotationIdentity: request.pdfNativeAnnotationIdentity,
      },
    );
    if (indices.length === 0 && request.allowUniqueSubtypeFallback === true) {
      const subtype = normalizePdfAnnotationSubtype(request.pdfAnnotationType);
      const matches = [];
      const refs = typeof annots?.asArray === 'function' ? annots.asArray() : [];
      refs.forEach((ref, index) => {
        const dict = lookupPdfValue(pdfDoc, ref);
        const candidateSubtype = normalizePdfAnnotationSubtype(
          String(dict?.get?.(PDFName.of('Subtype')) || ''),
        );
        if (candidateSubtype === subtype) matches.push(index);
      });
      // Print may receive a pdf.js runtime id after state hydration. A lone
      // native annotation of the same subtype is still safe to replace; more
      // than one candidate fails closed.
      if (matches.length === 1) indices = matches;
    }
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

const PDF_ANNOTATION_FLAG_INVISIBLE = 1;
const PDF_ANNOTATION_FLAG_HIDDEN = 2;
const PDF_ANNOTATION_FLAG_PRINT = 4;
const PDF_ANNOTATION_FLAG_NO_VIEW = 32;

const nativeAnnotationPrintsWithScreen = (pdfDoc, dict) => {
  const rawFlags = dict?.get?.(PDFName.of('F'));
  const flags = rawFlags === undefined ? 0 : readPdfNativeNumber(pdfDoc, rawFlags);
  if (!Number.isInteger(flags)) return false;
  return Boolean(flags & PDF_ANNOTATION_FLAG_PRINT)
    && !(flags & PDF_ANNOTATION_FLAG_INVISIBLE)
    && !(flags & PDF_ANNOTATION_FLAG_HIDDEN)
    && !(flags & PDF_ANNOTATION_FLAG_NO_VIEW);
};

const nativeAnnotationMatchesForObject = (pdfDoc, pageIndex, obj) => {
  const page = pdfDoc.getPage(pageIndex);
  const annots = page.node.lookup(PDFName.of('Annots'));
  const pdfAnnotationId = obj?.pdfAnnotationId || obj?.data?.fieldId || obj?.fieldId;
  if (!(annots instanceof PDFArray) || !pdfAnnotationId) return [];
  return findMatchingNativePdfAnnotationIndices(pdfDoc, annots, pdfAnnotationId, {
    pageIndex,
    pdfAnnotationType: obj?.pdfAnnotationType || obj?.data?.pdfAnnotationType || null,
    pdfNativeAnnotationIdentity:
      obj?.data?.pdfNativeAnnotationIdentity
      || obj?.pdfNativeAnnotationIdentity
      || null,
  });
};

const importedObjectAllowsPrint = (pdfDoc, pageIndex, obj) => {
  if (!isPdfImportedObject(obj)) return true;
  const page = pdfDoc.getPage(pageIndex);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return true;
  const indices = nativeAnnotationMatchesForObject(pdfDoc, pageIndex, obj);
  if (indices.length === 0) return true;
  return indices.every((index) => {
    const dict = pdfDoc.context.lookupMaybe(annots.get(index), PDFDict);
    return dict instanceof PDFDict && nativeAnnotationPrintsWithScreen(pdfDoc, dict);
  });
};

// Browser print starts with the source PDF. Keep only native dictionaries that
// still back a screen object and are allowed by /F. Every other native annot is
// absent from the app view, so leaving it for pdf.js would leak hidden content.
const stripNativeAnnotationsNotOnScreen = (pdfDoc, annotationsByPage) => {
  const diagnostics = { kept: 0, removed: 0, removedByFlags: 0 };
  pdfDoc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;
    const pageNumber = pageIndex + 1;
    const objects = annotationsByPage?.[pageNumber]?.objects
      || annotationsByPage?.[String(pageNumber)]?.objects
      || [];
    const keepIndices = new Set();
    for (const obj of objects) {
      if (!isPdfImportedObject(obj) && !isFormFieldObject(obj)) continue;
      for (const index of nativeAnnotationMatchesForObject(pdfDoc, pageIndex, obj)) {
        const dict = pdfDoc.context.lookupMaybe(annots.get(index), PDFDict);
        if (dict instanceof PDFDict && nativeAnnotationPrintsWithScreen(pdfDoc, dict)) {
          keepIndices.add(index);
        }
      }
    }
    for (let index = annots.size() - 1; index >= 0; index -= 1) {
      if (keepIndices.has(index)) {
        diagnostics.kept += 1;
        continue;
      }
      const dict = pdfDoc.context.lookupMaybe(annots.get(index), PDFDict);
      // Pending /Redact marks have no fabric object but ARE on screen (the
      // redaction mark layer draws their red outline); the export sanitiser
      // below turns them into the same hollow outline for paper. Keep them.
      if (
        dict instanceof PDFDict
        && dict.get(PDFName.of('Subtype')) === PDFName.of('Redact')
        && nativeAnnotationPrintsWithScreen(pdfDoc, dict)
      ) {
        keepIndices.add(index);
        diagnostics.kept += 1;
        continue;
      }
      if (dict instanceof PDFDict && !nativeAnnotationPrintsWithScreen(pdfDoc, dict)) {
        diagnostics.removedByFlags += 1;
      }
      annots.remove(index);
      diagnostics.removed += 1;
    }
  });
  return diagnostics;
};

const reorderManagedAnnotationsToAppDrawOrder = (
  pdfDoc,
  annotationsByPage,
  attachedEntries,
) => {
  const refsByObject = new Map();
  const refsById = new Map();
  for (const { item, refs } of attachedEntries) {
    refsByObject.set(item.object, refs);
    const id = item.id || getObjectId(item.object);
    if (id) refsById.set(String(id), refs);
  }

  pdfDoc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;
    const objects = annotationsByPage?.[pageIndex + 1]?.objects
      || annotationsByPage?.[String(pageIndex + 1)]?.objects
      || [];
    const desired = [];
    for (const obj of objects) {
      let refs = refsByObject.get(obj) || refsById.get(String(getObjectId(obj) || '')) || [];
      if (isPdfImportedObject(obj) || isFormFieldObject(obj)) {
        refs = nativeAnnotationMatchesForObject(pdfDoc, pageIndex, obj)
          .map((index) => annots.get(index));
      }
      for (const ref of refs) if (!desired.includes(ref)) desired.push(ref);
    }
    if (desired.length < 2) return;
    const rank = new Map(desired.map((ref, index) => [ref, index]));
    const slots = annots.asArray()
      .map((ref, index) => ({ ref, index }))
      .filter(({ ref }) => rank.has(ref));
    if (slots.length < 2) return;
    const sorted = slots.map(({ ref }) => ref).sort((left, right) => rank.get(left) - rank.get(right));
    slots.forEach(({ index }, slotIndex) => annots.set(index, sorted[slotIndex]));
  });
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

const resolvedPdfPaint = (value, fallback) => {
  const paint = parsePdfDrawColor(value, fallback);
  if (paint) return paint;
  return value === null || value === undefined || value === ''
    ? parsePdfDrawColor(fallback)
    : null;
};

const rotateAppPoint = (point, center, angleDeg) => {
  if (!angleDeg) return point;
  const angle = Number(angleDeg) * Math.PI / 180;
  const cos = Math.cos(angle); const sin = Math.sin(angle);
  const dx = point.x - center.x; const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
};

const withPrintPageTransform = (page, viewportHeight, draw) => {
  const geometry = getTextMarkupPageGeometry(page, viewportHeight);
  const origin = viewportPointToPdfPoint({ x: 0, y: 0 }, geometry);
  const xBasis = viewportPointToPdfPoint({ x: 1, y: 0 }, geometry);
  const yBasis = viewportPointToPdfPoint({ x: 0, y: 1 }, geometry);
  const dx = { x: xBasis.x - origin.x, y: xBasis.y - origin.y };
  const dy = { x: yBasis.x - origin.x, y: yBasis.y - origin.y };
  // Existing draw helpers author a virtual, viewport-sized PDF page where
  // app y-down is flipped around viewportHeight. Map that virtual y-up space
  // into the real rotated CropBox once for every annotation on the page.
  const e = origin.x + viewportHeight * dy.x;
  const f = origin.y + viewportHeight * dy.y;
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(dx.x, dx.y, -dy.x, -dy.y, e, f),
  );
  try { return draw(); } finally { page.pushOperators(popGraphicsState()); }
};

// ---------------------------------------------------------------------------
// /Annots page frame (2026-09-09).
//
// Every annotation writer above authors a VIRTUAL page: a viewport-sized,
// un-rotated, origin-at-zero page where app y-down is flipped around the
// app's page height (`pageHeight - y`). The app's page size is pdf.js'
// default viewport (CropBox-sized, /Rotate applied) and the importer maps
// /Rect and every coordinate array back through that same rotated viewport,
// so on a /Rotate 90/180/270 page or a page whose CropBox/MediaBox does not
// start at (0, 0) the virtual frame is NOT PDF user space: the exported
// annotation landed rotated and/or shifted by the box origin while the
// print/flatten path (withPrintPageTransform) was right. The single fix is
// the affine below - the same viewport -> user-space mapping the flattener
// and the text-markup adapters already use - applied ONCE to every dict the
// /Annots exporter registers: /Rect, /RD, /Vertices, /QuadPoints, /L, /CL,
// /InkList and the /AP form /Matrix (so the viewer's BBox -> /Rect fit stays
// a pure translation and the appearance turns with the page).
const PAGE_FRAME_IDENTITY_EPSILON = 1e-9;

const applyPdfMatrixToPoint = (matrix, x, y) => ({
  x: matrix[0] * x + matrix[2] * y + matrix[4],
  y: matrix[1] * x + matrix[3] * y + matrix[5],
});

// `first` then `second` (PDF row-vector convention: first x second).
const composePdfMatrices = (first, second) => [
  first[0] * second[0] + first[1] * second[2],
  first[0] * second[1] + first[1] * second[3],
  first[2] * second[0] + first[3] * second[2],
  first[2] * second[1] + first[3] * second[3],
  first[4] * second[0] + first[5] * second[2] + second[4],
  first[4] * second[1] + first[5] * second[3] + second[5],
];

/**
 * Affine [a b c d e f] taking the virtual (viewport-sized, y-up, origin 0)
 * page the annotation writers author into the page's real user space. Null
 * when the two frames coincide (unrotated page with a zero-origin box whose
 * height matches the app's), so the common case costs nothing.
 */
const getAnnotationPageFrameMatrix = (page, viewportHeight) => {
  const geometry = getTextMarkupPageGeometry(page, viewportHeight);
  const origin = viewportPointToPdfPoint({ x: 0, y: 0 }, geometry);
  const xBasis = viewportPointToPdfPoint({ x: 1, y: 0 }, geometry);
  const yBasis = viewportPointToPdfPoint({ x: 0, y: 1 }, geometry);
  const dx = { x: xBasis.x - origin.x, y: xBasis.y - origin.y };
  const dy = { x: yBasis.x - origin.x, y: yBasis.y - origin.y };
  const height = Number(viewportHeight) || 0;
  // Virtual (X, Y) = (u, H - v)  =>  P = origin + X * dx + (H - Y) * dy.
  const matrix = [
    dx.x, dx.y,
    -dy.x, -dy.y,
    origin.x + height * dy.x,
    origin.y + height * dy.y,
  ];
  const identity = [1, 0, 0, 1, 0, 0];
  const isIdentity = matrix.every((value, index) => Math.abs(value - identity[index]) <= PAGE_FRAME_IDENTITY_EPSILON);
  return isIdentity ? null : matrix;
};

const mapPdfRectThroughMatrix = (rect, matrix) => {
  const corners = [
    applyPdfMatrixToPoint(matrix, rect[0], rect[1]),
    applyPdfMatrixToPoint(matrix, rect[2], rect[1]),
    applyPdfMatrixToPoint(matrix, rect[2], rect[3]),
    applyPdfMatrixToPoint(matrix, rect[0], rect[3]),
  ];
  return [
    Math.min(...corners.map((point) => point.x)),
    Math.min(...corners.map((point) => point.y)),
    Math.max(...corners.map((point) => point.x)),
    Math.max(...corners.map((point) => point.y)),
  ];
};

const pdfNumberArray = (pdfDoc, values) => pdfDoc.context.obj(values.map((value) => PDFNumber.of(value)));

// Exact readers: the native-dedupe readers above round to a few decimals,
// which must not nudge a coordinate that is only changing frames.
const readPdfExactNumberArray = (pdfDoc, value) => {
  const resolved = lookupPdfValue(pdfDoc, value);
  if (!resolved || typeof resolved.asArray !== 'function') return null;
  const numbers = resolved.asArray().map((entry) => {
    const item = lookupPdfValue(pdfDoc, entry);
    return typeof item?.asNumber === 'function' ? item.asNumber() : Number(item);
  });
  return numbers.every(Number.isFinite) ? numbers : null;
};

const readPdfExactNestedNumberArrays = (pdfDoc, value) => {
  const resolved = lookupPdfValue(pdfDoc, value);
  if (!resolved || typeof resolved.asArray !== 'function') return null;
  const arrays = resolved.asArray().map((entry) => readPdfExactNumberArray(pdfDoc, entry));
  return arrays.every(Array.isArray) ? arrays : null;
};

const remapPdfPointArray = (pdfDoc, dict, key, matrix) => {
  const values = readPdfExactNumberArray(pdfDoc, dict.get(PDFName.of(key)));
  if (!Array.isArray(values) || values.length % 2 !== 0) return;
  const mapped = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    const point = applyPdfMatrixToPoint(matrix, values[index], values[index + 1]);
    mapped.push(point.x, point.y);
  }
  dict.set(PDFName.of(key), pdfNumberArray(pdfDoc, mapped));
};

const remapAppearanceStreamMatrix = (pdfDoc, streamRef, matrix, remappedStreams) => {
  const stream = lookupPdfValue(pdfDoc, streamRef);
  const dict = stream?.dict instanceof PDFDict ? stream.dict : null;
  if (!dict) return;
  if (remappedStreams.has(stream)) return; // shared between /N, /D, /R
  remappedStreams.add(stream);
  const existing = readPdfExactNumberArray(pdfDoc, dict.get(PDFName.of('Matrix')));
  const current = Array.isArray(existing) && existing.length === 6 ? existing : [1, 0, 0, 1, 0, 0];
  dict.set(PDFName.of('Matrix'), pdfNumberArray(pdfDoc, composePdfMatrices(current, matrix)));
};

const remapAppearanceDictMatrices = (pdfDoc, dict, matrix, remappedStreams) => {
  const ap = lookupPdfValue(pdfDoc, dict.get(PDFName.of('AP')));
  if (!(ap instanceof PDFDict)) return;
  for (const key of ['N', 'D', 'R']) {
    const entry = ap.get(PDFName.of(key));
    if (entry === undefined) continue;
    const resolved = lookupPdfValue(pdfDoc, entry);
    if (resolved instanceof PDFDict) {
      // Appearance sub-dictionary (one stream per appearance state).
      resolved.entries().forEach(([, stateRef]) => remapAppearanceStreamMatrix(pdfDoc, stateRef, matrix, remappedStreams));
    } else {
      remapAppearanceStreamMatrix(pdfDoc, entry, matrix, remappedStreams);
    }
  }
};

/**
 * Move one freshly written annotation dict (and its appearance forms) from
 * the writers' virtual frame into the page's real user space. Idempotence is
 * the caller's job: call it exactly once per created ref.
 */
const remapAnnotationRefToPageFrame = (pdfDoc, ref, matrix, remappedStreams = new Set()) => {
  if (!matrix) return;
  const dict = lookupPdfValue(pdfDoc, ref);
  if (!(dict instanceof PDFDict)) return;
  const rect = readPdfExactNumberArray(pdfDoc, dict.get(PDFName.of('Rect')));
  if (Array.isArray(rect) && rect.length === 4) {
    const mappedRect = mapPdfRectThroughMatrix(rect, matrix);
    // /RD [left, top, right, bottom] is the inset from /Rect to the base
    // shape in user space, so it turns with the page: rebuild it from the
    // remapped base rectangle instead of permuting by hand.
    const rd = readPdfExactNumberArray(pdfDoc, dict.get(PDFName.of('RD')));
    if (Array.isArray(rd) && rd.length === 4) {
      const inner = mapPdfRectThroughMatrix(
        [rect[0] + rd[0], rect[1] + rd[3], rect[2] - rd[2], rect[3] - rd[1]],
        matrix,
      );
      dict.set(PDFName.of('RD'), pdfNumberArray(pdfDoc, [
        inner[0] - mappedRect[0],
        mappedRect[3] - inner[3],
        mappedRect[2] - inner[2],
        inner[1] - mappedRect[1],
      ].map((value) => Math.max(0, value))));
    }
    dict.set(PDFName.of('Rect'), pdfNumberArray(pdfDoc, mappedRect));
  }
  for (const key of ['Vertices', 'QuadPoints', 'L', 'CL']) {
    if (dict.get(PDFName.of(key)) !== undefined) remapPdfPointArray(pdfDoc, dict, key, matrix);
  }
  const inkList = lookupPdfValue(pdfDoc, dict.get(PDFName.of('InkList')));
  if (inkList instanceof PDFArray) {
    const strokes = readPdfExactNestedNumberArrays(pdfDoc, inkList);
    if (Array.isArray(strokes)) {
      dict.set(PDFName.of('InkList'), pdfDoc.context.obj(strokes.map((stroke) => {
        const mapped = [];
        for (let index = 0; index + 1 < stroke.length; index += 2) {
          const point = applyPdfMatrixToPoint(matrix, stroke[index], stroke[index + 1]);
          mapped.push(point.x, point.y);
        }
        return pdfNumberArray(pdfDoc, mapped);
      })));
    }
  }
  remapAppearanceDictMatrices(pdfDoc, dict, matrix, remappedStreams);
};

const fabricPolygonWorldPoints = (obj) => {
  const points = Array.isArray(obj?.points) ? obj.points : [];
  if (!points.length) return [];
  const scaleX = Number(obj?.scaleX ?? 1) || 1;
  const scaleY = Number(obj?.scaleY ?? 1) || 1;
  const offsetX = Number(obj?.pathOffset?.x) || 0;
  const offsetY = Number(obj?.pathOffset?.y) || 0;
  const xs = points.map((point) => Number(point?.x) || 0);
  const ys = points.map((point) => Number(point?.y) || 0);
  const center = {
    x: scaleX * ((Math.min(...xs) + Math.max(...xs)) / 2 - offsetX),
    y: scaleY * ((Math.min(...ys) + Math.max(...ys)) / 2 - offsetY),
  };
  return points.map((point) => {
    const local = { x: ((Number(point?.x) || 0) - offsetX) * scaleX, y: ((Number(point?.y) || 0) - offsetY) * scaleY };
    const rotated = rotateAppPoint(local, center, Number(obj?.angle) || 0);
    return { x: (Number(obj?.left) || 0) + rotated.x, y: (Number(obj?.top) || 0) + rotated.y };
  });
};

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
    } else if (command === 'Z' || command === 'z') {
      // Closed subpaths matter for filled outline ink (multi-ring erased
      // geometry): dropping Z left rings open and the fill/stroke wrong.
      parts.push('Z');
    }
  });
  return parts.join(' ');
};

// Filled outline ink (native paper pen strokes and eraser-carved ink) paints
// on screen as a fill region with NO stroke — see renderPathToSvgAttrs. The
// print flattener must paint the same way. pdf-lib's drawSvgPath cannot
// express an even-odd fill (needed for erased ink's holes), so emit the raw
// operators mirroring drawSvgPath's origin/scale handling exactly.
const fabricPathToOperators = (pathData) => {
  const ops = [];
  const num = (value) => Number(value) || 0;
  (Array.isArray(pathData) ? pathData : []).forEach((cmd) => {
    const command = cmd?.[0];
    if (command === 'M') ops.push(moveTo(num(cmd[1]), num(cmd[2])));
    else if (command === 'L') ops.push(lineTo(num(cmd[1]), num(cmd[2])));
    else if (command === 'Q') ops.push(appendQuadraticCurve(num(cmd[1]), num(cmd[2]), num(cmd[3]), num(cmd[4])));
    else if (command === 'C') ops.push(appendBezierCurve(num(cmd[1]), num(cmd[2]), num(cmd[3]), num(cmd[4]), num(cmd[5]), num(cmd[6])));
    else if (command === 'Z' || command === 'z') ops.push(closePathOperator());
  });
  return ops;
};

const drawFilledOutlineInk = (page, pathData, pageHeight, attrs) => {
  const paint = parsePdfDrawColor(attrs.fill, '#000000');
  if (!paint) return 0;
  const pathOperators = fabricPathToOperators(pathData);
  if (!pathOperators.length) return 0;
  // The screen paints imported translucent ink (a wide multiply highlighter)
  // with the object's opacity and multiply blend; print must too, or a pale
  // wash on screen prints as a solid saturated bar (found on the desktop
  // print check, 2026-09-02; the web route did the same).
  // Imported ink carries its transparency in the fill's rgba alpha (paint.opacity),
  // app ink in the object's opacity; both must reach the paper.
  const opacity = Math.max(0, Math.min(1, Number(attrs.opacity ?? attrs.fillOpacity ?? 1) * (paint.opacity ?? 1)));
  const blendMode = attrs.blendMode === 'Multiply' ? BlendMode.Multiply : undefined;
  const graphicsStateKey = typeof page.maybeEmbedGraphicsState === 'function'
    ? page.maybeEmbedGraphicsState({ opacity, ...(blendMode ? { blendMode } : {}) })
    : undefined;
  const fillRuleOperator = attrs.fillRule === 'evenodd'
    ? PDFOperator.of(PDFOperatorNames.FillEvenOdd)
    : fillOperator();
  const { red, green, blue } = paint.color;
  page.pushOperators(
    pushGraphicsState(),
    ...(graphicsStateKey ? [setGraphicsState(graphicsStateKey)] : []),
    translateOperator(0, pageHeight),
    scaleOperator(1, -1),
    setFillingRgbColor(red, green, blue),
    ...pathOperators,
    fillRuleOperator,
    popGraphicsState(),
  );
  return 1;
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
    const circleFill = spec.circle.fill && spec.circle.fill !== 'none' ? parsePdfDrawColor(spec.circle.fill, null) : null;
    page.drawCircle({
      x: spec.circle.cx,
      y: getPdfY(pageHeight, spec.circle.cy),
      size: spec.circle.r,
      borderColor: stroke.color,
      borderOpacity: stroke.opacity,
      borderWidth: spec.circle.strokeWidth,
      ...(circleFill ? { color: circleFill.color, opacity: circleFill.opacity } : {}),
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
  } else if (spec.kind === 'diamond' || spec.kind === 'square') {
    const angleRad = ((spec.angleDeg || 0) * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const pts = String(spec.polygon.points).split(' ').map((pair) => pair.split(',').map(Number))
      .map(([lx, ly]) => [spec.tipX + (lx * cos) - (ly * sin), spec.tipY + (lx * sin) + (ly * cos)]);
    const d = `M ${pts.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
    const polyFill = spec.polygon.fill && spec.polygon.fill !== 'none' ? parsePdfDrawColor(spec.polygon.fill, null) : null;
    page.drawSvgPath(d, {
      x: 0,
      y: pageHeight,
      borderColor: stroke.color,
      borderOpacity: stroke.opacity,
      borderWidth: spec.polygon.strokeWidth,
      ...(polyFill ? { color: polyFill.color, opacity: polyFill.opacity } : {}),
    });
  } else if (spec.kind === 'horizontalLine' || spec.kind === 'slash') {
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
  const x1 = getObjNumber(obj, 'x1');
  const y1 = getObjNumber(obj, 'y1');
  const x2 = getObjNumber(obj, 'x2');
  const y2 = getObjNumber(obj, 'y2');
  // UX (2026-07-17, line style): honor a stored strokeDashArray so dashed /
  // dotted lines (and callout leader pieces, which pass the shared callout
  // dash) print with their on-screen pattern instead of flattening solid.
  const dash = Array.isArray(obj?.strokeDashArray) && obj.strokeDashArray.length > 0
    ? obj.strokeDashArray.map((v) => Number(v) || 0)
    : null;
  // Triangle heads: pull the line body back by headSize/3 so its tail does
  // not poke through the head (same rule as buildLineRenderSpec on screen).
  // Shaft insets, round caps and bent bodies follow the screen exactly
  // (buildLineRenderSpec → lineEndingBodyInset / buildCurvedLineBody).
  const endingStyles = resolveLineEndingStyles(obj);
  const startInset = lineEndingBodyInset(endingStyles.startStyle, width);
  const endInset = lineEndingBodyInset(endingStyles.endStyle, width);
  const midpoint = obj?.data?.midpoint;
  const midpointOffset = midpoint && Number.isFinite(Number(midpoint.x)) && Number.isFinite(Number(midpoint.y))
    ? (() => {
        // distance from the chord — the screen treats ≤ 1px as straight
        const dxm = x2 - x1; const dym = y2 - y1; const len2 = dxm * dxm + dym * dym;
        if (len2 === 0) return 0;
        const t = Math.max(0, Math.min(1, ((midpoint.x - x1) * dxm + (midpoint.y - y1) * dym) / len2));
        return Math.hypot(midpoint.x - (x1 + t * dxm), midpoint.y - (y1 + t * dym));
      })()
    : 0;
  const isCurved = midpointOffset > 1;
  let startAngleDeg;
  let endAngleDeg;
  if (isCurved) {
    const body = buildCurvedLineBody({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: Number(midpoint.x), y: Number(midpoint.y) }, startInset, endInset);
    startAngleDeg = body.startAngleDeg;
    endAngleDeg = body.endAngleDeg;
    page.drawSvgPath(body.d, {
      x: 0,
      y: pageHeight,
      borderColor: stroke.color,
      borderOpacity: stroke.opacity,
      borderWidth: width,
      borderLineCap: LineCapStyle.Round,
      ...(dash ? { borderDashArray: dash, borderDashPhase: 0 } : {}),
    });
  } else {
    const bodyAngle = Math.atan2(y2 - y1, x2 - x1);
    startAngleDeg = ((bodyAngle + Math.PI) * 180) / Math.PI;
    endAngleDeg = (bodyAngle * 180) / Math.PI;
    const bodyStart = { x: x1 + startInset * Math.cos(bodyAngle), y: y1 + startInset * Math.sin(bodyAngle) };
    const bodyEnd = { x: x2 - endInset * Math.cos(bodyAngle), y: y2 - endInset * Math.sin(bodyAngle) };
    page.drawLine({
      start: { x: bodyStart.x, y: getPdfY(pageHeight, bodyStart.y) },
      end: { x: bodyEnd.x, y: getPdfY(pageHeight, bodyEnd.y) },
      color: stroke.color,
      thickness: width,
      opacity: stroke.opacity,
      lineCap: LineCapStyle.Round,
      ...(dash ? { dashArray: dash, dashPhase: 0 } : {}),
    });
  }
  // Line endings print exactly as the screen resolves them (owner request
  // 2026-09-02: imported arrows printed as plain lines). Both ends, every
  // /LE style the screen knows: Open/ClosedArrow → triangles, Circle → open
  // circle, Butt/Square → bar, Diamond → diamond, Slash → slash (same
  // shared resolver as the screen, so print matches the screen).
  // Each head sits on the tangent at its own end (bent lines differ per end).
  const strokeHex = typeof obj?.stroke === 'string' ? obj.stroke : '#000000';
  const headOptions = { fill: endingStyles.interiorColor };
  drawFlattenedArrowheadSpec(page, buildArrowheadRenderSpec(endingStyles.endStyle, x2, y2, endAngleDeg, strokeHex, width, headOptions), pageHeight);
  drawFlattenedArrowheadSpec(page, buildArrowheadRenderSpec(endingStyles.startStyle, x1, y1, startAngleDeg, strokeHex, width, headOptions), pageHeight);
};

// Polyline endings: same styles, placed on the first and last segments in
// world space (imported polylines are unscaled), as the screen's renderPolyline.
const drawFlattenedPolylineEndings = (page, obj, pageHeight) => {
  const points = fabricPolygonWorldPoints(obj);
  if (points.length < 2) return;
  const { startStyle, endStyle, interiorColor } = resolveLineEndingStyles(obj);
  if (startStyle === ARROWHEAD_STYLES.NONE && endStyle === ARROWHEAD_STYLES.NONE) return;
  const headOptions = { fill: interiorColor };
  const width = Math.max(0.5, Number(obj?.strokeWidth) || 1);
  const strokeHex = typeof obj?.stroke === 'string' ? obj.stroke : '#000000';
  const first = points[0]; const second = points[1];
  const last = points[points.length - 1]; const beforeLast = points[points.length - 2];
  const startAngle = (Math.atan2(first.y - second.y, first.x - second.x) * 180) / Math.PI;
  const endAngle = (Math.atan2(last.y - beforeLast.y, last.x - beforeLast.x) * 180) / Math.PI;
  drawFlattenedArrowheadSpec(page, buildArrowheadRenderSpec(startStyle, first.x, first.y, startAngle, strokeHex, width, headOptions), pageHeight);
  drawFlattenedArrowheadSpec(page, buildArrowheadRenderSpec(endStyle, last.x, last.y, endAngle, strokeHex, width, headOptions), pageHeight);
};

// UX 2026-07-17 (print text style): pick the embedded Helvetica variant that
// matches what the user sees on screen. Understands both fabric-native fields
// (fontWeight/fontStyle on freetext objects) and the callout booleans
// (bold/italic) so both shapes print with their chosen weight/slant.
const pickFlattenedTextFont = (obj, fonts) => {
  if (!fonts || typeof fonts !== 'object' || !fonts.regular) return fonts;
  const family = String(obj?.fontFamily || '').toLowerCase();
  const familyFonts = /times|serif/.test(family)
    ? {
        regular: fonts.timesRegular,
        bold: fonts.timesBold,
        oblique: fonts.timesItalic,
        boldOblique: fonts.timesBoldItalic,
      }
    : /courier|mono/.test(family)
      ? {
          regular: fonts.courierRegular,
          bold: fonts.courierBold,
          oblique: fonts.courierOblique,
          boldOblique: fonts.courierBoldOblique,
        }
      : fonts;
  const isBold = obj?.fontWeight === 'bold' || Number(obj?.fontWeight) >= 600 || obj?.bold === true;
  const isItalic = obj?.fontStyle === 'italic' || obj?.fontStyle === 'oblique' || obj?.italic === true;
  if (isBold && isItalic) return familyFonts.boldOblique || familyFonts.bold || familyFonts.regular || fonts.regular;
  if (isBold) return familyFonts.bold || familyFonts.regular || fonts.regular;
  if (isItalic) return familyFonts.oblique || familyFonts.regular || fonts.regular;
  return familyFonts.regular || fonts.regular;
};

const drawFlattenedText = (page, obj, pageHeight, fonts) => {
  const fill = parsePdfDrawColor(obj?.fill || '#000000', '#000000') || parsePdfDrawColor('#000000');
  const left = getObjNumber(obj, 'left');
  const top = getObjNumber(obj, 'top');
  const width = Math.max(1, getObjNumber(obj, 'width', 200));
  const height = Math.max(1, getObjNumber(obj, 'height', Number(obj?.fontSize) || 14));
  const fontSize = Math.max(4, Number(obj?.fontSize) || 12);
  const font = pickFlattenedTextFont(obj, fonts);
  const angle = Number(obj?.angle) || 0;
  const pdfAngle = -angle;
  const objectOpacity = Number.isFinite(Number(obj?.opacity))
    ? Math.max(0, Math.min(1, Number(obj.opacity)))
    : 1;
  const background = resolvedPdfPaint(obj?.backgroundColor, 'transparent');
  const border = resolvedPdfPaint(obj?.stroke, 'transparent');
  const borderWidth = border ? Math.max(0, Number(obj?.strokeWidth) || 0) : 0;
  const center = { x: left + width / 2, y: top + height / 2 };
  if (background || borderWidth > 0) {
    const common = {
      color: background?.color,
      opacity: background ? (background.opacity ?? 1) * objectOpacity : undefined,
      borderColor: borderWidth > 0 ? border?.color : undefined,
      borderWidth,
      borderOpacity: borderWidth > 0 ? (border?.opacity ?? 1) * objectOpacity : undefined,
    };
    if (angle) {
      const points = [
        { x: left, y: top }, { x: left + width, y: top },
        { x: left + width, y: top + height }, { x: left, y: top + height },
      ].map((point) => rotateAppPoint(point, center, angle));
      page.drawSvgPath(`${points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')} Z`, {
        x: 0, y: pageHeight, ...common,
      });
    } else {
      page.drawRectangle({
        x: left, y: getPdfY(pageHeight, top + height), width, height, ...common,
      });
    }
  }

  const padding = 6;
  const innerWidth = Math.max(1, width - padding * 2);
  const lineHeight = fontSize * (Number(obj?.lineHeight) || 1.16) * 1.13;
  const fits = (value) => {
    try { return font.widthOfTextAtSize(value, fontSize) <= innerWidth; } catch { return true; }
  };
  const lines = [];
  String(obj?.text || '').split(/\r?\n/).forEach((paragraph) => {
    if (!paragraph) { lines.push(''); return; }
    let line = '';
    for (const character of paragraph) {
      if (line && !fits(line + character)) {
        lines.push(line);
        line = character;
      } else {
        line += character;
      }
    }
    lines.push(line);
  });
  const maxLines = Math.max(1, Math.floor((height - padding * 2 + fontSize * 0.35) / lineHeight));
  const visibleLines = lines.slice(0, maxLines);
  const blockHeight = visibleLines.length * lineHeight;
  const freeSpace = Math.max(0, height - padding * 2 + fontSize * 0.35 - blockHeight);
  const verticalOffset = obj?.verticalAlign === 'middle'
    ? freeSpace / 2
    : obj?.verticalAlign === 'bottom' ? freeSpace : 0;
  const rotatePoint = (point) => angle ? rotateAppPoint(point, center, angle) : point;
  const wantsUnderline = obj?.underline === true;
  const wantsLinethrough = obj?.linethrough === true || obj?.strikethrough === true;

  visibleLines.forEach((line, index) => {
    let lineWidth = innerWidth;
    try { lineWidth = font.widthOfTextAtSize(line, fontSize); } catch { /* use inner width */ }
    const textX = obj?.textAlign === 'center'
      ? left + padding + (innerWidth - lineWidth) / 2
      : obj?.textAlign === 'right' ? left + padding + innerWidth - lineWidth : left + padding;
    const appBaseline = top + padding + verticalOffset + fontSize + index * lineHeight;
    const origin = rotatePoint({ x: textX, y: appBaseline });
    page.drawText(line, {
      x: origin.x,
      y: getPdfY(pageHeight, origin.y),
      size: fontSize,
      font,
      color: fill.color,
      opacity: fill.opacity * objectOpacity,
      ...(angle ? { rotate: degrees(pdfAngle) } : {}),
    });
    if (!line || (!wantsUnderline && !wantsLinethrough)) return;
    const thickness = Math.max(0.5, fontSize / 14);
    const drawDecoration = (offset) => {
      const start = rotatePoint({ x: textX, y: appBaseline + offset });
      const end = rotatePoint({ x: textX + lineWidth, y: appBaseline + offset });
      page.drawLine({
        start: { x: start.x, y: getPdfY(pageHeight, start.y) },
        end: { x: end.x, y: getPdfY(pageHeight, end.y) },
        color: fill.color, thickness, opacity: fill.opacity * objectOpacity,
      });
    };
    if (wantsUnderline) drawDecoration(fontSize * 0.12);
    if (wantsLinethrough) drawDecoration(-fontSize * 0.28);
  });
};

const drawFlattenedCounterLabel = (page, obj, pageHeight, font) => {
  const text = String(obj?.data?.displayNumber ?? obj?.data?.number ?? '');
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

// UX 2026-09-09: printing/flattening ANY cloud shape (rect, ellipse/circle,
// polygon, open polyline) paints exactly what the export's /AP paints, because
// it IS the same form: buildCloudAppearance builds the appearance stream (fill
// region knocked out under the stroke band as plain geometry (see
// buildCloudAppearance / cloudFillKnockoutRings),
// then the crowns stroked one run at a time with round caps/joins, alpha and
// blend baked into the ExtGState, tilt in /Matrix) and the flattener places
// that form on the page with a pure translation — the same BBox->Rect fit a
// viewer performs for the annotation. Print and export can therefore never
// disagree, and the flattened raster is pixel-identical to the /AP raster.
// Returns false when the object is not a cloud so the caller draws it plainly.
let flattenedCloudFormCounter = 0;
const drawFlattenedCloud = (page, obj, pageHeight) => {
  const geometry = resolveAnnotationCloudSpec(obj) ? resolveCloudAnnotationGeometry(obj) : null;
  if (!geometry) return false;
  const appearance = buildCloudAppearance(page.doc, obj, pageHeight, {
    geometry,
    strokeFallback: geometry.kind === 'polyline' ? '#000000' : 'transparent',
  });
  if (!appearance) return true; // a cloud with nothing to paint
  // The form's /BBox under its /Matrix has an axis-aligned page box whose
  // min corner must land on the appearance /Rect's min corner.
  const [, , width, height] = appearance.bbox;
  const [a, b, c, d] = appearance.matrix || [1, 0, 0, 1, 0, 0];
  const corners = [[0, 0], [width, 0], [width, height], [0, height]]
    .map(([x, y]) => ({ x: a * x + c * y, y: b * x + d * y }));
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  flattenedCloudFormCounter += 1;
  const name = page.node.newXObject(`CloudAP${flattenedCloudFormCounter}`, appearance.ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(1, 0, 0, 1, appearance.rect[0] - minX, appearance.rect[1] - minY),
    drawObject(name),
    popGraphicsState(),
  );
  return true;
};

const drawFlattenedPolygon = (page, obj, pageHeight, closePath = true) => {
  if (drawFlattenedCloud(page, obj, pageHeight)) return true;
  const rawPoints = fabricPolygonWorldPoints(obj);
  if (rawPoints.length < (closePath ? 3 : 2)) return false;
  // Open polylines: pull the first / last point back so the body stops at the
  // edge of a hollow ending — identical to the screen renderer.
  const plEndings = closePath ? null : resolveLineEndingStyles(obj);
  const points = closePath ? rawPoints : insetOpenPolylinePoints(
    rawPoints,
    lineEndingBodyInset(plEndings.startStyle, Number(obj?.strokeWidth) || 1),
    lineEndingBodyInset(plEndings.endStyle, Number(obj?.strokeWidth) || 1),
  );
  // GOTCHA (drawSvgPath origin trap — see drawFlattenedArrowheadSpec):
  // origin {x: 0, y: pageHeight} + RAW app-space (y-down) coordinates; the
  // default origin (page bottom-left) negates y and lands the shape off-page.
  // (Cloud polygons / polylines returned above through drawFlattenedCloud.)
  const d = points.map((point, index) => {
    const x = Number(point?.x) || 0;
    const y = Number(point?.y) || 0;
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ') + (closePath ? ' Z' : '');
  const stroke = resolvedPdfPaint(obj?.stroke, '#000000');
  const fill = closePath ? resolvedPdfPaint(obj?.fill, 'transparent') : null;
  const strokeWidth = stroke ? Math.max(0, Number(obj?.strokeWidth) || 1) : 0;
  page.drawSvgPath(d, {
    x: 0,
    y: pageHeight,
    borderColor: stroke?.color,
    borderWidth: strokeWidth,
    color: fill?.color,
    opacity: fill?.opacity ?? 1,
    borderOpacity: stroke?.opacity,
    blendMode: obj?.globalCompositeOperation === 'multiply' ? BlendMode.Multiply : undefined,
  });
  return true;
};

const drawFlattenedObject = (page, obj, pageHeight, fonts, offset = { x: 0, y: 0 }, stampImages = new Map()) => {
  if (!obj || typeof obj !== 'object') return 0;
  if (obj?.data?.type === 'text-markup' && Array.isArray(obj?.data?.quads)) {
    const color = parsePdfDrawColor(obj.fill, '#f4d35e')
      || parsePdfDrawColor(obj.stroke, '#f4d35e')
      || parsePdfDrawColor('#f4d35e');
    const opacity = Math.max(0.05, Math.min(1, Number(obj.opacity ?? 1)));
    const markupType = String(obj.data.markupType || obj.exportType || 'highlight').toLowerCase();
    // UX: print uses the authored imported stroke weight, just like the page.
    const authoredLineWidth = obj.data.lineWidthSource === 'pdf-border' && Number.isFinite(obj.data.lineWidth) ? Math.max(0, obj.data.lineWidth) : null;
    // Imported links have no app-side paint. Count the no-op as handled so the
    // native border can be removed without sending it through the underline path.
    if (markupType === 'link' && obj.isPdfImported) return 1;
    let count = 0;
    obj.data.quads.forEach((quad) => {
      const left = Math.min(Number(quad.x1), Number(quad.x2), Number(quad.x3), Number(quad.x4));
      const right = Math.max(Number(quad.x1), Number(quad.x2), Number(quad.x3), Number(quad.x4));
      const top = Math.min(Number(quad.y1), Number(quad.y2), Number(quad.y3), Number(quad.y4));
      const bottom = Math.max(Number(quad.y1), Number(quad.y2), Number(quad.y3), Number(quad.y4));
      if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) return;
      if (markupType === 'redact' || markupType === 'highlight') {
        const points = [
          { x: quad.x1, y: quad.y1 },
          { x: quad.x2, y: quad.y2 },
          { x: quad.x4, y: quad.y4 },
          { x: quad.x3, y: quad.y3 },
        ];
        const path = `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} Z`;
        const unappliedRedaction = markupType === 'redact' && obj?.data?.applied !== true;
        page.drawSvgPath(path, {
          x: 0,
          y: pageHeight,
          color: unappliedRedaction ? undefined : (markupType === 'redact' ? rgb(0, 0, 0) : color.color),
          opacity: unappliedRedaction ? undefined : (markupType === 'redact' ? 1 : opacity),
          borderColor: unappliedRedaction ? color.color : undefined,
          borderOpacity: unappliedRedaction ? opacity : undefined,
          borderWidth: unappliedRedaction ? Math.max(1, Number(obj?.data?.lineWidth) || 1.2) : 0,
          blendMode: markupType === 'highlight' ? BlendMode.Multiply : undefined,
        });
      } else if (markupType === 'squiggly') {
        const y = bottom - Math.max(0.6, (bottom - top) * 0.08);
        const step = Math.max(1.5, (bottom - top) * 0.2);
        for (let x = left; x < right; x += step) {
          const start = { x, y: getPdfY(pageHeight, y) };
          const nextPoint = {
            x: Math.min(right, x + step),
            y: y + (Math.floor((x - left) / step) % 2 === 0 ? -step * 0.35 : step * 0.35),
          };
          const end = { x: nextPoint.x, y: getPdfY(pageHeight, nextPoint.y) };
          page.drawLine({
            start,
            end,
            thickness: authoredLineWidth ?? Math.max(0.6, (bottom - top) * 0.06),
            color: color.color,
            opacity,
          });
        }
      } else {
        const y = markupType === 'strikeout' ? (top + bottom) / 2 : bottom - Math.max(0.6, (bottom - top) * 0.08);
        page.drawLine({
          start: { x: left, y: getPdfY(pageHeight, y) },
          end: { x: right, y: getPdfY(pageHeight, y) },
          thickness: authoredLineWidth ?? Math.max(0.6, (bottom - top) * 0.06),
          color: color.color,
          opacity,
        });
      }
      count += 1;
    });
    return count;
  }
  if (Array.isArray(obj.objects)) {
    const parentLeft = Number(obj.left) || 0;
    const parentTop = Number(obj.top) || 0;
    return obj.objects.reduce((sum, child) => sum + drawFlattenedObject(page, {
      ...child,
      left: (Number(child?.left) || 0) + parentLeft,
      top: (Number(child?.top) || 0) + parentTop,
      x1: child?.x1 !== undefined ? (Number(child.x1) || 0) + parentLeft : child?.x1,
      y1: child?.y1 !== undefined ? (Number(child.y1) || 0) + parentTop : child?.y1,
      x2: child?.x2 !== undefined ? (Number(child.x2) || 0) + parentLeft : child?.x2,
      y2: child?.y2 !== undefined ? (Number(child.y2) || 0) + parentTop : child?.y2,
    }, pageHeight, fonts, offset, stampImages), 0);
  }
  const type = String(obj.type || '').toLowerCase();
  const shifted = offset.x || offset.y
    ? { ...obj, left: (Number(obj.left) || 0) + offset.x, top: (Number(obj.top) || 0) + offset.y }
    : obj;
  const stroke = resolvedPdfPaint(shifted?.stroke, '#000000');
  const fill = resolvedPdfPaint(shifted?.fill, 'transparent');
  const left = getObjNumber(shifted, 'left');
  const top = getObjNumber(shifted, 'top');
  const scaleX = Math.abs(Number(shifted?.scaleX ?? 1) || 1);
  const scaleY = Math.abs(Number(shifted?.scaleY ?? 1) || 1);
  const width = Math.max(0, getObjNumber(shifted, 'width') * scaleX);
  const height = Math.max(0, getObjNumber(shifted, 'height') * scaleY);
  const strokeWidth = stroke ? Math.max(0, Number(shifted?.strokeWidth) || 1) : 0;

  if (isPdfStampProxy(shifted)) {
    const image = stampImages.get(shifted.src || shifted.dataUrl);
    if (!image || width <= 0 || height <= 0) return 0;
    const angle = shifted?.data?.pdfStampAppearanceRotationBaked === true
      ? 0
      : Number(shifted.angle) || 0;
    const pdfAngle = -angle;
    const centerX = left + width / 2;
    const centerY = getPdfY(pageHeight, top + height / 2);
    const radians = pdfAngle * Math.PI / 180;
    const originDx = -width / 2;
    const originDy = -height / 2;
    const imageX = centerX + originDx * Math.cos(radians) - originDy * Math.sin(radians);
    const imageY = centerY + originDx * Math.sin(radians) + originDy * Math.cos(radians);
    page.drawImage(image, {
      x: imageX,
      y: imageY,
      width,
      height,
      opacity: Number.isFinite(Number(shifted.opacity))
        ? Math.max(0, Math.min(1, Number(shifted.opacity)))
        : 1,
      ...(angle ? { rotate: degrees(pdfAngle) } : {}),
    });
    return 1;
  }

  if ((type === 'circle' || type === 'ellipse') && shifted?.data?.type === 'counter') {
    drawFlattenedCounterPin(page, shifted, pageHeight, fonts.bold);
    return 1;
  }

  if (type === 'path') {
    const transform = createInkPageTransform(shifted, shifted.path);
    const transformedPath = transformInkPath(shifted.path, transform);
    const path = fabricPathToSvgPath(transformedPath);
    if (!path) return 0;
    // Paint decisions come from the SAME derivation the screen uses so print
    // matches the app exactly: filled outline ink (pen strokes, erased ink,
    // imported filled Ink) fills with the ink colour and no stroke; anything
    // else is a genuinely stroked path.
    const pathAttrs = renderPathToSvgAttrs(shifted);
    if (pathAttrs.filledOutline || (pathAttrs.strokeWidth === 0 && pathAttrs.fill && pathAttrs.fill !== 'none')) {
      return drawFilledOutlineInk(page, transformedPath, pageHeight, {
        ...pathAttrs,
        opacity: pathAttrs.opacity ?? pathAttrs.fillOpacity ?? shifted?.opacity,
        blendMode: shifted?.globalCompositeOperation === 'multiply' ? 'Multiply' : undefined,
      });
    }
    // GOTCHA (drawSvgPath origin trap — see drawFlattenedArrowheadSpec):
    // origin {x: 0, y: pageHeight} + RAW app-space (y-down) path coordinates.
    // The default origin (page bottom-left) negates y off-page.
    const objectOpacity = Number.isFinite(Number(shifted?.opacity))
      ? Math.max(0, Math.min(1, Number(shifted.opacity)))
      : 1;
    page.pushOperators(pushGraphicsState(), setLineJoin(1));
    page.drawSvgPath(path, {
      x: 0,
      y: pageHeight,
      borderColor: stroke?.color,
      borderWidth: strokeWidth * transform.strokeScale,
      borderOpacity: (stroke?.opacity ?? 1) * objectOpacity,
      borderLineCap: String(shifted?.strokeLineCap || 'round').toLowerCase() === 'round'
        ? LineCapStyle.Round
        : undefined,
      blendMode: shifted?.globalCompositeOperation === 'multiply' ? BlendMode.Multiply : undefined,
    });
    page.pushOperators(popGraphicsState());
    return 1;
  }
  if (type === 'rect') {
    if (isStickyNoteGlyphObject(shifted)) {
      const angle = Number(shifted?.angle) || 0;
      const center = { x: left + width / 2, y: top + height / 2 };
      const glyph = buildStickyNoteGlyphSpec({
        width,
        height,
        left: -width / 2,
        top: -height / 2,
      });
      const glyphFill = parsePdfDrawColor(shifted.fill || '#ffeb3b', '#ffeb3b');
      const glyphStroke = parsePdfDrawColor(stickyNoteOutlineColor(shifted.fill), '#5f5200');
      const glyphStrokeWidth = Math.max(1, Math.min(width, height) * 0.06);
      page.drawSvgPath(glyph.bubblePath, {
        x: center.x,
        y: getPdfY(pageHeight, center.y),
        rotate: degrees(-angle),
        color: glyphFill?.color,
        opacity: glyphFill?.opacity ?? 1,
        borderColor: glyphStroke?.color,
        borderOpacity: glyphStroke?.opacity ?? 1,
        borderWidth: glyphStrokeWidth,
      });
      for (const line of glyph.textLines) {
        const start = rotateAppPoint({ x: center.x + line.x1, y: center.y + line.y1 }, center, angle);
        const end = rotateAppPoint({ x: center.x + line.x2, y: center.y + line.y2 }, center, angle);
        page.drawLine({
          start: { x: start.x, y: getPdfY(pageHeight, start.y) },
          end: { x: end.x, y: getPdfY(pageHeight, end.y) },
          thickness: glyphStrokeWidth,
          color: glyphStroke?.color,
          opacity: glyphStroke?.opacity ?? 1,
          lineCap: LineCapStyle.Round,
        });
      }
      return 1;
    }
    // UX (2026-07-17, line style): dashed/dotted rect borders (incl. the
    // callout text box, which flattens through this branch) print with their
    // on-screen dash pattern instead of flattening solid.
    const rectDash = Array.isArray(shifted?.strokeDashArray) && shifted.strokeDashArray.length > 0
      ? shifted.strokeDashArray.map((v) => Number(v) || 0)
      : null;
    const angle = Number(shifted?.angle) || 0;
    // Screen parity: a rect whose stroke is null/transparent has NO border
    // (the imported-highlight proxy is exactly that — it printed with a black
    // hairline because the paint fallback substituted #000). And the object's
    // own opacity multiplies the fill colour's alpha (a hex fill at 45%
    // object opacity is 45%, not opaque).
    const rawStroke = shifted?.stroke;
    const hasBorder = !(rawStroke === null || rawStroke === undefined || rawStroke === '' || rawStroke === 'transparent')
      && strokeWidth > 0;
    const objectOpacity = Number.isFinite(Number(shifted?.opacity)) ? Math.max(0, Math.min(1, Number(shifted.opacity))) : 1;
    const common = {
      borderColor: hasBorder ? stroke?.color : undefined,
      borderWidth: hasBorder ? strokeWidth : 0,
      color: fill?.color,
      opacity: fill ? (fill.opacity ?? 1) * objectOpacity : undefined,
      borderOpacity: hasBorder ? (stroke?.opacity ?? 1) * objectOpacity : undefined,
      blendMode: shifted?.globalCompositeOperation === 'multiply' ? BlendMode.Multiply : undefined,
    };
    // A cloud rect prints through the shared cloud path (drawFlattenedCloud
    // returns false for unusable geometry, e.g. a non-finite corner, so that
    // case falls through to the plain rectangle branches below).
    if (drawFlattenedCloud(page, shifted, pageHeight)) {
      return 1;
    } else if (angle) {
      const center = { x: left + width / 2, y: top + height / 2 };
      const points = [
        { x: left, y: top }, { x: left + width, y: top },
        { x: left + width, y: top + height }, { x: left, y: top + height },
      ].map((point) => rotateAppPoint(point, center, angle));
      const d = `${points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')} Z`;
      page.drawSvgPath(d, { x: 0, y: pageHeight, ...common });
    } else {
      page.drawRectangle({
        x: left, y: getPdfY(pageHeight, top + height), width, height, ...common,
        ...(rectDash ? { borderDashArray: rectDash, borderDashPhase: 0 } : {}),
      });
    }
    return 1;
  }
  if (type === 'circle' || type === 'ellipse') {
    const radius = Number(shifted?.radius) || Math.max(width, height) / 2 || 10;
    const xRadius = (Number(shifted?.rx) || radius) * scaleX;
    const yRadius = (Number(shifted?.ry) || radius) * scaleY;
    const cx = left + xRadius; const cy = top + yRadius;
    const angle = Number(shifted?.angle) || 0;
    const common = { borderColor: stroke?.color, borderWidth: strokeWidth, color: fill?.color, opacity: fill?.opacity ?? 1, borderOpacity: stroke?.opacity, blendMode: shifted?.globalCompositeOperation === 'multiply' ? BlendMode.Multiply : undefined };
    // UX 2026-09-09: an ellipse/circle carrying the Cloud style prints its
    // scalloped edge, exactly like a cloud rect - same shared resolver, same
    // outline and scalloped fill the screen shows.
    if (drawFlattenedCloud(page, shifted, pageHeight)) return 1;
    if (angle) {
      const points = Array.from({ length: 48 }, (_, index) => {
        const theta = index * Math.PI * 2 / 48;
        return rotateAppPoint({ x: cx + Math.cos(theta) * xRadius, y: cy + Math.sin(theta) * yRadius }, { x: cx, y: cy }, angle);
      });
      const d = `${points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')} Z`;
      page.drawSvgPath(d, { x: 0, y: pageHeight, ...common });
    } else {
      page.drawEllipse({ x: cx, y: getPdfY(pageHeight, cy), xScale: xRadius, yScale: yRadius, ...common });
    }
    return 1;
  }
  if (type === 'line') {
    drawFlattenedLine(page, shifted, pageHeight);
    return 1;
  }
  if (type === 'polygon') return drawFlattenedPolygon(page, shifted, pageHeight, true) ? 1 : 0;
  if (type === 'polyline') {
    if (!drawFlattenedPolygon(page, shifted, pageHeight, false)) return 0;
    // A cloud polyline ends in the engine's rounded tails, not an arrowhead -
    // renderPolyline returns before its ending specs for the same reason.
    if (!resolveAnnotationCloudSpec(shifted)) drawFlattenedPolylineEndings(page, shifted, pageHeight);
    return 1;
  }
  if (type === 'textbox' || type === 'text' || type === 'i-text') {
    // UX 2026-07-17: pass the whole fonts map so bold/italic text prints in
    // the matching Helvetica variant instead of always regular.
    drawFlattenedText(page, shifted, pageHeight, fonts);
    return 1;
  }
  return 0;
};

const drawUniformHighlightMask = (page, objects, pageHeight) => {
  const first = objects?.[0];
  const quads = (objects || []).flatMap((obj) => (Array.isArray(obj?.data?.quads) ? obj.data.quads : []));
  if (!first || quads.length === 0) return 0;
  const color = parsePdfDrawColor(first.fill || first.stroke || '#f4d35e', '#f4d35e');
  const opacity = Math.max(0.05, Math.min(1, Number(first.opacity ?? 1)));
  const path = quads.map((quad) => {
    const points = [
      { x: quad.x1, y: quad.y1 },
      { x: quad.x2, y: quad.y2 },
      { x: quad.x4, y: quad.y4 },
      { x: quad.x3, y: quad.y3 },
    ];
    if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return '';
    return `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} Z`;
  }).filter(Boolean).join(' ');
  if (!path) return 0;
  page.drawSvgPath(path, {
    x: 0,
    y: pageHeight,
    color: color.color,
    opacity,
    blendMode: BlendMode.Multiply,
  });
  return 1;
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
  // Print anchors line 1 exactly where the screen does: the box-edge point
  // nearest the knee (calculateCalloutConnection), with the same bad-geometry
  // rescue — not a fixed left-middle anchor, which flattened the knee away.
  const connection = calculateCalloutConnection(
    textBox.left, textBox.top, textBox.width, textBox.height, knee, arrowTip, strokeWidth,
  );
  const line1Start = connection.line1Start;
  const effectiveKnee = connection.effectiveKnee || knee;
  if (!connection.shouldHideLine1) {
    drawFlattenedLine(page, { type: 'line', x1: line1Start.x, y1: line1Start.y, x2: effectiveKnee.x, y2: effectiveKnee.y, stroke, strokeWidth, ...leaderDashProps }, pageHeight);
  }
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
    fill: style.backgroundColor || '#ffffff',
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
  }, pageHeight, fonts);
  return 1;
};

const decodedPdfText = (value) => {
  try {
    if (typeof value?.decodeText === 'function') return value.decodeText();
    if (typeof value?.asString === 'function') return String(value.asString()).replace(/^\//, '');
  } catch { /* malformed form value */ }
  return '';
};

const inheritedWidgetValue = (pdfDoc, widget, key) => {
  let node = widget;
  for (let guard = 0; node instanceof PDFDict && guard < 32; guard += 1) {
    const raw = node.get(PDFName.of(key));
    if (raw) return pdfDoc.context.lookup(raw);
    const parent = node.get(PDFName.of('Parent'));
    node = parent ? pdfDoc.context.lookupMaybe(parent, PDFDict) : null;
  }
  return null;
};

const widgetColor = (pdfDoc, widget, key) => {
  const appearance = pdfDoc.context.lookupMaybe(widget.get(PDFName.of('MK')), PDFDict);
  const components = appearance
    ? readPdfNativeNumberArray(pdfDoc, appearance.get(PDFName.of(key)))
    : null;
  if (components?.length === 1) return rgb(components[0], components[0], components[0]);
  if (components?.length === 3) return rgb(...components);
  if (components?.length === 4) {
    const [c, m, y, k] = components;
    return rgb(1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k));
  }
  return null;
};

const widgetBorderWidth = (pdfDoc, widget) => {
  const borderStyle = pdfDoc.context.lookupMaybe(widget.get(PDFName.of('BS')), PDFDict);
  const styleWidth = borderStyle
    ? readPdfNativeNumber(pdfDoc, borderStyle.get(PDFName.of('W')))
    : null;
  if (Number.isFinite(styleWidth)) return Math.max(0, styleWidth);
  const border = readPdfNativeNumberArray(pdfDoc, widget.get(PDFName.of('Border')));
  return Math.max(0, Number(border?.[2]) || 0);
};

const fieldDefaultFontSize = (pdfDoc, widget) => {
  const da = decodedPdfText(inheritedWidgetValue(pdfDoc, widget, 'DA'));
  const match = da.match(/(?:^|\s)(\d*\.?\d+)\s+Tf(?:\s|$)/);
  const size = Number(match?.[1]);
  return Number.isFinite(size) && size > 0 ? size : null;
};

const fieldFlags = (pdfDoc, widget) => {
  const value = inheritedWidgetValue(pdfDoc, widget, 'Ff');
  return Math.max(0, Math.trunc(readPdfNativeNumber(pdfDoc, value) || 0));
};

const wrapFieldText = (text, font, size, maxWidth) => {
  const fits = (value) => {
    try { return font.widthOfTextAtSize(value, size) <= maxWidth; } catch { return true; }
  };
  const splitLongWord = (word) => {
    const parts = [];
    let part = '';
    for (const character of word) {
      if (part && !fits(part + character)) {
        parts.push(part);
        part = character;
      } else {
        part += character;
      }
    }
    if (part) parts.push(part);
    return parts;
  };
  const lines = [];
  String(text || '').split(/\r\n?|\n/).forEach((paragraph) => {
    if (!paragraph) {
      lines.push('');
      return;
    }
    let line = '';
    paragraph.split(/\s+/).filter(Boolean).forEach((word) => {
      const parts = fits(word) ? [word] : splitLongWord(word);
      parts.forEach((part) => {
        const candidate = line ? `${line} ${part}` : part;
        if (line && !fits(candidate)) {
          lines.push(line);
          line = part;
        } else {
          line = candidate;
        }
      });
    });
    lines.push(line);
  });
  return lines;
};

// Bake form values with each widget's own appearance settings. This avoids
// viewer-specific /NeedAppearances handling while keeping print true to /MK,
// /BS, /DA, and the multiline field flag.
const flattenFormWidgetsForPrint = (pdfDoc, fonts) => {
  const diagnostics = { widgetsFlattened: 0, checkboxesFlattened: 0, textFieldsFlattened: 0 };
  const black = rgb(17 / 255, 17 / 255, 17 / 255);
  const white = rgb(1, 1, 1);

  pdfDoc.getPages().forEach((page) => {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;
    for (let index = annots.size() - 1; index >= 0; index -= 1) {
      const raw = annots.get(index);
      const widget = pdfDoc.context.lookupMaybe(raw, PDFDict);
      if (!(widget instanceof PDFDict)) continue;
      if (decodedPdfText(pdfDoc.context.lookup(widget.get(PDFName.of('Subtype')))) !== 'Widget') continue;
      const rect = readPdfNativeNumberArray(pdfDoc, widget.get(PDFName.of('Rect')));
      if (!rect) continue;
      const [x1, y1, x2, y2] = rect;
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);
      if (!(width > 0 && height > 0)) continue;

      const backgroundColor = widgetColor(pdfDoc, widget, 'BG');
      const borderColor = widgetColor(pdfDoc, widget, 'BC');
      const borderWidth = widgetBorderWidth(pdfDoc, widget);
      page.drawRectangle({
        x,
        y,
        width,
        height,
        color: backgroundColor || undefined,
        borderColor: borderWidth > 0 ? (borderColor || black) : undefined,
        borderWidth,
      });

      const fieldType = decodedPdfText(inheritedWidgetValue(pdfDoc, widget, 'FT'));
      const value = inheritedWidgetValue(pdfDoc, widget, 'V');
      if (fieldType === 'Btn') {
        const state = decodedPdfText(widget.get(PDFName.of('AS')) || value);
        if (state && state !== 'Off') {
          const pad = Math.max(1, Math.min(width, height) * 0.12);
          const checkColor = borderColor || black;
          page.drawRectangle({ x: x + pad, y: y + pad, width: width - 2 * pad, height: height - 2 * pad, color: checkColor });
          page.drawLine({
            start: { x: x + width * 0.23, y: y + height * 0.52 },
            end: { x: x + width * 0.43, y: y + height * 0.3 },
            color: white,
            thickness: Math.max(1.2, Math.min(width, height) * 0.12),
          });
          page.drawLine({
            start: { x: x + width * 0.43, y: y + height * 0.3 },
            end: { x: x + width * 0.78, y: y + height * 0.72 },
            color: white,
            thickness: Math.max(1.2, Math.min(width, height) * 0.12),
          });
        }
        diagnostics.checkboxesFlattened += 1;
      } else if (fieldType === 'Tx') {
        const text = decodedPdfText(value);
        if (text) {
          const multiline = Boolean(fieldFlags(pdfDoc, widget) & (1 << 12));
          let size = fieldDefaultFontSize(pdfDoc, widget)
            || Math.max(4, Math.min(22, height * (multiline ? 0.22 : 0.72)));
          const innerWidth = Math.max(1, width - 4);
          if (!multiline && !fieldDefaultFontSize(pdfDoc, widget)) {
            try {
              const textWidth = fonts.regular.widthOfTextAtSize(text, size);
              if (textWidth > innerWidth) size = Math.max(4, size * innerWidth / textWidth);
            } catch { /* keep the field-height size for unencodable text */ }
          }
          const lines = multiline ? wrapFieldText(text, fonts.regular, size, innerWidth) : [text.replace(/[\r\n]+/g, ' ')];
          const lineHeight = size * 1.2;
          const maxLines = Math.max(1, Math.floor((height - 4) / lineHeight));
          lines.slice(0, maxLines).forEach((line, lineIndex) => {
            page.drawText(line, {
              x: x + 2,
              y: multiline
                ? y + height - 2 - size - lineIndex * lineHeight
                : y + Math.max(1, (height - size) / 2),
              size,
              font: fonts.regular,
              color: black,
            });
          });
        }
        diagnostics.textFieldsFlattened += 1;
      }
      annots.remove(index);
      diagnostics.widgetsFlattened += 1;
    }
  });
  return diagnostics;
};

export const savePDFWithFlattenedRegularAnnotationsForPrint = async (
  pdfFile,
  annotationsByPage,
  pageSizes,
  options = {},
) => {
  const actionType = options?.actionType || 'pdf-print-flattened-regular-annotations';
  const documentId = options?.documentId || null;
  const screenAnnotationsByPage = options?.screenAnnotationsByPage || annotationsByPage || {};
  const arrayBuffer = await pdfFile.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    // UX 2026-07-17: oblique variants embedded so italic / bold-italic text
    // annotations print with their on-screen slant (Bug: flatten always used
    // regular Helvetica for text, dropping weight and style).
    oblique: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    boldOblique: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
    timesRegular: await pdfDoc.embedFont(StandardFonts.TimesRoman),
    timesBold: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
    timesItalic: await pdfDoc.embedFont(StandardFonts.TimesRomanItalic),
    timesBoldItalic: await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic),
    courierRegular: await pdfDoc.embedFont(StandardFonts.Courier),
    courierBold: await pdfDoc.embedFont(StandardFonts.CourierBold),
    courierOblique: await pdfDoc.embedFont(StandardFonts.CourierOblique),
    courierBoldOblique: await pdfDoc.embedFont(StandardFonts.CourierBoldOblique),
  };
  // Rebuild the caller's payload defensively. Survey Markers stay in the same
  // all-visible print set as survey, space, and region shapes.
  const printablePayload = buildPrintableRegularAnnotationPayload({
    annotationsByPage,
    callouts: options?.callouts || [],
    surveyMarkers: options?.surveyMarkers || {},
  });
  const printableDiagnostics = options?.printableDiagnostics || printablePayload.diagnostics;
  let flattenedPrintAnnotationsAdded = 0;
  const stampImages = new Map();
  for (const pageData of Object.values(printablePayload.annotationsByPage || {})) {
    for (const obj of (Array.isArray(pageData?.objects) ? pageData.objects : [])) {
      if (!isPdfStampProxy(obj)) continue;
      const source = obj.src || obj.dataUrl;
      if (stampImages.has(source)) continue;
      const pngBytes = pngDataUrlToBytes(source);
      if (!pngBytes) continue;
      try {
        stampImages.set(source, await pdfDoc.embedPng(pngBytes));
      } catch (error) {
        console.warn('Failed to embed imported stamp PNG for print:', error);
      }
    }
  }

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
      const pdfAnnotationType = obj?.pdfAnnotationType || obj?.data?.pdfAnnotationType;
      tracker = {
        expected: 0,
        drawn: 0,
        request: {
          kind: 'edited',
          pageNumber,
          pdfAnnotationId: obj?.pdfAnnotationId,
          pdfAnnotationType,
          pdfNativeAnnotationIdentity:
            obj?.data?.pdfNativeAnnotationIdentity
            || obj?.pdfNativeAnnotationIdentity
            || null,
          allowUniqueSubtypeFallback:
            normalizePdfAnnotationSubtype(pdfAnnotationType) === 'highlight',
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
    const uniformHighlightGroups = new Map();
    withPrintPageTransform(page, pageHeight, () => {
      (Array.isArray(pageData?.objects) ? pageData.objects : []).forEach((obj) => {
        if (!importedObjectAllowsPrint(pdfDoc, pageIndex, obj)) return;
        const isUniformHighlight = obj?.data?.type === 'text-markup'
          && obj?.data?.markupType === 'highlight'
          && obj?.data?.overlapMode === 'uniform';
        if (isUniformHighlight) {
          const key = `${String(obj.fill || obj.stroke || '#f4d35e').toLowerCase()}:${Number(obj.opacity ?? 1)}`;
          if (!uniformHighlightGroups.has(key)) uniformHighlightGroups.set(key, []);
          uniformHighlightGroups.get(key).push(obj);
          return;
        }
        const drawnCount = drawFlattenedObject(page, obj, pageHeight, fonts, { x: 0, y: 0 }, stampImages);
        flattenedPrintAnnotationsAdded += drawnCount;
        trackEditedImportDraw(pageNumber, obj, drawnCount);
      });
      uniformHighlightGroups.forEach((objects) => {
        const printableObjects = objects.filter((obj) => importedObjectAllowsPrint(pdfDoc, pageIndex, obj));
        const drawnCount = drawUniformHighlightMask(page, printableObjects, pageHeight);
        flattenedPrintAnnotationsAdded += drawnCount;
        printableObjects.forEach((obj) => trackEditedImportDraw(pageNumber, obj, drawnCount));
      });
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
    if (calloutObj) withPrintPageTransform(page, pageHeight, () => {
      flattenedPrintAnnotationsAdded += drawFlattenedCallout(page, calloutObj, pageHeight, fonts);
    });
  });

  Object.values(printablePayload.surveyMarkers || {}).forEach((marker) => {
    const pageNumber = Number(marker?.pageNumber || marker?.page || 1);
    const pageIndex = pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) return;
    // A saved Survey Marker keeps its geometry under `bounds`; only fixtures
    // ever carried top-level x/y/width/height. Reading those directly printed
    // every real marker as a zero-size box at the page origin.
    const markerBounds = normalizeSurveyMarkerBounds(marker);
    if (!markerBounds) return;
    const markerNeedsEntity = marker?.needsEntity ?? (marker?.entityId == null && marker?.entityColor == null);
    const page = pdfDoc.getPage(pageIndex);
    const fallbackSize = page.getSize();
    const pageSize = pageSizes[String(pageNumber)] || pageSizes[pageNumber] || fallbackSize;
    const pageHeight = Number(pageSize?.height) || fallbackSize.height;
    withPrintPageTransform(page, pageHeight, () => {
      flattenedPrintAnnotationsAdded += drawFlattenedObject(page, {
      type: 'rect',
      left: markerBounds.left,
      top: markerBounds.top,
      width: markerBounds.width,
      height: markerBounds.height,
      // Same paint rule as the screen mirror: no entity yet → dashed blue
      // outline; entity assigned → its colour.
      fill: markerNeedsEntity ? 'transparent' : (marker?.color || marker?.entityColor || 'rgba(255,235,59,0.25)'),
      stroke: markerNeedsEntity ? '#4A90E2' : 'transparent',
      strokeWidth: markerNeedsEntity ? 2 : 0,
      strokeDashArray: markerNeedsEntity ? [5, 5] : undefined,
      opacity: 1,
      angle: Number(marker?.angle) || 0,
      globalCompositeOperation: 'multiply',
      }, pageHeight, fonts);
    });
  });

  const editedImportDiagnostics = {
    editedImportedNativeCopiesRemoved: 0,
    editedImportedNativeCopiesRemoveMisses: 0,
    deletedImportedNativeCopiesRemoved: 0,
    deletedImportedNativeCopiesRemoveMisses: 0,
  };
  const deletedNativeRequests = (Array.isArray(options?.deletedPdfAnnotations)
    ? options.deletedPdfAnnotations
    : [])
    .filter((entry) => entry?.pdfAnnotationId)
    .map((entry) => ({
      kind: 'deleted',
      pageNumber: Number(entry.pageNumber),
      pdfAnnotationId: entry.pdfAnnotationId,
      pdfAnnotationType: entry.pdfAnnotationType,
      pdfNativeAnnotationIdentity:
        entry.pdfNativeAnnotationIdentity
        || entry.data?.pdfNativeAnnotationIdentity
        || null,
    }));
  applyNativePdfAnnotationRemovalPlan({
    pdfDoc,
    requests: [
      ...deletedNativeRequests,
      ...[...editedImportTrackers.values()]
        .filter((tracker) => tracker.drawn > 0 && tracker.drawn === tracker.expected)
        .map((tracker) => tracker.request),
    ],
    exportDiagnostics: editedImportDiagnostics,
  });

  const nativeScreenParityDiagnostics = stripNativeAnnotationsNotOnScreen(
    pdfDoc,
    screenAnnotationsByPage,
  );

  const regularAnnotationsIncluded =
    (Number(printablePayload.diagnostics?.included?.fabric) || 0)
    + (Number(printablePayload.diagnostics?.included?.callouts) || 0)
    + (Number(printablePayload.diagnostics?.included?.surveyMarkers) || 0);
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
  const flattenedFormDiagnostics = flattenFormWidgetsForPrint(pdfDoc, fonts);
  // See the export path: appearances are already regenerated by the writer.
  sanitizeUnappliedRedactionsForExport(pdfDoc);
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
    pdfFormWidgetsFlattened: flattenedFormDiagnostics.widgetsFlattened,
    pdfFormCheckboxesFlattened: flattenedFormDiagnostics.checkboxesFlattened,
    pdfFormTextFieldsFlattened: flattenedFormDiagnostics.textFieldsFlattened,
    regularAnnotationsIncluded,
    scopedAnnotationsExcluded,
    editedImportedNativeCopiesRemoved: editedImportDiagnostics.editedImportedNativeCopiesRemoved,
    editedImportedNativeCopiesRemoveMisses: editedImportDiagnostics.editedImportedNativeCopiesRemoveMisses,
    deletedImportedNativeCopiesRemoved: editedImportDiagnostics.deletedImportedNativeCopiesRemoved,
    deletedImportedNativeCopiesRemoveMisses: editedImportDiagnostics.deletedImportedNativeCopiesRemoveMisses,
    nativeAnnotationsKeptForScreenParity: nativeScreenParityDiagnostics.kept,
    nativeAnnotationsRemovedForScreenParity: nativeScreenParityDiagnostics.removed,
    nativeAnnotationsRemovedByFlags: nativeScreenParityDiagnostics.removedByFlags,
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
      activeModuleId: options?.activeModuleId ?? null,
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
    const uniformHighlightExportGroups = new Map();
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

      const isUniformHighlight = obj?.data?.type === 'text-markup'
        && obj?.data?.markupType === 'highlight'
        && obj?.data?.overlapMode === 'uniform';
      if (isUniformHighlight) {
        const key = [
          item.pageNumber,
          String(obj.fill || obj.stroke || '#f4d35e').toLowerCase(),
          Number(obj.opacity ?? 1),
        ].join(':');
        if (!uniformHighlightExportGroups.has(key)) uniformHighlightExportGroups.set(key, []);
        uniformHighlightExportGroups.get(key).push(item);
        return;
      }

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
      let writesPageFrameDirectly = false;
      const objType = obj?.type?.toLowerCase?.() || item.fabricType || 'unknown';
      if (objType === 'line') {
        const lineValues = [obj?.x1, obj?.y1, obj?.x2, obj?.y2].map(Number);
        if (
          !lineValues.every(Number.isFinite)
          || Math.hypot(lineValues[2] - lineValues[0], lineValues[3] - lineValues[1]) <= 0.01
        ) {
          recordSkip(exportDiagnostics, item, 'invalid-or-degenerate-geometry');
          return;
        }
      }
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
        case 'group': {
          const markupWriters = {
            highlight: adaptHighlight,
            underline: adaptUnderline,
            squiggly: adaptSquiggly,
            strikeout: adaptStrikeOut,
            link: adaptLink,
            redact: adaptRedact,
          };
          const markupType = String(obj?.data?.markupType || obj?.exportType || '').toLowerCase();
          const writer = obj?.data?.type === 'text-markup' ? markupWriters[markupType] : null;
          if (writer) {
            annotRef = writer(obj, { pdfDoc, page, pageHeight });
            writesPageFrameDirectly = true;
          }
          break;
        }
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

      const createdRefs = Array.isArray(annotRefs) ? annotRefs : (annotRef ? [annotRef] : []);
      // Every writer above authors the virtual viewport frame (see
      // getAnnotationPageFrameMatrix); the text-markup adapters are the one
      // family already in user space, so they must not be moved twice.
      if (!writesPageFrameDirectly) {
        const pageFrameMatrix = getAnnotationPageFrameMatrix(page, pageHeight);
        if (pageFrameMatrix) {
          const remappedStreams = new Set();
          createdRefs.forEach((ref) => remapAnnotationRefToPageFrame(pdfDoc, ref, pageFrameMatrix, remappedStreams));
        }
      }
      const refsToPush = createdRefs.filter((ref) => exportAnnotationRefHasValidGeometry(pdfDoc, page, ref));
      if (refsToPush.length !== createdRefs.length) {
        recordSkip(exportDiagnostics, item, 'invalid-or-outside-page-geometry');
      }
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
      } else if (createdRefs.length === 0) {
        recordSkip(exportDiagnostics, item, 'pdf-annotation-create-failed');
      }
    });

    uniformHighlightExportGroups.forEach((items) => {
      const pageNumber = Number(items[0]?.pageNumber);
      const pageIndex = pageNumber - 1;
      const pageSize = pageSizes[String(pageNumber)] || pageSizes[pageNumber];
      if (!pageSize || pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) return;
      const maskPage = pdfDoc.getPage(pageIndex);
      const drawnCount = withPrintPageTransform(maskPage, pageSize.height, () => drawUniformHighlightMask(
        maskPage,
        items.map((item) => item.object),
        pageSize.height,
      ));
      if (drawnCount > 0) {
        exportDiagnostics.uniformHighlightMasksFlattened = (
          exportDiagnostics.uniformHighlightMasksFlattened || 0
        ) + drawnCount;
      } else {
        items.forEach((item) => recordSkip(exportDiagnostics, item, 'uniform-highlight-flatten-failed'));
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
    const attachedAnnotationEntries = [];
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
      attachedAnnotationEntries.push({ item, refs });
    });
    reorderManagedAnnotationsToAppDrawOrder(
      pdfDoc,
      annotationsByPage,
      attachedAnnotationEntries,
    );

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
    const redactionsSanitized = sanitizeUnappliedRedactionsForExport(pdfDoc);
    if (redactionsSanitized > 0) options?.onRedactionsSanitized?.(redactionsSanitized);
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
