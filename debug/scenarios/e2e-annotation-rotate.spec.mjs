import { test, expect } from '@playwright/test';

// E-02 leftover: selected-annotation canvas rotate via `mtr` (free drag).
// Prior E-02 dedicated the typed degree pill. Survey-marker `mtr` and
// counter nubbin/orbit are their own slices. Shift+45° handle snap was a
// followup-2 sample only. Distinct from leftover-18, E-01 resize, E-03
// move, V-01 pan, V-02 select, color / Match Fill / zoom / page-field /
// pill / textbox-create / pan / move / resize catalogs. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const RECT_A = { x0: 0.22, y0: 0.28, x1: 0.40, y1: 0.44 };
const RECT_B = { x0: 0.58, y0: 0.56, x1: 0.76, y1: 0.72 };

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
  const hubCopy = page.getByText('No documents yet');
  if (await hubCopy.isVisible().catch(() => false) || await pageCoveredByHub(page)) {
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
        width: Number(object.width ?? data.width ?? 0) * Math.abs(Number(object.scaleX ?? 1)),
        height: Number(object.height ?? data.height ?? 0) * Math.abs(Number(object.scaleY ?? 1)),
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

function isLine(row) {
  return row.type === 'line' || row.tool === 'line';
}

function angleNear(actual, want, tol = 8) {
  const a = ((Number(actual) % 360) + 360) % 360;
  const b = ((Number(want) % 360) + 360) % 360;
  const delta = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  return delta <= tol;
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

async function createLine(page, coords) {
  const before = new Set(await userOrder(page));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isLine);
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
    const layer = page.locator('[data-svg-annotation-layer="1"]').first();
    const cls = String(await layer.getAttribute('class') || '');
    return !cls.includes('tool-crosshair');
  }, { timeout: 8_000, message: 'Select must drop the creation crosshair' }).toBeTruthy();
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
  const title = /^transparent$/i.test(hex) ? 'Transparent' : hex;
  await picker.locator(`button[title="${title}"]`).first().click();
  await page.keyboard.press('Escape').catch(() => {});
  return true;
}

async function hitTarget(page, id) {
  return page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"] [data-shape-hit-target="rect"]`).first();
}

async function annoBox(page, id) {
  const hit = await hitTarget(page, id);
  await expect(hit).toBeVisible();
  const box = await hit.boundingBox();
  expect(box, `hit bbox for ${id}`).toBeTruthy();
  return box;
}

async function strokeClick(page, id, { modifiers = [] } = {}) {
  const box = await annoBox(page, id);
  const before = (await selectedIds(page)).includes(id);
  const points = [
    { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35 },
    { x: box.x + box.width * 0.65, y: box.y + box.height * 0.40 },
    { x: box.x + 6, y: box.y + box.height * 0.30 },
    { x: box.x + box.width * 0.30, y: box.y + 6 },
  ];
  for (const key of modifiers) await page.keyboard.down(key);
  try {
    for (const point of points) {
      await page.mouse.click(point.x, point.y);
      try {
        await expect.poll(async () => (await selectedIds(page)).includes(id), {
          timeout: 800,
        }).not.toBe(before);
        return;
      } catch {
        // missed
      }
    }
  } finally {
    for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
  }
  throw new Error(`stroke-click missed ${id}`);
}

