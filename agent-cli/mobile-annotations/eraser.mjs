import assert from 'node:assert/strict';
import {
  annotationGeometry,
  findPersistedAnnotation,
  persistedSnapshot,
  waitForPersistedAnnotation,
} from './storage.mjs';
import {
  mountedAnnotation,
  openRealMobileViewer,
  waitForMountedAnnotation,
} from './viewer.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const escapeAttribute = (value) => String(value).replace(/["\\]/g, '\\$&');

const selectorFor = (id) => `g[data-anno-id="${escapeAttribute(id)}"]`;

async function activateGroupedTool(page, group, label) {
  const tool = page.getByRole('button', { name: label, exact: true });
  if (await tool.count() === 0) {
    const groupButton = page.getByRole('button', { name: group, exact: true });
    assert.equal(await groupButton.count(), 1, `Expected one ${group} toolbar button`);
    await groupButton.click();
  }
  assert.equal(await tool.count(), 1, `Could not open ${group} → ${label}`);
  await tool.click();
}

async function visiblePageBox(page) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  assert(box && box.width > 40 && box.height > 40, 'PDF page must have usable geometry');
  const viewport = page.viewportSize();
  assert(viewport, 'Mobile viewport must be available');
  const visibleTop = Math.max(box.y + 20, 112);
  const visibleBottom = Math.min(box.y + box.height - 20, viewport.height - 110);
  assert(visibleBottom - visibleTop > 80, 'PDF page has too little visible height for eraser QA');
  return { ...box, visibleTop, visibleBottom };
}

async function annotationIds(page) {
  return page.locator('g[data-anno-id]').evaluateAll((groups) => (
    groups.map((group) => group.getAttribute('data-anno-id')).filter(Boolean)
  ));
}

async function createPen(page, touch, storageKeys, {
  startFraction,
  endFraction,
  yFraction,
}) {
  const beforeIds = new Set(await annotationIds(page));
  await activateGroupedTool(page, 'Draw', 'Pen');

  const width = page.getByRole('textbox', { name: 'Stroke width', exact: true });
  assert.equal(await width.count(), 1, 'Pen Width input must be available');
  await width.fill('10');
  await width.press('Tab');

  const box = await visiblePageBox(page);
  const y = box.visibleTop + ((box.visibleBottom - box.visibleTop) * yFraction);
  const startX = box.x + (box.width * startFraction);
  const endX = box.x + (box.width * endFraction);
  const span = endX - startX;
  await touch.stroke([
    { x: startX, y },
    { x: startX + span * 0.2, y: y - 4 },
    { x: startX + span * 0.4, y: y + 3 },
    { x: startX + span * 0.6, y: y - 3 },
    { x: startX + span * 0.8, y: y + 4 },
    { x: endX, y },
  ]);

  const handle = await page.waitForFunction(({ priorIds }) => {
    const prior = new Set(priorIds);
    return [...document.querySelectorAll('g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .find((id) => {
        if (!id || prior.has(id)) return false;
        const object = window.__phase35GetAnnotationById?.(id);
        return (
          String(object?.type || '').toLowerCase() === 'path'
          && String(object?.data?.tool || object?.tool || '').toLowerCase() === 'pen'
          && object?.isPdfImported !== true
        );
      }) || null;
  }, { priorIds: [...beforeIds] });
  const id = await handle.jsonValue();
  assert(id, 'Trusted touch must create a stable Pen annotation');
  const object = await waitForMountedAnnotation(page, id);
  const persisted = await waitForPersistedAnnotation(page, storageKeys.annotations, id);
  return { id, object, persisted };
}

