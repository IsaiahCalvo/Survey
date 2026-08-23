import { test, expect } from '@playwright/test';

// T-02 leftover: live Callout rubber-band then commit.
// Prior T-02 dedicated create geometry / knee / corners / arrowhead /
// dash / formatting catalogs. This pass asserts the in-drag
// `.callout-preview` (CREATE-01 dashed 5,5 rect + leader + solid
// triangle, opacity 0.6) then pointerup commit via createCallout
// (4px distance gate). Distinct from leftover-18, S-01/S-02 filled
// g.shape-creation-preview, S-03/S-04 line.shape-creation-preview,
// D-01/D-02 freehand preview, T-01 textbox auto-edit, T-02 handles.
// Do not stamp file.id.

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
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
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

function liveCalloutPreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] g.callout-preview');
}

function liveBoundaryPreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] g.shape-creation-preview');
}

function liveLinePreview(page) {
  return page.locator('[data-svg-annotation-layer="1"] line.shape-creation-preview');
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
      const boxEl = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"] [data-callout-part="textBox"]`,
      );
      return {
        id,
        type: String(object.type || data.type || 'callout').toLowerCase(),
        tool: String(data.tool || data.type || 'callout').toLowerCase(),
        callout: true,
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
        text: String(object.text || legacy.text || data.text || ''),
        arrowheadStyle: style.arrowheadStyle || null,
        lineStyle: style.lineStyle || null,
        fontFamily: style.fontFamily || null,
        textBoxWidth: Number(object.textBoxWidth ?? legacy.textBoxWidth ?? data.textBoxWidth ?? 0),
        textBoxHeight: Number(object.textBoxHeight ?? legacy.textBoxHeight ?? data.textBoxHeight ?? 0),
        arrowX: Number(arrow.x ?? 0),
        arrowY: Number(arrow.y ?? 0),
        boxX: Number(box.x ?? 0),
        boxY: Number(box.y ?? 0),
        kneeX: Number(knee.x ?? 0),
        kneeY: Number(knee.y ?? 0),
        visualBoxDash: boxEl?.getAttribute('stroke-dasharray') || null,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function calloutIds(page) {
  return (await calloutSnapshot(page)).map((row) => row.id);
}

async function geom(page, id) {
  const rows = await calloutSnapshot(page);
  return rows.find((row) => row.id === id) || null;
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
  await expect.poll(async () => {
    const layer = page.locator('[data-svg-annotation-layer="1"]').first();
    const cls = String(await layer.getAttribute('class') || '');
    return !cls.includes('tool-crosshair');
  }, { timeout: 8_000, message: 'Select must drop the creation crosshair' }).toBeTruthy();
}

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.42,
  y1 = 0.46,
} = {}) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function startLiveCallout(page, { x0 = 0.18, y0 = 0.28, x1 = 0.46, y1 = 0.46 } = {}) {
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
  await expect(liveCalloutPreview(page), 'live callout preview must paint before pointerup').toBeVisible({ timeout: 5_000 });
  return { box, start, mid, end };
}

