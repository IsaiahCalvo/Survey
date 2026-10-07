import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';

const HANDOFF_BOUND_MS = 1200;

let dom;
let vite;
let FabricEraserCanvas;
let TestPointerEvent;
let activeMutationObservers = 0;

const canvasOperations = new WeakMap();

before(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const NativeMutationObserver = dom.window.MutationObserver;
  class TrackingMutationObserver extends NativeMutationObserver {
    #observing = false;

    observe(...args) {
      if (!this.#observing) {
        this.#observing = true;
        activeMutationObservers += 1;
      }
      return super.observe(...args);
    }

    disconnect() {
      if (this.#observing) {
        this.#observing = false;
        activeMutationObservers -= 1;
      }
      return super.disconnect();
    }
  }
  globalThis.MutationObserver = TrackingMutationObserver;

  const makeContext = (canvas) => {
    const operations = [];
    canvasOperations.set(canvas, operations);
    return {
      operations,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      strokeStyle: '',
      lineCap: '',
      lineJoin: '',
      lineWidth: 1,
      save() { operations.push(['save']); },
      restore() { operations.push(['restore']); },
      setTransform(...args) { operations.push(['setTransform', ...args]); },
      clearRect(...args) { operations.push(['clearRect', ...args]); },
      drawImage(...args) {
        operations.push(['drawImage', this.globalCompositeOperation, ...args]);
      },
      beginPath() { operations.push(['beginPath']); },
      arc(...args) { operations.push(['arc', ...args]); },
      fill() { operations.push(['fill', this.globalCompositeOperation]); },
      moveTo(...args) { operations.push(['moveTo', ...args]); },
      lineTo(...args) { operations.push(['lineTo', ...args]); },
      stroke() { operations.push(['stroke', this.globalCompositeOperation]); },
      rect() {},
      fillRect() {},
      strokeRect() {},
      translate() {},
      scale() {},
      rotate() {},
      transform() {},
      closePath() {},
      quadraticCurveTo() {},
      bezierCurveTo() {},
      measureText() { return { width: 10 }; },
      setLineDash() {},
    };
  };
  dom.window.HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__testContext) this.__testContext = makeContext(this);
    return this.__testContext;
  };

  TestPointerEvent = class TestPointerEvent extends dom.window.MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      Object.defineProperties(this, {
        pointerId: { value: init.pointerId ?? 1 },
        pointerType: { value: init.pointerType ?? 'pen' },
        isPrimary: { value: init.isPrimary ?? true },
        pressure: { value: init.pressure ?? 0.5 },
      });
    }

    getCoalescedEvents() {
      return [this];
    }
  };
  dom.window.PointerEvent = TestPointerEvent;
  globalThis.PointerEvent = TestPointerEvent;
  dom.window.HTMLElement.prototype.setPointerCapture = function setPointerCapture(pointerId) {
    this.__capturedPointerId = pointerId;
  };
  dom.window.HTMLElement.prototype.releasePointerCapture = function releasePointerCapture(pointerId) {
    if (this.__capturedPointerId === pointerId) this.__capturedPointerId = null;
  };

  vite = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    ssr: { external: ['@survey/shared'] },
  });
  ({ default: FabricEraserCanvas } = await vite.ssrLoadModule(
    '/src/components/FabricEraserCanvas.jsx',
  ));
});

after(async () => {
  await vite?.close();
  dom?.window.close();
});

