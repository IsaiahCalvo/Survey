import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';

let dom;
let vite;
let SVGAnnotationLayer;

before(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    SVGElement: dom.window.SVGElement, Node: dom.window.Node,
    MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: clearTimeout,
    ResizeObserver: class { observe() {} disconnect() {} },
    DOMPoint: class { constructor(x, y) { this.x = x; this.y = y; } matrixTransform() { return this; } },
  });
  class TestPointerEvent extends dom.window.MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      Object.defineProperties(this, {
        pointerId: { value: init.pointerId ?? 1 }, pointerType: { value: init.pointerType ?? 'mouse' },
        isPrimary: { value: init.isPrimary ?? true }, pressure: { value: init.pressure ?? 0.5 },
      });
    }
    getCoalescedEvents() { return [this]; }
  }
  dom.window.PointerEvent = TestPointerEvent;
  globalThis.PointerEvent = TestPointerEvent;
  dom.window.SVGElement.prototype.getScreenCTM = () => ({ inverse: () => ({}) });
  dom.window.Element.prototype.setPointerCapture = function (id) { this.__pointerId = id; };
  dom.window.Element.prototype.hasPointerCapture = function (id) { return this.__pointerId === id; };
  dom.window.Element.prototype.releasePointerCapture = function (id) { if (this.__pointerId === id) this.__pointerId = null; };
  vite = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    ssr: { external: ['@survey/shared'] },
  });
  ({ default: SVGAnnotationLayer } = await vite.ssrLoadModule('/src/components/SVGAnnotationLayer.jsx'));
});

after(async () => { await vite?.close(); dom?.window.close(); });

const mark = () => ({
  type: 'rect', id: 'mark-1', left: 20, top: 20, width: 60, height: 60,
  scaleX: 1, scaleY: 1, angle: 0, fill: 'transparent', stroke: '#111827',
  strokeWidth: 2, data: { id: 'mark-1' },
});

function pointer(type, x, y, pointerId = 1) {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: x, clientY: y, pointerId, pointerType: 'mouse', isPrimary: true,
  });
}

async function mountLayer(overrides = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  const commits = [];
  const baseProps = {
    pageNumber: 1, width: 100, height: 100, annotations: { objects: [mark()] },
    callouts: [], surveyMarkers: [], onSaveAnnotations: (next) => commits.push(next),
    activeTool: 'select', selectionMode: 'lasso', selectedCalloutIds: new Set(),
    onSelectedCalloutIdsChange: () => {}, onSelectionChange: () => {},
    selectedModuleId: null, showSurveyPanel: false, selectedSpaceId: null,
    activeSpaceId: null, activeRegions: [], activeRegionId: null, spaces: [],
    layerVisibility: {}, viewerId: 'owner', documentOwnerId: 'owner', ...overrides,
  };
  await act(async () => root.render(React.createElement(SVGAnnotationLayer, baseProps)));
  const svg = document.querySelector('[data-svg-annotation-layer="1"]');
  Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 100 });
  return {
    root, svg, commits,
    rerender: async (next) => act(async () => root.render(React.createElement(SVGAnnotationLayer, { ...baseProps, ...next }))),
  };
}

test('mounted lasso click-selects a mark and leaves all resize handles live', async () => {
  const mounted = await mountLayer();
  const hit = mounted.svg.querySelector('[data-annotation-index="0"] [data-shape-hit-target="rect"]');
  await act(async () => { hit.dispatchEvent(pointer('pointerdown', 40, 40)); hit.dispatchEvent(pointer('pointerup', 40, 40)); });
  assert.equal(mounted.svg.querySelectorAll('[data-resize-handle]').length, 8);
  assert.equal(mounted.svg.querySelector('[data-lasso-selection-preview]'), null);
  await act(async () => mounted.root.unmount());
});

test('mounted lasso result moves and resizes through normal selection paths', async () => {
  const mounted = await mountLayer();
  await act(async () => {
    mounted.svg.dispatchEvent(pointer('pointerdown', 10, 10));
    for (const [x, y] of [[90, 10], [90, 90], [10, 90]]) mounted.svg.dispatchEvent(pointer('pointermove', x, y));
    mounted.svg.dispatchEvent(pointer('pointerup', 10, 10));
  });
  assert.equal(mounted.svg.querySelectorAll('[data-resize-handle]').length, 8);
  const hit = mounted.svg.querySelector('[data-annotation-index="0"] [data-shape-hit-target="rect"]');
  await act(async () => {
    hit.dispatchEvent(pointer('pointerdown', 40, 40, 2));
    mounted.svg.dispatchEvent(pointer('pointermove', 50, 50, 2));
    mounted.svg.dispatchEvent(pointer('pointerup', 50, 50, 2));
  });
  assert.equal(mounted.commits.at(-1).objects[0].left, 30);
  assert.equal(mounted.commits.at(-1).objects[0].top, 30);
  await mounted.rerender({ annotations: mounted.commits.at(-1) });
  const resize = mounted.svg.querySelector('[data-resize-handle="br"]');
  await act(async () => {
    resize.dispatchEvent(pointer('pointerdown', 90, 90, 3));
    mounted.svg.dispatchEvent(pointer('pointermove', 95, 95, 3));
    mounted.svg.dispatchEvent(pointer('pointerup', 95, 95, 3));
  });
  assert.ok(mounted.commits.at(-1).objects[0].scaleX > 1);
  assert.ok(mounted.commits.at(-1).objects[0].scaleY > 1);
  await act(async () => mounted.root.unmount());
});

test('mounted lasso clears its trail when a tool switch or zoom takes over', async () => {
  const mounted = await mountLayer();
  await act(async () => { mounted.svg.dispatchEvent(pointer('pointerdown', 10, 10)); mounted.svg.dispatchEvent(pointer('pointermove', 20, 20)); });
  assert.ok(mounted.svg.querySelector('[data-lasso-selection-preview]'));
  await mounted.rerender({ activeTool: 'pen' });
  assert.equal(mounted.svg.querySelector('[data-lasso-selection-preview]'), null);
  await mounted.rerender({ activeTool: 'select' });
  await act(async () => { mounted.svg.dispatchEvent(pointer('pointerdown', 10, 10, 2)); mounted.svg.dispatchEvent(pointer('pointermove', 20, 20, 2)); });
  assert.ok(mounted.svg.querySelector('[data-lasso-selection-preview]'));
  await mounted.rerender({ activeTool: 'select', zoomGeneration: 1 });
  assert.equal(mounted.svg.querySelector('[data-lasso-selection-preview]'), null);
  await act(async () => mounted.root.unmount());
});
