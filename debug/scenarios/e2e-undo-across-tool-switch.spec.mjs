import { test, expect } from '@playwright/test';

// Undo after tool-switch — create/transform with A, switch to B, undo
// restores A's last commit and invents 0 B ink. E-05 dedicated the
// create-A-then-B stack (drop B / restore B). This path is the switch
// with no B commit. Distinct from leftover-18 / X-01 / tool-switch
// draft discard / pointercancel / paste-after-zoom. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const RECT_BOX = { x0: 0.20, y0: 0.26, x1: 0.40, y1: 0.44 };

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect';
}

function isPen(row) {
  return row.type === 'path' || row.tool === 'pen' || row.tool === 'freedraw'
    || row.tool === 'highlighter';
}

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

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

async function pageCoveredByHub(page) {
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pageEl.boundingBox();
  if (!box) return false;
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const text = el?.textContent || '';
    return /No documents yet|Upload your first PDF|Search documents/.test(text);
  }, { x: box.x + box.width * 0.45, y: box.y + box.height * 0.40 });
}

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hubCopy = page.getByText('No documents yet');
    if (!(await hubCopy.isVisible().catch(() => false)) && !(await pageCoveredByHub(page))) break;
    const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
    if (await rail.first().isVisible().catch(() => false)) {
      await rail.first().click().catch(() => {});
    } else {
      const tab = page.getByRole('button', { name: /clickable-link-test\.pdf/ }).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click({ position: { x: 24, y: 8 } }).catch(() => {});
      }
    }
    await expect(hubCopy).toHaveCount(0, { timeout: 8_000 });
  }
  await expect.poll(async () => pageCoveredByHub(page), {
    timeout: 8_000,
    message: 'hub Documents must not cover the page',
  }).toBe(false);
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const width = Number(object.width ?? data.width ?? 0);
      const height = Number(object.height ?? data.height ?? 0);
      const scaleX = Number(object.scaleX ?? data.scaleX ?? 1) || 1;
      const scaleY = Number(object.scaleY ?? data.scaleY ?? 1) || 1;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        width,
        height,
        scaleX,
        scaleY,
        vw: width * Math.abs(scaleX),
        vh: height * Math.abs(scaleY),
      };
    }).filter((row) => !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userOwned(page) {
  return (await userAnnotationSnapshot(page)).filter((row) => row.imported !== true);
}

async function allAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
}

