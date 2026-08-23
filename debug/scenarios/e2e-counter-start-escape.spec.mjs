import { test, expect } from '@playwright/test';

// Product bug leftover the Width/Size Escape inspect missed: Counter Start
// commits on Enter/blur but had no Escape skip-commit. Zoom % / page # /
// rotation / Width / Size / bookmark rename already restore. Opacity / hex /
// Cloud bump apply live (no blur-commit draft). 390 now mounts the same
// Start field (was Size-only). Distinct from Size catalog and leftover-18
// / X-01. Do not stamp file.id.

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

async function activateCounter(page) {
  await activateTool(page, 'Shapes', 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
}

async function dropCounterPin(page, { xf = 0.40, yf = 0.36 } = {}) {
  const overlay = page.locator('[data-counter-overlay="1"]');
  await expect(overlay).toBeVisible();
  await page.waitForTimeout(280);
  const box = await overlay.boundingBox();
  expect(box, 'counter overlay geometry').toBeTruthy();
  const start = { x: box.x + box.width * xf, y: box.y + box.height * yf };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 8, { steps: 4 });
  await page.mouse.up();
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const annoIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const overlayIds = [...document.querySelectorAll(`[data-counter-overlay="${pageNum}"] [data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const ids = [...new Set([...annoIds, ...overlayIds])];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const host = document.querySelector(`[data-counter-overlay="${pageNum}"] [data-anno-id="${id}"]`)
        || document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"]`);
      const label = host?.querySelector('text')?.textContent?.trim() || '';
      return {
        id,
        type: String(object.type || data.type || (overlayIds.includes(id) ? 'counter' : '')).toLowerCase(),
        tool: String(data.tool || data.type || object.tool || (overlayIds.includes(id) ? 'counter' : '')).toLowerCase(),
        imported: object.isPdfImported === true,
        displayNumber: Number(data.displayNumber ?? label),
        seriesStart: data.seriesStart ?? null,
        label,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

function isCounterRow(row) {
  return row.tool === 'counter'
    || row.type.includes('counter')
    || row.type === 'circle'
    || row.type === 'group'
    || !row.type;
}

async function dropPin(page, coords) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await dropCounterPin(page, coords);
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !before.has(row.id) && isCounterRow(row)) || null;
    return created;
  }, { message: `expected a new counter pin at ${JSON.stringify(coords)}` }).not.toBeNull();
  return created;
}

async function selectPin(page, id) {
  await page.keyboard.press('v');
  const target = page.locator(
    `[data-counter-overlay="1"] [data-anno-id="${id}"], [data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`
  ).first();
  await expect(target).toBeVisible({ timeout: 8_000 });
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function startField(page) {
  return page.getByRole('textbox', { name: 'Counter start number', exact: true });
}

async function typeDraft(field, raw) {
  await expect(field).toBeVisible({ timeout: 8_000 });
  await expect(field).toBeEnabled();
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
}

async function pinNumber(page, id) {
  const row = (await userAnnotationSnapshot(page)).find((item) => item.id === id);
  return row?.displayNumber ?? null;
}

test('Counter Start Escape skip-commit intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  const hunts = [];

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await activateCounter(page);
  const pin = await dropPin(page, { xf: 0.36, yf: 0.34 });
  await selectPin(page, pin.id);

  const field = await startField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await expect(field).toBeEnabled();
  expect(await field.inputValue()).toBe('1');
  expect(await pinNumber(page, pin.id)).toBe(1);

  await typeDraft(field, '10');
  await expect(field).toHaveValue('10');
  await field.press('Escape');
  await expect(field).toHaveValue('1');
  await expect.poll(async () => pinNumber(page, pin.id), {
    message: 'Escape must not persist Start 10',
  }).toBe(1);
  hunts.push({ hunt: 'intended — type 10 + Escape restores 1; pin stays 1', pass: true, id: pin.id });

  await typeDraft(field, '10');
  await field.press('Enter');
  await expect(field).toHaveValue('10');
  await expect.poll(async () => pinNumber(page, pin.id), {
    message: 'Enter still commits Start 10',
  }).toBe(10);
  hunts.push({ hunt: 'intended — Enter still commits Start 10', pass: true });

  await typeDraft(field, '99');
  await field.press('Escape');
  await expect(field).toHaveValue('10');
  await expect.poll(async () => pinNumber(page, pin.id)).toBe(10);
  hunts.push({ hunt: 'break — 99 + Escape restores 10 (not clamp-commit)', pass: true });

  await typeDraft(field, '');
  await field.press('Escape');
  await expect(field).toHaveValue('10');
  await expect.poll(async () => pinNumber(page, pin.id)).toBe(10);
  hunts.push({ hunt: 'break — empty + Escape restores 10', pass: true });

  await typeDraft(field, 'abc');
  await expect(field).toHaveValue('');
  await field.press('Escape');
  await expect(field).toHaveValue('10');
  await expect.poll(async () => pinNumber(page, pin.id)).toBe(10);
  hunts.push({ hunt: 'break — letters strip then Escape restores 10', pass: true });

  await typeDraft(field, '8');
  await field.press('Escape');
  await expect(field).toHaveValue('10');
  await page.mouse.click(16, 180);
  await expect(field).toHaveValue('10');
  await expect.poll(async () => pinNumber(page, pin.id), {
    message: 'blur after Escape must not persist the cancelled Start draft',
  }).toBe(10);
  hunts.push({ hunt: 'break — Escape then click-away does not persist 8', pass: true });

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(fileId).toBeNull();
  expect(viewBox).toBe('0 0 612 792');
  hunts.push({ hunt: 'edge — viewBox 0 0 612 792; file.id null', pass: true, viewBox, fileId });

  await assertNoErrorBoundary(page);
  console.log('COUNTER_START_ESCAPE_PROOF', JSON.stringify({ hunts, fileId, viewBox, pin: pin.id }));
});

