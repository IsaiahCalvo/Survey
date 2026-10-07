// Owner 2026-10-07 (Pages tab round 2): thumbnail size cap, the blank-page
// size rule, and the one page menu list shared by the Pages tab and the
// viewer's page menu.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PDFDocument, degrees } from 'pdf-lib';

import { thumbnailBoxSize, thumbnailBoxStyle, THUMBNAIL_BOX_MAX } from '../src/sidebar/pageThumbnailBox.js';
import { blankPageReferencePage, blankPageSize } from '../src/utils/blankPageSize.js';
import { availableActions, buildPageMenuItems, runPageMenuAction } from '../src/sidebar/pageMenuItems.js';
import { mutatePdfPages, mutatePdfPagesBatch } from '../src/utils/pdfPageMutation.js';
import { applyPageViewOperation } from '../src/utils/pageViewDocument.js';
import { pageNumberAfterOperation, transformPageState } from '../src/utils/pageAnnotationReindex.js';

const LETTER = 792 / 612;
const SHEET = 792 / 1224; // 17x11 in, landscape
const SHEET_TURNED = 1224 / 792; // the same sheet rotated 90 degrees

// ---- thumbnail size cap -------------------------------------------------

test('every thumbnail fits one square: wide sheets fill the width', () => {
  const box = thumbnailBoxSize(SHEET, 249);
  assert.equal(box.width, THUMBNAIL_BOX_MAX);
  assert.ok(Math.abs(box.height - THUMBNAIL_BOX_MAX * SHEET) < 1e-9);
});

test('a sheet turned on its side is no taller than a letter page', () => {
  const letter = thumbnailBoxSize(LETTER, 249);
  const turned = thumbnailBoxSize(SHEET_TURNED, 249);
  assert.ok(turned.height <= letter.height + 1e-9, `${turned.height} > ${letter.height}`);
  assert.equal(turned.height, THUMBNAIL_BOX_MAX);
  // ...and keeps its shape.
  assert.ok(Math.abs(turned.height / turned.width - SHEET_TURNED) < 1e-9);
});

test('a narrow card shrinks the square to its width', () => {
  assert.deepEqual(thumbnailBoxSize(1, 150), { width: 150, height: 150 });
  const tall = thumbnailBoxSize(2, 120);
  assert.equal(tall.height, 120);
  assert.equal(tall.width, 60);
});

test('an unknown shape is drawn as a letter page', () => {
  assert.deepEqual(thumbnailBoxSize(undefined, 500), thumbnailBoxSize(LETTER, 500));
});

test('the box style caps the width and keeps the aspect ratio', () => {
  assert.deepEqual(thumbnailBoxStyle(SHEET), { width: `calc(min(100%, ${THUMBNAIL_BOX_MAX}px) * 1)`, aspectRatio: String(Number((1224 / 792).toFixed(5))) });
  const turned = thumbnailBoxStyle(SHEET_TURNED);
  assert.equal(turned.width, `calc(min(100%, ${THUMBNAIL_BOX_MAX}px) * ${Number((792 / 1224).toFixed(5))})`);
  assert.equal(turned.aspectRatio, String(Number((792 / 1224).toFixed(5))));
});

// ---- blank page size ------------------------------------------------------

test('a blank page takes the page above it, or page 1 at the very top', () => {
  assert.equal(blankPageReferencePage(3, 8), 3);
  assert.equal(blankPageReferencePage(0, 8), 1);
  assert.equal(blankPageReferencePage(8, 8), 8);
});

test('a blank page matches its reference as shown, stored unturned', () => {
  assert.deepEqual(blankPageSize({ width: 1224, height: 792, rotation: 0 }), { width: 1224, height: 792 });
  assert.deepEqual(blankPageSize({ width: 1224, height: 792, rotation: 90 }), { width: 792, height: 1224 });
  assert.deepEqual(blankPageSize({ width: 1224, height: 792, rotation: -270 }), { width: 792, height: 1224 });
  assert.deepEqual(blankPageSize({ width: 1224, height: 792, rotation: 180 }), { width: 1224, height: 792 });
  assert.deepEqual(blankPageSize({}), { width: 612, height: 792 });
});

async function sheets() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([1224, 792]).setRotation(degrees(90));
  pdf.addPage([1224, 792]);
  return pdf.save();
}

async function shown(bytes) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const turned = page.getRotation().angle % 180 !== 0;
    return [turned ? page.getHeight() : page.getWidth(), turned ? page.getWidth() : page.getHeight(), page.getRotation().angle];
  });
}

