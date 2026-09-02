import test from 'node:test';
import assert from 'node:assert/strict';

import { convertPdfAnnotationToFabric } from '../src/utils/pdfAnnotationImporter.js';
import {
  buildStickyNoteGlyphSpec,
  buildCloudPathCommands,
  getCloudPathBounds,
  isStickyNoteGlyphObject,
  stickyNoteOutlineColor,
} from '../src/utils/pdfAnnotationAppearance.js';

const viewport = {
  height: 100,
  convertToViewportPoint(x, y) {
    return [x, 100 - y];
  },
  convertToViewportRectangle(rect) {
    const [x1, y1] = this.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y2] = this.convertToViewportPoint(rect[2], rect[3]);
    return [x1, y1, x2, y2];
  },
};

test('imported Text uses one note glyph shape for every PDF icon name', () => {
  for (const name of ['Comment', 'Note', 'Key', 'Help', 'Paragraph']) {
    const note = convertPdfAnnotationToFabric({
      id: `note-${name}`,
      subtype: 'Text',
      rect: [10, 60, 30, 80],
      color: new Uint8ClampedArray([255, 217, 51]),
      name,
      contents: 'Body',
    }, viewport);

    assert.equal(note.type, 'rect');
    assert.equal(note.data?.type, 'note');
    assert.equal(note.data?.pdfNoteGlyph, 'note');
    assert.equal(note.data?.pdfNoteIcon, name);
    assert.equal(note.data?.noteText, 'Body');
  }
});

test('sticky note glyph has a rounded bubble, tail, and three text lines', () => {
  const glyph = buildStickyNoteGlyphSpec({ width: 20, height: 20 });
  assert.match(glyph.bubblePath, /^M /);
  assert.match(glyph.bubblePath, / Q /, 'rounded corners use curves');
  assert.match(glyph.bubblePath, / L [\d.]+ 20(?:\.0+)? L /, 'tail reaches the bottom edge');
  assert.equal(glyph.textLines.length, 3);
  assert.ok(glyph.textLines.every((line) => line.x2 > line.x1));
  assert.equal(stickyNoteOutlineColor('rgba(255, 217, 51, 0.92)'), 'rgba(122, 104, 24, 0.78)');
  assert.equal(isStickyNoteGlyphObject({ data: { type: 'note' }, pdfAnnotationType: 'Text' }), true);
  assert.equal(isStickyNoteGlyphObject({ data: { type: 'note', pdfNoteGlyph: 'note' } }), true);
  assert.equal(isStickyNoteGlyphObject({ type: 'rect', data: { type: 'note' } }), false);
});

test('clouds without an explicit intensity keep the default cloud marker', () => {
  const square = convertPdfAnnotationToFabric({
    id: 'cloud-square',
    subtype: 'Square',
    rect: [10, 10, 90, 70],
    color: new Uint8ClampedArray([255, 0, 0]),
    borderWidth: 2,
    borderEffect: { style: 'C' },
  }, viewport);
  const polygon = convertPdfAnnotationToFabric({
    id: 'cloud-polygon',
    subtype: 'Polygon',
    rect: [10, 10, 90, 70],
    vertices: [10, 10, 90, 10, 90, 70, 10, 70],
    color: new Uint8ClampedArray([255, 0, 0]),
    borderWidth: 2,
    borderEffect: { style: 'C' },
  }, viewport);

  assert.equal(square.data?.pdfCloudIntensity, 2);
  assert.equal(polygon.data?.pdfCloudIntensity, 2);
});

test('cloud geometry uses intensity-sized outward arcs and keeps the source rect extent', () => {
  const points = [
    { x: 10, y: 10 },
    { x: 170, y: 10 },
    { x: 170, y: 80 },
    { x: 10, y: 80 },
  ];
  const small = buildCloudPathCommands(points, 1, 2);
  const standard = buildCloudPathCommands(points, 2, 2);
  const smallBounds = getCloudPathBounds(small);
  const standardBounds = getCloudPathBounds(standard);

  assert.equal(small.filter(([kind]) => kind === 'C').length, 42);
  assert.equal(standard.filter(([kind]) => kind === 'C').length, 30);
  assert.ok(Math.abs(standardBounds.minX - 0) < 0.25);
  assert.ok(Math.abs(standardBounds.minY - 0) < 0.25);
  assert.ok(Math.abs(standardBounds.maxX - 180) < 0.25);
  assert.ok(Math.abs(standardBounds.maxY - 90) < 0.25);
  assert.ok(smallBounds.minX > standardBounds.minX, 'I=1 has smaller outward bumps');
  assert.ok(smallBounds.maxY < standardBounds.maxY, 'I=1 has smaller outward bumps');

  const scaled = getCloudPathBounds(buildCloudPathCommands(points, 2, 2, 2));
  assert.ok(scaled.minX < standardBounds.minX - 9, 'saved import scale grows print and screen bumps');
});

test('Acrobat page 2 cloud polygon reaches the source outer rectangle', () => {
  // Localized from acrobat-authored-annotations.pdf page 2, annotation 59R.
  // PDF vertices use y-up, so local screen y is rect[3] - vertexY.
  const points = [
    { x: 16.157, y: 96.177 },
    { x: 91.157, y: 106.177 },
    { x: 159.157, y: 71.177 },
    { x: 136.157, y: 16.177 },
    { x: 51.157, y: 11.177 },
    { x: 11.157, y: 46.177 },
  ];
  const bounds = getCloudPathBounds(buildCloudPathCommands(points, 2, 2));
  const sourceOuterRect = {
    minX: 0,
    minY: 0,
    maxX: 170.248,
    maxY: 117.233,
  };

  for (const key of Object.keys(sourceOuterRect)) {
    assert.ok(
      Math.abs(bounds[key] - sourceOuterRect[key]) <= 2,
      `${key} differs from Acrobat by more than two points: ${bounds[key]}`,
    );
  }
});
