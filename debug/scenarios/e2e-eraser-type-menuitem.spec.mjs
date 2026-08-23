import { test, expect } from '@playwright/test';

// Eraser Type *actions* expose role=menuitem.
// Unique leftover after Selection Mode menuitem (`97d102a0` / `3ace3c1f`).
// Live ?testPdf= Eraser Type caret opened a nameless <div> of <button>s —
// getByRole('menuitem') was 0 while the menu was open. Same a11y class as
// Home-tab / annotation / Pages / hub Account / Manage Team More /
// Selection Mode, but a new compile-visible host in high-risk PDFViewer.
// Distinct from leftover-18 / X-01 / D-03 type apply / remapped eraser Size /
// Select Mode create-tool dismiss / unnamed-dialog family already proved.
// Do not stamp file.id. Do not invent leftover-18 mint / roster / Stripe.
// Do not name Activity. Do not take Counter caret.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey-hub-tab');
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
      localStorage.removeItem('eraserMode');
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
}

function eraserMenu(page) {
  return page.getByRole('menu', { name: 'Eraser Type', exact: true });
}

async function openDraw(page) {
  await page.getByRole('button', { name: 'Draw', exact: true }).first().click();
  await expect(page.locator('[data-eraser-caret-button="true"]')).toBeVisible({ timeout: 15_000 });
}

async function openEraserMenu(page) {
  await page.locator('[data-eraser-caret-button="true"]').click();
  await expect(eraserMenu(page)).toBeVisible();
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

async function hiddenCounts(page) {
  const counts = {};
  for (const name of HIDDEN) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

test('desktop Eraser Type actions are named menuitems + Full stroke erase', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-eraser-caret-button="true"]').count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Full stroke erase', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menu', { name: 'Eraser Type', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  expect(await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: /^Select text/ }).count()).toBe(0);

  await openDraw(page);
  await openEraserMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Full stroke erase', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: /^Select text/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Group', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Extract/i })).toHaveCount(0);

  await page.getByRole('menuitem', { name: 'Full stroke erase', exact: true }).click();
  await expect(eraserMenu(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Full stroke erase', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Full stroke erase', exact: true })).toHaveCount(0);

  await openEraserMenu(page);
  await page.keyboard.press('Escape');
  await expect(eraserMenu(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Full stroke erase', exact: true })).toBeVisible();

  await openEraserMenu(page);
  await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).click();
  await expect(eraserMenu(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Partial erase', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Full stroke erase', exact: true })).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});

test('390 + idle break for Eraser Type menuitem chrome', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 });
  expect(await page.locator('[data-eraser-caret-button="true"]').count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Full stroke erase', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menu', { name: 'Eraser Type', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Manage team', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count()).toBe(0);
  await page.getByRole('button', { name: 'Manage team', exact: true }).click();
  const team = page.getByRole('dialog', { name: 'Manage Team', exact: true });
  await expect(team).toBeVisible({ timeout: 10_000 });
  await team.getByRole('button', { name: 'More', exact: true }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: /^Select text/ }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});
