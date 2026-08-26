import { test, expect } from '@playwright/test';

// AFTER_CALLOUT_FILL_SWATCH_INDEPENDENT_HUNT
// Independent hunt after selected-callout Fill swatch independence (c22e7910).
// No unique LIVE leftover proved. Selected-shape Fill vs Border already
// stamps independent rgba and Select chrome stays 0.90 / 0.10 (not leftover
// 0.09). Selected-textbox first-create already stamps Fill 90 + Border 10.
// Do not invent a leftover. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('lastShapeTool');
      localStorage.removeItem('lastDrawTool');
      localStorage.removeItem('lastReviewTool');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('surveyMarkers_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
          || key.startsWith('pdfSidebar_')
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
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

async function dismissChrome(page) {
  await blurInputs(page);
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function activateTool(page, categoryName, toolName) {
  const hostTool = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true }).first();
  if (!(await hostTool.isVisible().catch(() => false))) {
    const buttons = page.getByRole('button', { name: categoryName, exact: true });
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      if (await buttons.nth(i).isVisible().catch(() => false)) {
        await buttons.nth(i).click();
        break;
      }
    }
  }
  if (await hostTool.isVisible().catch(() => false)) {
    if ((await hostTool.getAttribute('aria-pressed')) !== 'true') await hostTool.click();
    return;
  }
  const mobile = page.getByRole('button', { name: toolName, exact: true });
  const count = await mobile.count();
  for (let i = 0; i < count; i += 1) {
    const btn = mobile.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const pressed = await btn.getAttribute('aria-pressed');
    if (pressed === 'true') return;
    await btn.click();
    return;
  }
  await expect(hostTool, `tool ${toolName}`).toBeVisible();
}

async function applyOpacity(page, tabName, pct) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  const presets = page.getByRole('button', { name: 'Preset colors', exact: true });
  if (!(await presets.isVisible().catch(() => false))) await color.click();
  await expect(presets).toBeVisible({ timeout: 8_000 });
  const tab = page.getByRole('button', { name: tabName, exact: true }).first();
  if (await tab.isVisible().catch(() => false)) await tab.click();
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await field.press('Enter');
  await expect(field).toHaveValue(String(pct));
  await page.keyboard.press('Escape');
  await expect(presets).toHaveCount(0, { timeout: 8_000 }).catch(() => {});
  await dismissChrome(page);
}

async function colorSwatchPaint(page) {
  return page.evaluate(() => {
    const parse = (css) => {
      const m = String(css || '').match(
        /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i,
      );
      if (!m) return null;
      return { a: m[4] == null ? 1 : Number(m[4]), css: String(css || '') };
    };
    const btn = document.querySelector('[data-annotation-color-trigger]');
    if (!btn) return null;
    const fill = btn.querySelector('.ctx-color-fill');
    return {
      fill: parse(fill ? getComputedStyle(fill).backgroundColor : ''),
      stroke: parse(getComputedStyle(btn).borderTopColor || getComputedStyle(btn).borderColor),
    };
  });
}

async function annoSnapshot(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-anno-id]')]
      .map((el) => el.getAttribute('data-anno-id'))
      .filter(Boolean);
    return [...new Set(ids)].map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        type: String(object.type || '').toLowerCase(),
        fill: object.fill ?? null,
        stroke: object.stroke ?? null,
        backgroundColor: object.backgroundColor ?? null,
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true);
  });
}

function parseA(css) {
  const m = String(css || '').match(/rgba?\([^)]+,\s*([\d.]+)\s*\)/i);
  if (m) return Number(m[1]);
  if (!css || css === 'transparent' || css === 'none') return 0;
  return 1;
}

async function selectById(page, id) {
  const selectBtn = page.getByRole('button', { name: 'Select', exact: true }).first();
  if ((await selectBtn.getAttribute('aria-pressed')) !== 'true') await selectBtn.click();
  await page.locator(`[data-anno-id="${id}"]`).first().click({ force: true });
}

