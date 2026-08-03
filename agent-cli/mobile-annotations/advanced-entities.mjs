import assert from 'node:assert/strict';
import { openRealMobileViewer } from './viewer.mjs';
import { runSpaceLifecycle } from './survey-region.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeAttribute = (value) => String(value).replace(/["\\]/g, '\\$&');

function invariant(value, message) {
  if (!value) throw new Error(message);
  return value;
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function tapLocator(touch, locator, label) {
  const target = invariant(await firstVisible(locator), `Expected visible ${label}`);
  const box = invariant(await target.boundingBox(), `${label} has no touch bounds`);
  await touch.tap({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  return target;
}

async function exposedLocatorPoint(locator, label) {
  const target = invariant(await firstVisible(locator), `Expected visible ${label}`);
  const point = await target.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const fractions = [0.5, 0.2, 0.8, 0.35, 0.65];
    for (const yFraction of fractions) {
      for (const xFraction of fractions) {
        const x = rect.left + rect.width * xFraction;
        const y = rect.top + rect.height * yFraction;
        const hit = document.elementFromPoint(x, y);
        if (hit === node || node.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  invariant(point, `${label} has no exposed trusted-touch point`);
  return { point, target };
}

async function tapExposedLocator(touch, locator, label) {
  const { point, target } = await exposedLocatorPoint(locator, label);
  // A zero-distance trusted touch sequence preserves the exact hit-tested SVG
  // target. Chromium's convenience tap applies mobile target adjustment and
  // may redirect to a nearby PDF form widget layered over the marker.
  await touch.drag(point, point, { steps: 1 });
  return target;
}

async function readJson(page, key, fallback = null) {
  return page.evaluate(({ storageKey, fallbackValue }) => {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? fallbackValue : JSON.parse(raw);
  }, { storageKey: key, fallbackValue: fallback });
}

async function hardReload(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await openRealMobileViewer(page, null, { navigate: false });
}

async function history(page, touch, name) {
  const button = page.getByRole('button', { name, exact: true });
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await button.isEnabled(), true, `${name} must be enabled after transform`);
  await tapLocator(touch, button, name);
}

const markerProjection = (marker) => marker?.bounds ? {
  x: Number(marker.bounds.x) || 0,
  y: Number(marker.bounds.y) || 0,
  width: Number(marker.bounds.width) || 0,
  height: Number(marker.bounds.height) || 0,
  angle: Number(marker.bounds.angle) || 0,
} : null;

async function openSurveyCategory(page, touch) {
  await page.getByRole('button', { name: 'Open survey' }).click();
  const chooser = page.getByRole('heading', { name: 'Choose survey template' });
  if (await chooser.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  }
  await page.locator('button.survey-marker-category-main', { hasText: 'Walls' }).click();
  const collapse = await firstVisible(page.getByRole('button', { name: 'Collapse Survey panel' }));
  if (collapse) {
    await collapse.click();
    await collapse.waitFor({ state: 'hidden', timeout: 5_000 });
  }
  const backdrop = await firstVisible(page.getByRole('button', { name: 'Close Survey panel' }));
  if (backdrop) await backdrop.click({ position: { x: 4, y: 4 } });
}

async function markerRecord(page, key, id) {
  return (await readJson(page, key, {}))?.[id] || null;
}

async function waitMarkerProjection(page, key, id, expected, equality = true) {
  const expectedJson = JSON.stringify(expected);
  await page.waitForFunction(({ storageKey, markerId, target, equal }) => {
    const bounds = JSON.parse(localStorage.getItem(storageKey) || '{}')?.[markerId]?.bounds;
    if (!bounds) return false;
    const projection = JSON.stringify({
      x: Number(bounds.x) || 0,
      y: Number(bounds.y) || 0,
      width: Number(bounds.width) || 0,
      height: Number(bounds.height) || 0,
      angle: Number(bounds.angle) || 0,
    });
    return equal ? projection === target : projection !== target;
  }, { storageKey: key, markerId: id, target: expectedJson, equal: equality }, { timeout: 10_000 });
  return markerRecord(page, key, id);
}

async function selectMarker(page, touch, id) {
  const backdrop = await firstVisible(page.getByRole('button', { name: 'Close Survey panel' }));
  if (backdrop) {
    await backdrop.click({ force: true });
    await backdrop.waitFor({ state: 'hidden', timeout: 5_000 });
  }
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const hit = page.locator(`[data-survey-marker-id="${escapeAttribute(id)}"] [data-survey-marker-hit-target="true"]`);
  const selectedHandle = page.locator(
    `[data-survey-marker-id="${escapeAttribute(id)}"] .svg-selection-overlay [data-resize-handle="br"]`,
  );
  if (await firstVisible(selectedHandle)) {
    return hit;
  }
  await tapExposedLocator(touch, hit, `Survey Marker ${id}`);
  await delay(400);
  return hit;
}

async function hydrateSurveyMarkerOverlay(page, id) {
  await page.getByRole('button', { name: 'Open survey' }).click();
  const chooser = page.getByRole('heading', { name: 'Choose survey template' });
  if (await chooser.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  }
  const collapse = await firstVisible(page.getByRole('button', { name: 'Collapse Survey panel' }));
  if (collapse) await collapse.click();
  await page.locator(`[data-survey-marker-id="${escapeAttribute(id)}"]`)
    .waitFor({ state: 'visible', timeout: 10_000 });
}

async function markerFrameBox(page) {
  const frame = invariant(await firstVisible(page.locator('.svg-selection-overlay > rect')), 'Survey Marker selection frame missing');
  return invariant(await frame.boundingBox(), 'Survey Marker selection frame has no bounds');
}

export async function runSurveyMarkerAdvancedTransform({ page, touch, storageKeys, artifacts = null }) {
  await openSurveyCategory(page, touch);
  const beforeIds = new Set(await page.locator('[data-survey-marker-id]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-survey-marker-id')).filter(Boolean)
  )));
  const layer = page.locator('[data-svg-annotation-layer="1"]').first();
  const box = invariant(await layer.boundingBox(), 'Survey Marker layer has no bounds');
  const viewport = invariant(page.viewportSize(), 'Mobile viewport unavailable');
  const top = Math.max(box.y + 16, 112);
  const bottom = Math.min(box.y + box.height - 16, viewport.height - 118);
  await touch.drag(
    // Keep the marker and its above-shape rotation handle below this fixture's
    // interactive PDF form widgets. Trusted touch correctly targets those
    // widgets when geometry overlaps; this scenario needs blank page space.
    { x: box.x + box.width * 0.3, y: top + (bottom - top) * 0.58 },
    { x: box.x + box.width * 0.62, y: top + (bottom - top) * 0.76 },
    { steps: 12 },
  );
  await page.waitForFunction((prior) => (
    [...document.querySelectorAll('[data-survey-marker-id]')]
      .some((node) => !prior.includes(node.getAttribute('data-survey-marker-id')))
  ), [...beforeIds], { timeout: 10_000 });
  const id = invariant(await page.locator('[data-survey-marker-id]').evaluateAll((nodes, prior) => (
    nodes.map((node) => node.getAttribute('data-survey-marker-id'))
      .find((candidate) => candidate && !prior.includes(candidate)) || null
  ), [...beforeIds]), 'Survey Marker advanced create returned no id');
  await page.waitForFunction(({ key, markerId }) => Boolean(
    JSON.parse(localStorage.getItem(key) || '{}')?.[markerId]?.bounds,
  ), { key: storageKeys.markers, markerId: id }, { timeout: 10_000 });
  const initialMarker = await markerRecord(page, storageKeys.markers, id);
  const initial = invariant(markerProjection(initialMarker), 'Survey Marker initial bounds missing');

  await selectMarker(page, touch, id);
  await page.locator('.svg-selection-overlay [data-resize-handle="br"]')
    .waitFor({ state: 'visible', timeout: 10_000 }).catch(async () => {
      const diagnostic = await page.evaluate(() => ({
        overlays: [...document.querySelectorAll('.svg-selection-overlay')].map((node) => ({
          html: node.outerHTML.slice(0, 1600),
          rect: node.getBoundingClientRect().toJSON?.() || null,
        })),
        selectedAnnotationIds: window.__selectedAnnotationIds || null,
        selectedMarkerIds: [...document.querySelectorAll('[data-survey-marker-id]')].map((node) => node.getAttribute('data-survey-marker-id')),
      }));
      throw new Error(`Survey Marker resize chrome missing: ${JSON.stringify(diagnostic)}`);
    });
  const { point: resizeStart } = await exposedLocatorPoint(
    page.locator('.svg-selection-overlay [data-resize-handle="br"]'),
    'Survey Marker resize handle',
  );
  await touch.drag(resizeStart, { x: resizeStart.x + 30, y: resizeStart.y + 22 }, { steps: 12 });
  let marker = await waitMarkerProjection(page, storageKeys.markers, id, initial, false);
  const resized = markerProjection(marker);

  await history(page, touch, 'Undo');
  await waitMarkerProjection(page, storageKeys.markers, id, initial);
  await history(page, touch, 'Redo');
  await waitMarkerProjection(page, storageKeys.markers, id, resized);

  await selectMarker(page, touch, id);
  await page.locator('.svg-selection-overlay > rect').first().waitFor({ state: 'visible', timeout: 10_000 });
  const frame = await markerFrameBox(page);
  await page.locator('.svg-selection-overlay [data-rotation-handle="mtr"] circle')
    .waitFor({ state: 'visible', timeout: 10_000 });
  const rotate = invariant(await firstVisible(page.locator('.svg-selection-overlay [data-rotation-handle="mtr"] circle')),
    'Survey Marker rotation handle missing');
  const { point: rotateStart } = await exposedLocatorPoint(rotate, 'Survey Marker rotation handle');
  const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  await touch.drag(rotateStart, { x: center.x + 54, y: center.y }, { steps: 14 });
  marker = await waitMarkerProjection(page, storageKeys.markers, id, resized, false);
  const rotated = markerProjection(marker);
  assert(Math.abs(rotated.angle - resized.angle) > 0.1, 'Survey Marker rotation angle did not persist');

  await history(page, touch, 'Undo');
  await waitMarkerProjection(page, storageKeys.markers, id, resized);
  await history(page, touch, 'Redo');
  await waitMarkerProjection(page, storageKeys.markers, id, rotated);
  await hardReload(page);
  marker = await markerRecord(page, storageKeys.markers, id);
  assert.deepEqual(markerProjection(marker), rotated, 'Survey Marker resize+rotation changed after reload');
  await artifacts?.screenshot?.(page, 'survey-marker-advanced-transform');
  const result = {
    tool: 'survey-marker-advanced',
    baseTool: 'survey-marker',
    persistenceStore: 'markers',
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

async function openSpaces(page, touch) {
  await tapLocator(touch, page.getByRole('button', { name: 'Open spaces' }), 'Open spaces');
  await page.getByRole('heading', { name: 'Spaces' }).waitFor({ state: 'visible' });
}

async function enterRegionEditor(page, touch, spaceId) {
  await openSpaces(page, touch);
  const row = page.locator(`[data-space-sortable-row-id="${escapeAttribute(spaceId)}"]`);
  await row.waitFor({ state: 'visible', timeout: 10_000 });
  if (!await row.getByPlaceholder('Add pages (e.g. 3, 6-9, 12)').isVisible().catch(() => false)) {
    await tapLocator(touch, row.locator('button[title="Expand"]'), 'Expand Space');
  }
  await tapLocator(touch, row.getByRole('button', { name: 'Edit region areas on the page' }), 'Edit region areas');
  await page.getByRole('toolbar', { name: 'Region editing' }).waitFor({ state: 'visible' });
  const close = await firstVisible(page.getByRole('button', { name: 'Close document panel' }));
  if (close) {
    await tapLocator(touch, close, 'Close document panel');
    await close.waitFor({ state: 'hidden', timeout: 5_000 });
    // Closing the mobile document panel remounts the published viewer toolbar
    // API. Wait for the replacement Region controls instead of clicking the
    // stale pre-close button.
    await page.getByRole('toolbar', { name: 'Region editing' }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('.mobile-pdf-tools__subtools[aria-label="Region tools"] button[aria-label="Select region"]')
      .waitFor({ state: 'attached', timeout: 10_000 });
    await delay(300);
  }
}

function regionById(sidebar, spaceId, regionId) {
  return sidebar?.spaces?.find((space) => space?.id === spaceId)
    ?.assignedPages?.find((entry) => Number(entry?.pageId) === 1)
    ?.regions?.find((region) => region?.regionId === regionId) || null;
}

async function confirmRegion(page, touch) {
  await tapLocator(
    touch,
    page.getByRole('toolbar', { name: 'Region editing' }).getByRole('button', { name: 'Confirm', exact: true }),
    'Region Confirm',
  );
}

export async function runRegionAdvancedTransform({ page, touch, storageKeys, artifacts = null, spaceId = null }) {
  const space = spaceId ? { id: spaceId } : await runSpaceLifecycle({ page, touch, storageKeys, artifacts: null });
  await enterRegionEditor(page, touch, space.id);
  const canvas = page.locator('div[data-region-selection-ui="true"]').filter({ has: page.locator('svg') }).first();
  const canvasBox = invariant(await canvas.boundingBox(), 'Region canvas has no bounds');
  const viewport = invariant(page.viewportSize(), 'Mobile viewport unavailable');
  const top = Math.max(180, canvasBox.y + 20);
  const bottom = Math.min(viewport.height - 120, canvasBox.y + canvasBox.height - 20);
  const beforeSidebar = await readJson(page, storageKeys.sidebar, {});
  const beforeIds = new Set((beforeSidebar?.spaces?.find((entry) => entry?.id === space.id)
    ?.assignedPages?.find((entry) => Number(entry?.pageId) === 1)?.regions || []).map((region) => region.regionId));
  const previewBefore = await canvas.locator('svg path, svg rect').count();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await touch.drag(
      { x: canvasBox.x + canvasBox.width * (0.28 + attempt * 0.08), y: top + (bottom - top) * 0.22 },
      { x: canvasBox.x + canvasBox.width * (0.62 + attempt * 0.08), y: top + (bottom - top) * 0.62 },
      { steps: 12 },
    );
    await delay(250);
    if (await canvas.locator('svg path, svg rect').count() > previewBefore) break;
  }
  assert(await canvas.locator('svg path, svg rect').count() > previewBefore,
    'Region trusted-touch draw produced no preview');
  await confirmRegion(page, touch);
  await page.waitForFunction(({ key, targetSpaceId, priorIds }) => {
    const spaces = JSON.parse(localStorage.getItem(key) || '{}')?.spaces || [];
    const regions = spaces.find((space) => space?.id === targetSpaceId)
      ?.assignedPages?.find((entry) => Number(entry?.pageId) === 1)?.regions || [];
    return regions.some((region) => region?.regionId && !priorIds.includes(region.regionId));
  }, { key: storageKeys.sidebar, targetSpaceId: space.id, priorIds: [...beforeIds] });
  let sidebar = await readJson(page, storageKeys.sidebar, {});
  const created = sidebar.spaces.find((entry) => entry?.id === space.id)
    ?.assignedPages?.find((entry) => Number(entry?.pageId) === 1)?.regions
    ?.find((region) => region?.regionId && !beforeIds.has(region.regionId));
  const id = invariant(created?.regionId, 'Region advanced create returned no id');
  const initialCoordinates = JSON.stringify(created.coordinates);

  await hardReload(page);
  await enterRegionEditor(page, touch, space.id);
  const selectRegion = page.locator('.mobile-pdf-tools__subtools[aria-label="Region tools"] button[aria-label="Select region"]');
  await selectRegion.scrollIntoViewIfNeeded();
  await tapLocator(touch, selectRegion, 'Select region');
  await page.waitForFunction(() => document.querySelector(
    '.mobile-pdf-tools__subtools[aria-label="Region tools"] button[aria-label="Select region"]',
  )?.classList.contains('is-active'), null, { timeout: 5_000 }).catch(async () => {
    const diagnostic = await page.evaluate(() => ({
      activeElement: document.activeElement?.outerHTML?.slice(0, 500) || null,
      tools: [...document.querySelectorAll('.mobile-pdf-tools__subtools[aria-label="Region tools"] button')]
        .map((node) => ({
          label: node.getAttribute('aria-label'),
          className: node.className,
          disabled: node.disabled,
          rect: node.getBoundingClientRect().toJSON?.() || null,
        })),
      toolbar: document.querySelector('[role="toolbar"][aria-label="Region editing"]')?.outerHTML?.slice(0, 1000) || null,
    }));
    throw new Error(`Region select mode did not activate: ${JSON.stringify(diagnostic)}`);
  });
  await delay(250);
  if (!await firstVisible(page.locator('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]'))) {
    const candidates = page.locator('div[data-region-selection-ui="true"] svg path');
    const candidateCount = await candidates.count();
    for (let index = candidateCount - 1; index >= 0; index -= 1) {
      const candidate = candidates.nth(index);
      const box = await candidate.boundingBox();
      if (!box || box.width < 5 || box.height < 5) continue;
      await touch.tap({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      await delay(150);
      if (await firstVisible(page.locator('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]'))) break;
    }
  }
  await page.waitForFunction(() => (
    [...document.querySelectorAll('[data-region-vertex-handle], [data-region-resize-handle]')]
      .some((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
  ), null, { timeout: 10_000 }).catch(async () => {
    const diagnostic = await page.evaluate(() => ({
      handleCount: document.querySelectorAll('[data-region-vertex-handle], [data-region-resize-handle]').length,
      selectedPaths: document.querySelectorAll('svg path[stroke="#F5A623"]').length,
      regionUiCount: document.querySelectorAll('[data-region-selection-ui="true"]').length,
      selectedHtml: document.querySelector('svg path[stroke="#F5A623"]')?.parentElement?.outerHTML?.slice(0, 1200) || null,
    }));
    throw new Error(`Region resize handles missing: ${JSON.stringify(diagnostic)}`);
  });
  const vertex = invariant(await firstVisible(page.locator(
    '[data-region-vertex-handle="2"], [data-region-resize-handle="se"]',
  )), 'Region has no visible southeast resize/vertex handle');
  const selectedPath = page.locator('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]').first();
  const pathBeforeResize = await selectedPath.getAttribute('d');
  const { point: vertexStart } = await exposedLocatorPoint(vertex, 'Region resize vertex');
  await touch.drag(vertexStart, { x: vertexStart.x + 28, y: vertexStart.y + 22 }, { steps: 12 });
  await page.waitForFunction((before) => (
    document.querySelector('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]')?.getAttribute('d') !== before
  ), pathBeforeResize, { timeout: 10_000 });
  const resizedPath = await selectedPath.getAttribute('d');
  await history(page, touch, 'Undo');
  const undoPath = await selectedPath.getAttribute('d');
  assert.notEqual(resizedPath, undoPath, 'Region resize Undo did not restore path');
  await history(page, touch, 'Redo');
  await page.waitForFunction((expected) => (
    document.querySelector('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]')?.getAttribute('d') === expected
  ), resizedPath);

  const rotate = page.locator('[data-region-selection-ui="true"] [data-rotation-handle="mtr"] circle').first();
  await rotate.waitFor({ state: 'visible', timeout: 10_000 });
  const pathBox = invariant(await selectedPath.boundingBox(), 'Region selected path has no bounds');
  const { point: rotateStart } = await exposedLocatorPoint(rotate, 'Region rotation handle');
  const center = { x: pathBox.x + pathBox.width / 2, y: pathBox.y + pathBox.height / 2 };
  await touch.drag(rotateStart, { x: center.x + 54, y: center.y }, { steps: 14 });
  await page.waitForFunction((before) => (
    document.querySelector('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]')?.getAttribute('d') !== before
  ), resizedPath, { timeout: 10_000 });
  const rotatedPath = await selectedPath.getAttribute('d');
  assert.notEqual(rotatedPath, resizedPath, 'Region rotation did not change rendered path');
  await history(page, touch, 'Undo');
  await history(page, touch, 'Redo');
  await confirmRegion(page, touch);

  await page.waitForFunction(({ key, targetSpaceId, regionId, initial }) => {
    const sidebarValue = JSON.parse(localStorage.getItem(key) || '{}');
    const region = sidebarValue?.spaces?.find((space) => space?.id === targetSpaceId)
      ?.assignedPages?.find((entry) => Number(entry?.pageId) === 1)
      ?.regions?.find((candidate) => candidate?.regionId === regionId);
    return region && JSON.stringify(region.coordinates) !== initial && Math.abs(Number(region.rotation) || 0) > 0.1;
  }, { key: storageKeys.sidebar, targetSpaceId: space.id, regionId: id, initial: initialCoordinates });
  sidebar = await readJson(page, storageKeys.sidebar, {});
  const transformed = invariant(regionById(sidebar, space.id, id), 'Transformed Region missing from storage');
  // Regions intentionally have no independent name; the owning Space is the
  // named entity. Assert that contract instead of inventing a fake rename UI.
  assert.equal(Object.hasOwn(transformed, 'name'), false, 'Region unexpectedly gained an unsupported name field');
  await hardReload(page);
  sidebar = await readJson(page, storageKeys.sidebar, {});
  assert.deepEqual(regionById(sidebar, space.id, id), transformed, 'Region resize+rotation changed after reload');
  await artifacts?.screenshot?.(page, 'region-advanced-transform');
  const result = {
    tool: 'region-advanced',
    baseTool: 'region',
    persistenceStore: 'sidebar',
    id,
    spaceId: space.id,
    input: touch.inputKind,
    lifecycle: 'create-resize-undo-redo-rotate-undo-redo-confirm-reload',
    naming: 'not-supported-region-names-belong-to-space',
    resize: true,
    rotate: true,
    status: 'passed',
  };
  artifacts?.recordScenario?.(result);
  return result;
}
