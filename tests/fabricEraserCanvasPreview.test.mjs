import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  eraserStrokeTouchesObject,
  getEraserCandidateId,
  sampleEraserStroke,
} from '../src/utils/eraserHitTest.js';
import { getEraserOperation } from '../src/utils/eraserPolicy.js';
import { isPointOnObject } from '../src/utils/geometryHitTest.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { planPageEraserPreview } from '../src/utils/eraserPreviewPlan.js';

const ERASER_SOURCE = readFileSync(
  new URL('../src/components/FabricEraserCanvas.jsx', import.meta.url),
  'utf8',
);

const loadPlanCanvasEraserHits = () => {
  const start = ERASER_SOURCE.indexOf('/* @@planCanvasEraserHits */');
  const end = ERASER_SOURCE.indexOf('/* @@planCanvasEraserHits-end */');
  assert.ok(start > -1 && end > start, 'planCanvasEraserHits block must exist in FabricEraserCanvas');
  const body = ERASER_SOURCE
    .slice(start, end)
    .replace('/* @@planCanvasEraserHits */', '');
  return new Function(
    'eraserStrokeTouchesObject',
    'getEraserCandidateId',
    'sampleEraserStroke',
    'getEraserOperation',
    'isPointOnObject',
    `${body}\nreturn planCanvasEraserHits;`,
  )(
    eraserStrokeTouchesObject,
    getEraserCandidateId,
    sampleEraserStroke,
    getEraserOperation,
    isPointOnObject,
  );
};

const planCanvasEraserHits = loadPlanCanvasEraserHits();

const ink = (id, y = 50) => createProductionPaperInk({
  id,
  tool: 'pen',
  points: [{ x: 0, y }, { x: 100, y }],
  color: '#d11b2d',
  width: 20,
});

const rect = (id, overrides = {}) => ({
  type: 'rect',
  id,
  annotationId: id,
  tool: 'rect',
  left: 20,
  top: 30,
  width: 60,
  height: 40,
  fill: '#2563eb',
  stroke: '#111111',
  strokeWidth: 2,
  data: { id },
  ...overrides,
});

const commitWithPlan = (objects, points, mode, extras = {}) => {
  const objectAllowed = extras.objectAllowed || (() => true);
  const overlayCandidates = extras.overlayCandidates || [];
  const plan = planCanvasEraserHits({
    objects,
    eraserPoints: points,
    eraserRadius: extras.eraserRadius ?? 8,
    mode,
    objectAllowed,
    overlayCandidates,
  });
  const winnerIds = new Set(plan.atomicIds);
  const result = erasePageAnnotations({
    pageAnnotations: { objects },
    eraserPoints: points,
    eraserRadius: extras.eraserRadius ?? 8,
    mode,
    canErase: (object, index) => {
      if (!objectAllowed(object, index)) return false;
      if (mode === 'entire' || mode === 'full') {
        return winnerIds.has(getEraserCandidateId(object, index));
      }
      return true;
    },
  });
  return { plan, result };
};

test('source: skip is never treated as atomic in preview or commit', () => {
  assert.match(ERASER_SOURCE, /if \(getEraserOperation\(object, 'partial'\) !== 'partial'\) return;/);
  assert.match(ERASER_SOURCE, /if \(!isEntireEraserMode\(mode\)\) return;/);
  assert.match(ERASER_SOURCE, /mode === 'partial'\) return \[\];/);
  assert.match(ERASER_SOURCE, /mode,\n    \}\);/);
});

test('source: survey-marker and callout lanes pass the live gesture mode', () => {
  assert.match(
    ERASER_SOURCE,
    /getPermittedCalloutHitIds\(eraserPoints, undefined, radius, mode\)/,
  );
  assert.match(
    ERASER_SOURCE,
    /getPermittedSurveyMarkerHitIds\(eraserPoints, undefined, radius, mode\)/,
  );
  const markerStart = ERASER_SOURCE.indexOf('const getPermittedSurveyMarkerHitIds');
  const markerEnd = ERASER_SOURCE.indexOf('const buildOverlayCandidates', markerStart);
  const markerSource = ERASER_SOURCE.slice(markerStart, markerEnd);
  assert.match(markerSource, /mode,/);
  assert.match(markerSource, /if \(mode === 'partial'\) return \[\];/);
});

test('source: entire-mode ranking uses per-sample topmost (callouts outrank markers outrank objects)', () => {
  const start = ERASER_SOURCE.indexOf('/* @@planCanvasEraserHits */');
  const end = ERASER_SOURCE.indexOf('/* @@planCanvasEraserHits-end */');
  const body = ERASER_SOURCE.slice(start, end);
  assert.match(body, /sampleEraserStroke\(eraserPoints, radius\)/);
  assert.match(body, /lane === 'callout'/);
  assert.match(body, /pdfAppearanceCompositeId/);
  assert.match(ERASER_SOURCE, /winnerObjectIds\.has\(getEraserCandidateId\(object, index\)\)/);
});

