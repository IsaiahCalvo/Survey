import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAnnotationAt } from '../src/utils/annotationHitTest.js';

class MockElement {
  constructor(attrs = {}, rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) {
    this.attrs = attrs;
    this.rect = rect;
    this.children = [];
    this.parent = null;
    this.id = attrs.id || '';
    this.style = attrs.style || {};
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  querySelector(selector) {
    if (selector.includes('canvas.survey-pdfjs-page-canvas') || selector.includes('.survey-pdfjs-page-canvas')) {
      return this.children.find((child) => child.attrs.class === 'survey-pdfjs-page-canvas') || null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector.includes('data-path-hit-target')) {
      return this.children.filter((child) => child.attrs['data-path-hit-target'] === 'true'
        || child.attrs['data-path-bbox-hit-target'] === 'true');
    }
    if (selector.includes('data-annotation-index')) {
      return this.children.filter((child) => child.attrs['data-annotation-index'] != null
        || child.attrs['data-callout-id'] != null
        || child.attrs['data-counter-overlay'] != null);
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

test('pan fallback checks visible SVG path hit targets across wrappers', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const pageDiv = new MockElement(
    { id: 'viewer_pageDiv_0' },
    { left: 100, top: 100, right: 700, bottom: 900, width: 600, height: 800 }
  );
  const pageCanvas = new MockElement(
    { class: 'survey-pdfjs-page-canvas' },
    { left: 100, top: 100, right: 700, bottom: 900, width: 600, height: 800 }
  );
  pageDiv.children.push(pageCanvas);

  const hiddenWrapper = new MockElement(
    { 'data-diag-svg-wrapper': '1', style: { display: 'none' } },
    { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  );
  const visibleWrapper = new MockElement(
    { 'data-diag-svg-wrapper': '1', style: { display: 'block' } },
    { left: 100, top: 100, right: 700, bottom: 900, width: 600, height: 800 }
  );
  const carrier = new MockElement(
    { 'data-annotation-index': '4' },
    { left: 300, top: 300, right: 320, bottom: 320, width: 20, height: 20 }
  );
  const pathHitTarget = new MockElement(
    { 'data-path-hit-target': 'true' },
    { left: 292, top: 292, right: 328, bottom: 328, width: 36, height: 36 }
  );
  pathHitTarget.parent = carrier;
  visibleWrapper.children.push(pathHitTarget);

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
      if (selector === '[data-diag-svg-wrapper="1"]') return [hiddenWrapper, visibleWrapper];
      if (selector === '[data-group-selection-bbox="true"]') return [];
      return [];
    },
  };

  try {
    const result = resolveAnnotationAt({
      clientX: 310,
      clientY: 310,
      composedPath: () => [pageDiv],
    });

    assert.equal(result.kind, 'annotation');
    assert.equal(result.pageNumber, 1);
    assert.equal(result.annotationIndex, 4);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('resolveAnnotationAt resolves callout and counter from composed path', () => {
  const calloutEl = new MockElement({
    'data-callout-id': 'c-9',
    'data-pal-root': '2',
  });
  const calloutHit = resolveAnnotationAt({
    clientX: 1,
    clientY: 1,
    composedPath: () => [calloutEl],
  });
  assert.equal(calloutHit.kind, 'callout');
  assert.equal(calloutHit.calloutId, 'c-9');
  assert.equal(calloutHit.pageNumber, 2);

  const counterEl = new MockElement({
    'data-counter-overlay': '1',
    'data-annotation-index': '3',
    'data-diag-svg-wrapper': '4',
  });
  const counterHit = resolveAnnotationAt({
    clientX: 1,
    clientY: 1,
    composedPath: () => [counterEl],
  });
  assert.equal(counterHit.kind, 'counter');
  assert.equal(counterHit.isCounter === true || counterHit.kind === 'counter', true);
  assert.equal(counterHit.pageNumber, 4);
});

test('resolveAnnotationAt resolves multi-select group hitbox', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const wrapper = new MockElement({ 'data-diag-svg-wrapper': '3' });
  const groupBox = new MockElement(
    {
      'data-group-selection-bbox': 'true',
      'data-group-selection-indices': '1,4,7',
    },
    { left: 10, top: 10, right: 100, bottom: 100, width: 90, height: 90 },
  );
  groupBox.closest = (selector) => (selector.includes('data-diag-svg-wrapper') ? wrapper : null);
  const hitbox = new MockElement(
    { 'data-group-selection-hitbox': 'true' },
    { left: 10, top: 10, right: 100, bottom: 100, width: 90, height: 90 },
  );
  groupBox.querySelector = (sel) => (sel.includes('hitbox') ? hitbox : null);

  globalThis.window = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  globalThis.document = {
    elementsFromPoint: () => [],
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector.includes('data-group-selection-bbox')) return [groupBox];
      return [];
    },
  };

  try {
    const result = resolveAnnotationAt({
      clientX: 40,
      clientY: 40,
      composedPath: () => [],
    });
    assert.equal(result.kind, 'group');
    assert.deepEqual(result.groupIndices, [1, 4, 7]);
    assert.equal(result.pageNumber, 3);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('pageDiv-only hit rejects cursor outside page canvas bounds', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const pageDiv = new MockElement(
    { id: 'viewer_pageDiv_0' },
    { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
  );
  const pageCanvas = new MockElement(
    { class: 'survey-pdfjs-page-canvas' },
    { left: 0, top: 0, right: 50, bottom: 50, width: 50, height: 50 },
  );
  pageCanvas.width = 50;
  pageCanvas.height = 50;
  pageDiv.children.push(pageCanvas);

  globalThis.window = {
    __DIAG_HIT_TEST: true,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  globalThis.document = {
    elementsFromPoint: () => [pageDiv],
    querySelector: () => pageDiv,
    querySelectorAll: () => [],
  };

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const miss = resolveAnnotationAt({
      clientX: 80,
      clientY: 80,
      composedPath: () => [pageDiv],
    });
    assert.equal(miss.kind, 'page');
    assert.equal(miss.pageNumber, null);
    assert.ok(logs.some((l) => l.includes('HitTest pageDiv-bounds')));
  } finally {
    console.log = originalLog;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('pan fallback uses SVG geometry and annotation candidate rects', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const wrapper = new MockElement(
    { 'data-diag-svg-wrapper': '1', style: { display: 'block' } },
    { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 },
  );
  const pageDiv = new MockElement(
    { id: 'viewer_pageDiv_0', 'data-diag-svg-wrapper': '1' },
    { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 },
  );
  const pageCanvas = new MockElement(
    { class: 'survey-pdfjs-page-canvas' },
    { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 },
  );
  pageDiv.children.push(pageCanvas);

  const pathTarget = new MockElement(
    { 'data-path-hit-target': 'true' },
    { left: 10, top: 10, right: 20, bottom: 20, width: 10, height: 10 },
  );
  pathTarget.ownerSVGElement = {
    createSVGPoint: () => ({ x: 0, y: 0, matrixTransform() { return { x: 1, y: 1 }; } }),
  };
  pathTarget.getScreenCTM = () => ({ inverse() { return {}; } });
  pathTarget.isPointInStroke = () => true;
  const carrier = new MockElement({ 'data-annotation-index': '9' });
  pathTarget.parent = carrier;
  pathTarget.closest = (sel) => (sel.includes('data-annotation-index') ? carrier : null);

  const candidate = new MockElement(
    { 'data-annotation-index': '12' },
    { left: 100, top: 100, right: 120, bottom: 120, width: 20, height: 20 },
  );

  wrapper.querySelectorAll = (selector) => {
    if (selector.includes('data-path-hit-target')) return [pathTarget];
    if (selector.includes('data-annotation-index')) return [candidate];
    return [];
  };

  globalThis.window = {
    __DIAG_HIT_TEST: true,
    getComputedStyle: (el) => ({
      display: el.style?.display || 'block',
      visibility: 'visible',
      opacity: '1',
    }),
  };
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  globalThis.document = {
    elementsFromPoint: () => [pageDiv],
    querySelector: () => pageDiv,
    querySelectorAll: (selector) => {
      if (selector === '[data-diag-svg-wrapper="1"]') return [wrapper];
      if (selector.includes('group-selection')) return [];
      return [];
    },
  };

  try {
    const geoHit = resolveAnnotationAt({
      clientX: 15,
      clientY: 15,
      composedPath: () => [pageDiv],
    });
    assert.equal(geoHit.kind, 'annotation');
    assert.equal(geoHit.annotationIndex, 9);
    assert.ok(logs.some((l) => l.includes('HitTest pan-svg-fallback')));

    pathTarget.isPointInStroke = () => false;
    pathTarget.isPointInFill = () => false;
    pathTarget.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    const candHit = resolveAnnotationAt({
      clientX: 110,
      clientY: 110,
      composedPath: () => [pageDiv],
    });
    assert.equal(candHit.annotationIndex, 12);
  } finally {
    console.log = originalLog;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('group selection with fewer than two indices is ignored', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const wrapper = new MockElement({ 'data-diag-svg-wrapper': '2' });
  const groupBox = new MockElement(
    {
      'data-group-selection-bbox': 'true',
      'data-group-selection-indices': '5',
    },
    { left: 0, top: 0, right: 50, bottom: 50, width: 50, height: 50 },
  );
  groupBox.closest = () => wrapper;
  groupBox.querySelector = () => null;

  globalThis.window = { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
  globalThis.document = {
    elementsFromPoint: () => [],
    querySelector: () => null,
    querySelectorAll: (selector) => (selector.includes('group-selection') ? [groupBox] : []),
  };
  try {
    const result = resolveAnnotationAt({ clientX: 10, clientY: 10, composedPath: () => [] });
    assert.equal(result.kind, 'page');
    assert.equal(result.groupIndices, null);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('resolveAnnotationAt uses elementsFromPoint when path has no page', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const pageDiv = new MockElement(
    { id: 'viewer_pageDiv_0' },
    { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 },
  );
  const pageCanvas = new MockElement(
    { class: 'survey-pdfjs-page-canvas' },
    { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 },
  );
  pageCanvas.width = 200;
  pageCanvas.height = 200;
  pageDiv.children.push(pageCanvas);

  globalThis.window = { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
  globalThis.document = {
    elementsFromPoint: () => [pageDiv],
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  try {
    const hit = resolveAnnotationAt({
      clientX: 20,
      clientY: 20,
      composedPath: () => [],
    });
    assert.equal(hit.pageNumber, 1);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('SVG geometry miss and diag log failures are swallowed', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLog = console.log;

  const wrapper = new MockElement(
    { 'data-diag-svg-wrapper': '1', style: { display: 'block' } },
    { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 },
  );
  const pageDiv = new MockElement(
    { id: 'viewer_pageDiv_0', 'data-diag-svg-wrapper': '1' },
    { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 },
  );
  const pageCanvas = new MockElement(
    { class: 'survey-pdfjs-page-canvas' },
    { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 },
  );
  pageDiv.children.push(pageCanvas);

  const pathTarget = new MockElement(
    { 'data-path-hit-target': 'true' },
    { left: 10, top: 10, right: 20, bottom: 20, width: 10, height: 10 },
  );
  pathTarget.ownerSVGElement = {
    createSVGPoint: () => { throw new Error('svg-point-boom'); },
  };
  pathTarget.getScreenCTM = () => ({ inverse() { return {}; } });
  wrapper.children.push(pathTarget);

  console.log = () => { throw new Error('log-boom'); };
  globalThis.window = {
    __DIAG_HIT_TEST: true,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  globalThis.document = {
    elementsFromPoint: () => [pageDiv],
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector.includes('data-diag-svg-wrapper')) return [wrapper];
      return [];
    },
  };
  try {
    const hit = resolveAnnotationAt({
      clientX: 15,
      clientY: 15,
      composedPath: () => [pageDiv],
    });
    assert.equal(hit.kind, 'page');
  } finally {
    console.log = originalLog;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
