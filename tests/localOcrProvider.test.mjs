import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  buildOcrCacheKey,
  createTesseractOcrProvider,
  extractTesseractWords,
  hasUsableEmbeddedText,
  loadCachedOcrResult,
  normalizeOcrResult,
  recognizePageLocally,
  saveCachedOcrResult,
} from '../src/utils/localOcrProvider.js';
import { createTextMarkupAnnotation } from '../src/utils/pdfTextMarkup.js';

const createStorage = () => {
  const values = new Map();
  return {
    values,
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('bundled English OCR data matches the pinned language file', async () => {
  const languageData = await readFile(new URL('../public/ocr/eng.traineddata.gz', import.meta.url));
  assert.equal(languageData.length, 2_952_873);
  assert.equal(
    createHash('sha256').update(languageData).digest('hex'),
    '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',
  );
});

test('scan detection rejects empty PDF text and accepts usable text', () => {
  assert.equal(hasUsableEmbeddedText({ items: [{ str: ' ' }] }), false);
  assert.equal(hasUsableEmbeddedText({ items: [{ str: 'A' }, { str: 'B' }] }), true);
});

test('OCR cache key covers document, page, language, and engine version', () => {
  assert.equal(buildOcrCacheKey({ documentFingerprint: 'abc', pageNumber: 3, language: 'ara', engineVersion: 'v2' }), 'abc:3:ara:v2');
});

test('OCR page cache survives reload and rejects stale engine data', () => {
  const storage = createStorage();
  const result = { words: [{ text: 'Local' }], engineVersion: 'tesseract-js-7-eng-v1' };
  assert.equal(saveCachedOcrResult('doc:1:eng:v1', result, storage), true);
  assert.deepEqual(loadCachedOcrResult('doc:1:eng:v1', storage), result);
  storage.values.set('survey:ocr:stale', JSON.stringify({ words: [], engineVersion: 'old' }));
  assert.equal(loadCachedOcrResult('stale', storage), null);
});

test('OCR page cache evicts the oldest entries to stay within its byte budget', () => {
  const storage = createStorage();
  const result = (text) => ({ words: [{ text }], text, engineVersion: 'tesseract-js-7-eng-v1' });
  const budget = 1_100;
  assert.equal(saveCachedOcrResult('oldest', result('a'.repeat(120)), storage, budget), true);
  assert.equal(saveCachedOcrResult('middle', result('b'.repeat(120)), storage, budget), true);
  assert.equal(saveCachedOcrResult('newest', result('c'.repeat(120)), storage, budget), true);
  assert.equal(loadCachedOcrResult('oldest', storage), null);
  assert.deepEqual(loadCachedOcrResult('newest', storage), result('c'.repeat(120)));
  const storedBytes = [...storage.values].reduce((total, [key, value]) => total + ((key.length + value.length) * 2), 0);
  assert.ok(storedBytes <= budget, `${storedBytes} bytes exceeds ${budget}`);
});

test('OCR cache evicts oldest data and retries once after a quota write failure', () => {
  const storage = createStorage();
  storage.values.set('survey:ocr:old', JSON.stringify({
    cachedAt: 1,
    result: { words: [], engineVersion: 'tesseract-js-7-eng-v1' },
  }));
  let attempts = 0;
  storage.setItem = (key, value) => {
    attempts += 1;
    if (attempts === 1) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    storage.values.set(key, value);
  };
  const result = { words: [{ text: 'new' }], engineVersion: 'tesseract-js-7-eng-v1' };
  assert.equal(saveCachedOcrResult('new', result, storage), true);
  assert.equal(attempts, 2);
  assert.equal(storage.getItem('survey:ocr:old'), null);
  assert.deepEqual(loadCachedOcrResult('new', storage), result);
});

test('OCR words map to page quads with confidence', () => {
  const result = normalizeOcrResult({ words: [{ text: 'hello', confidence: 92, box: { x: 10, y: 20, width: 30, height: 10 } }] }, {
    sourceSize: { width: 100, height: 100 }, pageSize: { width: 600, height: 800 },
  });
  assert.equal(result.words[0].confidence, 0.92);
  assert.deepEqual(result.words[0].quad, { x1: 60, y1: 160, x2: 240, y2: 160, x3: 60, y3: 240, x4: 240, y4: 240 });
});

test('provider boundary reports progress, supports cancellation, and never uploads', async () => {
  const calls = [];
  const provider = { recognize: async (request) => { calls.push(request); return { words: [] }; } };
  const progress = [];
  await recognizePageLocally({
    provider, image: { localPixels: true }, onProgress: (state) => progress.push(state),
    mapping: { sourceSize: { width: 1, height: 1 }, pageSize: { width: 1, height: 1 } },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].image.localPixels, true);
  assert.deepEqual(progress.map((item) => item.phase), ['recognizing', 'complete']);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => recognizePageLocally({ provider, signal: controller.signal }), { name: 'AbortError' });
});

test('missing engine has a stable provider state', async () => {
  await assert.rejects(() => recognizePageLocally({ provider: null }), { code: 'OCR_ENGINE_UNAVAILABLE' });
});

test('Tesseract blocks become words with boxes and confidence', () => {
  assert.deepEqual(extractTesseractWords({ blocks: [{ paragraphs: [{ lines: [{ words: [{
    text: 'Scan', confidence: 96, bbox: { x0: 4, y0: 6, x1: 24, y1: 18 },
  }] }] }] }] }), [{
    text: 'Scan', confidence: 96, box: { x: 4, y: 6, width: 20, height: 12 },
  }]);
});

test('built-in Tesseract words map into all four text markup records', async () => {
  const events = [];
  let terminated = 0;
  let workerOptions;
  const provider = createTesseractOcrProvider(async () => ({
    OEM: { LSTM_ONLY: 1 },
    createWorker: async (_language, _oem, options) => {
      workerOptions = options;
      return ({
      recognize: async () => {
        options.logger({ status: 'recognizing text', progress: 0.6 });
        return { data: { text: 'Local OCR', blocks: [{ paragraphs: [{ lines: [{ words: [
          { text: 'Local', confidence: 97, bbox: { x0: 10, y0: 20, x1: 50, y1: 40 } },
          { text: 'OCR', confidence: 95, bbox: { x0: 55, y0: 20, x1: 85, y1: 40 } },
        ] }] }] }] } };
      },
      terminate: async () => { terminated += 1; },
      });
    },
  }), async () => ({
    workerPath: 'https://app.local/assets/ocr-worker.js',
    corePath: 'https://app.local/assets/ocr-core.wasm.js',
    langPath: 'https://app.local/ocr',
  }));
  const result = await provider.recognize({
    image: { pixels: true },
    language: 'eng',
    onProgress: (event) => events.push(event),
  });
  assert.equal(result.text, 'Local OCR');
  const normalized = normalizeOcrResult(result, {
    sourceSize: { width: 100, height: 100 },
    pageSize: { width: 600, height: 800 },
  });
  assert.equal(normalized.text, 'Local OCR');
  assert.equal(normalized.words.length, 2);
  const quads = normalized.words.map((word) => word.quad);
  for (const markupType of ['highlight', 'underline', 'squiggly', 'strikeout']) {
    const annotation = createTextMarkupAnnotation({
      id: `ocr-${markupType}`,
      pageNumber: 1,
      selectionGroupId: 'ocr-range',
      markupType,
      selectedText: normalized.text,
      quads,
    });
    assert.equal(annotation.data.markupType, markupType);
    assert.equal(annotation.data.selectedText, 'Local OCR');
    assert.equal(annotation.data.quads.length, 2);
  }
  assert.deepEqual(events, [{ phase: 'recognizing text', progress: 0.6 }]);
  assert.equal(terminated, 1);
  assert.equal(workerOptions.workerPath, 'https://app.local/assets/ocr-worker.js');
  assert.equal(workerOptions.corePath, 'https://app.local/assets/ocr-core.wasm.js');
  assert.equal(workerOptions.langPath, 'https://app.local/ocr');
  assert.equal(typeof workerOptions.errorHandler, 'function');
  assert.doesNotThrow(() => workerOptions.errorHandler('handled worker load error'));
});

test('Tesseract worker startup failures use a clear asset load error', async () => {
  const provider = createTesseractOcrProvider(async () => ({
    OEM: { LSTM_ONLY: 1 },
    createWorker: async () => { throw new Error('worker failed'); },
  }), async () => ({
    workerPath: 'https://app.local/assets/ocr-worker.js',
    corePath: 'https://app.local/assets/ocr-core.wasm.js',
    langPath: 'https://app.local/ocr',
  }));
  await assert.rejects(() => provider.recognize({ image: {} }), {
    code: 'OCR_ASSET_LOAD_FAILED',
    message: 'Text recognition assets failed to load.',
  });
});
