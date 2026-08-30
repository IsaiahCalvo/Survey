import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('Text Select starts OCR only after the current page reports no embedded text', () => {
  const start = source.indexOf('// Text Select pays the OCR cost only when the user asks for text interaction.');
  assert.notEqual(start, -1, 'missing Text Select OCR effect');
  const effect = source.slice(start, start + 1_800);
  assert.match(effect, /if \(activeTool !== 'text-select'\) return/);
  assert.match(effect, /textAvailabilityByPage\[pageNum\] !== false/);
  assert.match(effect, /\['running', 'complete', 'cancelled', 'error'\]\.includes\(ocrStateByPage\[pageNum\]\?\.status\)/);
  assert.match(effect, /recognizeTextOnPage\(pageNum\)/);
});

test('OCR results use the document-page-language cache before starting recognition', () => {
  assert.match(source, /const cached = ocrCacheRef\.current\.get\(cacheKey\) \|\| loadCachedOcrResult\(cacheKey\)/);
  assert.match(source, /saveCachedOcrResult\(cacheKey, result\)/);
});
