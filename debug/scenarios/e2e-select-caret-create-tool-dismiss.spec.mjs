import { test, expect } from '@playwright/test';

// Unique leftover after Survey/Spaces dismiss (`52dde4d0` / `d9f67e34`).
// Select caret arm-then-toggle already proved page-click dismiss while Select
// is armed (Select does not preventDefault). Keyboard P/L while the menu is
// open leaves a creation tool armed; SVG preventDefault then swallows the
// compatibility mousedown this menu used to wait on — page click left
// Selection Mode open and started a stroke.
// Do not replay Survey/Spaces/Pages/Style/Width/Fit dismiss, Home, Close tab,
// remapped-after-CW, leftover-18. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function userCreatedIds(page) {
  return page.locator('[data-svg-annotation-layer="1"] [data-anno-id]').evaluateAll((nodes, reSource) => {
    const re = new RegExp(reSource);
    return nodes
      .map((node) => node.getAttribute('data-anno-id'))
      .filter((id) => id && re.test(id));
  }, UUID_RE.source);
}

function selectMenu(page) {
  return page.locator('[data-select-mode-menu="true"]');
}

async function openSelectMenu(page) {
  await page.locator('[data-select-mode-caret="true"]').click();
  await expect(selectMenu(page)).toHaveCount(1);
}

async function clickPage(page, fracX = 0.82, fracY = 0.25) {
  const layer = page.locator('[data-svg-annotation-layer="1"]').first();
  const box = await layer.boundingBox();
  expect(box, 'page layer has a box').toBeTruthy();
  await page.mouse.click(box.x + box.width * fracX, box.y + box.height * fracY);
}

async function viewerSpacePan(page) {
  return page.locator('.survey-pdfjs-viewer').first().evaluate((el) => el.dataset.spacePan || 'off');
}

test('desktop Select caret create-tool dismiss intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  const hubCaret = await page.locator('[data-select-mode-caret="true"]').count();
  const hubDraw = await page.getByRole('button', { name: 'Draw', exact: true }).count();

  await openPage(page, { url: LINK_PDF });
  await assertNoErrorBoundary(page);
  expect(await pageViewBox(page), 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();

  const hunt = await huntHiddenChrome(page);
  for (const [name, count] of Object.entries(hunt)) {
    expect(count, `${name} compile-hidden`).toBe(0);
  }

  const marksBefore = await userCreatedIds(page);

  // Intended: caret opens Selection Mode; Escape closes.
  await openSelectMenu(page);
  await expect(page.getByRole('button', { name: /Select annotations/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Select text/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(selectMenu(page), 'Escape must close Selection Mode').toHaveCount(0);

  // Intended: keyboard P leaves the menu open; page click closes; no stroke.
  await openSelectMenu(page);
  await blurInputs(page);
  await page.keyboard.press('p');
  await expect(selectMenu(page), 'P must leave Selection Mode open').toHaveCount(1);
  await clickPage(page);
  await expect(selectMenu(page), 'click-outside must close Selection Mode after P').toHaveCount(0);
  expect(await userCreatedIds(page), 'Pen-armed dismiss must not start a stroke').toEqual(marksBefore);
  await page.keyboard.press('Escape');
  await expect(selectMenu(page), 'Escape with menu closed invents 0').toHaveCount(0);

  // Intended: keyboard L same contract.
  await openSelectMenu(page);
  await blurInputs(page);
  await page.keyboard.press('l');
  await expect(selectMenu(page), 'L must leave Selection Mode open').toHaveCount(1);
  await clickPage(page, 0.75, 0.3);
  await expect(selectMenu(page), 'click-outside must close Selection Mode after L').toHaveCount(0);
  expect(await userCreatedIds(page), 'Line-armed dismiss must not start a rubber-band').toEqual(marksBefore);

  // Break: Space stays temporary-pan and does not open Selection Mode.
  await blurInputs(page);
  await page.locator('button.btn[aria-label="Select"]').first().focus();
  await page.keyboard.down('Space');
  await expect(selectMenu(page), 'Space must not open Selection Mode').toHaveCount(0);
  const panWhileHeld = await viewerSpacePan(page);
  expect(['armed', 'dragging'], 'Space stays temporary-pan').toContain(panWhileHeld);
  await page.keyboard.up('Space');
  await expect(selectMenu(page), 'Space release must not leave Selection Mode open').toHaveCount(0);

  // Break: hubPreview has no Select caret / Draw.
  expect(hubCaret, 'hubPreview has no Select caret').toBe(0);
  expect(hubDraw, 'hubPreview has no Draw').toBe(0);

  // Edge: search fixture keeps portrait viewBox + null file.id.
  await openPage(page, { url: SEARCH_PDF });
  await assertNoErrorBoundary(page);
  await openSelectMenu(page);
  await blurInputs(page);
  await page.keyboard.press('p');
  await expect(selectMenu(page)).toHaveCount(1);
  await clickPage(page);
  await expect(selectMenu(page), 'search-fixture page click must close Selection Mode').toHaveCount(0);
  expect(await pageViewBox(page), 'search fixture viewBox').toBe('0 0 612 792');
  expect(await fileId(page), 'search fixture file.id must stay null').toBeNull();
  const huntSearch = await huntHiddenChrome(page);
  expect(huntSearch.Print, 'search fixture Print').toBe(0);
});

test('390 Select caret create-tool dismiss edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await assertNoErrorBoundary(page);
  await expect(page.getByRole('button', { name: 'Fit options', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Zoom and fit options', exact: true })).toBeVisible();

  expect(await page.locator('[data-select-mode-caret="true"]').count(), '390 desktop Select caret').toBe(0);
  expect(await selectMenu(page).count(), '390 Selection Mode portal').toBe(0);

  expect(await pageViewBox(page), '390 viewBox').toBe('0 0 612 792');
  expect(await fileId(page), '390 file.id must stay null').toBeNull();
  const hunt = await huntHiddenChrome(page);
  expect(hunt.Print, '390 Print').toBe(0);
});
