import { test, expect } from '@playwright/test';

// Unique leftover after overlay-listed P-04 tool-key arming:
// live toolbar / category-strip click-to-arm (including Rectangle /
// Ellipse, which have no overlay letter). Keyboard V/P/H/E/T/Q/L/A/C
// is e2e-tool-key-arming. Create-path clicks (then draw) are each
// tool's live-create spec. This leftover is click-to-arm only:
// category + sub-row, invent-0, hubPreview 0, 390 rail.
// Distinct from leftover-18 / X-01 / remapped-after-CW / Ctrl+2 /
// Ctrl+M / rail Previous/Next / ⇧V / Shift+E / keyboard letters.
// Do not stamp file.id. Do not invent Note-Link / Forms / stamp.

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
  const value = String(className || '');
  return value.includes('btn-active') || value.includes('is-active');
}

function toolRoots(page) {
  return [
    page.locator('[data-tool-toolbar="true"]'),
    page.locator('#chrome-sub-toolbar-host'),
    page.locator('[aria-label="Document tools"]'),
    page.locator('.mobile-pdf-tools__subtools'),
  ];
}

async function clickNamed(page, name, root = null) {
  const roots = root ? [root] : toolRoots(page);
  for (const scope of roots) {
    if (!(await scope.count())) continue;
    const buttons = scope.getByRole('button', { name, exact: true });
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      if (!(await button.isVisible().catch(() => false))) continue;
      await button.click();
      return true;
    }
  }
  return false;
}

async function categoryActive(page, name) {
  for (const scope of toolRoots(page)) {
    if (!(await scope.count())) continue;
    const buttons = scope.getByRole('button', { name, exact: true });
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      if (!(await button.isVisible().catch(() => false))) continue;
      if (isActiveClass(await button.getAttribute('class'))) return true;
    }
  }
  return false;
}

async function subToolActive(page, name) {
  const hosts = [
    page.locator('#chrome-sub-toolbar-host'),
    page.locator('.mobile-pdf-tools__subtools'),
    page.locator('[aria-label="Document tools"]'),
  ];
  for (const host of hosts) {
    if (!(await host.count())) continue;
    const sub = host.getByRole('button', { name, exact: true });
    const count = await sub.count();
    for (let i = 0; i < count; i += 1) {
      const button = sub.nth(i);
      if (!(await button.isVisible().catch(() => false))) continue;
      if (isActiveClass(await button.getAttribute('class'))) return true;
    }
  }
  return false;
}

async function eraserActive(page) {
  for (const name of ['Partial erase', 'Full stroke erase', 'Eraser']) {
    if (await subToolActive(page, name)) return true;
  }
  return false;
}

async function clickEraser(page) {
  for (const name of ['Partial erase', 'Full stroke erase', 'Eraser']) {
    if (await clickNamed(page, name, page.locator('#chrome-sub-toolbar-host'))) return true;
    if (await clickNamed(page, name, page.locator('.mobile-pdf-tools__subtools'))) return true;
    if (await clickNamed(page, name)) return true;
  }
  return false;
}

async function clickSubTool(page, name) {
  if (await clickNamed(page, name, page.locator('#chrome-sub-toolbar-host'))) return true;
  if (await clickNamed(page, name, page.locator('.mobile-pdf-tools__subtools'))) return true;
  return clickNamed(page, name);
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
    layers: [...document.querySelectorAll('button')]
      .filter((el) => /^layers$/i.test((el.getAttribute('aria-label') || el.textContent || '').trim())).length,
    attachments: [...document.querySelectorAll('button')]
      .filter((el) => /^attachments$/i.test((el.getAttribute('aria-label') || el.textContent || '').trim())).length,
    exportAnnotated: [...document.querySelectorAll('button')]
      .filter((el) => /export annotated pdf/i.test(el.getAttribute('aria-label') || el.textContent || '')).length,
    rectangleKey: [...document.querySelectorAll('[data-keyboard-shortcuts-modal="true"] kbd')]
      .filter((el) => el.textContent === 'R').length,
  }));
}

