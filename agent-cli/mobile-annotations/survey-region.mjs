import { openRealMobileViewer } from './viewer.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function waitForFirstVisible(locator, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = await firstVisible(locator);
    if (target) return target;
    await wait(100);
  }
  return null;
}

async function clickVisible(locator, label) {
  const target = await firstVisible(locator);
  invariant(target, `Expected visible ${label}`);
  await target.click();
  return target;
}

async function readJsonStorage(page, key) {
  return page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? null : JSON.parse(raw);
  }, key);
}

async function waitForStorage(page, key, predicate, label, timeoutMs = 10_000) {
  await page.waitForFunction(({ storageKey, predicateSource }) => {
    try {
      const raw = localStorage.getItem(storageKey);
      const value = raw === null ? null : JSON.parse(raw);
      // The predicates below are harness-owned, argument-free functions.
      return Function('value', `return (${predicateSource})(value)`)(value);
    } catch {
      return false;
    }
  }, { storageKey: key, predicateSource: String(predicate) }, { timeout: timeoutMs });
  const value = await readJsonStorage(page, key);
  invariant(predicate(value), `${label}: storage predicate failed after wait`);
  return value;
}

async function waitForMarkerRecord(page, key, id, predicate, label, timeoutMs = 10_000) {
  await page.waitForFunction(({ storageKey, markerId, predicateSource }) => {
    try {
      const markers = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return Function('marker', `return (${predicateSource})(marker)`)(markers?.[markerId]);
    } catch {
      return false;
    }
  }, { storageKey: key, markerId: id, predicateSource: String(predicate) }, { timeout: timeoutMs });
  const marker = markerById(await readJsonStorage(page, key), id);
  invariant(predicate(marker), `${label}: marker predicate failed after wait`);
  return marker;
}

async function waitForMarkerBoundsChange(page, key, id, before, timeoutMs = 10_000) {
  await page.waitForFunction(({ storageKey, markerId, previous }) => {
    const bounds = JSON.parse(localStorage.getItem(storageKey) || '{}')?.[markerId]?.bounds;
    if (!bounds) return false;
    return JSON.stringify({
      x: Number(bounds.x) || 0,
      y: Number(bounds.y) || 0,
      width: Number(bounds.width) || 0,
      height: Number(bounds.height) || 0,
      angle: Number(bounds.angle) || 0,
    }) !== previous;
  }, { storageKey: key, markerId: id, previous: before }, { timeout: timeoutMs });
  return markerById(await readJsonStorage(page, key), id);
}

const markerById = (markers, id) => markers?.[id] || null;
const spaceById = (sidebar, id) => sidebar?.spaces?.find((space) => space?.id === id) || null;
const boundsFingerprint = (marker) => marker?.bounds ? JSON.stringify({
  x: Number(marker.bounds.x) || 0,
  y: Number(marker.bounds.y) || 0,
  width: Number(marker.bounds.width) || 0,
  height: Number(marker.bounds.height) || 0,
  angle: Number(marker.bounds.angle) || 0,
}) : JSON.stringify(null);

async function collapseSurveySheet(page) {
  const collapse = await firstVisible(page.getByRole('button', { name: 'Collapse Survey panel' }));
  if (collapse) {
    await collapse.click();
    await collapse.waitFor({ state: 'hidden' });
  }
}

async function openSurveyCategory(page) {
  await clickVisible(page.getByRole('button', { name: 'Open survey' }), 'Open survey button');
  const chooser = page.getByRole('heading', { name: 'Choose survey template' });
  if (await chooser.isVisible().catch(() => false)) {
    await clickVisible(
      page.getByRole('button', { name: /KAL-436 Preservation Template/ }),
      'KAL-436 test template',
    );
  }
  const walls = await waitForFirstVisible(
    page.locator('button.survey-marker-category-main', { hasText: 'Walls' }),
    15_000,
  );
  invariant(walls, 'Survey test category Walls did not render');
  await walls.click();
  await collapseSurveySheet(page);
}

