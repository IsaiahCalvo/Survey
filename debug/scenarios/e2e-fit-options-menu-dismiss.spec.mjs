import { test, expect } from '@playwright/test';

// Unique leftover after Home-tab click (`3431364f`).
// Fit options popup dismiss chrome (open / Escape / click-outside / Enter).
// Menu Fit height / Fit page / Fit width APPLY modes already dedicated.
// Ctrl+2 / Ctrl+M / Ctrl+0 / Ctrl+1 apply modes, they do not prove dismiss.
// Overlay lists Esc as Close dialogs; V-09 is the shortcuts overlay.
// Distinct from leftover-18 / X-01 / remapped-after-CW / Home tab / Close tab
// / rail Previous/Next / toolbar arm / P-04 letters.
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
    await expect(page.getByText(/Documents|Projects|Templates|Archive/i).first()).toBeVisible({ timeout: 30_000 });
    return;
  }
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
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

function fitTrigger(page) {
  return page.getByRole('button', { name: 'Fit options', exact: true }).first();
}

async function openFitMenu(page) {
  await fitTrigger(page).click();
  await expect(page.getByRole('button', { name: 'Fit page', exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: 'Fit width', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit height', exact: true })).toBeVisible();
}

async function expectFitMenuClosed(page, message = 'Fit options menu must close') {
  await expect(page.getByRole('button', { name: 'Fit page', exact: true }), message).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fit width', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fit height', exact: true })).toHaveCount(0);
}

async function viewerSpacePan(page) {
  return page.locator('.survey-pdfjs-viewer').first().evaluate((el) => el.dataset.spacePan || 'off');
}

test('desktop Fit options menu dismiss intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  const hubFit = await page.getByRole('button', { name: 'Fit options', exact: true }).count();
  const hubDraw = await page.getByRole('button', { name: 'Draw', exact: true }).count();

  await openPage(page, { url: LINK_PDF });
  await assertNoErrorBoundary(page);
  await expect(fitTrigger(page)).toBeVisible();
  await expect(fitTrigger(page)).toHaveAttribute('aria-haspopup', 'true');
  await expect(fitTrigger(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await pageViewBox(page), 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();

  const hunt = await huntHiddenChrome(page);
  for (const [name, count] of Object.entries(hunt)) {
    expect(count, `${name} compile-hidden`).toBe(0);
  }

  // Intended: click opens the three live fit modes; Actual size stays compile-hidden.
  await openFitMenu(page);
  await expect(fitTrigger(page)).toHaveAttribute('aria-expanded', 'true');
  expect(await page.getByRole('button', { name: 'Actual size', exact: true }).count(), 'Actual size stays 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Manual', exact: true }).count(), 'Manual row stays 0').toBe(0);

  // Intended: Escape dismisses without applying a different fit mode.
  const percentBeforeEscape = await page.getByRole('button', { name: 'Edit zoom percentage', exact: true }).innerText();
  await page.keyboard.press('Escape');
  await expectFitMenuClosed(page, 'Escape must close Fit options');
  await expect(fitTrigger(page)).toHaveAttribute('aria-expanded', 'false');
  const percentAfterEscape = await page.getByRole('button', { name: 'Edit zoom percentage', exact: true }).innerText();
  expect(percentAfterEscape, 'Escape dismiss must not change zoom %').toBe(percentBeforeEscape);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  // Intended: click-outside on the page closes; second Escape invents 0.
  await openFitMenu(page);
  const layer = page.locator('[data-svg-annotation-layer="1"]').first();
  const box = await layer.boundingBox();
  expect(box, 'page layer has a box').toBeTruthy();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await expectFitMenuClosed(page, 'click-outside must close Fit options');
  await page.keyboard.press('Escape');
  await expectFitMenuClosed(page, 'Escape with menu closed invents 0');
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible();

  // Break: Enter on the focused trigger toggles open; Space stays temporary-pan.
  await blurInputs(page);
  await fitTrigger(page).focus();
  await expect(fitTrigger(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Fit height', exact: true })).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await expectFitMenuClosed(page, 'Escape after Enter-open must close');

  await blurInputs(page);
  await fitTrigger(page).focus();
  await expect(fitTrigger(page)).toBeFocused();
  await page.keyboard.down('Space');
  await expectFitMenuClosed(page, 'Space must not open Fit options');
  const panWhileHeld = await viewerSpacePan(page);
  expect(['armed', 'dragging'], 'Space on Fit options stays temporary-pan').toContain(panWhileHeld);
  await page.keyboard.up('Space');
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible();
  await expectFitMenuClosed(page, 'Space release must not leave Fit options open');

  // Break: hubPreview has no Fit options / Draw.
  expect(hubFit, 'hubPreview has no Fit options').toBe(0);
  expect(hubDraw, 'hubPreview has no Draw').toBe(0);

  // Edge: search fixture keeps portrait viewBox + null file.id.
  await openPage(page, { url: SEARCH_PDF });
  await assertNoErrorBoundary(page);
  await openFitMenu(page);
  await page.keyboard.press('Escape');
  await expectFitMenuClosed(page, 'search-fixture Escape must close Fit options');
  expect(await pageViewBox(page), 'search fixture viewBox').toBe('0 0 612 792');
  expect(await fileId(page), 'search fixture file.id must stay null').toBeNull();
  const huntSearch = await huntHiddenChrome(page);
  expect(huntSearch['Actual size'], 'search fixture Actual size').toBe(0);
});

test('390 Zoom and fit options dismiss edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await assertNoErrorBoundary(page);
  await expect(page.getByRole('button', { name: 'Fit options', exact: true })).toHaveCount(0);
  const chevron = page.getByRole('button', { name: 'Zoom and fit options', exact: true });
  await expect(chevron).toBeVisible();
  await chevron.click();
  const menu = page.locator('.mobile-pdf-header__zoom-menu');
  await expect(menu).toHaveClass(/is-open/);
  await expect(page.getByRole('option', { name: /^Fit height$/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveClass(/is-open/);
  expect(await pageViewBox(page), '390 viewBox').toBe('0 0 612 792');
  expect(await fileId(page), '390 file.id must stay null').toBeNull();
  const hunt = await huntHiddenChrome(page);
  expect(hunt.Print, '390 Print').toBe(0);
  expect(hunt['Actual size'], '390 Actual size').toBe(0);
});
