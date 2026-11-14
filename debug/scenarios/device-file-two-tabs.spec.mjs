// A file opened from the device with no account, open in two browser tabs at
// once, each tab drawing its own mark. Drawboard PDF web keeps such a file in
// one saved state per browser and the last tab to save wins: the other tab's
// mark is gone for good, with no warning (file-model.md, test 3, 2026-11-09).
// Survey must keep both marks, and opening the same PDF again reopens that
// copy instead of a blank second one (2026-11-14).
//
// Run: start Vite on DEVICE_TABS_PORT (default 5203, Nightly), then
//   npx playwright test debug/scenarios/device-file-two-tabs.spec.mjs --trace off
import { test, expect, chromium } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { dragPage, tool, windowMarks } from './test-plan/tp-actions.mjs';

const BASE = `http://localhost:${process.env.DEVICE_TABS_PORT || '5203'}`;
const OUT = process.env.DEVICE_TABS_OUT || null;

test.describe.configure({ timeout: 240_000 });

async function sourcePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('Two tabs', { x: 72, y: 720, size: 24, font });
  return Buffer.from(await pdf.save());
}

async function home(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const sheet = page.locator('.auth-modal-overlay');
  await expect(page.getByRole('button', { name: 'Upload', exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
  if (await sheet.isVisible()) { await page.keyboard.press('Escape'); await expect(sheet).toBeHidden(); }
}

async function pageShown(page) {
  const div = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(div.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
}

async function drawRect(page, points) {
  await tool(page, 'Shapes', 'Rectangle');
  await dragPage(page, 1, points);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1_200);
}

test('two tabs on one device file both keep their marks', async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.addInitScript(() => {
    try { localStorage.setItem('survey.flag.device-files', '1'); } catch { /* private mode */ }
  });
  const shot = async (p, name) => { if (OUT) await p.screenshot({ path: `${OUT}/${name}.png` }); };
  const bytes = await sourcePdf();

  // Tab A opens the file from the device.
  const a = await context.newPage();
  await home(a);
  const chooser = a.waitForEvent('filechooser');
  await a.getByRole('button', { name: 'Upload', exact: true }).filter({ visible: true }).first().click();
  await (await chooser).setFiles({ name: 'two-tabs.pdf', mimeType: 'application/pdf', buffer: bytes });
  // Signed out it opens at once: no "Review the sheet before upload" step.
  await pageShown(a);

  // Tab B opens the same device file from the home list.
  const b = await context.newPage();
  await home(b);
  await b.getByText('two-tabs.pdf').filter({ visible: true }).first().click();
  const openBtn = b.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
  if (await openBtn.isVisible().catch(() => false)) await openBtn.click();
  await pageShown(b);

  // Each tab draws its own rectangle, A first, then B, then A again.
  await a.bringToFront();
  await drawRect(a, [[60, 80], [140, 120], [220, 160]]);
  await b.bringToFront();
  await drawRect(b, [[60, 300], [140, 340], [220, 380]]);
  await a.bringToFront();
  await drawRect(a, [[300, 500], [360, 540], [420, 580]]);
  await shot(a, 'a'); await shot(b, 'b');

  // A third tab opens the same PDF from the computer again: it reopens the
  // copy already kept, with all three marks, not a blank second copy.
  await a.close(); await b.close();
  const c = await context.newPage();
  await home(c);
  const again = c.waitForEvent('filechooser');
  await c.getByRole('button', { name: 'Upload', exact: true }).filter({ visible: true }).first().click();
  await (await again).setFiles({ name: 'two-tabs.pdf', mimeType: 'application/pdf', buffer: bytes });
  await pageShown(c);
  await expect.poll(async () => (await windowMarks(c)).length, { timeout: 20_000 }).toBe(3);
  await shot(c, 'c');
  await c.getByRole('button', { name: 'Home', exact: true }).first().click();
  await expect(c.getByRole('button', { name: /^two-tabs\.pdf On this device/ }).filter({ visible: true })).toHaveCount(1, { timeout: 10_000 });
  await browser.close();
});
