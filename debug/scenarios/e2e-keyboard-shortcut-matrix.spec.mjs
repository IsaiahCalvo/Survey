import { test, expect } from '@playwright/test';

// Keyboard shortcut matrix that prior waves listed but did not hard-assert:
// Delete (not only Backspace), Ctrl+] / Ctrl+[ z-order, Esc overlay/cancel,
// tool letters, Ctrl+F search. Annotation Duplicate / Group are not compiled-in
// — prove they do not invent clones. Not a replay of P-04 C-in-input, UL-30
// context-menu z-order, leftover-18, flatten, or mobile 390 chrome.

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
        zOrder: object.data?.zOrder || object.zOrder || null,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function appAnnotationIds(page, pageNumber = 1) {
  return (await userAnnotationSnapshot(page, pageNumber)).map((row) => row.id);
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

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle';
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if ((await sub.first().getAttribute('aria-pressed')) !== 'true') await sub.first().click();
    return;
  }
  await page.getByRole('button', { name: categoryName, exact: true }).click();
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

async function selectStroke(page, id) {
  await page.keyboard.press('v');
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + Math.min(6, Math.max(2, box.width / 2)), y: box.y + Math.max(2, box.height / 2) },
    { x: box.x + 2, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    if (await page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').count()) return;
  }
  expect(await page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').count()).toBeGreaterThan(0);
}

async function blurChrome(page) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.08);
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function siblingOrder(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
}

