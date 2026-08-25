import { test, expect } from '@playwright/test';

// Desktop AppShell Export / Draw / Shapes / Text already have visible
// names but omitted type="button" (live type was null). Pan / Select
// are the same reachable toolbar siblings. Mobile RailButton Draw /
// Shapes / Text / More-menu Export are already typed — do not replay
// those as the leftover. History Version history trigger 0 stays parked
// (no file.id; do not stamp one). leftover-18 stays parked.
// Hosted on ?testPdf=clickable-link-test.pdf. Prove the trigger type
// only: still named, type=button does not empty accname or auto-submit
// / export, Draw / Shapes / Text still open their menus.
// Do NOT click Export annotated PDF / Invite / Send / Done / Restore /
// Delete forever / Open file / Share / Upload / Sign out / Delete
// account / Subscription apply / Start trial / Create project / Save /
// Undo / Redo / Pen / Rectangle / Callout apply.

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

function desktopExport(page) {
  return page.getByRole('button', { name: 'Export annotated PDF', exact: true }).first();
}

function desktopDraw(page) {
  return page.locator('[data-tool-toolbar="true"]').getByRole('button', { name: 'Draw', exact: true });
}

function desktopShapes(page) {
  return page.locator('[data-tool-toolbar="true"]').getByRole('button', { name: 'Shapes', exact: true });
}

function desktopText(page) {
  return page.locator('[data-tool-toolbar="true"]').getByRole('button', { name: 'Text', exact: true });
}

function desktopPan(page) {
  return page.locator('[data-tool-toolbar="true"]').getByRole('button', { name: 'Pan', exact: true });
}

function desktopSelect(page) {
  return page.locator('[data-tool-toolbar="true"]').getByRole('button', { name: 'Select', exact: true });
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

async function expectChromeNotImplicit(page) {
  const implicit = await page.evaluate(() => (
    [...document.querySelectorAll('button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  expect(implicit.some((name) => name === 'Export annotated PDF')).toBe(false);
  expect(implicit.some((name) => name === 'Draw')).toBe(false);
  expect(implicit.some((name) => name === 'Shapes')).toBe(false);
  expect(implicit.some((name) => name === 'Text')).toBe(false);
  expect(implicit.some((name) => name === 'Pan')).toBe(false);
  expect(implicit.some((name) => name === 'Select')).toBe(false);
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

test('desktop Export / Draw / Shapes / Text are typed; menus still open', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await desktopExport(page).count(), 'empty hub has no desktop Export').toBe(0);
  expect(await desktopDraw(page).count()).toBe(0);
  expect(await desktopShapes(page).count()).toBe(0);
  expect(await desktopText(page).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(desktopDraw(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');

  const exportBtn = desktopExport(page);
  const draw = desktopDraw(page);
  const shapes = desktopShapes(page);
  const text = desktopText(page);
  const pan = desktopPan(page);
  const select = desktopSelect(page);
  await expectTypedControl(exportBtn, 'Export annotated PDF');
  await expectTypedControl(draw, 'Draw');
  await expectTypedControl(shapes, 'Shapes');
  await expectTypedControl(text, 'Text');
  await expectTypedControl(pan, 'Pan');
  await expectTypedControl(select, 'Select');
  await expectChromeNotImplicit(page);

  await draw.click();
  await expect(page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Pen', exact: true })).toBeVisible({ timeout: 15_000 });
  await expectTypedControl(draw, 'Draw');
  await expectTypedControl(exportBtn, 'Export annotated PDF');

  await shapes.click();
  await expect(page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true })).toBeVisible({ timeout: 15_000 });
  await expectTypedControl(shapes, 'Shapes');
  await expectTypedControl(exportBtn, 'Export annotated PDF');

  await text.click();
  await expect(page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Callout', exact: true })).toBeVisible({ timeout: 15_000 });
  await expectTypedControl(text, 'Text');
  await expectTypedControl(exportBtn, 'Export annotated PDF');
  await expectChromeNotImplicit(page);

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

test('390 + guest + hub break/edge for Export / Draw / Shapes / Text type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await desktopExport(page).count()).toBe(0);
  expect(await desktopDraw(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopExport(page).count()).toBe(0);
  expect(await desktopDraw(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Upload' }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopExport(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopExport(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopExport(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const mobileDraw = page.locator('.mobile-pdf-tools').getByRole('button', { name: 'Draw', exact: true });
  const mobileShapes = page.locator('.mobile-pdf-tools').getByRole('button', { name: 'Shapes', exact: true });
  const mobileText = page.locator('.mobile-pdf-tools').getByRole('button', { name: 'Text', exact: true });
  await expect(mobileDraw).toBeVisible({ timeout: 15_000 });
  await expect(mobileDraw).toHaveAttribute('type', 'button');
  await expect(mobileDraw).toHaveAttribute('aria-label', 'Draw');
  await expect(mobileShapes).toHaveAttribute('type', 'button');
  await expect(mobileShapes).toHaveAttribute('aria-label', 'Shapes');
  await expect(mobileText).toHaveAttribute('type', 'button');
  await expect(mobileText).toHaveAttribute('aria-label', 'Text');
  expect(await desktopExport(page).count()).toBe(0);
  expect(await desktopDraw(page).count()).toBe(0);
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
