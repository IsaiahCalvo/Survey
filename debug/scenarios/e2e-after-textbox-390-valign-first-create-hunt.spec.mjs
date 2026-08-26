import { test, expect } from '@playwright/test';

// AFTER_TEXTBOX_390_VALIGN_FIRST_CREATE_HUNT
// Genuine hunt of 390 first-create / next-draw / tool-pref leftovers after
// valign first-create (f2f02e68). No unique LIVE leftover proved.
// Text Italic / Underline / Strike / size / color / align already ride.
// Callout those styles + Width / Dashed / Open Triangle already ride.
// Do not invent Color chrome mobile does not have, callout verticalAlign,
// Line /AP, callout Rotation, or a richTextEditor. Do not stamp file.id.

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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
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

async function pageBox(page) {
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await expect(pageEl).toBeVisible();
  return pageEl.boundingBox();
}

async function dragOnPage(page, { x0, y0, x1, y1 }) {
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function closeTextSheet(page) {
  const close = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  if (await close.isVisible().catch(() => false)) await close.click();
  else {
    const backdrop = page.getByRole('button', { name: 'Close text formatting', exact: true });
    if (await backdrop.isVisible().catch(() => false)) await backdrop.click();
    else await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toHaveCount(0);
}

async function pickMobileOption(page, ariaLabel, label) {
  const trigger = page.getByRole('button', { name: new RegExp(`^${ariaLabel}:`) }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const listbox = page.getByRole('listbox', { name: ariaLabel });
  await expect(listbox).toBeVisible({ timeout: 5_000 });
  await listbox.getByRole('option', { name: label, exact: true }).click();
  await expect(listbox).toHaveCount(0);
}

async function setWidth(page, n) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill('');
  await field.fill(String(n));
  await field.press('Enter');
}

async function snapshot(page) {
  return page.evaluate(() => {
    const annoIds = [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-anno-id]')]
      .map((el) => el.getAttribute('data-anno-id'))
      .filter(Boolean);
    const calloutIds = [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-callout-id]')]
      .map((el) => el.getAttribute('data-callout-id'))
      .filter(Boolean);
    return [...new Set([...annoIds, ...calloutIds])].map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const style = object.style || data.style || legacy.style || {};
      return {
        id,
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
        callout: Boolean(legacy.id || String(id).startsWith('callout-')),
        text: String(object.text ?? legacy.text ?? ''),
        textAlign: object.textAlign || data.textAlign || style.textAlign || null,
        verticalAlign: object.verticalAlign || data.verticalAlign || style.verticalAlign || null,
        fontSize: object.fontSize || data.fontSize || style.fontSize || null,
        fontStyle: object.fontStyle || data.fontStyle || null,
        italic: object.italic ?? data.italic ?? style.italic ?? (object.fontStyle === 'italic'),
        underline: object.underline ?? data.underline ?? style.underline ?? null,
        linethrough: object.linethrough ?? data.linethrough ?? style.strikethrough ?? null,
        fill: object.fill || style.fontColor || null,
        strokeWidth: object.strokeWidth ?? style.lineThickness ?? null,
        dash: object.strokeDashArray || style.lineStyle || null,
        arrow: data.arrowheadStyle || style.arrowheadStyle || null,
      };
    }).filter((row) => row.imported !== true);
  });
}

async function commitEditor(page) {
  const box = await pageBox(page);
  if (await page.locator('[data-text-edit-overlay] [contenteditable]').count()) {
    await page.mouse.click(12, 200);
    if (await page.locator('[data-text-edit-overlay]').count()) {
      await page.mouse.click(box.x + box.width - 12, box.y + box.height - 12);
    }
    await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  }
}

