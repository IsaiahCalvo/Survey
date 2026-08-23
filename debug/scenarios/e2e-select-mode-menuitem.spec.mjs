import { test, expect } from '@playwright/test';

// Selection Mode *actions* expose role=menuitem.
// Unique leftover after Manage Team More menuitem (`4f194d3e` / `52fdd26a`).
// Live ?testPdf= Selection Mode caret opened a nameless <div> of <button>s —
// getByRole('menuitem') was 0 while the menu was open. Same a11y class as
// Home-tab / annotation / Pages / hub Account / Manage Team More, but a
// new compile-visible host. Distinct from leftover-18 / X-01 / Select Mode
// create-tool dismiss / unnamed-dialog family already proved /
// remapped-after-CW / rail-toggle. Do not stamp file.id. Do not invent
// leftover-18 mint / roster / Stripe. Do not name Activity.

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

function selectMenu(page) {
  return page.getByRole('menu', { name: 'Selection Mode', exact: true });
}

async function openSelectMenu(page) {
  await page.locator('[data-select-mode-caret="true"]').click();
  await expect(selectMenu(page)).toBeVisible();
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

test('desktop Selection Mode actions are named menuitems + Select text', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-select-mode-caret="true"]').count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: /^Select text/ }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: /^Select annotations/ }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  expect(await page.getByRole('menuitem', { name: /^Select text/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Select', exact: true }).count()).toBeGreaterThan(0);

  await openSelectMenu(page);
  await expect(page.getByRole('menuitem', { name: /^Select annotations/ })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: /^Select text/ })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Group', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Extract/i })).toHaveCount(0);

  await page.getByRole('menuitem', { name: /^Select text/ }).click();
  await expect(selectMenu(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select text', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Select text/ })).toHaveCount(0);

  await openSelectMenu(page);
  await page.keyboard.press('Escape');
  await expect(selectMenu(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select text', exact: true })).toBeVisible();

  await openSelectMenu(page);
  await page.getByRole('menuitem', { name: /^Select annotations/ }).click();
  await expect(selectMenu(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select text', exact: true })).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});

test('390 + idle break for Selection Mode menuitem chrome', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 });
  expect(await page.locator('[data-select-mode-caret="true"]').count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: /^Select text/ }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: /^Select annotations/ }).count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Manage team', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('menuitem', { name: /^Select text/ }).count()).toBe(0);
  await page.getByRole('button', { name: 'Manage team', exact: true }).click();
  const team = page.getByRole('dialog', { name: 'Manage Team', exact: true });
  await expect(team).toBeVisible({ timeout: 10_000 });
  await team.getByRole('button', { name: 'More', exact: true }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: /^Select text/ })).toHaveCount(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(await page.getByRole('menuitem', { name: /^Select text/ }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});
