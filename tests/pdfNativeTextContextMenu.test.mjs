import test from 'node:test';
import assert from 'node:assert/strict';

import { selectionUsesPdfTextLayer } from '../src/utils/pdfNativeTextInteraction.js';

const node = (selectorMatch) => ({
  nodeType: 1,
  closest(selector) {
    return selector === '.pdfjsTextLayer, .textLayer' && selectorMatch ? this : null;
  },
});

test('a live PDF text selection keeps the native context menu', () => {
  assert.equal(selectionUsesPdfTextLayer({ isCollapsed: false, anchorNode: node(true) }), true);
});

test('collapsed or off-page selections still use the app context menu', () => {
  assert.equal(selectionUsesPdfTextLayer({ isCollapsed: true, anchorNode: node(true) }), false);
  assert.equal(selectionUsesPdfTextLayer({ isCollapsed: false, anchorNode: node(false) }), false);
});
