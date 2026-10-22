// Tooltip rule in a real browser (docs/TOOLTIP-RULES.md, owner 2026-10-22):
// a document tab shows its full name on hover; the first chip waits, the next
// one right after shows at once; a touch tap shows none.
//
// Local fake data only (same dev route as drop-upload.spec.mjs).
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 npx playwright test \
//     --config debug/playwright.config.mjs debug/scenarios/tooltip-rule.spec.mjs
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FakeBackend } from './test-plan/tp-fake-backend.mjs';
import { prepareLocalContext, viewerUrl } from './test-plan/tp-local-doc.mjs';

const OUT = process.env.TOOLTIP_OUT || 'debug/out/tooltip-rule';
mkdirSync(OUT, { recursive: true });
test.use({ video: 'off', ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}) });
test.describe.configure({ timeout: 240_000 });

const DOC_ID = '7e57d0c0-0000-4000-8000-0000000d0101';
const chip = (page) => page.locator('body > div[aria-hidden="true"]').filter({ hasText: /\S/ }).last();

test('tab name chip waits once, then the next shows at once', async ({ browser }) => {
  const backend = new FakeBackend({ documentId: DOC_ID });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepareLocalContext(context, DOC_ID, { backend });
  const page = await context.newPage();
  await page.goto(viewerUrl('clickable-link-test.pdf', { cloudLibrary: true }));
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);

  const tab = page.locator('[data-pdf-tab-id]').first();
  const name = (await tab.getAttribute('aria-label')) || '';
  expect(name.length).toBeGreaterThan(0);
  const nameSpan = tab.locator('span').filter({ hasText: name }).first();
  await page.mouse.move(5, 300);
  await page.waitForTimeout(800);
  await nameSpan.hover();
  await page.waitForTimeout(120);
  expect(await page.locator('body > div[aria-hidden="true"]', { hasText: name }).count(), 'first chip waits').toBe(0);
  await page.waitForTimeout(500);
  await expect(page.locator('body > div[aria-hidden="true"]', { hasText: name })).toBeVisible();
  await page.screenshot({ path: `${OUT}/tab-name.png`, clip: { x: 0, y: 0, width: 900, height: 140 } });

  // Straight on to the Undo button: warm, so its chip shows with no wait.
  const undoChip = page.locator('body > div[aria-hidden="true"]', { hasText: /undo/i });
  const undoWrap = page.locator('span').filter({ has: page.getByRole('button', { name: /undo/i }) }).first();
  await undoWrap.hover();
  await page.waitForTimeout(60);
  await expect(undoChip).toBeVisible({ timeout: 100 });
  await page.screenshot({ path: `${OUT}/warm-next.png`, clip: { x: 0, y: 0, width: 900, height: 160 } });

  // Cold again after resting off the chrome: the next chip waits.
  await page.mouse.move(700, 600);
  await page.waitForTimeout(1200);
  await nameSpan.hover();
  await page.waitForTimeout(100);
  expect(await page.locator('body > div[aria-hidden="true"]', { hasText: name }).count(), 'cold again').toBe(0);
  await context.close();
});
