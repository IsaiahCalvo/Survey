import test from 'node:test';
import assert from 'node:assert/strict';

import { eraserStrokeTouchesObject } from '../src/utils/eraserHitTest.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { cullInkSliverPolygons } from '../src/utils/paperAnnotationGeometry.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';

// 2026-07-19 eraser audit regressions: the hit test must share the SVG
// renderers' world geometry (center-based line endpoints, rotation about the
// visual center, stamps as boxes). Each case below was a confirmed
// "shape immune to the eraser" class before the fix.

const touch = (object, x, y, radius = 8) => eraserStrokeTouchesObject({
  eraserPoints: [{ x, y }],
  eraserRadius: radius,
  object,
});

test('slash "/" diagonal line is hittable along its whole visible length', () => {
  // Visible segment: (100, 200) -> (200, 100). Stored fabric-style:
  // bbox (100,100)-(200,200), endpoints CENTER-relative.
  const line = {
    type: 'line',
    left: 100,
    top: 100,
    width: 100,
    height: 100,
    x1: -50,
    y1: 50,
    x2: 50,
    y2: -50,
    stroke: '#d11b2d',
    strokeWidth: 3,
    tool: 'line',
  };
  assert.equal(touch(line, 100, 200), true, 'visible start');
  assert.equal(touch(line, 150, 150), true, 'visible middle');
  assert.equal(touch(line, 200, 100), true, 'visible end');
  assert.equal(touch(line, 130, 120), false, 'clear of the line');
});

test('backslash "\\" diagonal line is hittable on BOTH halves', () => {
  // Visible segment: (100, 100) -> (200, 200).
  const line = {
    type: 'line',
    left: 100,
    top: 100,
    width: 100,
    height: 100,
    x1: -50,
    y1: -50,
    x2: 50,
    y2: 50,
    stroke: '#d11b2d',
    strokeWidth: 3,
    tool: 'arrow',
  };
  assert.equal(touch(line, 125, 125), true, 'first half');
  assert.equal(touch(line, 185, 185), true, 'second half (was immune)');
  assert.equal(touch(line, 40, 40), false, 'phantom pre-start zone must NOT hit');
});

test('rotated rect: hit region follows the visible (center-pivoted) shape', () => {
  const rect = {
    type: 'rect',
    left: 100,
    top: 100,
    width: 120,
    height: 40,
    angle: 90,
    fill: null,
    stroke: '#116622',
    strokeWidth: 2,
  };
  // At 90° about the center (160, 120), the visible rect occupies
  // x in [140, 180], y in [60, 180]; its top edge midpoint is (160, 60).
  assert.equal(touch(rect, 160, 60), true, 'visible rotated edge');
  assert.equal(touch(rect, 100, 100, 4), false, 'old unrotated corner no longer hits');
});

test('rotated textbox: hit region follows the visible box', () => {
  const text = {
    type: 'Textbox',
    left: 200,
    top: 200,
    width: 100,
    height: 30,
    angle: 45,
    text: 'hello',
  };
  // Center (250, 215); the visible rotated box contains the center.
  assert.equal(touch(text, 250, 215, 4), true);
  // The unrotated far corner region is empty space now.
  assert.equal(touch(text, 208, 202, 1), false);
});

test('stamp (image) annotations are hittable as their box', () => {
  const stamp = {
    type: 'image',
    left: 300,
    top: 300,
    width: 80,
    height: 60,
    scaleX: 1,
    scaleY: 1,
  };
  assert.equal(touch(stamp, 340, 330), true, 'inside the stamp');
  assert.equal(touch(stamp, 500, 500), false, 'far away');
});

test('curved line (midpoint) is hittable along the drawn curve', () => {
  // Straight chord (0,0)->(100,0) bowed to pass through (50,30).
  const line = {
    type: 'line',
    left: 0,
    top: 0,
    width: 100,
    height: 0,
    x1: -50,
    y1: 0,
    x2: 50,
    y2: 0,
    stroke: '#d11b2d',
    strokeWidth: 3,
    data: { midpoint: { x: 50, y: 30 } },
  };
  assert.equal(touch(line, 50, 30, 5), true, 'curve apex');
  assert.equal(touch(line, 50, 0, 3), false, 'chord midpoint is off the drawn curve');
});

// --- Native paper ink: true visible-shape subtraction ----------------------

const drawInk = (id, points, width = 12) => createProductionPaperInk({
  id,
  tool: 'pen',
  points,
  color: '#d11b2d',
  width,
});