// 2026-10-04 (test-reliability pass) — wait on what the component does, not
// on the wall clock. An exact repaint reaches the component through a
// MutationObserver (a microtask) whose check schedules the before-paint swap
// with requestAnimationFrame — shimmed above as setTimeout(0). The old fixed
// 10 ms sleep was armed BEFORE that frame was queued, so whenever the check
// itself took more than ~9 ms (a loaded machine: 1 run in 5 under load) the
// sleep ended first and the clone was still there. afterNextFrame() lets the
// observer run (setImmediate drains every pending microtask first), then waits
// for a frame queued AFTER the component's own: same-delay timers fire in the
// order they were queued, so on any machine speed the component's frame has
// run when this resolves. Nothing is retried and no deadline grows: the
// assertion still demands the swap within one frame of the exact repaint.
async function afterNextFrame() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// The safe-hold bound is a watchdog armed when the release's commit hands off
// (state 'active' -> 'waiting'), at the end of an async commit chain. A sleep
// of HANDOFF_BOUND_MS only outlasts it if the watchdog was armed before the
// sleep started; started together with the pointer-up, a slow erase (a loaded
// machine) could arm it late and the sleep ended first. So: wait - frame by
// frame, not by the clock - for the hand-off, then sleep past the bound.
async function sleepPastHandoffBound() {
  const clone = document.querySelector('[data-eraser-mask-clone="1"]');
  for (let frame = 0; frame < 500 && clone?.dataset.eraserHandoffState === 'active'; frame += 1) {
    await afterNextFrame();
  }
  assert.equal(clone?.dataset.eraserHandoffState, 'waiting', 'the commit armed the handoff watchdog');
  await new Promise((resolve) => setTimeout(resolve, HANDOFF_BOUND_MS));
}

const pathObject = ({
  id,
  authorId = 'collaborator',
  locked = false,
  y = 50,
} = {}) => ({
  type: 'path',
  id,
  tool: 'pen',
  path: [['M', 10, y], ['L', 90, y]],
  left: 0,
  top: 0,
  stroke: '#d11b2d',
  strokeWidth: 16,
  fill: null,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
  locked,
  authorId,
  data: { id, tool: 'pen', authorId },
});

const atomicObject = ({ id, type, authorId = 'collaborator' }) => ({
  type,
  id,
  left: 35,
  top: 35,
  width: 30,
  height: 30,
  fill: '#2563eb',
  stroke: '#1e3a8a',
  strokeWidth: 2,
  authorId,
  data: { id, authorId },
});

const objects = () => [
  pathObject({ id: 'own-ink' }),
  pathObject({ id: 'foreign-ink', authorId: 'other-user' }),
  pathObject({ id: 'locked-ink', locked: true }),
  atomicObject({ id: 'shape', type: 'rect' }),
  atomicObject({ id: 'text', type: 'textbox' }),
];

function pointer(type, { pointerId = 1, x, y, buttons }) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons,
    clientX: x,
    clientY: y,
    pointerId,
    pointerType: 'pen',
    isPrimary: true,
  });
}

function svgMarkup(pageObjects) {
  return pageObjects.map((object, index) => (
    `<g data-annotation-index="${index}" data-annotation-id="${object.id}">
      ${object.type === 'path'
        ? '<path d="M 10 50 L 90 50" stroke="#d11b2d" stroke-width="16" />'
        : '<rect x="35" y="35" width="30" height="30" fill="#2563eb" />'}
    </g>`
  )).join('');
}

function replaceSvgWrapper(pageObjects, revision = 'baseline') {
  const previous = document.querySelector('[data-diag-svg-wrapper]');
  const replacement = document.createElement('div');
  replacement.setAttribute('data-diag-svg-wrapper', '');
  replacement.dataset.svgAnnotationRevision = revision;
  replacement.innerHTML = (
    `<svg data-svg-annotation-layer="1" viewBox="0 0 100 100">
      ${svgMarkup(pageObjects)}
    </svg>`
  );
  previous.replaceWith(replacement);
  return replacement;
}

