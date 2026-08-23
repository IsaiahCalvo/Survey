import { test, expect } from '@playwright/test';

// Hub primary nav (Documents / Projects / Templates / Archive) was missing
// type="button". Unique leftover after ?testPdf= Sync chip hide (`725f28d7`).
// Last hunt collected `.survey-hub .nav` / `.mobile-home-tabs` types as null
// while MobileRailNav already had type="button". Implicit submit default is
// the same hygiene class as Spaces-rail / Expand Survey / Bookmarks Add —
// this leftover is hub primary nav, not those families.
// Distinct from leftover-18 / X-01 / nameless-menu / rail-toggle / dismiss /
// Home `?` / remapped-after-CW / Sync chip / hub Account menuitem.
// Keep-mounted unnamed Search/select is NOT this leftover.
// Do not stamp file.id. Do not invent leftover-18 auth/billing panes.

const HUB = '/?hubPreview=1';
const HUB_TABS = '/?hubPreview=1&mobileNav=tabs';
const HUB_EMPTY = '/?hubPreview=1&empty=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
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

function desktopNav(page) {
  return page.locator('aside.side nav.nav, aside.side nav.nav-bottom');
}

function desktopNavButton(page, name) {
  return desktopNav(page).getByRole('button', { name, exact: true });
}

async function navTypes(page, selector) {
  return page.evaluate((sel) => (
    [...document.querySelectorAll(sel)]
      .filter((node) => {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((node) => ({
        name: (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim(),
        type: node.getAttribute('type'),
      }))
  ), selector);
}

test('desktop hub nav is type=button + switches Documents/Projects/Templates/Archive', async ({ page }) => {
  test.setTimeout(120_000);
  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('h1.title')).toHaveText('Documents');

  const types = await navTypes(page, '.survey-hub aside.side nav button');
  expect(types.map((row) => row.name).sort()).toEqual(['Archive', 'Documents', 'Projects', 'Templates']);
  expect(types.every((row) => row.type === 'button')).toBe(true);

  await desktopNavButton(page, 'Projects').click();
  await expect(page.locator('h1.title')).toHaveText('Projects');
  await expect(page.getByRole('button', { name: /New project|Create project/i }).first()).toBeVisible();
  await expect(page.getByText('Tower 5 — Security').first()).toBeVisible();

  await desktopNavButton(page, 'Templates').click();
  await expect(page.locator('h1.title')).toHaveText('Templates');
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible();

  await desktopNavButton(page, 'Archive').click();
  await expect(page.locator('h1.title')).toHaveText('Archive');
  await expect(page.locator('.archive-desktop-search').getByPlaceholder('Search archive...')).toBeVisible();

  await desktopNavButton(page, 'Documents').click();
  await expect(page.locator('h1.title')).toHaveText('Documents');
  await expect(page.locator('.documents-desktop-search').getByPlaceholder('Search documents...')).toBeVisible();
  await expect(page.getByText('SE-011 Security Shop Drawings.pdf').filter({ visible: true }).first()).toBeVisible();

  await desktopNavButton(page, 'Projects').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('h1.title')).toHaveText('Projects');

  await desktopNavButton(page, 'Documents').dblclick();
  await expect(page.locator('h1.title')).toHaveText('Documents');
  await expect(page.getByText('SE-011 Security Shop Drawings.pdf').filter({ visible: true }).first()).toBeVisible();

  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Connect Microsoft|Sign in with Microsoft/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 Home sections + editor break for hub nav type=button', async ({ page }) => {
  test.setTimeout(120_000);
  await openPage(page, { width: 390, height: 844, url: HUB_TABS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('navigation', { name: 'Home sections' })).toBeVisible();

  const tabTypes = await navTypes(page, '.survey-hub .mobile-home-tabs button');
  expect(tabTypes.map((row) => row.name).sort()).toEqual(['Documents', 'Projects', 'Templates']);
  expect(tabTypes.every((row) => row.type === 'button')).toBe(true);
  expect(await page.getByRole('button', { name: 'Archive', exact: true }).count()).toBe(0);

  await page.locator('.mobile-home-tabs').getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.locator('h1.title')).toHaveText('Templates');
  await expect(page.getByRole('button', { name: /Security Walk-Through/ }).first()).toBeVisible();

  await page.locator('.mobile-home-tabs').getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.locator('h1.title')).toHaveText('Documents');

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
  const openNavType = await page.getByRole('button', { name: 'Open navigation', exact: true }).getAttribute('type');
  expect(openNavType).toBe('button');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const railTypes = await navTypes(page, '.survey-hub .mobile-rail-nav-options button');
  expect(railTypes.every((row) => row.type === 'button')).toBe(true);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const emptyTypes = await navTypes(page, '.survey-hub aside.side nav button');
  expect(emptyTypes.every((row) => row.type === 'button')).toBe(true);
  await expect(page.getByText('No documents yet').first()).toBeVisible();

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(await page.getByRole('button', { name: /Syncing|Retry now|Save version|checking whether this document uses live collaboration/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('navigation', { name: 'Home sections' }).count()).toBe(0);
});
