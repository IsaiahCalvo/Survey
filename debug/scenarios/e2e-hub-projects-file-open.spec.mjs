import { test, expect } from '@playwright/test';

// Unique leftover after Hub Projects file More/Select Delete.
// Reachable hubPreview Projects chrome those slices never dedicated:
// file-row Open (`onOpenDocument` / HubPreview `handleOpenDocument`).
// Distinct from Documents Preview pane / Open file and leftover-18 Upload.
// File More has no Open item — Open is the row click.
// Do not invent mobileProjectLayout rail/teams/drive/browse (stays 'drill').
// Do not invent a per-file PDF; HubPreview always assigns the Package 2 fixture.
// Do not replay extras / catalog-completeness / Move/Copy / card reorder /
// Team write / file Search / file-row reorder / file Delete / Documents extras /
// Lock persist / Archive / Templates / Spaces / Survey-rail / PDF waves.
// Leftover-18 parked.

const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';

const TOWER = 'Tower 5 — Security';
const LAB = 'Lab Reno — MEP';
const MEP = 'MEP Phase 2';
const SE011 = 'SE-011 Security Shop Drawings.pdf';
const RFI = 'RFI-014 Lobby Camera Coverage.pdf';
const DOOR = 'Door Hardware Schedule — A.601.pdf';
const MEP_FILE = 'MEP Coordination — Level 3.pdf';
const FIXTURE = 'Package 2 - Rev 4 -- IC.pdf';

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