async function activateEraser(page, { mode, size }) {
  let eraser = page.getByRole('button', { name: 'Eraser', exact: true });
  if (await eraser.count() === 0) {
    const draw = page.getByRole('button', { name: 'Draw', exact: true });
    assert.equal(await draw.count(), 1, 'Expected one Draw toolbar button');
    await draw.click();
  }
  eraser = page.getByRole('button', { name: 'Eraser', exact: true });
  assert.equal(await eraser.count(), 1, 'Eraser tool must be available');
  await eraser.click();

  await page.locator('[data-diag-eraser-wrapper="1"]').waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  const desiredMode = mode === 'entire' ? 'Full Stroke' : 'Partial Erase';
  const modeTrigger = page.getByRole('button', { name: 'Eraser mode', exact: true });
  assert.equal(await modeTrigger.count(), 1, 'Mobile Eraser mode control must be available');
  if ((await modeTrigger.textContent())?.trim() !== desiredMode) {
    await modeTrigger.click();
    const option = page.getByRole('option', { name: desiredMode, exact: true });
    assert.equal(await option.count(), 1, `${desiredMode} option must be available`);
    await option.click();
  }
  // The option closes its popover before React commits the selected label.
  // Poll the actual mobile control instead of sampling that intermediate frame.
  await page.waitForFunction(({ label }) => {
    const controls = [...document.querySelectorAll('button')];
    const trigger = controls.find((button) => button.getAttribute('aria-label') === 'Eraser mode');
    return trigger?.textContent?.trim() === label;
  }, { label: desiredMode }, { timeout: 5_000 });

  const width = page.getByRole('textbox', { name: 'Eraser size', exact: true });
  assert.equal(await width.count(), 1, 'Eraser Width input must be available');
  await width.fill(String(size));
  await width.press('Tab');
  assert.equal(await width.inputValue(), String(size), 'Eraser diameter must commit');
}

function crossingPoints(box, inset = 12) {
  const x = box.x + (box.width / 2);
  return {
    start: { x, y: box.y - inset },
    middle: { x, y: box.y + (box.height / 2) },
    end: { x, y: box.y + box.height + inset },
  };
}

function touchPoint(point) {
  return {
    force: 0.7,
    id: 41,
    radiusX: 5,
    radiusY: 5,
    x: point.x,
    y: point.y,
  };
}

function interpolate(start, end, steps) {
  return Array.from({ length: steps }, (_, index) => ({
    x: start.x + (((end.x - start.x) * (index + 1)) / steps),
    y: start.y + (((end.y - start.y) * (index + 1)) / steps),
  }));
}

async function createInFlightTouch(context, page) {
  const cdp = await context.newCDPSession(page);
  let active = false;
  return {
    async start(point) {
      assert.equal(active, false, 'Only one eraser touch may be active');
      active = true;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [touchPoint(point)],
      });
    },
    async move(start, end, steps = 5) {
      assert.equal(active, true, 'Eraser touch must start before it moves');
      for (const point of interpolate(start, end, steps)) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [touchPoint(point)],
        });
        await delay(12);
      }
    },
    async end() {
      assert.equal(active, true, 'Eraser touch must start before it ends');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      active = false;
    },
    async dispose() {
      if (active) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
          .catch(() => {});
      }
      await cdp.detach().catch(() => {});
    },
  };
}

async function eraserPreview(page) {
  return page.locator('[data-diag-eraser-wrapper="1"]').evaluate((wrapper) => {
    const clone = document.querySelector('[data-eraser-mask-clone="1"]');
    if (clone) {
      return {
        active: getComputedStyle(clone).display !== 'none',
        evidence: clone.querySelector('mask path')?.getAttribute('d')?.length || 0,
        kind: 'svg-mask-clone',
      };
    }
    const canvas = wrapper.querySelector('[data-eraser-live-preview="1"]');
    const context2d = canvas?.getContext('2d');
    const pixels = context2d?.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonTransparentPixels = 0;
    if (pixels) {
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 0) nonTransparentPixels += 1;
      }
    }
    return {
      active: Boolean(canvas && canvas.style.display !== 'none'),
      evidence: nonTransparentPixels,
      kind: 'painted-canvas',
    };
  });
}

async function waitForChangedObject(page, storageKey, id, beforePersisted) {
  await page.waitForFunction(({ annotationId, before, key }) => {
    const mounted = window.__phase35GetAnnotationById?.(annotationId) || null;
    let stored = null;
    try {
      const pages = JSON.parse(localStorage.getItem(key) || '{}');
      stored = Object.values(pages).flatMap((entry) => entry?.objects || [])
        .find((object) => object?.id === annotationId) || null;
    } catch {
      return false;
    }
    return Boolean(mounted && stored && JSON.stringify(stored) !== before);
  }, {
    annotationId: id,
    before: JSON.stringify(beforePersisted),
    key: storageKey,
  }, { timeout: 10_000 });
  return waitForPersistedAnnotation(page, storageKey, id);
}

