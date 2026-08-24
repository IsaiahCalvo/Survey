import { test, expect } from '@playwright/test';

// Create project dialog Close was title-only `×` (no aria-label;
// getByRole Close was 0; live accname was the glyph). Type was
// already button. Reachable via
// `?hubPreview=1&tab=projects&workflowE2E=1` + New project
// (setup only). Same a11y name class as Rename Close / Archive
// Show documents / Settings Close, new host (CreateProjectModal
// Close). Do NOT click Create / submit a new project.
// Cancel / Escape / Close dismiss is OK. Do not click Restore /
// Delete forever / Open file / Share / Upload / Sign out /
// Delete account / Select apply. Do not replay Confirm
// Cancel/Confirm type, Rename Close name, or Rename Cancel/Save
// type.

const HUB = '/?hubPreview=1&tab=projects&workflowE2E=1';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects&workflowE2E=1';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects&workflowE2E=1';
const HUB_NO_WORKFLOW = '/?hubPreview=1&tab=projects';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const TOWER = 'Tower 5 — Security';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey-hub-tab');
      localStorage.removeItem('survey_document_history_events_v1');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function createDialog(page) {
  return page.getByRole('dialog', { name: 'Create project', exact: true });
}

function createClose(page) {
  return createDialog(page).getByRole('button', { name: 'Close', exact: true });
}

function createSubmit(page) {
  return createDialog(page).getByRole('button', { name: 'Create project', exact: true });
}

function createCancel(page) {
  return createDialog(page).getByRole('button', { name: 'Cancel', exact: true });
}

async function openCreateProject(page) {
  const trigger = page.getByRole('button', { name: 'New project', exact: true }).locator('visible=true').first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await page.getByRole('button', { name: 'New project', exact: true }).locator('visible=true').first().click();
  await expect(createDialog(page)).toBeVisible({ timeout: 8_000 });
}

async function expectNamedClose(button) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('aria-label', 'Close');
  await expect(button).toHaveAttribute('title', 'Close');
  await expect(button).toHaveAttribute('type', 'button');
  const accname = await button.evaluate((node) => {
    const labelled = node.getAttribute('aria-label')
      || node.getAttribute('title')
      || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return labelled || '';
  });
  expect(accname).toBe('Close');
  expect(accname).not.toBe('');
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

async function hiddenCounts(page) {
  const counts = {};
  for (const name of HIDDEN) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

test('Create project Close is named; Create apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });

  expect(await createDialog(page).count()).toBe(0);
  await openCreateProject(page);
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('');

  await expectNamedClose(createClose(page));
  expect(await createSubmit(page).count()).toBe(1);
  await expect(createSubmit(page)).toBeDisabled();
  expect(await createCancel(page).count()).toBe(1);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await createClose(page).click();
  await expect(createDialog(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(page.getByText(TOWER).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + tabs + editor break/edge for Create project Close name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.projects-mobile-create-button').first()).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('.projects-desktop-create-button').filter({ visible: true }).count()).toBe(0);
  await openCreateProject(page);
  await expectNamedClose(createClose(page));
  await page.keyboard.press('Escape');
  await expect(createDialog(page)).toHaveCount(0, { timeout: 8_000 });
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await createDialog(page).count()).toBe(0);
  await openCreateProject(page);
  await expectNamedClose(createClose(page));
  await createCancel(page).click();
  await expect(createDialog(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(page.getByText('No projects yet').first()).toBeVisible();

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await page.getByRole('textbox', { name: 'Search projects...', exact: true }).count()).toBeGreaterThan(0);
  await openCreateProject(page);
  await expectNamedClose(createClose(page));
  await page.keyboard.press('Escape');
  await expect(createDialog(page)).toHaveCount(0, { timeout: 8_000 });

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await openCreateProject(page);
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('E2E must not create');
  await expectNamedClose(createClose(page));
  await expect(createSubmit(page)).toBeEnabled();
  await createCancel(page).click();
  await expect(createDialog(page)).toHaveCount(0, { timeout: 8_000 });
  expect(await page.getByText('E2E must not create').count()).toBe(0);
  await expect(page.getByText(TOWER).first()).toBeVisible();

  await openPage(page, { url: HUB_NO_WORKFLOW });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await createDialog(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await createDialog(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await createDialog(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await createDialog(page).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await createDialog(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