async function openHub(page, { width = 1440, height = 900, url = HUB_PROJECTS } = {}) {
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

function desktopLayout(page) {
  return page.locator('.projects-desktop-layout');
}

function fileRow(page, name) {
  return desktopLayout(page).locator('[data-document-id]').filter({ hasText: name }).first();
}

function filesHeader(page) {
  return desktopLayout(page).locator('span', { hasText: /^Files$/ }).locator('xpath=following-sibling::div[1]');
}

async function openProject(page, name) {
  const seedId = { [TOWER]: 'p1', [LAB]: 'p2', [MEP]: 'p3' }[name];
  const row = desktopLayout(page).locator(`[data-drag-rearrange-row][data-project-id="${seedId}"]`);
  await expect(row).toBeVisible({ timeout: 8_000 });
  await row.dispatchEvent('click');
  await expect(desktopLayout(page).getByRole('textbox', { name: 'Click to rename' })).toHaveValue(name, { timeout: 8_000 });
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

async function clickFileOpen(page, name) {
  await Promise.all([
    page.waitForURL((url) => url.searchParams.has('testPdf'), { timeout: 15_000 }),
    fileRow(page, name).getByText(name, { exact: true }).click(),
  ]);
}

async function waitForViewer(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
}

async function returnHomeToProjects(page) {
  await page.locator('.tab-bar').getByTitle('Home').click();
  await page.waitForURL((url) => url.searchParams.get('hubPreview') === '1', { timeout: 15_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
}

test('Projects file-row Open intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  // Independent hunt: open hub tabs + testPdf chrome before proving the leftover.
  await openHub(page, { url: HUB_DOCS });
  const docsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  const docsOpenFile = await page.getByRole('button', { name: 'Open file', exact: true }).count();
  const docsPreview = await page.getByText('Preview', { exact: true }).count();
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
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

  // Empty: no file rows, so Open cannot fire.
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet.').first()).toBeVisible({ timeout: 15_000 });
  const emptyFileRows = await desktopLayout(page).locator('[data-document-id]').count();
  expect(emptyFileRows, 'empty projects have no file rows to Open').toBe(0);
  expect(viewerParams(page).hubPreview).toBe('1');
  expect(viewerParams(page).testPdf).toBeNull();

  // Documents contrast: row click is Preview (stays on hub), not viewer nav.
  await openHub(page, { url: HUB_DOCS });
  await page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: 'test.pdf' }).first().click();
  await expect(page.getByRole('button', { name: 'Close preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open file', exact: true })).toBeVisible();
  expect(viewerParams(page).hubPreview).toBe('1');
  expect(viewerParams(page).testPdf).toBeNull();
  expect(viewerParams(page).tab).toBe('documents');
  const docsPreviewStayed = true;

  await openHub(page);
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
  await openProject(page, TOWER);
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(fileRow(page, RFI)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open file', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0);

  // Break: More is not Open. No Open menuitem. Row stays; URL stays hub.
  await fileRow(page, SE011).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible();
  expect(viewerParams(page).hubPreview).toBe('1');
  expect(viewerParams(page).testPdf).toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(fileRow(page, SE011)).toBeVisible();
  const moreDidNotOpen = true;

  // Break: Select mode click toggles, does not navigate.
  await filesHeader(page).getByRole('button', { name: 'Select', exact: true }).click();
  await fileRow(page, SE011).click();
  await expect(page.locator('.survey-hub')).toBeVisible();
  expect(viewerParams(page).hubPreview).toBe('1');
  expect(viewerParams(page).testPdf).toBeNull();
  await expect(fileRow(page, SE011)).toBeVisible();
  await filesHeader(page).getByRole('button', { name: 'Done', exact: true }).click();
  const selectDidNotOpen = true;

  // Intended: row click of SE-011 navigates to the hubPreview fixture viewer.
  await clickFileOpen(page, SE011);
  const openedSe011 = viewerParams(page);
  expect(openedSe011.hubPreview, 'Open leaves hubPreview').toBeNull();
  expect(openedSe011.testPdf).toBe(FIXTURE);
  expect(openedSe011.previewName).toBe(SE011);
  expect(openedSe011.returnTab).toBe('projects');
  await waitForViewer(page);
  // AppShell consumes window.__devTestPdf (sets null) after handing the File
  // to the tab. The live name is the PDF tab title = previewName.
  const openedFileName = await page.locator('.tab-bar').getByTitle(SE011).innerText();
  const leftoverDevFile = await page.evaluate(() => window.__devTestPdf ?? null);
  expect(openedFileName.replace(/\s+/g, ' ').trim()).toBe(SE011);
  expect(leftoverDevFile, 'AppShell must consume __devTestPdf').toBeNull();
  await expect(page.locator('.tab-bar').getByTitle(SE011)).toBeVisible();
  await assertNoErrorBoundary(page);

  // Return via Home uses returnTab=projects (not Documents).
  await returnHomeToProjects(page);
  expect(viewerParams(page).tab).toBe('projects');
  expect(viewerParams(page).hubPreview).toBe('1');
  await openProject(page, TOWER);
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(fileRow(page, RFI)).toBeVisible();
  const homeReturnedProjects = true;

  // Isolation: RFI Open uses RFI previewName, not SE-011 / Door / MEP.
  await clickFileOpen(page, RFI);
  const openedRfi = viewerParams(page);
  expect(openedRfi.testPdf).toBe(FIXTURE);
  expect(openedRfi.previewName).toBe(RFI);
  expect(openedRfi.returnTab).toBe('projects');
  await waitForViewer(page);
  await expect(page.locator('.tab-bar').getByTitle(RFI)).toBeVisible();
  await returnHomeToProjects(page);
  await openProject(page, LAB);
  await expect(fileRow(page, DOOR)).toBeVisible();
  await expect(desktopLayout(page).getByText(SE011)).toHaveCount(0);
  await clickFileOpen(page, DOOR);
  const openedDoor = viewerParams(page);
  expect(openedDoor.previewName).toBe(DOOR);
  expect(openedDoor.returnTab).toBe('projects');
  await waitForViewer(page);
  await expect(page.locator('.tab-bar').getByTitle(DOOR)).toBeVisible();
  await returnHomeToProjects(page);
  await openProject(page, MEP);
  await expect(fileRow(page, MEP_FILE)).toBeVisible();
  const isolation = openedSe011.previewName === SE011
    && openedRfi.previewName === RFI
    && openedDoor.previewName === DOOR;

  // 390 drill: file-row click Opens. Layout stays drill (no rail/browse).
  await openHub(page, { width: 390, height: 844 });
  const mobileRow = (id) => page.locator(`.projects-mobile-folder-row[data-project-id="${id}"]`);
  const mobileFile = (name) => page.locator('.projects-mobile-file-row').filter({ hasText: name });
  await expect(mobileRow('p1')).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('.mobile-project-rail, .mobile-project-browse, .mobile-project-drive').count()).toBe(0);

  await mobileRow('p1').click();
  await expect(page.locator('.projects-mobile-back-button')).toBeVisible({ timeout: 8_000 });
  await expect(mobileFile(SE011)).toBeVisible();
  await expect(mobileFile(RFI)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open file', exact: true })).toHaveCount(0);

  await mobileFile(SE011).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(viewerParams(page).hubPreview).toBe('1');

  await Promise.all([
    page.waitForURL((url) => url.searchParams.has('testPdf'), { timeout: 15_000 }),
    mobileFile(SE011).getByText(SE011, { exact: true }).click(),
  ]);
  const mobileOpened = viewerParams(page);
  expect(mobileOpened.testPdf).toBe(FIXTURE);
  expect(mobileOpened.previewName).toBe(SE011);
  expect(mobileOpened.returnTab).toBe('projects');
  await expect(page.getByRole('button', { name: 'Back to documents' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Back to documents' }).click();
  await page.waitForURL((url) => url.searchParams.get('hubPreview') === '1', { timeout: 15_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(viewerParams(page).tab).toBe('projects');
  // Fresh hub load after Back: mobile list (desktop Tower copy stays CSS-hidden).
  await expect(page.locator('.projects-mobile-folder-row[data-project-id="p1"]')).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('.mobile-project-rail, .mobile-project-browse, .mobile-project-drive').count()).toBe(0);

  await assertNoErrorBoundary(page);

  console.log('HUB_PROJECTS_FILE_OPEN_PROOF', JSON.stringify({
    emptyFileRows,
    docsPreviewStayed,
    projectsOpenFile,
    projectsPreview,
    moreDidNotOpen,
    selectDidNotOpen,
    openedSe011,
    openedFileName,
    consumedDevFile: leftoverDevFile === null,
    homeReturnedProjects,
    openedRfi,
    openedDoor,
    isolation,
    mobileOpened,
    mobileReturnedProjects: viewerParams(page).tab === 'projects',
  }));
});
