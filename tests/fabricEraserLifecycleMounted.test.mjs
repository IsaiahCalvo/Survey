import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

let dom;
let vite;
let FabricEraserCanvas;
let TestPointerEvent;

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
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  TestPointerEvent = class TestPointerEvent extends dom.window.MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      Object.defineProperties(this, {
        pointerId: { value: init.pointerId ?? 1 },
        pointerType: { value: init.pointerType ?? 'mouse' },
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
  dom.window.HTMLElement.prototype.hasPointerCapture = function hasPointerCapture(pointerId) {
    return this.__capturedPointerId === pointerId;
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

const ink = () => ({
  type: 'path',
  id: 'ink',
  tool: 'pen',
  path: [['M', 10, 50], ['L', 90, 50]],
  left: 0,
  top: 0,
  stroke: '#d11b2d',
  strokeWidth: 16,
  fill: null,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
  data: { id: 'ink', tool: 'pen' },
});

function pointer(type, {
  pointerId,
  pointerType = 'pen',
  isPrimary = true,
  x,
  y,
  buttons,
}) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons,
    clientX: x,
    clientY: y,
    pointerId,
    pointerType,
    isPrimary,
  });
}

async function mountEraser(overrides = {}, { withPreviewSurface = false } = {}) {
  document.body.innerHTML = withPreviewSurface
    ? `<div data-annotation-real-surface>
        <div data-diag-svg-wrapper>
          <svg data-svg-annotation-layer="1" viewBox="0 0 100 100">
            <g data-annotation-index="0" data-annotation-id="ink" data-anno-id="ink">
              <path d="M 10 50 L 90 50" stroke="#d11b2d" stroke-width="16" />
            </g>
          </svg>
        </div>
        <div id="root"></div>
      </div>`
    : '<div id="root"></div>';
  const host = document.getElementById('root');
  const root = createRoot(host);
  const commits = [];
  const textMarkupCommits = [];
  const previewPresentation = [];
  const baseProps = {
    pageNumber: 1,
    pageWidth: 100,
    pageHeight: 100,
    annotations: { objects: [ink()] },
    onEraseCommit: (next) => commits.push(next),
    onEraseTextMarkup: (_page, points, radius) => textMarkupCommits.push({ points, radius }),
    onErasePreviewPresentation: (_page, visible) => previewPresentation.push(visible),
    eraserMode: 'partial',
    eraserSize: 8,
    viewerScale: 1,
    zoomGeneration: 0,
    viewerId: 'owner',
    documentOwnerId: 'owner',
    ...overrides,
  };
  await act(async () => root.render(React.createElement(FabricEraserCanvas, baseProps)));
  const surface = host.querySelector('[data-diag-eraser-wrapper="1"]');
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
    textMarkupCommits,
    previewPresentation,
    rerender: async (next) => {
      await act(async () => root.render(React.createElement(
        FabricEraserCanvas,
        { ...baseProps, ...next },
      )));
    },
  };
}

test('mounted eraser control: a normal primary pointer gesture commits', async () => {
  const mounted = await mountEraser();

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 1, x: 30, y: 50, buttons: 1,
    }));
    assert.equal(mounted.surface.__capturedPointerId, 1, 'pointer must own capture');
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 1, x: 50, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 1, x: 70, y: 50, buttons: 0,
    }));
    assert.equal(mounted.surface.__capturedPointerId, null, 'pointer-up must release capture');
  });

  assert.equal(mounted.textMarkupCommits.length, 1);
  assert.deepEqual(mounted.textMarkupCommits[0].points, [
    { x: 30, y: 50 },
    { x: 50, y: 50 },
    { x: 70, y: 50 },
  ]);
  assert.equal(mounted.commits.length, 1);
  await act(async () => mounted.root.unmount());
});

test('mounted eraser ignores a transient buttons=0 move while pointer capture is still owned', async () => {
  const mounted = await mountEraser();

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 2, x: 30, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 2, x: 40, y: 50, buttons: 1,
    }));
    // Chromium can emit a transient hover-like move with buttons=0 during a
    // long captured drag. Pointer-up/cancel/lost-capture remain authoritative.
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 2, x: 45, y: 50, buttons: 0,
    }));
    assert.equal(mounted.commits.length, 0, 'a stray move must not end the gesture');
    assert.equal(mounted.surface.__capturedPointerId, 2, 'capture must remain owned');
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 2, x: 60, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 2, x: 70, y: 50, buttons: 0,
    }));
  });

  assert.equal(mounted.commits.length, 1);
  assert.deepEqual(mounted.textMarkupCommits[0].points, [
    { x: 30, y: 50 },
    { x: 40, y: 50 },
    { x: 45, y: 50 },
    { x: 60, y: 50 },
    { x: 70, y: 50 },
  ]);
  await act(async () => mounted.root.unmount());
});

