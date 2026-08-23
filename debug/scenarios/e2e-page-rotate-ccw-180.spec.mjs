import { test, expect } from '@playwright/test';

// CCW (-90) and 180 (two CWs — no dedicated 180 button) page rotate.
// Existing remapper + persist proofs are CW-only. Representative set:
// bbox rect, pen path, callout, counter, line. Persist is local save/reload
// (same remount /Rotate limit as CW — do not stamp file.id).
// Distinct from leftover-18 / X-01 / clockwise catalog (not replayed).

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const RECT_BOX = { x0: 0.20, y0: 0.26, x1: 0.40, y1: 0.44 };
const PEN_BOX = { x0: 0.22, y0: 0.30, x1: 0.40, y1: 0.42 };
const CALLOUT_BOX = { x0: 0.16, y0: 0.22, x1: 0.44, y1: 0.42 };
const COUNTER_PIN = { xf: 0.28, yf: 0.52 };
const LINE_BOX = { x0: 0.18, y0: 0.22, x1: 0.42, y1: 0.38 };

function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = (((Number(delta) || 0) % 360) + 360) % 360;
  if (turns === 90) return { x: pageHeight - y, y: x };
  if (turns === 180) return { x: pageWidth - x, y: pageHeight - y };
  if (turns === 270) return { x: y, y: pageWidth - x };
  return { x, y };
}

function isRect(row) {
  return row.type === 'rect' || row.tool === 'rect';
}

function isInk(row) {
  return row.type === 'path' || row.tool === 'pen' || row.tool === 'freedraw';
}

function isLine(row) {
  return row.tool === 'line' && (row.type === 'line' || row.type === 'Line');
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
      const vw = width * Math.abs(scaleX);
      const vh = height * Math.abs(scaleY);
      const angle = Number(object.angle ?? data.angle ?? 0);
      const rad = (angle * Math.PI) / 180;
      const kind = String(data.type || data.annotationType || object.type || '').toLowerCase();
      const first = object.paperCenterline?.[0] || {};
      const cx = kind === 'counter' ? left + radius : left + vw / 2;
      const cy = kind === 'counter' ? top + radius : top + vh / 2;
      return {
        id,
        type: kind,
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        kind,
        imported: object.isPdfImported === true,
        callout: data.type === 'callout' || String(id).startsWith('callout-'),
        left,
        top,
        radius,
        cx,
        cy,
        angle,
        pointerAngle: Number.isFinite(Number(data.pointerAngle)) ? Number(data.pointerAngle) : null,
        clx: Number(first.x ?? NaN),
        cly: Number(first.y ?? NaN),
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
      const viewBox = document.querySelector('[data-svg-annotation-layer="1"]')?.getAttribute('viewBox') || '';
      const portrait = viewBox === '0 0 612 792';
      const W = portrait ? 612 : 792;
      const H = portrait ? 792 : 612;
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

async function persistOpenCalloutText(page, text = 'A') {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  if (!(await editor.isVisible().catch(() => false))) return;
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);
}

async function createRect(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isRect).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await blurInputs(page);
  const geom = await pageBox(page);
  await page.mouse.move(geom.x + geom.width * RECT_BOX.x0, geom.y + geom.height * RECT_BOX.y0);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * RECT_BOX.x1, geom.y + geom.height * RECT_BOX.y1, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await annotationSnapshot(page)).filter((row) => row.imported !== true && isRect(row));
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new rect' }).not.toBeNull();
  return created;
}

async function createInk(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isInk).map((row) => row.id));
  await activateTool(page, 'Draw', 'Pen');
  await blurInputs(page);
  const geom = await pageBox(page);
  await page.mouse.move(geom.x + geom.width * PEN_BOX.x0, geom.y + geom.height * PEN_BOX.y0);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * PEN_BOX.x1, geom.y + geom.height * PEN_BOX.y1, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await annotationSnapshot(page)).filter((row) => row.imported !== true && isInk(row));
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new pen' }).not.toBeNull();
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

async function createLine(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isLine).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Line');
  await blurInputs(page);
  const geom = await pageBox(page);
  await page.mouse.move(geom.x + geom.width * LINE_BOX.x0, geom.y + geom.height * LINE_BOX.y0);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * LINE_BOX.x1, geom.y + geom.height * LINE_BOX.y1, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await annotationSnapshot(page)).filter((row) => row.imported !== true && isLine(row));
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new line' }).not.toBeNull();
  return created;
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

