import { test, expect } from '@playwright/test';

// Unique leftover after official exclusive-layer pointerdown align
// (`cfde5d64` / `117b0f1d`). V-04 keyboard is Ctrl++/−
// (`e2e-zoom-keyboard-fit-width`). UL-06 is the Zoom % field.
// Ctrl+wheel / Fit page / Fit height / Ctrl+2 / Ctrl+M already dedicated.
// This leftover is rail / 390-More **click** Zoom in / Zoom out.
// Distinct from leftover-18 / X-01 / remapped-after-CW / dismiss-family /
// Home / Close tab / tool-key / toolbar arm. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1400, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
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

async function zoomPercent(page) {
  const label = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (await label.count()) {
    return Number.parseInt((await label.innerText()).trim(), 10);
  }
  const input = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  if (await input.count()) {
    return Number.parseInt(await input.inputValue(), 10);
  }
  return null;
}

async function pageMetrics(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const pageDiv = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${pageNum}"]`);
    const wrapper = document.querySelector('.survey-pdfjs-viewer');
    if (!pageDiv || !wrapper) return null;
    return {
      pageW: pageDiv.offsetWidth,
      pageH: pageDiv.offsetHeight,
      wrapW: wrapper.clientWidth,
      wrapH: wrapper.clientHeight,
    };
  }, pageNumber);
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

async function createRectOnPage(page, pageNumber = 1) {
  const before = new Set(await userAnnotationIds(page, pageNumber));
  await activateTool(page, 'Shapes', 'Rectangle');
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.28);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.46, { steps: 8 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const ids = await userAnnotationIds(page, pageNumber);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: `expected a new rect on page ${pageNumber}` }).not.toBeNull();
  return created;
}

async function selectDesktopFit(page, name) {
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function focusZoomInput(page) {
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (!(await zoomBtn.count())) return null;
  await zoomBtn.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeVisible();
  await zoomInput.click();
  return zoomInput;
}

async function setZoomPercent(page, value) {
  const zoomInput = await focusZoomInput(page);
  expect(zoomInput, 'zoom % field').toBeTruthy();
  await zoomInput.fill(String(value));
  await zoomInput.press('Enter');
  await blurInputs(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: `zoom % must become ${value}`,
  }).toBe(value);
}

function zoomInBtn(page) {
  return page.getByRole('button', { name: 'Zoom in', exact: true }).first();
}

function zoomOutBtn(page) {
  return page.getByRole('button', { name: 'Zoom out', exact: true }).first();
}

async function clickZoomIn(page) {
  await blurInputs(page);
  await expect(zoomInBtn(page)).toBeVisible();
  await zoomInBtn(page).click();
}