async function previewInfo(page) {
  const preview = liveCalloutPreview(page);
  if (!(await preview.count())) return null;
  return preview.evaluate((el) => {
    const rect = el.querySelector('rect');
    const lines = [...el.querySelectorAll('line')];
    const dashedLines = lines.filter((line) => (line.getAttribute('stroke-dasharray') || '') === '5,5');
    const polygon = el.querySelector('polygon');
    return {
      tag: el.tagName,
      className: el.getAttribute('class') || '',
      opacity: Number(el.getAttribute('opacity') || 1),
      rectDash: rect?.getAttribute('stroke-dasharray') || '',
      rectW: Number(rect?.getAttribute('width') || 0),
      rectH: Number(rect?.getAttribute('height') || 0),
      dashedLineCount: dashedLines.length,
      hasPolygon: !!polygon,
    };
  });
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

test('desktop callout live create intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  await selectMode(page);
  const emptyBefore = await calloutIds(page);
  expect(await liveCalloutPreview(page).count(), 'empty page live callout preview 0').toBe(0);
  await dragOnPage(page, { x0: 0.10, y0: 0.12, x1: 0.18, y1: 0.20 });
  expect(await calloutIds(page), 'empty Select drag invents 0').toEqual(emptyBefore);
  expect(await liveCalloutPreview(page).count(), 'Select drag must not paint callout preview').toBe(0);

  // Intended — live CREATE-01 rubber-band during drag, commit on pointerup.
  const beforeA = new Set(await calloutIds(page));
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  const dragA = await startLiveCallout(page, { x0: 0.16, y0: 0.22, x1: 0.44, y1: 0.42 });
  expect(await calloutIds(page), 'Callout live drag must not commit yet').toEqual([...beforeA]);
  expect(await liveBoundaryPreview(page).count(), 'Callout preview is not the Rect/Ellipse g path').toBe(0);
  expect(await liveLinePreview(page).count(), 'Callout preview is not the Line/Arrow path').toBe(0);
  const liveA = await previewInfo(page);
  expect(liveA?.tag, 'Callout preview must be a <g>').toBe('g');
  expect(liveA?.className, 'preview class is callout-preview').toBe('callout-preview');
  expect(liveA?.opacity, 'CREATE-01 preview is translucent').toBeCloseTo(0.6, 5);
  expect(liveA?.rectDash, 'CREATE-01 preview box is dashed 5,5 (not Style [6,4])').toBe('5,5');
  expect(liveA?.rectW, 'CREATE-01 preview box is the 120px default').toBe(120);
  expect(liveA?.rectH, 'CREATE-01 preview box is the 32px default').toBe(32);
  expect(liveA?.dashedLineCount, 'CREATE-01 preview paints dashed leader lines').toBeGreaterThanOrEqual(1);
  expect(liveA?.hasPolygon, 'CREATE-01 preview shows a solid-triangle ghost head').toBe(true);
  await page.mouse.move(dragA.end.x, dragA.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(liveCalloutPreview(page), 'Callout pointerup must drop the preview').toHaveCount(0);
  const calloutA = await waitForNewCallout(page, beforeA);
  expect(calloutA.textBoxWidth, 'commit stamps default 120px box width (normalized)').toBeGreaterThan(0.15);
  expect(calloutA.textBoxHeight, 'commit stamps default 32px box height (normalized)').toBeGreaterThan(0.03);
  expect(calloutA.visualBoxDash, 'CREATE-01 commit restores solid box').toBeNull();
  expect(calloutA.fontFamily, 'create stamps a single-name fontFamily').toBe('Arial');
  await persistOpenCalloutText(page, 'A');
  const a0 = await geom(page, calloutA.id);
  expect(a0, 'persisted Callout A must still exist').toBeTruthy();

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await calloutIds(page)).includes(calloutA.id), {
    message: 'undo must restore by dropping Callout',
  }).toBe(false);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await calloutIds(page)).includes(calloutA.id), {
    message: 'redo must restore Callout',
  }).toBe(true);

  // Intended — second live create isolates A.
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  const beforeB = new Set(await calloutIds(page));
  const dragB = await startLiveCallout(page, { x0: 0.52, y0: 0.24, x1: 0.78, y1: 0.44 });
  expect(await calloutIds(page), 'second Callout live drag must not commit yet').toEqual([...beforeB]);
  const liveB = await previewInfo(page);
  expect(liveB?.rectDash, 'second CREATE-01 preview is dashed 5,5').toBe('5,5');
  await page.mouse.move(dragB.end.x, dragB.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(liveCalloutPreview(page), 'second pointerup must drop the preview').toHaveCount(0);
  const calloutB = await waitForNewCallout(page, beforeB);
  await persistOpenCalloutText(page, 'B');
  const a1 = await geom(page, calloutA.id);
  expect(a1.arrowX, 'second commit must isolate A arrow X').toBeCloseTo(a0.arrowX, 3);
  expect(a1.arrowY, 'second commit must isolate A arrow Y').toBeCloseTo(a0.arrowY, 3);
  expect(a1.boxX, 'second commit must isolate A box X').toBeCloseTo(a0.boxX, 3);
  expect(a1.boxY, 'second commit must isolate A box Y').toBeCloseTo(a0.boxY, 3);

  // Break — click / sub-4px drag invents 0 (distance gate).
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  const beforeTiny = new Set(await calloutIds(page));
  const tinyBox = await pageBox(page);
  await page.mouse.move(tinyBox.x + tinyBox.width * 0.12, tinyBox.y + tinyBox.height * 0.52);
  await page.mouse.down();
  await page.mouse.up();
  await expect(liveCalloutPreview(page), 'tiny click must drop any preview').toHaveCount(0, { timeout: 5_000 });
  expect(await calloutIds(page), 'tiny click must invent 0').toEqual([...beforeTiny]);

  // Break — tool-switch mid-drag clears the preview (never commits).
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  const beforeSwitch = new Set(await calloutIds(page));
  await startLiveCallout(page, { x0: 0.16, y0: 0.56, x1: 0.34, y1: 0.68 });
  await page.keyboard.press('v');
  await expect(liveCalloutPreview(page), 'tool-switch mid-drag must drop the preview').toHaveCount(0, { timeout: 5_000 });
  await page.mouse.up().catch(() => {});
  expect(await calloutIds(page), 'tool-switch mid-drag must invent 0').toEqual([...beforeSwitch]);

  // Break — zoom mid-drag does NOT flush drag-out callouts (they keep tracking).
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  const beforeZoom = new Set(await calloutIds(page));
  const zoomDrag = await startLiveCallout(page, { x0: 0.18, y0: 0.70, x1: 0.42, y1: 0.84 });
  expect(await calloutIds(page), 'zoom mid-drag starts uncommitted').toEqual([...beforeZoom]);
  await page.keyboard.press('Control+=');
  await expect.poll(async () => (await calloutIds(page)).join(','), {
    timeout: 3_000,
    message: 'zoom mid-drag must not flush a drag-out callout',
  }).toBe([...beforeZoom].join(','));
  expect(
    (await liveCalloutPreview(page).count()) > 0
    || (await calloutIds(page)).length === beforeZoom.size,
    'zoom mid-drag must keep tracking or stay uncommitted',
  ).toBeTruthy();
  await page.mouse.move(zoomDrag.end.x, zoomDrag.end.y, { steps: 4 });
  await page.mouse.up();
  const zoomCallout = await waitForNewCallout(page, beforeZoom);
  await expect(liveCalloutPreview(page), 'zoom then pointerup must drop the preview').toHaveCount(0);
  await persistOpenCalloutText(page, 'Z');
  const afterZoomUp = await calloutIds(page);
  expect(afterZoomUp.filter((id) => !beforeZoom.has(id)).length, 'zoom keep-track + pointerup must not double-commit').toBe(1);
  expect(afterZoomUp.includes(zoomCallout.id), 'zoom mid-drag then pointerup must commit one Callout').toBe(true);
  expect(afterZoomUp.includes(calloutA.id), 'zoom keep-track must isolate earlier Callout A').toBe(true);
  expect(afterZoomUp.includes(calloutB.id), 'zoom keep-track must isolate Callout B').toBe(true);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Callout', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);
  expect(await liveCalloutPreview(page).count()).toBe(0);

  console.log('CALLOUT_LIVE_CREATE_DESKTOP_PROOF', JSON.stringify({
    calloutA: calloutA.id,
    calloutB: calloutB.id,
    zoomCallout: zoomCallout.id,
    boxW: calloutA.textBoxWidth,
    boxH: calloutA.textBoxHeight,
    fontFamily: calloutA.fontFamily,
    viewBox,
    fileId: null,
  }));
});

