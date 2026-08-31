import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  captureNativeSelectionSnapshot,
  getCaretBoundaryFromClientPoint,
  repairCollapsedTextDragSelection,
} from '../src/utils/nativeTextDragSelection.js';

const setup = () => {
  const dom = new JSDOM(`<!doctype html>
    <div class="pdfjsTextLayer is-interactive">
      <span>Selectable line one on page 4.</span>
    </div>`, { pretendToBeVisual: true });
  const { document } = dom.window;
  const textNode = document.querySelector('span').firstChild;
  document.caretPositionFromPoint = (x) => ({
    offsetNode: textNode,
    offset: x < 50 ? 1 : 29,
  });
  return { dom, document, textNode };
};

test('repairs an empty rotated text drag into a native browser range', () => {
  const { dom, document, textNode } = setup();
  const selection = dom.window.getSelection();
  selection.removeAllRanges();

  const start = getCaretBoundaryFromClientPoint(document, 10, 40);
  const repaired = repairCollapsedTextDragSelection({
    documentRef: document,
    windowRef: dom.window,
    startBoundary: start,
    endClientPoint: { x: 90, y: 40 },
  });

  assert.equal(repaired, true);
  assert.equal(selection.isCollapsed, false);
  assert.equal(selection.toString(), 'electable line one on page 4');
  assert.equal(selection.getRangeAt(0).startContainer, textNode);
  assert.equal(selection.getRangeAt(0).startOffset, 1);
  assert.equal(selection.getRangeAt(0).endOffset, 29);
});

test('keeps a valid native selection unchanged', () => {
  const { dom, document, textNode } = setup();
  const selection = dom.window.getSelection();
  const selectionSnapshot = captureNativeSelectionSnapshot(selection);
  const nativeRange = document.createRange();
  nativeRange.setStart(textNode, 3);
  nativeRange.setEnd(textNode, 12);
  selection.addRange(nativeRange);

  const start = getCaretBoundaryFromClientPoint(document, 10, 40);
  const repaired = repairCollapsedTextDragSelection({
    documentRef: document,
    windowRef: dom.window,
    selectionSnapshot,
    startBoundary: start,
    endClientPoint: { x: 90, y: 40 },
  });

  assert.equal(repaired, false);
  assert.equal(selection.toString(), 'ectable l');
  assert.equal(selection.getRangeAt(0).startOffset, 3);
  assert.equal(selection.getRangeAt(0).endOffset, 12);
});

test('replaces an unchanged stale selection after a drag on another page', () => {
  const { dom, document, textNode } = setup();
  const oldLayer = document.createElement('div');
  oldLayer.className = 'pdfjsTextLayer is-interactive';
  oldLayer.innerHTML = '<span>Old RTL selection</span>';
  document.body.prepend(oldLayer);
  const oldTextNode = oldLayer.querySelector('span').firstChild;
  const selection = dom.window.getSelection();
  const oldRange = document.createRange();
  oldRange.setStart(oldTextNode, 0);
  oldRange.setEnd(oldTextNode, oldTextNode.nodeValue.length);
  selection.addRange(oldRange);
  const selectionSnapshot = captureNativeSelectionSnapshot(selection);

  const start = getCaretBoundaryFromClientPoint(document, 10, 40);
  const repaired = repairCollapsedTextDragSelection({
    documentRef: document,
    windowRef: dom.window,
    selectionSnapshot,
    startBoundary: start,
    endClientPoint: { x: 90, y: 40 },
  });

  assert.equal(repaired, true);
  assert.equal(selection.toString(), 'electable line one on page 4');
  assert.equal(selection.getRangeAt(0).startContainer, textNode);
});

test('orders a reverse-direction drag without losing the range', () => {
  const { dom, document } = setup();
  const selection = dom.window.getSelection();
  const start = getCaretBoundaryFromClientPoint(document, 90, 40);

  const repaired = repairCollapsedTextDragSelection({
    documentRef: document,
    windowRef: dom.window,
    startBoundary: start,
    endClientPoint: { x: 10, y: 40 },
  });

  assert.equal(repaired, true);
  assert.equal(selection.toString(), 'electable line one on page 4');
  assert.equal(selection.getRangeAt(0).startOffset, 1);
  assert.equal(selection.getRangeAt(0).endOffset, 29);
});

test('uses the WebKit caret range API when caretPositionFromPoint is absent', () => {
  const { dom, document, textNode } = setup();
  delete document.caretPositionFromPoint;
  document.caretRangeFromPoint = () => {
    const range = document.createRange();
    range.setStart(textNode, 8);
    range.collapse(true);
    return range;
  };

  assert.deepEqual(getCaretBoundaryFromClientPoint(document, 10, 40), {
    node: textNode,
    offset: 8,
  });
});

test('does not create a range outside an interactive PDF text layer', () => {
  const { dom, document, textNode } = setup();
  const outside = document.createElement('div');
  outside.textContent = 'Outside';
  document.body.appendChild(outside);
  const selection = dom.window.getSelection();
  document.caretPositionFromPoint = () => ({ offsetNode: outside.firstChild, offset: 3 });

  const repaired = repairCollapsedTextDragSelection({
    documentRef: document,
    windowRef: dom.window,
    startBoundary: { node: textNode, offset: 1 },
    endClientPoint: { x: 90, y: 40 },
  });

  assert.equal(repaired, false);
  assert.equal(selection.rangeCount, 0);
});
