import { DEFAULT_ROUTE } from './constants.mjs';

const TOOL_MATCHERS = Object.freeze({
  pen: (object) => String(object?.type || '').toLowerCase() === 'path'
    && String(object?.data?.tool || object?.tool || '').toLowerCase() === 'pen',
  highlighter: (object) => String(object?.type || '').toLowerCase() === 'path'
    && String(object?.data?.tool || object?.tool || '').toLowerCase() === 'highlighter',
  line: (object) => String(object?.type || '').toLowerCase() === 'line'
    && String(object?.data?.tool || object?.tool || '').toLowerCase() !== 'arrow',
  arrow: (object) => String(object?.type || '').toLowerCase() === 'line'
    && String(object?.data?.tool || object?.tool || '').toLowerCase() === 'arrow',
  rectangle: (object) => String(object?.type || '').toLowerCase() === 'rect',
  ellipse: (object) => String(object?.type || '').toLowerCase() === 'ellipse',
  text: (object) => String(object?.type || '').toLowerCase() === 'textbox',
  counter: (object) => String(object?.type || '').toLowerCase() === 'circle'
    && object?.data?.type === 'counter',
});

export function isFirstPageRasterSizeReady(size) {
  const width = Number(size?.width || 0);
  const height = Number(size?.height || 0);
  return width > 0 && height > 0 && !(width === 300 && height === 150);
}

async function uniqueButton(page, name) {
  const button = page.getByRole('button', { name, exact: true });
  const count = await button.count();
  if (count !== 1) throw new Error(`Expected one visible ${name} button, found ${count}`);
  return button;
}

async function activateGroupedTool(page, group, label) {
  let tool = page.locator('.mobile-pdf-tools__subtools').getByRole('button', { name: label, exact: true });
  if (await tool.count() === 0) {
    await (await uniqueButton(page, group)).click();
    tool = page.locator('.mobile-pdf-tools__subtools').getByRole('button', { name: label, exact: true });
  }
  if (await tool.count() !== 1) throw new Error(`Could not open ${group} → ${label}`);
  await tool.click();
}

