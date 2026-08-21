import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const OVERLAY_SOURCE = readFileSync(new URL('../src/components/TextEditOverlay.jsx', import.meta.url), 'utf8');
const VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('P1-07: existing text commit re-resolves the target by id, not the frozen index', () => {
  const start = OVERLAY_SOURCE.indexOf('function replaceTextInPageJson');
  assert.ok(start > -1);
  const body = OVERLAY_SOURCE.slice(start, start + 900);
  assert.match(body, /updated\.objects\.findIndex/);
  assert.match(body, /const targetId = \(original\?\.data && original\.data\.id\)/);
  assert.match(OVERLAY_SOURCE, /replaceTextInPageJson\(annotations, annotationIndex, liveJson, originalRef\.current\)/);
  assert.equal(body.includes('else updated.objects[annotationIndex] = json;'), false);
  assert.match(OVERLAY_SOURCE, /onEditCancel/);
});

test('P1-15: callout text commit merges text/bounds onto the live entry', () => {
  const start = VIEWER_SOURCE.indexOf("source: 'callout:edit-commit'");
  assert.ok(start > -1);
  const body = VIEWER_SOURCE.slice(start - 900, start + 200);
  assert.match(body, /textBoxPosition: updatedReactCallout\.textBoxPosition/);
  assert.match(body, /\.\.\.c,/);
  assert.equal(body.includes('c.id === editingAnnotation.reactCalloutId ? updatedReactCallout : c'), false);
});
