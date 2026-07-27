import { expect, test } from '@playwright/test';

const SUMMARY_MARKER = '[PDFImportStatistics] summary ';

async function loadImportSummary(page, fixture) {
  const summaries = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith(SUMMARY_MARKER)) {
      summaries.push(JSON.parse(text.slice(SUMMARY_MARKER.length)));
    }
  });

  await page.goto(`/?testPdf=${encodeURIComponent(fixture)}&pdfImportDebug=1`);
  await page.waitForFunction(
    (pdfName) => window.__pdfImportStatistics?.pdfName === pdfName,
    fixture,
    { timeout: 60_000 },
  );

  const state = await page.evaluate(() => ({
    statistics: window.__pdfImportStatistics,
    diagnosticPages: Object.keys(window.__pdfEmbeddedAnnotationDiag || {}).length,
  }));
  return { ...state, summaries };
}

test('clean supported PDF emits one zero-loss import summary', async ({ page }) => {
  const result = await loadImportSummary(page, 'clickable-link-test.pdf');

  expect(result.summaries).toHaveLength(1);
  expect(result.statistics.counts).toEqual({
    sampled: 8,
    fallback: 0,
    skipped: 0,
  });
  expect(result.diagnosticPages).toBe(1);
});

test('mixed PDF reports reconstructed, fallback, native-only, and skipped imports once', async ({ page }) => {
  const result = await loadImportSummary(page, 'kal412-mixed-import-e2e.pdf');

  expect(result.summaries).toHaveLength(1);
  expect(result.statistics.counts).toEqual({
    sampled: 2,
    fallback: 3,
    skipped: 1,
  });
  expect(result.statistics.bySubtype.Ink).toEqual({
    sampled: 1,
    fallback: 1,
    skipped: 0,
  });
  expect(result.statistics.bySubtype.Stamp.fallback).toBe(1);
  expect(result.statistics.bySubtype.Redact.fallback).toBe(1);
  expect(result.statistics.reasons.skipped['converter-returned-null']).toBe(1);
  expect(result.diagnosticPages).toBe(1);
});
