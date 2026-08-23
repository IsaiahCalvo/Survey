import { test, expect } from '@playwright/test';

// T-01 leftover: live Textbox rubber-band then auto-edit mount.
// Prior T-01 dedicated create auto-edit (Hello / tight-fit / wrap /
// Escape / blank discard / re-edit) + selected bbox resize / canvas mtr.
// This pass asserts the in-drag `[data-text-preview]` dashed box
// (10px gate) then pointerup `setEditingAnnotation({ isNewText: true })`.
// Distinct from leftover-18, T-01 auto-edit type/commit, selected resize,
// T-02 `.callout-preview`, S-01/S-02 filled g, S-03/S-04 line preview,
// D-01/D-02 freehand. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

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
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
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

async function pageCoveredByHub(page) {
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pageEl.boundingBox();
  if (!box) return false;
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const text = el?.textContent || '';
    return /No documents yet|Upload your first PDF|Search documents/.test(text);
  }, { x: box.x + box.width * 0.45, y: box.y + box.height * 0.40 });
}

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  const hubCopy = page.getByText('No documents yet');
  if (await hubCopy.isVisible().catch(() => false) || await pageCoveredByHub(page)) {
    const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
    if (await rail.first().isVisible().catch(() => false)) {
      await rail.first().click().catch(() => {});
    } else {
      const tab = page.getByRole('button', { name: /clickable-link-test\.pdf/ }).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click({ position: { x: 24, y: 8 } }).catch(() => {});
      }
    }
    await expect(hubCopy).toHaveCount(0, { timeout: 8_000 });
  }
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const overlay = page.locator(`[data-text-overlay="${pageNumber}"]`);
  const target = (await overlay.count())
    ? overlay.first()
    : page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  const box = await target.boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  return raw || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

function liveTextPreview(page) {
  return page.locator('[data-text-overlay="1"] [data-text-preview]');
}

function liveCalloutPreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] g.callout-preview');
}

function liveBoundaryPreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] g.shape-creation-preview');
}

function liveLinePreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] line.shape-creation-preview');
}

function isTextRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  if (row?.callout === true || type === 'callout' || tool === 'callout') return false;
  return type === 'textbox' || type === 'text' || tool === 'text';
}

async function annotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set([
      ...[...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
        .map((group) => group.getAttribute('data-anno-id')),
    ].filter(Boolean))];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      if (object.isPdfImported === true || /^\d+R$/i.test(String(id || ''))) return null;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        callout: object.data?.type === 'callout'
          || String(id).startsWith('callout-')
          || object.callout === true,
        text: String(object.text ?? data.text ?? ''),
        width: Number(object.width || 0) * Math.abs(Number(object.scaleX) || 1),
        height: Number(object.height || 0) * Math.abs(Number(object.scaleY) || 1),
        fontFamily: String(object.fontFamily || data.fontFamily || ''),
      };
    }).filter(Boolean);
  }, pageNumber);
}

async function textRows(page) {
  return (await annotationSnapshot(page)).filter(isTextRow);
}

async function textIds(page) {
  return (await textRows(page)).map((row) => row.id);
}

async function geom(page, id) {
  return (await textRows(page)).find((row) => row.id === id) || null;
}

async function waitForNewText(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await textRows(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isTextRow(row)) || null;
    return created;
  }, { message: 'expected a new textbox' }).not.toBeNull();
  return created;
}

async function previewPainted(page) {
  const preview = liveTextPreview(page);
  if (!(await preview.count())) return false;
  return preview.evaluate((el) => el.style.display === 'block' || getComputedStyle(el).display === 'block');
}

async function previewInfo(page) {
  const preview = liveTextPreview(page);
  if (!(await preview.count())) return null;
  return preview.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      inlineDisplay: el.style.display || '',
      computedDisplay: style.display,
      borderStyle: style.borderTopStyle || '',
      borderColor: style.borderTopColor || '',
      width: parseFloat(el.style.width || '0'),
      height: parseFloat(el.style.height || '0'),
      background: el.style.backgroundColor || style.backgroundColor || '',
    };
  });
}

function toolButtons(page, name) {
  return page.locator(
    `button.btn-icon[aria-label="${name}"], button.mobile-pdf-tools__button[aria-label="${name}"]`,
  );
}

