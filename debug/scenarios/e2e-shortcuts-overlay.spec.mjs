import { test, expect } from '@playwright/test';

// V-09 shortcuts overlay — intended + break + edge.
// Unique leftover after V-03 Select text. Prior V-09 was `?` then Esc
// smoke (matrix + window), then a documented INPUT steal. This pass
// guards useKeyPress so `?` in INPUT / TEXTAREA / contentEditable stays
// in the field. Not leftover-18. Distinct from P-04 tool-key arm,
// V-05/V-08/E-05 catalog samples, and leftover-18. Do not stamp file.id.
// Product: `?` toggles; Esc / click-outside / Close dismiss; zoom % and
// Search keep `?` / do not open the overlay. Catalog is the hardcoded
// list — Duplicate is not a live annotation chord and stays
// omitted. Ctrl+M Manual lock is listed
// next to the Fit siblings (live chord, same class as Shift+E).
// Ctrl+S Save document is listed next to Search text (live chord).
// F3 Find next is listed next to Search text (live chord).
// Shift+F3 Find previous is listed next to Find next (live chord).
// Ctrl+Z Undo / Ctrl+Shift+Z Redo are listed next to Save (live chords).
// Delete selected is listed next to Undo/Redo (live chord).
// Bring to front is listed next to Delete (live z-order chord).
// Send to back is listed next to Bring to front (live z-order chord).

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const LISTED = [
  'Previous/Next page',
  'First page',
  'Last page',
  'Zoom in',
  'Zoom out',
  'Fit page',
  'Fit width',
  'Fit height',
  'Manual lock',
  'Open document',
  'Save document',
  'Undo',
  'Redo',
  'Delete selected',
  'Bring to front',
  'Send to back',
  'Search text',
  'Find next',
  'Find previous',
  'Select annotations',
  'Select text on the page',
  'Pen',
  'Highlighter',
  'Eraser',
  'Partial erase',
  'Text',
  'Callout',
  'Line',
  'Arrow',
  'Counter',
  'Toggle sidebar',
  'Toggle shortcuts',
  'Close dialogs/cancel',
];

const OMITTED = [
  /\bDuplicate\b/i,
  /Bring forward/i,
  /Send backward/i,
  /Select all/i,
];

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
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

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
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

function overlay(page) {
  return page.locator('[data-keyboard-shortcuts-modal="true"]');
}

