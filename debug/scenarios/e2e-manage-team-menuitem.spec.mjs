import { test, expect } from '@playwright/test';

// Manage Team member/invite More *actions* expose role=menuitem.
// Unique leftover after Templates Edit modules dialog name (`6f2f2140` /
// `4e7a4a7a`). Live hubPreview Manage Team More opened a nameless <div>
// of <button>s — getByRole('menuitem') was 0 while the menu was open.
// Same a11y class as Home-tab / annotation / Pages / hub Account, but a
// new compile-visible host. Distinct from leftover-18 / X-01 / Activity
// dialog name (A-06 roster adjacent — do not take) / unnamed-dialog
// family already proved / remapped-after-CW / dismiss / rail-toggle.
// Do not invent leftover-18 mint / roster / Stripe. Do not stamp file.id.

const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
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

function teamDialog(page) {
  return page.getByRole('dialog', { name: 'Manage Team', exact: true });
}

function memberMenu(page) {
  return page.getByRole('menu', { name: /actions$/ });
}

async function openDesktopManageTeam(page) {
  await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Manage team', exact: true }).click();
  await expect(teamDialog(page)).toBeVisible({ timeout: 10_000 });
}

async function openFirstMore(page) {
  const more = teamDialog(page).getByRole('button', { name: 'More', exact: true }).first();
  await expect(more).toBeVisible();
  await more.click();
  await expect(memberMenu(page)).toBeVisible();
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

test('desktop Manage Team More actions are named menuitems + Copy email', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('button', { name: 'Manage team', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Copy email', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'View activity', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('button', { name: 'Manage team', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Copy email', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('menuitem', { name: 'Copy email', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Invite user', exact: true }).count()).toBe(0);

  await openDesktopManageTeam(page);
  expect(await page.getByRole('menuitem', { name: 'Copy email', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);

  await openFirstMore(page);
  await expect(page.getByRole('menuitem', { name: 'Invite user', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'View activity', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Change role', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Remove from team', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Extract/i })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Group', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Invite user', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /activity/i })).toHaveCount(0);

  await page.getByRole('menuitem', { name: 'Copy email', exact: true }).click();
  await expect(memberMenu(page)).toHaveCount(0);
  await expect(teamDialog(page)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Invite User', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /activity/i })).toHaveCount(0);

  await openFirstMore(page);
  await page.keyboard.press('Escape');
  await expect(memberMenu(page)).toHaveCount(0);
  await expect(teamDialog(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(0);

  await teamDialog(page).getByRole('button', { name: 'Done', exact: true }).last().click();
  await expect(teamDialog(page)).toHaveCount(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + editor break for Manage Team menuitem chrome', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await page.getByText(TOWER).first().click();
  await page.getByRole('button', { name: 'Manage team', exact: true }).click();
  await expect(teamDialog(page)).toBeVisible({ timeout: 10_000 });
  await openFirstMore(page);
  await expect(page.getByRole('menuitem', { name: 'Invite user', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'View activity', exact: true })).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: /activity/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(memberMenu(page)).toHaveCount(0);
  await teamDialog(page).getByRole('button', { name: 'Done', exact: true }).last().click();
  await expect(teamDialog(page)).toHaveCount(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('dialog', { name: 'Manage Team', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Copy email', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Invite user', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'View activity', exact: true }).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});
