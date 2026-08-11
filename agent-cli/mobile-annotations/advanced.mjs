import assert from 'node:assert/strict';
import {
  annotationGeometry,
  calloutGeometry,
  findPersistedAnnotation,
  persistedSnapshot,
  waitForPersistedAnnotation,
  waitForPersistedCallout,
} from './storage.mjs';
import {
  createAnnotation,
  openRealMobileViewer,
  waitForMountedAnnotation,
  waitForMountedCallout,
} from './viewer.mjs';

const STANDARD_TRANSFORM_TOOLS = Object.freeze([
  'pen',
  'highlighter',
  'line',
  'arrow',
  'rectangle',
  'ellipse',
  'text',
  'counter',
]);

export const ADVANCED_ANNOTATION_CAPABILITIES = Object.freeze([
  ...STANDARD_TRANSFORM_TOOLS.map((tool) => ({ tool, resize: true, rotate: true })),
  { tool: 'callout', resize: true, rotate: false, reason: 'Callouts expose textbox corners and leader handles; rotation is not a supported product operation.' },
  { tool: 'survey-marker', resize: true, rotate: true },
  { tool: 'region', resize: true, rotate: true, naming: false, reason: 'Regions belong to named Spaces and have no independent name field.' },
]);

export const ADVANCED_SURFACE_COVERAGE = Object.freeze({
  mobile390x844: {
    transforms: 'certified by trusted CDP touch with exact-key reload assertions',
    textReEdit: 'certified by the base lifecycle before advanced resize/rotation',
    calloutParts: 'textbox corner, arrow tip, and knee persisted after trusted-touch drags',
    counterSeries: 'stable series id/value asserted by the base lifecycle; series switching belongs to workflow harness',
    multiSelectCopyPasteZOrder: 'shared annotation commands; owned by full-app workflow harness, not duplicated here',
  },
  desktop: {
    reuse: 'SVGAnnotationLayer/useSVGInteraction transform and persistence code is shared with mobile',
    status: 'source-path reuse only in this module; desktop viewport certification belongs to the desktop full-app harness',
  },
});

