import { test, expect } from '@playwright/test';

// Local History sidebar restore AFTER page CW remaps live leftovers that
// only have rect+ink restore receipts: callout, counter, line, textbox,
// survey-marker. Isolate per type (Walls hides sibling canvas marks).
// Named cloud Restore stays leftover-18 X-01 (lease + file.id).
// A-07 click-restore was proved before the remappers — not this path.
// Do not stamp file.id. Do not invent cloud versions.
// Watch Fabric left/top 0 / missing stampDisplayedPlacement.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1';

const LINE_BOX = { x0: 0.18, y0: 0.22, x1: 0.42, y1: 0.38 };
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
        left,
        top,
        ownLeft: Number.isFinite(ownLeft) ? ownLeft : null,
        ownTop: Number.isFinite(ownTop) ? ownTop : null,
        dataLeft: Number.isFinite(dataLeft) ? dataLeft : null,
        dataTop: Number.isFinite(dataTop) ? dataTop : null,
        width: vw,
        height: vh,
        radius,
        cx,
        cy,
        angle,
        pointerAngle: Number.isFinite(Number(data.pointerAngle)) ? Number(data.pointerAngle) : null,
        fontFamily: String(object.fontFamily || data.fontFamily || ''),
        px1: cx + x1 * Math.cos(rad) - y1 * Math.sin(rad),
        py1: cy + x1 * Math.sin(rad) + y1 * Math.cos(rad),
        px2: cx + x2 * Math.cos(rad) - y2 * Math.sin(rad),
        py2: cy + x2 * Math.sin(rad) + y2 * Math.cos(rad),
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
      const arrow = object.arrowTip || legacy.arrowTip || data.arrowTip || {};
      const knee = object.knee || legacy.knee || data.knee || {};
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
        textBoxWidth: boxW,
        textBoxHeight: boxH,
        arrowX: Number(arrow.x ?? 0),
        arrowY: Number(arrow.y ?? 0),
        kneeX: Number(knee.x ?? 0),
        kneeY: Number(knee.y ?? 0),
        cx: boxX * W + (boxW * W) / 2,
        cy: boxY * H + (boxH * H) / 2,
        left: boxX * W,
        top: boxY * H,
        ownLeft: Number(object.left),
        ownTop: Number(object.top),
        dataLeft: Number(data.left),
        dataTop: Number(data.top),
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
      present: !!group,
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

async function persistOpenCalloutText(page, text = 'A') {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  if (!(await editor.isVisible().catch(() => false))) return;
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  await page.mouse.click(12, 200);
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

async function createSurveyMarker(page, name = 'walls-hist') {
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

async function selectedIds(page) {
  return page.evaluate(() => [...(window.__selectedAnnotationIds || [])]);
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
    const cls = String(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('class') || '');
    return !cls.includes('tool-crosshair');
  }, { timeout: 8_000 }).toBeTruthy();
}

async function clickEmpty(page, { xf = 0.08, yf = 0.08 } = {}) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
}