async function waitForAbsentObject(page, storageKey, id) {
  await page.waitForFunction(({ annotationId, key }) => {
    if (window.__phase35GetAnnotationById?.(annotationId)) return false;
    try {
      const pages = JSON.parse(localStorage.getItem(key) || '{}');
      return !Object.values(pages).some((entry) => (
        Array.isArray(entry?.objects)
        && entry.objects.some((object) => object?.id === annotationId)
      ));
    } catch {
      return false;
    }
  }, { annotationId: id, key: storageKey }, { timeout: 10_000 });
  await page.locator(selectorFor(id)).waitFor({ state: 'detached', timeout: 10_000 });
}

function assertSameGeometry(actual, expected, label) {
  assert.deepEqual(annotationGeometry(actual), annotationGeometry(expected), label);
}

/**
 * Runs the eraser row against the mounted 390x844 mobile viewer.
 *
 * The caller owns the browser/context/page lifecycle. This row intentionally
 * requires Chromium's trusted CDP touch so a mouse fallback cannot certify
 * iPhone eraser behavior.
 */
export async function runEraserLifecycle({
  artifacts,
  context,
  page,
  storageKeys,
  touch,
}) {
  assert.equal(
    touch.inputKind,
    'trusted-cdp-touch',
    'Eraser certification requires Chromium trusted CDP touch',
  );

  // Three short, separated strokes keep each eraser assertion independent and
  // avoid disturbing lifecycle objects produced by earlier tool rows.
  const partialTarget = await createPen(page, touch, storageKeys, {
    startFraction: 0.08,
    endFraction: 0.28,
    yFraction: 0.08,
  });
  const deletedTarget = await createPen(page, touch, storageKeys, {
    startFraction: 0.39,
    endFraction: 0.59,
    yFraction: 0.08,
  });
  const undoTarget = await createPen(page, touch, storageKeys, {
    startFraction: 0.70,
    endFraction: 0.90,
    yFraction: 0.08,
  });

  // Partial erase: prove the live mid-drag preview exists while committed app
  // state remains untouched, then release and prove the same stable ID changes.
  await activateEraser(page, { mode: 'partial', size: 18 });
  const partialBox = await page.locator(selectorFor(partialTarget.id)).boundingBox();
  assert(partialBox, 'Partial-erase Pen must remain rendered');
  const partialPoints = crossingPoints(partialBox);
  const inFlightTouch = await createInFlightTouch(context, page);
  try {
    await inFlightTouch.start(partialPoints.start);
    await inFlightTouch.move(partialPoints.start, partialPoints.middle);
    const preview = await eraserPreview(page);
    assert.equal(preview.active, true, 'Partial erase must show a live mid-drag preview');
    assert(preview.evidence > 0, `Partial erase ${preview.kind} must contain visible carve data`);
    assert.deepEqual(
      await mountedAnnotation(page, partialTarget.id),
      partialTarget.object,
      'Mid-drag preview must not mutate committed annotation state',
    );
    await artifacts.screenshot(page, 'eraser-partial-mid-drag');
    await inFlightTouch.move(partialPoints.middle, partialPoints.end);
    await inFlightTouch.end();
  } finally {
    await inFlightTouch.dispose();
  }

  const partialPersisted = await waitForChangedObject(
    page,
    storageKeys.annotations,
    partialTarget.id,
    partialTarget.persisted,
  );
  const partialMounted = await waitForMountedAnnotation(page, partialTarget.id);
  assert.notDeepEqual(
    annotationGeometry(partialMounted),
    annotationGeometry(partialTarget.object),
    'Partial erase must change Pen geometry without deleting its stable ID',
  );
  assertSameGeometry(
    partialPersisted,
    partialMounted,
    'Partial erase mounted and persisted geometry must match',
  );
  await artifacts.screenshot(page, 'eraser-partial-committed');

  // Full-object erase: the touched Pen must disappear from both mounted state
  // and the exact annotationsByPage_<pdfId> key.
  await activateEraser(page, { mode: 'entire', size: 24 });
  const deletedBox = await page.locator(selectorFor(deletedTarget.id)).boundingBox();
  assert(deletedBox, 'Full-erase Pen must be rendered before the gesture');
  const deletedPoints = crossingPoints(deletedBox);
  await touch.stroke([deletedPoints.start, deletedPoints.middle, deletedPoints.end]);
  await waitForAbsentObject(page, storageKeys.annotations, deletedTarget.id);
  assert(
    await mountedAnnotation(page, partialTarget.id),
    'Full-object gesture must not delete the separated partial-erase target',
  );
  await artifacts.screenshot(page, 'eraser-full-object-deleted');

  // Undo after erase: perform a second whole-object delete and demand one Undo
  // restore the exact pre-gesture object in mounted and persisted state.
  const undoBox = await page.locator(selectorFor(undoTarget.id)).boundingBox();
  assert(undoBox, 'Undo target must be rendered before the gesture');
  const undoPoints = crossingPoints(undoBox);
  await touch.stroke([undoPoints.start, undoPoints.middle, undoPoints.end]);
  await waitForAbsentObject(page, storageKeys.annotations, undoTarget.id);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  assert.equal(await undo.count(), 1, 'Exactly one Undo button must be available');
  assert.equal(await undo.isEnabled(), true, 'Undo must be enabled after full-object erase');
  await undo.click();
  const restoredMounted = await waitForMountedAnnotation(page, undoTarget.id);
  const restoredPersisted = await waitForPersistedAnnotation(
    page,
    storageKeys.annotations,
    undoTarget.id,
  );
  assert.deepEqual(restoredMounted, undoTarget.object, 'Undo must exactly restore mounted object');
  assertSameGeometry(
    restoredPersisted,
    undoTarget.persisted,
    'Undo must restore exact persisted geometry',
  );
  await artifacts.screenshot(page, 'eraser-undo-restored');

  // A single hard reload certifies all persisted outcomes together: partial
  // carve present, full-object deletion absent, and the undone object restored.
  await artifacts.time('eraser:hard-reload', async () => {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await openRealMobileViewer(page, null, { navigate: false });
  });
  const reloadPartial = await waitForMountedAnnotation(page, partialTarget.id);
  const reloadUndo = await waitForMountedAnnotation(page, undoTarget.id);
  const reloadSnapshot = await persistedSnapshot(page, storageKeys);
  const reloadPartialPersisted = findPersistedAnnotation(
    reloadSnapshot.annotations,
    partialTarget.id,
  );
  const reloadDeletedPersisted = findPersistedAnnotation(
    reloadSnapshot.annotations,
    deletedTarget.id,
  );
  const reloadUndoPersisted = findPersistedAnnotation(reloadSnapshot.annotations, undoTarget.id);
  assert(reloadPartialPersisted, 'Partial erase result must persist through hard reload');
  assert.equal(reloadDeletedPersisted, null, 'Full-object erase must remain absent after hard reload');
  assert(reloadUndoPersisted, 'Undone erase must remain restored after hard reload');
  assert.equal(
    await mountedAnnotation(page, deletedTarget.id),
    null,
    'Full-object erased ID must remain unmounted after hard reload',
  );
  assertSameGeometry(reloadPartial, partialPersisted, 'Reloaded partial geometry must be exact');
  assertSameGeometry(
    reloadPartialPersisted,
    partialPersisted,
    'Reloaded persisted partial geometry must be exact',
  );
  assertSameGeometry(reloadUndo, undoTarget.object, 'Reloaded Undo geometry must be exact');
  assertSameGeometry(
    reloadUndoPersisted,
    undoTarget.persisted,
    'Reloaded persisted Undo geometry must be exact',
  );
  await artifacts.screenshot(page, 'eraser-reloaded');

  artifacts.recordScenario({
    id: partialTarget.id,
    input: touch.inputKind,
    expectedPresent: true,
    geometry: annotationGeometry(reloadPartialPersisted),
    lifecycle: 'partial-mid-drag-reload',
    persistedType: reloadPartialPersisted.type,
    status: 'passed',
    tool: 'eraser',
  });
  artifacts.recordScenario({
    id: deletedTarget.id,
    input: touch.inputKind,
    expectedPresent: false,
    lifecycle: 'full-object-delete-reload',
    persistedType: null,
    status: 'passed',
    tool: 'eraser',
  });
  artifacts.recordScenario({
    id: undoTarget.id,
    input: touch.inputKind,
    expectedPresent: true,
    geometry: annotationGeometry(reloadUndoPersisted),
    lifecycle: 'full-object-delete-undo-reload',
    persistedType: reloadUndoPersisted.type,
    status: 'passed',
    tool: 'eraser',
  });

  return {
    deletedId: deletedTarget.id,
    partialId: partialTarget.id,
    restoredId: undoTarget.id,
  };
}
