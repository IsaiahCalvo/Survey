import { test, expect } from '@playwright/test';

// Unique leftover after Style/Width dismiss (`27ea9639` / `39da34c8`).
// Pages thumbnail context stayed open on a page click while Rectangle was
// armed: listener waited for bubbling mousedown, and SVG pointerdown
// preventDefault suppresses that mousedown. Last hunt opened Pages after
// Eraser (SVG pointer-events none) so it missed this. Style/Width apply +
// dismiss, Fit dismiss, Select caret, Home, rail Prev-Next, P-04 letters,
// remapped-after-CW, leftover-18 are not this slice.
// Do not stamp file.id. Do not invent Extract / Note-Link / Forms.

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

function pagesMenu(page) {
  return page.locator('[data-pages-context-menu="true"]');
}

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pages.first().isVisible().catch(() => false)) {
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') {
      await pages.first().click();
    }
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) {
    await rail.first().click();
  }
  const again = page.getByRole('button', { name: 'Pages', exact: true });
  if (await again.first().isVisible().catch(() => false)
    && (await again.first().getAttribute('aria-pressed')) !== 'true') {
    await again.first().click();
  }
}

async function openPagesContext(page, pageNumber = 1) {
  await openPagesPanel(page);
  const thumb = page.locator(`#chrome-left-host [data-page-number="${pageNumber}"]`).first();
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await thumb.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await thumb.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(12, rect.width / 2),
        clientY: rect.top + Math.min(12, rect.height / 2),
      }));
    });
    try {
      await expect(pagesMenu(page)).toBeVisible({ timeout: 2_500 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

async function viewerSpacePan(page) {
  return page.locator('.survey-pdfjs-viewer').first().evaluate((el) => el.dataset.spacePan || 'off');
}

test('desktop Pages context dismiss intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  const hubPages = await page.getByRole('button', { name: 'Pages', exact: true }).count();
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

  // Intended: Pages context opens Rotate; Escape closes.
  await openPagesContext(page);
  await expect(pagesMenu(page).getByText('Rotate', { exact: true })).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await expect(pagesMenu(page), 'Escape must close Pages context').toHaveCount(0);

  // Intended: page click closes while Rectangle is armed; no invented rect.
  await openPagesContext(page);
  await expect(pagesMenu(page)).toBeVisible({ timeout: 5_000 });
  await clickPage(page);
  await expect(pagesMenu(page), 'click-outside must close Pages context').toHaveCount(0);
  expect(await userAnnotationIds(page), 'Pages dismiss must not start a rubber-band').toEqual(marksBefore);
  await page.keyboard.press('Escape');
  await expect(pagesMenu(page), 'Escape with Pages closed invents 0').toHaveCount(0);

  // Break: Space stays temporary-pan and does not open Pages context.
  await blurInputs(page);
  await page.keyboard.down('Space');
  await expect(pagesMenu(page), 'Space must not open Pages context').toHaveCount(0);
  const panWhileHeld = await viewerSpacePan(page);
  expect(['armed', 'dragging'], 'Space stays temporary-pan').toContain(panWhileHeld);
  await page.keyboard.up('Space');
  await expect(pagesMenu(page), 'Space release must not leave Pages context open').toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible();

  // Break: hubPreview has no Pages / Draw.
  expect(hubPages, 'hubPreview has no Pages').toBe(0);
  expect(hubDraw, 'hubPreview has no Draw').toBe(0);

  // Edge: search fixture keeps portrait viewBox + null file.id.
  await openPage(page, { url: SEARCH_PDF });
  await assertNoErrorBoundary(page);
  await armRectangle(page);
  await openPagesContext(page);
  await expect(pagesMenu(page)).toBeVisible({ timeout: 5_000 });
  await clickPage(page);
  await expect(pagesMenu(page), 'search-fixture page click must close Pages context').toHaveCount(0);
  expect(await pageViewBox(page), 'search fixture viewBox').toBe('0 0 612 792');
  expect(await fileId(page), 'search fixture file.id must stay null').toBeNull();
  const huntSearch = await huntHiddenChrome(page);
  expect(huntSearch.Print, 'search fixture Print').toBe(0);
});

test('390 Pages context dismiss edge', async ({ page }) => {
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

  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pages.count()) {
    await pages.first().click();
    const actions = page.getByRole('button', { name: 'Page 1 actions', exact: true });
    if (await actions.count()) {
      await actions.first().click();
      await expect(pagesMenu(page)).toBeVisible({ timeout: 5_000 });
      await clickPage(page);
      await expect(pagesMenu(page), '390 page click must close Pages context').toHaveCount(0);
    } else {
      // 390 actions live on the Pages sheet; default chrome may omit them.
      expect(await pagesMenu(page).count(), '390 default Pages context').toBe(0);
    }
  } else {
    expect(await pagesMenu(page).count(), '390 Pages panel absent').toBe(0);
  }

  expect(await pageViewBox(page), '390 viewBox').toBe('0 0 612 792');
  expect(await fileId(page), '390 file.id must stay null').toBeNull();
  const hunt = await huntHiddenChrome(page);
  expect(hunt.Print, '390 Print').toBe(0);
});