async function pageDrawingBox(page) {
  const layer = page.locator('[data-svg-annotation-layer="1"]').first();
  const box = invariant(await layer.boundingBox(), 'Mobile annotation layer has no bounds');
  const viewport = invariant(page.viewportSize(), 'Mobile viewport is unavailable');
  const top = Math.max(box.y + 16, 112);
  const bottom = Math.min(box.y + box.height - 16, viewport.height - 118);
  invariant(bottom - top > 80, `Mobile PDF drawing area is only ${bottom - top}px tall`);
  return { ...box, top, bottom };
}

async function newMarkerId(page, priorIds) {
  await page.waitForFunction((before) => (
    [...document.querySelectorAll('[data-survey-marker-id]')]
      .map((node) => node.getAttribute('data-survey-marker-id'))
      .some((id) => id && !before.includes(id))
  ), [...priorIds]);
  return page.locator('[data-survey-marker-id]').evaluateAll((nodes, before) => (
    nodes.map((node) => node.getAttribute('data-survey-marker-id'))
      .find((id) => id && !before.includes(id)) || null
  ), [...priorIds]);
}

async function markerHitBox(page, id) {
  const group = page.locator(`[data-survey-marker-id="${String(id).replace(/["\\]/g, '\\$&')}"]`);
  await group.waitFor({ state: 'visible', timeout: 10_000 });
  const hitRect = group.locator('[data-survey-marker-hit-target="true"]');
  return invariant(await hitRect.boundingBox(), `Survey Marker ${id} has no hit bounds`);
}

async function hardReload(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await openRealMobileViewer(page, null, { navigate: false });
}