test('mounted eraser ignores a second pointer without cancelling the active pen gesture', async () => {
  const mounted = await mountEraser();

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 90,
      pointerType: 'touch',
      isPrimary: false,
      x: 90,
      y: 90,
      buttons: 1,
    }));
    assert.equal(
      mounted.surface.__capturedPointerId,
      undefined,
      'a non-primary pointer cannot start a gesture',
    );
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 7, x: 30, y: 50, buttons: 1,
    }));
    assert.equal(mounted.surface.__capturedPointerId, 7, 'first pointer must own capture');
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 7, x: 50, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 91,
      pointerType: 'touch',
      isPrimary: false,
      x: 90,
      y: 90,
      buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 7, x: 70, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 7, x: 70, y: 50, buttons: 0,
    }));
  });

  assert.equal(mounted.commits.length, 1);
  assert.notDeepEqual(mounted.commits[0].objects, [ink()]);
  await act(async () => mounted.root.unmount());
});

test('mounted eraser commits an active visible gesture exactly once on unmount', async () => {
  const mounted = await mountEraser();

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 8, x: 30, y: 50, buttons: 1,
    }));
    assert.equal(mounted.surface.__capturedPointerId, 8, 'pointer must own capture');
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 8, x: 55, y: 50, buttons: 1,
    }));
  });
  await act(async () => mounted.root.unmount());

  assert.equal(mounted.commits.length, 1);
  assert.notDeepEqual(mounted.commits[0].objects, [ink()]);
});

test('mounted eraser falls back to local planning when its worker stops during unmount', async () => {
  const workers = [];
  globalThis.Worker = class DelayedWorker {
    constructor(url) {
      this.url = String(url);
      workers.push(this);
    }

    postMessage(message) {
      this.message = message;
    }

    terminate() {
      this.terminated = true;
    }
  };
  try {
    const mounted = await mountEraser();
    await act(async () => {
      mounted.surface.dispatchEvent(pointer('pointerdown', {
        pointerId: 81, x: 30, y: 50, buttons: 1,
      }));
      mounted.surface.dispatchEvent(pointer('pointermove', {
        pointerId: 81, x: 55, y: 50, buttons: 1,
      }));
      mounted.surface.dispatchEvent(pointer('pointerup', {
        pointerId: 81, x: 70, y: 50, buttons: 0,
      }));
      await Promise.resolve();
    });
    assert.equal(workers.some((worker) => worker.message?.requestId), true);
    await act(async () => mounted.root.unmount());
    await act(async () => Promise.resolve());

    assert.equal(workers.some((worker) => worker.url.includes('pageSpaceEraserWorker')), true);
    assert.equal(mounted.commits.length, 1);
    assert.notDeepEqual(mounted.commits[0].objects, [ink()]);
  } finally {
    delete globalThis.Worker;
  }
});

test('mounted eraser snapshots mode and radius at pointer-down', async () => {
  const mounted = await mountEraser();
  const gesturePoints = [
    { x: 30, y: 50 },
    { x: 50, y: 50 },
    { x: 70, y: 50 },
  ];

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 9, x: 30, y: 50, buttons: 1,
    }));
    assert.equal(mounted.surface.__capturedPointerId, 9, 'pointer must own capture');
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 9, x: 50, y: 50, buttons: 1,
    }));
  });
  await mounted.rerender({ eraserMode: 'entire', eraserSize: 60 });
  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 9, x: 70, y: 50, buttons: 0,
    }));
  });

  assert.equal(mounted.textMarkupCommits.length, 1, 'pointer-up must reach commit');
  assert.equal(mounted.commits.length, 1);
  const expected = erasePageAnnotations({
    pageAnnotations: { objects: [ink()] },
    eraserPoints: gesturePoints,
    eraserRadius: 4,
    mode: 'partial',
    canErase: () => true,
  }).pageAnnotations;
  assert.deepEqual(
    mounted.commits[0].objects,
    expected.objects,
    'commit geometry must exactly match down-time partial/8px settings',
  );
  assert.equal(mounted.textMarkupCommits[0].radius, 4, 'down-time 8px diameter must win');
  await act(async () => mounted.root.unmount());
});

test('mounted eraser commits on lost capture itself; later pointer-up is a no-op', async () => {
  const mounted = await mountEraser();

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 10, x: 30, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 10, x: 55, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('lostpointercapture', {
      pointerId: 10, x: 55, y: 50, buttons: 0,
    }));
  });

  assert.equal(mounted.commits.length, 1, 'lost capture must commit before pointer-up');
  const committedOnLoss = structuredClone(mounted.commits[0]);

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 10, x: 70, y: 50, buttons: 0,
    }));
  });

  assert.equal(mounted.commits.length, 1, 'later pointer-up must not commit twice');
  assert.deepEqual(mounted.commits[0], committedOnLoss);
  assert.equal(mounted.textMarkupCommits.length, 1);
  await act(async () => mounted.root.unmount());
});

