// KAL-718 (Nightly 'copy-format'): Drawboard's Copy Format / Paste Format on
// the mark menu. One mark's look (line colour and opacity, fill colour and
// opacity, width, line style, arrow heads) is kept and put on other marks;
// each mark takes only what it has, locked marks stay, one write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyMarkFormat,
  applyMarkFormatToPage,
  canCopyMarkFormat,
  copyMarkFormat,
  markFormatCalloutPatch,
  markFormatChanges,
} from '../src/utils/markFormat.js';
import { readRestyleStyle } from '../src/utils/selectionRestyle.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const redCloudRect = {
  type: 'rect', left: 10, top: 10, width: 50, height: 30,
  stroke: 'rgba(220, 38, 38, 0.5)', fill: '#fde68a', strokeWidth: 4,
  data: { id: 'a', pdfCloudIntensity: 2 },
};
const plainRect = {
  type: 'rect', left: 100, top: 10, width: 50, height: 30,
  stroke: '#000000', fill: 'transparent', strokeWidth: 1, data: { id: 'b' },
};
const line = {
  type: 'line', x1: 0, y1: 0, x2: 50, y2: 50, stroke: '#000000', strokeWidth: 1,
  data: { id: 'c' },
};
const arrow = {
  type: 'line', x1: 0, y1: 0, x2: 50, y2: 50, stroke: '#2563eb', strokeWidth: 3,
  strokeDashArray: [6, 4],
  data: { id: 'd', arrowheadStyle: 'openTriangle', startArrowheadStyle: 'openTriangle' },
};

test('copy: a shape keeps its whole look; a mark with no look gives nothing', () => {
  const format = copyMarkFormat(redCloudRect);
  assert.equal(format.strokeColor, '#dc2626');
  assert.equal(format.strokeOpacity, 50);
  assert.equal(format.fillColor, '#fde68a');
  assert.equal(format.fillOpacity, 100);
  assert.equal(format.width, 4);
  assert.equal(format.lineStyle, 'cloud');
  assert.equal(format.cloudIntensity, 2);
  assert.ok(Object.isFrozen(format));
  // A highlight, a count pin and a bare object have no look to copy.
  assert.equal(copyMarkFormat({ type: 'rect', data: { type: 'text-markup' } }), null);
  assert.equal(copyMarkFormat({ type: 'circle', data: { type: 'counter' } }), null);
  assert.equal(copyMarkFormat(null), null);
  assert.equal(canCopyMarkFormat(null), false);
  assert.equal(canCopyMarkFormat(plainRect), true);
});

test('paste: a shape takes colour, fill, width and cloud from another', () => {
  const next = applyMarkFormat(plainRect, copyMarkFormat(redCloudRect));
  const style = readRestyleStyle(next);
  assert.equal(style.strokeColor, '#dc2626');
  assert.equal(style.strokeOpacity, 50);
  assert.equal(style.fillColor, '#fde68a');
  assert.equal(style.fillOpacity, 100);
  assert.equal(style.width, 4);
  assert.equal(style.lineStyle, 'cloud');
  // Its place and size are its own.
  assert.equal(next.left, 100);
  assert.equal(next.width, 50);
  // Pasting the same look again changes nothing.
  assert.equal(applyMarkFormat(next, copyMarkFormat(redCloudRect)), null);
});

test('paste: a line takes no fill and no cloud; an arrow look carries both heads', () => {
  const fromRect = applyMarkFormat(line, copyMarkFormat(redCloudRect));
  assert.equal(fromRect.fill, undefined);
  assert.equal(fromRect.data.pdfCloudIntensity, undefined);
  assert.equal(readRestyleStyle(fromRect).strokeColor, '#dc2626');
  assert.equal(fromRect.strokeWidth, 4);

  const plainArrow = { ...line, data: { id: 'e', arrowheadStyle: 'solidTriangle' } };
  const next = applyMarkFormat(plainArrow, copyMarkFormat(arrow));
  assert.equal(next.data.arrowheadStyle, 'openTriangle');
  assert.equal(next.data.startArrowheadStyle, 'openTriangle');
  assert.deepEqual(readRestyleStyle(next).lineStyle, readRestyleStyle(arrow).lineStyle);
  // One-ended look onto a two-ended arrow: the start head goes.
  const oneEnd = { ...arrow, data: { id: 'f', arrowheadStyle: 'solidTriangle', startArrowheadStyle: 'none' } };
  const trimmed = applyMarkFormat(arrow, copyMarkFormat(oneEnd));
  assert.equal(trimmed.data.arrowheadStyle, 'solidTriangle');
  assert.equal(trimmed.data.startArrowheadStyle, 'none');
});

