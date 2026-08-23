import { test, expect } from '@playwright/test';

// Unique leftover after Spaces rail toggle (`05841b84` / `cc8d23de`).
// Last hunt counted collapsed-rail Pages / Search text / Bookmarks and
// only used Search as Match-case contrast. V-08 is Next/Previous/result-row;
// Match case / Whole word stay 0. This leftover is the collapsed 48px
// left-rail Search text tab (48 → 272 Search panel + focus) + 390
// Open pages, search, and bookmarks → Search. Distinct from leftover-18 /
// X-01 / remapped-after-CW / dismiss-family / Spaces rail toggle / Expand
// Survey / left-rail History Collapse sidebar / V-06 thumbnails /
// bookmark page-number jump / Home / Close tab / tool-key / toolbar arm.
// Do not stamp file.id. Do not run a find (V-08).

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

function searchTabBtn(page) {
  return page.getByRole('button', { name: 'Search text', exact: true });
}

function collapseSidebarBtn(page) {
  return page.getByRole('button', { name: 'Collapse sidebar', exact: true });
}

function expandSidebarBtn(page) {
  return page.getByRole('button', { name: 'Expand sidebar', exact: true });
}

function desktopSearchField(page) {
  return page.getByPlaceholder('Search text in PDF...');
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

async function isSearchFieldFocused(page) {
  return desktopSearchField(page).evaluate((el) => document.activeElement === el);
}

async function waitForSearchPanel(page) {
  await expect(desktopSearchField(page)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'expanded Search panel is 272',
  }).toBe(272);
  const metrics = await leftRailMetrics(page);
  expect(metrics.host, 'left host flex stays 48 (panel overlays)').toBe(48);
  expect(metrics.panel, 'expanded Search panel is 272').toBe(272);
  await expect.poll(async () => isSearchFieldFocused(page), {
    timeout: 3_000,
    message: 'Search text tab must focus the field',
  }).toBe(true);
  expect(
    await page.getByRole('button', { name: 'Match case', exact: true }).count(),
    'Search Match case stays compile-hidden',
  ).toBe(0);
  expect(
    await page.getByRole('button', { name: 'Whole word', exact: true }).count(),
    'Search Whole word stays compile-hidden',
  ).toBe(0);
  expect(
    await page.getByRole('button', { name: 'Next match (Enter)', exact: true }).count(),
    'empty Search must not invent V-08 Next',
  ).toBe(0);
  expect(
    await page.getByRole('button', { name: 'Previous match (Shift+Enter)', exact: true }).count(),
    'empty Search must not invent V-08 Previous',
  ).toBe(0);
}

