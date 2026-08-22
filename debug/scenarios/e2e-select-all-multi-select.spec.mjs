import { test, expect } from '@playwright/test';

// V-02 select-all / multi-select — intended + break + edge.
// Unique leftover after V-04 zoom keyboard + Fit width. Prior V-02 was
// window smoke (stroke-click, Shift-click group chrome, marquee overlay).
// Annotation Ctrl+A is not wired (bare A arms Arrow). Not leftover-18.
// Distinct from hub Documents Select All, Archive Select, survey-rail
// Delete selected, adversarial marquee→Delete, leftover-18. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const RECT_A = { x0: 0.16, y0: 0.22, x1: 0.36, y1: 0.40 };
const RECT_B = { x0: 0.62, y0: 0.58, x1: 0.82, y1: 0.76 };

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
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  return raw || '';
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id, index) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        index,
        type: String(object.type || object.data?.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function allAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
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

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
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
  modifiers = [],
} = {}) {
  const box = await pageBox(page, pageNumber);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
  return { start, end, box };
}

async function createRect(page, coords) {
  const before = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRect);
}

async function selectMode(page) {
  await blurInputs(page);
  const selectBtn = page.getByRole('button', { name: 'Select', exact: true });
  let clicked = false;
  const count = await selectBtn.count();
  for (let i = 0; i < count; i += 1) {
    const button = selectBtn.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const cls = String(await button.getAttribute('class') || '');
    if (cls.includes('mobile-header-select-button')) continue;
    await button.click({ timeout: 4_000 }).catch(() => {});
    clicked = true;
    break;
  }
  if (!clicked) await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function selectedIds(page) {
  return page.evaluate(() => [...(window.__selectedAnnotationIds || [])]);
}

async function expectSelected(page, ids, message) {
  const want = [...ids].sort();
  await expect.poll(async () => [...(await selectedIds(page))].sort(), {
    timeout: 8_000,
    message: message || `expected selection ${want.join(',')}`,
  }).toEqual(want);
}

async function clickEmpty(page, { xf = 0.08, yf = 0.08 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
}

async function strokeClick(page, id, { modifiers = [] } = {}) {
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + 2, box.y + box.height / 2, {
    modifiers,
  });
}

async function groupOverlayCount(page) {
  return page.locator('[data-group-selection-bbox="true"]').count();
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

test('desktop select / shift-click / marquee intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await blurInputs(page);

  const importedAtStart = await allAnnotationIds(page);

  // Overlay lists V Select annotations. Ctrl+A / Select all are not wired
  // and are not listed. Bare A is Arrow.
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists Select annotations').toMatch(/Select annotations/);
  expect(overlayText, 'overlay lists V').toMatch(/\bV\b/);
  expect(overlayText, 'overlay lists Arrow on A').toMatch(/Arrow/);
  expect(overlayText, 'overlay must omit Select all').not.toMatch(/Select all/i);
  expect(overlayText, 'overlay must omit Ctrl+A').not.toMatch(/Ctrl\s*\+\s*A/i);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);

  // Break — empty page Ctrl+A invents 0 and does not select imported natives.
  await page.keyboard.press('Control+a');
  expect(await selectedIds(page), 'empty-page Ctrl+A must invent 0').toEqual([]);
  expect(await allAnnotationIds(page), 'empty-page Ctrl+A must hold imported ids').toEqual(importedAtStart);

  const rectA = await createRect(page, RECT_A);
  const rectB = await createRect(page, RECT_B);
  await blurInputs(page);
  expect(await userOrder(page), 'intended create A then B').toEqual([rectA.id, rectB.id]);

  await selectMode(page);
  await clickEmpty(page);
  await expectSelected(page, [], 'empty click must deselect after create');

  // Intended — stroke-click selects A (center miss is stroke-hit).
  await strokeClick(page, rectA.id);
  await expectSelected(page, [rectA.id], 'stroke-click must select A');
  expect(await groupOverlayCount(page), 'single select has no group overlay').toBe(0);

  // Intended — Shift-click unions B; group chrome appears.
  await strokeClick(page, rectB.id, { modifiers: ['Shift'] });
  await expectSelected(page, [rectA.id, rectB.id], 'Shift-click must add B');
  expect(await groupOverlayCount(page), 'multi-select must show group overlay').toBe(1);

  // Intended — Shift-click toggles B back out.
  await strokeClick(page, rectB.id, { modifiers: ['Shift'] });
  await expectSelected(page, [rectA.id], 'Shift-click must toggle B off');
  expect(await groupOverlayCount(page), 'single select after toggle has no group overlay').toBe(0);

  await strokeClick(page, rectB.id, { modifiers: ['Shift'] });
  await expectSelected(page, [rectA.id, rectB.id], 'Shift-click must toggle B back on');

  // Intended — empty click replaces selection with none.
  await clickEmpty(page);
  await expectSelected(page, [], 'empty click must clear multi-select');

  // Intended — window marquee (L→R) fully around A selects only A.
  await dragOnPage(page, { x0: 0.12, y0: 0.18, x1: 0.42, y1: 0.46 });
  await expectSelected(page, [rectA.id], 'window marquee around A must select A');

  await clickEmpty(page);
  await expectSelected(page, [], 'deselect before crossing');

  // Intended — crossing marquee (R→L) that only overlaps B selects B.
  // Same region L→R is window and must miss B (not fully contained).
  await dragOnPage(page, { x0: 0.90, y0: 0.82, x1: 0.70, y1: 0.66 });
  await expectSelected(page, [rectB.id], 'crossing marquee that clips B must select B');

  await clickEmpty(page);
  await dragOnPage(page, { x0: 0.70, y0: 0.66, x1: 0.90, y1: 0.82 });
  await expectSelected(page, [], 'window marquee that only clips B must miss B');

  // Intended — window around both selects A+B.
  await dragOnPage(page, { x0: 0.10, y0: 0.16, x1: 0.90, y1: 0.84 });
  await expectSelected(page, [rectA.id, rectB.id], 'window marquee around both must select A+B');
  expect(await groupOverlayCount(page), 'window both must show group overlay').toBe(1);

  // Intended — Shift+marquee unions B onto A.
  await clickEmpty(page);
  await strokeClick(page, rectA.id);
  await expectSelected(page, [rectA.id], 'reselect A before Shift-marquee');
  await dragOnPage(page, { x0: 0.56, y0: 0.52, x1: 0.90, y1: 0.84, modifiers: ['Shift'] });
  await expectSelected(page, [rectA.id, rectB.id], 'Shift-marquee around B must union B');

  // Intended — Alt+marquee subtracts B.
  await dragOnPage(page, { x0: 0.56, y0: 0.52, x1: 0.90, y1: 0.84, modifiers: ['Alt'] });
  await expectSelected(page, [rectA.id], 'Alt-marquee around B must subtract B');

  // Break — sub-threshold drag (< 5px) is an empty click, not a marquee.
  await strokeClick(page, rectB.id, { modifiers: ['Shift'] });
  await expectSelected(page, [rectA.id, rectB.id], 'reselect both before tiny drag');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * 0.08);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.08 + 3, box.y + box.height * 0.08 + 2, { steps: 2 });
  await page.mouse.up();
  await expectSelected(page, [], 'tiny marquee must deselect like an empty click');

  await strokeClick(page, rectA.id);
  await strokeClick(page, rectB.id, { modifiers: ['Shift'] });
  await expectSelected(page, [rectA.id, rectB.id], 'reselect both before Esc');

  // Break — Esc mid-marquee cancels; selection held.
  await page.mouse.move(box.x + box.width * 0.10, box.y + box.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.50, box.y + box.height * 0.50, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expectSelected(page, [rectA.id, rectB.id], 'Esc mid-marquee must keep A+B');

  // Break — Ctrl+A is not select-all. With A selected it must not add B.
  await clickEmpty(page);
  await strokeClick(page, rectA.id);
  await expectSelected(page, [rectA.id], 'A selected before Ctrl+A');
  await page.keyboard.press('Control+a');
  await expectSelected(page, [rectA.id], 'Ctrl+A must not add B');
  expect(await userOrder(page), 'Ctrl+A must not invent marks').toEqual([rectA.id, rectB.id]);

  // Break — bare A arms Arrow, not select-all.
  await page.keyboard.press('a');
  await expectSelected(page, [rectA.id], 'bare A must not change selection');
  await dragOnPage(page, { x0: 0.10, y0: 0.16, x1: 0.90, y1: 0.84 });
  await expectSelected(page, [], 'Arrow-armed window drag must not marquee-select');
  expect(await userOrder(page), 'Arrow-armed drag must invent 0').toEqual([rectA.id, rectB.id]);

  await selectMode(page);
  await clickEmpty(page);

  // Break — zoom % INPUT Ctrl+A is browser select-all in the field.
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await zoomBtn.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeVisible();
  await zoomInput.click();
  await page.keyboard.press('Control+a');
  expect(await userOrder(page), 'Ctrl+A in zoom INPUT must keep A and B').toEqual([rectA.id, rectB.id]);
  await expectSelected(page, [], 'Ctrl+A in zoom INPUT must not select annotations');
  await page.keyboard.press('Escape');
  await blurInputs(page);

  await selectMode(page);
  const importedNow = await allAnnotationIds(page);
  for (const id of importedAtStart) {
    expect(importedNow, `imported ${id} must survive select`).toContain(id);
  }
  expect(await userOrder(page)).toEqual([rectA.id, rectB.id]);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('SELECT_ALL_MULTI_SELECT_DESKTOP_PROOF', JSON.stringify({
    overlayListsSelect: /Select annotations/.test(overlayText),
    overlayOmitsSelectAll: !/Select all/i.test(overlayText),
    rectA: rectA.id,
    rectB: rectB.id,
    viewBox,
    fileId: null,
  }));
});

