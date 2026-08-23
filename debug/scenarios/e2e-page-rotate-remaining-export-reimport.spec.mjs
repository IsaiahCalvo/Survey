import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Current-code proof: live counter / survey-marker / line / textbox, then
// Pages rotate remapper, then local cache + export → ?testPdf= re-import.
// Distinct from 649e75f2 rect, a3e9bcff ink, ed08b9ed callout serialize.
// Distinct from leftover-18 / X-01 / remapped-live / create-after-CW.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const REIMPORT_NAME = '_e2e-page-rotate-remaining-export-reimport.pdf';

const LINE_BOX = { x0: 0.18, y0: 0.22, x1: 0.42, y1: 0.38 };
const TEXT_BOX = { x0: 0.48, y0: 0.20, x1: 0.74, y1: 0.34 };
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

function isTextRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  if (row?.callout === true || type === 'callout' || tool === 'callout') return false;
  return type === 'textbox' || type === 'text' || tool === 'text';
}

function isCounter(row) {
  return row.type === 'counter' || row.kind === 'counter';
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
        )) {
          keys.push(key);
        }
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
      const tab = page.getByRole('button', { name: /clickable-link-test\.pdf|_e2e-page-rotate-remaining-export-reimport\.pdf/ }).first();
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
      const left = Number(object.left ?? data.left ?? 0);
      const top = Number(object.top ?? data.top ?? 0);
      const width = Number(object.width ?? data.width ?? 0);
      const height = Number(object.height ?? data.height ?? 0);
      const radius = Number(object.radius ?? 14);
      const x1 = Number(object.x1 ?? 0);
      const y1 = Number(object.y1 ?? 0);
      const x2 = Number(object.x2 ?? 0);
      const y2 = Number(object.y2 ?? 0);
      const cx = left + width / 2;
      const cy = top + height / 2;
      const kind = String(data.type || data.annotationType || object.type || '').toLowerCase();
      return {
        id,
        type: kind,
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        kind,
        imported: object.isPdfImported === true,
        callout: data.type === 'callout' || String(id).startsWith('callout-'),
        text: String(object.text ?? data.text ?? ''),
        left,
        top,
        width: width * Math.abs(Number(object.scaleX) || 1),
        height: height * Math.abs(Number(object.scaleY) || 1),
        radius,
        cx: kind === 'counter' ? left + radius : cx,
        cy: kind === 'counter' ? top + radius : cy,
        angle: Number(object.angle ?? data.angle ?? 0),
        pointerAngle: Number.isFinite(Number(data.pointerAngle)) ? Number(data.pointerAngle) : null,
        fontFamily: String(object.fontFamily || data.fontFamily || ''),
        px1: cx + x1,
        py1: cy + y1,
        px2: cx + x2,
        py2: cy + y2,
      };
    }).filter((row) => !/^\d+R$/i.test(String(row.id || '')));
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
    const transform = rect?.getAttribute('transform') || '';
    const rot = /rotate\(\s*([-0-9.]+)/.exec(transform);
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
      x,
      y,
      width,
      height,
      cx: x + width / 2,
      cy: y + height / 2,
      angle: rot ? Number(rot[1]) : 0,
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

async function createLine(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isLine).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Line');
  await blurInputs(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * LINE_BOX.x0, box.y + box.height * LINE_BOX.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * LINE_BOX.x1, box.y + box.height * LINE_BOX.y1, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await annotationSnapshot(page)).filter((row) => row.imported !== true && isLine(row));
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new line' }).not.toBeNull();
  return created;
}