function pointInRing({ x, y }, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonSet(point, polygons) {
  return (polygons || []).some((polygon) => (
    polygon.reduce((inside, ring) => (pointInRing(point, ring) ? !inside : inside), false)
  ));
}

function verticalInkIntervals(x, minY, maxY, polygons, step = 0.01) {
  const intervals = [];
  let start = null;
  let last = null;
  for (let y = minY + step / 2; y < maxY; y += step) {
    if (pointInPolygonSet({ x, y }, polygons)) {
      if (start == null) start = y;
      last = y;
    } else if (start != null) {
      intervals.push({ start, end: last, thickness: last - start + step });
      start = null;
      last = null;
    }
  }
  if (start != null) intervals.push({ start, end: last, thickness: last - start + step });
  return intervals;
}

test('thick native pen and highlighter strokes take a shallow rounded edge bite while their center survives', async (t) => {
  for (const tool of ['pen', 'highlighter']) {
    await t.test(tool, () => {
      const ink = createProductionPaperInk({
        id: `${tool}-edge-bite`,
        tool,
        points: [{ x: 0, y: 50 }, { x: 200, y: 50 }],
        color: '#d11b2d',
        width: 20,
      });
      const result = erasePageAnnotations({
        pageAnnotations: { objects: [ink] },
        eraserPoints: [{ x: 100, y: 38 }],
        eraserRadius: 7,
        mode: 'partial',
      });
      const survivor = result.pageAnnotations.objects[0];

      assert.equal(result.didChange, true);
      assert.deepEqual(result.changedIds, [`${tool}-edge-bite`]);
      assert.deepEqual(result.deletedIds, []);
      assert.equal(survivor.fillRule, 'evenodd');
      assert.equal(survivor.strokeWidth, 0);
      assert.ok(Array.isArray(survivor.polygons) && survivor.polygons.length > 0);
      assert.equal(
        pointInPolygonSet({ x: 100, y: 41 }, survivor.polygons),
        false,
        'eraser removes the touched upper edge',
      );
      assert.equal(
        pointInPolygonSet({ x: 100, y: 50 }, survivor.polygons),
        true,
        'shallow edge contact must not cut through the center',
      );
      assert.equal(
        pointInPolygonSet({ x: 70, y: 41 }, survivor.polygons),
        true,
        'nearby untouched edge remains intact',
      );
    });
  }
});

test('repeated partial erases rebase on the already carved polygon instead of an original centerline', () => {
  const ink = drawInk('twice', [{ x: 0, y: 50 }, { x: 300, y: 50 }], 20);
  const first = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [{ x: 80, y: 38 }],
    eraserRadius: 7,
    mode: 'partial',
  });
  const second = erasePageAnnotations({
    pageAnnotations: first.pageAnnotations,
    eraserPoints: [{ x: 200, y: 38 }],
    eraserRadius: 7,
    mode: 'partial',
  });
  const survivor = second.pageAnnotations.objects[0];

  assert.equal(second.didChange, true);
  assert.equal(survivor.fillRule, 'evenodd');
  assert.equal(pointInPolygonSet({ x: 80, y: 41 }, survivor.polygons), false, 'first bite persists');
  assert.equal(pointInPolygonSet({ x: 200, y: 41 }, survivor.polygons), false, 'second bite persists');
  assert.equal(pointInPolygonSet({ x: 80, y: 50 }, survivor.polygons), true, 'first center survives');
  assert.equal(pointInPolygonSet({ x: 200, y: 50 }, survivor.polygons), true, 'second center survives');
});

