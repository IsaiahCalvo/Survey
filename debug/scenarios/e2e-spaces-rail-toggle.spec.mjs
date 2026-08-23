import { test, expect } from '@playwright/test';

// Unique leftover after Expand Survey panel (`8f8ee007` / `ae2016a4`).
// Last hunt counted left-rail Spaces and deferred it. Expand Survey and
// left-rail History Collapse/Expand sidebar stay dedicated. This leftover
// is the collapsed 48px left-rail Spaces tab (48 → 272 Spaces panel) +
// 390 Open spaces. Distinct from leftover-18 / X-01 / Space CSV / PDF
// Pages / survey Y/N/N-A / remapped-after-CW / dismiss-family / Expand
// Survey / Spaces card Expand / Survey/Spaces menu dismiss / Home /
// Close tab / tool-key / toolbar arm. Do not stamp file.id.
// Do not invent a space seed or leftover-18 export.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1400, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
          || key.startsWith('spaces_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (url.includes('hubPreview=1')) {
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    return;
  }
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function currentPageNumber(page) {
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  if (await input.count()) return Number.parseInt(await input.inputValue(), 10);
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) return Number.parseInt((await btn.innerText()).trim(), 10);
  const jump = page.getByRole('button', { name: 'Jump to page', exact: true });
  if (await jump.count()) {
    const raw = (await jump.innerText()).trim();
    return Number.parseInt(raw, 10);
  }
  const mobileInput = page.getByRole('textbox', { name: 'Page number', exact: true });
  if (await mobileInput.count()) return Number.parseInt(await mobileInput.inputValue(), 10);
  return null;
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/i.test(String(id || ''));
    });
  }, pageNumber);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function leftRailMetrics(page) {
  return page.evaluate(() => {
    const host = document.getElementById('chrome-left-host');
    if (!host) return { host: 0, panel: 0 };
    const panel = [...host.querySelectorAll('div')].find((el) => {
      const width = el.style && el.style.width;
      return width === '48px' || width === '272px';
    });
    return {
      host: host.offsetWidth,
      panel: panel ? panel.offsetWidth : 0,
    };
  });
}

function spacesBtn(page) {
  return page.getByRole('button', { name: 'Spaces', exact: true });
}

function collapseSidebarBtn(page) {
  return page.getByRole('button', { name: 'Collapse sidebar', exact: true });
}

function expandSidebarBtn(page) {
  return page.getByRole('button', { name: 'Expand sidebar', exact: true });
}

async function hiddenCounts(page) {
  const names = [
    'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
    'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
    'Marquee zoom', 'Layers', 'Attachments',
  ];
  const counts = {};
  for (const name of names) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if ((await sub.first().getAttribute('aria-pressed')) !== 'true') await sub.first().click();
    return;
  }
  const visible = page.getByRole('button', { name: toolName, exact: true });
  if (await visible.count() && await visible.first().isVisible().catch(() => false)) {
    if ((await visible.first().getAttribute('aria-pressed')) !== 'true') await visible.first().click();
    return;
  }
  await page.getByRole('button', { name: categoryName, exact: true }).first().click();
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

async function waitForSpacesPanel(page) {
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(/No spaces yet/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeVisible();
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'expanded Spaces panel is 272',
  }).toBe(272);
  const metrics = await leftRailMetrics(page);
  expect(metrics.host, 'left host flex stays 48 (panel overlays)').toBe(48);
  expect(metrics.panel, 'expanded Spaces panel is 272').toBe(272);
}

