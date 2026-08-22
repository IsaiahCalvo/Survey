import { test, expect } from '@playwright/test';

// Unique leftover after Projects catalog-completeness (rename / delete /
// create + Manage-team open/Esc) and Hub Documents extras / Lock persist.
// Reachable hubPreview Projects chrome that those slices never dedicated:
// Search, Pin/Unpin, Select Duplicate, file More Copy/Paste.
// Do not replay Documents extras. Do not invent leftover-18 Share send,
// Upload OS picker, Team writeback, or cloud lockDocument.

const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';

const TOWER = 'Tower 5 — Security';
const LAB = 'Lab Reno — MEP';
const MEP = 'MEP Phase 2';
const LAB_COPY = 'Lab Reno — MEP (copy)';
const SE011 = 'SE-011 Security Shop Drawings.pdf';
const SE011_COPY = 'SE-011 Security Shop Drawings-copy.pdf';
const RFI = 'RFI-014 Lobby Camera Coverage.pdf';
const DOOR = 'Door Hardware Schedule — A.601.pdf';

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

function projectRow(page, name) {
  const seedId = { [TOWER]: 'p1', [LAB]: 'p2', [MEP]: 'p3' }[name];
  if (seedId) return desktopLayout(page).locator(`[data-project-id="${seedId}"]`).first();
  return desktopLayout(page).locator('[data-project-id]').filter({ hasText: name }).first();
}

function fileRow(page, name) {
  return desktopLayout(page).locator('[data-document-id]').filter({ hasText: name }).first();
}

async function projectOrder(page) {
  return desktopLayout(page).locator('[data-project-id]').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('div[style*="font-weight: 600"]')?.textContent?.trim() || row.textContent?.trim() || '')
  ));
}