test('source: zoomGeneration and container-aware sizing stay intact', () => {
  assert.match(ERASER_SOURCE, /zoomGeneration,/);
  assert.match(ERASER_SOURCE, /setZoomGeneration|zoomGeneration === initialZoomGenerationRef/);
  assert.doesNotMatch(ERASER_SOURCE, /pageSize\s*\*\s*scale/);
  assert.match(ERASER_SOURCE, /preview\.width \/ pageWidth/);
});

test('intended use: partial ink carve — preview plan matches commit and does not delete', () => {
  const objects = [ink('ink-only')];
  const { plan, result } = commitWithPlan(objects, [{ x: 50, y: 50 }], 'partial');
  const preview = planPageEraserPreview({
    pageAnnotations: { objects },
    eraserPoints: [{ x: 50, y: 50 }],
    eraserRadius: 8,
    mode: 'partial',
  });

  assert.equal(plan.shouldPreview, true);
  assert.deepEqual(plan.atomicIds, []);
  assert.deepEqual(plan.calloutIds, []);
  assert.deepEqual(plan.surveyMarkerIds, []);
  assert.deepEqual(plan.partialIds, result.changedIds);
  assert.deepEqual(plan.atomicIds, result.deletedIds);
  assert.deepEqual(preview.partialIds, plan.partialIds);
  assert.deepEqual(preview.atomicIds, []);
});

test('break: shape-under-ink is skip — preview has no atomic ghost, commit leaves the rect', () => {
  const shape = rect('shape-under');
  const stroke = ink('ink-over');
  const point = { x: 50, y: 50 };
  assert.equal(getEraserOperation(shape, 'partial'), 'skip');
  assert.equal(
    eraserStrokeTouchesObject({ eraserPoints: [point], eraserRadius: 8, object: shape }),
    true,
  );

  const { plan, result } = commitWithPlan([shape, stroke], [point], 'partial');
  assert.deepEqual(plan.atomicIds, []);
  assert.deepEqual(plan.partialIds, result.changedIds);
  assert.deepEqual(result.deletedIds, []);
  assert.equal(result.pageAnnotations.objects[0], shape);
});

test('overlapping ink still all carves in partial; far stroke is identity-preserved', () => {
  const lower = ink('ink-lower', 50);
  const upper = ink('ink-upper', 52);
  const far = ink('ink-far', 200);
  const { plan, result } = commitWithPlan(
    [lower, upper, far],
    [{ x: 50, y: 51 }],
    'partial',
  );

  assert.deepEqual(plan.partialIds.sort(), ['ink-lower', 'ink-upper']);
  assert.deepEqual(plan.atomicIds, []);
  assert.deepEqual(result.changedIds.sort(), ['ink-lower', 'ink-upper']);
  assert.equal(result.pageAnnotations.objects[2], far);
});

test('empty stroke and locked objects: preview and commit are no-ops', () => {
  const objects = [ink('locked-ink'), rect('locked-shape')];
  const empty = commitWithPlan(objects, [], 'partial');
  assert.equal(empty.plan.shouldPreview, false);
  assert.equal(empty.result.didChange, false);

  const locked = commitWithPlan(objects, [{ x: 50, y: 50 }], 'partial', {
    objectAllowed: () => false,
  });
  assert.equal(locked.plan.shouldPreview, false);
  assert.equal(locked.result.didChange, false);
  assert.deepEqual(locked.plan.partialIds, []);
  assert.deepEqual(locked.plan.atomicIds, []);
});

test('entire mode is topmost-only: stacked rects delete the upper object only', () => {
  const bottom = rect('bottom', { left: 20, top: 30 });
  const top = rect('top', { left: 25, top: 35 });
  const point = { x: 50, y: 50 };
  const { plan, result } = commitWithPlan([bottom, top], [point], 'entire');

  assert.deepEqual(plan.atomicIds, ['top']);
  assert.deepEqual(result.deletedIds, ['top']);
  assert.equal(result.pageAnnotations.objects.length, 1);
  assert.equal(result.pageAnnotations.objects[0], bottom);
});

test('break: entire mode without topmost would delete both stacked rects', () => {
  const bottom = rect('bottom');
  const top = rect('top', { left: 25, top: 35 });
  const unrestricted = erasePageAnnotations({
    pageAnnotations: { objects: [bottom, top] },
    eraserPoints: [{ x: 50, y: 50 }],
    eraserRadius: 8,
    mode: 'entire',
  });
  assert.deepEqual(unrestricted.deletedIds.sort(), ['bottom', 'top']);

  const { result } = commitWithPlan([bottom, top], [{ x: 50, y: 50 }], 'entire');
  assert.deepEqual(result.deletedIds, ['top']);
});

