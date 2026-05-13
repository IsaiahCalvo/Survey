#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LOGS_ROOT = path.join(REPO_ROOT, 'Logs');
const BASE_URL = process.env.FIX19_BASE_URL || 'http://localhost:5173/';

function loadEnv(file) {
  const p = path.join(REPO_ROOT, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

function stampForFolder(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonTail(line) {
  const idx = line.indexOf('{');
  if (idx < 0) return null;
  try {
    return JSON.parse(line.slice(idx));
  } catch {
    return null;
  }
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows || []) {
    const value = row?.[key] || 'unknown';
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

async function createDisposableDocument(supabase, userId) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const annotationRefs = [];
  for (let i = 1; i <= 2; i += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Fix 19 live annotation contract test page ${i}`, {
      x: 72,
      y: 720,
      size: 18,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText('Disposable PDF generated for authenticated runtime verification.', {
      x: 72,
      y: 690,
      size: 11,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    page.drawRectangle({ x: 72, y: 640, width: 468, height: 1, color: rgb(0.6, 0.6, 0.6) });
    if (i === 1) {
      const mkArray = (items) => {
        const arr = PDFArray.withContext(pdf.context);
        items.forEach((item) => arr.push(Number.isFinite(item) ? PDFNumber.of(item) : item));
        return arr;
      };
      const addAnnot = (dict) => {
        const ref = pdf.context.register(pdf.context.obj(dict));
        annotationRefs.push(ref);
      };
      addAnnot({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Squiggly'),
        NM: PDFString.of('fix19-native-squiggly'),
        Contents: PDFString.of('Fix19 native Squiggly annotation'),
        Rect: mkArray([92, 600, 150, 624]),
        QuadPoints: mkArray([92, 624, 150, 624, 92, 600, 150, 600]),
        C: mkArray([1, 0, 0]),
        Border: mkArray([0, 0, 2]),
        F: PDFNumber.of(4),
      });
      addAnnot({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('PolyLine'),
        NM: PDFString.of('fix19-native-polyline'),
        Contents: PDFString.of('Fix19 native PolyLine annotation'),
        Rect: mkArray([96, 486, 310, 570]),
        Vertices: mkArray([96, 500, 152, 560, 225, 510, 310, 552]),
        C: mkArray([0, 0.25, 1]),
        Border: mkArray([0, 0, 3]),
        F: PDFNumber.of(4),
      });
      addAnnot({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Polygon'),
        NM: PDFString.of('fix19-native-polygon'),
        Contents: PDFString.of('Fix19 native Polygon annotation'),
        Rect: mkArray([345, 492, 506, 596]),
        Vertices: mkArray([360, 505, 420, 590, 498, 548, 472, 505]),
        C: mkArray([0, 0.55, 0.2]),
        IC: mkArray([0.8, 1, 0.85]),
        Border: mkArray([0, 0, 3]),
        F: PDFNumber.of(4),
      });
      page.node.set(PDFName.of('Annots'), mkArray(annotationRefs));
    }
  }
  const bytes = await pdf.save();
  const docStamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const name = `Fix19 Imported PDF Gap ${docStamp}.pdf`;
  const filePath = `${userId}/fix19-live/${docStamp}.pdf`;

  const upload = await supabase.storage
    .from('documents')
    .upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
      contentType: 'application/pdf',
      upsert: false,
    });
  if (upload.error) throw upload.error;

  const insert = await supabase
    .from('documents')
    .insert({
      user_id: userId,
      name,
      file_path: filePath,
      file_size: bytes.length,
      page_count: 2,
      is_survey_mode: false,
      current_page: 1,
      zoom_level: 100,
      tool_preferences: {},
      archived: false,
      first_opened_device: 'dev',
      first_opened_user_tier: 'developer',
      first_opened_app_version: '0.1.45',
    })
    .select()
    .single();
  if (insert.error) throw insert.error;
  return insert.data;
}

async function getAppState(page) {
  return page.evaluate(() => {
    const s = window.__diagState;
    const objects = Object.values(s?.annotationsByPage || {}).flatMap((p) => p?.objects || []);
    return {
      activeTool: s?.activeTool || null,
      pdfName: s?.pdfName || null,
      pdfId: s?.pdfId || null,
      pageNumber: s?.pageNumber || null,
      objects: objects.map((o) => ({
        id: o.id || o.data?.id || o.highlightId || null,
        type: o.type || null,
        tool: o.tool || null,
        dataType: o.data?.type || null,
        pdfAnnotationId: o.pdfAnnotationId || null,
        pdfAnnotationType: o.pdfAnnotationType || null,
        isPdfImported: o.isPdfImported === true,
        selectable: o.selectable === true,
        evented: o.evented === true,
        text: o.text || null,
        moduleId: o.moduleId || null,
        regionId: o.regionId || null,
      })),
      callouts: (s?.callouts || []).map((c) => ({
        id: c.id,
        text: c.text || '',
        pageNumber: c.pageNumber,
        moduleId: c.moduleId || null,
        regionId: c.regionId || null,
      })),
      svgAnnoIds: [...document.querySelectorAll('svg [data-anno-id]')]
        .map((el) => el.getAttribute('data-anno-id'))
        .filter(Boolean),
      calloutIds: [...document.querySelectorAll('[data-callout-id]')]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
      selectedCount: document.querySelectorAll('[data-selected="true"], .selected, [data-selection-overlay]').length,
      yDocAnnotationCount: window.__ydocAnnotationCount ?? null,
      nativeLayerDiag: window.__nativePdfAnnotationLayerDiag || null,
    };
  });
}

async function waitForObjectCount(page, minimum, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getAppState(page);
    if (state.objects.length >= minimum) return state;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for at least ${minimum} objects`);
}

async function waitForImportedPdfTypes(page, expectedTypes, timeoutMs = 10_000) {
  const expected = new Set(expectedTypes);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getAppState(page);
    const found = new Set(
      state.objects
        .filter((o) => o.isPdfImported)
        .map((o) => o.pdfAnnotationType)
    );
    if ([...expected].every((type) => found.has(type))) return state;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for imported PDF types: ${expectedTypes.join(', ')}`);
}

async function waitForActiveTool(page, tool, timeoutMs = 5_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getAppState(page);
    if (state.activeTool === tool) return state;
    await sleep(100);
  }
  return getAppState(page);
}

async function waitForCalloutCount(page, minimum, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getAppState(page);
    if (state.callouts.length >= minimum) return state;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for at least ${minimum} callouts`);
}

async function waitForSynced(consoleLines, sinceIndex, timeoutMs = 8_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = consoleLines.slice(sinceIndex).some((line) =>
      line.includes('[CloudSync][status] transition') && line.includes('"to":"synced"')
    );
    if (found) return true;
    await sleep(150);
  }
  return false;
}

async function waitForCloudDeltaForId(consoleLines, sinceIndex, id, timeoutMs = 12_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matchingLine = consoleLines.slice(sinceIndex).find((line) => {
      if (!line.includes('[CloudSync][delta] fabric prepared')) return false;
      const payload = parseJsonTail(line);
      return Array.isArray(payload?.changedIds) && payload.changedIds.includes(id);
    });
    if (matchingLine) {
      return {
        line: matchingLine,
        payload: parseJsonTail(matchingLine) || {},
      };
    }
    await sleep(150);
  }
  return {
    line: null,
    payload: null,
  };
}

