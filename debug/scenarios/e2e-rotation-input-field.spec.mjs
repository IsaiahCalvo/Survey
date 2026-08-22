import { test, expect } from '@playwright/test';

// E-02 leftover: RotationInputField type / blur / wrap / Escape.
// Prior E-02 was handle Shift-drag +45° plus one ArrowUp / Shift+Arrow sample
// (e2e-unblocked-followup-2). Counter nubbin / survey-marker mtr are dedicated.
// Distinct from leftover-18, UL-06 Zoom %, UL-07 page number, color catalogs.
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
        pointerAngle: data.pointerAngle ?? null,
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

async function typeDegrees(input, text) {
  await input.click();
  await input.press('Control+A');
  await input.press('Backspace');
  await expect(input).toHaveValue('');
  if (text) await input.pressSequentially(String(text), { delay: 20 });
}

async function commitTypedDegrees(page, degrees) {
  const input = await showRotationPill(page);
  await input.fill(String(degrees));
  await expect(input).toHaveValue(String(degrees));
  await input.press('Enter');
}

test('desktop RotationInputField intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);

  expect(await page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true }).count()).toBe(0);

  const a = await createRect(page, { x0: 0.20, y0: 0.26, x1: 0.40, y1: 0.44 });
  await selectStroke(page, a.id);
  await expect(page.locator('[data-rotation-handle="mtr"]').first()).toBeVisible({ timeout: 8_000 });
  await expectAngle(page, a.id, 0, 'new rect starts at 0°');

  // Intended — type 90 + Enter.
  await commitTypedDegrees(page, 90);
  await expectAngle(page, a.id, 90, 'typed 90 must commit 90');

  // Intended — click-away blur also commits.
  const blurInput = await showRotationPill(page);
  await blurInput.fill('180');
  await expect(blurInput).toHaveValue('180');
  await page.locator('.survey-pdfjs-viewer').click({ position: { x: 16, y: 16 } });
  await expectAngle(page, a.id, 180, 'click-away blur must commit 180');

  // Break — 360 / 405 wrap into [0, 360).
  await selectStroke(page, a.id);
  await commitTypedDegrees(page, 360);
  await expectAngle(page, a.id, 0, '360 must wrap to 0');
  await selectStroke(page, a.id);
  await commitTypedDegrees(page, 405);
  await expectAngle(page, a.id, 45, '405 must wrap to 45');

  // Break — empty + letters + minus restore the live angle (digits-only).
  // Ctrl+A used to be blocked (e.key === 'a'), so Backspace left a leftover digit.
  const emptyInput = await showRotationPill(page);
  await expect(emptyInput).toHaveValue('45');
  await emptyInput.click();
  await emptyInput.press('Control+A');
  await emptyInput.press('Backspace');
  await expect(emptyInput, 'Ctrl+A then Backspace must clear 45').toHaveValue('');
  await emptyInput.press('Enter');
  await expectAngle(page, a.id, 45, 'empty Enter must restore 45');

  const letterInput = await showRotationPill(page);
  await typeDegrees(letterInput, 'abc');
  await expect(letterInput, 'letters must not enter the pill').toHaveValue('');
  await letterInput.press('Enter');
  await expectAngle(page, a.id, 45, 'letters must restore 45');

  const minusInput = await showRotationPill(page);
  await typeDegrees(minusInput, '-');
  await expect(minusInput, 'minus is blocked').toHaveValue('');
  await minusInput.press('Enter');
  await expectAngle(page, a.id, 45, 'minus must restore 45');

  // Break — Escape restores and must not commit the typed draft.
  const escapeInput = await showRotationPill(page);
  await escapeInput.fill('270');
  await expect(escapeInput).toHaveValue('270');
  await escapeInput.press('Escape');
  await expectAngle(page, a.id, 45, 'Escape must restore 45 and not commit 270');

  // Break — Line single-click chrome has no rotation pill (p1/p2, not mtr).
  const line = await createLine(page);
  await selectStroke(page, line.id);
  expect(
    await page.locator('[data-rotation-handle="mtr"]').count(),
    'Line single-click mtr must be 0',
  ).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true }).count()).toBe(0);

  // Edge — isolation: second rect does not rewrite the first angle.
  const b = await createRect(page, { x0: 0.48, y0: 0.52, x1: 0.68, y1: 0.70 });
  await selectStroke(page, b.id);
  await commitTypedDegrees(page, 90);
  await expectAngle(page, b.id, 90, 'second rect typed 90');
  await expectAngle(page, a.id, 45, 'second rect must isolate the first angle');

  // Edge — undo drops the last typed commit.
  await page.keyboard.press('Control+Z');
  await expectAngle(page, b.id, 0, 'undo must drop second-rect 90');
  await expectAngle(page, a.id, 45, 'undo must hold the first angle');

  // Edge — empty Select + Pen invent 0 and hold the stored angle.
  const marksBeforePen = (await userAnnotationSnapshot(page)).map((row) => row.id).sort();
  await page.keyboard.press('v');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').click({ position: { x: 12, y: 12 } });
  expect(await page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true }).count()).toBe(0);
  await activateTool(page, 'Draw', 'Pen');
  expect(await page.locator('[data-rotation-handle="mtr"]').count(), 'Pen hide mtr').toBe(0);
  expect(await page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true }).count()).toBe(0);
  await expectAngle(page, a.id, 45, 'Pen hide must hold the first angle');
  expect((await userAnnotationSnapshot(page)).map((row) => row.id).sort()).toEqual(marksBeforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-rotation-handle="mtr"]').count()).toBe(0);

  console.log('ROTATION_INPUT_FIELD_DESKTOP_PROOF', JSON.stringify({
    firstId: a.id,
    secondId: b.id,
    lineId: line.id,
    viewBox,
    fileId: null,
  }));
});

test('390 RotationInputField intended + break + edge', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);

  const a = await createRect(page, { x0: 0.22, y0: 0.28, x1: 0.52, y1: 0.48 });
  await selectStroke(page, a.id);
  await expect(page.locator('[data-rotation-handle="mtr"]').first()).toBeVisible({ timeout: 8_000 });

  await commitTypedDegrees(page, 90);
  await expectAngle(page, a.id, 90, '390 typed 90 must commit 90');

  const escapeInput = await showRotationPill(page);
  await escapeInput.fill('270');
  await expect(escapeInput).toHaveValue('270');
  await escapeInput.press('Escape');
  await expectAngle(page, a.id, 90, '390 Escape must restore 90 and not commit 270');

  await commitTypedDegrees(page, 360);
  await expectAngle(page, a.id, 0, '390 360 must wrap to 0');

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('ROTATION_INPUT_FIELD_390_PROOF', JSON.stringify({
    id: a.id,
    viewBox,
    fileId: null,
  }));
});
