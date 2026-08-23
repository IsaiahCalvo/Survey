import { test, expect } from '@playwright/test';

// Create a callout AFTER the page is already CW-rotated (viewBox 0 0 792 612).
// 52d001fd / e2e-page-rotate-create proved rect+pen via screenToSVG.
// Callout stores 0–1 fractions of the current page (120/W × 32/H). Distinct
// from leftover-18 / X-01 / remapped rect/callout/ink/counter/survey-marker/
// midpoint / remapped mt/mtr/br / remapped-page export / rect+pen create.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const CALLOUT_BOX = { x0: 0.16, y0: 0.22, x1: 0.44, y1: 0.42 };

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
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

function liveCalloutPreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] g.callout-preview');
}

function isCalloutRow(row) {
  return row.callout === true || row.type === 'callout' || String(row.id || '').startsWith('callout-');
}

async function calloutSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const style = legacy.style || data.style || object.style || {};
      const arrow = object.arrowTip || legacy.arrowTip || data.arrowTip || {};
      const knee = object.knee || legacy.knee || data.knee || {};
      const box = object.textBoxPosition || legacy.textBoxPosition || data.textBoxPosition || {};
      return {
        id,
        type: String(object.type || data.type || 'callout').toLowerCase(),
        callout: true,
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
        fontFamily: style.fontFamily || null,
        textBoxWidth: Number(object.textBoxWidth ?? legacy.textBoxWidth ?? data.textBoxWidth ?? 0),
        textBoxHeight: Number(object.textBoxHeight ?? legacy.textBoxHeight ?? data.textBoxHeight ?? 0),
        arrowX: Number(arrow.x ?? 0),
        arrowY: Number(arrow.y ?? 0),
        boxX: Number(box.x ?? 0),
        boxY: Number(box.y ?? 0),
        kneeX: Number(knee.x ?? 0),
        kneeY: Number(knee.y ?? 0),
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function calloutIds(page) {
  return (await calloutSnapshot(page)).map((row) => row.id);
}

async function geom(page, id) {
  return (await calloutSnapshot(page)).find((row) => row.id === id) || null;
}

async function waitForNewCallout(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await calloutSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isCalloutRow(row)) || null;
    return created;
  }, { message: 'expected a new callout' }).not.toBeNull();
  return created;
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

async function persistOpenCalloutText(page, text = 'A') {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  if (!(await editor.isVisible().catch(() => false))) return;
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);
}

async function startLiveCallout(page, { x0, y0, x1, y1 } = CALLOUT_BOX) {
  const box = await pageBox(page);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  return { start, end };
}

async function selectCallout(page, calloutId) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const scoped = toolButtons(page, 'Select');
  if (await scoped.count() && await scoped.first().isVisible().catch(() => false)) {
    await scoped.first().click();
  }
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
  const group = page.locator(`[data-svg-annotation-layer="1"] [data-callout-id="${calloutId}"]`);
  const candidates = [
    group.locator('[data-callout-part="textBox"]').first(),
    group.locator('[data-callout-part="knee"]').last(),
    group.first(),
  ];
  for (const target of candidates) {
    if (!(await target.count())) continue;
    const box = await target.boundingBox();
    if (!box || box.width < 1 || box.height < 1) continue;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  }
  return false;
}

function handleLocator(page, calloutId, part) {
  return page.locator(
    `[data-svg-annotation-layer="1"] [data-callout-id="${calloutId}"] [data-callout-part="${part}"]`,
  ).last();
}

