import { mapOcrBoxToPage } from './pdfTextMarkup.js';

export const OCR_ENGINE_VERSION = 'tesseract-js-7-eng-v1';
export const OCR_ENGINE_NAME = 'Tesseract.js 7';
export const OCR_ENGINE_LICENSE = 'Apache-2.0';

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
  if (provider && typeof provider.recognize === 'function') return provider;
  return createTesseractOcrProvider();
}

export function extractTesseractWords(data) {
  const words = [];
  for (const block of data?.blocks || []) {
    for (const paragraph of block?.paragraphs || []) {
      for (const line of paragraph?.lines || []) {
        for (const word of line?.words || []) {
          const bbox = word?.bbox;
          if (!word?.text?.trim() || !bbox) continue;
          words.push({
            text: word.text,
            confidence: word.confidence,
            box: {
              x: Number(bbox.x0),
              y: Number(bbox.y0),
              width: Number(bbox.x1) - Number(bbox.x0),
              height: Number(bbox.y1) - Number(bbox.y0),
            },
          });
        }
      }
    }
  }
  return words;
}

export function createTesseractOcrProvider(loadModule = () => import('tesseract.js')) {
  return {
    id: OCR_ENGINE_VERSION,
    name: OCR_ENGINE_NAME,
    license: OCR_ENGINE_LICENSE,
    async recognize({ image, language = 'eng', signal, onProgress }) {
      let worker = null;
      let terminateRequested = false;
      let terminatePromise = null;
      const terminate = () => {
        terminateRequested = true;
        if (worker && !terminatePromise) terminatePromise = worker.terminate();
      };
      signal?.addEventListener?.('abort', terminate, { once: true });
      try {
        if (signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError');
        const module = await loadModule();
        const api = module?.createWorker ? module : module?.default;
        if (!api?.createWorker) throw new Error('Tesseract.js failed to load.');
        worker = await api.createWorker(language, api.OEM?.LSTM_ONLY ?? 1, {
          logger: (message) => onProgress?.({
            phase: message?.status || 'recognizing',
            progress: Number.isFinite(Number(message?.progress)) ? Number(message.progress) : 0,
          }),
        });
        if (terminateRequested || signal?.aborted) {
          if (!terminatePromise) terminatePromise = worker.terminate();
          await terminatePromise;
          throw new DOMException('OCR cancelled', 'AbortError');
        }
        const result = await worker.recognize(image, {}, { text: true, blocks: true });
        if (signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError');
        return {
          words: extractTesseractWords(result?.data),
          text: String(result?.data?.text || ''),
          engineVersion: OCR_ENGINE_VERSION,
        };
      } finally {
        signal?.removeEventListener?.('abort', terminate);
        if (worker) {
          if (!terminatePromise) terminatePromise = worker.terminate();
          await terminatePromise;
        }
      }
    },
  };
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
