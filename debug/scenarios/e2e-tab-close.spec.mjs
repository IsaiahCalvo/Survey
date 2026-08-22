import { test, expect } from '@playwright/test';

// Unique leftover after Documents Open file.
// Desktop TabBar Close tab (`onTabClose` / `handleTabClose`) is live
// AppShell chrome. Distinct from Home click (`handleTabClick` /
// `handleBack` / `returnToDevHubPreview`). TabBar is desktop-only
// (`!isNarrowShell`). 390 Back is handleBack — already proven, not this
// leftover. Page-drop toast is a stub. Tab reorder needs two PDF tabs
// (not invented on ?testPdf=). leftover-18 parked.

const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';
const SE011 = 'SE-011 Security Shop Drawings.pdf';

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

async function waitForViewer(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
}

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80)
  ));
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

test('TabBar Close tab intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const docsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  const docsCloseTab = await page.getByRole('button', { name: 'Close tab', exact: true }).count();
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByText('Tower 5 — Security').first()).toBeVisible({ timeout: 15_000 });
  const projectsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  const projectsAddFiles = await page.getByRole('button', { name: 'Add files', exact: true }).count();
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  const templatesChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  await page.locator('aside.side nav').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  const archiveEmpty = await page.getByText('Nothing in Archive').count();
  const archiveSearch = await page.getByPlaceholder('Search archive...').count();
  const archiveChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));

  await openPage(page, { url: TEST_PDF });
  await waitForViewer(page);
  await expect(page.locator('.tab-bar')).toBeVisible();
  const editorChrome = await visibleNames(page.locator('button, [role="tab"], input'));
  const editorCloseTab = await page.getByRole('button', { name: 'Close tab', exact: true }).count();
  const editorPdfTabs = await page.locator('[data-pdf-tab-id]').count();
  const editorHome = await page.locator('.tab-bar').getByTitle('Home').count();
  console.log('HUNT_INVENTORY', JSON.stringify({
    docsChrome: docsChrome.slice(0, 24),
    docsCloseTab,
    projectsChrome: projectsChrome.slice(0, 24),
    projectsAddFiles,
    templatesChrome: templatesChrome.slice(0, 20),
    archiveChrome: archiveChrome.slice(0, 16),
    archiveEmpty,
    archiveSearch,
    editorChrome: editorChrome.slice(0, 36),
    editorCloseTab,
    editorPdfTabs,
    editorHome,
  }));

  // Break: hubPreview has no AppShell TabBar.
  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const hubCloseTab = await page.getByRole('button', { name: 'Close tab', exact: true }).count();
  const hubTabBar = await page.locator('.tab-bar').count();
  expect(hubCloseTab, 'hubPreview has no Close tab').toBe(0);
  expect(hubTabBar, 'hubPreview has no AppShell tab-bar').toBe(0);

  // Intended: Close tab leaves the viewer and keeps the Home tab.
  await openPage(page, { url: TEST_PDF });
  await waitForViewer(page);
  await expect(page.getByRole('button', { name: 'Close tab', exact: true })).toHaveCount(1);
  await expect(page.locator('[data-pdf-tab-id]')).toHaveCount(1);
  const homeClose = await page.locator('.tab-bar').getByTitle('Home').locator('xpath=..').getByRole('button', { name: 'Close tab' }).count();
  expect(homeClose, 'Home tab has no Close tab').toBe(0);
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Close tab', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-pdf-tab-id]')).toHaveCount(0);
  await expect(page.locator('.tab-bar').getByTitle('Home')).toBeVisible();
  const afterClose = viewerParams(page);
  expect(afterClose.testPdf, 'Close tab does not navigate away from testPdf').toBe('clickable-link-test.pdf');
  expect(afterClose.hubPreview, 'Close tab does not assign hubPreview').toBeNull();
  const closedToDashboard = true;

  // Break: Home has no Close tab (counted while the PDF tab was open).

  // Edge: reload remounts the fixture viewer (close is session-only).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForViewer(page);
  await expect(page.getByRole('button', { name: 'Close tab', exact: true })).toHaveCount(1);
  const reloadRestored = true;

  // Edge: Close tab after Open file does not use returnToDevHubPreview.
  await openPage(page, { url: HUB_DOCS });
  await expect(page.getByText(SE011).first()).toBeVisible({ timeout: 15_000 });
  await page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: SE011 }).first().click();
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await waitForViewer(page);
  const opened = viewerParams(page);
  expect(opened.returnTab).toBe('documents');
  expect(opened.previewName).toContain('SE-011');
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeHidden({ timeout: 15_000 });
  const closedFromOpen = viewerParams(page);
  expect(closedFromOpen.hubPreview, 'Close tab is not Home / returnToDevHubPreview').toBeNull();
  expect(closedFromOpen.returnTab).toBe('documents');
  expect(closedFromOpen.testPdf).toBeTruthy();
  const closeDidNotReturnHub = true;

  // Edge: unsaved ink does not confirm; close is immediate.
  await openPage(page, { url: TEST_PDF });
  await waitForViewer(page);
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const layer = page.locator('[data-svg-annotation-layer="1"]').first();
  await expect(layer).toBeVisible({ timeout: 30_000 });
  const box = await layer.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 80, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 120);
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const noConfirm = true;

  // Edge: 390 has no TabBar Close tab (Back is handleBack, not this leftover).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TEST_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 60_000 });
  const mobileCloseTab = await page.getByRole('button', { name: 'Close tab', exact: true }).count();
  const mobileTabBar = await page.locator('.tab-bar').count();
  const mobileBack = await page.getByRole('button', { name: /Back/i }).count();
  expect(mobileCloseTab, '390 has no Close tab').toBe(0);
  expect(mobileTabBar, '390 has no TabBar').toBe(0);

  console.log('TAB_CLOSE_PROOF', JSON.stringify({
    leftoverKind: 'app-shell-tab-close',
    hubCloseTab,
    hubTabBar,
    closedToDashboard,
    homeClose,
    reloadRestored,
    openedReturnTab: opened.returnTab,
    closeDidNotReturnHub,
    closedFromOpenHubPreview: closedFromOpen.hubPreview,
    noConfirm,
    mobileCloseTab,
    mobileTabBar,
    mobileBack,
    editorCloseTab,
    editorPdfTabs,
  }));
});
