import { test, expect } from '@playwright/test';

// Local ?testPdf= save/reload AFTER page CW for leftover types:
// callout, counter, line, arrow, textbox, survey-marker.
// Family-level untransformed reload is e2e-testpdf-local-save-reload.
// Distinct from leftover-18 / X-01 / History Restore / export-after-rotate.
// Fixture remount cannot restore baked /Rotate (no file.id persist).
// Prove what does persist: overlay identity + remapped cache coords.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1';

const LINE_BOX = { x0: 0.18, y0: 0.22, x1: 0.42, y1: 0.38 };
const ARROW_BOX = { x0: 0.20, y0: 0.48, x1: 0.46, y1: 0.64 };
const TEXT_BOX = { x0: 0.48, y0: 0.20, x1: 0.74, y1: 0.34 };
const CALLOUT_BOX = { x0: 0.16, y0: 0.22, x1: 0.44, y1: 0.42 };
const COUNTER_PIN = { xf: 0.28, yf: 0.52 };
const MARKER_BOX = { x0: 0.50, y0: 0.46, x1: 0.72, y1: 0.62 };

function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = (((Number(delta) || 0) % 360) + 360) % 360;
  if (turns === 90) return { x: pageHeight - y, y: x };
  if (turns === 180) return { x: pageWidth - x, y: pageHeight - y };
  if (turns === 270) return { x: y, y: pageWidth - x };
  return { x, y };
}

function isLine(row) {
  return row.tool === 'line' && (row.type === 'line' || row.type === 'Line');
}

function isArrow(row) {
  return row.tool === 'arrow' || row.type === 'arrow' || String(row.arrowhead || '').length > 0;
}

function isTextRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  if (row?.callout === true || type === 'callout' || tool === 'callout') return false;
  return type === 'textbox' || type === 'text' || tool === 'text';
}

function isCounter(row) {
  return row.type === 'counter' || row.kind === 'counter';
}

function isCalloutRow(row) {
  return row.callout === true || row.type === 'callout' || String(row.id || '').startsWith('callout-');
}

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
  keepOnReload = false,
} = {}) {
  await page.addInitScript((opts) => {
    try {
      if (opts.keepOnReload && sessionStorage.getItem('e2e-keep-local-save') === '1') return;
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('surveyMarkers_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
          || key.startsWith('pdfSidebar_')
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  }, { keepOnReload });
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

async function annotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
        .map((group) => group.getAttribute('data-anno-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const ownLeft = Number(object.left);
      const dataLeft = Number(data.left);
      const ownTop = Number(object.top);
      const dataTop = Number(data.top);
      const left = Number.isFinite(dataLeft) && (!Number.isFinite(ownLeft) || (Math.abs(ownLeft) < 1 && Math.abs(dataLeft) > 1))
        ? dataLeft
        : (Number.isFinite(ownLeft) ? ownLeft : 0);
      const top = Number.isFinite(dataTop) && (!Number.isFinite(ownTop) || (Math.abs(ownTop) < 1 && Math.abs(dataTop) > 1))
        ? dataTop
        : (Number.isFinite(ownTop) ? ownTop : 0);
      const width = Number(object.width ?? data.width ?? 0);
      const height = Number(object.height ?? data.height ?? 0);
      const scaleX = Number(object.scaleX ?? data.scaleX ?? 1) || 1;
      const scaleY = Number(object.scaleY ?? data.scaleY ?? 1) || 1;
      const radius = Number(object.radius ?? 14);
      const x1 = Number(object.x1 ?? 0);
      const y1 = Number(object.y1 ?? 0);
      const x2 = Number(object.x2 ?? 0);
      const y2 = Number(object.y2 ?? 0);
      const vw = width * Math.abs(scaleX);
      const vh = height * Math.abs(scaleY);
      const angle = Number(object.angle ?? data.angle ?? 0);
      const rad = (angle * Math.PI) / 180;
      const kind = String(data.type || data.annotationType || object.type || '').toLowerCase();
      const cx = kind === 'counter' ? left + radius : left + vw / 2;
      const cy = kind === 'counter' ? top + radius : top + vh / 2;
      return {
        id,
        type: kind,
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        kind,
        imported: object.isPdfImported === true,
        callout: data.type === 'callout' || String(id).startsWith('callout-'),
        arrowhead: String(data.arrowhead || object.arrowhead || ''),
        left,
        top,
        radius,
        cx,
        cy,
        angle,
        pointerAngle: Number.isFinite(Number(data.pointerAngle)) ? Number(data.pointerAngle) : null,
        fontFamily: String(object.fontFamily || data.fontFamily || ''),
        text: String(object.text ?? data.text ?? ''),
        px1: cx + x1 * Math.cos(rad) - y1 * Math.sin(rad),
        py1: cy + x1 * Math.sin(rad) + y1 * Math.cos(rad),
      };
    }).filter((row) => !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
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
      const box = object.textBoxPosition || legacy.textBoxPosition || data.textBoxPosition || {};
      const pageW = 792;
      const pageH = 612;
      const portrait = (document.querySelector('[data-svg-annotation-layer="1"]')?.getAttribute('viewBox') || '')
        === '0 0 612 792';
      const W = portrait ? 612 : pageW;
      const H = portrait ? 792 : pageH;
      const boxX = Number(box.x ?? 0);
      const boxY = Number(box.y ?? 0);
      const boxW = Number(object.textBoxWidth ?? legacy.textBoxWidth ?? data.textBoxWidth ?? 0);
      const boxH = Number(object.textBoxHeight ?? legacy.textBoxHeight ?? data.textBoxHeight ?? 0);
      return {
        id,
        type: 'callout',
        callout: true,
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
        boxX,
        boxY,
        cx: boxX * W + (boxW * W) / 2,
        cy: boxY * H + (boxH * H) / 2,
      };
    });
  }, pageNumber);
}

