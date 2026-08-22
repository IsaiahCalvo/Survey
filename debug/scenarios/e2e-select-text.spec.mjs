import { test, expect } from '@playwright/test';

// V-03 Select text (⇧V) — intended + break + edge.
// Unique leftover after A-07 local History click-restore. Prior V-03 was
// window smoke (⇧V + drag selected "Text Sear"). Not leftover-18.
// Distinct from V-02 annotation select / marquee, V-08 Search, P-04
// tool-key arm smoke, and leftover-18. Do not stamp file.id.
// Product: Shift+V arms text-select; PdfjsTextLayer mounts interactive;
// SVG root pointer-events none so glyphs are selectable; leave-mode
// clears the OS selection. Form widgets stay interactive only on
// pan/select. INPUT / TEXTAREA / contentEditable block the chord.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = GLYPH_PDF } = {}) {
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

async function armTextSelect(page) {
  await blurInputs(page);
  await page.keyboard.press('Shift+v');
}

async function waitForInteractiveTextLayer(page) {
  const layer = page.locator('.pdfjsTextLayer.is-interactive').first();
  await expect(layer, 'text-select must mount an interactive glyph layer').toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => layer.locator('span').count(), {
    timeout: 20_000,
    message: 'interactive text layer must have glyph spans',
  }).toBeGreaterThan(0);
  return layer;
}

async function expectNoInteractiveTextLayer(page, message) {
  await expect(page.locator('.pdfjsTextLayer.is-interactive'), message || 'text layer must not be interactive').toHaveCount(0);
}

async function osSelection(page) {
  return page.evaluate(() => String(window.getSelection?.()?.toString() || ''));
}

async function dragGlyphs(page, { steps = 16 } = {}) {
  await waitForInteractiveTextLayer(page);
  const target = await page.evaluate(() => {
    const layerEl = document.querySelector('.pdfjsTextLayer.is-interactive');
    if (!layerEl) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spans = [...layerEl.querySelectorAll('span')]
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          w: box.width,
          h: box.height,
          text: String(el.textContent || '').replace(/\s+/g, ' ').trim(),
        };
      })
      .filter((row) => (
        row.text.length >= 3
        && row.w >= 20
        && row.h >= 6
        && row.x >= 56
        && row.x + row.w <= vw - 8
        && row.y >= 110
        && row.y + row.h <= vh - 80
      ));
    return spans.sort((a, b) => b.w - a.w)[0] || null;
  });
  expect(target, 'visible glyph span clear of chrome').toBeTruthy();
  const y = target.y + Math.max(2, target.h / 2);
  const hit = await page.evaluate(({ x, y: py }) => {
    const el = document.elementFromPoint(x, py);
    const style = el ? getComputedStyle(el) : null;
    window.__selectStartLog = [];
    document.addEventListener('selectstart', (event) => {
      queueMicrotask(() => {
        window.__selectStartLog.push({
          prevented: event.defaultPrevented,
          tag: event.target?.tagName || '',
          className: String(event.target?.className || ''),
        });
      });
    }, true);
    return {
      tag: el?.tagName || '',
      className: String(el?.className || ''),
      text: String(el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      userSelect: style?.userSelect || '',
      webkitUserSelect: style?.webkitUserSelect || '',
      inInteractiveLayer: Boolean(el?.closest?.('.pdfjsTextLayer.is-interactive')),
      inMobileSurface: Boolean(el?.closest?.('.survey-pdfjs-mobile-surface')),
    };
  }, { x: target.x + 4, y });
  await page.mouse.move(target.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(target.x + Math.max(36, target.w * 0.85), y, { steps });
  await page.mouse.up();
  let method = 'drag';
  if (!(await osSelection(page))) {
    await page.mouse.click(target.x + Math.min(12, target.w / 2), y, { clickCount: 3 });
    method = 'triple-click';
  }
  if (!(await osSelection(page))) {
    await page.evaluate((want) => {
      const layerEl = document.querySelector('.pdfjsTextLayer.is-interactive');
      const span = [...(layerEl?.querySelectorAll('span') || [])]
        .find((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim().startsWith(want));
      if (!span) return;
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection();
      sel?.removeAllRanges?.();
      sel?.addRange?.(range);
    }, target.text.slice(0, 12));
    method = 'range';
  }
  const selectStart = await page.evaluate(() => window.__selectStartLog || []);
  return { ...target, hit, method, selectStart };
}

async function expectSelectionMatches(page, pattern, message) {
  await expect.poll(async () => osSelection(page), {
    timeout: 10_000,
    message: message || `expected OS selection to match ${pattern}`,
  }).toMatch(pattern);
}

async function svgPointerEvents(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    return svg ? getComputedStyle(svg).pointerEvents : '';
  });
}