test('390 select / shift-click / marquee intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const importedAtStart = await allAnnotationIds(page);
  await page.keyboard.press('Control+a');
  expect(await selectedIds(page), '390 empty-page Ctrl+A must invent 0').toEqual([]);
  expect(await allAnnotationIds(page), '390 Ctrl+A must hold imported ids').toEqual(importedAtStart);

  const rectA = await createRect(page, { x0: 0.18, y0: 0.24, x1: 0.42, y1: 0.42 });
  const rectB = await createRect(page, { x0: 0.56, y0: 0.56, x1: 0.80, y1: 0.76 });
  await blurInputs(page);
  expect(await userOrder(page), '390 create A then B').toEqual([rectA.id, rectB.id]);

  await selectMode(page);
  await clickEmpty(page);
  await expectSelected(page, [], '390 empty click must deselect');

  await strokeClick(page, rectA.id);
  await expectSelected(page, [rectA.id], '390 stroke-click must select A');
  await strokeClick(page, rectB.id, { modifiers: ['Shift'] });
  await expectSelected(page, [rectA.id, rectB.id], '390 Shift-click must add B');

  await clickEmpty(page);
  await dragOnPage(page, { x0: 0.12, y0: 0.18, x1: 0.48, y1: 0.48 });
  await expectSelected(page, [rectA.id], '390 window marquee around A must select A');

  await page.keyboard.press('Control+a');
  await expectSelected(page, [rectA.id], '390 Ctrl+A must not add B');

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('SELECT_ALL_MULTI_SELECT_390_PROOF', JSON.stringify({
    rectA: rectA.id,
    rectB: rectB.id,
    viewBox,
    fileId: null,
  }));
});
