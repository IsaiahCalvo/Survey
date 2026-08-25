import { test, expect } from '@playwright/test';

// Desktop AppShell Undo / Redo already have visible names but omitted
// type="button" (live type was null). Mobile header Undo / Redo are
// already typed — do not replay those. History Version history trigger
// 0 stays parked (no file.id; do not stamp one). leftover-18 stays parked.
// Hosted on ?testPdf=clickable-link-test.pdf. Prove the trigger type only:
// still named Undo / Redo, type=button does not empty accname or
// auto-submit a form, Undo still undoes a just-drawn rectangle.
// Do NOT click Export / Share / Upload / Sign out / Delete account /
// Invite / Send / Done / Restore / Delete forever / Open file /
// Subscription apply / Start trial / Create project / Save.

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

function desktopUndo(page) {
  return page.locator('[data-undo-redo-controls="true"]').getByRole('button', { name: 'Undo', exact: true });
}

function desktopRedo(page) {
  return page.locator('[data-undo-redo-controls="true"]').getByRole('button', { name: 'Redo', exact: true });
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

async function expectUndoRedoNotImplicit(page) {
  const implicit = await page.evaluate(() => (
    [...document.querySelectorAll('[data-undo-redo-controls="true"] button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  expect(implicit.some((name) => name === 'Undo')).toBe(false);
  expect(implicit.some((name) => name === 'Redo')).toBe(false);
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

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function dragOnPage(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
}

async function armRectangle(page) {
  const rectangle = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true });
  if (!(await rectangle.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  }
  await expect(rectangle).toBeVisible({ timeout: 15_000 });
  const pressed = await rectangle.getAttribute('aria-pressed');
  const cls = String(await rectangle.getAttribute('class') || '');
  const active = cls.includes('is-active') || cls.includes('btn-active');
  if (pressed !== 'true' && !active) {
    await rectangle.click();
  }
  await expect(rectangle).toHaveClass(/btn-active|is-active/);
}

test('desktop Undo / Redo are typed; Undo still undoes a rectangle', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await desktopUndo(page).count(), 'empty hub has no desktop Undo cluster').toBe(0);
  expect(await desktopRedo(page).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');

  const undo = desktopUndo(page);
  const redo = desktopRedo(page);
  await expectTypedControl(undo, 'Undo');
  await expectTypedControl(redo, 'Redo');
  await expectUndoRedoNotImplicit(page);
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  const annoCount = () => page.evaluate(() => (
    document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]').length
  ));
  const baseline = await annoCount();
  await armRectangle(page);
  await dragOnPage(page, { x0: 0.22, y0: 0.28, x1: 0.40, y1: 0.46 });
  await expect.poll(annoCount, { timeout: 15_000 }).toBeGreaterThan(baseline);
  await expect(undo).toBeEnabled();
  await expectTypedControl(undo, 'Undo');

  await undo.click();
  await expect.poll(annoCount, { timeout: 10_000 }).toBe(baseline);
  await expect(redo).toBeEnabled();
  await expectTypedControl(redo, 'Redo');

  await redo.click();
  await expect.poll(annoCount, { timeout: 10_000 }).toBeGreaterThan(baseline);
  await expectTypedControl(undo, 'Undo');
  await expectTypedControl(redo, 'Redo');
  await expectUndoRedoNotImplicit(page);

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

test('390 + guest + hub break/edge for Undo / Redo type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await desktopUndo(page).count()).toBe(0);
  expect(await desktopRedo(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopUndo(page).count()).toBe(0);
  expect(await desktopRedo(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Upload' }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopUndo(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopUndo(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopUndo(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const mobileUndo = page.locator('.mobile-pdf-header__history').getByRole('button', { name: 'Undo', exact: true });
  const mobileRedo = page.locator('.mobile-pdf-header__history').getByRole('button', { name: 'Redo', exact: true });
  await expect(mobileUndo).toBeVisible({ timeout: 15_000 });
  await expect(mobileUndo).toHaveAttribute('type', 'button');
  await expect(mobileUndo).toHaveAttribute('aria-label', 'Undo');
  await expect(mobileRedo).toHaveAttribute('type', 'button');
  await expect(mobileRedo).toHaveAttribute('aria-label', 'Redo');
  expect(await desktopUndo(page).count()).toBe(0);
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