test('390 callout live create intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const emptyBefore = await calloutIds(page);
  await selectMode(page);
  expect(await liveCalloutPreview(page).count(), '390 empty live callout preview 0').toBe(0);
  await dragOnPage(page, { x0: 0.12, y0: 0.16, x1: 0.22, y1: 0.24 });
  expect(await calloutIds(page), '390 empty Select drag invents 0').toEqual(emptyBefore);

  const beforeA = new Set(await calloutIds(page));
  await activateTool(page, 'Text', 'Callout');
  const dragA = await startLiveCallout(page, { x0: 0.16, y0: 0.26, x1: 0.56, y1: 0.44 });
  expect(await calloutIds(page), '390 Callout live drag must not commit yet').toEqual([...beforeA]);
  const liveA = await previewInfo(page);
  expect(liveA?.tag, '390 Callout preview must be a <g>').toBe('g');
  expect(liveA?.rectDash, '390 CREATE-01 preview is dashed 5,5').toBe('5,5');
  expect(liveA?.hasPolygon, '390 CREATE-01 preview shows a ghost head').toBe(true);
  await page.mouse.move(dragA.end.x, dragA.end.y, { steps: 6 });
  await page.mouse.up();
  await expect(liveCalloutPreview(page), '390 Callout pointerup must drop the preview').toHaveCount(0);
  const calloutA = await waitForNewCallout(page, beforeA);
  await persistOpenCalloutText(page, 'A');
  const a0 = await geom(page, calloutA.id);

  await activateTool(page, 'Text', 'Callout');
  const beforeB = new Set(await calloutIds(page));
  const dragB = await startLiveCallout(page, { x0: 0.18, y0: 0.54, x1: 0.58, y1: 0.72 });
  const liveB = await previewInfo(page);
  expect(liveB?.tag, '390 second preview must be a <g>').toBe('g');
  await page.mouse.move(dragB.end.x, dragB.end.y, { steps: 6 });
  await page.mouse.up();
  const calloutB = await waitForNewCallout(page, beforeB);
  await persistOpenCalloutText(page, 'B');
  const a1 = await geom(page, calloutA.id);
  expect(a1.arrowX, '390 second commit must isolate A').toBeCloseTo(a0.arrowX, 3);
  expect(calloutB.textBoxWidth, '390 second commit must stamp a default box').toBeGreaterThan(0.15);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('CALLOUT_LIVE_CREATE_390_PROOF', JSON.stringify({
    calloutA: calloutA.id,
    calloutB: calloutB.id,
    viewBox,
    fileId: null,
  }));
});