async function openProjectMore(page, name) {
  await projectRow(page, name).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

async function openFileMore(page, name) {
  await fileRow(page, name).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

test('Projects extras Search / Pin / Duplicate / file Copy-Paste intended + break + edge', async ({ page }) => {
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
  const archiveHostError = await page.getByText(/invalid input syntax for type uuid/i).count();
  const archiveChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));

  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  const editorChrome = await visibleNames(page.locator('button, [role="tab"], input'));
  await page.getByRole('button', { name: 'Fit options' }).first().click();
  const fitLabels = await page.locator('button').evaluateAll((nodes) => (
    nodes
      .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => /^(Fit page|Fit width|Fit height|Manual|Actual size|Rotate)/i.test(text))
  ));
  await page.keyboard.press('Escape');
  console.log('HUNT_INVENTORY', JSON.stringify({
    docsChrome: docsChrome.slice(0, 40),
    projectsChrome: projectsChrome.slice(0, 40),
    templatesChrome: templatesChrome.slice(0, 40),
    archiveChrome: archiveChrome.slice(0, 20),
    archiveEmpty,
    archiveHostError,
    editorChrome: editorChrome.slice(0, 50),
    fitLabels,
  }));

  // Empty: no Search hits, no Pin / Duplicate / file More.
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet.').first()).toBeVisible({ timeout: 15_000 });
  const emptyDup = await desktopLayout(page).getByRole('button', { name: 'Duplicate', exact: true }).count();
  const emptyPin = await page.getByRole('menuitem', { name: /Pin project|Unpin project/ }).count();
  const emptyFileMore = await desktopLayout(page).locator('[data-document-id] button[title="More"]').count();
  expect(emptyDup, 'empty projects have no Duplicate').toBe(0);
  expect(emptyPin, 'empty projects have no Pin menu').toBe(0);
  expect(emptyFileMore, 'empty projects have no file More').toBe(0);

  await openHub(page);
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(LAB).first()).toBeVisible();
  await expect(page.getByText(MEP).first()).toBeVisible();

  const search = page.locator('.projects-desktop-search input[placeholder="Search projects..."]');
  await expect(search).toBeVisible();
  await search.fill('xyzzy');
  await expect(page.getByText('No projects match your search.').first()).toBeVisible();
  await expect(page.getByText(TOWER)).toHaveCount(0);
  await search.fill('lab');
  await expect(page.getByText(LAB).first()).toBeVisible();
  await expect(page.getByText(TOWER)).toHaveCount(0);
  await expect(page.getByText(MEP)).toHaveCount(0);
  await search.fill('TOWER');
  await expect(page.getByText(TOWER).first()).toBeVisible();
  await expect(page.getByText(LAB)).toHaveCount(0);
  await search.fill('');
  await expect(page.getByText(LAB).first()).toBeVisible();
  await expect(page.getByText(MEP).first()).toBeVisible();
  await page.locator('h1.title').click();
  await expect(search).not.toBeFocused();

  const orderBeforePin = await projectOrder(page);
  expect(orderBeforePin[0]).toContain('Tower 5');
  await openProjectMore(page, LAB);
  await expect(page.getByRole('menuitem', { name: 'Pin project', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add member', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Get link to project', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Upload files', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Pin project', exact: true }).click();
  await expect.poll(async () => (await projectOrder(page))[0]).toContain('Lab Reno');
  await openProjectMore(page, LAB);
  await expect(page.getByRole('menuitem', { name: 'Unpin project', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Unpin project', exact: true }).click();
  await expect.poll(async () => (await projectOrder(page))[0]).toContain('Tower 5');
  await expect(page.getByText(MEP).first()).toBeVisible();

  const select = desktopLayout(page).getByTestId('project-select-toggle');
  await select.click();
  const duplicate = desktopLayout(page).getByRole('button', { name: 'Duplicate', exact: true });
  await expect(duplicate).toBeDisabled();
  await desktopLayout(page).locator('[data-project-id="p2"]').first().click();
  await expect(duplicate).toBeEnabled();
  await duplicate.click();
  await expect(page.getByText(LAB_COPY).first()).toBeVisible();
  await expect(page.getByText(LAB).first()).toBeVisible();
  await expect(page.getByText(TOWER).first()).toBeVisible();
  await expect(page.getByText(MEP).first()).toBeVisible();

  await desktopLayout(page).getByRole('button', { name: 'Done', exact: true }).click();
  await projectRow(page, LAB_COPY).click();
  await expect(desktopLayout(page).getByText('Door Hardware Schedule — A.601-copy.pdf').first()).toBeVisible();
  await projectRow(page, LAB).click();
  await expect(fileRow(page, DOOR)).toBeVisible();
  await expect(desktopLayout(page).getByText('Door Hardware Schedule — A.601-copy.pdf')).toHaveCount(0);

  await projectRow(page, TOWER).click();
  await expect(fileRow(page, SE011)).toBeVisible();
  await openFileMore(page, SE011);
  const pasteEmpty = page.getByRole('menuitem', { name: 'Paste', exact: true });
  await expect(pasteEmpty).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await openFileMore(page, RFI);
  const pasteReady = page.getByRole('menuitem', { name: 'Paste', exact: true });
  await expect(pasteReady).toBeEnabled();
  await pasteReady.click();
  await expect(page.getByText(SE011_COPY).first()).toBeVisible();
  await expect(fileRow(page, SE011)).toBeVisible();
  await projectRow(page, LAB).click();
  await expect(fileRow(page, DOOR)).toBeVisible();
  await expect(desktopLayout(page).getByText(SE011_COPY)).toHaveCount(0);

  // 390: Search + Select Duplicate + Pin.
  await openHub(page, { width: 390, height: 844 });
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
  const mobileSearch = page.locator('input[placeholder="Search projects..."]');
  await expect(mobileSearch).toBeVisible();
  await mobileSearch.fill('mep');
  await expect(page.getByText(MEP).first()).toBeVisible();
  await expect(page.getByText(TOWER)).toHaveCount(0);
  await mobileSearch.fill('');
  await expect(page.getByText(TOWER).first()).toBeVisible();
  await page.locator('h1.title').click();

  const mobileSelect = page.getByTestId('project-select-toggle');
  await mobileSelect.click();
  const mobileDup = page.getByRole('button', { name: 'Duplicate', exact: true });
  await expect(mobileDup).toBeDisabled();
  await page.locator('[data-project-id="p3"]').first().click();
  await expect(mobileDup).toBeEnabled();
  await mobileDup.click();
  await expect(page.getByText('MEP Phase 2 (copy)').first()).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.locator('[data-project-id="p2"]').locator('button[title="More"]').click();
  await expect(page.getByRole('menuitem', { name: 'Pin project', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Pin project', exact: true }).click();
  await expect(page.locator('[data-project-id="p2"] [title="Pinned"]')).toBeVisible();

  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();

  console.log('HUB_PROJECTS_EXTRAS_PROOF', JSON.stringify({
    emptyDup: emptyDup,
    emptyPin: emptyPin,
    searchMiss: true,
    searchLab: true,
    pinLabFloated: true,
    unpinRestoredTower: true,
    selectDuplicateDisabled: true,
    projectCopy: LAB_COPY,
    fileCopyPaste: SE011_COPY,
    isolation: true,
    mobileSearch: true,
    mobileCopy: 'MEP Phase 2 (copy)',
    mobilePin: true,
    noFileId: fileId === null,
  }));
});
