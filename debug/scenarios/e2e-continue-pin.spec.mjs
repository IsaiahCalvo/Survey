import { test, expect } from '@playwright/test';

// UL-31 Continue pin — dedicated intended+break+edge.
// Cluster e2e-context-menu-spaces only re-armed [data-counter-overlay].
// Not series-list Delete, Size/Start, nubbin, bbox, or leftover-18.
// Overlay-gated: while Counter is armed the page overlay owns right-click.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { fixture = LINK_PDF, width = 1440, height = 900 } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
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

async function menuLabels(page) {
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  return menu.evaluate((el) => (
    [...el.querySelectorAll('div, button, [role="menuitem"]')]
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean)
  ));
}

async function rightClickPin(page, id) {
  const host = page.locator(
    `[data-counter-overlay="1"] [data-anno-id="${id}"], [data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`
  ).first();
  await expect(host).toBeVisible({ timeout: 8_000 });
  const box = await host.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
}

async function clickContinuePin(page) {
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText('Continue pin', { exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();
}

async function clickNewCount(page) {
  const seriesBtn = page.getByRole('button', { name: 'Counter series' });
  await expect(seriesBtn).toBeVisible({ timeout: 8_000 });
  await seriesBtn.click();
  const neu = page.getByRole('button', { name: '+ New Count', exact: true })
    .or(page.getByText('+ New Count', { exact: true }));
  await expect(neu.first()).toBeVisible({ timeout: 8_000 });
  await neu.first().click();
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();
}

async function dismissMenu(page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);
}

async function armPen(page) {
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) await pen.click();
  await expect.poll(async () => String(await pen.getAttribute('class') || '')).toMatch(/btn-active/);
}