async function mountEraser({
  withSvg = true,
  pageObjects = objects(),
  overrides = {},
} = {}) {
  document.body.innerHTML = `<div data-annotation-real-surface>
    <div data-diag-svg-wrapper data-svg-annotation-revision="baseline">
      ${withSvg
        ? `<svg data-svg-annotation-layer="1" viewBox="0 0 100 100">${svgMarkup(pageObjects)}</svg>`
        : ''}
    </div>
    <div data-lightweight-annotation-overlay>
      <canvas
        width="100"
        height="100"
        data-annotation-presentation-canvas="1"
        data-canvas-annotation-revision="baseline"
        data-canvas-paint-generation="1"
        data-canvas-draw-scale="1"
        data-canvas-draw-scale-y="1"
        data-canvas-page-offset-x="0"
        data-canvas-page-offset-y="0"
      ></canvas>
    </div>
    <div id="root"></div>
  </div>`;
  const root = createRoot(document.getElementById('root'));
  const commits = [];
  const previewPresentation = [];
  const baseProps = {
    pageNumber: 1,
    pageWidth: 100,
    pageHeight: 100,
    annotations: { objects: pageObjects, eraserPresentationRevision: 'baseline' },
    onEraseCommit: (next) => commits.push(next),
    onEraseTextMarkup: () => {},
    onErasePreviewPresentation: (_page, visible) => previewPresentation.push(visible),
    eraserMode: 'partial',
    eraserSize: 12,
    viewerScale: 1,
    zoomGeneration: 0,
    viewerId: 'collaborator',
    documentOwnerId: 'owner',
    ...overrides,
  };
  await act(async () => root.render(React.createElement(FabricEraserCanvas, baseProps)));
  const surface = document.querySelector('[data-diag-eraser-wrapper="1"]');
  surface.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    toJSON() {},
  });
  return {
    root,
    surface,
    commits,
    previewPresentation,
    rerender: async (next) => act(async () => root.render(React.createElement(
      FabricEraserCanvas,
      { ...baseProps, ...next },
    ))),
    unmount: async () => act(async () => root.unmount()),
  };
}

async function drag(mounted, {
  pointerId = 1,
  release = false,
  from = { x: 25, y: 50 },
  to = { x: 65, y: 50 },
} = {}) {
  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId,
      x: from.x,
      y: from.y,
      buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId,
      x: to.x,
      y: to.y,
      buttons: 1,
    }));
    if (release) {
      mounted.surface.dispatchEvent(pointer('pointerup', {
        pointerId,
        x: to.x,
        y: to.y,
        buttons: 0,
      }));
    }
  });
}

test('missing SVG disables the unsafe flattened-canvas approximation but still commits', async () => {
  const mounted = await mountEraser({ withSvg: false });
  const preview = document.querySelector('[data-eraser-live-preview="1"]');
  const source = document.querySelector('[data-annotation-presentation-canvas="1"]');

  await drag(mounted);

  assert.equal(preview.style.display, 'none', 'flattened pixels must never become erase truth');
  assert.deepEqual(mounted.previewPresentation, [], 'unsafe fallback must not hide real content');
  assert.equal(
    (canvasOperations.get(preview) || []).some((entry) => (
      ['fill', 'stroke', 'drawImage'].includes(entry[0]) && entry[1] === 'destination-out'
    )),
    false,
    'no destination-out may touch flattened foreign/locked/atomic pixels',
  );
  assert.notEqual(source.closest('[data-lightweight-annotation-overlay]').style.visibility, 'hidden');

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 1,
      x: 65,
      y: 50,
      buttons: 0,
    }));
  });
  assert.equal(mounted.commits.length, 1, 'visual fallback failure cannot drop the erase');
  await mounted.unmount();
});

