import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('PDF analytics records the first visibly rendered page once per document load', () => {
  assert.match(source, /handlePdfjsPageRenderComplete = useCallback\(\(payload\)/);
  assert.match(source, /payload\?\.pageNumber !== 1/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /survey_pdf_first_page_painted/);
  assert.match(source, /paintState\.reported = true/);
});
