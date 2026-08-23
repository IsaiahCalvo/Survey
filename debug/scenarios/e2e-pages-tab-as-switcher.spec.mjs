import { test, expect } from '@playwright/test';

// Unique leftover after Bookmarks rail toggle (`daa3f031` / `b2a8ad42`).
// Last hunt counted Bookmarks → Pages (`alt=Page 1`, page stays 1, no
// thumbnail jump) and only used Expand sidebar→Pages as contrast.
// V-06 is thumbnail left-click jump. This leftover is the expanded
// left-rail **Pages tab-as-switcher** (Bookmarks / Search / Spaces →
// Pages without navigating) + 390 hub Bookmarks → Pages. Distinct from
// leftover-18 / X-01 / remapped-after-CW / dismiss-family / Bookmarks
// rail toggle / Search rail toggle / Spaces rail toggle / Expand Survey
// / left-rail History Expand/Collapse sidebar / Expand sidebar→Pages /
// V-06 thumbnails / V-07 jump-rename-group / dest-XYZ / Home / Close tab
// / tool-key / toolbar arm. Do not stamp file.id. Do not click
// thumbnails. Do not invent dest-XYZ remapping.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1400, height = 900, url = LINK_PDF } = {}) {
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
          || key.startsWith('spaces_')
          || key.startsWith('bookmarks_')
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

async function currentPageNumber(page) {
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  if (await input.count()) return Number.parseInt(await input.inputValue(), 10);
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) return Number.parseInt((await btn.innerText()).trim(), 10);
  const jump = page.getByRole('button', { name: 'Jump to page', exact: true });
  if (await jump.count()) {
    const raw = (await jump.innerText()).trim();
    return Number.parseInt(raw, 10);
  }
  const mobileInput = page.getByRole('textbox', { name: 'Page number', exact: true });
  if (await mobileInput.count()) return Number.parseInt(await mobileInput.inputValue(), 10);
  return null;
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/i.test(String(id || ''));
    });
  }, pageNumber);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function leftRailMetrics(page) {
  return page.evaluate(() => {
    const host = document.getElementById('chrome-left-host');
    if (!host) return { host: 0, panel: 0 };
    const panel = [...host.querySelectorAll('div')].find((el) => {
      const width = el.style && el.style.width;
      return width === '48px' || width === '272px';
    });
    return {
      host: host.offsetWidth,
      panel: panel ? panel.offsetWidth : 0,
    };
  });
}

function pagesTabBtn(page) {
  return page.getByRole('button', { name: 'Pages', exact: true });
}

function bookmarksTabBtn(page) {
  return page.getByRole('button', { name: 'Bookmarks', exact: true });
}

function searchTabBtn(page) {
  return page.getByRole('button', { name: 'Search text', exact: true });
}

function spacesTabBtn(page) {
  return page.getByRole('button', { name: 'Spaces', exact: true });
}

function collapseSidebarBtn(page) {
  return page.getByRole('button', { name: 'Collapse sidebar', exact: true });
}

function expandSidebarBtn(page) {
  return page.getByRole('button', { name: 'Expand sidebar', exact: true });
}

function emptyBookmarksCopy(page) {
  return page.getByText(/No bookmarks yet/i);
}

function addBookmarkBtn(page) {
  return page.getByRole('button', { name: 'Add bookmark', exact: true });
}

function pageThumb(page, n = 1) {
  return page.getByAltText(`Page ${n}`).first();
}

async function hiddenCounts(page) {
  const names = [
    'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
    'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
    'Marquee zoom', 'Layers', 'Attachments',
  ];
  const counts = {};
  for (const name of names) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if ((await sub.first().getAttribute('aria-pressed')) !== 'true') await sub.first().click();
    return;
  }
  const visible = page.getByRole('button', { name: toolName, exact: true });
  if (await visible.count() && await visible.first().isVisible().catch(() => false)) {
    if ((await visible.first().getAttribute('aria-pressed')) !== 'true') await visible.first().click();
    return;
  }
  await page.getByRole('button', { name: categoryName, exact: true }).first().click();
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

async function waitForBookmarksPanel(page) {
  await expect(emptyBookmarksCopy(page)).toBeVisible({ timeout: 8_000 });
  await expect(addBookmarkBtn(page)).toBeVisible();
}

async function waitForPagesPanel(page, { pageNumber = 1 } = {}) {
  await expect.poll(async () => {
    const thumb = await pageThumb(page, pageNumber).isVisible().catch(() => false);
    const loading = await page.getByText('Loading pages…').first().isVisible().catch(() => false);
    return thumb || loading;
  }, {
    timeout: 8_000,
    message: 'Pages switcher must show thumbnails',
  }).toBe(true);
  await expect(emptyBookmarksCopy(page), 'Pages switcher must hide Bookmarks empty chrome').toBeHidden();
  expect(await addBookmarkBtn(page).count(), 'Pages switcher must hide Add bookmark').toBe(0);
  expect(
    await page.getByPlaceholder('Search text in PDF...').isVisible().catch(() => false),
    'Pages switcher must not show Search field',
  ).toBe(false);
  expect(
    await page.getByText(/No spaces yet/i).isVisible().catch(() => false),
    'Pages switcher must not show Spaces empty chrome',
  ).toBe(false);
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'expanded Pages panel is 272',
  }).toBe(272);
  const metrics = await leftRailMetrics(page);
  expect(metrics.host, 'left host flex stays 48 (panel overlays)').toBe(48);
  expect(metrics.panel, 'expanded Pages panel is 272').toBe(272);
}

