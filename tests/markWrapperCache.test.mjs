// Perf guard (dense-sheet drags): a drag frame rebuilds and reconciles only
// the marks it moves. Every pointermove sets the layer's visualTransform; the
// layer used to rebuild every mark's wrapper (hit target, glow, handlers) and
// React reconciled all of them — about 9 ms per frame on a 667-mark sheet.
// Now an unmoved mark keeps its wrapper element (utils/markWrapperCache.js),
// so React skips it.
//
// Measured on the dense seed (667 marks on the sheet): see
// /mnt/project-files/perf/speed-round-3.md, Round 7.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMarkWrapperCache, mapMarkWrappers, markWrapperIsLive } from '../src/utils/markWrapperCache.js';

const require = createRequire(import.meta.url);
const LAYER_PATH = new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url);

// ---------------------------------------------------------------------------
// The helper
// ---------------------------------------------------------------------------
test('a mark is live when the gesture moves, previews, edits or turns it', () => {
  const group = { id: 'group', dx: 1, dy: 1, affectedIds: new Set([2, 5]) };
  assert.equal(markWrapperIsLive(3, {}), false);
  assert.equal(markWrapperIsLive(3, { visualTransform: { id: 3, dx: 1, dy: 0 } }), true);
  assert.equal(markWrapperIsLive(4, { visualTransform: { id: 3, dx: 1, dy: 0 } }), false);
  assert.equal(markWrapperIsLive(5, { visualTransform: group }), true);
  assert.equal(markWrapperIsLive(4, { visualTransform: group }), false);
  assert.equal(markWrapperIsLive(4, { visualTransform: { id: 'group', previewObjects: { 4: {} } } }), true);
  assert.equal(markWrapperIsLive(4, { counterHandlePreview: { annotationIndex: 4, pointerAngle: 10 } }), true);
  assert.equal(markWrapperIsLive(4, { editingAnnotationIndex: 4 }), true);
  assert.equal(markWrapperIsLive(0, { editingAnnotationIndex: null }), false);
});

test('unchanged marks get their previous element back; a changed key, a live mark or new shared values rebuild', () => {
  const cache = createMarkWrapperCache();
  let built = 0;
  const render = (entry) => { built += 1; return { built, index: entry.index }; };
  const a = { index: 0, obj: {} };
  const b = { index: 1, obj: {} };
  const keyOf = (live) => (entry) => (live.has(entry.index) ? null : [entry.obj]);
  const first = mapMarkWrappers(cache, ['s'], [a, b], keyOf(new Set()), render);
  const second = mapMarkWrappers(cache, ['s'], [a, b], keyOf(new Set()), render);
  assert.equal(second[0], first[0]);
  assert.equal(second[1], first[1]);
  assert.equal(built, 2);
  const third = mapMarkWrappers(cache, ['s'], [a, b], keyOf(new Set([1])), render);
  assert.equal(third[0], first[0]);
  assert.notEqual(third[1], first[1], 'a live mark is built fresh');
  const fourth = mapMarkWrappers(cache, ['s'], [a, { index: 1, obj: {} }], keyOf(new Set()), render);
  assert.notEqual(fourth[1], third[1], 'a new mark object rebuilds');
  assert.equal(fourth[0], first[0]);
  const fifth = mapMarkWrappers(cache, ['t'], [a, b], keyOf(new Set()), render);
  assert.notEqual(fifth[0], first[0], 'a new shared value rebuilds every mark');
  assert.equal(cache.byIndex.size, 2, 'only the current marks are kept');
});

