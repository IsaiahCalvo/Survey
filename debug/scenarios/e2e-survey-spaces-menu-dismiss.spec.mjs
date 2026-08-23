import { test, expect } from '@playwright/test';

// Unique leftover after Pages context dismiss (`5c01eecc` / `9e52e13e`).
// Survey / Spaces rail menus stayed open on a page click while Rectangle was
// armed: listeners waited for mousedown, and SVG pointerdown preventDefault
// suppresses that mousedown. Last hunt noted these were not live-proved.
// Template re-pick apply, module Next/Prev apply, Space CSV / PDF Pages apply
// stay dedicated or leftover-18. This leftover is dismiss only.
// Do not stamp file.id. Do not invent Extract / Note-Link / Forms.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1';
const KAL436 = /KAL-436 Preservation Template/;
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

async function openPage(page, { width = 1400, height = 900, url = SURVEY_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
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

function chooseTemplateBtn(page) {
  return page.getByRole('button', { name: 'Choose survey template' });
}

function templateListbox(page) {
  return page.getByRole('listbox', { name: 'Choose survey template' });
}

function moduleTrigger(page) {
  return page.locator('#chrome-right-host button[aria-haspopup="listbox"]:not([aria-label="Choose survey template"])');
}

function moduleListbox(page) {
  return page.getByRole('listbox', { name: 'Choose survey module' });
}

function spacesExportMenu(page) {
  return page.locator('.spaces-header-export-menu');
}

async function enterSurveyKal436(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: KAL436 }).click();
  await expect(chooseTemplateBtn(page)).toBeVisible({ timeout: 15_000 });
}

async function openTemplatePicker(page) {
  const btn = chooseTemplateBtn(page);
  await expect(btn).toBeVisible({ timeout: 8_000 });
  if ((await btn.getAttribute('aria-expanded')) !== 'true') {
    await btn.click();
  }
  await expect(templateListbox(page)).toBeVisible({ timeout: 8_000 });
}

async function openModulePicker(page) {
  const btn = moduleTrigger(page);
  await expect(btn.first()).toBeVisible({ timeout: 8_000 });
  if ((await btn.first().getAttribute('aria-expanded')) !== 'true') {
    await btn.first().click();
  }
  await expect(moduleListbox(page)).toBeVisible({ timeout: 8_000 });
}

async function openSpaces(page) {
  const tab = page.getByRole('button', { name: 'Spaces', exact: true });
  await expect(tab).toBeVisible({ timeout: 15_000 });
  if ((await tab.getAttribute('aria-pressed')) !== 'true') {
    await tab.click();
  }
  await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeVisible({ timeout: 15_000 });
}

async function viewerSpacePan(page) {
  return page.locator('.survey-pdfjs-viewer').first().evaluate((el) => el.dataset.spacePan || 'off');
}

