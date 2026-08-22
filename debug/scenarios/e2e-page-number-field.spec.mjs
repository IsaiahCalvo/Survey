import { test, expect } from '@playwright/test';

// UL-07 leftover: rail / 390 page-number edit field.
// Prior proof was e2e-unlisted-live sample only (0+99 stay 1; jump 3)
// plus thumbnail-click contrast (type 8 vs thumb 3).
// Distinct from V-05 keyboard, V-06 thumbnail click, UL-06 Zoom %, leftover-18.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1400, height = 900, url = MULTI_PDF } = {}) {
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

async function expectPage(page, n, message) {
  await expect.poll(() => currentPageNumber(page), {
    timeout: 20_000,
    message: message || `expected page ${n}`,
  }).toBe(n);
}

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
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

async function focusPageInput(page) {
  const desktopBtn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await desktopBtn.count()) {
    await desktopBtn.click();
    const input = page.getByRole('textbox', { name: 'Current page', exact: true });
    await expect(input).toBeVisible();
    await input.click();
    return input;
  }
  const jump = page.getByRole('button', { name: 'Jump to page', exact: true });
  if (await jump.count()) {
    await jump.click();
    const input = page.getByRole('textbox', { name: 'Page number', exact: true });
    await expect(input).toBeVisible();
    await input.click();
    return input;
  }
  return null;
}

async function clearAndTypePage(page, input, text) {
  await input.click();
  await input.press('Control+A');
  await input.press('Backspace');
  await expect(input).toHaveValue('');
  if (text) await input.pressSequentially(text, { delay: 25 });
}

async function commitPageNumber(page, value) {
  const input = await focusPageInput(page);
  expect(input, 'page number field').toBeTruthy();
  await clearAndTypePage(page, input, String(value));
  await expect(input).toHaveValue(String(value));
  await input.press('Enter');
  await blurInputs(page);
}

test('desktop page number field intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await expect(page.getByRole('button', { name: 'Edit page number', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Current page', exact: true })).toHaveCount(0);
  expect(await currentPageNumber(page)).toBe(1);

  // Intended — type 8 + Enter jumps on the 120-page fixture.
  await commitPageNumber(page, 8);
  await expectPage(page, 8, 'typed 8 must commit page 8');
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="8"]')).toBeVisible({ timeout: 20_000 });

  // Intended — click-away blur also commits.
  const blurInput = await focusPageInput(page);
  await clearAndTypePage(page, blurInput, '12');
  await expect(blurInput).toHaveValue('12');
  await page.locator('.survey-pdfjs-page-div[data-page-number="8"]').click({ position: { x: 12, y: 12 } }).catch(async () => {
    await page.locator('.survey-pdfjs-viewer').click({ position: { x: 24, y: 24 } });
  });
  await blurInputs(page);
  await expectPage(page, 12, 'click-away blur must commit page 12');

  // Break — 0 / 121 / empty / letters restore the live page.
  await commitPageNumber(page, 0);
  await expectPage(page, 12, '0 must restore page 12');
  await commitPageNumber(page, 121);
  await expectPage(page, 12, '121 must restore page 12');

  const emptyInput = await focusPageInput(page);
  await emptyInput.fill('');
  await emptyInput.press('Enter');
  await blurInputs(page);
  await expectPage(page, 12, 'empty Enter must restore page 12');

  const letterInput = await focusPageInput(page);
  await clearAndTypePage(page, letterInput, 'abc');
  await expect(letterInput, 'letters must strip').toHaveValue('');
  await letterInput.press('Enter');
  await blurInputs(page);
  await expectPage(page, 12, 'letters must restore page 12');

  // Break — Escape restores and must not commit the typed draft.
  await commitPageNumber(page, 1);
  await expectPage(page, 1, 'return to page 1 before Escape');
  const escapeInput = await focusPageInput(page);
  await clearAndTypePage(page, escapeInput, '8');
  await expect(escapeInput).toHaveValue('8');
  await escapeInput.press('Escape');
  await blurInputs(page);
  await expectPage(page, 1, 'Escape must restore page 1 and not commit 8');
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();

  // Break — opening the field then ArrowRight + digit appends (failed select-all).
  const appendInput = await focusPageInput(page);
  await appendInput.press('ArrowRight');
  await appendInput.pressSequentially('2', { delay: 25 });
  expect(await appendInput.inputValue(), 'append without select-all').toBe('12');
  await appendInput.press('Escape');
  await blurInputs(page);
  await expectPage(page, 1, 'Escape after append must restore page 1');

  // Edge — isolation: page-1 rect survives the jump; field invents 0.
  const rectId = await createRectOnPage(page, 1);
  await blurInputs(page);
  const page1Before = await userAnnotationIds(page, 1);
  expect(page1Before).toContain(rectId);
  await commitPageNumber(page, 8);
  await expectPage(page, 8, 'isolation jump 8');
  await commitPageNumber(page, 1);
  await expectPage(page, 1, 'isolation return 1');
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive page jump').toEqual(page1Before);

  // Edge — Pen-armed field still jumps and invents 0.
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  await commitPageNumber(page, 3);
  await expectPage(page, 3, 'Pen-armed 3 must commit');
  await commitPageNumber(page, 1);
  await expectPage(page, 1);
  expect(await userAnnotationIds(page, 1)).toEqual(marksBeforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Edit page number', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Current page', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  // Edge — 1-page: 0 / 99 stay 1.
  await openEditor(page, { url: LINK_PDF });
  await blurInputs(page);
  expect(await currentPageNumber(page)).toBe(1);
  await commitPageNumber(page, 0);
  await expectPage(page, 1, '1-page 0 must stay 1');
  await commitPageNumber(page, 99);
  await expectPage(page, 1, '1-page 99 must stay 1');
  expect(await pageViewBox(page)).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGE_NUMBER_FIELD_DESKTOP_PROOF', JSON.stringify({
    rectId,
    viewBox,
    fileId,
  }));
});

test('390 page number field intended + break + edge', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, { width: 390, height: 844, url: MULTI_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  expect(await page.getByRole('button', { name: 'Edit page number', exact: true }).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Jump to page', exact: true })).toBeVisible();
  expect(await currentPageNumber(page)).toBe(1);

  await commitPageNumber(page, 8);
  await expectPage(page, 8, '390 typed 8 must commit page 8');

  const escapeInput = await focusPageInput(page);
  await clearAndTypePage(page, escapeInput, '12');
  await expect(escapeInput).toHaveValue('12');
  await escapeInput.press('Escape');
  await blurInputs(page);
  await expectPage(page, 8, '390 Escape must restore page 8 and not commit 12');

  await commitPageNumber(page, 0);
  await expectPage(page, 8, '390 0 must restore page 8');
  await commitPageNumber(page, 121);
  await expectPage(page, 8, '390 121 must restore page 8');

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGE_NUMBER_FIELD_390_PROOF', JSON.stringify({
    jumpToPage: 1,
    viewBox,
    fileId,
  }));
});