// ---------------------------------------------------------------------------
// The wrapper body reads nothing from the component that the cache does not
// key on. A new value read inside renderMarkWrapper must be added to the
// shared list or the per-mark key, or a kept wrapper would go stale.
// ---------------------------------------------------------------------------
test('every component value the wrapper body reads is keyed', () => {
  const { parse } = require('@babel/parser');
  const traverse = require('@babel/traverse').default;
  const source = readFileSync(LAYER_PATH, 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let reads = null;
  let sharedNames = null;
  traverse(ast, {
    VariableDeclarator(path) {
      if (path.node.id.name === 'renderMarkWrapper') {
        const fn = path.get('init');
        reads = new Set();
        fn.traverse({
          Identifier(p) {
            if (!p.isReferencedIdentifier()) return;
            const binding = p.scope.getBinding(p.node.name);
            if (!binding || binding.scope.path.type === 'Program') return;
            for (let s = binding.scope; s; s = s.parent) if (s === fn.scope) return;
            reads.add(p.node.name);
          },
        });
      }
      if (path.node.id.name === 'wrappedAnnotations') {
        const call = path.node.init;
        assert.equal(call.callee.name, 'mapMarkWrappers');
        sharedNames = new Set(call.arguments[1].elements.map((el) => el.name));
      }
    },
  });
  assert.ok(reads && sharedNames, 'renderMarkWrapper / mapMarkWrappers not found');
  // Read per mark (the key: selectedIds.has(i), hoveredId === i) or only by
  // live marks (markWrapperIsLive), or covered by the shared values.
  const covered = new Map([
    ['selectedIds', 'per-mark key + markWrapperMultiSelection'],
    ['effectiveSelectedCalloutIds', 'markWrapperMultiSelection'],
    ['hoveredId', 'per-mark key'],
    ['visualTransform', 'live marks only'],
    ['counterHandlePreview', 'live marks only'],
    ['editingAnnotationIndex', 'live marks only'],
    ['editingAnnotationEditType', 'read only for the edited (live) mark'],
    ['liveTextEditBounds', 'read only for the edited (live) mark'],
    ['liveMeasureLabels', 'written only for live marks; a new Map each render'],
    ['markHitBand', 'a pure function of inverseScale + inputKind (shared)'],
    ['cachedMarkGeometry', 'a pure cache over its WeakMaps'],
  ]);
  const unkeyed = [...reads].filter((name) => !sharedNames.has(name) && !covered.has(name));
  assert.deepEqual(unkeyed, [], `renderMarkWrapper reads values the cache does not key on: ${unkeyed.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Mounted: a drag re-renders only the dragged mark.
// ---------------------------------------------------------------------------
let dom;
let vite;
let React;
let act;
let createRoot;
let SVGAnnotationLayer;
let mounted = null;

before(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    SVGElement: dom.window.SVGElement, Node: dom.window.Node,
    MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver,
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
  React = (await import('react')).default;
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const { createServer } = await import('vite');
  vite = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    ssr: { external: ['@survey/shared'] },
  });
  ({ default: SVGAnnotationLayer } = await vite.ssrLoadModule('/src/components/SVGAnnotationLayer.jsx'));
});

after(async () => { await vite?.close(); dom?.window.close(); });
afterEach(async () => {
  if (mounted) await act(async () => mounted.unmount());
  mounted = null;
});

const rect = (id, left, top) => ({
  type: 'rect', id, left, top, width: 30, height: 20,
  scaleX: 1, scaleY: 1, angle: 0, fill: 'transparent', stroke: '#111827',
  strokeWidth: 2, data: { id },
});

function pointer(type, x, y, init = {}) {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, ...init,
  });
}

// React DOM keeps the props it last rendered a host element with on the node.
// A wrapper React reconciled gets a new props object for its hit target (the
// inline handlers are new each build); a wrapper React skipped keeps it.
const reactPropsOf = (node) => {
  const k = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  return k ? node[k] : undefined;
};

const MARKS = 12;
const grid = () => Array.from({ length: MARKS }, (_, n) => rect(`m${n}`, 20 + (n % 4) * 90, 20 + Math.floor(n / 4) * 90));

async function mountLayer() {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  mounted = root;
  const saves = [];
  const props = {
    pageNumber: 1, width: 400, height: 400, annotations: { objects: grid() },
    callouts: [], surveyMarkers: [],
    onSaveAnnotations: (next, context) => saves.push({ next, context }),
    activeTool: 'select', selectedCalloutIds: new Set(),
    onSelectedCalloutIdsChange: () => {}, onSelectionChange: () => {},
    selectedModuleId: null, showSurveyPanel: false, selectedSpaceId: null,
    activeSpaceId: null, activeRegions: [], activeRegionId: null, spaces: [],
    layerVisibility: {}, viewerId: 'owner', documentOwnerId: 'owner',
  };
  await act(async () => root.render(React.createElement(SVGAnnotationLayer, props)));
  const svg = document.querySelector('[data-svg-annotation-layer="1"]');
  Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 400 });
  const hitOf = (index) => document.querySelector(`[data-annotation-index="${index}"] [data-shape-hit-target="rect"]`);
  const snapshot = () => Array.from({ length: MARKS }, (_, n) => reactPropsOf(hitOf(n)));
  return { svg, saves, hitOf, snapshot };
}

test('a drag frame re-renders the dragged mark only; the drop lands where it did before', async () => {
  const m = await mountLayer();
  assert.ok(reactPropsOf(m.hitOf(0)), 'React DOM props are readable on the hit target');
  // Select mark 5, then press on it and start the drag.
  const start = { x: 21 + 90, y: 30 + 90 };
  await act(async () => {
    m.hitOf(5).dispatchEvent(pointer('pointerdown', start.x, start.y));
    m.hitOf(5).dispatchEvent(pointer('pointerup', start.x, start.y));
  });
  await act(async () => { m.hitOf(5).dispatchEvent(pointer('pointerdown', start.x, start.y)); });
  await act(async () => { m.svg.dispatchEvent(pointer('pointermove', start.x + 10, start.y + 6)); });
  assert.ok(m.svg.parentNode.querySelector('[data-svg-annotation-lift]'), 'the move is live (lifted)');
  const before = m.snapshot();
  const movedBefore = reactPropsOf(m.hitOf(5));
  let rerendered = 0;
  for (let step = 2; step <= 6; step += 1) {
    await act(async () => { m.svg.dispatchEvent(pointer('pointermove', start.x + 10 * step, start.y + 6 * step)); });
    const now = m.snapshot();
    for (let n = 0; n < MARKS; n += 1) if (n !== 5 && now[n] !== before[n]) rerendered += 1;
  }
  assert.equal(rerendered, 0, 'unmoved marks were re-rendered during the drag');
  assert.notEqual(reactPropsOf(m.hitOf(5)), movedBefore, 'the dragged mark follows every frame');
  const lift = m.svg.parentNode.querySelector('[data-svg-annotation-lift]');
  assert.ok(lift.querySelector('[data-annotation-index="5"]'), 'the dragged mark draws in the lift layer');
  assert.match(lift.style.transform, /translate\(/);

  await act(async () => { m.svg.dispatchEvent(pointer('pointerup', start.x + 60, start.y + 36)); });
  const moved = m.saves.at(-1)?.next?.objects;
  assert.ok(moved, 'the drop saved');
  assert.equal(moved[5].left, 110 + 60);
  assert.equal(moved[5].top, 110 + 36);
  for (let n = 0; n < MARKS; n += 1) {
    if (n === 5) continue;
    assert.equal(moved[n].left, grid()[n].left);
    assert.equal(moved[n].top, grid()[n].top);
  }
  assert.equal(m.svg.parentNode.querySelector('[data-svg-annotation-lift]'), null, 'the lift ends with the drag');
});

test('selection and hover still repaint the marks they change', async () => {
  const m = await mountLayer();
  const pick = async (index, extra = {}) => {
    const hit = m.hitOf(index);
    const r = { x: Number(hit.getAttribute('x')) + 1, y: Number(hit.getAttribute('y')) + 5 };
    await act(async () => {
      hit.dispatchEvent(pointer('pointerdown', r.x, r.y, extra));
      hit.dispatchEvent(pointer('pointerup', r.x, r.y, extra));
    });
  };
  await pick(2);
  const wrapper = (n) => document.querySelector(`[data-annotation-index="${n}"]`);
  assert.equal(wrapper(2).style.cursor, 'move', 'the picked mark shows the move cursor');
  assert.equal(wrapper(3).style.cursor, '');
  await pick(3);
  assert.equal(wrapper(2).style.cursor, '', 'the old pick lost its selected look');
  assert.equal(wrapper(3).style.cursor, 'move');
  // A second member: both members show the multi-selection glow.
  await pick(7, { shiftKey: true });
  assert.ok(wrapper(3).querySelector('[data-hover-glow="rect"]'), 'multi-selection glow on the first member');
  assert.ok(wrapper(7).querySelector('[data-hover-glow="rect"]'), 'multi-selection glow on the added member');
  assert.equal(wrapper(0).querySelector('[data-hover-glow="rect"]'), null);
});
