import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

const pageOne = '.survey-pdfjs-page-div[data-page-number="1"]';
async function open(page, fixture = 'e2e/prog-10-all-subtypes.pdf') {
  await page.goto(`/?testPdf=${fixture}&eraserLifecycleE2E=1`);
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.locator(pageOne).waitFor();
  await page.waitForTimeout(1200);
}
async function pointOn(page, kind) {
  return page.locator(`[data-shape-kind="${kind}"]`).first().evaluate(node => {
    const geo = node.matches('path,polygon,polyline,rect,ellipse') ? node : node.querySelector('path,polygon,polyline,rect,ellipse');
    const p = geo.getPointAtLength(geo.getTotalLength() * 0.15);
    const q = new DOMPoint(p.x, p.y).matrixTransform(geo.getScreenCTM());
    return { x: q.x, y: q.y };
  });
}
const vertexHandles = 'circle[style*="cursor: grab"][fill="#ffffff"][stroke="#4a90e2"]';
for (const tool of ['v', 'Alt+v', 'Shift+v']) {
  for (const kind of ['polygon', 'polyline', 'cloud-polygon']) {
    test(`${tool} selects and edits imported ${kind}`, async ({ page }) => {
      await open(page);
      await page.keyboard.press(tool);
      const point = await pointOn(page, kind);
      await page.mouse.click(point.x, point.y);
      const handles = page.locator(vertexHandles);
      await expect(handles.first()).toBeVisible();
      const mark = page.locator(`[data-shape-kind="${kind}"]`).first();
      const before = await mark.boundingBox();
      const handle = await handles.first().boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 - 12, handle.y + handle.height / 2 + 10, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => JSON.stringify(await mark.boundingBox())).not.toBe(JSON.stringify(before));
    });
  }
}

test('Text Select Shift adds and Alt subtracts annotations', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Shift+v');
  const a = await pointOn(page, 'rect');
  const b = await pointOn(page, 'ellipse');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Shift');
  await expect(page.locator('[data-group-selection-indices]')).toHaveAttribute('data-group-selection-indices', '3,4');
  await page.keyboard.down('Alt');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Alt');
  await expect(page.locator('[data-group-selection-indices]')).toHaveCount(0);
  await expect(page.locator('[data-resize-handle]').first()).toBeVisible();
});

for (const kind of ['highlight', 'underline', 'strikeout', 'squiggly']) {
  test(`pasting ${kind} cannot stack the same anchored text mark`, async ({ page }) => {
    await open(page, 'e2e/prog-02-text-markup.pdf');
    await page.keyboard.press('v');
    const marks = page.locator(`[data-shape-kind="text-markup-${kind}"]`);
    const count = await marks.count();
    const box = await marks.first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('[data-text-range-handle]').first()).toBeVisible();
    await page.keyboard.press('Meta+c');
    await page.keyboard.press('Meta+v');
    await page.keyboard.press('Meta+v');
    await expect(marks).toHaveCount(count);
  });
}