test('390 Text / Callout first-create prefs already ride + hubPreview break', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);

  await activateTool(page, 'Text', 'Text');
  await clickVisible(page, 'Text formatting');
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toBeVisible({ timeout: 8_000 });
  const bold = page.getByRole('button', { name: 'Bold', exact: true });
  if ((await bold.getAttribute('aria-pressed')) === 'true') await bold.click();
  await page.getByRole('button', { name: 'Italic', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Underline', exact: true }).click();
  await page.getByRole('button', { name: 'Strikethrough', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Strikethrough', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Font size').fill('24');
  await page.getByRole('button', { name: 'Set Text color #ff0000', exact: true }).click();
  await page.getByRole('button', { name: 'Right horizontal alignment', exact: true }).click();
  await closeTextSheet(page);

  const beforeText = new Set((await snapshot(page)).map((row) => row.id));
  await activateTool(page, 'Text', 'Text');
  await dragOnPage(page, { x0: 0.22, y0: 0.18, x1: 0.72, y1: 0.36 });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await page.keyboard.type('Hi');
  await commitEditor(page);
  let textRow = null;
  await expect.poll(async () => {
    textRow = (await snapshot(page)).find((row) => !beforeText.has(row.id) && !row.callout) || null;
    return textRow;
  }, { message: 'expected a new textbox' }).not.toBeNull();
  expect(textRow.text).toBe('Hi');
  expect(textRow.fontStyle, '390 Italic already rides first-create').toBe('italic');
  expect(textRow.underline, '390 Underline already rides first-create').toBe(true);
  expect(textRow.linethrough, '390 Strike already rides first-create').toBe(true);
  expect(textRow.fontSize, '390 size 24 already rides first-create').toBe(24);
  expect(String(textRow.fill).toLowerCase(), '390 Text color already rides first-create').toBe('#ff0000');
  expect(textRow.textAlign, '390 Right already rides first-create').toBe('right');
  expect(textRow.verticalAlign === 'top' || textRow.verticalAlign == null).toBeTruthy();

  await activateTool(page, 'Text', 'Callout');
  await setWidth(page, 8);
  await pickMobileOption(page, 'Arrowhead style', 'Open Triangle');
  await pickMobileOption(page, 'Border style', 'Dashed');
  const beforeCallout = new Set((await snapshot(page)).map((row) => row.id));
  await dragOnPage(page, { x0: 0.22, y0: 0.52, x1: 0.48, y1: 0.70 });
  const calloutEditor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(calloutEditor).toBeVisible({ timeout: 10_000 });
  await calloutEditor.click();
  await calloutEditor.pressSequentially('Yo', { delay: 6 });
  await commitEditor(page);
  let calloutRow = null;
  await expect.poll(async () => {
    calloutRow = (await snapshot(page)).find((row) => !beforeCallout.has(row.id) && row.callout) || null;
    return calloutRow;
  }, { message: 'expected a new callout' }).not.toBeNull();
  expect(calloutRow.text).toBe('Yo');
  expect(calloutRow.italic, '390 Callout Italic already rides first-create').toBe(true);
  expect(calloutRow.underline, '390 Callout Underline already rides first-create').toBe(true);
  expect(calloutRow.linethrough, '390 Callout Strike already rides first-create').toBe(true);
  expect(calloutRow.fontSize, '390 Callout size already rides first-create').toBe(24);
  expect(calloutRow.textAlign, '390 Callout Right already rides first-create').toBe('right');
  expect(calloutRow.strokeWidth, '390 Callout Width 8 already rides first-create').toBe(8);
  expect(calloutRow.dash, '390 Callout Dashed already rides first-create').toBe('dashed');
  expect(calloutRow.arrow, '390 Callout Open Triangle already rides first-create').toBe('openTriangle');
  expect(calloutRow.verticalAlign, 'must not invent callout verticalAlign').toBeNull();
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await fileId(page)).toBeNull();

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await assertNoErrorBoundary(page);
  expect(await page.getByRole('button', { name: 'Text formatting', exact: true }).count(), 'hubPreview Text formatting must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Italic', exact: true }).count()).toBe(0);
});

test('1440 edge: no 390 sheet; viewBox / file.id / no invent', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  expect(await page.getByRole('button', { name: 'Bottom vertical alignment', exact: true }).count(), '1440 next-draw Bottom chrome must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Italic', exact: true }).count(), '1440 next-draw Italic chrome must be 0').toBe(0);

  await activateTool(page, 'Text', 'Text');
  const before = (await snapshot(page)).length;
  await activateTool(page, 'Text', 'Callout');
  expect(await page.getByRole('button', { name: 'Bottom vertical alignment', exact: true }).count(), '1440 Callout Bottom chrome must stay 0').toBe(0);
  expect((await snapshot(page)).length, 'Callout tool must invent 0 textboxes').toBe(before);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
});
