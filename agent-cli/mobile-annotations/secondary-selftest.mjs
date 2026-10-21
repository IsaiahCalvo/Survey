#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import { ArtifactRecorder } from './artifacts.mjs';
import { MOBILE_VIEWPORT } from './constants.mjs';
import { addExactStorageCleanup, exactStorageKeys, persistedSnapshot } from './storage.mjs';
import { createTouchDriver } from './touch.mjs';
import { ensureViteServer } from './vite-server.mjs';
import { createAnnotation, openRealMobileViewer } from './viewer.mjs';

const FIXTURE_NAME = 'text-search-glyph-lab.pdf';
const DEFAULT_ROUTE = `/?testPdf=${FIXTURE_NAME}&mobileNav=tabs&nativeShell=expo`;
const fixturePath = path.resolve('debug', 'fixtures', FIXTURE_NAME);
const pdfId = `${FIXTURE_NAME}-${fs.statSync(fixturePath).size}`;
const initialPageCount = (await PDFDocument.load(fs.readFileSync(fixturePath))).getPageCount();
const storageKeys = exactStorageKeys(pdfId);
const artifacts = new ArtifactRecorder('.playwright-mcp/mobile-secondary-viewer', {
  browser: 'chromium',
  fixture: FIXTURE_NAME,
  route: DEFAULT_ROUTE,
  viewport: MOBILE_VIEWPORT,
  coverage: ['multi-select clipboard/z-order', 'counter series', 'bookmarks CRUD', 'page operations', 'export/reimport'],
});

const annotationIds = async (page) => page.locator('g[data-anno-id]').evaluateAll((nodes) => (
  nodes.map((node) => node.getAttribute('data-anno-id')).filter(Boolean)
));

const GEOMETRY_FIELDS = [
  'left', 'top', 'width', 'height', 'rx', 'ry', 'scaleX', 'scaleY',
  'angle', 'flipX', 'flipY', 'skewX', 'skewY', 'originX', 'originY',
  'pathOffset', 'x1', 'y1', 'x2', 'y2', 'points', 'path', 'cmds', 'polygons',
  'text', 'lineEnding1', 'lineEnding2', 'arrowheadStyle',
];
const STYLE_FIELDS = [
  'fill', 'stroke', 'strokeWidth', 'strokeDashArray', 'strokeLineCap',
  'strokeLineJoin', 'strokeUniform', 'opacity', 'backgroundColor', 'fontSize',
  'fontFamily', 'fontWeight', 'fontStyle', 'textAlign', 'underline',
  'linethrough', 'lineHeight', 'charSpacing', 'fillRule',
  'globalCompositeOperation', 'rx', 'ry',
];

function pickDefined(source, fields) {
  return Object.fromEntries(fields
    .filter((field) => source?.[field] !== undefined)
    .map((field) => [field, source[field]]));
}

function canonicalAnnotationSnapshot(snapshot) {
  return Object.entries(snapshot.annotations || {})
    .sort(([left], [right]) => Number(left) - Number(right))
    .flatMap(([pageNumber, entry]) => (entry?.objects || []).map((object, zOrder) => {
      const data = object?.data || {};
      const isCounter = data.type === 'counter';
      return {
        id: object.id || data.id || object.annotationId || null,
        pageNumber: Number(pageNumber),
        zOrder,
        type: isCounter ? 'counter' : (data.type || object.tool || object.exportType || object.type || null),
        text: object.text ?? data.text ?? data.label ?? null,
        geometry: {
          ...pickDefined(object, GEOMETRY_FIELDS),
          ...(isCounter && object.radius !== undefined ? { radius: object.radius } : {}),
        },
        style: pickDefined(object, STYLE_FIELDS),
        counter: isCounter ? {
          displayNumber: data.displayNumber ?? data.number ?? null,
          seriesId: data.seriesId ?? null,
          seriesName: data.seriesName ?? null,
          seriesColor: data.seriesColor ?? object.fill ?? data.color ?? null,
          seriesStart: data.seriesStart ?? null,
          groupId: data.groupId ?? data.counterGroupId ?? null,
          sequence: data.sequence ?? data.displayNumber ?? data.number ?? null,
        } : null,
      };
    }));
}

