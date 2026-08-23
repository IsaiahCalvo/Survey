import { test, expect } from '@playwright/test';

// Pages thumbnail context *actions* expose role=menuitem (not dismiss).
// Unique leftover after annotation context menuitem (`8d95e104`).
// Items were named <button>s inside a nameless <div> — getByRole('menuitem')
// was 0 while the menu was open. Same a11y class as Home-tab / annotation
// context. Distinct from leftover-18 / X-01 / remapped-after-CW /
// dismiss-family / rail-toggle / overlay-mount / Home `?` / annotation
// context actions / Pages apply catalogs (rotate/insert/delete/move).
// Do not stamp file.id. Do not invent Extract / Group / dest-XYZ / lease.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const ACTION_NAMES = [
  'Move up',
  'Move down',
  'Cut',
  'Copy',
  'Paste',
  'Duplicate',
  'Insert blank page',
  'Rotate',
  'Rotate counter-clockwise',
  'Mirror horizontally',
  'Mirror vertically',
  'Reset',
  'Delete',
];

async function openEditor(page, { width = 1400, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
}

function pagesMenu(page) {
  return page.locator('[data-pages-context-menu="true"]');
}

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pages.first().isVisible().catch(() => false)) {
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') {
      await pages.first().click();
    }
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) {
    await rail.first().click();
  }
}

async function openPagesContext(page, pageNumber = 1) {
  await openPagesPanel(page);
  const thumb = page.locator(`#chrome-left-host [data-page-number="${pageNumber}"]`).first();
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await thumb.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await thumb.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(12, rect.width / 2),
        clientY: rect.top + Math.min(12, rect.height / 2),
      }));
    });
    try {
      await expect(pagesMenu(page)).toBeVisible({ timeout: 2_500 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

test('desktop Pages context actions are named menuitems + Enter', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);

  await openPagesContext(page);
  await expect(page.getByRole('menu', { name: 'Page 1 actions' })).toBeVisible();
  for (const name of ACTION_NAMES) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole('menuitem', { name: /Extract/i })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Group', exact: true })).toHaveCount(0);

  const paste = page.getByRole('menuitem', { name: 'Paste', exact: true });
  await expect(paste).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Move up', exact: true })).toBeDisabled();

  const pagesBefore = await page.locator('.survey-pdfjs-page-div').count();
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(pagesMenu(page)).toHaveCount(0);
  await expect.poll(() => page.locator('.survey-pdfjs-page-div').count()).toBe(pagesBefore + 1);

  await openPagesContext(page);
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await expect(pagesMenu(page)).toHaveCount(0);
  await openPagesContext(page);
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(pagesMenu(page)).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});

test('390 + hub break for Pages menuitem chrome', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LINK_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 });

  expect(await page.getByRole('menuitem', { name: 'Rotate', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: /Extract/i }).count()).toBe(0);

  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pages.count()) {
    await pages.first().click();
    const actions = page.getByRole('button', { name: 'Page 1 actions', exact: true });
    if (await actions.count()) {
      await actions.first().click();
      await expect(page.getByRole('menu', { name: 'Page 1 actions' })).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toHaveCount(1);
      await expect(page.getByRole('menuitem', { name: /Extract/i })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
  }

  expect(await page.getByRole('button', { name: 'Save log', exact: true }).count()).toBe(0);

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-pages-context-menu="true"]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Rotate', exact: true }).count()).toBe(0);
});
