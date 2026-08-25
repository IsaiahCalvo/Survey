import { test, expect } from '@playwright/test';

// Desktop AppShell Zoom in / Zoom out / Previous page / Next page already
// have visible names but omitted type="button" (live type was null).
// Collapsed + expanded right-rail footer siblings are the same family.
// Mobile header Previous/Next and More-menu Zoom in/out are already
// typed — do not replay those as the leftover. History Version history
// trigger 0 stays parked (no file.id; do not stamp one). leftover-18
// stays parked. Hosted on ?testPdf=clickable-link-test.pdf. Prove the
// trigger type only: still named, type=button does not empty accname
// or auto-submit, one Zoom in click still scales via the existing
// pdf.js / zoomGeneration path (SVG viewBox stays page-sized).
// Zoom / Prev / Next *behavior* catalogs are already exhausted — the
// click is only the type-edge, not a new leftover.
// Do NOT click Export annotated PDF / Invite / Send / Done / Restore /
// Delete forever / Open file / Share / Upload / Sign out / Delete
// account / Subscription apply / Start trial / Create project / Save /
// Undo / Redo / Pen / Rectangle / Callout apply / Version history /
// Edit zoom percentage / Fit options apply.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
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

function rightRail(page) {
  return page.locator('#chrome-right-host');
}

function desktopZoomIn(page) {
  return rightRail(page).getByRole('button', { name: 'Zoom in', exact: true });
}

function desktopZoomOut(page) {
  return rightRail(page).getByRole('button', { name: 'Zoom out', exact: true });
}

function desktopPrev(page) {
  return rightRail(page).getByRole('button', { name: 'Previous page', exact: true });
}

function desktopNext(page) {
  return rightRail(page).getByRole('button', { name: 'Next page', exact: true });
}

async function zoomPercent(page) {
  const label = rightRail(page).getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (await label.count()) {
    return Number.parseInt((await label.innerText()).trim(), 10);
  }
  return null;
}

async function expectTypedControl(button, name) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('type', 'button');
  await expect(button).toHaveAttribute('aria-label', name);
  const accname = await button.evaluate((node) => {
    const labelled = node.getAttribute('aria-label')
      || node.getAttribute('title')
      || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return labelled || '';
  });
  expect(accname).toBe(name);
  expect(accname).not.toBe('');
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function expectFooterNotImplicit(page) {
  const implicit = await page.evaluate(() => (
    [...document.querySelectorAll('#chrome-right-host button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  expect(implicit.some((name) => name === 'Zoom in')).toBe(false);
  expect(implicit.some((name) => name === 'Zoom out')).toBe(false);
  expect(implicit.some((name) => name === 'Previous page')).toBe(false);
  expect(implicit.some((name) => name === 'Next page')).toBe(false);
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

test('desktop Zoom in / Zoom out / Previous page / Next page are typed; Zoom in still scales', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await desktopZoomIn(page).count(), 'empty hub has no desktop Zoom in').toBe(0);
  expect(await desktopZoomOut(page).count()).toBe(0);
  expect(await desktopPrev(page).count()).toBe(0);
  expect(await desktopNext(page).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');

  const zoomIn = desktopZoomIn(page);
  const zoomOut = desktopZoomOut(page);
  const prev = desktopPrev(page);
  const next = desktopNext(page);
  await expectTypedControl(zoomIn, 'Zoom in');
  await expectTypedControl(zoomOut, 'Zoom out');
  await expectTypedControl(prev, 'Previous page');
  await expectTypedControl(next, 'Next page');
  await expectFooterNotImplicit(page);

  const startPct = await zoomPercent(page);
  expect(Number.isFinite(startPct), 'starting zoom %').toBeTruthy();
  await zoomIn.click();
  await expect.poll(async () => zoomPercent(page), {
    timeout: 20_000,
    message: 'Zoom in click must raise zoom % via existing pdf.js path',
  }).toBeGreaterThan(startPct);
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  await expectTypedControl(zoomIn, 'Zoom in');
  await expectTypedControl(zoomOut, 'Zoom out');
  await expectTypedControl(prev, 'Previous page');
  await expectTypedControl(next, 'Next page');
  await expectFooterNotImplicit(page);

  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + guest + hub break/edge for Zoom / page-nav type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await desktopZoomIn(page).count()).toBe(0);
  expect(await desktopPrev(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopZoomIn(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Upload' }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopZoomIn(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopZoomIn(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopZoomIn(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const mobilePrev = page.locator('.mobile-pdf-header__pages').getByRole('button', { name: 'Previous page', exact: true });
  const mobileNext = page.locator('.mobile-pdf-header__pages').getByRole('button', { name: 'Next page', exact: true });
  await expect(mobilePrev).toBeVisible({ timeout: 15_000 });
  await expect(mobilePrev).toHaveAttribute('type', 'button');
  await expect(mobilePrev).toHaveAttribute('aria-label', 'Previous page');
  await expect(mobileNext).toHaveAttribute('type', 'button');
  await expect(mobileNext).toHaveAttribute('aria-label', 'Next page');
  expect(await desktopZoomIn(page).count()).toBe(0);
  expect(await desktopZoomOut(page).count()).toBe(0);
  expect(await desktopPrev(page).count()).toBe(0);
  expect(await desktopNext(page).count()).toBe(0);
  const mobileHistory = page.getByRole('button', { name: 'Version history', exact: true });
  if (await mobileHistory.count()) {
    await expect(mobileHistory.first()).toBeDisabled();
  }
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.locator('[data-hub-keep-mount]').evaluate((host) => (
    host.hasAttribute('inert') || host.inert === true
  ))).toBe(true);
  expect(await fileId(page)).toBeNull();
});