// RULED 2026-09-28 owner: open editing + lock — title: foreign ink is now permitted; the preserved case is user-locked (and system-locked) ink.
test('safe SVG preview carves only permitted ink and preserves user-locked/locked content', async () => {
  const userLockedInk = pathObject({ id: 'user-locked-ink', authorId: 'other-user' });
  userLockedInk.data = { ...userLockedInk.data, lockedBy: 'other-user' };
  const mounted = await mountEraser({ pageObjects: [...objects(), userLockedInk] });
  await drag(mounted);

  const clone = document.querySelector('[data-eraser-mask-clone="1"]');
  assert.ok(clone);
  assert.match(
    clone.querySelector('[data-annotation-id="own-ink"]').getAttribute('mask') || '',
    /^url\(#eraser-carve-mask-/,
  );
  // RULED 2026-09-28 owner: open editing + lock — another author's ink is carved like the viewer's own.
  assert.match(
    clone.querySelector('[data-annotation-id="foreign-ink"]').getAttribute('mask') || '',
    /^url\(#eraser-carve-mask-/,
  );
  // RULED 2026-09-28 owner: open editing + lock — the refusal moves to a user-locked foreign ink.
  assert.equal(clone.querySelector('[data-annotation-id="user-locked-ink"]').getAttribute('mask'), null);
  assert.equal(clone.querySelector('[data-annotation-id="user-locked-ink"]').style.display, '');
  assert.equal(clone.querySelector('[data-annotation-id="locked-ink"]').getAttribute('mask'), null);
  assert.equal(clone.querySelector('[data-annotation-id="locked-ink"]').style.display, '');
  assert.equal(clone.querySelector('[data-annotation-id="shape"]').style.display, 'none');
  assert.equal(clone.querySelector('[data-annotation-id="text"]').style.display, 'none');
  await mounted.unmount();
});

test('one partial-erase drag continues past a counter into later shapes, text, and ink', async () => {
  const segmentPath = (id, x1, x2) => ({
    ...pathObject({ id }),
    path: [['M', x1, 50], ['L', x2, 50]],
    width: x2 - x1,
  });
  const counter = {
    ...atomicObject({ id: 'counter-mid', type: 'circle' }),
    left: 28,
    top: 38,
    width: 12,
    height: 24,
    data: {
      id: 'counter-mid',
      type: 'counter',
      annotationType: 'counter',
      displayNumber: 2,
      seriesId: 'mixed-series',
      seriesStart: 1,
      createdAt: 2,
      authorId: 'collaborator',
    },
  };
  const shape = {
    ...atomicObject({ id: 'shape-after-counter', type: 'rect' }),
    left: 45,
    top: 38,
    width: 12,
    height: 24,
  };
  const text = {
    ...atomicObject({ id: 'text-after-counter', type: 'textbox' }),
    left: 62,
    top: 38,
    width: 12,
    height: 24,
    data: { id: 'text-after-counter', tool: 'text', authorId: 'collaborator' },
  };
  const pageObjects = [
    segmentPath('ink-before-counter', 2, 24),
    counter,
    shape,
    text,
    segmentPath('ink-after-counter', 76, 98),
  ];
  const mounted = await mountEraser({ pageObjects });

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      x: 4,
      y: 50,
      buttons: 1,
    }));
    for (const x of [20, 35, 52, 69, 80, 84]) {
      mounted.surface.dispatchEvent(pointer('pointermove', {
        x,
        y: 50,
        buttons: 1,
      }));
    }
  });

  const clone = document.querySelector('[data-eraser-mask-clone="1"]');
  assert.ok(clone, 'the continuous gesture must retain one live preview');
  assert.equal(
    clone.querySelector('[data-annotation-id="counter-mid"]').style.display,
    'none',
  );
  assert.equal(
    clone.querySelector('[data-annotation-id="shape-after-counter"]').style.display,
    'none',
  );
  assert.equal(
    clone.querySelector('[data-annotation-id="text-after-counter"]').style.display,
    'none',
  );
  assert.match(
    clone.querySelector('[data-annotation-id="ink-after-counter"]').getAttribute('mask') || '',
    /^url\(#eraser-carve-mask-/,
    'crossing the counter must not stop live carving of later ink',
  );

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerup', {
      x: 84,
      y: 50,
      buttons: 0,
    }));
    await Promise.resolve();
  });

  assert.equal(mounted.commits.length, 1);
  const committedIds = mounted.commits[0].objects.map((object) => object.id);
  assert.ok(committedIds.includes('ink-before-counter'));
  assert.ok(committedIds.includes('ink-after-counter'));
  assert.ok(!committedIds.includes('counter-mid'));
  assert.ok(!committedIds.includes('shape-after-counter'));
  assert.ok(!committedIds.includes('text-after-counter'));
  await mounted.unmount();
});