async function markerIds(page) {
  return page.locator('[data-survey-marker-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-survey-marker-id')).filter(Boolean),
  );
}

async function markerGeom(page, id) {
  return page.evaluate((annoId) => {
    const group = document.querySelector(`[data-survey-marker-id="${annoId}"]`);
    const rect = group?.querySelector('rect:not([data-survey-marker-hit-target])')
      || group?.querySelector('rect');
    const x = Number(rect?.getAttribute('x'));
    const y = Number(rect?.getAttribute('y'));
    const width = Number(rect?.getAttribute('width'));
    const height = Number(rect?.getAttribute('height'));
    let stored = null;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('surveyMarkers_')) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        const marker = data?.[annoId];
        if (marker?.bounds) {
          stored = {
            x: Number(marker.bounds.x),
            y: Number(marker.bounds.y),
            width: Number(marker.bounds.width),
            height: Number(marker.bounds.height),
            angle: Number(marker.bounds.angle ?? 0),
          };
          break;
        }
      } catch { /* ignore */ }
    }
    return {
      id: annoId,
      present: !!group,
      x,
      y,
      width,
      height,
      cx: (Number.isFinite(x) ? x : stored?.x || 0) + (Number.isFinite(width) ? width : stored?.width || 0) / 2,
      cy: (Number.isFinite(y) ? y : stored?.y || 0) + (Number.isFinite(height) ? height : stored?.height || 0) / 2,
      stored,
    };
  }, id);
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

async function activateShapeTool(page, toolName) {
  await blurInputs(page);
  await page.keyboard.press('Escape');
  const category = page.getByRole('button', { name: 'Shapes', exact: true }).first();
  await expect(category).toBeVisible({ timeout: 8_000 });
  if (!String(await category.getAttribute('class') || '').includes('btn-active')) {
    await category.click();
  }
  const desktopSub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const sub = (await desktopSub.count())
    ? desktopSub
    : page.getByRole('button', { name: toolName, exact: true });
  await expect(sub.first()).toBeVisible({ timeout: 8_000 });
  if (!String(await sub.first().getAttribute('class') || '').includes('btn-active')) {
    await sub.first().click();
  }
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

async function persistOpenCalloutText(page, text = 'A') {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  if (!(await editor.isVisible().catch(() => false))) return;
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);
}

async function createLineLike(page, toolName, box, pred) {
  const before = new Set((await annotationSnapshot(page)).filter(pred).map((row) => row.id));
  await activateTool(page, 'Shapes', toolName);
  await blurInputs(page);
  const geom = await pageBox(page);
  await page.mouse.move(geom.x + geom.width * box.x0, geom.y + geom.height * box.y0);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * box.x1, geom.y + geom.height * box.y1, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await annotationSnapshot(page)).filter((row) => row.imported !== true && pred(row));
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: `expected a new ${toolName}` }).not.toBeNull();
  return created;
}