test('desktop selected-shape / textbox Fill vs Border already independent intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await activateTool(page, 'Shapes', 'Rectangle');
  await applyOpacity(page, 'Fill', 90);
  await applyOpacity(page, 'Border', 10);
  await activateTool(page, 'Shapes', 'Rectangle');
  const box = await pageBox(page);
  const beforeRect = new Set((await annoSnapshot(page)).map((row) => row.id));
  await page.mouse.move(box.x + box.width * 0.20, box.y + box.height * 0.20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.34, { steps: 8 });
  await page.mouse.up();
  let rect = null;
  await expect.poll(async () => {
    const rows = (await annoSnapshot(page)).filter((row) => !beforeRect.has(row.id));
    rect = rows[0] || null;
    return rect;
  }, { message: 'expected a new rect' }).not.toBeNull();
  expect(parseA(rect.fill), 'rect Fill must stamp 0.90').toBeCloseTo(0.90, 2);
  expect(parseA(rect.stroke), 'rect Border must stamp 0.10').toBeCloseTo(0.10, 2);

  await selectById(page, rect.id);
  await expect.poll(async () => {
    const paint = await colorSwatchPaint(page);
    return paint?.fill
      && Math.abs(paint.fill.a - 0.90) < 0.04
      && Math.abs(paint.fill.a - 0.09) > 0.04
      && paint?.stroke
      && Math.abs(paint.stroke.a - 0.10) < 0.04
      ? paint
      : null;
  }, { timeout: 12_000, message: 'selected-shape Fill swatch must stay 0.90, not leftover 0.09' }).not.toBeNull();

  await activateTool(page, 'Text', 'Text');
  await applyOpacity(page, 'Fill', 90);
  await applyOpacity(page, 'Border', 10);
  await activateTool(page, 'Text', 'Text');
  const beforeText = new Set((await annoSnapshot(page)).map((row) => row.id));
  await page.mouse.click(box.x + box.width * 0.24, box.y + box.height * 0.55);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially('Hi', { delay: 6 });
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  let text = null;
  await expect.poll(async () => {
    const rows = (await annoSnapshot(page)).filter((row) => !beforeText.has(row.id));
    text = rows[0] || null;
    return text;
  }, { message: 'expected a new textbox' }).not.toBeNull();
  expect(parseA(text.backgroundColor), 'textbox Fill must stamp 0.90').toBeCloseTo(0.90, 2);
  expect(parseA(text.stroke), 'textbox Border must stamp 0.10').toBeCloseTo(0.10, 2);

  await openEditor(page);
  await dismissChrome(page);
  const emptyExport = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(emptyExport).toBeVisible();
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    emptyExport.click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  expect((await annoSnapshot(page)).length, 'empty export must not invent a shape').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 selected-shape Fill vs Border already independent edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await annoSnapshot(page)).length).toBe(0);

  const mobileRect = page.getByRole('button', { name: 'Rectangle', exact: true }).first();
  if (await mobileRect.isVisible().catch(() => false)) {
    await activateTool(page, 'Shapes', 'Rectangle');
    await applyOpacity(page, 'Fill', 90);
    await applyOpacity(page, 'Border', 10);
    await activateTool(page, 'Shapes', 'Rectangle');
    const box = await pageBox(page);
    const before = new Set((await annoSnapshot(page)).map((row) => row.id));
    await page.mouse.move(box.x + box.width * 0.20, box.y + box.height * 0.20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.38, { steps: 8 });
    await page.mouse.up();
    let rect = null;
    await expect.poll(async () => {
      const rows = (await annoSnapshot(page)).filter((row) => !before.has(row.id));
      rect = rows[0] || null;
      return rect;
    }).not.toBeNull();
    expect(parseA(rect.fill)).toBeCloseTo(0.90, 2);
    expect(parseA(rect.stroke)).toBeCloseTo(0.10, 2);
    await selectById(page, rect.id);
    await expect.poll(async () => {
      const paint = await colorSwatchPaint(page);
      return paint?.fill
        && Math.abs(paint.fill.a - 0.90) < 0.04
        && Math.abs(paint.fill.a - 0.09) > 0.04
        ? paint
        : null;
    }, { timeout: 12_000, message: '390 Fill swatch must stay 0.90, not leftover 0.09' }).not.toBeNull();
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Rectangle', exact: true }).count()).toBe(0);
});