test('dense blank-start drag keeps live SVG work bounded and reaches late ink with a live cursor', async (t) => {
  const pageObjects = [
    pathObject({ id: 'early-ink', y: 30 }),
    pathObject({ id: 'late-ink', y: 80 }),
  ];
  const mounted = await mountEraser({ pageObjects });
  t.after(async () => {
    await mounted.rerender({ interruptionPolicy: 'cancel' });
    await mounted.unmount();
  });
  const nativeSetAttribute = dom.window.SVGElement.prototype.setAttribute;
  const carveWrites = [];
  dom.window.SVGElement.prototype.setAttribute = function trackedSetAttribute(name, value) {
    if (
      name === 'd'
      && this.closest?.('[data-eraser-mask-clone="1"]')
      && this.getAttribute('stroke') === '#000'
    ) {
      carveWrites.push(String(value).length);
    }
    return nativeSetAttribute.call(this, name, value);
  };

  try {
    await act(async () => {
      mounted.surface.dispatchEvent(pointer('pointerdown', {
        x: 5,
        y: 5,
        buttons: 1,
      }));
      // Model several seconds of high-rate input before the first hit.
      for (let index = 0; index < 900; index += 1) {
        mounted.surface.dispatchEvent(pointer('pointermove', {
          x: 5 + (index % 80),
          y: 5,
          buttons: 1,
        }));
      }
      mounted.surface.dispatchEvent(pointer('pointermove', {
        x: 50,
        y: 30,
        buttons: 1,
      }));
      // Keep the same held gesture dense after preview activation, then cross
      // a late annotation. This is the input-starvation shape from production.
      for (let index = 0; index < 900; index += 1) {
        mounted.surface.dispatchEvent(pointer('pointermove', {
          x: 5 + (index % 80),
          y: 55 + ((index % 7) - 3),
          buttons: 1,
        }));
      }
      mounted.surface.dispatchEvent(pointer('pointermove', {
        x: 50,
        y: 80,
        buttons: 1,
      }));
    });
  } finally {
    dom.window.SVGElement.prototype.setAttribute = nativeSetAttribute;
  }

  const clone = document.querySelector('[data-eraser-mask-clone="1"]');
  assert.ok(clone, 'the long held gesture must retain one live preview');
  assert.match(
    clone.querySelector('[data-annotation-id="early-ink"]').getAttribute('mask') || '',
    /^url\(#eraser-carve-mask-/,
  );
  assert.match(
    clone.querySelector('[data-annotation-id="late-ink"]').getAttribute('mask') || '',
    /^url\(#eraser-carve-mask-/,
    'late ink must react before pointer-up',
  );
  assert.equal(
    document.querySelector('[data-eraser-cursor="true"]').style.transform,
    'translate3d(44px, 74px, 0)',
    'the custom cursor must reach the final pointer sample during the held drag',
  );
  assert.ok(carveWrites.length > 1, 'the regression must exercise repeated live SVG updates');
  const largestCarveWrite = Math.max(...carveWrites);
  const totalCarveWriteChars = carveWrites.reduce((total, length) => total + length, 0);
  assert.ok(
    largestCarveWrite <= 1600,
    `each SVG path update must stay bounded; largest d write was ${largestCarveWrite} chars`,
  );
  assert.ok(
    totalCarveWriteChars <= 400_000,
    `total SVG serialization must stay linear; wrote ${totalCarveWriteChars} d characters`,
  );
  const chunks = [...clone.querySelectorAll('[data-eraser-carve-chunk]')];
  assert.ok(chunks.length > 1, 'the dense gesture must seal at least one immutable path chunk');
  for (let index = 1; index < chunks.length; index += 1) {
    const previousNumbers = chunks[index - 1].getAttribute('d').match(/-?\d+(?:\.\d+)?/g);
    const nextNumbers = chunks[index].getAttribute('d').match(/-?\d+(?:\.\d+)?/g);
    assert.deepEqual(
      previousNumbers?.slice(-2),
      nextNumbers?.slice(0, 2),
      `chunk ${index} must repeat the prior endpoint so the mask has no geometry gap`,
    );
  }
  t.diagnostic(JSON.stringify({
    moves: 1802,
    chunks: chunks.length,
    largestCarveWrite,
    totalCarveWriteChars,
  }));
});

test('live preview namespaces imported-ink clip ids instead of resolving into the hidden SVG', async (t) => {
  const mounted = await mountEraser();
  t.after(() => mounted.unmount());
  const svg = document.querySelector('svg[data-svg-annotation-layer]');
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = (
    '<clipPath id="paper-eraser-clip-imported">'
      + '<rect x="0" y="0" width="100" height="100" />'
    + '</clipPath>'
  );
  svg.prepend(defs);
  document.querySelector('[data-annotation-id="own-ink"]')
    .setAttribute('clip-path', 'url(#paper-eraser-clip-imported)');

  await drag(mounted);

  const clone = document.querySelector('[data-eraser-mask-clone="1"]');
  assert.ok(clone);
  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    'real and preview SVGs must never expose duplicate fragment ids',
  );
  const cloneInk = clone.querySelector('[data-annotation-id="own-ink"]');
  const cloneClipReference = cloneInk.getAttribute('clip-path');
  assert.notEqual(cloneClipReference, 'url(#paper-eraser-clip-imported)');
  const cloneClipId = cloneClipReference?.match(/^url\(#(.+)\)$/)?.[1];
  assert.ok(cloneClipId);
  assert.ok(clone.querySelector(`[id="${cloneClipId}"]`));
});

test('removing the live clone mid-swap reattaches the same safe presentation before paint', async () => {
  const mounted = await mountEraser();
  await drag(mounted);

  const clone = document.querySelector('[data-eraser-mask-clone="1"]');
  clone.remove();

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 1,
      x: 75,
      y: 50,
      buttons: 1,
    }));
    await Promise.resolve();
  });

  const recovered = document.querySelector('[data-eraser-mask-clone="1"]');
  assert.equal(recovered, clone, 'recovery must retain exact carved geometry');
  assert.equal(
    recovered.querySelector('[data-annotation-id="foreign-ink"]').style.display,
    '',
    'blocked content must remain visible through clone recovery',
  );
  assert.equal(document.querySelector('[data-diag-svg-wrapper]').style.visibility, 'hidden');
  await mounted.unmount();
});

