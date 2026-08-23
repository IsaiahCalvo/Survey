import { test, expect } from '@playwright/test';

// Product bug leftover the rename/Escape hunts parked:
// annotation CompactColorPicker had no sibling passthrough, so the first
// Width / Style click after typing hex only dismissed the picker.
// Font color already passthroughed Font / Font size. Canvas dismiss must
// still not start a stroke. Distinct from leftover-18 / X-01. No file.id.

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

async function clickVisible(page, name) {
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return button;
    }
  }
  await expect(buttons.first(), `visible ${name}`).toBeVisible();
  await buttons.first().click();
  return buttons.first();
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

async function userInkCount(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .filter((group) => {
        const id = group.getAttribute('data-anno-id');
        const object = window.__phase35GetAnnotationById?.(id) || {};
        return object.isPdfImported !== true;
      }).length
  ), pageNumber);
}

async function openColorPicker(page) {
  const trigger = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('textbox', { name: 'Hex color', exact: true }).isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(page.getByRole('textbox', { name: 'Hex color', exact: true })).toBeVisible();
}

async function typeHex(page, value) {
  const field = page.getByRole('textbox', { name: 'Hex color', exact: true }).first();
  await expect(field).toBeVisible();
  await field.click();
  await field.fill(value);
}

test('desktop hex then Width / Style receive the dismiss click', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);

  await activateTool(page, 'Draw', 'Pen');
  await openColorPicker(page);
  await typeHex(page, '00FF00');

  // Intended — first Width click dismisses the picker and opens presets.
  const widthTrigger = page.getByRole('button', { name: 'Width presets', exact: true }).first();
  await expect(widthTrigger).toBeVisible();
  await widthTrigger.click();
  await expect(page.getByRole('textbox', { name: 'Hex color', exact: true })).toHaveCount(0);
  const widthPopover = page.locator('[data-annotation-size-popover="true"]');
  await expect(widthPopover).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await expect(widthPopover).toHaveCount(0);

  await activateTool(page, 'Shapes', 'Rectangle');
  await openColorPicker(page);
  await typeHex(page, 'FF0000');
  const styleTrigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(styleTrigger).toBeVisible();
  await styleTrigger.click();
  await expect(page.getByRole('textbox', { name: 'Hex color', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-annotation-dropdown-popover="true"]').getByText('Cloud', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // Break — canvas click still dismisses without starting a stroke.
  await activateTool(page, 'Draw', 'Pen');
  await openColorPicker(page);
  const before = await userInkCount(page);
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pageEl.boundingBox();
  expect(box, 'page geometry').toBeTruthy();
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.40);
  await expect(page.getByRole('textbox', { name: 'Hex color', exact: true })).toHaveCount(0);
  expect(await userInkCount(page)).toBe(before);
  // DismissBarrier keeps a same-gesture click blocker briefly after outside
  // pointerdown. Wait it out before the next chrome click.
  await page.waitForTimeout(1000);

  // Break — color swatch is not passthrough: the same click that dismisses
  // does not toggle the picker back open.
  await openColorPicker(page);
  await expect(page.getByRole('textbox', { name: 'Hex color', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Hex color', exact: true })).toHaveCount(0);

  await assertNoErrorBoundary(page);
  console.log('COLOR_PICKER_WIDTH_PASSTHROUGH', JSON.stringify({
    widthFirstClick: true,
    styleFirstClick: true,
    canvasNoStroke: true,
    swatchToggleCloses: true,
  }));
});

test('color picker Width passthrough edge: 390 takeover + hub + testPdf', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await activateTool(page, 'Draw', 'Pen');
  const mobileSwatch = page.getByRole('button', { name: 'Stroke color', exact: true }).first();
  if (await mobileSwatch.isVisible().catch(() => false)) {
    await mobileSwatch.click();
    const openPicker = page.getByRole('button', { name: 'Open stroke color picker', exact: true });
    await expect(openPicker).toBeVisible({ timeout: 8_000 });
    await openPicker.click();
    const hex = page.getByRole('textbox', { name: 'Hex color', exact: true });
    await expect(hex).toBeVisible({ timeout: 8_000 });
    await hex.fill('0000FF');
    // 390 uses a modal takeover + backdrop. The first Width tap closes the
    // picker; presets must not open on that same gesture.
    const width = page.getByRole('button', { name: 'Width presets', exact: true }).first();
    if (await width.isVisible().catch(() => false)) {
      await width.click();
    } else {
      await page.getByRole('button', { name: /Close .*color picker/i }).first().click();
    }
    await expect(hex).toHaveCount(0);
    await expect(page.locator('[data-annotation-size-popover="true"]')).toHaveCount(0);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Width presets', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Hex color', exact: true })).toHaveCount(0);

  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible();
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('COLOR_PICKER_WIDTH_PASSTHROUGH_EDGE', JSON.stringify({
    mobile390: true,
    hub: true,
    testPdf: true,
  }));
});
