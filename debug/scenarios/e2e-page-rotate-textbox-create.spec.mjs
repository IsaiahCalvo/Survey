import { test, expect } from '@playwright/test';

// Create a Textbox AFTER the page is already CW-rotated (viewBox 0 0 792 612).
// 52d001fd proved rect+pen via screenToSVG. e8a2e61a proved callout fractions.
// 7beeebd8 proved line bbox + CENTER-relative x1..y2. Textbox is a different
// click-to-place / rubber-band path: [data-text-preview] then
// setEditingAnnotation({ isNewText: true }) — not SHAPE_CREATION_TOOLS.
// Distinct from leftover-18 / X-01 / remapped rect/callout/ink/counter/
// survey-marker/midpoint / remapped mt/mtr/br / remapped-page export /
// rect+pen create / callout create / line create. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const TEXT_BOX = { x0: 0.18, y0: 0.24, x1: 0.52, y1: 0.40 };

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
          || key.startsWith('pdfSidebar_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
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

async function closeDocumentPanel(page) {
  const backdrop = page.getByRole('button', { name: 'Close document panel' });
  if (await backdrop.first().isVisible().catch(() => false)) {
    await backdrop.first().click().catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  await closeDocumentPanel(page);
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hubCopy = page.getByText('No documents yet');
    if (!(await hubCopy.isVisible().catch(() => false)) && !(await pageCoveredByHub(page))) break;
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
  await expect.poll(async () => pageCoveredByHub(page), {
    timeout: 8_000,
    message: 'hub Documents must not cover the page',
  }).toBe(false);
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
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
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
        left: Number(object.left ?? data.left ?? 0),
        top: Number(object.top ?? data.top ?? 0),
        width: Number(object.width || 0) * Math.abs(Number(object.scaleX) || 1),
        height: Number(object.height || 0) * Math.abs(Number(object.scaleY) || 1),
        angle: Number(object.angle ?? data.angle ?? 0),
        fontFamily: String(object.fontFamily || data.fontFamily || ''),
      };
    }).filter(Boolean);
  }, pageNumber);
}

async function textRows(page) {
  return (await annotationSnapshot(page)).filter(isTextRow);
}

async function userOwned(page) {
  return textRows(page);
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
      width: parseFloat(el.style.width || '0'),
      height: parseFloat(el.style.height || '0'),
    };
  });
}

async function editOverlayGeom(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('[data-text-edit-overlay]');
    const scaler = overlay?.firstElementChild;
    const box = scaler?.firstElementChild;
    if (!overlay || !scaler || !box) return null;
    return {
      pageWidth: parseFloat(scaler.style.width || '0'),
      pageHeight: parseFloat(scaler.style.height || '0'),
      left: parseFloat(box.style.left || '0'),
      top: parseFloat(box.style.top || '0'),
      width: parseFloat(box.style.width || '0'),
      height: parseFloat(box.style.height || '0'),
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

async function armText(page) {
  await dismissChrome(page);
  // PDFViewer skips pointerdown for 300ms after an edit commit
  // (editModeCooldownRef). Without this wait the next drag is a no-op.
  await page.waitForTimeout(350);
  await activateTool(page, 'Text', 'Text');
  await expect(page.locator('[data-text-overlay="1"]').first()).toBeVisible({ timeout: 8_000 });
}

async function startLiveTextbox(page, { x0, y0, x1, y1 } = TEXT_BOX) {
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

function pagesMenu(page) {
  return page.locator('[data-pages-context-menu="true"]');
}

function pageThumb(page, pageNumber) {
  return page.locator(`#chrome-left-host [data-page-number="${pageNumber}"]`).first();
}

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pages.first().isVisible().catch(() => false)) {
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') {
      await pages.first().click();
    }
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) {
    await rail.first().click();
  }
  const again = page.getByRole('button', { name: 'Pages', exact: true });
  if (await again.first().isVisible().catch(() => false)
    && (await again.first().getAttribute('aria-pressed')) !== 'true') {
    await again.first().click();
  }
}

