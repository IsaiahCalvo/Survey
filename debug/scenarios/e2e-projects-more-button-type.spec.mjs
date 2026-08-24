import { test, expect } from '@playwright/test';

// Projects More / file-row More triggers already have a visible
// name (`More`) but omitted type="button" (live type was null).
// Hosted on `?hubPreview=1&tab=projects`. Same a11y type class as
// Account Settings Sign out / Invite-open Edit / Documents Close
// preview, new host (ProjectsFolderTree More trigger). Menu name
// is exhausted — do not replay Projects / file-row More name.
// Prove the trigger type only: still named More, still opens the
// menu, Escape / outside dismisses without applying a menuitem.
// Do not click Restore / Delete forever / Open file / Share /
// Upload / Sign out / Delete account / Pin / Lock / Get link.

const HUB = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const TOWER = 'Tower 5 — Security';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
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

function desktopProjectMore(page, name) {
  return page.locator('.projects-desktop-layout [data-project-id]')
    .filter({ hasText: name })
    .getByRole('button', { name: 'More', exact: true });
}

function desktopFileMore(page, name) {
  return page.locator('.projects-desktop-layout [data-document-id]')
    .filter({ hasText: name })
    .getByRole('button', { name: 'More', exact: true });
}

function mobileProjectMore(page, name) {
  return page.locator('.projects-mobile-folder-row[data-project-id], .projects-mobile-layout [data-project-id]')
    .filter({ hasText: name })
    .getByRole('button', { name: 'More', exact: true })
    .first();
}

function towerMenu(page) {
  return page.getByRole('menu', { name: `${TOWER} actions`, exact: true });
}

function ownerMenu(page) {
  return page.getByRole('menu', { name: `${OWNER} actions`, exact: true });
}

async function expectTypedMore(button) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('type', 'button');
  await expect(button).toHaveAttribute('title', 'More');
  const accname = await button.evaluate((node) => {
    const labelled = node.getAttribute('aria-label')
      || node.getAttribute('title')
      || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return labelled || '';
  });
  expect(accname).toBe('More');
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

test('Projects More trigger is typed; menu opens; menuitem apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });

  const projectMore = desktopProjectMore(page, TOWER);
  await expectTypedMore(projectMore);
  expect(await towerMenu(page).count()).toBe(0);

  await projectMore.click();
  await expect(towerMenu(page)).toBeVisible({ timeout: 8_000 });
  await expectTypedMore(projectMore);
  expect(await page.getByRole('menuitem', { name: 'Get link to project', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('menuitem', { name: 'Share', exact: true }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(towerMenu(page)).toHaveCount(0, { timeout: 8_000 });
  await expectTypedMore(projectMore);
  await expect(page.locator('.survey-hub')).toBeVisible();

  const fileMore = desktopFileMore(page, OWNER);
  await expectTypedMore(fileMore);
  await fileMore.click();
  await expect(ownerMenu(page)).toBeVisible({ timeout: 8_000 });
  await expectTypedMore(fileMore);
  expect(await page.getByRole('menuitem', { name: 'Copy', exact: true }).count()).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(ownerMenu(page)).toHaveCount(0, { timeout: 8_000 });
  await expectTypedMore(fileMore);

  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Share project', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Document Access', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + tabs + editor break/edge for Projects More type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 15_000 });
  const mobileMore = mobileProjectMore(page, TOWER);
  await expectTypedMore(mobileMore);
  await mobileMore.click();
  await expect(towerMenu(page)).toBeVisible({ timeout: 8_000 });
  await expectTypedMore(mobileMore);
  await page.keyboard.press('Escape');
  await expect(towerMenu(page)).toHaveCount(0, { timeout: 8_000 });
  await expectTypedMore(mobileMore);
  const desktopKeep = desktopProjectMore(page, TOWER);
  if (await desktopKeep.count() > 0) {
    await expect(desktopKeep.first()).toHaveAttribute('type', 'button');
  }

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.projects-desktop-layout').getByText('No projects yet').first()).toBeVisible();
  expect(await desktopProjectMore(page, TOWER).count()).toBe(0);
  expect(await desktopFileMore(page, OWNER).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'More', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await page.getByRole('textbox', { name: 'Search projects...', exact: true }).count()).toBeGreaterThan(0);
  await expectTypedMore(desktopProjectMore(page, TOWER));
  await expectTypedMore(desktopFileMore(page, OWNER));

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopProjectMore(page, TOWER).count()).toBe(0);
  expect(await desktopFileMore(page, OWNER).count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopProjectMore(page, TOWER).count()).toBe(0);
  expect(await desktopFileMore(page, OWNER).count()).toBe(0);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopProjectMore(page, TOWER).count()).toBe(0);
  expect(await desktopFileMore(page, OWNER).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await desktopProjectMore(page, TOWER).count()).toBe(0);
  expect(await desktopFileMore(page, OWNER).count()).toBe(0);
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
  expect(await desktopProjectMore(page, TOWER).count()).toBe(0);
  expect(await desktopFileMore(page, OWNER).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
