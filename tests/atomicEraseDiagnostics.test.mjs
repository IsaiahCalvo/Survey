import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordAtomicEraseDiagnostic,
  summarizeAtomicEraseDebugIntent,
  summarizeGeometryAudit,
  updateAtomicEraseDiagnostic,
} from '../src/utils/atomicEraseDiagnostics.js';
import { auditPartialEraseGeometry } from '../src/utils/paperAnnotationGeometry.js';

const rectangle = (left, top, right, bottom) => [[[
  [left, top],
  [right, top],
  [right, bottom],
  [left, bottom],
  [left, top],
]]];

test('live eraser diagnostics summarize large geometry instead of rendering it', () => {
  const ring = Array.from({ length: 2000 }, (_, index) => [index, index % 31]);
  const audit = summarizeGeometryAudit({
    storageKey: 'ink-1',
    annotationId: 'ink-1',
    areas: { before: 100, after: 50 },
    violations: { addedInk: false },
    geometryErrors: {},
    before: [[ring]],
    contact: [[ring]],
    contactedInk: [[ring]],
    after: [[ring]],
    removed: [[ring]],
    added: [],
  });
  const summary = summarizeAtomicEraseDebugIntent({
    mutationId: 'erase-1',
    pageNumber: 1,
    gesture: {
      mode: 'partial',
      radius: 12,
      points: Array.from({ length: 1000 }, (_, index) => ({ x: index, y: index })),
    },
    targets: [{ storageKey: 'ink-1', operation: 'replace' }],
    result: { status: 'committed' },
    geometryAudits: [audit],
    timing: { commitWorkMs: 4 },
  });
  const rendered = JSON.stringify(summary);

  assert.equal(summary.gesture.pointCount, 1000);
  assert.deepEqual(summary.gesture.start, { x: 0, y: 0 });
  assert.deepEqual(summary.gesture.end, { x: 999, y: 999 });
  assert.equal(summary.geometryAudits[0].vertices.before, 2000);
  assert.equal('points' in summary.gesture, false);
  assert.equal('before' in summary.geometryAudits[0], false);
  assert.ok(rendered.length < 1000, `summary grew to ${rendered.length} characters`);
});

test('partial erase audit locates every forbidden geometry change', () => {
  const removedTooMuch = auditPartialEraseGeometry({
    before: rectangle(0, 0, 100, 100),
    after: [],
    eraserPoints: [{ x: 50, y: 50 }],
    radius: 10,
    captureLocations: true,
  });
  assert.equal(removedTooMuch.violations.removedOutsideContact, true);
  assert.ok(removedTooMuch.violationSamples.removedOutsideContact.length > 0);
  assert.ok(removedTooMuch.areas.removedOutsideContact > 0);

  const retainedContact = auditPartialEraseGeometry({
    before: rectangle(0, 0, 100, 100),
    after: rectangle(0, 0, 100, 100),
    eraserPoints: [{ x: 50, y: 50 }],
    radius: 10,
    captureLocations: true,
  });
  assert.equal(retainedContact.violations.retainedInsideContact, true);
  assert.ok(retainedContact.violationSamples.retainedInsideContact.length > 0);
  assert.ok(retainedContact.areas.retainedInsideContact > 0);

  const addedInk = auditPartialEraseGeometry({
    before: rectangle(0, 0, 100, 100),
    after: rectangle(0, 0, 120, 100),
    eraserPoints: [{ x: 50, y: 50 }],
    radius: 10,
    captureLocations: true,
  });
  assert.equal(addedInk.violations.addedInk, true);
  assert.ok(addedInk.added.length > 0);
  assert.ok(addedInk.areas.added > 0);
});

test('partial erase audit does not call a valid even-odd hole added ink', () => {
  const outer = rectangle(0, 0, 100, 100)[0][0];
  const hole = rectangle(40, 0, 60, 70)[0][0];
  const validCut = auditPartialEraseGeometry({
    before: [[outer]],
    after: [[outer, hole]],
    eraserPoints: [{ x: 50, y: 0 }, { x: 50, y: 70 }],
    radius: 10,
    captureLocations: true,
  });

  assert.equal(validCut.violations.addedInk, false);
  assert.equal(validCut.violationSamples.addedInk.length, 0);
});

test('production diagnostics retain exact replay data and export a safe copy', () => {
  const host = {};
  recordAtomicEraseDiagnostic(host, {
    mutationId: 'erase-live-1',
    pageNumber: 1,
    gesture: {
      mode: 'partial',
      radius: 10,
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    },
    auditStatus: 'pending',
  });
  updateAtomicEraseDiagnostic(host, 'erase-live-1', {
    auditStatus: 'complete',
    geometryAudits: [{ violations: { removedOutsideContact: true } }],
  });

  assert.equal(host.__eraserDiagnostics.entries.length, 1);
  assert.equal(host.__eraserDiagnostics.entries[0].gesture.points.length, 2);
  assert.equal(host.__eraserDiagnostics.entries[0].auditStatus, 'complete');
  const exported = host.__exportEraserDiagnostics();
  exported[0].gesture.points[0].x = 999;
  assert.equal(host.__eraserDiagnostics.entries[0].gesture.points[0].x, 1);
});
