import { test, expect } from '@playwright/test';

// UL-27–29 + E-04 context-menu Cut / Copy / Paste / Delete —
// intended + break + edge. Distinct from:
//   - UL-27–29 same-page smoke (`e2e-context-menu-spaces.spec.mjs`)
//   - callout last-writer (`e2e-callout-paste.spec.mjs`)
//   - thin-leftovers cross-page paste
//   - keyboard Delete (`e2e-keyboard-shortcut-matrix.spec.mjs`)
//   - survey-marker Delete
//   - UL-32 page Cut/Copy/Paste
//   - UL-30 arrange / lock-hide-flatten
// Not leftover-18. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const CLIP_ITEMS = ['Cut', 'Copy', 'Paste', 'Delete'];
const GRAY_PASTE = /rgb\(\s*90,\s*100,\s*115\s*\)/;

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
        tool: String(object.data?.tool || object.data?.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
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

function isCounter(row) {
  return row.tool === 'counter' || row.type.includes('counter');
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

async function dismissMenus(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

const MENU_TITLES = new Set(['Page', 'Annotation', 'Callout', 'Counter']);

async function menuLabels(page) {
  return page.locator('[data-annotation-context-menu="true"]').evaluate((el, titles) => (
    [...el.querySelectorAll('div')]
      .map((node) => (node.textContent || '').trim())
      .filter((text) => text && !titles.includes(text))
  ), [...MENU_TITLES]);
}

async function pasteColor(page) {
  return page.locator('[data-annotation-context-menu="true"]')
    .getByText('Paste', { exact: true })
    .evaluate((el) => getComputedStyle(el).color);
}

async function rightClickEmptyPage(page, { xf = 0.12, yf = 0.12 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf, { button: 'right' });
}

async function rightClickUntilPasteOnly(page, candidates = [
  { xf: 0.08, yf: 0.88 },
  { xf: 0.12, yf: 0.12 },
  { xf: 0.90, yf: 0.88 },
  { xf: 0.50, yf: 0.50 },
]) {
  let labels = null;
  for (const pos of candidates) {
    await dismissMenus(page);
    await rightClickEmptyPage(page, pos);
    const menu = page.locator('[data-annotation-context-menu="true"]');
    if (!(await menu.count())) {
      await page.waitForTimeout(120);
    }
    if (!(await menu.count())) continue;
    const next = await menuLabels(page);
    if (next.length === 1 && next[0] === 'Paste') {
      labels = next;
      break;
    }
  }
  expect(labels, 'empty page must offer Paste-only').toEqual(['Paste']);
  return labels;
}

async function rightClickStroke(page, id) {
  await selectMode(page);
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  // Transparent fill lets a center click fall through to Paste-only.
  // Pasted clones can sit near chrome, so try the stroke then the group.
  const points = [
    { x: box.x + 2, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + 2 },
    { x: box.x + Math.min(8, Math.max(2, box.width / 2)), y: box.y + Math.min(8, Math.max(2, box.height / 2)) },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  ];
  for (const point of points) {
    await dismissMenus(page);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    const menu = page.locator('[data-annotation-context-menu="true"]');
    try {
      await expect(menu).toBeVisible({ timeout: 2_000 });
      const labels = await menuLabels(page);
      if (labels.includes('Cut') || labels.includes('Delete')) return;
    } catch { /* try next point */ }
    await page.keyboard.press('Escape');
  }
  await target.click({ button: 'right', timeout: 4_000 }).catch(() => {});
  if (await page.locator('[data-annotation-context-menu="true"]').count()) return;
  await target.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(8, Math.max(2, rect.width / 2)),
      clientY: rect.top + Math.min(8, Math.max(2, rect.height / 2)),
    }));
  });
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
}

async function clickMenuItem(page, label) {
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText(label, { exact: true }).click();
  await expect(menu).toHaveCount(0, { timeout: 8_000 });
}

