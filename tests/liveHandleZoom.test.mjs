import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  HANDLE_ZOOM_VAR,
  getHandleZoomCompensation,
  getLiveInverseScale,
  trackHandleZoom,
  untrackHandleZoom,
} from '../src/utils/liveHandleZoom.js';
import { installGlyphOnlyButtons } from '../src/utils/glyphOnlyButtons.js';

test('grabbers counter the live zoom until the layer re-renders', () => {
  // Drawn at 100 % (1 page unit per px); a pinch to 200 % halves the units per px.
  assert.equal(getHandleZoomCompensation(0.5, 1), 0.5);
  // Zoom-out to 50 %: grabbers drawn at 100 % must double in page units.
  assert.equal(getHandleZoomCompensation(2, 1), 2);
  // At rest the re-rendered size already matches: no correction.
  assert.equal(getHandleZoomCompensation(0.5, 0.5), 1);
  // Past the zoom-out cap both sides clamp, as the renderer does.
  assert.equal(getHandleZoomCompensation(8, 4), 1);
  assert.equal(getHandleZoomCompensation(null, 1), 1);
  assert.equal(getHandleZoomCompensation(0.5, 0), 1);
});

test('live inverse scale reads the painted width, CSS transforms included', () => {
  assert.equal(getLiveInverseScale({ getBoundingClientRect: () => ({ width: 1200 }) }, 600), 0.5);
  assert.equal(getLiveInverseScale({ getBoundingClientRect: () => ({ width: 0 }) }, 600), null);
  assert.equal(getLiveInverseScale(null, 600), null);
});

test('a tracked layer carries the correction and drops it when untracked', () => {
  const dom = new JSDOM('<!doctype html><div id="page"><svg id="layer"></svg></div>');
  const saved = {};
  for (const key of ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'ResizeObserver']) saved[key] = globalThis[key];
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.ResizeObserver = undefined;
  try {
    const svg = dom.window.document.getElementById('layer');
    let width = 1200;
    svg.getBoundingClientRect = () => ({ width });
    // Grabbers drawn for 100 % while the page shows at 200 %.
    trackHandleZoom(svg, { pageWidth: 600, renderedInverseScale: 1 });
    assert.equal(svg.style.getPropertyValue(HANDLE_ZOOM_VAR), '0.5');
    assert.equal(svg.hasAttribute('data-handle-zooming'), true);
    // The layer re-renders at the new zoom: no correction left.
    trackHandleZoom(svg, { pageWidth: 600, renderedInverseScale: 0.5 });
    assert.equal(svg.style.getPropertyValue(HANDLE_ZOOM_VAR), '');
    width = 300;
    trackHandleZoom(svg, { pageWidth: 600, renderedInverseScale: 0.5 });
    assert.equal(svg.style.getPropertyValue(HANDLE_ZOOM_VAR), '4');
    untrackHandleZoom(svg);
    assert.equal(svg.style.getPropertyValue(HANDLE_ZOOM_VAR), '');
    assert.equal(svg.hasAttribute('data-handle-zooming'), false);
  } finally {
    Object.assign(globalThis, saved);
  }
});

test('an svg grabber with role="button" is not given the glyph press', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="icon"><svg></svg></button>
    <svg><g id="add" role="button" aria-label="Add vertex"><circle r="4"></circle></g></svg>
  </body>`);
  const saved = { MutationObserver: globalThis.MutationObserver, document: globalThis.document };
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.document = dom.window.document;
  try {
    const stop = installGlyphOnlyButtons(dom.window.document.body);
    assert.equal(dom.window.document.getElementById('icon').hasAttribute('data-glyph-only'), true);
    assert.equal(dom.window.document.getElementById('add').hasAttribute('data-glyph-only'), false);
    stop();
  } finally {
    Object.assign(globalThis, saved);
  }
});
