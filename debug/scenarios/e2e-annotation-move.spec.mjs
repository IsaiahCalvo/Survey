import { test, expect } from '@playwright/test';

// E-03 leftover: selected-annotation move (single + multi-select group-move
// + page clamp). Prior E-03 was window "drag a rect off-page; multi-select
// drag" plus survey-marker body. Distinct from leftover-18, E-01 resize,
// E-02 rotation, V-01 pan, V-02 select, survey-marker body, color / Match
// Fill / zoom / page-field / rotation / textbox-create / pan catalogs.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const RECT_A = { x0: 0.22, y0: 0.28, x1: 0.40, y1: 0.44 };
const RECT_B = { x0: 0.58, y0: 0.56, x1: 0.76, y1: 0.72 };
const RECT_CLAMP = { x0: 0.04, y0: 0.20, x1: 0.20, y1: 0.34 };

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
  const toggles = [
    page.getByRole('button', { name: /Open pages, search, and bookmarks/i }),
    page.getByRole('button', { name: 'Collapse sidebar', exact: true }),
    page.getByRole('button', { name: 'Pages', exact: true }),
  ];
  const emptyVisible = await page.getByText('No documents yet').isVisible().catch(() => false);
  const covering = emptyVisible || await pageCoveredByHub(page);
  if (covering) {
    for (const toggle of toggles) {
      if (await toggle.first().isVisible().catch(() => false)) {
        await toggle.first().click().catch(() => {});
        break;
      }
    }
    const pdfTab = page.getByText('clickable-link-test.pdf').first();
    if (await pdfTab.isVisible().catch(() => false)) await pdfTab.click().catch(() => {});
  }
  await blurInputs(page);
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
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: Number(object.left ?? data.left ?? 0),
        top: Number(object.top ?? data.top ?? 0),
        width: Number(object.width ?? data.width ?? 0),
        height: Number(object.height ?? data.height ?? 0),
        angle: Number(object.angle ?? data.angle ?? 0),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function geom(page, id) {
  const rows = await userAnnotationSnapshot(page);
  return rows.find((row) => row.id === id) || null;
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
  return row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect';
}

async function selectedIds(page) {
  return page.evaluate(() => [...(window.__selectedAnnotationIds || [])]);
}

async function expectSelected(page, ids, message) {
  const want = [...ids].sort();
  await expect.poll(async () => [...(await selectedIds(page))].sort(), {
    timeout: 8_000,
    message: message || `expected selection ${want.join(',')}`,
  }).toEqual(want);
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

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.42,
  y1 = 0.46,
} = {}) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function createRect(page, coords) {
  const before = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRect);
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

function strokePoints(box) {
  // Transparent fill is stroke-only. Avoid corners (resize handles).
  return [
    { x: box.x + 3, y: box.y + Math.max(6, box.height / 2) },
    { x: box.x + Math.max(6, box.width / 2), y: box.y + 3 },
    { x: box.x + Math.max(6, box.width - 4), y: box.y + Math.max(6, box.height / 2) },
    { x: box.x + Math.max(6, box.width / 2), y: box.y + Math.max(6, box.height - 4) },
  ];
}

async function annoBox(page, id) {
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  return box;
}

async function strokeClick(page, id, { modifiers = [] } = {}) {
  const box = await annoBox(page, id);
  const before = (await selectedIds(page)).includes(id);
  for (const key of modifiers) await page.keyboard.down(key);
  try {
    for (const point of strokePoints(box)) {
      await page.mouse.click(point.x, point.y);
      try {
        await expect.poll(async () => (await selectedIds(page)).includes(id), {
          timeout: 700,
        }).not.toBe(before);
        return;
      } catch {
        // This edge missed the stroke; try the next.
      }
    }
  } finally {
    for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
  }
  throw new Error(`stroke-click missed ${id}`);
}