async function selectMode(page) {
  await blurInputs(page);
  const selectBtn = page.getByRole('button', { name: 'Select', exact: true });
  let clicked = false;
  const count = await selectBtn.count();
  for (let i = 0; i < count; i += 1) {
    const button = selectBtn.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const cls = String(await button.getAttribute('class') || '');
    if (cls.includes('mobile-header-select-button')) continue;
    await button.click({ timeout: 4_000 }).catch(() => {});
    clicked = true;
    break;
  }
  if (!clicked) await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function createCallout(page, text, coords) {
  const before = await page.evaluate(() => (
    [...document.querySelectorAll('[data-callout-id]')]
      .map((node) => node.getAttribute('data-callout-id'))
      .filter(Boolean)
  ));
  await activateTool(page, 'Text', 'Callout');
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  let created = null;
  await expect.poll(async () => {
    const ids = await page.evaluate(() => (
      [...document.querySelectorAll('[data-callout-id]')]
        .map((node) => node.getAttribute('data-callout-id'))
        .filter(Boolean)
    ));
    created = ids.find((id) => !before.includes(id)) || null;
    return created;
  }, { message: 'expected a new callout' }).not.toBeNull();
  const box = await pageBox(page);
  await page.mouse.click(box.x + 8, box.y + box.height - 8);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await selectMode(page);
  return created;
}

async function rightClickCallout(page, id) {
  const scoped = page.locator(`[data-svg-annotation-layer="1"] [data-callout-id="${id}"]`);
  const target = scoped.locator('[data-callout-part="textBox"]').first();
  const fallback = scoped.first();
  const node = (await target.count()) ? target : fallback;
  await expect(node).toBeVisible();
  const box = await node.boundingBox();
  expect(box, `callout bbox ${id}`).toBeTruthy();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
}

async function pasteCloneOnEmpty(page, beforeIds, candidates) {
  await rightClickUntilPasteOnly(page, candidates);
  const color = await pasteColor(page);
  expect(color, 'Paste must be enabled (clipboard populated)').not.toMatch(GRAY_PASTE);
  await clickMenuItem(page, 'Paste');
  return waitForNewUserAnnotation(page, beforeIds, isRect);
}

test('desktop cut / copy / paste / delete intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissMenus(page);

  // Break: empty page is Paste-only; gray Paste click is a no-op.
  const emptyLabels = await rightClickUntilPasteOnly(page);
  for (const label of ['Cut', 'Copy', 'Delete']) {
    expect(emptyLabels, `empty page must omit ${label}`).not.toContain(label);
  }
  const emptyColor = await pasteColor(page);
  expect(emptyColor).toMatch(GRAY_PASTE);
  const beforeEmpty = await userOrder(page);
  await page.locator('[data-annotation-context-menu="true"]').getByText('Paste', { exact: true }).click();
  await page.waitForTimeout(200);
  expect(await userOrder(page), 'empty clipboard Paste must invent 0').toEqual(beforeEmpty);
  await dismissMenus(page);

  const rectA = await createRect(page, { x0: 0.18, y0: 0.22, x1: 0.38, y1: 0.40 });
  const rectC = await createRect(page, { x0: 0.70, y0: 0.70, x1: 0.88, y1: 0.86 });
  await selectMode(page);
  await expect.poll(async () => userOrder(page)).toEqual([rectA.id, rectC.id]);

  await rightClickStroke(page, rectA.id);
  const ownedLabels = await menuLabels(page);
  for (const label of CLIP_ITEMS) {
    expect(ownedLabels, `owned menu missing ${label}`).toContain(label);
  }

  // Intended — Copy keeps the original; Paste is repeatable (new ids).
  await clickMenuItem(page, 'Copy');
  expect(await userOrder(page), 'Copy must keep A and C').toEqual([rectA.id, rectC.id]);

  const copy1 = await pasteCloneOnEmpty(page, new Set([rectA.id, rectC.id]), [
    { xf: 0.10, yf: 0.55 },
    { xf: 0.08, yf: 0.88 },
  ]);
  expect(copy1.id).not.toBe(rectA.id);
  expect(await userOrder(page)).toContain(rectA.id);
  expect(await userOrder(page)).toContain(rectC.id);

  const copy2 = await pasteCloneOnEmpty(page, new Set(await userOrder(page)), [
    { xf: 0.88, yf: 0.18 },
    { xf: 0.50, yf: 0.12 },
  ]);
  expect(copy2.id, 'second Copy-paste must mint a unique id').not.toBe(copy1.id);
  expect(copy2.id).not.toBe(rectA.id);

  // Intended — Cut the owned original (not a paste) so the stroke hit is
  // the same geometry as the catalog click. First Paste restores a clone;
  // second is gray (one-shot).
  await rightClickStroke(page, rectA.id);
  await clickMenuItem(page, 'Cut');
  await expect.poll(async () => (await userOrder(page)).includes(rectA.id)).toBeFalsy();
  expect(await userOrder(page), 'Cut must leave isolation sibling C').toContain(rectC.id);
  expect(await userOrder(page)).toContain(copy1.id);
  expect(await userOrder(page)).toContain(copy2.id);

  const cutClone = await pasteCloneOnEmpty(page, new Set(await userOrder(page)), [
    { xf: 0.50, yf: 0.82 },
    { xf: 0.12, yf: 0.88 },
  ]);
  expect(cutClone.id).not.toBe(rectA.id);

  await rightClickUntilPasteOnly(page, [
    { xf: 0.50, yf: 0.50 },
    { xf: 0.90, yf: 0.50 },
    { xf: 0.08, yf: 0.12 },
  ]);
  const afterCutPasteColor = await pasteColor(page);
  expect(afterCutPasteColor, 'Cut is one-shot — second Paste stays gray').toMatch(GRAY_PASTE);
  const afterCutPasteIds = await userOrder(page);
  await page.locator('[data-annotation-context-menu="true"]').getByText('Paste', { exact: true }).click();
  await page.waitForTimeout(200);
  expect(await userOrder(page), 'one-shot Cut second Paste invents 0').toEqual(afterCutPasteIds);
  await dismissMenus(page);

  // Intended — context-menu Delete on owned original C. Does not populate clipboard.
  await rightClickStroke(page, rectC.id);
  await clickMenuItem(page, 'Delete');
  await expect.poll(async () => (await userOrder(page)).includes(rectC.id)).toBeFalsy();
  expect(await userOrder(page), 'Delete must leave Copy clones').toContain(copy1.id);
  expect(await userOrder(page)).toContain(copy2.id);

  await rightClickUntilPasteOnly(page, [
    { xf: 0.50, yf: 0.50 },
    { xf: 0.90, yf: 0.50 },
    { xf: 0.08, yf: 0.12 },
  ]);
  expect(await pasteColor(page), 'Delete must not populate clipboard').toMatch(GRAY_PASTE);
  await dismissMenus(page);

  // Edge — Undo restores the deleted rect.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => (await userOrder(page)).includes(rectC.id), {
    message: 'Undo after context-menu Delete must restore the rect',
  }).toBeTruthy();
  expect(await userOrder(page)).toContain(copy1.id);

  const isolatedOrder = await userOrder(page);
  expect(isolatedOrder).toContain(rectC.id);
  expect(isolatedOrder).toContain(copy1.id);

  // Break — counter menu is Continue pin only (not Cut/Copy/Paste/Delete).
  const beforeCounter = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
  await dragOnPage(page, { x0: 0.48, y0: 0.48, x1: 0.54, y1: 0.54 });
  const counter = await waitForNewUserAnnotation(page, beforeCounter, isCounter);
  const pinBox = await page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${counter.id}"]`).boundingBox()
    || await page.locator('[data-counter-overlay="1"]').boundingBox();
  expect(pinBox, 'counter pin geometry').toBeTruthy();
  await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2, { button: 'right' });
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
  const counterLabels = await menuLabels(page);
  expect(counterLabels).toContain('Continue pin');
  for (const label of CLIP_ITEMS) {
    expect(counterLabels, `counter menu must omit ${label}`).not.toContain(label);
  }
  await dismissMenus(page);

  // Break — callout catalog has Cut/Copy/Paste/Delete (do not replay last-writer paste).
  const calloutId = await createCallout(page, 'clip catalog', {
    x0: 0.56, y0: 0.16, x1: 0.76, y1: 0.30,
  });
  await rightClickCallout(page, calloutId);
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
  const calloutLabels = await menuLabels(page);
  for (const label of CLIP_ITEMS) {
    expect(calloutLabels, `callout menu missing ${label}`).toContain(label);
  }
  await dismissMenus(page);
  expect(await userOrder(page), 'callout create must keep prior rects').toEqual(
    expect.arrayContaining([copy1.id, rectC.id]),
  );

  // Break — Pen-armed empty-page menu stays Paste-only; rects held.
  const afterCalloutRects = await userOrder(page);
  await activateTool(page, 'Draw', 'Pen');
  await rightClickUntilPasteOnly(page, [
    { xf: 0.10, yf: 0.88 },
    { xf: 0.90, yf: 0.12 },
  ]);
  const penEmpty = await menuLabels(page);
  expect(penEmpty).toEqual(['Paste']);
  await dismissMenus(page);
  expect(await userOrder(page), 'Pen-armed must not rewrite rect stack').toEqual(afterCalloutRects);

  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  await selectMode(page);
  await rightClickUntilPasteOnly(page, [
    { xf: 0.10, yf: 0.10 },
    { xf: 0.90, yf: 0.12 },
  ]);
  await dismissMenus(page);
  expect((await userAnnotationSnapshot(page)).length, 'Select / empty page invents 0').toBe(beforeSelect);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-annotation-context-menu="true"]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('CUT_COPY_PASTE_DELETE_DESKTOP_PROOF', JSON.stringify({
    emptyLabels,
    ownedLabels,
    counterLabels,
    calloutLabels,
    copy1: copy1.id,
    copy2: copy2.id,
    cutClone: cutClone.id,
    cutSource: rectA.id,
    rectC: rectC.id,
    calloutId,
    viewBox,
    fileId,
  }));
});

