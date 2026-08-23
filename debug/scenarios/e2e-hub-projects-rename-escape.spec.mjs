import { test, expect } from '@playwright/test';

// Product bug leftover the Counter Start / Width Escape hunts parked:
// Hub project-name fields committed on Enter/blur with no Escape restore.
// Templates / Spaces / bookmark rename already restore. Documents / Archive
// use RenameModal (Escape closes without persist). Distinct from
// catalog-completeness Enter rename, leftover-18 / X-01. No file.id.

const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';

const TOWER = 'Tower 5 — Security';
const LAB = 'Lab Reno — MEP';
const HUNT = 'Hunt Tower';

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

function desktopLayout(page) {
  return page.locator('.projects-desktop-layout');
}

async function openDesktopProject(page, name) {
  const seedId = { [TOWER]: 'p1', [LAB]: 'p2' }[name];
  const row = desktopLayout(page).locator(`[data-drag-rearrange-row][data-project-id="${seedId}"]`);
  await expect(row).toBeVisible({ timeout: 8_000 });
  await row.dispatchEvent('click');
  await expect(desktopRename(page)).toHaveValue(name, { timeout: 8_000 });
}

function desktopRename(page) {
  return desktopLayout(page).locator('input[title="Click to rename"]');
}

function projectRowLabel(page, name) {
  return desktopLayout(page).locator('[data-project-id]').filter({ hasText: name }).first();
}

test('Projects rename Escape restores the draft and skips blur persist', async ({ page }) => {
  test.setTimeout(180_000);

  await openHub(page, { url: HUB_DOCS });
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible({ timeout: 15_000 });
  await openHub(page, { url: HUB_TEMPLATES });
  await expect(page.getByRole('button', { name: 'New template', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await openHub(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await assertNoErrorBoundary(page);

  await openHub(page);
  await openDesktopProject(page, TOWER);
  const rename = desktopRename(page);

  // Intended — type a new name + Escape restores; click-away does not persist.
  await rename.click();
  await rename.fill(HUNT);
  await expect(rename).toHaveValue(HUNT);
  await rename.press('Escape');
  await expect(rename).toHaveValue(TOWER);
  await page.locator('body').click({ position: { x: 8, y: 8 } });
  await expect(rename).toHaveValue(TOWER);
  await expect(projectRowLabel(page, TOWER)).toBeVisible();
  await expect(page.getByText(HUNT)).toHaveCount(0);

  // Intended — Enter still commits.
  await rename.click();
  await rename.fill(HUNT);
  await rename.press('Enter');
  await expect(rename).toHaveValue(HUNT);
  await expect(page.getByText(HUNT).first()).toBeVisible();
  await expect(projectRowLabel(page, TOWER)).toHaveCount(0);

  // Break — typed draft + Escape after a committed rename restores the new name.
  await rename.click();
  await rename.fill('Should Not Stick');
  await rename.press('Escape');
  await expect(rename).toHaveValue(HUNT);
  await expect(page.getByText('Should Not Stick')).toHaveCount(0);

  // Break — whitespace + Escape restores (does not blank-commit).
  await rename.click();
  await rename.fill('   ');
  await rename.press('Escape');
  await expect(rename).toHaveValue(HUNT);

  // Break — empty + Escape restores.
  await rename.click();
  await rename.fill('');
  await rename.press('Escape');
  await expect(rename).toHaveValue(HUNT);

  // Break — blur without Escape still commits (catalog-completeness contract).
  await rename.click();
  await rename.fill(LAB);
  await rename.blur();
  await expect(rename).toHaveValue(LAB);
  await expect(page.getByText(LAB).first()).toBeVisible();

  await assertNoErrorBoundary(page);
  console.log('HUB_PROJECTS_RENAME_ESCAPE', JSON.stringify({
    intendedEscapeRestore: true,
    enterCommits: true,
    postCommitEscape: true,
    whitespaceEscape: true,
    emptyEscape: true,
    blurStillCommits: true,
  }));
});

test('Projects rename Escape edge: 390 drill title + empty + testPdf', async ({ page }) => {
  test.setTimeout(180_000);

  await openHub(page, { width: 390, height: 844 });
  const mobileRow = page.locator('.projects-mobile-folder-row[data-project-id="p1"]');
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.click();
  const mobileTitle = page.locator('.projects-mobile-title-input');
  await expect(mobileTitle).toBeVisible({ timeout: 8_000 });
  await expect(mobileTitle).toHaveValue(TOWER);

  await mobileTitle.click();
  await mobileTitle.fill(HUNT);
  await mobileTitle.press('Escape');
  await expect(mobileTitle).toHaveValue(TOWER);
  await expect(page.getByText(HUNT)).toHaveCount(0);

  await mobileTitle.fill(HUNT);
  await mobileTitle.press('Enter');
  await expect(mobileTitle).toHaveValue(HUNT);

  await openHub(page, { url: '/?hubPreview=1&empty=1&tab=projects' });
  await expect(page.getByText('No projects yet').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('input[title="Click to rename"]')).toHaveCount(0);

  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.projects-mobile-title-input').locator('visible=true')).toHaveCount(0);
  await expect(page.locator('input[title="Click to rename"]').locator('visible=true')).toHaveCount(0);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('HUB_PROJECTS_RENAME_ESCAPE_EDGE', JSON.stringify({
    mobile390: true,
    empty: true,
    testPdf: true,
  }));
});
