import { test, expect } from '@playwright/test';

// Counter-series Delete execute. Place a 3-pin series, delete one pin
// (keyboard). Pin context menu has Continue pin only — no Delete invented.
// Series-list context menu Delete wipes the whole series (confirm modal).
// leftover-18 parked. Not a replay of UL-31 Continue pin.

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
        seriesId: data.seriesId || null,
        seriesStart: data.seriesStart ?? null,
        createdAt: data.createdAt ?? null,
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

async function waitForPinCount(page, count) {
  let rows = [];
  await expect.poll(async () => {
    rows = await counterSnapshot(page);
    return rows.length;
  }, { message: `expected ${count} counter pins`, timeout: 15_000 }).toBe(count);
  return rows;
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

// Proven 3-pin path from e2e-adversarial-wave8: overlay bbox + settle + short drag.
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

async function clickEmptyPage(page) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.08);
}

async function undoOnce(page) {
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled({ timeout: 8_000 });
  await undo.click();
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

function numbers(rows) {
  return rows.map((row) => row.displayNumber);
}

test('counter-series Delete execute: keyboard pin + series menu', async ({ page }) => {
  const hunts = [];
  await openEditor(page);

  await activateCounter(page);
  const pin1 = await dropPin(page, { xf: 0.34, yf: 0.32 });
  const pin2 = await dropPin(page, { xf: 0.50, yf: 0.32 });
  const pin3 = await dropPin(page, { xf: 0.66, yf: 0.32 });
  const series = await waitForPinCount(page, 3);
  expect(new Set(series.map((row) => row.seriesId)).size, 'one series').toBe(1);
  expect(numbers(series)).toEqual([1, 2, 3]);
  hunts.push({
    hunt: 'intended — 3-pin series numbers 1,2,3',
    pass: true,
    seriesId: series[0].seriesId,
    numbers: numbers(series),
  });

  // Break — Delete with none selected leaves the series.
  await page.keyboard.press('v');
  await clickEmptyPage(page);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  expect(numbers(await waitForPinCount(page, 3))).toEqual([1, 2, 3]);
  hunts.push({ hunt: 'break — Delete with none selected is a no-op', pass: true });

  // Break — Delete while Pen is armed on a selected counter. Product rule:
  // keyboard Delete still removes the selected pin (tool does not own Delete).
  await selectPin(page, pin2.id);
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) await pen.click();
  await expect.poll(async () => String(await pen.getAttribute('class') || '')).toMatch(/btn-active/);
  await page.keyboard.press('Delete');
  const afterPenDelete = await waitForPinCount(page, 2);
  expect(afterPenDelete.map((row) => row.id)).not.toContain(pin2.id);
  expect(numbers(afterPenDelete)).toEqual([1, 2]);
  hunts.push({
    hunt: 'break — Delete while Pen armed on a selected counter still deletes + remaining renumber',
    pass: true,
    remaining: afterPenDelete.map((row) => ({ id: row.id, n: row.displayNumber })),
  });
  await undoOnce(page);
  expect(numbers(await waitForPinCount(page, 3))).toEqual([1, 2, 3]);
  hunts.push({ hunt: 'edge — undo restores the Pen-armed delete', pass: true });

  // Edge — delete first / middle / last of a 3-count series. Product rule:
  // remaining pins renumber by createdAt (seriesStart + index).
  await selectPin(page, pin1.id);
  await page.keyboard.press('Delete');
  const afterFirst = await waitForPinCount(page, 2);
  expect(afterFirst.map((row) => row.id)).not.toContain(pin1.id);
  expect(numbers(afterFirst)).toEqual([1, 2]);
  expect(afterFirst.map((row) => row.id)).toEqual([pin2.id, pin3.id]);
  hunts.push({ hunt: 'edge — delete first: remaining 2,3 become 1,2', pass: true });
  await undoOnce(page);
  expect(numbers(await waitForPinCount(page, 3))).toEqual([1, 2, 3]);

  await selectPin(page, pin2.id);
  await page.keyboard.press('Delete');
  const afterMiddle = await waitForPinCount(page, 2);
  expect(afterMiddle.map((row) => row.id)).not.toContain(pin2.id);
  expect(numbers(afterMiddle)).toEqual([1, 2]);
  expect(afterMiddle.map((row) => row.id)).toEqual([pin1.id, pin3.id]);
  hunts.push({ hunt: 'edge — delete middle: remaining 1,3 become 1,2', pass: true });
  await undoOnce(page);
  expect(numbers(await waitForPinCount(page, 3))).toEqual([1, 2, 3]);

  await selectPin(page, pin3.id);
  await page.keyboard.press('Delete');
  const afterLast = await waitForPinCount(page, 2);
  expect(afterLast.map((row) => row.id)).not.toContain(pin3.id);
  expect(numbers(afterLast)).toEqual([1, 2]);
  expect(afterLast.map((row) => row.id)).toEqual([pin1.id, pin2.id]);
  hunts.push({ hunt: 'edge — delete last: remaining stay 1,2', pass: true });
  await undoOnce(page);
  expect(numbers(await waitForPinCount(page, 3))).toEqual([1, 2, 3]);
  hunts.push({ hunt: 'intended — keyboard Delete removes the selected pin; undo restores + renumbers', pass: true });

  // Pin context menu: Continue pin only. Do not invent pin-level Delete.
  await selectPin(page, pin1.id);
  const pinHost = page.locator(
    `[data-counter-overlay="1"] [data-anno-id="${pin1.id}"], [data-svg-annotation-layer="1"] > g[data-anno-id="${pin1.id}"]`
  ).first();
  const pinBox = await pinHost.boundingBox();
  await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2, { button: 'right' });
  const pinMenu = page.locator('[data-annotation-context-menu="true"]');
  await expect(pinMenu).toBeVisible({ timeout: 8_000 });
  const pinFlat = await pinMenu.evaluate((el) => (
    [...el.querySelectorAll('div')]
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean)
  ));
  expect(pinFlat).toContain('Continue pin');
  expect(pinFlat.some((t) => t === 'Delete')).toBeFalsy();
  await page.keyboard.press('Escape');
  await expect(pinMenu).toHaveCount(0);
  hunts.push({
    hunt: 'edge — pin context menu is Continue pin only (no pin Delete invented)',
    pass: true,
    pinFlat,
  });

  // Series-list context menu Delete executes the whole series (confirm).
  await activateCounter(page);
  const seriesBtn = page.getByRole('button', { name: 'Counter series' });
  await expect(seriesBtn).toBeVisible({ timeout: 8_000 });
  await seriesBtn.click();
  const seriesRow = page.getByRole('button', { name: /3 pins/i }).first();
  await expect(seriesRow).toBeVisible({ timeout: 8_000 });
  await seriesRow.click({ button: 'right' });
  const seriesMenu = page.locator('[data-counter-series-context-menu]');
  await expect(seriesMenu).toBeVisible({ timeout: 8_000 });
  await seriesMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 8_000 });
  await expect(confirm).toContainText(/Delete .*count/i);
  await confirm.getByRole('button', { name: 'Delete count', exact: true }).click();
  await expect.poll(async () => (await counterSnapshot(page)).length, {
    message: 'series Delete must remove every pin',
  }).toBe(0);
  hunts.push({ hunt: 'intended — series context-menu Delete + confirm wipes the 3-pin series', pass: true });

  await undoOnce(page);
  expect(numbers(await waitForPinCount(page, 3))).toEqual([1, 2, 3]);
  hunts.push({ hunt: 'edge — undo restores the wiped series as 1,2,3', pass: true });

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);
  console.log('COUNTER_SERIES_DELETE_PROOF', JSON.stringify({ hunts, fileId }));
});
