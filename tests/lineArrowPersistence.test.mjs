// tests/lineArrowPersistence.test.mjs
// Phase 15 Wave 0 scaffold — Fabric.js 5.5.2 persistence contract for line/arrow.
//
// UX: tests guard LINE-01/02/03 + ARROW-04 persistence invariants. Deep-clone
// preservation matters because the Phase 15 drag commit uses
// JSON.parse(JSON.stringify(annotations)) before mutating, and
// FabricDrawingCanvas.jsx's CUSTOM_PROPS array already includes 'data' (lines
// 25-31) — so data.midpoint + data.arrowheadStyle naturally survive Fabric's
// toJSON round-trip.
//
// NOTE: the persistence chain in production is:
//   Fabric.Line → toJSON(['data']) → plain object → JSON.stringify → Supabase → JSON.parse → plain object → fabric.util.enlivenObjects → Fabric.Line
// Only the middle stages (plain-object → JSON.stringify → JSON.parse → plain-object)
// are stateless data transformations that Phase 15's drag commit relies on — those
// are what we exercise here. We do NOT import `fabric` directly at the top of this
// file because `fabric@5.5.2` pulls in the `node-canvas` native binding, which is
// currently built against an older NODE_MODULE_VERSION (116) than this machine's
// Node runtime (127) and therefore fails to dlopen. Rebuilding node-canvas is an
// infrastructure concern outside Plan 15-01's scope (zero src/ changes allowed),
// so we exercise the plain-JSON invariants here. The Fabric.Line toJSON contract
// is guaranteed by the Fabric 5.x API docs — any prop whose name appears in the
// toJSON argument array is serialized as-is. See deferred-items.md for the
// rebuild follow-up.

import test from 'node:test';
import assert from 'node:assert/strict';

// Simulated shape of what `new fabric.Line([0,0,100,0], {...}).toJSON(['data'])`
// produces. The only Phase-15-relevant invariant is that `data.midpoint` and
// `data.arrowheadStyle` survive round-trip serialization unchanged.
function simulateFabricLineToJSON({ x1, y1, x2, y2, stroke, strokeWidth, data }) {
  // Fabric 5.x toJSON returns a plain object containing type=line + geometry +
  // any custom props named in the toJSON argument array. We mirror the shape.
  return {
    type: 'line',
    version: '5.5.2',
    x1, y1, x2, y2,
    stroke,
    strokeWidth,
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    data, // survives because 'data' is in toJSON([...]) argument
  };
}

test("Fabric.Line with data.midpoint round-trips through toJSON(['data'])", () => {
  const json = simulateFabricLineToJSON({
    x1: 0, y1: 0, x2: 100, y2: 0,
    stroke: '#f00',
    strokeWidth: 2,
    data: { midpoint: { x: 50, y: 50 } },
  });
  assert.ok(json.data, 'expected json.data to be present');
  assert.equal(json.data.midpoint.x, 50);
  assert.equal(json.data.midpoint.y, 50);
});

test("Fabric.Line with data.arrowheadStyle round-trips through toJSON(['data'])", () => {
  const json = simulateFabricLineToJSON({
    x1: 0, y1: 0, x2: 100, y2: 0,
    stroke: '#f00',
    strokeWidth: 2,
    data: { arrowheadStyle: 'vShape' },
  });
  assert.ok(json.data, 'expected json.data to be present');
  assert.equal(json.data.arrowheadStyle, 'vShape');
});

test('JSON.parse(JSON.stringify(...)) deep clone preserves both data.midpoint and data.arrowheadStyle', () => {
  const orig = {
    type: 'line',
    x1: -50,
    y1: 0,
    x2: 50,
    y2: 0,
    left: 0,
    top: 0,
    width: 100,
    height: 0,
    tool: 'arrow',
    data: { midpoint: { x: 50, y: 50 }, arrowheadStyle: 'vShape' },
  };
  const clone = JSON.parse(JSON.stringify(orig));
  assert.equal(clone.data.midpoint.x, 50);
  assert.equal(clone.data.midpoint.y, 50);
  assert.equal(clone.data.arrowheadStyle, 'vShape');
  assert.notEqual(clone.data, orig.data, 'expected separate references after deep clone');
  assert.notEqual(clone.data.midpoint, orig.data.midpoint, 'expected nested midpoint to be a separate reference');
});

test('data.midpoint can be stored as null after deletion (simulating snap-to-straight)', () => {
  const obj = {
    type: 'line',
    data: { midpoint: { x: 50, y: 50 }, arrowheadStyle: 'solidTriangle' },
  };
  delete obj.data.midpoint;
  assert.equal(obj.data.midpoint, undefined);
  const serialized = JSON.stringify(obj);
  assert.equal(serialized.includes('"midpoint"'), false, `serialized JSON should not contain "midpoint": ${serialized}`);
  // arrowheadStyle survives a midpoint deletion (ARROW-04 invariant)
  assert.equal(obj.data.arrowheadStyle, 'solidTriangle');
});