test('redaction warning follows delete, undo and redo', async ({ page }) => {
  await open(page, 'unapplied-redaction-leak.pdf');
  await page.keyboard.press('v');
  const mark = page.locator('[data-shape-kind="text-markup-redact"]');
  await expect(page.getByText('Redactions are not applied', { exact: true })).toBeVisible();
  const box = await mark.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Delete');
  await expect(mark).toHaveCount(0);
  await expect(page.getByText('Redactions are not applied', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Meta+z');
  await expect(mark).toHaveCount(1);
  await expect(page.getByText('Redactions are not applied', { exact: true })).toBeVisible();
  await page.keyboard.press('Meta+Shift+z');
  await expect(mark).toHaveCount(0);
  await expect(page.getByText('Redactions are not applied', { exact: true })).toHaveCount(0);
});

test('empty erase settles its audit status', async ({ page }) => {
  await open(page, 'clickable-link-test.pdf');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Partial erase', exact: true }).click();
  const box = await page.locator(pageOne).boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 35, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toHaveAttribute('data-eraser-audit-status', 'not-needed');
});

test('Redact painted size and ink weight match the text tools', async ({ page }) => {
  await open(page, 'e2e/prog-02-text-markup.pdf');
  await page.keyboard.press('Shift+v');
  const box = await page.locator('[data-pdf-annotation-id="9R"]').first().boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.locator('[data-text-selection-action-bar]').screenshot({ path: test.info().outputPath('redact-toolbar.png') });
  const metrics = [];
  for (const name of ['Apply Underline', 'Apply Squiggle', 'Apply Strike Through', 'Apply Redact']) {
    const png = PNG.sync.read(await page.getByRole('button', { name, exact: true }).screenshot());
    let left = png.width, right = -1, top = png.height, bottom = -1, ink = 0;
    for (let y = 2; y < png.height - 2; y++) for (let x = 3; x < png.width - 3; x++) {
      const i = (y * png.width + x) * 4;
      if (Math.min(...png.data.subarray(i, i + 3)) > 125) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y); ink++;
      }
    }
    metrics.push({ width: right - left + 1, height: bottom - top + 1, ink });
  }
  const redact = metrics.pop();
  expect(redact.width).toBeLessThanOrEqual(Math.max(...metrics.map(m => m.width)) + 1);
  expect(redact.height).toBeGreaterThanOrEqual(Math.max(...metrics.map(m => m.height)) * 0.8);
  expect(redact.ink).toBeLessThanOrEqual(Math.max(...metrics.map(m => m.ink)) * 1.2);
  expect(redact.ink).toBeGreaterThan(Math.min(...metrics.map(m => m.ink)) * 0.7);
});

for (const action of ['undo', 'reload']) {
  test(`fine erase survives ${action} during pending worker planning`, async ({ page }) => {
    test.setTimeout(60000);
    // Force a pending worker even on fast machines. Real geometry and real
    // document commits still run; only response delivery is delayed.
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          if (!String(url).includes('pageSpaceEraserWorker')) return;
          const native = this;
          Object.defineProperty(this, 'onmessage', { set(callback) {
            native.addEventListener('message', event => setTimeout(() => callback(event), 1500));
          }});
        }
      };
    });
    await open(page, 'spike-120-pages.pdf');
    const box = await page.locator(pageOne).boundingBox();
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    const width = page.getByRole('textbox', { name: /^(Width|Size)$/ });
    await width.fill('60'); await width.press('Tab');
    async function gesture(points) {
      await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
      await page.mouse.down();
      for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x, box.y + y);
      await page.mouse.up();
    }
    const stored = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]'), g => window.__phase35GetAnnotationById(g.getAttribute('data-anno-id'))));
    await gesture(Array.from({ length: 61 }, (_, i) => [60 + i * 7.5, 320 + 55 * Math.sin(i / 5)]));
    await expect.poll(async () => (await stored()).length).toBe(1);
    const original = (await stored())[0];
    await page.getByRole('button', { name: 'Partial erase', exact: true }).click();
    await page.locator('[data-diag-eraser-wrapper="1"]').waitFor();
    await width.fill('4'); await width.press('Tab');
    await gesture(Array.from({ length: 121 }, (_, i) => [110 + (i % 2 ? 150 : 0) + i * 1.2, 260 + i * 0.9]));
    await page.waitForTimeout(action === 'undo' ? 100 : 200);
    if (action === 'undo') {
      await page.keyboard.press('Meta+z');
      await expect.poll(async () => JSON.stringify((await stored())[0]?.path)).toBe(JSON.stringify(original.path));
      // Wait past the delayed worker delivery: the erase must not re-land.
      await page.waitForTimeout(2500);
      expect((await stored())[0].path).toEqual(original.path);
      await page.keyboard.press('Meta+Shift+z');
      await expect.poll(async () => JSON.stringify((await stored())[0]?.path)).not.toBe(JSON.stringify(original.path));
    } else {
      await page.reload();
      await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
      await expect.poll(async () => (await stored()).length).toBe(1);
      const survivor = (await stored())[0];
      expect(survivor.path).not.toEqual(original.path);
      // A second reload must preserve exactly the committed survivor.
      await page.reload();
      await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
      await expect.poll(async () => JSON.stringify((await stored())[0]?.path)).toBe(JSON.stringify(survivor.path));
    }
  });
}

