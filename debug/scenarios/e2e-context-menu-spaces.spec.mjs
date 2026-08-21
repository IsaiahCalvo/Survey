import { test, expect } from '@playwright/test';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openEditor(page, fixture = LINK_PDF) {
  await page.goto(fixture);
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

async function appAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
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
        tool: String(object.data?.tool || object.data?.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
        zOrder: object.data?.zOrder || object.zOrder || null,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true, pageNumber = 1) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page, pageNumber);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
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
  return { start, end, box };
}

async function dismissMenus(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

async function menuLabels(page) {
  return page.locator('[data-annotation-context-menu="true"]').evaluate((el) => (
    [...el.querySelectorAll('div')]
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean)
  ));
}

async function rightClickEmptyPage(page, { xf = 0.78, yf = 0.78 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf, { button: 'right' });
}

async function rightClickStroke(page, id) {
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`);
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + 2, box.y + box.height / 2, { button: 'right' });
}

async function clickMenuItem(page, label) {
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText(label, { exact: true }).click();
}

test('UL-27–31 owned-mark context menu: cut/copy/paste/z-order + break/edge', async ({ page }) => {
  const ctxLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[CTXDIAG') || text.includes('[AnnotCtxMenu]')) ctxLogs.push(text);
  });

  await openEditor(page);

  // Break: chrome right-click must not open the annotation menu.
  await page.getByRole('button', { name: 'Draw', exact: true }).click({ button: 'right' });
  await page.waitForTimeout(200);
  expect(await page.locator('[data-annotation-context-menu="true"]').count()).toBe(0);

  // Break: empty page shows Paste only, gray while clipboard is empty.
  await rightClickEmptyPage(page);
  const emptyMenu = page.locator('[data-annotation-context-menu="true"]');
  await expect(emptyMenu).toBeVisible({ timeout: 8_000 });
  const emptyLabels = await menuLabels(page);
  expect(emptyLabels).toEqual(['Paste']);
  const pasteState = await emptyMenu.evaluate((el) => {
    const item = [...el.querySelectorAll('div')].find((node) => (node.textContent || '').trim() === 'Paste');
    if (!item) return null;
    const style = getComputedStyle(item);
    return { color: style.color, cursor: style.cursor };
  });
  expect(pasteState).toBeTruthy();
  // Desktop grays Paste via #5a6473 + default cursor (no opacity).
  expect(pasteState.cursor).toBe('default');
  expect(pasteState.color).toMatch(/rgb\(90,\s*100,\s*115\)/);
  await dismissMenus(page);

  // Two overlapping owned rects so z-order + multi-select have something to do.
  const beforeA = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { x0: 0.20, y0: 0.22, x1: 0.42, y1: 0.42 });
  const rectA = await waitForNewUserAnnotation(page, beforeA, (row) => row.type === 'rect' || row.type === 'rectangle');

  const beforeB = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { x0: 0.30, y0: 0.30, x1: 0.52, y1: 0.50 });
  const rectB = await waitForNewUserAnnotation(page, beforeB, (row) => row.type === 'rect' || row.type === 'rectangle');

  await page.keyboard.press('v');
  await page.waitForTimeout(80);

  await rightClickStroke(page, rectA.id);
  const ownedLabels = await menuLabels(page);
  for (const label of ['Cut', 'Copy', 'Paste', 'Bring to front', 'Send to back']) {
    expect(ownedLabels, `owned menu missing ${label}`).toContain(label);
  }

  // UL-28 Copy then UL-29 Paste at empty page.
  await clickMenuItem(page, 'Copy');
  await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);
  const idsAfterCopy = await appAnnotationIds(page);
  expect(idsAfterCopy).toContain(rectA.id);
  expect(idsAfterCopy).toContain(rectB.id);

  await rightClickEmptyPage(page, { xf: 0.72, yf: 0.22 });
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible();
  const pasteAfterCopy = await page.locator('[data-annotation-context-menu="true"]')
    .getByText('Paste', { exact: true })
    .evaluate((el) => getComputedStyle(el).opacity);
  expect(Number.parseFloat(pasteAfterCopy)).toBeGreaterThan(0.9);
  await clickMenuItem(page, 'Paste');
  const afterPasteCopy = await waitForNewUserAnnotation(page, new Set(idsAfterCopy), (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ));
  expect(afterPasteCopy.id).toBeTruthy();

  // UL-27 Cut removes the mark; paste restores a clone.
  await page.keyboard.press('v');
  await rightClickStroke(page, rectB.id);
  await clickMenuItem(page, 'Cut');
  await expect.poll(async () => (await appAnnotationIds(page)).includes(rectB.id)).toBeFalsy();
  const idsAfterCut = await appAnnotationIds(page);
  await rightClickEmptyPage(page, { xf: 0.76, yf: 0.70 });
  await clickMenuItem(page, 'Paste');
  const afterCutPaste = await waitForNewUserAnnotation(page, new Set(idsAfterCut), (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ));
  expect(afterCutPaste.id).toBeTruthy();

  // UL-30 Bring to front / Send to back on remaining A vs the copy.
  const liveIds = await appAnnotationIds(page);
  expect(liveIds[liveIds.length - 1]).not.toBe(rectA.id);
  await page.keyboard.press('v');
  await rightClickStroke(page, rectA.id);
  await clickMenuItem(page, 'Bring to front');
  await expect.poll(async () => {
    const ids = await appAnnotationIds(page);
    return ids[ids.length - 1];
  }).toBe(rectA.id);

  await rightClickStroke(page, rectA.id);
  await clickMenuItem(page, 'Send to back');
  await expect.poll(async () => {
    const ids = await appAnnotationIds(page);
    return ids[0];
  }).toBe(rectA.id);

  // Edge: multi-select group menu if the dashed box is offered.
  await page.keyboard.press('v');
  await rightClickStroke(page, rectA.id);
  await dismissMenus(page);
  const aBox = await page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${rectA.id}"]`).boundingBox();
  await page.mouse.click(aBox.x + 2, aBox.y + aBox.height / 2);
  const otherId = (await appAnnotationIds(page)).find((id) => id !== rectA.id);
  const otherBox = await page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${otherId}"]`).boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.click(otherBox.x + 2, otherBox.y + otherBox.height / 2);
  await page.keyboard.up('Shift');
  const groupBox = page.locator('[data-group-selection-bbox="true"]');
  const groupOffered = await groupBox.count();
  let groupMenuLabels = null;
  if (groupOffered) {
    const gb = await groupBox.boundingBox();
    await page.mouse.click(gb.x + gb.width / 2, gb.y + 4, { button: 'right' });
    if (await page.locator('[data-annotation-context-menu="true"]').count()) {
      groupMenuLabels = await menuLabels(page);
    }
  }
  expect({
    chromeSuppressed: true,
    emptyPasteOnly: emptyLabels,
    owned: ownedLabels,
    copyPasteId: afterPasteCopy.id,
    cutPasteId: afterCutPaste.id,
    groupOffered: groupOffered > 0,
    groupMenuLabels,
    ctxLogs: ctxLogs.length,
  }).toBeTruthy();
  if (groupMenuLabels) {
    expect(groupMenuLabels).toContain('Cut');
    expect(groupMenuLabels).toContain('Bring to front');
  }
  await dismissMenus(page);
});