async function reloadViewer(page, baseUrl) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openRealMobileViewer(page, baseUrl, { navigate: false });
}

async function openHubTab(page, name) {
  const opener = page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true });
  if (await opener.isVisible().catch(() => false)) await opener.click();
  // The hub's tabs are named by aria-label now (no title tooltip).
  await page.locator(`.mobile-pdf-hub-tab[aria-label="${name}"]`).click();
}

async function visiblePageContextAction(page, label) {
  // Page menu entries are role="menuitem" (PageActionsMenu).
  const candidates = page.getByRole('menuitem', { name: label, exact: true }).filter({ visible: true });
  const indexes = await candidates.evaluateAll((nodes) => nodes.flatMap((node, index) => (
    node.closest('[role="toolbar"][aria-label="Page actions"]') ? [] : [index]
  )));
  assert.equal(indexes.length, 1, `exactly one visible ${label} action must belong to the open page menu`);
  return candidates.nth(indexes[0]);
}

async function groupMenuPoint(page) {
  const group = page.locator('[data-group-selection-bbox="true"]');
  await group.waitFor({ state: 'visible', timeout: 10_000 });
  return group.evaluate((node) => {
    const box = node.getBoundingClientRect();
    // A hollow mark's inside is not in elementsFromPoint, but the app's hit
    // test still picks it (and opens that mark's own menu), so stay outside
    // every mark's box, not just its painted pixels.
    const marks = [...document.querySelectorAll('g[data-anno-id], [data-callout-id]')].map((m) => m.getBoundingClientRect());
    const inMark = (x, y) => marks.some((r) => x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8);
    for (let y = box.top + 4; y < box.bottom - 4; y += 6) {
      for (let x = box.left + 4; x < box.right - 4; x += 6) {
        const stack = document.elementsFromPoint(x, y);
        if (!inMark(x, y) && !stack.some((candidate) => candidate.closest?.('[data-anno-id], [data-callout-id]'))) return { x, y };
      }
    }
    return { x: box.left + 3, y: box.top + 3 };
  });
}

async function openGroupMenu(page, touch) {
  await touch.longPress(await groupMenuPoint(page));
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await menu.waitFor({ state: 'visible', timeout: 10_000 });
  return menu;
}

async function selectPairWithMarquee(page, touch, ids) {
  await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
  // The last mark drawn stays selected, and its finger-sized handle pads can
  // cover where the marquee starts, turning the drag into a resize. Tap blank
  // page first so the drag starts on bare SVG.
  const blank = await page.locator('[data-svg-annotation-layer="1"]').first().evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    for (let y = box.bottom - 20; y > box.top + 20; y -= 15) {
      for (let x = box.left + 20; x < box.right - 20; x += 15) {
        if (document.elementFromPoint(x, y) === svg) return { x, y };
      }
    }
    return null;
  });
  assert(blank, 'blank page point required to clear the selection');
  await touch.tap(blank);
  await page.locator('.svg-selection-overlay').first().waitFor({ state: 'detached', timeout: 10_000 });
  const boxes = [];
  for (const id of ids) {
    const box = await page.locator(`g[data-anno-id="${id}"]`).boundingBox();
    assert(box, `annotation ${id} must have screen geometry`);
    boxes.push(box);
  }
  const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  assert(pageBox, 'page geometry required');
  const left = Math.max(pageBox.x + 2, Math.min(...boxes.map((box) => box.x)) - 12);
  const top = Math.max(pageBox.y + 2, Math.min(...boxes.map((box) => box.y)) - 12);
  const right = Math.min(pageBox.x + pageBox.width - 2, Math.max(...boxes.map((box) => box.x + box.width)) + 12);
  const bottom = Math.min(pageBox.y + pageBox.height - 2, Math.max(...boxes.map((box) => box.y + box.height)) + 12);
  const drag = await page.locator('[data-svg-annotation-layer="1"]').evaluate((svg, bounds) => {
    const candidates = [
      { start: { x: bounds.left, y: bounds.top }, end: { x: bounds.right, y: bounds.bottom } },
      { start: { x: bounds.right, y: bounds.top }, end: { x: bounds.left, y: bounds.bottom } },
      { start: { x: bounds.right, y: bounds.bottom }, end: { x: bounds.left, y: bounds.top } },
      { start: { x: bounds.left, y: bounds.bottom }, end: { x: bounds.right, y: bounds.top } },
    ];
    return candidates.find(({ start }) => document.elementFromPoint(start.x, start.y) === svg) || null;
  }, { left, top, right, bottom });
  assert(drag, 'marquee must start on the empty SVG root, not an annotation');
  await touch.drag(drag.start, drag.end, { steps: 18 });
  const selected = page.locator('[data-group-selection-bbox="true"]');
  await selected.waitFor({ state: 'visible', timeout: 10_000 });
  const selectedIds = (await selected.getAttribute('data-group-selection-indices') || '').split(',').filter(Boolean);
  assert.equal(selectedIds.length, 2, 'marquee must select exactly two annotations');
}

