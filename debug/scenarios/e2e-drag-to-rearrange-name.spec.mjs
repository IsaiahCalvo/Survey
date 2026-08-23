import { test, expect } from '@playwright/test';

// Share-open project drag handle already had a visible title tooltip, but
// omitted aria-label (accname was title-only). Same a11y name class as
// Click to rename / Search projects, new host (DragRearrangeHandle).
// Do not drag-apply project order. Do not apply rename / Add files /
// New project / Upload / Pin / Lock / Delete / Copy / Send. Share
// Permission / Invite User role / Click to rename stay dedicated.
// Do not stamp file.id.

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

function desktopHandles(page) {
  return page.locator('.projects-desktop-layout [data-drag-rearrange-handle]');
}

function mobileHandles(page) {
  return page.locator('.projects-mobile-folder-row [data-drag-rearrange-handle]');
}

function shareProject(page) {
  return page.getByRole('dialog', { name: 'Share project', exact: true });
}

function desktopProjectRow(page, name) {
  return page.locator('.projects-desktop-layout [data-project-id]').filter({ hasText: name }).first();
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

async function openShareProject(page) {
  await desktopProjectRow(page, PROJECT).getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: `${PROJECT} actions`, exact: true });
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await page.getByRole('menuitem', { name: 'Get link to project', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(shareProject(page)).toBeVisible({ timeout: 10_000 });
}

async function expectNamedHandle(handle) {
  await expect(handle).toBeVisible({ timeout: 8_000 });
  await expect(handle).toHaveAttribute('aria-label', 'Drag to rearrange');
  await expect(handle).toHaveAttribute('title', 'Drag to rearrange');
}

test('Share-open Drag to rearrange is named; drag apply not taken', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 20_000 });

  const handles = desktopHandles(page);
  await expect(handles.first()).toBeVisible({ timeout: 8_000 });
  const namedCount = await handles.count();
  expect(namedCount).toBeGreaterThan(0);
  for (let i = 0; i < namedCount; i += 1) {
    await expectNamedHandle(handles.nth(i));
  }
  await expect(page.getByRole('button', { name: 'Drag to rearrange', exact: true }).first()).toBeVisible();

  const towerHandle = desktopProjectRow(page, PROJECT).locator('[data-drag-rearrange-handle]');
  await expectNamedHandle(towerHandle);

  await openShareProject(page);
  await expectNamedHandle(towerHandle);
  await expect(page.getByRole('combobox', { name: 'Permission', exact: true })).toBeVisible();
  await expect(page.locator('.projects-desktop-layout input[aria-label="Click to rename"]')).toHaveAttribute('aria-label', 'Click to rename');
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count()).toBe(1);

  await page.keyboard.press('Escape');
  await expect(shareProject(page)).toHaveCount(0);
  await expectNamedHandle(towerHandle);
  await expect(page.getByText(PROJECT).first()).toBeVisible();

  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + documents + editor break/edge for Drag to rearrange', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = page.locator('.projects-mobile-folder-row[data-project-id]').filter({ hasText: PROJECT }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  const mobileHandle = mobileRow.locator('[data-drag-rearrange-handle]');
  await expectNamedHandle(mobileHandle);
  await mobileRow.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menu', { name: `${PROJECT} actions`, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Get link to project', exact: true }).click();
  await expect(shareProject(page)).toBeVisible({ timeout: 10_000 });
  await expectNamedHandle(mobileHandle);
  await page.keyboard.press('Escape');
  await expect(shareProject(page)).toHaveCount(0);
  await expectNamedHandle(mobileHandle);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet.').first()).toBeVisible({ timeout: 15_000 });
  expect(await desktopHandles(page).count()).toBe(0);
  expect(await mobileHandles(page).count()).toBe(0);
  expect(await shareProject(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expectNamedHandle(desktopHandles(page).first());
  expect(await page.getByRole('textbox', { name: 'Search projects...', exact: true }).count()).toBeGreaterThan(0);
  expect(await shareProject(page).count()).toBe(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopHandles(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Drag to rearrange', exact: true }).count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Search documents...', exact: true })).toBeVisible();

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopHandles(page).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await desktopHandles(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Drag to rearrange', exact: true }).count()).toBe(0);
  expect(await shareProject(page).count()).toBe(0);
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
  expect(await desktopHandles(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