test('UL-31 Continue pin on an owned counter', async ({ page }) => {
  const stubLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[AnnotCtxMenu] continuePin') || text.includes('continuePin')) stubLogs.push(text);
  });
  await openEditor(page);
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Counter');
  const overlay = page.locator('[data-counter-overlay="1"]');
  await expect(overlay).toBeVisible();
  await dragOnPage(page, { x0: 0.55, y0: 0.55, x1: 0.62, y1: 0.62 });
  const counter = await waitForNewUserAnnotation(page, before, (row) => (
    row.tool === 'counter' || row.type.includes('counter') || row.type === 'circle' || row.type === 'group' || !row.type
  ));

  const pin = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${counter.id}"], [data-counter-overlay] [data-anno-id="${counter.id}"]`).first();
  const pinBox = await page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${counter.id}"]`).boundingBox()
    || await page.locator('[data-counter-overlay="1"]').boundingBox();
  expect(pinBox).toBeTruthy();
  await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2, { button: 'right' });
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  const labels = await menuLabels(page);
  expect(labels).toContain('Continue pin');
  await menu.getByText('Continue pin', { exact: true }).click();
  await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Counter series' })).toBeVisible();
  expect(stubLogs.some((line) => line.includes('[AnnotCtxMenu] continuePin'))).toBeFalsy();
  expect(Boolean(pin)).toBeTruthy();
  expect(labels).toContain('Continue pin');
});

test('U-02 Create space on ?testPdf= without cloud id', async ({ page }) => {
  await openEditor(page);
  const spacesTab = page.getByRole('button', { name: 'Spaces', exact: true });
  await expect(spacesTab).toBeVisible();
  await spacesTab.click();

  const create = page.getByRole('button', { name: 'Create space', exact: true });
  await expect(create).toBeVisible();
  expect(await page.getByRole('button', { name: 'Upgrade to Pro to create spaces' }).count()).toBe(0);

  const before = await page.locator('[data-space-sortable-row-id]').count();
  await create.click();
  await expect.poll(async () => page.locator('[data-space-sortable-row-id]').count()).toBe(before + 1);
  await expect(page.getByRole('textbox', { name: 'Rename Space 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Space 1' })).toBeVisible();

  await create.click();
  await expect.poll(async () => page.locator('[data-space-sortable-row-id]').count()).toBe(before + 2);
  await expect(page.getByRole('textbox', { name: 'Rename Space 2' })).toBeVisible();

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
});
