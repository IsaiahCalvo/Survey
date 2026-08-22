import { test, expect } from '@playwright/test';

// Cloud bump every integer 1–20. Local toolbar field (UL-34), not leftover-18
// cloud persist / file.id. Discrete 1…20 after the cluster-level Cloud clamp.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openEditor(page) {
  await page.goto(LINK_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if (!(String(await sub.first().getAttribute('class') || '').includes('btn-active'))) {
      await sub.first().click();
    }
    return;
  }
  await page.getByRole('button', { name: categoryName, exact: true }).click();
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if (!(String(await target.getAttribute('class') || '').includes('btn-active'))) {
    await target.click();
  }
}

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.20,
  y0 = 0.22,
  x1 = 0.48,
  y1 = 0.48,
} = {}) {
  const box = await pageBox(page, pageNumber);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function userRects(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const type = String(object.type || data.type || '').toLowerCase();
      if (object.isPdfImported === true || /^\d+R$/i.test(String(id))) return null;
      if (!(type === 'rect' || type === 'rectangle')) return null;
      const host = document.querySelector(`[data-svg-annotation-layer="1"] [data-anno-id="${id}"]`);
      const path = host?.querySelector('path');
      return {
        id,
        intensity: Number(data.pdfCloudIntensity),
        dash: object.strokeDashArray || data.strokeDashArray || null,
        pathD: path?.getAttribute('d') || '',
      };
    }).filter(Boolean);
  });
}

async function waitForNewRect(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userRects(page);
    created = rows.find((row) => !beforeIds.has(row.id)) || null;
    return created;
  }, { message: 'expected a new user rect' }).not.toBeNull();
  return created;
}

async function pickStyle(page, optionName) {
  const trigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: String(optionName), exact: true });
  if (await option.count()) {
    await option.click();
    return;
  }
  await popover.getByText(String(optionName), { exact: true }).click();
}

async function bumpField(page) {
  return page.getByRole('textbox', { name: 'Cloud bump size', exact: true });
}

async function setBump(page, raw) {
  const field = await bumpField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
}

async function storedIntensity(page, id) {
  const rows = await userRects(page);
  return rows.find((row) => row.id === id)?.intensity;
}

async function selectRect(page, id) {
  await page.keyboard.press('v');
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible({ timeout: 8_000 });
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + Math.min(8, Math.max(3, box.width / 2)), y: box.y + Math.max(3, box.height / 2) },
    { x: box.x + 3, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + 3 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    if (await page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').count()) return;
  }
  expect(await page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').count()).toBeGreaterThan(0);
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

test('cloud bump every integer 1–20 intended + break + edge', async ({ page }) => {
  const hunts = [];
  await openEditor(page);

  await activateTool(page, 'Shapes', 'Rectangle');
  await pickStyle(page, 'Cloud');
  const field = await bumpField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  hunts.push({ hunt: 'intended — Cloud style reveals the local Bump field', pass: true });

  const before = new Set((await userRects(page)).map((row) => row.id));
  await dragOnPage(page);
  const rect = await waitForNewRect(page, before);
  expect(Number.isFinite(rect.intensity)).toBeTruthy();
  hunts.push({ hunt: 'intended — new cloud rect stores pdfCloudIntensity', pass: true, created: rect.intensity });

  // Patch only runs when a shape is selected (toolbar state otherwise stays local).
  await selectRect(page, rect.id);
  await expect(await bumpField(page)).toBeVisible();

  const proven = [];
  for (let n = 1; n <= 20; n += 1) {
    await setBump(page, n);
    await expect.poll(async () => storedIntensity(page, rect.id), {
      message: `bump ${n} must store pdfCloudIntensity=${n}`,
    }).toBe(n);
    await expect(field).toHaveValue(String(n));
    proven.push(n);
  }
  expect(proven).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  hunts.push({ hunt: 'intended — every integer 1–20 stores on the selected cloud rect', pass: true, proven });

  const atOne = (await userRects(page)).find((row) => row.id === rect.id);
  await setBump(page, 20);
  await expect.poll(async () => storedIntensity(page, rect.id)).toBe(20);
  const atTwenty = (await userRects(page)).find((row) => row.id === rect.id);
  expect(atTwenty.pathD.length, 'bump 20 path should differ from bump 1').toBeGreaterThan(0);
  expect(atOne.pathD).not.toBe(atTwenty.pathD);
  hunts.push({ hunt: 'edge — bump 1 vs 20 changes the cloud path', pass: true });

  await setBump(page, 5);
  await expect.poll(async () => storedIntensity(page, rect.id)).toBe(5);
  await field.click();
  await field.fill('abc');
  await field.press('Enter');
  expect(await field.inputValue()).toBe('5');
  expect(await storedIntensity(page, rect.id)).toBe(5);
  hunts.push({ hunt: 'break — letters are rejected; intensity stays 5', pass: true });

  await setBump(page, 0);
  await expect.poll(async () => storedIntensity(page, rect.id)).toBe(1);
  await expect(field).toHaveValue('1');
  hunts.push({ hunt: 'break — 0 clamps to 1', pass: true });

  await setBump(page, 99);
  await expect.poll(async () => storedIntensity(page, rect.id)).toBe(20);
  await expect(field).toHaveValue('20');
  hunts.push({ hunt: 'break — 99 clamps to 20', pass: true });

  await field.click();
  await field.fill('');
  await field.press('Enter');
  await expect.poll(async () => storedIntensity(page, rect.id)).toBe(1);
  await expect(field).toHaveValue('1');
  hunts.push({ hunt: 'edge — empty field commits 1', pass: true });

  await pickStyle(page, 'Solid');
  await expect(field).toHaveCount(0);
  hunts.push({ hunt: 'edge — Solid hides the bump field (rect-only Cloud)', pass: true });

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);
  console.log('CLOUD_BUMP_1_20_PROOF', JSON.stringify({ hunts, fileId, proven }));
});
