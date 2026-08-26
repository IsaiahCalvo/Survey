import { test, expect } from '@playwright/test';

// Overlay leftover: Delete is a live selected-annotation chord
// (SVGAnnotationLayer Delete/Backspace handler), and sibling Action
// shortcuts (Ctrl+Z Undo / Ctrl+Shift+Z Redo) were already listed, but
// the catalog omitted Delete. Distinct from leftover-18, inventing
// Open file / UL-03 for overlay Ctrl+O, inventing Backspace-alias
// overlay rows, inventing clipboard overlay rows, and inventing
// Duplicate/z-order overlay rows.
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
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
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

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        type: String(object.type || object.data?.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userOrder(page) {
  return (await userAnnotationSnapshot(page)).map((row) => row.id);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle';
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if ((await sub.first().getAttribute('aria-pressed')) !== 'true') await sub.first().click();
    return;
  }
  const visible = page.getByRole('button', { name: toolName, exact: true });
  if (await visible.count() && await visible.first().isVisible().catch(() => false)) {
    if ((await visible.first().getAttribute('aria-pressed')) !== 'true') await visible.first().click();
    return;
  }
  await page.getByRole('button', { name: categoryName, exact: true }).first().click();
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.42,
  y1 = 0.46,
} = {}) {
  const box = await pageBox(page, pageNumber);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function createRect(page, coords) {
  const before = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRect);
}

async function selectStroke(page, id) {
  await page.keyboard.press('v');
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + Math.min(6, Math.max(2, box.width / 2)), y: box.y + Math.max(2, box.height / 2) },
    { x: box.x + 2, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    if (await page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').count()) return;
  }
  expect(await page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').count()).toBeGreaterThan(0);
}

function overlay(page) {
  return page.locator('[data-keyboard-shortcuts-modal="true"]');
}

function assertOverlayListsDelete(text, label) {
  expect(text, `${label} lists Undo`).toContain('Undo');
  expect(text, `${label} lists Redo`).toContain('Redo');
  expect(text, `${label} lists Delete selected`).toContain('Delete selected');
  expect(text, `${label} must not invent Backspace`).not.toMatch(/\bBackspace\b/);
  expect(text, `${label} must not invent Ctrl\+Y`).not.toMatch(/Ctrl\+Y|⌘Y|Cmd\+Y/i);
  expect(text, `${label} must not invent Copy\/Cut\/Paste`).not.toMatch(/\b(Copy|Cut|Paste)\b/);
  expect(text, `${label} must not invent Open file`).not.toMatch(/Open file/i);
  expect(text, `${label} must not invent Duplicate`).not.toMatch(/\bDuplicate\b/);
}

test('desktop overlay Delete intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const idsBefore = await userOrder(page);
  expect(idsBefore, 'fresh editor must invent 0 user marks').toEqual([]);

  // Break — empty-selection Delete invents 0 marks.
  await page.keyboard.press('Delete');
  expect(await userOrder(page), 'empty-selection Delete invents 0').toEqual(idsBefore);

  // Intended — Delete removes the selected rect; sibling stays.
  const rectA = await createRect(page, { x0: 0.16, y0: 0.20, x1: 0.36, y1: 0.38 });
  const rectB = await createRect(page, { x0: 0.42, y0: 0.24, x1: 0.62, y1: 0.42 });
  await blurInputs(page);
  await expect.poll(async () => userOrder(page), {
    message: 'create must leave two user rects',
  }).toEqual(expect.arrayContaining([rectA.id, rectB.id]));

  await selectStroke(page, rectA.id);
  await page.keyboard.press('Delete');
  await expect.poll(async () => userOrder(page), {
    message: 'Delete must remove the selected rect',
  }).toEqual([rectB.id]);

  await blurInputs(page);
  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal).toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsDelete(catalog, 'desktop overlay');

  // Break — Esc dismisses; zoom INPUT Delete does not steal; second ? toggles.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await page.keyboard.press('?');
  await expect(modal, 'second `?` toggles closed').toHaveCount(0);

  await selectStroke(page, rectB.id);
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await expect(zoomBtn).toBeVisible();
  await zoomBtn.click();
  const zoom = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoom).toBeVisible();
  await zoom.click();
  await page.keyboard.press('Delete');
  expect(await userOrder(page), 'zoom % INPUT does not steal Delete').toEqual([rectB.id]);
  await page.keyboard.press('Escape').catch(() => {});
  await blurInputs(page);

  // Edge — overlay / Delete invent 0 extra marks; viewBox / file.id stay.
  expect(await userOrder(page), 'overlay Delete must keep the sibling rect').toEqual([rectB.id]);
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

  console.log('OVERLAY_DELETE_DESKTOP_PROOF', JSON.stringify({
    listedDelete: /Delete selected/.test(catalog),
    keptId: rectB.id,
    viewBox,
    fileId: await fileId(page),
  }));
});

test('390 overlay Delete intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal, '390 overlay exists').toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  assertOverlayListsDelete(catalog, '390 overlay');

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  const idsBefore = await userOrder(page);
  await page.keyboard.press('Delete');
  expect(await userOrder(page), '390 empty-selection Delete invents 0').toEqual(idsBefore);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await userOrder(page)).toEqual([]);
  await assertNoErrorBoundary(page);

  console.log('OVERLAY_DELETE_390_PROOF', JSON.stringify({
    listedDelete: /Delete selected/.test(catalog),
    viewBox,
    fileId: await fileId(page),
  }));
});
