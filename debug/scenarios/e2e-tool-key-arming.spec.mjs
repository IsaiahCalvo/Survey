import { test, expect } from '@playwright/test';

// Unique leftover after rail Previous/Next page click:
// overlay-listed P-04 tool-key arming (V/P/H/E/T/Q/L/A/C).
// 2026-08-21 matrix sampled letters. V-03 is ⇧V. D-03 is E vs Shift+E.
// Toolbar clicks are each tool's create path. This leftover is the
// keyboard arm (category + sub-row) with INPUT steal / invent-0 / 390.
// Distinct from leftover-18 / X-01 / remapped-after-CW / Ctrl+2 / Ctrl+M /
// rail Previous/Next. Do not stamp file.id. Do not invent Note-Link / Forms.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
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
          || key === 'lastDrawTool'
          || key === 'lastShapeTool'
          || key === 'lastReviewTool'
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

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    return [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter((id) => id && !/^\d+R$/i.test(id));
  }, pageNumber);
}

function isActiveClass(className) {
  return String(className || '').includes('btn-active');
}

async function categoryActive(page, name) {
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    if (isActiveClass(await button.getAttribute('class'))) return true;
  }
  return false;
}

async function subToolActive(page, name) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name, exact: true });
  if (await sub.count()) {
    return isActiveClass(await sub.first().getAttribute('class'));
  }
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    if (isActiveClass(await button.getAttribute('class'))) return true;
  }
  return false;
}

async function eraserActive(page) {
  const names = ['Partial erase', 'Full stroke erase', 'Eraser'];
  for (const name of names) {
    if (await subToolActive(page, name)) return true;
  }
  return false;
}

async function counterOverlayCount(page) {
  return page.locator('[data-counter-overlay]').count();
}

async function huntCompileHidden(page) {
  return page.evaluate(() => ({
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
    rectangleKey: [...document.querySelectorAll('[data-keyboard-shortcuts-modal="true"] kbd')]
      .filter((el) => el.textContent === 'R').length,
  }));
}