async function geom(page, id) {
  return (await userAnnotationSnapshot(page)).find((row) => row.id === id) || null;
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userOwned(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function selectedIds(page) {
  return page.evaluate(() => [...(window.__selectedAnnotationIds || [])]);
}

function toolButtons(page, name) {
  return page.locator(
    `button.btn-icon[aria-label="${name}"], button.mobile-pdf-tools__button[aria-label="${name}"]`,
  );
}

async function clickVisible(page, name) {
  const buttons = toolButtons(page, name);
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    return button;
  }
  const fallback = page.getByRole('button', { name, exact: true });
  await expect(fallback.first(), `visible ${name}`).toBeVisible();
  await fallback.first().click();
  return fallback.first();
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
  await clickVisible(page, categoryName);
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

async function dragOnPage(page, { x0, y0, x1, y1 }) {
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function setNextDrawFill(page, hex = '#00FFFF') {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  if (!(await color.isVisible().catch(() => false))) return false;
  await color.click();
  const picker = page.locator('[data-annotation-color-picker]');
  try {
    await expect(picker).toBeVisible({ timeout: 2_000 });
  } catch {
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
  const fillTab = picker.getByRole('button', { name: 'Fill', exact: true });
  if (await fillTab.count()) await fillTab.click();
  await picker.locator(`button[title="${hex}"]`).first().click();
  await page.keyboard.press('Escape').catch(() => {});
  return true;
}

async function createRect(page, coords) {
  const before = new Set((await userOwned(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await setNextDrawFill(page, '#00FFFF');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRect);
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const scoped = toolButtons(page, 'Select');
  if (await scoped.count() && await scoped.first().isVisible().catch(() => false)) {
    await scoped.first().click();
  }
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
  await expect.poll(async () => {
    const cls = String(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('class') || '');
    return !cls.includes('tool-crosshair');
  }, { timeout: 8_000 }).toBeTruthy();
}

async function clickEmpty(page, { xf = 0.08, yf = 0.08 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
}

async function strokeClickRect(page, id) {
  const hit = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"] [data-shape-hit-target="rect"]`).first();
  await expect(hit).toBeVisible();
  const box = await hit.boundingBox();
  expect(box, `hit bbox for ${id}`).toBeTruthy();
  const before = (await selectedIds(page)).includes(id);
  const points = [
    { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35 },
    { x: box.x + box.width * 0.65, y: box.y + box.height * 0.40 },
    { x: box.x + 6, y: box.y + box.height * 0.30 },
    { x: box.x + box.width * 0.30, y: box.y + 6 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    try {
      await expect.poll(async () => (await selectedIds(page)).includes(id), {
        timeout: 800,
      }).not.toBe(before);
      return;
    } catch { /* try next */ }
  }
  throw new Error(`rect click missed ${id}`);
}

async function selectUntilHandles(page, id, min = 4) {
  await dismissChrome(page);
  await selectMode(page);
  await clickEmpty(page);
  await strokeClickRect(page, id);
  await expect.poll(async () => (await selectedIds(page)).includes(id), { timeout: 8_000 }).toBe(true);
  await expect.poll(async () => page.locator('[data-svg-annotation-layer="1"] [data-resize-handle]').count(), {
    timeout: 8_000,
    message: `selected ${id} must show resize handles`,
  }).toBeGreaterThanOrEqual(min);
}

async function dragResizeHandle(page, handleId, dx, dy) {
  const handle = page.locator(`[data-svg-annotation-layer="1"] [data-resize-handle="${handleId}"]`).first();
  await expect(handle, `${handleId} handle`).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
}

function undoButton(page) {
  return page.getByRole('button', { name: 'Undo', exact: true }).first();
}

function redoButton(page) {
  return page.getByRole('button', { name: 'Redo', exact: true }).first();
}

async function expectHistoryEnabled(page, { undo, redo }) {
  await expect.poll(async () => ({
    undo: await undoButton(page).isEnabled(),
    redo: await redoButton(page).isEnabled(),
  }), { message: `expected undo=${undo} redo=${redo}` }).toEqual({ undo, redo });
}

async function inkCount(page) {
  return (await userOwned(page)).filter(isPen).length;
}

test('desktop undo after tool-switch intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  const importedAtStart = await allAnnotationIds(page);
  expect((await userOwned(page)).length, 'fresh editor must have 0 user marks').toBe(0);
  await expectHistoryEnabled(page, { undo: false, redo: false });

  // Break — empty stack undo / redo invent 0 and hold imported natives.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+y');
  expect(await allAnnotationIds(page), 'empty-stack chords must hold imported ids').toEqual(importedAtStart);
  expect((await userOwned(page)).length).toBe(0);
  await undoButton(page).click({ force: true });
  await redoButton(page).click({ force: true });
  expect(await allAnnotationIds(page), 'disabled toolbar clicks must invent 0').toEqual(importedAtStart);

  const created = await createRect(page, RECT_BOX);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  const createdGeom = await geom(page, created.id);
  expect(createdGeom.vw).toBeGreaterThan(20);

  await selectUntilHandles(page, created.id, 8);
  await dragResizeHandle(page, 'br', 180, 140);
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && now.vw > createdGeom.vw + 10 && now.vh > createdGeom.vh + 8;
  }, { timeout: 8_000, message: `br must grow the live rect from ${createdGeom.vw}x${createdGeom.vh}` }).toBeTruthy();
  const resized = await geom(page, created.id);
  expect(resized.vw, 'br grows width').toBeGreaterThan(createdGeom.vw + 10);
  await expectHistoryEnabled(page, { undo: true, redo: false });

  // Intended — switch to Pen after A's transform. No B ink. Undo still armed.
  await blurInputs(page);
  await activateTool(page, 'Draw', 'Pen');
  await blurInputs(page);
  expect(await inkCount(page), 'tool-switch must invent 0 pen').toBe(0);
  expect((await userOwned(page)).map((row) => row.id), 'tool-switch must keep A').toEqual([created.id]);
  const afterSwitch = await geom(page, created.id);
  expect(Math.abs(afterSwitch.vw - resized.vw)).toBeLessThan(4);
  await expectHistoryEnabled(page, { undo: true, redo: false });

  // Break — redo after tool-switch with empty redo invents 0 B ink.
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+Shift+z');
  expect(await inkCount(page), 'redo after tool-switch must invent 0 pen').toBe(0);
  expect((await userOwned(page)).map((row) => row.id)).toEqual([created.id]);
  const afterEmptyRedo = await geom(page, created.id);
  expect(Math.abs(afterEmptyRedo.vw - resized.vw), 'empty redo must hold the transform').toBeLessThan(4);

  // Intended — Ctrl+Z restores A's last commit (create-time size), not B ink.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && Math.abs(now.vw - createdGeom.vw) < 6;
  }, { timeout: 8_000, message: 'Ctrl+Z after Pen must restore create-time size' }).toBeTruthy();
  expect(await inkCount(page), 'undo after tool-switch must invent 0 pen').toBe(0);
  const undone = await geom(page, created.id);
  expect(undone, 'undo must keep A, not drop it').toBeTruthy();
  expect(Math.abs(undone.vw - createdGeom.vw)).toBeLessThan(6);
  expect(undone.vw, 'undo must not leave the transformed size').toBeLessThan(resized.vw - 8);
  await expectHistoryEnabled(page, { undo: true, redo: true });

  // Intended — redo after the switch restores A's transform, still 0 B ink.
  await page.keyboard.press('Control+y');
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && Math.abs(now.vw - resized.vw) < 6;
  }, { timeout: 8_000, message: 'Ctrl+Y after tool-switch must restore the transform' }).toBeTruthy();
  expect(await inkCount(page), 'redo after undo+switch must invent 0 pen').toBe(0);
  const redone = await geom(page, created.id);
  expect(Math.abs(redone.vw - resized.vw)).toBeLessThan(6);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('UNDO_ACROSS_TOOL_SWITCH_DESKTOP_PROOF', JSON.stringify({
    rectId: created.id,
    createdVw: createdGeom.vw,
    resizedVw: resized.vw,
    undoneVw: undone.vw,
    redoneVw: redone.vw,
    inkAfter: await inkCount(page).catch(() => 0),
    viewBox,
    fileId: null,
  }));
});

test('390 undo after tool-switch intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  const importedAtStart = await allAnnotationIds(page);
  await expectHistoryEnabled(page, { undo: false, redo: false });
  await page.keyboard.press('Control+z');
  expect(await allAnnotationIds(page), '390 empty-stack Ctrl+Z must invent 0').toEqual(importedAtStart);

  const created = await createRect(page, { x0: 0.18, y0: 0.30, x1: 0.52, y1: 0.48 });
  await dismissChrome(page);
  const createdGeom = await geom(page, created.id);
  await selectUntilHandles(page, created.id, 4);
  await dragResizeHandle(page, 'br', 36, 28);
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && now.vw > createdGeom.vw + 6;
  }, { message: '390 br must grow the live rect' }).toBeTruthy();
  const resized = await geom(page, created.id);

  await blurInputs(page);
  await activateTool(page, 'Draw', 'Pen');
  await blurInputs(page);
  expect(await inkCount(page), '390 tool-switch must invent 0 pen').toBe(0);
  await expectHistoryEnabled(page, { undo: true, redo: false });
  await redoButton(page).click({ force: true });
  expect(await inkCount(page), '390 redo after tool-switch must invent 0').toBe(0);

  await undoButton(page).click();
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && Math.abs(now.vw - createdGeom.vw) < 6;
  }, { message: '390 toolbar Undo after Pen must restore create-time size' }).toBeTruthy();
  expect(await inkCount(page), '390 undo after tool-switch must invent 0 pen').toBe(0);
  const undone = await geom(page, created.id);
  expect(undone.vw, '390 undo must not leave the transformed size').toBeLessThan(resized.vw - 4);

  await page.keyboard.press('Control+y');
  await expect.poll(async () => {
    const now = await geom(page, created.id);
    return now && Math.abs(now.vw - resized.vw) < 6;
  }, { message: '390 Ctrl+Y after tool-switch must restore the transform' }).toBeTruthy();
  expect(await inkCount(page), '390 redo must invent 0 pen').toBe(0);

  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('UNDO_ACROSS_TOOL_SWITCH_390_PROOF', JSON.stringify({
    rectId: created.id,
    createdVw: createdGeom.vw,
    resizedVw: resized.vw,
    undoneVw: undone.vw,
    viewBox: await pageViewBox(page),
    fileId: null,
  }));
});
