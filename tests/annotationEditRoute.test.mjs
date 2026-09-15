import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAnnotationEditType,
  opensTextEditor,
  resolveEditTypeForAnnotation,
} from '../src/utils/annotationEditRoute.js';

test('fabric 7 capitalized types normalize to the lowercase contract', () => {
  assert.equal(normalizeAnnotationEditType('Textbox'), 'textbox');
  assert.equal(normalizeAnnotationEditType('IText'), 'i-text');
  assert.equal(normalizeAnnotationEditType('itext'), 'i-text');
  assert.equal(normalizeAnnotationEditType('i-text'), 'i-text');
  assert.equal(normalizeAnnotationEditType(undefined), '');
});

test('text types open the inline caret editor, from either type source', () => {
  for (const type of ['textbox', 'Textbox', 'i-text', 'IText', 'text']) {
    assert.equal(resolveEditTypeForAnnotation({ type }).editType, 'text', type);
    // and when the caller passes the type explicitly
    assert.equal(resolveEditTypeForAnnotation({ type: 'path' }, type).editType, 'text', type);
  }
  assert.equal(opensTextEditor({ type: 'Textbox' }), true);
});

test('pen / highlighter strokes and plain shapes open nothing', () => {
  for (const type of ['path', 'rect', 'circle', 'ellipse', 'triangle']) {
    const route = resolveEditTypeForAnnotation({ type });
    assert.equal(route.editType, null, type);
    assert.ok(route.skipReason, `${type} must report why it was skipped`);
    assert.equal(opensTextEditor({ type }), false);
  }
});

test('counters, lines and polys open the bbox transform chrome', () => {
  assert.equal(resolveEditTypeForAnnotation({ type: 'line' }).editType, 'bbox');
  assert.equal(resolveEditTypeForAnnotation({ type: 'polygon' }).editType, 'bbox');
  assert.equal(resolveEditTypeForAnnotation({ type: 'polyline' }).editType, 'bbox');
  // A counter is a rect/circle carrying data.type === 'counter' — it must beat
  // the plain-shape no-op branch.
  const counter = { type: 'rect', data: { type: 'counter' } };
  assert.equal(resolveEditTypeForAnnotation(counter).editType, 'bbox');
  assert.equal(resolveEditTypeForAnnotation(counter).isCounter, true);
  assert.equal(opensTextEditor(counter), false);
});

test('unknown types are an explicit no-op, never a callout fallthrough (KAL-125 / CD-6)', () => {
  for (const type of ['image', 'stamp', 'group', '', undefined]) {
    const route = resolveEditTypeForAnnotation({ type });
    assert.equal(route.editType, null, String(type));
    assert.equal(route.skipReason, 'unhandled type', String(type));
  }
  assert.equal(resolveEditTypeForAnnotation(null).editType, null);
});
