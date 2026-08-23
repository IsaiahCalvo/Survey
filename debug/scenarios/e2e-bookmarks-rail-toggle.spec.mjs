import { test, expect } from '@playwright/test';

// Unique leftover after Search text rail toggle (`7fbd7bb7` / `31baa5a0`).
// Last hunt counted collapsed-rail Bookmarks empty chrome (No bookmarks yet
// + Add bookmark) and Pages tab-as-switcher. V-07 is jump/rename/group;
// dest-XYZ stays stubbed (page-number jump only). This leftover is the
// collapsed 48px left-rail Bookmarks tab (48 → 272 empty Bookmarks panel)
// + 390 Open pages, search, and bookmarks → Bookmarks. Distinct from
// leftover-18 / X-01 / remapped-after-CW / dismiss-family / Search rail
// toggle / Spaces rail toggle / Expand Survey / left-rail History
// Collapse sidebar / V-07 jump-rename-group / dest-XYZ / V-06 thumbnails
// / Home / Close tab / tool-key / toolbar arm. Do not stamp file.id.
// Do not invent dest-XYZ remapping. Do not create/rename/jump bookmarks.

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

function bookmarksTabBtn(page) {
  return page.getByRole('button', { name: 'Bookmarks', exact: true });
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
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'expanded Bookmarks panel is 272',
  }).toBe(272);
  const metrics = await leftRailMetrics(page);
  expect(metrics.host, 'left host flex stays 48 (panel overlays)').toBe(48);
  expect(metrics.panel, 'expanded Bookmarks panel is 272').toBe(272);
  expect(
    await page.getByPlaceholder('Search text in PDF...').isVisible().catch(() => false),
    'Bookmarks must not show Search field',
  ).toBe(false);
  expect(
    await page.getByRole('button', { name: 'New bookmark group', exact: true }).count(),
    'empty Bookmarks must not invent the create menu',
  ).toBe(0);
  expect(
    await page.getByPlaceholder('Bookmark name').count(),
    'empty Bookmarks must not invent dest/name fields',
  ).toBe(0);
  expect(
    await page.getByRole('button', { name: 'Y', exact: true }).count(),
    'Bookmarks must not invent survey Y/N',
  ).toBe(0);
}