test('near-parallel partial erases do not persist an attached hairline bridge', async (t) => {
  const widths = [3, 4, 6, 9, 10, 20, 36, 40];
  const diameters = [4, 10, 20, 24, 40, 80];
  const cases = [
    ...widths.flatMap((width) => (
      diameters.map((diameter) => ({ tool: 'pen', width, diameter }))
    )),
    { tool: 'highlighter', width: 10, diameter: 20 },
  ];

  for (const { tool, width, diameter } of cases) {
    await t.test(`${tool} width ${width}, eraser ${diameter}`, () => {
      const radius = diameter / 2;
      const wantedBridge = 0.25;
      const eraserY = 50 + width / 2 - radius - wantedBridge;
      const ink = createProductionPaperInk({
        id: `${tool}-${width}-${diameter}`,
        tool,
        points: [{ x: 0, y: 50 }, { x: 300, y: 50 }],
        color: '#d11b2d',
        width,
      });
      const result = erasePageAnnotations({
        pageAnnotations: { objects: [ink] },
        eraserPoints: [{ x: 80, y: eraserY }, { x: 220, y: eraserY }],
        eraserRadius: radius,
        mode: 'partial',
      });
      const survivor = result.pageAnnotations.objects[0];

      assert.equal(result.didChange, true);
      assert.ok(survivor, 'the untouched ends remain');
      assert.equal(
        pointInPolygonSet({ x: 10, y: 50 }, survivor.polygons),
        true,
        'left healthy end remains',
      );
      assert.equal(
        pointInPolygonSet({ x: 290, y: 50 }, survivor.polygons),
        true,
        'right healthy end remains',
      );
      assert.equal(
        pointInPolygonSet(
          { x: 150, y: 50 + width / 2 - wantedBridge / 2 },
          survivor.polygons,
        ),
        false,
        `the attached ${wantedBridge}-unit edge ribbon is removed`,
      );
      if (width > diameter + wantedBridge + 0.35) {
        assert.equal(
          pointInPolygonSet(
            {
              x: 150,
              y: eraserY - radius - wantedBridge - 0.1,
            },
            survivor.polygons,
          ),
          true,
          'the minimum topology-changing pad preserves the thick opposite band',
        );
      }
      const minimumRealBand = Math.max(0.08, 0.15 * width);
      for (const interval of verticalInkIntervals(
        150,
        50 - width / 2,
        50 + width / 2,
        survivor.polygons,
      )) {
        assert.ok(
          interval.thickness >= minimumRealBand - 0.02,
          `no new ${interval.thickness.toFixed(2)}-unit skinny band may be created on the opposite edge`,
        );
      }
    });
  }
});

test('near-centered erase removes every sub-threshold side ribbon without shrinking a real band', async (t) => {
  for (const tool of ['pen', 'highlighter']) {
    for (const offset of [-0.5, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.5]) {
      await t.test(`${tool}, offset ${offset}`, () => {
        const ink = createProductionPaperInk({
          id: `${tool}-${offset}`,
          tool,
          points: [{ x: 0, y: 50 }, { x: 300, y: 50 }],
          color: '#d11b2d',
          width: 10,
        });
        const result = erasePageAnnotations({
          pageAnnotations: { objects: [ink] },
          eraserPoints: [{ x: 80, y: 50 + offset }, { x: 220, y: 50 + offset }],
          eraserRadius: 4,
          mode: 'partial',
        });
        const survivor = result.pageAnnotations.objects[0];
        const intervals = verticalInkIntervals(150, 45, 55, survivor?.polygons);

        assert.ok(survivor, 'healthy stroke ends remain');
        assert.equal(pointInPolygonSet({ x: 10, y: 50 }, survivor.polygons), true);
        assert.equal(pointInPolygonSet({ x: 290, y: 50 }, survivor.polygons), true);
        for (const interval of intervals) {
          assert.ok(
            interval.thickness >= 1.48,
            `no ${interval.thickness.toFixed(2)}-unit ribbon may remain`,
          );
        }
        if (Math.abs(offset) === 0.5) {
          assert.ok(
            intervals.some((interval) => interval.thickness >= 1.48),
            'the original threshold-width band stays instead of being globally thinned',
          );
        } else {
          assert.deepEqual(intervals, [], 'both original bands were below the source-width floor');
        }
      });
    }
  }
});

test('one-sided cleanup keeps the healthy band when only its opposite is sub-threshold', () => {
  const ink = drawInk('one-sided', [{ x: 0, y: 50 }, { x: 300, y: 50 }], 7);
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [{ x: 80, y: 50.14 }, { x: 220, y: 50.14 }],
    eraserRadius: 2.5,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];
  const intervals = verticalInkIntervals(150, 46.5, 53.5, survivor?.polygons);

  assert.ok(survivor);
  assert.equal(pointInPolygonSet({ x: 150, y: 47 }, survivor.polygons), true);
  assert.equal(pointInPolygonSet({ x: 150, y: 53.2 }, survivor.polygons), false);
  assert.equal(intervals.length, 1);
  assert.ok(intervals[0].thickness >= 1.12, 'the 1.14-unit healthy side remains full-width');
});