export async function openRealMobileViewer(page, baseUrl, { navigate = true } = {}) {
  if (navigate) {
    await page.goto(`${baseUrl}${DEFAULT_ROUTE}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
  }
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor({
    state: 'visible',
    timeout: 60_000,
  });
  await page.locator('[data-svg-annotation-layer="1"]').waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  await page.waitForFunction(() => {
    const canvases = [...document.querySelectorAll(
      '.survey-pdfjs-page-div[data-page-number="1"] canvas',
    )];
    return canvases.some((canvas) => (
      canvas instanceof HTMLCanvasElement
      && canvas.width > 0
      && canvas.height > 0
      && !(canvas.width === 300 && canvas.height === 150)
    ));
  }, null, { timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__phase35GetAnnotationById === 'function');
}

async function visiblePageBox(page) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  if (!box || box.width < 40 || box.height < 40) throw new Error('Real PDF page has no usable geometry');
  const viewport = page.viewportSize();
  const top = Math.max(box.y + 20, 112);
  const bottom = Math.min(box.y + box.height - 20, viewport.height - 110);
  if (bottom - top < 80) throw new Error(`PDF page visible area is too small: ${bottom - top}px`);
  return { ...box, visibleTop: top, visibleBottom: bottom };
}

async function newAnnotationId(page, beforeIds, expectedTool) {
  return page.waitForFunction(({ priorIds, toolId }) => {
    const prior = new Set(priorIds);
    const groups = [...document.querySelectorAll('g[data-anno-id]')];
    const lookup = (id) => {
      const direct = window.__phase35GetAnnotationById?.(id) || null;
      if (direct) return direct;
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith('annotationsByPage_')) continue;
        try {
          const pages = JSON.parse(localStorage.getItem(key) || '{}');
          for (const entry of Object.values(pages)) {
            const found = entry?.objects?.find((object) => object?.id === id || object?.data?.id === id);
            if (found) return found;
          }
        } catch { /* ignore unrelated cache */ }
      }
      return null;
    };
    const matches = (object) => {
      if (object?.isPdfImported === true) return false;
      const type = String(object?.type || '').toLowerCase();
      const tool = String(object?.data?.tool || object?.tool || '').toLowerCase();
      if (toolId === 'pen' || toolId === 'highlighter') return type === 'path' && tool === toolId;
      if (toolId === 'line') return type === 'line' && tool !== 'arrow';
      if (toolId === 'arrow') return type === 'line' && tool === 'arrow';
      if (toolId === 'rectangle') return type === 'rect';
      if (toolId === 'ellipse') return type === 'ellipse';
      if (toolId === 'text') return type === 'textbox';
      if (toolId === 'counter') return type === 'circle' && object?.data?.type === 'counter';
      return false;
    };
    for (const group of groups) {
      const id = group.getAttribute('data-anno-id');
      if (id && !prior.has(id) && matches(lookup(id))) return id;
    }
    return null;
  }, { priorIds: [...beforeIds], toolId: expectedTool }).then((handle) => handle.jsonValue());
}

async function newCalloutId(page, beforeIds) {
  return page.waitForFunction((priorIds) => {
    const prior = new Set(priorIds);
    return [...document.querySelectorAll('[data-callout-id]')]
      .map((element) => element.getAttribute('data-callout-id'))
      .find((id) => id && !prior.has(id)) || null;
  }, [...beforeIds]).then((handle) => handle.jsonValue());
}

function strokePoints(box, yFraction) {
  const y = box.visibleTop + (box.visibleBottom - box.visibleTop) * yFraction;
  return [
    { x: box.x + box.width * 0.22, y },
    { x: box.x + box.width * 0.32, y: y - 8 },
    { x: box.x + box.width * 0.43, y: y + 5 },
    { x: box.x + box.width * 0.54, y: y - 5 },
    { x: box.x + box.width * 0.65, y: y + 7 },
    { x: box.x + box.width * 0.76, y },
  ];
}

export async function createAnnotation(page, touch, toolId, beforeIds) {
  if (toolId === 'pen' || toolId === 'highlighter') {
    await activateGroupedTool(page, 'Draw', toolId === 'pen' ? 'Pen' : 'Highlighter');
    const box = await visiblePageBox(page);
    await touch.stroke(strokePoints(box, toolId === 'pen' ? 0.68 : 0.82));
  } else if (['rectangle', 'ellipse', 'line', 'arrow'].includes(toolId)) {
    const labels = { rectangle: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow' };
    await activateGroupedTool(page, 'Shapes', labels[toolId]);
    const box = await visiblePageBox(page);
    const visibleHeight = box.visibleBottom - box.visibleTop;
    const positions = {
      rectangle: [0.56, 0.72, 0.78, 0.88],
      ellipse: [0.52, 0.18, 0.76, 0.4],
      line: [0.18, 0.5, 0.48, 0.62],
      arrow: [0.5, 0.5, 0.78, 0.66],
    }[toolId];
    await touch.drag(
      { x: box.x + box.width * positions[0], y: box.visibleTop + visibleHeight * positions[1] },
      { x: box.x + box.width * positions[2], y: box.visibleTop + visibleHeight * positions[3] },
      { steps: 12 },
    );
  } else if (toolId === 'counter') {
    await activateGroupedTool(page, 'Shapes', 'Counter');
    const overlay = page.locator('[data-counter-overlay="1"]');
    await overlay.waitFor({ state: 'visible', timeout: 10_000 });
    const box = await overlay.boundingBox();
    if (!box) throw new Error('Counter overlay has no geometry');
    await touch.drag(
      { x: box.x + box.width * 0.7, y: box.y + box.height * 0.68 },
      { x: box.x + box.width * 0.74, y: box.y + box.height * 0.72 },
      { steps: 5 },
    );
  } else if (toolId === 'text') {
    await activateGroupedTool(page, 'Text', 'Text');
    const overlay = page.locator('[data-text-overlay="1"]');
    await overlay.waitFor({ state: 'visible', timeout: 10_000 });
    const box = await overlay.boundingBox();
    if (!box) throw new Error('Text overlay has no geometry');
    await touch.tap({ x: box.x + box.width * 0.34, y: box.y + box.height * 0.62 });
    const editor = page.locator('[data-text-edit-overlay] [contenteditable]');
    await editor.waitFor({ state: 'visible', timeout: 10_000 });
    await editor.fill('Mobile text lifecycle');
    await (await uniqueButton(page, 'Pan')).click();
  } else if (toolId === 'callout') {
    const priorCallouts = await page.locator('[data-callout-id]').evaluateAll((elements) => (
      elements.map((element) => element.getAttribute('data-callout-id')).filter(Boolean)
    ));
    await activateGroupedTool(page, 'Text', 'Callout');
    const box = await visiblePageBox(page);
    const visibleHeight = box.visibleBottom - box.visibleTop;
    await touch.drag(
      { x: box.x + box.width * 0.24, y: box.visibleTop + visibleHeight * 0.74 },
      { x: box.x + box.width * 0.55, y: box.visibleTop + visibleHeight * 0.58 },
      { steps: 12 },
    );
    const calloutId = await newCalloutId(page, priorCallouts);
    const editor = page.locator('[data-text-edit-overlay] [contenteditable]');
    await editor.waitFor({ state: 'visible', timeout: 10_000 });
    await editor.fill('Mobile callout lifecycle');
    await (await uniqueButton(page, 'Pan')).click();
    return { id: calloutId, kind: 'callout' };
  } else {
    throw new Error(`No create scenario for ${toolId}`);
  }

  const id = await newAnnotationId(page, beforeIds, toolId);
  const object = await waitForMountedAnnotation(page, id);
  if (!TOOL_MATCHERS[toolId]?.(object)) {
    throw new Error(`${toolId}: created object model mismatch: ${JSON.stringify(object)}`);
  }
  return { id, kind: 'annotation', object };
}

export async function waitForMountedCallout(page, id, timeoutMs = 10_000) {
  const selector = `[data-callout-id="${String(id).replace(/["\\]/g, '\\$&')}"]`;
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: timeoutMs });
  return selector;
}

