import { test, expect } from '@playwright/test';

// Eraser Size catalog — every discrete preset + custom field.
// Distinct from D-05 stroke Width (12 presets, 1–50) and Counter Size
// (8 presets, 4–76). D-05 mixed Width + 1–100 is NOT a substitute.
// Do not replay leftover-18 / F3 / series Delete / cloud bump / pickers.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const ERASER_PRESETS = [1, 4, 8, 12, 16, 24, 32, 48, 64, 80, 100];

async function openEditor(page) {
  await page.goto(LINK_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if (!(String(await sub.first().getAttribute('class') || '').includes('btn-active'))) {
      await sub.first().click();
    }
    return;
  }
  await page.getByRole('button', { name: categoryName, exact: true }).click();
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if (!(String(await target.getAttribute('class') || '').includes('btn-active'))) {
    await target.click();
  }
}

async function activatePen(page) {
  await activateTool(page, 'Draw', 'Pen');
  await expect(page.getByRole('textbox', { name: 'Width', exact: true })).toBeVisible({ timeout: 8_000 });
}

async function activateEraser(page, { mode = 'partial' } = {}) {
  await activateTool(page, 'Draw', mode === 'entire' ? 'Full stroke erase' : 'Partial erase');
  if (mode === 'entire') {
    const current = page.getByRole('button', { name: 'Full stroke erase', exact: true });
    if (await current.count() === 0) {
      await page.getByRole('button', { name: 'Eraser type', exact: true }).click();
      await page.getByRole('button', { name: 'Full stroke erase', exact: true }).click();
    }
  }
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('textbox', { name: 'Size', exact: true })).toBeVisible({ timeout: 8_000 });
}

async function sizeField(page) {
  return page.getByRole('textbox', { name: 'Size', exact: true });
}

async function widthField(page) {
  return page.getByRole('textbox', { name: 'Width', exact: true });
}

async function setSizeTyped(page, raw) {
  const field = await sizeField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
  await field.press('Enter');
}

async function pickSizePreset(page, preset) {
  const trigger = page.getByRole('button', { name: 'Size presets', exact: true });
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-size-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: String(preset), exact: true });
  if (await option.count()) {
    await option.click();
  } else {
    await popover.getByText(String(preset), { exact: true }).click();
  }
  await expect(popover).toHaveCount(0);
}

async function listSizePresets(page) {
  const trigger = page.getByRole('button', { name: 'Size presets', exact: true });
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-size-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const values = await popover.getByRole('option').evaluateAll((nodes) => (
    nodes.map((node) => Number(node.querySelector('.annotation-size-control__preset-value')?.textContent?.trim()))
      .filter((n) => Number.isFinite(n))
  ));
  const hasSlider = await popover.locator('input[type="range"]').count();
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  return { values, hasSlider };
}

async function createPenStroke(page, { width = 6, yFraction = 0.62 } = {}) {
  await activatePen(page);
  const widthInput = await widthField(page);
  await widthInput.fill(String(width));
  await widthInput.press('Tab');
  await expect(widthInput).toHaveValue(String(width));

  const before = new Set(await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  )));

  const box = await pageBox(page);
  const y = box.y + box.height * yFraction;
  const points = [
    { x: box.x + box.width * 0.18, y },
    { x: box.x + box.width * 0.32, y: y - 3 },
    { x: box.x + box.width * 0.46, y: y + 2 },
    { x: box.x + box.width * 0.60, y: y - 2 },
    { x: box.x + box.width * 0.74, y: y + 3 },
    { x: box.x + box.width * 0.86, y },
  ];
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 3 });
  }
  await page.mouse.up();

  let createdId = null;
  await expect.poll(async () => {
    createdId = await page.evaluate((existingIds) => {
      const known = new Set(existingIds);
      return [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((group) => group.getAttribute('data-anno-id'))
        .find((id) => {
          if (!id || known.has(id)) return false;
          const object = window.__phase35GetAnnotationById?.(id) || {};
          return object.isPdfImported !== true
            && String(object.type || '').toLowerCase() === 'path';
        }) || null;
    }, [...before]);
    return createdId;
  }, { message: 'Pen gesture must commit a local path' }).not.toBeNull();
  return createdId;
}

