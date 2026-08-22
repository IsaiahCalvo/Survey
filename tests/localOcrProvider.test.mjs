import test from 'node:test';
import assert from 'node:assert/strict';
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

test('scan detection rejects empty PDF text and accepts usable text', () => {
  assert.equal(hasUsableEmbeddedText({ items: [{ str: ' ' }] }), false);
  assert.equal(hasUsableEmbeddedText({ items: [{ str: 'A' }, { str: 'B' }] }), true);
});

test('OCR cache key covers document, page, language, and engine version', () => {
  assert.equal(buildOcrCacheKey({ documentFingerprint: 'abc', pageNumber: 3, language: 'ara', engineVersion: 'v2' }), 'abc:3:ara:v2');
});

test('OCR page cache survives reload and rejects stale engine data', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const result = { words: [{ text: 'Local' }], engineVersion: 'tesseract-js-7-eng-v1' };
  assert.equal(saveCachedOcrResult('doc:1:eng:v1', result, storage), true);
  assert.deepEqual(loadCachedOcrResult('doc:1:eng:v1', storage), result);
  values.set('survey:ocr:stale', JSON.stringify({ words: [], engineVersion: 'old' }));
  assert.equal(loadCachedOcrResult('stale', storage), null);
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

test('built-in Tesseract provider lazy loads, reports progress, and terminates', async () => {
  const events = [];
  let terminated = 0;
  const provider = createTesseractOcrProvider(async () => ({
    OEM: { LSTM_ONLY: 1 },
    createWorker: async (_language, _oem, options) => ({
      recognize: async () => {
        options.logger({ status: 'recognizing text', progress: 0.6 });
        return { data: { text: 'Local', blocks: [] } };
      },
      terminate: async () => { terminated += 1; },
    }),
  }));
  const result = await provider.recognize({
    image: { pixels: true },
    language: 'eng',
    onProgress: (event) => events.push(event),
  });
  assert.equal(result.text, 'Local');
  assert.deepEqual(events, [{ phase: 'recognizing text', progress: 0.6 }]);
  assert.equal(terminated, 1);
});
