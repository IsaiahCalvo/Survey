import { test, expect } from '@playwright/test';

// Unique leftover after Fit-options dismiss (`e6168568`).
// Style / Width formatting popovers stayed open on a page click while a
// creation tool was armed: exclusive layer listened for capture mousedown,
// and Rectangle pointerdown preventDefault suppresses that mousedown.
// Fit options apply + dismiss, Select caret arm-then-toggle, Home, rail
// Prev-Next, P-04 letters, remapped-after-CW, leftover-18 are not this slice.
// Do not stamp file.id. Do not invent measure / Note-Link / Forms.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

async function openPage(page, { width = 1400, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
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
  if (url.includes('hubPreview=1')) {
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    return;
  }
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
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

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function huntHiddenChrome(page) {
  const counts = {};
  for (const name of HIDDEN) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

async function userAnnotationIds(page) {
  return page.locator('[data-svg-annotation-layer="1"] [data-anno-id]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-anno-id')).filter(Boolean)
  ));
}

async function armRectangle(page) {
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Style', exact: true })).toBeVisible({ timeout: 5_000 });
}

async function clickPage(page, fracX = 0.82, fracY = 0.82) {
  const layer = page.locator('[data-svg-annotation-layer="1"]').first();
  const box = await layer.boundingBox();
  expect(box, 'page layer has a box').toBeTruthy();
  await page.mouse.click(box.x + box.width * fracX, box.y + box.height * fracY);
}

function dashedOption(page) {
  return page.getByRole('option', { name: 'Dashed', exact: true });
}

function widthPopover(page) {
  return page.locator('[data-annotation-size-popover="true"]');
}

async function viewerSpacePan(page) {
  return page.locator('.survey-pdfjs-viewer').first().evaluate((el) => el.dataset.spacePan || 'off');
}