test('desktop Pages tab-as-switcher intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const hunt = await hiddenCounts(page);
  const fileIdHunt = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileIdHunt, 'file.id must stay null on ?testPdf=').toBeNull();
  expect(hunt['Match case'], 'Search Match case compile-hidden').toBe(0);
  expect(hunt.Forms, 'Forms toolbar compile-hidden').toBe(0);
  expect(hunt.Note, 'Note create compile-hidden').toBe(0);
  expect(hunt.Print, 'Print compile-hidden').toBe(0);
  expect(hunt.Measure, 'Measure compile-hidden').toBe(0);
  expect(hunt.Group, 'Group compile-hidden').toBe(0);

  // Contrast — Expand sidebar opens Pages on the collapsed default. That
  // path is History-dedicated contrast, not this leftover.
  await expect(pagesTabBtn(page), 'collapsed rail Pages must be live').toBeVisible();
  await expect(expandSidebarBtn(page)).toBeVisible();
  expect(await collapseSidebarBtn(page).count(), 'collapsed rail Collapse sidebar 0').toBe(0);
  const start = await leftRailMetrics(page);
  expect(start.host, 'chrome-left-host stays 48').toBe(48);
  expect(start.panel, 'collapsed left rail is 48').toBe(48);
  await expandSidebarBtn(page).click();
  await expect(collapseSidebarBtn(page)).toBeVisible({ timeout: 8_000 });
  await expect(pageThumb(page, 1), 'Expand sidebar opens Pages').toBeVisible({ timeout: 8_000 });
  await collapseSidebarBtn(page).click();
  await expect(expandSidebarBtn(page)).toBeVisible({ timeout: 8_000 });

  // Overlay lists B for sidebar, not a Pages-tab chord.
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists B Toggle sidebar').toMatch(/Toggle sidebar/);
  expect(overlayText, 'overlay does not list a Pages-tab chord').not.toMatch(/Open pages|Expand Pages|Pages panel|Pages tab|Switch to Pages/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  // Intended — Bookmarks → Pages shows thumbnails and does not jump.
  expect(await currentPageNumber(page)).toBe(1);
  await bookmarksTabBtn(page).click();
  await waitForBookmarksPanel(page);
  const pageBeforeBookmarks = await currentPageNumber(page);
  await pagesTabBtn(page).click();
  await waitForPagesPanel(page);
  expect(await currentPageNumber(page), 'Bookmarks → Pages must not jump').toBe(pageBeforeBookmarks);
  expect(await currentPageNumber(page), 'Bookmarks → Pages stays page 1').toBe(1);

  // Intended — Search text → Pages and Spaces → Pages are the same switcher.
  await searchTabBtn(page).click();
  await expect(page.getByPlaceholder('Search text in PDF...')).toBeVisible({ timeout: 8_000 });
  await expect(pageThumb(page, 1), 'Search must hide Pages thumbnails').toBeHidden();
  const pageBeforeSearch = await currentPageNumber(page);
  await pagesTabBtn(page).click();
  await waitForPagesPanel(page);
  expect(await currentPageNumber(page), 'Search → Pages must not jump').toBe(pageBeforeSearch);

  await spacesTabBtn(page).click();
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  const pageBeforeSpaces = await currentPageNumber(page);
  await pagesTabBtn(page).click();
  await waitForPagesPanel(page);
  expect(await currentPageNumber(page), 'Spaces → Pages must not jump').toBe(pageBeforeSpaces);

  // Intended — footer stays live after Pages switcher.
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeVisible();

  // Break — Escape does not collapse after Pages (desktop has no Esc dismiss).
  await page.keyboard.press('Escape');
  await expect(pageThumb(page, 1), 'Escape must not collapse Pages').toBeVisible();
  await expect(collapseSidebarBtn(page)).toBeVisible();

  // Break — Space stays temporary-pan, does not collapse.
  await page.keyboard.down(' ');
  await expect(pageThumb(page, 1), 'Space must not collapse Pages').toBeVisible();
  await page.keyboard.up(' ');
  await expect(pageThumb(page, 1)).toBeVisible();

  // Break — already-open Pages tab click stays on Pages (not a toggle-close,
  // and not a thumbnail jump).
  expect(await currentPageNumber(page)).toBe(1);
  await pagesTabBtn(page).click();
  await expect(pageThumb(page, 1), 're-click Pages must stay open').toBeVisible();
  expect((await leftRailMetrics(page)).panel, 're-click Pages keeps panel 272').toBe(272);
  expect(await currentPageNumber(page), 're-click Pages must not jump').toBe(1);

  // Break — double-click Pages stays expanded and invents 0 jump.
  const pagesBox = await pagesTabBtn(page).boundingBox();
  expect(pagesBox, 'Pages geometry').toBeTruthy();
  await page.mouse.dblclick(pagesBox.x + pagesBox.width / 2, pagesBox.y + pagesBox.height / 2);
  await expect(pageThumb(page, 1), 'double-click Pages must stay expanded').toBeVisible({ timeout: 8_000 });
  expect(await currentPageNumber(page), 'double-click Pages invents 0 jump').toBe(1);
  expect(await expandSidebarBtn(page).count(), 'double-click Pages must not rebound to collapsed').toBe(0);

  await collapseSidebarBtn(page).click();
  await expect(pagesTabBtn(page)).toBeVisible();

  // Break — hubPreview has no viewer Pages panel.
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview has no Draw').toBe(0);
  expect(await page.getByAltText('Page 1').count(), 'hubPreview viewer Pages thumbnails 0').toBe(0);
  expect(await emptyBookmarksCopy(page).count(), 'hubPreview viewer Bookmarks panel 0').toBe(0);

  // Edge — page-1 rect survives Pages switcher; click invents 0.
  await openEditor(page);
  await blurInputs(page);
  await activateTool(page, 'Shapes', 'Rectangle');
  const box = await pageBox(page, 1);
  const beforeRect = new Set(await userAnnotationIds(page, 1));
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.28);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.46, { steps: 8 });
  await page.mouse.up();
  let rectId = null;
  await expect.poll(async () => {
    const ids = await userAnnotationIds(page, 1);
    rectId = ids.find((id) => !beforeRect.has(id)) || null;
    return rectId;
  }, { message: 'expected a new rect on page 1' }).not.toBeNull();
  await blurInputs(page);
  const page1Before = await userAnnotationIds(page, 1);
  await bookmarksTabBtn(page).click();
  await waitForBookmarksPanel(page);
  await pagesTabBtn(page).click();
  await waitForPagesPanel(page);
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive Pages switcher').toEqual(page1Before);
  expect(await currentPageNumber(page), 'rect + Pages switcher must stay page 1').toBe(1);

  // Edge — Pen-armed Pages switcher invents 0 and does not start a stroke.
  await bookmarksTabBtn(page).click();
  await waitForBookmarksPanel(page);
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  await pagesTabBtn(page).click();
  await waitForPagesPanel(page);
  expect(await userAnnotationIds(page, 1), 'Pen-armed Pages switcher invents 0').toEqual(marksBeforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge — 120-page: Next to 2, then Bookmarks → Pages stays 2 (no reset
  // to 1, no dest-XYZ, no thumbnail jump). Rail Next is setup only.
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  expect(await currentPageNumber(page)).toBe(1);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(async () => currentPageNumber(page), {
    timeout: 8_000,
    message: 'setup Next page reaches 2',
  }).toBe(2);
  await bookmarksTabBtn(page).click();
  await waitForBookmarksPanel(page);
  expect(await currentPageNumber(page), 'Bookmarks must not reset page 2').toBe(2);
  await pagesTabBtn(page).click();
  await waitForPagesPanel(page, { pageNumber: 2 });
  expect(await currentPageNumber(page), 'Bookmarks → Pages must stay on page 2').toBe(2);
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGES_TAB_AS_SWITCHER_DESKTOP_PROOF', JSON.stringify({
    hunt,
    start,
    overlayListsPagesTabChord: /Open pages|Expand Pages|Pages panel|Pages tab|Switch to Pages/.test(overlayText),
    rectId,
    viewBox,
    fileId,
  }));
});

