/**
 * Pure helpers for PagesPanel thumbnail cache, black-frame detection,
 * and filtered-space reorder gating. Kept out of the JSX module so Node
 * tests can import them directly.
 */

export function getPdfDocumentCacheStamp(pdfDoc) {
  if (!pdfDoc || typeof pdfDoc !== 'object') return null;
  const fingerprints = pdfDoc.fingerprints;
  if (Array.isArray(fingerprints) && fingerprints[0]) return String(fingerprints[0]);
  if (pdfDoc.fingerprint) return String(pdfDoc.fingerprint);
  return null;
}

export function buildPagesPanelThumbKey({
  stamp,
  pageNumber,
  quality = 'fast',
  revision = 0,
} = {}) {
  if (!stamp || !Number.isFinite(pageNumber) || pageNumber < 1) return null;
  const q = quality === 'crisp' ? 'crisp' : 'fast';
  const rev = Number.isFinite(Number(revision)) ? Number(revision) : 0;
  return `pages-panel::${stamp}::${pageNumber}::${q}::r${rev}`;
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
