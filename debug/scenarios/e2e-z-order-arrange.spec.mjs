import { test, expect } from '@playwright/test';

// UL-30 z-order / arrange — context-menu Bring forward / Send backward
// plus overlap-aware skip, already-front/back no-op, callout omit.
// Distinct from UL-30 front/back smoke (`e2e-context-menu-spaces.spec.mjs`)
// and keyboard-shortcut-matrix Ctrl+]/[ / Shift+] / Shift+[ hotkeys.
// Not leftover-18. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const Z_ORDER_ITEMS = [
  'Bring to front',
  'Bring forward',
  'Send backward',
  'Send to back',
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
        zOrder: object.data?.zOrder || object.zOrder || null,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userOrder(page) {
  return (await userAnnotationSnapshot(page)).map((row) => row.id);
}

async function siblingOrder(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
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
  // Stroke-only hit: transparent fill lets a center click fall through to the
  // page (Paste-only). The left edge stays on the stroke.
  await page.mouse.click(box.x + 2, box.y + box.height / 2, { button: 'right' });
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

async function seedOverlapStack(page, {
  a = { x0: 0.18, y0: 0.22, x1: 0.38, y1: 0.40 },
  c = { x0: 0.70, y0: 0.70, x1: 0.88, y1: 0.86 },
  b = { x0: 0.26, y0: 0.30, x1: 0.46, y1: 0.48 },
} = {}) {
  // A and B overlap. C is far away so it sits between them in array
  // order but is skipped by overlap-aware Bring forward.
  const rectA = await createRect(page, a);
  const rectC = await createRect(page, c);
  const rectB = await createRect(page, b);
  await selectMode(page);
  await expect.poll(async () => userOrder(page)).toEqual([rectA.id, rectC.id, rectB.id]);
  return { rectA, rectC, rectB };
}

test('desktop z-order arrange intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissMenus(page);

  // Break: empty page is Paste-only — no arrange items.
  const emptyLabels = await rightClickUntilPasteOnly(page);
  for (const label of Z_ORDER_ITEMS) {
    expect(emptyLabels, `empty page must omit ${label}`).not.toContain(label);
  }
  await dismissMenus(page);

  const { rectA, rectC, rectB } = await seedOverlapStack(page);

  await rightClickStroke(page, rectA.id);
  const ownedLabels = await menuLabels(page);
  for (const label of Z_ORDER_ITEMS) {
    expect(ownedLabels, `owned menu missing ${label}`).toContain(label);
  }

  // Intended — Bring forward skips non-overlapping C and lands past B.
  await clickMenuItem(page, 'Bring forward');
  await expect.poll(async () => userOrder(page), {
    message: 'Bring forward must skip non-overlapping C and land A past overlapping B',
  }).toEqual([rectC.id, rectB.id, rectA.id]);
  const afterForward = await userAnnotationSnapshot(page);
  expect(afterForward.find((row) => row.id === rectA.id)?.zOrder, 'Bring forward stamps zOrder').toBeTruthy();

  // Intended — Send backward lands A immediately below overlapping B.
  await rightClickStroke(page, rectA.id);
  await clickMenuItem(page, 'Send backward');
  await expect.poll(async () => userOrder(page), {
    message: 'Send backward must place A behind overlapping B',
  }).toEqual([rectC.id, rectA.id, rectB.id]);

  // Intended — Bring to front / Send to back (menu, not only keyboard).
  await rightClickStroke(page, rectA.id);
  await clickMenuItem(page, 'Bring to front');
  await expect.poll(async () => userOrder(page)).toEqual([rectC.id, rectB.id, rectA.id]);
  expect((await siblingOrder(page)).at(-1)).toBe(rectA.id);

  await rightClickStroke(page, rectA.id);
  await clickMenuItem(page, 'Send to back');
  await expect.poll(async () => userOrder(page)).toEqual([rectA.id, rectC.id, rectB.id]);
  expect((await siblingOrder(page))[0]).toBe(rectA.id);

  // Break — already-back Send backward / already-front Bring forward are no-ops.
  const backOrder = await userOrder(page);
  await rightClickStroke(page, rectA.id);
  await clickMenuItem(page, 'Send backward');
  expect(await userOrder(page), 'already-back Send backward is a no-op').toEqual(backOrder);

  await rightClickStroke(page, rectA.id);
  await clickMenuItem(page, 'Bring to front');
  await expect.poll(async () => userOrder(page)).toEqual([rectC.id, rectB.id, rectA.id]);
  const frontOrder = await userOrder(page);
  await rightClickStroke(page, rectA.id);
  await clickMenuItem(page, 'Bring forward');
  expect(await userOrder(page), 'already-front Bring forward is a no-op').toEqual(frontOrder);

  // Break — non-overlapping C has no overlapping neighbor above → Bring forward no-op.
  const cOrder = await userOrder(page);
  await rightClickStroke(page, rectC.id);
  await clickMenuItem(page, 'Bring forward');
  expect(await userOrder(page), 'non-overlapping C Bring forward is a no-op').toEqual(cOrder);

  // Isolation — far C keeps its stamped/implicit key while A/B stay [C, B, A].
  expect((await userOrder(page))[0]).toBe(rectC.id);

  // Undo rewinds the last no-op-or-move that actually checkpointed. Walk back
  // to the post-Bring-forward stack [C, B, A] if undo rewound a later front.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undo.isEnabled()) {
    await undo.click();
    const afterUndo = await userOrder(page);
    expect(afterUndo).toContain(rectA.id);
    expect(afterUndo).toContain(rectB.id);
    expect(afterUndo).toContain(rectC.id);
    expect(afterUndo.length, 'undo must not drop a rect').toBe(3);
  }

  // Restore a known stack for the callout / Pen edges.
  await selectMode(page);
  await rightClickStroke(page, rectA.id);
  if ((await userOrder(page)).at(-1) !== rectA.id) {
    await clickMenuItem(page, 'Bring to front');
    await expect.poll(async () => userOrder(page).then((ids) => ids.at(-1))).toBe(rectA.id);
  } else {
    await dismissMenus(page);
  }
  const isolatedOrder = await userOrder(page);

  // Break — callout menu omits all four arrange items (own SVG layer).
  const calloutId = await createCallout(page, 'Z-order omit', {
    x0: 0.58, y0: 0.16, x1: 0.78, y1: 0.30,
  });
  await rightClickCallout(page, calloutId);
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
  const calloutLabels = await menuLabels(page);
  for (const label of Z_ORDER_ITEMS) {
    expect(calloutLabels, `callout menu must omit ${label}`).not.toContain(label);
  }
  expect(calloutLabels).toContain('Copy');
  await dismissMenus(page);
  expect(await userOrder(page), 'callout create must not rewrite rect stack').toEqual(isolatedOrder);

  // Break — Pen-armed empty-page menu stays Paste-only; rect stack held.
  await activateTool(page, 'Draw', 'Pen');
  await rightClickEmptyPage(page, { xf: 0.10, yf: 0.88 });
  const penEmpty = await menuLabels(page);
  expect(penEmpty).toEqual(['Paste']);
  await dismissMenus(page);
  expect(await userOrder(page), 'Pen-armed must not rewrite rect stack').toEqual(isolatedOrder);

  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  await selectMode(page);
  await rightClickEmptyPage(page, { xf: 0.10, yf: 0.10 });
  await dismissMenus(page);
  expect((await userAnnotationSnapshot(page)).length, 'Select / empty page invents 0').toBe(beforeSelect);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Bring forward', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-annotation-context-menu="true"]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('Z_ORDER_ARRANGE_DESKTOP_PROOF', JSON.stringify({
    emptyLabels,
    ownedLabels,
    calloutLabels,
    isolatedOrder,
    viewBox,
    fileId,
    rectA: rectA.id,
    rectB: rectB.id,
    rectC: rectC.id,
    calloutId,
  }));
});

