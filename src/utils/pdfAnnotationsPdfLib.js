/**
 * PDF Annotation System using pdf-lib Low-Level API
 * Manually creates PDF annotations following PDF 1.7 specification
 * Compatible with Adobe Acrobat and all PDF readers
 */

import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, StandardFonts, rgb } from 'pdf-lib';
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
import { isSurveyMarkerType } from './surveyMarkerType.js';
import {
  ANNOTATION_VISIBILITY_SCOPE,
  getAnnotationVisibilityScope,
  getSpaceIdForRegionFromSpaces,
} from './annotationVisibilityRules.js';

const EXPORTABLE_FABRIC_TYPES = new Set([
  'path',
  'rect',
  'circle',
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

const clonePlain = (value) => JSON.parse(JSON.stringify(value));

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
      if (obj?.isPdfImported || obj?.pdfAnnotationId) {
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

export function buildPdfExportAnnotationPlan({
  annotationsByPage = {},
  callouts = [],
  surveyMarkers = {},
  pageSizes = {},
  spaces = [],
} = {}) {
  const diagnostics = emptyExportCounts();
  const items = [];

  const consider = (item, obj) => {
    recordConsidered(diagnostics, item);

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

    if (isPdfImportedObject(obj) && !isEditedPdfImportedObject(obj)) {
      diagnostics.importedNativeCopiesSkipped += 1;
      recordSkip(diagnostics, item, 'imported-pdf-native-preserved');
      return;
    }

    if (isEditedPdfImportedObject(obj)) {
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
    items.push({ ...item, object: obj });
  };

  Object.entries(annotationsByPage || {}).forEach(([pageKey, pageData]) => {
    const pageNumber = Number.parseInt(pageKey, 10);
    const objects = Array.isArray(pageData?.objects) ? pageData.objects : [];
    objects.forEach((obj, index) => {
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

/**
 * Convert Fabric.js path to PDF Ink annotation
 */
const createInkAnnotation = (pdfDoc, page, fabricObj, pageHeight, options = {}) => {
  try {
    const pathData = fabricObj.path;
    if (!pathData || pathData.length === 0) {
      return null;
    }

    // Build InkList - array of arrays of coordinates
    const inkList = [];
    let currentPath = [];

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
      } else if (command === 'L') {
        // Line - add point
        currentPath.push(cmd[1], pageHeight - cmd[2]);
      } else if (command === 'Q') {
        // Quadratic bezier - use end point
        currentPath.push(cmd[3], pageHeight - cmd[4]);
      } else if (command === 'C') {
        // Cubic bezier - use end point
        currentPath.push(cmd[5], pageHeight - cmd[6]);
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

    // Create annotation dictionary following PDF spec
    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Ink',
      Rect: [minX, minY, maxX, maxY],
      InkList: inkListArray,
      C: [color.red, color.green, color.blue],
      Border: [0, 0, fabricObj.strokeWidth || 1],
      Contents: PDFString.of(''),
      P: page.ref, // Reference to page
    };

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

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Circle',
      Rect: [minX, minY, maxX, maxY],
      C: [color.red, color.green, color.blue],
      Border: [0, 0, fabricObj.strokeWidth || 1],
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

    // Add line endings (arrows, etc.)
    if (fabricObj.lineEnding1 || fabricObj.lineEnding2) {
      const le1 = fabricObj.lineEnding1 || 'None';
      const le2 = fabricObj.lineEnding2 || 'None';
      annotationDict.LE = [PDFName.of(le1), PDFName.of(le2)];
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

    // Default appearance string (simplified - using Helvetica)
    const da = `0 0 0 rg /Helv ${fontSize} Tf`;

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'FreeText',
      Rect: [minX, minY, maxX, maxY],
      Contents: PDFString.of(text),
      DA: PDFString.of(da),
      C: [color.red, color.green, color.blue],
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

  const line1 = createLineAnnotation(pdfDoc, page, {
    type: 'line',
    x1: textBox.left,
    y1: textBox.top + textBox.height / 2,
    x2: knee.x,
    y2: knee.y,
    stroke,
    strokeWidth,
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
    lineEnding2: 'ClosedArrow',
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
  }, pageHeight, buildCalloutOptions('text'));
  if (textRef) refs.push(textRef);

  return refs;
};

const parsePdfAnnotationObjectNumber = (pdfAnnotationId) => {
  const match = String(pdfAnnotationId || '').trim().match(/^(\d+)R$/i);
  if (!match) return null;
  const objectNumber = Number(match[1]);
  return Number.isInteger(objectNumber) && objectNumber > 0 ? objectNumber : null;
};

const decodePdfDictText = (dict, key) => {
  try {
    return dict?.get?.(PDFName.of(key))?.decodeText?.() || null;
  } catch {
    return null;
  }
};

const removeMatchingNativePdfAnnotation = (pdfDoc, annots, pdfAnnotationId) => {
  if (!pdfDoc || !annots || !pdfAnnotationId || typeof annots.asArray !== 'function') {
    return 0;
  }

  const objectNumber = parsePdfAnnotationObjectNumber(pdfAnnotationId);
  const refs = annots.asArray();
  let removed = 0;
  for (let index = refs.length - 1; index >= 0; index -= 1) {
    const ref = refs[index];
    let dict = null;
    try {
      dict = pdfDoc.context.lookup(ref);
    } catch {
      dict = null;
    }
    const name = decodePdfDictText(dict, 'NM');
    const matchesObjectNumber = objectNumber !== null && Number(ref?.objectNumber) === objectNumber;
    const matchesName = name && name === pdfAnnotationId;
    if (matchesObjectNumber || matchesName) {
      annots.remove(index);
      removed += 1;
    }
  }
  return removed;
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

const fabricPathToSvgPath = (pathData, pageHeight) => {
  if (!Array.isArray(pathData) || pathData.length === 0) return '';
  const parts = [];
  pathData.forEach((cmd) => {
    const command = cmd?.[0];
    if (command === 'M' || command === 'L') {
      parts.push(`${command} ${Number(cmd[1]) || 0} ${getPdfY(pageHeight, Number(cmd[2]) || 0)}`);
    } else if (command === 'Q') {
      parts.push(`Q ${Number(cmd[1]) || 0} ${getPdfY(pageHeight, Number(cmd[2]) || 0)} ${Number(cmd[3]) || 0} ${getPdfY(pageHeight, Number(cmd[4]) || 0)}`);
    } else if (command === 'C') {
      parts.push(`C ${Number(cmd[1]) || 0} ${getPdfY(pageHeight, Number(cmd[2]) || 0)} ${Number(cmd[3]) || 0} ${getPdfY(pageHeight, Number(cmd[4]) || 0)} ${Number(cmd[5]) || 0} ${getPdfY(pageHeight, Number(cmd[6]) || 0)}`);
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

const drawFlattenedLine = (page, obj, pageHeight) => {
  const stroke = parsePdfDrawColor(obj?.stroke || '#000000', '#000000') || parsePdfDrawColor('#000000');
  const width = Math.max(0.5, Number(obj?.strokeWidth) || 1);
  const x1 = getObjNumber(obj, 'x1');
  const y1 = getObjNumber(obj, 'y1');
  const x2 = getObjNumber(obj, 'x2');
  const y2 = getObjNumber(obj, 'y2');
  page.drawLine({
    start: { x: x1, y: getPdfY(pageHeight, y1) },
    end: { x: x2, y: getPdfY(pageHeight, y2) },
    color: stroke.color,
    thickness: width,
    opacity: stroke.opacity,
  });
  const ending2 = String(obj?.lineEnding2 || obj?.data?.lineEnding2 || '').toLowerCase();
  const isArrow = ending2.includes('arrow') || obj?.data?.annotationType === 'arrow' || obj?.tool === 'arrow';
  if (isArrow) drawArrowHead(page, { x1, y1, x2, y2, pageHeight, color: stroke.color, width });
};

const drawFlattenedText = (page, obj, pageHeight, font) => {
  const fill = parsePdfDrawColor(obj?.fill || obj?.stroke || '#000000', '#000000') || parsePdfDrawColor('#000000');
  const left = getObjNumber(obj, 'left');
  const top = getObjNumber(obj, 'top');
  const height = Math.max(1, getObjNumber(obj, 'height', Number(obj?.fontSize) || 14));
  const fontSize = Math.max(4, Number(obj?.fontSize) || 12);
  page.drawText(String(obj?.text || ''), {
    x: left,
    y: getPdfY(pageHeight, top + Math.min(height, fontSize + 2)),
    size: fontSize,
    font,
    color: fill.color,
    opacity: fill.opacity,
    maxWidth: Math.max(1, getObjNumber(obj, 'width', 200)),
  });
};

const drawFlattenedCounterLabel = (page, obj, pageHeight, font) => {
  const text = String(obj?.data?.displayNumber ?? '');
  if (!text) return;
  const radius = Math.max(1, (Number(obj?.radius) || 10) * Math.abs(Number(obj?.scaleX) || 1));
  const left = getObjNumber(obj, 'left');
  const top = getObjNumber(obj, 'top');
  const fontSize = Math.max(6, radius * 0.9);
  const textWidth = font.widthOfTextAtSize(text, fontSize);
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
  const tipExtension = Math.max(5, radius * 0.5);
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
  const d = [
    `M ${tipX} ${getPdfY(pageHeight, tipY)}`,
    `L ${t1x} ${getPdfY(pageHeight, t1y)}`,
    `A ${radius} ${radius} 0 1 0 ${t2x} ${getPdfY(pageHeight, t2y)}`,
    'Z',
  ].join(' ');

  page.drawSvgPath(d, {
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
  const left = getObjNumber(obj, 'left');
  const top = getObjNumber(obj, 'top');
  const d = points.map((point, index) => {
    const x = left + (Number(point?.x) || 0);
    const y = getPdfY(pageHeight, top + (Number(point?.y) || 0));
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ') + (closePath ? ' Z' : '');
  const stroke = parsePdfDrawColor(obj?.stroke || '#000000', '#000000') || parsePdfDrawColor('#000000');
  const fill = closePath ? parsePdfDrawColor(obj?.fill, '#ffffff') : null;
  page.drawSvgPath(d, {
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
    return obj.objects.reduce((sum, child) => sum + drawFlattenedObject(page, {
      ...child,
      left: (Number(child?.left) || 0) + parentLeft,
      top: (Number(child?.top) || 0) + parentTop,
      x1: child?.x1 !== undefined ? (Number(child.x1) || 0) + parentLeft : child?.x1,
      y1: child?.y1 !== undefined ? (Number(child.y1) || 0) + parentTop : child?.y1,
      x2: child?.x2 !== undefined ? (Number(child.x2) || 0) + parentLeft : child?.x2,
      y2: child?.y2 !== undefined ? (Number(child.y2) || 0) + parentTop : child?.y2,
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
  const width = Math.max(0, getObjNumber(shifted, 'width'));
  const height = Math.max(0, getObjNumber(shifted, 'height'));
  const strokeWidth = Math.max(0.5, Number(shifted?.strokeWidth) || 1);

  if ((type === 'circle' || type === 'ellipse') && shifted?.data?.type === 'counter') {
    drawFlattenedCounterPin(page, shifted, pageHeight, fonts.bold);
    return 1;
  }

  if (type === 'path') {
    const path = fabricPathToSvgPath(shifted.path, pageHeight);
    if (!path) return 0;
    page.drawSvgPath(path, {
      borderColor: stroke.color,
      borderWidth: strokeWidth,
      borderOpacity: stroke.opacity,
    });
    return 1;
  }
  if (type === 'rect') {
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
    });
    return 1;
  }
  if (type === 'circle' || type === 'ellipse') {
    const radius = Number(shifted?.radius) || Math.max(width, height) / 2 || 10;
    const xScale = Number(shifted?.rx) || radius;
    const yScale = Number(shifted?.ry) || radius;
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
    drawFlattenedText(page, shifted, pageHeight, fonts.regular);
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
  drawFlattenedLine(page, { type: 'line', x1: textBox.left, y1: textBox.top + textBox.height / 2, x2: knee.x, y2: knee.y, stroke, strokeWidth }, pageHeight);
  drawFlattenedLine(page, { type: 'line', x1: knee.x, y1: knee.y, x2: arrowTip.x, y2: arrowTip.y, stroke, strokeWidth, lineEnding2: 'ClosedArrow' }, pageHeight);
  drawFlattenedObject(page, {
    type: 'rect',
    left: textBox.left,
    top: textBox.top,
    width: textBox.width,
    height: textBox.height,
    stroke,
    strokeWidth,
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
  }, pageHeight, fonts.regular);
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
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  const printablePayload = buildPrintableRegularAnnotationPayload({
    annotationsByPage,
    callouts: options?.callouts || [],
    surveyMarkers: {},
  });
  const printableDiagnostics = options?.printableDiagnostics || printablePayload.diagnostics;
  let flattenedPrintAnnotationsAdded = 0;

  Object.entries(printablePayload.annotationsByPage || {}).forEach(([pageKey, pageData]) => {
    const pageNumber = Number.parseInt(pageKey, 10);
    const pageIndex = pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) return;
    const page = pdfDoc.getPage(pageIndex);
    const fallbackSize = page.getSize();
    const pageSize = pageSizes[String(pageNumber)] || pageSizes[pageNumber] || fallbackSize;
    const pageHeight = Number(pageSize?.height) || fallbackSize.height;
    (Array.isArray(pageData?.objects) ? pageData.objects : []).forEach((obj) => {
      flattenedPrintAnnotationsAdded += drawFlattenedObject(page, obj, pageHeight, fonts);
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

  const regularAnnotationsIncluded =
    (Number(printablePayload.diagnostics?.included?.fabric) || 0)
    + (Number(printablePayload.diagnostics?.included?.callouts) || 0);
  const scopedAnnotationsExcluded = Object.values(printableDiagnostics?.excludedByScope || {})
    .reduce((sum, count) => sum + (Number(count) || 0), 0);
  const pdfBytes = await pdfDoc.save();
  console.log('[PDFPrintFlatten] pdf bytes generated ' + JSON.stringify({
    actionType,
    documentId,
    pdfBytesGenerated: true,
    byteLength: pdfBytes?.length || pdfBytes?.byteLength || 0,
    flattenedPrintAnnotationsAdded,
    regularAnnotationsIncluded,
    scopedAnnotationsExcluded,
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

      if (isEditedPdfImportedObject(obj)) {
        const removed = removeMatchingNativePdfAnnotation(pdfDoc, annots, obj?.pdfAnnotationId);
        if (removed > 0) {
          exportDiagnostics.editedImportedNativeCopiesRemoved += removed;
        } else {
          exportDiagnostics.editedImportedNativeCopiesRemoveMisses += 1;
        }
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

      switch (objType) {
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
        refsToPush.forEach((ref) => annots.push(ref));
        totalAnnotations += refsToPush.length;
        exportDiagnostics.pdfAnnotationsAdded += refsToPush.length;
      } else {
        recordSkip(exportDiagnostics, item, 'pdf-annotation-create-failed');
      }
    });

    // Save the PDF
    const pdfBytes = await pdfDoc.save();
    console.log('[PDFImportedEditExport] summary ' + JSON.stringify({
      actionType,
      documentId,
      importedNativeCopiesSkipped: exportDiagnostics.importedNativeCopiesSkipped,
      editedImportedCopiesExported: exportDiagnostics.editedImportedCopiesExported,
      editedImportedNativeCopiesRemoved: exportDiagnostics.editedImportedNativeCopiesRemoved,
      editedImportedNativeCopiesRemoveMisses: exportDiagnostics.editedImportedNativeCopiesRemoveMisses,
      reason: 'unedited imported PDF-native app copies are skipped because the source PDF already contains the native annotation; edited imported copies are exported from app state and matching native annotations are removed when identifiable.'
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