test('desktop Style / Width menu dismiss intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  const hubStyle = await page.getByRole('button', { name: 'Style', exact: true }).count();
  const hubDraw = await page.getByRole('button', { name: 'Draw', exact: true }).count();

  await openPage(page, { url: LINK_PDF });
  await assertNoErrorBoundary(page);
  expect(await pageViewBox(page), 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();

  const hunt = await huntHiddenChrome(page);
  for (const [name, count] of Object.entries(hunt)) {
    expect(count, `${name} compile-hidden`).toBe(0);
  }

  await armRectangle(page);
  const marksBefore = await userAnnotationIds(page);

  // Intended: Style opens Solid / Dashed / Dotted / Cloud; Escape closes.
  await page.getByRole('button', { name: 'Style', exact: true }).click();
  await expect(dashedOption(page)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('option', { name: 'Solid', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Cloud', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dashedOption(page), 'Escape must close Style').toHaveCount(0);

  // Intended: page click closes Style; does not invent a rect (consume).
  await page.getByRole('button', { name: 'Style', exact: true }).click();
  await expect(dashedOption(page)).toBeVisible({ timeout: 5_000 });
  await clickPage(page);
  await expect(dashedOption(page), 'click-outside must close Style').toHaveCount(0);
  expect(await userAnnotationIds(page), 'Style dismiss must not start a rubber-band').toEqual(marksBefore);
  await page.keyboard.press('Escape');
  await expect(dashedOption(page), 'Escape with Style closed invents 0').toHaveCount(0);

  // Intended: Width presets open; page click closes; no invented mark.
  await page.getByRole('button', { name: 'Width presets', exact: true }).click();
  await expect(widthPopover(page)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('option', { name: '16', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(widthPopover(page), 'Escape must close Width presets').toHaveCount(0);

  await page.getByRole('button', { name: 'Width presets', exact: true }).click();
  await expect(widthPopover(page)).toBeVisible({ timeout: 5_000 });
  await clickPage(page, 0.78, 0.78);
  await expect(widthPopover(page), 'click-outside must close Width presets').toHaveCount(0);
  expect(await userAnnotationIds(page), 'Width dismiss must not start a rubber-band').toEqual(marksBefore);

  // Intended: color swatch page-click dismiss (DismissBarrier + exclusive layer).
  const colorTrigger = page.locator('[data-annotation-color-trigger]').first();
  await expect(colorTrigger).toBeVisible();
  await colorTrigger.click();
  const colorPicker = page.locator('[data-testid="compact-color-picker"]');
  await expect(colorPicker).toBeVisible({ timeout: 5_000 });
  await clickPage(page, 0.74, 0.74);
  await expect(colorPicker, 'click-outside must close color picker').toHaveCount(0);
  expect(await userAnnotationIds(page), 'color dismiss must not start a rubber-band').toEqual(marksBefore);

  // Break: Space stays temporary-pan and does not open Style.
  await blurInputs(page);
  await page.getByRole('button', { name: 'Style', exact: true }).focus();
  await expect(page.getByRole('button', { name: 'Style', exact: true })).toBeFocused();
  await page.keyboard.down('Space');
  await expect(dashedOption(page), 'Space must not open Style').toHaveCount(0);
  const panWhileHeld = await viewerSpacePan(page);
  expect(['armed', 'dragging'], 'Space on Style stays temporary-pan').toContain(panWhileHeld);
  await page.keyboard.up('Space');
  await expect(dashedOption(page), 'Space release must not leave Style open').toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible();

  // Break: hubPreview has no Style / Draw.
  expect(hubStyle, 'hubPreview has no Style').toBe(0);
  expect(hubDraw, 'hubPreview has no Draw').toBe(0);

  // Edge: search fixture keeps portrait viewBox + null file.id.
  await openPage(page, { url: SEARCH_PDF });
  await assertNoErrorBoundary(page);
  await armRectangle(page);
  await page.getByRole('button', { name: 'Style', exact: true }).click();
  await expect(dashedOption(page)).toBeVisible({ timeout: 5_000 });
  await clickPage(page);
  await expect(dashedOption(page), 'search-fixture page click must close Style').toHaveCount(0);
  expect(await pageViewBox(page), 'search fixture viewBox').toBe('0 0 612 792');
  expect(await fileId(page), 'search fixture file.id must stay null').toBeNull();
  const huntSearch = await huntHiddenChrome(page);
  expect(huntSearch.Print, 'search fixture Print').toBe(0);
});

test('390 Style dismiss edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await assertNoErrorBoundary(page);
  await expect(page.getByRole('button', { name: 'Fit options', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Zoom and fit options', exact: true })).toBeVisible();

  const tools = page.getByRole('button', { name: /Document tools|Shapes/ }).first();
  if (await page.getByRole('button', { name: 'Shapes', exact: true }).count()) {
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  } else if (await tools.count()) {
    await tools.click();
    const shapes = page.getByRole('button', { name: 'Shapes', exact: true });
    if (await shapes.count()) await shapes.click();
  }
  const rectangle = page.getByRole('button', { name: 'Rectangle', exact: true });
  if (await rectangle.count()) await rectangle.first().click();

  const styleTrigger = page.getByRole('button', { name: /^Style/ }).first();
  if (await styleTrigger.count() && await styleTrigger.isVisible().catch(() => false)) {
    await styleTrigger.click();
    const dashed = page.getByRole('option', { name: 'Dashed', exact: true });
    await expect(dashed).toBeVisible({ timeout: 5_000 });
    await clickPage(page);
    await expect(dashed, '390 page click must close Style').toHaveCount(0);
  } else {
    // 390 Style lives on the properties sheet after a shape exists; default
    // chrome has no desktop Style trigger. Distinct from Zoom-and-fit Escape.
    expect(await page.getByRole('button', { name: 'Style', exact: true }).count(), '390 default Style').toBe(0);
  }

  expect(await pageViewBox(page), '390 viewBox').toBe('0 0 612 792');
  expect(await fileId(page), '390 file.id must stay null').toBeNull();
  const hunt = await huntHiddenChrome(page);
  expect(hunt.Print, '390 Print').toBe(0);
});
