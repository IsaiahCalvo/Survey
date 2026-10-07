import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compensateScrollLeftForColumnWidth,
  resolveCentredPageLeft,
  resolveDocumentColumnWidth,
  resolveDocumentScrollLeftMax,
} from '../src/utils/pdfPageColumn.js';

/*
 * UX (owner 2026-09-30): pages of different sizes stay centred during and after
 * a pinch / wheel zoom, on phone, web and desktop. Measured in headless
 * Chromium on a Letter / 11x17 landscape / A5 PDF at the phone layout: the old
 * per-page rule (centre a page that fits, pin an overflowing one to padX) left
 * page centres up to 3216px apart at 800% and made pages jump up to 135px on
 * release when the A5 page crossed from fitting to overflowing mid-pinch. One
 * shared centre line: centres 0.02px apart, release jump <= 0.63px.
 */

const PAGES = [{ w: 612 }, { w: 1224 }, { w: 420 }]; // Letter, 11x17 landscape, A5 (pt)
const PAD_X = 14;
const VIEWPORT = 354;

const layoutAt = (scale, { sideLeft = 0, sideRight = 0 } = {}) => {
  const columnWidth = resolveDocumentColumnWidth({
    viewportWidth: VIEWPORT,
    widestPageWidth: Math.max(...PAGES.map((p) => p.w)) * scale,
    padX: PAD_X,
  });
  return {
    columnWidth,
    lefts: PAGES.map((p) => resolveCentredPageLeft({ pageWidth: p.w * scale, columnWidth, sideLeft })),
    maxLeft: resolveDocumentScrollLeftMax({ columnWidth, viewportWidth: VIEWPORT, sideLeft, sideRight }),
  };
};

test('the column is the widest page plus padX each side, never narrower than the viewport', () => {
  assert.equal(resolveDocumentColumnWidth({ viewportWidth: 354, widestPageWidth: 200, padX: 14 }), 354);
  assert.equal(resolveDocumentColumnWidth({ viewportWidth: 354, widestPageWidth: 326, padX: 14 }), 354, 'fit width fills it exactly');
  assert.equal(resolveDocumentColumnWidth({ viewportWidth: 354, widestPageWidth: 723, padX: 14 }), 751);
  // Continuous: no jump in width (or scroll range) as the widest page passes the viewport.
  const justUnder = resolveDocumentColumnWidth({ viewportWidth: 354, widestPageWidth: 353.9, padX: 14 });
  const justOver = resolveDocumentColumnWidth({ viewportWidth: 354, widestPageWidth: 354.1, padX: 14 });
  assert.ok(Math.abs(justOver - justUnder) < 0.5);
});

test('every page of a mixed-size document is centred on one line, fitting or not', () => {
  for (const scale of [0.13, 0.59, 1, 2.45, 8]) {
    const { columnWidth, lefts } = layoutAt(scale, { sideLeft: 224 });
    const centres = lefts.map((left, i) => left + (PAGES[i].w * scale) / 2);
    centres.forEach((centre) => assert.ok(Math.abs(centre - (224 + columnWidth / 2)) < 1e-9, `scale ${scale}`));
  }
});

test('one horizontal scroll range for the whole document, side room included', () => {
  assert.equal(resolveDocumentScrollLeftMax({ columnWidth: 354, viewportWidth: 354 }), 0);
  assert.equal(resolveDocumentScrollLeftMax({ columnWidth: 751, viewportWidth: 354 }), 397);
  assert.equal(resolveDocumentScrollLeftMax({ columnWidth: 354, viewportWidth: 354, sideLeft: 224, sideRight: 272 }), 496);
});

test('a uniform live preview lands exactly on the committed layout for every page', () => {
  // The viewer previews a zoom as ONE transform of the whole document about an
  // anchor, then commits the new scale and a scroll that keeps the anchor under
  // the fingers. With one centre line that commit is the same picture for every
  // page — the old per-page rule broke this for the page crossing "fits".
  const from = 0.4; // A5 168px wide: fits; landscape 490px: overflows
  const to = 1.6; // A5 672px: overflows
  const zoom = to / from;
  const before = layoutAt(from);
  const after = layoutAt(to);
  const finger = 170; // screen x of the pinch centre
  // Anchor on the A5 page (index 2), 30% across it.
  const anchorBefore = before.lefts[2] + 0.3 * PAGES[2].w * from;
  const anchorAfter = after.lefts[2] + 0.3 * PAGES[2].w * to;
  const scrollAfter = Math.min(Math.max(0, anchorAfter - finger), after.maxLeft);
  const anchorScreen = anchorAfter - scrollAfter;
  PAGES.forEach((page, i) => {
    const previewScreenLeft = anchorScreen + (before.lefts[i] - anchorBefore) * zoom;
    const committedScreenLeft = after.lefts[i] - scrollAfter;
    assert.ok(Math.abs(previewScreenLeft - committedScreenLeft) < 1e-9, `page ${i + 1}`);
  });
});

test('a column that widens at the same zoom keeps the centre line still on screen', () => {
  // Page 1 (Letter) painted first; the landscape page's size arrives later.
  const narrow = 354;
  const wide = 751;
  const scrollLeft = compensateScrollLeftForColumnWidth(0, narrow, wide);
  assert.equal(narrow / 2 - 0, wide / 2 - scrollLeft);
  assert.equal(compensateScrollLeftForColumnWidth(10, 751, 354), 0, 'never negative');
});
