// Pages-panel click contract. Extracted so Node can prove jump vs mobile
// multi-select without mounting the thumbnail rail.

import { resolveTextLayerRotation } from '../utils/pdfjsTextLayerViewport.js';

export function resolvePageThumbnailClick({
  pageNumber,
  numPages,
  mobileMode = false,
  mobileSelectMode = false,
} = {}) {
  const page = Number.parseInt(pageNumber, 10);
  if (!Number.isInteger(page) || page < 1) return { kind: 'ignore' };
  if (Number.isInteger(numPages) && numPages > 0 && page > numPages) {
    return { kind: 'ignore' };
  }
  if (mobileMode && mobileSelectMode) {
    return { kind: 'toggle-select', pageNumber: page };
  }
  return { kind: 'navigate', pageNumber: page };
}

export function isPagesPanelEmpty(numPages) {
  return !Number.isInteger(numPages) || numPages < 1;
}

export function getPdfDocumentCacheStamp(pdfDoc) {
  if (!pdfDoc || typeof pdfDoc !== 'object') return null;
  const fingerprints = pdfDoc.fingerprints;
  if (Array.isArray(fingerprints) && fingerprints[0]) return String(fingerprints[0]);
  if (pdfDoc.fingerprint) return String(pdfDoc.fingerprint);
  return null;
}

// Same host-aspect contract as the text layer / Search marks. After Pages CW
// the live `.survey-pdfjs-page-div` is landscape while a leftover pdf.js
// proxy (or rotate-blind IDB thumb) can still be 612×792.
export function resolvePagesPanelThumbRotation({
  pageRotate = 0,
  hostWidth = 0,
  hostHeight = 0,
  intrinsicWidth = 0,
  intrinsicHeight = 0,
} = {}) {
  return resolveTextLayerRotation(
    pageRotate,
    0,
    hostWidth,
    hostHeight,
    intrinsicWidth,
    intrinsicHeight,
  );
}

export function buildPagesPanelThumbKey({
  stamp,
  pageNumber,
  quality = 'fast',
  revision = 0,
  rotate = 0,
} = {}) {
  if (!stamp || !Number.isFinite(pageNumber) || pageNumber < 1) return null;
  const q = quality === 'crisp' ? 'crisp' : 'fast';
  const rev = Number.isFinite(Number(revision)) ? Number(revision) : 0;
  const rot = ((Number(rotate) % 360) + 360) % 360;
  return `pages-panel::${stamp}::${pageNumber}::${q}::rot${rot}::r${rev}`;
}

export function isLikelyBlackThumbnailPixels(data, width, height) {
  if (!data || !data.length || !Number.isFinite(width) || !Number.isFinite(height)) {
    return false;
  }
  if (width <= 0 || height <= 0) return false;

  const totalPixels = width * height;
  let opaquePixels = 0;
  let darkOpaquePixels = 0;
  let minLuminance = 255;
  let maxLuminance = 0;

  for (let offset = 0; offset < data.length; offset += 4) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    if (luminance < minLuminance) minLuminance = luminance;
    if (luminance > maxLuminance) maxLuminance = luminance;
    if (a >= 220) {
      opaquePixels += 1;
      if (luminance <= 12) {
        darkOpaquePixels += 1;
      }
    }
  }

  const opaqueRatio = opaquePixels / totalPixels;
  const darkOpaqueRatio = opaquePixels > 0 ? (darkOpaquePixels / opaquePixels) : 0;
  const contrast = maxLuminance - minLuminance;
  return opaqueRatio >= 0.9 && darkOpaqueRatio >= 0.94 && contrast <= 10;
}

export function canReorderVisiblePages({ allowedPages, numPages } = {}) {
  if (!Array.isArray(allowedPages) || !Number.isFinite(numPages) || numPages < 1) {
    return false;
  }
  if (allowedPages.length !== numPages) return false;
  return allowedPages.every((page, index) => page === index + 1);
}