async function createTextbox(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isTextRow).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(280);
  await activateTool(page, 'Text', 'Text');
  await expect(page.locator('[data-text-overlay="1"]').first()).toBeVisible({ timeout: 8_000 });
  await blurInputs(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * TEXT_BOX.x0, box.y + box.height * TEXT_BOX.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * TEXT_BOX.x1, box.y + box.height * TEXT_BOX.y1, { steps: 10 });
  await page.mouse.up();
  await persistOpenText(page, 'A');
  let created = null;
  await expect.poll(async () => {
    const rows = (await annotationSnapshot(page)).filter((row) => row.imported !== true && isTextRow(row));
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new textbox' }).not.toBeNull();
  return created;
}

async function createCounter(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isCounter).map((row) => row.id));
  await dismissChrome(page);
  await activateShapeTool(page, 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
  const overlay = page.locator('[data-counter-overlay="1"]');
  const box = (await overlay.boundingBox()) || (await pageBox(page));
  await page.mouse.click(box.x + box.width * COUNTER_PIN.xf, box.y + box.height * COUNTER_PIN.yf);
  let created = null;
  await expect.poll(async () => {
    const rows = (await annotationSnapshot(page)).filter((row) => row.imported !== true && isCounter(row));
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new counter pin' }).not.toBeNull();
  return created;
}

async function createCallout(page) {
  const before = new Set((await calloutSnapshot(page)).filter(isCalloutRow).map((row) => row.id));
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * CALLOUT_BOX.x0, box.y + box.height * CALLOUT_BOX.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * CALLOUT_BOX.x1, box.y + box.height * CALLOUT_BOX.y1, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await calloutSnapshot(page)).filter((row) => row.imported !== true && isCalloutRow(row));
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new callout' }).not.toBeNull();
  await persistOpenCalloutText(page, 'A');
  return (await calloutSnapshot(page)).find((row) => row.id === created.id) || created;
}

async function armWalls(page) {
  const hostWalls = () => page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
  if (!(await hostWalls().count()) || !(await hostWalls().first().isVisible().catch(() => false))) {
    const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
    if (await survey.count()) await survey.click();
    const picker = page.getByRole('heading', { name: 'Choose survey template' });
    if (await picker.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
    }
  }
  const walls = (await hostWalls().count())
    ? hostWalls()
    : page.getByRole('button', { name: 'Walls', exact: true });
  await expect(walls.first()).toBeVisible({ timeout: 15_000 });
  if (!String(await walls.first().getAttribute('class') || '').includes('btn-active')) {
    await walls.first().click();
  }
}

async function createSurveyMarker(page, name = 'walls-reload') {
  const before = new Set(await markerIds(page));
  await armWalls(page);
  await blurInputs(page);
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  expect(box, 'annotation layer geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * MARKER_BOX.x0, box.y + box.height * MARKER_BOX.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * MARKER_BOX.x1, box.y + box.height * MARKER_BOX.y1, { steps: 10 });
  await page.mouse.up();
  const field = page.getByPlaceholder('Enter name');
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toHaveCount(0, { timeout: 8_000 });
  let created = null;
  await expect.poll(async () => {
    const ids = await markerIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: `expected committed survey-marker ${name}` }).not.toBeNull();
  return markerGeom(page, created);
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
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') await pages.first().click();
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) await rail.first().click();
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

async function localPersist(page) {
  return page.evaluate(() => {
    const objects = [];
    const callouts = [];
    const markers = [];
    let sidebarRotation = null;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('annotationsByPage_')) {
        let parsed = null;
        try { parsed = JSON.parse(localStorage.getItem(key) || '{}'); } catch { parsed = null; }
        for (const pageData of Object.values(parsed || {})) {
          for (const object of pageData?.objects || []) {
            objects.push({
              key,
              id: object?.id || object?.data?.id || null,
              type: String(object?.type || object?.data?.type || '').toLowerCase(),
              left: Number(object?.left ?? object?.data?.left ?? 0),
              top: Number(object?.top ?? object?.data?.top ?? 0),
              pointerAngle: Number(object?.data?.pointerAngle ?? NaN),
              fontFamily: String(object?.fontFamily || object?.data?.fontFamily || ''),
              pageWidth: Number(pageData?.width ?? 0),
              pageHeight: Number(pageData?.height ?? 0),
            });
          }
        }
      }
      if (key?.startsWith('callouts_')) {
        let parsed = null;
        try { parsed = JSON.parse(localStorage.getItem(key) || '[]'); } catch { parsed = null; }
        for (const callout of Array.isArray(parsed) ? parsed : []) {
          callouts.push({
            id: callout?.id || callout?.data?.id || null,
            boxX: Number(callout?.textBoxPosition?.x ?? NaN),
            boxY: Number(callout?.textBoxPosition?.y ?? NaN),
          });
        }
      }
      if (key?.startsWith('surveyMarkers_')) {
        let parsed = null;
        try { parsed = JSON.parse(localStorage.getItem(key) || '{}'); } catch { parsed = null; }
        for (const [id, marker] of Object.entries(parsed || {})) {
          markers.push({
            id,
            x: Number(marker?.bounds?.x ?? NaN),
            y: Number(marker?.bounds?.y ?? NaN),
            angle: Number(marker?.bounds?.angle ?? 0),
          });
        }
      }
      if (key?.startsWith('pdfSidebar_')) {
        let parsed = null;
        try { parsed = JSON.parse(localStorage.getItem(key) || '{}'); } catch { parsed = null; }
        sidebarRotation = Number(parsed?.pageTransformations?.['1']?.rotation
          ?? parsed?.pageTransformations?.[1]?.rotation
          ?? NaN);
      }
    }
    return {
      objects,
      callouts,
      markers,
      sidebarRotation: Number.isFinite(sidebarRotation) ? sidebarRotation : null,
      fileId: window.__devTestPdf?.id ?? null,
    };
  });
}