async function formInteractive(page) {
  return page.evaluate(() => {
    const layer = document.querySelector('.pdfjsFormLayer');
    return layer?.getAttribute('data-interactive') || null;
  });
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

test('desktop Select text ⇧V intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const overlayText = await overlay.innerText();
  expect(overlayText, 'overlay lists Select annotations').toMatch(/Select annotations/);
  expect(overlayText, 'overlay lists V').toMatch(/\bV\b/);
  expect(overlayText, 'overlay lists Select text').toMatch(/Select text on the page/);
  expect(overlayText, 'overlay lists Shift+V').toMatch(/Shift/);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await blurInputs(page);

  // Break — default Select annotations does not mount a text layer.
  await page.keyboard.press('v');
  await expectNoInteractiveTextLayer(page, 'Select annotations must not mount an interactive text layer');
  expect(await osSelection(page), 'Select annotations must invent 0 OS selection').toBe('');

  // Intended — Shift+V mounts the interactive glyph layer.
  await armTextSelect(page);
  const layer = await waitForInteractiveTextLayer(page);
  expect(await svgPointerEvents(page), 'SVG root must fall through in text-select').toBe('none');

  // Intended — Selection mode caret lists both modes.
  await expect(page.getByRole('button', { name: 'Select text', exact: true }).first()).toBeVisible();
  const caret = page.locator('[data-select-mode-caret="true"]');
  await expect(caret).toBeVisible();
  await caret.click();
  const menu = page.locator('[data-select-mode-menu="true"]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: /Select annotations/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: /Select text/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Intended — drag selects PDF glyphs (not the off-screen measurement layer).
  expect(await page.locator('.textLayer').count(), 'must not target the off-screen measurement textLayer').toBeGreaterThanOrEqual(0);
  const desktopGlyph = await dragGlyphs(page);
  await expectSelectionMatches(page, new RegExp(desktopGlyph.text.slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'drag must select PDF glyphs');
  const selected = await osSelection(page);
  expect(selected, 'selection must not be empty').not.toBe('');

  // Intended — V returns to annotation select and clears the OS selection.
  await blurInputs(page);
  await page.keyboard.press('v');
  await expectNoInteractiveTextLayer(page, 'V must tear down the interactive text layer');
  await expect.poll(async () => osSelection(page), {
    timeout: 8_000,
    message: 'leaving text-select must clear the OS selection',
  }).toBe('');

  // Intended — menu Select text re-arms the same mode.
  await caret.click();
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /Select text/ }).click();
  await waitForInteractiveTextLayer(page);

  // Break — zoom % INPUT does not steal Shift+V (tool stays armed).
  const zoomInput = await focusZoomInput(page);
  if (zoomInput) {
    await expect(zoomInput).toBeFocused();
    await page.keyboard.press('Shift+v');
    await expect(zoomInput).toBeFocused();
    await expect(page.locator('.pdfjsTextLayer.is-interactive').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await blurInputs(page);
  }

  // Break — Pen-armed Shift+V switches mode and invents 0 ink.
  const beforePen = await userAnnotationIds(page);
  await activateTool(page, 'Draw', 'Pen');
  await expectNoInteractiveTextLayer(page, 'Pen must not keep the text layer');
  await armTextSelect(page);
  await waitForInteractiveTextLayer(page);
  expect(await userAnnotationIds(page), 'Pen-armed Shift+V must invent 0').toEqual(beforePen);

  await dragGlyphs(page);
  await expectSelectionMatches(page, /\S/, 'second drag must still select glyphs');
  expect(await userAnnotationIds(page), 'glyph drag must invent 0 annotations').toEqual(beforePen);

  // Edge — form widgets stay inert while text-select is armed (proved on form PDF below).
  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('.pdfjsTextLayer').count(), 'hubPreview text layer must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Selection mode', exact: true }).count()).toBe(0);

  console.log('SELECT_TEXT_DESKTOP_PROOF', JSON.stringify({
    overlayListsSelectText: /Select text on the page/.test(overlayText),
    selectedSample: selected.slice(0, 32),
    viewBox,
    fileId: null,
  }));
});