test('missing repaint enters bounded safe-hold; zoom cannot reveal stale geometry', async () => {
  const mounted = await mountEraser();
  await drag(mounted, { release: true });
  assert.equal(mounted.commits.length, 1);

  await act(async () => {
    await sleepPastHandoffBound();
  });
  const clone = document.querySelector('[data-eraser-mask-clone="1"]');
  assert.ok(clone, 'missing repaint must retain the safe carved presentation');
  assert.equal(clone.dataset.eraserHandoffState, 'safe-hold');
  assert.equal(document.querySelector('[data-diag-svg-wrapper]').style.visibility, 'hidden');

  await mounted.rerender({ zoomGeneration: 1 });
  await mounted.rerender({ zoomGeneration: 2 });
  assert.equal(document.querySelector('[data-eraser-mask-clone="1"]'), clone);
  assert.equal(document.querySelector('[data-diag-svg-wrapper]').style.visibility, 'hidden');

  const expectedRevision = mounted.commits[0].eraserPresentationRevision;
  await act(async () => {
    document.querySelector('[data-diag-svg-wrapper]').dataset.svgAnnotationRevision = expectedRevision;
    await afterNextFrame();
  });
  assert.equal(
    document.querySelectorAll('[data-eraser-mask-clone]').length,
    0,
    'a later React paint must release safe-hold without requiring pointer or zoom input',
  );
  assert.equal(activeMutationObservers, 0, 'terminal repaint must disconnect every handoff observer');

  await mounted.unmount();
  assert.equal(activeMutationObservers, 0, 'unmount must disconnect every preview observer');
});

test('last-item source removal cannot end handoff before exact empty SVG arrives', async () => {
  const mounted = await mountEraser({
    pageObjects: [pathObject({ id: 'own-ink' })],
  });
  await drag(mounted, { release: true });
  const expectedRevision = mounted.commits[0].eraserPresentationRevision;
  document.querySelector('[data-annotation-presentation-canvas="1"]').remove();
  await act(async () => Promise.resolve());

  assert.ok(
    document.querySelector('[data-eraser-mask-clone="1"]'),
    'worker source removal alone cannot reveal stale final-item SVG',
  );
  const wrapper = document.querySelector('[data-diag-svg-wrapper]');
  wrapper.querySelector('svg').replaceChildren();
  wrapper.dataset.svgAnnotationRevision = expectedRevision;
  await act(async () => afterNextFrame());

  assert.equal(document.querySelectorAll('[data-eraser-mask-clone]').length, 0);
  assert.equal(wrapper.style.visibility, '');
  await mounted.unmount();
});