test('keyboard shortcut matrix: intended + break + edge', async ({ page }) => {
  const hunts = [];
  await openEditor(page);
  await blurChrome(page);

  // AppShell hides the overlay on the production viewer; DevTestRoute remounts
  // it so '?' is reachable on ?testPdf=. Catalog: tools/Esc/search/Delete/
  // Bring to front / Bring forward / Send backward; no Duplicate rows.
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText).toMatch(/Pen/);
  expect(overlayText).toMatch(/Select annotations/);
  expect(overlayText).toMatch(/Search text/);
  expect(overlayText).toMatch(/Esc/);
  expect(overlayText).toMatch(/Delete selected/);
  expect(overlayText).toMatch(/Bring to front/);
  expect(overlayText).toMatch(/Bring forward/);
  expect(overlayText).toMatch(/Send backward/);
  expect(overlayText).toMatch(/Send to back/);
  expect(overlayText).not.toMatch(/\bDuplicate\b/i);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  hunts.push({ hunt: 'intended — ? overlay lists tools/Esc/Delete/Bring to front/Bring forward/Send backward; Esc closes; no Duplicate rows', pass: true });

  // Intended — tool letters arm the documented tools (not a replay of P-04
  // C-in-input; that input-guard still stands).
  const toolProof = {};
  const subTool = (name) => page.locator('#chrome-sub-toolbar-host').getByRole('button', { name, exact: true });
  const isArmed = async (name) => {
    const btn = subTool(name);
    await expect(btn).toBeVisible({ timeout: 8_000 });
    const cls = await btn.getAttribute('class');
    return String(cls || '').includes('btn-active');
  };
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  toolProof.p = await isArmed('Pen');
  await page.keyboard.press('h');
  toolProof.h = await isArmed('Highlighter');
  await page.keyboard.press('t');
  toolProof.t = await isArmed('Text');
  await page.keyboard.press('q');
  toolProof.q = await isArmed('Callout');
  await page.keyboard.press('l');
  toolProof.l = await isArmed('Line');
  await page.keyboard.press('a');
  toolProof.a = await isArmed('Arrow');
  await page.keyboard.press('c');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
  toolProof.c = true;
  await page.keyboard.press('v');
  await expect(page.locator('[data-counter-overlay="1"]')).toHaveCount(0);
  toolProof.v = true;
  expect(Object.values(toolProof).every(Boolean), `tool letters ${JSON.stringify(toolProof)}`).toBeTruthy();
  hunts.push({ hunt: 'intended — tool letters P/H/T/Q/L/A/C/V arm', pass: true, toolProof });

  // Intended — Ctrl+F opens the find field (overlay lists it; prior V-08 used the tab click).
  await blurChrome(page);
  await page.keyboard.press('Control+f');
  const search = page.getByPlaceholder('Search text in PDF...');
  await expect(search).toBeVisible({ timeout: 8_000 });
  await expect(search).toBeFocused();
  hunts.push({ hunt: 'intended — Ctrl+F focuses Search text', pass: true });

  // Two overlapping owned rects so z-order has a neighbor to pass.
  await activateTool(page, 'Shapes', 'Rectangle');
  const beforeA = new Set(await appAnnotationIds(page));
  await dragOnPage(page, { x0: 0.20, y0: 0.22, x1: 0.44, y1: 0.44 });
  const rectA = await waitForNewUserAnnotation(page, beforeA, isRect);
  const beforeB = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { x0: 0.30, y0: 0.30, x1: 0.54, y1: 0.52 });
  const rectB = await waitForNewUserAnnotation(page, beforeB, isRect);
  const userOrder = async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.map((row) => row.id);
  };
  expect((await userOrder()).at(-1)).toBe(rectB.id);

  await page.keyboard.press('v');
  await selectStroke(page, rectA.id);
  await expect(page.locator('[data-resize-handle]').first()).toBeVisible({ timeout: 8_000 });

  // Overlap-aware: Ctrl+] / Ctrl+[ pass the nearest overlapping neighbor,
  // not the first/last imported native (e.g. 39R) on the layer.
  await page.keyboard.press('Control+]');
  await expect.poll(async () => {
    const ids = await userOrder();
    return ids.indexOf(rectA.id) > ids.indexOf(rectB.id);
  }, { message: 'Ctrl+] must place A above overlapping B' }).toBeTruthy();
  hunts.push({ hunt: 'intended — Ctrl+] bring forward past overlapping neighbor', pass: true, order: await userOrder() });

  await page.keyboard.press('Control+[');
  await expect.poll(async () => {
    const ids = await userOrder();
    return ids.indexOf(rectA.id) < ids.indexOf(rectB.id);
  }, { message: 'Ctrl+[ must place A behind overlapping B' }).toBeTruthy();
  hunts.push({ hunt: 'intended — Ctrl+[ send backward past overlapping neighbor', pass: true, order: await userOrder() });

  await page.keyboard.press('Control+Shift+]');
  await expect.poll(async () => (await siblingOrder(page)).at(-1)).toBe(rectA.id);
  await page.keyboard.press('Control+Shift+[');
  await expect.poll(async () => (await siblingOrder(page))[0]).toBe(rectA.id);
  hunts.push({ hunt: 'intended — Ctrl+Shift+] front and Ctrl+Shift+[ back', pass: true });

  // Edge — no annotation Duplicate shortcut. Ctrl+D must not clone.
  const idsBeforeDup = await appAnnotationIds(page);
  await selectStroke(page, rectA.id);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(200);
  expect(await appAnnotationIds(page)).toEqual(idsBeforeDup);
  hunts.push({ hunt: 'edge — Ctrl+D does not invent a Duplicate clone', pass: true });

  // Edge — Group/Ungroup shortcuts are compile-hidden (early return).
  const idsBeforeGroup = await appAnnotationIds(page);
  await page.keyboard.press('Control+g');
  await page.keyboard.press('Control+Shift+g');
  await page.waitForTimeout(200);
  expect(await appAnnotationIds(page)).toEqual(idsBeforeGroup);
  hunts.push({ hunt: 'edge — Ctrl+G / Ctrl+Shift+G stay compile-hidden', pass: true });

  // Break — Delete while zoom % is focused belongs to the field, not the mark.
  await selectStroke(page, rectB.id);
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await zoomBtn.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeVisible();
  await zoomInput.click();
  await page.keyboard.press('Delete');
  expect(await appAnnotationIds(page)).toContain(rectB.id);
  await page.keyboard.press('Escape');
  hunts.push({ hunt: 'break — Delete in focused zoom INPUT no-ops', pass: true });

  // Break — z-order with no selection does not scramble existing order.
  await blurChrome(page);
  await page.mouse.click(12, 200);
  const orderBeforeIdle = await siblingOrder(page);
  await page.keyboard.press('Control+]');
  await page.keyboard.press('Control+[');
  expect(await siblingOrder(page)).toEqual(orderBeforeIdle);
  hunts.push({ hunt: 'break — z-order keys with no selection are a no-op', pass: true });

  // Intended — Delete (not Backspace) removes the selected owned rect.
  await selectStroke(page, rectB.id);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await appAnnotationIds(page)).includes(rectB.id), {
    message: 'Delete must remove the selected owned rect',
  }).toBeFalsy();
  expect(await appAnnotationIds(page)).toContain(rectA.id);
  hunts.push({ hunt: 'intended — Delete removes selected rect; sibling stays', pass: true });

  // Edge — Esc after selection does not delete the remaining mark.
  await selectStroke(page, rectA.id);
  await page.keyboard.press('Escape');
  expect(await appAnnotationIds(page)).toContain(rectA.id);
  hunts.push({ hunt: 'edge — Esc does not delete the selected mark', pass: true });

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);
  console.log('KEYBOARD_MATRIX_PROOF', JSON.stringify({ hunts, fileId }));
});
