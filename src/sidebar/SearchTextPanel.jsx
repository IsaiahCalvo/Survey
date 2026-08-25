/**
 * SearchTextPanel.jsx — sidebar full-text search over the loaded PDF with match highlighting.
 *
 * Default export SearchTextPanel extracts/caches per-page text via pdf.js, finds
 * query matches, and computes highlight rectangles using pdf.js text-layer DOM
 * ranges refined against the rendered page image's ink (falling back to native
 * onFindTextMatches bounds or metric estimates). Drives navigation via
 * onNavigateToMatch/onNavigateToPage and emits diagnostics through textSearchDiag.
 */
import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import Icon from '../Icons';
import { emitTextSearchDiag } from '../utils/textSearchDiag';
import { resolveSearchPageViewport, viewportMatchesLiveHost } from '../utils/pdfjsTextLayerViewport';
import { ensureTextLayerStyles } from '../components/PdfjsTextLayer';
import { useTooltip } from '../components/Tooltip';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

// Search result ID generator
const createResultId = (() => {
  let counter = 0;
  return () => {
    counter += 1;
    return `search-${Date.now()}-${counter}`;
  };
})();

const clampValue = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const TEXT_HIGHLIGHT_MIN_HEIGHT = 5;
const TEXT_HIGHLIGHT_ASCENT_RATIO = 0.74;
const TEXT_HIGHLIGHT_TOP_PAD_RATIO = 0.02;
const TEXT_HIGHLIGHT_BOTTOM_PAD_RATIO = 0.10;
const TEXT_HIGHLIGHT_BOUNDARY_LEFT_PAD_RATIO = 0.015;
const TEXT_HIGHLIGHT_INTERNAL_LEFT_PAD_RATIO = 0.006;
const TEXT_HIGHLIGHT_BOUNDARY_RIGHT_PAD_RATIO = 0.18;
const TEXT_HIGHLIGHT_INTERNAL_RIGHT_PAD_RATIO = 0.035;
const TEXT_HIGHLIGHT_MAX_SIDE_PAD_RATIO = 0.22;
const TEXT_LAYER_GEOMETRY_MIN_RECT_SIZE = 0.01;
const TEXT_LAYER_INK_SCAN_THRESHOLD = 42;
const TEXT_LAYER_INK_SCAN_MIN_PIXELS = 4;
const TEXT_LAYER_INK_SCAN_MAX_PIXELS = 180000;
const TEXT_LAYER_INK_SCAN_MIN_PAD = 2.4;
const TEXT_LAYER_INK_SCAN_MAX_PAD = 18;
const TEXT_LAYER_INK_SCAN_PAD_RATIO = 0.48;
const TEXT_LAYER_INK_SCAN_MIN_HEIGHT = 2;
const TEXT_LAYER_INK_SCAN_BUCKET_SHIFT = 4;
const TEXT_LAYER_INK_COMPONENT_SELECTION_PAD = 2;
const TEXT_LAYER_MEASUREMENT_TIMEOUT_MS = 2500;

const SEARCH_TEXT_WORD_CHAR_REGEX = /[\p{L}\p{N}\p{M}]/u;

let searchTextMeasureContext = null;
const renderedPageImageCanvasCache = new WeakMap();

const getSearchTextMeasureContext = () => {
  if (typeof document === 'undefined') return null;
  if (!searchTextMeasureContext) {
    const canvas = document.createElement('canvas');
    searchTextMeasureContext = canvas.getContext('2d');
  }
  return searchTextMeasureContext;
};

const getSearchTextFontFamily = (style = {}, textItem = {}) => {
  const family = style?.fontFamily || textItem?.fontFamily || '';
  return typeof family === 'string' && family.trim() ? family : FONT_FAMILY;
};

const measureSearchTextWidth = (ctx, font, text) => {
  if (!ctx || !font || typeof text !== 'string') return null;
  try {
    ctx.font = font;
    const width = ctx.measureText(text).width;
    return Number.isFinite(width) && width > 0 ? width : null;
  } catch {
    return null;
  }
};

const isSearchTextWordChar = (char) => (
  typeof char === 'string' && char.length > 0 && SEARCH_TEXT_WORD_CHAR_REGEX.test(char)
);

const resolveTextSegmentContext = (itemText, relativeStart, relativeLength) => {
  const segmentEnd = relativeStart + relativeLength;
  const previousChar = relativeStart > 0 ? itemText.slice(relativeStart - 1, relativeStart) : '';
  const nextChar = segmentEnd < itemText.length ? itemText.slice(segmentEnd, segmentEnd + 1) : '';

  return {
    previousChar,
    nextChar,
    startsAtBoundary: !isSearchTextWordChar(previousChar),
    endsAtBoundary: !isSearchTextWordChar(nextChar)
  };
};

const resolveTextHighlightPad = (fontHeight, ratio, minimum) => {
  const maxSidePad = Math.max(1, fontHeight * TEXT_HIGHLIGHT_MAX_SIDE_PAD_RATIO);
  return Math.min(Math.max(minimum, fontHeight * ratio), maxSidePad);
};

const rectsLookLeftoverPortraitOrigin = (rects, viewport) => {
  if (!Array.isArray(rects) || rects.length === 0 || !viewport) return false;
  const viewportLandscape = Number(viewport.width) > Number(viewport.height) + 8;
  if (!viewportLandscape) return false;
  return rects.every((rect) => (
    Number(rect?.x) <= 2
    && Number(rect?.y) < 40
    && Number(rect?.width) > 8
  ));
};

