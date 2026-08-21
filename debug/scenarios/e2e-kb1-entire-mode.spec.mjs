import { test, expect } from '@playwright/test';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openEditor(page) {
  await page.goto(LINK_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  expect(box, 'page 1 geometry').toBeTruthy();
  return box;
}

async function appAnnotationIds(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ));
}

async function userAnnotationSnapshot(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        type: String(object.type || object.data?.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true);
  });
}

async function waitForNewUserAnnotation(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && (row.type === 'rect' || row.type === 'rectangle')) || null;
    return created;
  }, { message: 'expected a new user rect' }).not.toBeNull();
  return created;
}

async function activateTool(page, categoryName, toolName) {
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  await expect(tool).toBeVisible();
  await tool.click();
}

async function dragOnPage(page, { x0, y0, x1, y1 }) {
  const box = await pageBox(page);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function createRect(page, coords) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before);
}

async function annotationBox(page, id) {
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  return box;
}

async function eraseInside(page, box) {
  const x = box.x + box.width / 2;
  const inset = Math.max(6, Math.min(12, box.height / 4));
  await page.mouse.move(x, box.y + inset);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(x, box.y + box.height - inset, { steps: 4 });
  await page.mouse.up();
}

async function openDrawTools(page) {
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count() === 0) {
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
  }
  await expect(pen).toBeVisible();
}

async function activateEraser(page, { mode = 'partial', size = 24 } = {}) {
  await openDrawTools(page);
  const label = mode === 'entire' ? 'Full stroke erase' : 'Partial erase';
  const currentMode = page.getByRole('button', { name: label, exact: true });
  if (mode === 'entire' && await currentMode.count() === 0) {
    const typeButton = page.getByRole('button', { name: 'Eraser type', exact: true });
    await expect(typeButton).toBeVisible();
    await typeButton.click();
    const popover = page.locator('[data-annotation-dropdown-popover="true"]');
    await expect(popover).toBeVisible();
    await popover.getByText('Full stroke erase', { exact: true }).click();
  }
  await expect(currentMode).toBeVisible();
  await currentMode.click();
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toHaveCount(1, { timeout: 8_000 });
  const width = page.getByRole('textbox', { name: /^(Width|Size)$/ }).first();
  if (await width.count()) {
    await width.fill(String(size));
    await width.press('Tab');
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-annotation-dropdown-popover="true"]')).toHaveCount(0);
}

async function eraserPlan(page) {
  return page.locator('[data-diag-eraser-wrapper="1"]').evaluate((wrapper) => ({
    status: wrapper.dataset.eraserPlanStatus || null,
    targetCount: wrapper.dataset.eraserPlanTargetCount || null,
    kinds: wrapper.dataset.eraserPlanKinds || null,
  }));
}

test('KB-1 leftover: partial skips stacked rects; entire deletes topmost only', async ({ page }) => {
  await openEditor(page);
  const bottom = await createRect(page, { x0: 0.30, y0: 0.32, x1: 0.50, y1: 0.52 });
  const top = await createRect(page, { x0: 0.32, y0: 0.34, x1: 0.48, y1: 0.50 });
  const hitBox = await annotationBox(page, top.id);

  await activateEraser(page, { mode: 'partial', size: 20 });
  await eraseInside(page, hitBox);
  await expect.poll(async () => {
    const ids = (await userAnnotationSnapshot(page)).map((row) => row.id);
    return ids.includes(bottom.id) && ids.includes(top.id);
  }).toBe(true);
  const afterPartial = (await userAnnotationSnapshot(page)).map((row) => row.id);
  const afterPartialPlan = await eraserPlan(page);

  await activateEraser(page, { mode: 'entire', size: 20 });
  const entireHit = await annotationBox(page, top.id);
  await eraseInside(page, entireHit);
  console.log('KB1_ENTIRE_SWIPE', JSON.stringify({
    entireHit,
    plan: await eraserPlan(page),
    ids: (await userAnnotationSnapshot(page)).map((row) => row.id),
  }));
  await expect.poll(async () => {
    const ids = (await userAnnotationSnapshot(page)).map((row) => row.id);
    return { hasTop: ids.includes(top.id), hasBottom: ids.includes(bottom.id) };
  }).toEqual({ hasTop: false, hasBottom: true });

  console.log('KB1_ENTIRE_MODE_PROOF', JSON.stringify({
    bottom: bottom.id,
    top: top.id,
    afterPartial,
    afterPartialPlan,
    afterEntire: (await userAnnotationSnapshot(page)).map((row) => row.id),
    afterEntirePlan: await eraserPlan(page),
    verdict: 'partial-skip + entire-topmost',
  }));
});
