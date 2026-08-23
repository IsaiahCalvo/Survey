import { test, expect } from '@playwright/test';

// Keep-mounted hub was still in Tab order under the ?testPdf= viewer.
// First candidate (unnamed editor text + checkbox) is PDF AcroForm
// widgets on clickable-link-test.pdf (name / agree) — not leftover hub
// chrome. Forms editor / X-05 persist stay leftover-18. Unique leftover
// after hub nav type=button: Tab from Draw leaked into Documents /
// Projects / Templates / Archive / Open account menu because the hub
// wrapper had no inert. Product: inert + aria-hidden while viewer is
// visible; Home / Back lift both. Distinct from leftover-18 / X-01 /
// nameless-menu / rail-toggle / dismiss / Home `?` / Home tab click /
// remapped-after-CW / Sync chip / hub Account / hub nav type=button.
// Do not stamp file.id. Do not invent leftover-18 auth/billing panes.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const HUB_EMPTY = '/?hubPreview=1&empty=1';
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

async function keepMountState(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-hub-keep-mount]');
    if (!host) return null;
    return {
      inert: host.hasAttribute('inert') || host.inert === true,
      ariaHidden: host.getAttribute('aria-hidden'),
    };
  });
}

async function tabStopsFrom(page, start, count = 16) {
  await start.focus();
  const stops = [];
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        name: el.getAttribute('aria-label')
          || el.getAttribute('placeholder')
          || (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        inHub: Boolean(el.closest('.survey-hub')),
        inKeepMount: Boolean(el.closest('[data-hub-keep-mount]')),
      };
    }));
  }
  return stops;
}

async function formWidgets(page) {
  return page.evaluate(() => {
    const name = document.querySelector('#pdfjs_internal_id_10R, input[name="name"]');
    const agree = document.querySelector('input[type="checkbox"][name="agree"]');
    return {
      name: name ? {
        inHub: Boolean(name.closest('.survey-hub')),
        type: name.getAttribute('type') || name.type,
      } : null,
      agree: agree ? {
        inHub: Boolean(agree.closest('.survey-hub')),
        type: agree.getAttribute('type') || agree.type,
      } : null,
    };
  });
}

test('desktop keep-mount hub is inert under the viewer; Home lifts it', async ({ page }) => {
  test.setTimeout(120_000);
  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');

  const mounted = await keepMountState(page);
  expect(mounted, 'keep-mount host is present').toBeTruthy();
  expect(mounted.inert, 'viewer keeps hub inert').toBe(true);
  expect(mounted.ariaHidden).toBe('true');

  const widgets = await formWidgets(page);
  expect(widgets.name, 'PDF name field stays a page widget').toBeTruthy();
  expect(widgets.name.inHub).toBe(false);
  expect(widgets.agree, 'PDF agree checkbox stays a page widget').toBeTruthy();
  expect(widgets.agree.inHub).toBe(false);
  expect(widgets.agree.type).toBe('checkbox');

  const fromDraw = await tabStopsFrom(page, page.getByRole('button', { name: 'Draw', exact: true }).first());
  expect(fromDraw.some((row) => row && row.inHub), 'Tab from Draw must not leak into keep-mounted hub').toBe(false);
  expect(fromDraw.some((row) => row && row.inKeepMount)).toBe(false);
  expect(fromDraw.some((row) => row && row.name === 'Documents')).toBe(false);
  expect(fromDraw.some((row) => row && row.name === 'Open account menu')).toBe(false);

  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeHidden({ timeout: 15_000 });
  const afterHome = await keepMountState(page);
  expect(afterHome.inert, 'Home lifts inert').toBe(false);
  expect(afterHome.ariaHidden).toBeNull();
  await expect(page.locator('.documents-desktop-search').getByPlaceholder('Search documents...')).toBeVisible();
  await expect(page.locator('aside.side nav.nav').getByRole('button', { name: 'Documents', exact: true })).toBeVisible();

  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.locator('h1.title')).toHaveText('Projects');
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.locator('h1.title')).toHaveText('Documents');

  await page.locator('[data-pdf-tab-id]').first().click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 20_000 });
  const afterReturn = await keepMountState(page);
  expect(afterReturn.inert, 'PDF tab re-inerts the hub').toBe(true);
  expect(afterReturn.ariaHidden).toBe('true');
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('button', { name: /Syncing|Retry now|Save version|checking whether this document uses live collaboration/i }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + hubPreview break/edge for keep-mount inert', async ({ page }) => {
  test.setTimeout(120_000);
  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  const hubState = await keepMountState(page);
  expect(hubState, 'hubPreview is not AppShell keep-mount').toBeNull();
  await expect(page.locator('.documents-desktop-search').getByPlaceholder('Search documents...')).toBeVisible();
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.locator('h1.title')).toHaveText('Templates');

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await keepMountState(page), 'empty hubPreview is not keep-mount').toBeNull();
  await expect(page.getByText('No documents yet').first()).toBeVisible();

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 });
  const mobile = await keepMountState(page);
  expect(mobile.inert, '390 viewer keeps hub inert').toBe(true);
  expect(mobile.ariaHidden).toBe('true');
  expect(await page.getByRole('button', { name: /Up to date\. Tap to sync now/i }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Connect Microsoft|Sign in with Microsoft/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
});