async function clickVisible(page, name) {
  const buttons = toolButtons(page, name);
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    return button;
  }
  const fallback = page.getByRole('button', { name, exact: true });
  await expect(fallback.first(), `visible ${name}`).toBeVisible();
  await fallback.first().click();
  return fallback.first();
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
  await clickVisible(page, categoryName);
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const scoped = toolButtons(page, 'Select');
  if (await scoped.count() && await scoped.first().isVisible().catch(() => false)) {
    await scoped.first().click();
  }
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
  await expect.poll(async () => page.locator('[data-text-overlay="1"]').count(), {
    timeout: 8_000,
    message: 'Select must drop the Text draw overlay',
  }).toBe(0);
}

async function armText(page) {
  await dismissChrome(page);
  // PDFViewer skips pointerdown for 300ms after an edit commit
  // (editModeCooldownRef). Without this wait the next drag is a no-op.
  await page.waitForTimeout(350);
  await activateTool(page, 'Text', 'Text');
  await expect(page.locator('[data-text-overlay="1"]').first()).toBeVisible({ timeout: 8_000 });
}

async function startLiveTextbox(page, { x0 = 0.18, y0 = 0.22, x1 = 0.46, y1 = 0.36 } = {}) {
  const box = await pageBox(page);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const mid = {
    x: box.x + box.width * ((x0 + x1) / 2),
    y: box.y + box.height * ((y0 + y1) / 2),
  };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 8 });
  await expect.poll(async () => previewPainted(page), {
    timeout: 5_000,
    message: 'live textbox preview must paint before pointerup',
  }).toBe(true);
  return { box, start, mid, end };
}

async function persistOpenText(page, text = 'A') {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  const pageGeom = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  expect(pageGeom, 'page geometry for click-out').toBeTruthy();
  await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.mouse.click(pageGeom.x + pageGeom.width - 12, pageGeom.y + pageGeom.height - 12);
  }
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);
}

async function undoUntilGone(page, id) {
  await blurInputs(page);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  for (let i = 0; i < 6; i += 1) {
    if (!(await textIds(page)).includes(id)) return;
    await undo.click();
  }
}

async function redoUntilPresent(page, id) {
  await blurInputs(page);
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await expect(redo).toBeVisible();
  for (let i = 0; i < 6; i += 1) {
    if ((await textIds(page)).includes(id)) return;
    await redo.click();
  }
}

