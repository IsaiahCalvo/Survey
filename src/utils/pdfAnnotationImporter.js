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
 * - Line / PolyLine / Polygon → Fabric.js Line/Polyline/Polygon
 * - Text notes / Caret / Underline / StrikeOut / Squiggly
 *
 * Unsupported types (preserved but not imported):
 * - Stamp, Link, Widget, Popup, FileAttachment, Sound, Movie, etc.
 */

// Supported annotation subtypes that we can convert to Fabric.js
const SUPPORTED_SUBTYPES = [
  'Ink',
  'Highlight',
  'FreeText',
  'Square',
  'Circle',
  'Line',
  'PolyLine',
  'Polygon',
  'Text',
  'Underline',
  'StrikeOut',
  'Squiggly',
  'Caret'
];

const LINE_CAP_MAP = ['butt', 'round', 'square'];
const LINE_JOIN_MAP = ['miter', 'round', 'bevel'];

let pdfLibPromise = null;

async function loadPdfLibCore() {
  if (!pdfLibPromise) {
    pdfLibPromise = import('pdf-lib');
  }
  return pdfLibPromise;
}

// Annotation subtypes that are unsupported but should be preserved
const UNSUPPORTED_SUBTYPES = [
  'Stamp', 'Link', 'Widget', 'Popup', 'FileAttachment', 'Sound', 'Movie',
  'Screen', 'PrinterMark', 'TrapNet', 'Watermark', '3D', 'Redact', 'RichMedia'
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
 * - Array with 0-1 range values (standard PDF)
 * - Array with 0-255 range values (some viewers)
 * - Object with numeric keys like {"0": 219, "1": 52, "2": 37} (Uint8ClampedArray serialized)
 */
function pdfColorToHex(colorInput, annotation = null) {
  // Try to get color from multiple possible locations
  let color = colorInput;

  // If no direct color, try annotation's color property
  if (!color && annotation) {
    color = annotation.color;
  }

  // Try borderColor as fallback
  if (!color && annotation?.borderColor) {
    color = annotation.borderColor;
  }

  // Default to black if no color found
  if (!color) {
    return '#000000';
  }

  // Handle object format like {"0": 219, "1": 52, "2": 37} (Uint8ClampedArray serialized)
  // This happens when PDF.js returns a typed array
  let r, g, b;

  if (typeof color === 'object' && !Array.isArray(color)) {
    // Object with numeric keys
    if ('0' in color && '1' in color && '2' in color) {
      r = color['0'];
      g = color['1'];
      b = color['2'];
    } else if (color.r !== undefined && color.g !== undefined && color.b !== undefined) {
      // Object with r, g, b keys
      r = color.r;
      g = color.g;
      b = color.b;
    } else {
      return '#000000';
    }
  } else if (Array.isArray(color) || (color && typeof color.length === 'number')) {
    // Array or array-like
    if (color.length === 0) {
      return '#000000';
    }

    // Handle grayscale (single value)
    if (color.length === 1) {
      const grayVal = color[0] > 1 ? color[0] : Math.round(color[0] * 255);
      const gray = grayVal.toString(16).padStart(2, '0');
      return `#${gray}${gray}${gray}`;
    }

    r = color[0];
    g = color[1];
    b = color[2];
  } else {
    return '#000000';
  }

  // Determine if values are in 0-1 range or 0-255 range
  // If any value is > 1, assume 0-255 range
  const isNormalized = r <= 1 && g <= 1 && b <= 1;

  if (isNormalized) {
    r = Math.round(r * 255);
    g = Math.round(g * 255);
    b = Math.round(b * 255);
  } else {
    r = Math.round(r);
    g = Math.round(g);
    b = Math.round(b);
  }

  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  return hex;
}

function clamp01(value, fallback = 1) {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeOpacityValue(value) {
  if (value === null || value === undefined || value === '') return null;

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  // Some generators store alpha as a percentage (0-100).
  if (numeric > 1 && numeric <= 100) {
    return clamp01(numeric / 100, null);
  }

  return clamp01(numeric, null);
}

function extractAnnotationOpacity(annotation, fallback = 1) {
  if (!annotation || typeof annotation !== 'object') {
    return fallback;
  }

  const candidates = [
    annotation.opacity,
    annotation.alpha,
    annotation.ca,
    annotation.CA,
    annotation.fillAlpha,
    annotation.strokeAlpha
  ];

  for (const candidate of candidates) {
    const normalized = normalizeOpacityValue(candidate);
    if (normalized !== null) {
      return normalized;
    }
  }

  return fallback;
}

function hexToRgba(hex, alpha = 1) {
  if (typeof hex !== 'string' || !hex.startsWith('#')) return hex;

  const cleanHex = hex.slice(1);
  if (cleanHex.length !== 6) return hex;

  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  const a = clamp01(alpha, 1);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function getBorderWidth(annotation, fallback = 1, options = {}) {
  const { allowExplicitZero = false } = options;
  const rawWidth = annotation?.borderStyle?.width ?? annotation?.borderWidth;

  if (rawWidth === null || rawWidth === undefined || rawWidth === '') {
    return fallback;
  }

  const width = Number(rawWidth);
  if (!Number.isFinite(width) || width < 0) return fallback;
  if (width === 0 && !allowExplicitZero) return fallback;
  return width;
}

function getShapeFillHex(annotation) {
  if (!annotation || typeof annotation !== 'object') return null;

  // PDF creators vary across these fields; prefer explicit interior/fill values.
  const fillSource =
    annotation.interiorColor ??
    annotation.fillColor ??
    annotation.backgroundColor ??
    annotation.fill;

  if (!fillSource) return null;
  return pdfColorToHex(fillSource, annotation);
}

function getShapeFillColor(annotation, strokeHex) {
  const explicitFillHex = getShapeFillHex(annotation);
  const objectOpacity = extractAnnotationOpacity(annotation, 1);

  if (explicitFillHex) {
    return hexToRgba(explicitFillHex, objectOpacity);
  }

  // Drawboard and similar tools may rely on shared opacity + stroke color and omit interiorColor.
  // For partially transparent circle/square markups, use stroke color as fill fallback.
  if (objectOpacity < 1) {
    return hexToRgba(strokeHex, objectOpacity);
  }

  return 'transparent';
}

function getAnnotationTitle(annotation) {
  if (!annotation || typeof annotation !== 'object') {
    return '';
  }

  if (typeof annotation.title === 'string' && annotation.title.trim().length > 0) {
    return annotation.title.trim();
  }

  if (typeof annotation.titleObj?.str === 'string' && annotation.titleObj.str.trim().length > 0) {
    return annotation.titleObj.str.trim();
  }

  return '';
}

function getAnnotationContents(annotation) {
  if (!annotation || typeof annotation !== 'object') {
    return '';
  }

  if (typeof annotation.contents === 'string' && annotation.contents.trim().length > 0) {
    return annotation.contents.trim();
  }

  if (typeof annotation.contentsObj?.str === 'string' && annotation.contentsObj.str.trim().length > 0) {
    return annotation.contentsObj.str.trim();
  }

  return '';
}

function isAutoCadShxTextAnnotation(annotation) {
  if (!annotation || annotation.subtype !== 'Square') {
    return false;
  }

  const normalizedTitle = getAnnotationTitle(annotation).toLowerCase();
  if (!normalizedTitle.includes('autocad shx text')) {
    return false;
  }

  return true;
}

function convertAutoCadShxTextToFabricProxy(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  return {
    type: 'rect',
    left: viewportRect.left,
    top: viewportRect.top,
    width: viewportRect.width,
    height: viewportRect.height,
    fill: 'transparent',
    stroke: 'transparent',
    strokeWidth: 0,
    // Keep selectable to mirror Acrobat/Drawboard behavior, but hide transform handles.
    selectable: true,
    evented: true,
    hasControls: false,
    hasBorders: true,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    perPixelTargetFind: false,
    targetFindTolerance: 8,
    hoverCursor: 'text',
    data: {
      isAutoCadShxText: true,
      shxText: getAnnotationContents(annotation)
    },
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'AutoCAD SHX Text',
    layer: 'pdf-annotations'
  };
}

function toUint8Array(bytesLike) {
  if (!bytesLike) return null;

  if (bytesLike instanceof Uint8Array) {
    return bytesLike;
  }

  if (bytesLike instanceof ArrayBuffer) {
    return new Uint8Array(bytesLike);
  }

  if (ArrayBuffer.isView(bytesLike)) {
    return new Uint8Array(bytesLike.buffer, bytesLike.byteOffset, bytesLike.byteLength);
  }

  return null;
}

function readPdfLibNumber(value) {
  if (!value) return null;

  try {
    if (typeof value.asNumber === 'function') {
      const numeric = value.asNumber();
      return Number.isFinite(numeric) ? numeric : null;
    }
  } catch {
    // ignore and fall back
  }

  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function readPdfLibNumberArray(value) {
  if (!value || typeof value.asArray !== 'function') return null;

  const arr = value.asArray();
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const numbers = arr
    .map((item) => readPdfLibNumber(item))
    .filter((item) => Number.isFinite(item));

  return numbers.length === arr.length ? numbers : null;
}

function readPdfLibText(value) {
  if (!value) return null;

  try {
    if (typeof value.decodeText === 'function') {
      const decoded = value.decodeText();
      return typeof decoded === 'string' && decoded.length > 0 ? decoded : null;
    }
  } catch {
    // ignore and fall back
  }

  const str = String(value || '').trim();
  return str.length > 0 ? str : null;
}

function normalizePdfNameToken(rawName) {
  if (typeof rawName !== 'string') return null;
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
}

function readPdfLibNameArray(value) {
  if (!value || typeof value.asArray !== 'function') return null;

  const arr = value.asArray();
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const names = arr
    .map((item) => normalizePdfNameToken(readPdfLibText(item)))
    .filter(Boolean);

  return names.length === arr.length ? names : null;
}

function readPdfLibDashArray(value) {
  if (!value || typeof value.asArray !== 'function') return null;

  const arr = value.asArray();
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const first = arr[0];
  if (first && typeof first.asArray === 'function') {
    return readPdfLibNumberArray(first);
  }

  const numbers = arr
    .map((item) => readPdfLibNumber(item))
    .filter((item) => Number.isFinite(item));

  return numbers.length === arr.length ? numbers : null;
}

function normalizePdfLineEndings(lineEndings) {
  if (!lineEndings) return null;

  const raw = Array.isArray(lineEndings) ? lineEndings : [lineEndings];
  const normalized = raw
    .map((ending) => normalizePdfNameToken(typeof ending === 'string' ? ending : String(ending || '')))
    .filter(Boolean);

  if (normalized.length === 0) return null;
  if (normalized.length === 1) {
    return [normalized[0], 'None'];
  }

  return [normalized[0], normalized[1]];
}

function isNearWhiteHexColor(hex) {
  if (typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) {
    return false;
  }

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  if (![r, g, b].every((value) => Number.isFinite(value))) {
    return false;
  }

  return r >= 245 && g >= 245 && b >= 245;
}

function parseDefaultAppearanceString(daValue) {
  if (typeof daValue !== 'string' || daValue.trim().length === 0) {
    return null;
  }

  const result = {};

  const rgbMatch = daValue.match(/([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+rg\b/i);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    if ([r, g, b].every((value) => Number.isFinite(value))) {
      result.fontColor = [r, g, b];
    }
  } else {
    const grayMatch = daValue.match(/([+-]?\d*\.?\d+)\s+g\b/i);
    if (grayMatch) {
      const gray = Number(grayMatch[1]);
      if (Number.isFinite(gray)) {
        result.fontColor = [gray, gray, gray];
      }
    }
  }

  const fontMatch = daValue.match(/\/([^\s]+)\s+([+-]?\d*\.?\d+)\s+Tf\b/i);
  if (fontMatch) {
    const fontName = fontMatch[1];
    const fontSize = Number(fontMatch[2]);
    if (fontName) {
      result.fontName = fontName;
    }
    if (Number.isFinite(fontSize) && fontSize > 0) {
      result.fontSize = fontSize;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function parseDefaultStyleString(dsValue) {
  if (typeof dsValue !== 'string' || dsValue.trim().length === 0) {
    return null;
  }

  const result = {};

  const colorMatch = dsValue.match(/color:\s*#([0-9a-f]{6})/i);
  if (colorMatch) {
    const hex = colorMatch[1];
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    result.fontColor = [r, g, b];
  }

  const fontSizeMatch = dsValue.match(/font-size:\s*([+-]?\d*\.?\d+)pt/i);
  if (fontSizeMatch) {
    const fontSize = Number(fontSizeMatch[1]);
    if (Number.isFinite(fontSize) && fontSize > 0) {
      result.fontSize = fontSize;
    }
  }

  const fontFamilyMatch = dsValue.match(/font-family:\s*([^;]+)/i);
  if (fontFamilyMatch) {
    const fontName = String(fontFamilyMatch[1] || '').trim();
    if (fontName) {
      result.fontName = fontName;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function toNumericArray(values) {
  if (!values) return null;

  if (Array.isArray(values)) {
    const numbers = values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    return numbers.length === values.length ? numbers : null;
  }

  if (ArrayBuffer.isView(values)) {
    return Array.from(values)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
  }

  if (typeof values === 'object') {
    const numericKeys = Object.keys(values)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));

    if (numericKeys.length === 0) return null;

    const numbers = numericKeys
      .map((key) => Number(values[key]))
      .filter((value) => Number.isFinite(value));

    return numbers.length === numericKeys.length ? numbers : null;
  }

  return null;
}

function coordinateArrayToPoints(values) {
  const points = [];
  if (!Array.isArray(values) || values.length < 2) return points;

  for (let i = 0; i < values.length - 1; i += 2) {
    const x = values[i];
    const y = values[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x, y });
  }

  return points;
}

function normalizePdfPointList(pointList) {
  if (!pointList) return [];

  if (Array.isArray(pointList) && pointList.length > 0) {
    const first = pointList[0];

    if (Number.isFinite(first)) {
      return coordinateArrayToPoints(pointList);
    }

    if (Array.isArray(first)) {
      return pointList
        .map((pair) => ({
          x: Number(pair?.[0]),
          y: Number(pair?.[1])
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    }

    if (typeof first === 'object') {
      return pointList
        .map((point) => ({
          x: Number(point?.x),
          y: Number(point?.y)
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  }

  const numeric = toNumericArray(pointList);
  return coordinateArrayToPoints(numeric);
}

function convertPdfPointListToViewportPoints(pointList, viewport, scale = 1) {
  const pdfPoints = normalizePdfPointList(pointList);
  if (pdfPoints.length === 0) return [];

  return pdfPoints.map((point) => convertPdfPointToViewport(point.x, point.y, viewport, scale));
}

function roundWithTolerance(value, tolerance = 1) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value / tolerance) * tolerance;
}

function extractCalloutTextBoxRectFromAppearance(annotation, viewport, scale = 1) {
  const path = annotation?._appearance?.path;
  if (!Array.isArray(path) || path.length === 0) {
    return null;
  }

  const subpaths = [];
  let current = [];

  const pushCurrent = (closed = false) => {
    if (current.length >= 3) {
      subpaths.push({ points: current.slice(), closed });
    }
    current = [];
  };

  path.forEach((segment) => {
    if (!Array.isArray(segment) || segment.length === 0) return;
    const cmd = segment[0];

    if (cmd === 'M') {
      if (current.length > 0) {
        pushCurrent(false);
      }
      current = [{ x: Number(segment[1]), y: Number(segment[2]) }];
      return;
    }

    if (cmd === 'L') {
      if (current.length === 0) return;
      current.push({ x: Number(segment[1]), y: Number(segment[2]) });
      return;
    }

    if (cmd === 'C') {
      if (current.length === 0) return;
      current.push({ x: Number(segment[5]), y: Number(segment[6]) });
      return;
    }

    if (cmd === 'Z') {
      pushCurrent(true);
    }
  });

  if (current.length > 0) {
    pushCurrent(false);
  }

  const rectangleCandidates = subpaths
    .filter((subpath) => subpath.closed && subpath.points.length >= 4)
    .map((subpath) => {
      const points = subpath.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      if (points.length < 4) return null;

      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const width = maxX - minX;
      const height = maxY - minY;
      if (!(width > 0 && height > 0)) return null;

      // Rectangle-like paths usually have ~2 unique Xs and ~2 unique Ys.
      const uniqueX = new Set(xs.map((value) => roundWithTolerance(value, 0.5)));
      const uniqueY = new Set(ys.map((value) => roundWithTolerance(value, 0.5)));
      const isRectLike = uniqueX.size <= 3 && uniqueY.size <= 3;
      if (!isRectLike) return null;

      return {
        minX,
        minY,
        maxX,
        maxY,
        area: width * height
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.area - a.area);

  if (rectangleCandidates.length === 0) {
    return null;
  }

  const best = rectangleCandidates[0];
  return convertPdfRectToViewportRect([best.minX, best.minY, best.maxX, best.maxY], viewport, scale);
}

function toRelativeFabricPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  const relativePoints = points.map((point) => ({
    x: point.x - minX,
    y: point.y - minY
  }));

  return {
    left: minX,
    top: minY,
    points: relativePoints
  };
}

function extractAnnotationDashArray(annotation) {
  // Per PDF spec (ISO 32000-2 §12.5.4), the /D dash array is only meaningful
  // when /S is /D. Upstream parsers (PDF.js, Syncfusion) sometimes surface a
  // leftover [3] on borderStyle.dash / borderDashArray for SOLID lines too
  // (confirmed on SE-011 Security Shop Drawing), which previously produced
  // spurious dashed rendering in FabricEraserCanvas and FabricEditCanvas.
  //
  // Strict gate: only return a dash array when we have explicit evidence that
  // /S is /D. If borderStyleType is missing or anything other than 'D', the
  // annotation is solid — return null and ignore any dash candidates.
  const borderStyleType = normalizePdfNameToken(
    annotation?.borderStyle?.style || annotation?.borderStyleType || ''
  );
  if (borderStyleType !== 'D') return null;

  const dashCandidates = [
    annotation?.borderDashArray,
    annotation?.borderStyle?.dashArray,
    annotation?.borderStyle?.dash,
    annotation?.dashArray
  ];

  for (const candidate of dashCandidates) {
    const numeric = toNumericArray(candidate);
    if (Array.isArray(numeric) && numeric.length > 0) {
      const cleaned = numeric.filter((value) => value > 0);
      if (cleaned.length > 0) return cleaned;
    }
  }

  // /S is explicitly /D but no /D entry present: fall back to [3, 3].
  return [3, 3];
}

function decodeStreamBytesToLatin1(bytes) {
  if (!bytes || bytes.length === 0) return '';

  // Avoid stack overflow on large streams by chunking.
  const chunkSize = 0x8000;
  let result = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return result;
}

function parseAppearanceStream(content) {
  if (!content || typeof content !== 'string') return null;

  const tokens = content.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const operands = [];
  const path = [];
  let currentPoint = null;
  let strokeColor = null;
  let fillColor = null;
  let strokeWidth = null;
  let lineCap = null;
  let lineJoin = null;
  let hasStroke = false;
  let hasFill = false;

  const consumeNumbers = (count) => {
    if (operands.length < count) return null;

    const raw = operands.slice(-count);
    if (!raw.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return null;
    }

    operands.length -= count;
    return raw;
  };

  const closeCurrentSubpath = () => {
    if (path.length === 0) return;
    if (path[path.length - 1][0] === 'Z') return;
    path.push(['Z']);
  };

  for (const token of tokens) {
    const numeric = Number(token);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      operands.push(numeric);
      continue;
    }

    if (token.startsWith('/')) {
      operands.push(token);
      continue;
    }

    switch (token) {
      case 'm': {
        const values = consumeNumbers(2);
        if (!values) break;
        const [x, y] = values;
        path.push(['M', x, y]);
        currentPoint = { x, y };
        break;
      }
      case 'l': {
        const values = consumeNumbers(2);
        if (!values) break;
        const [x, y] = values;
        path.push(['L', x, y]);
        currentPoint = { x, y };
        break;
      }
      case 'c': {
        const values = consumeNumbers(6);
        if (!values) break;
        const [x1, y1, x2, y2, x3, y3] = values;
        path.push(['C', x1, y1, x2, y2, x3, y3]);
        currentPoint = { x: x3, y: y3 };
        break;
      }
      case 'v': {
        const values = consumeNumbers(4);
        if (!values || !currentPoint) break;
        const [x2, y2, x3, y3] = values;
        path.push(['C', currentPoint.x, currentPoint.y, x2, y2, x3, y3]);
        currentPoint = { x: x3, y: y3 };
        break;
      }
      case 'y': {
        const values = consumeNumbers(4);
        if (!values) break;
        const [x1, y1, x3, y3] = values;
        path.push(['C', x1, y1, x3, y3, x3, y3]);
        currentPoint = { x: x3, y: y3 };
        break;
      }
      case 'h': {
        closeCurrentSubpath();
        break;
      }
      case 're': {
        const values = consumeNumbers(4);
        if (!values) break;
        const [x, y, w, h] = values;
        path.push(['M', x, y]);
        path.push(['L', x + w, y]);
        path.push(['L', x + w, y + h]);
        path.push(['L', x, y + h]);
        path.push(['Z']);
        currentPoint = { x, y };
        break;
      }
      case 'w': {
        const values = consumeNumbers(1);
        if (!values) break;
        strokeWidth = values[0];
        break;
      }
      case 'J': {
        const values = consumeNumbers(1);
        if (!values) break;
        const capIndex = Math.trunc(values[0]);
        lineCap = LINE_CAP_MAP[capIndex] || null;
        break;
      }
      case 'j': {
        const values = consumeNumbers(1);
        if (!values) break;
        const joinIndex = Math.trunc(values[0]);
        lineJoin = LINE_JOIN_MAP[joinIndex] || null;
        break;
      }
      case 'RG': {
        const values = consumeNumbers(3);
        if (!values) break;
        strokeColor = values;
        break;
      }
      case 'G': {
        const values = consumeNumbers(1);
        if (!values) break;
        strokeColor = [values[0], values[0], values[0]];
        break;
      }
      case 'rg': {
        const values = consumeNumbers(3);
        if (!values) break;
        fillColor = values;
        break;
      }
      case 'g': {
        const values = consumeNumbers(1);
        if (!values) break;
        fillColor = [values[0], values[0], values[0]];
        break;
      }
      case 'S': {
        hasStroke = true;
        break;
      }
      case 's': {
        closeCurrentSubpath();
        hasStroke = true;
        break;
      }
      case 'f':
      case 'F':
      case 'f*': {
        hasFill = true;
        break;
      }
      case 'B':
      case 'B*': {
        hasFill = true;
        hasStroke = true;
        break;
      }
      case 'b':
      case 'b*': {
        closeCurrentSubpath();
        hasFill = true;
        hasStroke = true;
        break;
      }
      default: {
        // Unknown operator; clear to avoid stale operands leaking into the next op.
        operands.length = 0;
        break;
      }
    }
  }

  if (path.length === 0) {
    return null;
  }

  return {
    path,
    strokeWidth,
    strokeColor,
    fillColor,
    lineCap,
    lineJoin,
    hasStroke,
    hasFill
  };
}

function extractAppearanceMetadataForAnnotation(annotationDict, context, pdfLib) {
  const { PDFName, decodePDFRawStream } = pdfLib;
  const ap = annotationDict?.get?.(PDFName.of('AP'));
  if (!ap) return null;

  const apDict = context.lookup(ap);
  const normalAppearance = apDict?.get?.(PDFName.of('N'));
  if (!normalAppearance) return null;

  const stream = context.lookup(normalAppearance);
  if (!stream) return null;

  try {
    const decoded = decodePDFRawStream(stream).decode();
    const source = decodeStreamBytesToLatin1(decoded);
    return parseAppearanceStream(source);
  } catch {
    return null;
  }
}

async function buildRawAnnotationMetadataById(rawPdfBytes) {
  const bytes = toUint8Array(rawPdfBytes);
  if (!bytes) return null;

  try {
    const pdfLib = await loadPdfLibCore();
    const { PDFDocument, PDFName } = pdfLib;
    const rawPdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
    const metadataById = new Map();

    rawPdfDoc.getPages().forEach((page) => {
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (!annots || typeof annots.asArray !== 'function') return;

      annots.asArray().forEach((annotRef) => {
        const dict = rawPdfDoc.context.lookup(annotRef);
        if (!dict || typeof dict.get !== 'function') return;

        const subtype = readPdfLibText(dict.get(PDFName.of('Subtype')));
        if (!subtype) return;

        const referenceId = (
          typeof annotRef?.objectNumber === 'number'
            ? `${annotRef.objectNumber}R`
            : null
        );
        const nameId = readPdfLibText(dict.get(PDFName.of('NM')));
        const idCandidates = [referenceId, nameId].filter(Boolean);
        if (idCandidates.length === 0) return;

        const color = readPdfLibNumberArray(dict.get(PDFName.of('C')));
        const lineColor = readPdfLibNumberArray(dict.get(PDFName.of('LineColor')));
        const interiorColor = readPdfLibNumberArray(dict.get(PDFName.of('IC')));
        const ca = readPdfLibNumber(dict.get(PDFName.of('ca')));
        const CA = readPdfLibNumber(dict.get(PDFName.of('CA')));
        const fillOpacity = readPdfLibNumber(dict.get(PDFName.of('FillOpacity')));
        const intent = normalizePdfNameToken(readPdfLibText(dict.get(PDFName.of('IT'))));
        const lineEndings = normalizePdfLineEndings(readPdfLibNameArray(dict.get(PDFName.of('LE'))));
        const lineCoordinates = readPdfLibNumberArray(dict.get(PDFName.of('L')));
        const vertices = readPdfLibNumberArray(dict.get(PDFName.of('Vertices')));
        const calloutLine = readPdfLibNumberArray(dict.get(PDFName.of('CL')));
        const iconName = normalizePdfNameToken(readPdfLibText(dict.get(PDFName.of('Name'))));
        const state = readPdfLibText(dict.get(PDFName.of('State')));
        const stateModel = readPdfLibText(dict.get(PDFName.of('StateModel')));
        const daText = readPdfLibText(dict.get(PDFName.of('DA')));
        const dsText = readPdfLibText(dict.get(PDFName.of('DS')));
        const contents = readPdfLibText(dict.get(PDFName.of('Contents')));
        const title = readPdfLibText(dict.get(PDFName.of('T')));
        const defaultAppearanceData = {
          ...(parseDefaultStyleString(dsText) || {}),
          ...(parseDefaultAppearanceString(daText) || {})
        };

        let borderWidth = null;
        let borderStyleType = null;
        let borderDashArray = null;
        const borderStyleRef = dict.get(PDFName.of('BS'));
        const borderStyle = borderStyleRef ? rawPdfDoc.context.lookup(borderStyleRef) : null;
        if (borderStyle && typeof borderStyle.get === 'function') {
          borderWidth = readPdfLibNumber(borderStyle.get(PDFName.of('W')));
          borderStyleType = normalizePdfNameToken(readPdfLibText(borderStyle.get(PDFName.of('S'))));
          borderDashArray = readPdfLibDashArray(borderStyle.get(PDFName.of('D')));
        }
        const borderArrayRef = dict.get(PDFName.of('Border'));
        if (borderArrayRef && typeof borderArrayRef.asArray === 'function') {
          const borderArrayEntries = borderArrayRef.asArray();
          if (!Number.isFinite(borderWidth)) {
            const borderNumbers = borderArrayEntries
              .map((item) => readPdfLibNumber(item))
              .filter((value) => Number.isFinite(value));
            if (borderNumbers.length >= 3) {
              borderWidth = borderNumbers[2];
            }
          }
          if (!borderDashArray && borderArrayEntries.length >= 4) {
            const borderDashValue = rawPdfDoc.context.lookup(borderArrayEntries[3]) || borderArrayEntries[3];
            borderDashArray = readPdfLibDashArray(borderDashValue) || readPdfLibNumberArray(borderDashValue);
          }
        }

        const appearance = extractAppearanceMetadataForAnnotation(dict, rawPdfDoc.context, pdfLib);

        const metadata = {
          subtype,
          ...(color ? { color } : {}),
          ...(lineColor ? { lineColor } : {}),
          ...(interiorColor ? { interiorColor } : {}),
          ...(Number.isFinite(ca) ? { ca } : {}),
          ...(Number.isFinite(CA) ? { CA } : {}),
          ...(Number.isFinite(fillOpacity) ? { fillOpacity } : {}),
          ...(Number.isFinite(borderWidth) ? { borderWidth } : {}),
          ...(borderStyleType ? { borderStyleType } : {}),
          ...(borderDashArray ? { borderDashArray } : {}),
          ...(intent ? { intent } : {}),
          ...(lineEndings ? { lineEndings } : {}),
          ...(lineCoordinates ? { lineCoordinates } : {}),
          ...(vertices ? { vertices } : {}),
          ...(calloutLine ? { calloutLine } : {}),
          ...(iconName ? { iconName } : {}),
          ...(state ? { state } : {}),
          ...(stateModel ? { stateModel } : {}),
          ...(contents ? { contents } : {}),
          ...(title ? { title } : {}),
          ...(daText ? { defaultAppearanceString: daText } : {}),
          ...(dsText ? { defaultStyleString: dsText } : {}),
          ...(Object.keys(defaultAppearanceData).length > 0 ? { defaultAppearanceData } : {}),
          ...(appearance ? { appearance } : {})
        };

        idCandidates.forEach((candidate) => {
          metadataById.set(candidate, metadata);
        });
      });
    });

    return metadataById;
  } catch (error) {
    console.warn('Failed to parse raw PDF annotation metadata:', error);
    return null;
  }
}

function getRawAnnotationMetadataForAnnotation(annotation, metadataById) {
  if (!annotation || !metadataById || !(metadataById instanceof Map)) {
    return null;
  }

  const annotationId = String(annotation.id || '').trim();
  if (!annotationId) {
    return null;
  }

  return (
    metadataById.get(annotationId) ||
    metadataById.get(annotationId.replace(/\s+/g, '')) ||
    null
  );
}

function applyRawMetadataToAnnotation(annotation, rawMetadata) {
  if (!rawMetadata) return annotation;

  const borderStyle = {
    ...(annotation.borderStyle || {})
  };
  if (!Number.isFinite(borderStyle.width) && Number.isFinite(rawMetadata.borderWidth)) {
    borderStyle.width = rawMetadata.borderWidth;
  }
  if (!borderStyle.style && rawMetadata.borderStyleType) {
    borderStyle.style = rawMetadata.borderStyleType;
  }
  if (
    (!Array.isArray(borderStyle.dashArray) || borderStyle.dashArray.length === 0) &&
    Array.isArray(rawMetadata.borderDashArray) &&
    rawMetadata.borderDashArray.length > 0
  ) {
    borderStyle.dashArray = rawMetadata.borderDashArray;
  }

  const normalizedLineEndings = normalizePdfLineEndings(
    annotation.lineEndings || rawMetadata.lineEndings
  );

  return {
    ...annotation,
    color: annotation.color || rawMetadata.color || annotation.color,
    lineColor: annotation.lineColor || rawMetadata.lineColor || annotation.lineColor,
    interiorColor: annotation.interiorColor || rawMetadata.interiorColor || annotation.interiorColor,
    borderStyle,
    borderWidth: Number.isFinite(annotation.borderWidth) ? annotation.borderWidth : rawMetadata.borderWidth,
    opacity: annotation.opacity ?? rawMetadata.opacity,
    ca: annotation.ca ?? rawMetadata.ca,
    CA: annotation.CA ?? rawMetadata.CA,
    fillOpacity: annotation.fillOpacity ?? rawMetadata.fillOpacity,
    borderDashArray: annotation.borderDashArray || rawMetadata.borderDashArray || annotation.borderDashArray,
    borderStyleType: annotation.borderStyleType || rawMetadata.borderStyleType || annotation.borderStyleType,
    lineEndings: normalizedLineEndings || annotation.lineEndings,
    lineCoordinates: annotation.lineCoordinates || rawMetadata.lineCoordinates || annotation.lineCoordinates,
    vertices: annotation.vertices || rawMetadata.vertices || annotation.vertices,
    calloutLine: annotation.calloutLine || rawMetadata.calloutLine || annotation.calloutLine,
    intent: annotation.intent || rawMetadata.intent || annotation.intent,
    name: annotation.name || rawMetadata.iconName || annotation.name,
    state: annotation.state || rawMetadata.state || annotation.state,
    stateModel: annotation.stateModel || rawMetadata.stateModel || annotation.stateModel,
    contents: annotation.contents || rawMetadata.contents || annotation.contents,
    title: annotation.title || rawMetadata.title || annotation.title,
    defaultAppearanceData: {
      ...(annotation.defaultAppearanceData || {}),
      ...(rawMetadata.defaultAppearanceData || {})
    },
    defaultAppearanceString: annotation.defaultAppearanceString || rawMetadata.defaultAppearanceString || annotation.defaultAppearanceString,
    defaultStyleString: annotation.defaultStyleString || rawMetadata.defaultStyleString || annotation.defaultStyleString,
    _appearance: rawMetadata.appearance || annotation._appearance || null
  };
}

function convertAppearancePathToFabricPath(pathCommands, viewport, scale = 1) {
  if (!Array.isArray(pathCommands) || pathCommands.length === 0) return null;

  const converted = [];

  pathCommands.forEach((segment) => {
    if (!Array.isArray(segment) || segment.length === 0) return;

    const cmd = segment[0];

    if (cmd === 'M' || cmd === 'L') {
      const point = convertPdfPointToViewport(segment[1], segment[2], viewport, scale);
      converted.push([cmd, point.x, point.y]);
      return;
    }

    if (cmd === 'C') {
      const p1 = convertPdfPointToViewport(segment[1], segment[2], viewport, scale);
      const p2 = convertPdfPointToViewport(segment[3], segment[4], viewport, scale);
      const p3 = convertPdfPointToViewport(segment[5], segment[6], viewport, scale);
      converted.push(['C', p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]);
      return;
    }

    if (cmd === 'Z') {
      converted.push(['Z']);
    }
  });

  return converted.length > 0 ? converted : null;
}

/**
 * Convert PDF Ink annotation to Fabric.js Path data
 * PDF coordinates have origin at bottom-left, Fabric.js at top-left
 */
function convertPdfPointToViewport(x, y, viewport, scale = 1) {
  if (viewport && typeof viewport.convertToViewportPoint === 'function') {
    const [viewportX, viewportY] = viewport.convertToViewportPoint(x, y);
    return { x: viewportX * scale, y: viewportY * scale };
  }

  const pageHeight = Number.isFinite(viewport?.height) ? viewport.height : 0;
  return { x: x * scale, y: (pageHeight - y) * scale };
}

function convertPdfRectToViewportRect(rect, viewport, scale = 1) {
  if (!rect || rect.length < 4) {
    return null;
  }

  let x1, y1, x2, y2;

  if (viewport && typeof viewport.convertToViewportRectangle === 'function') {
    [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
  } else {
    const pageHeight = Number.isFinite(viewport?.height) ? viewport.height : 0;
    x1 = rect[0];
    y1 = pageHeight - rect[3];
    x2 = rect[2];
    y2 = pageHeight - rect[1];
  }

  const left = Math.min(x1, x2) * scale;
  const right = Math.max(x1, x2) * scale;
  const top = Math.min(y1, y2) * scale;
  const bottom = Math.max(y1, y2) * scale;

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function convertInkToFabricPath(annotation, viewport, scale = 1) {
  const appearance = annotation?._appearance || null;
  let pathData = convertAppearancePathToFabricPath(appearance?.path, viewport, scale);

  if (!pathData) {
    if (!annotation.inkLists || annotation.inkLists.length === 0) {
      return null;
    }

    pathData = [];
    annotation.inkLists.forEach((inkList) => {
      if (!inkList || inkList.length < 2) return;

      // inkList is an array of {x, y} points or flat [x1, y1, x2, y2...] array
      const points = [];

      if (Array.isArray(inkList[0])) {
        // Point pair array format [[x1, y1], [x2, y2], ...]
        inkList.forEach((point) => {
          if (!Array.isArray(point) || point.length < 2) return;
          points.push(convertPdfPointToViewport(point[0], point[1], viewport, scale));
        });
      } else if (typeof inkList[0] === 'object') {
        // Object format [{x, y}, ...]
        inkList.forEach((pt) => {
          if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') return;
          points.push(convertPdfPointToViewport(pt.x, pt.y, viewport, scale));
        });
      } else {
        // Flat number array
        for (let i = 0; i < inkList.length; i += 2) {
          if (typeof inkList[i] !== 'number' || typeof inkList[i + 1] !== 'number') continue;
          points.push(convertPdfPointToViewport(inkList[i], inkList[i + 1], viewport, scale));
        }
      }

      if (points.length === 0) {
        return;
      }

      // Smooth raw PDF ink points to better match native viewer appearance.
      pathData.push(['M', points[0].x, points[0].y]);
      if (points.length === 2) {
        pathData.push(['L', points[1].x, points[1].y]);
      } else {
        for (let i = 1; i < points.length - 1; i++) {
          const midX = (points[i].x + points[i + 1].x) / 2;
          const midY = (points[i].y + points[i + 1].y) / 2;
          pathData.push(['Q', points[i].x, points[i].y, midX, midY]);
        }
        const last = points[points.length - 1];
        pathData.push(['L', last.x, last.y]);
      }
    });
  }

  if (!pathData || pathData.length === 0) {
    return null;
  }

  const strokeColorHex = pdfColorToHex(annotation.color, annotation);
  const fillSource = appearance?.fillColor ?? annotation.interiorColor ?? null;
  const fillColorHex = fillSource ? pdfColorToHex(fillSource, annotation) : null;
  const strokeOpacity = extractAnnotationOpacity(annotation, 1);

  const borderWidth = getBorderWidth(annotation, 0);
  let strokeWidth = 0;
  if (borderWidth > 0) {
    // Slightly reduce imported ink stroke width so external annotations remain legible.
    strokeWidth = Math.max(0.75, borderWidth * 0.82) * scale;
  } else if (Number.isFinite(appearance?.strokeWidth) && appearance.strokeWidth > 0) {
    strokeWidth = appearance.strokeWidth * scale;
  } else if (!appearance || !appearance.hasFill) {
    // Zero-width strokes with no fill fallback need a visible width for editability.
    strokeWidth = 0.9 * scale;
  }

  const hasFill = Boolean(appearance?.hasFill);
  const hasStroke = appearance
    ? (appearance.hasStroke && strokeWidth > 0)
    : strokeWidth > 0;

  return {
    type: 'path',
    path: pathData,
    stroke: hasStroke ? hexToRgba(strokeColorHex, strokeOpacity) : null,
    strokeWidth,
    fill: hasFill ? hexToRgba(fillColorHex || strokeColorHex, strokeOpacity) : null,
    strokeLineCap: appearance?.lineCap || 'round',
    strokeLineJoin: appearance?.lineJoin || 'round',
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
function convertHighlightToFabricRect(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const color = pdfColorToHex(annotation.color || [1, 1, 0], annotation); // Default yellow
  const opacity = extractAnnotationOpacity(annotation, 0.3);

  return {
    type: 'rect',
    left: viewportRect.left,
    top: viewportRect.top,
    width: viewportRect.width,
    height: viewportRect.height,
    fill: color,
    opacity,
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
function convertFreeTextToFabricTextbox(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const text = annotation.contents || '';
  const calloutPoints = convertPdfPointListToViewportPoints(annotation.calloutLine, viewport, scale);
  const intent = normalizePdfNameToken(annotation.intent || '');
  const isCalloutIntent = intent === 'FreeTextCallout' || calloutPoints.length >= 2;

  const appearanceTextBoxRect = isCalloutIntent
    ? extractCalloutTextBoxRectFromAppearance(annotation, viewport, scale)
    : null;
  const targetRect = appearanceTextBoxRect || viewportRect;
  const defaultAppearanceColor = annotation.defaultAppearanceData?.fontColor;
  const lineColor = annotation.lineColor;
  const lineColorHex = lineColor ? pdfColorToHex(lineColor, annotation) : null;
  const annotationColorHex = pdfColorToHex(annotation.color || [0, 0, 0], annotation);
  const fallbackAppearanceColor = annotation._appearance?.strokeColor
    ? pdfColorToHex(annotation._appearance.strokeColor, annotation)
    : null;
  const textColor = defaultAppearanceColor
    ? pdfColorToHex(defaultAppearanceColor, annotation)
    : (lineColorHex || fallbackAppearanceColor || annotationColorHex);
  let borderColor = lineColorHex || fallbackAppearanceColor || annotationColorHex;
  if (isCalloutIntent && isNearWhiteHexColor(borderColor) && !isNearWhiteHexColor(textColor)) {
    borderColor = textColor;
  }
  const fontSize = annotation.defaultAppearanceData?.fontSize || 12;
  const strokeWidth = getBorderWidth(annotation, 0, { allowExplicitZero: true });
  const fillHex = getShapeFillHex(annotation);
  const fillOpacity = extractAnnotationOpacity(annotation, 1);
  const backgroundColor = fillHex
    ? hexToRgba(fillHex, fillOpacity)
    : (isCalloutIntent && annotationColorHex
      ? hexToRgba(annotationColorHex, fillOpacity)
      : 'transparent');

  const data = {
    ...(isCalloutIntent ? { pdfIntent: intent || 'FreeTextCallout' } : {}),
    ...(calloutPoints.length >= 2 ? { pdfCalloutPoints: calloutPoints } : {}),
    ...(appearanceTextBoxRect
      ? {
          pdfCalloutBoxRect: {
            left: appearanceTextBoxRect.left,
            top: appearanceTextBoxRect.top,
            width: appearanceTextBoxRect.width,
            height: appearanceTextBoxRect.height
          }
        }
      : {}),
    ...(isCalloutIntent
      ? {
          pdfCalloutStyle: {
            textColor,
            borderColor,
            backgroundColor,
            strokeWidth: strokeWidth * scale
          }
        }
      : {})
  };

  // Plan 15-04 Issue 4 follow-up (2026-04-17): the SVG renderer insets text
  // content by a 6-pixel gutter inside the border on every side. PDF imports
  // used to render edge-to-edge, so source-PDF rects were sized exactly to the
  // text. Without expansion here, the padded content area is 12 px smaller
  // than the source and the bottom line visibly spilled on first render. Bump
  // stored dims by 2*6 and shift anchor by -6 so the padded content area ==
  // original source rect; border grows outward by 6 on each side. Only applies
  // to plain FreeText; callout-intent imports are routed through renderCallout
  // elsewhere and already include the right breathing room.
  const TEXT_PADDING = 6; // keep in sync with svgAnnotationRenderers.TEXT_PADDING
  const padLeft = isCalloutIntent ? targetRect.left : targetRect.left - TEXT_PADDING;
  const padTop = isCalloutIntent ? targetRect.top : targetRect.top - TEXT_PADDING;
  const padWidth = isCalloutIntent ? targetRect.width : targetRect.width + 2 * TEXT_PADDING;
  // Extra descender breathing for plain imports — source PDF rects are often
  // sized to the baseline, so descenders (y, g, p, j) clipped the bottom edge
  // even after the 6px padding bump. 0.35 * fontSize matches the renderer's
  // descenderBuffer so the border fully encloses the glyph bounding box.
  const descenderRoom = isCalloutIntent ? 0 : (fontSize * scale) * 0.35;
  const padHeight = isCalloutIntent
    ? targetRect.height
    : targetRect.height + 2 * TEXT_PADDING + descenderRoom;

  return {
    type: 'textbox',
    left: padLeft,
    top: padTop,
    width: padWidth,
    height: padHeight,
    text: text,
    fill: textColor,
    stroke: strokeWidth > 0 ? borderColor : null,
    strokeWidth: strokeWidth * scale,
    backgroundColor,
    fontSize: fontSize * scale,
    fontFamily: annotation.defaultAppearanceData?.fontName || 'sans-serif',
    ...(Object.keys(data).length > 0 ? { data } : {}),
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

function getAnnotationPolylinePoints(annotation, viewport, scale = 1) {
  const vertices = convertPdfPointListToViewportPoints(annotation.vertices, viewport, scale);
  if (vertices.length >= 2) {
    return vertices;
  }

  if (Array.isArray(annotation.lineCoordinates) && annotation.lineCoordinates.length >= 4) {
    const start = convertPdfPointToViewport(
      annotation.lineCoordinates[0],
      annotation.lineCoordinates[1],
      viewport,
      scale
    );
    const end = convertPdfPointToViewport(
      annotation.lineCoordinates[2],
      annotation.lineCoordinates[3],
      viewport,
      scale
    );
    return [start, end];
  }

  const rect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!rect) return [];

  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.bottom }
  ];
}

function convertPolyLineToFabricPolyline(annotation, viewport, scale = 1) {
  const points = getAnnotationPolylinePoints(annotation, viewport, scale);
  if (points.length < 2) {
    return null;
  }

  const relative = toRelativeFabricPoints(points);
  if (!relative) {
    return null;
  }

  const strokeColor = pdfColorToHex(annotation.color || [0, 0, 0], annotation);
  const strokeOpacity = extractAnnotationOpacity(annotation, 1);
  const strokeWidth = getBorderWidth(annotation, 1);
  const lineEndings = normalizePdfLineEndings(annotation.lineEndings);
  const dashArray = extractAnnotationDashArray(annotation);
  const intent = normalizePdfNameToken(annotation.intent || '');

  const data = {
    ...(lineEndings ? { pdfLineEndings: lineEndings } : {}),
    ...(intent ? { pdfIntent: intent } : {})
  };

  return {
    type: 'polyline',
    left: relative.left,
    top: relative.top,
    points: relative.points,
    fill: 'transparent',
    stroke: hexToRgba(strokeColor, strokeOpacity),
    strokeWidth: strokeWidth * scale,
    ...(dashArray ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeUniform: true,
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    ...(Object.keys(data).length > 0 ? { data } : {}),
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'PolyLine',
    layer: 'pdf-annotations'
  };
}

function convertPolygonToFabricPolygon(annotation, viewport, scale = 1) {
  const points = convertPdfPointListToViewportPoints(annotation.vertices, viewport, scale);
  if (points.length < 3) {
    return null;
  }

  const relative = toRelativeFabricPoints(points);
  if (!relative) {
    return null;
  }

  const strokeColor = pdfColorToHex(annotation.color || [0, 0, 0], annotation);
  const strokeOpacity = extractAnnotationOpacity(annotation, 1);
  const fillColor = getShapeFillColor(annotation, strokeColor);
  const strokeWidth = getBorderWidth(annotation, 1, { allowExplicitZero: true });
  const hasVisibleStroke = strokeWidth > 0;
  const hasVisibleFill = fillColor !== 'transparent';
  const dashArray = extractAnnotationDashArray(annotation);
  const intent = normalizePdfNameToken(annotation.intent || '');

  if (!hasVisibleStroke && !hasVisibleFill) {
    return null;
  }

  return {
    type: 'polygon',
    left: relative.left,
    top: relative.top,
    points: relative.points,
    fill: fillColor,
    stroke: hasVisibleStroke ? hexToRgba(strokeColor, strokeOpacity) : null,
    strokeWidth: hasVisibleStroke ? strokeWidth * scale : 0,
    ...(dashArray && hasVisibleStroke ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeUniform: true,
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    ...(intent ? { data: { pdfIntent: intent } } : {}),
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Polygon',
    layer: 'pdf-annotations'
  };
}

function convertTextToFabricNote(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const minSize = 14 * scale;
  const width = Math.max(viewportRect.width, minSize);
  const height = Math.max(viewportRect.height, minSize);
  const noteColor = pdfColorToHex(annotation.color || [1, 0.92, 0.23], annotation);
  const iconName = normalizePdfNameToken(annotation.name || '') || 'Note';

  return {
    type: 'rect',
    left: viewportRect.left,
    top: viewportRect.top,
    width,
    height,
    fill: hexToRgba(noteColor, 0.92),
    stroke: 'rgba(0, 0, 0, 0.4)',
    strokeWidth: Math.max(1, scale),
    strokeUniform: true,
    rx: Math.max(2, 3 * scale),
    ry: Math.max(2, 3 * scale),
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    hoverCursor: 'pointer',
    data: {
      type: 'note',
      noteText: getAnnotationContents(annotation),
      pdfNoteIcon: iconName,
      ...(annotation.state ? { pdfState: annotation.state } : {}),
      ...(annotation.stateModel ? { pdfStateModel: annotation.stateModel } : {})
    },
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Text',
    layer: 'pdf-annotations'
  };
}

/**
 * Convert PDF Square annotation to Fabric.js Rect
 */
function convertSquareToFabricRect(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const strokeColor = pdfColorToHex(annotation.color || [0, 0, 0], annotation);
  const strokeOpacity = extractAnnotationOpacity(annotation, 1);
  const fillColor = getShapeFillColor(annotation, strokeColor);
  const strokeWidth = getBorderWidth(annotation, 1, { allowExplicitZero: true });
  const hasVisibleStroke = strokeWidth > 0;
  const hasVisibleFill = fillColor !== 'transparent';

  // Ignore shape annotations that are fully invisible in the source PDF.
  if (!hasVisibleStroke && !hasVisibleFill) {
    return null;
  }

  return {
    type: 'rect',
    left: viewportRect.left,
    top: viewportRect.top,
    width: viewportRect.width,
    height: viewportRect.height,
    fill: fillColor,
    stroke: hasVisibleStroke ? hexToRgba(strokeColor, strokeOpacity) : null,
    strokeWidth: hasVisibleStroke ? strokeWidth * scale : 0,
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
function convertCircleToFabricCircle(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  // For ellipse, use the smaller dimension as radius
  // Fabric.js Circle is actually a circle, but we'll approximate ellipses
  const radius = Math.min(viewportRect.width, viewportRect.height) / 2;
  if (radius <= 0) {
    return null;
  }

  const strokeColor = pdfColorToHex(annotation.color || [0, 0, 0], annotation);
  const strokeOpacity = extractAnnotationOpacity(annotation, 1);
  const fillColor = getShapeFillColor(annotation, strokeColor);
  const strokeWidth = getBorderWidth(annotation, 1);

  return {
    type: 'circle',
    left: viewportRect.left,
    top: viewportRect.top,
    radius: radius,
    fill: fillColor,
    stroke: hexToRgba(strokeColor, strokeOpacity),
    strokeWidth: strokeWidth * scale,
    strokeUniform: true,
    // If it's an ellipse, store the original dimensions
    scaleX: viewportRect.width / (radius * 2),
    scaleY: viewportRect.height / (radius * 2),
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
function convertLineToFabricLine(annotation, viewport, scale = 1) {
  // Line coordinates: [x1, y1, x2, y2]
  const lineCoords = annotation.lineCoordinates;
  const lineEndings = normalizePdfLineEndings(annotation.lineEndings);
  const dashArray = extractAnnotationDashArray(annotation);
  const intent = normalizePdfNameToken(annotation.intent || '');
  const calloutPoints = convertPdfPointListToViewportPoints(annotation.calloutLine, viewport, scale);
  const data = {
    ...(lineEndings ? { pdfLineEndings: lineEndings } : {}),
    ...(intent ? { pdfIntent: intent } : {}),
    ...(calloutPoints.length >= 2 ? { pdfCalloutPoints: calloutPoints } : {})
  };

  const strokeValue = hexToRgba(
    pdfColorToHex(annotation.color || [0, 0, 0], annotation),
    extractAnnotationOpacity(annotation, 1)
  );
  const strokeWidthValue = getBorderWidth(annotation, 1) * scale;

  if (!lineCoords || lineCoords.length < 4) {
    // Fallback to rect if no line coordinates
    const rect = annotation.rect;
    if (!rect || rect.length < 4) return null;

    const start = convertPdfPointToViewport(rect[0], rect[1], viewport, scale);
    const end = convertPdfPointToViewport(rect[2], rect[3], viewport, scale);

    return {
      type: 'line',
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      stroke: strokeValue,
      strokeWidth: strokeWidthValue,
      ...(dashArray ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
      strokeUniform: true,
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      ...(Object.keys(data).length > 0 ? { data } : {}),
      isPdfImported: true,
      pdfAnnotationId: annotation.id,
      pdfAnnotationType: 'Line',
      layer: 'pdf-annotations'
    };
  }

  const start = convertPdfPointToViewport(lineCoords[0], lineCoords[1], viewport, scale);
  const end = convertPdfPointToViewport(lineCoords[2], lineCoords[3], viewport, scale);

  return {
    type: 'line',
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    stroke: strokeValue,
    strokeWidth: strokeWidthValue,
    ...(dashArray ? { strokeDashArray: dashArray.map((value) => value * scale) } : {}),
    strokeUniform: true,
    // Required Fabric.js properties for proper interaction
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    ...(Object.keys(data).length > 0 ? { data } : {}),
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
function convertUnderlineToFabricRect(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const height = Math.max(2 * scale, viewportRect.height * 0.1); // Thin line

  const color = pdfColorToHex(annotation.color || [1, 0, 0], annotation); // Default red

  // Position at bottom for underline, middle for strikeout
  const isStrikeOut = annotation.subtype === 'StrikeOut';
  const top = isStrikeOut
    ? viewportRect.top + (viewportRect.height / 2) - (height / 2)
    : viewportRect.top + viewportRect.height - height;

  return {
    type: 'rect',
    left: viewportRect.left,
    top: top,
    width: viewportRect.width,
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

function convertSquigglyToFabricPolyline(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const width = Math.max(4 * scale, viewportRect.width);
  const amplitude = Math.max(1.5 * scale, viewportRect.height * 0.2);
  const wavelength = Math.max(6 * scale, amplitude * 3);
  const segmentCount = Math.max(4, Math.round(width / wavelength) * 2);

  const points = [];
  for (let i = 0; i <= segmentCount; i++) {
    const t = i / segmentCount;
    points.push({
      x: t * width,
      y: amplitude + (i % 2 === 0 ? -amplitude : amplitude)
    });
  }

  const strokeColor = pdfColorToHex(annotation.color || [1, 0, 0], annotation);
  const strokeOpacity = extractAnnotationOpacity(annotation, 1);
  const strokeWidth = Math.max(1, getBorderWidth(annotation, 1)) * scale;

  return {
    type: 'polyline',
    left: viewportRect.left,
    top: viewportRect.top + viewportRect.height - amplitude * 2,
    points,
    fill: 'transparent',
    stroke: hexToRgba(strokeColor, strokeOpacity),
    strokeWidth,
    strokeUniform: true,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Squiggly',
    layer: 'pdf-annotations'
  };
}

function convertCaretToFabricPolyline(annotation, viewport, scale = 1) {
  const viewportRect = convertPdfRectToViewportRect(annotation.rect, viewport, scale);
  if (!viewportRect) {
    return null;
  }

  const width = Math.max(viewportRect.width, 12 * scale);
  const height = Math.max(viewportRect.height, 10 * scale);
  const strokeColor = pdfColorToHex(annotation.color || [1, 0, 0], annotation);
  const strokeOpacity = extractAnnotationOpacity(annotation, 1);
  const strokeWidth = Math.max(1, getBorderWidth(annotation, 1)) * scale;

  return {
    type: 'polyline',
    left: viewportRect.left,
    top: viewportRect.top,
    points: [
      { x: 0, y: height },
      { x: width / 2, y: 0 },
      { x: width, y: height }
    ],
    fill: 'transparent',
    stroke: hexToRgba(strokeColor, strokeOpacity),
    strokeWidth,
    strokeUniform: true,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    isPdfImported: true,
    pdfAnnotationId: annotation.id,
    pdfAnnotationType: 'Caret',
    layer: 'pdf-annotations'
  };
}

/**
 * Convert a single PDF annotation to Fabric.js object data
 * @param {Object} annotation - PDF.js annotation object
 * @param {Object} viewport - PDF.js page viewport (scale 1)
 * @param {number} scale - Scale factor (default 1)
 * @returns {Object|null} Fabric.js object data or null if unsupported
 */
export function convertPdfAnnotationToFabric(annotation, viewport, scale = 1, rawMetadata = null) {
  const normalizedAnnotation = applyRawMetadataToAnnotation(annotation, rawMetadata);
  const subtype = normalizedAnnotation.subtype;

  switch (subtype) {
    case 'Ink':
      return convertInkToFabricPath(normalizedAnnotation, viewport, scale);
    case 'Highlight':
      return convertHighlightToFabricRect(normalizedAnnotation, viewport, scale);
    case 'FreeText':
      return convertFreeTextToFabricTextbox(normalizedAnnotation, viewport, scale);
    case 'Square':
      if (isAutoCadShxTextAnnotation(normalizedAnnotation)) {
        return convertAutoCadShxTextToFabricProxy(normalizedAnnotation, viewport, scale);
      }
      return convertSquareToFabricRect(normalizedAnnotation, viewport, scale);
    case 'Circle':
      return convertCircleToFabricCircle(normalizedAnnotation, viewport, scale);
    case 'Line':
      return convertLineToFabricLine(normalizedAnnotation, viewport, scale);
    case 'PolyLine':
      return convertPolyLineToFabricPolyline(normalizedAnnotation, viewport, scale);
    case 'Polygon':
      return convertPolygonToFabricPolygon(normalizedAnnotation, viewport, scale);
    case 'Text':
      return convertTextToFabricNote(normalizedAnnotation, viewport, scale);
    case 'Underline':
    case 'StrikeOut':
      return convertUnderlineToFabricRect(normalizedAnnotation, viewport, scale);
    case 'Squiggly':
      return convertSquigglyToFabricPolyline(normalizedAnnotation, viewport, scale);
    case 'Caret':
      return convertCaretToFabricPolyline(normalizedAnnotation, viewport, scale);
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
export async function importAnnotationsFromPdf(pdfDoc, options = {}) {
  const annotationsByPage = {};
  const unsupportedTypes = new Set();
  const numPages = pdfDoc.numPages;
  const rawMetadataById = await buildRawAnnotationMetadataById(options.rawPdfBytes);

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });

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
        const rawMetadata = getRawAnnotationMetadataForAnnotation(annotation, rawMetadataById);

        const fabricObj = convertPdfAnnotationToFabric(annotation, viewport, 1, rawMetadata);
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

      // Check if any annotation can be edited by this importer.
      const hasEditableAnnotations = annotations.some(ann =>
        ann.subtype &&
        !SILENT_IGNORE_SUBTYPES.includes(ann.subtype)
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
