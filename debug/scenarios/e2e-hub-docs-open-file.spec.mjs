import { test, expect } from '@playwright/test';

// Unique leftover after Hub Projects file-row Open.
// Reachable hubPreview Documents chrome those slices never dedicated:
// Open file (`onOpenDocument` / HubPreview `handleOpenDocument` with
// returnTab='documents').
// Desktop: Preview-pane Open file + row double-click.
// 390: row click openMobileDoc + detail Open file.
// Distinct from Documents Preview pane (already extras) and from
// Projects file-row Open (returnTab=projects).
// Do not invent mobileProjectLayout rail/teams/drive/browse (stays 'drill').
// Do not invent a per-file PDF; HubPreview always assigns the Package 2 fixture.
// Do not replay extras / catalog-completeness / Lock persist / Projects extras /
// file Move/Copy / card reorder / Team write / file Search / file-row reorder /
// file Delete / file-row Open / Archive / Templates / Spaces / Survey-rail /
// PDF waves.
// Leftover-18 parked.

const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';

const SE011 = 'SE-011 Security Shop Drawings.pdf';
const RFI = 'RFI-014 Lobby Camera Coverage.pdf';
const TEST_DOC = 'test.pdf';
const DOOR = 'Door Hardware Schedule — A.601.pdf';
const PACKAGE2 = 'Package 2 — Rev 4 — IC.pdf';
const FIXTURE = 'Package 2 - Rev 4 -- IC.pdf';

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

async function openHub(page, { width = 1440, height = 900, url = HUB_DOCS } = {}) {
  await openPage(page, { width, height, url });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80)
  ));
}

function desktopRow(page, name) {
  return page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: name }).first();
}

