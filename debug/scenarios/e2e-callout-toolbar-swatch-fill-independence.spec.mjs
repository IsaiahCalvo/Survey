import { test, expect } from '@playwright/test';

// Selected-callout Color Fill swatch multiplied leftover Border so a Fill
// of 90 + Border of 10 painted the Fill disc at 9% until Fill was
// re-touched. Persist / export / flatten / page view already honored the
// 0–1 values independently. Distinct from leftover-18, selected-callout
// swatch floor 0.08 / 0.2, callout Fill / Border Opacity screen floors,
// and C-01 swatch / hex / Transparent apply. Do not click swatch / hex /
// Transparent. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const LIVE_FILL = 90;
const LIVE_BORDER = 10;

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
        )) {
          keys.push(key);
        }
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

async function calloutSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
  return page.evaluate(({ pageNum, includeImported: keepImported }) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const style = legacy.style || data.style || object.style || {};
      return {
        id,
        text: String(object.text || legacy.text || data.text || ''),
        fillOpacity: style.fillOpacity ?? null,
        borderOpacity: style.borderOpacity ?? null,
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
      };
    }).filter((row) => keepImported || row.imported !== true);
  }, { pageNum: pageNumber, includeImported });
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

async function createCallout(page, text = 'Y') {
  const before = new Set((await calloutSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Text', 'Callout');
  await applyOpacity(page, 'Fill', LIVE_FILL);
  await applyOpacity(page, 'Border', LIVE_BORDER);
  await activateTool(page, 'Text', 'Callout');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.22);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.40, { steps: 10 });
  await page.mouse.up();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  if (text) await editor.pressSequentially(text, { delay: 6 });
  await page.mouse.click(12, 200);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.mouse.click(box.x + box.width - 12, box.y + box.height - 12);
  }
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  let created = null;
  await expect.poll(async () => {
    const rows = (await calloutSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created
      && Math.abs(Number(created.fillOpacity) - LIVE_FILL / 100) < 0.02
      && Math.abs(Number(created.borderOpacity) - LIVE_BORDER / 100) < 0.02
      ? created
      : null;
  }, { message: `expected a new callout with fill ${LIVE_FILL} and border ${LIVE_BORDER}` }).not.toBeNull();
  await dismissChrome(page);
  return created;
}

async function selectCallout(page, id) {
  const selectBtn = page.getByRole('button', { name: 'Select', exact: true }).first();
  await expect(selectBtn).toBeVisible({ timeout: 8_000 });
  if ((await selectBtn.getAttribute('aria-pressed')) !== 'true') {
    await selectBtn.click();
  }
  await expect(selectBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 8_000 }).catch(() => {});
  const box = page.locator(
    `[data-svg-annotation-layer="1"] [data-callout-id="${id}"] [data-callout-part="textBox"]`,
  ).first();
  if (await box.count()) {
    await box.click({ force: true });
  } else {
    await page.locator(`[data-svg-annotation-layer="1"] [data-callout-id="${id}"]`).first().click({ force: true });
  }
}

async function colorSwatchPaint(page) {
  return page.evaluate(() => {
    const parse = (css) => {
      const m = String(css || '').match(
        /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i,
      );
      if (!m) return null;
      return {
        r: Number(m[1]),
        g: Number(m[2]),
        b: Number(m[3]),
        a: m[4] == null ? 1 : Number(m[4]),
        css: String(css || ''),
      };
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

test('desktop selected-callout Color Fill swatch stays 90 after Border 10 intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createCallout(page, 'Y');
  expect(created.text).toBe('Y');
  expect(Number(created.fillOpacity), 'Fill Opacity must stamp 0.90').toBeCloseTo(0.90, 2);
  expect(Number(created.borderOpacity), 'Border Opacity must stamp 0.10').toBeCloseTo(0.10, 2);

  await selectCallout(page, created.id);
  await expect.poll(async () => {
    const paint = await colorSwatchPaint(page);
    return paint?.fill
      && Math.abs(paint.fill.a - 0.90) < 0.04
      && Math.abs(paint.fill.a - 0.09) > 0.04
      && paint?.stroke
      && Math.abs(paint.stroke.a - 0.10) < 0.04
      ? paint
      : null;
  }, { timeout: 12_000, message: 'selected Fill swatch must paint 0.90, not leftover 0.09' }).not.toBeNull();

  await openEditor(page);
  await dismissChrome(page);
  const emptyExport = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(emptyExport).toBeVisible();
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    emptyExport.click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  expect((await calloutSnapshot(page)).length, 'empty export must not invent a callout').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 selected-callout Fill swatch independence edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await calloutSnapshot(page)).length).toBe(0);

  const mobileCallout = page.getByRole('button', { name: 'Callout', exact: true }).first();
  if (await mobileCallout.isVisible().catch(() => false)) {
    const created = await createCallout(page, 'Y');
    expect(created.text).toBe('Y');
    expect(Number(created.fillOpacity)).toBeCloseTo(0.90, 2);
    expect(Number(created.borderOpacity)).toBeCloseTo(0.10, 2);
    await selectCallout(page, created.id);
    await expect.poll(async () => {
      const paint = await colorSwatchPaint(page);
      return paint?.fill
        && Math.abs(paint.fill.a - 0.90) < 0.04
        && Math.abs(paint.fill.a - 0.09) > 0.04
        ? paint
        : null;
    }, { timeout: 12_000, message: '390 Fill swatch must stay 0.90, not leftover 0.09' }).not.toBeNull();
  } else {
    expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
});
