import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findNearestSurveyMarkerAt } from '../src/utils/surveyMarkerHitTest.js';

function makeMarkerTarget({
  id,
  pageNumber = 1,
  rect,
  strokeWidth = 0,
  scale = 1,
  exactHit = false,
  inHiddenTab = false,
}) {
  const wrapper = {
    getAttribute: (name) => (name === 'data-diag-svg-wrapper' ? String(pageNumber) : null),
  };
  const carrier = {
    getAttribute: (name) => (name === 'data-survey-marker-id' ? String(id) : null),
  };
  const el = {
    ownerSVGElement: {
      createSVGPoint: () => ({
        x: 0,
        y: 0,
        matrixTransform: () => ({ x: 0, y: 0 }),
      }),
    },
    getScreenCTM: () => ({
      a: scale,
      b: 0,
      c: 0,
      d: scale,
      inverse: () => ({}),
    }),
    getBoundingClientRect: () => rect,
    getAttribute: (name) => {
      if (name === 'stroke-width') return strokeWidth ? String(strokeWidth) : null;
      if (name === 'fill') return 'rgba(0,0,0,0.001)';
      if (name === 'stroke') return strokeWidth ? 'rgba(0,0,0,0.001)' : 'none';
      return null;
    },
    isPointInFill: () => exactHit,
    isPointInStroke: () => exactHit,
    closest: (selector) => {
      if (selector === '[data-survey-marker-id]') return carrier;
      if (selector === '[data-diag-svg-wrapper]') return wrapper;
      if (selector === '[data-tab-panel]') {
        return inHiddenTab ? { getAttribute: () => 'false' } : null;
      }
      return null;
    },
  };
  return el;
}

test('findNearestSurveyMarkerAt selects within 16 px touch slop and 6 px mouse slop (#1815)', () => {
  const target = makeMarkerTarget({
    id: 'marker-door-1',
    pageNumber: 1,
    rect: { left: 100, top: 100, right: 112, bottom: 112, width: 12, height: 12 },
    exactHit: false,
  });
  const root = {
    querySelectorAll: (sel) => (sel === '[data-survey-marker-hit-target="true"]' ? [target] : []),
  };

  // Touch tap 8 px off the marker edge (Pass 232 repro) must select it.
  const touchNear = findNearestSurveyMarkerAt(
    { clientX: 120, clientY: 106, pointerType: 'touch' },
    root,
  );
  assert.equal(touchNear?.annotationId, 'marker-door-1');
  assert.equal(touchNear?.pageNumber, 1);

  // Touch tap far away (35 px off) must not select it.
  const touchFar = findNearestSurveyMarkerAt(
    { clientX: 147, clientY: 106, pointerType: 'touch' },
    root,
  );
  assert.equal(touchFar, null);

  // Mouse click 5 px off hits within 6 px slop; 10 px off misses.
  const mouseNear = findNearestSurveyMarkerAt(
    { clientX: 117, clientY: 106, pointerType: 'mouse' },
    root,
  );
  assert.equal(mouseNear?.annotationId, 'marker-door-1');

  const mouseFar = findNearestSurveyMarkerAt(
    { clientX: 122, clientY: 106, pointerType: 'mouse' },
    root,
  );
  assert.equal(mouseFar, null);
});

test('findNearestSurveyMarkerAt picks the closest marker when two are within touch slop', () => {
  const m1 = makeMarkerTarget({
    id: 'marker-a',
    rect: { left: 100, top: 100, right: 110, bottom: 110, width: 10, height: 10 },
  });
  const m2 = makeMarkerTarget({
    id: 'marker-b',
    rect: { left: 124, top: 100, right: 134, bottom: 110, width: 10, height: 10 },
  });
  const root = {
    querySelectorAll: () => [m1, m2],
  };

  const hit = findNearestSurveyMarkerAt({ clientX: 121, clientY: 105, pointerType: 'touch' }, root);
  assert.equal(hit?.annotationId, 'marker-b');
});

test('WalkthruHandoffDialog portals to document.body with atRoot (#1817)', () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/home/WalkthruHandoffDialog.jsx'),
    'utf8',
  );
  assert.match(src, /<DialogCard[\s\S]*?\batRoot\b/);
});

test('Select, Text Select, and Pan all wire findNearestSurveyMarkerAt (#1815)', () => {
  const svgSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/SVGAnnotationLayer.jsx'),
    'utf8',
  );
  const viewerSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/PDFViewer.jsx'),
    'utf8',
  );
  assert.match(svgSrc, /findNearestSurveyMarkerAt\(e,\s*svgRef\.current\?\.parentElement \|\| svgRef\.current\)/);
  assert.match(viewerSrc, /const marker = findNearestSurveyMarkerAt\(event\);/);
  assert.match(viewerSrc, /findNearestSurveyMarkerAt\(e,\s*undefined,\s*\{\s*touchPad:\s*16,\s*mousePad:\s*0\s*\}\)/);
});
