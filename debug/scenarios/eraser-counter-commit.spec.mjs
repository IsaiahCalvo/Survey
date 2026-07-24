import { test, expect } from '@playwright/test';

const HARNESS = process.env.PLAYWRIGHT_BASE_URL
  ? new URL('/?atomicEraseHarness=1', process.env.PLAYWRIGHT_BASE_URL).toString()
  : '/?atomicEraseHarness=1';
const COUNTER_IDS = [
  'harness-counter-1',
  'harness-counter-2',
  'harness-counter-3',
];

async function counterState(page) {
  return page.evaluate((ids) => ids
    .map((id) => window.__atomicEraseHarness.getAnnotationById(id))
    .filter(Boolean)
    .sort((left, right) => left.data.createdAt - right.data.createdAt)
    .map((counter) => ({
      id: counter.data.id,
      displayNumber: counter.data.displayNumber,
      seriesStart: counter.data.seriesStart,
    })), COUNTER_IDS);
}

async function eraseSecondCounter(page) {
  const box = await page.locator('[data-annotation-real-surface]').boundingBox();
  await page.mouse.click(box.x + 397, box.y + 302);
}

test('real atomic counter 1/2/3 deletion renumbers and lane Undo/Redo is exact in both modes', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(HARNESS);
  await expect(page.locator('[data-atomic-erase-harness-ready="true"]')).toBeVisible();
  await expect.poll(
    () => page.evaluate(() => typeof window.__atomicEraseHarness?.getAnnotationById),
  ).toBe('function');

  const original = await counterState(page);
  expect(original.map((counter) => counter.displayNumber)).toEqual([1, 2, 3]);
  const deletedAndRenumbered = [
    original[0],
    { ...original[2], displayNumber: 2, seriesStart: 1 },
  ];

  const eraseAndAssertHistory = async (expectedMode) => {
    await eraseSecondCounter(page);
    await expect.poll(() => counterState(page)).toEqual(deletedAndRenumbered);
    const transition = await page.evaluate(
      () => structuredClone(window.__atomicEraseHarnessTransitions.at(-1)),
    );
    expect(transition.lanes).toHaveLength(1);
    expect(transition.lanes[0].nextLane.deleted).toBe(true);
    expect(transition.counterRenumbers).toEqual([{
      storageKey: COUNTER_IDS[2],
      previous: { displayNumber: 3, seriesStart: 1 },
      next: { displayNumber: 2, seriesStart: 1 },
    }]);
    const committedIntent = await page.evaluate(
      () => structuredClone(window.__atomicEraseHarnessIntents.at(-1)),
    );
    expect(committedIntent.gesture.mode).toBe(expectedMode);
    expect(committedIntent.gesture.radius).toBe(12);
    expect(await page.getByLabel('Eraser mode').inputValue()).toBe(expectedMode);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => counterState(page)).toEqual(original);
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect.poll(() => counterState(page)).toEqual(deletedAndRenumbered);
  };

  // Counters are atomic objects, so Partial erase still whole-deletes them.
  await eraseAndAssertHistory('partial');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => counterState(page)).toEqual(original);

  await page.getByLabel('Eraser mode').selectOption('full');
  await eraseAndAssertHistory('full');
  expect(errors, `Console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('tiny eraser whole-deletes a counter from its visible nub tip and Undo restores it', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(HARNESS);
  await expect(page.locator('[data-atomic-erase-harness-ready="true"]')).toBeVisible();
  await expect.poll(
    () => page.evaluate(() => typeof window.__atomicEraseHarness?.getAnnotationById),
  ).toBe('function');
  await page.getByLabel('Eraser diameter').fill('4');

  const target = await page.evaluate(() => {
    const object = window.__atomicEraseHarness.getAnnotationById('harness-counter-2');
    const radius = (Number(object.radius) || 14) * Math.abs(Number(object.scaleX) || 1);
    const centerX = Number(object.left || 0) + radius;
    const centerY = Number(object.top || 0) + radius;
    const angle = ((object.data.pointerAngle ?? 225) * Math.PI) / 180;
    const tipDistance = radius + Math.max(5, radius * 0.5);
    return {
      x: centerX + Math.cos(angle) * tipDistance,
      y: centerY + Math.sin(angle) * tipDistance,
      bodyDistance: tipDistance,
      radius,
    };
  });
  expect(target.bodyDistance).toBeGreaterThan(target.radius + 2);

  const surface = await page.locator('[data-annotation-real-surface]').boundingBox();
  await page.mouse.click(surface.x + target.x, surface.y + target.y);
  await expect.poll(() => counterState(page)).toEqual([
    {
      id: 'harness-counter-1',
      displayNumber: 1,
      seriesStart: 1,
    },
    {
      id: 'harness-counter-3',
      displayNumber: 2,
      seriesStart: 1,
    },
  ]);
  const intent = await page.evaluate(
    () => structuredClone(window.__atomicEraseHarnessIntents.at(-1)),
  );
  expect(intent.gesture.radius).toBe(2);
  expect(intent.gesture.mode).toBe('partial');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => counterState(page)).toEqual([
    {
      id: 'harness-counter-1',
      displayNumber: 1,
      seriesStart: 1,
    },
    {
      id: 'harness-counter-2',
      displayNumber: 2,
      seriesStart: 1,
    },
    {
      id: 'harness-counter-3',
      displayNumber: 3,
      seriesStart: 1,
    },
  ]);
  expect(errors, `Console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('transformed counter nub is the exact browser hit target and space beyond it misses', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(HARNESS);
  await expect(page.locator('[data-atomic-erase-harness-ready="true"]')).toBeVisible();
  await expect.poll(
    () => page.evaluate(() => typeof window.__atomicEraseHarness?.applyRemoteBaseEdit),
  ).toBe('function');
  await page.getByLabel('Eraser mode').selectOption('full');
  await page.getByLabel('Eraser diameter').fill('1');

  const target = await page.evaluate(async () => {
    const object = window.__atomicEraseHarness.applyRemoteBaseEdit(
      'harness-counter-1',
      {
        scaleX: 1.2,
        scaleY: 7,
        angle: 45,
        data: { pointerAngle: 37 },
      },
    );
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const radius = (Number(object.radius) || 14)
      * Math.abs(Number(object.scaleX) || 1);
    const center = {
      x: Number(object.left || 0) + radius,
      y: Number(object.top || 0) + radius,
    };
    const radians = (object.data.pointerAngle * Math.PI) / 180;
    const direction = { x: Math.cos(radians), y: Math.sin(radians) };
    const tipDistance = radius + Math.max(5, radius * 0.5);
    const tip = {
      x: center.x + direction.x * tipDistance,
      y: center.y + direction.y * tipDistance,
    };
    return {
      inside: {
        x: tip.x - direction.x * 1.5,
        y: tip.y - direction.y * 1.5,
      },
      outside: {
        x: tip.x + direction.x * 3,
        y: tip.y + direction.y * 3,
      },
      pathD: document
        .querySelector('[data-annotation-id="harness-counter-1"] path')
        ?.getAttribute('d'),
      tip,
    };
  });
  expect(target.pathD).toContain(`M ${target.tip.x},${target.tip.y}`);

  const surface = await page.locator('[data-annotation-real-surface]').boundingBox();
  await page.mouse.click(
    surface.x + target.outside.x,
    surface.y + target.outside.y,
  );
  await page.waitForTimeout(100);
  expect(await page.evaluate(
    () => window.__atomicEraseHarnessTransactions.length,
  )).toBe(0);
  expect(await page.evaluate(
    () => window.__atomicEraseHarness.getAnnotationById('harness-counter-1') !== null,
  )).toBe(true);

  await page.mouse.click(
    surface.x + target.inside.x,
    surface.y + target.inside.y,
  );
  await expect.poll(
    () => page.evaluate(
      () => window.__atomicEraseHarness.getAnnotationById('harness-counter-1'),
    ),
  ).toBeNull();
  const intent = await page.evaluate(
    () => structuredClone(window.__atomicEraseHarnessIntents.at(-1)),
  );
  expect(intent.gesture).toMatchObject({ radius: 0.5, mode: 'full' });
  expect(intent.diagnostics.candidateAnnotationIds).toEqual(['harness-counter-1']);
  expect(intent.targets[0]).toMatchObject({
    storageKey: 'harness-counter-1',
    operation: 'delete',
    before: {
      scaleX: 1.2,
      scaleY: 7,
      angle: 45,
      data: { pointerAngle: 37 },
    },
  });
  expect(errors, `Console errors: ${errors.join(' | ')}`).toEqual([]);
});