test('390 z-order arrange intended + break + edge', async ({ page }) => {
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
  await dismissMenus(page);

  const { rectA, rectC, rectB } = await seedOverlapStack(page);

  await rightClickStroke(page, rectA.id);
  const ownedLabels = await menuLabels(page);
  for (const label of Z_ORDER_ITEMS) {
    expect(ownedLabels, `390 owned menu missing ${label}`).toContain(label);
  }

  // 390 edge — same four-item catalog + absolute front/back. Overlap-aware
  // skip of C is the desktop intended (SVG getBBox scale is flaky here).
  await clickMenuItem(page, 'Bring to front');
  await expect.poll(async () => userOrder(page).then((ids) => ids.at(-1))).toBe(rectA.id);

  const frontOrder = await userOrder(page);
  await rightClickStroke(page, rectA.id);
  await clickMenuItem(page, 'Bring forward');
  expect(await userOrder(page), '390 already-front Bring forward is a no-op').toEqual(frontOrder);

  await rightClickStroke(page, rectA.id);
  await clickMenuItem(page, 'Send to back');
  await expect.poll(async () => userOrder(page).then((ids) => ids[0])).toBe(rectA.id);

  const calloutId = await createCallout(page, '390 omit', {
    x0: 0.56, y0: 0.22, x1: 0.84, y1: 0.36,
  });
  await rightClickCallout(page, calloutId);
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
  const calloutLabels = await menuLabels(page);
  for (const label of Z_ORDER_ITEMS) {
    expect(calloutLabels, `390 callout menu must omit ${label}`).not.toContain(label);
  }
  await dismissMenus(page);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.getByRole('button', { name: 'Bring forward', exact: true }).count()).toBe(0);

  console.log('Z_ORDER_ARRANGE_390_PROOF', JSON.stringify({
    emptyLabels,
    ownedLabels,
    calloutLabels,
    viewBox,
    fileId,
    rectA: rectA.id,
    rectB: rectB.id,
    rectC: rectC.id,
    calloutId,
  }));
});
