import test from 'node:test';
import assert from 'node:assert/strict';

import {
  categorizeAnnotations,
  convertPdfAnnotationToFabric,
  importAnnotationsFromPdf,
} from '../src/utils/pdfAnnotationImporter.js';
import { getTextMarkupSelectionChrome } from '../src/utils/pdfTextMarkup.js';

const viewport = {
  width: 200,
  height: 100,
  convertToViewportPoint(x, y) {
    return [x, 100 - y];
  },
};

const textContent = {
  items: [{
    str: 'Selectable words',
    transform: [10, 0, 0, 10, 10, 80],
    width: 80,
    height: 10,
    dir: 'ltr',
  }],
};

const quadPoints = [10, 90, 90, 90, 10, 80, 90, 80];

for (const subtype of ['Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Link', 'Redact']) {
  test(`imported ${subtype} becomes one native text-range annotation`, () => {
    const annotation = convertPdfAnnotationToFabric({
      id: `${subtype.toLowerCase()}-1`,
      subtype,
      rect: [10, 80, 90, 90],
      quadPoints,
      color: [1, 0, 0],
      ...(subtype === 'Link' ? { url: 'https://example.com/spec' } : {}),
    }, viewport, 1, null, { pageNumber: 1, textContent });

    assert.ok(annotation);
    assert.equal(annotation.type, 'group');
    assert.equal(annotation.data.type, 'text-markup');
    assert.equal(annotation.data.markupType, subtype === 'StrikeOut' ? 'strikeout' : subtype.toLowerCase());
    assert.deepEqual(annotation.data.textRange, { start: 0, end: 16 });
    assert.equal(annotation.data.textRangeModel.text, 'Selectable words');
    assert.equal(annotation.data.selectedText, 'Selectable words');
    assert.equal(annotation.isPdfImported, true);
    assert.equal(annotation.pdfAnnotationId, `${subtype.toLowerCase()}-1`);
    assert.deepEqual(getTextMarkupSelectionChrome(annotation), {
      hideBoundingBox: true,
      hideResizeHandles: false,
    });
  });
}

test('an imported text mark with no matching PDF text cannot stretch off text', () => {
  const annotation = convertPdfAnnotationToFabric({
    id: 'unmatched-underline',
    subtype: 'Underline',
    rect: [120, 10, 180, 20],
    quadPoints: [120, 20, 180, 20, 120, 10, 180, 10],
    color: [1, 0, 0],
  }, viewport, 1, null, { pageNumber: 1, textContent });

  assert.equal(annotation.data.type, 'text-markup');
  assert.equal(annotation.data.textRange, undefined);
  assert.equal(annotation.data.textRangeModel, undefined);
  assert.deepEqual(getTextMarkupSelectionChrome(annotation), {
    hideBoundingBox: false,
    hideResizeHandles: true,
  });
});

test('the page importer converts all six PDF text-markup subtypes through one native path', async () => {
  const subtypes = ['Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Link', 'Redact'];
  const annotations = subtypes.map((subtype) => ({
    id: `${subtype.toLowerCase()}-page-import`,
    subtype,
    rect: [10, 80, 90, 90],
    quadPoints,
    color: [1, 0, 0],
    hasAppearance: true,
    ...(subtype === 'Link' ? { url: 'https://example.com/spec' } : {}),
  }));
  const page = {
    getViewport() { return viewport; },
    async getAnnotations() { return annotations; },
    streamTextContent() {
      let sent = false;
      return { getReader: () => ({ read: async () => {
        if (sent) return { done: true };
        sent = true;
        return { done: false, value: { items: textContent.items, styles: {}, lang: 'en' } };
      } }) };
    },
  };
  const result = await importAnnotationsFromPdf({
    numPages: 1,
    async getPage() { return page; },
  });
  const imported = result.annotationsByPage[1].objects;

  assert.equal(imported.length, 6);
  assert.deepEqual(imported.map((annotation) => annotation.data.markupType), [
    'highlight', 'underline', 'strikeout', 'squiggly', 'link', 'redact',
  ]);
  assert.ok(imported.every((annotation) => annotation.data.textRangeModel?.runs?.length === 1));
  assert.deepEqual(categorizeAnnotations(annotations).unsupported, []);
});