test('Counter Start Escape skip-commit 390 + hubPreview', async ({ page }) => {
  test.setTimeout(180_000);
  const hunts = [];

  await openEditor(page, { width: 390, height: 844 });
  const closePages = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await page.getByText('No documents yet').isVisible().catch(() => false) && await closePages.isVisible().catch(() => false)) {
    await closePages.click();
    await expect(page.getByText('No documents yet')).toHaveCount(0);
  }

  await activateCounter(page);
  const pin = await dropPin(page, { xf: 0.40, yf: 0.36 });
  await selectPin(page, pin.id);

  const field = await startField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await expect(field).toBeEnabled();
  expect(await field.inputValue()).toBe('1');
  await expect(page.getByRole('textbox', { name: 'Size', exact: true }).first()).toBeVisible();
  hunts.push({ hunt: 'intended — 390 selected pin reveals Start + Size', pass: true, id: pin.id });

  await typeDraft(field, '10');
  await field.press('Escape');
  await expect(field).toHaveValue('1');
  await expect.poll(async () => pinNumber(page, pin.id), {
    message: '390 Escape must not persist Start 10',
  }).toBe(1);
  hunts.push({ hunt: 'intended — 390 type 10 + Escape restores 1', pass: true });

  await typeDraft(field, '10');
  await field.press('Enter');
  await expect(field).toHaveValue('10');
  await expect.poll(async () => pinNumber(page, pin.id), {
    message: '390 Enter still commits Start 10',
  }).toBe(10);
  hunts.push({ hunt: 'intended — 390 Enter commits Start 10', pass: true });

  await typeDraft(field, '99');
  await field.press('Escape');
  await expect(field).toHaveValue('10');
  await expect.poll(async () => pinNumber(page, pin.id)).toBe(10);
  hunts.push({ hunt: 'break — 390 99 + Escape restores 10', pass: true });

  await typeDraft(field, 'abc');
  await expect(field).toHaveValue('');
  await field.press('Escape');
  await expect(field).toHaveValue('10');
  await expect.poll(async () => pinNumber(page, pin.id)).toBe(10);
  hunts.push({ hunt: 'break — 390 letters + Escape restores 10', pass: true });

  await activateCounter(page);
  const pin2 = await dropPin(page, { xf: 0.58, yf: 0.36 });
  const two = (await userAnnotationSnapshot(page)).filter(isCounterRow);
  expect(two.map((row) => row.displayNumber).sort((a, b) => a - b)).toEqual([10, 11]);
  await selectPin(page, pin.id);
  await expect(await startField(page)).toBeDisabled();
  hunts.push({ hunt: 'break — 390 Start locks after a second pin', pass: true, pin2: pin2.id });

  await page.getByRole('button', { name: 'Draw', exact: true }).first().click();
  await expect(await startField(page)).toHaveCount(0);
  hunts.push({ hunt: 'edge — 390 Pen hides Start', pass: true });

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  hunts.push({ hunt: 'edge — viewBox 0 0 612 792; file.id null', pass: true, viewBox, fileId });

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('textbox', { name: 'Counter start number', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
  hunts.push({ hunt: 'edge — hubPreview Start 0', pass: true });

  await assertNoErrorBoundary(page);
  console.log('COUNTER_START_390_PROOF', JSON.stringify({
    hunts,
    viewBox,
    fileId,
  }));
});