test('desktop Survey / Spaces menu dismiss intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  const hubSurvey = await page.getByRole('button', { name: 'Survey', exact: true }).count();
  const hubSpaces = await page.getByRole('button', { name: 'Spaces', exact: true }).count();
  const hubDraw = await page.getByRole('button', { name: 'Draw', exact: true }).count();

  await openPage(page, { url: SURVEY_PDF });
  await assertNoErrorBoundary(page);
  expect(await pageViewBox(page), 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();

  const hunt = await huntHiddenChrome(page);
  for (const [name, count] of Object.entries(hunt)) {
    expect(count, `${name} compile-hidden`).toBe(0);
  }

  await enterSurveyKal436(page);
  await armRectangle(page);
  const marksBefore = await userAnnotationIds(page);

  // Intended: template picker Escape closes.
  await openTemplatePicker(page);
  await page.keyboard.press('Escape');
  await expect(templateListbox(page), 'Escape must close template picker').toHaveCount(0);

  // Intended: page click closes while Rectangle is armed; no invented rect.
  await openTemplatePicker(page);
  await expect(templateListbox(page)).toBeVisible({ timeout: 5_000 });
  await clickPage(page);
  await expect(templateListbox(page), 'click-outside must close template picker').toHaveCount(0);
  expect(await userAnnotationIds(page), 'template dismiss must not start a rubber-band').toEqual(marksBefore);
  await page.keyboard.press('Escape');
  await expect(templateListbox(page), 'Escape with template closed invents 0').toHaveCount(0);

  // Intended: module picker Escape + page click.
  await openModulePicker(page);
  await page.keyboard.press('Escape');
  await expect(moduleListbox(page), 'Escape must close module picker').toHaveCount(0);
  await openModulePicker(page);
  await clickPage(page, 0.78, 0.78);
  await expect(moduleListbox(page), 'click-outside must close module picker').toHaveCount(0);
  expect(await userAnnotationIds(page), 'module dismiss must not start a rubber-band').toEqual(marksBefore);

  // Intended: Spaces export menu dismiss only — do not click leftover-18 CSV / PDF Pages.
  await openSpaces(page);
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await page.waitForTimeout(360);
  const exportBtn = page.getByRole('button', { name: 'Export Space 1', exact: true });
  await expect(exportBtn).toBeVisible({ timeout: 8_000 });
  await armRectangle(page);
  await exportBtn.click();
  await expect(spacesExportMenu(page)).toBeVisible({ timeout: 5_000 });
  await expect(spacesExportMenu(page).getByRole('button', { name: 'CSV', exact: true })).toBeVisible();
  await expect(spacesExportMenu(page).getByRole('button', { name: 'PDF Pages', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(spacesExportMenu(page), 'Escape must close Spaces export').toHaveCount(0);
  await exportBtn.click();
  await expect(spacesExportMenu(page)).toBeVisible({ timeout: 5_000 });
  await clickPage(page, 0.74, 0.74);
  await expect(spacesExportMenu(page), 'click-outside must close Spaces export').toHaveCount(0);
  expect(await userAnnotationIds(page), 'Spaces export dismiss must not start a rubber-band').toEqual(marksBefore);

  // Break: Space stays temporary-pan and does not open these menus.
  await blurInputs(page);
  await page.keyboard.down('Space');
  await expect(templateListbox(page), 'Space must not open template picker').toHaveCount(0);
  await expect(moduleListbox(page), 'Space must not open module picker').toHaveCount(0);
  await expect(spacesExportMenu(page), 'Space must not open Spaces export').toHaveCount(0);
  const panWhileHeld = await viewerSpacePan(page);
  expect(['armed', 'dragging'], 'Space stays temporary-pan').toContain(panWhileHeld);
  await page.keyboard.up('Space');
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible();

  // Break: hubPreview has no Survey / Spaces / Draw.
  expect(hubSurvey, 'hubPreview has no Survey').toBe(0);
  expect(hubSpaces, 'hubPreview has no Spaces').toBe(0);
  expect(hubDraw, 'hubPreview has no Draw').toBe(0);

  // Edge: search fixture keeps portrait viewBox + null file.id.
  await openPage(page, { url: SEARCH_PDF });
  await assertNoErrorBoundary(page);
  await enterSurveyKal436(page);
  await armRectangle(page);
  await openTemplatePicker(page);
  await clickPage(page);
  await expect(templateListbox(page), 'search-fixture page click must close template picker').toHaveCount(0);
  expect(await pageViewBox(page), 'search fixture viewBox').toBe('0 0 612 792');
  expect(await fileId(page), 'search fixture file.id must stay null').toBeNull();
  const huntSearch = await huntHiddenChrome(page);
  expect(huntSearch.Print, 'search fixture Print').toBe(0);
});

test('390 Survey / Spaces menu dismiss edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { width: 390, height: 844, url: SURVEY_PDF });
  await assertNoErrorBoundary(page);
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

  const openSurvey = page.getByRole('button', { name: 'Open survey', exact: true });
  if (await openSurvey.count()) {
    await openSurvey.click();
    const firstPick = page.getByRole('heading', { name: 'Choose survey template' });
    if (await firstPick.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: KAL436 }).click();
    }
    if (await chooseTemplateBtn(page).count()) {
      await openTemplatePicker(page);
      await clickPage(page);
      await expect(templateListbox(page), '390 page click must close template picker').toHaveCount(0);
    }
    const exportSurvey = page.getByRole('button', { name: 'Export survey data', exact: true });
    if (await exportSurvey.count()) {
      await exportSurvey.click();
      const exportMenu = page.locator('.mobile-survey-sheet-export-menu');
      if (await exportMenu.count()) {
        await clickPage(page, 0.8, 0.8);
        await expect(exportMenu, '390 page click must close survey export').toHaveCount(0);
      }
    }
  }

  expect(await pageViewBox(page), '390 viewBox').toBe('0 0 612 792');
  expect(await fileId(page), '390 file.id must stay null').toBeNull();
  const hunt = await huntHiddenChrome(page);
  expect(hunt.Print, '390 Print').toBe(0);
});