test('desktop toolbar click-to-arm intended + break + edge', async ({ page }) => {
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
  expect(hunt.layers, 'Layers panel compile-hidden').toBe(0);
  expect(hunt.attachments, 'Attachments panel compile-hidden').toBe(0);

  await page.getByRole('button', { name: 'Search text', exact: true }).first().click();
  await expect(page.getByPlaceholder(/Search text/i).first()).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('button', { name: /match case/i }).count(), 'opened Search still has no Match case').toBe(0);
  expect(await page.getByRole('button', { name: /whole word/i }).count(), 'opened Search still has no Whole word').toBe(0);

  await openEditor(page, { url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const marksBefore = await userAnnotationIds(page, 1);
  expect(hunt.exportAnnotated, 'Export annotated PDF chrome is live').toBeGreaterThan(0);

  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists Pen').toMatch(/\bPen\b/);
  expect(overlayText, 'overlay omits Rectangle key').not.toMatch(/Rectangle/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  // Intended — category + sub-row click-to-arm, including no-key Rectangle/Ellipse.
  // Select's caret overlaps the button center; click must still arm Select
  // (was: Pan stayed sticky and only the mode menu opened).
  expect(await clickNamed(page, 'Select')).toBe(true);
  await expect.poll(() => categoryActive(page, 'Select'), { message: 'Select button must arm Select' }).toBe(true);
  expect(await categoryActive(page, 'Pan'), 'Select click must leave Pan').toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-select-mode-menu="true"]')).toHaveCount(0);
  await blurInputs(page);

  expect(await clickNamed(page, 'Draw')).toBe(true);
  await expect.poll(() => categoryActive(page, 'Draw'), { message: 'Draw category click must open Draw' }).toBe(true);
  await expect.poll(() => subToolActive(page, 'Pen'), { message: 'Draw category arms last Draw tool (Pen)' }).toBe(true);

  expect(await clickSubTool(page, 'Highlighter')).toBe(true);
  await expect.poll(() => subToolActive(page, 'Highlighter'), { message: 'Highlighter button must arm Highlighter' }).toBe(true);
  expect(await categoryActive(page, 'Draw'), 'Highlighter keeps Draw').toBe(true);
  expect(await subToolActive(page, 'Pen'), 'Highlighter leaves Pen').toBe(false);

  expect(await clickEraser(page)).toBe(true);
  await expect.poll(() => eraserActive(page), { message: 'Eraser button must arm Eraser' }).toBe(true);

  expect(await clickSubTool(page, 'Pen')).toBe(true);
  await expect.poll(() => subToolActive(page, 'Pen'), { message: 'Pen button must re-arm Pen' }).toBe(true);

  expect(await clickNamed(page, 'Shapes')).toBe(true);
  await expect.poll(() => categoryActive(page, 'Shapes'), { message: 'Shapes category click must open Shapes' }).toBe(true);

  expect(await clickSubTool(page, 'Rectangle')).toBe(true);
  await expect.poll(() => subToolActive(page, 'Rectangle'), { message: 'Rectangle button must arm Rectangle' }).toBe(true);
  expect(await clickSubTool(page, 'Rectangle')).toBe(true);
  expect(await subToolActive(page, 'Rectangle'), 're-click Rectangle stays Rectangle').toBe(true);

  expect(await clickSubTool(page, 'Ellipse')).toBe(true);
  await expect.poll(() => subToolActive(page, 'Ellipse'), { message: 'Ellipse button must arm Ellipse' }).toBe(true);
  expect(await subToolActive(page, 'Rectangle'), 'Ellipse leaves Rectangle').toBe(false);

  expect(await clickSubTool(page, 'Line')).toBe(true);
  await expect.poll(() => subToolActive(page, 'Line'), { message: 'Line button must arm Line' }).toBe(true);

  expect(await clickSubTool(page, 'Arrow')).toBe(true);
  await expect.poll(() => subToolActive(page, 'Arrow'), { message: 'Arrow button must arm Arrow' }).toBe(true);

  expect(await clickSubTool(page, 'Counter')).toBe(true);
  await expect.poll(() => subToolActive(page, 'Counter'), { message: 'Counter button must arm Counter' }).toBe(true);
  await expect.poll(() => counterOverlayCount(page), { message: 'Counter button must mount overlay' }).toBeGreaterThan(0);

  expect(await clickNamed(page, 'Text')).toBe(true);
  await expect.poll(() => categoryActive(page, 'Text'), { message: 'Text category click must open Text' }).toBe(true);
  expect(await page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Note', exact: true }).count(), 'Text strip omits Note').toBe(0);

  expect(await clickSubTool(page, 'Callout')).toBe(true);
  await expect.poll(() => subToolActive(page, 'Callout'), { message: 'Callout button must arm Callout' }).toBe(true);

  expect(await clickSubTool(page, 'Text')).toBe(true);
  await expect.poll(async () => {
    const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
    if (!(await sub.count())) return false;
    return isActiveClass(await sub.first().getAttribute('class'));
  }, { message: 'Text tool button must arm Text' }).toBe(true);

  expect(await clickNamed(page, 'Pan')).toBe(true);
  await expect.poll(() => categoryActive(page, 'Pan'), { message: 'Pan button must arm Pan' }).toBe(true);
  await expect.poll(() => counterOverlayCount(page), { message: 'Pan dismisses counter overlay' }).toBe(0);

  expect(await clickNamed(page, 'Select')).toBe(true);
  await expect.poll(() => categoryActive(page, 'Select'), { message: 'Select after Pan returns Select' }).toBe(true);

  expect(await userAnnotationIds(page, 1), 'toolbar clicks invent 0 annotations').toEqual(marksBefore);

  // Break — keyboard R still does not invent Rectangle (click is the only arm).
  await page.keyboard.press('r');
  expect(await categoryActive(page, 'Select'), 'R after Select stays Select').toBe(true);
  expect(await page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true }).count(), 'R does not invent Rectangle strip').toBe(0);

  // Break — Text strip has no Note / Forms; clicks invent 0.
  expect(await clickNamed(page, 'Text')).toBe(true);
  expect(await page.getByRole('button', { name: 'Note', exact: true }).count(), 'Note create still 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Forms', exact: true }).count(), 'Forms still 0').toBe(0);
  expect(await userAnnotationIds(page, 1), 'break clicks invent 0').toEqual(marksBefore);

  // Break — hubPreview has no Draw; tool buttons invent 0.
  await openEditor(page, { url: HUB });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count(), 'hubPreview has no Draw').toBe(0);
  expect(await page.getByRole('button', { name: 'Rectangle', exact: true }).count(), 'hubPreview has no Rectangle').toBe(0);
  const hubMarks = await page.locator('[data-svg-annotation-layer] > g[data-anno-id]').count();
  await clickNamed(page, 'Draw');
  await clickNamed(page, 'Rectangle');
  await clickNamed(page, 'Counter');
  expect(await page.locator('[data-svg-annotation-layer] > g[data-anno-id]').count(), 'hubPreview tool clicks invent 0').toBe(hubMarks);
  expect(await page.locator('[data-counter-overlay]').count(), 'hubPreview Counter overlay 0').toBe(0);
  await assertNoErrorBoundary(page);

  await openEditor(page, { url: LINK_PDF });
  await blurInputs(page);
  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  console.log('TOOLBAR_TOOL_ARMING_DESKTOP_PROOF', JSON.stringify({
    hunt,
    overlayOmitsRectangle: !/Rectangle/.test(overlayText),
    viewBox,
    fileId,
    marksBefore,
  }));
});

