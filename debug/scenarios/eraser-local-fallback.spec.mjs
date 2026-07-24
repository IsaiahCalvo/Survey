import { test, expect } from '@playwright/test';

const TEST_PDF = '/?testPdf=clickable-link-test.pdf';

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (
      (yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonSet(point, polygons) {
  return (polygons || []).some((polygon) => (
    polygon.reduce((inside, ring) => (pointInRing(point, ring) ? !inside : inside), false)
  ));
}

function polygonCenter(polygons) {
  const points = (polygons || []).flat(2);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

async function annotationIds(page) {
  return page.locator('svg[data-svg-annotation-layer] [data-annotation-id]').evaluateAll(
    (elements) => [...new Set(elements
      .map((element) => element.getAttribute('data-annotation-id'))
      .filter(Boolean))],
  );
}

async function waitForLocalEditor(page) {
  await page.goto(TEST_PDF);
  await page.getByRole('button', { name: 'Draw' }).waitFor({ state: 'visible', timeout: 60_000 });
  await expect.poll(
    () => page.evaluate(() => typeof window.__phase35GetAnnotationById),
    { timeout: 30_000 },
  ).toBe('function');
}

test('local-only partial erase uses the save fallback and survives a full reload', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await waitForLocalEditor(page);

  const pageOne = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await expect(pageOne).toBeVisible();
  await pageOne.scrollIntoViewIfNeeded();
  const beforeIds = await annotationIds(page);
  const pageBox = await pageOne.boundingBox();
  const strokeY = pageBox.y + pageBox.height * 0.38;
  const strokeStartX = pageBox.x + pageBox.width * 0.28;
  const strokeEndX = pageBox.x + pageBox.width * 0.72;

  await page.keyboard.press('p');
  const widthInput = page.locator('input[title="Width"]');
  await widthInput.fill('20');
  await widthInput.press('Enter');
  await page.mouse.move(strokeStartX, strokeY);
  await page.mouse.down();
  await page.mouse.move(strokeEndX, strokeY, { steps: 30 });
  await page.mouse.up();

  let annotationId = null;
  await expect.poll(async () => {
    annotationId = (await annotationIds(page)).find((id) => !beforeIds.includes(id)) || null;
    return annotationId;
  }, { timeout: 15_000 }).not.toBeNull();
  const original = await page.evaluate(
    (id) => window.__phase35GetAnnotationById(id),
    annotationId,
  );
  const crossingPoint = polygonCenter(original.polygons);
  expect(pointInPolygonSet(crossingPoint, original.polygons)).toBe(true);

  await page.keyboard.press('Shift+E');
  await widthInput.fill('24');
  await widthInput.press('Enter');
  const eraseX = pageBox.x + pageBox.width * 0.50;
  await page.mouse.move(eraseX, strokeY - 28);
  await page.mouse.down();
  await page.mouse.move(eraseX, strokeY + 28, { steps: 14 });
  await page.mouse.up();

  let erased = null;
  await expect.poll(async () => {
    erased = await page.evaluate(
      (id) => window.__phase35GetAnnotationById(id),
      annotationId,
    );
    return JSON.stringify(erased?.polygons) !== JSON.stringify(original?.polygons);
  }, { timeout: 15_000 }).toBe(true);
  expect(pointInPolygonSet(crossingPoint, erased.polygons)).toBe(false);
  expect(await page.evaluate(() => window.__lastEraseTransaction ?? null)).toBeNull();

  await page.reload();
  await page.getByRole('button', { name: 'Draw' }).waitFor({ state: 'visible', timeout: 60_000 });
  await expect.poll(
    () => page.evaluate(() => typeof window.__phase35GetAnnotationById),
    { timeout: 30_000 },
  ).toBe('function');
  await expect.poll(
    () => page.evaluate(
      ({ id, expected }) => (
        JSON.stringify(window.__phase35GetAnnotationById(id)?.polygons)
        === JSON.stringify(expected)
      ),
      { id: annotationId, expected: erased.polygons },
    ),
    { timeout: 30_000 },
  ).toBe(true);
  const reloaded = await page.evaluate(
    (id) => window.__phase35GetAnnotationById(id),
    annotationId,
  );
  expect(pointInPolygonSet(crossingPoint, reloaded.polygons)).toBe(false);
  expect(await page.evaluate(() => window.__lastEraseTransaction ?? null)).toBeNull();
  expect(errors, `Console errors: ${errors.join(' | ')}`).toEqual([]);
});
