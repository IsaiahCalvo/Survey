// KAL-240 — text selection quick menu.
//
// 1. Placement: the menu never covers the selection, stays inside the viewer,
//    goes above on desktop and below (clear of the handle and of iOS's own
//    callout) on touch.
// 2. Quad -> markup geometry: a browser selection's client rects, on plain
//    and rotated pages, become one text-markup record with one quad per line,
//    and the exported PDF's QuadPoints land on the selected words in PDF user
//    space — the same chain the quick menu's actions run.
// 3. Copy falls back to the legacy command when the Clipboard API refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  IOS_CALLOUT_HEIGHT,
  QUICK_MENU_GAP,
  QUICK_MENU_TOUCH_HANDLE_GAP,
  TEXT_SELECTION_QUICK_MENU_MARKS,
  computeTextSelectionQuickMenuPosition,
  copyTextSelection,
  textSelectionQuickMenuKey,
  unionClientRects,
} from '../src/utils/textSelectionQuickMenu.js';
import { clientRectToPageQuad, createTextMarkupAnnotation, mergeLineQuads } from '../src/utils/pdfTextMarkup.js';
import { bakeAnnotationsIntoPdf } from '../src/utils/pdfNativeExport/index.js';

const FIXTURE = new URL('../debug/fixtures/text-selection-rotation-matrix.pdf', import.meta.url);

const overlaps = (menu, size, sel) => (
  menu.left < sel.right && menu.left + size.width > sel.left
  && menu.top < sel.bottom && menu.top + size.height > sel.top
);

// ---------------------------------------------------------------- placement

const DESKTOP_BOUNDS = { left: 48, top: 129, right: 1392, bottom: 900 };
const MENU = { width: 186, height: 40 };

test('desktop: the menu sits above the selection, centred on it', () => {
  const sel = { left: 460, top: 400, right: 770, bottom: 446 };
  const pos = computeTextSelectionQuickMenuPosition({ selectionRect: sel, bounds: DESKTOP_BOUNDS, menuWidth: MENU.width, menuHeight: MENU.height });
  assert.equal(pos.placement, 'above');
  assert.equal(pos.top, sel.top - QUICK_MENU_GAP - MENU.height);
  assert.equal(pos.left, Math.round((460 + 770) / 2 - MENU.width / 2));
  assert.equal(overlaps(pos, MENU, sel), false);
});

test('desktop: no room above (selection right under the tool bars) puts it below', () => {
  const sel = { left: 460, top: 148, right: 677, bottom: 214 };
  const pos = computeTextSelectionQuickMenuPosition({ selectionRect: sel, bounds: DESKTOP_BOUNDS, menuWidth: MENU.width, menuHeight: MENU.height });
  assert.equal(pos.placement, 'below');
  assert.equal(pos.top, sel.bottom + QUICK_MENU_GAP);
  assert.ok(pos.top >= DESKTOP_BOUNDS.top);
  assert.equal(overlaps(pos, MENU, sel), false);
});

test('the menu is clamped inside the viewer near its side edges', () => {
  const left = computeTextSelectionQuickMenuPosition({ selectionRect: { left: 50, top: 400, right: 70, bottom: 416 }, bounds: DESKTOP_BOUNDS, menuWidth: MENU.width, menuHeight: MENU.height });
  assert.equal(left.left, DESKTOP_BOUNDS.left + 8);
  const right = computeTextSelectionQuickMenuPosition({ selectionRect: { left: 1370, top: 400, right: 1390, bottom: 416 }, bounds: DESKTOP_BOUNDS, menuWidth: MENU.width, menuHeight: MENU.height });
  assert.equal(right.left, DESKTOP_BOUNDS.right - 8 - MENU.width);
});

test('a selection taller than the viewer pins the menu to the edge it covers least', () => {
  const sel = { left: 460, top: 140, right: 900, bottom: 880 };
  const pos = computeTextSelectionQuickMenuPosition({ selectionRect: sel, bounds: DESKTOP_BOUNDS, menuWidth: MENU.width, menuHeight: MENU.height });
  assert.equal(pos.placement, 'pinned');
  // Top edge: 137..177 overlaps the selection by 37px; bottom edge 852..892 by 28px.
  assert.equal(pos.top, DESKTOP_BOUNDS.bottom - 8 - MENU.height);
});

test('a selection scrolled out of the viewer has no menu', () => {
  assert.equal(computeTextSelectionQuickMenuPosition({ selectionRect: { left: 460, top: 20, right: 600, bottom: 60 }, bounds: DESKTOP_BOUNDS, menuWidth: MENU.width, menuHeight: MENU.height }), null);
  assert.equal(computeTextSelectionQuickMenuPosition({ selectionRect: null, bounds: DESKTOP_BOUNDS, menuWidth: 10, menuHeight: 10 }), null);
});

const PHONE_BOUNDS = { left: 0, top: 77, right: 390, bottom: 756 };
const PHONE_MENU = { width: 235, height: 50 };