test('desktop Spaces rail toggle intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const hunt = await hiddenCounts(page);
  const fileIdHunt = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileIdHunt, 'file.id must stay null on ?testPdf=').toBeNull();
  expect(hunt['Match case'], 'Search Match case compile-hidden').toBe(0);
  expect(hunt.Forms, 'Forms toolbar compile-hidden').toBe(0);
  expect(hunt.Note, 'Note create compile-hidden').toBe(0);
  expect(hunt.Print, 'Print compile-hidden').toBe(0);
  expect(hunt.Measure, 'Measure compile-hidden').toBe(0);
  expect(hunt.Group, 'Group compile-hidden').toBe(0);

  // Intended — collapsed 48px left rail shows Spaces, not the Spaces panel.
  await expect(spacesBtn(page), 'collapsed rail Spaces must be live').toBeVisible();
  expect(await page.getByText(/No spaces yet/i).count(), 'collapsed rail Spaces panel 0').toBe(0);
  const start = await leftRailMetrics(page);
  expect(start.host, 'chrome-left-host stays 48').toBe(48);
  expect(start.panel, 'collapsed left rail is 48').toBe(48);
  await expect(expandSidebarBtn(page), 'collapsed rail Expand sidebar lives (History-dedicated, not this leftover)').toBeVisible();
  expect(await collapseSidebarBtn(page).count(), 'collapsed rail Collapse sidebar 0').toBe(0);

  // Contrast — Expand sidebar opens Pages, not Spaces.
  await expandSidebarBtn(page).click();
  await expect(collapseSidebarBtn(page)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'Expand sidebar grows panel to 272',
  }).toBe(272);
  await expect(page.getByText(/No spaces yet/i), 'Expand sidebar must not open Spaces').toBeHidden();
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true }), 'Expand sidebar must not show Spaces heading').toBeHidden();
  await collapseSidebarBtn(page).click();
  await expect(expandSidebarBtn(page)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'Collapse sidebar restores panel 48',
  }).toBe(48);

  // Overlay lists B for sidebar, not a Spaces chord.
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists B Toggle sidebar').toMatch(/Toggle sidebar/);
  expect(overlayText, 'overlay does not list a Spaces chord').not.toMatch(/Open spaces|Expand Spaces|Spaces panel/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  // Intended — Spaces click grows the left rail to 272 and shows the empty panel.
  await spacesBtn(page).click();
  await waitForSpacesPanel(page);
  expect(await expandSidebarBtn(page).count(), 'Expand sidebar gone after Spaces').toBe(0);
  expect(
    await page.getByRole('button', { name: 'Y', exact: true }).count(),
    'Spaces must not invent survey Y/N',
  ).toBe(0);
  expect(
    await page.getByRole('button', { name: /CSV|PDF Pages/ }).count(),
    'empty Spaces must not invent leftover-18 export apply',
  ).toBe(0);

  // Intended — footer stays live after Spaces expand.
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeVisible();

  // Intended — Collapse sidebar (not this leftover) restores the 48px Spaces icon.
  await collapseSidebarBtn(page).click();
  await expect(spacesBtn(page), 'Collapse sidebar must restore Spaces icon').toBeVisible({ timeout: 8_000 });
  expect(await page.getByText(/No spaces yet/i).count(), 'Spaces panel hidden after collapse').toBe(0);
  await expect.poll(async () => (await leftRailMetrics(page)).panel, {
    timeout: 5_000,
    message: 'collapsed left rail is 48 again',
  }).toBe(48);

  // Break — Escape does not collapse after Spaces (desktop has no Esc dismiss).
  await spacesBtn(page).click();
  await waitForSpacesPanel(page);
  await page.keyboard.press('Escape');
  await expect(page.getByText(/No spaces yet/i), 'Escape must not collapse Spaces').toBeVisible();
  await expect(collapseSidebarBtn(page)).toBeVisible();

  // Break — Space stays temporary-pan, does not collapse.
  await page.keyboard.down(' ');
  await expect(page.getByText(/No spaces yet/i), 'Space must not collapse Spaces').toBeVisible();
  await page.keyboard.up(' ');
  await expect(page.getByText(/No spaces yet/i)).toBeVisible();

  // Break — already-open Spaces tab click stays on Spaces (not a toggle-close).
  await spacesBtn(page).click();
  await expect(page.getByText(/No spaces yet/i), 're-click Spaces must stay open').toBeVisible();
  expect((await leftRailMetrics(page)).panel, 're-click Spaces keeps panel 272').toBe(272);
  expect((await leftRailMetrics(page)).host, 're-click Spaces keeps host 48').toBe(48);

  await collapseSidebarBtn(page).click();
  await expect(spacesBtn(page)).toBeVisible();

  // Break — double-click Spaces stays expanded and invents 0 spaces.
  const spacesBox = await spacesBtn(page).boundingBox();
  expect(spacesBox, 'Spaces geometry').toBeTruthy();
  await page.mouse.dblclick(spacesBox.x + spacesBox.width / 2, spacesBox.y + spacesBox.height / 2);
  await expect(page.getByText(/No spaces yet/i), 'double-click Spaces must stay expanded').toBeVisible({ timeout: 8_000 });
  expect(await page.getByRole('button', { name: /Rename / }).count(), 'double-click Spaces invents 0 cards').toBe(0);
  expect(await expandSidebarBtn(page).count(), 'double-click Spaces must not rebound to collapsed').toBe(0);

  await collapseSidebarBtn(page).click();
  await expect(spacesBtn(page)).toBeVisible();

  // Break — hubPreview has no viewer Spaces panel.
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview has no Draw').toBe(0);
  expect(await page.getByText(/No spaces yet/i).count(), 'hubPreview viewer Spaces panel 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Create space', exact: true }).count(), 'hubPreview Create space 0').toBe(0);

  // Edge — page-1 rect survives Spaces; click invents 0.
  await openEditor(page);
  await blurInputs(page);
  await activateTool(page, 'Shapes', 'Rectangle');
  const box = await pageBox(page, 1);
  const beforeRect = new Set(await userAnnotationIds(page, 1));
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.28);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.46, { steps: 8 });
  await page.mouse.up();
  let rectId = null;
  await expect.poll(async () => {
    const ids = await userAnnotationIds(page, 1);
    rectId = ids.find((id) => !beforeRect.has(id)) || null;
    return rectId;
  }, { message: 'expected a new rect on page 1' }).not.toBeNull();
  await blurInputs(page);
  const page1Before = await userAnnotationIds(page, 1);
  await spacesBtn(page).click();
  await waitForSpacesPanel(page);
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive Spaces').toEqual(page1Before);

  // Edge — Pen-armed Spaces invents 0 and does not start a stroke.
  await collapseSidebarBtn(page).click();
  await expect(spacesBtn(page)).toBeVisible();
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  await spacesBtn(page).click();
  await expect(page.getByText(/No spaces yet/i), 'Pen-armed Spaces must still expand').toBeVisible();
  expect(await userAnnotationIds(page, 1), 'Pen-armed Spaces invents 0').toEqual(marksBeforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge — 120-page: Spaces does not change the page number.
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  expect(await currentPageNumber(page)).toBe(1);
  await spacesBtn(page).click();
  await waitForSpacesPanel(page);
  expect(await currentPageNumber(page), 'Spaces must not change page').toBe(1);
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('SPACES_RAIL_TOGGLE_DESKTOP_PROOF', JSON.stringify({
    hunt,
    start,
    overlayListsSpacesChord: /Open spaces|Expand Spaces|Spaces panel/.test(overlayText),
    rectId,
    viewBox,
    fileId,
  }));
});

test('390 Open spaces sheet edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  // 390 uses the dock Open spaces sheet, not the 48px desktop Spaces icon.
  expect(await page.getByText(/No spaces yet/i).count(), '390 Spaces panel 0 until Open spaces').toBe(0);
  await expect(page.getByRole('button', { name: 'Open spaces', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open spaces', exact: true }).click();
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeVisible();
  expect(
    await page.getByRole('button', { name: 'Y', exact: true }).count(),
    '390 Open spaces must not invent Y/N',
  ).toBe(0);

  const closer = page.getByRole('button', { name: 'Exit Spaces / Regions', exact: true })
    .or(page.getByRole('button', { name: 'Close document panel', exact: true }));
  await closer.first().click();
  await expect(page.getByText(/No spaces yet/i)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Open spaces', exact: true })).toBeVisible();

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('SPACES_RAIL_TOGGLE_390_PROOF', JSON.stringify({
    viewBox,
    fileId,
  }));
});
