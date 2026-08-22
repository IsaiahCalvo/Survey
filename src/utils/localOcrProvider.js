import { mapOcrBoxToPage } from './pdfTextMarkup.js';

export const OCR_ENGINE_VERSION = 'survey-local-ocr-v1';

export function hasUsableEmbeddedText(textContent, minimumCharacters = 2) {
  const text = (textContent?.items || []).map((item) => String(item?.str || '')).join('').replace(/\s/g, '');
  return text.length >= minimumCharacters;
}

export function buildOcrCacheKey({ documentFingerprint, pageNumber, language = 'eng', engineVersion = OCR_ENGINE_VERSION }) {
  return [documentFingerprint || 'unknown', Number(pageNumber) || 0, language, engineVersion].join(':');
}

const storageKeyForCache = (cacheKey) => `survey:ocr:${cacheKey}`;

export function loadCachedOcrResult(cacheKey, storage = globalThis?.localStorage) {
  if (!cacheKey || !storage?.getItem) return null;
  try {
    const value = JSON.parse(storage.getItem(storageKeyForCache(cacheKey)) || 'null');
    return value?.engineVersion === OCR_ENGINE_VERSION && Array.isArray(value?.words) ? value : null;
  } catch {
    return null;
  }
}

export function saveCachedOcrResult(cacheKey, result, storage = globalThis?.localStorage) {
  if (!cacheKey || !storage?.setItem || !result) return false;
  try {
    storage.setItem(storageKeyForCache(cacheKey), JSON.stringify(result));
    return true;
  } catch {
    return false;
  }
}

export function normalizeOcrResult(result, { sourceSize, pageSize, rotation = 0 } = {}) {
  const words = (result?.words || []).map((word) => {
    const box = word.box || word.bbox;
    const quad = mapOcrBoxToPage(box, sourceSize, pageSize, rotation);
    if (!quad) return null;
    return {
      text: String(word.text || ''),
      confidence: Math.max(0, Math.min(1, Number(word.confidence) > 1 ? Number(word.confidence) / 100 : Number(word.confidence) || 0)),
      quad,
    };
  }).filter((word) => word && word.text.trim());
  return { words, text: words.map((word) => word.text).join(' '), engineVersion: result?.engineVersion || OCR_ENGINE_VERSION };
}

export function resolveLocalOcrProvider(globalObject = globalThis) {
  const provider = globalObject?.surveyElectron?.ocr || globalObject?.__surveyOcrProvider;
  if (!provider || typeof provider.recognize !== 'function') return null;
  return provider;
}

export async function recognizePageLocally({ provider, image, language = 'eng', signal, onProgress, mapping }) {
  if (!provider || typeof provider.recognize !== 'function') {
    const error = new Error('Local OCR engine is not installed in this build.');
    error.code = 'OCR_ENGINE_UNAVAILABLE';
    throw error;
  }
  if (signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError');
  onProgress?.({ phase: 'recognizing', progress: 0 });
  const result = await provider.recognize({ image, language, signal, onProgress });
  if (signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError');
  const normalized = normalizeOcrResult(result, mapping);
  onProgress?.({ phase: 'complete', progress: 1 });
  return normalized;
}