const escapeAttribute = (value) => String(value).replace(/["\\]/g, '\\$&');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invariant(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function annotationTransformProjection(object) {
  return {
    ...annotationGeometry(object),
    pointerAngle: object?.data?.pointerAngle,
  };
}

function fingerprint(value) {
  return JSON.stringify(value);
}

function changed(before, after) {
  return fingerprint(before) !== fingerprint(after);
}

async function tapLocator(touch, locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  const box = invariant(await locator.boundingBox(), `${label} has no touch bounds`);
  await touch.tap({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function activateSelect(page, touch) {
  const button = page.getByRole('button', { name: 'Select', exact: true });
  assert.equal(await button.count(), 1, 'Exactly one Select tool must exist');
  await tapLocator(touch, button, 'Select tool');
}

function annotationGroup(page, id) {
  return page.locator(`g[data-anno-id="${escapeAttribute(id)}"]`);
}

async function annotationHitTarget(page, id, toolId) {
  const group = annotationGroup(page, id);
  const selector = {
    arrow: '[data-shape-hit-target="line"]',
    counter: '[data-shape-hit-target="counter"]',
    ellipse: '[data-shape-hit-target="ellipse"]',
    highlighter: '[data-path-hit-target="true"]',
    line: '[data-shape-hit-target="line"]',
    pen: '[data-path-hit-target="true"]',
    rectangle: '[data-shape-hit-target="rect"]',
    text: '[data-shape-hit-target="textbox"]',
  }[toolId];
  const target = selector ? group.locator(selector).first() : group;
  return await target.count() ? target : group;
}

async function selectAnnotation(page, touch, id, toolId) {
  await activateSelect(page, touch);
  const target = await annotationHitTarget(page, id, toolId);
  const box = invariant(await target.boundingBox(), `${toolId} ${id} has no touch bounds`);
  const point = toolId === 'rectangle'
    ? { x: box.x + box.width - 0.5, y: box.y + box.height * 0.25 }
    : toolId === 'ellipse'
      ? { x: box.x + box.width / 2, y: box.y + 3 }
      : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touch.tap(point);
  await page.waitForFunction(() => (
    [...document.querySelectorAll('.svg-selection-overlay, [data-callout-part^="textBox-"], [data-mobile-tool-properties="true"]')]
      .some((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
  ), null, { timeout: 10_000 });
  return target;
}

async function enterBboxMode(page, touch, id, toolId) {
  await selectAnnotation(page, touch, id, toolId);
  const enter = page.getByRole('button', { name: 'Resize and rotate', exact: true });
  assert.equal(await enter.count(), 1, `${toolId}: mobile Resize and rotate control must exist`);
  await tapLocator(touch, enter, `${toolId} Resize and rotate`);
  await page.locator('.svg-selection-overlay [data-resize-handle="br"]')
    .waitFor({ state: 'visible', timeout: 10_000 });
}

async function waitForAnnotationProjectionChange(page, key, id, before, timeoutMs = 10_000) {
  const beforeFingerprint = fingerprint(before);
  await page.waitForFunction(({ annotationId, expected, storageKey }) => {
    try {
      const pages = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const object = Object.values(pages).flatMap((entry) => entry?.objects || [])
        .find((candidate) => candidate?.id === annotationId || candidate?.data?.id === annotationId);
      if (!object) return false;
      const geometryFields = [
        'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
        'x1', 'y1', 'x2', 'y2', 'path', 'points', 'polygons',
      ];
      const projection = Object.fromEntries(geometryFields
        .filter((field) => object[field] !== undefined)
        .map((field) => [field, object[field]]));
      projection.pointerAngle = object?.data?.pointerAngle;
      return JSON.stringify(projection) !== expected;
    } catch {
      return false;
    }
  }, { annotationId: id, expected: beforeFingerprint, storageKey: key }, { timeout: timeoutMs });
  return waitForPersistedAnnotation(page, key, id, timeoutMs);
}

async function waitForExactAnnotationProjection(page, key, id, expected, timeoutMs = 10_000) {
  const expectedFingerprint = fingerprint(expected);
  await page.waitForFunction(({ annotationId, expectedValue, storageKey }) => {
    try {
      const pages = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const object = Object.values(pages).flatMap((entry) => entry?.objects || [])
        .find((candidate) => candidate?.id === annotationId || candidate?.data?.id === annotationId);
      if (!object) return false;
      const geometryFields = [
        'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
        'x1', 'y1', 'x2', 'y2', 'path', 'points', 'polygons',
      ];
      const projection = Object.fromEntries(geometryFields
        .filter((field) => object[field] !== undefined)
        .map((field) => [field, object[field]]));
      projection.pointerAngle = object?.data?.pointerAngle;
      return JSON.stringify(projection) === expectedValue;
    } catch {
      return false;
    }
  }, { annotationId: id, expectedValue: expectedFingerprint, storageKey: key }, { timeout: timeoutMs });
  return waitForPersistedAnnotation(page, key, id, timeoutMs);
}

async function history(page, touch, action) {
  const button = page.getByRole('button', { name: action, exact: true });
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  const handle = await button.elementHandle();
  invariant(handle, `${action} history control has no mounted element`);
  await page.waitForFunction((element) => (
    !element.disabled && element.getAttribute('aria-disabled') !== 'true'
  ), handle, { timeout: 10_000 });
  assert.equal(await button.isEnabled(), true, `${action} must be enabled after transform`);
  await tapLocator(touch, button, action);
}

async function selectionFrame(page) {
  const rect = invariant(await firstVisible(page.locator('.svg-selection-overlay > rect')),
    'No visible selection frame exists');
  return invariant(await rect.boundingBox(), 'Selection frame has no screen geometry');
}

async function dragResizeHandle(page, touch) {
  const handle = invariant(await firstVisible(page.locator('.svg-selection-overlay [data-resize-handle="br"]')),
    'No visible bottom-right resize handle exists');
  const box = invariant(await handle.boundingBox(), 'Bottom-right resize handle has no touch bounds');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touch.drag(start, { x: start.x + 28, y: start.y + 24 }, { steps: 12 });
}

async function dragRotationHandle(page, touch) {
  const frame = await selectionFrame(page);
  const handle = invariant(await firstVisible(page.locator('.svg-selection-overlay [data-rotation-handle="mtr"] circle')),
    'No visible rotation handle exists');
  const box = invariant(await handle.boundingBox(), 'Rotation handle has no touch bounds');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const viewport = invariant(page.viewportSize(), 'Mobile viewport unavailable');
  const radius = Math.max(42, Math.min(72, frame.width / 2 + 38));
  const end = {
    x: Math.min(viewport.width - 18, center.x + radius),
    y: Math.min(viewport.height - 110, Math.max(116, center.y)),
  };
  await touch.drag(start, end, { steps: 14 });
}

async function hardReload(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await openRealMobileViewer(page, null, { navigate: false });
}

async function createStandard(page, touch, toolId) {
  const beforeIds = new Set(await page.locator('g[data-anno-id]').evaluateAll((groups) => (
    groups.map((group) => group.getAttribute('data-anno-id')).filter(Boolean)
  )));
  const created = await createAnnotation(page, touch, toolId, beforeIds);
  invariant(created?.id, `${toolId}: advanced create returned no stable id`);
  await waitForMountedAnnotation(page, created.id);
  return created.id;
}

export async function runStandardAdvancedTransform({ page, touch, storageKeys, toolId, artifacts = null }) {
  assert(STANDARD_TRANSFORM_TOOLS.includes(toolId), `${toolId} is not a standard advanced-transform tool`);
  const id = await createStandard(page, touch, toolId);
  let object = await waitForPersistedAnnotation(page, storageKeys.annotations, id);
  const initial = annotationTransformProjection(object);

  if (['line', 'arrow', 'counter'].includes(toolId)) await enterBboxMode(page, touch, id, toolId);
  else await selectAnnotation(page, touch, id, toolId);

  await dragResizeHandle(page, touch);
  object = await waitForAnnotationProjectionChange(page, storageKeys.annotations, id, initial);
  const resized = annotationTransformProjection(object);
  assert(changed(initial, resized), `${toolId}: resize did not change persisted geometry`);

  await history(page, touch, 'Undo');
  await waitForExactAnnotationProjection(page, storageKeys.annotations, id, initial);
  await history(page, touch, 'Redo');
  await waitForExactAnnotationProjection(page, storageKeys.annotations, id, resized);

  // Undo/Redo can repaint selection chrome; select again before rotation.
  if (['line', 'arrow', 'counter'].includes(toolId)) await enterBboxMode(page, touch, id, toolId);
  else await selectAnnotation(page, touch, id, toolId);
  await dragRotationHandle(page, touch);
  object = await waitForAnnotationProjectionChange(page, storageKeys.annotations, id, resized);
  const rotated = annotationTransformProjection(object);
  assert(changed(resized, rotated), `${toolId}: rotation did not change persisted geometry`);

  await history(page, touch, 'Undo');
  await waitForExactAnnotationProjection(page, storageKeys.annotations, id, resized);
  await history(page, touch, 'Redo');
  await waitForExactAnnotationProjection(page, storageKeys.annotations, id, rotated);

  await hardReload(page);
  await waitForMountedAnnotation(page, id);
  const reloaded = await waitForPersistedAnnotation(page, storageKeys.annotations, id);
  assert.deepEqual(annotationTransformProjection(reloaded), rotated,
    `${toolId}: resize+rotation geometry changed after hard reload`);
  await artifacts?.screenshot?.(page, `${toolId}-advanced-transform`);

  const result = {
    tool: `${toolId}-advanced`,
    baseTool: toolId,
    id,
    input: touch.inputKind,
    lifecycle: 'create-resize-undo-redo-rotate-undo-redo-reload',
    resize: true,
    rotate: true,
    status: 'passed',
  };
  artifacts?.recordScenario?.(result);
  return result;
}

export async function runCalloutAdvancedTransform({ page, touch, storageKeys, artifacts = null }) {
  const beforeIds = new Set(await page.locator('[data-callout-id]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-callout-id')).filter(Boolean)
  )));
  const created = await createAnnotation(page, touch, 'callout', beforeIds);
  const id = invariant(created?.id, 'callout advanced create returned no stable id');
  await waitForMountedCallout(page, id);
  let callout = await waitForPersistedCallout(page, storageKeys.callouts, id);
  const initial = calloutGeometry(callout);

  await activateSelect(page, touch);
  const leader = page.locator(`[data-callout-id="${escapeAttribute(id)}"] [data-callout-part="line1"]`).first();
  await tapLocator(touch, leader, `callout ${id}`);
  const corner = page.locator(`[data-callout-id="${escapeAttribute(id)}"] [data-callout-part="textBox-br"]`).last();
  await corner.waitFor({ state: 'visible', timeout: 10_000 });
  const cornerBox = invariant(await corner.boundingBox(), 'Callout textbox resize handle has no touch bounds');
  const start = { x: cornerBox.x + cornerBox.width / 2, y: cornerBox.y + cornerBox.height / 2 };
  await touch.drag(start, { x: start.x + 26, y: start.y + 20 }, { steps: 12 });

  await page.waitForFunction(({ key, calloutId, expected }) => {
    const object = JSON.parse(localStorage.getItem(key) || '[]').find((entry) => entry?.id === calloutId);
    if (!object) return false;
    const projection = Object.fromEntries([
      'pageNumber', 'arrowTip', 'knee', 'textBoxPosition', 'textBoxWidth', 'textBoxHeight',
    ].filter((field) => object[field] !== undefined).map((field) => [field, object[field]]));
    return JSON.stringify(projection) !== expected;
  }, { key: storageKeys.callouts, calloutId: id, expected: fingerprint(initial) }, { timeout: 10_000 });
  callout = await waitForPersistedCallout(page, storageKeys.callouts, id);
  const resized = calloutGeometry(callout);
  assert(changed(initial, resized), 'callout: textbox resize did not change persisted geometry');

  await history(page, touch, 'Undo');
  await page.waitForFunction(({ key, calloutId, expected }) => {
    const object = JSON.parse(localStorage.getItem(key) || '[]').find((entry) => entry?.id === calloutId);
    if (!object) return false;
    const projection = Object.fromEntries([
      'pageNumber', 'arrowTip', 'knee', 'textBoxPosition', 'textBoxWidth', 'textBoxHeight',
    ].filter((field) => object[field] !== undefined).map((field) => [field, object[field]]));
    return JSON.stringify(projection) === expected;
  }, { key: storageKeys.callouts, calloutId: id, expected: fingerprint(initial) });
  await history(page, touch, 'Redo');
  await page.waitForFunction(({ key, calloutId, expected }) => {
    const object = JSON.parse(localStorage.getItem(key) || '[]').find((entry) => entry?.id === calloutId);
    if (!object) return false;
    const projection = Object.fromEntries([
      'pageNumber', 'arrowTip', 'knee', 'textBoxPosition', 'textBoxWidth', 'textBoxHeight',
    ].filter((field) => object[field] !== undefined).map((field) => [field, object[field]]));
    return JSON.stringify(projection) === expected;
  }, { key: storageKeys.callouts, calloutId: id, expected: fingerprint(resized) });

  let partBaseline = resized;
  for (const part of ['arrowTip', 'knee']) {
    await activateSelect(page, touch);
    const selectionTarget = page.locator(`[data-callout-id="${escapeAttribute(id)}"] [data-callout-part="line1"]`).first();
    await tapLocator(touch, selectionTarget, `callout ${id}`);
    const handle = page.locator(`[data-callout-id="${escapeAttribute(id)}"] [data-callout-part="${part}"]`).last();
    await handle.waitFor({ state: 'visible', timeout: 10_000 });
    const handleBox = invariant(await handle.boundingBox(), `Callout ${part} handle has no touch bounds`);
    const partStart = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
    const partEnd = part === 'arrowTip'
      ? { x: partStart.x + 14, y: partStart.y + 10 }
      : { x: partStart.x - 12, y: partStart.y + 12 };
    await touch.drag(partStart, partEnd, { steps: 10 });
    await page.waitForFunction(({ key, calloutId, expected }) => {
      const object = JSON.parse(localStorage.getItem(key) || '[]').find((entry) => entry?.id === calloutId);
      if (!object) return false;
      const projection = Object.fromEntries([
        'pageNumber', 'arrowTip', 'knee', 'textBoxPosition', 'textBoxWidth', 'textBoxHeight',
      ].filter((field) => object[field] !== undefined).map((field) => [field, object[field]]));
      return JSON.stringify(projection) !== expected;
    }, { key: storageKeys.callouts, calloutId: id, expected: fingerprint(partBaseline) }, { timeout: 10_000 });
    callout = await waitForPersistedCallout(page, storageKeys.callouts, id);
    partBaseline = calloutGeometry(callout);
  }

  await hardReload(page);
  await waitForMountedCallout(page, id);
  callout = await waitForPersistedCallout(page, storageKeys.callouts, id);
  assert.deepEqual(calloutGeometry(callout), partBaseline, 'callout: transformed parts changed after hard reload');
  await artifacts?.screenshot?.(page, 'callout-advanced-transform');
  const result = {
    tool: 'callout-advanced',
    baseTool: 'callout',
    id,
    input: touch.inputKind,
    lifecycle: 'create-textbox-resize-undo-redo-arrow-tip-move-knee-move-reload',
    resize: true,
    rotate: false,
    rotateReason: 'unsupported-by-product-design',
    status: 'passed',
  };
  artifacts?.recordScenario?.(result);
  return result;
}

export async function runAdvancedAnnotationSuite({ page, touch, storageKeys, artifacts = null, tools = STANDARD_TRANSFORM_TOOLS }) {
  const results = [];
  for (const toolId of tools.filter((tool) => tool !== 'callout')) {
    results.push(await runStandardAdvancedTransform({ page, touch, storageKeys, toolId, artifacts }));
  }
  if (!tools || tools.includes('callout') || tools === STANDARD_TRANSFORM_TOOLS) {
    results.push(await runCalloutAdvancedTransform({ page, touch, storageKeys, artifacts }));
  }
  return results;
}

export async function assertAdvancedFinalPersistence(page, storageKeys, results) {
  const snapshot = await persistedSnapshot(page, storageKeys);
  for (const result of results) {
    if (result.baseTool === 'callout') continue;
    if (result.persistenceStore === 'markers') {
      assert(snapshot.markers?.[result.id],
        `${result.tool}: final exact-key marker snapshot lost ${result.id}`);
      continue;
    }
    if (result.persistenceStore === 'sidebar') {
      const persistedRegion = snapshot.sidebar?.spaces
        ?.find((space) => space?.id === result.spaceId)
        ?.assignedPages?.flatMap((pageEntry) => pageEntry?.regions || [])
        ?.find((region) => region?.regionId === result.id);
      assert(persistedRegion,
        `${result.tool}: final exact-key sidebar snapshot lost ${result.id}`);
      continue;
    }
    assert(findPersistedAnnotation(snapshot.annotations, result.id),
      `${result.tool}: final exact-key snapshot lost ${result.id}`);
  }
}
