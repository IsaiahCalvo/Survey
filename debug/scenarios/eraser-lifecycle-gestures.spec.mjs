import { test, expect } from '@playwright/test';
// 2026-08-16 (975b7e86) relabelled the shared toolbar size input to "Size" while
// the eraser (or counter) is active and left it "Width" for the pen. The specs
// match either label so they follow the tool that is active.
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { asymmetricNoRepaint } from './eraserPixelOracle.mjs';

const ANNOTATED_FIXTURE = '/?testPdf=clickable-link-test.pdf&eraserLifecycleE2E=1';
const MULTIPAGE_FIXTURE = '/?testPdf=text-search-glyph-lab.pdf&eraserLifecycleE2E=1';

function captureErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function expectNoErrors(errors) {
  expect(errors, `Unexpected mounted-app errors:\n${errors.join('\n')}`).toEqual([]);
}

async function openEditor(page, fixture = ANNOTATED_FIXTURE) {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(
    () => typeof window.__phase35GetAnnotationById,
  )).toBe('function');
}

async function openDrawTools(page) {
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count() === 0) {
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
  }
  await expect(pen).toHaveCount(1);
  await expect(pen).toBeVisible();
}

async function activateDrawTool(page, name) {
  await openDrawTools(page);
  const button = page.getByRole('button', { name, exact: true });
  await expect(button).toHaveCount(1);
  await button.click();
}

async function activateEraser(page, { mode = 'partial', size = 20 } = {}) {
  await openDrawTools(page);
  const currentMode = page.getByRole('button', {
    name: mode === 'entire' ? 'Full stroke erase' : 'Partial erase',
    exact: true,
  });

  if (mode === 'entire' && await currentMode.count() === 0) {
    // The eraser type is chosen from a listbox behind the "Eraser type"
    // button (it only appears once the eraser is active), so activate the
    // eraser in its current mode first, then pick the whole-stroke option.
    await page.getByRole('button', { name: 'Partial erase', exact: true }).click();
    const typeButton = page.getByRole('button', { name: 'Eraser type', exact: true });
    await expect(typeButton).toHaveCount(1);
    await typeButton.click();
    await page.getByRole('option', { name: 'Full stroke erase', exact: true }).click();
  }

  await expect(currentMode).toHaveCount(1);
  await currentMode.click();

  // The toolbar reuses one Width input for drawing and erasing. Wait for the
  // eraser surface to mount so this immediate fill reaches the eraser handler,
  // not the previously-active drawing tool's handler.
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toHaveCount(1);
  const width = page.getByRole('textbox', { name: /^(Width|Size)$/ });
  await expect(width).toHaveCount(1);
  await width.fill(String(size));
  await width.press('Tab');
  await expect(width).toHaveValue(String(size));
}

