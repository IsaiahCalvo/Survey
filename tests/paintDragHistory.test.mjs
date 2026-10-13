/*
 * UX 2026-09-23 (smooth sliders, review fix): a colour-slider drag's one undo
 * step must revert the drag and NOTHING else. A collaborator who moves or adds
 * a mark on the same page mid-drag must not have it undone by our Undo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { collectChangedObjectKeys, restoreTouchedObjects } from '../src/utils/paintDragHistory.js';
import { buildAnnotationHistoryAction } from '../src/utils/annotationLocalHistory.js';

const rect = (id, extra = {}) => ({ type: 'rect', id, data: { id }, left: 10, top: 10, width: 20, height: 20, fill: '#ff0000', ...extra });

test('a slider drag records only its own object even when a collaborator edited the page mid-drag', () => {
  // First preview frame: the page was {A, B}.
  const baseline = { objects: [rect('A', { fill: 'rgba(0, 0, 255, 0.8)' }), rect('B')] };
  // The drag's frames edited A only.
  const firstFrame = { objects: [rect('A', { fill: 'rgba(0, 0, 255, 0.5)' }), rect('B')] };
  const touched = collectChangedObjectKeys(baseline, firstFrame);
  assert.deepEqual([...touched], ['A']);
  // Meanwhile a collaborator moved B and added C.
  const current = { objects: [rect('A', { fill: 'rgba(0, 0, 255, 0.5)' }), rect('B', { left: 90 }), rect('C')] };
  // Release: A lands on 30%.
  const next = { objects: [rect('A', { fill: 'rgba(0, 0, 255, 0.3)' }), rect('B', { left: 90 }), rect('C')] };
  collectChangedObjectKeys(current, next).forEach((key) => touched.add(key));

  // The old way (whole-page snapshot) folds the collaborator's work in.
  const wholePage = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: baseline, nextPage: next });
  assert.ok(JSON.stringify(wholePage).includes('"C"'), 'sanity: the whole-page diff sees C');

  const previous = restoreTouchedObjects(current, baseline, touched);
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: previous, nextPage: next });
  const text = JSON.stringify(action);
  assert.ok(action, 'the drag still records a step');
  assert.ok(text.includes('rgba(0, 0, 255, 0.8)'), 'undo goes back to the pre-drag paint');
  assert.ok(!text.includes('"C"'), 'the collaborator\'s new mark is not in our step');
  assert.ok(!text.includes('"left":90'), 'the collaborator\'s move is not in our step');
  // Restored page keeps the collaborator's objects exactly.
  assert.deepEqual(previous.objects.map((o) => o.id), ['A', 'B', 'C']);
  assert.equal(previous.objects[1].left, 90);
});

test('the viewer builds the release step from the current page, and drops leftover snapshots', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /\(previewBaseline && paintPhaseNow === 'commit'\)\s*\?\s*restoreTouchedObjects\(/);
  assert.match(viewer, /paintDragTouchedByPageRef\.current\.forEach\(\(_keys, pageKey\) => \{\s*previewBaselineByPageRef\.current\.delete\(pageKey\);/);
});