test('touch: the menu goes below, clear of the end handle, so iOS keeps the space above for its callout', () => {
  const sel = { left: 75, top: 300, right: 190, bottom: 326 };
  const pos = computeTextSelectionQuickMenuPosition({ selectionRect: sel, bounds: PHONE_BOUNDS, menuWidth: PHONE_MENU.width, menuHeight: PHONE_MENU.height, pointer: 'coarse' });
  assert.equal(pos.placement, 'below');
  assert.equal(pos.top, sel.bottom + QUICK_MENU_GAP + QUICK_MENU_TOUCH_HANDLE_GAP);
  assert.ok(pos.left >= 8 && pos.left + PHONE_MENU.width <= 382);
  assert.equal(overlaps(pos, PHONE_MENU, sel), false);
});

test('touch: a selection at the very top leaves room for the iOS callout under it too', () => {
  const sel = { left: 75, top: 40, right: 190, bottom: 60 };
  const pos = computeTextSelectionQuickMenuPosition({ selectionRect: sel, bounds: { ...PHONE_BOUNDS, top: 0 }, menuWidth: PHONE_MENU.width, menuHeight: PHONE_MENU.height, pointer: 'coarse' });
  assert.equal(pos.top, sel.bottom + QUICK_MENU_GAP + QUICK_MENU_TOUCH_HANDLE_GAP + IOS_CALLOUT_HEIGHT);
});

test('touch: no room below falls back above', () => {
  const sel = { left: 75, top: 680, right: 190, bottom: 720 };
  const pos = computeTextSelectionQuickMenuPosition({ selectionRect: sel, bounds: PHONE_BOUNDS, menuWidth: PHONE_MENU.width, menuHeight: PHONE_MENU.height, pointer: 'coarse' });
  assert.equal(pos.placement, 'above');
  assert.equal(overlaps(pos, PHONE_MENU, sel), false);
});

test('the selection rect is the union of the range rects, skipping empty ones', () => {
  assert.deepEqual(unionClientRects([
    { left: 460, top: 198, right: 677, bottom: 214 },
    { left: 0, top: 0, right: 0, bottom: 0 },
    { left: 460, top: 228, width: 120, height: 16 },
  ]), { left: 460, top: 198, right: 677, bottom: 244 });
  assert.equal(unionClientRects([]), null);
});

test('the dismissal key follows the selected text range, not its screen position', () => {
  const a = { pages: [{ pageNumber: 1, textRange: { start: 4, end: 40 }, quads: [] }], anchor: { left: 1 } };
  const b = { pages: [{ pageNumber: 1, textRange: { start: 4, end: 40 }, quads: [] }], anchor: { left: 99 } };
  assert.equal(textSelectionQuickMenuKey(a), textSelectionQuickMenuKey(b));
  assert.notEqual(textSelectionQuickMenuKey(a), textSelectionQuickMenuKey({ pages: [{ pageNumber: 1, textRange: { start: 4, end: 41 } }] }));
  assert.equal(textSelectionQuickMenuKey(null), '');
});

test('the menu offers the four marks in the docked bar order', () => {
  assert.deepEqual(TEXT_SELECTION_QUICK_MENU_MARKS.map((mark) => mark.id), ['highlight', 'underline', 'squiggly', 'strikeout']);
});

// ---------------------------------------------------- quad -> markup geometry

let fixtureLines = null;
function loadFixtureLines() {
  fixtureLines ||= readFixtureLines();
  return fixtureLines;
}

async function readFixtureLines() {
  const data = new Uint8Array(readFileSync(FIXTURE));
  const task = pdfjsLib.getDocument({ data, verbosity: 0 });
  const doc = await task.promise;
  const pages = {};
  for (const pageNumber of [1, 2, 3, 4]) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    const lines = items.filter((item) => /^Selectable line/.test(item.str)).map((item) => {
      const [, , , , x, y] = item.transform;
      const user = { left: x, bottom: y, right: x + item.width, top: y + item.height };
      const corners = [[user.left, user.bottom], [user.right, user.bottom], [user.left, user.top], [user.right, user.top]]
        .map(([px, py]) => viewport.convertToViewportPoint(px, py));
      return {
        text: item.str,
        user,
        viewport: {
          left: Math.min(...corners.map(([vx]) => vx)),
          right: Math.max(...corners.map(([vx]) => vx)),
          top: Math.min(...corners.map(([, vy]) => vy)),
          bottom: Math.max(...corners.map(([, vy]) => vy)),
        },
      };
    });
    pages[pageNumber] = { rotation: page.rotate, size: { width: viewport.width, height: viewport.height }, lines };
  }
  await task.destroy();
  return pages;
}

// The page as the browser lays it out at 150%, 100px in and 60px down.
const ZOOM = 1.5;
const pageRectFor = (size) => ({ left: 100, top: 60, width: size.width * ZOOM, height: size.height * ZOOM });
const toClient = (rect) => ({
  left: 100 + rect.left * ZOOM,
  top: 60 + rect.top * ZOOM,
  right: 100 + rect.right * ZOOM,
  bottom: 60 + rect.bottom * ZOOM,
});

