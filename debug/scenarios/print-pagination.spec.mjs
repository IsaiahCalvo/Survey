import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';

// Real-pipeline pagination gate. The E2E round-trip found a six-page document
// printing ONE sheet (page 1 only) whenever the printable width fell under
// 720px — portrait paper with margins, or any phone — because the mobile
// layout's html/body pin applied to print media. A second print in the same
// dialog session printed the "still preparing" placeholder. Both are
// invisible to the fidelity harness (one capture, CSS page size, no margins).

const root = resolve(import.meta.dirname, '..', '..');
const outputDir = join(root, 'debug', 'artifacts', 'print-pagination');
const FIXTURE = '/?testPdf=e2e%2Fprog-06-mixed-page-sizes.pdf&surveyTransitionE2E=1';
const EXPECTED_PAGES = 6;
const shortcut = process.platform === 'darwin' ? 'Meta+P' : 'Control+P';
const margin = (value) => ({ top: value, right: value, bottom: value, left: value });

const PAPER_COMBOS = [
  { name: 'css-page-size', options: { preferCSSPageSize: true } },
  { name: 'letter-no-margin', options: { format: 'Letter', margin: margin(0) } },
  { name: 'letter-half-inch', options: { format: 'Letter', margin: margin('0.5in') } },
  { name: 'letter-one-inch', options: { format: 'Letter', margin: margin('1in') } },
  { name: 'a4-one-inch', options: { format: 'A4', margin: margin('1in') } },
  { name: 'letter-landscape-half-inch', options: { format: 'Letter', landscape: true, margin: margin('0.5in') } },
];

async function pageCount(path) {
  return (await PDFDocument.load(await readFile(path))).getPageCount();
}

async function openDocument(page) {
  await page.goto(FIXTURE);
  await page.locator('.survey-pdfjs-page-div[data-page-number]').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1500);
}

async function waitForPrintReady(page) {
  await expect(page.locator('[data-browser-print-document]')).toHaveAttribute('data-browser-print-ready', 'true', { timeout: 60_000 });
}

test.beforeEach(async ({ page }) => {
  await mkdir(outputDir, { recursive: true });
  await page.addInitScript(() => {
    window.__browserPrintCalls = 0;
    window.print = () => { window.__browserPrintCalls += 1; };
  });
});

test('every paper and margin combination prints one sheet per page', async ({ page }) => {
  await openDocument(page);
  await page.keyboard.press(shortcut);
  await expect.poll(() => page.evaluate(() => window.__browserPrintCalls), { timeout: 60_000 }).toBe(1);
  await waitForPrintReady(page);
  await expect(page.locator('.survey-browser-print-sheet')).toHaveCount(EXPECTED_PAGES);
  await page.emulateMedia({ media: 'print' });

  const counts = {};
  const orientations = {};
  for (const combo of PAPER_COMBOS) {
    const path = join(outputDir, `${combo.name}.pdf`);
    await page.pdf({ path, printBackground: true, ...combo.options });
    const doc = await PDFDocument.load(await readFile(path));
    counts[combo.name] = doc.getPageCount();
    orientations[combo.name] = doc.getPages().map((p) => (p.getWidth() > p.getHeight() ? 'L' : 'P')).join('');
  }
  expect(counts).toEqual(Object.fromEntries(PAPER_COMBOS.map((combo) => [combo.name, EXPECTED_PAGES])));
  // Wide pages get their own landscape sheet (CSS named pages) with NO phantom
  // sheet after them; the fixture's pages 3, 5 and 6 are wide. Landscape paper
  // in the dialog turns every sheet landscape, so only portrait combos assert.
  for (const combo of PAPER_COMBOS.filter((c) => !c.options.landscape)) {
    expect(orientations[combo.name], combo.name).toBe('PPLPLL');
  }
});

test('a retry print in the same dialog session prints the real pages, not the placeholder', async ({ page }) => {
  await openDocument(page);
  await page.keyboard.press(shortcut);
  await expect.poll(() => page.evaluate(() => window.__browserPrintCalls), { timeout: 60_000 }).toBe(1);
  await waitForPrintReady(page);
  await page.emulateMedia({ media: 'print' });

  const first = join(outputDir, 'retry-first.pdf');
  await page.pdf({ path: first, printBackground: true, format: 'Letter', margin: margin('0.5in') });
  expect(await pageCount(first)).toBe(EXPECTED_PAGES);

  // page.pdf fires afterprint; the prepared sheets must survive for a retry.
  const second = join(outputDir, 'retry-second.pdf');
  await page.pdf({ path: second, printBackground: true, format: 'A4', margin: margin('1in') });
  expect(await pageCount(second)).toBe(EXPECTED_PAGES);
  await expect(page.getByText('Document is still preparing for print')).toHaveCount(0);
});

test('a browser-menu print with nothing prepared shows the retry sheet, then the retry prints every page', async ({ page }) => {
  await openDocument(page);
  await page.emulateMedia({ media: 'print' });

  const placeholder = join(outputDir, 'menu-first.pdf');
  await page.pdf({ path: placeholder, printBackground: true, format: 'Letter', margin: margin('0.5in') });
  expect(await pageCount(placeholder)).toBe(1);

  // beforeprint with nothing prepared kicks off preparation without auto-printing.
  await waitForPrintReady(page);
  expect(await page.evaluate(() => window.__browserPrintCalls)).toBe(0);

  const retry = join(outputDir, 'menu-retry.pdf');
  await page.pdf({ path: retry, printBackground: true, format: 'Letter', margin: margin('0.5in') });
  expect(await pageCount(retry)).toBe(EXPECTED_PAGES);
});