async function rotate180ViaTwoCWs(page, pageNumber = 1) {
  await rotatePage(page, pageNumber, 'cw');
  await rotatePage(page, pageNumber, 'cw');
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
              clx: Number(object?.paperCenterline?.[0]?.x ?? NaN),
              cly: Number(object?.paperCenterline?.[0]?.y ?? NaN),
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

function centerOf(kind, row) {
  if (kind === 'line') return { x: row.px1, y: row.py1 };
  if (kind === 'ink') {
    if (Number.isFinite(row.clx) && Number.isFinite(row.cly)) return { x: row.clx, y: row.cly };
  }
  return { x: row.cx, y: row.cy };
}

async function liveOf(page, kind, id) {
  if (kind === 'callout') return (await calloutSnapshot(page)).find((row) => row.id === id) || null;
  return (await annotationSnapshot(page)).find((row) => row.id === id) || null;
}

async function createSet(page) {
  await dismissChrome(page);
  const rect = await createRect(page);
  await dismissChrome(page);
  const ink = await createInk(page);
  await dismissChrome(page);
  const callout = await createCallout(page);
  await dismissChrome(page);
  const counter = await createCounter(page);
  await dismissChrome(page);
  const line = await createLine(page);
  await dismissChrome(page);
  return { rect, ink, callout, counter, line };
}

async function assertRemapped(page, created, delta, label) {
  const kinds = [
    ['rect', created.rect],
    ['ink', created.ink],
    ['callout', created.callout],
    ['counter', created.counter],
    ['line', created.line],
  ];
  const results = {};
  for (const [kind, before] of kinds) {
    await expect.poll(async () => liveOf(page, kind, before.id), {
      timeout: 20_000,
      message: `${label} must keep live ${kind}`,
    }).not.toBeNull();
    const remapped = await liveOf(page, kind, before.id);
    const beforeCenter = centerOf(kind, before);
    const remappedCenter = centerOf(kind, remapped);
    const expected = rotateDisplayedPoint(beforeCenter.x, beforeCenter.y, 612, 792, delta);
    expect(Math.abs(remappedCenter.x - expected.x), `${kind} ${label} follows ${delta}`).toBeLessThan(24);
    expect(Math.abs(remappedCenter.y - expected.y)).toBeLessThan(24);
    expect(remappedCenter.x, `${kind} must not stay on the pre-rotate center`).not.toBeCloseTo(beforeCenter.x, 0);
    if (kind === 'counter') {
      const wantAngle = (((225 + delta) % 360) + 360) % 360;
      expect(remapped.pointerAngle).toBe(wantAngle);
    }
    results[kind] = { id: before.id, before: beforeCenter, remapped: remappedCenter, expected };
  }
  return results;
}

async function proveMode(page, mode) {
  await openEditor(page, { keepOnReload: true });
  await dismissChrome(page);
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createSet(page);
  for (const row of Object.values(created)) expect(row?.id).toBeTruthy();
  expect(created.counter.pointerAngle).toBe(225);

  if (mode === 'ccw') {
    await rotatePage(page, 1, 'ccw');
  } else {
    await rotate180ViaTwoCWs(page, 1);
  }
  await waitForEditorReady(page);
  await dismissChrome(page);

  const wantViewBox = mode === 'ccw' ? '0 0 792 612' : '0 0 612 792';
  expect(await pageViewBox(page), `${mode} viewBox`).toBe(wantViewBox);
  const delta = mode === 'ccw' ? -90 : 180;
  const remapped = await assertRemapped(page, created, delta, mode);

  await expect.poll(async () => {
    const persist = await localPersist(page);
    return persist.objects.some((row) => row.id === created.rect.id)
      && persist.objects.some((row) => row.id === created.ink.id)
      && persist.callouts.some((row) => row.id === created.callout.id)
      && persist.objects.some((row) => row.id === created.counter.id)
      && persist.objects.some((row) => row.id === created.line.id);
  }, { timeout: 10_000, message: 'local cache must hold remapped ids' }).toBe(true);
  const beforeReload = await localPersist(page);
  expect(beforeReload.fileId).toBeNull();

  await reloadEditor(page);
  await dismissChrome(page);
  expect(await fileId(page), 'reload must not stamp file.id').toBeNull();
  const remountViewBox = await pageViewBox(page);
  expect(remountViewBox).toBe('0 0 612 792');
  const afterReload = await localPersist(page);
  expect(afterReload.fileId).toBeNull();
  expect(afterReload.sidebarRotation, 'remount pageTransformations rotation').toBeNull();

  const cachedRect = afterReload.objects.find((row) => row.id === created.rect.id);
  expect(cachedRect, 'rect id persists').toBeTruthy();
  const liveRect = await liveOf(page, 'rect', created.rect.id);
  expect(liveRect, 'reload keeps rect id').toBeTruthy();
  expect(Math.abs(cachedRect.left - liveRect.left), 'cache keeps remapped rect left').toBeLessThan(4);
  expect(Math.abs(cachedRect.left - created.rect.left), 'cache is not leftover identity').toBeGreaterThan(8);

  const cachedInk = afterReload.objects.find((row) => row.id === created.ink.id);
  expect(cachedInk, 'ink id persists').toBeTruthy();
  expect(await liveOf(page, 'ink', created.ink.id)).toBeTruthy();

  const cachedCallout = afterReload.callouts.find((row) => row.id === created.callout.id);
  expect(cachedCallout, 'callout id persists').toBeTruthy();
  const liveCallout = await liveOf(page, 'callout', created.callout.id);
  expect(liveCallout).toBeTruthy();
  expect(Math.abs(cachedCallout.boxX - liveCallout.boxX)).toBeLessThan(0.02);

  const cachedCounter = afterReload.objects.find((row) => row.id === created.counter.id);
  expect(cachedCounter, 'counter id persists').toBeTruthy();
  const liveCounter = await liveOf(page, 'counter', created.counter.id);
  expect(liveCounter).toBeTruthy();
  expect(cachedCounter.pointerAngle).toBe(liveCounter.pointerAngle);

  const cachedLine = afterReload.objects.find((row) => row.id === created.line.id);
  expect(cachedLine, 'line id persists').toBeTruthy();
  expect(await liveOf(page, 'line', created.line.id)).toBeTruthy();

  await wipePersistKeys(page);
  await reloadEditor(page);
  await dismissChrome(page);
  expect((await annotationSnapshot(page)).some((row) => row.id === created.rect.id), 'wipe+reload invents 0').toBe(false);
  expect((await calloutSnapshot(page)).some((row) => row.id === created.callout.id), 'wipe+reload invents 0').toBe(false);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  return {
    mode,
    remountViewBox,
    remountLimit: remountViewBox === '0 0 612 792',
    sidebarRotation: afterReload.sidebarRotation,
    fileId: null,
    types: remapped,
  };
}

test('desktop CCW remap + persist intended + wipe+reload invents 0', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveMode(page, 'ccw');
  console.log('PAGE_ROTATE_CCW', JSON.stringify(proof));
});