test('UL-31 Continue pin intended + break + edge', async ({ page }) => {
  const stubLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[AnnotCtxMenu] continuePin') || text.includes('continuePin')) stubLogs.push(text);
  });

  // Hunt: hubPreview has no Continue pin (editor chrome only).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HUB);
  await expect(page.getByRole('button', { name: 'Documents', exact: true })).toBeVisible({ timeout: 30_000 });
  for (const tab of ['Documents', 'Projects', 'Templates', 'Archive']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
  }
  expect(await page.getByText('Continue pin', { exact: true }).count()).toBe(0);
  expect(await page.locator('[data-annotation-context-menu="true"]').count()).toBe(0);
  expect(await page.locator('[data-counter-overlay]').count()).toBe(0);

  await openEditor(page);
  await activateCounter(page);

  const pinA1 = await dropPin(page, { xf: 0.32, yf: 0.30 });
  const afterA = await waitForPinCount(page, 1);
  expect(afterA[0].seriesId).toBeTruthy();
  const seriesA = afterA[0].seriesId;
  expect(afterA[0].displayNumber).toBe(1);

  await clickNewCount(page);
  const pinB1 = await dropPin(page, { xf: 0.62, yf: 0.30 });
  const twoSeries = await waitForPinCount(page, 2);
  const seriesB = twoSeries.find((row) => row.id === pinB1.id)?.seriesId;
  expect(seriesB, 'New Count mint a second series').toBeTruthy();
  expect(seriesB).not.toBe(seriesA);
  expect(twoSeries.map((row) => row.displayNumber)).toEqual([1, 1]);

  // Intended — Continue pin on series A after New Count / series B.
  await rightClickPin(page, pinA1.id);
  const pinLabels = await menuLabels(page);
  expect(pinLabels).toContain('Continue pin');
  expect(pinLabels.some((label) => label === 'Delete')).toBeFalsy();
  await clickContinuePin(page);
  expect(stubLogs.some((line) => line.includes('[AnnotCtxMenu] continuePin'))).toBeFalsy();
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

  // Break — Counter-armed empty overlay still offers Continue pin (not Paste).
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.82, { button: 'right' });
  const emptyArmedLabels = await menuLabels(page);
  expect(emptyArmedLabels).toContain('Continue pin');
  expect(emptyArmedLabels.some((label) => label === 'Paste')).toBeFalsy();
  await dismissMenu(page);
  expect((await waitForPinCount(page, 3)).length).toBe(3);

  // Break — already-on-series Continue pin re-arms, does not mint a series.
  await rightClickPin(page, pinA2.id);
  await clickContinuePin(page);
  const stillThree = await waitForPinCount(page, 3);
  expect(new Set(stillThree.map((row) => row.seriesId)).size).toBe(2);
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();

  // Break — Select-armed pin is the shape menu, not Continue pin.
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await expect(page.locator('[data-counter-overlay="1"]')).toHaveCount(0);
  await rightClickPin(page, pinA1.id);
  const selectLabels = await menuLabels(page);
  expect(selectLabels).toContain('Delete');
  expect(selectLabels.some((label) => label === 'Continue pin')).toBeFalsy();
  await dismissMenu(page);

  // Break — empty page with Select is Paste-only.
  await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.82, { button: 'right' });
  const emptySelectLabels = await menuLabels(page);
  expect(emptySelectLabels).toContain('Paste');
  expect(emptySelectLabels.some((label) => label === 'Continue pin')).toBeFalsy();
  await dismissMenu(page);

  // Break — Pen-armed hides the overlay; Continue pin is gone.
  await armPen(page);
  await expect(page.locator('[data-counter-overlay="1"]')).toHaveCount(0);
  await rightClickPin(page, pinB1.id);
  const penLabels = await menuLabels(page);
  expect(penLabels.some((label) => label === 'Continue pin')).toBeFalsy();
  await dismissMenu(page);

  // Edge — undo the Continue-placed pin; series B stays.
  await activateCounter(page);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled({ timeout: 8_000 });
  await undo.click();
  const afterUndo = await waitForPinCount(page, 2);
  expect(afterUndo.map((row) => row.id)).not.toContain(pinA2.id);
  expect(afterUndo.find((row) => row.id === pinB1.id)?.seriesId).toBe(seriesB);
  expect(afterUndo.find((row) => row.id === pinA1.id)?.seriesId).toBe(seriesA);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  expect(viewBox).toMatch(/^0 0 /);

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  // Edge — 390 uses the same overlay Continue pin (no distinct long-press).
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await activateCounter(page);
  const mobileA = await dropPin(page, { xf: 0.40, yf: 0.34 });
  await clickNewCount(page);
  const mobileB = await dropPin(page, { xf: 0.62, yf: 0.34 });
  const mobileTwo = await waitForPinCount(page, 2);
  const mobileSeriesA = mobileTwo.find((row) => row.id === mobileA.id)?.seriesId;
  const mobileSeriesB = mobileTwo.find((row) => row.id === mobileB.id)?.seriesId;
  expect(mobileSeriesA).toBeTruthy();
  expect(mobileSeriesB).toBeTruthy();
  expect(mobileSeriesB).not.toBe(mobileSeriesA);
  await rightClickPin(page, mobileA.id);
  const mobileLabels = await menuLabels(page);
  expect(mobileLabels).toContain('Continue pin');
  await clickContinuePin(page);
  const mobileA2 = await dropPin(page, { xf: 0.40, yf: 0.54 });
  const mobileAfter = await waitForPinCount(page, 3);
  expect(mobileAfter.filter((row) => row.seriesId === mobileSeriesA).map((row) => row.displayNumber)).toEqual([1, 2]);
  expect(mobileAfter.find((row) => row.id === mobileB.id)?.seriesId).toBe(mobileSeriesB);
  expect(mobileA2.seriesId).toBe(mobileSeriesA);
  await assertNoErrorBoundary(page);

  console.log('CONTINUE_PIN_PROOF', JSON.stringify({
    hubContinuePin: 0,
    pinA1: pinA1.id,
    pinB1: pinB1.id,
    pinA2: pinA2.id,
    seriesA,
    seriesB,
    afterContinueA: seriesAPins.map((row) => ({ id: row.id, n: row.displayNumber })),
    pinLabels,
    emptyArmedLabels,
    selectLabels,
    emptySelectLabels,
    penLabels,
    stubLogs,
    viewBox,
    fileId,
    mobile: {
      a: mobileA.id,
      b: mobileB.id,
      a2: mobileA2.id,
      labels: mobileLabels,
    },
  }));
});
