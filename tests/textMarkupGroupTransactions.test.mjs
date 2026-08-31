import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAnnotationHistoryAction,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import {
  buildAtomicTextMarkupPageMutation,
  buildTextMarkupGroupCreateTransaction,
  buildTextMarkupPaintEditTransaction,
  buildTextMarkupRangeToggleOffTransaction,
  expandTextMarkupEraseIntent,
  getTextMarkupRangeTypes,
  isExactTextMarkupDuplicate,
  preserveTextMarkupRangeResizeSiblings,
} from '../src/utils/textMarkupGroupTransactions.js';

const mark = (id, pageNumber, group = 'range-1', markupType = 'highlight') => ({
  type: 'group',
  data: {
    id,
    type: 'text-markup',
    pageNumber,
    selectionGroupId: group,
    markupType,
    textRange: { start: 5, end: 12 },
    quads: [{ x1: 10, y1: 20, x2: 60, y2: 20, x3: 10, y3: 30, x4: 60, y4: 30 }],
  },
  meta: { authorId: 'user-1' },
});

test('the same text range keeps each review type as its own stacked annotation', () => {
  const highlight = mark('highlight', 1, 'highlight-group', 'highlight');
  const underline = mark('underline', 1, 'underline-group', 'underline');
  const squiggly = mark('squiggly', 1, 'squiggly-group', 'squiggly');
  const strikeout = mark('strikeout', 1, 'strikeout-group', 'strikeout');
  const tx = buildTextMarkupGroupCreateTransaction(
    { 1: { objects: [highlight] } },
    [underline, squiggly, strikeout],
  );

  assert.deepEqual(
    tx.nextByPage['1'].objects.map((item) => item.data.markupType),
    ['highlight', 'underline', 'squiggly', 'strikeout'],
  );
  assert.equal(tx.created.length, 3);
  assert.equal(isExactTextMarkupDuplicate(highlight, underline), false);
});

test('an exact same-range same-type repeat is not added twice', () => {
  const first = mark('first', 1, 'first-group', 'highlight');
  const duplicate = mark('duplicate', 1, 'second-group', 'highlight');
  const tx = buildTextMarkupGroupCreateTransaction({ 1: { objects: [first] } }, [duplicate]);

  assert.equal(tx, null);
  assert.equal(isExactTextMarkupDuplicate(first, duplicate), true);
});

test('same-range same-type marks remain distinct when paint or overlap differs', () => {
  const first = mark('first', 1, 'first-group', 'highlight');
  first.stroke = '#ff0000';
  first.opacity = 0.3;
  first.data.overlapMode = 'layered';
  const recolored = { ...mark('recolored', 1, 'color-group', 'highlight'), stroke: '#0000ff', opacity: 0.3 };
  const uniform = {
    ...mark('uniform', 1, 'uniform-group', 'highlight'),
    stroke: '#ff0000',
    opacity: 0.3,
    data: { ...mark('uniform', 1, 'uniform-group', 'highlight').data, overlapMode: 'uniform' },
  };
  const tx = buildTextMarkupGroupCreateTransaction({ 1: { objects: [first] } }, [recolored, uniform]);

  assert.equal(tx.created.length, 2);
  assert.equal(isExactTextMarkupDuplicate(first, recolored), false);
  assert.equal(isExactTextMarkupDuplicate(first, uniform), false);
});

test('same-range review marks report every active toggle', () => {
  const highlight = mark('highlight', 1, 'highlight-group', 'highlight');
  const underline = mark('underline', 1, 'underline-group', 'underline');
  const squiggly = mark('squiggly', 1, 'squiggly-group', 'squiggly');
  const strikeout = mark('strikeout', 1, 'strikeout-group', 'strikeout');
  const link = mark('link', 1, 'link-group', 'link');
  link.data.linkUrl = 'https://example.com/one';
  const redact = mark('redact', 1, 'redact-group', 'redact');
  const types = getTextMarkupRangeTypes({
    1: { objects: [highlight, underline, squiggly, strikeout, link, redact] },
  }, [highlight]);

  assert.deepEqual(types, ['highlight', 'underline', 'squiggly', 'strikeout', 'link', 'redact']);
});