async function runMultiSelectClipboardAndZOrder(page, touch, baseUrl) {
  const before = new Set(await annotationIds(page));
  const rectangle = await createAnnotation(page, touch, 'rectangle', before);
  before.add(rectangle.id);
  const ellipse = await createAnnotation(page, touch, 'ellipse', before);
  await selectPairWithMarquee(page, touch, [rectangle.id, ellipse.id]);

  let menu = await openGroupMenu(page, touch);
  await menu.getByText('Copy', { exact: true }).click();
  const prePasteIds = new Set(await annotationIds(page));
  menu = await openGroupMenu(page, touch);
  await menu.getByText('Paste', { exact: true }).click();
  await page.waitForFunction((count) => document.querySelectorAll('g[data-anno-id]').length === count + 2, prePasteIds.size);
  const afterCopyPaste = await annotationIds(page);
  const pastedIds = afterCopyPaste.filter((id) => !prePasteIds.has(id));
  assert.equal(pastedIds.length, 2, 'group paste must create two new annotations');

  // A paste selects what it created (w53), so the group menu now acts on the
  // pasted pair, which lands on top. Send it to the back first so every
  // reorder below actually moves it.
  const subject = pastedIds;
  menu = await openGroupMenu(page, touch);
  await menu.getByText('Send to back', { exact: true }).click();
  let snapshot = await persistedSnapshot(page, storageKeys);
  let order = snapshot.annotationObjects.map((object) => object.id || object.data?.id);
  assert.deepEqual(order.slice(0, 2), subject, 'group Send to back must move the selected pair below the originals');

  menu = await openGroupMenu(page, touch);
  await menu.getByText('Bring forward', { exact: true }).click();
  snapshot = await persistedSnapshot(page, storageKeys);
  order = snapshot.annotationObjects.map((object) => object.id || object.data?.id);
  assert.notDeepEqual(order.slice(0, 2), subject, 'group Bring forward must move the selection up one layer');

  menu = await openGroupMenu(page, touch);
  await menu.getByText('Bring to front', { exact: true }).click();
  snapshot = await persistedSnapshot(page, storageKeys);
  order = snapshot.annotationObjects.map((object) => object.id || object.data?.id);
  assert.deepEqual(order.slice(-2), subject, 'group Bring to front must move the selected pair above the originals');

  menu = await openGroupMenu(page, touch);
  await menu.getByText('Send backward', { exact: true }).click();
  snapshot = await persistedSnapshot(page, storageKeys);
  order = snapshot.annotationObjects.map((object) => object.id || object.data?.id);
  assert(!order.slice(-2).includes(subject[0]), 'group Send backward must move the selection down one layer');

  menu = await openGroupMenu(page, touch);
  await menu.getByText('Cut', { exact: true }).click();
  await page.waitForFunction((ids) => ids.every((id) => !document.querySelector(`g[data-anno-id="${id}"]`)), subject);

  // Paste the cut group from an empty point inside the page.
  const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  await touch.longPress({ x: pageBox.x + 18, y: pageBox.y + 28 });
  menu = page.locator('[data-annotation-context-menu="true"]');
  await menu.waitFor({ state: 'visible', timeout: 10_000 });
  await menu.getByText('Paste', { exact: true }).click();
  await page.waitForFunction((count) => document.querySelectorAll('g[data-anno-id]').length === count, prePasteIds.size + 2);

  snapshot = await persistedSnapshot(page, storageKeys);
  assert.equal(snapshot.annotationObjects.length, prePasteIds.size + 2, 'cut then paste must restore the group');
  const stableIds = snapshot.annotationObjects.map((object) => object.id || object.data?.id);
  await reloadViewer(page, baseUrl);
  const reloaded = await persistedSnapshot(page, storageKeys);
  assert.deepEqual(reloaded.annotationObjects.map((object) => object.id || object.data?.id), stableIds, 'clipboard/z-order result must persist after reload');
  return { created: [rectangle.id, ellipse.id], persistedCount: stableIds.length };
}