test('locked top object does not shield the erasable object below', () => {
  const bottom = rect('bottom');
  const top = rect('top', { left: 25, top: 35, locked: true });
  const { plan, result } = commitWithPlan(
    [bottom, top],
    [{ x: 50, y: 50 }],
    'entire',
    { objectAllowed: (object) => object.locked !== true },
  );

  assert.deepEqual(plan.atomicIds, ['bottom']);
  assert.deepEqual(result.deletedIds, ['bottom']);
  assert.equal(result.pageAnnotations.objects[0], top);
});

test('a long drag unions topmost winners of each stack it crosses', () => {
  const stackABottom = rect('a-bottom', { left: 0, top: 0, width: 30, height: 30 });
  const stackATop = rect('a-top', { left: 0, top: 0, width: 30, height: 30 });
  const stackBBottom = rect('b-bottom', { left: 80, top: 0, width: 30, height: 30 });
  const stackBTop = rect('b-top', { left: 80, top: 0, width: 30, height: 30 });
  const { plan, result } = commitWithPlan(
    [stackABottom, stackATop, stackBBottom, stackBTop],
    [{ x: 15, y: 15 }, { x: 95, y: 15 }],
    'entire',
  );

  assert.deepEqual(plan.atomicIds.sort(), ['a-top', 'b-top']);
  assert.deepEqual(result.deletedIds.sort(), ['a-top', 'b-top']);
  assert.equal(result.pageAnnotations.objects.length, 2);
});

test('callout overlay outranks objects[] at the same sample', () => {
  const shape = rect('under-callout');
  const overlay = {
    id: 'callout-1',
    lane: 'callout',
    laneRank: 2,
    rank: 0,
    hitsSample: () => true,
  };
  const { plan, result } = commitWithPlan(
    [shape],
    [{ x: 50, y: 50 }],
    'entire',
    { overlayCandidates: [overlay] },
  );

  assert.deepEqual(plan.atomicIds, []);
  assert.deepEqual(plan.calloutIds, ['callout-1']);
  assert.deepEqual(result.deletedIds, []);
  assert.equal(result.pageAnnotations.objects[0], shape);
});

test('survey marker overlay outranks objects[] but loses to a callout', () => {
  const shape = rect('under-marker');
  const marker = {
    id: 'marker-1',
    lane: 'marker',
    laneRank: 1,
    rank: 0,
    hitsSample: () => true,
  };
  const callout = {
    id: 'callout-1',
    lane: 'callout',
    laneRank: 2,
    rank: 0,
    hitsSample: () => true,
  };

  const markerOnly = commitWithPlan([shape], [{ x: 50, y: 50 }], 'entire', {
    overlayCandidates: [marker],
  });
  assert.deepEqual(markerOnly.plan.surveyMarkerIds, ['marker-1']);
  assert.deepEqual(markerOnly.plan.atomicIds, []);

  const both = commitWithPlan([shape], [{ x: 50, y: 50 }], 'entire', {
    overlayCandidates: [marker, callout],
  });
  assert.deepEqual(both.plan.calloutIds, ['callout-1']);
  assert.deepEqual(both.plan.surveyMarkerIds, []);
  assert.deepEqual(both.plan.atomicIds, []);
});

test('imported appearance composite deletes as one unit ranked by its highest member', () => {
  const lower = rect('comp-lower', {
    data: { id: 'comp-lower', pdfAppearanceCompositeId: 'group-a' },
  });
  const upper = rect('comp-upper', {
    left: 25,
    top: 35,
    data: { id: 'comp-upper', pdfAppearanceCompositeId: 'group-a' },
  });
  const neighbor = rect('neighbor', { left: 200, top: 30 });
  const { plan, result } = commitWithPlan(
    [lower, upper, neighbor],
    [{ x: 50, y: 50 }],
    'entire',
  );

  assert.deepEqual(plan.atomicIds.sort(), ['comp-lower', 'comp-upper']);
  assert.deepEqual(result.deletedIds.sort(), ['comp-lower', 'comp-upper']);
  assert.equal(result.pageAnnotations.objects[0], neighbor);
});

test('partial mode never collects overlay or atomic ids even when overlays report hits', () => {
  const shape = rect('shape');
  const stroke = ink('ink');
  const overlay = {
    id: 'callout-1',
    lane: 'callout',
    laneRank: 2,
    rank: 0,
    hitsSample: () => true,
  };
  const { plan } = commitWithPlan([shape, stroke], [{ x: 50, y: 50 }], 'partial', {
    overlayCandidates: [overlay],
  });
  assert.deepEqual(plan.atomicIds, []);
  assert.deepEqual(plan.calloutIds, []);
  assert.deepEqual(plan.surveyMarkerIds, []);
  assert.ok(plan.partialIds.includes('ink'));
});
