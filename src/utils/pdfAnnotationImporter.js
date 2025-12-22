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
 * - Line → Fabric.js Line
 *
 * Unsupported types (preserved but not imported):
 * - Stamp, Link, Widget, Popup, FileAttachment, Sound, Movie, etc.
 */

// Supported annotation subtypes that we can convert to Fabric.js
const SUPPORTED_SUBTYPES = ['Ink', 'Highlight', 'FreeText', 'Square', 'Circle', 'Line', 'Underline', 'StrikeOut'];

// Annotation subtypes that are unsupported but should be preserved
const UNSUPPORTED_SUBTYPES = [
  'Stamp', 'Link', 'Widget', 'Popup', 'FileAttachment', 'Sound', 'Movie',
  'Screen', 'PrinterMark', 'TrapNet', 'Watermark', '3D', 'Redact', 'Caret',
  'Text', 'Polygon', 'PolyLine', 'RichMedia'
];

/**
 * Extract annotations from a PDF.js page
 * @param {PDFPageProxy} page - PDF.js page object
 * @returns {Promise<Array>} Array of annotation objects
 */
export async function extractAnnotationsFromPage(page) {
  try {
    const annotations = await page.getAnnotations();
    return annotations;
  } catch (error) {
    console.error('Error extracting annotations from page:', error);
    return [];
  }
}

/**
 * Convert PDF color to hex string
 * Handles various color formats from different PDF creators
 */
function pdfColorToHex(colorArray, annotation = null) {
  // Try to get color from multiple possible locations
  let color = colorArray;

  // If no direct color, try annotation's color property
  if ((!color || color.length === 0) && annotation) {
    color = annotation.color;
  }

  // Try borderColor as fallback
  if ((!color || color.length === 0) && annotation?.borderColor) {
    color = annotation.borderColor;
  }

  // Default to black if no color found
  if (!color || !Array.isArray(color) || color.length === 0) {
    console.log('[pdfAnnotationImporter] No color found, defaulting to black');
    return '#000000';
  }

  // Handle grayscale (single value)
  if (color.length === 1) {
    const gray = Math.round(color[0] * 255).toString(16).padStart(2, '0');
    return `#${gray}${gray}${gray}`;
  }

  // Handle RGB (3 values, 0-1 range)
  if (color.length >= 3) {
    const r = Math.round(color[0] * 255).toString(16).padStart(2, '0');
    const g = Math.round(color[1] * 255).toString(16).padStart(2, '0');
    const b = Math.round(color[2] * 255).toString(16).padStart(2, '0');
    console.log(`[pdfAnnotationImporter] Parsed color: RGB(${color[0]}, ${color[1]}, ${color[2]}) -> #${r}${g}${b}`);
    return `#${r}${g}${b}`;
  }

  console.log('[pdfAnnotationImporter] Unknown color format, defaulting to black:', color);
  return '#000000';
}

/**
 * Convert PDF Ink annotation to Fabric.js Path data
 * PDF coordinates have origin at bottom-left, Fabric.js at top-left
 */
