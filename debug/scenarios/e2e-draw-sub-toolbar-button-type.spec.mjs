import { test, expect } from '@playwright/test';

// Desktop PDFViewer draw-category sub-toolbar Pen / Highlighter /
// Partial erase already have visible names but omitted
// type="button" (live type was null after Draw arm). Distinct from
// the exhausted Draw *category* type. Mobile RailButton siblings
// are already typed — do not replay those as the leftover. History
// Version history trigger 0 stays parked (no file.id; do not stamp
// one). leftover-18 stays parked. Do not invent a highlighter caret
// series (compile-hidden).
// Hosted on ?testPdf=clickable-link-test.pdf. Prove the trigger type
// only: still named, type=button does not empty accname or auto-create.
// Draw category click is setup only. Click sub-toolbar Pen only to
// prove selecting the typed tool does not mint an annotation.
// Do NOT click Highlighter / Eraser create / Rectangle / Ellipse /
// Line / Arrow / Counter apply / Callout apply / Note / Link / C-01
// swatch / Font color / Bold / Italic / Export annotated PDF /
// Invite / Send / Done / Restore / Delete forever / Open file /
// Share / Upload / Sign out / Delete account / Subscription apply /
// Start trial / Create project / Save / Undo / Redo / Text /
// Callout / Shapes / Version history / Fit options apply / Edit
// zoom percentage.

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
const DRAW_NAMES = ['Pen', 'Highlighter', 'Partial erase'];

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey-hub-tab');
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('lastReviewTool');
      localStorage.removeItem('eraserMode');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function desktopDraw(page) {
  return page.locator('[data-tool-toolbar="true"]').getByRole('button', { name: 'Draw', exact: true });
}

function subDraw(page, name) {
  if (name === 'Partial erase') {
    return page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: /^(Eraser|Partial erase|Full stroke erase)$/ });
  }
  return page.locator('#chrome-sub-toolbar-host').getByRole('button', { name, exact: true });
}

async function expectTypedControl(button, name) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('type', 'button');
  if (name === 'Partial erase') {
    const accname = await button.evaluate((node) => {
      const labelled = node.getAttribute('aria-label')
        || node.getAttribute('title')
        || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      return labelled || '';
    });
    expect(['Partial erase', 'Full stroke erase', 'Eraser']).toContain(accname);
    expect(accname).not.toBe('');
  } else {
    await expect(button).toHaveAttribute('aria-label', name);
    const accname = await button.evaluate((node) => {
      const labelled = node.getAttribute('aria-label')
        || node.getAttribute('title')
        || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      return labelled || '';
    });
    expect(accname).toBe(name);
    expect(accname).not.toBe('');
  }
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function expectDrawNotImplicit(page) {
  const implicit = await page.evaluate(() => (
    [...document.querySelectorAll('#chrome-sub-toolbar-host button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  for (const name of DRAW_NAMES) {
    expect(implicit.some((row) => row === name)).toBe(false);
  }
  expect(implicit.some((row) => row === 'Eraser' || row === 'Full stroke erase')).toBe(false);
}

async function annotationCount(page) {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-svg-annotation-layer="1"]');
    if (!layer) return 0;
    return layer.querySelectorAll('[data-annotation-id], [data-callout-id], text, foreignObject').length;
  });
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

test('desktop Draw sub-toolbar tools are typed after Draw arm; Pen click does not create', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  for (const name of DRAW_NAMES) {
    expect(await subDraw(page, name).count(), `empty hub has no sub-toolbar ${name}`).toBe(0);
  }

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');

  for (const name of DRAW_NAMES) {
    expect(await subDraw(page, name).count(), `idle editor hides sub-toolbar ${name}`).toBe(0);
  }
  expect(await page.locator('[data-highlighter-caret-popup]').count()).toBe(0);
  expect(await page.locator('[data-eraser-caret-popup]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Font color', exact: true }).count()).toBe(0);

  const draw = desktopDraw(page);
  await expect(draw).toBeVisible({ timeout: 8_000 });
  await expect(draw).toHaveAttribute('type', 'button');
  await draw.click();

  const host = page.locator('#chrome-sub-toolbar-host');
  await expect(host).toBeVisible({ timeout: 8_000 });
  await expectTypedControl(subDraw(page, 'Pen'), 'Pen');
  await expectTypedControl(subDraw(page, 'Highlighter'), 'Highlighter');
  await expectTypedControl(subDraw(page, 'Partial erase'), 'Partial erase');
  await expectDrawNotImplicit(page);
  expect(await page.locator('[data-highlighter-caret-popup]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Font color', exact: true }).count()).toBe(0);

  const before = await annotationCount(page);
  await subDraw(page, 'Pen').click();
  await expectTypedControl(subDraw(page, 'Pen'), 'Pen');
  await expectTypedControl(subDraw(page, 'Highlighter'), 'Highlighter');
  await expectTypedControl(subDraw(page, 'Partial erase'), 'Partial erase');
  await expectDrawNotImplicit(page);
  expect(await annotationCount(page), 'typed Pen click does not auto-create').toBe(before);
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  await expect(host).toBeVisible();

  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + guest + hub break/edge for Draw sub-toolbar type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await subDraw(page, 'Pen').count()).toBe(0);
  expect(await subDraw(page, 'Highlighter').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await subDraw(page, 'Pen').count()).toBe(0);
  expect(await subDraw(page, 'Partial erase').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Upload' }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await subDraw(page, 'Highlighter').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await subDraw(page, 'Pen').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await subDraw(page, 'Partial erase').count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await subDraw(page, 'Pen').count()).toBe(0);
  expect(await subDraw(page, 'Highlighter').count()).toBe(0);
  const mobilePen = page.getByRole('button', { name: 'Pen', exact: true }).first();
  if (await mobilePen.count()) {
    await expect(mobilePen).toHaveAttribute('type', 'button');
  }
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
