import { test, expect } from '@playwright/test';

// 390 Text vertical alignment leftover-stayed top on first-create.
// Live sheet already offered Bottom / Middle, and textAlign already rode
// newTextStyle, but TextEditOverlay hardcoded verticalAlign 'top' so a
// next-draw Bottom never reached persist until alignment was re-touched.
// Distinct from leftover-18, MobileRailNav Escape, 390 stroke minOpacity,
// desktop T-06 3×3, and user-settable callout verticalAlign (not invented).
// Do not click swatch / hex / Transparent. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, {
  width = 390,
  height = 844,
  url = LINK_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
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
  if (!(await visibleSub())) await clickVisible(page, categoryName);
  const tool = await visibleSub();
  if (tool && (await tool.getAttribute('aria-pressed')) !== 'true') await tool.click();
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function dragOnPage(page, { x0, y0, x1, y1 }) {
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await expect(pageEl).toBeVisible();
  const box = await pageEl.boundingBox();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
}

async function commitTextEditor(page) {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  if (!(await editor.isVisible().catch(() => false))) return;
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pageEl.boundingBox();
  await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.10);
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]')).toHaveCount(0, { timeout: 8_000 });
}

async function textSnapshot(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || data.tool || '').toLowerCase(),
        tool: String(data.tool || data.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
        callout: object.data?.type === 'callout' || String(id).startsWith('callout-') || object.callout === true,
        text: String(object.text ?? data.text ?? ''),
        textAlign: object.textAlign || data.textAlign || null,
        verticalAlign: object.verticalAlign || data.verticalAlign || null,
      };
    }).filter((row) => row.imported !== true);
  });
}

function isTextRow(row) {
  if (row.callout) return false;
  return row.type === 'textbox' || row.type === 'text' || row.tool === 'text' || row.tool === 'textbox';
}

async function closeTextSheet(page) {
  const close = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  if (await close.isVisible().catch(() => false)) await close.click();
  else {
    const backdrop = page.getByRole('button', { name: 'Close text formatting', exact: true });
    if (await backdrop.isVisible().catch(() => false)) await backdrop.click();
    else await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('button', { name: 'Bottom vertical alignment', exact: true })).toHaveCount(0);
}

async function createText(page, text, coords) {
  const before = new Set((await textSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Text', 'Text');
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await page.keyboard.type(text);
  await commitTextEditor(page);
  let created = null;
  await expect.poll(async () => {
    created = (await textSnapshot(page)).find((row) => !before.has(row.id) && isTextRow(row)) || null;
    return created;
  }, { message: 'expected a new textbox' }).not.toBeNull();
  return created;
}

test('390 Text verticalAlign first-create intended + hubPreview break', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);

  await activateTool(page, 'Text', 'Text');
  await clickVisible(page, 'Text formatting');
  await expect(page.getByRole('button', { name: 'Bottom vertical alignment', exact: true })).toBeVisible({ timeout: 8_000 });
  await page.getByRole('button', { name: 'Bottom vertical alignment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bottom vertical alignment', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Right horizontal alignment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Right horizontal alignment', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await closeTextSheet(page);

  const created = await createText(page, 'Hi', { x0: 0.22, y0: 0.18, x1: 0.72, y1: 0.42 });
  expect(created.text, '390 first box must keep Hi').toBe('Hi');
  expect(created.textAlign, '390 Right must ride first-create').toBe('right');
  expect(created.verticalAlign, '390 Bottom must ride first-create (not leftover top)').toBe('bottom');
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await fileId(page)).toBeNull();

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await assertNoErrorBoundary(page);
  expect(await page.getByRole('button', { name: 'Text formatting', exact: true }).count(), 'hubPreview Text formatting must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Bottom vertical alignment', exact: true }).count()).toBe(0);
});

test('1440 first-create stays top; 390 edge viewBox / file.id / no invent', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  expect(await page.getByRole('button', { name: 'Bottom vertical alignment', exact: true }).count(), '1440 next-draw Bottom chrome must be 0').toBe(0);

  await activateTool(page, 'Text', 'Text');
  const created = await createText(page, 'Desk', { x0: 0.22, y0: 0.18, x1: 0.52, y1: 0.28 });
  expect(created.text).toBe('Desk');
  expect(created.verticalAlign, '1440 first-create stays top (no 390 sheet)').toBe('top');
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();

  const before = (await textSnapshot(page)).length;
  await activateTool(page, 'Text', 'Callout');
  expect(await page.getByRole('button', { name: 'Bottom vertical alignment', exact: true }).count(), '1440 Callout Bottom chrome must stay 0').toBe(0);
  expect((await textSnapshot(page)).length, 'Callout tool must invent 0 textboxes').toBe(before);
});