test('same-range links with different URLs stay distinct', () => {
  const first = mark('link-one', 1, 'link-one-group', 'link');
  first.data.linkUrl = 'https://example.com/one';
  const second = mark('link-two', 1, 'link-two-group', 'link');
  second.data.linkUrl = 'https://example.com/two';
  const tx = buildTextMarkupGroupCreateTransaction({ 1: { objects: [first] } }, [second]);

  assert.equal(tx.created.length, 1);
  assert.equal(isExactTextMarkupDuplicate(first, second), false);
});

test('turning off one review toggle removes only that full group', () => {
  const pageOneHighlight = mark('highlight-1', 1, 'highlight-group', 'highlight');
  const pageTwoHighlight = mark('highlight-2', 2, 'highlight-group', 'highlight');
  const pageOneUnderline = mark('underline-1', 1, 'underline-group', 'underline');
  const pageTwoUnderline = mark('underline-2', 2, 'underline-group', 'underline');
  const pageOneSquiggly = mark('squiggly-1', 1, 'squiggly-group', 'squiggly');
  const before = {
    1: { objects: [pageOneHighlight, pageOneUnderline, pageOneSquiggly] },
    2: { objects: [pageTwoHighlight, pageTwoUnderline] },
  };
  const tx = buildTextMarkupRangeToggleOffTransaction(
    before,
    [pageOneHighlight, pageTwoHighlight],
    'highlight',
  );

  assert.ok(tx);
  assert.equal(tx.action.type, 'fabric:document-batch');
  assert.deepEqual(tx.removedSelectionGroupIds, ['highlight-group']);
  assert.deepEqual(tx.selectionGroupIds, ['highlight-group']);
  assert.deepEqual(tx.nextByPage['1'].objects, [pageOneUnderline, pageOneSquiggly]);
  assert.deepEqual(tx.nextByPage['2'].objects, [pageTwoUnderline]);
});

test('turning off an inactive review toggle is a no-op', () => {
  const highlight = mark('highlight', 1, 'highlight-group', 'highlight');
  assert.equal(
    buildTextMarkupRangeToggleOffTransaction(
      { 1: { objects: [highlight] } },
      [highlight],
      'underline',
    ),
    null,
  );
});

test('cross-page text markup creation is one document history action', () => {
  const tx = buildTextMarkupGroupCreateTransaction({}, [mark('a', 1), mark('b', 2)]);
  assert.equal(tx.action.type, 'fabric:document-batch');
  assert.equal(tx.action.actions.length, 2);
  assert.deepEqual(tx.created.map((entry) => entry.pageNumber), [1, 2]);

  const undone = applyAnnotationHistoryAction(tx.nextByPage, invertAnnotationHistoryAction(tx.action));
  assert.equal(undone['1'].objects.length, 0);
  assert.equal(undone['2'].objects.length, 0);
  const redone = applyAnnotationHistoryAction(undone, tx.action);
  assert.equal(redone['1'].objects[0].data.id, 'a');
  assert.equal(redone['2'].objects[0].data.id, 'b');
});