const createSearchTextMeasureLayer = (viewport) => {
  if (typeof document === 'undefined') return null;

  ensureTextLayerStyles();
  const container = document.createElement('div');
  // Same glyph-positioning contract as the live text layer. Without these
  // pdf.js CSS vars, TextLayer.render() stacks spans at the origin and Search
  // paints leftover portrait marks (x=0,y≈20) into the swapped viewBox.
  container.className = 'pdfjsTextLayer textLayer search-text-measurement-layer';
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${viewport.width}px`,
    height: `${viewport.height}px`,
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '-1',
    contain: 'layout style paint',
    overflow: 'hidden',
    inset: 'auto'
  });
  container.style.setProperty('--scale-factor', String(viewport.scale || 1));
  document.body.appendChild(container);
  return container;
};

const cleanupTextLayerMeasurement = (pageData) => {
  const measurement = pageData?.textLayerMeasurement;
  if (!measurement) return;
  try {
    measurement.task?.cancel?.();
  } catch {
    // The task may already be complete.
  }
  measurement.container?.remove?.();
  pageData.textLayerMeasurement = null;
  pageData.textLayerMeasurementPromise = null;
};

const cleanupTextLayerMeasurements = (cache) => {
  if (!cache) return;
  for (const pageData of cache.values()) {
    cleanupTextLayerMeasurement(pageData);
  }
};

const waitForSearchTextFonts = async () => {
  if (typeof document === 'undefined' || !document.fonts?.ready) return;
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise(resolve => setTimeout(resolve, 180))
    ]);
  } catch {
    // Font readiness is best-effort; PDF.js still provides a fallback layout.
  }
};

const waitForSearchTextLayout = async () => {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  await new Promise(resolve => window.requestAnimationFrame(resolve));
};

const withSearchTextMeasurementTimeout = (promise) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    reject(new Error('Timed out measuring PDF text layer'));
  }, TEXT_LAYER_MEASUREMENT_TIMEOUT_MS);

  promise.then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      clearTimeout(timer);
      reject(error);
    }
  );
});

const normalizeSearchTextMeasurementDivStyles = (textDivs) => {
  textDivs.forEach((textDiv) => {
    if (!textDiv?.style) return;
    textDiv.style.position = 'absolute';
    textDiv.style.whiteSpace = 'pre';
    textDiv.style.transformOrigin = '0% 0%';
    textDiv.style.color = 'transparent';
  });
};

const getTextNodeForMeasurementDiv = (textDiv) => {
  if (!textDiv) return null;
  for (const node of textDiv.childNodes) {
    if (node.nodeType === 3) {
      return node;
    }
  }
  return null;
};

const getPageImageHost = (pageNumber) => {
  if (typeof document === 'undefined') return null;
  const pageIndex = Number(pageNumber) - 1;
  if (!Number.isFinite(pageIndex) || pageIndex < 0) return null;

  const pageHost =
    document.querySelector(`.survey-pdfjs-page-div[id$="_pageDiv_${pageIndex}"]`) ||
    Array.from(document.querySelectorAll('.survey-pdfjs-page-div')).find((node) => {
      const pageAttr = node.getAttribute('data-page-number') || node.getAttribute('aria-label') || '';
      return pageAttr === String(pageNumber);
    }) ||
    Array.from(document.querySelectorAll('.survey-pdfjs-page-div'))[pageIndex] ||
    null;

  if (!pageHost) return null;
  const pageImage = Array.from(pageHost.querySelectorAll('img')).find((img) => (
    img?.complete &&
    img.naturalWidth > 0 &&
    img.naturalHeight > 0 &&
    (img.alt === `Page ${pageNumber}` || img.getBoundingClientRect().width > 100)
  ));

  return pageImage || null;
};

const getRenderedPageImageCanvas = (image) => {
  if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) {
    return null;
  }

  const cached = renderedPageImageCanvasCache.get(image);
  const cacheKey = `${image.currentSrc || image.src || ''}:${image.naturalWidth}x${image.naturalHeight}`;
  if (cached?.cacheKey === cacheKey && cached.ctx) {
    return cached;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const entry = { canvas, ctx, cacheKey };
    renderedPageImageCanvasCache.set(image, entry);
    return entry;
  } catch {
    return null;
  }
};

const readDominantSearchTextBackground = (data, width, height) => {
  const buckets = new Map();
  const step = Math.max(4, Math.floor(Math.sqrt((width * height) / 2400)));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      if (alpha < 12) continue;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const key = `${r >> TEXT_LAYER_INK_SCAN_BUCKET_SHIFT}:${g >> TEXT_LAYER_INK_SCAN_BUCKET_SHIFT}:${b >> TEXT_LAYER_INK_SCAN_BUCKET_SHIFT}`;
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
  }

  let dominant = null;
  for (const bucket of buckets.values()) {
    if (!dominant || bucket.count > dominant.count) {
      dominant = bucket;
    }
  }

  if (!dominant?.count) {
    return null;
  }

  return {
    r: dominant.r / dominant.count,
    g: dominant.g / dominant.count,
    b: dominant.b / dominant.count
  };
};

const isSearchTextInkPixel = (data, index, background) => {
  const alpha = data[index + 3];
  if (alpha < 18 || !background) return false;
  const dr = data[index] - background.r;
  const dg = data[index + 1] - background.g;
  const db = data[index + 2] - background.b;
  return Math.sqrt((dr * dr) + (dg * dg) + (db * db)) >= TEXT_LAYER_INK_SCAN_THRESHOLD;
};

const collectSearchTextInkComponents = (mask, width, height) => {
  const components = [];
  const stack = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1) continue;

    mask[start] = 0;
    stack.push(start);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let pixels = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixels += 1;

      for (let dy = -1; dy <= 1; dy += 1) {
        const nextY = y + dy;
        if (nextY < 0 || nextY >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          if (nextX < 0 || nextX >= width) continue;
          const nextIndex = nextY * width + nextX;
          if (mask[nextIndex] !== 1) continue;
          mask[nextIndex] = 0;
          stack.push(nextIndex);
        }
      }
    }

    if (pixels >= TEXT_LAYER_INK_SCAN_MIN_PIXELS) {
      components.push({
        left: minX,
        top: minY,
        right: maxX + 1,
        bottom: maxY + 1,
        pixels
      });
    }
  }

  return components;
};

const resolveSearchTextInkSelectionRect = (rect) => {
  const selectionRect = rect?.selectionRect;
  if (
    selectionRect &&
    Number.isFinite(Number(selectionRect.x)) &&
    Number.isFinite(Number(selectionRect.y)) &&
    Number(selectionRect.width) > TEXT_LAYER_GEOMETRY_MIN_RECT_SIZE &&
    Number(selectionRect.height) > TEXT_LAYER_GEOMETRY_MIN_RECT_SIZE
  ) {
    return {
      x: Number(selectionRect.x),
      y: Number(selectionRect.y),
      width: Number(selectionRect.width),
      height: Number(selectionRect.height)
    };
  }

  return rect;
};

const mergeSearchTextRectBounds = (primaryRect, secondaryRect) => {
  if (!secondaryRect || secondaryRect === primaryRect) return primaryRect;
  const left = Math.min(primaryRect.x, secondaryRect.x);
  const top = Math.min(primaryRect.y, secondaryRect.y);
  const right = Math.max(primaryRect.x + primaryRect.width, secondaryRect.x + secondaryRect.width);
  const bottom = Math.max(primaryRect.y + primaryRect.height, secondaryRect.y + secondaryRect.height);

  return {
    x: left,
    y: top,
    width: Math.max(right - left, TEXT_LAYER_GEOMETRY_MIN_RECT_SIZE),
    height: Math.max(bottom - top, TEXT_LAYER_GEOMETRY_MIN_RECT_SIZE)
  };
};

const isSearchTextInkComponentInsideRange = (component, expectedRect, selectionPadX, selectionPadY) => {
  const centerX = (component.left + component.right) / 2;
  const centerY = (component.top + component.bottom) / 2;
  const componentWidth = Math.max(component.right - component.left, 1);
  const componentHeight = Math.max(component.bottom - component.top, 1);
  const overlapX = Math.max(
    0,
    Math.min(component.right, expectedRect.right) - Math.max(component.left, expectedRect.left)
  );
  const overlapY = Math.max(
    0,
    Math.min(component.bottom, expectedRect.bottom + selectionPadY) -
      Math.max(component.top, expectedRect.top - selectionPadY)
  );
  const centerInsideX = centerX >= expectedRect.left - selectionPadX && centerX <= expectedRect.right + selectionPadX;
  const centerInsideY = centerY >= expectedRect.top - selectionPadY && centerY <= expectedRect.bottom + selectionPadY;
  const mostlyInsideX = overlapX / componentWidth >= 0.62;
  const meaningfullyOnLine = overlapY / componentHeight >= 0.28;

  return (centerInsideX && centerInsideY) || (mostlyInsideX && meaningfullyOnLine);
};

const refineTextRectWithRenderedInk = ({
  rect,
  pageData,
  pageNumber,
  pageImageEntry
}) => {
  if (!rect || !pageData?.viewport || !pageImageEntry?.ctx || !pageImageEntry?.canvas) {
    return rect;
  }

  const viewportWidth = Number(pageData.viewport.width) || 0;
  const viewportHeight = Number(pageData.viewport.height) || 0;
  const imageWidth = pageImageEntry.canvas.width;
  const imageHeight = pageImageEntry.canvas.height;
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return rect;
  }

  const xScale = imageWidth / viewportWidth;
  const yScale = imageHeight / viewportHeight;
  const selectionRect = resolveSearchTextInkSelectionRect(rect);
  const scanRect = mergeSearchTextRectBounds(rect, selectionRect);
  const scanPad = Math.min(
    TEXT_LAYER_INK_SCAN_MAX_PAD,
    Math.max(TEXT_LAYER_INK_SCAN_MIN_PAD, scanRect.height * TEXT_LAYER_INK_SCAN_PAD_RATIO)
  );
  const scanLeft = Math.max(0, scanRect.x - scanPad);
  const scanTop = Math.max(0, scanRect.y - scanPad);
  const scanRight = Math.min(viewportWidth, scanRect.x + scanRect.width + scanPad);
  const scanBottom = Math.min(viewportHeight, scanRect.y + scanRect.height + scanPad);

  const cropX = Math.floor(scanLeft * xScale);
  const cropY = Math.floor(scanTop * yScale);
  const cropRight = Math.ceil(scanRight * xScale);
  const cropBottom = Math.ceil(scanBottom * yScale);
  const cropWidth = Math.max(1, Math.min(imageWidth - cropX, cropRight - cropX));
  const cropHeight = Math.max(1, Math.min(imageHeight - cropY, cropBottom - cropY));

  if (cropWidth <= 1 || cropHeight <= 1 || cropWidth * cropHeight > TEXT_LAYER_INK_SCAN_MAX_PIXELS) {
    return rect;
  }

  try {
    const imageData = pageImageEntry.ctx.getImageData(cropX, cropY, cropWidth, cropHeight);
    const background = readDominantSearchTextBackground(imageData.data, cropWidth, cropHeight);
    if (!background) return rect;

    const mask = new Uint8Array(cropWidth * cropHeight);

    for (let y = 0; y < cropHeight; y += 1) {
      for (let x = 0; x < cropWidth; x += 1) {
        const index = (y * cropWidth + x) * 4;
        if (!isSearchTextInkPixel(imageData.data, index, background)) continue;
        mask[y * cropWidth + x] = 1;
      }
    }

    const expectedRect = {
      left: (selectionRect.x * xScale) - cropX,
      top: (selectionRect.y * yScale) - cropY,
      right: ((selectionRect.x + selectionRect.width) * xScale) - cropX,
      bottom: ((selectionRect.y + selectionRect.height) * yScale) - cropY
    };
    const selectionPadX = TEXT_LAYER_INK_COMPONENT_SELECTION_PAD;
    const selectionPadY = Math.max(
      TEXT_LAYER_INK_COMPONENT_SELECTION_PAD,
      rect.height * yScale * 0.22
    );
    const components = collectSearchTextInkComponents(mask, cropWidth, cropHeight);
    const selectedComponents = components.filter((component) => (
      isSearchTextInkComponentInsideRange(component, expectedRect, selectionPadX, selectionPadY)
    ));

    if (selectedComponents.length === 0) {
      return rect;
    }

    const minX = Math.min(...selectedComponents.map((component) => component.left));
    const minY = Math.min(...selectedComponents.map((component) => component.top));
    const maxX = Math.max(...selectedComponents.map((component) => component.right));
    const maxY = Math.max(...selectedComponents.map((component) => component.bottom));
    const inkPixels = selectedComponents.reduce((sum, component) => sum + component.pixels, 0);
    const tightLeft = (cropX + minX) / xScale;
    const tightTop = (cropY + minY) / yScale;
    const tightRight = (cropX + maxX) / xScale;
    const tightBottom = (cropY + maxY) / yScale;
    const inkOverhangX = Math.max(0.45, Math.min(1.6, selectionRect.height * 0.07));
    const guardedTightLeft = Math.max(tightLeft, selectionRect.x - inkOverhangX);
    const guardedTightRight = Math.min(tightRight, selectionRect.x + selectionRect.width + inkOverhangX);
    const visualPadX = Math.max(0.32, Math.min(1.1, rect.height * 0.045));
    const visualPadY = Math.max(0.32, Math.min(1.1, rect.height * 0.045));
    const refinedLeft = Math.max(0, guardedTightLeft - visualPadX);
    const refinedTop = Math.max(0, tightTop - visualPadY);
    const refinedRight = Math.min(viewportWidth, guardedTightRight + visualPadX);
    const refinedBottom = Math.min(viewportHeight, tightBottom + visualPadY);
    const refinedWidth = refinedRight - refinedLeft;
    const refinedHeight = refinedBottom - refinedTop;

    if (refinedWidth <= TEXT_LAYER_GEOMETRY_MIN_RECT_SIZE || refinedHeight < TEXT_LAYER_INK_SCAN_MIN_HEIGHT) {
      return rect;
    }

    const { selectionRect: _selectionRect, ...baseRect } = rect;

    return {
      ...baseRect,
      x: refinedLeft,
      y: refinedTop,
      width: refinedWidth,
      height: refinedHeight,
      geometryMethod: 'text-layer-image-ink',
      baseGeometryMethod: rect.geometryMethod,
      inkPixels,
      inkScan: {
        pageNumber,
        cropWidth,
        cropHeight,
        componentCount: components.length,
        selectedComponentCount: selectedComponents.length,
        background: {
          r: Math.round(background.r),
          g: Math.round(background.g),
          b: Math.round(background.b)
        }
      }
    };
  } catch {
    return rect;
  }
};

const ensureTextLayerMeasurement = async (pageData) => {
  if (!pageData?.textContent || !pageData?.viewport || typeof document === 'undefined') {
    return null;
  }
  if (pageData.textLayerMeasurement) {
    return pageData.textLayerMeasurement;
  }
  if (pageData.textLayerMeasurementPromise) {
    return pageData.textLayerMeasurementPromise;
  }
  if (typeof pdfjsLib.TextLayer !== 'function') {
    return null;
  }

  pageData.textLayerMeasurementPromise = (async () => {
    const container = createSearchTextMeasureLayer(pageData.viewport);
    if (!container) return null;

    const task = new pdfjsLib.TextLayer({
      textContentSource: pageData.textContent,
      container,
      viewport: pageData.viewport
    });

    try {
      await withSearchTextMeasurementTimeout(task.render());
      const textDivs = Array.from(task.textDivs || []);
      normalizeSearchTextMeasurementDivStyles(textDivs);
      await waitForSearchTextFonts();
      await waitForSearchTextLayout();
      pageData.textLayerMeasurement = {
        container,
        task,
        textDivs,
        textContentItemsStr: Array.from(task.textContentItemsStr || [])
      };
      return pageData.textLayerMeasurement;
    } catch (error) {
      task.cancel?.();
      container.remove();
      pageData.textLayerMeasurement = null;
      pageData.textLayerMeasurementPromise = null;
      throw error;
    }
  })();

  return pageData.textLayerMeasurementPromise;
};

const buildTextLayerRectanglesForMatch = async (pageData, matchStart, matchLength, pageNumber) => {
  let measurement = null;
  try {
    measurement = await ensureTextLayerMeasurement(pageData);
  } catch (error) {
    console.warn('[SearchTextPanel] Text-layer measurement unavailable; using metric bounds fallback:', error);
    return [];
  }
  if (!measurement?.container || !Array.isArray(measurement.textDivs)) {
    return [];
  }

  const matchEnd = matchStart + matchLength;
  const containerRect = measurement.container.getBoundingClientRect();
  const rectangles = [];
  const pageImageEntry = getRenderedPageImageCanvas(getPageImageHost(pageNumber));
  const selectionRects = buildRectanglesForMatch(pageData, matchStart, matchLength);
  let selectionRectIndex = 0;

  for (const rangeInfo of pageData.ranges || []) {
    if (rangeInfo.end <= matchStart) continue;
    if (rangeInfo.start >= matchEnd) break;

    const textDiv = measurement.textDivs[rangeInfo.textDivIndex];
    const textNode = getTextNodeForMeasurementDiv(textDiv);
    if (!textNode) continue;

    const overlapStart = Math.max(rangeInfo.start, matchStart);
    const overlapEnd = Math.min(rangeInfo.end, matchEnd);
    const relativeStart = overlapStart - rangeInfo.start;
    const relativeEnd = overlapEnd - rangeInfo.start;
    if (relativeEnd <= relativeStart) continue;
    const segmentContext = resolveTextSegmentContext(
      textNode.textContent || '',
      relativeStart,
      relativeEnd - relativeStart
    );
    const selectionRect = selectionRects[selectionRectIndex] || null;
    selectionRectIndex += 1;

    const domRange = document.createRange();
    try {
      domRange.setStart(textNode, relativeStart);
      domRange.setEnd(textNode, relativeEnd);
      const clientRects = Array.from(domRange.getClientRects());

      clientRects.forEach((rect) => {
        const width = rect.width;
        const height = rect.height;
        if (width <= TEXT_LAYER_GEOMETRY_MIN_RECT_SIZE || height <= TEXT_LAYER_GEOMETRY_MIN_RECT_SIZE) {
          return;
        }

        const baseRect = {
          x: Math.max(0, rect.left - containerRect.left),
          y: Math.max(0, rect.top - containerRect.top),
          width,
          height,
          geometryMethod: 'text-layer-range',
          matchText: textNode.textContent?.slice(relativeStart, relativeEnd) || '',
          textDivIndex: rangeInfo.textDivIndex,
          fontFamily: textDiv.style.fontFamily || undefined,
          fontSize: textDiv.style.fontSize || undefined,
          transform: textDiv.style.transform || undefined,
          startsAtBoundary: segmentContext.startsAtBoundary,
          endsAtBoundary: segmentContext.endsAtBoundary,
          previousChar: segmentContext.previousChar,
          nextChar: segmentContext.nextChar,
          selectionRect
        };

        rectangles.push(refineTextRectWithRenderedInk({
          rect: baseRect,
          pageData,
          pageNumber,
          segmentContext,
          pageImageEntry
        }));
      });
    } finally {
      domRange.detach?.();
    }
  }

  return rectangles;
};

const resolveTextSegmentAdvance = ({
  textItem,
  styles,
  itemWidth,
  fontHeight,
  glyphCount,
  relativeStart,
  relativeLength
}) => {
  const fallbackScale = itemWidth / glyphCount;
  const fallback = {
    start: fallbackScale * relativeStart,
    width: Math.max(fallbackScale * relativeLength, 2),
    method: 'average'
  };

  const itemText = textItem?.str || '';
  if (!itemText || relativeStart < 0 || relativeLength <= 0) {
    return fallback;
  }

  const ctx = getSearchTextMeasureContext();
  const style = styles?.[textItem.fontName] || {};
  const fontFamily = getSearchTextFontFamily(style, textItem);
  const fontSize = Math.max(1, Number(fontHeight) || 12);
  const font = `${fontSize}px ${fontFamily}`;
  const fullWidth = measureSearchTextWidth(ctx, font, itemText);

  if (!fullWidth) {
    return fallback;
  }

  const prefixText = itemText.slice(0, relativeStart);
  const matchText = itemText.slice(relativeStart, relativeStart + relativeLength);
  const prefixWidth = prefixText ? measureSearchTextWidth(ctx, font, prefixText) : 0;
  const segmentEndText = itemText.slice(0, relativeStart + relativeLength);
  const segmentEndWidth = measureSearchTextWidth(ctx, font, segmentEndText);
  const matchWidth = Number.isFinite(segmentEndWidth)
    ? segmentEndWidth - prefixWidth
    : measureSearchTextWidth(ctx, font, matchText);

  if (!Number.isFinite(prefixWidth) || !Number.isFinite(matchWidth) || matchWidth <= 0) {
    return fallback;
  }

  const startRatio = Math.max(0, Math.min(prefixWidth / fullWidth, 1));
  const widthRatio = Math.max(0, Math.min(matchWidth / fullWidth, 1 - startRatio));

  return {
    start: itemWidth * startRatio,
    width: Math.max(itemWidth * widthRatio, 2),
    method: 'canvas-ratio',
    matchText,
    itemTextLength: itemText.length,
    measuredFullWidth: Math.round(fullWidth * 100) / 100,
    measuredMatchWidth: Math.round(matchWidth * 100) / 100,
    measuredEndWidth: Number.isFinite(segmentEndWidth)
      ? Math.round(segmentEndWidth * 100) / 100
      : undefined,
    startRatio: Math.round(startRatio * 10000) / 10000,
    widthRatio: Math.round(widthRatio * 10000) / 10000
  };
};

const getPdfDocumentKey = (pdfDoc, numPages, explicitKey) => {
  const stableExplicitKey = typeof explicitKey === 'string' ? explicitKey.trim() : '';
  if (stableExplicitKey) {
    return `explicit:${stableExplicitKey}`;
  }

  if (!pdfDoc) return null;

  const pdfInfo = pdfDoc?._pdfInfo || {};
  const fingerprints = pdfDoc.fingerprints || pdfInfo.fingerprints;
  if (Array.isArray(fingerprints) && fingerprints.some(Boolean)) {
    return `fingerprints:${fingerprints.filter(Boolean).join(':')}`;
  }

  const fingerprint = pdfDoc.fingerprint || pdfInfo.fingerprint;
  if (fingerprint) {
    return `fingerprint:${fingerprint}`;
  }

  const docId =
    pdfDoc.loadingTask?.docId ||
    pdfDoc._transport?.docId ||
    pdfDoc._transport?.messageHandler?.sourceName;
  if (docId) {
    return `doc:${docId}`;
  }

  const pageCount = Number(numPages) || Number(pdfDoc.numPages) || 0;
  return `pages:${pageCount}`;
};

// Create snippet with context around match
const createSnippet = (text, start, end, radius = 60) => {
  if (!text || typeof text !== 'string') {
    return { snippet: '', matchIndex: -1 };
  }
  const snippetStart = Math.max(0, start - radius);
  const snippetEnd = Math.min(text.length, end + radius);
  const prefix = snippetStart > 0 ? '...' : '';
  const suffix = snippetEnd < text.length ? '...' : '';
  const snippetText = `${prefix}${text.slice(snippetStart, snippetEnd)}${suffix}`;
  const highlightOffset = prefix ? 3 : 0;
  const matchIndex = highlightOffset + (start - snippetStart);
  return { snippet: snippetText, matchIndex };
};

// Build rectangles for a text match - converts character positions to visual coordinates
const buildRectanglesForMatch = (pageData, matchStart, matchLength) => {
  const { items, ranges, viewportTransform, styles } = pageData;
  if (!items || !ranges || !viewportTransform) {
    return [];
  }

  const matchEnd = matchStart + matchLength;
  const rects = [];

  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i];
    if (range.end <= matchStart) continue;
    if (range.start >= matchEnd) break;

    const textItem = items[range.itemIndex];
    if (!textItem || !textItem.str || !textItem.transform) continue;

    const overlapStart = Math.max(range.start, matchStart);
    const overlapEnd = Math.min(range.end, matchEnd);
    const relativeStart = overlapStart - range.start;
    const relativeLength = overlapEnd - overlapStart;
    if (relativeLength <= 0) continue;

    const transformed = pdfjsLib.Util.transform(viewportTransform, textItem.transform);
    const glyphCount = Math.max(textItem.str.length, 1);
    const itemWidth = clampValue(textItem.width, Math.hypot(clampValue(transformed[0]), clampValue(transformed[1])) || glyphCount * 2);
    const vectorHeight = Math.hypot(clampValue(transformed[2]), clampValue(transformed[3]));
    const itemHeight = clampValue(textItem.height, 0);
    const fontHeight = itemHeight > 0
      ? itemHeight
      : (vectorHeight || clampValue(textItem.fontSize, 12) || 12);
    const topPad = Math.max(0.35, fontHeight * TEXT_HIGHLIGHT_TOP_PAD_RATIO);
    const bottomPad = Math.max(1, fontHeight * TEXT_HIGHLIGHT_BOTTOM_PAD_RATIO);
    const segmentContext = resolveTextSegmentContext(textItem.str, relativeStart, relativeLength);
    const leftPad = segmentContext.startsAtBoundary
      ? resolveTextHighlightPad(fontHeight, TEXT_HIGHLIGHT_BOUNDARY_LEFT_PAD_RATIO, 0.25)
      : resolveTextHighlightPad(fontHeight, TEXT_HIGHLIGHT_INTERNAL_LEFT_PAD_RATIO, 0.08);
    const rightPad = segmentContext.endsAtBoundary
      ? resolveTextHighlightPad(fontHeight, TEXT_HIGHLIGHT_BOUNDARY_RIGHT_PAD_RATIO, 0.75)
      : resolveTextHighlightPad(fontHeight, TEXT_HIGHLIGHT_INTERNAL_RIGHT_PAD_RATIO, 0.12);

    const baseLeft = transformed[4];
    const baseTop = transformed[5] - (fontHeight * TEXT_HIGHLIGHT_ASCENT_RATIO) - topPad;
    const segmentAdvance = resolveTextSegmentAdvance({
      textItem,
      styles,
      itemWidth,
      fontHeight,
      glyphCount,
      relativeStart,
      relativeLength
    });

    const rectLeft = baseLeft + segmentAdvance.start;
    const rectWidth = Math.max(segmentAdvance.width, 2);
    const paddedLeft = Math.max(0, rectLeft - leftPad);
    const appliedLeftPad = rectLeft - paddedLeft;

    rects.push({
      x: paddedLeft,
      y: baseTop,
      width: rectWidth + appliedLeftPad + rightPad,
      height: Math.max(fontHeight + topPad + bottomPad, TEXT_HIGHLIGHT_MIN_HEIGHT),
      geometryMethod: segmentAdvance.method,
      matchText: segmentAdvance.matchText,
      itemTextLength: segmentAdvance.itemTextLength,
      measuredFullWidth: segmentAdvance.measuredFullWidth,
      measuredMatchWidth: segmentAdvance.measuredMatchWidth,
      measuredEndWidth: segmentAdvance.measuredEndWidth,
      startRatio: segmentAdvance.startRatio,
      widthRatio: segmentAdvance.widthRatio,
      baseWidth: Math.round(rectWidth * 100) / 100,
      leftPad: Math.round(leftPad * 100) / 100,
      rightPad: Math.round(rightPad * 100) / 100,
      startsAtBoundary: segmentContext.startsAtBoundary,
      endsAtBoundary: segmentContext.endsAtBoundary,
      nextChar: segmentContext.nextChar
    });
  }

  return rects;
};

// Calculate bounding box for all rectangles of a match
const calculateMatchBounds = (rectangles) => {
  if (!rectangles || rectangles.length === 0) {
    return null;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const rect of rectangles) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
};

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeNativeRect = (value) => {
  if (!value || typeof value !== 'object') return null;

  const x = toFiniteNumber(value.x ?? value.left ?? value.Left ?? value.X);
  const y = toFiniteNumber(value.y ?? value.top ?? value.Top ?? value.Y);
  const width = toFiniteNumber(value.width ?? value.Width ?? (
    value.right !== undefined && x !== null ? Number(value.right) - x : undefined
  ));
  const height = toFiniteNumber(value.height ?? value.Height ?? (
    value.bottom !== undefined && y !== null ? Number(value.bottom) - y : undefined
  ));

  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
};

const normalizeNativePageNumber = (value, fallback = null) => {
  const pageNumber = toFiniteNumber(
    value?.pageNumber ??
    value?.PageNumber ??
    value?.page ??
    value?.Page ??
    fallback
  );
  if (pageNumber !== null && pageNumber > 0) {
    return Math.floor(pageNumber);
  }

  const pageIndex = toFiniteNumber(value?.pageIndex ?? value?.PageIndex);
  if (pageIndex !== null && pageIndex >= 0) {
    return Math.floor(pageIndex) + 1;
  }

  return fallback && fallback > 0 ? Math.floor(fallback) : null;
};

const collectNativeTextMatches = (rawResults) => {
  const byPage = new Map();

  const addMatch = (pageNumber, rectangles) => {
    if (!pageNumber || !Array.isArray(rectangles) || rectangles.length === 0) return;
    const normalizedRects = rectangles.map(normalizeNativeRect).filter(Boolean);
    if (normalizedRects.length === 0) return;
    const matches = byPage.get(pageNumber) || [];
    matches.push({
      rectangles: normalizedRects,
      bounds: calculateMatchBounds(normalizedRects)
    });
    byPage.set(pageNumber, matches);
  };

  const visit = (value, contextPage = null) => {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, contextPage));
      return;
    }

    if (typeof value !== 'object') return;

    const pageNumber = normalizeNativePageNumber(value, contextPage);
    const directBounds =
      value.bounds ??
      value.Bounds ??
      value.textBounds ??
      value.TextBounds ??
      value.rectangle ??
      value.Rectangle ??
      value.rect ??
      value.Rect ??
      null;

    if (directBounds) {
      addMatch(pageNumber, Array.isArray(directBounds) ? directBounds : [directBounds]);
      return;
    }

    const directRect = normalizeNativeRect(value);
    if (directRect) {
      addMatch(pageNumber, [directRect]);
      return;
    }

    Object.entries(value).forEach(([key, child]) => {
      const keyPageNumber = /^\d+$/.test(key) ? Number(key) : pageNumber;
      visit(child, keyPageNumber || contextPage);
    });
  };

  visit(rawResults);
  return byPage;
};

// Pure: wraps the matched substring in a highlight. Hoisted to module scope so
// it isn't reallocated per render and can be shared by the memoized row below.
const highlightMatch = (text, matchIndex, queryLength) => {
  if (matchIndex < 0 || !text) return text;
  const beforeMatch = text.substring(0, matchIndex);
  const match = text.substring(matchIndex, matchIndex + queryLength);
  const afterMatch = text.substring(matchIndex + queryLength);
  return (
    <>
      {beforeMatch}
      <strong style={{ background: '#d8a84e', color: '#15110a', padding: '0 2px', borderRadius: '2px' }}>{match}</strong>
      {afterMatch}
    </>
  );
};

// One row of the results list. Memoized so that navigating between matches
// (which only flips `isActive` on two rows) re-renders just those rows instead
// of every row in a large result set.
const SearchResultRow = memo(function SearchResultRow({ result, index, isActive, queryLength, onSelect }) {
  return (
    <div
      data-result-index={index}
      onClick={() => onSelect(result, index)}
      style={{
        padding: '10px 12px',
        background: isActive ? '#3a5070' : '#181c24',
        border: isActive ? '1px solid #d8a84e' : '1px solid #2a3140',
        borderRadius: '6px',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        fontSize: '12px',
        color: '#e8e2d4',
        // Off-screen result rows skip layout/paint on big searches.
        // 'auto' lets the browser remember each row's real height.
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 56px'
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = '#2a3140';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = '#181c24';
        }
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: '4px',
        gap: '8px'
      }}>
        <span style={{
          fontSize: '10px',
          fontWeight: '600',
          color: '#f4f1ea',
          background: isActive ? '#d8a84e' : '#5a6473',
          padding: '2px 6px',
          borderRadius: '4px',
          minWidth: '20px',
          textAlign: 'center'
        }}>
          {index + 1}
        </span>
        <span style={{
          fontSize: '11px',
          fontWeight: '600',
          color: '#d8a84e',
          background: 'rgba(216, 168, 78, 0.15)',
          padding: '2px 6px',
          borderRadius: '4px'
        }}>
          Page {result.pageNumber}
        </span>
      </div>
      <div style={{
        fontSize: '12px',
        lineHeight: '1.4',
        color: '#8d96a6',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}>
        {highlightMatch(result.snippet, result.snippetMatchIndex, queryLength)}
      </div>
    </div>
  );
});

const SearchTextPanel = ({
  pdfDoc,
  numPages,
  onNavigateToPage,
  onNavigateToMatch,
  onFindTextMatches,
  onClearTextSearch,
  searchResults: externalSearchResults,
  currentMatchIndex: externalCurrentMatchIndex,
  onSearchResultsChange,
  onCurrentMatchIndexChange,
  isActive = true,
  focusRequestToken = 0,
  selectOnFocus = false,
  pdfDocumentKey = null,
  mobileMode = false
}) => {
  // KAL-65: sidebar controls use the app's instant shared tooltip, never a
  // native title= (the OS tooltip takes ~1.5s and is OS-styled, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  // Internal state for standalone use
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const [internalSearchResults, setInternalSearchResults] = useState([]);
  const [internalCurrentMatchIndex, setInternalCurrentMatchIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState({ current: 0, total: 0 });
  const searchInputRef = useRef(null);
  const resultsContainerRef = useRef(null);
  const pageDataCacheRef = useRef(new Map());
  const searchIdRef = useRef(0);
  const lastHandledFocusTokenRef = useRef(null);
  const documentKeyRef = useRef(null);
  const searchResultsRef = useRef([]);
  const currentMatchIndexRef = useRef(-1);
  const lastSearchQueryRef = useRef('');
  const lastPerformedSearchKeyRef = useRef('');

  // Use external state if provided, otherwise use internal state
  const searchResults = externalSearchResults !== undefined ? externalSearchResults : internalSearchResults;
  const currentMatchIndex = externalCurrentMatchIndex !== undefined ? externalCurrentMatchIndex : internalCurrentMatchIndex;
  const resolvedDocumentKey = useMemo(
    () => getPdfDocumentKey(pdfDoc, numPages, pdfDocumentKey),
    [pdfDoc, numPages, pdfDocumentKey]
  );

  useEffect(() => {
    searchResultsRef.current = Array.isArray(searchResults) ? searchResults : [];
  }, [searchResults]);

  useEffect(() => {
    currentMatchIndexRef.current = Number.isFinite(currentMatchIndex) ? currentMatchIndex : -1;
  }, [currentMatchIndex]);

  const setSearchResults = useCallback((results, reason = 'update') => {
    const safeResults = Array.isArray(results) ? results : [];
    const previousCount = searchResultsRef.current.length;
    const shouldLog =
      reason !== 'progressive' ||
      previousCount === 0 ||
      safeResults.length === 0 ||
      safeResults.length < previousCount;

    if (shouldLog && previousCount !== safeResults.length) {
      emitTextSearchDiag('results_change', {
        reason,
        previousCount,
        nextCount: safeResults.length,
        query: lastSearchQueryRef.current,
        documentKey: documentKeyRef.current
      });
    }

    searchResultsRef.current = safeResults;
    if (onSearchResultsChange) {
      onSearchResultsChange(safeResults);
    } else {
      setInternalSearchResults(safeResults);
    }
  }, [onSearchResultsChange]);

  const setCurrentMatchIndex = useCallback((index, reason = 'update') => {
    if (currentMatchIndexRef.current !== index) {
      emitTextSearchDiag('current_match_change', {
        reason,
        previousIndex: currentMatchIndexRef.current,
        nextIndex: index,
        resultCount: searchResultsRef.current.length,
        query: lastSearchQueryRef.current,
        documentKey: documentKeyRef.current
      });
    }
    currentMatchIndexRef.current = index;
    if (onCurrentMatchIndexChange) {
      onCurrentMatchIndexChange(index);
    } else {
      setInternalCurrentMatchIndex(index);
    }
  }, [onCurrentMatchIndexChange]);

  // Reset only when the actual document changes. The viewer may refresh the PDF
  // object during zoom/navigation; that must not dismiss an active search.
  useEffect(() => {
    const previousDocumentKey = documentKeyRef.current;

    if (!resolvedDocumentKey) {
      if (previousDocumentKey && (lastSearchQueryRef.current || searchResultsRef.current.length > 0)) {
        emitTextSearchDiag('document_temporarily_missing_preserve_search', {
          previousDocumentKey,
          query: lastSearchQueryRef.current,
          resultCount: searchResultsRef.current.length,
          currentMatchIndex: currentMatchIndexRef.current
        });
      }
      return;
    }

    if (!previousDocumentKey) {
      documentKeyRef.current = resolvedDocumentKey;
      emitTextSearchDiag('document_key_ready', {
        documentKey: resolvedDocumentKey,
        numPages
      });
      return;
    }

    if (previousDocumentKey === resolvedDocumentKey) {
      return;
    }

    documentKeyRef.current = resolvedDocumentKey;
    lastPerformedSearchKeyRef.current = '';
    searchIdRef.current += 1;
    cleanupTextLayerMeasurements(pageDataCacheRef.current);
    pageDataCacheRef.current.clear();
    emitTextSearchDiag('document_key_changed_clear_search', {
      previousDocumentKey,
      nextDocumentKey: resolvedDocumentKey,
      query: lastSearchQueryRef.current,
      previousResultCount: searchResultsRef.current.length
    });
    setSearchResults([], 'document-key-change');
    setCurrentMatchIndex(-1, 'document-key-change');
    setInternalSearchQuery('');
    onClearTextSearch?.();
  }, [resolvedDocumentKey, numPages, setSearchResults, setCurrentMatchIndex, onClearTextSearch]);

  useEffect(() => (
    () => {
      cleanupTextLayerMeasurements(pageDataCacheRef.current);
    }
  ), []);

  useEffect(() => {
    if (!isActive || !searchInputRef.current) {
      return undefined;
    }
    if (!Number.isFinite(focusRequestToken) || focusRequestToken <= 0) {
      return undefined;
    }
    if (focusRequestToken === lastHandledFocusTokenRef.current) {
      return undefined;
    }

    lastHandledFocusTokenRef.current = focusRequestToken;
    let retryTimer = null;

    const focusInput = () => {
      const input = searchInputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      if (selectOnFocus) {
        input.select();
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(() => {
        focusInput();
        // Retry after sidebar expansion/layout in case initial focus lands too early.
        retryTimer = window.setTimeout(focusInput, 140);
      });
      return () => {
        window.cancelAnimationFrame(frame);
        if (retryTimer !== null) {
          window.clearTimeout(retryTimer);
        }
      };
    }

    const timer = setTimeout(() => {
      focusInput();
      retryTimer = setTimeout(focusInput, 140);
    }, 0);
    return () => {
      clearTimeout(timer);
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
    };
  }, [focusRequestToken, isActive, selectOnFocus]);

  // Load page text data with caching
  const loadPageData = useCallback(async (pageNumber) => {
    if (!pdfDoc) return null;

    // Check cache first. After CW the overlay viewBox flips before pdf.js
    // always rebakes /Rotate; drop leftover portrait viewports so marks
    // are remade against the live landscape host.
    if (pageDataCacheRef.current.has(pageNumber)) {
      const cached = pageDataCacheRef.current.get(pageNumber);
      if (viewportMatchesLiveHost(cached?.viewport, pageNumber)) {
        return cached;
      }
      cleanupTextLayerMeasurement(cached);
      pageDataCacheRef.current.delete(pageNumber);
    }

    try {
      const page = await pdfDoc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const viewport = resolveSearchPageViewport(page, pageNumber);

      let fullText = '';
      const ranges = [];
      let textDivIndex = 0;

      (textContent.items || []).forEach((item, index) => {
        if (typeof item?.str !== 'string') return;
        const str = item.str || '';
        const currentTextDivIndex = textDivIndex;
        textDivIndex += 1;
        if (!str) return;

        const start = fullText.length;
        fullText += str;
        ranges.push({
          start,
          end: start + str.length,
          itemIndex: index,
          textDivIndex: currentTextDivIndex
        });
      });

      const data = {
        text: fullText,
        textContent,
        items: textContent.items || [],
        styles: textContent.styles || {},
        ranges,
        viewport,
        viewportTransform: viewport.transform,
        textLayerMeasurement: null,
        textLayerMeasurementPromise: null
      };

      // Cache the result
      pageDataCacheRef.current.set(pageNumber, data);
      return data;
    } catch (error) {
      console.error(`Error loading page ${pageNumber} text data:`, error);
      return null;
    }
  }, [pdfDoc]);

  // Pre-cache pages in background
  useEffect(() => {
    if (!pdfDoc) return;

    let cancelled = false;

    const preCachePages = async () => {
      const batchSize = 5;
      for (let i = 1; i <= numPages; i += batchSize) {
        if (cancelled) break;
        const batch = [];
        for (let j = i; j < Math.min(i + batchSize, numPages + 1); j++) {
          if (!pageDataCacheRef.current.has(j)) {
            batch.push(loadPageData(j));
          }
        }
        if (batch.length > 0) {
          await Promise.all(batch);
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    };

    const timer = setTimeout(preCachePages, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdfDoc, numPages, loadPageData]);

  // Optimized search function
  const performSearch = useCallback(async (query) => {
    const trimmedQuery = (query || '').trim();
    lastSearchQueryRef.current = trimmedQuery;

    if (!trimmedQuery) {
      emitTextSearchDiag('search_clear_empty_query', {
        previousResultCount: searchResultsRef.current.length,
        previousIndex: currentMatchIndexRef.current,
        documentKey: documentKeyRef.current
      });
      setSearchResults([], 'empty-query');
      setCurrentMatchIndex(-1, 'empty-query');
      setIsSearching(false);
      setSearchProgress({ current: 0, total: 0 });
      onClearTextSearch?.();
      return [];
    }

    if (!pdfDoc) {
      emitTextSearchDiag('search_preserved_missing_pdf_doc', {
        query: trimmedQuery,
        existingResultCount: searchResultsRef.current.length,
        currentMatchIndex: currentMatchIndexRef.current,
        documentKey: documentKeyRef.current
      });
      setIsSearching(false);
      setSearchProgress({ current: 0, total: 0 });
      return searchResultsRef.current;
    }

    const searchId = ++searchIdRef.current;
    emitTextSearchDiag('search_start', {
      query: trimmedQuery,
      searchId,
      numPages,
      documentKey: documentKeyRef.current
    });
    setIsSearching(true);
    setSearchProgress({ current: 0, total: numPages });

    const normalizedQuery = trimmedQuery.toLowerCase();
    const results = [];
    const nativeMatchOffsetsByPage = new Map();
    let nativeMatchesByPage = null;

    if (typeof onFindTextMatches === 'function') {
      try {
        const nativeResults = await onFindTextMatches(trimmedQuery);
        if (searchIdRef.current !== searchId) return [];
        nativeMatchesByPage = collectNativeTextMatches(nativeResults);
      } catch (error) {
        console.warn('[SearchTextPanel] Native text search bounds unavailable:', error);
      }
    }

    try {
      for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
        if (searchIdRef.current !== searchId) return results;

        const pageData = await loadPageData(pageNumber);
        if (!pageData || !pageData.text) continue;

        const normalizedText = pageData.text.toLowerCase();
        let searchIndex = normalizedText.indexOf(normalizedQuery);

        while (searchIndex !== -1) {
          const nativePageMatches = nativeMatchesByPage?.get(pageNumber) || [];
          const nativeMatchIndex = nativeMatchOffsetsByPage.get(pageNumber) || 0;
          const nativeMatch = nativePageMatches[nativeMatchIndex] || null;
          nativeMatchOffsetsByPage.set(pageNumber, nativeMatchIndex + 1);

          const { snippet, matchIndex } = createSnippet(
            pageData.text,
            searchIndex,
            searchIndex + normalizedQuery.length
          );
          const textLayerRectangles = nativeMatch?.rectangles?.length
            ? []
            : await buildTextLayerRectanglesForMatch(pageData, searchIndex, normalizedQuery.length, pageNumber);
          const estimatedRectangles = buildRectanglesForMatch(pageData, searchIndex, normalizedQuery.length);
          const leftoverMeasured = rectsLookLeftoverPortraitOrigin(textLayerRectangles, pageData.viewport);
          const rectangles = nativeMatch?.rectangles?.length
            ? nativeMatch.rectangles
            : ((textLayerRectangles.length && !leftoverMeasured)
              ? textLayerRectangles
              : estimatedRectangles);
          const bounds = nativeMatch?.bounds || calculateMatchBounds(rectangles);
          const geometrySource = nativeMatch?.rectangles?.length
            ? 'native'
            : (leftoverMeasured
              ? 'pdfjs-estimate-after-leftover'
              : (textLayerRectangles.some((rect) => rect.geometryMethod === 'text-layer-image-ink')
                ? 'pdfjs-text-layer-ink'
                : (textLayerRectangles.length ? 'pdfjs-text-layer' : 'pdfjs-estimate')));

          results.push({
            id: createResultId(),
            pageNumber,
            startIndex: searchIndex,
            length: normalizedQuery.length,
            snippet,
            snippetMatchIndex: matchIndex,
            rectangles,
            bounds,
            geometrySource
          });

          searchIndex = normalizedText.indexOf(normalizedQuery, searchIndex + 1);
        }

        setSearchProgress({ current: pageNumber, total: numPages });

        // Progressive results update
        if (pageNumber % 3 === 0 || pageNumber === numPages) {
          if (searchIdRef.current === searchId) {
            setSearchResults([...results], 'progressive');
          }
        }
      }

      if (searchIdRef.current === searchId) {
        setSearchResults(results, 'search-complete');
        setCurrentMatchIndex(results.length > 0 ? 0 : -1, 'search-complete');
        setIsSearching(false);
        const totalRectangles = results.reduce(
          (sum, result) => sum + (Array.isArray(result.rectangles) ? result.rectangles.length : 0),
          0
        );
        const geometrySources = results.reduce((acc, result) => {
          const source = result.geometrySource || 'unknown';
          acc[source] = (acc[source] || 0) + 1;
          return acc;
        }, {});
        emitTextSearchDiag('search_geometry_complete', {
          query: trimmedQuery,
          searchId,
          resultCount: results.length,
          totalRectangles,
          geometrySources,
          firstResult: results[0] ? {
            pageNumber: results[0].pageNumber,
            bounds: results[0].bounds,
            firstRectangle: Array.isArray(results[0].rectangles) ? results[0].rectangles[0] : null,
            geometrySource: results[0].geometrySource || 'unknown'
          } : null,
          documentKey: documentKeyRef.current
        });
        emitTextSearchDiag('search_complete', {
          query: trimmedQuery,
          searchId,
          resultCount: results.length,
          documentKey: documentKeyRef.current
        });
      }

      return results;
    } catch (error) {
      console.error('Search error:', error);
      setIsSearching(false);
      return results;
    }
  }, [pdfDoc, numPages, loadPageData, onFindTextMatches, onClearTextSearch, setSearchResults, setCurrentMatchIndex]);

  // Debounced search
  useEffect(() => {
    const trimmedQuery = (internalSearchQuery || '').trim();
    const nextSearchKey = `${resolvedDocumentKey || 'missing'}::${trimmedQuery}`;
    if (nextSearchKey === lastPerformedSearchKeyRef.current) {
      return undefined;
    }

    const timer = setTimeout(() => {
      lastPerformedSearchKeyRef.current = nextSearchKey;
      performSearch(internalSearchQuery);
    }, 200);

    return () => clearTimeout(timer);
  }, [internalSearchQuery, performSearch, resolvedDocumentKey]);

  // Navigate to match and trigger callback
  const navigateToMatch = useCallback((index) => {
    if (index < 0 || index >= searchResults.length) return;

    emitTextSearchDiag('match_navigate_request', {
      index,
      resultCount: searchResults.length,
      pageNumber: searchResults[index]?.pageNumber,
      query: lastSearchQueryRef.current,
      documentKey: documentKeyRef.current
    });
    setCurrentMatchIndex(index, 'navigate');
    const result = searchResults[index];

    if (onNavigateToMatch) {
      onNavigateToMatch(result, index);
    } else if (onNavigateToPage) {
      onNavigateToPage(result.pageNumber);
    }
  }, [searchResults, setCurrentMatchIndex, onNavigateToMatch, onNavigateToPage]);

  // Go to next match
  const goToNextMatch = useCallback(() => {
    if (searchResults.length === 0) return;
    const nextIndex = currentMatchIndex < searchResults.length - 1
      ? currentMatchIndex + 1
      : 0;
    navigateToMatch(nextIndex);
  }, [searchResults, currentMatchIndex, navigateToMatch]);

  // Go to previous match
  const goToPrevMatch = useCallback(() => {
    if (searchResults.length === 0) return;
    const prevIndex = currentMatchIndex > 0
      ? currentMatchIndex - 1
      : searchResults.length - 1;
    navigateToMatch(prevIndex);
  }, [searchResults, currentMatchIndex, navigateToMatch]);

  // Handle result click
  const handleResultClick = useCallback((result, index) => {
    navigateToMatch(index);
  }, [navigateToMatch]);

  // Scroll selected result into view in the list
  useEffect(() => {
    if (currentMatchIndex >= 0 && resultsContainerRef.current) {
      const selectedElement = resultsContainerRef.current.querySelector(`[data-result-index="${currentMatchIndex}"]`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [currentMatchIndex]);

  // Keyboard shortcuts. The next/prev callbacks change on every match-index or
  // result-set change, so we reach them through refs (written during render)
  // and bind the document listener ONCE instead of tearing it down and
  // rebinding it on every keystroke of a live search.
  const clearSearchRef = useRef(null);
  const goToNextMatchRef = useRef(goToNextMatch);
  goToNextMatchRef.current = goToNextMatch;
  const goToPrevMatchRef = useRef(goToPrevMatch);
  goToPrevMatchRef.current = goToPrevMatch;
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!searchInputRef.current) return;

      // Only handle shortcuts when search input is focused or has results
      const isInputFocused = document.activeElement === searchInputRef.current;

      if (e.key === 'Enter' && isInputFocused) {
        e.preventDefault();
        if (e.shiftKey) {
          goToPrevMatchRef.current();
        } else {
          goToNextMatchRef.current();
        }
      }

      // F3 or Cmd/Ctrl+G for next/prev (common search shortcuts)
      const isCmdOrCtrlG = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'g';
      if (e.key === 'F3' || isCmdOrCtrlG) {
        e.preventDefault();
        if (e.shiftKey) {
          goToPrevMatchRef.current();
        } else {
          goToNextMatchRef.current();
        }
      }

      // Esc clears the search, but only while the search input is focused so it
      // never swallows Escape used elsewhere in the app.
      if (e.key === 'Escape' && isInputFocused) {
        e.preventDefault();
        clearSearchRef.current?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const clearSearch = useCallback(() => {
    emitTextSearchDiag('search_clear_button', {
      previousResultCount: searchResultsRef.current.length,
      previousIndex: currentMatchIndexRef.current,
      query: lastSearchQueryRef.current,
      documentKey: documentKeyRef.current
    });
    lastSearchQueryRef.current = '';
    lastPerformedSearchKeyRef.current = '';
    setInternalSearchQuery('');
    setSearchResults([], 'clear-button');
    setCurrentMatchIndex(-1, 'clear-button');
    onClearTextSearch?.();
    searchInputRef.current?.focus();
  }, [onClearTextSearch, setSearchResults, setCurrentMatchIndex]);

  // Keep the latest clearSearch reachable from the keydown listener above
  // (which is declared earlier in render order) without re-binding the listener.
  useEffect(() => {
    clearSearchRef.current = clearSearch;
  }, [clearSearch]);

  return (
    <div className={mobileMode ? 'mobile-search-panel' : undefined} style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: FONT_FAMILY,
      background: '#12151c'
    }}>
      {/* Search Bar */}
      <div className={mobileMode ? 'mobile-search-panel__bar' : undefined} style={{
        padding: '12px',
        boxSizing: 'border-box',
        background: '#12151c',
        borderBottom: '1px solid #2a3140',
        flexShrink: 0
      }}>
        <div style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center'
        }}>
          <Icon
            name="search"
            size={16}
            color="#8d96a6"
            style={{
              position: 'absolute',
              left: '10px',
              pointerEvents: 'none'
            }}
          />
          <input
            ref={searchInputRef}
            type="text"
            value={internalSearchQuery}
            onChange={(e) => setInternalSearchQuery(e.target.value)}
            aria-label="Search text in PDF"
            placeholder={mobileMode ? 'Search text' : 'Search text in PDF...'}
            style={{
              width: '100%',
              height: '25px',
              boxSizing: 'border-box',
              padding: '0 10px 0 36px',
              background: '#181c24',
              border: '1px solid #2a3140',
              borderRadius: '6px',
              fontSize: '13px',
              fontFamily: FONT_FAMILY,
              color: '#e8e2d4',
              outline: 'none',
              transition: 'border-color 0.15s ease'
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = '#d8a84e'}
            onBlur={(e) => e.currentTarget.style.borderColor = '#2a3140'}
          />
          {internalSearchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              style={{
                position: 'absolute',
                right: '8px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#2a3140'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Icon name="close" size={14} color="#8d96a6" />
            </button>
          )}
        </div>

        {/* Navigation Controls - shown when there are results */}
        {searchResults.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '10px',
            padding: '6px 8px',
            background: '#181c24',
            borderRadius: '6px',
            border: '1px solid #2a3140'
          }}>
            {/* Result Counter */}
            <div style={{
              fontSize: '12px',
              color: '#e8e2d4',
              fontWeight: '500'
            }}>
              {currentMatchIndex >= 0 ? (
                <span>
                  <span style={{ color: '#d8a84e' }}>{currentMatchIndex + 1}</span>
                  <span style={{ color: '#8d96a6' }}> of </span>
                  <span style={{ color: '#d8a84e' }}>{searchResults.length}</span>
                </span>
              ) : (
                <span style={{ color: '#8d96a6' }}>{searchResults.length} results</span>
              )}
            </div>

            {/* Navigation Buttons */}
            <div style={{
              display: 'flex',
              gap: '4px'
            }}>
              <button
                type="button"
                onClick={goToPrevMatch}
                disabled={searchResults.length === 0}
                {...tip('Previous match (Shift+Enter)', 'below')}
                aria-label="Previous match (Shift+Enter)"
                style={{
                  background: 'transparent',
                  border: '1px solid #2a3140',
                  borderRadius: '4px',
                  cursor: searchResults.length > 0 ? 'pointer' : 'not-allowed',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: searchResults.length > 0 ? 1 : 0.5
                }}
                onMouseEnter={(e) => {
                  tip('Previous match (Shift+Enter)', 'below').onMouseEnter(e);
                  if (searchResults.length > 0) e.currentTarget.style.background = '#2a3140';
                }}
                onMouseLeave={(e) => {
                  tip('Previous match (Shift+Enter)', 'below').onMouseLeave(e);
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <Icon name="chevronUp" size={14} color="#e8e2d4" />
              </button>
              <button
                type="button"
                onClick={goToNextMatch}
                disabled={searchResults.length === 0}
                {...tip('Next match (Enter)', 'below')}
                aria-label="Next match (Enter)"
                style={{
                  background: 'transparent',
                  border: '1px solid #2a3140',
                  borderRadius: '4px',
                  cursor: searchResults.length > 0 ? 'pointer' : 'not-allowed',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: searchResults.length > 0 ? 1 : 0.5
                }}
                onMouseEnter={(e) => {
                  tip('Next match (Enter)', 'below').onMouseEnter(e);
                  if (searchResults.length > 0) e.currentTarget.style.background = '#2a3140';
                }}
                onMouseLeave={(e) => {
                  tip('Next match (Enter)', 'below').onMouseLeave(e);
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <Icon name="chevronDown" size={14} color="#e8e2d4" />
              </button>
            </div>
          </div>
        )}

        {/* Search Progress */}
        {isSearching && searchProgress.total > 0 && (
          <div style={{
            marginTop: '8px',
            height: '3px',
            background: '#2a3140',
            borderRadius: '2px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${(searchProgress.current / searchProgress.total) * 100}%`,
              height: '100%',
              background: '#d8a84e',
              transition: 'width 0.1s ease'
            }} />
          </div>
        )}
      </div>

      {/* Search Results */}
      <div
        ref={resultsContainerRef}
        className={mobileMode ? 'mobile-search-panel__results' : undefined}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px'
        }}
      >
        {isSearching && (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#8d96a6',
            fontSize: '13px'
          }}>
            Searching... ({searchProgress.current}/{searchProgress.total} pages)
          </div>
        )}

        {!isSearching && internalSearchQuery && searchResults.length === 0 && (
          mobileMode ? (
            <div className="mobile-search-empty">
              <Icon name="search" size={44} color="#58d976" />
              <strong>No text matches</strong>
              <span>Try another word from the PDF.</span>
            </div>
          ) : (
            <div style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: '#8d96a6',
              fontSize: '13px'
            }}>
              No results found
            </div>
          )
        )}

        {!isSearching && !internalSearchQuery && (
          mobileMode ? (
            <div className="mobile-search-empty">
              <Icon name="search" size={54} color="#58d976" />
              <strong>Looking for a specific word?</strong>
              <span>Search visible PDF text and jump to the matching page.</span>
            </div>
          ) : (
            <div style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: '#8d96a6',
              fontSize: '13px'
            }}>
              Enter a search term to find text in the PDF
            </div>
          )
        )}

        {!isSearching && searchResults.length > 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}>
            {searchResults.map((result, index) => (
              <SearchResultRow
                key={result.id}
                result={result}
                index={index}
                isActive={index === currentMatchIndex}
                queryLength={internalSearchQuery.length}
                onSelect={handleResultClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchTextPanel;