test('the saved PDF: a blank after a turned sheet stands up like it, rotation 0', async () => {
  const pages = await shown(await mutatePdfPages(await sheets(), { type: 'insert', afterPage: 2 }));
  assert.deepEqual(pages[2], [792, 1224, 0]);
  assert.deepEqual(pages[1], [792, 1224, 90]);
});

test('the saved PDF: a blank at the very top takes page 1 (the page below)', async () => {
  const pages = await shown(await mutatePdfPages(await sheets(), { type: 'insert', afterPage: 0 }));
  assert.equal(pages.length, 4);
  assert.deepEqual(pages[0], [612, 792, 0]);
  assert.deepEqual(pages[1], [612, 792, 0]);
});

test('the saved PDF: paste above page 1 copies to the very top', async () => {
  const pages = await shown(await mutatePdfPages(await sheets(), { type: 'copy', source: 3, afterPage: 0 }));
  assert.deepEqual(pages.map((p) => p[0]), [1224, 612, 792, 1224]);
});

function fakeSheetsDoc() {
  const defs = [[612, 792, 0], [1224, 792, 90], [1224, 792, 0]];
  const pages = defs.map(([w, h, rotate], i) => ({
    pageNumber: i + 1,
    rotate,
    view: [0, 0, w, h],
    userUnit: 1,
    getViewport({ scale = 1, rotation = rotate } = {}) {
      const turned = ((rotation % 360) + 360) % 360 % 180 !== 0;
      return { width: (turned ? h : w) * scale, height: (turned ? w : h) * scale, rotation };
    },
  }));
  return {
    doc: { numPages: 3, fingerprints: ['fp', null], getPage: async (n) => pages[n - 1], getPageIndex: async () => 0 },
    pagesByNumber: { 1: pages[0], 2: pages[1], 3: pages[2] },
  };
}

test('the instant page view sizes the blank exactly like the saved PDF', async () => {
  const bytes = await sheets();
  for (const operations of [
    [{ type: 'insert', afterPage: 2 }],
    [{ type: 'insert', afterPage: 0 }],
    [{ type: 'rotate', page: 3, delta: -90 }, { type: 'insert', afterPage: 3 }],
    [{ type: 'insert', afterPage: 1 }, { type: 'rotate', page: 2, delta: 90 }, { type: 'insert', afterPage: 2 }],
  ]) {
    const { doc, pagesByNumber } = fakeSheetsDoc();
    let view = doc;
    for (const operation of operations) view = applyPageViewOperation(view, operation, { pagesByNumber });
    const viewSizes = [];
    for (let n = 1; n <= view.numPages; n += 1) {
      const vp = (await view.getPage(n)).getViewport({ scale: 1 });
      viewSizes.push([Math.round(vp.width), Math.round(vp.height)]);
    }
    const saved = (await shown(await mutatePdfPagesBatch(bytes, operations))).map(([w, h]) => [w, h]);
    assert.deepEqual(viewSizes, saved, JSON.stringify(operations));
  }
});

test('marks and the current page move down when a blank goes in at the top', () => {
  const next = transformPageState({ annotationsByPage: { 1: { objects: [{ id: 'a' }] }, 2: { objects: [] } } }, { type: 'insert', afterPage: 0 });
  assert.deepEqual(Object.keys(next.annotationsByPage), ['2', '3']);
  assert.equal(pageNumberAfterOperation(1, { type: 'insert', afterPage: 0 }, 4), 2);
});

// ---- the one page menu list ----------------------------------------------

test('the page menu list: order, groups and off states', () => {
  const items = buildPageMenuItems({ pageNumber: 3, pageCount: 8, clipboardPage: null });
  assert.deepEqual(items.filter((i) => !i.separator).map((i) => i.key), [
    'header', 'cut', 'copy', 'pasteAbove', 'pasteBelow', 'duplicate',
    'insertAbove', 'insertBelow', 'rotateLeft', 'rotateRight', 'mirrorH', 'mirrorV', 'reset', 'delete',
  ]);
  assert.equal(items[0].label, 'Page 3');
  const off = Object.fromEntries(items.filter((i) => !i.separator && !i.header).map((i) => [i.key, Boolean(i.disabled)]));
  assert.equal(off.pasteAbove, true);
  assert.equal(off.reset, true);
  assert.equal(off.delete, false);
  const withClip = buildPageMenuItems({ pageNumber: 3, pageCount: 1, clipboardPage: 2, clipboardType: 'copy', hasTransform: true });
  const off2 = Object.fromEntries(withClip.filter((i) => i.key && !i.separator).map((i) => [i.key, Boolean(i.disabled)]));
  assert.equal(off2.pasteBelow, false);
  assert.equal(off2.reset, false);
  assert.equal(off2.delete, true, 'the only page cannot be deleted');
  // A cut page pasted onto itself would do nothing.
  const self = buildPageMenuItems({ pageNumber: 2, pageCount: 3, clipboardPage: 2, clipboardType: 'cut' });
  assert.equal(self.find((i) => i.key === 'pasteAbove').disabled, true);
});