test('a single-point eraser removes both sub-threshold sides of an enclosed bite', () => {
  const ink = drawInk('single-point-ribbon', [{ x: 0, y: 50 }, { x: 300, y: 50 }], 10);
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [{ x: 150, y: 50.2 }],
    eraserRadius: 4,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];

  assert.ok(survivor, 'untouched stroke material remains around the tap');
  assert.equal(pointInPolygonSet({ x: 10, y: 50 }, survivor.polygons), true);
  assert.deepEqual(
    verticalInkIntervals(150, 45, 55, survivor.polygons),
    [],
    'the tap opens the enclosed hole instead of retaining top or bottom hairlines',
  );
});

test('localized cleanup does not widen an ordinary deep erase elsewhere in a bent gesture', () => {
  const ink = drawInk('bent-locality', [{ x: 0, y: 50 }, { x: 300, y: 50 }], 20);
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [{ x: 50, y: 55.1 }, { x: 130, y: 50 }, { x: 250, y: 50 }],
    eraserRadius: 2,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];

  assert.ok(survivor);
  assert.equal(
    pointInPolygonSet({ x: 50, y: 59 }, survivor.polygons),
    false,
    'the 2.9-unit cut-adjacent bridge is removed near the gesture start',
  );
  assert.equal(pointInPolygonSet({ x: 200, y: 47.75 }, survivor.polygons), true);
  assert.equal(pointInPolygonSet({ x: 200, y: 52.25 }, survivor.polygons), true);
  assert.equal(pointInPolygonSet({ x: 200, y: 50 }, survivor.polygons), false);
});

test('localized cleanup cannot turn a 1-unit eraser into a wide cut elsewhere', () => {
  const ink = drawInk('extreme-locality', [{ x: 0, y: 50 }, { x: 300, y: 50 }], 50);
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [{ x: 50, y: 67.1 }, { x: 130, y: 50 }, { x: 250, y: 50 }],
    eraserRadius: 0.5,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];

  assert.ok(survivor);
  assert.equal(pointInPolygonSet({ x: 200, y: 50 }, survivor.polygons), false);
  assert.equal(
    pointInPolygonSet({ x: 200, y: 50.6 }, survivor.polygons),
    true,
    'the centered section keeps ink immediately outside the requested 0.5 radius',
  );
  assert.equal(pointInPolygonSet({ x: 200, y: 57.7 }, survivor.polygons), true);
});

test('rotating the stroke and eraser does not change ribbon cleanup', () => {
  const angle = (37 * Math.PI) / 180;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -direction.y, y: direction.x };
  const pointAt = (distance, offset = 0) => ({
    x: 50 + direction.x * distance + normal.x * offset,
    y: 50 + direction.y * distance + normal.y * offset,
  });
  const ink = drawInk('rotated-ribbon', [pointAt(0), pointAt(300)], 10);
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [pointAt(80, 0.2), pointAt(220, 0.2)],
    eraserRadius: 4,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];

  assert.ok(survivor);
  assert.equal(pointInPolygonSet(pointAt(10), survivor.polygons), true);
  assert.equal(pointInPolygonSet(pointAt(290), survivor.polygons), true);
  for (let offset = -4.9; offset <= 4.9; offset += 0.1) {
    assert.equal(
      pointInPolygonSet(pointAt(150, offset), survivor.polygons),
      false,
      'no angle-dependent hairline remains across the erased cross-section',
    );
  }
});

for (const eraserOffset of [-0.5, 0.5]) {
test(`curved cleanup removes the thin side but preserves a band at the floor (offset ${eraserOffset})`, () => {
  const center = { x: 200, y: 200 };
  const arcPoint = (radius, degrees) => {
    const angle = (degrees * Math.PI) / 180;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  };
  const angles = Array.from({ length: 61 }, (_, index) => -45 + index * 1.5);
  const ink = drawInk('curved-threshold', angles.map((angle) => arcPoint(100, angle)), 10);
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: angles.map((angle) => arcPoint(100 + eraserOffset, angle)),
    eraserRadius: 4,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];
  const thinSideRadius = eraserOffset > 0 ? 104.75 : 95.25;
  const floorBandRadius = eraserOffset > 0 ? 95.5 : 104.5;

  assert.ok(survivor);
  assert.equal(
    pointInPolygonSet(arcPoint(thinSideRadius, 0), survivor.polygons),
    false,
    'the 0.5-unit ribbon is removed',
  );
  assert.equal(
    pointInPolygonSet(arcPoint(floorBandRadius, 0), survivor.polygons),
    true,
    'the opposite 1.5-unit band at the floor remains',
  );
});
}