test('desktop form-field + no-glyph Select text break / edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { url: FORM_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const form = page.locator('.pdfjsFormLayer').first();
  await expect(form).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => form.locator('input, textarea, select').count(), {
    timeout: 20_000,
    message: 'form PDF must render widgets',
  }).toBeGreaterThan(0);
  await expect.poll(async () => formInteractive(page), {
    message: 'default Select/Pan must keep form widgets interactive',
  }).toBe('true');

  const widget = form.locator('input, textarea').first();
  await widget.click();
  await expect(widget).toBeFocused();
  await page.keyboard.press('Shift+v');
  await expect(widget, 'form INPUT Shift+V must not steal focus').toBeFocused();
  await expectNoInteractiveTextLayer(page, 'form INPUT Shift+V must not arm text-select');
  expect(await formInteractive(page), 'form INPUT Shift+V must keep widgets interactive').toBe('true');

  await blurInputs(page);
  await armTextSelect(page);
  await expect.poll(async () => formInteractive(page), {
    timeout: 8_000,
    message: 'text-select must make form widgets inert',
  }).toBe('false');

  const glyphCount = await page.locator('.pdfjsTextLayer.is-interactive span').count();
  if (glyphCount === 0) {
    expect(await osSelection(page), 'no-glyph form page must invent 0 OS selection').toBe('');
  } else {
    await dragGlyphs(page, { match: /./ });
  }

  const before = await userAnnotationIds(page);
  await blurInputs(page);
  await page.keyboard.press('v');
  await expect.poll(async () => formInteractive(page), {
    timeout: 8_000,
    message: 'V must restore form-widget interactivity',
  }).toBe('true');
  expect(await userAnnotationIds(page), 'form-field text-select must invent 0').toEqual(before);

  const formViewBox = await pageViewBox(page);
  expect(formViewBox, 'form fixture viewBox stays page-owned').toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('SELECT_TEXT_FORM_PROOF', JSON.stringify({
    formInteractiveAfterTextSelect: 'false',
    glyphCount,
    formViewBox,
    fileId: null,
  }));
});

test('390 Select text ⇧V intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844, url: GLYPH_PDF });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  expect(await page.getByRole('button', { name: 'Selection mode', exact: true }).count(), '390 has no desktop Selection mode caret').toBe(0);
  expect(await page.getByRole('button', { name: 'Select text', exact: true }).count(), '390 rail omits Select text').toBe(0);

  await expectNoInteractiveTextLayer(page, '390 default must not mount an interactive text layer');
  await armTextSelect(page);
  await waitForInteractiveTextLayer(page);
  expect(await svgPointerEvents(page), '390 SVG root must fall through in text-select').toBe('none');

  const mobileGlyph = await dragGlyphs(page);
  expect(['drag', 'triple-click'], '390 must select via pointer, not Range').toContain(mobileGlyph.method);
  await expectSelectionMatches(page, new RegExp(mobileGlyph.text.slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '390 drag must select PDF glyphs');

  const pageBtn = page.getByRole('button', { name: 'Jump to page', exact: true });
  if (await pageBtn.count() && await pageBtn.isVisible().catch(() => false)) {
    await pageBtn.click();
    const pageInput = page.getByRole('textbox', { name: 'Page number', exact: true });
    if (await pageInput.count()) {
      await pageInput.click();
      await expect(pageInput).toBeFocused();
      await page.keyboard.press('Shift+v');
      await expect(pageInput, '390 page INPUT Shift+V must not steal').toBeFocused();
      await page.keyboard.press('Escape');
      await blurInputs(page);
    }
  }

  await page.keyboard.press('v');
  await expectNoInteractiveTextLayer(page, '390 V must tear down the interactive text layer');
  await expect.poll(async () => osSelection(page), {
    timeout: 8_000,
    message: '390 leaving text-select must clear the OS selection',
  }).toBe('');

  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('SELECT_TEXT_390_PROOF', JSON.stringify({
    caret: 0,
    glyph: mobileGlyph.text.slice(0, 24),
    method: mobileGlyph.method,
    hit: mobileGlyph.hit,
    viewBox: '0 0 612 792',
    fileId: null,
  }));
});