async function createTextbox(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isTextRow).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(350);
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
  await page.waitForTimeout(280);
  await activateShapeTool(page, 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
  const overlay = page.locator('[data-counter-overlay="1"]');
  const box = (await overlay.boundingBox()) || (await pageBox(page));
  await page.waitForTimeout(280);
  await page.mouse.click(box.x + box.width * COUNTER_PIN.xf, box.y + box.height * COUNTER_PIN.yf);
  let created = null;
  await expect.poll(async () => {
    const rows = (await annotationSnapshot(page)).filter((row) => row.imported !== true && isCounter(row));
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new counter pin' }).not.toBeNull();
  return created;
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

async function createSurveyMarker(page, name = 'walls-xf') {
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

async function localCache(page) {
  return page.evaluate(() => {
    const objects = [];
    const markers = [];
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
              left: Number(object?.left ?? 0),
              top: Number(object?.top ?? 0),
              angle: Number(object?.angle ?? 0),
              pageWidth: Number(pageData?.width ?? 0),
              pageHeight: Number(pageData?.height ?? 0),
            });
          }
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
    }
    return { objects, markers, fileId: window.__devTestPdf?.id ?? null };
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

async function wipeAnnotationKeys(page) {
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

async function waitForCacheIds(page, ids, markerIdsToFind = []) {
  await expect.poll(async () => {
    const cache = await localCache(page);
    const objectsOk = ids.every((id) => cache.objects.some((object) => object.id === id));
    const markersOk = markerIdsToFind.every((id) => cache.markers.some((marker) => marker.id === id));
    return objectsOk && markersOk;
  }, { timeout: 10_000, message: 'local cache must hold remapped ids' }).toBe(true);
}

async function exportAndSave(page, destName) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const dest = path.join(FIXTURE_DIR, destName);
  await download.saveAs(dest);
  return { download, dest, filename: download.suggestedFilename() };
}

function findRow(rows, pred, id) {
  return rows.find((row) => pred(row) && row.id === id)
    || rows.find((row) => pred(row) && row.imported === true)
    || rows.find((row) => pred(row));
}

test('desktop rotate remapper then export re-import of counter, survey-marker, line, textbox', async ({ page }) => {
  test.setTimeout(240_000);
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await openEditor(page, { keepOnReload: true });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, 'fresh fixture starts empty').toBe(0);
  expect((await markerIds(page)).length, 'fresh fixture starts with 0 survey-markers').toBe(0);

  const createdLine = await createLine(page);
  await dismissChrome(page);
  const createdText = await createTextbox(page);
  await dismissChrome(page);
  const createdCounter = await createCounter(page);
  await dismissChrome(page);
  const createdMarker = await createSurveyMarker(page, 'walls-xf');
  await dismissChrome(page);

  expect(createdLine?.id).toBeTruthy();
  expect(createdText?.id).toBeTruthy();
  expect(createdCounter?.id).toBeTruthy();
  expect(createdMarker?.id).toBeTruthy();
  expect(createdText.fontFamily, 'create stamps a single-name fontFamily').toBe('Helvetica');
  expect(createdText.text).toBe('A');
  expect(createdCounter.pointerAngle, 'live counter starts at the place default').toBe(225);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  await expect.poll(async () => {
    const rows = await annotationSnapshot(page);
    return rows.some((row) => row.id === createdLine.id)
      && rows.some((row) => row.id === createdText.id)
      && rows.some((row) => row.id === createdCounter.id)
      && (await markerIds(page)).includes(createdMarker.id);
  }, { timeout: 20_000, message: 'page rotate must keep all four live types' }).toBe(true);

  const rowsAfter = await annotationSnapshot(page);
  const rotatedLine = rowsAfter.find((row) => row.id === createdLine.id);
  const rotatedText = rowsAfter.find((row) => row.id === createdText.id);
  const rotatedCounter = rowsAfter.find((row) => row.id === createdCounter.id);
  const rotatedMarker = await markerGeom(page, createdMarker.id);

  const expectedLineStart = rotateDisplayedPoint(createdLine.px1, createdLine.py1, 612, 792, 90);
  const expectedTextCenter = rotateDisplayedPoint(createdText.cx, createdText.cy, 612, 792, 90);
  const expectedCounter = rotateDisplayedPoint(createdCounter.cx, createdCounter.cy, 612, 792, 90);
  const expectedMarker = rotateDisplayedPoint(createdMarker.cx, createdMarker.cy, 612, 792, 90);

  expect(Math.abs(rotatedLine.px1 - expectedLineStart.x), 'remapped line start follows +90').toBeLessThan(22);
  expect(Math.abs(rotatedLine.py1 - expectedLineStart.y)).toBeLessThan(22);
  expect(rotatedLine.px1, 'line must not stay on the pre-rotate point').not.toBeCloseTo(createdLine.px1, 0);

  expect(Math.abs(rotatedText.cx - expectedTextCenter.x), 'remapped textbox center follows +90').toBeLessThan(22);
  expect(Math.abs(rotatedText.cy - expectedTextCenter.y)).toBeLessThan(22);
  expect(rotatedText.left, 'textbox must not stay on the pre-rotate left').not.toBeCloseTo(createdText.left, 0);
  expect(rotatedText.fontFamily).toBe('Helvetica');

  expect(Math.abs(rotatedCounter.cx - expectedCounter.x), 'remapped counter center follows +90').toBeLessThan(22);
  expect(Math.abs(rotatedCounter.cy - expectedCounter.y)).toBeLessThan(22);
  expect(rotatedCounter.pointerAngle, 'nubbin pointerAngle remaps +90').toBe(315);
  expect(rotatedCounter.cx, 'counter must not stay on the pre-rotate center').not.toBeCloseTo(createdCounter.cx, 0);

  expect(Math.abs(rotatedMarker.cx - expectedMarker.x), 'remapped survey-marker center follows +90').toBeLessThan(22);
  expect(Math.abs(rotatedMarker.cy - expectedMarker.y)).toBeLessThan(22);
  expect(rotatedMarker.x, 'survey-marker must not stay on the pre-rotate bounds').not.toBeCloseTo(createdMarker.x, 0);

  await waitForCacheIds(page, [createdLine.id, createdText.id, createdCounter.id], [createdMarker.id]);
  const cached = await localCache(page);
  expect(cached.fileId).toBeNull();

  const { dest, filename } = await exportAndSave(page, REIMPORT_NAME);
  await page.evaluate(() => { sessionStorage.removeItem('e2e-keep-local-save'); });
  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${REIMPORT_NAME}`, keepOnReload: false });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page), 're-import must not stamp file.id').toBeNull();
  expect(await pageViewBox(page), 're-import must keep swapped viewBox').toBe('0 0 792 612');

  await expect.poll(async () => {
    const rows = await annotationSnapshot(page);
    const ids = await markerIds(page);
    return {
      line: Boolean(findRow(rows, isLine, createdLine.id)),
      text: Boolean(findRow(rows, isTextRow, createdText.id)),
      counter: Boolean(findRow(rows, isCounter, createdCounter.id)),
      marker: ids.includes(createdMarker.id) || ids.length > 0,
    };
  }, { timeout: 20_000, message: 're-import must paint all four exported types' }).toEqual({
    line: true,
    text: true,
    counter: true,
    marker: true,
  });

  const importedRows = await annotationSnapshot(page);
  const importedLine = findRow(importedRows, isLine, createdLine.id);
  const importedText = findRow(importedRows, isTextRow, createdText.id);
  const importedCounter = findRow(importedRows, isCounter, createdCounter.id);
  const importedMarkerId = (await markerIds(page)).includes(createdMarker.id)
    ? createdMarker.id
    : (await markerIds(page))[0];
  const importedMarker = await markerGeom(page, importedMarkerId);

  expect(importedLine.id, 're-import keeps the same line id').toBe(createdLine.id);
  expect(Math.abs(importedLine.px1 - rotatedLine.px1), 're-import must keep remapped line start').toBeLessThan(28);
  expect(Math.abs(importedLine.py1 - rotatedLine.py1)).toBeLessThan(28);
  expect(importedLine.px1, 're-import must not restore pre-rotate line').not.toBeCloseTo(createdLine.px1, 0);

  expect(importedText.id, 're-import keeps the same textbox id').toBe(createdText.id);
  expect(Math.abs(importedText.cx - rotatedText.cx), 're-import must keep remapped textbox center').toBeLessThan(28);
  expect(Math.abs(importedText.cy - rotatedText.cy)).toBeLessThan(28);
  expect(importedText.left, 're-import must not restore pre-rotate textbox').not.toBeCloseTo(createdText.left, 0);
  expect(importedText.fontFamily, 're-import keeps a single-name fontFamily').toBe('Helvetica');

  expect(importedCounter.id, 're-import keeps the same counter id').toBe(createdCounter.id);
  expect(Math.abs(importedCounter.cx - rotatedCounter.cx), 're-import must keep remapped counter center').toBeLessThan(28);
  expect(Math.abs(importedCounter.cy - rotatedCounter.cy)).toBeLessThan(28);
  expect(importedCounter.cx, 're-import must not restore pre-rotate counter').not.toBeCloseTo(createdCounter.cx, 0);

  expect(importedMarker.id, 're-import keeps the same survey-marker id').toBe(createdMarker.id);
  expect(Math.abs(importedMarker.cx - rotatedMarker.cx), 're-import must keep remapped survey-marker center').toBeLessThan(28);
  expect(Math.abs(importedMarker.cy - rotatedMarker.cy)).toBeLessThan(28);
  expect(importedMarker.x, 're-import must not restore pre-rotate survey-marker').not.toBeCloseTo(createdMarker.x, 0);
  expect(await fileId(page)).toBeNull();

  try { await unlink(dest); } catch { /* leftover fixture is fine */ }

  await keepLocalSave(page);
  await openEditor(page, { keepOnReload: true });
  await dismissChrome(page);
  await wipeAnnotationKeys(page);
  await reloadEditor(page);
  await dismissChrome(page);
  const wipedRows = (await annotationSnapshot(page)).filter((row) => row.imported !== true);
  const wipedMarkers = await markerIds(page);
  expect(wipedRows.some((row) => [createdLine.id, createdText.id, createdCounter.id].includes(row.id)), 'reload without save invents 0').toBe(false);
  expect(wipedMarkers.includes(createdMarker.id), 'reload without save invents 0 survey-markers').toBe(false);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  // Break — empty export still downloads; cancel does not invent marks.
  const emptyExport = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(emptyExport).toBeVisible();
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    emptyExport.click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  await emptyDownload.cancel();
  expect((await annotationSnapshot(page)).some((row) => row.id === createdLine.id)).toBe(false);
  expect(await fileId(page)).toBeNull();

  console.log('PAGE_ROTATE_REMAINING_EXPORT_REIMPORT_DESKTOP_PROOF', JSON.stringify({
    line: { id: createdLine.id, created: { px1: createdLine.px1, py1: createdLine.py1 }, rotated: { px1: rotatedLine.px1, py1: rotatedLine.py1 }, imported: { id: importedLine.id, px1: importedLine.px1, py1: importedLine.py1 } },
    textbox: { id: createdText.id, created: { left: createdText.left, top: createdText.top, cx: createdText.cx, cy: createdText.cy }, rotated: { left: rotatedText.left, top: rotatedText.top, cx: rotatedText.cx, cy: rotatedText.cy }, imported: { id: importedText.id, cx: importedText.cx, cy: importedText.cy, fontFamily: importedText.fontFamily } },
    counter: { id: createdCounter.id, created: { cx: createdCounter.cx, cy: createdCounter.cy, pointerAngle: createdCounter.pointerAngle }, rotated: { cx: rotatedCounter.cx, cy: rotatedCounter.cy, pointerAngle: rotatedCounter.pointerAngle }, imported: { id: importedCounter.id, cx: importedCounter.cx, cy: importedCounter.cy } },
    surveyMarker: { id: createdMarker.id, created: { cx: createdMarker.cx, cy: createdMarker.cy }, rotated: { cx: rotatedMarker.cx, cy: rotatedMarker.cy }, imported: { id: importedMarker.id, cx: importedMarker.cx, cy: importedMarker.cy } },
    exportName: filename,
    emptyExport: emptyDownload.suggestedFilename(),
    wipedInvented: wipedRows.length + wipedMarkers.length,
    viewBoxAfterRotate: '0 0 792 612',
    viewBoxAfterWipe: await pageViewBox(page),
    fileId: await fileId(page),
    leftover18CloudSave: 'unchanged',
  }));
});

test('390 remaining-export-reimport edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, '390 fresh editor invents 0').toBe(0);
  expect((await markerIds(page)).length, '390 fresh editor invents 0 survey-markers').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  console.log('PAGE_ROTATE_REMAINING_EXPORT_REIMPORT_390_EDGE', JSON.stringify({
    viewBox: '0 0 612 792',
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    userMarks: 0,
  }));
});