test('390 cut / copy / paste / delete intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissMenus(page);

  const emptyLabels = await rightClickUntilPasteOnly(page, [
    { xf: 0.08, yf: 0.88 },
    { xf: 0.90, yf: 0.88 },
    { xf: 0.10, yf: 0.55 },
    { xf: 0.88, yf: 0.55 },
  ]);
  for (const label of ['Cut', 'Copy', 'Delete']) {
    expect(emptyLabels, `390 empty page must omit ${label}`).not.toContain(label);
  }
  expect(await pasteColor(page)).toMatch(GRAY_PASTE);
  await dismissMenus(page);

  const rectA = await createRect(page, { x0: 0.18, y0: 0.22, x1: 0.40, y1: 0.40 });
  const rectC = await createRect(page, { x0: 0.62, y0: 0.66, x1: 0.86, y1: 0.84 });
  await selectMode(page);

  await rightClickStroke(page, rectA.id);
  const ownedLabels = await menuLabels(page);
  for (const label of CLIP_ITEMS) {
    expect(ownedLabels, `390 owned menu missing ${label}`).toContain(label);
  }

  await clickMenuItem(page, 'Delete');
  await expect.poll(async () => (await userOrder(page)).includes(rectA.id)).toBeFalsy();
  expect(await userOrder(page), '390 Delete must leave sibling C').toEqual([rectC.id]);

  await rightClickStroke(page, rectC.id);
  await clickMenuItem(page, 'Copy');
  const paste390 = await pasteCloneOnEmpty(page, new Set([rectC.id]), [
    { xf: 0.12, yf: 0.55 },
    { xf: 0.10, yf: 0.88 },
    { xf: 0.50, yf: 0.18 },
  ]);
  expect(paste390.id).not.toBe(rectC.id);
  expect(await userOrder(page)).toContain(rectC.id);

  const calloutId = await createCallout(page, '390 clip', {
    x0: 0.56, y0: 0.20, x1: 0.84, y1: 0.36,
  });
  await rightClickCallout(page, calloutId);
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
  const calloutLabels = await menuLabels(page);
  for (const label of CLIP_ITEMS) {
    expect(calloutLabels, `390 callout menu missing ${label}`).toContain(label);
  }
  await dismissMenus(page);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.locator('[data-annotation-context-menu="true"]').count()).toBe(0);

  console.log('CUT_COPY_PASTE_DELETE_390_PROOF', JSON.stringify({
    emptyLabels,
    ownedLabels,
    calloutLabels,
    paste390: paste390.id,
    rectA: rectA.id,
    rectC: rectC.id,
    calloutId,
    viewBox,
    fileId,
  }));
});