function convertInkToFabricPath(annotation, pageHeight, scale = 1) {
  console.log('[pdfAnnotationImporter] Converting Ink annotation:', JSON.stringify({
    id: annotation.id,
    subtype: annotation.subtype,
    color: annotation.color,
    borderColor: annotation.borderColor,
    borderStyle: annotation.borderStyle,
    borderWidth: annotation.borderWidth,
    inkLists: annotation.inkLists ? `${annotation.inkLists.length} lists` : 'none',
    rect: annotation.rect,
    // Log all keys to see what properties Adobe provides
    allKeys: Object.keys(annotation)
  }, null, 2));

  if (!annotation.inkLists || annotation.inkLists.length === 0) {
    console.log('[pdfAnnotationImporter] No inkLists found in annotation');
    return null;
  }

  // Build SVG path string from ink lists
  let pathData = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  annotation.inkLists.forEach(inkList => {
    if (!inkList || inkList.length < 2) return;

    // inkList is an array of {x, y} points or flat [x1, y1, x2, y2...] array
    const points = [];

    if (Array.isArray(inkList[0])) {
      // Flat array format [x1, y1, x2, y2...]
      for (let i = 0; i < inkList.length; i += 2) {
        const x = inkList[i] * scale;
        const y = (pageHeight - inkList[i + 1]) * scale; // Flip Y
        points.push({ x, y });
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    } else if (typeof inkList[0] === 'object') {
      // Object format [{x, y}, ...]
      inkList.forEach(pt => {
        const x = pt.x * scale;
        const y = (pageHeight - pt.y) * scale; // Flip Y
        points.push({ x, y });
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      });
    } else {
      // Flat number array
      for (let i = 0; i < inkList.length; i += 2) {
        const x = inkList[i] * scale;
        const y = (pageHeight - inkList[i + 1]) * scale; // Flip Y
        points.push({ x, y });
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (points.length > 0) {
      // Move to first point
      pathData.push(['M', points[0].x, points[0].y]);

      // Line to subsequent points
      for (let i = 1; i < points.length; i++) {
        pathData.push(['L', points[i].x, points[i].y]);
      }
    }
  });

  if (pathData.length === 0) {
    console.log('[pdfAnnotationImporter] No path data generated');
    return null;
  }

  // Get color - pass annotation for fallback color sources
  const color = pdfColorToHex(annotation.color, annotation);
  const strokeWidth = annotation.borderStyle?.width || annotation.borderWidth || 2;

  console.log(`[pdfAnnotationImporter] Created path with color: ${color}, strokeWidth: ${strokeWidth}`);

  // Calculate path bounds for proper positioning
  const width = maxX - minX;
  const height = maxY - minY;

  return {
    type: 'path',
    path: pathData,
    stroke: color,
    strokeWidth: strokeWidth * scale,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeUniform: true,
    // Required Fabric.js properties for proper interaction
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    lockMovementX: false,
    lockMovementY: false,
    perPixelTargetFind: true,
    targetFindTolerance: 5,
    // Mark as imported from PDF
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Ink',
    layer: 'pdf-annotations'
  };
}

/**
 * Convert PDF Highlight annotation to Fabric.js Rect with fill
 */
function convertHighlightToFabricRect(annotation, pageHeight, scale = 1) {
  const rect = annotation.rect;
  if (!rect || rect.length < 4) {
    return null;
  }

  // rect is [x1, y1, x2, y2] in PDF coordinates
  const left = rect[0] * scale;
  const bottom = rect[1] * scale;
  const right = rect[2] * scale;
  const top = rect[3] * scale;

  const width = right - left;
  const height = top - bottom;

  const color = pdfColorToHex(annotation.color || [1, 1, 0], annotation); // Default yellow

  return {
    type: 'rect',
    left: left,
    top: (pageHeight * scale) - top, // Flip Y
    width: width,
    height: height,
    fill: color,
    opacity: 0.3, // Typical highlight opacity
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
function convertFreeTextToFabricTextbox(annotation, pageHeight, scale = 1) {
  const rect = annotation.rect;
  if (!rect || rect.length < 4) {
    return null;
  }

  const left = rect[0] * scale;
  const bottom = rect[1] * scale;
  const right = rect[2] * scale;
  const top = rect[3] * scale;

  const width = right - left;
  const height = top - bottom;

  const text = annotation.contents || '';
  const color = pdfColorToHex(annotation.color || [0, 0, 0], annotation);
  const fontSize = annotation.defaultAppearanceData?.fontSize || 12;

  return {
    type: 'textbox',
    left: left,
    top: (pageHeight * scale) - top, // Flip Y
    width: width,
    height: height,
    text: text,
    fill: color,
    fontSize: fontSize * scale,
    fontFamily: 'sans-serif',
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

/**
 * Convert PDF Square annotation to Fabric.js Rect
 */
function convertSquareToFabricRect(annotation, pageHeight, scale = 1) {
  const rect = annotation.rect;
  if (!rect || rect.length < 4) {
    return null;
  }

  const left = rect[0] * scale;
  const bottom = rect[1] * scale;
  const right = rect[2] * scale;
  const top = rect[3] * scale;

  const width = right - left;
  const height = top - bottom;

  const strokeColor = pdfColorToHex(annotation.color || [0, 0, 0], annotation);
  const fillColor = annotation.interiorColor ? pdfColorToHex(annotation.interiorColor, annotation) : null;
  const strokeWidth = annotation.borderStyle?.width || 1;

  return {
    type: 'rect',
    left: left,
    top: (pageHeight * scale) - top, // Flip Y
    width: width,
    height: height,
    fill: fillColor || 'transparent',
    stroke: strokeColor,
    strokeWidth: strokeWidth * scale,
    strokeUniform: true,
    // Required Fabric.js properties for proper interaction
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
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
function convertCircleToFabricCircle(annotation, pageHeight, scale = 1) {
  const rect = annotation.rect;
  if (!rect || rect.length < 4) {
    return null;
  }

  const left = rect[0] * scale;
  const bottom = rect[1] * scale;
  const right = rect[2] * scale;
  const top = rect[3] * scale;

  const width = right - left;
  const height = top - bottom;

  // For ellipse, use the smaller dimension as radius
  // Fabric.js Circle is actually a circle, but we'll approximate ellipses
  const radius = Math.min(width, height) / 2;

  const strokeColor = pdfColorToHex(annotation.color || [0, 0, 0], annotation);
  const fillColor = annotation.interiorColor ? pdfColorToHex(annotation.interiorColor, annotation) : null;
  const strokeWidth = annotation.borderStyle?.width || 1;

  return {
    type: 'circle',
    left: left,
    top: (pageHeight * scale) - top, // Flip Y
    radius: radius,
    fill: fillColor || 'transparent',
    stroke: strokeColor,
    strokeWidth: strokeWidth * scale,
    strokeUniform: true,
    // If it's an ellipse, store the original dimensions
    scaleX: width / (radius * 2),
    scaleY: height / (radius * 2),
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
function convertLineToFabricLine(annotation, pageHeight, scale = 1) {
  // Line coordinates: [x1, y1, x2, y2]
  const lineCoords = annotation.lineCoordinates;
  if (!lineCoords || lineCoords.length < 4) {
    // Fallback to rect if no line coordinates
    const rect = annotation.rect;
    if (!rect || rect.length < 4) return null;

    return {
      type: 'line',
      x1: rect[0] * scale,
      y1: (pageHeight - rect[1]) * scale,
      x2: rect[2] * scale,
      y2: (pageHeight - rect[3]) * scale,
      stroke: pdfColorToHex(annotation.color || [0, 0, 0], annotation),
      strokeWidth: (annotation.borderStyle?.width || 1) * scale,
      strokeUniform: true,
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      isPdfImported: true,
      pdfAnnotationId: annotation.id,
      pdfAnnotationType: 'Line',
      layer: 'pdf-annotations'
    };
  }

  const strokeColor = pdfColorToHex(annotation.color || [0, 0, 0], annotation);
  const strokeWidth = annotation.borderStyle?.width || 1;

  return {
    type: 'line',
    x1: lineCoords[0] * scale,
    y1: (pageHeight - lineCoords[1]) * scale, // Flip Y
    x2: lineCoords[2] * scale,
    y2: (pageHeight - lineCoords[3]) * scale, // Flip Y
    stroke: strokeColor,
    strokeWidth: strokeWidth * scale,
    strokeUniform: true,
    // Required Fabric.js properties for proper interaction
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
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
function convertUnderlineToFabricRect(annotation, pageHeight, scale = 1) {
  const rect = annotation.rect;
  if (!rect || rect.length < 4) {
    return null;
  }

  const left = rect[0] * scale;
  const bottom = rect[1] * scale;
  const right = rect[2] * scale;
  const top = rect[3] * scale;

  const width = right - left;
  const height = Math.max(2, (top - bottom) * 0.1); // Thin line

  const color = pdfColorToHex(annotation.color || [1, 0, 0], annotation); // Default red

  // Position at bottom for underline, middle for strikeout
  const isStrikeOut = annotation.subtype === 'StrikeOut';
  const yOffset = isStrikeOut ? (top - bottom) / 2 : 0;

  return {
    type: 'rect',
    left: left,
    top: (pageHeight * scale) - bottom - yOffset, // Position based on type
    width: width,
    height: height,
    fill: color,
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
    pdfAnnotationType: annotation.subtype,
    layer: 'pdf-annotations'
  };
}

/**
 * Convert a single PDF annotation to Fabric.js object data
 * @param {Object} annotation - PDF.js annotation object
 * @param {number} pageHeight - Height of the page in PDF units
 * @param {number} scale - Scale factor (default 1)
 * @returns {Object|null} Fabric.js object data or null if unsupported
 */
export function convertPdfAnnotationToFabric(annotation, pageHeight, scale = 1) {
  const subtype = annotation.subtype;

  switch (subtype) {
    case 'Ink':
      return convertInkToFabricPath(annotation, pageHeight, scale);
    case 'Highlight':
      return convertHighlightToFabricRect(annotation, pageHeight, scale);
    case 'FreeText':
      return convertFreeTextToFabricTextbox(annotation, pageHeight, scale);
    case 'Square':
      return convertSquareToFabricRect(annotation, pageHeight, scale);
    case 'Circle':
      return convertCircleToFabricCircle(annotation, pageHeight, scale);
    case 'Line':
      return convertLineToFabricLine(annotation, pageHeight, scale);
    case 'Underline':
    case 'StrikeOut':
      return convertUnderlineToFabricRect(annotation, pageHeight, scale);
    default:
      // Unsupported annotation type
      return null;
  }
}

// Annotation types that should be silently ignored (common companion annotations)
const SILENT_IGNORE_SUBTYPES = ['Link', 'Popup', 'Widget'];

/**
 * Categorize annotations into supported and unsupported
 * @param {Array} annotations - Array of PDF.js annotations
 * @returns {Object} { supported: [], unsupported: [] }
 */
export function categorizeAnnotations(annotations) {
  const supported = [];
  const unsupported = [];

  annotations.forEach(annotation => {
    if (SUPPORTED_SUBTYPES.includes(annotation.subtype)) {
      supported.push(annotation);
    } else if (annotation.subtype && !SILENT_IGNORE_SUBTYPES.includes(annotation.subtype)) {
      // Only report types that are truly unsupported (not common companion annotations)
      unsupported.push(annotation);
    }
  });

  return { supported, unsupported };
}

/**
 * Import all annotations from a PDF document
 * @param {PDFDocumentProxy} pdfDoc - PDF.js document
 * @returns {Promise<Object>} { annotationsByPage: {}, unsupportedTypes: Set }
 */
export async function importAnnotationsFromPdf(pdfDoc) {
  const annotationsByPage = {};
  const unsupportedTypes = new Set();
  const numPages = pdfDoc.numPages;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const pageHeight = viewport.height;

      const annotations = await extractAnnotationsFromPage(page);
      const { supported, unsupported } = categorizeAnnotations(annotations);

      // Track unsupported types
      unsupported.forEach(ann => {
        if (ann.subtype) {
          unsupportedTypes.add(ann.subtype);
        }
      });

      // Convert supported annotations to Fabric.js objects
      const fabricObjects = [];
      supported.forEach(annotation => {
        const fabricObj = convertPdfAnnotationToFabric(annotation, pageHeight);
        if (fabricObj) {
          fabricObjects.push(fabricObj);
        }
      });

      if (fabricObjects.length > 0) {
        annotationsByPage[pageNum] = {
          objects: fabricObjects
        };
      }
    } catch (error) {
      console.error(`Error importing annotations from page ${pageNum}:`, error);
    }
  }

  return {
    annotationsByPage,
    unsupportedTypes: Array.from(unsupportedTypes)
  };
}

/**
 * Check if a PDF has any annotations
 * @param {PDFDocumentProxy} pdfDoc - PDF.js document
 * @returns {Promise<boolean>}
 */
export async function pdfHasAnnotations(pdfDoc) {
  const numPages = pdfDoc.numPages;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const annotations = await page.getAnnotations();

      // Check if any annotation is not a Link (links are not editable annotations)
      const hasEditableAnnotations = annotations.some(ann =>
        ann.subtype && ann.subtype !== 'Link' && ann.subtype !== 'Widget'
      );

      if (hasEditableAnnotations) {
        return true;
      }
    } catch (error) {
      console.error(`Error checking annotations on page ${pageNum}:`, error);
    }
  }

  return false;
}
