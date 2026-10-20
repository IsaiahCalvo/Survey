import test from 'node:test';
import assert from 'node:assert/strict';

import { selectEraserPreviewBaseline } from '../src/utils/eraserPreviewHandoff.js';

test('selectEraserPreviewBaseline prefers matching visible preview', () => {
  assert.equal(selectEraserPreviewBaseline({
    expectedRevision: 'r2',
    sourceRevision: 'r1',
    previewRevision: 'r2',
    previewVisible: true,
  }), 'preview');
});

test('selectEraserPreviewBaseline uses source when expected matches source', () => {
  assert.equal(selectEraserPreviewBaseline({
    expectedRevision: 'r1',
    sourceRevision: 'r1',
    previewRevision: 'r0',
    previewVisible: true,
  }), 'source');
});

test('selectEraserPreviewBaseline falls back based on preview visibility', () => {
  assert.equal(selectEraserPreviewBaseline({
    expectedRevision: 'r3',
    sourceRevision: 'r1',
    previewRevision: 'r2',
    previewVisible: true,
  }), 'preview');
  assert.equal(selectEraserPreviewBaseline({
    expectedRevision: 'r3',
    sourceRevision: 'r1',
    previewRevision: 'r2',
    previewVisible: false,
  }), 'source');
});

test('selectEraserPreviewBaseline treats missing expected as source', () => {
  assert.equal(selectEraserPreviewBaseline({
    sourceRevision: 'r1',
    previewRevision: 'r2',
    previewVisible: true,
  }), 'source');
});
