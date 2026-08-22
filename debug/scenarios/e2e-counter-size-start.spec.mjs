import { test, expect } from '@playwright/test';

// Counter Size catalog + Start number. Distinct from D-05 stroke Width
// (12 presets, 1–50) and from leftover-18 persist. Pickers-every-swatch
// skipped Size as "Width already D-05". UL-35 start # was wired-only.
// Do not replay series Delete / UL-31 Continue pin / cloud bump.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const COUNTER_PRESETS = [5, 8, 12, 16, 24, 32, 48, 64];

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
      // Counters stamp data.id (render identity). __phase35GetAnnotationById
      // only matches obj.id, so radius must come from the live SVG path
      // (`A r,r` in renderCounter). Default render fallback is 14.
      const pathD = host?.querySelector('path')?.getAttribute('d') || '';
      const arc = /A\s+([\d.]+),([\d.]+)/.exec(pathD);
      const svgR = arc ? Number(arc[1]) : 0;
      const found = object && Object.keys(object).length > 0;
      return {
        id,
        type: String(object.type || data.type || (overlayIds.includes(id) ? 'counter' : '')).toLowerCase(),
        tool: String(data.tool || data.type || object.tool || (overlayIds.includes(id) ? 'counter' : '')).toLowerCase(),
        imported: object.isPdfImported === true,
        displayNumber: Number(data.displayNumber ?? label),
        seriesId: data.seriesId || null,
        seriesStart: data.seriesStart ?? null,
        createdAt: data.createdAt ?? null,
        radius: Number(object.radius ?? data.radius ?? svgR ?? 0),
        svgR,
        foundById: found,
        objectKeys: found ? Object.keys(object).sort() : [],
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

async function counterSnapshot(page) {
  return (await userAnnotationSnapshot(page))
    .filter(isCounterRow)
    .sort((a, b) => {
      const at = a.createdAt || 0;
      const bt = b.createdAt || 0;
      if (at !== bt) return at - bt;
      return (a.displayNumber || 0) - (b.displayNumber || 0);
    });
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

async function sizeField(page) {
  return page.getByRole('textbox', { name: 'Size', exact: true });
}

async function setSizeTyped(page, raw) {
  const field = await sizeField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
  await field.press('Enter');
}

async function pickSizePreset(page, preset) {
  const trigger = page.getByRole('button', { name: 'Size presets', exact: true });
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-size-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: String(preset), exact: true });
  if (await option.count()) {
    await option.click();
    return;
  }
  await popover.getByText(String(preset), { exact: true }).click();
}

async function storedRadius(page, id) {
  const rows = await counterSnapshot(page);
  const row = rows.find((item) => item.id === id);
  return row?.svgR || row?.radius || 0;
}

async function startField(page) {
  return page.getByRole('textbox', { name: 'Counter start number', exact: true });
}