async function upperCanvasBox(page) {
  return page.locator('.upper-canvas').first().boundingBox();
}

async function drawOnCanvas(page, key, startX, startY, dx, dy) {
  await page.keyboard.press(key);
  await sleep(500);
  const box = await upperCanvasBox(page);
  if (!box) throw new Error('upper-canvas bounding box unavailable');
  await page.mouse.move(box.x + startX, box.y + startY);
  await page.mouse.down();
  await page.mouse.move(box.x + startX + dx, box.y + startY + dy, { steps: 12 });
  await page.mouse.up();
}

async function drawRectangle(page) {
  await page.getByTitle('Shapes').click();
  await sleep(200);
  await page.getByTitle('Rectangle').click();
  await sleep(500);
  const box = await upperCanvasBox(page);
  if (!box) throw new Error('upper-canvas bounding box unavailable');
  await page.mouse.move(box.x + 260, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 230, { steps: 12 });
  await page.mouse.up();
}

async function createCounter(page) {
  await page.keyboard.press('c');
  await sleep(500);
  const box = await page.locator('[data-counter-overlay]').first().boundingBox();
  if (!box) throw new Error('counter overlay bounding box unavailable');
  await page.mouse.move(box.x + 200, box.y + 480);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 500, { steps: 8 });
  await page.mouse.up();
}

