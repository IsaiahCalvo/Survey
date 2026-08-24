import { test, expect } from '@playwright/test';

// Projects desktop Manage team already has a visible name
// (`Manage team`) but omitted type="button" (live type was
// null). Shared 390 Team hosts. Same a11y type class as Add
// files / New project / New template / New module / New
// category / New entity, new host (ProjectsFolderTree Team /
// Manage team). Do not click Manage team apply. Do not click
// Add files / New project / Send / Select apply. Do not stamp
// file.id.

const HUB = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const PROJECT = 'Tower 5 — Security';
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

function desktopManageTeam(page) {
  return page.locator('.projects-desktop-layout').getByRole('button', { name: 'Manage team', exact: true });
}

function namedManageTeam(page) {
  return page.getByRole('button', { name: 'Manage team', exact: true });
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

test('Manage team is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 20_000 });

  const team = desktopManageTeam(page);
  await expect(team).toBeVisible({ timeout: 8_000 });
  await expect(team).toHaveAttribute('type', 'button');
  await expect(namedManageTeam(page).first()).toBeVisible();

  await expect(page.getByRole('button', { name: 'Add files', exact: true }).first()).toHaveAttribute('type', 'button');
  await expect(page.locator('.projects-desktop-create-button')).toHaveAttribute('type', 'button');
  await expect(page.locator('.projects-desktop-layout input[aria-label="Click to rename"]')).toHaveValue(PROJECT);
  expect(await page.getByRole('button', { name: 'Drag to rearrange', exact: true }).count()).toBeGreaterThan(0);

  await team.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  await expect(team).toHaveAttribute('type', 'button');
  await expect(page.getByRole('dialog', { name: 'Manage Team', exact: true })).toHaveCount(0);
  await expect(namedManageTeam(page).first()).toBeVisible();

  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + templates + editor break/edge for Manage team type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopManageTeam(page).count()).toBe(0);
  const mobileProject = page.locator('.projects-mobile-layout [data-project-id], .projects-mobile-row, .projects-mobile-browser [data-project-id]')
    .filter({ hasText: PROJECT }).first();
  await expect(mobileProject).toBeVisible({ timeout: 15_000 });
  await mobileProject.click();
  const mobile = namedManageTeam(page).first();
  await expect(mobile).toBeVisible({ timeout: 10_000 });
  await expect(mobile).toHaveAttribute('type', 'button');
  expect(await page.getByRole('dialog', { name: 'Manage Team', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await desktopManageTeam(page).count()).toBe(0);
  expect(await namedManageTeam(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('textbox', { name: 'Search projects...', exact: true }).count()).toBeGreaterThan(0);
  expect(await desktopManageTeam(page).count()).toBe(0);
  expect(await namedManageTeam(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Add files', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopManageTeam(page).count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopManageTeam(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[title$="· drag to reorder · double-click to rename"]').first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await desktopManageTeam(page).count()).toBe(0);
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
  expect(await desktopManageTeam(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
