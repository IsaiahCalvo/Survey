import { test, expect } from '@playwright/test';
// 2026-08-16 (975b7e86) relabelled the shared toolbar size input to "Size" while
// the eraser (or counter) is active and left it "Width" for the pen. The specs
// match either label so they follow the tool that is active.
import { PNG } from 'pngjs';
import { asymmetricNoRepaint } from './eraserPixelOracle.mjs';

const FIXTURE = '/?testPdf=clickable-link-test.pdf&eraserLifecycleE2E=1';

async function openEditor(page) {
  await page.goto(FIXTURE);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => page.evaluate(
    () => typeof window.__phase35GetAnnotationById,
  )).toBe('function');
}

async function openDrawTools(page) {
  if (await page.getByRole('button', { name: 'Pen', exact: true }).count() === 0) {
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
  }
}

async function setWidth(page, width) {
  const input = page.getByRole('textbox', { name: /^(Width|Size)$/ });
  await input.fill(String(width));
  await input.press('Tab');
  await input.evaluate((element) => element.blur());
  await expect(input).toHaveValue(String(width));
}

async function createStroke(page) {
  const annotationGroups = page.locator(
    '[data-svg-annotation-layer="1"] > g[data-anno-id]',
  );
  const beforeIds = new Set(
    await annotationGroups.evaluateAll((groups) =>
      groups.map((group) => group.getAttribute('data-anno-id')).filter(Boolean),
    ),
  );
  await openDrawTools(page);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await setWidth(page, 16);
  const pdfPage = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pdfPage.boundingBox();
  expect(box).toBeTruthy();
  const y = box.y + box.height * 0.78;
  await page.mouse.move(box.x + box.width * 0.22, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.78, y, { steps: 12 });
  await page.mouse.up();
  const findCreatedId = () => page.evaluate((existingIds) => {
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
        && String(object?.data?.tool || object?.tool || '').toLowerCase() === 'pen'
        && object?.isPdfImported !== true
      );
    }) || null;
  }, [...beforeIds]);
  let createdId = null;
  await expect.poll(async () => {
    createdId = await findCreatedId();
    return createdId;
  }, {
    message: 'Pen gesture must create a mounted local path annotation',
  }).not.toBeNull();
  return page.locator(
    `[data-svg-annotation-layer="1"] > g[data-anno-id="${createdId}"]`,
  );
}

async function activatePartialEraser(page) {
  await openDrawTools(page);
  const partialEraser = page.getByRole('button', { name: 'Partial erase', exact: true });
  await partialEraser.click();
  await expect(partialEraser).toHaveClass(/btn-active/);
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toBeVisible();
  await setWidth(page, 24);
}

function crossingPoints(box) {
  const x = box.x + box.width / 2;
  return {
    start: { x, y: box.y - 12 },
    middle: { x, y: box.y + box.height / 2 },
    end: { x, y: box.y + box.height + 12 },
  };
}

function paddedClip(box, viewport, padding = 24) {
  const x = Math.max(0, Math.floor(box.x - padding));
  const y = Math.max(0, Math.floor(box.y - padding));
  const right = Math.min(viewport.width, Math.ceil(box.x + box.width + padding));
  const bottom = Math.min(viewport.height, Math.ceil(box.y + box.height + padding));
  return { x, y, width: right - x, height: bottom - y };
}

function rgbaMismatchCount(firstPng, secondPng) {
  const first = PNG.sync.read(firstPng);
  const second = PNG.sync.read(secondPng);
  expect([second.width, second.height]).toEqual([first.width, first.height]);
  let mismatches = 0;
  for (let offset = 0; offset < first.data.length; offset += 4) {
    if (
      first.data[offset] !== second.data[offset]
      || first.data[offset + 1] !== second.data[offset + 1]
      || first.data[offset + 2] !== second.data[offset + 2]
      || first.data[offset + 3] !== second.data[offset + 3]
    ) {
      mismatches += 1;
    }
  }
  return mismatches;
}

test('SVG absence disables bitmap fallback; mid-swap clone recovery preserves exact pixels', async ({
  page,
}) => {
  await openEditor(page);
  const stroke = await createStroke(page);
  const strokeBox = await stroke.boundingBox();
  const clip = paddedClip(strokeBox, page.viewportSize());
  const beforePixels = await page.screenshot({ clip });
  await activatePartialEraser(page);
  const points = crossingPoints(strokeBox);

  await page.evaluate(() => {
    window.__eraserHandoffTest = { forceMaskCloneUnavailable: true };
  });
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.middle.x, points.middle.y, { steps: 4 });
  await expect(page.locator('[data-eraser-mask-clone="1"]')).toHaveCount(0);
  await expect(page.locator('[data-eraser-live-preview="1"]')).toHaveCSS('display', 'none');

  await page.evaluate(() => {
    window.__eraserHandoffTest.forceMaskCloneUnavailable = false;
  });
  await page.mouse.move(points.middle.x + 2, points.middle.y, { steps: 2 });
  const clone = page.locator('[data-eraser-mask-clone="1"]');
  await expect(clone).toHaveCount(1);
  await page.locator('[data-eraser-cursor="true"]').evaluate((element) => {
    element.style.display = 'none';
  });
  const beforeRecoveryPixels = await page.screenshot({ clip });
  await clone.evaluate((element) => {
    element.dataset.recoveryToken = 'same-exact-clone';
    element.remove();
  });
  await expect(page.locator('[data-recovery-token="same-exact-clone"]')).toHaveCount(1);
  const previewPixels = await page.screenshot({ clip });
  expect(rgbaMismatchCount(beforeRecoveryPixels, previewPixels)).toBe(0);
  await page.mouse.move(points.end.x, points.end.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-eraser-mask-clone="1"]')).toHaveCount(0);
  const committedPixels = await page.screenshot({ clip });
  const noRepaint = asymmetricNoRepaint(beforePixels, previewPixels, committedPixels);
  expect(noRepaint.interiorErasedPixels).toBeGreaterThan(0);
});

test('missing expected repaint reaches safe-hold and survives repeated zoom', async ({ page }) => {
  await openEditor(page);
  const stroke = await createStroke(page);
  const box = await stroke.boundingBox();
  const points = crossingPoints(box);
  await activatePartialEraser(page);

  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.middle.x, points.middle.y, { steps: 4 });
  await expect(page.locator('[data-eraser-mask-clone="1"]')).toHaveCount(1);
  await page.evaluate(() => {
    window.__eraserHandoffTest = { suppressExactRepaint: true };
  });
  await page.mouse.move(points.end.x, points.end.y, { steps: 4 });
  await page.mouse.up();

  const clone = page.locator('[data-eraser-mask-clone="1"]');
  await expect(clone).toHaveAttribute('data-eraser-handoff-state', 'safe-hold', {
    timeout: 2_000,
  });
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
  await zoom.click();
  await zoom.click();
  await expect(clone).toHaveAttribute('data-eraser-handoff-state', 'safe-hold');
  await expect(page.locator('[data-diag-svg-wrapper]')).toHaveCSS('visibility', 'hidden');

  await page.evaluate(() => {
    window.__eraserHandoffTest.suppressExactRepaint = false;
  });
  await setWidth(page, 25);
  await expect(clone).toHaveCount(0);
  await expect(page.locator('[data-diag-svg-wrapper]')).not.toHaveCSS('visibility', 'hidden');

  await page.reload();
  await expect(page.locator('[data-eraser-mask-clone]')).toHaveCount(0);
});
