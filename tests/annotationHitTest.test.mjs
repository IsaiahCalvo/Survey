import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAnnotationAt } from '../src/utils/annotationHitTest.js';

// ---------------------------------------------------------------------------
// Mocks
//
// MockElement supports the two hit paths resolveAnnotationAt uses:
//  - geometry pass: ownerSVGElement/createSVGPoint/getScreenCTM +
//    isPointInStroke/isPointInFill (opt-in via the `geometry` option, with
//    per-element predicates over the local point — identity CTM)
//  - bbox pass: getBoundingClientRect containment
// ---------------------------------------------------------------------------

const IDENTITY_SVG = {
  createSVGPoint() {
    return {
      x: 0,
      y: 0,
      matrixTransform() {
        return { x: this.x, y: this.y };
      },
    };
  },
};

class MockElement {
  constructor(attrs = {}, rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }, geometry = null) {
    this.attrs = attrs;
    this.rect = rect;
    this.children = [];
    this.parent = null;
    this.id = attrs.id || '';
    this.style = attrs.style || {};
    if (geometry) {
      // Simulates a real SVGGeometryElement: identity screen CTM, so the
      // local point handed to the predicates is just (clientX, clientY).
      this.ownerSVGElement = IDENTITY_SVG;
      this.getScreenCTM = () => ({ inverse: () => ({}) });
      this.isPointInStroke = (pt) => !!geometry.stroke && geometry.stroke(pt);
      this.isPointInFill = (pt) => !!geometry.fill && geometry.fill(pt);
    }
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  descendants() {
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  matches(selector) {
    if (selector.includes('data-path-hit-target') || selector.includes('data-shape-hit-target')) {
      return this.attrs['data-path-hit-target'] === 'true'
        || this.attrs['data-shape-hit-target'] != null;
    }
    return false;
  }

  querySelector(selector) {
    if (selector.includes('canvas.survey-pdfjs-page-canvas') || selector.includes('.survey-pdfjs-page-canvas')) {
      return this.children.find((child) => child.attrs.class === 'survey-pdfjs-page-canvas') || null;
    }
    if (selector.includes('data-path-hit-target') || selector.includes('data-shape-hit-target')) {
      return this.descendants().find((el) => el.matches(selector)) || null;
    }
    return null;
  }

  querySelectorAll(selector) {
    const all = this.descendants();
    if (selector === '[data-callout-part]') {
      return all.filter((el) => el.attrs['data-callout-part'] != null);
    }
    if (selector.includes('data-path-hit-target') || selector.includes('data-shape-hit-target')) {
      return all.filter((el) => el.attrs['data-path-hit-target'] === 'true'
        || el.attrs['data-shape-hit-target'] != null
        || (selector.includes('data-path-bbox-hit-target') && el.attrs['data-path-bbox-hit-target'] === 'true'));
    }
    if (selector.includes('data-annotation-index')) {
      return all.filter((el) => el.attrs['data-annotation-index'] != null
        || el.attrs['data-callout-id'] != null
        || el.attrs['data-counter-overlay'] != null
        || el.attrs['data-path-bbox-hit-target'] === 'true');
    }
    return [];
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (selector.includes('data-annotation-index') && current.attrs['data-annotation-index'] != null) return current;
      if (selector.includes('data-callout-id') && current.attrs['data-callout-id'] != null) return current;
      if (selector.includes('data-counter-overlay') && current.attrs['data-counter-overlay'] != null) return current;
      current = current.parent;
    }
    return null;
  }
}

const PAGE_RECT = { left: 100, top: 100, right: 700, bottom: 900, width: 600, height: 800 };

function makeEnv({ wrapperChildren = [] }) {
  const pageDiv = new MockElement({ id: 'viewer_pageDiv_0' }, PAGE_RECT);
  const pageCanvas = new MockElement({ class: 'survey-pdfjs-page-canvas' }, PAGE_RECT);
  pageDiv.children.push(pageCanvas);

  const visibleWrapper = new MockElement(
    { 'data-diag-svg-wrapper': '1', style: { display: 'block' } },
    PAGE_RECT
  );
  for (const child of wrapperChildren) {
    child.parent = child.parent || visibleWrapper;
    visibleWrapper.children.push(child);
  }

  const install = () => {
    globalThis.window = {
      getComputedStyle: (el) => ({
        display: el.style.display || 'block',
        visibility: el.style.visibility || 'visible',
        opacity: el.style.opacity || '1',
      }),
    };
    globalThis.document = {
      elementsFromPoint: () => [pageDiv],
      querySelector: () => pageDiv,
      querySelectorAll: (selector) => {
        if (selector === '[data-diag-svg-wrapper="1"]') return [visibleWrapper];
        if (selector === '[data-group-selection-bbox="true"]') return [];
        return [];
      },
    };
  };

  return { pageDiv, visibleWrapper, install };
}