test('mounted eraser commits on pointercancel itself; later pointer-up is a no-op', async () => {
  const mounted = await mountEraser();

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 11, x: 30, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 11, x: 55, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointercancel', {
      pointerId: 11, x: 55, y: 50, buttons: 0,
    }));
  });
  assert.equal(mounted.commits.length, 1, 'pointercancel must commit before pointer-up');

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 11, x: 70, y: 50, buttons: 0,
    }));
  });
  assert.equal(mounted.commits.length, 1, 'later pointer-up must not commit twice');
  assert.equal(mounted.textMarkupCommits.length, 1);
  await act(async () => mounted.root.unmount());
});

test('mounted eraser commits on zoom start itself; later pointer-up is a no-op', async () => {
  const mounted = await mountEraser();

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 12, x: 30, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 12, x: 55, y: 50, buttons: 1,
    }));
  });
  await mounted.rerender({ zoomGeneration: 1 });
  assert.equal(mounted.commits.length, 1, 'zoom start must commit before pointer-up');

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 12, x: 70, y: 50, buttons: 0,
    }));
  });
  assert.equal(mounted.commits.length, 1, 'later pointer-up must not commit twice');
  assert.equal(mounted.textMarkupCommits.length, 1);
  await act(async () => mounted.root.unmount());
});

test('mounted eraser cancels and restores preview when authorization is revoked', async () => {
  const mounted = await mountEraser({}, { withPreviewSurface: true });
  const svgWrapper = document.querySelector('[data-diag-svg-wrapper]');

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 13, x: 30, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 13, x: 55, y: 50, buttons: 1,
    }));
  });
  assert.equal(document.querySelectorAll('[data-eraser-mask-clone]').length, 1);
  assert.equal(svgWrapper.style.visibility, 'hidden');
  assert.deepEqual(mounted.previewPresentation, [true]);

  await mounted.rerender({ interruptionPolicy: 'cancel' });

  assert.equal(mounted.commits.length, 0, 'authorization loss must not commit');
  assert.equal(document.querySelectorAll('[data-eraser-mask-clone]').length, 0);
  assert.equal(svgWrapper.style.visibility, '', 'real SVG preview source must be restored');
  assert.deepEqual(mounted.previewPresentation, [true, false]);

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 13, x: 70, y: 50, buttons: 0,
    }));
  });
  assert.equal(mounted.commits.length, 0, 'later pointer-up must remain a no-op');

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 14, x: 30, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 14, x: 55, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 14, x: 70, y: 50, buttons: 0,
    }));
  });
  assert.equal(
    mounted.surface.__capturedPointerId,
    null,
    'revoked surface must not capture a new pointer',
  );
  assert.equal(mounted.commits.length, 0, 'revoked surface must block new erases');

  await mounted.rerender({ interruptionPolicy: 'commit' });
  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 15, x: 30, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 15, x: 55, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointerup', {
      pointerId: 15, x: 70, y: 50, buttons: 0,
    }));
  });
  assert.equal(mounted.commits.length, 1, 'restored access must allow a new erase');

  await act(async () => mounted.root.unmount());
  assert.equal(mounted.commits.length, 1, 'unmount must not duplicate the restored gesture');
});

test('parent revocation ref cancels an active gesture during the same render that unmounts it', async () => {
  const policyRef = { current: 'commit' };
  const mounted = await mountEraser(
    { interruptionPolicyRef: policyRef },
    { withPreviewSurface: true },
  );
  const svgWrapper = document.querySelector('[data-diag-svg-wrapper]');

  await act(async () => {
    mounted.surface.dispatchEvent(pointer('pointerdown', {
      pointerId: 16, x: 30, y: 50, buttons: 1,
    }));
    mounted.surface.dispatchEvent(pointer('pointermove', {
      pointerId: 16, x: 55, y: 50, buttons: 1,
    }));
  });
  assert.equal(document.querySelectorAll('[data-eraser-mask-clone]').length, 1);
  assert.equal(svgWrapper.style.visibility, 'hidden');

  policyRef.current = 'cancel';
  await act(async () => mounted.root.unmount());

  assert.equal(mounted.commits.length, 0, 'same-render authorization loss must not commit');
  assert.equal(document.querySelectorAll('[data-eraser-mask-clone]').length, 0);
  assert.equal(svgWrapper.style.visibility, '', 'unmount must restore the real SVG source');
});