async function keepLocalSave(page) {
  await page.evaluate(() => {
    sessionStorage.setItem('e2e-keep-local-save', '1');
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  });
}

async function reloadEditor(page) {
  await keepLocalSave(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
  await assertNoErrorBoundary(page);
}

async function wipePersistKeys(page) {
  await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (
        key.startsWith('annotationsByPage_')
        || key.startsWith('callouts_')
        || key.startsWith('surveyMarkers_')
        || key.startsWith('pdfSidebar_')
      )) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  });
}

function centerOf(row, kind) {
  if (kind === 'line' || kind === 'arrow') return { x: row.px1, y: row.py1 };
  return { x: row.cx, y: row.cy };
}

async function liveOf(page, kind, id) {
  if (kind === 'callout') return (await calloutSnapshot(page)).find((row) => row.id === id) || null;
  if (kind === 'survey-marker') return markerGeom(page, id);
  return (await annotationSnapshot(page)).find((row) => row.id === id) || null;
}

async function proveType(page, kind, createFn, { survey = false } = {}) {
  await openEditor(page, {
    url: survey ? SURVEY_PDF : LINK_PDF,
    keepOnReload: true,
  });
  await dismissChrome(page);
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createFn(page);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  if (kind === 'textbox') expect(created.fontFamily).toMatch(/^Helvetica$/);
  if (kind === 'counter') expect(created.pointerAngle).toBe(225);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  if (kind === 'survey-marker') await armWalls(page);
  await expect.poll(async () => liveOf(page, kind, created.id), {
    timeout: 20_000,
    message: `page rotate must keep the live ${kind}`,
  }).not.toBeNull();
  const remapped = await liveOf(page, kind, created.id);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const beforeCenter = centerOf(created, kind);
  const remappedCenter = centerOf(remapped, kind);
  const expected = rotateDisplayedPoint(beforeCenter.x, beforeCenter.y, 612, 792, 90);
  expect(Math.abs(remappedCenter.x - expected.x), 'CW remap follows +90').toBeLessThan(24);
  expect(Math.abs(remappedCenter.y - expected.y)).toBeLessThan(24);
  expect(remappedCenter.x, 'must not stay on the pre-rotate center').not.toBeCloseTo(beforeCenter.x, 0);

  await expect.poll(async () => {
    const persist = await localPersist(page);
    if (kind === 'survey-marker') return persist.markers.some((row) => row.id === created.id);
    if (kind === 'callout') return persist.callouts.some((row) => row.id === created.id);
    return persist.objects.some((row) => row.id === created.id);
  }, { timeout: 10_000, message: 'local cache must hold remapped id' }).toBe(true);
  const beforeReload = await localPersist(page);
  expect(beforeReload.fileId).toBeNull();

  await reloadEditor(page);
  await dismissChrome(page);
  if (kind === 'survey-marker') await armWalls(page);
  expect(await fileId(page), 'reload must not stamp file.id').toBeNull();

  const remountViewBox = await pageViewBox(page);
  const remountLimit = remountViewBox === '0 0 612 792';
  const afterReload = await localPersist(page);
  expect(afterReload.fileId).toBeNull();
  if (kind === 'survey-marker') {
    const cached = afterReload.markers.find((row) => row.id === created.id);
    expect(cached, 'survey-marker id persists in surveyMarkers_*').toBeTruthy();
    const wantX = remapped.stored?.x ?? remapped.x;
    const wantY = remapped.stored?.y ?? remapped.y;
    expect(Math.abs(cached.x - wantX), 'cache keeps remapped bounds.x').toBeLessThan(2);
    expect(Math.abs(cached.y - wantY)).toBeLessThan(2);
  } else if (kind === 'callout') {
    const cached = afterReload.callouts.find((row) => row.id === created.id);
    expect(cached, 'callout id persists in callouts_*').toBeTruthy();
    expect(Math.abs(cached.boxX - remapped.boxX), 'cache keeps remapped boxX').toBeLessThan(0.02);
    expect(Math.abs(cached.boxY - remapped.boxY)).toBeLessThan(0.02);
  } else {
    const cached = afterReload.objects.find((row) => row.id === created.id);
    expect(cached, `${kind} id persists in annotationsByPage_*`).toBeTruthy();
    expect(Math.abs(cached.left - remapped.left), 'cache keeps remapped left').toBeLessThan(4);
    expect(Math.abs(cached.top - remapped.top)).toBeLessThan(4);
    if (kind === 'counter') expect(cached.pointerAngle).toBe(remapped.pointerAngle);
    if (kind === 'textbox') expect(cached.fontFamily).toMatch(/^Helvetica$/);
  }

  const live = await liveOf(page, kind, created.id);
  expect(live, `reload must keep the same ${kind} id`).toBeTruthy();
  expect(live.id).toBe(created.id);
  if (kind === 'textbox') expect(String(live.fontFamily || '')).toMatch(/^Helvetica$/);
  if (kind === 'counter') expect(live.pointerAngle).toBe(remapped.pointerAngle);

  await wipePersistKeys(page);
  await reloadEditor(page);
  await dismissChrome(page);
  if (kind === 'survey-marker') {
    expect((await markerIds(page)).includes(created.id), 'wipe+reload invents 0').toBe(false);
  } else if (kind === 'callout') {
    expect((await calloutSnapshot(page)).some((row) => row.id === created.id), 'wipe+reload invents 0').toBe(false);
  } else {
    expect((await annotationSnapshot(page)).some((row) => row.id === created.id), 'wipe+reload invents 0').toBe(false);
  }
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  return {
    kind,
    id: created.id,
    before: beforeCenter,
    remapped: remappedCenter,
    expected,
    remountViewBox,
    remountLimit,
    sidebarRotation: afterReload.sidebarRotation,
    fileId: null,
  };
}

