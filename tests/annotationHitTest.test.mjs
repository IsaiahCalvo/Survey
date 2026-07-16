import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAnnotationAt } from '../src/utils/annotationHitTest.js';
import { registerAnnotationHitSource } from '../src/utils/annotationGeometryHitSource.js';

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

// Canvas presentation (post-a3380bbf): no SVG wrapper DOM exists under
// pan / drawing tools. The geometry fallback must resolve hits from the
// registered per-page hit source instead.
const withCanvasPresentationDom = (pageDivRect, run) => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const pageDiv = new MockElement({ id: 'viewer_pageDiv_0' }, pageDivRect);
  const pageCanvas = new MockElement({ class: 'survey-pdfjs-page-canvas' }, pageDivRect);
  pageDiv.children.push(pageCanvas);

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
    querySelectorAll: () => [],
  };

  try {
    run(pageDiv);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
};

test('geometry fallback resolves annotations when no SVG DOM is mounted', () => {
  const pageRect = { left: 100, top: 100, right: 712, bottom: 892, width: 612, height: 792 };
  withCanvasPresentationDom(pageRect, (pageDiv) => {
    const surfaceEl = new MockElement({}, pageRect);
    const unregister = registerAnnotationHitSource(1, () => ({
      surfaceEl,
      pageWidth: 612,
      pageHeight: 792,
      items: [{
        obj: {
          type: 'rect', left: 50, top: 50, width: 100, height: 80,
          fill: '#ff0000', stroke: 'transparent', strokeWidth: 0,
          scaleX: 1, scaleY: 1, angle: 0,
        },
        index: 9,
      }],
      callouts: [{
        id: 'callout-geo',
        pageNumber: 1,
        arrowTip: { x: 0.6, y: 0.6 },
        knee: { x: 0.7, y: 0.6 },
        textBoxPosition: { x: 0.8, y: 0.55 },
        textBoxWidth: 0.15,
        textBoxHeight: 0.08,
        style: { lineThickness: 2 },
      }],
    }));
    try {
      // Page rect == page units here (612x792 at scale 1, offset 100,100).
      const annotationHit = resolveAnnotationAt({
        clientX: 100 + 90,
        clientY: 100 + 90,
        composedPath: () => [pageDiv],
      });
      assert.equal(annotationHit.kind, 'annotation');
      assert.equal(annotationHit.pageNumber, 1);
      assert.equal(annotationHit.annotationIndex, 9);

      const calloutHit = resolveAnnotationAt({
        clientX: 100 + 0.85 * 612,
        clientY: 100 + 0.58 * 792,
        composedPath: () => [pageDiv],
      });
      assert.equal(calloutHit.kind, 'callout');
      assert.equal(calloutHit.calloutId, 'callout-geo');

      const emptyHit = resolveAnnotationAt({
        clientX: 100 + 400,
        clientY: 100 + 400,
        composedPath: () => [pageDiv],
      });
      assert.equal(emptyHit.kind, 'page');
    } finally {
      unregister();
    }
  });
});

test('geometry fallback declines when cursor is outside the registered surface (sidebar thumbnail)', () => {
  // Thumbnail-sized pageDiv in the sidebar; the real page surface lives
  // elsewhere on screen. The fallback must not translate thumbnail-space
  // cursor positions into main-page hits.
  const thumbRect = { left: 0, top: 0, right: 120, bottom: 160, width: 120, height: 160 };
  withCanvasPresentationDom(thumbRect, (pageDiv) => {
    const surfaceEl = new MockElement({}, { left: 500, top: 100, right: 1112, bottom: 892, width: 612, height: 792 });
    const unregister = registerAnnotationHitSource(1, () => ({
      surfaceEl,
      pageWidth: 612,
      pageHeight: 792,
      items: [{
        obj: {
          type: 'rect', left: 0, top: 0, width: 612, height: 792,
          fill: '#ff0000', stroke: 'transparent', strokeWidth: 0,
          scaleX: 1, scaleY: 1, angle: 0,
        },
        index: 0,
      }],
      callouts: [],
    }));
    try {
      const result = resolveAnnotationAt({
        clientX: 60,
        clientY: 80,
        composedPath: () => [pageDiv],
      });
      assert.equal(result.kind, 'page');
      assert.equal(result.annotationIndex, null);
    } finally {
      unregister();
    }
  });
});