async function createTextbox(page) {
  await page.keyboard.press('t');
  await sleep(500);
  const box = await page.locator('[data-text-overlay]').first().boundingBox();
  if (!box) throw new Error('text overlay bounding box unavailable');
  await page.mouse.move(box.x + 100, box.y + 600);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 650, { steps: 8 });
  await page.mouse.up();
  await sleep(900);
  await page.keyboard.type('Fix19 textbox', { delay: 20 });
  await sleep(300);
  await page.mouse.click(box.x + 20, box.y + 20);
}

async function createCallout(page) {
  await page.keyboard.press('q');
  await sleep(500);
  const box = await page.locator('svg[data-svg-annotation-layer]').first().boundingBox();
  if (!box) throw new Error('SVG annotation layer bounding box unavailable');
  await page.mouse.move(box.x + 300, box.y + 560);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 610, { steps: 10 });
  await page.mouse.up();
}

async function moveSvgEntity(page, id, kind = 'annotation') {
  await page.evaluate(() => {
    window.__LINE_BBOX_DIAG = true;
    window.__ANNOTATION_PREVIEW_DIAG = true;
    if (typeof window.__fix19SetActiveTool === 'function') {
      window.__fix19SetActiveTool('select');
    }
  });
  const devSelectionResult = false;
  await page.keyboard.press('v');
  const toolState = await waitForActiveTool(page, 'select');
  await sleep(250);
  const selector = kind === 'callout'
    ? `[data-callout-id="${id}"]`
    : `svg[data-svg-annotation-layer] [data-anno-id="${id}"]`;
  const loc = page.locator(selector).first();
  const visibleBox = await loc.boundingBox();
  const selectionHitLocator = page.locator(`svg[data-svg-annotation-layer] [data-path-selection-hit-target="true"]`).first();
  const bboxHitLocator = page.locator(`${selector} [data-path-bbox-hit-target="true"]`).first();
  const bboxHitBox = kind === 'annotation'
    ? (
        await selectionHitLocator.boundingBox().catch(() => null)
        || await bboxHitLocator.boundingBox().catch(() => null)
      )
    : null;
  const primaryHitLocator = bboxHitBox
    ? ((await selectionHitLocator.count().catch(() => 0)) > 0 ? selectionHitLocator : bboxHitLocator)
    : null;
  const hitBox = kind === 'annotation'
    ? (
        bboxHitBox
        || await page.locator(`${selector} [data-path-hit-target="true"]`).first().boundingBox().catch(() => null)
        || await page.locator(`${selector} rect`).last().boundingBox().catch(() => null)
      )
    : null;
  const box = hitBox || visibleBox;
  if (!box) {
    return {
      selectable: false,
      moved: false,
      svgElementFound: await loc.count().then((count) => count > 0).catch(() => false),
      svgBoundingBoxFound: false,
      svgHitBoxFound: false,
      bbox: null,
      hitBox: null,
      activeToolBeforeDrag: toolState.activeTool,
      devSelectionResult,
    };
  }
  const pathDragPoint = kind === 'annotation' && !bboxHitBox
    ? await page.evaluate((annotationId) => {
        const group = document.querySelector(`svg [data-anno-id="${CSS.escape(annotationId)}"]`);
        const path = group?.querySelector?.('[data-path-hit-target="true"]');
        const svg = path?.ownerSVGElement;
        if (!path || !svg || typeof path.getTotalLength !== 'function') return null;
        const total = path.getTotalLength();
        if (!Number.isFinite(total) || total <= 0) return null;
        const point = path.getPointAtLength(total * 0.42);
        const ctm = path.getScreenCTM();
        if (!ctm) return null;
        const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(ctm);
        return { x: screenPoint.x, y: screenPoint.y };
      }, id).catch(() => null)
    : null;
  const startX = Math.round(pathDragPoint?.x ?? (box.x + box.width / 2));
  const startY = Math.round(pathDragPoint?.y ?? (box.y + box.height / 2));
  const elementAtStart = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return {
      tagName: el?.tagName || null,
      id: el?.id || null,
      className: typeof el?.className === 'string' ? el.className : (el?.className?.baseVal || null),
      svgLayer: el?.ownerSVGElement?.getAttribute?.('data-svg-annotation-layer') || null,
      annoId: el?.closest?.('[data-anno-id]')?.getAttribute?.('data-anno-id') || null,
      pathHit: el?.getAttribute?.('data-path-hit-target') || null,
      pathBoxHit: el?.getAttribute?.('data-path-bbox-hit-target') || null,
      pathSelectionHit: el?.getAttribute?.('data-path-selection-hit-target') || null,
      pointerEvents: el ? getComputedStyle(el).pointerEvents : null,
    };
  }, { x: startX, y: startY }).catch(() => null);
  const getDragDebug = async (annotationId, x, y) => page.evaluate(({ annotationId, x, y }) => {
    const s = window.__diagState;
    const page = s?.annotationsByPage?.[s?.pageNumber] || Object.values(s?.annotationsByPage || {})[0] || {};
    const objects = Array.isArray(page?.objects) ? page.objects : [];
    const obj = objects.find((candidate) =>
      candidate?.id === annotationId
      || candidate?.data?.id === annotationId
      || candidate?.pdfAnnotationId === annotationId
    );
    const path = Array.isArray(obj?.path) ? obj.path : null;
    const xs = [];
    const ys = [];
    for (const seg of path || []) {
      for (let i = 1; i + 1 < seg.length; i += 2) {
        if (typeof seg[i] === 'number' && typeof seg[i + 1] === 'number') {
          xs.push(seg[i]);
          ys.push(seg[i + 1]);
        }
      }
    }
    const el = document.elementFromPoint(x, y);
    return {
      activeTool: s?.activeTool || null,
      squigglyEventCounts: {
        nativeDown: window.__fix19SquigglyNativeDownCount || 0,
        reactDown: window.__fix19SquigglyReactDownCount || 0,
        reactMouseDown: window.__fix19SquigglyReactMouseDownCount || 0,
      },
      selectedOverlayCount: document.querySelectorAll('.svg-selection-overlay').length,
      selectedWrapperCount: document.querySelectorAll('[data-anno-id]').length,
      elementAtPoint: {
        tagName: el?.tagName || null,
        svgLayer: el?.ownerSVGElement?.getAttribute?.('data-svg-annotation-layer') || null,
        annoId: el?.closest?.('[data-anno-id]')?.getAttribute?.('data-anno-id') || null,
        pathHit: el?.getAttribute?.('data-path-hit-target') || null,
        pathBoxHit: el?.getAttribute?.('data-path-bbox-hit-target') || null,
        pathSelectionHit: el?.getAttribute?.('data-path-selection-hit-target') || null,
        pointerEvents: el ? getComputedStyle(el).pointerEvents : null,
      },
      obj: obj ? {
        id: obj.id || obj.data?.id || obj.pdfAnnotationId || null,
        type: obj.type || null,
        left: obj.left ?? null,
        top: obj.top ?? null,
        pathHead: path ? path.slice(0, 4) : null,
        pathBBox: xs.length ? {
          minX: Math.min(...xs),
          minY: Math.min(...ys),
          maxX: Math.max(...xs),
          maxY: Math.max(...ys),
        } : null,
      } : null,
    };
  }, { annotationId, x, y }).catch(() => null);
  const debugBeforeClick = await getDragDebug(id, startX, startY);

  if (primaryHitLocator) {
    await primaryHitLocator.click({ force: true }).catch(async () => page.mouse.click(startX, startY));
  } else {
    await page.mouse.click(startX, startY);
  }
  await sleep(350);
  const debugAfterClick = await getDragDebug(id, startX, startY);
  if (primaryHitLocator) {
    await primaryHitLocator.hover({ force: true }).catch(async () => page.mouse.move(startX, startY));
  } else {
    await page.mouse.move(startX, startY);
  }
  await page.mouse.down();
  await page.mouse.move(startX + 18, startY + 12, { steps: 8 });
  await page.mouse.up();
  await sleep(100);
  const debugAfterDrag = await getDragDebug(id, startX + 18, startY + 12);
  return {
    selectable: true,
    moved: true,
    svgElementFound: true,
    svgBoundingBoxFound: !!visibleBox,
    svgHitBoxFound: !!hitBox,
    bbox: visibleBox ? {
      x: visibleBox.x,
      y: visibleBox.y,
      width: visibleBox.width,
      height: visibleBox.height,
    } : null,
    hitBox: hitBox ? {
      x: hitBox.x,
      y: hitBox.y,
      width: hitBox.width,
      height: hitBox.height,
    } : null,
    pathDragPoint,
    elementAtStart,
    debugBeforeClick,
    debugAfterClick,
    debugAfterDrag,
    activeToolBeforeDrag: toolState.activeTool,
    devSelectionResult,
  };
}

