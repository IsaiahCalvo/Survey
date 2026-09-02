// Tests for the pure counting/naming logic behind the "some annotations
// aren't displayed" toast (src/utils/unsupportedAnnotationNotice.js) and the
// importer's per-subtype unsupportedCounts plumbing.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FRIENDLY_SUBTYPE_NAMES,
  summarizeUnsupportedCounts,
  formatUnsupportedAnnotationNotice
} from '../src/utils/unsupportedAnnotationNotice.js';
import { countUnsupportedAnnotations, importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

test('formatUnsupportedAnnotationNotice returns null when nothing is hidden', () => {
  assert.equal(formatUnsupportedAnnotationNotice({}), null);
  assert.equal(formatUnsupportedAnnotationNotice(null), null);
  assert.equal(formatUnsupportedAnnotationNotice({ Stamp: 0 }), null);
});

test('single known type, singular wording', () => {
  assert.equal(
    formatUnsupportedAnnotationNotice({ Stamp: 1 }),
    '1 stamp in this document isn’t displayed. It’s not deleted — it stays in the file and will still be included when you export.'
  );
});

test('redaction warning says covered text stays readable until redactions are applied', () => {
  assert.equal(
    formatUnsupportedAnnotationNotice({ Redact: 1 }),
    '1 redaction mark is shown with an outline. The covered text is still readable until the redaction is applied. Exporting an annotated PDF does not apply it.'
  );
});

test('multiple known types use plural friendly names and plural tail', () => {
  assert.equal(
    formatUnsupportedAnnotationNotice({ Sound: 1, Stamp: 2 }),
    '2 stamps and 1 sound clip in this document aren’t displayed. They’re not deleted — they stay in the file and will still be included when you export.'
  );
});

test('three or more parts join with commas and a final "and"', () => {
  const msg = formatUnsupportedAnnotationNotice({ Stamp: 3, FileAttachment: 2, Movie: 1 });
  assert.ok(msg.startsWith('3 stamps, 2 attached files, and 1 video in this document aren’t displayed.'));
});

test('unknown subtypes bucket into jargon-free wording (single unknown type)', () => {
  assert.equal(
    formatUnsupportedAnnotationNotice({ TrapNet: 1 }),
    '1 annotation of a type we don’t recognize in this document isn’t displayed. It’s not deleted — it stays in the file and will still be included when you export.'
  );
});

test('multiple unknown subtypes pluralize both nouns', () => {
  const { parts, total } = summarizeUnsupportedCounts({ TrapNet: 1, PrinterMark: 2 });
  assert.deepEqual(parts, ['3 annotations of types we don’t recognize']);
  assert.equal(total, 3);
});

test('mixed known + unknown puts the unknown bucket last', () => {
  assert.equal(
    formatUnsupportedAnnotationNotice({ Screen: 1, Stamp: 2 }),
    '2 stamps and 1 annotation of a type we don’t recognize in this document aren’t displayed. They’re not deleted — they stay in the file and will still be included when you export.'
  );
});

test('no raw PDF subtype jargon ever leaks into the message', () => {
  const msg = formatUnsupportedAnnotationNotice({
    Stamp: 1, Sound: 1, Movie: 1, RichMedia: 1, FileAttachment: 1,
    '3D': 2, Watermark: 1, Redact: 1, TrapNet: 1, Screen: 1
  });
  ['Stamp', 'Sound', 'Movie', 'RichMedia', 'FileAttachment', 'Watermark', 'Redact', 'TrapNet', 'Screen', 'Subtype']
    .forEach((jargon) => assert.ok(!msg.includes(jargon), `message leaked "${jargon}": ${msg}`));
});

test('Text safety-net maps to "sticky note" (it should normally never reach the counts)', () => {
  assert.deepEqual(FRIENDLY_SUBTYPE_NAMES.Text, ['sticky note', 'sticky notes']);
  assert.ok(formatUnsupportedAnnotationNotice({ Text: 2 }).startsWith('2 sticky notes in this document aren’t displayed.'));
});

// --- Importer plumbing: unsupportedCounts ---------------------------------

const makeViewport = ({ pageHeight = 200 } = {}) => {
  const convertToViewportPoint = (x, y) => [x, pageHeight - y];
  return {
    height: pageHeight,
    convertToViewportPoint,
    convertToViewportRectangle(rect) {
      const [x1, y1] = convertToViewportPoint(rect[0], rect[1]);
      const [x2, y2] = convertToViewportPoint(rect[2], rect[3]);
      return [x1, y1, x2, y2];
    }
  };
};

const makeDoc = (annotationsByPage) => ({
  numPages: Object.keys(annotationsByPage).length,
  async getPage(pageNum) {
    return {
      getViewport: () => makeViewport(),
      async getAnnotations() {
        return annotationsByPage[pageNum] || [];
      }
    };
  }
});

test('importer counts unsupported subtypes across pages and dedupes Preview re-save copies', async () => {
  const result = await importAnnotationsFromPdf(makeDoc({
    1: [
      { id: 'stamp-1', subtype: 'Stamp', rect: [0, 0, 10, 10], hasAppearance: true },
      // Same /NM id twice — Mac Preview duplicate copy; must count once.
      { id: 'stamp-1', subtype: 'Stamp', rect: [0, 0, 10, 10], hasAppearance: true },
      { id: 'sound-1', subtype: 'Sound', rect: [0, 0, 5, 5] },
      // Silently-ignored companions never count.
      { id: 'link-1', subtype: 'Link', rect: [0, 0, 5, 5] },
      { id: 'popup-1', subtype: 'Popup' },
      { id: 'widget-1', subtype: 'Widget', rect: [0, 0, 5, 5] }
    ],
    2: [
      { id: 'stamp-2', subtype: 'Stamp', rect: [0, 0, 10, 10], hasAppearance: true }
    ]
  }));

  assert.deepEqual(result.unsupportedCounts, { Stamp: 2, Sound: 1 });
  assert.deepEqual(result.unsupportedTypes.sort(), ['Sound', 'Stamp']);
});

test('importer reports zero unsupportedCounts for displayed-proxy types (sticky notes, underline/strikeout/squiggly)', async () => {
  const result = await importAnnotationsFromPdf(makeDoc({
    1: [
      { id: 'note-1', subtype: 'Text', rect: [10, 10, 30, 30], color: [1, 1, 0] },
      { id: 'ul-1', subtype: 'Underline', rect: [10, 40, 60, 45], color: [0, 0, 1], quadPoints: [[{ x: 10, y: 45 }, { x: 60, y: 45 }, { x: 10, y: 40 }, { x: 60, y: 40 }]] },
      { id: 'so-1', subtype: 'StrikeOut', rect: [10, 50, 60, 55], color: [1, 0, 0], quadPoints: [[{ x: 10, y: 55 }, { x: 60, y: 55 }, { x: 10, y: 50 }, { x: 60, y: 50 }]] }
    ]
  }));

  assert.deepEqual(result.unsupportedCounts, {});
  assert.deepEqual(result.unsupportedTypes, []);
});

test('countUnsupportedAnnotations (cloud-doc cheap scan) matches full-import classification', async () => {
  const doc = makeDoc({
    1: [
      { id: 'stamp-1', subtype: 'Stamp', rect: [0, 0, 10, 10], hasAppearance: true },
      { id: 'stamp-1', subtype: 'Stamp', rect: [0, 0, 10, 10], hasAppearance: true }, // Preview dupe
      { id: 'note-1', subtype: 'Text', rect: [10, 10, 30, 30], color: [1, 1, 0] },   // displayed proxy
      { id: 'link-1', subtype: 'Link', rect: [0, 0, 5, 5] }                            // silent companion
    ],
    2: [
      { id: 'stamp-no-ap', subtype: 'Stamp', rect: [12, 12, 24, 24], hasAppearance: false },
      { id: 'att-1', subtype: 'FileAttachment', rect: [0, 0, 8, 8] }
    ]
  });
  assert.deepEqual(await countUnsupportedAnnotations(doc), { Stamp: 1, FileAttachment: 1 });
});