async function assertCatalog(text, label) {
  for (const row of LISTED) {
    expect(text, `${label} lists ${row}`).toContain(row);
  }
  expect(text, `${label} lists Navigation`).toMatch(/NAVIGATION/i);
  expect(text, `${label} lists Actions`).toMatch(/ACTIONS/i);
  expect(text, `${label} lists Tools`).toMatch(/TOOLS/i);
  expect(text, `${label} lists Interface`).toMatch(/INTERFACE/i);
  expect(text, `${label} lists Shift\\+V`).toMatch(/Shift/);
  expect(text, `${label} lists Esc`).toMatch(/Esc/);
  for (const pattern of OMITTED) {
    expect(text, `${label} must omit ${pattern}`).not.toMatch(pattern);
  }
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

test('desktop shortcuts overlay intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const idsBefore = await userAnnotationIds(page);
  expect(idsBefore, 'fresh editor must invent 0 user marks').toEqual([]);

  // Intended — `?` opens; lists the real catalog; Close is autofocused.
  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts', exact: true })).toBeVisible();
  const catalog = await modal.innerText();
  await assertCatalog(catalog, 'desktop overlay');
  const closeBtn = page.getByRole('button', { name: 'Close', exact: true });
  await expect(closeBtn).toBeFocused();

  // Intended — Esc dismisses (focus trap owns Escape).
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  // Intended — overlay can be reopened.
  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible({ timeout: 8_000 });

  // Break — second `?` toggles closed.
  await page.keyboard.press('?');
  await expect(modal).toHaveCount(0);

  // Intended — click-outside (backdrop, not the panel) dismisses.
  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await modal.click({ position: { x: 8, y: 8 } });
  await expect(modal).toHaveCount(0);

  // Intended — Close button dismisses; reopen still works.
  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await closeBtn.click();
  await expect(modal).toHaveCount(0);
  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  // Break — zoom % is an INPUT. `?` must stay in the field (digits-only
  // filter drops the glyph) and must not open the overlay.
  const zoomInput = await focusZoomInput(page);
  expect(zoomInput, 'desktop zoom % INPUT').toBeTruthy();
  await expect(zoomInput).toBeFocused();
  const zoomBefore = await zoomInput.inputValue();
  await page.keyboard.press('?');
  await expect(modal, 'zoom INPUT `?` must not open overlay').toHaveCount(0);
  await expect(zoomInput).toBeFocused();
  expect(await zoomInput.inputValue(), 'zoom INPUT keeps its value; digits-only drops `?`').toBe(zoomBefore);

  // Break — Search is a text INPUT. `?` must stay in the query and must
  // not open the overlay.
  await blurInputs(page);
  await page.keyboard.press('Control+f');
  const search = page.getByPlaceholder('Search text in PDF...');
  await expect(search).toBeVisible({ timeout: 8_000 });
  await expect(search).toBeFocused();
  const searchBefore = await search.inputValue();
  await page.keyboard.press('?');
  await expect(modal, 'search INPUT `?` must not open overlay').toHaveCount(0);
  await expect(search).toBeFocused();
  expect(await search.inputValue(), 'search INPUT must keep the `?` character').toBe(`${searchBefore}?`);

  // Edge — opening/closing the overlay invents 0 marks; file.id stays null.
  expect(await userAnnotationIds(page), 'overlay must invent 0 marks').toEqual(idsBefore);
  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  // Isolation — hubPreview is a standalone HubPreview mount (no AppShell).
  // Overlay lives on AppShell home + DevTestRoute remount, so `?` invents 0.
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);
  await blurInputs(page);
  await page.keyboard.press('?');
  expect(await overlay(page).count(), 'hubPreview must not mount the overlay').toBe(0);

  console.log('SHORTCUTS_OVERLAY_DESKTOP_PROOF', JSON.stringify({
    listed: LISTED.length,
    listedUndoRedo: /\bUndo\b/.test(catalog) && /\bRedo\b/.test(catalog),
    viewBox,
    fileId: await fileId(page),
  }));
});

test('390 shortcuts overlay intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('?');
  const modal = overlay(page);
  await expect(modal, '390 overlay exists').toBeVisible({ timeout: 8_000 });
  const catalog = await modal.innerText();
  await assertCatalog(catalog, '390 overlay');

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await page.keyboard.press('?');
  await expect(modal, '390 second `?` toggles closed').toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await modal.click({ position: { x: 8, y: 8 } });
  await expect(modal, '390 click-outside dismisses').toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(modal).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(modal).toHaveCount(0);

  const jump = page.getByRole('button', { name: 'Jump to page', exact: true });
  if (await jump.count() && await jump.isVisible().catch(() => false)) {
    await jump.click();
    const pageInput = page.getByRole('textbox', { name: 'Page number', exact: true });
    await expect(pageInput).toBeVisible();
    await pageInput.click();
    const pageBefore = await pageInput.inputValue();
    await page.keyboard.press('?');
    await expect(modal, '390 page INPUT `?` must not open overlay').toHaveCount(0);
    await expect(pageInput).toBeFocused();
    expect(await pageInput.inputValue(), '390 page INPUT keeps its value; digits-only drops `?`').toBe(pageBefore);
  }

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(await userAnnotationIds(page)).toEqual([]);
  await assertNoErrorBoundary(page);

  console.log('SHORTCUTS_OVERLAY_390_PROOF', JSON.stringify({
    listed: LISTED.length,
    viewBox,
    fileId: await fileId(page),
  }));
});
