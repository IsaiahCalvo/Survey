import { test, expect } from '@playwright/test';

// E-02 leftover: RotationInputField Arrow ±1 / Shift+Arrow ±45.
// Prior E-02 dedicated type/blur/wrap/Escape and canvas `mtr` Shift+45 snap.
// Followup-2 only sampled ArrowUp 0→1 / Shift+ArrowUp 1→46.
// Distinct from leftover-18, free-drag 90/180, typed pill, canvas snap,
// counter nubbin, survey-marker `mtr`, group-rotate 15°.
// Do not stamp file.id. Do not replay P1-32 hold-arrow coalescing.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

function angleNear(angle, target, slack = 1.5) {
  const norm = ((Number(angle || 0) % 360) + 360) % 360;
  const want = ((Number(target || 0) % 360) + 360) % 360;
  return Math.min(
    Math.abs(norm - want),
    Math.abs(norm - (want + 360)),
    Math.abs(norm - (want - 360)),
  ) < slack;
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

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function clickVisible(page, name) {
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    return button;
  }
  if (name === 'Select') {
    const mode = page.getByRole('button', { name: 'Selection mode', exact: true }).first();
    if (await mode.isVisible().catch(() => false)) {
      await mode.click();
      return mode;
    }
    await page.keyboard.press('v');
    return mode;
  }
  await expect(buttons.first(), `visible ${name}`).toBeVisible();
  await buttons.first().click();
  return buttons.first();
}

async function dragOnPage(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const pageEl = page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  await expect(pageEl).toBeVisible();
  const box = await pageEl.boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
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
        angle: object.angle ?? data.angle ?? data.rotation ?? 0,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
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

async function annotationById(page, id) {
  return (await userAnnotationSnapshot(page)).find((row) => row.id === id) || null;
}

async function expectAngle(page, id, degrees, message) {
  await expect.poll(async () => {
    const row = await annotationById(page, id);
    return angleNear(row?.angle, degrees) ? degrees : Number(row?.angle);
  }, { timeout: 12_000, message: message || `expected angle ${degrees} on ${id}` }).toBe(degrees);
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.getByRole('button', { name: toolName, exact: true });
  const visibleSub = async () => {
    const count = await sub.count();
    for (let i = 0; i < count; i += 1) {
      if (await sub.nth(i).isVisible().catch(() => false)) return sub.nth(i);
    }
    return null;
  };
  if (!(await visibleSub())) {
    await clickVisible(page, categoryName);
  }
  const target = (await visibleSub()) || sub.first();
  await expect(target).toBeVisible();
  const pressed = await target.getAttribute('aria-pressed');
  const active = String(await target.getAttribute('class') || '').includes('is-active')
    || String(await target.getAttribute('class') || '').includes('btn-active');
  if (pressed !== 'true' && !active) await target.click();
}

async function createRect(page, coords = { x0: 0.22, y0: 0.28, x1: 0.42, y1: 0.46 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect'
  ));
}

async function createLine(page, coords = { x0: 0.52, y0: 0.28, x1: 0.74, y1: 0.44 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'line' || row.tool === 'line'
  ));
}

