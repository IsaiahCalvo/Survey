import { test, expect } from '@playwright/test';

// Product bug leftover the Counter Start 390 inspect parked: desktop
// series-list Delete was live (UL-35 / e2e-counter-series-delete). 390
// Counter Series menu had + New Count + Continue Count only. Distinct
// from pin Delete, Continue Count switch, leftover-18 / X-01. Do not
// stamp file.id.

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
      const bt = b.createdAt ?? 0;
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

async function clickNewCount(page) {
  const menu = await openSeriesMenu(page);
  const neu = menu.getByRole('button', { name: '+ New Count', exact: true });
  await expect(neu).toBeVisible({ timeout: 8_000 });
  await neu.click();
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();
}

async function undoOnce(page) {
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled({ timeout: 8_000 });
  await undo.click();
}

test('390 Counter series Delete intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  const hunts = [];

  await openEditor(page, { width: 390, height: 844 });
  const closePages = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await page.getByText('No documents yet').isVisible().catch(() => false) && await closePages.isVisible().catch(() => false)) {
    await closePages.click();
    await expect(page.getByText('No documents yet')).toHaveCount(0);
  }

  await activateCounter(page);
  const emptyMenu = await openSeriesMenu(page);
  expect(await emptyMenu.getByRole('button', { name: '+ New Count', exact: true }).count()).toBe(1);
  expect(await emptyMenu.locator('[data-counter-series-delete]').count()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(emptyMenu).toHaveCount(0);
  hunts.push({ hunt: 'break — 390 empty-armed Delete 0', pass: true });

  const pinA1 = await dropPin(page, { xf: 0.36, yf: 0.32 });
  const pinA2 = await dropPin(page, { xf: 0.52, yf: 0.32 });
  const pinA3 = await dropPin(page, { xf: 0.68, yf: 0.32 });
  const seriesA = (await waitForPinCount(page, 3))[0].seriesId;
  expect(seriesA).toBeTruthy();

  const menuA = await openSeriesMenu(page);
  const deleteA = menuA.locator('[data-counter-series-delete]').first();
  await expect(deleteA).toBeVisible({ timeout: 8_000 });
  await deleteA.click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 8_000 });
  await expect(confirm).toContainText(/Delete .*count/i);
  hunts.push({
    hunt: 'intended — 390 series Delete opens confirm',
    pass: true,
    ids: [pinA1.id, pinA2.id, pinA3.id],
  });

  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect((await waitForPinCount(page, 3)).map((row) => row.id)).toEqual(
    expect.arrayContaining([pinA1.id, pinA2.id, pinA3.id]),
  );
  hunts.push({ hunt: 'break — 390 Cancel keeps the 3-pin series', pass: true });

  const menuA2 = await openSeriesMenu(page);
  await menuA2.locator('[data-counter-series-delete]').first().click();
  const confirm2 = page.getByRole('dialog');
  await expect(confirm2).toBeVisible({ timeout: 8_000 });
  await confirm2.getByRole('button', { name: 'Delete count', exact: true }).click();
  await expect.poll(async () => (await counterSnapshot(page)).length, {
    message: '390 series Delete must wipe every pin',
  }).toBe(0);
  hunts.push({ hunt: 'intended — 390 Delete count wipes the 3-pin series', pass: true });

  await undoOnce(page);
  expect((await waitForPinCount(page, 3)).map((row) => row.displayNumber)).toEqual([1, 2, 3]);
  hunts.push({ hunt: 'edge — 390 undo restores 1,2,3', pass: true });

  await clickNewCount(page);
  const pinB1 = await dropPin(page, { xf: 0.40, yf: 0.54 });
  const twoSeries = await waitForPinCount(page, 4);
  const seriesB = twoSeries.find((row) => row.id === pinB1.id)?.seriesId;
  expect(seriesB).toBeTruthy();
  expect(seriesB).not.toBe(seriesA);

  const menuTwo = await openSeriesMenu(page);
  expect(await menuTwo.locator('[data-counter-series-delete]').count()).toBe(2);
  await menuTwo.getByRole('button', { name: 'Delete Count 1', exact: true }).click();
  const confirmB = page.getByRole('dialog');
  await expect(confirmB).toBeVisible({ timeout: 8_000 });
  await confirmB.getByRole('button', { name: 'Delete count', exact: true }).click();
  const afterIsolate = await waitForPinCount(page, 1);
  expect(afterIsolate.map((row) => row.id)).toEqual([pinB1.id]);
  expect(afterIsolate[0].seriesId).toBe(seriesB);
  hunts.push({ hunt: 'break — 390 Delete Count 1 isolates Count 2', pass: true, pinB: pinB1.id });

  await page.getByRole('button', { name: 'Draw', exact: true }).first().click();
  expect(await page.locator('[data-counter-series-delete]').count()).toBe(0);
  expect(await page.locator('.mobile-pdf-properties__menu').count()).toBe(0);
  hunts.push({ hunt: 'edge — 390 Pen hides Delete', pass: true });

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  hunts.push({ hunt: 'edge — viewBox 0 0 612 792; file.id null', pass: true, viewBox, fileId });

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-counter-series-delete]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  hunts.push({ hunt: 'edge — hubPreview Delete 0', pass: true });

  await assertNoErrorBoundary(page);
  console.log('COUNTER_SERIES_DELETE_390_PROOF', JSON.stringify({
    hunts,
    viewBox,
    fileId,
    seriesA,
    seriesB,
    pinB1: pinB1.id,
  }));
});

test('desktop Counter series context Delete still confirms', async ({ page }) => {
  test.setTimeout(180_000);
  const hunts = [];

  await openEditor(page);
  await activateCounter(page);
  const pin = await dropPin(page, { xf: 0.40, yf: 0.36 });
  await waitForPinCount(page, 1);

  const seriesBtn = page.getByRole('button', { name: 'Counter series' });
  await expect(seriesBtn).toBeVisible({ timeout: 8_000 });
  await seriesBtn.click();
  const seriesRow = page.getByRole('button', { name: /1 pins/i }).first();
  await expect(seriesRow).toBeVisible({ timeout: 8_000 });
  await seriesRow.click({ button: 'right' });
  const seriesMenu = page.locator('[data-counter-series-context-menu]');
  await expect(seriesMenu).toBeVisible({ timeout: 8_000 });
  await seriesMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 8_000 });
  await confirm.getByRole('button', { name: 'Delete count', exact: true }).click();
  await expect.poll(async () => (await counterSnapshot(page)).length).toBe(0);
  hunts.push({ hunt: 'intended — desktop context Delete still wipes', pass: true, id: pin.id });

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);
  console.log('COUNTER_SERIES_DELETE_DESKTOP_STILL_PROOF', JSON.stringify({ hunts, fileId }));
});