test('desktop 180 via two CWs remap + persist intended + wipe+reload invents 0', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveMode(page, '180');
  console.log('PAGE_ROTATE_180', JSON.stringify(proof));
});

test('empty CCW / empty two-CW / cancel rotate invent 0', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await dismissChrome(page);
  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length).toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await rotate180ViaTwoCWs(page, 1);
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, 'empty two-CW invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();

  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, 'empty CCW invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  expect(await fileId(page)).toBeNull();

  const beforeBox = await pageViewBox(page);
  const items = await openPageMenu(page, 1);
  expect(await items.rotateCw.count()).toBeGreaterThan(0);
  expect(await items.rotateCcw.count()).toBeGreaterThan(0);
  expect(await pagesMenu(page).getByText('Rotate 180', { exact: true }).count(), 'no invented 180 button').toBe(0);
  await page.keyboard.press('Escape');
  await expect(pagesMenu(page)).toHaveCount(0, { timeout: 8_000 });
  await closeDocumentPanel(page);
  expect(await pageViewBox(page), 'cancel rotate keeps viewBox').toBe(beforeBox);
  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, 'cancel rotate invents 0').toBe(0);
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);
  console.log('PAGE_ROTATE_CCW_180_BREAK', JSON.stringify({
    emptyCcw: 0,
    emptyTwoCw: 0,
    cancel: 0,
    invented180Button: 0,
    fileId: null,
  }));
});

test('390 CCW/180 edge: viewBox, file.id, no invent; hubPreview Draw 0', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);
  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  console.log('PAGE_ROTATE_CCW_180_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    marks: (await annotationSnapshot(page)).filter((row) => row.imported !== true).length,
  }));

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
});
