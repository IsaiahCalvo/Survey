// Perf guard (dense-sheet drags): the selection quick bar stays out of a
// drag's frames. The bar hides while the pick is moved, resized or rotated
// (data-selection-gesture on its page layer), but every frame of the drag
// rewrites the page, which wakes its placement pass. That pass used to read
// the whole selection again each time: a document-wide query for the page
// layer, three more over every mark of the layer, and one for degree boxes,
// about 2 ms a frame on a 667-mark sheet, for a bar that stays hidden.
// Now, while the same pick's layer is still mid-gesture, the pass checks only
// that flag; the gesture's end (or a new pick) reads the page in full again.
//
// Measured on the dense seed: see /mnt/project-files/perf/speed-round-3.md,
// Round 8.
import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARKS = 200;

let dom;
let vite;
let React;
let act;
let createRoot;
let SelectionQuickBar;
let HISTORY_PAGE_SELECTION_EVENT;
let mounted = null;
const queries = { count: 0, on: false };

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
  });
  dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
  dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  // Count every selector query the page makes while `queries.on`.
  for (const proto of [dom.window.Document.prototype, dom.window.Element.prototype]) {
    for (const name of ['querySelector', 'querySelectorAll']) {
      const original = proto[name];
      proto[name] = function counted(...args) {
        if (queries.on) queries.count += 1;
        return original.apply(this, args);
      };
    }
  }
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
  ({ default: SelectionQuickBar } = await vite.ssrLoadModule('/src/components/SelectionQuickBar.jsx'));
  ({ HISTORY_PAGE_SELECTION_EVENT } = await vite.ssrLoadModule('/src/utils/historyMarkFilter.js'));
});

after(async () => { await vite?.close(); dom?.window.close(); });
afterEach(async () => {
  queries.on = false;
  if (mounted) await act(async () => mounted.unmount());
  mounted = null;
});

const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });

// A page layer on screen (jsdom has no layout: the boxes are stubbed) holding
// MARKS marks and the shared selection frame.
function buildPage() {
  document.body.innerHTML = '<div data-testid="pdf-container"></div><div id="root"></div>';
  const container = document.querySelector('[data-testid="pdf-container"]');
  container.getBoundingClientRect = () => box(0, 0, 1400, 900);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('data-svg-annotation-layer', '1');
  svg.getClientRects = () => [box(100, 100, 800, 600)];
  svg.getBoundingClientRect = () => box(100, 100, 800, 600);
  for (let i = 0; i < MARKS; i += 1) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-annotation-index', String(i));
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', String(10 + (i % 20) * 30));
    r.setAttribute('y', String(10 + Math.floor(i / 20) * 30));
    g.appendChild(r);
    svg.appendChild(g);
  }
  const frame = document.createElementNS(SVG_NS, 'rect');
  frame.setAttribute('class', 'svg-selection-overlay');
  frame.getBoundingClientRect = () => box(400, 400, 60, 40);
  svg.appendChild(frame);
  container.appendChild(svg);
  return { svg, mark: svg.querySelector('[data-annotation-index="3"]') };
}

const api = {
  contextTool: 'rect',
  activeTool: 'select',
  selectionCount: 1,
  handleFillColorChange: () => {},
  handleStrokeWidthInputChange: () => {},
  setLineBorderStyle: () => {},
};

// One frame: let the MutationObserver and the bar's rAF pass run.
const frame = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 2)); });

async function mountBar() {
  const page = buildPage();
  const root = createRoot(document.getElementById('root'));
  mounted = root;
  await act(async () => root.render(React.createElement(SelectionQuickBar, { enabled: true, api })));
  const pick = (ids) => act(async () => {
    window.dispatchEvent(new CustomEvent(HISTORY_PAGE_SELECTION_EVENT, {
      detail: { pageNumber: 1, items: ids.map((id) => ({ id, typeKey: 'rect' })) },
    }));
  });
  await pick(['m3']);
  await frame();
  const bar = document.querySelector('[data-selection-quick-bar]');
  return { ...page, bar, pick };
}

test('the bar shows over a picked mark (the full read still works)', async () => {
  const { bar } = await mountBar();
  assert.equal(bar.getAttribute('data-visible'), 'true');
  assert.ok(bar.style.left && bar.style.top, 'placed on screen');
});

test('a drag hides the bar at once, and its frames read nothing more off the page', async () => {
  const { svg, mark, bar } = await mountBar();
  assert.equal(bar.getAttribute('data-visible'), 'true');

  // The drag starts: the layer flags the gesture, and the bar hides.
  await act(async () => { svg.setAttribute('data-selection-gesture', 'true'); });
  await frame();
  assert.equal(bar.getAttribute('data-visible'), 'false');

  // Every drag frame moves the mark; the bar's pass wakes on each one.
  queries.count = 0;
  queries.on = true;
  for (let step = 1; step <= 20; step += 1) {
    await act(async () => { mark.setAttribute('transform', `translate(${step * 3}, ${step * 2})`); });
    await frame();
    assert.equal(bar.getAttribute('data-visible'), 'false', `still hidden on frame ${step}`);
  }
  queries.on = false;
  assert.equal(queries.count, 0, `selector queries during 20 drag frames: ${queries.count}`);

  // The drop clears the flag: one full read places the bar again.
  queries.count = 0;
  queries.on = true;
  await act(async () => { svg.removeAttribute('data-selection-gesture'); });
  await frame();
  queries.on = false;
  assert.ok(queries.count > 0, 'the drop reads the selection again');
  assert.equal(bar.getAttribute('data-visible'), 'true');
});

test('a new pick mid-gesture reads the page again, and a lock badge it finds is kept', async () => {
  const { svg, bar, pick } = await mountBar();
  await act(async () => { svg.setAttribute('data-selection-gesture', 'true'); });
  await frame();
  assert.equal(bar.getAttribute('data-visible'), 'false');

  const badge = document.createElementNS(SVG_NS, 'g');
  badge.setAttribute('data-selection-lock-badge', 'true');
  queries.count = 0;
  queries.on = true;
  await act(async () => { svg.appendChild(badge); });
  await pick(['m3', 'm4']);
  await frame();
  queries.on = false;
  assert.ok(queries.count > 0, 'a new pick is read in full');
  assert.equal(bar.getAttribute('data-visible'), 'false', 'still hidden mid-gesture');

  await act(async () => { svg.removeAttribute('data-selection-gesture'); });
  await frame();
  // A locked pick: the bar comes back without its edit controls.
  assert.equal(bar.getAttribute('data-visible'), 'true');
  assert.equal(bar.querySelector('[aria-label="Delete"]'), null, 'no Delete on a locked pick');
});
