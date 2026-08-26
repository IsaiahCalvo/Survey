import { test, expect } from '@playwright/test';

// E-05 Undo / Redo stack — intended + break + edge.
// Unique leftover keyboard chord family after the 2026-08-21 sample matrix
// (tool letters / Delete / z-order / Ctrl+F / Esc). Overlay does not list
// Undo/Redo. Prior E-05 was window smoke (toolbar count only). Style /
// spaces / survey specs only used Undo as an edge. Not leftover-18.
// Distinct from P1-45 bookmark undo, keyboard Delete, and Cut/Copy/Paste.
// Chords: Ctrl+Z undo; Ctrl+Shift+Z + Ctrl+Y redo. Toolbar stays in sync.
// Do not stamp file.id.

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

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  return raw || '';
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id, index) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        index,
        type: String(object.type || object.data?.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function allAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
}

async function userOrder(page) {
  return (await userAnnotationSnapshot(page)).map((row) => row.id);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle';
}

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
  });
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
  await page.getByRole('button', { name: categoryName, exact: true }).first().click();
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
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

async function createRect(page, coords) {
  const before = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRect);
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

async function expectUserIds(page, ids, message) {
  await expect.poll(async () => userOrder(page), { message }).toEqual(ids);
}

test('desktop undo/redo stack intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const importedAtStart = await allAnnotationIds(page);
  expect(await userOrder(page), 'fresh editor must have 0 user marks').toEqual([]);
  await expectHistoryEnabled(page, { undo: false, redo: false });

  // Break — empty stack chords / toolbar do not invent or drop imported natives.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+Alt+z');
  expect(await allAnnotationIds(page), 'empty-stack chords must hold imported ids').toEqual(importedAtStart);
  expect(await userOrder(page)).toEqual([]);
  await undoButton(page).click({ force: true });
  await redoButton(page).click({ force: true });
  expect(await allAnnotationIds(page), 'disabled toolbar clicks must invent 0').toEqual(importedAtStart);

  // Overlay lists tools plus the live Undo / Redo chords next to Save.
  await blurInputs(page);
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText).toMatch(/Pen/);
  expect(overlayText).toMatch(/Esc/);
  expect(overlayText).toMatch(/\bUndo\b/);
  expect(overlayText).toMatch(/\bRedo\b/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);

  const rectA = await createRect(page, { x0: 0.16, y0: 0.22, x1: 0.36, y1: 0.40 });
  await expectHistoryEnabled(page, { undo: true, redo: false });
  const rectB = await createRect(page, { x0: 0.52, y0: 0.28, x1: 0.74, y1: 0.48 });
  await blurInputs(page);
  await expectUserIds(page, [rectA.id, rectB.id], 'intended create A then B');
  await expectHistoryEnabled(page, { undo: true, redo: false });

  // Intended — Ctrl+Z pops B; A stays. Redo enables.
  await page.keyboard.press('Control+z');
  await expectUserIds(page, [rectA.id], 'Ctrl+Z must drop B and keep A');
  await expectHistoryEnabled(page, { undo: true, redo: true });

  // Intended — Ctrl+Shift+Z is redo.
  await page.keyboard.press('Control+Shift+z');
  await expectUserIds(page, [rectA.id, rectB.id], 'Ctrl+Shift+Z must restore B');

  // Intended — Ctrl+Y is also redo.
  await page.keyboard.press('Control+z');
  await expectUserIds(page, [rectA.id], 'Ctrl+Z again drops B');
  await page.keyboard.press('Control+y');
  await expectUserIds(page, [rectA.id, rectB.id], 'Ctrl+Y must restore B');

  // Intended — toolbar Undo / Redo stay in sync with the keyboard stack.
  await undoButton(page).click();
  await expectUserIds(page, [rectA.id], 'toolbar Undo must drop B');
  await redoButton(page).click();
  await expectUserIds(page, [rectA.id, rectB.id], 'toolbar Redo must restore B');

  // Intended — two-step stack: Undo×2 then Redo×2 restores create order.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expectUserIds(page, [], 'two Ctrl+Z must drop A and B');
  await page.keyboard.press('Control+Shift+z');
  await expectUserIds(page, [rectA.id], 'first redo restores A');
  await page.keyboard.press('Control+y');
  await expectUserIds(page, [rectA.id, rectB.id], 'second redo restores B');

  // Break — focused zoom % INPUT blocks the chord (isUndoRedoBlocked).
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await zoomBtn.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeVisible();
  await zoomInput.click();
  await page.keyboard.press('Control+z');
  expect(await userOrder(page), 'Ctrl+Z in zoom INPUT must keep A and B').toEqual([rectA.id, rectB.id]);
  await page.keyboard.press('Escape');
  await blurInputs(page);

  // Break — new create after undo clears the redo stack (B does not return).
  await page.keyboard.press('Control+z');
  await expectUserIds(page, [rectA.id], 'undo B before new create');
  await expectHistoryEnabled(page, { undo: true, redo: true });
  const rectC = await createRect(page, { x0: 0.38, y0: 0.58, x1: 0.58, y1: 0.74 });
  await blurInputs(page);
  await expectUserIds(page, [rectA.id, rectC.id], 'new C after undo B');
  await expectHistoryEnabled(page, { undo: true, redo: false });
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+y');
  expect(await userOrder(page), 'cleared redo must not restore B').toEqual([rectA.id, rectC.id]);
  expect(await userOrder(page)).not.toContain(rectB.id);

  // Edge — Select on empty page invents 0.
  await page.keyboard.press('v');
  const box = await pageBox(page);
  const beforeSelect = await userOrder(page);
  await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.08);
  expect(await userOrder(page), 'Select / empty page invents 0').toEqual(beforeSelect);

  // Isolation: imported natives still present; A and C held.
  const importedNow = await allAnnotationIds(page);
  for (const id of importedAtStart) {
    expect(importedNow, `imported ${id} must survive the stack`).toContain(id);
  }
  expect(await userOrder(page)).toEqual([rectA.id, rectC.id]);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('UNDO_REDO_STACK_DESKTOP_PROOF', JSON.stringify({
    overlayListsUndo: /\bUndo\b/i.test(overlayText),
    overlayListsRedo: /\bRedo\b/i.test(overlayText),
    rectA: rectA.id,
    rectB: rectB.id,
    rectC: rectC.id,
    viewBox,
    fileId,
  }));
});