test('desktop save/reload after CW — callout intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveType(page, 'callout', createCallout);
  console.log('PAGE_ROTATE_SAVE_RELOAD_CALLOUT', JSON.stringify(proof));
});

test('desktop save/reload after CW — counter intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveType(page, 'counter', createCounter);
  console.log('PAGE_ROTATE_SAVE_RELOAD_COUNTER', JSON.stringify(proof));
});

test('desktop save/reload after CW — line intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveType(page, 'line', () => createLineLike(page, 'Line', LINE_BOX, isLine));
  console.log('PAGE_ROTATE_SAVE_RELOAD_LINE', JSON.stringify(proof));
});

test('desktop save/reload after CW — arrow intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveType(page, 'arrow', () => createLineLike(page, 'Arrow', ARROW_BOX, isArrow));
  console.log('PAGE_ROTATE_SAVE_RELOAD_ARROW', JSON.stringify(proof));
});

test('desktop save/reload after CW — textbox intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveType(page, 'textbox', createTextbox);
  console.log('PAGE_ROTATE_SAVE_RELOAD_TEXTBOX', JSON.stringify(proof));
});

test('desktop save/reload after CW — survey-marker intended + break + hub', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveType(page, 'survey-marker', createSurveyMarker, { survey: true });
  console.log('PAGE_ROTATE_SAVE_RELOAD_SURVEY_MARKER', JSON.stringify(proof));

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
});

test('390 save/reload remaining after remap edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);
  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  console.log('PAGE_ROTATE_SAVE_RELOAD_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    marks: (await annotationSnapshot(page)).filter((row) => row.imported !== true).length,
  }));
});