test('desktop overlay tool-key arming intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { url: SEARCH_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const hunt = await huntCompileHidden(page);
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

  await openEditor(page, { url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const marksBefore = await userAnnotationIds(page, 1);

  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists Select annotations').toMatch(/Select annotations/);
  expect(overlayText, 'overlay lists Pen').toMatch(/\bPen\b/);
  expect(overlayText, 'overlay lists Highlighter').toMatch(/Highlighter/);
  expect(overlayText, 'overlay lists Eraser').toMatch(/Eraser/);
  expect(overlayText, 'overlay lists Text').toMatch(/\bText\b/);
  expect(overlayText, 'overlay lists Callout').toMatch(/Callout/);
  expect(overlayText, 'overlay lists Line').toMatch(/\bLine\b/);
  expect(overlayText, 'overlay lists Arrow').toMatch(/\bArrow\b/);
  expect(overlayText, 'overlay lists Counter').toMatch(/Counter/);
  expect(overlayText, 'overlay omits Rectangle key').not.toMatch(/Rectangle/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  // Intended — each overlay tool letter arms the matching category + sub-row.
  await page.keyboard.press('v');
  await expect.poll(() => categoryActive(page, 'Select'), { message: 'V must arm Select annotations' }).toBe(true);
  expect(await categoryActive(page, 'Draw'), 'V closes Draw sub-row').toBe(false);

  await page.keyboard.press('p');
  await expect.poll(() => categoryActive(page, 'Draw'), { message: 'P must open Draw' }).toBe(true);
  await expect.poll(() => subToolActive(page, 'Pen'), { message: 'P must arm Pen' }).toBe(true);

  await page.keyboard.press('p');
  expect(await subToolActive(page, 'Pen'), 're-press P stays Pen').toBe(true);

  await page.keyboard.press('h');
  await expect.poll(() => subToolActive(page, 'Highlighter'), { message: 'H must arm Highlighter' }).toBe(true);
  expect(await categoryActive(page, 'Draw'), 'H keeps Draw').toBe(true);
  expect(await subToolActive(page, 'Pen'), 'H leaves Pen').toBe(false);

  await page.keyboard.press('e');
  await expect.poll(() => eraserActive(page), { message: 'E must arm Eraser' }).toBe(true);
  expect(await categoryActive(page, 'Draw'), 'E keeps Draw').toBe(true);

  await page.keyboard.press('t');
  await expect.poll(() => categoryActive(page, 'Text'), { message: 'T must open Text category' }).toBe(true);
  await expect.poll(async () => {
    const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
    if (!(await sub.count())) return false;
    return isActiveClass(await sub.first().getAttribute('class'));
  }, { message: 'T must arm Text tool' }).toBe(true);

  await page.keyboard.press('q');
  await expect.poll(() => subToolActive(page, 'Callout'), { message: 'Q must arm Callout' }).toBe(true);
  expect(await categoryActive(page, 'Text'), 'Q keeps Text category').toBe(true);

  await page.keyboard.press('l');
  await expect.poll(() => categoryActive(page, 'Shapes'), { message: 'L must open Shapes' }).toBe(true);
  await expect.poll(() => subToolActive(page, 'Line'), { message: 'L must arm Line' }).toBe(true);
  expect(await categoryActive(page, 'Draw'), 'L leaves Draw').toBe(false);

  await page.keyboard.press('a');
  await expect.poll(() => subToolActive(page, 'Arrow'), { message: 'A must arm Arrow' }).toBe(true);

  await page.keyboard.press('c');
  await expect.poll(() => subToolActive(page, 'Counter'), { message: 'C must arm Counter' }).toBe(true);
  await expect.poll(() => counterOverlayCount(page), { message: 'C must mount counter overlay' }).toBeGreaterThan(0);

  await page.keyboard.press('v');
  await expect.poll(() => categoryActive(page, 'Select'), { message: 'V after Counter returns Select' }).toBe(true);
  await expect.poll(() => counterOverlayCount(page), { message: 'V dismisses counter overlay' }).toBe(0);

  expect(await userAnnotationIds(page, 1), 'tool keys invent 0 annotations').toEqual(marksBefore);

  // Break — undocumented letters do not invent a Rectangle / Ellipse / stamp tool.
  await page.keyboard.press('r');
  await page.keyboard.press('o');
  await page.keyboard.press('s');
  await page.keyboard.press('i');
  await page.keyboard.press('g');
  await page.keyboard.press('n');
  await page.keyboard.press('f');
  expect(await categoryActive(page, 'Select'), 'undocumented letters must not leave Select').toBe(true);
  expect(await page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true }).count(), 'R does not invent Rectangle').toBe(0);
  expect(await userAnnotationIds(page, 1), 'undocumented letters invent 0').toEqual(marksBefore);

  // Break — Zoom % INPUT steals P.
  await page.keyboard.press('p');
  await expect.poll(() => subToolActive(page, 'Pen'), { message: 'setup Pen before INPUT steal' }).toBe(true);
  const zoomEdit = page.getByRole('button', { name: 'Edit zoom percentage', exact: true }).first();
  await expect(zoomEdit).toBeVisible({ timeout: 10_000 });
  await zoomEdit.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeVisible({ timeout: 8_000 });
  await zoomInput.press('p');
  expect(await zoomInput.evaluate((el) => el === document.activeElement), 'Zoom % INPUT steals P').toBe(true);
  expect(await subToolActive(page, 'Pen'), 'P in Zoom % must not switch tools').toBe(true);
  await page.keyboard.press('Escape');
  await blurInputs(page);

  // Break — Search field steals T.
  await page.getByRole('button', { name: 'Search text', exact: true }).first().click();
  const search = page.getByPlaceholder(/Search text/i).first();
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.click();
  const beforeSearch = await search.inputValue();
  await search.press('t');
  expect(await search.inputValue(), 'Search field steals T').toBe(`${beforeSearch}t`);
  expect(await subToolActive(page, 'Pen'), 'T in Search must not arm Text').toBe(true);
  await page.keyboard.press('Escape');
  await blurInputs(page);

  // Break — hubPreview has no Draw; letters invent 0.
  await openEditor(page, { url: HUB });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview has no Draw').toBe(0);
  const hubMarks = await page.locator('[data-svg-annotation-layer] > g[data-anno-id]').count();
  await page.keyboard.press('p');
  await page.keyboard.press('l');
  await page.keyboard.press('c');
  expect(await page.locator('[data-svg-annotation-layer] > g[data-anno-id]').count(), 'hubPreview tool keys invent 0').toBe(hubMarks);
  expect(await page.locator('[data-counter-overlay]').count(), 'hubPreview Counter overlay 0').toBe(0);
  await assertNoErrorBoundary(page);

  await openEditor(page, { url: LINK_PDF });
  await blurInputs(page);
  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  console.log('TOOL_KEY_ARMING_DESKTOP_PROOF', JSON.stringify({
    hunt,
    overlayListsTools: /Pen/.test(overlayText) && /Callout/.test(overlayText),
    viewBox,
    fileId,
    marksBefore,
  }));
});

test('390 overlay tool-key arming edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const marksBefore = await userAnnotationIds(page, 1);
  await page.keyboard.press('p');
  await page.keyboard.press('l');
  await page.keyboard.press('v');
  expect(await userAnnotationIds(page, 1), '390 tool keys invent 0').toEqual(marksBefore);

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('TOOL_KEY_ARMING_390_PROOF', JSON.stringify({
    viewBox,
    fileId,
  }));
});