async function dragFirstVertexHandle(page) {
  const loc = page.locator('svg[data-svg-annotation-layer] circle[fill="#ffffff"][stroke="#4a90e2"]').first();
  const box = await loc.boundingBox().catch(() => null);
  if (!box) {
    return {
      selectable: false,
      moved: false,
      svgVertexHandleFound: false,
      vertexHandleBox: null,
    };
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 16, box.y + box.height / 2 + 10, { steps: 8 });
  await page.mouse.up();
  return {
    selectable: true,
    moved: true,
    svgVertexHandleFound: true,
    vertexHandleBox: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    },
  };
}

function summarizeFamily(family, rowType, beforeState, afterState, consoleLines, startIndex, entityId, moveResult, reloadState) {
  const relevant = consoleLines.slice(startIndex);
  const deltaLine = relevant.find((line) => line.includes('[CloudSync][delta]') && line.includes(entityId));
  const pushLine = relevant.find((line) => line.includes('[CloudSync][push]') && line.includes(entityId));
  const delta = parseJsonTail(deltaLine || '') || {};
  const push = parseJsonTail(pushLine || '') || {};
  const reloaded = family === 'callout'
    ? reloadState.callouts.some((c) => c.id === entityId)
    : reloadState.objects.some((o) => o.id === entityId);
  return {
    family,
    entityId,
    supabaseRowType: rowType,
    createdVisible: family === 'callout'
      ? afterState.callouts.some((c) => c.id === entityId)
      : afterState.objects.some((o) => o.id === entityId),
    selectable: moveResult.selectable,
    moved: moveResult.moved,
    changedCount: delta.changedCount ?? push.changedCount ?? null,
    supabaseUpsertCount: delta.supabaseUpsertCount ?? push.supabaseUpsertCount ?? null,
    yDocUpdateCount: delta.yDocUpdateCount ?? null,
    fullFanOutReason: delta.fullFanOutReason ?? push.fullFanOutReason ?? null,
    reloadResult: reloaded ? 'returned after reload' : 'missing after reload',
    pass: Boolean(entityId && moveResult.selectable && moveResult.moved && reloaded && (delta.fullFanOutReason ?? null) === null),
  };
}

