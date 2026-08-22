import { test, expect } from '@playwright/test';

// V-05 page-nav keyboard — intended + break + edge.
// Unique leftover after E-05 undo/redo stack. Prior V-05 was overlay +
// window smoke (1-page ignores next; multi-page Home/End jump). Not
// leftover-18. Distinct from thumbnail left-click (V-06), rail page
// input (UL-07), Fit height, and mobile page input. Do not stamp file.id.
// Product: ← / → previous/next; Home first; End last. isFormField
// (INPUT / TEXTAREA / contentEditable) blocks the chords. goToPage
// rejects page < 1 and page > numPages (no-op / clamp).

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = MULTI_PDF } = {}) {
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

async function pressNav(page, key) {
  await blurInputs(page);
  await page.keyboard.press(key);
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

async function focusPageInput(page) {
  const jump = page.getByRole('button', { name: 'Jump to page', exact: true });
  if (await jump.count() && await jump.isVisible().catch(() => false)) {
    await jump.click();
    const mobileInput = page.getByRole('textbox', { name: 'Page number', exact: true });
    await expect(mobileInput).toBeVisible();
    await mobileInput.click();
    return mobileInput;
  }
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  await expect(btn).toBeVisible();
  await btn.click();
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  await expect(input).toBeVisible();
  await input.click();
  return input;
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

test('desktop page-nav keyboard intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await expectPage(page, 1, 'fresh editor starts on page 1');

  // Overlay lists the product mapping.
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists previous/next').toMatch(/Previous\/Next page/);
  expect(overlayText, 'overlay lists Home first page').toMatch(/First page/);
  expect(overlayText, 'overlay lists End last page').toMatch(/Last page/);
  expect(overlayText).toMatch(/Home/);
  expect(overlayText).toMatch(/End/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  // Intended — ArrowRight / ArrowLeft move one page.
  await pressNav(page, 'ArrowRight');
  await expectPage(page, 2, 'ArrowRight must move a page');
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="2"]')).toBeVisible({ timeout: 20_000 });
  await pressNav(page, 'ArrowLeft');
  await expectPage(page, 1, 'ArrowLeft must move a page');

  // Intended — End last; Home first. Last is the page End lands on
  // (do not scrape zoom % as a page count).
  await pressNav(page, 'End');
  let last = null;
  await expect.poll(async () => {
    last = await currentPageNumber(page);
    return last;
  }, { timeout: 20_000, message: 'End must jump to last page' }).toBeGreaterThan(2);
  await pressNav(page, 'Home');
  await expectPage(page, 1, 'Home must jump to first page');

  // Break — first page ← / Home no-op.
  await pressNav(page, 'ArrowLeft');
  await expectPage(page, 1, 'ArrowLeft on first page must no-op');
  await pressNav(page, 'Home');
  await expectPage(page, 1, 'Home on first page must no-op');

  // Break — last page → / End clamp.
  await pressNav(page, 'End');
  await expectPage(page, last, 'End before last-page clamp');
  await pressNav(page, 'ArrowRight');
  await expectPage(page, last, 'ArrowRight on last page must clamp');
  await pressNav(page, 'End');
  await expectPage(page, last, 'End on last page must clamp');

  // Break — focused page INPUT does not steal the chords.
  await pressNav(page, 'Home');
  await expectPage(page, 1);
  await pressNav(page, 'ArrowRight');
  await expectPage(page, 2, 'setup page 2 before INPUT steal');
  const pageInput = await focusPageInput(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  expect(await pageInput.inputValue(), 'page INPUT value must stay 2 while focused').toMatch(/^2$/);
  await page.keyboard.press('Escape');
  await blurInputs(page);
  await expectPage(page, 2, 'page INPUT chords must not steal');

  // Break — focused zoom % INPUT does not steal.
  const zoomInput = await focusZoomInput(page);
  if (zoomInput) {
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    await page.keyboard.press('Escape');
    await blurInputs(page);
    await expectPage(page, 2, 'zoom INPUT chords must not steal');
  }

  // Edge — isolation: page-1 rect survives End / Home; nav invents 0 on page 2.
  await pressNav(page, 'Home');
  await expectPage(page, 1);
  const rectId = await createRectOnPage(page, 1);
  await blurInputs(page);
  const page1Before = await userAnnotationIds(page, 1);
  expect(page1Before).toContain(rectId);
  await pressNav(page, 'ArrowRight');
  await expectPage(page, 2, 'isolation ArrowRight after create');
  expect(await userAnnotationIds(page, 2), 'nav must invent 0 user marks on page 2').toEqual([]);
  await pressNav(page, 'Home');
  await expectPage(page, 1, 'Home returns to the isolated page');
  expect(await userAnnotationIds(page, 1), 'page-1 rect must survive End/Home').toEqual(page1Before);

  // Edge — Pen-armed ArrowRight still navigates and invents 0.
  await activateTool(page, 'Draw', 'Pen');
  const marksBeforePen = await userAnnotationIds(page, 1);
  await pressNav(page, 'ArrowRight');
  await expectPage(page, 2, 'Pen-armed ArrowRight must still move a page');
  expect(await userAnnotationIds(page, 1)).toEqual(marksBeforePen);
  expect(await userAnnotationIds(page, 2), 'Pen-armed nav invents 0').toEqual([]);

  await pressNav(page, 'Home');
  await expectPage(page, 1, 'Home before viewBox');
  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toMatch(/^0 0 /);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  // Edge — 1-page fixture: ← / → / Home / End stay on 1.
  await openEditor(page, { url: LINK_PDF });
  await blurInputs(page);
  await expectPage(page, 1, '1-page starts on 1');
  await pressNav(page, 'ArrowRight');
  await expectPage(page, 1, '1-page ArrowRight must stay 1');
  await pressNav(page, 'End');
  await expectPage(page, 1, '1-page End must stay 1');
  await pressNav(page, 'ArrowLeft');
  await expectPage(page, 1, '1-page ArrowLeft must stay 1');
  await pressNav(page, 'Home');
  await expectPage(page, 1, '1-page Home must stay 1');
  const onePageViewBox = await pageViewBox(page);
  expect(onePageViewBox).toBe('0 0 612 792');
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGE_NAV_KEYBOARD_DESKTOP_PROOF', JSON.stringify({
    last,
    overlayListsHome: /\bHome\b/.test(overlayText),
    overlayListsEnd: /\bEnd\b/.test(overlayText),
    rectId,
    viewBox,
    onePageViewBox,
    fileId,
  }));
});