test('desktop Bookmarks rail toggle intended + break + edge', async ({ page }) => {
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

  // Intended — collapsed 48px left rail shows Bookmarks, not empty chrome.
  await expect(bookmarksTabBtn(page), 'collapsed rail Bookmarks must be live').toBeVisible();
  expect(await emptyBookmarksCopy(page).count(), 'collapsed rail empty Bookmarks 0').toBe(0);
  expect(await addBookmarkBtn(page).count(), 'collapsed rail Add bookmark 0').toBe(0);
  const start = await leftRailMetrics(page);
  expect(start.host, 'chrome-left-host stays 48').toBe(48);
  expect(start.panel, 'collapsed left rail is 48').toBe(48);
  await expect(expandSidebarBtn(page), 'collapsed rail Expand sidebar lives (History-dedicated, not this leftover)').toBeVisible();
  expect(await collapseSidebarBtn(page).count(), 'collapsed rail Collapse sidebar 0').toBe(0);

  // Contrast — Expand sidebar opens Pages, not Bookmarks.
  await expandSidebarBtn(page).click();
  await expect(collapseSidebarBtn(page)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'Expand sidebar grows panel to 272',
  }).toBe(272);
  await expect(
    page.getByAltText('Page 1').or(page.getByText('Loading...')).or(page.getByText('Loading pages…')),
    'Expand sidebar opens Pages',
  ).toBeVisible({ timeout: 8_000 });
  await expect(emptyBookmarksCopy(page), 'Expand sidebar must not open Bookmarks').toBeHidden();
  expect(await addBookmarkBtn(page).count(), 'Expand sidebar must not show Add bookmark').toBe(0);
  await collapseSidebarBtn(page).click();
  await expect(expandSidebarBtn(page)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'Collapse sidebar restores panel 48',
  }).toBe(48);

  // Overlay lists B for sidebar, not a Bookmarks-tab chord.
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists B Toggle sidebar').toMatch(/Toggle sidebar/);
  expect(overlayText, 'overlay does not list a Bookmarks-tab chord').not.toMatch(/Open bookmarks|Expand Bookmarks|Bookmarks panel|Bookmarks tab/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  // Intended — Bookmarks click grows the left rail to 272 and shows empty chrome.
  await bookmarksTabBtn(page).click();
  await waitForBookmarksPanel(page);
  expect(await expandSidebarBtn(page).count(), 'Expand sidebar gone after Bookmarks').toBe(0);

  // Intended — footer stays live after Bookmarks expand.
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeVisible();

  // Intended — Collapse sidebar restores the 48px Bookmarks icon.
  await collapseSidebarBtn(page).click();
  await expect(bookmarksTabBtn(page), 'Collapse sidebar must restore Bookmarks icon').toBeVisible({ timeout: 8_000 });
  expect(await emptyBookmarksCopy(page).count(), 'Bookmarks panel hidden after collapse').toBe(0);
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'collapsed left rail is 48 again',
  }).toBe(48);

  // Break — Escape does not collapse after Bookmarks (desktop has no Esc dismiss).
  await bookmarksTabBtn(page).click();
  await waitForBookmarksPanel(page);
  await page.keyboard.press('Escape');
  await expect(emptyBookmarksCopy(page), 'Escape must not collapse Bookmarks').toBeVisible();
  await expect(collapseSidebarBtn(page)).toBeVisible();

  // Break — Space stays temporary-pan, does not collapse.
  await page.keyboard.down(' ');
  await expect(emptyBookmarksCopy(page), 'Space must not collapse Bookmarks').toBeVisible();
  await page.keyboard.up(' ');
  await expect(emptyBookmarksCopy(page)).toBeVisible();

  // Break — already-open Bookmarks tab click stays on Bookmarks (not a toggle-close).
  await bookmarksTabBtn(page).click();
  await expect(emptyBookmarksCopy(page), 're-click Bookmarks must stay open').toBeVisible();
  expect((await leftRailMetrics(page)).panel, 're-click Bookmarks keeps panel 272').toBe(272);
  expect((await leftRailMetrics(page)).host, 're-click Bookmarks keeps host 48').toBe(48);
  expect(await addBookmarkBtn(page).count(), 're-click Bookmarks keeps Add bookmark').toBeGreaterThan(0);

  await collapseSidebarBtn(page).click();
  await expect(bookmarksTabBtn(page)).toBeVisible();

  // Break — double-click Bookmarks stays expanded and invents 0 bookmarks.
  const bookmarksBox = await bookmarksTabBtn(page).boundingBox();
  expect(bookmarksBox, 'Bookmarks geometry').toBeTruthy();
  await page.mouse.dblclick(bookmarksBox.x + bookmarksBox.width / 2, bookmarksBox.y + bookmarksBox.height / 2);
  await expect(emptyBookmarksCopy(page), 'double-click Bookmarks must stay expanded').toBeVisible({ timeout: 8_000 });
  expect(
    await page.getByRole('button', { name: 'New bookmark group', exact: true }).count(),
    'double-click Bookmarks invents 0 create menu',
  ).toBe(0);
  expect(await expandSidebarBtn(page).count(), 'double-click Bookmarks must not rebound to collapsed').toBe(0);

  await collapseSidebarBtn(page).click();
  await expect(bookmarksTabBtn(page)).toBeVisible();

  // Break — hubPreview has no viewer Bookmarks panel.
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview has no Draw').toBe(0);
  expect(await emptyBookmarksCopy(page).count(), 'hubPreview viewer Bookmarks panel 0').toBe(0);
  expect(await addBookmarkBtn(page).count(), 'hubPreview Add bookmark 0').toBe(0);

  // Edge — page-1 rect survives Bookmarks; click invents 0.
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
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive Bookmarks').toEqual(page1Before);

  // Edge — Pen-armed Bookmarks invents 0 and does not start a stroke.
  await collapseSidebarBtn(page).click();
  await expect(bookmarksTabBtn(page)).toBeVisible();
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  await bookmarksTabBtn(page).click();
  await expect(emptyBookmarksCopy(page), 'Pen-armed Bookmarks must still expand').toBeVisible();
  expect(await userAnnotationIds(page, 1), 'Pen-armed Bookmarks invents 0').toEqual(marksBeforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge — 120-page: Bookmarks does not change the page number (no dest-XYZ jump).
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  expect(await currentPageNumber(page)).toBe(1);
  await bookmarksTabBtn(page).click();
  await waitForBookmarksPanel(page);
  expect(await currentPageNumber(page), 'Bookmarks must not change page').toBe(1);
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('BOOKMARKS_RAIL_TOGGLE_DESKTOP_PROOF', JSON.stringify({
    hunt,
    start,
    overlayListsBookmarksTabChord: /Open bookmarks|Expand Bookmarks|Bookmarks panel|Bookmarks tab/.test(overlayText),
    rectId,
    viewBox,
    fileId,
  }));
});

test('390 Open pages/search/bookmarks Bookmarks tab edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  // 390 uses the dock hub, not the 48px desktop Bookmarks icon.
  expect(await emptyBookmarksCopy(page).count(), '390 Bookmarks panel 0 until hub Bookmarks').toBe(0);
  await expect(page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bookmarks', exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(emptyBookmarksCopy(page), '390 hub defaults to Pages not Bookmarks').toBeHidden();
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(emptyBookmarksCopy(page)).toBeVisible({ timeout: 8_000 });
  await expect(addBookmarkBtn(page)).toBeVisible();
  expect(
    await page.getByRole('button', { name: 'New bookmark group', exact: true }).count(),
    '390 Bookmarks must not invent desktop group chrome',
  ).toBe(0);
  expect(
    await page.getByRole('button', { name: 'Y', exact: true }).count(),
    '390 Bookmarks must not invent Y/N',
  ).toBe(0);

  const closer = page.getByRole('button', { name: 'Close document panel', exact: true });
  await closer.first().click();
  await expect(emptyBookmarksCopy(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true })).toBeVisible();

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('BOOKMARKS_RAIL_TOGGLE_390_PROOF', JSON.stringify({
    viewBox,
    fileId,
  }));
});