test('390 Open pages/search/bookmarks Pages tab-as-switcher edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  // 390 uses the dock hub, not the 48px desktop Pages icon.
  await expect(page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pages', exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(pageThumb(page, 1), '390 hub defaults to Pages').toBeVisible({ timeout: 8_000 });
  await expect(emptyBookmarksCopy(page), '390 hub defaults hide Bookmarks empty chrome').toBeHidden();
  expect(await currentPageNumber(page)).toBe(1);

  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(emptyBookmarksCopy(page)).toBeVisible({ timeout: 8_000 });
  await expect(addBookmarkBtn(page)).toBeVisible();
  expect(await currentPageNumber(page), '390 Bookmarks must not change page').toBe(1);

  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(pageThumb(page, 1), '390 Bookmarks → Pages must show thumbnails').toBeVisible({ timeout: 8_000 });
  await expect(emptyBookmarksCopy(page), '390 Bookmarks → Pages must hide empty chrome').toBeHidden();
  expect(await addBookmarkBtn(page).count(), '390 Pages switcher hides Add bookmark').toBe(0);
  expect(await currentPageNumber(page), '390 Bookmarks → Pages must not jump').toBe(1);

  const closer = page.getByRole('button', { name: 'Close document panel', exact: true });
  await closer.first().click();
  await expect(page.getByAltText('Page 1')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true })).toBeVisible();

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGES_TAB_AS_SWITCHER_390_PROOF', JSON.stringify({
    viewBox,
    fileId,
  }));
});