async function pageBox(page, pageNumber = 1) {
  const box = await page
    .locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`)
    .boundingBox();
  expect(box, `PDF page ${pageNumber} must have measurable geometry`).toBeTruthy();
  return box;
}

async function appAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
}

async function appAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => ({
        id: group.getAttribute('data-anno-id'),
        html: group.outerHTML,
      }))
      .filter((entry) => entry.id)
      .sort((a, b) => a.id.localeCompare(b.id))
  ), pageNumber);
}

async function annotationSignature(page, selector) {
  const id = await page.locator(selector).getAttribute('data-anno-id').catch(() => null);
  if (!id) return null;
  return page.evaluate((annotationId) => {
    const object = window.__phase35GetAnnotationById?.(annotationId) || null;
    return object ? JSON.stringify(object) : null;
  }, id);
}

async function annotationMarkup(page, selector) {
  return page.locator(selector).evaluate((group) => group.outerHTML);
}

async function annotationBox(page, selector) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `Annotation ${selector} must be rendered`).toBeTruthy();
  return box;
}

async function annotationObject(page, selector) {
  const id = await page.locator(selector).getAttribute('data-anno-id');
  expect(id, 'Annotation must expose a stable id').toBeTruthy();
  const object = await page.evaluate((annotationId) => (
    window.__phase35GetAnnotationById?.(annotationId) || null
  ), id);
  expect(object, `Annotation ${id} must exist in mounted app state`).toBeTruthy();
  return object;
}

async function screenPointsToPagePoints(page, points) {
  return page.locator('[data-diag-eraser-wrapper="1"]').evaluate((wrapper, screenPoints) => {
    const rect = wrapper.getBoundingClientRect();
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    const viewBox = svg?.viewBox?.baseVal;
    if (!viewBox || rect.width <= 0 || rect.height <= 0) {
      throw new Error('Mounted page geometry is unavailable');
    }
    return screenPoints.map((point) => ({
      x: ((point.x - rect.left) / rect.width) * viewBox.width,
      y: ((point.y - rect.top) / rect.height) * viewBox.height,
    }));
  }, points);
}

async function createFreehandStroke(page, {
  tool = 'Pen',
  width = 6,
  yFraction = 0.82,
  blurWidth = true,
} = {}) {
  const beforeIds = new Set(await appAnnotationIds(page));
  await activateDrawTool(page, tool);

  const widthInput = page.getByRole('textbox', { name: /^(Width|Size)$/ });
  await expect(widthInput).toHaveCount(1);
  await widthInput.fill(String(width));
  if (blurWidth) {
    await page.waitForTimeout(75);
    await widthInput.press('Tab');
    await widthInput.evaluate((input) => input.blur());
  }
  await expect(widthInput).toHaveValue(String(width));

  const box = await pageBox(page);
  const y = box.y + box.height * yFraction;
  const points = [
    { x: box.x + box.width * 0.25, y },
    { x: box.x + box.width * 0.35, y: y - 4 },
    { x: box.x + box.width * 0.45, y: y + 3 },
    { x: box.x + box.width * 0.55, y: y - 3 },
    { x: box.x + box.width * 0.65, y: y + 4 },
    { x: box.x + box.width * 0.75, y },
  ];

  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 2 });
  }
  await page.mouse.up();

  const findCreatedId = () => page.evaluate(({ existingIds, expectedTool }) => {
    const knownIds = new Set(existingIds);
    const renderedIds = [
      ...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]'),
    ]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return renderedIds.find((id) => {
      if (knownIds.has(id)) return false;
      const object = window.__phase35GetAnnotationById?.(id) || null;
      return (
        String(object?.type || '').toLowerCase() === 'path'
        && String(object?.data?.tool || object?.tool || '').toLowerCase() === expectedTool
        && object?.isPdfImported !== true
      );
    }) || null;
  }, {
    existingIds: [...beforeIds],
    expectedTool: tool.toLowerCase(),
  });

  let createdId = null;
  await expect.poll(async () => {
    createdId = await findCreatedId();
    return createdId;
  }, {
    message: `${tool} gesture must create a mounted local path annotation`,
  }).not.toBeNull();

  return `[data-svg-annotation-layer="1"] > g[data-anno-id="${createdId}"]`;
}

function crossingPoints(box, inset = 10) {
  const x = box.x + box.width / 2;
  return {
    start: { x, y: box.y - inset },
    middle: { x, y: box.y + box.height / 2 },
    end: { x, y: box.y + box.height + inset },
  };
}

async function eraseAcross(page, box) {
  const points = crossingPoints(box);
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.middle.x, points.middle.y, { steps: 4 });
  await page.mouse.move(points.end.x, points.end.y, { steps: 4 });
  await page.mouse.up();
}

async function expectExactUndoRedo(page, selector, before, after, {
  clip = null,
  beforePixels = null,
  beforeMarkup = null,
} = {}) {
  const capturePixels = clip ? () => page.screenshot({ clip }) : null;
  const afterPixels = capturePixels ? await capturePixels() : null;
  const afterMarkup = beforeMarkup === null ? null : await annotationMarkup(page, selector);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => annotationSignature(page, selector), {
    message: 'One Undo must restore the exact pre-gesture SVG',
  }).toBe(before);
  if (beforeMarkup !== null) {
    await expect.poll(() => annotationMarkup(page, selector), {
      message: 'One Undo must restore the exact rendered SVG markup',
    }).toBe(beforeMarkup);
  }
  if (capturePixels && beforePixels) {
    const undoPixels = await capturePixels();
    expect(pngDistance(beforePixels, undoPixels),
      'Undo may differ only at a narrow antialiasing fringe').toBeLessThan(0.01);
  }

  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect.poll(() => annotationSignature(page, selector), {
    message: 'One Redo must restore the exact post-gesture SVG',
  }).toBe(after);
  if (afterMarkup !== null) {
    await expect.poll(() => annotationMarkup(page, selector), {
      message: 'One Redo must restore the exact rendered SVG markup',
    }).toBe(afterMarkup);
  }
  if (capturePixels && afterPixels) {
    const redoPixels = await capturePixels();
    expect(pngDistance(afterPixels, redoPixels),
      'Redo may differ only at a narrow antialiasing fringe').toBeLessThan(0.01);
  }
}

function compareGeometry(actual, expected, epsilon = 1e-4, path = '$') {
  if (typeof actual === 'number' && typeof expected === 'number') {
    const delta = Math.abs(actual - expected);
    return { matches: delta <= epsilon, maxDelta: delta, path };
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
      return { matches: false, maxDelta: Infinity, path };
    }
    return actual.reduce((result, value, index) => {
      if (!result.matches) return result;
      const next = compareGeometry(value, expected[index], epsilon, `${path}[${index}]`);
      return next.maxDelta > result.maxDelta ? next : result;
    }, { matches: true, maxDelta: 0, path });
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      return { matches: false, maxDelta: Infinity, path };
    }
    return actualKeys.reduce((result, key) => {
      if (!result.matches) return result;
      const next = compareGeometry(actual[key], expected[key], epsilon, `${path}.${key}`);
      return next.maxDelta > result.maxDelta ? next : result;
    }, { matches: true, maxDelta: 0, path });
  }
  return {
    matches: Object.is(actual, expected),
    maxDelta: Object.is(actual, expected) ? 0 : Infinity,
    path,
  };
}

async function previewState(page) {
  return page.locator('[data-diag-eraser-wrapper="1"]').evaluate((wrapper) => {
    const clone = document.querySelector('[data-eraser-mask-clone="1"]');
    if (clone) {
      const carve = clone.querySelector('mask path');
      return {
        kind: 'svg-mask-clone',
        active: true,
        carveLength: carve?.getAttribute('d')?.length || 0,
        display: getComputedStyle(clone).display,
        width: 0,
        height: 0,
        nonTransparentPixels: 0,
      };
    }

    const canvas = wrapper.querySelector('[data-eraser-live-preview="1"]');
    const context = canvas.getContext('2d');
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonTransparentPixels = 0;
    if (pixels) {
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 0) nonTransparentPixels += 1;
      }
    }
    return {
      kind: 'painted-canvas',
      active: canvas.style.display !== 'none',
      carveLength: 0,
      display: canvas.style.display,
      width: canvas.width,
      height: canvas.height,
      nonTransparentPixels,
    };
  });
}

function pngDistance(first, second) {
  const a = PNG.sync.read(first);
  const b = PNG.sync.read(second);
  expect({ width: a.width, height: a.height }).toEqual({ width: b.width, height: b.height });
  const diff = new PNG({ width: a.width, height: a.height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    includeAA: true,
    threshold: 0.12,
  });
  return mismatched / (a.width * a.height);
}

function paddedClip(box, viewport, padding = 20) {
  const x = Math.max(0, Math.floor(box.x - padding));
  const y = Math.max(0, Math.floor(box.y - padding));
  const right = Math.min(viewport.width, Math.ceil(box.x + box.width + padding));
  const bottom = Math.min(viewport.height, Math.ceil(box.y + box.height + padding));
  return { x, y, width: right - x, height: bottom - y };
}

async function createRectangleAndText(page) {
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  const rectangle = page.getByRole('button', { name: 'Rectangle', exact: true });
  await expect(rectangle).toHaveCount(1);
  await rectangle.click();

  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.48);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.74, box.y + box.height * 0.62, { steps: 5 });
  await page.mouse.up();

  // The Text category button and the Text sub-tool share the accessible
  // name "Text"; sub-tools carry aria-label (no title) since the toolbar
  // tooltip rework, so select by role and take the second match.
  const textButtons = page.getByRole('button', { name: 'Text', exact: true });
  await textButtons.first().click();
  await expect(textButtons).toHaveCount(2);
  await textButtons.nth(1).click();

  await page.mouse.click(box.x + box.width * 0.24, box.y + box.height * 0.73);
  await page.keyboard.type('Erase me');

  // Tool/category change blurs TextEditOverlay and commits the textbox through
  // the normal mounted-app path.
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await expect.poll(() => appAnnotationIds(page), {
    message: 'Rectangle and textbox must both commit before eraser testing',
  }).toHaveLength(2);
}

async function exerciseWriteBlockTransition(page, setterName, label) {
  const selector = await createFreehandStroke(page, { tool: 'Pen', width: 12 });
  const before = await annotationSignature(page, selector);
  const box = await annotationBox(page, selector);
  await activateEraser(page, { size: 24 });
  const eraserWrapper = page.locator('[data-diag-eraser-wrapper="1"]');
  const originalEraserWrapper = await eraserWrapper.elementHandle();
  expect(originalEraserWrapper, `${label} needs a mounted eraser surface`).toBeTruthy();

  await expect.poll(() => page.evaluate((name) => typeof window[name], setterName), {
    message: `${label} E2E seam must exist only on the flagged route`,
  }).toBe('function');

  const points = crossingPoints(box);
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.middle.x, points.middle.y, { steps: 4 });
  const preview = await previewState(page);
  expect(preview.active, `${label} must interrupt a visible erase`).toBe(true);

  await page.evaluate((name) => window[name](true), setterName);
  await expect(eraserWrapper).toHaveAttribute(
    'data-diag-eraser-interruption-policy',
    'cancel',
  );
  await expect(page.locator('[data-eraser-mask-clone="1"]')).toHaveCount(0);
  await expect.poll(() => annotationSignature(page, selector), {
    message: `${label} must restore preview without committing`,
  }).toBe(before);

  await page.mouse.up();
  await expect.poll(() => annotationSignature(page, selector), {
    message: `pointer-up after ${label} must be a no-op`,
  }).toBe(before);

  await eraseAcross(page, box);
  await expect.poll(() => annotationSignature(page, selector), {
    message: `${label} must block new eraser gestures while writes are forbidden`,
  }).toBe(before);

  await page.evaluate((name) => window[name](false), setterName);
  await expect(eraserWrapper).toHaveAttribute(
    'data-diag-eraser-interruption-policy',
    'commit',
  );
  expect(await eraserWrapper.evaluate(
    (current, original) => current === original,
    originalEraserWrapper,
  ), `${label} must recover on the same eraser surface`).toBe(true);
  let after = before;
  await eraseAcross(page, box);
  await expect.poll(async () => {
    after = await annotationSignature(page, selector);
    return after;
  }, {
    message: `Restoring access after ${label} must permit a new erase`,
  }).not.toBe(before);

  await expectExactUndoRedo(page, selector, before, after);
}

test.describe('mounted eraser lifecycle and gestures', () => {
  test('normal controls prove the harness is live before edge gestures', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);

    const zoom = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
    const beforeZoom = await zoom.innerText();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(zoom).not.toHaveText(beforeZoom);

    await activateDrawTool(page, 'Highlighter');
    await expect(page.getByRole('textbox', { name: /^(Width|Size)$/ })).toHaveValue('20');

    await activateEraser(page, { mode: 'partial', size: 20 });
    await expect(page.getByRole('button', { name: 'Partial erase', exact: true }))
      .toHaveClass(/btn-active/);
    await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toBeVisible();
    await expectNoErrors(errors);
  });

  test('fast pen width blur commits the live input value', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);
    await activateDrawTool(page, 'Pen');

    const width = page.getByRole('textbox', { name: /^(Width|Size)$/ });
    await expect(width).toHaveCount(1);
    await width.fill('17');
    await width.press('Tab');
    await expect(width).toHaveValue('17');
    await expectNoErrors(errors);
  });

  test('fast eraser width blur commits the live input value', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);
    await activateDrawTool(page, 'Highlighter');
    await page.getByRole('button', { name: 'Partial erase', exact: true }).click();
    await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toHaveCount(1);

    const width = page.getByRole('textbox', { name: /^(Width|Size)$/ });
    await expect(width).toHaveCount(1);
    await width.fill('37');
    await width.press('Tab');
    await expect(width).toHaveValue('37');
    await expectNoErrors(errors);
  });

  test('pen width typed without blur applies to the next stroke', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);

    const selector = await createFreehandStroke(page, {
      tool: 'Pen',
      width: 17,
      blurWidth: false,
    });
    const object = await annotationObject(page, selector);
    expect(object.sourceWidth).toBe(17);
    await expectNoErrors(errors);
  });

  test('eraser diameter typed without blur applies at pointer-down', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);

    const selector = await createFreehandStroke(page, { tool: 'Pen', width: 14 });
    const before = await annotationSignature(page, selector);
    const beforeObject = await annotationObject(page, selector);
    const box = await annotationBox(page, selector);
    await activateEraser(page, { size: 8 });

    const width = page.getByRole('textbox', { name: /^(Width|Size)$/ });
    await width.fill('64');
    await expect(width).toHaveValue('64');
    await page.evaluate(() => {
      window.__noBlurEraserSaveAction = null;
      window.addEventListener('annotations:fabric-save-action', (event) => {
        if (event.detail?.source === 'eraser:commit') {
          window.__noBlurEraserSaveAction = event.detail;
        }
      }, { once: true });
    });

    await eraseAcross(page, box);
    let after = before;
    await expect.poll(async () => {
      after = await annotationSignature(page, selector);
      return after;
    }).not.toBe(before);
    const saveAction = await page.evaluate(() => window.__noBlurEraserSaveAction);
    expect(saveAction?.eraserRadius).toBe(32);
    expect(saveAction?.eraserMode).toBe('partial');
    expect(saveAction?.eraserPoints?.length).toBeGreaterThan(1);
    const expectedObjects = await page.evaluate(async ({ object, save }) => {
      const { erasePageAnnotations } = await import('/src/utils/pageSpaceEraser.js');
      const eraseAtRadius = (eraserRadius) => erasePageAnnotations({
        pageAnnotations: { objects: [object] },
        eraserPoints: save.eraserPoints,
        eraserRadius,
        mode: save.eraserMode,
        canErase: () => true,
      }).pageAnnotations.objects[0];
      return {
        requested: eraseAtRadius(save.eraserRadius),
        previous: eraseAtRadius(4),
      };
    }, { object: beforeObject, save: saveAction });
    const actualObject = await annotationObject(page, selector);
    const committedComparison = compareGeometry(
      actualObject,
      expectedObjects.requested,
    );
    const previousComparison = compareGeometry(
      actualObject,
      expectedObjects.previous,
    );
    expect(
      committedComparison.matches,
      `Pointer-down must capture the unblurred 64px diameter; requested mismatch=${committedComparison.path}, previous-size match=${previousComparison.matches}`,
    ).toBe(true);
    expect(previousComparison.matches, 'The previous 8px diameter must not be used').toBe(false);
    expect(committedComparison.maxDelta).toBeLessThanOrEqual(1e-4);

    await expectExactUndoRedo(page, selector, before, after);
    await expectNoErrors(errors);
  });

  for (const scenario of [
    { penWidth: 3, eraserSize: 8, zoomIn: false },
    { penWidth: 14, eraserSize: 64, zoomIn: true },
  ]) {
    test(`pen ${scenario.penWidth}px carves at ${scenario.eraserSize}px eraser${scenario.zoomIn ? ' after zoom' : ''}`, async ({ page }) => {
      const errors = captureErrors(page);
      await openEditor(page);
      if (scenario.zoomIn) {
        const zoom = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
        const beforeZoom = await zoom.innerText();
        await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
        await expect(zoom).not.toHaveText(beforeZoom);
      }

      const selector = await createFreehandStroke(page, {
        tool: 'Pen',
        width: scenario.penWidth,
      });
      const before = await annotationSignature(page, selector);
      const box = await annotationBox(page, selector);

      await activateEraser(page, { size: scenario.eraserSize });
      await eraseAcross(page, box);

      let after = before;
      await expect.poll(async () => {
        after = await annotationSignature(page, selector);
        return after;
      }, {
        message: 'Pen SVG must change after a real partial-erase swipe',
      }).not.toBe(before);

      await expectExactUndoRedo(page, selector, before, after);
      await expectNoErrors(errors);
    });
  }

  test('highlighter preview pixels precede commit and match committed rendering', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);

    const selector = await createFreehandStroke(page, {
      tool: 'Highlighter',
      width: 20,
      // Keep the pixel oracle isolated from fixture annotations near 82%.
      yFraction: 0.72,
    });
    const before = await annotationSignature(page, selector);
    const box = await annotationBox(page, selector);
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    const clip = paddedClip(box, viewport);
    const beforePixels = await page.screenshot({ clip });

    await activateEraser(page, { size: 20 });
    const points = crossingPoints(box);
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.middle.x, points.middle.y, { steps: 5 });

    const preview = await previewState(page);
    expect(preview.active).toBe(true);
    if (preview.kind === 'svg-mask-clone') {
      expect(preview.carveLength).toBeGreaterThan(0);
    } else {
      expect(preview.display).not.toBe('none');
      expect(preview.width).toBeGreaterThan(0);
      expect(preview.height).toBeGreaterThan(0);
      expect(preview.nonTransparentPixels).toBeGreaterThan(0);
    }
    expect(await annotationSignature(page, selector),
      'Committed SVG must stay untouched while the preview canvas is active').toBe(before);
    const previewPixels = await page.screenshot({ clip });

    // Release at the preview endpoint so the two screenshots represent the
    // exact same geometric sweep; only renderer antialiasing may differ.
    await page.mouse.up();
    await expect(page.locator('[data-eraser-live-preview="1"]')).toHaveCSS('display', 'none');
    await expect(page.locator('[data-eraser-mask-clone="1"]')).toHaveCount(0);

    let after = before;
    await expect.poll(async () => {
      after = await annotationSignature(page, selector);
      return after;
    }).not.toBe(before);
    const committedPixels = await page.screenshot({ clip });

    expect(pngDistance(beforePixels, previewPixels),
      'Preview must visibly differ from the un-erased pixels').toBeGreaterThan(0.002);
    expect(pngDistance(beforePixels, committedPixels),
      'Committed output must visibly differ from the un-erased pixels').toBeGreaterThan(0.002);
    expect(pngDistance(previewPixels, committedPixels),
      'Preview and commit may differ only at a narrow antialiasing fringe').toBeLessThan(0.01);
    const noRepaint = asymmetricNoRepaint(
      beforePixels,
      previewPixels,
      committedPixels,
    );
    expect(noRepaint.interiorErasedPixels,
      'No-repaint oracle needs a real erased interior beyond the 1px AA fringe')
      .toBeGreaterThan(0);
    expect(noRepaint.regeneratedInteriorPixels,
      `Commit must not regenerate ink erased in preview (${noRepaint.regeneratedRate})`)
      .toBe(0);

    await expectExactUndoRedo(page, selector, before, after);
    await expectNoErrors(errors);
  });

  test('partial/full mode and diameter may change mid-drag without splitting history', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);

    const selector = await createFreehandStroke(page, { tool: 'Pen', width: 12 });
    const before = await annotationSignature(page, selector);
    const beforeObject = await annotationObject(page, selector);
    const box = await annotationBox(page, selector);

    await activateEraser(page, { mode: 'partial', size: 8 });
    const points = crossingPoints(box);
    const eraserPoints = await screenPointsToPagePoints(page, [
      points.start,
      points.middle,
      points.end,
    ]);
    const expectedObject = await page.evaluate(async ({ object, points: pagePoints }) => {
      const { erasePageAnnotations } = await import('/src/utils/pageSpaceEraser.js');
      return erasePageAnnotations({
        pageAnnotations: { objects: [object] },
        eraserPoints: pagePoints,
        eraserRadius: 4,
        mode: 'partial',
        canErase: () => true,
      }).pageAnnotations.objects[0];
    }, { object: beforeObject, points: eraserPoints });
    expect(expectedObject, 'Pointer-down partial mode must retain carved ink').toBeTruthy();
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.middle.x, points.middle.y, { steps: 4 });

    const typeButton = page.getByRole('button', { name: 'Eraser type', exact: true });
    await expect(typeButton).toHaveCount(1);
    await typeButton.evaluate((button) => button.click());
    // Eraser type is a listbox option now; pick it without moving the mouse
    // so the drag in progress is not disturbed.
    const fullEraseOption = page.getByRole('option', { name: 'Full stroke erase', exact: true });
    await expect(fullEraseOption).toHaveCount(1);
    await fullEraseOption.evaluate((option) => option.click());
    await expect(page.getByRole('button', { name: 'Full stroke erase', exact: true })).toHaveCount(1);

    const width = page.getByRole('textbox', { name: /^(Width|Size)$/ });
    await width.fill('60');
    await width.press('Tab');
    await expect(width).toHaveValue('60');

    await page.mouse.move(points.end.x, points.end.y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('[data-eraser-live-preview="1"]')).toHaveCSS('display', 'none');

    let after = before;
    await expect.poll(async () => {
      after = await annotationSignature(page, selector);
      return after;
    }, {
      message: 'The active swipe must produce one deterministic committed result',
    }).not.toBe(before);
    let committedComparison = null;
    await expect.poll(async () => {
      committedComparison = compareGeometry(
        await annotationObject(page, selector),
        expectedObject,
      );
      return committedComparison.matches;
    }, {
      message: 'Commit must use pointer-down partial mode and 8px diameter within 0.0001 page units',
    }).toBe(true);
    expect(
      committedComparison.maxDelta,
      `Captured pointer transforms may differ by at most 0.0001 page units (${committedComparison.path})`,
    ).toBeLessThanOrEqual(1e-4);

    await expectExactUndoRedo(page, selector, before, after);
    await expectNoErrors(errors);
  });

  test('zoom during an active drag commits before page resize', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);

    const selector = await createFreehandStroke(page, { tool: 'Pen', width: 10 });
    const before = await annotationSignature(page, selector);
    const beforeMarkup = await annotationMarkup(page, selector);
    const box = await annotationBox(page, selector);
    await activateEraser(page, { size: 24 });

    const points = crossingPoints(box);
    const zoom = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
    const beforeZoom = await zoom.innerText();
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.middle.x, points.middle.y, { steps: 4 });
    await page.keyboard.press('Control+=');
    await expect(zoom).not.toHaveText(beforeZoom);
    await page.mouse.up();

    let after = before;
    await expect.poll(async () => {
      after = await annotationSignature(page, selector);
      return after;
    }, {
      message: 'Zoom-start must commit the visible erase instead of discarding it',
    }).not.toBe(before);
    await expect(page.locator('[data-eraser-live-preview="1"]')).toHaveCSS('display', 'none');

    await expectExactUndoRedo(page, selector, before, after, {
      beforeMarkup,
    });
    await expectNoErrors(errors);
  });

  test('tool switch during an active drag commits the visible erase', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);

    const selector = await createFreehandStroke(page, { tool: 'Pen', width: 10 });
    const before = await annotationSignature(page, selector);
    const box = await annotationBox(page, selector);
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    const clip = paddedClip(box, viewport);
    const beforePixels = await page.screenshot({ clip });
    await activateEraser(page, { size: 24 });

    const points = crossingPoints(box);
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.middle.x, points.middle.y, { steps: 4 });
    await page.keyboard.press('v');
    await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toHaveCount(0);
    await page.mouse.up();

    let after = before;
    await expect.poll(async () => {
      after = await annotationSignature(page, selector);
      return after;
    }, {
      message: 'Switching tools must commit the erase already shown in preview',
    }).not.toBe(before);

    await expectExactUndoRedo(page, selector, before, after, { clip, beforePixels });
    await expectNoErrors(errors);
  });

  test('page switch during an active drag commits before the page unmounts', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page, MULTIPAGE_FIXTURE);

    const selector = await createFreehandStroke(page, { tool: 'Pen', width: 10 });
    const before = await annotationSignature(page, selector);
    const box = await annotationBox(page, selector);
    await activateEraser(page, { size: 24 });

    const points = crossingPoints(box);
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.middle.x, points.middle.y, { steps: 4 });

    const nextPage = page.getByRole('button', { name: 'Next page', exact: true });
    await expect(nextPage).toBeEnabled();
    await nextPage.evaluate((button) => button.click());
    await expect(page.locator('[data-svg-annotation-layer="2"]')).toBeVisible();
    await page.mouse.up();

    const previousPage = page.getByRole('button', { name: 'Previous page', exact: true });
    await expect(previousPage).toBeEnabled();
    await previousPage.evaluate((button) => button.click());
    await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible();

    let after = before;
    await expect.poll(async () => {
      after = await annotationSignature(page, selector);
      return after;
    }, {
      message: 'Leaving the page must commit the erase already shown in preview',
    }).not.toBe(before);

    await expectExactUndoRedo(page, selector, before, after);
    await expectNoErrors(errors);
  });

  test('pointercancel commits once and leaves no stale preview', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);

    const selector = await createFreehandStroke(page, { tool: 'Pen', width: 10 });
    const before = await annotationSignature(page, selector);
    const box = await annotationBox(page, selector);
    await activateEraser(page, { size: 24 });

    await page.evaluate(() => {
      window.__eraserPointerId = null;
      document.querySelector('[data-diag-eraser-wrapper="1"]')
        .addEventListener('pointerdown', (event) => {
          window.__eraserPointerId = event.pointerId;
        }, { once: true, capture: true });
    });

    const points = crossingPoints(box);
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.middle.x, points.middle.y, { steps: 4 });
    const pointerId = await page.evaluate(() => window.__eraserPointerId);
    expect(pointerId).not.toBeNull();
    await page.dispatchEvent('[data-diag-eraser-wrapper="1"]', 'pointercancel', {
      pointerId,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
      bubbles: true,
      cancelable: true,
    });

    let after = before;
    await expect.poll(async () => {
      after = await annotationSignature(page, selector);
      return after;
    }, {
      message: 'pointercancel must keep the erase already shown to the user',
    }).not.toBe(before);
    const committedOnCancel = after;
    await page.mouse.up();
    await expect.poll(() => annotationSignature(page, selector))
      .toBe(committedOnCancel);
    await expect(page.locator('[data-eraser-live-preview="1"]')).toHaveCSS('display', 'none');

    await expectExactUndoRedo(page, selector, before, after);
    await expectNoErrors(errors);
  });

  test('lost pointer capture commits once and leaves the cursor usable', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);

    const selector = await createFreehandStroke(page, { tool: 'Pen', width: 10 });
    const before = await annotationSignature(page, selector);
    const box = await annotationBox(page, selector);
    await activateEraser(page, { size: 24 });

    await page.evaluate(() => {
      window.__eraserPointerId = null;
      document.querySelector('[data-diag-eraser-wrapper="1"]')
        .addEventListener('pointerdown', (event) => {
          window.__eraserPointerId = event.pointerId;
        }, { once: true, capture: true });
    });

    const points = crossingPoints(box);
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.middle.x, points.middle.y, { steps: 4 });
    const pointerId = await page.evaluate(() => window.__eraserPointerId);
    expect(pointerId).not.toBeNull();
    const hadCapture = await page.evaluate((id) => {
      const wrapper = document.querySelector('[data-diag-eraser-wrapper="1"]');
      const captured = wrapper.hasPointerCapture(id);
      wrapper.releasePointerCapture(id);
      return captured;
    }, pointerId);
    expect(hadCapture, 'The mounted eraser must use real pointer capture').toBe(true);

    let after = before;
    await expect.poll(async () => {
      after = await annotationSignature(page, selector);
      return after;
    }, {
      message: 'lostpointercapture must keep the erase already shown to the user',
    }).not.toBe(before);
    const committedOnLoss = after;
    await page.mouse.up();
    await expect.poll(() => annotationSignature(page, selector))
      .toBe(committedOnLoss);
    await expect(page.locator('[data-eraser-live-preview="1"]')).toHaveCSS('display', 'none');

    const cursor = page.locator('[data-eraser-cursor="true"]');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(cursor).not.toHaveCSS('display', 'none');

    await expectExactUndoRedo(page, selector, before, after);
    await expectNoErrors(errors);
  });

  test('revocation and document-lock notifications cancel, block, then restore erasing', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);
    await exerciseWriteBlockTransition(
      page,
      '__eraserLifecycleSetAccessRevoked',
      'access revocation',
    );

    await openEditor(page);
    await exerciseWriteBlockTransition(
      page,
      '__eraserLifecycleSetDocumentLocked',
      'document lock notification',
    );
    await expectNoErrors(errors);
  });

  test('a palm/second pointer cannot cancel the active pen erase', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);

    const selector = await createFreehandStroke(page, { tool: 'Pen', width: 12 });
    const before = await annotationSignature(page, selector);
    const box = await annotationBox(page, selector);
    const pdfBox = await pageBox(page);
    await activateEraser(page, { size: 24 });

    await page.evaluate(() => {
      window.__eraserPointerTypes = [];
      document.querySelector('[data-diag-eraser-wrapper="1"]')
        .addEventListener('pointerdown', (event) => {
          window.__eraserPointerTypes.push(event.pointerType);
        }, { capture: true });
    });

    const cdp = await page.context().newCDPSession(page);
    const points = crossingPoints(box);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: points.start.x,
      y: points.start.y,
      button: 'none',
      buttons: 0,
      pointerType: 'pen',
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: points.start.x,
      y: points.start.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      pointerType: 'pen',
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: points.middle.x,
      y: points.middle.y,
      button: 'none',
      buttons: 1,
      pointerType: 'pen',
    });

    const palm = {
      x: pdfBox.x + pdfBox.width * 0.9,
      y: pdfBox.y + pdfBox.height * 0.9,
      radiusX: 24,
      radiusY: 24,
      force: 0.6,
      id: 91,
    };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [palm],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: points.middle.x,
      y: points.middle.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      pointerType: 'pen',
    });

    const pointerTypes = await page.evaluate(() => window.__eraserPointerTypes);
    expect(pointerTypes).toContain('pen');
    expect(pointerTypes).toContain('touch');

    let after = before;
    await expect.poll(async () => {
      after = await annotationSignature(page, selector);
      return after;
    }, {
      message: 'A secondary palm pointer must not discard the active pen erase',
    }).not.toBe(before);

    await expectExactUndoRedo(page, selector, before, after);
    await expectNoErrors(errors);
  });

  test('partial erase whole-deletes textbox and shape in one exact undo step', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page, MULTIPAGE_FIXTURE);
    await createRectangleAndText(page);

    const before = await appAnnotationSnapshot(page);
    expect(before).toHaveLength(2);
    const boxes = await Promise.all(before.map((entry) => (
      annotationBox(page, `[data-anno-id="${entry.id}"]`)
    )));
    const centers = boxes.map((box) => ({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    }));

    await activateEraser(page, { mode: 'partial', size: 20 });
    await page.mouse.move(centers[0].x, centers[0].y);
    await page.mouse.down();
    await page.mouse.move(
      (centers[0].x + centers[1].x) / 2,
      (centers[0].y + centers[1].y) / 2,
      { steps: 5 },
    );
    await page.mouse.move(centers[1].x, centers[1].y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => appAnnotationSnapshot(page)).toEqual([]);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => appAnnotationSnapshot(page)).toEqual(before);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(() => appAnnotationSnapshot(page)).toEqual([]);
    await expectNoErrors(errors);
  });

  test('rapid repeated swipes each retain an exact Undo/Redo boundary', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page);

    const selector = await createFreehandStroke(page, { tool: 'Highlighter', width: 28 });
    const createdId = await page.locator(selector).getAttribute('data-anno-id');
    const baseline = await appAnnotationSnapshot(page);
    expect(baseline.some((entry) => entry.id === createdId)).toBe(true);
    const box = await annotationBox(page, selector);
    await activateEraser(page, { size: 12 });

    let previous = JSON.stringify(baseline);
    const fractions = [0.12, 0.28, 0.44, 0.60, 0.76, 0.90];
    for (const fraction of fractions) {
      const x = box.x + box.width * fraction;
      await page.mouse.move(x, box.y - 12);
      await page.mouse.down();
      await page.mouse.move(x, box.y + box.height + 12, { steps: 2 });
      await page.mouse.up();
      const current = JSON.stringify(await appAnnotationSnapshot(page));
      expect(current, `Rapid swipe at ${fraction} must commit a distinct change`).not.toBe(previous);
      previous = current;
    }
    const final = await appAnnotationSnapshot(page);

    for (let index = 0; index < fractions.length; index += 1) {
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
    }
    await expect.poll(() => appAnnotationSnapshot(page), {
      message: 'One Undo per rapid swipe must restore the exact baseline',
    }).toEqual(baseline);

    for (let index = 0; index < fractions.length; index += 1) {
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
    }
    await expect.poll(() => appAnnotationSnapshot(page), {
      message: 'One Redo per rapid swipe must restore the exact final pixels/geometry',
    }).toEqual(final);
    await expectNoErrors(errors);
  });
});