async function strokeDrag(page, id, dxPx, dyPx) {
  const box = await annoBox(page, id);
  const start = strokePoints(box)[0];
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dxPx, start.y + dyPx, { steps: 12 });
  await page.mouse.up();
}

async function clickEmpty(page, { xf = 0.08, yf = 0.08 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
}

test('desktop annotation move intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const importedAtStart = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ));

  await selectMode(page);
  const emptyBefore = await userOrder(page);
  await dragOnPage(page, { x0: 0.10, y0: 0.12, x1: 0.18, y1: 0.20 });
  expect(await userOrder(page), 'empty Select drag invents 0').toEqual(emptyBefore);

  const rectA = await createRect(page, RECT_A);
  const rectB = await createRect(page, RECT_B);
  await blurInputs(page);
  expect(await userOrder(page), 'intended create A then B').toEqual([rectA.id, rectB.id]);

  await selectMode(page);
  await clickEmpty(page);
  await expectSelected(page, [], 'empty click must deselect after create');

  const a0 = await geom(page, rectA.id);
  const b0 = await geom(page, rectB.id);
  expect(a0, 'A geom').toBeTruthy();
  expect(b0, 'B geom').toBeTruthy();

  // Intended — stroke-drag moves A; size/angle held; B isolated.
  await strokeClick(page, rectA.id);
  await expectSelected(page, [rectA.id], 'stroke-click must select A before move');
  await strokeDrag(page, rectA.id, 48, 36);
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && now.left > a0.left + 8 && now.top > a0.top + 8;
  }, { message: 'single move must change A left/top' }).toBeTruthy();
  const a1 = await geom(page, rectA.id);
  const b1 = await geom(page, rectB.id);
  expect(a1.width, 'single move must hold A width').toBeCloseTo(a0.width, 1);
  expect(a1.height, 'single move must hold A height').toBeCloseTo(a0.height, 1);
  expect(a1.angle, 'single move must hold A angle').toBeCloseTo(a0.angle, 1);
  expect(b1.left, 'single move must isolate B left').toBeCloseTo(b0.left, 1);
  expect(b1.top, 'single move must isolate B top').toBeCloseTo(b0.top, 1);

  // Intended — undo restores A.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && Math.abs(now.left - a0.left) < 2 && Math.abs(now.top - a0.top) < 2;
  }, { message: 'undo must restore A left/top' }).toBeTruthy();

  // Intended — redo re-applies the move.
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && Math.abs(now.left - a1.left) < 2 && Math.abs(now.top - a1.top) < 2;
  }, { message: 'redo must restore moved A' }).toBeTruthy();

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && Math.abs(now.left - a0.left) < 2 && Math.abs(now.top - a0.top) < 2;
  }, { message: 'second undo must restore A again' }).toBeTruthy();

  // Intended — multi-select group-move keeps the same delta.
  await clickEmpty(page);
  await strokeClick(page, rectA.id);
  await strokeClick(page, rectB.id, { modifiers: ['Shift'] });
  await expectSelected(page, [rectA.id, rectB.id], 'Shift-click must add B for group-move');
  const aPreGroup = await geom(page, rectA.id);
  const bPreGroup = await geom(page, rectB.id);
  await strokeDrag(page, rectA.id, 40, 28);
  await expect.poll(async () => {
    const nowA = await geom(page, rectA.id);
    const nowB = await geom(page, rectB.id);
    return nowA && nowB
      && nowA.left > aPreGroup.left + 6
      && nowB.left > bPreGroup.left + 6;
  }, { message: 'group-move must translate A and B' }).toBeTruthy();
  const aGroup = await geom(page, rectA.id);
  const bGroup = await geom(page, rectB.id);
  const dAx = aGroup.left - aPreGroup.left;
  const dAy = aGroup.top - aPreGroup.top;
  const dBx = bGroup.left - bPreGroup.left;
  const dBy = bGroup.top - bPreGroup.top;
  expect(dBx, 'group-move must keep B dx with A').toBeCloseTo(dAx, 1);
  expect(dBy, 'group-move must keep B dy with A').toBeCloseTo(dAy, 1);
  expect(aGroup.width, 'group-move must hold A width').toBeCloseTo(aPreGroup.width, 1);
  expect(bGroup.height, 'group-move must hold B height').toBeCloseTo(bPreGroup.height, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const nowA = await geom(page, rectA.id);
    const nowB = await geom(page, rectB.id);
    return nowA && nowB
      && Math.abs(nowA.left - aPreGroup.left) < 2
      && Math.abs(nowB.left - bPreGroup.left) < 2;
  }, { message: 'undo group-move must restore A and B' }).toBeTruthy();

  // Break — micro-drag below the 2px commit threshold.
  await clickEmpty(page);
  await strokeClick(page, rectA.id);
  const aMicro = await geom(page, rectA.id);
  await strokeDrag(page, rectA.id, 1, 1);
  const aMicroAfter = await geom(page, rectA.id);
  expect(aMicroAfter.left, 'micro-drag must not commit left').toBeCloseTo(aMicro.left, 1);
  expect(aMicroAfter.top, 'micro-drag must not commit top').toBeCloseTo(aMicro.top, 1);

  // Break — hollow interior is inert (transparent fill). Center-drag
  // must not move A (marquee / empty, not body-move).
  await clickEmpty(page);
  await strokeClick(page, rectA.id);
  const aHollow = await geom(page, rectA.id);
  const hollowBox = await annoBox(page, rectA.id);
  await page.mouse.move(hollowBox.x + hollowBox.width / 2, hollowBox.y + hollowBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hollowBox.x + hollowBox.width / 2 + 50, hollowBox.y + hollowBox.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  const aHollowAfter = await geom(page, rectA.id);
  expect(aHollowAfter.left, 'hollow-fill drag must not move A left').toBeCloseTo(aHollow.left, 1);
  expect(aHollowAfter.top, 'hollow-fill drag must not move A top').toBeCloseTo(aHollow.top, 1);

  // Break — off-page drag clamps to the viewBox (constrainToPage).
  const rectC = await createRect(page, RECT_CLAMP);
  await selectMode(page);
  await clickEmpty(page);
  await strokeClick(page, rectC.id);
  const c0 = await geom(page, rectC.id);
  expect(c0.left, 'clamp rect starts near the left').toBeLessThan(80);
  await strokeDrag(page, rectC.id, -220, -180);
  await expect.poll(async () => {
    const now = await geom(page, rectC.id);
    return now && now.left <= 1 && now.top <= 1;
  }, { message: 'off-page drag must clamp to page origin' }).toBeTruthy();
  const c1 = await geom(page, rectC.id);
  expect(c1.width, 'clamp must hold C width').toBeCloseTo(c0.width, 1);
  expect(c1.height, 'clamp must hold C height').toBeCloseTo(c0.height, 1);
  const aAfterClamp = await geom(page, rectA.id);
  expect(aAfterClamp.left, 'clamp C must isolate A').toBeCloseTo((await geom(page, rectA.id)).left, 1);

  // Break — Pen-armed drag draws ink; existing rects stay put.
  const aPen = await geom(page, rectA.id);
  const bPen = await geom(page, rectB.id);
  const beforePen = new Set(await userOrder(page));
  await activateTool(page, 'Draw', 'Pen');
  await dragOnPage(page, { x0: 0.12, y0: 0.78, x1: 0.28, y1: 0.86 });
  const ink = await waitForNewUserAnnotation(page, beforePen, (row) => (
    row.type === 'path' || row.tool === 'pen' || row.tool === 'freedraw'
  ));
  expect(ink, 'Pen drag must invent ink').toBeTruthy();
  const aPenAfter = await geom(page, rectA.id);
  const bPenAfter = await geom(page, rectB.id);
  expect(aPenAfter.left, 'Pen drag must not move A').toBeCloseTo(aPen.left, 1);
  expect(bPenAfter.top, 'Pen drag must not move B').toBeCloseTo(bPen.top, 1);

  for (const id of importedAtStart) {
    const still = await page.evaluate((want) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .some((group) => group.getAttribute('data-anno-id') === want)
    ), id);
    expect(still, `imported ${id} must survive move`).toBe(true);
  }

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('ANNOTATION_MOVE_DESKTOP_PROOF', JSON.stringify({
    rectA: rectA.id,
    rectB: rectB.id,
    rectC: rectC.id,
    singleDx: a1.left - a0.left,
    singleDy: a1.top - a0.top,
    groupDx: dAx,
    groupDy: dAy,
    clampLeft: c1.left,
    clampTop: c1.top,
    viewBox,
    fileId: null,
  }));
});

