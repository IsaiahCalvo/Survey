// Stamps other apps save with no /AP /N (Acrobat's standard stamps) are drawn
// from their /Name instead of hidden behind the "not displayed" notice
// (Drawboard Projects audit, 2026-10-27).
import test from 'node:test';
import assert from 'node:assert/strict';
import { namedStampColor, namedStampLabel } from '../src/utils/pdfStampProxy.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

test('stamp names read as Acrobat prints them', () => {
  assert.equal(namedStampLabel('Approved'), 'APPROVED');
  assert.equal(namedStampLabel('/NotApproved'), 'NOT APPROVED');
  assert.equal(namedStampLabel('NotForPublicRelease'), 'NOT FOR PUBLIC RELEASE');
  assert.equal(namedStampLabel('AsIs'), 'AS IS');
  assert.equal(namedStampLabel('SBRejected'), 'REJECTED');
  assert.equal(namedStampLabel('#Reviewed'), 'REVIEWED');
  assert.equal(namedStampLabel('For_Comment'), 'FOR COMMENT');
  assert.equal(namedStampLabel('', 'Checked by QA'), 'CHECKED BY QA');
  assert.equal(namedStampLabel(null, ''), 'STAMP');
});

test('stamp ink: its own colour, else green / red / blue by word', () => {
  assert.equal(namedStampColor('APPROVED'), 'rgb(46, 125, 50)');
  assert.equal(namedStampColor('NOT APPROVED'), 'rgb(198, 40, 40)');
  assert.equal(namedStampColor('DRAFT'), 'rgb(198, 40, 40)');
  assert.equal(namedStampColor('FOR COMMENT'), 'rgb(31, 78, 156)');
  assert.equal(namedStampColor('APPROVED', '#7b1fa2'), '#7b1fa2');
  // Black means "no colour set" for a stamp: keep the word's ink.
  assert.equal(namedStampColor('APPROVED', '#000000'), 'rgb(46, 125, 50)');
});

const viewport = () => {
  const toPoint = (x, y) => [x, 200 - y];
  return {
    height: 200,
    convertToViewportPoint: toPoint,
    convertToViewportRectangle: (r) => [...toPoint(r[0], r[1]), ...toPoint(r[2], r[3])],
  };
};
const docWith = (annotations) => ({
  numPages: 1,
  async getPage() {
    return { getViewport: viewport, async getAnnotations() { return annotations; } };
  },
});

test('a stamp with no appearance imports as a drawn, locked stamp', async () => {
  const drawn = [];
  const result = await importAnnotationsFromPdf(docWith([
    { id: '12R', subtype: 'Stamp', rect: [20, 100, 140, 140], hasAppearance: false, name: 'Approved', color: new Uint8ClampedArray([0, 0, 0]) },
  ]), {
    renderStampAppearances: async () => new Map(),
    drawNamedStampAppearance: (args) => { drawn.push(args); return 'data:image/png;base64,AAAA'; },
  });
  assert.deepEqual(result.unsupportedCounts, {});
  assert.deepEqual(drawn, [{ label: 'APPROVED', color: 'rgb(46, 125, 50)', widthPt: 120, heightPt: 40 }]);
  const [stamp] = result.annotationsByPage[1].objects;
  assert.equal(stamp.type, 'image');
  assert.equal(stamp.pdfAnnotationType, 'Stamp');
  assert.equal(stamp.src, 'data:image/png;base64,AAAA');
  assert.equal(stamp.left, 20);
  assert.equal(stamp.top, 60);
  assert.equal(stamp.width, 120);
  assert.equal(stamp.lockMovementX, true);
  assert.equal(stamp.data.pdfStampDrawnFromName, 'APPROVED');
});

test('a painted appearance wins over drawing; a failed draw still reports the stamp', async () => {
  let drawCalls = 0;
  const painted = await importAnnotationsFromPdf(docWith([
    { id: '7R', subtype: 'Stamp', rect: [0, 0, 50, 20], hasAppearance: true, name: 'Draft' },
  ]), {
    renderStampAppearances: async () => new Map([['7R', 'data:image/png;base64,BBBB']]),
    drawNamedStampAppearance: () => { drawCalls += 1; return 'data:image/png;base64,AAAA'; },
  });
  assert.equal(drawCalls, 0);
  assert.equal(painted.annotationsByPage[1].objects[0].src, 'data:image/png;base64,BBBB');
  assert.equal(painted.annotationsByPage[1].objects[0].data.pdfStampDrawnFromName, undefined);

  const failed = await importAnnotationsFromPdf(docWith([
    { id: '8R', subtype: 'Stamp', rect: [0, 0, 50, 20], hasAppearance: false, name: 'Draft' },
  ]), {
    renderStampAppearances: async () => new Map(),
    drawNamedStampAppearance: () => { throw new Error('no canvas'); },
  });
  assert.deepEqual(failed.unsupportedCounts, { Stamp: 1 });
});
