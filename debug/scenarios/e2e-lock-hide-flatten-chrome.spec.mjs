import { test, expect } from '@playwright/test';

// Lock / hide / flatten annotation chrome — named leftover after UL-30
// arrange. Source has no user item. This pass live-proves the chrome is
// absent on ?testPdf= (not leftover-18, not flatten-to-PDF export).
// Do not invent compile-hidden flatten-to-PDF. Do not stamp file.id.
// Distinct from X-03 print flatten, Documents Lock persist, import lock
// flags, and region Hide/Show.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const FORBIDDEN = [
  'Lock',
  'Unlock',
  'Hide',
  'Show',
  'Flatten',
  'Lock annotation',
  'Hide annotation',
  'Flatten annotation',
  'Unhide',
];

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

async function assertForbiddenChrome(page, where) {
  for (const name of FORBIDDEN) {
    expect(
      await page.getByRole('button', { name, exact: true }).count(),
      `${where}: button ${name} must be 0`,
    ).toBe(0);
    expect(
      await page.getByRole('menuitem', { name, exact: true }).count(),
      `${where}: menuitem ${name} must be 0`,
    ).toBe(0);
  }
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
    if (!(await menu.count())) await page.waitForTimeout(120);
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
  await page.mouse.click(box.x + 2, box.y + box.height / 2, { button: 'right' });
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
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

function assertNoForbiddenLabels(labels, where) {
  for (const name of FORBIDDEN) {
    expect(labels, `${where} must omit ${name}`).not.toContain(name);
  }
}

test('desktop lock/hide/flatten annotation chrome is absent', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissMenus(page);
  await assertForbiddenChrome(page, 'fresh editor toolbar');

  const emptyLabels = await rightClickUntilPasteOnly(page);
  assertNoForbiddenLabels(emptyLabels, 'empty page');
  await dismissMenus(page);

  const rect = await createRect(page, { x0: 0.20, y0: 0.24, x1: 0.40, y1: 0.42 });
  await selectMode(page);
  await rightClickStroke(page, rect.id);
  const ownedLabels = await menuLabels(page);
  expect(ownedLabels).toEqual(expect.arrayContaining([
    'Cut', 'Copy', 'Paste', 'Delete',
    'Bring to front', 'Bring forward', 'Send backward', 'Send to back',
  ]));
  assertNoForbiddenLabels(ownedLabels, 'owned rect');
  await dismissMenus(page);
  await assertForbiddenChrome(page, 'selected rect toolbar');

  const calloutId = await createCallout(page, 'no lock', {
    x0: 0.56, y0: 0.22, x1: 0.84, y1: 0.36,
  });
  await rightClickCallout(page, calloutId);
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
  const calloutLabels = await menuLabels(page);
  assertNoForbiddenLabels(calloutLabels, 'callout');
  await dismissMenus(page);

  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible();
  const overlayText = await overlay.innerText();
  expect(overlayText).toMatch(/Select annotations/);
  expect(overlayText).not.toMatch(/\bLock\b|\bUnlock\b|\bHide\b|\bFlatten\b/i);
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(overlay).toHaveCount(0);

  const beforePen = (await userAnnotationSnapshot(page)).length;
  await activateTool(page, 'Draw', 'Pen');
  await assertForbiddenChrome(page, 'Pen-armed toolbar');
  await rightClickEmptyPage(page, { xf: 0.10, yf: 0.88 });
  const penEmpty = await menuLabels(page);
  expect(penEmpty).toEqual(['Paste']);
  assertNoForbiddenLabels(penEmpty, 'Pen-armed empty');
  await dismissMenus(page);
  expect((await userAnnotationSnapshot(page)).length, 'Pen-armed invents 0').toBe(beforePen);

  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  await selectMode(page);
  await rightClickEmptyPage(page, { xf: 0.10, yf: 0.10 });
  await dismissMenus(page);
  expect((await userAnnotationSnapshot(page)).length, 'Select / empty page invents 0').toBe(beforeSelect);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => userOrder(page).then((ids) => ids.includes(rect.id))).toBeTruthy();

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await assertForbiddenChrome(page, 'hubPreview');
  expect(await page.locator('[data-annotation-context-menu="true"]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('LOCK_HIDE_FLATTEN_DESKTOP_PROOF', JSON.stringify({
    emptyLabels,
    ownedLabels,
    calloutLabels,
    overlayHasLock: /\bLock\b/i.test(overlayText),
    viewBox,
    fileId,
    rectId: rect.id,
    calloutId,
  }));
});

test('390 lock/hide/flatten annotation chrome is absent', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissMenus(page);
  await assertForbiddenChrome(page, '390 fresh toolbar');

  const emptyLabels = await rightClickUntilPasteOnly(page, [
    { xf: 0.08, yf: 0.88 },
    { xf: 0.90, yf: 0.88 },
    { xf: 0.10, yf: 0.55 },
    { xf: 0.88, yf: 0.55 },
  ]);
  assertNoForbiddenLabels(emptyLabels, '390 empty page');
  await dismissMenus(page);

  const rect = await createRect(page, { x0: 0.20, y0: 0.24, x1: 0.40, y1: 0.42 });
  await selectMode(page);
  await rightClickStroke(page, rect.id);
  const ownedLabels = await menuLabels(page);
  expect(ownedLabels).toEqual(expect.arrayContaining(['Cut', 'Copy', 'Paste', 'Delete']));
  assertNoForbiddenLabels(ownedLabels, '390 owned rect');
  await dismissMenus(page);
  await assertForbiddenChrome(page, '390 selected rect');

  const calloutId = await createCallout(page, '390 no lock', {
    x0: 0.56, y0: 0.22, x1: 0.84, y1: 0.36,
  });
  await rightClickCallout(page, calloutId);
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
  const calloutLabels = await menuLabels(page);
  assertNoForbiddenLabels(calloutLabels, '390 callout');
  await dismissMenus(page);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('LOCK_HIDE_FLATTEN_390_PROOF', JSON.stringify({
    emptyLabels,
    ownedLabels,
    calloutLabels,
    viewBox,
    fileId,
    rectId: rect.id,
    calloutId,
  }));
});
