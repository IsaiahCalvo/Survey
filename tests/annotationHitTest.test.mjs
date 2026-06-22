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