async function expectText(locator, text) {
  await locator.filter({ hasText: text }).waitFor({ state: 'visible', timeout: 10_000 });
}

async function runCounterSeries(page, touch, baseUrl) {
  const createCounterAt = async (prior, xFraction, yFraction) => {
    let counter = page.locator('.mobile-pdf-tools__subtools').getByRole('button', { name: 'Counter', exact: true });
    if (await counter.count() === 0) {
      await page.getByRole('button', { name: 'Shapes', exact: true }).click();
      counter = page.locator('.mobile-pdf-tools__subtools').getByRole('button', { name: 'Counter', exact: true });
    }
    if (!await counter.evaluate((button) => button.classList.contains('is-active'))) {
      await counter.click();
    }
    const overlay = page.locator('[data-counter-overlay="1"]');
    await overlay.waitFor({ state: 'visible', timeout: 10_000 });
    const start = await overlay.evaluate((node, preferred) => {
      const box = node.getBoundingClientRect();
      const fractions = [preferred, [0.82, 0.56], [0.18, 0.55], [0.82, 0.76], [0.18, 0.76], [0.5, 0.82], [0.5, 0.18]];
      for (const [xFraction, yFraction] of fractions) {
        const point = { x: box.left + box.width * xFraction, y: box.top + box.height * yFraction };
        if (document.elementFromPoint(point.x, point.y) === node) return point;
      }
      return null;
    }, [xFraction, yFraction]);
    assert(start, 'counter placement needs an unobstructed point on the real creation overlay');
    await touch.drag(
      start,
      { x: start.x + 3, y: start.y + 3 },
      { steps: 5 },
    );
    const id = await page.waitForFunction((ids) => {
      const priorIds = new Set(ids);
      return [...document.querySelectorAll('g[data-anno-id]')]
        .map((node) => node.getAttribute('data-anno-id'))
        .find((candidate) => candidate && !priorIds.has(candidate)) || null;
    }, [...prior]).then((handle) => handle.jsonValue());
    await page.waitForTimeout(250);
    return { id };
  };
  const before = new Set(await annotationIds(page));
  const first = await createCounterAt(before, 0.3, 0.28);
  before.add(first.id);
  // Count picker (#837): the strip's "Counter series" pill opens the Counts
  // menu - New count, or Continue an existing count.
  const seriesPill = page.locator('[data-mobile-tool-properties="true"]').getByRole('button', { name: 'Counter series', exact: true });
  await expectText(seriesPill, 'Count 1');
  await seriesPill.click();
  await page.getByRole('button', { name: 'New count', exact: true }).click();
  const second = await createCounterAt(before, 0.34, 0.68);
  before.add(second.id);
  await expectText(seriesPill, 'Count 2');
  await seriesPill.click();
  await page.locator('.counter-series-menu').getByRole('button', { name: /^Continue Count 1,/ }).click();
  const third = await createCounterAt(before, 0.7, 0.7);
  const ids = [first.id, second.id, third.id];
  const snapshot = await persistedSnapshot(page, storageKeys);
  const counters = ids.map((id) => snapshot.annotationObjects.find((object) => (object.id || object.data?.id) === id));
  assert(counters.every(Boolean), 'all counter objects must persist');
  assert.notEqual(counters[1].data.seriesId, counters[0].data.seriesId, 'New Count must create a distinct series');
  assert.equal(counters[2].data.seriesId, counters[0].data.seriesId, 'switching to Count 1 must reuse first series');
  assert.deepEqual([counters[0], counters[2]].map((counter) => counter.data.displayNumber), [1, 2]);
  assert.equal(counters[1].data.displayNumber, 1);
  await reloadViewer(page, baseUrl);
  const reloaded = await persistedSnapshot(page, storageKeys);
  for (const counter of counters) {
    const id = counter.id || counter.data?.id;
    assert(reloaded.annotationObjects.some((object) => (object.id || object.data?.id) === id && object.data.seriesId === counter.data.seriesId));
  }
  return { ids, series: [...new Set(counters.map((counter) => counter.data.seriesId))] };
}