test('paste: a filled shape with no line gives its look too, and the line goes off', () => {
  const noLine = { ...redCloudRect, stroke: 'transparent', data: { id: 'g' } };
  const format = copyMarkFormat(noLine);
  assert.notEqual(format, null);
  assert.equal(format.strokeOpacity, 0);
  const kinds = markFormatChanges(format).map((c) => c.kind);
  assert.ok(kinds.indexOf('fillColor') < kinds.indexOf('fillOpacity'));
  const next = applyMarkFormat(plainRect, format);
  const style = readRestyleStyle(next);
  assert.equal(style.strokeOpacity, 0);
  assert.equal(style.fillColor, '#fde68a');
  assert.equal(style.fillOpacity, 100);
});

test('paste on a page: every picked mark that may change, in one new page', () => {
  const page = { objects: [redCloudRect, plainRect, line, { ...plainRect, data: { id: 'h', lockedBy: 'u1' } }] };
  const format = copyMarkFormat(redCloudRect);
  const locked = (mark) => !mark?.data?.lockedBy;
  const next = applyMarkFormatToPage(page, [{ index: 1 }, { index: 2 }, { index: 3 }], format, locked);
  assert.notEqual(next, null);
  assert.equal(next.objects[0], page.objects[0]);
  assert.equal(readRestyleStyle(next.objects[1]).strokeColor, '#dc2626');
  assert.equal(readRestyleStyle(next.objects[2]).strokeColor, '#dc2626');
  assert.equal(next.objects[3], page.objects[3]); // locked: left as it was
  assert.equal(page.objects[1].stroke, '#000000'); // input untouched
  assert.equal(applyMarkFormatToPage(page, [{ index: 0 }], format), null);
  assert.equal(applyMarkFormatToPage(page, [{ index: 1 }], null), null);
});

test('callouts: copy from one, paste one style patch onto another', () => {
  const calloutObject = {
    type: 'group',
    data: {
      type: 'callout', id: 'k',
      legacyCallout: {
        id: 'k',
        style: { borderColor: '#16a34a', borderOpacity: 1, fillColor: '#ffffff', fillOpacity: 1, lineThickness: 2, lineStyle: 'dashed', arrowheadStyle: 'openArrow' },
      },
    },
  };
  const format = copyMarkFormat(calloutObject);
  assert.equal(format.strokeColor, '#16a34a');
  assert.equal(format.lineStyle, 'dashed');
  assert.equal(format.arrowheadStyle, 'openArrow');

  const patch = markFormatCalloutPatch({ id: 'm', style: { borderColor: '#000000', lineThickness: 1 } }, copyMarkFormat(redCloudRect));
  assert.equal(patch.borderColor, '#dc2626');
  assert.equal(patch.borderOpacity, 0.5);
  assert.equal(patch.fillColor, '#fde68a');
  assert.equal(patch.lineThickness, 4);
  assert.equal(patch.lineStyle, 'cloud');
  assert.equal(markFormatCalloutPatch(null, format), null);
});

test('wiring: Nightly flag, menu rows on the mark, callout and group menus', () => {
  assert.equal(FEATURE_FLAGS['copy-format']?.stage, 'beta');
  const menu = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  assert.match(menu, /item\('Copy format', 'copyFormat'/);
  assert.match(menu, /item\('Paste format', 'pasteFormat'.*Boolean\(markFormat\)\)/);
  assert.match(menu, /\.\.\.formatItems\(\{ calloutIds: \[ctx\.calloutId\] \}, calloutObj\)/);
  assert.match(menu, /\.\.\.formatItems\(\{ indices: \[ctx\.annotationIndex\] \}, menuObj\)/);
  assert.match(menu, /\.\.\.formatItems\(familySelection\)/);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /copyMarkFormat: copyFormatOn \? copyMarkFormatFrom : null/);
  assert.match(viewer, /pasteMarkFormat: copyFormatOn \? pasteMarkFormat : null/);
  assert.match(viewer, /action: 'paste-format'/);
});