test('390 page-nav keyboard intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: MULTI_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await expectPage(page, 1, '390 starts on page 1');

  // Intended — same window listener: ← / → / Home / End.
  await pressNav(page, 'ArrowRight');
  await expectPage(page, 2, '390 ArrowRight must move a page');
  await pressNav(page, 'ArrowLeft');
  await expectPage(page, 1, '390 ArrowLeft must move a page');
  await pressNav(page, 'End');
  let last = null;
  await expect.poll(async () => {
    last = await currentPageNumber(page);
    return last;
  }, { timeout: 20_000, message: '390 End must jump to last page' }).toBeGreaterThan(2);
  await pressNav(page, 'Home');
  await expectPage(page, 1, '390 Home must jump to first page');

  // Break — first / last clamp.
  await pressNav(page, 'ArrowLeft');
  await expectPage(page, 1, '390 ArrowLeft on first page must no-op');
  await pressNav(page, 'Home');
  await expectPage(page, 1, '390 Home on first page must no-op');
  await pressNav(page, 'End');
  await expectPage(page, last, '390 End before last-page clamp');
  await pressNav(page, 'ArrowRight');
  await expectPage(page, last, '390 ArrowRight on last page must clamp');
  await pressNav(page, 'End');
  await expectPage(page, last, '390 End on last page must clamp');

  // Break — focused mobile page INPUT does not steal.
  await pressNav(page, 'Home');
  await expectPage(page, 1);
  await pressNav(page, 'ArrowRight');
  await expectPage(page, 2, '390 setup page 2 before INPUT steal');
  const pageInput = await focusPageInput(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  expect(await pageInput.inputValue(), '390 page INPUT value must stay 2').toMatch(/^2$/);
  await page.keyboard.press('Escape');
  await blurInputs(page);
  await expectPage(page, 2, '390 page INPUT chords must not steal');

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toMatch(/^0 0 /);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('PAGE_NAV_KEYBOARD_390_PROOF', JSON.stringify({
    last,
    viewBox,
    fileId,
  }));
});