/** Full Survey Marker lifecycle through the real mobile UI. */
export async function runSurveyMarkerLifecycle({
  page,
  touch,
  storageKeys,
  artifacts = null,
}) {
  invariant(storageKeys?.markers, 'Survey Marker lifecycle requires storageKeys.markers');
  const name = `Mobile marker ${Date.now().toString(36)}`;
  const renamed = `${name} edited`;

  await openSurveyCategory(page);
  const beforeIds = new Set(await page.locator('[data-survey-marker-id]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-survey-marker-id')).filter(Boolean)
  )));
  const box = await pageDrawingBox(page);
  await touch.drag(
    { x: box.x + box.width * 0.25, y: box.top + (box.bottom - box.top) * 0.25 },
    { x: box.x + box.width * 0.58, y: box.top + (box.bottom - box.top) * 0.48 },
    { steps: 12 },
  );
  // Mobile intentionally skips the desktop name modal: it auto-names,
  // persists immediately, opens marker detail, and returns to Pan.
  const id = invariant(await newMarkerId(page, beforeIds), 'Survey Marker create returned no stable id');
  let marker = await waitForMarkerRecord(
    page,
    storageKeys.markers,
    id,
    (value) => Boolean(value?.name),
    'Survey Marker create',
  );
  const defaultName = marker.name;
  const createdBounds = boundsFingerprint(marker);
  await artifacts?.screenshot?.(page, 'survey-marker-created');

  await hardReload(page);
  marker = await waitForMarkerRecord(
    page,
    storageKeys.markers,
    id,
    (value) => Boolean(value?.name),
    'Survey Marker create reload',
  );
  invariant(marker.name === defaultName, `Survey Marker ${id} changed name after hard reload`);

  // Mobile edit: trusted double-tap on the placed mark opens its detail sheet.
  // Re-selecting the fixture template hydrates its persisted marker overlay
  // after a hard reload; the marker row itself is not needed for editing.
  await clickVisible(page.getByRole('button', { name: 'Open survey' }), 'Open survey button');
  const chooser = page.getByRole('heading', { name: 'Choose survey template' });
  if (await chooser.isVisible().catch(() => false)) {
    await clickVisible(
      page.getByRole('button', { name: /KAL-436 Preservation Template/ }),
      'KAL-436 test template',
    );
  }
  await collapseSurveySheet(page);
  await clickVisible(page.getByRole('button', { name: 'Select', exact: true }), 'Select tool');
  const editHitBox = await markerHitBox(page, id);
  const editPoint = { x: editHitBox.x + editHitBox.width / 2, y: editHitBox.y + editHitBox.height / 2 };
  await touch.tap(editPoint);
  await touch.tap(editPoint);
  const renameInput = page.getByRole('textbox', { name: `Rename ${defaultName}` });
  await renameInput.waitFor({ state: 'visible', timeout: 10_000 });
  await renameInput.fill(renamed);
  await renameInput.press('Enter');
  marker = await waitForMarkerRecord(
    page,
    storageKeys.markers,
    id,
    (value) => value?.name?.endsWith(' edited'),
    'Survey Marker rename',
  );
  invariant(marker.name === renamed, `Survey Marker ${id} rename persisted to wrong record`);
  await collapseSurveySheet(page);

  // Move uses the real SVG hit target and trusted touch-generated pointer events.
  await clickVisible(page.getByRole('button', { name: 'Select', exact: true }), 'Select tool');
  let hitBox = await markerHitBox(page, id);
  let start = { x: hitBox.x + hitBox.width / 2, y: hitBox.y + hitBox.height / 2 };
  await touch.tap(start);
  // Selected = its rotation handle shows (owner 2026-10-01: no floating
  // Delete chip beside a selected Survey Marker any more).
  await page.locator('[data-rotation-handle]').first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  // Let the marker's 350ms double-tap window expire before beginning the
  // distinct move gesture; otherwise the next pointerdown opens edit again.
  await wait(400);
  // Selection chrome can repaint the hit rect. Re-measure immediately before
  // dragging, and allow one human-like retry if WebKit/Chromium consumes the
  // first touch while settling selection.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    hitBox = await markerHitBox(page, id);
    start = { x: hitBox.x + hitBox.width / 2, y: hitBox.y + hitBox.height / 2 };
    await touch.drag(
      start,
      { x: start.x + 24 + (attempt * 8), y: start.y + 18 + (attempt * 6) },
      { steps: 10 },
    );
    try {
      marker = await waitForMarkerBoundsChange(page, storageKeys.markers, id, createdBounds, 4_000);
      break;
    } catch (error) {
      if (attempt === 1) throw error;
      await touch.tap(start);
      await wait(400);
    }
  }
  const movedBounds = boundsFingerprint(marker);
  invariant(movedBounds !== createdBounds, `Survey Marker ${id} bounds did not change after trusted-touch move`);

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.waitFor({ state: 'visible' });
  // Persistence and the React history button are separate commit signals.
  // Under parallel browser load, marker storage can update one frame first.
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => (
    (button.getAttribute('aria-label') === 'Undo' || button.getAttribute('title') === 'Undo')
      && !button.disabled
      && button.getClientRects().length > 0
  )), null, { timeout: 10_000 });
  invariant(await undo.isEnabled(), 'Undo stayed disabled after Survey Marker move history commit');
  await undo.click();
  await page.waitForFunction(({ key, markerId, expected }) => {
    const current = JSON.parse(localStorage.getItem(key) || '{}')?.[markerId];
    const bounds = current?.bounds;
    const fingerprint = bounds ? JSON.stringify({
      x: Number(bounds.x) || 0,
      y: Number(bounds.y) || 0,
      width: Number(bounds.width) || 0,
      height: Number(bounds.height) || 0,
      angle: Number(bounds.angle) || 0,
    }) : JSON.stringify(null);
    return fingerprint === expected;
  }, { key: storageKeys.markers, markerId: id, expected: createdBounds });

  // Re-select after undo, then delete through the long-press menu - the
  // phone's touch path to Delete (owner 2026-10-01: a selected Survey Marker
  // shows no floating Delete chip). Wait out the marker's double-tap window
  // from the prior drag pointerdown; an immediate tap would open detail and
  // occlude the canvas.
  await wait(400);
  const deleteHitBox = await markerHitBox(page, id);
  const deletePoint = { x: deleteHitBox.x + deleteHitBox.width / 2, y: deleteHitBox.y + deleteHitBox.height / 2 };
  await touch.tap(deletePoint);
  await wait(400);
  await touch.longPress(deletePoint);
  const menu = page.locator('[data-annotation-context-menu]');
  const menuShown = await menu.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
  if (!menuShown) {
    await artifacts?.screenshot?.(page, 'survey-marker-longpress-no-menu');
    throw new Error('survey-marker: long-press on a selected marker opened no action menu');
  }
  const deleteAction = menu.getByText('Delete', { exact: true });
  invariant(await deleteAction.count() === 1, 'Survey Marker long-press menu has no Delete action');
  const deleteBox = invariant(await deleteAction.boundingBox(), 'Survey Marker Delete action has no bounds');
  invariant(deleteBox.height >= 32,
    `Survey Marker Delete action is ${deleteBox.width}x${deleteBox.height}; expected a finger-sized row`);
  await touch.tap({ x: deleteBox.x + deleteBox.width / 2, y: deleteBox.y + deleteBox.height / 2 });
  await page.waitForFunction(({ key, markerId }) => (
    !JSON.parse(localStorage.getItem(key) || '{}')?.[markerId]
  ), { key: storageKeys.markers, markerId: id });

  // Undo-delete must restore the same persisted record, then touch-delete it
  // again so reload proves the final deletion rather than the undo state.
  // WebKit can leave its native Paste callout open after the trusted-touch
  // selection gesture. Dismiss it before exercising the visible mobile Undo.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (
    [...document.querySelectorAll('button[aria-label="Undo"]')]
      .some((button) => !button.disabled)
  ));
  const visibleUndo = invariant(await firstVisible(undo), 'Visible Undo missing after Survey Marker touch delete');
  invariant(await visibleUndo.isEnabled(), 'Undo was disabled after Survey Marker touch delete');
  await tapLocator(touch, undo, 'Undo Survey Marker touch delete');
  marker = await waitForMarkerRecord(
    page,
    storageKeys.markers,
    id,
    (value) => value?.name?.endsWith(' edited'),
    'Survey Marker undo delete',
  );
  invariant(boundsFingerprint(marker) === createdBounds,
    `Survey Marker ${id} undo-delete restored the wrong bounds`);
  await hardReload(page);
  const markers = await readJsonStorage(page, storageKeys.markers);
  const reloadedMarker = invariant(markerById(markers, id), `Undo-restored Survey Marker ${id} missing after reload`);
  invariant(reloadedMarker.name === renamed, `Undo-restored Survey Marker ${id} lost its edited name after reload`);
  invariant(boundsFingerprint(reloadedMarker) === createdBounds,
    `Undo-restored Survey Marker ${id} lost its restored bounds after reload`);

  const result = {
    tool: 'survey-marker',
    status: 'passed',
    id,
    input: touch.inputKind,
    deleteInput: touch.inputKind,
    expectedPresent: true,
    storeKind: 'marker',
    lifecycle: 'create-edit-move-undo-delete-undo-delete-reload',
    createdBounds: JSON.parse(createdBounds),
    movedBounds: JSON.parse(movedBounds),
  };
  artifacts?.recordScenario?.(result);
  return result;
}

