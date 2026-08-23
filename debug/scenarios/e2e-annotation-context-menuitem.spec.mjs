import { test, expect } from '@playwright/test';

// Annotation context *actions* expose role=menuitem + Enter (not dismiss).
// Unique leftover after official Spaces rail openPanel align (`4a10a417`).
// Items were clickable divs with no role / name / keyboard — getByRole
// menuitem was 0 while the menu was open. Distinct from leftover-18 /
// X-01 / remapped-after-CW / dismiss-family / rail-toggle / overlay-mount /
// spacesRailToggle / Home `?` / Cut-Copy-Paste execute catalogs.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

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
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function userAnnoIds(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/i.test(String(id || ''));
    });
  });
}

async function drawRect(page) {
  const before = new Set(await userAnnoIds(page));
  await page.getByRole('button', { name: 'Shapes', exact: true }).first().click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).first().click();
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.24);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.36, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await userAnnoIds(page)).find((id) => !before.has(id)) || null).not.toBeNull();
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  const ids = await userAnnoIds(page);
  return ids.find((id) => !before.has(id)) || ids[ids.length - 1];
}

async function openAnnoMenu(page, id) {
  const mark = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(mark).toBeVisible();
  const box = await mark.boundingBox();
  expect(box, 'annotation geometry').toBeTruthy();
  // Transparent fill lets a center click fall through to the page
  // (Paste-only). The left stroke stays on the shape.
  await page.mouse.click(box.x + 2, box.y + box.height / 2, { button: 'right' });
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible();
  await expect(page.getByRole('menu', { name: 'Annotation' })).toBeVisible();
}

test('desktop annotation context actions are named menuitems + Enter', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  const id = await drawRect(page);
  await openAnnoMenu(page, id);

  const menu = page.getByRole('menu', { name: 'Annotation' });
  await expect(menu).toBeVisible();
  for (const name of ['Cut', 'Copy', 'Paste', 'Delete', 'Bring to front', 'Bring forward', 'Send backward', 'Send to back']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Group', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toHaveAttribute('aria-disabled', 'true');

  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);

  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.58, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect.poll(async () => (await userAnnoIds(page)).length).toBeGreaterThan(1);

  const file = await page.evaluate(() => {
    const selected = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return selected && typeof selected === 'object' ? selected.id ?? null : null;
  });
  expect(file).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});

test('390 + hub + empty-page break for annotation menuitem chrome', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LINK_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 });
  const more = page.getByRole('button', { name: 'More document options', exact: true });
  if (await more.count()) {
    await more.first().click();
    await page.waitForTimeout(150);
  }
  expect(await page.getByRole('menuitem', { name: 'Bring to front', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Save log', exact: true }).count()).toBe(0);

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-annotation-context-menu="true"]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
});