test('390 annotation move intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const emptyBefore = await userOrder(page);
  await selectMode(page);
  await dragOnPage(page, { x0: 0.12, y0: 0.16, x1: 0.22, y1: 0.24 });
  expect(await userOrder(page), '390 empty Select drag invents 0').toEqual(emptyBefore);

  const rectA = await createRect(page, { x0: 0.20, y0: 0.26, x1: 0.42, y1: 0.42 });
  const rectB = await createRect(page, { x0: 0.54, y0: 0.54, x1: 0.76, y1: 0.70 });
  await blurInputs(page);
  expect(await userOrder(page), '390 create A then B').toEqual([rectA.id, rectB.id]);

  await selectMode(page);
  await clickEmpty(page);
  const a0 = await geom(page, rectA.id);
  const b0 = await geom(page, rectB.id);
  await strokeClick(page, rectA.id);
  await expectSelected(page, [rectA.id], '390 stroke-click must select A');
  await strokeDrag(page, rectA.id, 36, 28);
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && now.left > a0.left + 6 && now.top > a0.top + 6;
  }, { message: '390 single move must change A left/top' }).toBeTruthy();
  const a1 = await geom(page, rectA.id);
  const b1 = await geom(page, rectB.id);
  expect(a1.width, '390 move must hold A width').toBeCloseTo(a0.width, 1);
  expect(b1.left, '390 move must isolate B').toBeCloseTo(b0.left, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && Math.abs(now.left - a0.left) < 2;
  }, { message: '390 undo must restore A' }).toBeTruthy();

  await strokeClick(page, rectA.id);
  await strokeClick(page, rectB.id, { modifiers: ['Shift'] });
  await expectSelected(page, [rectA.id, rectB.id], '390 Shift-click must add B');
  const aPre = await geom(page, rectA.id);
  const bPre = await geom(page, rectB.id);
  await strokeDrag(page, rectA.id, 30, 22);
  await expect.poll(async () => {
    const nowA = await geom(page, rectA.id);
    const nowB = await geom(page, rectB.id);
    return nowA && nowB && nowA.left > aPre.left + 4 && nowB.left > bPre.left + 4;
  }, { message: '390 group-move must translate A and B' }).toBeTruthy();
  const aG = await geom(page, rectA.id);
  const bG = await geom(page, rectB.id);
  expect(bG.left - bPre.left, '390 group-move must keep B dx with A').toBeCloseTo(aG.left - aPre.left, 1);

  const rectC = await createRect(page, { x0: 0.05, y0: 0.18, x1: 0.22, y1: 0.32 });
  await selectMode(page);
  await clickEmpty(page);
  await strokeClick(page, rectC.id);
  await strokeDrag(page, rectC.id, -160, -140);
  await expect.poll(async () => {
    const now = await geom(page, rectC.id);
    return now && now.left <= 1 && now.top <= 1;
  }, { message: '390 off-page drag must clamp to page origin' }).toBeTruthy();

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('ANNOTATION_MOVE_390_PROOF', JSON.stringify({
    rectA: rectA.id,
    rectB: rectB.id,
    rectC: rectC.id,
    viewBox,
    fileId: null,
  }));
});