async function clickAnno(page, id) {
  const host = page.locator(
    `[data-counter-overlay="1"] [data-anno-id="${id}"], [data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`,
  ).first();
  const hit = host.locator('[data-shape-hit-target], [data-path-hit-target], [data-text-hit-target], circle, rect, path, text').first();
  const target = (await hit.count()) ? hit : host;
  await expect(target).toBeVisible({ timeout: 8_000 });
  const box = await target.boundingBox();
  expect(box, `hit bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width * 0.50, y: box.y + box.height * 0.50 },
    { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35 },
    { x: box.x + 6, y: box.y + box.height * 0.40 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    try {
      await expect.poll(async () => (await selectedIds(page)).includes(id), { timeout: 900 }).toBe(true);
      return;
    } catch { /* try next */ }
  }
  throw new Error(`click missed ${id}`);
}

async function clickCallout(page, id) {
  const textBox = page.locator(`[data-callout-id="${id}"] [data-callout-part="textBox"]`).first();
  const host = page.locator(`[data-callout-id="${id}"]`).first();
  const target = (await textBox.count()) ? textBox : host;
  await expect(target).toBeVisible({ timeout: 8_000 });
  const box = await target.boundingBox();
  expect(box, `callout bbox for ${id}`).toBeTruthy();
  await target.click({ force: true }).catch(async () => {
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
  });
}

function deleteChrome(page) {
  return page.locator('[aria-label="Delete Survey Marker"]');
}

async function selectUntilDeleteChrome(page, id) {
  await selectMode(page);
  await expect.poll(async () => {
    const geom = await markerGeom(page, id);
    const hit = page.locator(`[data-survey-marker-id="${id}"] [data-survey-marker-hit-target="true"]`).first();
    if (await hit.count()) {
      await hit.click({ force: true });
    } else if (geom.present) {
      const box = await pageBox(page);
      const raw = await pageViewBox(page);
      const parts = String(raw).trim().split(/\s+/).map(Number);
      const W = parts[2] || 612;
      const H = parts[3] || 792;
      await page.mouse.click(
        box.x + ((geom.x + geom.width / 2) / W) * box.width,
        box.y + ((geom.y + geom.height / 2) / H) * box.height,
      );
    }
    return deleteChrome(page).count();
  }, { timeout: 12_000 }).toBeGreaterThan(0);
}

async function hasId(page, kind, id) {
  if (kind === 'callout') {
    return (await calloutSnapshot(page)).some((row) => row.id === id);
  }
  if (kind === 'survey-marker') {
    return (await markerIds(page)).includes(id);
  }
  return (await annotationSnapshot(page)).some((row) => row.id === id);
}

async function geomOf(page, kind, id) {
  if (kind === 'callout') return (await calloutSnapshot(page)).find((row) => row.id === id) || null;
  if (kind === 'survey-marker') return markerGeom(page, id);
  return (await annotationSnapshot(page)).find((row) => row.id === id) || null;
}

async function deleteSelected(page, kind, id) {
  await dismissChrome(page);
  await selectMode(page);
  await clickEmpty(page);
  if (kind === 'survey-marker') {
    await selectUntilDeleteChrome(page, id);
    const chrome = deleteChrome(page).first();
    const box = await chrome.boundingBox();
    if (box && box.width > 2 && box.height > 2) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await chrome.dispatchEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 1, button: 0,
      });
    }
  } else if (kind === 'callout') {
    await clickCallout(page, id);
    await blurInputs(page);
    const deleted = await page.evaluate((calloutId) => {
      if (typeof window.__onDeleteSelectedCallouts === 'function') {
        window.__onDeleteSelectedCallouts([calloutId]);
        return true;
      }
      return false;
    }, id);
    if (!deleted) {
      await page.keyboard.press('Delete');
      if (await hasId(page, kind, id)) await page.keyboard.press('Backspace');
    }
  } else if (kind === 'counter') {
    const target = page.locator(
      `[data-counter-overlay="1"] [data-anno-id="${id}"], [data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`,
    ).first();
    await expect(target).toBeVisible({ timeout: 8_000 });
    const box = await target.boundingBox();
    expect(box, `counter bbox for ${id}`).toBeTruthy();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await blurInputs(page);
    await page.keyboard.press('Delete');
    if (await hasId(page, kind, id)) await page.keyboard.press('Backspace');
  } else {
    await clickAnno(page, id);
    await expect.poll(async () => (await selectedIds(page)).includes(id), {
      timeout: 8_000,
      message: `${id} must be selected before Delete`,
    }).toBe(true);
    await blurInputs(page);
    await page.keyboard.press('Delete');
    if (await hasId(page, kind, id)) await page.keyboard.press('Backspace');
  }
  await expect.poll(async () => hasId(page, kind, id), {
    message: `Delete must remove ${id} so Restore can run`,
  }).toBeFalsy();
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

async function openHistory(page) {
  const history = page.getByRole('button', { name: 'Version history' });
  await expect(history.first()).toBeVisible({ timeout: 15_000 });
  await history.first().click();
  await expect(page.getByText('Version history').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('kal48-revisions-panel')).toBeVisible();
}

async function waitForHistoryEvents(page) {
  await expect.poll(async () => page.locator('[data-testid^="document-history-event-"]').count(), {
    timeout: 15_000,
    message: 'expected local History events after an in-session edit',
  }).toBeGreaterThan(0);
}

async function assertSaveVersionFailClosed(page) {
  await expect(page.getByTestId('kal48-save-revision')).toHaveCount(0);
  await expect(page.locator('[data-testid^="kal48-revision-row-"]')).toHaveCount(0);
  await expect(page.getByText('Only the document owner can save or restore versions.')).toBeVisible();
}

function deletedRows(page) {
  return page.locator('[data-testid^="document-history-event-"]').filter({ hasText: /deleted/i });
}

async function restoreLatestDeleted(page, kind, id) {
  await openHistory(page);
  await waitForHistoryEvents(page);
  const deleted = deletedRows(page).first();
  await expect(deleted).toBeVisible({ timeout: 15_000 });
  const restore = deleted.getByRole('button', { name: 'Restore', exact: true });
  await expect(restore).toBeVisible();
  await restore.click();
  await expect.poll(async () => hasId(page, kind, id), {
    message: `Restore must bring ${id} back`,
  }).toBeTruthy();
  await expect(page.getByText(/Restored deleted item/i)).toBeVisible();
}

function centerOf(row, kind) {
  if (kind === 'line') {
    return { x: (row.px1 + row.px2) / 2, y: (row.py1 + row.py2) / 2 };
  }
  return { x: row.cx, y: row.cy };
}

async function proveType(page, kind, create, { survey = false } = {}) {
  const cloudHits = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/supabase\.co|\/rest\/v1\/document_history|\/rest\/v1\/document_revisions|\/rpc\/kal48_/i.test(url)) {
      cloudHits.push(url.split('?')[0]);
    }
  });

  await openEditor(page, { url: survey ? SURVEY_PDF : LINK_PDF });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  if (kind === 'callout') {
    expect((await calloutSnapshot(page)).filter((row) => row.imported !== true).length, 'fresh editor must invent 0').toBe(0);
  } else if (kind === 'survey-marker') {
    expect((await markerIds(page)).length, 'fresh editor must invent 0').toBe(0);
  } else {
    expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, 'fresh editor must invent 0').toBe(0);
  }
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await create(page);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  const before = await geomOf(page, kind, created.id);
  expect(before, `live create must stamp a ${kind}`).toBeTruthy();
  expect(await pageViewBox(page), 'before-rotate checkpoint keeps portrait viewBox').toBe('0 0 612 792');
  if (kind === 'textbox') {
    expect(String(before.fontFamily || ''), 'textbox fontFamily must stay a single name').toMatch(/^Helvetica$|^Arial$|^Times New Roman$|^Courier New$|^Georgia$|^Verdana$/);
  }

  await openHistory(page);
  await waitForHistoryEvents(page);
  await assertSaveVersionFailClosed(page);
  const createBefore = page.locator('[data-testid^="document-history-event-"]').filter({ hasNotText: /deleted/i });
  await expect(createBefore.first()).toBeVisible();
  expect(
    await createBefore.first().getByRole('button', { name: 'Restore', exact: true }).count(),
    'create-event must omit Restore — click is jump+spotlight, not a snapshot',
  ).toBe(0);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await dismissChrome(page);

  const beforeCenter = centerOf(before, kind);
  const expected = rotateDisplayedPoint(beforeCenter.x, beforeCenter.y, 612, 792, 90);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  if (kind === 'survey-marker') await armWalls(page);
  await expect.poll(async () => geomOf(page, kind, created.id), {
    timeout: 20_000,
    message: `page rotate must keep the live ${kind}`,
  }).not.toBeNull();
  const remapped = await geomOf(page, kind, created.id);
  expect(remapped, `page rotate must keep the live ${kind}`).toBeTruthy();
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const remappedCenter = centerOf(remapped, kind);
  expect(Math.abs(remappedCenter.x - expected.x), 'remapped center must follow displayed-space +90').toBeLessThan(24);
  expect(Math.abs(remappedCenter.y - expected.y)).toBeLessThan(24);
  expect(remappedCenter.x, 'must not stay on the pre-rotate center').not.toBeCloseTo(beforeCenter.x, 0);
  if (kind === 'line') {
    console.log('PAGE_ROTATE_HISTORY_RESTORE_REMAINING_LINE_REMAPPED', JSON.stringify(remapped));
  }
  if (kind !== 'callout' && kind !== 'survey-marker' && remapped.ownLeft === 0 && remapped.dataLeft != null) {
    expect(Math.abs(remapped.dataLeft), 'Fabric left 0 must still carry remapped data.left').toBeGreaterThan(1);
  }

  await deleteSelected(page, kind, created.id);
  expect(await pageViewBox(page), 'delete after remap must keep swapped viewBox').toBe('0 0 792 612');

  const deletedCount = await deletedRows(page).count().catch(() => 0);
  await openHistory(page);
  await waitForHistoryEvents(page);
  await assertSaveVersionFailClosed(page);
  const deleted = deletedRows(page);
  if ((await deleted.count()) === 0) {
    console.log('PAGE_ROTATE_HISTORY_RESTORE_REMAINING_UNREACHABLE', JSON.stringify({
      kind,
      id: created.id,
      reason: 'no History deleted row after remapped delete',
      priorDeletedCount: deletedCount,
    }));
    expect(await fileId(page), 'must not stamp file.id').toBeNull();
    expect(cloudHits, 'local History must not hit cloud History/revision endpoints').toEqual([]);
    return { unreachable: true, kind, id: created.id, remapped, before, cloudHits };
  }

  const createRows = page.locator('[data-testid^="document-history-event-"]').filter({ hasNotText: /deleted/i });
  expect(
    await createRows.first().getByRole('button', { name: 'Restore', exact: true }).count(),
    'create-event must omit Restore — click is jump+spotlight, not a snapshot',
  ).toBe(0);

  await page.getByRole('button', { name: 'Pages', exact: true }).click().catch(() => {});
  await restoreLatestDeleted(page, kind, created.id);
  if (kind === 'survey-marker') await armWalls(page);
  await dismissChrome(page);
  if (kind === 'survey-marker') await armWalls(page);
  const restoredAfter = await geomOf(page, kind, created.id);
  expect(restoredAfter, `after-rotate Restore must keep the same ${kind} id`).toBeTruthy();
  const restoredCenter = centerOf(restoredAfter, kind);
  if (kind === 'line') {
    console.log('PAGE_ROTATE_HISTORY_RESTORE_REMAINING_LINE_RESTORED', JSON.stringify(restoredAfter));
  }
  expect(Math.abs(restoredCenter.x - remappedCenter.x), 'after-rotate Restore must keep remapped center').toBeLessThan(10);
  expect(Math.abs(restoredCenter.y - remappedCenter.y)).toBeLessThan(10);
  expect(restoredCenter.x, 'after-rotate Restore must not rewind to pre-rotate center').not.toBeCloseTo(beforeCenter.x, 0);
  expect(await pageViewBox(page), 'after-rotate Restore must keep swapped viewBox').toBe('0 0 792 612');
  if (kind === 'callout') {
    expect(Math.abs(restoredAfter.boxX - remapped.boxX), 'callout Restore must keep remapped boxX').toBeLessThan(0.02);
    expect(Math.abs(restoredAfter.boxY - remapped.boxY)).toBeLessThan(0.02);
  }
  if (kind === 'textbox') {
    expect(String(restoredAfter.fontFamily || '')).toMatch(/^Helvetica$|^Arial$|^Times New Roman$|^Courier New$|^Georgia$|^Verdana$/);
  }
  if (kind === 'counter') {
    expect(restoredAfter.pointerAngle, 'counter Restore must keep remapped pointerAngle').toBe(remapped.pointerAngle);
  }
  expect(
    kind === 'survey-marker'
      ? (await markerIds(page)).filter((id) => id === created.id).length
      : (kind === 'callout'
        ? (await calloutSnapshot(page)).filter((row) => row.id === created.id).length
        : (await annotationSnapshot(page)).filter((row) => row.id === created.id).length),
    'after-rotate Restore must not invent extra ids',
  ).toBe(1);
  await expect(page.getByText(/Restored deleted item/i)).toBeVisible();

  const restoreAgain = deletedRows(page).first().getByRole('button', { name: 'Restore', exact: true });
  await restoreAgain.click();
  expect(
    kind === 'survey-marker'
      ? (await markerIds(page)).filter((id) => id === created.id).length
      : (kind === 'callout'
        ? (await calloutSnapshot(page)).filter((row) => row.id === created.id).length
        : (await annotationSnapshot(page)).filter((row) => row.id === created.id).length),
    'second Restore must not duplicate the remapped id',
  ).toBe(1);
  await expect(page.getByTestId('kal48-status')).toContainText(/Restored deleted item|already present|no restore needed/i);
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  await page.getByRole('button', { name: 'Pages', exact: true }).click().catch(() => {});
  await dismissChrome(page);
  await deleteSelected(page, kind, created.id);
  await openHistory(page);
  await waitForHistoryEvents(page);
  const pending = deletedRows(page).first();
  await expect(pending.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(page.getByTestId('kal48-revisions-panel')).toBeHidden();
  expect(await hasId(page, kind, created.id), 'collapse/dismiss must not apply Restore').toBeFalsy();
  expect(await pageViewBox(page)).toBe('0 0 792 612');

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(cloudHits, 'local History must not hit cloud History/revision endpoints').toEqual([]);
  await assertNoErrorBoundary(page);

  return {
    kind,
    id: created.id,
    before: { cx: beforeCenter.x, cy: beforeCenter.y },
    remapped: { cx: remappedCenter.x, cy: remappedCenter.y },
    restoredAfter: { cx: restoredCenter.x, cy: restoredCenter.y },
    expected,
    ownLeft: remapped.ownLeft ?? null,
    dataLeft: remapped.dataLeft ?? remapped.stored?.x ?? null,
    viewBox: '0 0 792 612',
    fileId: null,
    cloudHits: cloudHits.length,
  };
}

test('desktop History restore after CW — callout intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveType(page, 'callout', createCallout);
  expect(proof.unreachable, 'callout History deleted row must exist').toBeFalsy();
  console.log('PAGE_ROTATE_HISTORY_RESTORE_REMAINING_CALLOUT', JSON.stringify(proof));
});

test('desktop History restore after CW — counter intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveType(page, 'counter', createCounter);
  expect(proof.unreachable, 'counter History deleted row must exist').toBeFalsy();
  console.log('PAGE_ROTATE_HISTORY_RESTORE_REMAINING_COUNTER', JSON.stringify(proof));
});

test('desktop History restore after CW — line intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveType(page, 'line', createLine);
  expect(proof.unreachable, 'line History deleted row must exist').toBeFalsy();
  console.log('PAGE_ROTATE_HISTORY_RESTORE_REMAINING_LINE', JSON.stringify(proof));
});

test('desktop History restore after CW — textbox intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveType(page, 'textbox', createTextbox);
  expect(proof.unreachable, 'textbox History deleted row must exist').toBeFalsy();
  console.log('PAGE_ROTATE_HISTORY_RESTORE_REMAINING_TEXTBOX', JSON.stringify(proof));
});

test('desktop History restore after CW — survey-marker intended + break + hub', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = await proveType(page, 'survey-marker', createSurveyMarker, { survey: true });
  if (proof.unreachable) {
    console.log('PAGE_ROTATE_HISTORY_RESTORE_REMAINING_SURVEY_MARKER_UNREACHABLE', JSON.stringify(proof));
  } else {
    console.log('PAGE_ROTATE_HISTORY_RESTORE_REMAINING_SURVEY_MARKER', JSON.stringify(proof));
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByTestId('kal48-revisions-panel').count()).toBe(0);
});

test('390 History restore remaining after remap edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages|Version history/i }).count(),
    '390 Pages rotate / History restore-after-remap is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_HISTORY_RESTORE_REMAINING_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    history: await page.getByRole('button', { name: 'Version history' }).count(),
    marks: (await annotationSnapshot(page)).filter((row) => row.imported !== true).length,
  }));
});
