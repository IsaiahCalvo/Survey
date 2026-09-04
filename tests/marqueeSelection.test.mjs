/**
 * Phase 19 — AutoCAD Window + Crossing Selection
 * Marquee math tests: direction detection, AABB containment, hit resolution.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_DRAG_PX,
  cycleMarqueeDirection,
  getMarqueeDirection,
  getMarqueeRect,
  isBBoxFullyContained,
  isBBoxOverlapping,
  resolveMarqueeHits,
} from '../src/utils/marqueeSelection.js';

test('MIN_DRAG_PX is 5 (matches dormant reference)', () => {
  assert.equal(MIN_DRAG_PX, 5);
});

test('getMarqueeDirection: endX >= startX is window (left to right)', () => {
  assert.equal(getMarqueeDirection({ startX: 10, endX: 50 }), 'window');
  assert.equal(getMarqueeDirection({ startX: 10, endX: 10 }), 'window');
});

test('getMarqueeDirection: endX < startX is crossing (right to left)', () => {
  assert.equal(getMarqueeDirection({ startX: 50, endX: 10 }), 'crossing');
});

test('Space override switches rectangle selection between window and crossing', () => {
  assert.equal(cycleMarqueeDirection('window'), 'crossing');
  assert.equal(cycleMarqueeDirection('crossing'), 'window');
  assert.equal(getMarqueeDirection({ startX: 10, endX: 50, modeOverride: 'crossing' }), 'crossing');
  assert.equal(getMarqueeDirection({ startX: 50, endX: 10, modeOverride: 'window' }), 'window');
});

test('getMarqueeRect: normalizes regardless of drag direction', () => {
  const r1 = getMarqueeRect({ startX: 10, startY: 20, endX: 100, endY: 80 });
  const r2 = getMarqueeRect({ startX: 100, startY: 80, endX: 10, endY: 20 });
  assert.deepEqual(r1, r2);
  assert.equal(r1.left, 10);
  assert.equal(r1.top, 20);
  assert.equal(r1.right, 100);
  assert.equal(r1.bottom, 80);
  assert.equal(r1.width, 90);
  assert.equal(r1.height, 60);
});

test('isBBoxFullyContained: true when every edge inside marquee', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  const bbox = { left: 10, top: 10, right: 50, bottom: 50 };
  assert.equal(isBBoxFullyContained(marquee, bbox), true);
});

test('isBBoxFullyContained: false when any edge is outside', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.equal(
    isBBoxFullyContained(marquee, { left: 10, top: 10, right: 150, bottom: 50 }),
    false,
  );
  assert.equal(
    isBBoxFullyContained(marquee, { left: -5, top: 10, right: 50, bottom: 50 }),
    false,
  );
});

test('isBBoxFullyContained: exact edge match is still contained', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  const bbox = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.equal(isBBoxFullyContained(marquee, bbox), true);
});

test('isBBoxOverlapping: standard AABB overlap', () => {
  const marquee = { left: 0, top: 0, right: 50, bottom: 50 };
  assert.equal(
    isBBoxOverlapping(marquee, { left: 40, top: 40, right: 60, bottom: 60 }),
    true,
  );
  assert.equal(
    isBBoxOverlapping(marquee, { left: 60, top: 60, right: 70, bottom: 70 }),
    false,
  );
});

test('isBBoxOverlapping: fully-contained bbox counts as overlapping', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  const bbox = { left: 10, top: 10, right: 20, bottom: 20 };
  assert.equal(isBBoxOverlapping(marquee, bbox), true);
});

test('resolveMarqueeHits window mode: only annotations fully inside are selected', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  const annotations = {
    objects: [
      { type: 'rect', left: 10, top: 10, width: 20, height: 20 }, // fully inside
      { type: 'rect', left: 90, top: 90, width: 50, height: 50 }, // straddles
      { type: 'rect', left: 200, top: 200, width: 10, height: 10 }, // outside
    ],
  };
  const { annotationIndices } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'window',
    annotations,
    callouts: [],
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(annotationIndices, [0]);
});

test('resolveMarqueeHits crossing mode: annotations whose bbox overlaps are selected', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  const annotations = {
    objects: [
      { type: 'rect', left: 90, top: 90, width: 50, height: 50 }, // overlaps
      { type: 'rect', left: 200, top: 200, width: 10, height: 10 }, // no overlap
      { type: 'rect', left: 10, top: 10, width: 20, height: 20 }, // fully inside overlaps too
    ],
  };
  const { annotationIndices } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'crossing',
    annotations,
    callouts: [],
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(annotationIndices.sort(), [0, 2]);
});

test('resolveMarqueeHits crossing mode counts a boundary touch as a hit', () => {
  const { annotationIndices } = resolveMarqueeHits({
    marqueeRect: { left: 0, top: 0, right: 100, bottom: 100 },
    direction: 'crossing',
    annotations: { objects: [
      { type: 'rect', left: 100, top: 25, width: 40, height: 40, fill: '#93c5fd', stroke: '#111', strokeWidth: 2 },
    ] },
    callouts: [], pageWidth: 1000, pageHeight: 800,
  });
  assert.deepEqual(annotationIndices, [0]);
});

test('resolveMarqueeHits crossing mode touches visible rotated rectangle edges', () => {
  const annotation = { type: 'rect', left: 100, top: 100, width: 100, height: 60, angle: 45, fill: '#93c5fd', stroke: '#111', strokeWidth: 2 };
  for (const marqueeRect of [
    { left: 90, top: 110, right: 95, bottom: 122 },
    { left: 202, top: 137, right: 210, bottom: 151 },
    { left: 125, top: 70, right: 142, bottom: 80 },
  ]) {
    assert.deepEqual(resolveMarqueeHits({
      marqueeRect, direction: 'crossing', annotations: { objects: [annotation] },
      callouts: [], pageWidth: 1000, pageHeight: 800,
    }).annotationIndices, [0]);
  }
});

test('resolveMarqueeHits crossing mode touches one text-range quad', () => {
  const { annotationIndices } = resolveMarqueeHits({
    marqueeRect: { left: 78, top: 12, right: 90, bottom: 18 },
    direction: 'crossing',
    annotations: { objects: [{
      type: 'group', left: 10, top: 10, width: 70, height: 30,
      data: { type: 'text-markup', quads: [
        { x1: 10, y1: 10, x2: 80, y2: 10, x3: 10, y3: 20, x4: 80, y4: 20 },
        { x1: 10, y1: 30, x2: 50, y2: 30, x3: 10, y3: 40, x4: 50, y4: 40 },
      ] },
    }] }, callouts: [], pageWidth: 100, pageHeight: 100,
  });
  assert.deepEqual(annotationIndices, [0]);
});

test('resolveMarqueeHits crossing mode: unfilled rect blank interior is not selected', () => {
  const marquee = { left: 40, top: 40, right: 60, bottom: 60 };
  const annotations = {
    objects: [
      {
        type: 'rect',
        left: 10,
        top: 10,
        width: 100,
        height: 80,
        fill: 'none',
        stroke: '#111',
        strokeWidth: 4,
      },
    ],
  };
  const { annotationIndices } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'crossing',
    annotations,
    callouts: [],
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(annotationIndices, []);
});

test('resolveMarqueeHits crossing mode: filled rect blank interior is selected', () => {
  const marquee = { left: 40, top: 40, right: 60, bottom: 60 };
  const annotations = {
    objects: [
      {
        type: 'rect',
        left: 10,
        top: 10,
        width: 100,
        height: 80,
        fill: '#93c5fd',
        stroke: '#111',
        strokeWidth: 4,
      },
    ],
  };
  const { annotationIndices } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'crossing',
    annotations,
    callouts: [],
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(annotationIndices, [0]);
});

test('resolveMarqueeHits skips annotations outside the rendered/selectable index set', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  const annotations = {
    objects: [
      { type: 'rect', left: 10, top: 10, width: 20, height: 20 },
      { type: 'rect', left: 30, top: 30, width: 20, height: 20 },
    ],
  };
  const diagnostics = [];
  const { annotationIndices } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'window',
    annotations,
    callouts: [],
    pageWidth: 1000,
    pageHeight: 800,
    selectableAnnotationIndices: new Set([0]),
    onCandidateDiagnostic: (entry) => diagnostics.push(entry),
  });
  assert.deepEqual(annotationIndices, [0]);
  assert.equal(diagnostics.some((entry) =>
    entry.index === 1 && entry.reason === 'not-rendered-or-not-interactive'
  ), true);
});

test('resolveMarqueeHits: empty annotations + empty callouts returns empty result', () => {
  const { annotationIndices, calloutIds } = resolveMarqueeHits({
    marqueeRect: { left: 0, top: 0, right: 100, bottom: 100 },
    direction: 'window',
    annotations: { objects: [] },
    callouts: [],
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(annotationIndices, []);
  assert.deepEqual(calloutIds, []);
});

test('resolveMarqueeHits: callouts fully inside marquee are included (window)', () => {
  const marquee = { left: 0, top: 0, right: 1000, bottom: 800 };
  const callouts = [
    {
      id: 'c1',
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.12, y: 0.12 },
      textBoxPosition: { x: 0.15, y: 0.1 },
      textBoxWidth: 0.05,
      textBoxHeight: 0.03,
    },
  ];
  const { calloutIds } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'window',
    annotations: { objects: [] },
    callouts,
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(calloutIds, ['c1']);
});

test('resolveMarqueeHits: callouts only partially inside are NOT window-selected', () => {
  const marquee = { left: 0, top: 0, right: 150, bottom: 150 };
  const callouts = [
    {
      id: 'c1',
      arrowTip: { x: 0.05, y: 0.05 }, // x=50, y=40
      knee: { x: 0.1, y: 0.1 },       // x=100, y=80
      textBoxPosition: { x: 0.2, y: 0.2 }, // x=200, y=160 (outside)
      textBoxWidth: 0.05,
      textBoxHeight: 0.03,
    },
  ];
  const { calloutIds } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'window',
    annotations: { objects: [] },
    callouts,
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(calloutIds, []);
});

test('resolveMarqueeHits: callouts partially inside ARE crossing-selected', () => {
  const marquee = { left: 0, top: 0, right: 150, bottom: 150 };
  const callouts = [
    {
      id: 'c1',
      arrowTip: { x: 0.05, y: 0.05 }, // inside
      knee: { x: 0.1, y: 0.1 },
      textBoxPosition: { x: 0.2, y: 0.2 }, // outside
      textBoxWidth: 0.05,
      textBoxHeight: 0.03,
    },
  ];
  const { calloutIds } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'crossing',
    annotations: { objects: [] },
    callouts,
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(calloutIds, ['c1']);
});

test('resolveMarqueeHits: callout crossing ignores blank space inside callout bbox', () => {
  const marquee = { left: 190, top: 150, right: 210, bottom: 170 };
  const callouts = [
    {
      id: 'c1',
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.1, y: 0.3 },
      textBoxPosition: { x: 0.3, y: 0.1 },
      textBoxWidth: 0.1,
      textBoxHeight: 0.05,
      style: { lineThickness: 2 },
    },
  ];
  const { calloutIds } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'crossing',
    annotations: { objects: [] },
    callouts,
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(calloutIds, []);
});

test('resolveMarqueeHits: callout crossing selects connector or textbox geometry', () => {
  const callouts = [
    {
      id: 'c1',
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.1, y: 0.3 },
      textBoxPosition: { x: 0.3, y: 0.1 },
      textBoxWidth: 0.1,
      textBoxHeight: 0.05,
      style: { lineThickness: 2 },
    },
  ];
  const connectorHit = resolveMarqueeHits({
    marqueeRect: { left: 95, top: 150, right: 105, bottom: 170 },
    direction: 'crossing',
    annotations: { objects: [] },
    callouts,
    pageWidth: 1000,
    pageHeight: 800,
  });
  const textboxHit = resolveMarqueeHits({
    marqueeRect: { left: 320, top: 90, right: 340, bottom: 110 },
    direction: 'crossing',
    annotations: { objects: [] },
    callouts,
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(connectorHit.calloutIds, ['c1']);
  assert.deepEqual(textboxHit.calloutIds, ['c1']);
});

test('resolveMarqueeHits: page-scopes callouts so off-page hits do not create phantom multi-selection', () => {
  const marquee = { left: 0, top: 0, right: 100, bottom: 100 };
  const annotations = {
    objects: [
      {
        id: 'poly-1',
        type: 'polygon',
        left: 10,
        top: 10,
        points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 25 }],
      },
    ],
  };
  const callouts = [
    {
      id: 'off-page-callout',
      pageNumber: 2,
      arrowTip: { x: 0.02, y: 0.02 },
      knee: { x: 0.03, y: 0.03 },
      textBoxPosition: { x: 0.04, y: 0.04 },
      textBoxWidth: 0.02,
      textBoxHeight: 0.02,
    },
    {
      id: 'same-page-callout-outside-marquee',
      pageNumber: 1,
      arrowTip: { x: 0.8, y: 0.8 },
      knee: { x: 0.82, y: 0.82 },
      textBoxPosition: { x: 0.84, y: 0.84 },
      textBoxWidth: 0.02,
      textBoxHeight: 0.02,
    },
  ];
  const { annotationIndices, calloutIds } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'window',
    annotations,
    callouts,
    pageWidth: 1000,
    pageHeight: 800,
    pageNumber: 1,
  });
  assert.deepEqual(annotationIndices, [0]);
  assert.deepEqual(calloutIds, []);
});

test('resolveMarqueeHits: crossing mode fast-rejects non-overlapping annotations', () => {
  const marquee = { left: 0, top: 0, right: 10, bottom: 10 };
  const annotations = {
    objects: [
      { type: 'rect', left: 100, top: 100, width: 5, height: 5 },
      { type: 'circle', left: 200, top: 200, radius: 10 },
    ],
  };
  const { annotationIndices } = resolveMarqueeHits({
    marqueeRect: marquee,
    direction: 'crossing',
    annotations,
    callouts: [],
    pageWidth: 1000,
    pageHeight: 800,
  });
  assert.deepEqual(annotationIndices, []);
});