function summarizeImportedFamily(imported, row, afterImportState, reloadState, postReloadMoveResult, postReloadDelta, duplicateImport) {
  const visible = afterImportState.objects.some((o) => o.id === imported.appId || o.pdfAnnotationId === imported.pdfAnnotationId);
  const reloadedObjects = reloadState.objects.filter((o) => o.pdfAnnotationId === imported.pdfAnnotationId);
  const reloadedObject = reloadedObjects[0] || null;
  const duplicateCountAfterReload = Math.max(0, reloadedObjects.length - 1);
  const duplicateImportHits = (duplicateImport?.duplicates || [])
    .filter((d) => d.pdfAnnotationId === imported.pdfAnnotationId).length;
  const delta = postReloadDelta?.payload || {};

  return {
    family: `imported ${imported.pdfAnnotationType}`,
    documentPdfUsed: null,
    sourceNativeAnnotationSubtype: imported.pdfAnnotationType,
    importedAppRowType: row?.annotation_type || null,
    appId: imported.appId,
    pdfAnnotationId: imported.pdfAnnotationId,
    visibleAfterImport: visible,
    importerFabricSelectableFlag: imported.selectable === true,
    importerFabricEventedFlag: imported.evented === true,
    fabricSelectableFlagAfterReload: reloadedObject?.selectable === true,
    fabricEventedFlagAfterReload: reloadedObject?.evented === true,
    svgElementFoundAfterReload: postReloadMoveResult.svgElementFound === true,
    svgBoundingBoxFoundAfterReload: postReloadMoveResult.svgBoundingBoxFound === true,
    svgBoundingBoxAfterReload: postReloadMoveResult.bbox || null,
    svgHitBoxFoundAfterReload: postReloadMoveResult.svgHitBoxFound === true,
    dragElementAtStart: postReloadMoveResult.elementAtStart || null,
    dragDebugBeforeClick: postReloadMoveResult.debugBeforeClick || null,
    dragDebugAfterClick: postReloadMoveResult.debugAfterClick || null,
    dragDebugAfterDrag: postReloadMoveResult.debugAfterDrag || null,
    dragStartPoint: postReloadMoveResult.pathDragPoint || null,
    svgSelectable: postReloadMoveResult.selectable === true,
    postReloadMoveResult: postReloadMoveResult.resultLabel || (postReloadMoveResult.moved ? 'moved by SVG drag after reload' : 'not moved after reload'),
    svgVertexHandleFoundAfterReload: postReloadMoveResult.svgVertexHandleFound === true,
    svgVertexHandleBoxAfterReload: postReloadMoveResult.vertexHandleBox || null,
    devMoveFallbackUsed: postReloadMoveResult.devMoveFallbackUsed === true,
    postReloadMoveDeltaLine: postReloadDelta?.line || null,
    postReloadMoveChangedCount: delta.changedCount ?? null,
    postReloadMoveSupabaseUpsertCount: delta.supabaseUpsertCount ?? null,
    yDocUpdateCount: delta.yDocUpdateCount ?? null,
    postReloadMoveYDocUpdateCount: delta.yDocUpdateCount ?? null,
    postReloadMoveFullFanOutReason: delta.fullFanOutReason ?? null,
    reloadResult: reloadedObjects.length === 1 ? 'returned once after reload' : `returned ${reloadedObjects.length} rows after reload`,
    duplicateCountAfterReload,
    duplicateImportResult: duplicateImportHits > 0 ? 'second import detected existing app copy' : 'second import did not report duplicate',
    pass: Boolean(
      imported.appId
      && imported.pdfAnnotationId
      && row?.annotation_type
      && visible
      && postReloadMoveResult.svgElementFound === true
      && postReloadMoveResult.svgBoundingBoxFound === true
      && postReloadMoveResult.selectable === true
      && postReloadMoveResult.moved === true
      && postReloadMoveResult.devMoveFallbackUsed !== true
      && reloadedObjects.length === 1
      && duplicateCountAfterReload === 0
      && duplicateImportHits === 1
      && delta.changedCount === 1
      && delta.supabaseUpsertCount === 1
      && delta.yDocUpdateCount === 1
      && delta.fullFanOutReason === null
    ),
  };
}

