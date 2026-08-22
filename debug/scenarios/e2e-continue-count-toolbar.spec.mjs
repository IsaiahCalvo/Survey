import { test, expect } from '@playwright/test';

// UL-35 toolbar Continue Count series-row — dedicated intended+break+edge.
// Distinct from UL-31 overlay Continue pin, New Count mint, Size/Start,
// and series-list Delete. Cluster UL-35 listed the row; Size/Start/Delete
// were the dedicated slices. Continue pin used New Count as setup only.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { fixture = LINK_PDF, width = 1440, height = 900 } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('annotationsByPage_') || key.startsWith('cloudRenderAnnotationsByPage_'))) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
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
      const pages = window.__diagState?.annotationsByPage || {};
      const objects = Object.values(pages).flatMap((row) => row?.objects || []);
      const object = objects.find((row) => (
        String(row?.id || '') === String(id)
        || String(row?.data?.id || '') === String(id)
      )) || window.__phase35GetAnnotationById?.(id) || {};
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

async function openSeriesMenu(page) {
  const seriesBtn = page.getByRole('button', { name: 'Counter series' })
    .or(page.locator('[data-mobile-tool-properties="true"] button[aria-expanded]').first());
  await expect(seriesBtn.first()).toBeVisible({ timeout: 8_000 });
  await seriesBtn.first().click();
  const menu = page.locator('[data-annotation-dropdown-popover="true"][data-counter-series-menu="true"]')
    .or(page.locator('.mobile-pdf-properties__menu'));
  await expect(menu.first()).toBeVisible({ timeout: 8_000 });
  return menu.first();
}

async function seriesMenuRows(page, { dismiss = true } = {}) {
  const menu = await openSeriesMenu(page);
  const rows = await menu.evaluate((el) => (
    [...el.querySelectorAll('button')]
      .map((node) => ({
        label: (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim(),
        active: node.classList.contains('is-active'),
      }))
      .filter((row) => /\d+\s+pins?/i.test(row.label) || /Count\s+\d+/i.test(row.label))
  ));
  const continueCount = await menu.getByText('Continue Count', { exact: true }).count();
  const newCount = await menu.getByRole('button', { name: '+ New Count', exact: true }).count();
  if (dismiss) {
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }
  return { rows, continueCount, newCount, menu };
}

async function clickContinueCountRow(page, matcher) {
  const menu = await openSeriesMenu(page);
  const row = menu.locator('button').filter({ hasText: matcher }).first();
  await expect(row).toBeVisible({ timeout: 8_000 });
  await row.click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();
}

async function clickNewCount(page) {
  const menu = await openSeriesMenu(page);
  const neu = menu.getByRole('button', { name: '+ New Count', exact: true });
  await expect(neu).toBeVisible({ timeout: 8_000 });
  await neu.click();
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();
}

async function armPen(page) {
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) await pen.click();
  await expect.poll(async () => String(await pen.getAttribute('class') || '')).toMatch(/btn-active/);
}