async function userInkMetric(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => {
        const id = group.getAttribute('data-anno-id');
        const object = window.__phase35GetAnnotationById?.(id) || {};
        if (!id || object.isPdfImported === true) return null;
        const type = String(object.type || '').toLowerCase();
        const tool = String(object.data?.tool || object.tool || '').toLowerCase();
        if (type !== 'path' && tool !== 'pen') return null;
        const d = group.querySelector('path')?.getAttribute('d') || '';
        let ink = 0;
        const path = object.path;
        if (Array.isArray(path)) {
          let last = null;
          for (const cmd of path) {
            const x = Number(cmd[cmd.length - 2]);
            const y = Number(cmd[cmd.length - 1]);
            if (Number.isFinite(x) && Number.isFinite(y)) {
              if (last) ink += Math.hypot(x - last.x, y - last.y);
              last = { x, y };
            }
          }
        }
        return {
          id,
          dLen: d.length,
          ink,
          pathCmds: Array.isArray(path) ? path.length : 0,
        };
      })
      .filter(Boolean);
    return {
      ids: rows.map((row) => row.id),
      dLen: rows.reduce((sum, row) => sum + row.dLen, 0),
      ink: rows.reduce((sum, row) => sum + row.ink, 0),
      pathCmds: rows.reduce((sum, row) => sum + row.pathCmds, 0),
      count: rows.length,
    };
  });
}

function inkChanged(before, after) {
  return before.dLen !== after.dLen
    || Math.abs(before.ink - after.ink) > 0.25
    || before.count !== after.count
    || before.ids.join('|') !== after.ids.join('|');
}

async function containerAwareScale(page) {
  return page.evaluate(() => {
    const pageEl = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const svg = document.querySelector('[data-svg-annotation-layer="1"] svg, [data-svg-annotation-layer="1"]');
    const viewBox = svg?.viewBox?.baseVal;
    const pageWidth = viewBox?.width || 0;
    const offsetWidth = pageEl?.offsetWidth || 0;
    const reportedScale = Number(pageEl?.dataset?.scale || pageEl?.getAttribute('data-scale') || 0);
    return {
      offsetWidth,
      pageWidth,
      effectiveScale: pageWidth > 0 ? offsetWidth / pageWidth : 0,
      reportedScale,
      product: pageWidth * (reportedScale || 0),
    };
  });
}

async function measureCursor(page, expectedDiameter) {
  const wrapper = page.locator('[data-diag-eraser-wrapper="1"]');
  await expect(wrapper).toBeVisible();
  const box = await wrapper.boundingBox();
  expect(box, 'eraser wrapper geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.40);
  const scale = await containerAwareScale(page);
  let cursor = null;
  await expect.poll(async () => {
    cursor = await page.locator('[data-eraser-cursor="true"]').evaluateAll((nodes) => {
      const visible = nodes.find((node) => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && parseFloat(style.width) > 0;
      });
      if (!visible) return null;
      const style = getComputedStyle(visible);
      return {
        width: parseFloat(style.width),
        height: parseFloat(style.height),
        display: style.display,
      };
    });
    return cursor;
  }, { message: `eraser cursor must appear for diameter ${expectedDiameter}` }).not.toBeNull();
  const expected = expectedDiameter * scale.effectiveScale;
  return { ...cursor, ...scale, expected };
}

async function currentStrokeId(page) {
  const metric = await userInkMetric(page);
  expect(metric.ids.length, 'a user pen stroke must remain').toBeGreaterThan(0);
  return metric.ids[0];
}