async function clickEmpty(page, { xf = 0.08, yf = 0.08 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
}

async function dragMtrToAngle(page, id, deg) {
  const box = await annoBox(page, id);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  expect(hb, 'mtr handle').toBeTruthy();
  const start = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  const radius = Math.max(80, Math.hypot(start.x - cx, start.y - cy));
  const end = {
    x: cx + radius * Math.sin((deg * Math.PI) / 180),
    y: cy - radius * Math.cos((deg * Math.PI) / 180),
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.up();
}

test('desktop annotation rotate intended + break + edge', async ({ page }) => {
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
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'empty page mtr 0').toBe(0);
  await dragOnPage(page, { x0: 0.10, y0: 0.12, x1: 0.18, y1: 0.20 });
  expect(await userOrder(page), 'empty Select drag invents 0').toEqual(emptyBefore);

  await activateTool(page, 'Shapes', 'Rectangle');
  await setNextDrawFill(page, '#00FFFF');
  const rectA = await createRect(page, RECT_A);
  const rectB = await createRect(page, RECT_B);
  await dismissChrome(page);
  await blurInputs(page);
  expect(await userOrder(page), 'intended create A then B').toEqual([rectA.id, rectB.id]);

  await selectMode(page);
  await clickEmpty(page);
  await expectSelected(page, [], 'empty click must deselect after create');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'deselect hides mtr').toBe(0);

  const a0 = await geom(page, rectA.id);
  const b0 = await geom(page, rectB.id);
  expect(a0, 'A geom').toBeTruthy();
  expect(b0, 'B geom').toBeTruthy();
  expect(a0.angle, 'A starts unrotated').toBeCloseTo(0, 1);

  // Intended — single-click A shows mtr; free-drag to 90° (not Shift snap, not pill).
  await strokeClick(page, rectA.id);
  await expectSelected(page, [rectA.id], 'stroke-click must select A before rotate');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'single-select A must show mtr').toBeGreaterThan(0);

  await dragMtrToAngle(page, rectA.id, 90);
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && angleNear(now.angle, 90, 10);
  }, { message: 'free mtr drag must set A near 90°' }).toBeTruthy();
  const a90 = await geom(page, rectA.id);
  const b90 = await geom(page, rectB.id);
  expect(a90.width, 'mtr rotate must hold A width').toBeCloseTo(a0.width, 1);
  expect(a90.height, 'mtr rotate must hold A height').toBeCloseTo(a0.height, 1);
  expect(a90.left, 'mtr rotate must hold A left').toBeCloseTo(a0.left, 1);
  expect(a90.top, 'mtr rotate must hold A top').toBeCloseTo(a0.top, 1);
  expect(b90.angle, 'mtr rotate must isolate B angle').toBeCloseTo(b0.angle, 1);
  expect(b90.left, 'mtr rotate must isolate B left').toBeCloseTo(b0.left, 1);

  // Intended — undo / redo.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: 'undo must restore A angle 0' }).toBeTruthy();

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && angleNear(now.angle, a90.angle, 2);
  }, { message: 'redo must restore rotated A' }).toBeTruthy();

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: 'second undo must restore A angle 0 again' }).toBeTruthy();

  // Intended — second free-drag to 180°.
  await clickEmpty(page);
  await strokeClick(page, rectA.id);
  await dragMtrToAngle(page, rectA.id, 180);
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && angleNear(now.angle, 180, 10);
  }, { message: 'free mtr drag must set A near 180°' }).toBeTruthy();
  const a180 = await geom(page, rectA.id);
  expect(a180.width, '180 rotate must hold A width').toBeCloseTo(a0.width, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: 'undo 180 must restore A angle 0' }).toBeTruthy();

  // Break — micro-drag on mtr does not commit.
  await clickEmpty(page);
  await strokeClick(page, rectA.id);
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible();
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 1, hb.y + hb.height / 2 + 1);
  await page.mouse.up();
  const aMicro = await geom(page, rectA.id);
  expect(angleNear(aMicro.angle, 0, 2), 'micro-drag must not commit angle').toBeTruthy();

  // Break — multi-select group frame is moveOnly (mtr hidden).
  await clickEmpty(page);
  await strokeClick(page, rectA.id);
  await strokeClick(page, rectB.id, { modifiers: ['Shift'] });
  await expectSelected(page, [rectA.id, rectB.id], 'Shift-click must add B');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'group moveOnly hides mtr').toBe(0);
  expect(await page.locator('[data-group-selection-bbox="true"]').count(), 'group dashed frame present').toBeGreaterThan(0);
  const aGroup = await geom(page, rectA.id);
  expect(angleNear(aGroup.angle, 0, 2), 'group select must not rotate A').toBeTruthy();

  // Break — Line single-click omits mtr (endpoints, not bbox rotate).
  const line = await createLine(page, { x0: 0.18, y0: 0.72, x1: 0.38, y1: 0.80 });
  await selectMode(page);
  await clickEmpty(page);
  const lineHit = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${line.id}"]`).first();
  await expect(lineHit).toBeVisible();
  const lb = await lineHit.boundingBox();
  await page.mouse.click(lb.x + lb.width * 0.5, lb.y + lb.height * 0.5);
  await expectSelected(page, [line.id], 'line click must select the line');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'Line single-click mtr 0').toBe(0);
  const aAfterLine = await geom(page, rectA.id);
  expect(angleNear(aAfterLine.angle, 0, 2), 'Line select must isolate A angle').toBeTruthy();

  // Break — Pen empty-page invents ink; A angle held (chrome may stay).
  await clickEmpty(page);
  const aPen = await geom(page, rectA.id);
  const beforePen = new Set(await userOrder(page));
  await activateTool(page, 'Draw', 'Pen');
  await dragOnPage(page, { x0: 0.12, y0: 0.86, x1: 0.28, y1: 0.92 });
  const ink = await waitForNewUserAnnotation(page, beforePen, (row) => (
    row.type === 'path' || row.tool === 'pen' || row.tool === 'freedraw'
  ));
  expect(ink, 'Pen drag must invent ink').toBeTruthy();
  const aPenAfter = await geom(page, rectA.id);
  expect(angleNear(aPenAfter.angle, aPen.angle, 2), 'Pen drag must not rotate A').toBeTruthy();

  for (const id of importedAtStart) {
    const still = await page.evaluate((want) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .some((group) => group.getAttribute('data-anno-id') === want)
    ), id);
    expect(still, `imported ${id} must survive rotate`).toBe(true);
  }

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);
  expect(await page.locator('[data-rotation-handle="mtr"]').count()).toBe(0);

  console.log('ANNOTATION_ROTATE_DESKTOP_PROOF', JSON.stringify({
    rectA: rectA.id,
    rectB: rectB.id,
    line: line.id,
    angle90: a90.angle,
    angle180: a180.angle,
    viewBox,
    fileId: null,
  }));
});

test('390 annotation rotate intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const emptyBefore = await userOrder(page);
  await selectMode(page);
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), '390 empty mtr 0').toBe(0);
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
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), '390 single-select must show mtr').toBeGreaterThan(0);

  await dragMtrToAngle(page, rectA.id, 90);
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && angleNear(now.angle, 90, 12);
  }, { message: '390 free mtr drag must set A near 90°' }).toBeTruthy();
  const a1 = await geom(page, rectA.id);
  const b1 = await geom(page, rectB.id);
  expect(a1.width, '390 mtr must hold A width').toBeCloseTo(a0.width, 1);
  expect(b1.angle, '390 mtr must isolate B').toBeCloseTo(b0.angle, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, rectA.id);
    return now && angleNear(now.angle, 0, 2);
  }, { message: '390 undo must restore A angle 0' }).toBeTruthy();

  await clickEmpty(page);
  await dragOnPage(page, { x0: 0.16, y0: 0.22, x1: 0.82, y1: 0.76 });
  await expectSelected(page, [rectA.id, rectB.id], '390 window marquee must select A+B');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), '390 group moveOnly hides mtr').toBe(0);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('ANNOTATION_ROTATE_390_PROOF', JSON.stringify({
    rectA: rectA.id,
    rectB: rectB.id,
    angle90: a1.angle,
    viewBox,
    fileId: null,
  }));
});
