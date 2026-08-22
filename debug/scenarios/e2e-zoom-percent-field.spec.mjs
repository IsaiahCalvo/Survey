import { test, expect } from '@playwright/test';

// UL-06 leftover: rail Zoom % edit field.
// Prior proof was e2e-unlisted-live sample only (200 / 0→min / 9999→4000 / 50→min).
// Distinct from V-04 keyboard + Fit width, Fit height, W4-02 pinch,
// V-05 page-nav, leftover-18. Do not stamp file.id.

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

async function focusZoomInput(page) {
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (!(await zoomBtn.count())) return null;
  await zoomBtn.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeVisible();
  await zoomInput.click();
  return zoomInput;
}

async function commitZoomPercent(page, value) {
  const zoomInput = await focusZoomInput(page);
  expect(zoomInput, 'zoom % field').toBeTruthy();
  await zoomInput.fill(String(value));
  await zoomInput.press('Enter');
  await blurInputs(page);
}

async function selectDesktopFit(page, name) {
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('desktop zoom % field intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await expect(page.getByRole('button', { name: 'Edit zoom percentage', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Zoom percentage', exact: true })).toHaveCount(0);

  await selectDesktopFit(page, 'Fit page');
  const fitPagePct = await zoomPercent(page);
  const fitPage = await pageMetrics(page);
  expect(Number.isFinite(fitPagePct), 'Fit page %').toBeTruthy();

  // Intended — type 200 + Enter writes manual 200% and grows the page.
  await commitZoomPercent(page, 200);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'typed 200 must commit 200%',
  }).toBe(200);
  await expect.poll(async () => (await pageMetrics(page)).pageW, {
    timeout: 20_000,
    message: '200% must grow page width vs Fit page',
  }).toBeGreaterThan(fitPage.pageW + 8);
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit page', exact: true })).toHaveAttribute('data-active', 'false');
  await expect(page.getByRole('button', { name: 'Fit width', exact: true })).toHaveAttribute('data-active', 'false');
  await page.keyboard.press('Escape');

  // Intended — blur also commits.
  const zoomForBlur = await focusZoomInput(page);
  await zoomForBlur.fill('250');
  await zoomForBlur.blur();
  await blurInputs(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'blur must commit 250%',
  }).toBe(250);

  // Break — 0 / 1 / 50 lift to the engine dynamic min (often ~Fit page).
  await commitZoomPercent(page, 0);
  let liftedZero = null;
  await expect.poll(async () => {
    liftedZero = await zoomPercent(page);
    return liftedZero;
  }, { timeout: 20_000, message: '0 must lift above the typed value' }).toBeGreaterThan(50);
  await commitZoomPercent(page, 50);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: '50 must lift to the same engine min as 0',
  }).toBe(liftedZero);
  await commitZoomPercent(page, 1);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: '1 must lift to the same engine min as 0',
  }).toBe(liftedZero);

  // Break — mid-keystroke 9999 clamps to 4000; Enter keeps 4000.
  const zoomCeil = await focusZoomInput(page);
  await zoomCeil.fill('9999');
  expect(await zoomCeil.inputValue(), '9999 must clamp in the field').toBe('4000');
  await zoomCeil.press('Enter');
  await blurInputs(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: '4000% ceiling must apply',
  }).toBe(4000);

  // Break — empty + Enter restores the live scale (no 0 / no invent).
  await commitZoomPercent(page, 200);
  await expect.poll(() => zoomPercent(page)).toBe(200);
  const emptyInput = await focusZoomInput(page);
  await emptyInput.fill('');
  await emptyInput.press('Enter');
  await blurInputs(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'empty Enter must restore 200%',
  }).toBe(200);

  // Break — letters strip to empty, then restore.
  const letterInput = await focusZoomInput(page);
  await letterInput.fill('abc');
  expect(await letterInput.inputValue(), 'letters must strip').toBe('');
  await letterInput.press('Enter');
  await blurInputs(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'letters must restore 200%',
  }).toBe(200);

  // Break — Escape restores and must not commit the typed draft.
  const escapeInput = await focusZoomInput(page);
  await escapeInput.fill('333');
  await escapeInput.press('Escape');
  await blurInputs(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Escape must restore 200% and not commit 333',
  }).toBe(200);

  // Break — failed select-all appends digits onto the live value.
  const appendInput = await focusZoomInput(page);
  await appendInput.press('End');
  await appendInput.type('2');
  expect(await appendInput.inputValue(), 'append without select-all').toBe('2002');
  await appendInput.press('Escape');
  await blurInputs(page);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Escape after append must restore 200%',
  }).toBe(200);

  // Edge — isolation: page-1 rect survives the field; zoom invents 0.
  await selectDesktopFit(page, 'Fit page');
  const rectId = await createRectOnPage(page, 1);
  await blurInputs(page);
  const page1Before = await userAnnotationIds(page, 1);
  expect(page1Before).toContain(rectId);
  await commitZoomPercent(page, 200);
  await expect.poll(() => zoomPercent(page)).toBe(200);
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive 200%').toEqual(page1Before);

  // Edge — Pen-armed field still zooms and invents 0.
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  await commitZoomPercent(page, 175);
  await expect.poll(() => zoomPercent(page), {
    timeout: 20_000,
    message: 'Pen-armed 175 must commit',
  }).toBe(175);
  expect(await userAnnotationIds(page, 1)).toEqual(marksBeforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Edit zoom percentage', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Zoom percentage', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  // Edge — 120-page: typing 200 does not change the page number.
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  expect(await currentPageNumber(page)).toBe(1);
  await commitZoomPercent(page, 200);
  await expect.poll(() => zoomPercent(page)).toBe(200);
  expect(await currentPageNumber(page), 'zoom % must not change page').toBe(1);
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('ZOOM_PERCENT_FIELD_DESKTOP_PROOF', JSON.stringify({
    fitPagePct,
    liftedZero,
    rectId,
    viewBox,
    fileId,
  }));
});

test('390 zoom % field is absent; fit chrome stays', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  expect(await page.getByRole('button', { name: 'Edit zoom percentage', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Zoom percentage', exact: true }).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Zoom and fit options' })).toBeVisible();

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('ZOOM_PERCENT_FIELD_390_PROOF', JSON.stringify({
    editZoom: 0,
    zoomInput: 0,
    viewBox,
    fileId,
  }));
});