test('desktop textbox live create intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  await selectMode(page);
  const emptyBefore = await textIds(page);
  expect(await liveTextPreview(page).count(), 'empty page live text preview 0').toBe(0);
  const emptyBox = await pageBox(page);
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.10, emptyBox.y + emptyBox.height * 0.12);
  await page.mouse.down();
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.18, emptyBox.y + emptyBox.height * 0.20, { steps: 8 });
  expect(await previewPainted(page), 'Select drag must not paint text preview').toBe(false);
  await page.mouse.up();
  expect(await textIds(page), 'empty Select drag invents 0').toEqual(emptyBefore);
  expect(await liveTextPreview(page).count(), 'Select drag must not leave a text preview').toBe(0);

  // Intended — live dashed rubber-band during drag, overlay mounts on pointerup.
  const beforeA = new Set(await textIds(page));
  await armText(page);
  await blurInputs(page);
  const dragA = await startLiveTextbox(page, { x0: 0.16, y0: 0.20, x1: 0.48, y1: 0.36 });
  expect(await textIds(page), 'Text live drag must not commit yet').toEqual([...beforeA]);
  expect(await page.locator('[data-text-edit-overlay]').count(), 'Text live drag must not mount auto-edit yet').toBe(0);
  expect(await liveBoundaryPreview(page).count(), 'Text preview is not the Rect/Ellipse g path').toBe(0);
  expect(await liveLinePreview(page).count(), 'Text preview is not the Line/Arrow path').toBe(0);
  expect(await liveCalloutPreview(page).count(), 'Text preview is not the Callout path').toBe(0);
  const liveA = await previewInfo(page);
  expect(liveA?.inlineDisplay, 'rubber-band display is block during drag').toBe('block');
  expect(liveA?.borderStyle, 'rubber-band is dashed (not Style [6,4])').toBe('dashed');
  expect(liveA?.width, 'rubber-band width follows the drag').toBeGreaterThan(10);
  expect(liveA?.height, 'rubber-band height follows the drag').toBeGreaterThan(10);
  expect(liveA?.background, 'rubber-band keeps a translucent fill').toMatch(/rgba?\(/);
  await page.mouse.move(dragA.end.x, dragA.end.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => previewPainted(page), {
    timeout: 5_000,
    message: 'Text pointerup must drop the rubber-band',
  }).toBe(false);
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first(), 'pointerup mounts T-01 auto-edit').toBeVisible({ timeout: 10_000 });
  await persistOpenText(page, 'A');
  const textA = await waitForNewText(page, beforeA);
  expect(textA.text, 'keep-alive glyph must commit A').toBe('A');
  expect(textA.fontFamily, 'create stamps a single-name fontFamily').toBe('Helvetica');
  expect(textA.width, 'rubber-band commit stamps a drag width').toBeGreaterThan(8);
  await selectMode(page);
  const a0 = await geom(page, textA.id);
  expect(a0, 'persisted Textbox A must still exist').toBeTruthy();

  await undoUntilGone(page, textA.id);
  await expect.poll(async () => (await textIds(page)).includes(textA.id), {
    message: 'undo must restore by dropping Textbox',
  }).toBe(false);
  await redoUntilPresent(page, textA.id);
  await expect.poll(async () => (await textIds(page)).includes(textA.id), {
    message: 'redo must restore Textbox',
  }).toBe(true);

  // Intended — second live create isolates A.
  await armText(page);
  await blurInputs(page);
  const beforeB = new Set(await textIds(page));
  const dragB = await startLiveTextbox(page, { x0: 0.52, y0: 0.22, x1: 0.80, y1: 0.38 });
  expect(await textIds(page), 'second Text live drag must not commit yet').toEqual([...beforeB]);
  const liveB = await previewInfo(page);
  expect(liveB?.borderStyle, 'second rubber-band is dashed').toBe('dashed');
  await page.mouse.move(dragB.end.x, dragB.end.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => previewPainted(page), {
    timeout: 5_000,
    message: 'second pointerup must drop the rubber-band',
  }).toBe(false);
  await persistOpenText(page, 'B');
  const textB = await waitForNewText(page, beforeB);
  const a1 = await geom(page, textA.id);
  expect(a1.width, 'second commit must isolate A width').toBeCloseTo(a0.width, 1);
  expect(a1.height, 'second commit must isolate A height').toBeCloseTo(a0.height, 1);
  expect(a1.text, 'second commit must isolate A text').toBe('A');
  expect(textB.text, 'second commit must stamp B').toBe('B');

  // Break — sub-10px drag does not paint the rubber-band (click-to-place
  // overlay is T-01, discarded here so this leftover stays the band).
  await armText(page);
  await blurInputs(page);
  const beforeTiny = new Set(await textIds(page));
  const tinyBox = await pageBox(page);
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.12, tinyBox.y + tinyBox.height * 0.52);
  await page.mouse.down();
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.12 + 4, tinyBox.y + tinyBox.height * 0.52 + 3);
  expect(await previewPainted(page), 'sub-10px drag must not paint the rubber-band').toBe(false);
  await page.mouse.up();
  await expect.poll(async () => previewPainted(page), {
    timeout: 5_000,
    message: 'tiny click must drop any rubber-band',
  }).toBe(false);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  }
  expect(await textIds(page), 'tiny click / click-to-place discard must invent 0').toEqual([...beforeTiny]);

  // Break — tool-switch mid-drag clears the preview (never commits).
  await armText(page);
  await blurInputs(page);
  const beforeSwitch = new Set(await textIds(page));
  await startLiveTextbox(page, { x0: 0.16, y0: 0.56, x1: 0.34, y1: 0.68 });
  await page.keyboard.press('v');
  await expect.poll(async () => previewPainted(page), {
    timeout: 5_000,
    message: 'tool-switch mid-drag must drop the rubber-band',
  }).toBe(false);
  await page.mouse.up().catch(() => {});
  expect(await page.locator('[data-text-edit-overlay]').count(), 'tool-switch mid-drag must not mount auto-edit').toBe(0);
  expect(await textIds(page), 'tool-switch mid-drag must invent 0').toEqual([...beforeSwitch]);

  // Break — zoom mid-drag does NOT flush the rubber-band (DOM overlay keep-track).
  await armText(page);
  await blurInputs(page);
  const beforeZoom = new Set(await textIds(page));
  const zoomDrag = await startLiveTextbox(page, { x0: 0.18, y0: 0.70, x1: 0.42, y1: 0.84 });
  expect(await textIds(page), 'zoom mid-drag starts uncommitted').toEqual([...beforeZoom]);
  expect(await page.locator('[data-text-edit-overlay]').count(), 'zoom mid-drag must not mount auto-edit yet').toBe(0);
  await page.keyboard.press('Control+=');
  await expect.poll(async () => (await textIds(page)).join(','), {
    timeout: 3_000,
    message: 'zoom mid-drag must not flush a drag-out textbox',
  }).toBe([...beforeZoom].join(','));
  expect(
    (await previewPainted(page))
    || (await textIds(page)).length === beforeZoom.size,
    'zoom mid-drag must keep tracking or stay uncommitted',
  ).toBeTruthy();
  await page.mouse.move(zoomDrag.end.x, zoomDrag.end.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first(), 'zoom then pointerup mounts auto-edit').toBeVisible({ timeout: 10_000 });
  await persistOpenText(page, 'Z');
  const zoomText = await waitForNewText(page, beforeZoom);
  await expect.poll(async () => previewPainted(page), {
    timeout: 5_000,
    message: 'zoom then pointerup must drop the rubber-band',
  }).toBe(false);
  const afterZoomUp = await textIds(page);
  expect(afterZoomUp.filter((id) => !beforeZoom.has(id)).length, 'zoom keep-track + pointerup must not double-commit').toBe(1);
  expect(afterZoomUp.includes(zoomText.id), 'zoom mid-drag then pointerup must commit one Textbox').toBe(true);
  expect(afterZoomUp.includes(textA.id), 'zoom keep-track must isolate earlier Textbox A').toBe(true);
  expect(afterZoomUp.includes(textB.id), 'zoom keep-track must isolate Textbox B').toBe(true);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Text', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);
  expect(await liveTextPreview(page).count()).toBe(0);

  console.log('TEXTBOX_LIVE_CREATE_DESKTOP_PROOF', JSON.stringify({
    textA: textA.id,
    textB: textB.id,
    zoomText: zoomText.id,
    width: textA.width,
    height: textA.height,
    fontFamily: textA.fontFamily,
    viewBox,
    fileId: null,
  }));
});