export async function mountedAnnotation(page, id) {
  return page.evaluate((annotationId) => {
    const direct = window.__phase35GetAnnotationById?.(annotationId) || null;
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith('annotationsByPage_')) continue;
      try {
        const pages = JSON.parse(localStorage.getItem(key) || '{}');
        for (const entry of Object.values(pages)) {
          const found = entry?.objects?.find((object) => (
            object?.id === annotationId || object?.data?.id === annotationId
          ));
          if (found) return found;
        }
      } catch { /* ignore malformed unrelated caches */ }
    }
    return null;
  }, id);
}

export async function waitForMountedAnnotation(page, id, timeoutMs = 10_000) {
  const selector = `g[data-anno-id="${String(id).replace(/["\\]/g, '\\$&')}"]`;
  await page.locator(selector).waitFor({ state: 'visible', timeout: timeoutMs });
  await page.waitForFunction((annotationId) => {
    if (window.__phase35GetAnnotationById?.(annotationId)) return true;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith('annotationsByPage_')) continue;
      try {
        const pages = JSON.parse(localStorage.getItem(key) || '{}');
        if (Object.values(pages).some((entry) => entry?.objects?.some((object) => (
          object?.id === annotationId || object?.data?.id === annotationId
        )))) return true;
      } catch { /* ignore */ }
    }
    return false;
  }, id, { timeout: timeoutMs });
  return mountedAnnotation(page, id);
}