test('live eraser preserves untouched tiny dots and removes only the contacted ribbon', async ({ page }) => {
  await page.goto('/?atomicEraseHarness=1');
  await page.locator('[data-atomic-erase-harness-ready="true"]').waitFor();
  const original = await page.evaluate(async () => {
    const { createProductionPaperInk } = await import('/src/utils/productionPaperInk.js');
    const dot = createProductionPaperInk({ id: 'harness-pen', points: [{ x: 50, y: 50 }], width: 0.02, color: '#000000' });
    const ribbon = { type: 'path', left: 0, top: 0, fill: '#000000', stroke: null, strokeWidth: 0,
      path: [['M', 230, 140], ['L', 280, 140], ['L', 280, 140.3], ['L', 230, 140.3], ['Z']],
      polygons: null, paperInkGeometry: null, paperCenterline: null, data: { type: 'ink', tool: 'pen' } };
    window.__atomicEraseHarness.applyRemoteBaseEdit('harness-pen', dot);
    window.__atomicEraseHarness.applyRemoteBaseEdit('harness-counter-1', ribbon);
    return window.__atomicEraseHarness.getAnnotationById('harness-pen');
  });
  const surface = await page.locator('[data-annotation-real-surface]').boundingBox();
  await page.mouse.move(surface.x + 225, surface.y + 140);
  await page.mouse.down();
  await page.mouse.move(surface.x + 285, surface.y + 140, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__atomicEraseHarness.getAnnotationById('harness-counter-1'))).toBeNull();
  expect(await page.evaluate(() => window.__atomicEraseHarness.getAnnotationById('harness-pen'))).toEqual(original);
});

test('fine scrub planning has bounded cost in the browser', async ({ page }) => {
  await open(page, 'clickable-link-test.pdf');
  const result = await page.evaluate(async () => {
    const { createProductionPaperInk } = await import('/src/utils/productionPaperInk.js');
    const { erasePageAnnotations } = await import('/src/utils/pageSpaceEraser.js');
    const ink = createProductionPaperInk({ id: 'dense', width: 60, color: '#000000',
      points: Array.from({ length: 61 }, (_, i) => ({ x: 60 + i * 7.5, y: 320 + 55 * Math.sin(i / 5) })) });
    const eraserPoints = Array.from({ length: 121 }, (_, i) => ({ x: 110 + (i % 2 ? 150 : 0) + i * 1.2, y: 260 + i * 0.9 }));
    const start = performance.now();
    const result = erasePageAnnotations({ pageAnnotations: { objects: [ink] }, eraserPoints, eraserRadius: 2, mode: 'partial' });
    return { ms: performance.now() - start, changed: result.changedIds, failures: result.failedStages };
  });
  console.log('fine scrub planning', result);
  expect(result.changed).toEqual(['dense']);
  expect(result.ms).toBeLessThan(1000);
  expect((result.failures || []).filter(f => f.recovered === false)).toHaveLength(0);
});

for (const fixture of ['unapplied-redaction-leak.pdf', 'e2e/prog-09-unapplied-redaction.pdf']) {
  test(`redaction notice clears after erasing every mark in ${fixture}`, async ({ page }) => {
    await open(page, fixture);
    const marks = page.locator('[data-shape-kind="text-markup-redact"]');
    const count = await marks.count();
    expect(count).toBe(fixture.includes('prog-09') ? 6 : 1);
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    await page.getByRole('button', { name: 'Partial erase', exact: true }).click();
    await page.locator('[data-diag-eraser-wrapper="1"]').waitFor();
    for (let i = count; i > 0; i--) {
      const box = await marks.first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.mouse.up();
      await expect(marks).toHaveCount(i - 1);
    }
    await expect(page.getByText('Redactions are not applied', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Meta+z');
    await expect(marks).toHaveCount(1);
    await expect(page.getByText('Redactions are not applied', { exact: true })).toBeVisible();
  });
}

test('a cut text mark can be pasted back without creating a duplicate', async ({ page }) => {
  await open(page, 'e2e/prog-02-text-markup.pdf');
  await page.keyboard.press('v');
  const marks = page.locator('[data-shape-kind="text-markup-highlight"]');
  const count = await marks.count();
  const box = await marks.first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Meta+x');
  await expect(marks).toHaveCount(count - 1);
  await page.keyboard.press('Meta+v');
  await expect(marks).toHaveCount(count);
});
