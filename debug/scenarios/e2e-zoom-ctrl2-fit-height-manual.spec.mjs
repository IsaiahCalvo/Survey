import { test, expect } from '@playwright/test';

// Unique leftover after remapped-after-CW catalog exhaustion:
// Ctrl+2 Fit height keyboard + Ctrl+M MANUAL lock.
// Menu Fit height is e2e-fit-height (click only). Ctrl+0 is Fit page.
// Ctrl+1 is e2e-zoom-keyboard-fit-width. Overlay lists Ctrl+0 only.
// Distinct from leftover-18 / X-01 / remapped-after-CW / Fit after CW.
// Do not stamp file.id. Do not invent measure / Note-Link / Forms.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
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
    await expect(page.getByText(/Documents|Projects|Templates|Archive/i).first()).toBeVisible({ timeout: 30_000 });
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

async function pageMetrics(page) {
  return page.evaluate(() => {
    const pageDiv = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const wrapper = document.querySelector('.survey-pdfjs-viewer');
    if (!pageDiv || !wrapper) return null;
    return {
      pageW: pageDiv.offsetWidth,
      pageH: pageDiv.offsetHeight,
      wrapH: wrapper.clientHeight,
    };
  });
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function userAnnotationIds(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ));
}

async function selectDesktopFit(page, name) {
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function openFitMenu(page) {
  const trigger = page.getByRole('button', { name: 'Fit options', exact: true });
  await trigger.click();
  await expect(page.getByRole('button', { name: 'Fit height', exact: true })).toBeVisible({ timeout: 5_000 });
}

async function closeFitMenu(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await expect(page.getByRole('button', { name: 'Fit height', exact: true })).toHaveCount(0);
}

async function fitRowActive(page, name) {
  await openFitMenu(page);
  const active = await page.getByRole('button', { name, exact: true }).getAttribute('data-active');
  await closeFitMenu(page);
  return active;
}

async function pressZoom(page, chord) {
  await blurInputs(page);
  await page.keyboard.press(chord);
}

test('desktop Ctrl+2 Fit height + Ctrl+M manual intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  expect(await userAnnotationIds(page), 'fresh editor invents 0').toEqual([]);

  await selectDesktopFit(page, 'Fit width');
  const widthPct = await zoomPercent(page);
  const widthM = await pageMetrics(page);
  expect(widthPct).toBeGreaterThan(150);

  await pressZoom(page, 'Control+2');
  await expect.poll(async () => await zoomPercent(page), {
    timeout: 10_000,
    message: 'Ctrl+2 must leave Fit width',
  }).not.toBe(widthPct);
  const after2Pct = await zoomPercent(page);
  const after2 = await pageMetrics(page);
  expect(after2.pageH, 'Ctrl+2 fills viewer height').toBeGreaterThan(widthM.wrapH - 8);
  expect(Math.abs(after2.pageH - after2.wrapH), 'Ctrl+2 pageH ≈ wrapH').toBeLessThan(36);
  expect(after2Pct, 'Ctrl+2 ≠ Fit width %').not.toBe(widthPct);
  expect(await fitRowActive(page, 'Fit height'), 'Ctrl+2 marks Fit height active').toBe('true');
  expect(await fitRowActive(page, 'Fit width'), 'Ctrl+2 leaves Fit width').toBe('false');
  expect(await userAnnotationIds(page), 'Ctrl+2 invents 0 annotations').toEqual([]);

  await selectDesktopFit(page, 'Fit width');
  await selectDesktopFit(page, 'Fit height');
  const menuHeightPct = await zoomPercent(page);
  expect(after2Pct, 'Ctrl+2 matches menu Fit height').toBe(menuHeightPct);

  await pressZoom(page, 'Control+0');
  await expect.poll(async () => await zoomPercent(page), {
    timeout: 10_000,
    message: 'Ctrl+0 Fit page contrast',
  }).not.toBe(menuHeightPct);
  const pagePct = await zoomPercent(page);
  expect(pagePct, 'Fit page ≠ Fit height').not.toBe(menuHeightPct);

  await pressZoom(page, 'Control+2');
  await expect.poll(async () => await zoomPercent(page), {
    timeout: 10_000,
    message: 'Ctrl+2 after Fit page returns Fit height',
  }).toBe(menuHeightPct);

  const heldPct = await zoomPercent(page);
  const heldM = await pageMetrics(page);
  await pressZoom(page, 'Control+m');
  await expect.poll(async () => await fitRowActive(page, 'Fit height'), {
    timeout: 8_000,
    message: 'Ctrl+M must leave Fit height active',
  }).toBe('false');
  expect(await zoomPercent(page), 'Ctrl+M holds current scale').toBe(heldPct);
  expect(Math.abs((await pageMetrics(page)).pageH - heldM.pageH), 'Ctrl+M does not resize').toBeLessThan(4);
  expect(await page.locator('[data-measure-overlay], [data-measurement-tool]').count(), 'Ctrl+M is not measure').toBe(0);
  expect(await userAnnotationIds(page), 'Ctrl+M invents 0 annotations').toEqual([]);

  await openFitMenu(page);
  await expect(page.getByRole('button', { name: 'Fit page', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit width', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit height', exact: true })).toHaveAttribute('data-active', 'false');
  await expect(page.getByRole('button', { name: 'Actual size', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Measure', exact: true })).toHaveCount(0);
  await closeFitMenu(page);

  await page.setViewportSize({ width: 1100, height: 700 });
  await expect.poll(async () => {
    const next = await pageMetrics(page);
    return next && Math.abs(next.wrapH - 623) < 80 ? next.pageH : null;
  }, { timeout: 10_000, message: 'resize after Ctrl+M must not re-fit height' }).toBe(heldM.pageH);

  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await zoomBtn.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeFocused();
  const beforeInput = await zoomPercent(page);
  await page.keyboard.press('Control+2');
  expect(await zoomPercent(page), 'Zoom % INPUT steals Ctrl+2').toBe(beforeInput);
  await blurInputs(page);

  await page.getByRole('button', { name: /Search/i }).first().click().catch(() => {});
  const search = page.getByPlaceholder(/Search text/i);
  if (await search.count()) {
    await search.first().click();
    await expect(search.first()).toBeFocused();
    await page.keyboard.press('Control+m');
    expect(await page.locator('[data-measure-overlay]').count()).toBe(0);
    expect(await fitRowActive(page, 'Fit height'), 'Search INPUT steals Ctrl+M').toBe('false');
  }

  await page.keyboard.press('?');
  const overlay = page.getByText('Fit page', { exact: true });
  await expect(overlay.first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Fit height', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/manual zoom|Fit width/i)).toHaveCount(0);
  await page.keyboard.press('Escape');

  await openEditor(page, { url: HUB });
  await page.keyboard.press('Control+2');
  await page.keyboard.press('Control+m');
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview has no Draw').toBe(0);
  expect(await page.locator('[data-svg-annotation-layer]').count(), 'hubPreview invents 0 layers').toBe(0);

  console.log('ZOOM_CTRL2_M', JSON.stringify({
    widthPct,
    after2Pct,
    menuHeightPct,
    pagePct,
    heldPct,
    fileId: null,
  }));
});

test('390 Ctrl+2 Fit height edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);
  expect(await fileId(page)).toBeNull();
  expect(await userAnnotationIds(page)).toEqual([]);
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');

  await pressZoom(page, 'Control+2');
  await expect.poll(async () => {
    const m = await pageMetrics(page);
    return m && Math.abs(m.pageH - m.wrapH) < 36;
  }, { timeout: 10_000, message: '390 Ctrl+2 fills height' }).toBeTruthy();
  expect(await userAnnotationIds(page), '390 Ctrl+2 invents 0').toEqual([]);
  expect(await page.locator('[data-measure-overlay]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