test('390 toolbar click-to-arm edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const marksBefore = await userAnnotationIds(page, 1);
  await expect(page.locator('[aria-label="Document tools"]')).toBeVisible({ timeout: 20_000 });

  expect(await clickNamed(page, 'Shapes')).toBe(true);
  await expect.poll(() => categoryActive(page, 'Shapes'), { message: '390 Shapes category must open' }).toBe(true);
  expect(await clickSubTool(page, 'Rectangle')).toBe(true);
  await expect.poll(() => subToolActive(page, 'Rectangle'), { message: '390 Rectangle button must arm Rectangle' }).toBe(true);

  expect(await clickSubTool(page, 'Ellipse')).toBe(true);
  await expect.poll(() => subToolActive(page, 'Ellipse'), { message: '390 Ellipse button must arm Ellipse' }).toBe(true);

  expect(await clickNamed(page, 'Draw')).toBe(true);
  await expect.poll(() => categoryActive(page, 'Draw'), { message: '390 Draw category must open' }).toBe(true);
  expect(await clickSubTool(page, 'Pen')).toBe(true);
  await expect.poll(() => subToolActive(page, 'Pen'), { message: '390 Pen button must arm Pen' }).toBe(true);

  expect(await clickNamed(page, 'Select')).toBe(true);
  await expect.poll(() => categoryActive(page, 'Select'), { message: '390 Select button must arm Select' }).toBe(true);

  expect(await userAnnotationIds(page, 1), '390 toolbar clicks invent 0').toEqual(marksBefore);

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('TOOLBAR_TOOL_ARMING_390_PROOF', JSON.stringify({
    viewBox,
    fileId,
  }));
});
