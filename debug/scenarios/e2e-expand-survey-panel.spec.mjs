import { test, expect } from '@playwright/test';

// Unique leftover after rail / 390-More Zoom in/out click
// (`64b2241a` / `fc0a99ce`). Last hunt observed right rail **48**
// (`Expand Survey panel`) and deferred it. Left-rail Collapse/Expand
// sidebar is already dedicated on History. This leftover is the
// collapsed right-rail **Expand Survey panel** chevron (48 → 320) +
// Collapse Survey. Distinct from leftover-18 / X-01 / survey Y/N/N-A /
// X-06 writeback / remapped-after-CW / dismiss-family / Zoom buttons /
// Home / Close tab / tool-key / toolbar arm. Do not stamp file.id.
// Do not invent a template seed or checklist Y/N.

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

async function railMetrics(page) {
  return page.evaluate(() => {
    const host = document.getElementById('chrome-right-host');
    if (!host) return { host: 0, panel: 0 };
    const panel = [...host.querySelectorAll('div')].find((el) => {
      const width = el.style && el.style.width;
      return width === '48px' || width === '320px';
    });
    return {
      host: host.offsetWidth,
      panel: panel ? panel.offsetWidth : 0,
    };
  });
}

function expandBtn(page) {
  return page.getByRole('button', { name: 'Expand Survey panel', exact: true });
}