loadEnv('.env');
loadEnv('.env.local');

const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_DEV_AUTO_LOGIN_EMAIL', 'VITE_DEV_AUTO_LOGIN_PASSWORD'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

fs.mkdirSync(LOGS_ROOT, { recursive: true });
const logDir = path.join(LOGS_ROOT, `${stampForFolder()}_fix19-live-auth`);
fs.mkdirSync(logDir, { recursive: true });

const consoleLines = [];
const network = [];
const failures = [];
const evidence = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  logDir,
  document: null,
  families: [],
  importedFamilies: [],
  importedHookResult: null,
  duplicateHookResult: null,
  blocked: [],
  finalRowsByType: {},
  reloadState: null,
  networkFailedRequestCount: 0,
  networkFailedSupabaseWriteCount: 0,
  consoleErrorCount: 0,
  wholePageFanOut: false,
  phantomSelection: false,
};

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const signIn = await supabase.auth.signInWithPassword({
  email: process.env.VITE_DEV_AUTO_LOGIN_EMAIL,
  password: process.env.VITE_DEV_AUTO_LOGIN_PASSWORD,
});
if (signIn.error) throw signIn.error;
const userId = signIn.data.user.id;
const document = await createDisposableDocument(supabase, userId);
evidence.document = {
  id: document.id,
  name: document.name,
  filePath: document.file_path,
  fileSize: document.file_size,
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

page.on('console', (msg) => {
  const line = `${new Date().toISOString()} ${msg.type()} ${msg.text()}`;
  consoleLines.push(line);
});
page.on('request', (request) => {
  network.push({ event: 'request', method: request.method(), url: request.url(), ts: new Date().toISOString() });
});
page.on('response', (response) => {
  network.push({
    event: 'response',
    status: response.status(),
    ok: response.ok(),
    url: response.url(),
    ts: new Date().toISOString(),
  });
});
page.on('requestfailed', (request) => {
  const row = {
    event: 'requestfailed',
    method: request.method(),
    url: request.url(),
    failure: request.failure()?.errorText || null,
    ts: new Date().toISOString(),
  };
  failures.push(row);
  network.push(row);
});

let runError = null;
try {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await sleep(4_000);
  await page.getByText(document.name, { exact: true }).click({ timeout: 30_000 });
  await page.waitForSelector('.e-pv-page-container', { timeout: 60_000 });
  await sleep(7_000);

  const importStartIndex = consoleLines.length;
  const hookResult = await page.evaluate(async () => {
    if (typeof window.__fix19ImportPdfAnnotations !== 'function') {
      throw new Error('window.__fix19ImportPdfAnnotations is not available');
    }
    return window.__fix19ImportPdfAnnotations();
  });
  evidence.importedHookResult = hookResult;
  const importedState = await waitForImportedPdfTypes(page, ['Squiggly', 'PolyLine', 'Polygon'], 15_000);
  await waitForSynced(consoleLines, importStartIndex, 12_000);
  await sleep(1200);

  const importedRows = await supabase
    .from('document_annotations')
    .select('highlight_id, annotation_type, page_number, annotation_data')
    .eq('document_id', document.id)
    .in('highlight_id', hookResult.imported.map((i) => i.appId));
  if (importedRows.error) throw importedRows.error;
  const rowById = new Map((importedRows.data || []).map((row) => [row.highlight_id, row]));

  const duplicateHookResult = await page.evaluate(async () => window.__fix19ImportPdfAnnotations());
  evidence.duplicateHookResult = duplicateHookResult;
  await sleep(1000);

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await sleep(4_000);
  await page.getByText(document.name, { exact: true }).click({ timeout: 30_000 });
  await page.waitForSelector('.e-pv-page-container', { timeout: 60_000 });
  await sleep(8_000);
  const reloadState = await getAppState(page);
  evidence.reloadState = reloadState;

  const postReloadMoves = new Map();
  const postReloadDeltas = new Map();
  for (const imported of hookResult.imported) {
    const moveStart = consoleLines.length;
    let moveResult = await moveSvgEntity(page, imported.appId);
    let deltaResult = await waitForCloudDeltaForId(consoleLines, moveStart, imported.appId, 12_000);
    if (!deltaResult.payload && imported.appType === 'polyline') {
      await page.evaluate((annotationId) => {
        if (typeof window.__fix19SelectAnnotation === 'function') {
          window.__fix19SelectAnnotation(annotationId);
        }
      }, imported.appId);
      await sleep(500);
      const vertexStart = consoleLines.length;
      const vertexResult = await dragFirstVertexHandle(page);
      const vertexDelta = await waitForCloudDeltaForId(consoleLines, vertexStart, imported.appId, 12_000);
      if (vertexDelta.payload) {
        moveResult = {
          ...moveResult,
          ...vertexResult,
          resultLabel: 'edited by SVG vertex-handle drag after reload',
        };
        deltaResult = vertexDelta;
      }
    } else if (deltaResult.payload) {
      moveResult = {
        ...moveResult,
        resultLabel: 'moved by SVG body drag after reload',
      };
    }
    await waitForSynced(consoleLines, moveStart, 12_000);
    await sleep(900);
    postReloadMoves.set(imported.appId, moveResult);
    postReloadDeltas.set(imported.appId, deltaResult);
  }

  evidence.importedFamilies = hookResult.imported.map((imported) => {
    const summary = summarizeImportedFamily(
      imported,
      rowById.get(imported.appId),
      importedState,
      reloadState,
      postReloadMoves.get(imported.appId) || {
        selectable: false,
        moved: false,
        svgElementFound: false,
        svgBoundingBoxFound: false,
        bbox: null,
      },
      postReloadDeltas.get(imported.appId) || { line: null, payload: null },
      duplicateHookResult
    );
    summary.documentPdfUsed = document.name;
    return summary;
  });

  const rowQuery = await supabase
    .from('document_annotations')
    .select('highlight_id, annotation_type, page_number')
    .eq('document_id', document.id);
  if (rowQuery.error) throw rowQuery.error;
  evidence.finalRowsByType = countBy(rowQuery.data || [], 'annotation_type');
} catch (err) {
  runError = err;
  evidence.error = err?.stack || err?.message || String(err);
} finally {
  await browser.close().catch(() => {});
}

evidence.endedAt = new Date().toISOString();
evidence.networkFailedRequestCount = failures.length;
evidence.networkFailedSupabaseWriteCount = failures.filter((row) =>
  ['POST', 'PATCH', 'PUT', 'DELETE'].includes(String(row.method || '').toUpperCase())
  && /supabase/i.test(row.url || '')
  && /document_annotations|doc_yjs_updates|doc_yjs_state/i.test(row.url || '')
).length;
evidence.consoleErrorCount = consoleLines.filter((line) =>
  /\bconsole\.error\b|\bUncaught\b|\bTypeError\b|\bReferenceError\b|^.* error /i.test(line)
).length;
evidence.wholePageFanOut = consoleLines.some((line) =>
  line.includes('[CloudSync][delta]') && !line.includes('"fullFanOutReason":null')
);
evidence.phantomSelection = consoleLines.some((line) =>
  /phantom|stale selection|selection.*missing/i.test(line)
);
evidence.pass = !runError
  && evidence.importedFamilies.length === 3
  && evidence.importedFamilies.every((f) => f.pass)
  && evidence.families.every((f) => f.pass)
  && evidence.networkFailedSupabaseWriteCount === 0
  && evidence.consoleErrorCount === 0
  && !evidence.wholePageFanOut
  && !evidence.phantomSelection
  && evidence.blocked.length === 0;

fs.writeFileSync(path.join(logDir, 'console.log'), `${consoleLines.join('\n')}\n`, 'utf8');
fs.writeFileSync(path.join(logDir, 'network.json'), JSON.stringify(network, null, 2), 'utf8');
fs.writeFileSync(path.join(logDir, 'summary.json'), JSON.stringify({
  url: BASE_URL,
  document: evidence.document,
  networkFailedRequestCount: evidence.networkFailedRequestCount,
  networkFailedSupabaseWriteCount: evidence.networkFailedSupabaseWriteCount,
  consoleErrorCount: evidence.consoleErrorCount,
  wholePageFanOut: evidence.wholePageFanOut,
  phantomSelection: evidence.phantomSelection,
  pass: evidence.pass,
  savedAtIso: new Date().toISOString(),
  snapshotName: path.basename(logDir),
}, null, 2), 'utf8');
fs.writeFileSync(path.join(logDir, 'fix19-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');

console.log(JSON.stringify({
  pass: evidence.pass,
  logDir,
  document: evidence.document,
  families: evidence.families.map((f) => ({
    family: f.family,
    pass: f.pass,
    rowType: f.supabaseRowType,
    changedCount: f.changedCount,
    supabaseUpsertCount: f.supabaseUpsertCount,
    yDocUpdateCount: f.yDocUpdateCount,
    reloadResult: f.reloadResult,
  })),
  importedFamilies: evidence.importedFamilies.map((f) => ({
    family: f.family,
    pass: f.pass,
    rowType: f.importedAppRowType,
    appId: f.appId,
    pdfAnnotationId: f.pdfAnnotationId,
    fabricSelectableFlagAfterReload: f.fabricSelectableFlagAfterReload,
    fabricEventedFlagAfterReload: f.fabricEventedFlagAfterReload,
    svgElementFoundAfterReload: f.svgElementFoundAfterReload,
    svgBoundingBoxFoundAfterReload: f.svgBoundingBoxFoundAfterReload,
    postReloadMoveChangedCount: f.postReloadMoveChangedCount,
    postReloadMoveSupabaseUpsertCount: f.postReloadMoveSupabaseUpsertCount,
    postReloadMoveYDocUpdateCount: f.postReloadMoveYDocUpdateCount,
    postReloadMoveFullFanOutReason: f.postReloadMoveFullFanOutReason,
    reloadResult: f.reloadResult,
    duplicateCountAfterReload: f.duplicateCountAfterReload,
  })),
  blocked: evidence.blocked,
  networkFailedRequestCount: evidence.networkFailedRequestCount,
  networkFailedSupabaseWriteCount: evidence.networkFailedSupabaseWriteCount,
  consoleErrorCount: evidence.consoleErrorCount,
  wholePageFanOut: evidence.wholePageFanOut,
  phantomSelection: evidence.phantomSelection,
}, null, 2));

if (runError) process.exit(1);
if (!evidence.pass) process.exit(2);