async function selectStroke(page, id) {
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
  const target = page.locator(`[data-shape-id="${id}"], [data-svg-annotation-layer] [data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + Math.min(6, Math.max(2, box.width / 2)), y: box.y + Math.max(2, box.height / 2) },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    if (await page.locator('[data-rotation-handle="mtr"], [data-resize-handle]').count()) return;
  }
}

async function showRotationPill(page) {
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  expect(box, 'mtr geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const input = page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true });
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.click();
  return input;
}

async function commitTypedDegrees(page, degrees) {
  const input = await showRotationPill(page);
  await input.fill(String(degrees));
  await expect(input).toHaveValue(String(degrees));
  await input.press('Enter');
}

test('desktop RotationInputField Arrow nudge intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);

  expect(await page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true }).count()).toBe(0);

  const emptyBefore = (await userAnnotationSnapshot(page)).map((row) => row.id);
  await page.keyboard.press('v');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').click({ position: { x: 12, y: 12 } });
  await dragOnPage(page, { x0: 0.10, y0: 0.12, x1: 0.18, y1: 0.20 });
  expect(
    (await userAnnotationSnapshot(page)).map((row) => row.id),
    'empty Select drag invents 0',
  ).toEqual(emptyBefore);
  expect(await page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true }).count()).toBe(0);

  const a = await createRect(page, { x0: 0.20, y0: 0.26, x1: 0.40, y1: 0.44 });
  const b = await createRect(page, { x0: 0.48, y0: 0.52, x1: 0.68, y1: 0.70 });
  await selectStroke(page, a.id);
  await expect(page.locator('[data-rotation-handle="mtr"]').first()).toBeVisible({ timeout: 8_000 });
  await expectAngle(page, a.id, 0, 'new rect starts at 0°');

  // Intended — focused ArrowUp/Down is ±1, not ±45.
  const input = await showRotationPill(page);
  await input.press('ArrowUp');
  await expectAngle(page, a.id, 1, 'ArrowUp from 0 must commit 1');
  await expect(input).toHaveValue('1');
  await input.press('ArrowUp');
  await expectAngle(page, a.id, 2, 'second ArrowUp must commit 2');
  await input.press('ArrowDown');
  await expectAngle(page, a.id, 1, 'ArrowDown from 2 must commit 1');

  // Intended — Shift+Arrow is ±45 from the live pill value (1 → 46 → 1).
  await input.press('Shift+ArrowUp');
  await expectAngle(page, a.id, 46, 'Shift+ArrowUp from 1 must commit 46');
  await expect(input).toHaveValue('46');
  await input.press('Shift+ArrowDown');
  await expectAngle(page, a.id, 1, 'Shift+ArrowDown from 46 must commit 1');

  // Intended — Shift+ArrowUp from 0 cycles 45 then 90 (not canvas soft-snap).
  await commitTypedDegrees(page, 0);
  await expectAngle(page, a.id, 0, 'reset to 0 before cardinal Shift');
  const cardinal = await showRotationPill(page);
  await cardinal.press('Shift+ArrowUp');
  await expectAngle(page, a.id, 45, 'Shift+ArrowUp from 0 must commit 45');
  await cardinal.press('Shift+ArrowUp');
  await expectAngle(page, a.id, 90, 'second Shift+ArrowUp must commit 90');

  // Break — ArrowLeft/Right are cursor keys, not angle steps.
  await commitTypedDegrees(page, 90);
  const cursor = await showRotationPill(page);
  await cursor.press('ArrowLeft');
  await cursor.press('ArrowRight');
  await expectAngle(page, a.id, 90, 'ArrowLeft/Right must not step the angle');

  // Break — wrap [0, 360): 359+1 → 0; 0-1 → 359.
  await commitTypedDegrees(page, 359);
  await expectAngle(page, a.id, 359, 'typed 359 before wrap');
  const wrapUp = await showRotationPill(page);
  await wrapUp.press('ArrowUp');
  await expectAngle(page, a.id, 0, 'ArrowUp from 359 must wrap to 0');
  const wrapDown = await showRotationPill(page);
  await wrapDown.press('ArrowDown');
  await expectAngle(page, a.id, 359, 'ArrowDown from 0 must wrap to 359');

  // Break — Shift wrap: 350+45 → 35; 10-45 → 325.
  await commitTypedDegrees(page, 350);
  const shiftWrap = await showRotationPill(page);
  await shiftWrap.press('Shift+ArrowUp');
  await expectAngle(page, a.id, 35, 'Shift+ArrowUp from 350 must wrap to 35');
  await commitTypedDegrees(page, 10);
  const shiftWrapDown = await showRotationPill(page);
  await shiftWrapDown.press('Shift+ArrowDown');
  await expectAngle(page, a.id, 325, 'Shift+ArrowDown from 10 must wrap to 325');

  // Break — unfocused Arrow does not rotate (page-nav / stay).
  await commitTypedDegrees(page, 45);
  await expectAngle(page, a.id, 45, 'typed 45 before unfocused Arrow');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.locator('.survey-pdfjs-viewer').click({ position: { x: 16, y: 16 } });
  await page.keyboard.press('ArrowUp');
  await expectAngle(page, a.id, 45, 'unfocused ArrowUp must not rotate');

  // Break — Line single-click has no pill / Arrow path.
  const line = await createLine(page);
  await selectStroke(page, line.id);
  expect(
    await page.locator('[data-rotation-handle="mtr"]').count(),
    'Line single-click mtr must be 0',
  ).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true }).count()).toBe(0);
  await expectAngle(page, a.id, 45, 'Line select must isolate A at 45');

  // Edge — isolation: B ArrowUp does not rewrite A.
  await selectStroke(page, b.id);
  const bInput = await showRotationPill(page);
  await bInput.press('ArrowUp');
  await expectAngle(page, b.id, 1, 'B ArrowUp must commit 1');
  await expectAngle(page, a.id, 45, 'B ArrowUp must isolate A at 45');

  // Edge — blur then undo is a single step (P1-32 hold-coalesce not this leftover).
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.locator('.survey-pdfjs-viewer').click({ position: { x: 16, y: 16 } });
  await page.keyboard.press('Control+Z');
  await expectAngle(page, b.id, 0, 'undo must drop B Arrow 1');
  await expectAngle(page, a.id, 45, 'undo must hold A at 45');
  await page.keyboard.press('Control+Shift+Z');
  await expectAngle(page, b.id, 1, 'redo must restore B Arrow 1');
  await page.keyboard.press('Control+Z');
  await expectAngle(page, b.id, 0, 'second undo must drop B Arrow 1 again');

  // Edge — Pen hide holds stored angle.
  await activateTool(page, 'Draw', 'Pen');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'Pen hide mtr').toBe(0);
  expect(await page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true }).count()).toBe(0);
  await expectAngle(page, a.id, 45, 'Pen hide must hold A at 45');

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-rotation-handle="mtr"]').count()).toBe(0);

  console.log('ROTATION_INPUT_ARROW_DESKTOP_PROOF', JSON.stringify({
    firstId: a.id,
    secondId: b.id,
    lineId: line.id,
    viewBox,
    fileId: null,
  }));
});

test('390 RotationInputField Arrow nudge intended + break + edge', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);

  const a = await createRect(page, { x0: 0.22, y0: 0.28, x1: 0.52, y1: 0.48 });
  await selectStroke(page, a.id);
  await expect(page.locator('[data-rotation-handle="mtr"]').first()).toBeVisible({ timeout: 8_000 });

  const input = await showRotationPill(page);
  await input.press('ArrowUp');
  await expectAngle(page, a.id, 1, '390 ArrowUp from 0 must commit 1');
  await input.press('Shift+ArrowUp');
  await expectAngle(page, a.id, 46, '390 Shift+ArrowUp from 1 must commit 46');

  await commitTypedDegrees(page, 359);
  const wrap = await showRotationPill(page);
  await wrap.press('ArrowUp');
  await expectAngle(page, a.id, 0, '390 ArrowUp from 359 must wrap to 0');

  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('ArrowUp');
  await expectAngle(page, a.id, 0, '390 unfocused ArrowUp must not rotate');

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('ROTATION_INPUT_ARROW_390_PROOF', JSON.stringify({
    id: a.id,
    viewBox,
    fileId: null,
  }));
});