async function openSpaces(page) {
  await clickVisible(page.getByRole('button', { name: 'Open spaces' }), 'Open spaces button');
  await page.getByRole('heading', { name: 'Spaces' }).waitFor({ state: 'visible' });
}

async function tapLocator(touch, locator, label) {
  const target = invariant(await firstVisible(locator), `Expected visible ${label}`);
  const box = invariant(await target.boundingBox(), `${label} has no touch bounds`);
  await touch.tap({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  return target;
}

async function closeDocumentPanelWithTouch(page, touch) {
  const closePanel = await firstVisible(page.getByRole('button', { name: 'Close document panel' }));
  if (!closePanel) return;
  const closeBox = invariant(await closePanel.boundingBox(), 'Document panel backdrop has no bounds');
  await touch.tap({ x: closeBox.x + closeBox.width / 2, y: closeBox.y + Math.min(closeBox.height / 2, 120) });
  await page.getByRole('button', { name: 'Close document panel' }).waitFor({ state: 'hidden', timeout: 5_000 });
}

async function enterRegionEditor(page, touch, spaceId) {
  await openSpaces(page);
  const row = await expandSpaceRow(page, spaceId);
  await row.getByRole('button', { name: 'Edit region areas on the page' }).click();
  await page.getByRole('toolbar', { name: 'Region editing' }).waitFor({ state: 'visible' });
  await closeDocumentPanelWithTouch(page, touch);
}

async function expandSpaceRow(page, id) {
  const row = page.locator(`[data-space-sortable-row-id="${String(id).replace(/["\\]/g, '\\$&')}"]`);
  await row.waitFor({ state: 'visible' });
  if (!await row.getByPlaceholder('Add pages (e.g. 3, 6-9, 12)').isVisible().catch(() => false)) {
    await clickVisible(row.locator('button[title="Expand"]'), `Expand space ${id}`);
  }
  return row;
}

/** Create, rename, assign page 1, and reload-verify a Space through mobile UI. */
export async function runSpaceLifecycle({ page, touch, storageKeys, artifacts = null }) {
  invariant(storageKeys?.sidebar, 'Space lifecycle requires storageKeys.sidebar');
  invariant(touch, 'Space lifecycle requires the mobile touch driver');
  await openSpaces(page);
  const before = new Set(await page.locator('[data-space-sortable-row-id]').evaluateAll((rows) => (
    rows.map((row) => row.getAttribute('data-space-sortable-row-id')).filter(Boolean)
  )));
  await clickVisible(page.getByRole('button', { name: 'Create space' }), 'Create space button');
  await page.waitForFunction((prior) => (
    [...document.querySelectorAll('[data-space-sortable-row-id]')]
      .some((row) => !prior.includes(row.getAttribute('data-space-sortable-row-id')))
  ), [...before]);
  const id = invariant(await page.locator('[data-space-sortable-row-id]').evaluateAll((rows, prior) => (
    rows.map((row) => row.getAttribute('data-space-sortable-row-id'))
      .find((candidate) => candidate && !prior.includes(candidate)) || null
  ), [...before]), 'Space create returned no stable id');
  const name = `Mobile space ${Date.now().toString(36)}`;
  let row = page.locator(`[data-space-sortable-row-id="${String(id).replace(/["\\]/g, '\\$&')}"]`);
  const rename = row.locator('input.space-name-inline');
  await rename.fill(name);
  await rename.press('Enter');
  row = await expandSpaceRow(page, id);
  await row.getByPlaceholder('Add pages (e.g. 3, 6-9, 12)').fill('1');
  await row.getByRole('button', { name: 'Add pages' }).click();
  let sidebar = await waitForStorage(
    page,
    storageKeys.sidebar,
    (value) => value?.spaces?.some((space) => space?.name?.startsWith('Mobile space') && space?.assignedPages?.some((entry) => entry?.pageId === 1)),
    'Space rename/page assignment',
  );
  invariant(spaceById(sidebar, id)?.name === name, `Space ${id} rename did not persist`);
  await artifacts?.screenshot?.(page, 'space-created-assigned');

  await hardReload(page);
  sidebar = await readJsonStorage(page, storageKeys.sidebar);
  const persisted = invariant(spaceById(sidebar, id), `Space ${id} missing after hard reload`);
  invariant(persisted.name === name, `Space ${id} name changed after hard reload`);
  invariant(persisted.assignedPages?.some((entry) => entry?.pageId === 1), `Space ${id} page 1 missing after hard reload`);

  await openSpaces(page);
  const deleteRow = page.locator(`[data-space-sortable-row-id="${String(id).replace(/["\\]/g, '\\$&')}"]`);
  const dialogAccepted = new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      invariant(dialog.type() === 'confirm', `Space delete raised ${dialog.type()}, expected confirm`);
      await dialog.accept();
      resolve(true);
    });
  });
  await deleteRow.locator('button.space-card-delete-button').click();
  await dialogAccepted;
  await page.waitForFunction(({ key, targetSpaceId }) => (
    !JSON.parse(localStorage.getItem(key) || '{}')?.spaces?.some((space) => space?.id === targetSpaceId)
  ), { key: storageKeys.sidebar, targetSpaceId: id });
  await closeDocumentPanelWithTouch(page, touch);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Undo"]');
    return Boolean(button && !button.disabled);
  });
  await tapLocator(touch, undo, 'Undo Space delete');
  sidebar = await waitForStorage(
    page,
    storageKeys.sidebar,
    (value) => value?.spaces?.some((space) => space?.name?.startsWith('Mobile space') && space?.assignedPages?.some((entry) => entry?.pageId === 1)),
    'Undo Space delete',
  );
  invariant(spaceById(sidebar, id)?.name === name, `Undo restored wrong Space for ${id}`);
  await hardReload(page);
  sidebar = await readJsonStorage(page, storageKeys.sidebar);
  invariant(spaceById(sidebar, id)?.assignedPages?.some((entry) => entry?.pageId === 1), `Undo-restored Space ${id} failed reload`);
  const result = {
    tool: 'space',
    status: 'passed',
    id,
    name,
    createRenameAssignReload: true,
    deleteUndoReload: true,
  };
  artifacts?.recordScenario?.(result);
  return result;
}