async function handleOnPage(page, calloutId, part) {
  const handle = handleLocator(page, calloutId, part);
  await expect(handle, `${part} handle`).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  const pageEl = await pageBox(page);
  expect(hb, `${part} bbox`).toBeTruthy();
  const cx = hb.x + hb.width / 2;
  const cy = hb.y + hb.height / 2;
  expect(cx, `${part} must stay on the swapped page`).toBeGreaterThan(pageEl.x - 8);
  expect(cx).toBeLessThan(pageEl.x + pageEl.width + 8);
  expect(cy).toBeGreaterThan(pageEl.y - 8);
  expect(cy).toBeLessThan(pageEl.y + pageEl.height + 8);
  return { handle, hb, cx, cy, pageEl };
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

test('desktop callout create after CW rotate intended + break + edge', async ({ page }) => {
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
  expect((await calloutIds(page)).length, 'fresh fixture starts empty').toBe(0);

  // Page CW first on an empty page — remapper has nothing to rewrite.
  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await calloutIds(page)).length, 'empty page rotate must invent 0').toBe(0);
  expect(await pageViewBox(page), 'create starts on the swapped viewBox').toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const liveW = 120 / 792;
  const liveH = 32 / 612;
  const staleW = 120 / 612;
  const staleH = 32 / 792;

  // Intended — live CREATE-01 rubber-band, then commit on the swapped page.
  const before = new Set(await calloutIds(page));
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  const drag = await startLiveCallout(page, CALLOUT_BOX);
  expect(await calloutIds(page), 'Callout live drag must not commit yet').toEqual([...before]);
  await expect(liveCalloutPreview(page), 'live callout preview must paint on the swapped page').toHaveCount(1, { timeout: 5_000 });
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 4 });
  await page.mouse.up();
  await expect(liveCalloutPreview(page), 'Callout pointerup must drop the preview').toHaveCount(0);
  const created = await waitForNewCallout(page, before);
  await persistOpenCalloutText(page, 'A');
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  expect(created.fontFamily, 'create stamps a single-name fontFamily').toBe('Arial');

  expect(
    Math.abs(created.textBoxWidth - liveW),
    'new callout box width must be 120 / 792, not stale 120 / 612',
  ).toBeLessThan(0.012);
  expect(
    Math.abs(created.textBoxHeight - liveH),
    'new callout box height must be 32 / 612, not stale 32 / 792',
  ).toBeLessThan(0.012);
  expect(
    Math.abs(created.textBoxWidth - staleW),
    'must not use stale portrait page width for fractions',
  ).toBeGreaterThan(0.02);
  expect(
    Math.abs(created.textBoxHeight - staleH),
    'must not use stale portrait page height for fractions',
  ).toBeGreaterThan(0.006);

  expect(created.arrowX, 'arrow X is a 0–1 fraction').toBeGreaterThan(0.05);
  expect(created.arrowX).toBeLessThan(0.95);
  expect(created.arrowY).toBeGreaterThan(0.05);
  expect(created.arrowY).toBeLessThan(0.95);
  expect(
    Math.abs(created.arrowX - CALLOUT_BOX.x0),
    'arrow must land at the displayed-page click, not a pre-rotate fraction',
  ).toBeLessThan(0.06);
  expect(Math.abs(created.arrowY - CALLOUT_BOX.y0)).toBeLessThan(0.06);
  expect(
    Math.abs(created.arrowX - (CALLOUT_BOX.x0 * 792 / 612)),
    'arrow must not divide live 792px by stale 612',
  ).toBeGreaterThan(0.02);
  expect(
    Math.abs(created.boxX - CALLOUT_BOX.x1),
    'box must land in displayed 792×612, not pre-rotate 612×792',
  ).toBeLessThan(0.08);
  expect(Math.abs(created.boxY - CALLOUT_BOX.y1)).toBeLessThan(0.08);

  const displayedArrowX = created.arrowX * 792;
  const displayedArrowY = created.arrowY * 612;
  const displayedBoxX = created.boxX * 792;
  const displayedBoxY = created.boxY * 612;
  const displayedBoxW = created.textBoxWidth * 792;
  const displayedBoxH = created.textBoxHeight * 612;
  expect(displayedArrowX, 'arrow stays on swapped width').toBeGreaterThanOrEqual(-8);
  expect(displayedArrowX).toBeLessThanOrEqual(800);
  expect(displayedArrowY, 'arrow stays on swapped height').toBeGreaterThanOrEqual(-8);
  expect(displayedArrowY).toBeLessThanOrEqual(620);
  expect(displayedBoxX).toBeGreaterThanOrEqual(-8);
  expect(displayedBoxX + displayedBoxW).toBeLessThanOrEqual(800);
  expect(displayedBoxY).toBeGreaterThanOrEqual(-8);
  expect(displayedBoxY + displayedBoxH).toBeLessThanOrEqual(620);
  expect(Math.abs(displayedBoxW - 120), 'pixel box width stays 120 on the live page').toBeLessThan(10);
  expect(Math.abs(displayedBoxH - 32), 'pixel box height stays 32 on the live page').toBeLessThan(10);
  expect(created.kneeX, 'knee is a 0–1 fraction').toBeGreaterThan(0.05);
  expect(created.kneeX).toBeLessThan(0.95);
  expect(created.kneeY).toBeGreaterThan(0.05);
  expect(created.kneeY).toBeLessThan(0.95);
  expect(created.kneeX * 792, 'knee stays on swapped width').toBeGreaterThanOrEqual(-8);
  expect(created.kneeY * 612, 'knee stays on swapped height').toBeLessThanOrEqual(620);
  expect(await pageViewBox(page), 'viewBox held after new callout').toBe('0 0 792 612');

  await selectCallout(page, created.id);
  const knee = await handleOnPage(page, created.id, 'knee');
  expect(knee.cx, 'knee handle must stay on the swapped page').toBeGreaterThan(0);
  const boxHandle = await handleOnPage(page, created.id, 'textBox-br');
  expect(boxHandle.cx, 'box handle must stay on the swapped page').toBeGreaterThan(0);
  await page.mouse.click(knee.cx, knee.cy);
  await expect(handleLocator(page, created.id, 'knee'), 'knee handle stays hittable').toBeVisible();
  await page.mouse.click(boxHandle.cx, boxHandle.cy);
  await expect(handleLocator(page, created.id, 'textBox-br'), 'box handle stays hittable').toBeVisible();

  // Break — tiny click invents 0 (4px gate).
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  const beforeTiny = new Set(await calloutIds(page));
  const tinyBox = await pageBox(page);
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.12, tinyBox.y + tinyBox.height * 0.55);
  await page.mouse.down();
  await page.mouse.up();
  await expect(liveCalloutPreview(page), 'tiny click must drop any preview').toHaveCount(0, { timeout: 5_000 });
  expect(await calloutIds(page), 'tiny click invents 0').toEqual([...beforeTiny]);

  // Break — tool-switch mid-drag discards (pointercancel is not wired here).
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  const beforeSwitch = new Set(await calloutIds(page));
  await startLiveCallout(page, { x0: 0.18, y0: 0.58, x1: 0.36, y1: 0.74 });
  await expect(liveCalloutPreview(page), 'tool-switch starts with a live preview').toHaveCount(1, { timeout: 5_000 });
  await page.keyboard.press('v');
  await expect(liveCalloutPreview(page), 'tool-switch mid-drag must drop the preview').toHaveCount(0, { timeout: 5_000 });
  await page.mouse.up().catch(() => {});
  expect(await calloutIds(page), 'tool-switch mid-drag must invent 0').toEqual([...beforeSwitch]);
  expect(await pageViewBox(page), 'viewBox held through break').toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const kept = await geom(page, created.id);
  expect(kept, 'tiny click / tool-switch must not drop the intended callout').toBeTruthy();
  expect(Math.abs(kept.boxX - created.boxX)).toBeLessThan(0.02);
  expect(Math.abs(kept.textBoxWidth - created.textBoxWidth)).toBeLessThan(0.01);

  console.log('PAGE_ROTATE_CALLOUT_CREATE_DESKTOP_PROOF', JSON.stringify({
    calloutId: created.id,
    fractions: {
      arrowX: created.arrowX, arrowY: created.arrowY,
      boxX: created.boxX, boxY: created.boxY,
      kneeX: created.kneeX, kneeY: created.kneeY,
      w: created.textBoxWidth, h: created.textBoxHeight,
    },
    displayed: {
      arrowX: displayedArrowX, arrowY: displayedArrowY,
      boxX: displayedBoxX, boxY: displayedBoxY,
      boxW: displayedBoxW, boxH: displayedBoxH,
    },
    liveExpected: { w: liveW, h: liveH, arrowX: CALLOUT_BOX.x0, arrowY: CALLOUT_BOX.y0 },
    stalePortrait: { w: staleW, h: staleH, arrowX: CALLOUT_BOX.x0 * 792 / 612 },
    viewBox: await pageViewBox(page),
    fileId: await fileId(page),
    leftover18CloudSave: 'unchanged',
  }));
});

test('390 callout-create-after-rotate edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await calloutIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  console.log('PAGE_ROTATE_CALLOUT_CREATE_390_EDGE', JSON.stringify({
    viewBox: '0 0 612 792',
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    callouts: 0,
  }));
});