test('bridge cleanup stops at the first empty gap instead of nicking a nearby pass', () => {
  const ink = drawInk('nearby-pass', [
    { x: 0, y: 50 },
    { x: 300, y: 50 },
    { x: 300, y: 61 },
    { x: 0, y: 61 },
  ], 10);
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [{ x: 30, y: 44.75 }, { x: 270, y: 44.75 }],
    eraserRadius: 10,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];

  assert.ok(survivor);
  assert.equal(
    pointInPolygonSet({ x: 150, y: 54.9 }, survivor.polygons),
    false,
    'the attached 0.25-unit ribbon is removed',
  );
  for (const y of [56.05, 56.1, 56.2]) {
    assert.equal(
      pointInPolygonSet({ x: 150, y }, survivor.polygons),
      true,
      `the separate nearby pass remains untouched at y=${y}`,
    );
  }
});

test('a disconnected speck cannot hide an attached main-stroke bridge from cleanup', () => {
  const ink = drawInk('speck-and-bridge', [{ x: 0, y: 50 }, { x: 300, y: 50 }], 10);
  const speckRing = [[
    [140, 55.2],
    [160, 55.2],
    [160, 55.6],
    [140, 55.6],
    [140, 55.2],
  ]];
  ink.polygons = [...ink.polygons, speckRing];
  ink.path = [
    ...ink.path,
    ['M', 140, 55.2],
    ['L', 160, 55.2],
    ['L', 160, 55.6],
    ['L', 140, 55.6],
    ['L', 140, 55.2],
    ['Z'],
  ];
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [{ x: 30, y: 44.75 }, { x: 270, y: 44.75 }],
    eraserRadius: 10,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];

  assert.ok(survivor);
  assert.equal(
    pointInPolygonSet({ x: 150, y: 54.9 }, survivor.polygons),
    false,
    'the main attached ribbon is removed independently of the speck component',
  );
});

test('legacy polygon-only ink also loses an attached hairline bridge', () => {
  const ink = drawInk('legacy-outline', [{ x: 0, y: 50 }, { x: 300, y: 50 }], 10);
  const {
    paperCenterline: _paperCenterline,
    paperCenterlineRuns: _paperCenterlineRuns,
    ...polygonOnly
  } = ink;
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [polygonOnly] },
    eraserPoints: [{ x: 30, y: 44.75 }, { x: 270, y: 44.75 }],
    eraserRadius: 10,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];

  assert.ok(survivor, 'healthy ends remain');
  assert.equal(pointInPolygonSet({ x: 10, y: 50 }, survivor.polygons), true);
  assert.equal(pointInPolygonSet({ x: 290, y: 50 }, survivor.polygons), true);
  for (let y = 45; y <= 55; y += 0.05) {
    assert.equal(
      pointInPolygonSet({ x: 150, y }, survivor.polygons),
      false,
      'topology fallback severs the legacy outline bridge without a centerline',
    );
  }
});

test('polygon-only loop does not keep a hairline closure after a near-parallel erase', () => {
  const loop = drawInk('legacy-loop', [
    { x: 0, y: 50 },
    { x: 300, y: 50 },
    { x: 300, y: 200 },
    { x: 0, y: 200 },
    { x: 0, y: 50 },
  ], 10);
  const {
    paperCenterline: _paperCenterline,
    paperCenterlineRuns: _paperCenterlineRuns,
    ...polygonOnly
  } = loop;
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [polygonOnly] },
    eraserPoints: [{ x: 30, y: 44.75 }, { x: 270, y: 44.75 }],
    eraserRadius: 10,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];

  assert.ok(survivor);
  assert.equal(pointInPolygonSet({ x: 150, y: 200 }, survivor.polygons), true, 'healthy loop bottom stays');
  for (let y = 45; y <= 55; y += 0.05) {
    assert.equal(
      pointInPolygonSet({ x: 150, y }, survivor.polygons),
      false,
      'the sub-threshold top closure is opened',
    );
  }
});