test('desktop Search text rail toggle intended + break + edge', async ({ page }) => {
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

  // Intended — collapsed 48px left rail shows Search text, not the field.
  await expect(searchTabBtn(page), 'collapsed rail Search text must be live').toBeVisible();
  expect(await desktopSearchField(page).count(), 'collapsed rail Search field 0').toBe(0);
  const start = await leftRailMetrics(page);
  expect(start.host, 'chrome-left-host stays 48').toBe(48);
  expect(start.panel, 'collapsed left rail is 48').toBe(48);
  await expect(expandSidebarBtn(page), 'collapsed rail Expand sidebar lives (History-dedicated, not this leftover)').toBeVisible();
  expect(await collapseSidebarBtn(page).count(), 'collapsed rail Collapse sidebar 0').toBe(0);

  // Contrast — Expand sidebar opens Pages, not Search.
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
  await expect(desktopSearchField(page), 'Expand sidebar must not show Search field').toBeHidden();
  await collapseSidebarBtn(page).click();
  await expect(expandSidebarBtn(page)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'Collapse sidebar restores panel 48',
  }).toBe(48);

  // Overlay lists Ctrl+F, not a Search-tab chord.
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists Ctrl+F Search text').toMatch(/Search text/);
  expect(overlayText, 'overlay does not list a Search-tab chord').not.toMatch(/Open search|Expand Search|Search panel|Search text tab/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  // Intended — Search text click grows the left rail to 272 and focuses the field.
  await searchTabBtn(page).click();
  await waitForSearchPanel(page);
  expect(await expandSidebarBtn(page).count(), 'Expand sidebar gone after Search').toBe(0);
  expect(
    await page.getByRole('button', { name: 'Y', exact: true }).count(),
    'Search must not invent survey Y/N',
  ).toBe(0);

  // Intended — footer stays live after Search expand.
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeVisible();

  // Intended — Collapse sidebar restores the 48px Search text icon.
  await collapseSidebarBtn(page).click();
  await expect(searchTabBtn(page), 'Collapse sidebar must restore Search text icon').toBeVisible({ timeout: 8_000 });
  expect(await desktopSearchField(page).count(), 'Search field hidden after collapse').toBe(0);
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'collapsed left rail is 48 again',
  }).toBe(48);

  // Break — Escape does not collapse after Search (desktop has no Esc dismiss).
  await searchTabBtn(page).click();
  await waitForSearchPanel(page);
  await page.keyboard.press('Escape');
  await expect(desktopSearchField(page), 'Escape must not collapse Search').toBeVisible();
  await expect(collapseSidebarBtn(page)).toBeVisible();

  // Break — Space stays temporary-pan, does not collapse.
  await blurInputs(page);
  await page.keyboard.down(' ');
  await expect(desktopSearchField(page), 'Space must not collapse Search').toBeVisible();
  await page.keyboard.up(' ');
  await expect(desktopSearchField(page)).toBeVisible();

  // Break — already-open Search tab click stays on Search and refocuses.
  await searchTabBtn(page).click();
  await expect(desktopSearchField(page), 're-click Search must stay open').toBeVisible();
  expect((await leftRailMetrics(page)).panel, 're-click Search keeps panel 272').toBe(272);
  expect((await leftRailMetrics(page)).host, 're-click Search keeps host 48').toBe(48);
  await expect.poll(async () => isSearchFieldFocused(page), {
    timeout: 3_000,
    message: 're-click Search must refocus the field',
  }).toBe(true);

  await collapseSidebarBtn(page).click();
  await expect(searchTabBtn(page)).toBeVisible();

  // Break — double-click Search stays expanded and invents 0 results.
  const searchBox = await searchTabBtn(page).boundingBox();
  expect(searchBox, 'Search text geometry').toBeTruthy();
  await page.mouse.dblclick(searchBox.x + searchBox.width / 2, searchBox.y + searchBox.height / 2);
  await expect(desktopSearchField(page), 'double-click Search must stay expanded').toBeVisible({ timeout: 8_000 });
  expect(
    await page.getByRole('button', { name: 'Next match (Enter)', exact: true }).count(),
    'double-click Search invents 0 results',
  ).toBe(0);
  expect(await expandSidebarBtn(page).count(), 'double-click Search must not rebound to collapsed').toBe(0);

  await collapseSidebarBtn(page).click();
  await expect(searchTabBtn(page)).toBeVisible();

  // Break — hubPreview has no viewer Search panel.
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview has no Draw').toBe(0);
  expect(await desktopSearchField(page).count(), 'hubPreview viewer Search field 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Search text', exact: true }).count(), 'hubPreview Search text rail 0').toBe(0);

  // Edge — page-1 rect survives Search; click invents 0.
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
  await searchTabBtn(page).click();
  await waitForSearchPanel(page);
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive Search').toEqual(page1Before);

  // Edge — Pen-armed Search invents 0 and does not start a stroke.
  await collapseSidebarBtn(page).click();
  await expect(searchTabBtn(page)).toBeVisible();
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  await searchTabBtn(page).click();
  await expect(desktopSearchField(page), 'Pen-armed Search must still expand').toBeVisible();
  expect(await userAnnotationIds(page, 1), 'Pen-armed Search invents 0').toEqual(marksBeforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge — 120-page: Search does not change the page number.
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  expect(await currentPageNumber(page)).toBe(1);
  await searchTabBtn(page).click();
  await waitForSearchPanel(page);
  expect(await currentPageNumber(page), 'Search must not change page').toBe(1);
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('SEARCH_RAIL_TOGGLE_DESKTOP_PROOF', JSON.stringify({
    hunt,
    start,
    overlayListsSearchTabChord: /Open search|Expand Search|Search panel|Search text tab/.test(overlayText),
    rectId,
    viewBox,
    fileId,
  }));
});

test('390 Open pages/search/bookmarks Search tab edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  // 390 uses the dock hub, not the 48px desktop Search text icon.
  expect(
    await page.getByPlaceholder('Search text').isVisible().catch(() => false),
    '390 Search field hidden until hub Search',
  ).toBe(false);
  await expect(page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByPlaceholder('Search text'), '390 hub defaults to Pages not Search').toBeHidden();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByPlaceholder('Search text')).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => page.getByPlaceholder('Search text').evaluate((el) => document.activeElement === el), {
    timeout: 3_000,
    message: '390 Search tab must focus the field',
  }).toBe(true);
  expect(
    await page.getByRole('button', { name: 'Match case', exact: true }).count(),
    '390 Search Match case 0',
  ).toBe(0);
  expect(
    await page.getByRole('button', { name: 'Y', exact: true }).count(),
    '390 Search must not invent Y/N',
  ).toBe(0);

  const closer = page.getByRole('button', { name: 'Close document panel', exact: true });
  await closer.first().click();
  await expect(page.getByPlaceholder('Search text')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true })).toBeVisible();

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('SEARCH_RAIL_TOGGLE_390_PROOF', JSON.stringify({
    viewBox,
    fileId,
  }));
});
