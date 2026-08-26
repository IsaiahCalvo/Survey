import { test, expect } from '@playwright/test';

// Overlay leftover: Shift+E is a live chord (forces Partial erase) and
// sibling erase shortcuts (E, plus the Shift+V pairing) were already
// listed, but the catalog omitted Shift+E. Distinct from leftover-18,
// D-03 type apply / skip-delete, Eraser Type caret / menuitem, and
// inventing Open file / UL-03 for overlay Ctrl+O. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('eraserMode');
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

function overlay(page) {
  return page.locator('[data-keyboard-shortcuts-modal="true"]');
}

function eraserTypeBtn(page) {
  return page.getByRole('button', { name: 'Eraser type', exact: true });
}

async function setEraserType(page, label) {
  const typeBtn = eraserTypeBtn(page);
  await expect(typeBtn).toBeVisible({ timeout: 8_000 });
  await typeBtn.click();
  const pop = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(pop).toBeVisible({ timeout: 5_000 });
  const option = pop.getByRole('option', { name: label, exact: true });
  const menu = pop.getByRole('menuitem', { name: label, exact: true });
  if (await option.count()) {
    await option.click();
  } else {
    await expect(menu).toBeVisible();
    await menu.click();
  }
  await expect(pop).toHaveCount(0);
  await expect.poll(async () => (
    (await typeBtn.innerText()).replace(/\s+/g, ' ').trim()
  ), { message: `Eraser type must read ${label}` }).toContain(label);
}

function assertOverlayListsShiftE(text, label) {
  expect(text, `${label} lists Eraser`).toContain('Eraser');
  expect(text, `${label} lists Partial erase`).toContain('Partial erase');
  expect(text, `${label} lists Shift`).toMatch(/Shift/);
  expect(text, `${label} must not invent Full stroke erase shortcut`).not.toMatch(/Full stroke erase/i);
  expect(text, `${label} must not invent Copy\/Cut\/Paste`).not.toMatch(/\b(Copy|Cut|Paste)\b/);
  expect(text, `${label} must not invent Open file`).not.toMatch(/Open file/i);
}

test('desktop overlay Shift+E Partial erase intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const idsBefore = await userAnnotationIds(page);
  expect(idsBefore, 'fresh editor must invent 0 user marks').toEqual([]);

  // Intended — Shift+E is live: E keeps remembered entire; Shift+E forces
  // Partial erase. Overlay then lists that live chord next to Eraser.
  await page.keyboard.press('e');
  await expect(eraserTypeBtn(page)).toBeVisible({ timeout: 8_000 });
  await setEraserType(page, 'Full stroke erase');
  expect(await page.evaluate(() => localStorage.getItem('eraserMode'))).toBe('entire');

  await blurInputs(page);
  await page.keyboard.press('e');
  await expect.poll(async () => (
    (await eraserTypeBtn(page).innerText()).replace(/\s+/g, ' ').trim()
  ), { message: 'E keeps remembered Full stroke erase' }).toContain('Full stroke erase');

  await blurInputs(page);
  await page.keyboard.press('Shift+E');
  await expect.poll(async () => (
    (await eraserTypeBtn(page).innerText()).replace(/\s+/g, ' ').trim()
  ), { message: 'Shift+E forces Partial erase' }).toContain('Partial erase');
  expect(await page.evaluate(() => localStorage.getItem('eraserMode'))).toBe('partial');

  await blurInputs(page);
  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal).toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsShiftE(catalog, 'desktop overlay');

  // Break — Esc dismisses; zoom INPUT e does not steal; second ? toggles.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await page.keyboard.press('?');
  await expect(modal, 'second `?` toggles closed').toHaveCount(0);

  await setEraserType(page, 'Full stroke erase');
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await expect(zoomBtn).toBeVisible();
  await zoomBtn.click();
  const zoom = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoom).toBeVisible();
  await zoom.click();
  await page.keyboard.press('e');
  expect(
    (await eraserTypeBtn(page).innerText()).replace(/\s+/g, ' ').trim(),
    'zoom % INPUT does not steal E',
  ).toContain('Full stroke erase');
  await blurInputs(page);

  // Edge — overlay / Shift+E invent 0 marks; viewBox / file.id stay.
  expect(await userAnnotationIds(page), 'overlay Shift+E must invent 0 marks').toEqual(idsBefore);
  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  await blurInputs(page);
  await page.keyboard.press('?');
  expect(await overlay(page).count(), 'hubPreview must not mount the overlay').toBe(0);
  expect(await page.getByRole('button', { name: 'Partial erase', exact: true }).count()).toBe(0);

  console.log('OVERLAY_SHIFT_E_DESKTOP_PROOF', JSON.stringify({
    listedPartialErase: /Partial erase/.test(catalog),
    viewBox,
    fileId: await fileId(page),
  }));
});

test('390 overlay Shift+E Partial erase intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal, '390 overlay exists').toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsShiftE(catalog, '390 overlay');

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('Shift+E');
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  assertOverlayListsShiftE(await modal.innerText(), '390 overlay after Shift+E');
  await page.keyboard.press('Escape');

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await userAnnotationIds(page)).toEqual([]);
  await assertNoErrorBoundary(page);

  console.log('OVERLAY_SHIFT_E_390_PROOF', JSON.stringify({
    listedPartialErase: /Partial erase/.test(catalog),
    viewBox,
    fileId: await fileId(page),
  }));
});