async function clickZoomOut(page) {
  await blurInputs(page);
  await expect(zoomOutBtn(page)).toBeVisible();
  await zoomOutBtn(page).click();
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

test('desktop rail Zoom in/out click intended + break + edge', async ({ page }) => {
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

  await expect(zoomInBtn(page), 'rail Zoom in must be live').toBeVisible();
  await expect(zoomOutBtn(page), 'rail Zoom out must be live').toBeVisible();

  // Overlay lists keyboard Zoom in/out, not a rail-click row.
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists keyboard Zoom in').toMatch(/Zoom in/);
  expect(overlayText, 'overlay lists keyboard Zoom out').toMatch(/Zoom out/);
  expect(overlayText, 'overlay lists Ctrl zoom chords').toMatch(/Ctrl/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  await selectDesktopFit(page, 'Fit page');
  const startPct = await zoomPercent(page);
  expect(Number.isFinite(startPct), 'starting zoom %').toBeTruthy();

  // Intended — Zoom in click raises % (same 1.25 step as zoomIn()).
  await clickZoomIn(page);
  let afterIn = null;
  await expect.poll(async () => {
    afterIn = await zoomPercent(page);
    return afterIn;
  }, { timeout: 20_000, message: 'Zoom in click must raise zoom %' }).toBeGreaterThan(startPct);

  // Intended — Zoom in leaves Fit page (manual step).
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit page', exact: true })).toHaveAttribute('data-active', 'false');
  await page.keyboard.press('Escape');

  // Intended — Zoom out click lowers from that step.
  await clickZoomOut(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Zoom out click must lower zoom % after Zoom in',
  }).toBeLessThan(afterIn);

  // Break — engine floor: extra Zoom out stays.
  await selectDesktopFit(page, 'Fit page');
  let floorPct = await zoomPercent(page);
  for (let i = 0; i < 8; i += 1) {
    await clickZoomOut(page);
    const next = await zoomPercent(page);
    if (next === floorPct) break;
    floorPct = next;
  }
  await clickZoomOut(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 10_000,
    message: 'Zoom out click at the engine floor must no-op',
  }).toBe(floorPct);

  // Break — 4000% ceiling: Zoom in click clamps.
  await setZoomPercent(page, 4000);
  await clickZoomIn(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 10_000,
    message: 'Zoom in click at 4000% must clamp',
  }).toBe(4000);

  // Break — focused zoom % INPUT does not steal a Zoom in *click*
  // (keyboard Ctrl+= is stolen; the button still applies).
  await selectDesktopFit(page, 'Fit page');
  const fitPagePct = await zoomPercent(page);
  const zoomInput = await focusZoomInput(page);
  expect(zoomInput, 'zoom % field').toBeTruthy();
  await expect(zoomInBtn(page)).toBeVisible();
  await zoomInBtn(page).click();
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Zoom in click must still zoom while Zoom % INPUT is focused',
  }).toBeGreaterThan(fitPagePct);
  await page.keyboard.press('Escape');
  await blurInputs(page);

  // Break — hubPreview has no rail Zoom in/out.
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview has no Draw').toBe(0);
  expect(await page.getByRole('button', { name: 'Zoom in', exact: true }).count(), 'hubPreview Zoom in 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Zoom out', exact: true }).count(), 'hubPreview Zoom out 0').toBe(0);

  // Edge — isolation: page-1 rect survives Zoom in; click invents 0.
  await openEditor(page);
  await blurInputs(page);
  await selectDesktopFit(page, 'Fit page');
  const rectId = await createRectOnPage(page, 1);
  await blurInputs(page);
  const page1Before = await userAnnotationIds(page, 1);
  expect(page1Before).toContain(rectId);
  const beforeIso = await zoomPercent(page);
  await clickZoomIn(page);
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(beforeIso);
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive Zoom in click').toEqual(page1Before);

  // Edge — Pen-armed Zoom in still zooms and invents 0.
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  const beforePenZoom = await zoomPercent(page);
  await clickZoomIn(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Pen-armed Zoom in click must still zoom',
  }).toBeGreaterThan(beforePenZoom);
  expect(await userAnnotationIds(page, 1), 'Pen-armed Zoom in invents 0').toEqual(marksBeforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge — 120-page: Zoom in does not change the page number.
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  expect(await currentPageNumber(page)).toBe(1);
  const multiBefore = await zoomPercent(page);
  await clickZoomIn(page);
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(multiBefore);
  expect(await currentPageNumber(page), 'Zoom in click must not change page').toBe(1);
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('TOOLBAR_ZOOM_BUTTONS_DESKTOP_PROOF', JSON.stringify({
    hunt,
    startPct,
    afterIn,
    floorPct,
    overlayListsZoomIn: /Zoom in/.test(overlayText),
    rectId,
    viewBox,
    fileId,
  }));
});

test('390 More-menu Zoom in/out click edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  // 390 rail Zoom in is inside More document options, not the slim rail.
  expect(await page.getByRole('button', { name: 'Zoom in', exact: true }).count(), '390 rail Zoom in 0 until More').toBe(0);
  await page.getByRole('button', { name: 'More document options', exact: true }).click();
  await expect(zoomInBtn(page)).toBeVisible({ timeout: 8_000 });
  await expect(zoomOutBtn(page)).toBeVisible();

  const beforeIn = await pageMetrics(page);
  await zoomInBtn(page).click();
  await expect.poll(async () => (await pageMetrics(page)).pageW, {
    timeout: 20_000,
    message: '390 More Zoom in click must grow page width',
  }).toBeGreaterThan(beforeIn.pageW + 8);
  const afterIn = await pageMetrics(page);

  await page.getByRole('button', { name: 'More document options', exact: true }).click();
  await expect(zoomOutBtn(page)).toBeVisible();
  await zoomOutBtn(page).click();
  await expect.poll(async () => (await pageMetrics(page)).pageW, {
    timeout: 20_000,
    message: '390 More Zoom out click must shrink page width',
  }).toBeLessThan(afterIn.pageW - 8);

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('TOOLBAR_ZOOM_BUTTONS_390_PROOF', JSON.stringify({
    beforeInW: beforeIn.pageW,
    afterInW: afterIn.pageW,
    viewBox,
    fileId,
  }));
});
