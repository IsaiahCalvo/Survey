import { test, expect } from '@playwright/test';

// Unique leftover after toolbar click-to-arm.
// Desktop TabBar Home click (`handleTabClick` / `setCurrentView('dashboard')`)
// on `?testPdf=` without `returnTab`. Distinct from Close tab
// (`handleTabClose` removes the PDF tab) and from Open-file Home
// (`returnToDevHubPreview` when `returnTab` is set). TabBar is
// desktop-only (`!isNarrowShell`). 390 Back is handleBack — already
// proven, not this leftover. leftover-18 parked. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';
const HUB_DOCS = '/?hubPreview=1&tab=documents';

async function openPage(page, { width = 1400, height = 900, url = LINK_PDF } = {}) {
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
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

function viewerParams(page) {
  const url = new URL(page.url());
  return {
    href: url.pathname + url.search,
    hubPreview: url.searchParams.get('hubPreview'),
    testPdf: url.searchParams.get('testPdf'),
    previewName: url.searchParams.get('previewName'),
    returnTab: url.searchParams.get('returnTab'),
    tab: url.searchParams.get('tab'),
  };
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    return [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter((id) => id && !/^\d+R$/i.test(id));
  }, pageNumber);
}

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function huntHiddenChrome(page) {
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

function homeTab(page) {
  return page.getByRole('tab', { name: 'Home', exact: true });
}

test('desktop Home tab click intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_DOCS });
  const hubTabBar = await page.locator('.tab-bar').count();
  const hubHomeTab = await page.getByRole('tab', { name: 'Home', exact: true }).count();
  const hubDraw = await page.getByRole('button', { name: 'Draw', exact: true }).count();

  await openPage(page, { url: LINK_PDF });
  await assertNoErrorBoundary(page);
  await expect(page.locator('.tab-bar')).toBeVisible();
  await expect(homeTab(page)).toBeVisible();
  await expect(page.locator('[data-home-tab="true"]')).toHaveCount(1);
  await expect(page.locator('[data-pdf-tab-id]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Close tab', exact: true })).toHaveCount(1);
  const homeClose = await page.locator('[data-home-tab="true"]').getByRole('button', { name: 'Close tab' }).count();
  expect(homeClose, 'Home tab has no Close tab').toBe(0);

  const hunt = await huntHiddenChrome(page);
  for (const [name, count] of Object.entries(hunt)) {
    expect(count, `${name} compile-hidden`).toBe(0);
  }

  const marksBefore = await userAnnotationIds(page, 1);
  const viewBoxBefore = await pageViewBox(page);
  expect(viewBoxBefore, 'SVG viewBox owns zoom').toBe('0 0 612 792');

  // Intended: draw a rect, then Home hides the viewer and keeps the PDF tab.
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true }).click();
  const layer = page.locator('[data-svg-annotation-layer="1"]').first();
  const box = await layer.boundingBox();
  expect(box, 'page layer has a box').toBeTruthy();
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  await expect.poll(async () => (await userAnnotationIds(page, 1)).length, {
    message: 'Rectangle create must add one mark',
  }).toBe(marksBefore.length + 1);
  const createdIds = await userAnnotationIds(page, 1);

  await homeTab(page).click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeHidden();
  await expect(page.locator('[data-pdf-tab-id]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Close tab', exact: true })).toHaveCount(1);
  await expect(homeTab(page)).toBeVisible();
  await expect(homeTab(page)).toHaveAttribute('aria-selected', 'true');
  const afterHome = viewerParams(page);
  expect(afterHome.testPdf, 'Home click does not navigate away from testPdf').toBe('clickable-link-test.pdf');
  expect(afterHome.hubPreview, 'Home click without returnTab does not assign hubPreview').toBeNull();
  expect(afterHome.returnTab, 'testPdf Home is not Open-file returnTab').toBeNull();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Intended: PDF tab click returns the same viewer + same mark + same viewBox.
  await page.locator('[data-pdf-tab-id]').first().click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 20_000 });
  expect(await pageViewBox(page), 'return keeps portrait viewBox').toBe('0 0 612 792');
  expect(await userAnnotationIds(page, 1), 'Home keep-mounted restores the same mark').toEqual(createdIds);
  await expect(homeTab(page)).toHaveAttribute('aria-selected', 'false');

  // Break: Home click invents 0 extra marks; Close tab is a different control.
  await homeTab(page).click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeHidden({ timeout: 15_000 });
  await page.locator('[data-pdf-tab-id]').first().click();
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 20_000 });
  expect(await userAnnotationIds(page, 1), 'Home round-trip invents 0').toEqual(createdIds);
  expect(await page.getByRole('button', { name: 'Close tab', exact: true }).count(), 'Close tab stays on the PDF tab').toBe(1);

  // Break: Enter / Space on focused Home also leave the viewer.
  await homeTab(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeHidden({ timeout: 15_000 });
  await page.locator('[data-pdf-tab-id]').first().click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await homeTab(page).focus();
  await page.keyboard.press(' ');
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeHidden({ timeout: 15_000 });
  const afterKeys = viewerParams(page);
  expect(afterKeys.hubPreview, 'Enter/Space Home do not assign hubPreview').toBeNull();
  expect(afterKeys.testPdf).toBe('clickable-link-test.pdf');

  // Break: hubPreview has no AppShell TabBar / Home tab.
  await openPage(page, { url: HUB });
  expect(await page.locator('.tab-bar').count(), 'hubPreview has no AppShell tab-bar').toBe(0);
  expect(await page.getByRole('tab', { name: 'Home', exact: true }).count(), 'hubPreview has no Home tab').toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview has no Draw').toBe(0);
  await assertNoErrorBoundary(page);

  // Edge: 1-page search fixture Home keeps file.id null + viewBox.
  await openPage(page, { url: SEARCH_PDF });
  await assertNoErrorBoundary(page);
  const searchViewBox = await pageViewBox(page);
  expect(searchViewBox).toBe('0 0 612 792');
  await homeTab(page).click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeHidden({ timeout: 15_000 });
  const searchHome = viewerParams(page);
  expect(searchHome.testPdf).toBe('text-search-glyph-lab.pdf');
  expect(searchHome.hubPreview).toBeNull();
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await page.locator('[data-pdf-tab-id]').first().click();
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 20_000 });
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  await assertNoErrorBoundary(page);

  console.log('HOME_TAB_CLICK_DESKTOP_PROOF', JSON.stringify({
    leftoverKind: 'app-shell-home-tab-click',
    hubTabBar,
    hubHomeTab,
    hubDraw,
    hunt,
    viewBoxBefore,
    createdIds,
    afterHome,
    searchHome,
    fileId,
  }));
});

test('390 Home tab click edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await assertNoErrorBoundary(page);

  const mobileTabBar = await page.locator('.tab-bar').count();
  const mobileHomeTab = await page.getByRole('tab', { name: 'Home', exact: true }).count();
  const mobileCloseTab = await page.getByRole('button', { name: 'Close tab', exact: true }).count();
  const mobileBack = await page.getByRole('button', { name: /Back/i }).count();
  expect(mobileTabBar, '390 has no TabBar').toBe(0);
  expect(mobileHomeTab, '390 has no Home tab').toBe(0);
  expect(mobileCloseTab, '390 has no Close tab').toBe(0);
  expect(mobileBack, '390 Back is handleBack, not this leftover').toBeGreaterThan(0);

  const hunt = await huntHiddenChrome(page);
  for (const [name, count] of Object.entries(hunt)) {
    expect(count, `390 ${name} compile-hidden`).toBe(0);
  }

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, '390 file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  console.log('HOME_TAB_CLICK_390_PROOF', JSON.stringify({
    leftoverKind: 'app-shell-home-tab-click-390',
    mobileTabBar,
    mobileHomeTab,
    mobileCloseTab,
    mobileBack,
    hunt,
    viewBox,
    fileId,
  }));
});