test('a second erase after safe-hold commits against the latest remote model without leaking clones', async () => {
  const mounted = await mountEraser({
    pageObjects: [pathObject({ id: 'local-ink' })],
    overrides: { eraserMode: 'entire' },
  });
  await drag(mounted, { release: true });
  await act(async () => {
    await sleepPastHandoffBound();
  });

  const heldClone = document.querySelector('[data-eraser-mask-clone="1"]');
  assert.ok(heldClone);
  assert.equal(heldClone.dataset.eraserHandoffState, 'safe-hold');

  const remoteHit = pathObject({ id: 'remote-hit' });
  const remoteKeep = pathObject({ id: 'remote-keep', y: 20 });
  const latestRemotePage = {
    ...mounted.commits[0],
    objects: [...mounted.commits[0].objects, remoteHit, remoteKeep],
  };
  await mounted.rerender({
    annotations: latestRemotePage,
    eraserMode: 'entire',
  });

  await drag(mounted, {
    pointerId: 2,
    release: true,
    from: { x: 25, y: 50 },
    to: { x: 65, y: 50 },
  });
  assert.equal(mounted.commits.length, 2);
  assert.equal(
    document.querySelectorAll('[data-eraser-mask-clone="1"]').length,
    1,
    'the second transaction must own exactly one preview clone',
  );

  const secondIds = mounted.commits[1].objects.map((object) => object.id);
  assert.ok(secondIds.includes('remote-keep'), 'latest remote state must remain in the commit base');
  assert.ok(!secondIds.includes('remote-hit'), 'the second erase must mutate the latest remote state');

  const secondRevision = mounted.commits[1].eraserPresentationRevision;
  await act(async () => {
    document.querySelector('[data-diag-svg-wrapper]').dataset.svgAnnotationRevision = secondRevision;
    await afterNextFrame();
  });
  assert.equal(document.querySelectorAll('[data-eraser-mask-clone]').length, 0);
  await mounted.unmount();
  assert.equal(activeMutationObservers, 0);
});

test('SVG wrapper replacement stays hidden during active and safe-hold until exact repaint', async () => {
  const pageObjects = objects();
  const mounted = await mountEraser({ pageObjects });
  await drag(mounted);
  const clone = document.querySelector('[data-eraser-mask-clone="1"]');
  assert.ok(clone);

  const activeReplacement = replaceSvgWrapper(pageObjects);
  await act(async () => Promise.resolve());
  assert.equal(document.querySelector('[data-eraser-mask-clone="1"]'), clone);
  assert.equal(activeReplacement.style.visibility, 'hidden');

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 1,
      x: 65,
      y: 50,
      buttons: 0,
    }));
    await sleepPastHandoffBound();
  });
  assert.equal(clone.dataset.eraserHandoffState, 'safe-hold');

  const safeHoldReplacement = replaceSvgWrapper(mounted.commits[0].objects);
  await act(async () => Promise.resolve());
  assert.equal(document.querySelector('[data-eraser-mask-clone="1"]'), clone);
  assert.equal(safeHoldReplacement.style.visibility, 'hidden');

  await act(async () => {
    safeHoldReplacement.dataset.svgAnnotationRevision = (
      mounted.commits[0].eraserPresentationRevision
    );
    await afterNextFrame();
  });
  assert.equal(document.querySelectorAll('[data-eraser-mask-clone]').length, 0);
  assert.equal(safeHoldReplacement.style.visibility, '');
  await mounted.unmount();
  assert.equal(activeMutationObservers, 0);
});

test('unmount clears the repaint watchdog and both preview observers', async () => {
  const mounted = await mountEraser();
  await drag(mounted, { release: true });
  assert.ok(
    activeMutationObservers >= 2,
    'release must arm the exact-repaint observer while the clone guard stays active',
  );

  await mounted.unmount();
  assert.equal(activeMutationObservers, 0);
  assert.equal(document.querySelectorAll('[data-eraser-mask-clone]').length, 0);

  await new Promise((resolve) => setTimeout(resolve, HANDOFF_BOUND_MS));
  assert.equal(activeMutationObservers, 0, 'the canceled watchdog must not recreate observers');
  assert.equal(document.querySelectorAll('[data-eraser-mask-clone]').length, 0);
});