async function openPageMenu(page, pageNumber = 1) {
  await openPagesPanel(page);
  const thumb = pageThumb(page, pageNumber);
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await thumb.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await thumb.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(12, rect.width / 2),
        clientY: rect.top + Math.min(12, rect.height / 2),
      }));
    });
    try {
      await expect(pagesMenu(page)).toBeVisible({ timeout: 2_500 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return {
    rotateCw: pagesMenu(page).getByText('Rotate', { exact: true }),
    rotateCcw: pagesMenu(page).getByText('Rotate counter-clockwise', { exact: true }),
  };
}

async function rotatePage(page, pageNumber, direction = 'cw') {
  const beforeBox = await pageBox(page, pageNumber);
  const items = await openPageMenu(page, pageNumber);
  await (direction === 'cw' ? items.rotateCw : items.rotateCcw).click();
  await expect(pagesMenu(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => {
    const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
    if (!box) return false;
    const wasPortrait = beforeBox.height > beforeBox.width + 8;
    const nowLandscape = box.width > box.height + 8;
    const nowPortrait = box.height > box.width + 8;
    return wasPortrait ? nowLandscape : nowPortrait;
  }, { timeout: 45_000, message: `page ${pageNumber} should flip aspect after ${direction} rotate` }).toBeTruthy();
  await closeDocumentPanel(page);
  await assertNoErrorBoundary(page);
}

async function waitForEditorReady(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

test('desktop textbox create after CW rotate intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await userOwned(page)).length, 'fresh fixture starts empty').toBe(0);

  // Page CW first on an empty page — remapper has nothing to rewrite.
  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await userOwned(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page), 'create starts on the swapped viewBox').toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const landscapeLeft = 792 * TEXT_BOX.x0;
  const landscapeTop = 612 * TEXT_BOX.y0;
  const landscapeWidth = 792 * (TEXT_BOX.x1 - TEXT_BOX.x0);
  const staleLeft = 612 * TEXT_BOX.x0;
  const staleTop = 792 * TEXT_BOX.y0;
  const staleWidth = 612 * (TEXT_BOX.x1 - TEXT_BOX.x0);

  // Intended — rubber-band a new Textbox onto the already-rotated page.
  const before = new Set((await userOwned(page)).map((row) => row.id));
  await armText(page);
  await blurInputs(page);
  const drag = await startLiveTextbox(page, TEXT_BOX);
  expect((await userOwned(page)).map((row) => row.id), 'Text live drag must not commit yet').toEqual([...before]);
  expect(await page.locator('[data-text-edit-overlay]').count(), 'Text live drag must not mount auto-edit yet').toBe(0);
  expect(await liveBoundaryPreview(page).count(), 'Text preview is not the Rect/Ellipse g path').toBe(0);
  expect(await liveLinePreview(page).count(), 'Text preview is not the Line/Arrow path').toBe(0);
  expect(await liveCalloutPreview(page).count(), 'Text preview is not the Callout path').toBe(0);
  const live = await previewInfo(page);
  expect(live?.inlineDisplay, 'rubber-band display is block during drag').toBe('block');
  expect(live?.borderStyle, 'rubber-band is dashed (not Style [6,4])').toBe('dashed');
  expect(live?.width, 'rubber-band width follows the drag').toBeGreaterThan(10);
  expect(live?.height, 'rubber-band height follows the drag').toBeGreaterThan(10);
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => previewPainted(page), {
    timeout: 5_000,
    message: 'Text pointerup must drop the rubber-band',
  }).toBe(false);
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first(), 'pointerup mounts T-01 auto-edit').toBeVisible({ timeout: 10_000 });

  const edit = await editOverlayGeom(page);
  expect(edit, 'auto-edit overlay must mount on the swapped page').toBeTruthy();
  expect(edit.pageWidth, 'edit scaler uses live 792 width').toBe(792);
  expect(edit.pageHeight, 'edit scaler uses live 612 height').toBe(612);
  expect(
    Math.abs(edit.left - landscapeLeft),
    'new textbox must land in displayed 792×612, not pre-rotate 612×792',
  ).toBeLessThan(28);
  expect(Math.abs(edit.top - landscapeTop)).toBeLessThan(28);
  expect(Math.abs(edit.width - landscapeWidth), 'drag width uses swapped 792').toBeLessThan(28);
  expect(
    Math.abs(edit.left - staleLeft),
    'must not use stale portrait pageSize for left',
  ).toBeGreaterThan(20);
  expect(Math.abs(edit.top - staleTop)).toBeGreaterThan(20);
  expect(Math.abs(edit.width - staleWidth), 'must not use stale portrait width for drag size').toBeGreaterThan(20);
  expect(edit.left, 'edit left stays on swapped width').toBeGreaterThanOrEqual(-8);
  expect(edit.left + edit.width).toBeLessThanOrEqual(800);
  expect(edit.top).toBeGreaterThanOrEqual(-8);
  expect(edit.top + edit.height).toBeLessThanOrEqual(620);

  await persistOpenText(page, 'A');
  const created = await waitForNewText(page, before);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  expect(created.text, 'keep-alive glyph must commit A').toBe('A');
  expect(created.fontFamily, 'create stamps a single-name fontFamily').toBe('Helvetica');
  expect(created.width, 'committed size must be sane').toBeGreaterThan(8);
  expect(created.height, 'committed height must be sane').toBeGreaterThan(8);
  expect(created.angle, 'new textbox must not invent a remapper angle').toBe(0);
  expect(
    Math.abs(created.left - landscapeLeft),
    'committed left stays in displayed 792×612',
  ).toBeLessThan(28);
  expect(Math.abs(created.top - landscapeTop)).toBeLessThan(28);
  expect(Math.abs(created.left - staleLeft), 'committed left must not use stale 612').toBeGreaterThan(20);
  expect(Math.abs(created.top - staleTop), 'committed top must not use stale 792').toBeGreaterThan(20);
  expect(created.left).toBeGreaterThanOrEqual(-8);
  expect(created.top).toBeGreaterThanOrEqual(-8);
  expect(created.left + created.width).toBeLessThanOrEqual(800);
  expect(created.top + created.height).toBeLessThanOrEqual(620);
  expect(await pageViewBox(page), 'viewBox held after new textbox').toBe('0 0 792 612');

  const afterIntended = new Set((await userOwned(page)).map((row) => row.id));
  expect(afterIntended.size, 'intended create added one textbox').toBe(1);

  // Break — sub-10px band invents 0 (10px gate). Click-to-place overlay is
  // T-01; Escape discard so this leftover stays the band.
  await armText(page);
  await blurInputs(page);
  const beforeTiny = new Set((await userOwned(page)).map((row) => row.id));
  const tinyBox = await pageBox(page);
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.12, tinyBox.y + tinyBox.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.12 + 4, tinyBox.y + tinyBox.height * 0.55 + 3);
  expect(await previewPainted(page), 'sub-10px band invents 0').toBe(false);
  await page.mouse.up();
  await expect.poll(async () => previewPainted(page), {
    timeout: 5_000,
    message: 'tiny click must drop any rubber-band',
  }).toBe(false);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  }
  expect((await userOwned(page)).map((row) => row.id), 'sub-10px band invents 0').toEqual([...beforeTiny]);

  // Break — tool-switch mid-drag invents 0.
  await armText(page);
  await blurInputs(page);
  const beforeSwitch = new Set((await userOwned(page)).map((row) => row.id));
  await startLiveTextbox(page, { x0: 0.16, y0: 0.58, x1: 0.34, y1: 0.72 });
  await page.keyboard.press('v');
  await expect.poll(async () => previewPainted(page), {
    timeout: 5_000,
    message: 'tool-switch mid-drag must drop the rubber-band',
  }).toBe(false);
  await page.mouse.up().catch(() => {});
  expect(await page.locator('[data-text-edit-overlay]').count(), 'tool-switch mid-drag must not mount auto-edit').toBe(0);
  expect((await userOwned(page)).map((row) => row.id), 'tool-switch invents 0').toEqual([...beforeSwitch]);
  expect(await pageViewBox(page), 'viewBox held through break').toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const kept = await geom(page, created.id);
  expect(kept, 'tiny click / tool-switch must not drop the intended textbox').toBeTruthy();
  expect(Math.abs(kept.left - created.left)).toBeLessThan(2);
  expect(Math.abs(kept.top - created.top)).toBeLessThan(2);

  console.log('PAGE_ROTATE_TEXTBOX_CREATE_DESKTOP_PROOF', JSON.stringify({
    textId: created.id,
    edit,
    commit: {
      left: created.left,
      top: created.top,
      width: created.width,
      height: created.height,
      text: created.text,
      fontFamily: created.fontFamily,
      angle: created.angle,
    },
    landscapeExpected: { left: landscapeLeft, top: landscapeTop, width: landscapeWidth },
    stalePortrait: { left: staleLeft, top: staleTop, width: staleWidth },
    viewBox: await pageViewBox(page),
    fileId: await fileId(page),
    leftover18CloudSave: 'unchanged',
  }));
});

test('390 textbox-create-after-rotate edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await userOwned(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Text', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  console.log('PAGE_ROTATE_TEXTBOX_CREATE_390_EDGE', JSON.stringify({
    viewBox: '0 0 612 792',
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    userMarks: 0,
  }));
});