test('undo and redo keep each stacked mark paint and overlap mode', () => {
  const paints = [
    ['highlight', '#ff0000', 0.3, 'layered'],
    ['underline', '#00ff00', 0.45, 'uniform'],
    ['squiggly', '#0000ff', 0.6, 'layered'],
    ['strikeout', '#ffff00', 0.75, 'uniform'],
  ];
  const marks = paints.map(([markupType, color, opacity, overlapMode], index) => {
    const annotation = mark(`paint-${index}`, 1, `paint-group-${index}`, markupType);
    annotation.fill = color;
    annotation.stroke = color;
    annotation.opacity = opacity;
    annotation.data.overlapMode = overlapMode;
    return annotation;
  });
  const tx = buildTextMarkupGroupCreateTransaction({}, marks);
  const undone = applyAnnotationHistoryAction(tx.nextByPage, invertAnnotationHistoryAction(tx.action));
  const redone = applyAnnotationHistoryAction(undone, tx.action);

  assert.deepEqual(redone['1'].objects.map((annotation) => ({
    markupType: annotation.data.markupType,
    fill: annotation.fill,
    stroke: annotation.stroke,
    opacity: annotation.opacity,
    overlapMode: annotation.data.overlapMode,
  })), paints.map(([markupType, color, opacity, overlapMode]) => ({
    markupType, fill: color, stroke: color, opacity, overlapMode,
  })));
});

test('editing the active stacked mark paint leaves every sibling byte-identical', () => {
  const paints = [
    ['highlight', '#f5c229'],
    ['underline', '#ef3029'],
    ['squiggly', '#f0f1f4'],
    ['strikeout', '#3d63dc'],
  ];
  const marks = paints.map(([markupType, color], index) => {
    const annotation = mark(`paint-edit-${index}`, 1, `${markupType}-group`, markupType);
    annotation.fill = color;
    annotation.stroke = color;
    annotation.opacity = 0.3;
    annotation.data.overlapMode = 'layered';
    return annotation;
  });
  const before = { 1: { objects: marks } };
  const siblingBytes = marks.slice(0, 3).map((annotation) => JSON.stringify(annotation));

  const tx = buildTextMarkupPaintEditTransaction({
    annotationsByPage: before,
    annotation: marks[3],
    color: '#0000FF',
    opacity: 0.65,
  });

  assert.ok(tx);
  assert.deepEqual(
    tx.nextByPage['1'].objects.slice(0, 3).map((annotation) => JSON.stringify(annotation)),
    siblingBytes,
  );
  assert.deepEqual(
    tx.nextByPage['1'].objects[3],
    { ...marks[3], fill: '#0000FF', stroke: '#0000FF', opacity: 0.65 },
  );
  const undone = applyAnnotationHistoryAction(tx.nextByPage, invertAnnotationHistoryAction(tx.action));
  assert.deepEqual(undone, before);
  const redone = applyAnnotationHistoryAction(undone, tx.action);
  assert.deepEqual(redone, tx.nextByPage);
  assert.deepEqual(JSON.parse(JSON.stringify(redone)), tx.nextByPage);
});

test('resizing one stacked range leaves every sibling record byte-identical', () => {
  const interactionFlags = {
    selectable: true,
    evented: true,
    hasControls: false,
    hasBorders: true,
    lockMovementX: true,
    lockMovementY: true,
  };
  const siblings = ['highlight', 'underline', 'squiggly', 'strikeout'].map((markupType, index) => ({
    ...mark(`range-resize-${index}`, 1, `${markupType}-group`, markupType),
    ...interactionFlags,
  }));
  const before = { objects: siblings };
  const activeIndex = 2;
  const resizedActive = {
    ...siblings[activeIndex],
    data: {
      ...siblings[activeIndex].data,
      textRange: { start: 2, end: 15 },
      quads: [{ x1: 4, y1: 20, x2: 78, y2: 20, x3: 4, y3: 30, x4: 78, y4: 30 }],
    },
  };
  const incoming = {
    objects: siblings.map((annotation, index) => (
      index === activeIndex ? resizedActive : structuredClone(annotation)
    )),
  };
  const siblingBytes = siblings.map((annotation) => JSON.stringify(annotation));

  const next = preserveTextMarkupRangeResizeSiblings({
    previousPage: before,
    nextPage: incoming,
    activeAnnotationId: resizedActive.data.id,
    activeAnnotationIndex: activeIndex,
  });

  siblings.forEach((annotation, index) => {
    if (index === activeIndex) return;
    assert.equal(next.objects[index], annotation);
    assert.equal(JSON.stringify(next.objects[index]), siblingBytes[index]);
  });
  assert.deepEqual(next.objects[activeIndex], resizedActive);
  assert.deepEqual(
    Object.fromEntries(Object.keys(interactionFlags).map((key) => [key, next.objects[activeIndex][key]])),
    interactionFlags,
  );
});