test('UL-35 toolbar Continue Count intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HUB);
  await expect(page.getByRole('button', { name: 'Documents', exact: true })).toBeVisible({ timeout: 30_000 });
  for (const tab of ['Documents', 'Projects', 'Templates', 'Archive']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
  }
  expect(await page.getByText('Continue Count', { exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Counter series' }).count()).toBe(0);

  await openEditor(page);
  await activateCounter(page);

  const emptyMenu = await seriesMenuRows(page);
  expect(emptyMenu.newCount).toBe(1);
  expect(emptyMenu.continueCount).toBe(0);
  expect(emptyMenu.rows).toHaveLength(0);

  const pinA1 = await dropPin(page, { xf: 0.32, yf: 0.30 });
  const afterA = await waitForPinCount(page, 1);
  const seriesA = afterA[0].seriesId;
  expect(seriesA).toBeTruthy();
  expect(afterA[0].displayNumber).toBe(1);

  const onePinMenu = await seriesMenuRows(page);
  expect(onePinMenu.continueCount).toBe(1);
  expect(onePinMenu.rows.some((row) => /Count 1/i.test(row.label) && row.active)).toBeTruthy();

  await clickNewCount(page);
  const pinB1 = await dropPin(page, { xf: 0.62, yf: 0.30 });
  const twoSeries = await waitForPinCount(page, 2);
  const seriesB = twoSeries.find((row) => row.id === pinB1.id)?.seriesId;
  expect(seriesB, 'New Count mint a second series').toBeTruthy();
  expect(seriesB).not.toBe(seriesA);
  expect(twoSeries.map((row) => row.displayNumber)).toEqual([1, 1]);

  const twoMenu = await seriesMenuRows(page);
  expect(twoMenu.continueCount).toBe(1);
  expect(twoMenu.rows.filter((row) => /Count\s+\d+/i.test(row.label))).toHaveLength(2);
  expect(twoMenu.rows.some((row) => /Count 2/i.test(row.label) && row.active)).toBeTruthy();

  // Intended — toolbar Continue Count → Count 1 after New Count / series B.
  await clickContinueCountRow(page, /Count 1/);
  expect(await page.getByText('Continue pin', { exact: true }).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Counter series' })).toBeVisible();

  const pinA2 = await dropPin(page, { xf: 0.32, yf: 0.52 });
  const afterContinue = await waitForPinCount(page, 3);
  const seriesAPins = afterContinue.filter((row) => row.seriesId === seriesA);
  const seriesBPins = afterContinue.filter((row) => row.seriesId === seriesB);
  expect(seriesAPins.map((row) => row.displayNumber)).toEqual([1, 2]);
  expect(seriesAPins.map((row) => row.id)).toEqual(expect.arrayContaining([pinA1.id, pinA2.id]));
  expect(seriesBPins).toHaveLength(1);
  expect(seriesBPins[0].id).toBe(pinB1.id);
  expect(seriesBPins[0].displayNumber).toBe(1);
  const menuAfter = await seriesMenuRows(page);
  expect(menuAfter.rows.some((row) => /Count 1/i.test(row.label) && /2 pins?/i.test(row.label) && row.active)).toBeTruthy();
  expect(menuAfter.rows.some((row) => /Count 2/i.test(row.label) && /1 pins?/i.test(row.label) && !row.active)).toBeTruthy();

  // Break — already-active Continue Count re-arms, does not mint a series.
  await clickContinueCountRow(page, /Count 1/);
  const stillThree = await waitForPinCount(page, 3);
  expect(new Set(stillThree.map((row) => row.seriesId)).size).toBe(2);
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();

  // Break — Select-armed hides Counter series / Continue Count.
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await expect(page.locator('[data-counter-overlay="1"]')).toHaveCount(0);
  expect(await page.getByRole('button', { name: 'Counter series' }).count()).toBe(0);
  expect(await page.getByText('Continue Count', { exact: true }).count()).toBe(0);

  // Break — Pen-armed hides Counter series / Continue Count.
  await armPen(page);
  await expect(page.locator('[data-counter-overlay="1"]')).toHaveCount(0);
  expect(await page.getByRole('button', { name: 'Counter series' }).count()).toBe(0);
  expect(await page.getByText('Continue Count', { exact: true }).count()).toBe(0);

  // Edge — switch back to B, next pin stays on B; undo drops only that pin.
  await activateCounter(page);
  await clickContinueCountRow(page, /Count 2/);
  const pinB2 = await dropPin(page, { xf: 0.62, yf: 0.52 });
  const four = await waitForPinCount(page, 4);
  expect(four.filter((row) => row.seriesId === seriesB).map((row) => row.displayNumber)).toEqual([1, 2]);
  expect(four.filter((row) => row.seriesId === seriesA)).toHaveLength(2);

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled({ timeout: 8_000 });
  await undo.click();
  const afterUndo = await waitForPinCount(page, 3);
  expect(afterUndo.map((row) => row.id)).not.toContain(pinB2.id);
  expect(afterUndo.find((row) => row.id === pinB1.id)?.seriesId).toBe(seriesB);
  expect(afterUndo.filter((row) => row.seriesId === seriesA)).toHaveLength(2);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  expect(viewBox).toMatch(/^0 0 /);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  // Edge — 390 uses the same Continue Count list (series label trigger).
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await activateCounter(page);
  const mobileA = await dropPin(page, { xf: 0.40, yf: 0.34 });
  await clickNewCount(page);
  const mobileB = await dropPin(page, { xf: 0.62, yf: 0.34 });
  expect(mobileB.seriesId).not.toBe(mobileA.seriesId);
  await clickContinueCountRow(page, /Count 1/);
  const mobileA2 = await dropPin(page, { xf: 0.40, yf: 0.54 });
  const mobileAfter = await waitForPinCount(page, 3);
  expect(mobileAfter.filter((row) => row.seriesId === mobileA.seriesId).map((row) => row.displayNumber)).toEqual([1, 2]);
  expect(mobileAfter.filter((row) => row.seriesId === mobileB.seriesId)).toHaveLength(1);
  expect(mobileA2.seriesId).toBe(mobileA.seriesId);
  expect(await page.getByText('Continue pin', { exact: true }).count()).toBe(0);
  await assertNoErrorBoundary(page);

  console.log('CONTINUE_COUNT_TOOLBAR_PROOF', JSON.stringify({
    hubContinueCount: 0,
    emptyContinueCount: emptyMenu.continueCount,
    pinA1: pinA1.id,
    pinB1: pinB1.id,
    pinA2: pinA2.id,
    pinB2: pinB2.id,
    seriesA,
    seriesB,
    afterContinueA: seriesAPins.map((row) => ({ id: row.id, n: row.displayNumber })),
    menuAfter: menuAfter.rows,
    viewBox,
    fileId,
    mobile: {
      a: mobileA.id,
      b: mobileB.id,
      a2: mobileA2.id,
    },
  }));
});
