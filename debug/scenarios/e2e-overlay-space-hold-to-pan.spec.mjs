import { test, expect } from '@playwright/test';

// Overlay leftover: Space is the live hold-to-pan chord
// (PdfjsViewerContainer activateSpacePan), and sibling
// Navigation shortcuts (page arrows / Home / End next to
// Zoom) were already listed, but the catalog omitted that
// view-pan chord. V-01 already proved the hold-Space
// behavior — this pass only lists the live chord.
// Distinct from leftover-18, inventing Open file / UL-03,
// inventing clipboard overlay rows, inventing Backspace-
// alias overlay rows, and inventing Duplicate overlay
// rows.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
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
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/i.test(String(id || ''));
    });
  }, pageNumber);
}

async function spacePan(page) {
  return page.locator('.survey-pdfjs-viewer').first().evaluate((el) => el.dataset.spacePan || 'off');
}

function overlay(page) {
  return page.locator('[data-keyboard-shortcuts-modal="true"]');
}

function assertOverlayListsHoldToPan(text, label) {
  expect(text, `${label} lists Last page`).toContain('Last page');
  expect(text, `${label} lists Hold to pan`).toContain('Hold to pan');
  expect(text, `${label} lists Zoom in`).toContain('Zoom in');
  expect(text, `${label} lists Toggle sidebar`).toContain('Toggle sidebar');
  expect(text, `${label} must not invent Backspace`).not.toMatch(/\bBackspace\b/);
  expect(text, `${label} must not invent Ctrl\+Y`).not.toMatch(/Ctrl\+Y|⌘Y|Cmd\+Y/i);
  expect(text, `${label} must not invent Copy\/Cut\/Paste`).not.toMatch(/\b(Copy|Cut|Paste)\b/);
  expect(text, `${label} must not invent Open file`).not.toMatch(/Open file/i);
  expect(text, `${label} must not invent Duplicate`).not.toMatch(/\bDuplicate\b/);
}

test('desktop overlay Hold to pan intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const idsBefore = await userAnnotationIds(page);
  expect(idsBefore, 'fresh editor must invent 0 user marks').toEqual([]);

  // Intended — hold Space arms data-space-pan; release restores off.
  await page.keyboard.down('Space');
  await expect.poll(async () => spacePan(page), {
    message: 'Space must arm data-space-pan',
  }).toBe('armed');
  expect(await userAnnotationIds(page), 'hold Space invents 0').toEqual(idsBefore);
  await page.keyboard.up('Space');
  await expect.poll(async () => spacePan(page), {
    message: 'keyup Space must set data-space-pan=off',
  }).toBe('off');

  await blurInputs(page);
  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal).toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsHoldToPan(catalog, 'desktop overlay');

  // Break — Esc dismisses; Search INPUT types a space; zoom INPUT
  // Space does not arm pan; second ? toggles.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await page.keyboard.press('?');
  await expect(modal, 'second `?` toggles closed').toHaveCount(0);

  await page.getByRole('button', { name: 'Search text', exact: true }).click();
  const search = page.getByPlaceholder('Search text in PDF...');
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.click();
  await search.fill('ab');
  await search.press('Space');
  await expect(search, 'Search INPUT Space must type a space').toHaveValue('ab ');
  expect(await spacePan(page), 'Search INPUT Space must not arm pan').toBe('off');
  await page.keyboard.press('Escape').catch(() => {});
  await blurInputs(page);

  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await expect(zoomBtn).toBeVisible();
  await zoomBtn.click();
  const zoom = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoom).toBeVisible();
  await zoom.click();
  const zoomBefore = await zoom.inputValue();
  await zoom.press('Space');
  expect(await spacePan(page), 'zoom INPUT Space must not arm pan').toBe('off');
  expect(await zoom.inputValue(), 'zoom INPUT Space must not rewrite %').toBe(zoomBefore);
  await page.keyboard.press('Escape').catch(() => {});
  await blurInputs(page);

  // Edge — overlay / Space invent 0 extra marks; viewBox / file.id stay.
  expect(await userAnnotationIds(page), 'overlay Hold to pan invents 0 extra marks').toEqual([]);
  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  const hubPage = await page.context().newPage();
  await hubPage.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(hubPage.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await hubPage.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  await blurInputs(hubPage);
  await hubPage.keyboard.press('?');
  expect(await overlay(hubPage).count(), 'hubPreview must not mount the overlay').toBe(0);
  await hubPage.close();

  console.log('OVERLAY_SPACE_HOLD_TO_PAN_DESKTOP_PROOF', JSON.stringify({
    listedHoldToPan: /Hold to pan/.test(catalog),
    viewBox,
    fileId: await fileId(page),
  }));
});

test('390 overlay Hold to pan intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal, '390 overlay exists').toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsHoldToPan(catalog, '390 overlay');

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  const idsBefore = await userAnnotationIds(page);
  await page.keyboard.down('Space');
  await expect.poll(async () => spacePan(page), {
    message: '390 Space must arm data-space-pan',
  }).toBe('armed');
  expect(await userAnnotationIds(page), '390 hold Space invents 0').toEqual(idsBefore);
  await page.keyboard.up('Space');
  await expect.poll(async () => spacePan(page), {
    message: '390 keyup Space must set data-space-pan=off',
  }).toBe('off');

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await userAnnotationIds(page)).toEqual([]);
  await assertNoErrorBoundary(page);

  console.log('OVERLAY_SPACE_HOLD_TO_PAN_390_PROOF', JSON.stringify({
    listedHoldToPan: /Hold to pan/.test(catalog),
    viewBox,
    fileId: await fileId(page),
  }));
});
