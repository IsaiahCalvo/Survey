import { mapOcrBoxToPage } from './pdfTextMarkup.js';

export const OCR_ENGINE_VERSION = 'tesseract-js-7-eng-v1';
export const OCR_ENGINE_NAME = 'Tesseract.js 7';
export const OCR_ENGINE_LICENSE = 'Apache-2.0';
export const OCR_CACHE_BUDGET_BYTES = 3 * 1024 * 1024;

const OCR_CACHE_PREFIX = 'survey:ocr:';

export function hasUsableEmbeddedText(textContent, minimumCharacters = 2) {
  const text = (textContent?.items || []).map((item) => String(item?.str || '')).join('').replace(/\s/g, '');
  return text.length >= minimumCharacters;
}

export function buildOcrCacheKey({ documentFingerprint, pageNumber, language = 'eng', engineVersion = OCR_ENGINE_VERSION }) {
  return [documentFingerprint || 'unknown', Number(pageNumber) || 0, language, engineVersion].join(':');
}

const storageKeyForCache = (cacheKey) => `${OCR_CACHE_PREFIX}${cacheKey}`;
const storageBytes = (key, value) => (String(key).length + String(value).length) * 2;

const listCachedOcrEntries = (storage, excludedKey) => {
  if (!Number.isFinite(Number(storage?.length)) || typeof storage?.key !== 'function') return [];
  const entries = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(OCR_CACHE_PREFIX) || key === excludedKey) continue;
    const serialized = storage.getItem(key);
    if (serialized == null) continue;
    let cachedAt = 0;
    try { cachedAt = Number(JSON.parse(serialized)?.cachedAt) || 0; } catch { /* evict invalid legacy data first */ }
    entries.push({ key, bytes: storageBytes(key, serialized), cachedAt });
  }
  return entries.sort((left, right) => left.cachedAt - right.cachedAt);
};

export function loadCachedOcrResult(cacheKey, storage = globalThis?.localStorage) {
  if (!cacheKey || !storage?.getItem) return null;
  try {
    const value = JSON.parse(storage.getItem(storageKeyForCache(cacheKey)) || 'null');
    const result = value?.result || value;
    return result?.engineVersion === OCR_ENGINE_VERSION && Array.isArray(result?.words) ? result : null;
  } catch {
    return null;
  }
}

export function saveCachedOcrResult(cacheKey, result, storage = globalThis?.localStorage, budgetBytes = OCR_CACHE_BUDGET_BYTES) {
  if (!cacheKey || !storage?.setItem || !result) return false;
  const key = storageKeyForCache(cacheKey);
  const serialized = JSON.stringify({ cachedAt: Date.now(), result });
  const entryBytes = storageBytes(key, serialized);
  if (entryBytes > budgetBytes) return false;
  const entries = listCachedOcrEntries(storage, key);
  let totalBytes = entryBytes + entries.reduce((total, entry) => total + entry.bytes, 0);
  const remainingEntries = [];
  entries.forEach((entry) => {
    if (totalBytes > budgetBytes && storage?.removeItem) {
      storage.removeItem(entry.key);
      totalBytes -= entry.bytes;
    } else {
      remainingEntries.push(entry);
    }
  });
  try {
    storage.setItem(key, serialized);
    return true;
  } catch {
    if (!storage?.removeItem) return false;
    storage.removeItem(key);
    if (remainingEntries.length) storage.removeItem(remainingEntries[0].key);
    try {
      storage.setItem(key, serialized);
      return true;
    } catch {
      return false;
    }
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

async function loadBundledOcrAssets() {
  const [{ default: workerAsset }, { default: coreAsset }] = await Promise.all([
    import('tesseract.js/dist/worker.min.js?url'),
    import('tesseract.js-core/tesseract-core-lstm.wasm.js?url'),
  ]);
  const pageUrl = globalThis?.location?.href || import.meta.url;
  const appBaseUrl = new URL(import.meta.env.BASE_URL || './', pageUrl);
  return {
    workerPath: new URL(workerAsset, pageUrl).href,
    corePath: new URL(coreAsset, pageUrl).href,
    langPath: new URL('ocr', appBaseUrl).href.replace(/\/$/, ''),
  };
}

export function createTesseractOcrProvider(
  loadModule = () => import('tesseract.js'),
  loadAssets = loadBundledOcrAssets,
) {
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
        try {
          const [module, assetPaths] = await Promise.all([loadModule(), loadAssets()]);
          const api = module?.createWorker ? module : module?.default;
          if (!api?.createWorker) throw new Error('Tesseract.js failed to load.');
          worker = await api.createWorker(language, api.OEM?.LSTM_ONLY ?? 1, {
            ...assetPaths,
            logger: (message) => onProgress?.({
              phase: message?.status || 'recognizing',
              progress: Number.isFinite(Number(message?.progress)) ? Number(message.progress) : 0,
            }),
            // Tesseract also rejects its load promise. Supplying this hook stops
            // its message handler from throwing the same worker error again.
            errorHandler: () => {},
          });
        } catch (cause) {
          const error = new Error('Text recognition assets failed to load.', { cause });
          error.code = 'OCR_ASSET_LOAD_FAILED';
          throw error;
        }
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