test('390 textbox live create intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const emptyBefore = await textIds(page);
  await selectMode(page);
  expect(await liveTextPreview(page).count(), '390 empty live text preview 0').toBe(0);
  const emptyBox = await pageBox(page);
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.12, emptyBox.y + emptyBox.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(emptyBox.x + emptyBox.width * 0.22, emptyBox.y + emptyBox.height * 0.24, { steps: 8 });
  await page.mouse.up();
  expect(await textIds(page), '390 empty Select drag invents 0').toEqual(emptyBefore);

  const beforeA = new Set(await textIds(page));
  await armText(page);
  const dragA = await startLiveTextbox(page, { x0: 0.16, y0: 0.24, x1: 0.62, y1: 0.40 });
  expect(await textIds(page), '390 Text live drag must not commit yet').toEqual([...beforeA]);
  const liveA = await previewInfo(page);
  expect(liveA?.inlineDisplay, '390 rubber-band display is block').toBe('block');
  expect(liveA?.borderStyle, '390 rubber-band is dashed').toBe('dashed');
  await page.mouse.move(dragA.end.x, dragA.end.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => previewPainted(page), {
    timeout: 5_000,
    message: '390 Text pointerup must drop the rubber-band',
  }).toBe(false);
  await persistOpenText(page, 'A');
  const textA = await waitForNewText(page, beforeA);
  const a0 = await geom(page, textA.id);

  await armText(page);
  const beforeB = new Set(await textIds(page));
  const dragB = await startLiveTextbox(page, { x0: 0.18, y0: 0.52, x1: 0.62, y1: 0.68 });
  const liveB = await previewInfo(page);
  expect(liveB?.inlineDisplay, '390 second rubber-band must paint').toBe('block');
  await page.mouse.move(dragB.end.x, dragB.end.y, { steps: 6 });
  await page.mouse.up();
  await persistOpenText(page, 'B');
  const textB = await waitForNewText(page, beforeB);
  const a1 = await geom(page, textA.id);
  expect(a1.width, '390 second commit must isolate A').toBeCloseTo(a0.width, 1);
  expect(textB.width, '390 second commit must stamp a drag width').toBeGreaterThan(8);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('TEXTBOX_LIVE_CREATE_390_PROOF', JSON.stringify({
    textA: textA.id,
    textB: textB.id,
    viewBox,
    fileId: null,
  }));
});
