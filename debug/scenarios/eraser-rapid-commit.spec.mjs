import { test, expect } from '@playwright/test';

const HARNESS = '/?atomicEraseHarness=1';
const PEN_ID = 'harness-pen';

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

function withoutDerivedBaseTransform(object) {
  const clone = structuredClone(object);
  delete clone.paperEraserBaseTransform;
  return clone;
}

async function harnessObject(page, id = PEN_ID) {
  return page.evaluate(
    (annotationId) => window.__atomicEraseHarness.getAnnotationById(annotationId),
    id,
  );
}

async function dragErase(page, pageX) {
  const box = await page.locator('[data-annotation-real-surface]').boundingBox();
  await page.mouse.move(box.x + pageX, box.y + 98);
  await page.mouse.down();
  await page.mouse.move(box.x + pageX, box.y + 182, { steps: 16 });
  await page.mouse.up();
}

async function waitForHarness(page) {
  await page.goto(HARNESS);
  await expect(page.locator('[data-atomic-erase-harness-ready="true"]')).toBeVisible();
  await expect.poll(
    () => page.evaluate(() => typeof window.__atomicEraseHarness?.getAnnotationById),
  ).toBe('function');
}

test('real atomic path serializes rapid partial erases and lane Undo/Redo is exact', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const state = { entered: 0, intents: [], releases: [] };
    window.__eraserRapidCommitState = state;
    window.__eraserCommitTestGate = async (intent) => {
      state.entered += 1;
      state.intents.push(structuredClone(intent));
      await new Promise((resolve) => state.releases.push(resolve));
    };
    window.__releaseNextEraserCommit = () => state.releases.shift()?.();
  });
  await waitForHarness(page);

  const original = await harnessObject(page);
  expect(original?.type).toBe('path');

  await dragErase(page, 255);
  await expect.poll(
    () => page.evaluate(() => window.__eraserRapidCommitState.entered),
  ).toBe(1);
  await expect(page.locator('[data-eraser-mask-clone]')).toHaveCount(1);

  // A normal React rerender while the commit is held must not clear the live
  // handoff clone or turn the queued gesture into a stale-state mutation.
  await page.getByLabel('Eraser diameter').fill('26');
  await expect(page.locator('[data-eraser-mask-clone]')).toHaveCount(1);
  await dragErase(page, 405);
  expect(await page.evaluate(() => window.__eraserRapidCommitState.entered)).toBe(1);
  await expect(page.locator('[data-eraser-mask-clone]')).toHaveCount(1);

  await page.evaluate(() => window.__releaseNextEraserCommit());
  await expect.poll(
    () => page.evaluate(() => window.__eraserRapidCommitState.entered),
  ).toBe(2);
  await expect(page.locator('[data-eraser-mask-clone]')).toHaveCount(1);

  const rawIntents = await page.evaluate(
    () => structuredClone(window.__eraserRapidCommitState.intents),
  );
  expect(rawIntents[0].gesture.mode).toBe('partial');
  expect(rawIntents[0].gesture.radius).toBe(12);
  expect(rawIntents[1].gesture.mode).toBe('partial');
  expect(rawIntents[1].gesture.radius).toBe(13);
  const firstTarget = rawIntents[0].targets.find((target) => target.storageKey === PEN_ID);
  const secondTarget = rawIntents[1].targets.find((target) => target.storageKey === PEN_ID);
  expect(firstTarget.operation).toBe('replace');
  expect(secondTarget.operation).toBe('replace');
  // Materializing the first durable lane adds its canonical base-transform
  // snapshot. It is bookkeeping for later collaborator affine rebases, not a
  // geometry/style difference between the queued gestures.
  expect(withoutDerivedBaseTransform(secondTarget.before)).toEqual(
    withoutDerivedBaseTransform(firstTarget.after),
  );
  expect(secondTarget.before.paperEraserBaseTransform).toEqual({
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    pathOffset: null,
    skewX: 0,
    skewY: 0,
    flipX: false,
    flipY: false,
  });

  await page.evaluate(() => window.__releaseNextEraserCommit());
  await expect.poll(
    () => page.evaluate(() => window.__atomicEraseHarnessTransitions.length),
  ).toBe(2);
  await expect(page.locator('[data-eraser-mask-clone]')).toHaveCount(0);

  const firstPoint = { x: rawIntents[0].gesture.points[0].x, y: 140 };
  const secondPoint = { x: rawIntents[1].gesture.points[0].x, y: 140 };
  expect(pointInPolygonSet(firstPoint, original.polygons)).toBe(true);
  expect(pointInPolygonSet(secondPoint, original.polygons)).toBe(true);
  const finalObject = await harnessObject(page);
  expect(pointInPolygonSet(firstPoint, finalObject.polygons)).toBe(false);
  expect(pointInPolygonSet(secondPoint, finalObject.polygons)).toBe(false);
  expect(await page.evaluate(() => window.__atomicEraseHarness.getHistoryDepths())).toEqual({
    undo: 2,
    redo: 0,
  });

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => {
    const object = await harnessObject(page);
    return {
      first: pointInPolygonSet(firstPoint, object.polygons),
      second: pointInPolygonSet(secondPoint, object.polygons),
    };
  }).toEqual({ first: false, second: true });

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => harnessObject(page)).toEqual(original);
  expect(await page.evaluate(() => window.__atomicEraseHarness.getHistoryDepths())).toEqual({
    undo: 0,
    redo: 2,
  });

  await page.getByRole('button', { name: 'Redo' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(() => harnessObject(page)).toEqual(finalObject);
  expect(errors, `Console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('conflicted held commit cannot overwrite remote truth and queued gesture rebases', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const state = { entered: 0, intents: [], releaseFirst: null, releaseSecond: null };
    window.__eraserFailureState = state;
    window.__eraserCommitTestGate = async (intent) => {
      state.entered += 1;
      state.intents.push(structuredClone(intent));
      if (state.entered === 1) {
        await new Promise((resolve) => {
          state.releaseFirst = resolve;
        });
      } else {
        await new Promise((resolve) => {
          state.releaseSecond = resolve;
        });
      }
    };
    window.__releaseFirstEraserCommit = () => state.releaseFirst?.();
    window.__releaseSecondEraserCommit = () => state.releaseSecond?.();
  });
  await waitForHarness(page);
  const original = await harnessObject(page);

  await dragErase(page, 250);
  await expect.poll(
    () => page.evaluate(() => window.__eraserFailureState.entered),
  ).toBe(1);
  await dragErase(page, 410);
  expect(await page.evaluate(() => window.__eraserFailureState.entered)).toBe(1);

  const remoteBase = await page.evaluate(
    (annotationId) => window.__atomicEraseHarness.applyRemoteBaseEdit(annotationId, {
      fill: '#2563eb',
      opacity: 0.42,
      data: { remoteRevision: 'authoritative-midpoint' },
    }),
    PEN_ID,
  );
  expect(remoteBase.fill).toBe('#2563eb');
  expect(remoteBase.data.remoteRevision).toBe('authoritative-midpoint');

  await page.evaluate(() => window.__releaseFirstEraserCommit());
  await expect.poll(
    () => page.evaluate(() => window.__eraserFailureState.entered),
  ).toBe(2);
  const rawIntents = await page.evaluate(
    () => structuredClone(window.__eraserFailureState.intents),
  );
  const firstTarget = rawIntents[0].targets.find((target) => target.storageKey === PEN_ID);
  const secondTarget = rawIntents[1].targets.find((target) => target.storageKey === PEN_ID);
  expect(secondTarget.before.fill).toBe('#2563eb');
  expect(secondTarget.before.opacity).toBe(0.42);
  expect(secondTarget.before.data.remoteRevision).toBe('authoritative-midpoint');
  expect(secondTarget.before).not.toEqual(firstTarget.after);

  await page.evaluate(() => window.__releaseSecondEraserCommit());
  await expect.poll(
    () => page.evaluate(() => window.__atomicEraseHarnessTransitions.length),
  ).toBe(1);
  await expect(page.locator('[data-eraser-mask-clone]')).toHaveCount(0);

  await expect.poll(
    () => page.evaluate(() => window.__atomicEraseHarnessTransactions.length),
  ).toBe(2);
  expect(await page.evaluate(
    () => window.__atomicEraseHarnessTransactions.map(
      ({ status, reason }) => ({ status, reason }),
    ),
  )).toEqual([
    { status: 'cancelled', reason: 'conflict' },
    { status: 'committed', reason: null },
  ]);

  const failedPoint = { x: rawIntents[0].gesture.points[0].x, y: 140 };
  const successfulPoint = { x: rawIntents[1].gesture.points[0].x, y: 140 };
  expect(pointInPolygonSet(failedPoint, original.polygons)).toBe(true);
  expect(pointInPolygonSet(successfulPoint, original.polygons)).toBe(true);
  const finalObject = await harnessObject(page);
  expect(pointInPolygonSet(failedPoint, finalObject.polygons)).toBe(true);
  expect(pointInPolygonSet(successfulPoint, finalObject.polygons)).toBe(false);
  expect(finalObject.fill).toBe('#2563eb');
  expect(finalObject.opacity).toBe(0.42);
  expect(finalObject.data.remoteRevision).toBe('authoritative-midpoint');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => {
    const object = await harnessObject(page);
    return {
      restored: pointInPolygonSet(successfulPoint, object.polygons),
      fill: object.fill,
      opacity: object.opacity,
      remoteRevision: object.data.remoteRevision,
    };
  }).toEqual({
    restored: true,
    fill: '#2563eb',
    opacity: 0.42,
    remoteRevision: 'authoritative-midpoint',
  });
  expect(errors).toEqual([]);
});