async function runBookmarksAndPages(page, baseUrl) {
  await openHubTab(page, 'Bookmarks');
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await page.getByRole('textbox', { name: 'Bookmark name', exact: true }).fill('Field entrance');
  await page.getByRole('spinbutton', { name: 'Bookmark page', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  // RULED 2026-09-23 (owner: phone bookmarks match desktop) — a row's rename
  // and delete glyphs show in Edit mode only, as on desktop, so enter it first.
  await page.getByRole('button', { name: 'Edit bookmarks', exact: true }).click();
  await page.getByRole('button', { name: 'Edit bookmark Field entrance', exact: true }).click();
  await page.getByRole('textbox', { name: 'Bookmark name', exact: true }).fill('Main entrance');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  let snapshot = await persistedSnapshot(page, storageKeys);
  assert.equal(snapshot.sidebar.bookmarks.length, 1);
  assert.equal(snapshot.sidebar.bookmarks[0].name, 'Main entrance');

  await page.getByRole('button', { name: 'Edit bookmark Main entrance', exact: true }).click();
  await page.getByRole('textbox', { name: 'Bookmark name', exact: true }).fill('Must not commit');
  await page.getByRole('spinbutton', { name: 'Bookmark page', exact: true }).fill(String(initialPageCount + 1));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'visible' });
  snapshot = await persistedSnapshot(page, storageKeys);
  assert.equal(snapshot.sidebar.bookmarks[0].name, 'Main entrance', 'invalid combined edit must not commit the name');
  assert.deepEqual(snapshot.sidebar.bookmarks[0].pageIds, [1], 'invalid combined edit must not commit the page');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('input[aria-label="Bookmark name"]').waitFor({ state: 'detached', timeout: 10_000 });

  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await page.getByRole('textbox', { name: 'Bookmark name', exact: true }).fill('Roof');
  await page.getByRole('spinbutton', { name: 'Bookmark page', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Edit bookmark Main entrance', exact: true }).click();
  await page.getByRole('textbox', { name: 'Bookmark name', exact: true }).fill('Roof');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'visible' });
  snapshot = await persistedSnapshot(page, storageKeys);
  assert.deepEqual(snapshot.sidebar.bookmarks.map(({ name, pageIds }) => ({ name, pageIds })), [
    { name: 'Main entrance', pageIds: [1] },
    { name: 'Roof', pageIds: [1] },
  ], 'conflicting combined edit must leave name and page unchanged');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.locator('.mobile-pdf-hub-tab[aria-label="Pages"]').click();
  await page.getByRole('toolbar', { name: 'Page actions' }).getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('.mobile-page-card').length === count,
    initialPageCount + 1,
  );
  await page.getByRole('button', { name: 'Page 2 actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rotate right', exact: true }).click();
  await page.getByRole('button', { name: 'Page 2 actions', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  snapshot = await persistedSnapshot(page, storageKeys);
  assert.deepEqual(snapshot.sidebar.pageTransformations, {}, 'physical rotation must not leave a second CSS rotation');

  // Physical move: both bookmarks belong to the original page 1, so moving
  // that page down must move both durable associations to page 2.
  await page.getByRole('button', { name: 'Page 1 actions', exact: true }).click();
  // Phone page menu (compact): Move up/down live behind More.
  await page.getByRole('menuitem', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move down', exact: true }).click();
  await page.waitForFunction((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}')?.bookmarks
        ?.every((bookmark) => bookmark.pageIds?.length === 1 && bookmark.pageIds[0] === 2);
    } catch { return false; }
  }, storageKeys.sidebar);

  // Page copy/paste clones page-addressed metadata and increases the real PDF
  // page count. Copy page 2 and paste it after page 1: the original shifts to
  // page 3 and the clone occupies page 2, so both bookmark targets survive.
  await page.getByRole('button', { name: 'Page 2 actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Page 1 actions', exact: true }).click();
  await (await visiblePageContextAction(page, 'Paste below')).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('.mobile-page-card').length === count,
    initialPageCount + 2,
  );
  await page.waitForFunction((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}')?.bookmarks
        ?.every((bookmark) => JSON.stringify(bookmark.pageIds) === '[2,3]');
    } catch { return false; }
  }, storageKeys.sidebar);

  // Cut/paste moves identity rather than cloning it and consumes the clipboard.
  await page.getByRole('button', { name: 'Page 3 actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Cut', exact: true }).click();
  await page.getByRole('button', { name: 'Page 1 actions', exact: true }).click();
  await (await visiblePageContextAction(page, 'Paste below')).click();
  await page.waitForFunction(() => !document.querySelector('.mobile-page-clipboard-badge'));
  await page.waitForFunction(
    (count) => document.querySelectorAll('.mobile-page-card').length === count,
    initialPageCount + 2,
  );

  await page.getByRole('button', { name: 'Page 3 actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  // The app's own confirm dialog (useConfirmDialog), not window.confirm.
  await page.getByRole('button', { name: 'Delete page', exact: true }).click();
  await page.waitForFunction((count) => document.querySelectorAll('.mobile-page-card').length === count, initialPageCount + 1);
  await page.getByRole('button', { name: 'Page 1 actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  // The app's own confirm dialog (useConfirmDialog), not window.confirm.
  await page.getByRole('button', { name: 'Delete page', exact: true }).click();
  await page.waitForFunction((count) => document.querySelectorAll('.mobile-page-card').length === count, initialPageCount);
  snapshot = await persistedSnapshot(page, storageKeys);
  assert(snapshot.sidebar.bookmarks.every((bookmark) => JSON.stringify(bookmark.pageIds) === '[1]'));

  await page.locator('.mobile-pdf-hub-tab[aria-label="Bookmarks"]').click();
  // RULED 2026-09-23 (owner: phone bookmarks match desktop) — delete lives in
  // Edit mode. The panel's draft (edit mode included) now survives the tab
  // switch, so enter Edit only if it is not still on.
  const doneEditing = page.getByRole('button', { name: 'Done editing bookmarks', exact: true });
  await page.getByRole('button', { name: /^(Edit bookmarks|Done editing bookmarks)$/ }).first().waitFor({ state: 'visible', timeout: 10_000 });
  if (!await doneEditing.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Edit bookmarks', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Delete bookmark Main entrance', exact: true }).click();
  await page.getByRole('button', { name: 'Delete bookmark Roof', exact: true }).click();
  await page.getByText('No bookmarks yet', { exact: true }).waitFor();
  snapshot = await persistedSnapshot(page, storageKeys);
  assert.deepEqual(snapshot.sidebar.bookmarks, []);
  // Owner 2026-09-30: phone sheets have no close X; a tap outside closes them.
  await page.getByRole('button', { name: 'Close document panel', exact: true }).click({ position: { x: 195, y: 150 } });
  await reloadViewer(page, baseUrl);
  const reloaded = await persistedSnapshot(page, storageKeys);
  assert.deepEqual(reloaded.sidebar.bookmarks, []);
  assert.equal(await page.locator('.survey-pdfjs-page-div').count(), initialPageCount);
  return {
    bookmarkCrud: true,
    pageOperations: ['insert', 'rotate', 'move', 'copy-paste', 'cut-paste', 'delete'],
    finalPageCount: initialPageCount,
  };
}

async function runExportReimport(page, context, baseUrl) {
  const sourceSnapshot = await persistedSnapshot(page, storageKeys);
  const sourceAnnotations = canonicalAnnotationSnapshot(sourceSnapshot);
  assert(sourceAnnotations.length > 0, 'source PDF must contain annotations before export');
  const more = page.getByRole('button', { name: 'More document options', exact: true });
  await more.click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).click();
  const download = await downloadPromise;
  const exportPath = path.join(artifacts.dir, 'annotated-export.pdf');
  await download.saveAs(exportPath);
  const bytes = fs.readFileSync(exportPath);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), initialPageCount, 'exported PDF must retain final page count');

  const exportName = 'secondary-reimport.pdf';
  await context.route(`**/debug-fixtures/${exportName}`, (route) => route.fulfill({
    body: bytes,
    contentType: 'application/pdf',
    status: 200,
  }));
  const exportKeys = exactStorageKeys(`${exportName}-${bytes.length}`);
  await page.evaluate((keys) => Object.values(keys).forEach((key) => localStorage.removeItem(key)), exportKeys);
  await page.goto(`${baseUrl}/?testPdf=${exportName}&mobileNav=tabs&nativeShell=expo`, { waitUntil: 'domcontentloaded' });
  await openRealMobileViewer(page, baseUrl, { navigate: false });
  await page.waitForFunction((count) => document.querySelectorAll('g[data-anno-id]').length === count, sourceAnnotations.length, { timeout: 30_000 });
  const imported = await persistedSnapshot(page, exportKeys);
  const importedAnnotations = canonicalAnnotationSnapshot(imported);
  assert.equal(importedAnnotations.length, sourceAnnotations.length, 'reimport annotation count must exactly match source');
  assert.deepEqual(importedAnnotations, sourceAnnotations, 'reimport must preserve type, text, geometry/style, page, counter series, and z-order');
  return {
    bytes: bytes.length,
    sourceAnnotations: sourceAnnotations.length,
    importedAnnotations: importedAnnotations.length,
    parity: 'exact',
    path: exportPath,
  };
}