function collapseBtn(page) {
  return page.getByRole('button', { name: 'Collapse Survey panel', exact: true });
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

test('desktop Expand Survey panel intended + break + edge', async ({ page }) => {
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

  // Intended — collapsed 48px rail shows Expand, not Collapse.
  await expect(expandBtn(page), 'collapsed rail Expand Survey must be live').toBeVisible();
  expect(await collapseBtn(page).count(), 'collapsed rail Collapse Survey 0').toBe(0);
  const start = await railMetrics(page);
  expect(start.host, 'chrome-right-host stays 48').toBe(48);
  expect(start.panel, 'collapsed survey panel is 48').toBe(48);

  // Overlay lists no Expand Survey row.
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay does not list Expand Survey').not.toMatch(/Expand Survey/);
  expect(overlayText, 'overlay does not list Collapse Survey').not.toMatch(/Collapse Survey/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  // Intended — Expand click grows the panel to 320 and shows the picker.
  await expandBtn(page).click();
  await expect(collapseBtn(page), 'Expand click must show Collapse Survey').toBeVisible({ timeout: 8_000 });
  expect(await expandBtn(page).count(), 'Expand gone after expand').toBe(0);
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible();
  await expect.poll(async () => (await railMetrics(page)).panel, {
    timeout: 5_000,
    message: 'expanded survey panel is 320',
  }).toBe(320);
  const expanded = await railMetrics(page);
  expect(expanded.host, 'host flex basis stays 48 (panel overlays)').toBe(48);
  expect(expanded.panel, 'expanded survey panel is 320').toBe(320);
  expect(
    await page.getByRole('button', { name: 'Y', exact: true }).count(),
    'Expand must not invent survey Y/N',
  ).toBe(0);

  // Intended — footer stays live (horizontal overlay) after expand.
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeVisible();

  // Intended — Collapse click returns to 48 and hides the picker.
  await collapseBtn(page).click();
  await expect(expandBtn(page), 'Collapse click must restore Expand Survey').toBeVisible({ timeout: 8_000 });
  expect(await collapseBtn(page).count(), 'Collapse gone after collapse').toBe(0);
  expect(await page.getByRole('heading', { name: 'Choose survey template' }).count()).toBe(0);
  await expect.poll(async () => (await railMetrics(page)).panel, {
    timeout: 5_000,
    message: 'collapsed survey panel is 48 again',
  }).toBe(48);
  const collapsedAgain = await railMetrics(page);
  expect(collapsedAgain.panel, 'collapsed survey panel is 48 again').toBe(48);

  // Break — Escape does not collapse after Expand (desktop has no Esc dismiss).
  await expandBtn(page).click();
  await expect(collapseBtn(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(collapseBtn(page), 'Escape must not collapse Survey').toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible();

  // Break — Space stays temporary-pan, does not collapse.
  await page.keyboard.down(' ');
  await expect(collapseBtn(page), 'Space must not collapse Survey').toBeVisible();
  await page.keyboard.up(' ');
  await expect(collapseBtn(page)).toBeVisible();

  // Break — extra Expand click is gone (not a toggle); single Collapse works.
  expect(await expandBtn(page).count(), 'already-expanded Expand 0').toBe(0);
  await collapseBtn(page).click();
  await expect(expandBtn(page)).toBeVisible();

  // Break — double-click Expand stays expanded (Collapse ignores detail>1).
  const expandBox = await expandBtn(page).boundingBox();
  expect(expandBox, 'Expand geometry').toBeTruthy();
  await page.mouse.dblclick(expandBox.x + expandBox.width / 2, expandBox.y + expandBox.height / 2);
  await expect(collapseBtn(page), 'double-click Expand must stay expanded').toBeVisible({ timeout: 8_000 });
  expect(await expandBtn(page).count(), 'double-click Expand must not rebound to collapsed').toBe(0);
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible();
  await collapseBtn(page).click();
  await expect(expandBtn(page)).toBeVisible();

  // Break — hubPreview has no Expand Survey.
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview has no Draw').toBe(0);
  expect(await expandBtn(page).count(), 'hubPreview Expand Survey 0').toBe(0);
  expect(await collapseBtn(page).count(), 'hubPreview Collapse Survey 0').toBe(0);

  // Edge — page-1 rect survives Expand; click invents 0.
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
  await expandBtn(page).click();
  await expect(collapseBtn(page)).toBeVisible();
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive Expand Survey').toEqual(page1Before);

  // Edge — Pen-armed Expand invents 0 and does not start a stroke.
  await collapseBtn(page).click();
  await expect(expandBtn(page)).toBeVisible();
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  await expandBtn(page).click();
  await expect(collapseBtn(page), 'Pen-armed Expand Survey must still expand').toBeVisible();
  expect(await userAnnotationIds(page, 1), 'Pen-armed Expand invents 0').toEqual(marksBeforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge — 120-page: Expand does not change the page number.
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  expect(await currentPageNumber(page)).toBe(1);
  await expandBtn(page).click();
  await expect(collapseBtn(page)).toBeVisible();
  expect(await currentPageNumber(page), 'Expand Survey must not change page').toBe(1);
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('EXPAND_SURVEY_PANEL_DESKTOP_PROOF', JSON.stringify({
    hunt,
    start,
    expanded,
    collapsedAgain,
    overlayListsExpand: /Expand Survey/.test(overlayText),
    rectId,
    viewBox,
    fileId,
  }));
});

test('390 Open survey sheet edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  // 390 uses the dock Open survey sheet, not the 48px desktop chevron.
  expect(await expandBtn(page).count(), '390 Expand Survey 0 until Open survey').toBe(0);
  await expect(page.getByRole('button', { name: 'Open survey', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 8_000 });
  await expect(collapseBtn(page).or(page.getByRole('button', { name: 'Close Survey panel', exact: true })).first()).toBeVisible();
  expect(
    await page.getByRole('button', { name: 'Y', exact: true }).count(),
    '390 Open survey must not invent Y/N',
  ).toBe(0);

  const closer = (await collapseBtn(page).count())
    ? collapseBtn(page)
    : page.getByRole('button', { name: 'Close Survey panel', exact: true });
  await closer.first().click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Open survey', exact: true })).toBeVisible();

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('EXPAND_SURVEY_PANEL_390_PROOF', JSON.stringify({
    viewBox,
    fileId,
  }));
});
