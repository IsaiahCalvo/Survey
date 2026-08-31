import { test, expect } from '@playwright/test';

const FIXTURE = '/?testPdf=clickable-link-test.pdf';
const LARGE_FIXTURE = '/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf';
const shortcut = process.platform === 'darwin' ? 'Meta+P' : 'Control+P';

async function openEditor(page) {
  await page.goto(FIXTURE);
  await page.locator('.survey-pdfjs-viewer-container').waitFor({
    state: 'visible',
    timeout: 60_000,
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__browserPrintCalls = [];
    window.print = () => {
      const printDocument = document.querySelector('[data-browser-print-document]');
      window.__browserPrintCalls.push({
        ready: printDocument?.getAttribute('data-browser-print-ready'),
        pages: printDocument?.querySelectorAll('[data-browser-print-page]').length || 0,
      });
    };
  });
});

test('print pages stay out of the DOM until the user asks to print', async ({ page }) => {
  await openEditor(page);
  const printDocument = page.locator('[data-browser-print-document]');

  await page.waitForTimeout(3000);

  await expect(printDocument).toHaveAttribute('data-browser-print-ready', 'false');
  await expect(printDocument.locator('[data-browser-print-page]')).toHaveCount(0);
});

test('Cmd or Ctrl+P prepares marked-up pages before calling print', async ({ page }) => {
  await page.goto(LARGE_FIXTURE);
  await expect(page.getByText('Loading PDF...').first()).toBeVisible();
  const printDocument = page.locator('[data-browser-print-document]');
  await expect(printDocument).toBeAttached();

  await page.keyboard.press(shortcut);
  await expect(page.getByText(/Preparing print/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__browserPrintCalls.length), {
    timeout: 30_000,
  }).toBe(1);

  const [printCall] = await page.evaluate(() => window.__browserPrintCalls);
  expect(printCall.ready).toBe('true');
  expect(printCall.pages).toBeGreaterThan(0);

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(printDocument.locator('[data-browser-print-page]')).toHaveCount(0);
});

test('raw print has a clear retry sheet when pages are not ready', async ({ page }) => {
  await page.goto(LARGE_FIXTURE);
  await expect(page.getByText('Loading PDF...').first()).toBeVisible();
  await page.emulateMedia({ media: 'print' });

  await expect(page.getByText('Document is still preparing for print — please cancel and retry.')).toBeVisible();
});

test('an edit drops prepared pages and the next print uses a fresh render', async ({ page }) => {
  await openEditor(page);
  const printDocument = page.locator('[data-browser-print-document]');
  const printedPages = printDocument.locator('[data-browser-print-page]');

  await page.keyboard.press(shortcut);
  await expect.poll(() => page.evaluate(() => window.__browserPrintCalls.length), {
    timeout: 30_000,
  }).toBe(1);
  await expect(printedPages).not.toHaveCount(0);

  const pageOne = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await expect(pageOne).toBeVisible();
  await page.getByRole('button', { name: 'Draw' }).click();
  const box = await pageOne.boundingBox();
  const y = box.y + box.height * 0.4;
  await page.mouse.move(box.x + box.width * 0.35, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, y, { steps: 12 });
  await page.mouse.up();

  await expect(printDocument).toHaveAttribute('data-browser-print-ready', 'false');
  await expect(printedPages).toHaveCount(0);

  await page.keyboard.press(shortcut);
  await expect.poll(() => page.evaluate(() => window.__browserPrintCalls.length), {
    timeout: 30_000,
  }).toBe(2);
  const calls = await page.evaluate(() => window.__browserPrintCalls);
  expect(calls[1].ready).toBe('true');
  expect(calls[1].pages).toBeGreaterThan(0);

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
});