function mobileCard(page, name) {
  return page.locator('.documents-mobile-list .mobile-doc-card').filter({ hasText: name }).first();
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

async function waitForViewer(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
}

async function returnHomeToDocuments(page) {
  await page.locator('.tab-bar').getByTitle('Home').click();
  await page.waitForURL((url) => url.searchParams.get('hubPreview') === '1', { timeout: 15_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(SE011).first()).toBeVisible({ timeout: 15_000 });
}

test('Documents Open file intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  // Independent hunt: open hub tabs + testPdf chrome before proving the leftover.
  await openHub(page, { url: HUB_DOCS });
  const docsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  const docsOpenFile = await page.getByRole('button', { name: 'Open file', exact: true }).count();
  const docsPreview = await page.getByText('Preview', { exact: true }).count();
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByText('Tower 5 — Security').first()).toBeVisible({ timeout: 15_000 });
  const projectsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  const projectsOpenFile = await page.getByRole('button', { name: 'Open file', exact: true }).count();
  const projectsPreview = await page.getByText('Preview', { exact: true }).count();
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  const templatesChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  await page.locator('aside.side nav').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  const archiveEmpty = await page.getByText('Nothing in Archive').count();
  const archiveChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));

  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  const editorChrome = await visibleNames(page.locator('button, [role="tab"], input'));
  console.log('HUNT_INVENTORY', JSON.stringify({
    docsChrome: docsChrome.slice(0, 40),
    docsOpenFile,
    docsPreview,
    projectsChrome: projectsChrome.slice(0, 50),
    projectsOpenFile,
    projectsPreview,
    templatesChrome: templatesChrome.slice(0, 30),
    archiveChrome: archiveChrome.slice(0, 16),
    archiveEmpty,
    editorChrome: editorChrome.slice(0, 40),
  }));

  // Empty: no rows, so Open cannot fire.
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  const emptyRows = await page.locator('.documents-desktop-card [data-document-id]').count();
  const emptyOpenFile = await page.getByRole('button', { name: 'Open file', exact: true }).count();
  expect(emptyRows, 'empty documents have no rows to Open').toBe(0);
  expect(emptyOpenFile, 'empty documents have no Open file').toBe(0);
  expect(viewerParams(page).hubPreview).toBe('1');
  expect(viewerParams(page).testPdf).toBeNull();

  await openHub(page);
  await expect(page.getByText(SE011).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(TEST_DOC).first()).toBeVisible();

  // Break: single-click is Preview (stays on hub), not viewer nav.
  await desktopRow(page, TEST_DOC).click();
  await expect(page.getByRole('button', { name: 'Close preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open file', exact: true })).toBeVisible();
  await expect(page.locator('aside').getByText(TEST_DOC).first()).toBeVisible();
  expect(viewerParams(page).hubPreview).toBe('1');
  expect(viewerParams(page).testPdf).toBeNull();
  expect(viewerParams(page).tab).toBe('documents');
  const singleClickStayed = true;

  // Break: More is not Open. Preview & details re-opens the pane.
  await desktopRow(page, SE011).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Preview & details', exact: true })).toBeVisible();
  expect(viewerParams(page).hubPreview).toBe('1');
  expect(viewerParams(page).testPdf).toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(desktopRow(page, SE011)).toBeVisible();
  const moreDidNotOpen = true;

  // Break: Close preview hides Open file and stays on hub.
  await desktopRow(page, TEST_DOC).click();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open file', exact: true })).toHaveCount(0);
  expect(viewerParams(page).hubPreview).toBe('1');
  expect(viewerParams(page).testPdf).toBeNull();
  const closePreviewHidOpen = true;

  // Break: Select mode click toggles, does not navigate.
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await desktopRow(page, SE011).click();
  await expect(page.locator('.survey-hub')).toBeVisible();
  expect(viewerParams(page).hubPreview).toBe('1');
  expect(viewerParams(page).testPdf).toBeNull();
  await expect(desktopRow(page, SE011)).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).first().click();
  const selectDidNotOpen = true;

  // Intended: Preview-pane Open file of SE-011 navigates to the fixture viewer.
  await desktopRow(page, SE011).click();
  await expect(page.locator('aside').getByText(SE011).first()).toBeVisible();
  await Promise.all([
    page.waitForURL((url) => url.searchParams.has('testPdf'), { timeout: 15_000 }),
    page.getByRole('button', { name: 'Open file', exact: true }).click(),
  ]);
  const openedSe011 = viewerParams(page);
  expect(openedSe011.hubPreview, 'Open file leaves hubPreview').toBeNull();
  expect(openedSe011.testPdf).toBe(FIXTURE);
  expect(openedSe011.previewName).toBe(SE011);
  expect(openedSe011.returnTab).toBe('documents');
  await waitForViewer(page);
  const openedFileName = await page.locator('.tab-bar').getByTitle(SE011).innerText();
  const leftoverDevFile = await page.evaluate(() => window.__devTestPdf ?? null);
  expect(openedFileName.replace(/\s+/g, ' ').trim()).toBe(SE011);
  expect(leftoverDevFile, 'AppShell must consume __devTestPdf').toBeNull();
  await expect(page.locator('.tab-bar').getByTitle(SE011)).toBeVisible();
  await assertNoErrorBoundary(page);

  // Return via Home uses returnTab=documents (not Projects).
  await returnHomeToDocuments(page);
  expect(viewerParams(page).tab).toBe('documents');
  expect(viewerParams(page).hubPreview).toBe('1');
  await expect(page.getByText(SE011).first()).toBeVisible();
  await expect(page.getByText(RFI).first()).toBeVisible();
  const homeReturnedDocuments = true;

  // Intended: desktop row double-click also Opens (not Preview-only).
  await Promise.all([
    page.waitForURL((url) => url.searchParams.has('testPdf'), { timeout: 15_000 }),
    desktopRow(page, RFI).dblclick(),
  ]);
  const openedRfi = viewerParams(page);
  expect(openedRfi.testPdf).toBe(FIXTURE);
  expect(openedRfi.previewName).toBe(RFI);
  expect(openedRfi.returnTab).toBe('documents');
  await waitForViewer(page);
  await expect(page.locator('.tab-bar').getByTitle(RFI)).toBeVisible();
  await returnHomeToDocuments(page);
  const dblclickOpened = true;

  // Isolation: test.pdf / Door each carry their own previewName. Same fixture.
  await Promise.all([
    page.waitForURL((url) => url.searchParams.has('testPdf'), { timeout: 15_000 }),
    desktopRow(page, TEST_DOC).dblclick(),
  ]);
  const openedTest = viewerParams(page);
  expect(openedTest.testPdf).toBe(FIXTURE);
  expect(openedTest.previewName).toBe(TEST_DOC);
  expect(openedTest.returnTab).toBe('documents');
  await waitForViewer(page);
  await expect(page.locator('.tab-bar').getByTitle(TEST_DOC)).toBeVisible();
  await returnHomeToDocuments(page);
  await Promise.all([
    page.waitForURL((url) => url.searchParams.has('testPdf'), { timeout: 15_000 }),
    desktopRow(page, DOOR).dblclick(),
  ]);
  const openedDoor = viewerParams(page);
  expect(openedDoor.testPdf).toBe(FIXTURE);
  expect(openedDoor.previewName).toBe(DOOR);
  expect(openedDoor.returnTab).toBe('documents');
  await waitForViewer(page);
  await expect(page.locator('.tab-bar').getByTitle(DOOR)).toBeVisible();
  await returnHomeToDocuments(page);
  await expect(page.getByText(PACKAGE2).first()).toBeVisible();
  const isolation = openedSe011.previewName === SE011
    && openedRfi.previewName === RFI
    && openedTest.previewName === TEST_DOC
    && openedDoor.previewName === DOOR;

  // Edge: Projects file-row Open is a different leftover (returnTab=projects).
  // Documents Open file is the Preview button + double-click, not a Projects row.
  await openHub(page, { url: HUB_PROJECTS });
  await expect(page.getByRole('button', { name: 'Open file', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0);
  const projectsHasNoOpenFile = true;

  // 390: row click openMobileDoc Opens. Detail Open file is a second path.
  await openHub(page, { width: 390, height: 844 });
  await expect(mobileCard(page, SE011)).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('.mobile-project-rail, .mobile-project-browse, .mobile-project-drive').count()).toBe(0);

  // Break: Select mode card click stays on hub.
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await mobileCard(page, SE011).click();
  expect(viewerParams(page).hubPreview).toBe('1');
  expect(viewerParams(page).testPdf).toBeNull();
  await page.getByRole('button', { name: 'Done', exact: true }).first().click();
  const mobileSelectDidNotOpen = true;

  // Break: More → Preview & details opens the detail sheet, not the viewer.
  await mobileCard(page, SE011).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Preview & details', exact: true }).click();
  await expect(page.getByRole('dialog', { name: `${SE011} details` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open file', exact: true })).toBeVisible();
  expect(viewerParams(page).hubPreview).toBe('1');
  expect(viewerParams(page).testPdf).toBeNull();

  // Intended: detail Open file navigates with returnTab=documents.
  await Promise.all([
    page.waitForURL((url) => url.searchParams.has('testPdf'), { timeout: 15_000 }),
    page.getByRole('button', { name: 'Open file', exact: true }).click(),
  ]);
  const mobileDetailOpened = viewerParams(page);
  expect(mobileDetailOpened.testPdf).toBe(FIXTURE);
  expect(mobileDetailOpened.previewName).toBe(SE011);
  expect(mobileDetailOpened.returnTab).toBe('documents');
  await expect(page.getByRole('button', { name: 'Back to documents' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Back to documents' }).click();
  await page.waitForURL((url) => url.searchParams.get('hubPreview') === '1', { timeout: 15_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(viewerParams(page).tab).toBe('documents');
  await expect(mobileCard(page, SE011)).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('.mobile-project-rail, .mobile-project-browse, .mobile-project-drive').count()).toBe(0);
  const mobileDetailReturnedDocuments = true;

  // Intended: 390 row click openMobileDoc Opens (not Preview-only).
  await Promise.all([
    page.waitForURL((url) => url.searchParams.has('testPdf'), { timeout: 15_000 }),
    mobileCard(page, RFI).click(),
  ]);
  const mobileRowOpened = viewerParams(page);
  expect(mobileRowOpened.testPdf).toBe(FIXTURE);
  expect(mobileRowOpened.previewName).toBe(RFI);
  expect(mobileRowOpened.returnTab).toBe('documents');
  await expect(page.getByRole('button', { name: 'Back to documents' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Back to documents' }).click();
  await page.waitForURL((url) => url.searchParams.get('hubPreview') === '1', { timeout: 15_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(viewerParams(page).tab).toBe('documents');
  await expect(mobileCard(page, RFI)).toBeVisible({ timeout: 15_000 });

  await assertNoErrorBoundary(page);

  console.log('HUB_DOCS_OPEN_FILE_PROOF', JSON.stringify({
    emptyRows,
    emptyOpenFile,
    singleClickStayed,
    moreDidNotOpen,
    closePreviewHidOpen,
    selectDidNotOpen,
    openedSe011,
    openedFileName,
    consumedDevFile: leftoverDevFile === null,
    homeReturnedDocuments,
    dblclickOpened,
    openedRfi,
    openedTest,
    openedDoor,
    isolation,
    projectsHasNoOpenFile,
    projectsOpenFile,
    mobileSelectDidNotOpen,
    mobileDetailOpened,
    mobileDetailReturnedDocuments,
    mobileRowOpened,
    mobileReturnedDocuments: viewerParams(page).tab === 'documents',
  }));
});