function runResolve(env, clientX, clientY) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  env.install();
  try {
    return resolveAnnotationAt({
      clientX,
      clientY,
      composedPath: () => [env.pageDiv],
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('pan fallback: on-stroke point resolves via real path geometry', () => {
  const carrier = new MockElement(
    { 'data-annotation-index': '4' },
    { left: 300, top: 300, right: 320, bottom: 320, width: 20, height: 20 }
  );
  // Stroke geometry: a thin diagonal band — only points where x === y hit.
  const pathHitTarget = new MockElement(
    { 'data-path-hit-target': 'true', fill: 'none' },
    { left: 292, top: 292, right: 328, bottom: 328, width: 36, height: 36 },
    { stroke: (pt) => Math.abs(pt.x - pt.y) <= 2 }
  );
  pathHitTarget.parent = carrier;
  carrier.children.push(pathHitTarget);

  const env = makeEnv({ wrapperChildren: [carrier] });
  const result = runResolve(env, 310, 310);
  assert.equal(result.kind, 'annotation');
  assert.equal(result.pageNumber, 1);
  assert.equal(result.annotationIndex, 4);
});

test('pan fallback: in-bbox-but-off-geometry point does NOT hit a curved path', () => {
  const carrier = new MockElement(
    { 'data-annotation-index': '4' },
    { left: 300, top: 300, right: 400, bottom: 400, width: 100, height: 100 }
  );
  const pathHitTarget = new MockElement(
    { 'data-path-hit-target': 'true', fill: 'none' },
    { left: 300, top: 300, right: 400, bottom: 400, width: 100, height: 100 },
    { stroke: (pt) => Math.abs(pt.x - pt.y) <= 2 }
  );
  pathHitTarget.parent = carrier;
  carrier.children.push(pathHitTarget);

  const env = makeEnv({ wrapperChildren: [carrier] });
  // Inside the path's bounding rect, far from the stroke band.
  const result = runResolve(env, 390, 310);
  assert.equal(result.kind, 'page');
  assert.equal(result.annotationIndex, null);
});

test('pan fallback: hollow rect interior does NOT hit; its stroke edge does', () => {
  const carrier = new MockElement(
    { 'data-annotation-index': '7' },
    { left: 200, top: 200, right: 500, bottom: 500, width: 300, height: 300 }
  );
  // Hollow rect: fill "none" → fill test gated off. Stroke band = the 10px
  // perimeter ring of the 200..500 square.
  const onPerimeter = (pt) => {
    const inOuter = pt.x >= 195 && pt.x <= 505 && pt.y >= 195 && pt.y <= 505;
    const inInner = pt.x > 210 && pt.x < 490 && pt.y > 210 && pt.y < 490;
    return inOuter && !inInner;
  };
  const rectHitTarget = new MockElement(
    { 'data-shape-hit-target': 'rect', fill: 'none' },
    { left: 200, top: 200, right: 500, bottom: 500, width: 300, height: 300 },
    { stroke: onPerimeter, fill: () => true /* implicit interior — must be ignored for fill="none" */ }
  );
  rectHitTarget.parent = carrier;
  carrier.children.push(rectHitTarget);

  const env = makeEnv({ wrapperChildren: [carrier] });

  const interior = runResolve(env, 350, 350);
  assert.equal(interior.kind, 'page');
  assert.equal(interior.annotationIndex, null);

  const edge = runResolve(env, 205, 350);
  assert.equal(edge.kind, 'annotation');
  assert.equal(edge.annotationIndex, 7);
});

test('pan fallback: filled ink outline interior hits via isPointInFill', () => {
  const carrier = new MockElement(
    { 'data-annotation-index': '2' },
    { left: 300, top: 300, right: 360, bottom: 320, width: 60, height: 20 }
  );
  // Filled outline polygon (native pen stroke): hit target declares an
  // active fill (rgba hit paint) so the interior counts.
  const inkHitTarget = new MockElement(
    { 'data-path-hit-target': 'true', fill: 'rgba(0,0,0,0.001)' },
    { left: 300, top: 300, right: 360, bottom: 320, width: 60, height: 20 },
    {
      stroke: () => false,
      fill: (pt) => pt.x >= 300 && pt.x <= 360 && pt.y >= 300 && pt.y <= 320,
    }
  );
  inkHitTarget.parent = carrier;
  carrier.children.push(inkHitTarget);

  const env = makeEnv({ wrapperChildren: [carrier] });
  const result = runResolve(env, 330, 310);
  assert.equal(result.kind, 'annotation');
  assert.equal(result.annotationIndex, 2);
});

test('pan fallback: carrier with geometry targets is skipped by the bbox pass', () => {
  // The carrier itself carries data-annotation-index and its rect contains
  // the cursor, but the shape geometry misses — the bbox candidates pass
  // must NOT resurrect the hit.
  const carrier = new MockElement(
    { 'data-annotation-index': '9' },
    { left: 200, top: 200, right: 500, bottom: 500, width: 300, height: 300 }
  );
  const shapeTarget = new MockElement(
    { 'data-shape-hit-target': 'ellipse', fill: 'none' },
    { left: 200, top: 200, right: 500, bottom: 500, width: 300, height: 300 },
    { stroke: () => false }
  );
  shapeTarget.parent = carrier;
  carrier.children.push(shapeTarget);

  const env = makeEnv({ wrapperChildren: [carrier] });
  const result = runResolve(env, 350, 350);
  assert.equal(result.kind, 'page');
  assert.equal(result.annotationIndex, null);
});

test('pan fallback: intentionally-bbox carrier (freetext-style, no geometry children) still hits', () => {
  const carrier = new MockElement(
    { 'data-annotation-index': '5' },
    { left: 300, top: 300, right: 420, bottom: 360, width: 120, height: 60 }
  );
  const env = makeEnv({ wrapperChildren: [carrier] });
  const result = runResolve(env, 350, 330);
  assert.equal(result.kind, 'annotation');
  assert.equal(result.annotationIndex, 5);
});

test('pan fallback: callout resolves with its id via the bbox pass', () => {
  const calloutGroup = new MockElement(
    { 'data-callout-id': 'callout-abc' },
    { left: 300, top: 300, right: 500, bottom: 420, width: 200, height: 120 }
  );
  const env = makeEnv({ wrapperChildren: [calloutGroup] });
  const result = runResolve(env, 400, 350);
  assert.equal(result.kind, 'callout');
  assert.equal(result.calloutId, 'callout-abc');
  assert.equal(result.pageNumber, 1);
});

test('pan fallback: overlapping bbox carriers resolve to the TOP-most (w52 stacking order)', () => {
  const bottom = new MockElement(
    { 'data-callout-id': 'callout-under' },
    { left: 300, top: 300, right: 500, bottom: 420, width: 200, height: 120 }
  );
  const top = new MockElement(
    { 'data-annotation-index': '2' },
    { left: 320, top: 310, right: 480, bottom: 400, width: 160, height: 90 }
  );
  // Document order = paint order: the text box is drawn above the callout.
  const env = makeEnv({ wrapperChildren: [bottom, top] });
  const result = runResolve(env, 400, 350);
  assert.equal(result.kind, 'annotation');
  assert.equal(result.annotationIndex, 2);
});

test('pan fallback: a text box in the empty part of a callout box above it still wins (w52)', () => {
  const callout = new MockElement(
    { 'data-callout-id': 'callout-over' },
    { left: 300, top: 300, right: 600, bottom: 500, width: 300, height: 200 }
  );
  // The callout's parts: its text box sits top-left, far from the point.
  const calloutBox = new MockElement(
    { 'data-callout-part': 'textBox' },
    { left: 300, top: 300, right: 380, bottom: 330, width: 80, height: 30 }
  );
  calloutBox.parent = callout;
  callout.children.push(calloutBox);
  const textBox = new MockElement(
    { 'data-annotation-index': '4' },
    { left: 480, top: 440, right: 560, bottom: 480, width: 80, height: 40 }
  );
  // Paint order: text box first, callout drawn above it.
  const env = makeEnv({ wrapperChildren: [textBox, callout] });
  const onTextBox = runResolve(env, 500, 460);
  assert.equal(onTextBox.kind, 'annotation');
  assert.equal(onTextBox.annotationIndex, 4);
  const onCalloutBox = runResolve(env, 320, 310);
  assert.equal(onCalloutBox.kind, 'callout');
});

test('counter tool overlay: right-click on a placed mark resolves the mark, bare page stays counter (w52)', () => {
  const pin = new MockElement(
    { 'data-annotation-index': '7' },
    { left: 300, top: 300, right: 340, bottom: 340, width: 40, height: 40 }
  );
  const env = makeEnv({ wrapperChildren: [pin] });
  const overlay = new MockElement({ 'data-counter-overlay': '1' }, PAGE_RECT);
  const resolveThroughOverlay = (x, y) => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    env.install();
    try {
      return resolveAnnotationAt({ clientX: x, clientY: y, composedPath: () => [overlay, env.pageDiv] });
    } finally {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
    }
  };
  const onPin = resolveThroughOverlay(320, 320);
  assert.equal(onPin.kind, 'annotation');
  assert.equal(onPin.annotationIndex, 7);
  const onPage = resolveThroughOverlay(600, 800);
  assert.equal(onPage.kind, 'counter');
});