test('bridge cleanup does not widen an erase when a genuinely thick band remains', async (t) => {
  for (const polygonOnly of [false, true]) {
    await t.test(polygonOnly ? 'legacy polygon-only ink' : 'native paper ink', () => {
      const ink = drawInk(
        polygonOnly ? 'legacy-thick-band' : 'native-thick-band',
        [{ x: -30, y: 50 }, { x: 330, y: 50 }],
        20,
      );
      if (polygonOnly) {
        delete ink.paperCenterline;
        delete ink.paperCenterlineRuns;
      }
      const result = erasePageAnnotations({
        pageAnnotations: { objects: [ink] },
        eraserPoints: [{ x: -30, y: 50 }, { x: 330, y: 50 }],
        eraserRadius: 2,
        mode: 'partial',
      });
      const survivor = result.pageAnnotations.objects[0];

      assert.ok(survivor);
      assert.equal(pointInPolygonSet({ x: 150, y: 50 }, survivor.polygons), false);
      assert.equal(
        pointInPolygonSet({ x: 150, y: 52.25 }, survivor.polygons),
        true,
        'the original 8-unit survivor begins immediately outside the requested radius',
      );
      assert.equal(pointInPolygonSet({ x: 150, y: 59 }, survivor.polygons), true);
      assert.equal(
        pointInPolygonSet({ x: 150, y: 47.75 }, survivor.polygons),
        true,
        'cleanup must not globally inflate the eraser above the centerline either',
      );
    });
  }
});

test('localized bridge cleanup preserves a shallow bite on a pen dot', () => {
  const dot = createProductionPaperInk({
    id: 'edge-bit-dot',
    tool: 'pen',
    points: [{ x: 50, y: 50 }],
    color: '#d11b2d',
    width: 10,
  });
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [dot] },
    eraserPoints: [{ x: 50, y: 43.5 }],
    eraserRadius: 2,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];

  assert.equal(result.didChange, true);
  assert.ok(survivor, 'a legitimate dot is not culled');
  assert.equal(pointInPolygonSet({ x: 50, y: 45 }, survivor.polygons), false, 'dot edge is bitten');
  assert.equal(pointInPolygonSet({ x: 50, y: 50 }, survivor.polygons), true, 'dot center remains');
});

test('a repeated erase cleans bridges from the already-carved polygon', () => {
  const ink = drawInk('repeat-bridge', [{ x: 0, y: 50 }, { x: 300, y: 50 }], 10);
  const first = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [{ x: 20, y: 43 }],
    eraserRadius: 3,
    mode: 'partial',
  });
  const alreadyCarved = first.pageAnnotations.objects[0];

  assert.equal(alreadyCarved.paperCenterline, undefined);
  assert.equal(
    alreadyCarved.paperCenterlineRuns,
    undefined,
    'the carved polygon remains the only persisted geometry used by later erases',
  );

  const second = erasePageAnnotations({
    pageAnnotations: first.pageAnnotations,
    eraserPoints: [{ x: 60, y: 44.75 }, { x: 270, y: 44.75 }],
    eraserRadius: 10,
    mode: 'partial',
  });
  const survivor = second.pageAnnotations.objects[0];

  assert.ok(survivor, 'healthy ends survive the second erase');
  assert.equal(pointInPolygonSet({ x: 10, y: 50 }, survivor.polygons), true);
  assert.equal(pointInPolygonSet({ x: 290, y: 50 }, survivor.polygons), true);
  for (let y = 45; y <= 55; y += 0.05) {
    assert.equal(
      pointInPolygonSet({ x: 150, y }, survivor.polygons),
      false,
      'the second erase is based on the carved polygon and leaves no attached bridge',
    );
  }
});

// --- Polygon-lane sliver cull ----------------------------------------------

test('sliver cull drops hairline ribbons and degenerate rings, keeps real ink', () => {
  const healthy = [[[0, 0], [40, 0], [40, 10], [0, 10], [0, 0]]];
  const hairline = [[[0, 20], [40, 20], [40, 20.3], [0, 20.3], [0, 20]]];
  const degenerate = [[[5, 5], [5, 5], [5, 5], [5, 5]]];
  const culled = cullInkSliverPolygons([healthy, hairline, degenerate], 10);
  assert.equal(culled.length, 1);
  assert.deepEqual(culled[0], healthy);
});

test('sliver cull keeps a full pen dot', () => {
  // Approximate a dot of radius 5 (width 10) as a 16-gon.
  const dot = [];
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    dot.push([50 + 5 * Math.cos(a), 50 + 5 * Math.sin(a)]);
  }
  dot.push(dot[0]);
  const culled = cullInkSliverPolygons([[dot]], 10);
  assert.equal(culled.length, 1);
});