function quadsFromClientRects(clientRects, size) {
  const pageRect = pageRectFor(size);
  return mergeLineQuads(clientRects.map((rect) => clientRectToPageQuad(rect, pageRect, size)).filter(Boolean));
}

async function exportedQuadBoxes(pageNumber, annotation) {
  const bytes = await bakeAnnotationsIntoPdf(readFileSync(FIXTURE), { [pageNumber]: { objects: [annotation] } });
  const pdf = await PDFDocument.load(bytes);
  const annots = pdf.getPage(pageNumber - 1).node.Annots();
  const list = Array.from({ length: annots?.size() || 0 }, (_, i) => annots.lookup(i));
  assert.equal(list.length, 1);
  const subtype = list[0].get(PDFName.of('Subtype')).toString();
  const points = list[0].get(PDFName.of('QuadPoints')).asArray().map((n) => n.asNumber());
  const boxes = [];
  for (let i = 0; i < points.length; i += 8) {
    const xs = [points[i], points[i + 2], points[i + 4], points[i + 6]];
    const ys = [points[i + 1], points[i + 3], points[i + 5], points[i + 7]];
    boxes.push({ left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) });
  }
  boxes.sort((a, b) => b.top - a.top || a.left - b.left);
  return { subtype, boxes };
}

const near = (actual, expected, label) => {
  for (const side of ['left', 'right', 'top', 'bottom']) {
    assert.ok(Math.abs(actual[side] - expected[side]) < 0.05, `${label} ${side}: ${actual[side]} vs ${expected[side]}`);
  }
};

test('a two-line selection split across spans becomes one mark with one quad per line', async () => {
  const { 1: page } = await loadFixtureLines();
  const [one, two] = page.lines;
  // Line one comes back from the browser as two fragments (two spans).
  const mid = (one.viewport.left + one.viewport.right) / 2;
  const rects = [
    toClient({ ...one.viewport, right: mid }),
    toClient({ ...one.viewport, left: mid }),
    toClient(two.viewport),
  ];
  const quads = quadsFromClientRects(rects, page.size);
  assert.equal(quads.length, 2);
  const annotation = createTextMarkupAnnotation({
    id: 'quick-hl', pageNumber: 1, selectionGroupId: 'g', markupType: 'highlight',
    selectedText: `${one.text}\n${two.text}`, quads, color: '#f4d35e', opacity: 0.4,
  });
  assert.equal(annotation.data.quads.length, 2);
  assert.equal(annotation.exportType, 'highlight');
  const { subtype, boxes } = await exportedQuadBoxes(1, annotation);
  assert.equal(subtype, '/Highlight');
  near(boxes[0], one.user, 'line one');
  near(boxes[1], two.user, 'line two');
});

for (const [pageNumber, rotation] of [[2, 90], [3, 180], [4, 270]]) {
  for (const markupType of ['underline', 'strikeout', 'squiggly']) {
    test(`a ${markupType} made on a /Rotate ${rotation} page exports onto the selected words`, async () => {
      const pages = await loadFixtureLines();
      const page = pages[pageNumber];
      assert.equal(page.rotation, rotation);
      const quads = quadsFromClientRects(page.lines.map((line) => toClient(line.viewport)), page.size);
      assert.equal(quads.length, 2);
      const annotation = createTextMarkupAnnotation({
        id: `quick-${markupType}-${rotation}`, pageNumber, selectionGroupId: 'g', markupType,
        selectedText: page.lines.map((line) => line.text).join('\n'), quads, color: '#d0021b', opacity: 1,
      });
      const { subtype, boxes } = await exportedQuadBoxes(pageNumber, annotation);
      assert.equal(subtype, `/${markupType === 'strikeout' ? 'StrikeOut' : markupType[0].toUpperCase() + markupType.slice(1)}`);
      const expected = page.lines.map((line) => line.user).sort((a, b) => b.top - a.top || a.left - b.left);
      near(boxes[0], expected[0], `${rotation} line one`);
      near(boxes[1], expected[1], `${rotation} line two`);
    });
  }
}

// ---------------------------------------------------------------------- copy

test('copy uses the Clipboard API and falls back to the legacy copy command', async () => {
  const written = [];
  assert.equal(await copyTextSelection('abc', { clipboard: { writeText: async (t) => { written.push(t); } }, execCommand: () => false }), true);
  assert.deepEqual(written, ['abc']);
  const commands = [];
  assert.equal(await copyTextSelection('abc', {
    clipboard: { writeText: async () => { throw new Error('denied'); } },
    execCommand: (command) => { commands.push(command); return true; },
  }), true);
  assert.deepEqual(commands, ['copy']);
  assert.equal(await copyTextSelection('', { clipboard: { writeText: async () => {} } }), false);
});