async function eraseAlongStroke(page, id, { startFrac = 0.32, endFrac = 0.48 } = {}) {
  const points = await page.evaluate(({ annotationId, startFrac: start, endFrac: end }) => {
    const object = window.__phase35GetAnnotationById?.(annotationId);
    const wrapper = document.querySelector('[data-diag-eraser-wrapper="1"]');
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    const rect = wrapper?.getBoundingClientRect();
    const viewBox = svg?.viewBox?.baseVal;
    if (!object || !rect || !viewBox?.width || !viewBox?.height) return [];
    const pts = [];
    for (const cmd of object.path || []) {
      const x = Number(cmd[cmd.length - 2]);
      const y = Number(cmd[cmd.length - 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        pts.push({
          x: rect.left + (x / viewBox.width) * rect.width,
          y: rect.top + (y / viewBox.height) * rect.height,
        });
      }
    }
    if (pts.length < 2) return pts;
    const i0 = Math.floor((pts.length - 1) * start);
    const i1 = Math.max(i0 + 1, Math.floor((pts.length - 1) * end));
    return pts.slice(i0, i1 + 1);
  }, { annotationId: id, startFrac, endFrac });
  expect(points.length, `path samples for ${id}`).toBeGreaterThanOrEqual(2);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 3 });
  }
  await page.mouse.up();
}