test('the phone list adds Move up / down; a missing action hides its rows', () => {
  const phone = buildPageMenuItems({ pageNumber: 1, pageCount: 3, move: { canUp: false, canDown: true } });
  assert.deepEqual(phone.filter((i) => i.key.startsWith('move')).map((i) => [i.key, Boolean(i.disabled)]), [['moveUp', true], ['moveDown', false]]);
  const noInsert = buildPageMenuItems({ pageNumber: 1, pageCount: 3, available: availableActions({ cut() {}, rotate() {} }) });
  assert.deepEqual(noInsert.filter((i) => !i.separator && !i.header).map((i) => i.key), ['cut', 'rotateLeft', 'rotateRight']);
  assert.ok(!noInsert.some((i, k) => i.separator && noInsert[k + 1]?.separator), 'no doubled separators');
});

test('each menu item runs the right page operation', () => {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  const handlers = Object.fromEntries(['move', 'cut', 'copy', 'paste', 'duplicate', 'insertBlank', 'rotate', 'mirror', 'reset', 'delete'].map((n) => [n, rec(n)]));
  for (const key of ['moveUp', 'moveDown', 'cut', 'copy', 'pasteAbove', 'pasteBelow', 'duplicate', 'insertAbove', 'insertBelow', 'rotateLeft', 'rotateRight', 'mirrorH', 'mirrorV', 'reset', 'delete']) {
    assert.equal(runPageMenuAction(key, 1, handlers), true, key);
  }
  assert.deepEqual(calls, [
    ['move', 1, -1], ['move', 1, 1], ['cut', 1], ['copy', 1], ['paste', 1, 'above'], ['paste', 1, 'below'],
    ['duplicate', 1], ['insertBlank', 0], ['insertBlank', 1], ['rotate', 1, -90], ['rotate', 1, 90],
    ['mirror', 1, 'horizontal'], ['mirror', 1, 'vertical'], ['reset', 1], ['delete', 1],
  ]);
  assert.equal(runPageMenuAction('cut', 1, {}), false);
});

// Owner 2026-10-07: drag a page anywhere on its card to move it (no handle),
// desktop and phone, with @dnd-kit; the drop is the ordinary page move.
test('the Pages tab drags whole cards with dnd-kit: mouse 5px, finger held 300ms, keyboard', () => {
  const panel = readFileSync(new URL('../src/sidebar/PagesPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /useSensor\(MouseSensor, \{ activationConstraint: \{ distance: 5 \} \}\)/);
  assert.match(panel, /useSensor\(TouchSensor, \{ activationConstraint: \{ delay: PAGE_DRAG_TOUCH_DELAY_MS, tolerance: 5 \} \}\)/);
  assert.match(panel, /const PAGE_DRAG_TOUCH_DELAY_MS = 300;/);
  assert.match(panel, /useSensor\(KeyboardSensor/);
  assert.match(panel, /<DragOverlay dropAnimation=\{dropAnimation\}/);
  assert.match(panel, /onReorderPages\(source, target\)/);
  // Owner 2026-10-07: a selection of several pages is carried as one block.
  assert.match(panel, /onReorderPages\(block\.pages, \{ index, pageCount: numPages \}\)/);
  assert.doesNotMatch(panel, /draggable=\{!mobileMode\}/, 'no native HTML5 drag any more');
  assert.doesNotMatch(panel, /data-drag-handle/, 'no handle: the card is the target');
});

test('the Pages tab and the viewer page menu draw the same list', () => {
  const panel = readFileSync(new URL('../src/sidebar/PagesPanel.jsx', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  for (const source of [panel, viewer]) {
    assert.match(source, /buildPageMenuItems\(/);
    assert.match(source, /runPageMenuAction\(/);
    assert.match(source, /<PageMenuList/);
  }
});