test('390 undo/redo stack intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await expectHistoryEnabled(page, { undo: false, redo: false });
  const importedAtStart = await allAnnotationIds(page);
  await page.keyboard.press('Control+z');
  expect(await allAnnotationIds(page), '390 empty-stack Ctrl+Z must invent 0').toEqual(importedAtStart);

  const rectA = await createRect(page, { x0: 0.18, y0: 0.24, x1: 0.42, y1: 0.42 });
  const rectB = await createRect(page, { x0: 0.50, y0: 0.30, x1: 0.76, y1: 0.50 });
  await blurInputs(page);
  await expectUserIds(page, [rectA.id, rectB.id], '390 create A then B');
  await expectHistoryEnabled(page, { undo: true, redo: false });

  await undoButton(page).click();
  await expectUserIds(page, [rectA.id], '390 toolbar Undo drops B');
  await expectHistoryEnabled(page, { undo: true, redo: true });

  await page.keyboard.press('Control+y');
  await expectUserIds(page, [rectA.id, rectB.id], '390 Ctrl+Y restores B');

  await page.keyboard.press('Control+z');
  await expectUserIds(page, [rectA.id], '390 Ctrl+Z drops B');
  const rectC = await createRect(page, { x0: 0.28, y0: 0.58, x1: 0.52, y1: 0.74 });
  await blurInputs(page);
  await page.keyboard.press('Control+Shift+z');
  expect(await userOrder(page), '390 cleared redo must not restore B').toEqual([rectA.id, rectC.id]);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('UNDO_REDO_STACK_390_PROOF', JSON.stringify({
    rectA: rectA.id,
    rectB: rectB.id,
    rectC: rectC.id,
    viewBox,
    fileId,
  }));
});