async function undoOnce(page) {
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

test('eraser Size every preset + custom field intended + break + edge', async ({ page }) => {
  const hunts = [];
  await openEditor(page);

  await activateEraser(page);
  const size = await sizeField(page);
  await expect(size).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('textbox', { name: 'Width', exact: true })).toHaveCount(0);
  const chrome = await listSizePresets(page);
  expect(chrome.values, 'live Size popover must list every eraser preset').toEqual(ERASER_PRESETS);
  expect(chrome.hasSlider, 'desktop Size chrome has a field + popover, not a slider').toBe(0);
  hunts.push({
    hunt: 'inspect — Size field + presets 1/4/8/12/16/24/32/48/64/80/100; no slider',
    pass: true,
    values: chrome.values,
  });

  await activatePen(page);
  const strokeId = await createPenStroke(page, { width: 6, yFraction: 0.58 });
  const originalInk = await userInkMetric(page);
  expect(originalInk.count).toBeGreaterThanOrEqual(1);
  expect(originalInk.ids).toContain(strokeId);

  await activateEraser(page);
  await expect(size).toBeVisible();
  const defaultSize = await size.inputValue();
  hunts.push({
    hunt: 'intended — Eraser arm reveals Size (not Width / D-05)',
    pass: true,
    defaultSize,
  });

  const proven = [];
  const remaining = [];
  let cursorAtOne = 0;
  let cursorAtHundred = 0;

  for (const preset of ERASER_PRESETS) {
    await pickSizePreset(page, preset);
    await expect(size).toHaveValue(String(preset));

    const cursor = await measureCursor(page, preset);
    expect(cursor.width, `cursor width for Size ${preset}`).toBeGreaterThan(0);
    expect(
      Math.abs(cursor.width - cursor.expected),
      `cursor ${cursor.width}px must match diameter ${preset} × container-aware scale ${cursor.effectiveScale} (expected ${cursor.expected})`,
    ).toBeLessThanOrEqual(Math.max(2, cursor.expected * 0.08));
    expect(cursor.height).toBeCloseTo(cursor.width, 1);
    if (preset === 1) cursorAtOne = cursor.width;
    if (preset === 100) cursorAtHundred = cursor.width;

    const strokeId = await currentStrokeId(page);
    const before = await userInkMetric(page);
    await eraseAlongStroke(page, strokeId);
    let after = before;
    await expect.poll(async () => {
      after = await userInkMetric(page);
      return inkChanged(before, after);
    }, { message: `Size ${preset} erase must change cut geometry` }).toBe(true);

    remaining.push({
      preset,
      cursorWidth: cursor.width,
      expected: cursor.expected,
      effectiveScale: cursor.effectiveScale,
      beforeInk: before.ink,
      afterInk: after.ink,
      beforeD: before.dLen,
      afterD: after.dLen,
      beforeCount: before.count,
      afterCount: after.count,
    });

    await undoOnce(page);
    await expect.poll(async () => {
      const restored = await userInkMetric(page);
      return restored.ids.join('|') === originalInk.ids.join('|')
        && Math.abs(restored.ink - originalInk.ink) < 1;
    }, { message: `Undo after Size ${preset} must restore the stroke` }).toBe(true);

    proven.push(preset);
  }

  expect(proven).toEqual(ERASER_PRESETS);
  expect(cursorAtHundred, 'Size 100 cursor must be larger than Size 1').toBeGreaterThan(cursorAtOne * 8);
  const remainOne = remaining.find((row) => row.preset === 1);
  const remainHundred = remaining.find((row) => row.preset === 100);
  expect(remainOne.afterInk, 'Size 1 should leave more ink than Size 100').toBeGreaterThan(remainHundred.afterInk);
  hunts.push({
    hunt: 'intended — every Size preset 1/4/8/12/16/24/32/48/64/80/100 applies cursor + cut',
    pass: true,
    proven,
    cursorAtOne,
    cursorAtHundred,
    remaining: remaining.map((row) => ({
      preset: row.preset,
      cursor: row.cursorWidth,
      afterInk: Number(row.afterInk.toFixed(2)),
    })),
  });

  await setSizeTyped(page, 40);
  await expect(size).toHaveValue('40');
  const customCursor = await measureCursor(page, 40);
  expect(Math.abs(customCursor.width - customCursor.expected)).toBeLessThanOrEqual(
    Math.max(2, customCursor.expected * 0.08),
  );
  const beforeCustom = await userInkMetric(page);
  await eraseAlongStroke(page, await currentStrokeId(page), { startFrac: 0.50, endFrac: 0.64 });
  await expect.poll(async () => inkChanged(beforeCustom, await userInkMetric(page)), {
    message: 'custom Size 40 must cut geometry',
  }).toBe(true);
  await undoOnce(page);
  hunts.push({
    hunt: 'intended — custom field 40 (not a preset) applies cursor + cut',
    pass: true,
    cursor: customCursor.width,
    expected: customCursor.expected,
  });

  await pickSizePreset(page, 16);
  await expect(size).toHaveValue('16');
  await size.click();
  await size.fill('abc');
  await size.press('Enter');
  expect(await size.inputValue()).toBe('16');
  const afterLetters = await measureCursor(page, 16);
  expect(Math.abs(afterLetters.width - afterLetters.expected)).toBeLessThanOrEqual(
    Math.max(2, afterLetters.expected * 0.08),
  );
  hunts.push({ hunt: 'break — letters are rejected; Size stays 16', pass: true });

  await setSizeTyped(page, 0);
  await expect(size).toHaveValue('1');
  const clampZero = await measureCursor(page, 1);
  expect(Math.abs(clampZero.width - clampZero.expected)).toBeLessThanOrEqual(
    Math.max(2, clampZero.expected * 0.08),
  );
  hunts.push({ hunt: 'break — 0 clamps to 1', pass: true });

  await setSizeTyped(page, 999);
  await expect(size).toHaveValue('100');
  const clampHuge = await measureCursor(page, 100);
  expect(Math.abs(clampHuge.width - clampHuge.expected)).toBeLessThanOrEqual(
    Math.max(2, clampHuge.expected * 0.08),
  );
  hunts.push({ hunt: 'break — 999 clamps to 100', pass: true });

  await size.click();
  await size.fill('');
  await size.press('Enter');
  await expect(size).toHaveValue('1');
  hunts.push({ hunt: 'edge — empty Size commits 1', pass: true });

  await activatePen(page);
  const width = await widthField(page);
  await expect(width).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Size', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Size presets', exact: true })).toHaveCount(0);
  await width.fill('10');
  await width.press('Enter');
  await expect(width).toHaveValue('10');
  hunts.push({
    hunt: 'break — Size with Eraser not armed is Width (Pen); no Size field',
    pass: true,
    width: await width.inputValue(),
  });

  await activateEraser(page);
  await expect(size).toHaveValue('1');
  expect(await size.inputValue(), 'Pen Width 10 must not silently become Eraser Size').not.toBe('10');
  hunts.push({
    hunt: 'break — changing Pen Width does not change Eraser Size (separate stores)',
    pass: true,
    eraserAfterPenWidth: await size.inputValue(),
  });

  await setSizeTyped(page, 24);
  await expect(size).toHaveValue('24');
  await activatePen(page);
  await expect(width).toHaveValue('10');
  hunts.push({
    hunt: 'break — changing Eraser Size does not change Pen Width',
    pass: true,
    penWidthAfterEraser: await width.inputValue(),
  });

  await activateEraser(page);
  await pickSizePreset(page, 1);
  const beforeMin = await userInkMetric(page);
  await eraseAlongStroke(page, await currentStrokeId(page), { startFrac: 0.28, endFrac: 0.44 });
  let afterMin = beforeMin;
  await expect.poll(async () => {
    afterMin = await userInkMetric(page);
    return inkChanged(beforeMin, afterMin);
  }).toBe(true);
  await undoOnce(page);
  await expect.poll(async () => {
    const restored = await userInkMetric(page);
    return restored.ids.join('|') === originalInk.ids.join('|')
      && Math.abs(restored.ink - originalInk.ink) < 1;
  }).toBe(true);
  hunts.push({ hunt: 'edge — undo after Size min (1) restores the stroke', pass: true });

  await pickSizePreset(page, 100);
  const beforeMax = await userInkMetric(page);
  await eraseAlongStroke(page, await currentStrokeId(page), { startFrac: 0.28, endFrac: 0.44 });
  let afterMax = beforeMax;
  await expect.poll(async () => {
    afterMax = await userInkMetric(page);
    return inkChanged(beforeMax, afterMax);
  }).toBe(true);
  await undoOnce(page);
  await expect.poll(async () => {
    const restored = await userInkMetric(page);
    return restored.ids.join('|') === originalInk.ids.join('|')
      && Math.abs(restored.ink - originalInk.ink) < 1;
  }).toBe(true);
  hunts.push({ hunt: 'edge — undo after Size max (100) restores the stroke', pass: true });

  const zoomReadout = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  const beforeZoom = await zoomReadout.innerText();
  const scaleBeforeZoom = await containerAwareScale(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).last().click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).last().click();
  await expect(zoomReadout).not.toHaveText(beforeZoom);
  await expect.poll(async () => (await containerAwareScale(page)).effectiveScale)
    .toBeGreaterThan(scaleBeforeZoom.effectiveScale + 0.05);

  await activateEraser(page);
  await pickSizePreset(page, 32);
  await expect(size).toHaveValue('32');
  const zoomCursor = await measureCursor(page, 32);
  expect(zoomCursor.effectiveScale, 'zoom must use offsetWidth/pageWidth, never pageSize*scale').toBeGreaterThan(0);
  expect(
    Math.abs(zoomCursor.width - zoomCursor.expected),
    `zoomed cursor ${zoomCursor.width} must match 32 × offsetWidth/pageWidth ${zoomCursor.effectiveScale}`,
  ).toBeLessThanOrEqual(Math.max(2, zoomCursor.expected * 0.08));
  const beforeZoomErase = await userInkMetric(page);
  await eraseAlongStroke(page, await currentStrokeId(page), { startFrac: 0.40, endFrac: 0.58 });
  await expect.poll(async () => inkChanged(beforeZoomErase, await userInkMetric(page)), {
    message: 'zoom then erase at Size 32 must cut',
  }).toBe(true);
  hunts.push({
    hunt: 'edge — zoom then erase uses container-aware scale (offsetWidth/pageWidth)',
    pass: true,
    effectiveScale: zoomCursor.effectiveScale,
    reportedScale: zoomCursor.reportedScale,
    cursor: zoomCursor.width,
    expected: zoomCursor.expected,
  });

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);
  console.log('ERASER_SIZE_PRESETS_PROOF', JSON.stringify({
    hunts,
    fileId,
    proven,
    chrome: chrome.values,
  }));
});