test('deleting one page member deletes the full selection group as one action', () => {
  const keep = { type: 'rect', data: { id: 'keep' }, meta: { authorId: 'user-1' } };
  const before = {
    1: { objects: [keep, mark('a', 1)] },
    2: { objects: [mark('b', 2)] },
    3: { objects: [mark('other', 3, 'range-2')] },
  };
  const tx = buildAtomicTextMarkupPageMutation({
    annotationsByPage: before,
    pageNumber: 1,
    nextPage: { objects: [keep] },
  });
  assert.equal(tx.action.type, 'fabric:document-batch');
  assert.deepEqual(tx.selectionGroupIds, ['range-1']);
  assert.deepEqual(tx.nextByPage['1'].objects.map((item) => item.data.id), ['keep']);
  assert.equal(tx.nextByPage['2'].objects.length, 0);
  assert.equal(tx.nextByPage['3'].objects[0].data.id, 'other');

  const restored = applyAnnotationHistoryAction(tx.nextByPage, invertAnnotationHistoryAction(tx.action));
  assert.deepEqual(restored['1'].objects.map((item) => item.data.id), ['keep', 'a']);
  assert.equal(restored['2'].objects[0].data.id, 'b');
  const deletedAgain = applyAnnotationHistoryAction(restored, tx.action);
  assert.equal(deletedAgain['1'].objects.some((item) => item.data.selectionGroupId === 'range-1'), false);
  assert.equal(deletedAgain['2'].objects.some((item) => item.data.selectionGroupId === 'range-1'), false);
});

test('an eraser page mutation keeps unrelated page edits in the same atomic action', () => {
  const before = {
    1: { objects: [mark('a', 1), { type: 'path', data: { id: 'ink' }, left: 1, meta: { authorId: 'user-1' } }] },
    2: { objects: [mark('b', 2)] },
  };
  const tx = buildAtomicTextMarkupPageMutation({
    annotationsByPage: before,
    pageNumber: 1,
    nextPage: { objects: [{ type: 'path', data: { id: 'ink' }, left: 4, meta: { authorId: 'user-1' } }] },
  });
  assert.equal(tx.action.type, 'fabric:document-batch');
  assert.equal(tx.nextByPage['1'].objects[0].left, 4);
  assert.equal(tx.nextByPage['2'].objects.length, 0);
  const restored = applyAnnotationHistoryAction(tx.nextByPage, invertAnnotationHistoryAction(tx.action));
  assert.equal(restored['1'].objects.find((item) => item.data.id === 'ink').left, 1);
  assert.equal(restored['2'].objects[0].data.id, 'b');
});

test('registered-document erase intent adds every cross-page group member', () => {
  const before = {
    1: { objects: [mark('a', 1)] },
    2: { objects: [mark('b', 2), mark('other', 2, 'range-2')] },
  };
  const expanded = expandTextMarkupEraseIntent({
    mutationId: 'erase-1',
    pageNumber: 1,
    targets: [{
      domain: 'page-object',
      kind: 'text-markup',
      operation: 'delete',
      pageNumber: 1,
      index: 0,
      storageKey: 'a',
      before: mark('a', 1),
    }],
    sideEffects: [{ type: 'annotation-delete-history' }, { type: 'keep-me' }],
  }, before);
  assert.deepEqual(expanded.targets.map((target) => target.storageKey), ['a', 'b']);
  assert.deepEqual(expanded.targets.map((target) => target.pageNumber), [1, 2]);
  assert.deepEqual(expanded.sideEffects, [{ type: 'keep-me' }]);
  assert.deepEqual(expanded.diagnostics.textMarkupSelectionGroupIds, ['range-1']);
});