let browser;
let managedProcess;
let page;
try {
  const server = await ensureViteServer(null);
  managedProcess = server.managedProcess;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    locale: 'en-US',
    screen: MOBILE_VIEWPORT,
    viewport: MOBILE_VIEWPORT,
  });
  await addExactStorageCleanup(context, storageKeys, artifacts.runId);
  page = await context.newPage();
  artifacts.captureBrowserProblems(page);
  await page.goto(`${server.baseUrl}${DEFAULT_ROUTE}`, { waitUntil: 'domcontentloaded' });
  await openRealMobileViewer(page, server.baseUrl, { navigate: false });
  const touch = await createTouchDriver({ browserName: 'chromium', context, page });
  const results = [];
  results.push(await artifacts.time('multi-select-clipboard-z-order', () => runMultiSelectClipboardAndZOrder(page, touch, server.baseUrl)));
  results.push(await artifacts.time('counter-series', () => runCounterSeries(page, touch, server.baseUrl)));
  results.push(await artifacts.time('bookmarks-pages', () => runBookmarksAndPages(page, server.baseUrl)));
  results.push(await artifacts.time('export-reimport', () => runExportReimport(page, context, server.baseUrl)));
  results.forEach((result) => artifacts.recordScenario(result));
  await artifacts.screenshot(page, 'reimported-export');
  artifacts.setFinal({ input: touch.inputKind, results });
  artifacts.assertNoBrowserErrors();
  console.log(`RESULT: PASS\nartifacts: ${artifacts.finish('passed')}`);
} catch (error) {
  if (page) await artifacts.screenshot(page, 'failure').catch(() => {});
  console.error(`RESULT: FAIL\n${error?.stack || error}\nartifacts: ${artifacts.finish('failed', error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  managedProcess?.kill('SIGTERM');
}
