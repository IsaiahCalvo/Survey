import { test, expect } from '@playwright/test';

// Unique leftover after Hub Projects file Search + file-row reorder.
// Reachable hubPreview Projects chrome those slices never dedicated:
// file More Delete + file Select Delete (`deleteFiles`).
// Distinct from project delete (`deleteProjects` / `delete-selected-projects`)
// and from file More Copy/Paste. No confirm exists — prove immediate.
// Do not invent mobileProjectLayout rail/teams/drive/browse (stays 'drill').
// Do not replay extras / catalog-completeness / Move/Copy / card reorder /
// Team write / file Search / file-row reorder / Documents extras /
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

async function openFileMore(page, name) {
  await fileRow(page, name).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

async function confirmDialogCount(page) {
  return page.getByRole('dialog').filter({ hasText: /are you sure|delete|confirm/i }).count();
}

test('Projects file More/Select Delete intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  // Independent hunt: open hub tabs + testPdf chrome before proving the leftover.
  await openHub(page, { url: HUB_DOCS });
  const docsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
  const projectsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
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
    projectsChrome: projectsChrome.slice(0, 50),
    templatesChrome: templatesChrome.slice(0, 30),
    archiveChrome: archiveChrome.slice(0, 16),
    archiveEmpty,
    editorChrome: editorChrome.slice(0, 40),
  }));

  // Empty: no file More, no file Select Delete. Project delete chrome is also gone.
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet.').first()).toBeVisible({ timeout: 15_000 });
  const emptyFileMore = await desktopLayout(page).locator('[data-document-id] button[title="More"]').count();
  const emptyFileDelete = await filesHeader(page).getByRole('button', { name: 'Delete' }).count();
  const emptyFileMenuDelete = await page.getByRole('menuitem', { name: 'Delete', exact: true }).count();
  expect(emptyFileMore, 'empty projects have no file More').toBe(0);
  expect(emptyFileDelete, 'empty projects have no file Select Delete').toBe(0);
  expect(emptyFileMenuDelete, 'empty projects have no file More Delete').toBe(0);

  await openHub(page);
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
  await openProject(page, TOWER);
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(fileRow(page, RFI)).toBeVisible();

  // More path — Escape / outside dismiss without deleting. No confirm exists.
  await openFileMore(page, SE011);
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(fileRow(page, RFI)).toBeVisible();

  await openFileMore(page, SE011);
  await page.locator('h1.title').click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(fileRow(page, SE011)).toBeVisible();

  // Intended: More Delete of SE-011 is immediate. RFI stays. Projects stay.
  await openFileMore(page, SE011);
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  expect(await confirmDialogCount(page), 'file More Delete has no confirm').toBe(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(desktopLayout(page).getByText(SE011)).toHaveCount(0);
  await expect(fileRow(page, RFI)).toBeVisible();
  await expect(page.getByText(TOWER).first()).toBeVisible();
  await expect(page.getByText(LAB).first()).toBeVisible();
  await expect(page.getByText(MEP).first()).toBeVisible();

  // Session switch keeps the delete. Isolation: Lab / MEP files untouched.
  await openProject(page, LAB);
  await expect(fileRow(page, DOOR)).toBeVisible();
  await expect(desktopLayout(page).getByText(SE011)).toHaveCount(0);
  await expect(desktopLayout(page).getByText(RFI)).toHaveCount(0);
  await openProject(page, MEP);
  await expect(fileRow(page, MEP_FILE)).toBeVisible();
  await expect(desktopLayout(page).getByText(SE011)).toHaveCount(0);
  await openProject(page, TOWER);
  await expect(fileRow(page, RFI)).toBeVisible();
  await expect(desktopLayout(page).getByText(SE011)).toHaveCount(0);
  const sessionKept = (await desktopLayout(page).locator('[data-document-id]').count()) === 1;

  // Reload (no workflowE2E) restores the seed — session-only, not persist.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await openProject(page, TOWER);
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(fileRow(page, RFI)).toBeVisible();
  const reloadRestores = true;

  // Select path — Files-header Select, not project-list Select.
  const fileSelect = filesHeader(page).getByRole('button', { name: 'Select', exact: true });
  await fileSelect.click();
  const fileDelete = filesHeader(page).getByRole('button', { name: 'Delete' });
  await expect(fileDelete).toBeVisible();
  await expect(fileDelete).toBeDisabled();
  // Project-list Delete must stay a different control (not this leftover).
  await expect(desktopLayout(page).getByTestId('delete-selected-projects')).toHaveCount(0);

  await fileRow(page, RFI).click();
  await expect(fileDelete).toBeEnabled();
  await fileDelete.click();
  expect(await confirmDialogCount(page), 'file Select Delete has no confirm').toBe(0);
  await expect(desktopLayout(page).getByText(RFI)).toHaveCount(0);
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(fileDelete).toBeDisabled();

  // Last-file delete is allowed — Lab has one file.
  await filesHeader(page).getByRole('button', { name: 'Done', exact: true }).click();
  await openProject(page, LAB);
  await expect(fileRow(page, DOOR)).toBeVisible();
  await filesHeader(page).getByRole('button', { name: 'Select', exact: true }).click();
  const labDelete = filesHeader(page).getByRole('button', { name: 'Delete' });
  await expect(labDelete).toBeDisabled();
  await fileRow(page, DOOR).click();
  await expect(labDelete).toBeEnabled();
  await labDelete.click();
  expect(await confirmDialogCount(page), 'last-file Select Delete has no confirm').toBe(0);
  await expect(desktopLayout(page).getByText(DOOR)).toHaveCount(0);
  await expect(desktopLayout(page).getByText('No files in this project yet.')).toBeVisible();
  await expect(page.getByText(LAB).first()).toBeVisible();
  await openProject(page, MEP);
  await expect(fileRow(page, MEP_FILE)).toBeVisible();
  await expect(desktopLayout(page).getByText(DOOR)).toHaveCount(0);
  await openProject(page, TOWER);
  await expect(fileRow(page, SE011)).toBeVisible();
  await expect(desktopLayout(page).getByText(RFI)).toHaveCount(0);

  // 390 drill: More Delete + Select Delete. Layout stays drill (no rail/browse).
  await openHub(page, { width: 390, height: 844 });
  const mobileRow = (id) => page.locator(`.projects-mobile-folder-row[data-project-id="${id}"]`);
  const mobileFile = (name) => page.locator('.projects-mobile-file-row').filter({ hasText: name });
  await expect(mobileRow('p1')).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('.mobile-project-rail, .mobile-project-browse, .mobile-project-drive').count()).toBe(0);

  await mobileRow('p1').click();
  await expect(page.locator('.projects-mobile-back-button')).toBeVisible({ timeout: 8_000 });
  await expect(mobileFile(SE011)).toBeVisible();
  await expect(mobileFile(RFI)).toBeVisible();

  await mobileFile(SE011).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(mobileFile(SE011)).toBeVisible();

  await mobileFile(SE011).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  expect(await confirmDialogCount(page), '390 file More Delete has no confirm').toBe(0);
  await expect(mobileFile(SE011)).toHaveCount(0);
  await expect(mobileFile(RFI)).toBeVisible();

  const mobileSelect = page.getByRole('button', { name: 'Select', exact: true }).locator('visible=true');
  await mobileSelect.click();
  const mobileDelete = page.getByRole('button', { name: 'Delete' }).locator('visible=true');
  await expect(mobileDelete).toBeDisabled();
  await mobileFile(RFI).click();
  await expect(mobileDelete).toBeEnabled();
  await mobileDelete.click();
  expect(await confirmDialogCount(page), '390 file Select Delete has no confirm').toBe(0);
  await expect(page.locator('.projects-mobile-empty-card').getByText('No files in this project yet.')).toBeVisible();
  await expect(page.locator('.projects-mobile-file-row')).toHaveCount(0);

  await page.locator('.projects-mobile-back-button').click();
  await expect(mobileRow('p2')).toBeVisible({ timeout: 8_000 });
  await mobileRow('p2').click();
  await expect(mobileFile(DOOR)).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.projects-mobile-file-row').filter({ hasText: SE011 })).toHaveCount(0);
  await mobileFile(DOOR).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.projects-mobile-empty-card').getByText('No files in this project yet.')).toBeVisible();
  await page.locator('.projects-mobile-back-button').click();
  await expect(mobileRow('p3')).toBeVisible();
  await mobileRow('p3').click();
  await expect(mobileFile(MEP_FILE)).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.projects-mobile-file-row').filter({ hasText: DOOR })).toHaveCount(0);

  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();

  console.log('HUB_PROJECTS_FILE_DELETE_PROOF', JSON.stringify({
    emptyFileMore,
    emptyFileDelete,
    emptyFileMenuDelete,
    moreEscapeKeeps: true,
    moreOutsideKeeps: true,
    moreImmediate: true,
    selectNoneDisabled: true,
    selectImmediate: true,
    lastFileAllowed: true,
    sessionKept,
    reloadRestores,
    isolation: true,
    mobileMoreImmediate: true,
    mobileSelectImmediate: true,
    mobileLastFile: true,
    noConfirm: true,
    noFileId: fileId === null,
  }));
});
