import { test, expect } from '@playwright/test';

// Unique leftover after Ctrl+2 Fit height / Ctrl+M MANUAL:
// desktop rail Previous page / Next page click.
// V-05 is keyboard ←/→ Home/End (e2e-page-nav-keyboard).
// UL-07 is the page # field. V-06 is thumbnail left-click.
// 390 prev/next was mobile hit-targets sample only.
// Distinct from leftover-18 / X-01 / remapped-after-CW / zoom chords.
// Do not stamp file.id. Do not invent Note-Link / Forms / stamp / measure.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1400, height = 900, url = MULTI_PDF } = {}) {
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

function prevBtn(page) {
  return page.getByRole('button', { name: 'Previous page', exact: true }).first();
}

function nextBtn(page) {
  return page.getByRole('button', { name: 'Next page', exact: true }).first();
}

async function clickNext(page) {
  await blurInputs(page);
  await expect(nextBtn(page)).toBeEnabled();
  await nextBtn(page).click();
}

async function clickPrev(page) {
  await blurInputs(page);
  await expect(prevBtn(page)).toBeEnabled();
  await prevBtn(page).click();
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
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

async function jumpViaPageField(page, value) {
  const jump = page.getByRole('button', { name: 'Jump to page', exact: true });
  if (await jump.count() && await jump.isVisible().catch(() => false)) {
    await jump.click();
    const mobileInput = page.getByRole('textbox', { name: 'Page number', exact: true });
    await expect(mobileInput).toBeVisible();
    await mobileInput.fill(String(value));
    await mobileInput.press('Enter');
    await blurInputs(page);
    return;
  }
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  await expect(btn).toBeVisible();
  await btn.click();
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  await expect(input).toBeVisible();
  await input.fill(String(value));
  await input.press('Enter');
  await blurInputs(page);
}

async function countNamed(page, name) {
  return page.getByRole('button', { name, exact: true }).count();
}

test('desktop rail Previous/Next page click intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  // Hunt — leftover-18 hosts stay absent; compile-hidden chrome stays 0.
  // Do not replay remapped-after-CW or Ctrl+2 / Ctrl+M.
  await openEditor(page, { url: SEARCH_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const hunt = await page.evaluate(() => ({
    fileId: window.__devTestPdf?.id ?? null,
    matchCase: [...document.querySelectorAll('button, [role="checkbox"], label')]
      .filter((el) => /match case/i.test(el.textContent || el.getAttribute('aria-label') || '')).length,
    wholeWord: [...document.querySelectorAll('button, [role="checkbox"], label')]
      .filter((el) => /whole word/i.test(el.textContent || el.getAttribute('aria-label') || '')).length,
    comments: [...document.querySelectorAll('button')]
      .filter((el) => /^comments$/i.test((el.getAttribute('aria-label') || el.textContent || '').trim())).length,
    forms: [...document.querySelectorAll('button')]
      .filter((el) => /^forms$/i.test((el.getAttribute('aria-label') || el.textContent || '').trim())).length,
    print: [...document.querySelectorAll('button')]
      .filter((el) => /^print$/i.test((el.getAttribute('aria-label') || el.textContent || '').trim())).length,
    actualSize: [...document.querySelectorAll('button')]
      .filter((el) => /actual size/i.test(el.textContent || el.getAttribute('aria-label') || '')).length,
    measure: [...document.querySelectorAll('button')]
      .filter((el) => /^measure$/i.test((el.getAttribute('aria-label') || el.textContent || '').trim())).length,
    group: [...document.querySelectorAll('button')]
      .filter((el) => /^(group|ungroup)$/i.test((el.getAttribute('aria-label') || el.textContent || '').trim())).length,
    extract: [...document.querySelectorAll('button')]
      .filter((el) => /extract pages/i.test(el.textContent || el.getAttribute('aria-label') || '')).length,
    note: [...document.querySelectorAll('button')]
      .filter((el) => /^(note|sticky note|link)$/i.test((el.getAttribute('aria-label') || el.textContent || '').trim())).length,
    marqueeZoom: [...document.querySelectorAll('button')]
      .filter((el) => /marquee zoom/i.test(el.textContent || el.getAttribute('aria-label') || '')).length,
  }));
  expect(hunt.fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  expect(hunt.matchCase, 'Search Match case compile-hidden').toBe(0);
  expect(hunt.wholeWord, 'Search Whole word compile-hidden').toBe(0);
  expect(hunt.comments, 'Comments compile-hidden').toBe(0);
  expect(hunt.forms, 'Forms toolbar compile-hidden').toBe(0);
  expect(hunt.print, 'Print compile-hidden').toBe(0);
  expect(hunt.actualSize, 'Actual size compile-hidden').toBe(0);
  expect(hunt.measure, 'Measure compile-hidden').toBe(0);
  expect(hunt.group, 'Group/Ungroup compile-hidden').toBe(0);
  expect(hunt.extract, 'Extract Pages compile-hidden').toBe(0);
  expect(hunt.note, 'Note/Link create compile-hidden').toBe(0);
  expect(hunt.marqueeZoom, 'Marquee zoom compile-hidden').toBe(0);

  await page.getByRole('button', { name: 'Search text', exact: true }).first().click();
  await expect(page.getByPlaceholder(/Search text/i).first()).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('button', { name: /match case/i }).count(), 'opened Search still has no Match case').toBe(0);
  expect(await page.getByRole('button', { name: /whole word/i }).count(), 'opened Search still has no Whole word').toBe(0);

  // Leftover — desktop rail Previous / Next on a 120-page fixture.
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);
  await expectPage(page, 1, 'fresh editor starts on page 1');

  await expect(prevBtn(page), 'Previous must be disabled on page 1').toBeDisabled();
  await expect(nextBtn(page), 'Next must be enabled on page 1').toBeEnabled();

  // Overlay lists keyboard Previous/Next, not the rail buttons.
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists previous/next keyboard').toMatch(/Previous\/Next page/);
  expect(overlayText, 'overlay omits rail Previous page').not.toMatch(/Previous page/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  // Intended — Next click 1→2; Previous click 2→1.
  await clickNext(page);
  await expectPage(page, 2, 'Next page click must move a page');
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="2"]')).toBeVisible({ timeout: 20_000 });
  await expect(prevBtn(page)).toBeEnabled();
  await clickPrev(page);
  await expectPage(page, 1, 'Previous page click must move a page');
  await expect(prevBtn(page)).toBeDisabled();

  // Break — first-page Previous stays disabled (do not force-click).
  await expect(prevBtn(page), 'Previous on first page must stay disabled').toBeDisabled();
  await expectPage(page, 1, 'disabled Previous must not navigate');

  // Break — last-page Next disabled; Previous click leaves last.
  await jumpViaPageField(page, 120);
  await expectPage(page, 120, 'page field setup to last page');
  await expect(nextBtn(page), 'Next must be disabled on last page').toBeDisabled();
  await expect(prevBtn(page)).toBeEnabled();
  await clickPrev(page);
  await expectPage(page, 119, 'Previous from last page must leave 120');
  await expect(nextBtn(page)).toBeEnabled();

  // Break — hubPreview has no rail page nav.
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview has no Draw').toBe(0);
  expect(await countNamed(page, 'Previous page'), 'hubPreview Previous page 0').toBe(0);
  expect(await countNamed(page, 'Next page'), 'hubPreview Next page 0').toBe(0);

  // Edge — 1-page fixture: both rail buttons disabled.
  await openEditor(page, { url: LINK_PDF });
  await blurInputs(page);
  await expectPage(page, 1, '1-page starts on 1');
  await expect(prevBtn(page), '1-page Previous disabled').toBeDisabled();
  await expect(nextBtn(page), '1-page Next disabled').toBeDisabled();
  const onePageViewBox = await pageViewBox(page);
  expect(onePageViewBox).toBe('0 0 612 792');

  // Edge — isolation: page-1 rect survives Next/Previous on 120-page.
  await openEditor(page, { url: MULTI_PDF });
  await blurInputs(page);
  await expectPage(page, 1);
  const rectId = await createRectOnPage(page, 1);
  await blurInputs(page);
  const page1Before = await userAnnotationIds(page, 1);
  expect(page1Before).toContain(rectId);
  await clickNext(page);
  await expectPage(page, 2, 'isolation Next after create');
  expect(await userAnnotationIds(page, 2), 'Next click must invent 0 user marks on page 2').toEqual([]);
  await clickPrev(page);
  await expectPage(page, 1, 'Previous returns to the isolated page');
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive Next/Previous').toEqual(page1Before);

  // Edge — Pen-armed Next still navigates and invents 0.
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  await clickNext(page);
  await expectPage(page, 2, 'Pen-armed Next click must still move a page');
  expect(await userAnnotationIds(page, 1)).toEqual(marksBeforePen);
  expect(await userAnnotationIds(page, 2), 'Pen-armed Next invents 0').toEqual([]);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toMatch(/^0 0 /);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGE_NAV_TOOLBAR_DESKTOP_PROOF', JSON.stringify({
    hunt,
    overlayListsKeyboardNav: /Previous\/Next page/.test(overlayText),
    rectId,
    viewBox,
    onePageViewBox,
    fileId,
  }));
});

test('390 rail Previous/Next page click edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: MULTI_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);
  await expectPage(page, 1, '390 starts on page 1');

  await expect(prevBtn(page), '390 Previous disabled on page 1').toBeDisabled();
  await expect(nextBtn(page)).toBeEnabled();
  await clickNext(page);
  await expectPage(page, 2, '390 Next page click must move a page');
  await clickPrev(page);
  await expectPage(page, 1, '390 Previous page click must move a page');
  await expect(prevBtn(page)).toBeDisabled();

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGE_NAV_TOOLBAR_390_PROOF', JSON.stringify({
    viewBox,
    fileId,
  }));
});