/**
 * Trusted-touch Region lifecycle: draw, reload, Select/move, Undo/Redo,
 * persist/reload exact coordinates, Delete/undo-delete/redo-delete, reload.
 */
export async function runRegionLifecycle({ page, touch, storageKeys, spaceId, artifacts = null }) {
  invariant(spaceId, 'Region lifecycle requires a created spaceId');
  await enterRegionEditor(page, touch, spaceId);

  const canvas = page.locator('div[data-region-selection-ui="true"]').filter({ has: page.locator('svg') }).first();
  const canvasBox = invariant(await canvas.boundingBox(), 'Region interaction canvas has no bounds');
  const viewport = invariant(page.viewportSize(), 'Region viewport is unavailable');
  const visibleTop = Math.max(canvasBox.y + 20, 176);
  const visibleBottom = Math.min(canvasBox.y + canvasBox.height - 20, viewport.height - 120);
  invariant(visibleBottom - visibleTop > 80, `Region canvas has only ${visibleBottom - visibleTop}px visible`);
  const before = await readJsonStorage(page, storageKeys.sidebar);
  const beforePage = spaceById(before, spaceId)?.assignedPages?.find((entry) => entry?.pageId === 1);
  const beforeCount = beforePage?.regions?.length || 0;
  const previewBefore = await canvas.locator('svg path, svg rect').count();
  await page.evaluate(() => {
    window.__mobileRegionPointerProbe = [];
    const record = (event) => window.__mobileRegionPointerProbe.push({
      type: event.type,
      pointerType: event.pointerType,
      pointerId: event.pointerId,
      button: event.button,
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
      target: event.target?.tagName || null,
      className: typeof event.target?.className === 'string' ? event.target.className : null,
      ariaLabel: event.target?.getAttribute?.('aria-label') || null,
      text: String(event.target?.textContent || '').trim().slice(0, 60),
      targetRegionUi: Boolean(event.target?.closest?.('[data-region-selection-ui="true"]')),
    });
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((type) => (
      document.addEventListener(type, record, { capture: true, once: type !== 'pointermove' })
    ));
  });
  await touch.drag(
    { x: canvasBox.x + canvasBox.width * 0.25, y: visibleTop + (visibleBottom - visibleTop) * 0.2 },
    { x: canvasBox.x + canvasBox.width * 0.65, y: visibleTop + (visibleBottom - visibleTop) * 0.72 },
    { steps: 12 },
  );
  await wait(250);
  const previewAfter = await canvas.locator('svg path, svg rect').count();
  if (previewAfter <= previewBefore) {
    await artifacts?.screenshot?.(page, 'region-trusted-touch-no-draw');
    const bindings = await canvas.evaluate((node) => ({
      reactMouseDown: Object.keys(node).some((key) => key.startsWith('__reactProps') && Boolean(node[key]?.onMouseDown)),
      pointerDownAttribute: node.hasAttribute('onpointerdown'),
      touchStartAttribute: node.hasAttribute('ontouchstart'),
    }));
    const pointerProbe = await page.evaluate(() => window.__mobileRegionPointerProbe || []);
    throw new Error(
      `region: trusted touch produced no preview (${previewBefore}→${previewAfter}); `
      + `bindings=${JSON.stringify(bindings)} pointerProbe=${JSON.stringify(pointerProbe.slice(0, 8))}`,
    );
  }

  await tapLocator(
    touch,
    page.getByRole('toolbar', { name: 'Region editing' }).getByRole('button', { name: 'Confirm', exact: true }),
    'Region Confirm button',
  );
  const sidebar = await waitForStorage(
    page,
    storageKeys.sidebar,
    (value) => value?.spaces?.some((space) => space?.assignedPages?.some((entry) => (entry?.regions?.length || 0) > 0)),
    'Region draw persistence',
  );
  const pageEntry = spaceById(sidebar, spaceId)?.assignedPages?.find((entry) => entry?.pageId === 1);
  invariant((pageEntry?.regions?.length || 0) > beforeCount, 'Region draw did not add a persisted region');
  const regionId = invariant(pageEntry.regions[0]?.regionId, 'Persisted Region has no stable id');
  const createdCoordinates = JSON.stringify(pageEntry.regions[0].coordinates);
  await hardReload(page);
  const afterReload = await readJsonStorage(page, storageKeys.sidebar);
  invariant(
    (spaceById(afterReload, spaceId)?.assignedPages?.find((entry) => entry?.pageId === 1)?.regions?.length || 0) > beforeCount,
    'Region disappeared after hard reload',
  );

  // Re-enter, choose the new mobile Select mode, then move with trusted touch.
  await enterRegionEditor(page, touch, spaceId);
  await tapLocator(touch, page.getByRole('button', { name: 'Select region' }), 'Select region tool');
  const selectedPath = page.locator('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]').first();
  await selectedPath.waitFor({ state: 'visible', timeout: 5_000 });
  const originalPath = await selectedPath.getAttribute('d');
  const selectedBox = invariant(await selectedPath.boundingBox(), 'Selected Region has no touch bounds');
  const selectedCenter = { x: selectedBox.x + selectedBox.width / 2, y: selectedBox.y + selectedBox.height / 2 };
  await touch.drag(selectedCenter, { x: selectedCenter.x + 22, y: selectedCenter.y + 14 }, { steps: 10 });
  await page.waitForFunction((prior) => (
    document.querySelector('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]')?.getAttribute('d') !== prior
  ), originalPath);
  const movedPath = await selectedPath.getAttribute('d');

  // Header Undo is the real mobile control and must restore the pre-move path.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const visibleUndo = invariant(await firstVisible(undo), 'Visible Region Undo button missing');
  // The SVG path repaints during the drag before React publishes the matching
  // history entry. Wait for that separate commit signal instead of racing it.
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => (
    (button.getAttribute('aria-label') === 'Undo' || button.getAttribute('title') === 'Undo')
      && !button.disabled
      && button.getClientRects().length > 0
  )), null, { timeout: 5_000 });
  invariant(await visibleUndo.isEnabled(), 'Region Undo stayed disabled after touch move');
  await tapLocator(touch, undo, 'Region Undo button');
  await page.waitForFunction((expected) => (
    document.querySelector('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]')?.getAttribute('d') === expected
  ), originalPath);
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  const visibleRedo = invariant(await firstVisible(redo), 'Visible Region Redo button missing');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => (
    (button.getAttribute('aria-label') === 'Redo' || button.getAttribute('title') === 'Redo')
      && !button.disabled
      && button.getClientRects().length > 0
  )), null, { timeout: 5_000 });
  invariant(await visibleRedo.isEnabled(), 'Region Redo stayed disabled after Undo');
  await tapLocator(touch, redo, 'Region Redo button');
  await page.waitForFunction((expected) => (
    document.querySelector('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]')?.getAttribute('d') === expected
  ), movedPath);
  await tapLocator(touch, undo, 'Region second Undo button');
  await page.waitForFunction((expected) => (
    document.querySelector('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]')?.getAttribute('d') === expected
  ), originalPath);

  // Move again and commit so reload proves the transformed coordinates.
  const undoBox = invariant(await selectedPath.boundingBox(), 'Region lost bounds after Undo');
  const undoCenter = { x: undoBox.x + undoBox.width / 2, y: undoBox.y + undoBox.height / 2 };
  await touch.drag(undoCenter, { x: undoCenter.x + 26, y: undoCenter.y + 16 }, { steps: 10 });
  await page.waitForFunction((prior) => (
    document.querySelector('div[data-region-selection-ui="true"] svg path[stroke="#F5A623"]')?.getAttribute('d') !== prior
  ), originalPath);
  await tapLocator(
    touch,
    page.getByRole('toolbar', { name: 'Region editing' }).getByRole('button', { name: 'Confirm', exact: true }),
    'Region Confirm after move',
  );
  await page.waitForFunction(({ key, targetSpaceId, targetRegionId, priorCoordinates }) => {
    const sidebarValue = JSON.parse(localStorage.getItem(key) || '{}');
    const region = sidebarValue?.spaces?.find((space) => space?.id === targetSpaceId)
      ?.assignedPages?.find((entry) => entry?.pageId === 1)
      ?.regions?.find((candidate) => candidate?.regionId === targetRegionId);
    return region && JSON.stringify(region.coordinates) !== priorCoordinates;
  }, {
    key: storageKeys.sidebar,
    targetSpaceId: spaceId,
    targetRegionId: regionId,
    priorCoordinates: createdCoordinates,
  });
  const movedSidebar = await readJsonStorage(page, storageKeys.sidebar);
  const movedRegion = spaceById(movedSidebar, spaceId)?.assignedPages
    ?.find((entry) => entry?.pageId === 1)?.regions?.find((region) => region?.regionId === regionId);
  invariant(movedRegion, `Moved Region ${regionId} missing from storage`);
  invariant(JSON.stringify(movedRegion.coordinates) !== createdCoordinates, 'Region move coordinates did not persist');
  await hardReload(page);
  const movedReload = await readJsonStorage(page, storageKeys.sidebar);
  invariant(
    JSON.stringify(spaceById(movedReload, spaceId)?.assignedPages?.find((entry) => entry?.pageId === 1)
      ?.regions?.find((region) => region?.regionId === regionId)?.coordinates) === JSON.stringify(movedRegion.coordinates),
    'Moved Region coordinates changed after hard reload',
  );

  // Re-enter Select, delete via the new touch control, commit, and reload.
  await enterRegionEditor(page, touch, spaceId);
  await tapLocator(touch, page.getByRole('button', { name: 'Select region' }), 'Select region before delete');
  const deleteButton = page.getByRole('toolbar', { name: 'Region editing' })
    .getByRole('button', { name: 'Delete', exact: true });
  await deleteButton.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const toolbar = document.querySelector('[role="toolbar"][aria-label="Region editing"]');
    return [...(toolbar?.querySelectorAll('button') || [])]
      .some((button) => button.textContent?.trim() === 'Delete' && !button.disabled);
  });
  invariant(await deleteButton.isEnabled(), 'Region Delete stayed disabled after selecting a region');
  await tapLocator(touch, deleteButton, 'Region Delete button');
  await selectedPath.waitFor({ state: 'hidden', timeout: 5_000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Undo"]');
    return Boolean(button && !button.disabled);
  });
  invariant(await undo.isEnabled(), 'Region Undo stayed disabled after Delete');
  await tapLocator(touch, undo, 'Undo Region delete');
  await selectedPath.waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Redo"]');
    return Boolean(button && !button.disabled);
  });
  invariant(await redo.isEnabled(), 'Region Redo stayed disabled after undo-delete');
  await tapLocator(touch, redo, 'Redo Region delete');
  await selectedPath.waitFor({ state: 'hidden', timeout: 5_000 });
  await tapLocator(
    touch,
    page.getByRole('toolbar', { name: 'Region editing' }).getByRole('button', { name: 'Confirm', exact: true }),
    'Region Confirm after delete',
  );
  await page.waitForFunction(({ key, targetSpaceId, targetRegionId }) => {
    const sidebarValue = JSON.parse(localStorage.getItem(key) || '{}');
    const targetSpace = sidebarValue?.spaces?.find((space) => space?.id === targetSpaceId);
    const regions = targetSpace?.assignedPages?.find((entry) => entry?.pageId === 1)?.regions || [];
    return !regions.some((region) => region?.regionId === targetRegionId);
  }, { key: storageKeys.sidebar, targetSpaceId: spaceId, targetRegionId: regionId });
  await hardReload(page);
  const deletedReload = await readJsonStorage(page, storageKeys.sidebar);
  invariant(
    !spaceById(deletedReload, spaceId)?.assignedPages?.find((entry) => entry?.pageId === 1)
      ?.regions?.some((region) => region?.regionId === regionId),
    `Deleted Region ${regionId} returned after hard reload`,
  );
  const result = {
    tool: 'region',
    status: 'passed',
    spaceId,
    regionId,
    input: touch.inputKind,
    movedPathChanged: movedPath !== originalPath,
  };
  artifacts?.recordScenario?.(result);
  return result;
}

/** Integration seam for the main runner; no entrypoint edits are required here. */
export function surveyRegionScenarioRegistry() {
  return new Map([
    ['survey-marker', runSurveyMarkerLifecycle],
    ['space', runSpaceLifecycle],
    ['region', runRegionLifecycle],
  ]);
}