async function setStart(page, raw) {
  const field = await startField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await expect(field).toBeEnabled();
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
  await field.press('Enter');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

test('counter Size catalog + Start number intended + break + edge', async ({ page }) => {
  const hunts = [];
  await openEditor(page);

  await activateCounter(page);
  const size = await sizeField(page);
  await expect(size).toBeVisible({ timeout: 8_000 });
  hunts.push({ hunt: 'intended — Counter arm reveals Size (not Width / D-05)', pass: true });

  await pickSizePreset(page, 5);
  await expect(size).toHaveValue('5');
  const pin1 = await dropPin(page, { xf: 0.34, yf: 0.34 });
  await expect.poll(async () => storedRadius(page, pin1.id), {
    message: 'armed Size 5 must store radius 5 on the first pin',
  }).toBe(5);
  hunts.push({
    hunt: 'intended — armed Size 5 drops a pin with radius 5',
    pass: true,
    id: pin1.id,
  });

  await selectPin(page, pin1.id);
  await expect(size).toBeVisible();
  await expect(await startField(page)).toBeEnabled();

  const proven = [];
  let svgAtFive = 0;
  for (const preset of COUNTER_PRESETS) {
    await pickSizePreset(page, preset);
    await expect.poll(async () => storedRadius(page, pin1.id), {
      message: `Size preset ${preset} must store radius=${preset}`,
    }).toBe(preset);
    await expect(size).toHaveValue(String(preset));
    if (preset === 5) {
      svgAtFive = (await counterSnapshot(page)).find((row) => row.id === pin1.id)?.svgR || 0;
    }
    proven.push(preset);
  }
  expect(proven).toEqual(COUNTER_PRESETS);
  const atSixtyFour = (await counterSnapshot(page)).find((row) => row.id === pin1.id);
  expect(atSixtyFour.svgR, 'preset 64 should change the live SVG r').toBeGreaterThan(svgAtFive);
  hunts.push({
    hunt: 'intended — every Size preset 5/8/12/16/24/32/48/64 stores radius on the selected pin',
    pass: true,
    proven,
    svgAtFive,
    svgAt64: atSixtyFour.svgR,
  });

  await setSizeTyped(page, 16);
  await expect.poll(async () => storedRadius(page, pin1.id)).toBe(16);

  await size.click();
  await size.fill('abc');
  await size.press('Enter');
  expect(await size.inputValue()).toBe('16');
  expect(await storedRadius(page, pin1.id)).toBe(16);
  hunts.push({ hunt: 'break — letters are rejected; radius stays 16', pass: true });

  await setSizeTyped(page, 3);
  await expect.poll(async () => storedRadius(page, pin1.id)).toBe(4);
  await expect(size).toHaveValue('4');
  hunts.push({ hunt: 'break — 3 clamps to COUNTER_SIZE_MIN 4', pass: true });

  await setSizeTyped(page, 0);
  await expect.poll(async () => storedRadius(page, pin1.id)).toBe(4);
  await expect(size).toHaveValue('4');
  hunts.push({ hunt: 'break — 0 clamps to 4', pass: true });

  await setSizeTyped(page, 77);
  await expect.poll(async () => storedRadius(page, pin1.id)).toBe(76);
  await expect(size).toHaveValue('76');
  hunts.push({ hunt: 'break — 77 clamps to COUNTER_SIZE_MAX 76', pass: true });

  await setSizeTyped(page, 999);
  await expect.poll(async () => storedRadius(page, pin1.id)).toBe(76);
  await expect(size).toHaveValue('76');
  hunts.push({ hunt: 'break — 999 clamps to 76', pass: true });

  await size.click();
  await size.fill('');
  await size.press('Enter');
  await expect.poll(async () => storedRadius(page, pin1.id)).toBe(4);
  await expect(size).toHaveValue('4');
  hunts.push({ hunt: 'edge — empty Size commits 4', pass: true });

  await setSizeTyped(page, 12);
  await expect.poll(async () => storedRadius(page, pin1.id)).toBe(12);

  const start = await startField(page);
  await expect(start).toBeEnabled();
  expect(await start.inputValue()).toBe('1');
  await setStart(page, 10);
  await expect.poll(async () => {
    const row = (await counterSnapshot(page)).find((r) => r.id === pin1.id);
    return row?.displayNumber;
  }).toBe(10);
  await expect(start).toHaveValue('10');
  hunts.push({ hunt: 'intended — Start 10 renumbers the lone pin label to 10', pass: true });

  await start.click();
  await start.fill('abc');
  await start.press('Enter');
  await expect.poll(async () => {
    const row = (await counterSnapshot(page)).find((r) => r.id === pin1.id);
    return row?.displayNumber;
  }).toBe(1);
  hunts.push({
    hunt: 'break — Start letters strip to empty then commit 1',
    pass: true,
    afterLetters: await start.inputValue(),
  });

  await setStart(page, 0);
  await expect.poll(async () => {
    const row = (await counterSnapshot(page)).find((r) => r.id === pin1.id);
    return row?.displayNumber;
  }).toBe(1);
  await expect(start).toHaveValue('1');
  hunts.push({ hunt: 'break — Start 0 clamps to 1', pass: true });

  await start.click();
  await start.fill('');
  await start.press('Enter');
  await expect.poll(async () => {
    const row = (await counterSnapshot(page)).find((r) => r.id === pin1.id);
    return row?.displayNumber;
  }).toBe(1);
  await expect(start).toHaveValue('1');
  hunts.push({ hunt: 'edge — empty Start commits 1', pass: true });

  await setStart(page, 7);
  await expect.poll(async () => {
    const row = (await counterSnapshot(page)).find((r) => r.id === pin1.id);
    return row?.displayNumber;
  }).toBe(7);

  await activateCounter(page);
  const pin2 = await dropPin(page, { xf: 0.52, yf: 0.34 });
  const two = (await counterSnapshot(page)).sort((a, b) => a.displayNumber - b.displayNumber);
  expect(two.map((row) => row.displayNumber)).toEqual([7, 8]);
  expect(new Set(two.map((row) => row.seriesId)).size).toBe(1);
  hunts.push({
    hunt: 'edge — second pin after Start 7 is 8 (same series)',
    pass: true,
    numbers: two.map((row) => row.displayNumber),
    pin2: pin2.id,
  });

  await selectPin(page, pin1.id);
  const locked = await startField(page);
  await expect(locked).toBeDisabled();
  hunts.push({ hunt: 'break — Start locks after a second pin', pass: true });

  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await expect(size).toHaveCount(0);
  hunts.push({ hunt: 'edge — Pen hides Counter Size / Start (not a Width field)', pass: true });

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);
  console.log('COUNTER_SIZE_START_PROOF', JSON.stringify({ hunts, fileId, proven }));
});
