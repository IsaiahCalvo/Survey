// w57 (2026-09-28) — arrow-key nudge, mounted in the real SVGAnnotationLayer.
//
// Owner: "select any single annotation and use the arrow keys to move it in
// small increments, or hold Shift + arrow to jump in larger increments, just
// like Drawboard PDF and Adobe Acrobat." These tests pin the behaviour:
//   * 1 page unit per press, 10 with Shift (page units, zoom-independent);
//   * a held key (auto-repeat) or quick taps preview live with NO save per
//     press, then save ONCE (one undo step) NUDGE_IDLE_COMMIT_MS later;
//   * the key never scrolls / turns the page while a mark moves;
//   * any other key or a pointerdown saves the burst first, synchronously;
//   * typing in a field, an open right-click menu, a locked mark and an empty
//     selection leave the arrow keys alone.
import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';

let dom;
let vite;
let SVGAnnotationLayer;
let NUDGE_IDLE_COMMIT_MS;

before(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    SVGElement: dom.window.SVGElement, Node: dom.window.Node,
    MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent,
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
  vite = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    ssr: { external: ['@survey/shared'] },
  });
  ({ default: SVGAnnotationLayer } = await vite.ssrLoadModule('/src/components/SVGAnnotationLayer.jsx'));
  ({ NUDGE_IDLE_COMMIT_MS } = await vite.ssrLoadModule('/src/utils/annotationFamilyRules.js'));
});

after(async () => { await vite?.close(); dom?.window.close(); });

// A failed assertion must not leave a layer (and its window key listeners)
// mounted for the next test.
let mounted = null;
afterEach(async () => {
  if (mounted) await act(async () => mounted.unmount());
  mounted = null;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rect = (id, left, top, extra = {}) => ({
  type: 'rect', id, left, top, width: 60, height: 40,
  scaleX: 1, scaleY: 1, angle: 0, fill: 'transparent', stroke: '#111827',
  strokeWidth: 2, data: { id, ...(extra.data || {}) }, ...extra,
});

function pointer(type, x, y, pointerId = 1) {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: x, clientY: y, pointerId, pointerType: 'mouse', isPrimary: true,
  });
}

function key(k, init = {}, target = document.body) {
  const event = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

async function mountLayer(objects, overrides = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  mounted = root;
  const saves = [];
  const baseProps = {
    pageNumber: 1, width: 400, height: 400, annotations: { objects },
    callouts: [], surveyMarkers: [],
    onSaveAnnotations: (next, context) => saves.push({ next, context }),
    activeTool: 'select', selectedCalloutIds: new Set(),
    onSelectedCalloutIdsChange: () => {}, onSelectionChange: () => {},
    selectedModuleId: null, showSurveyPanel: false, selectedSpaceId: null,
    activeSpaceId: null, activeRegions: [], activeRegionId: null, spaces: [],
    layerVisibility: {}, viewerId: 'owner', documentOwnerId: 'owner', ...overrides,
  };
  await act(async () => root.render(React.createElement(SVGAnnotationLayer, baseProps)));
  const svg = document.querySelector('[data-svg-annotation-layer="1"]');
  Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 400 });
  const select = async (index, x, y) => {
    const hit = svg.querySelector(`[data-annotation-index="${index}"] [data-shape-hit-target="rect"]`);
    await act(async () => { hit.dispatchEvent(pointer('pointerdown', x, y)); hit.dispatchEvent(pointer('pointerup', x, y)); });
  };
  const translateOf = (index) => svg.querySelector(`[data-annotation-index="${index}"]`)?.closest('[transform]')?.getAttribute('transform')
    || svg.querySelector(`[data-annotation-index="${index}"]`)?.getAttribute('transform') || null;
  return { root, svg, saves, select, translateOf };
}

const nudgeSaves = (saves) => saves.filter((s) => /nudge/.test(String(s.context?.action || '')));

test('arrow = 1 page unit, Shift+arrow = 10; a burst saves once, after the idle gap', async () => {
  const m = await mountLayer([rect('a', 100, 100)]);
  await m.select(0, 101, 120);
  const before = m.saves.length;
  let prevented = 0;
  await act(async () => {
    for (let i = 0; i < 3; i += 1) prevented += key('ArrowRight', { repeat: i > 0 }).defaultPrevented ? 1 : 0;
    prevented += key('ArrowDown', { shiftKey: true }).defaultPrevented ? 1 : 0;
  });
  assert.equal(prevented, 4, 'every nudge press is consumed (no page scroll / page turn)');
  assert.equal(m.saves.length, before, 'no save while the burst is running');
  assert.match(m.translateOf(0) || '', /translate\(3,? 10\)/, 'live preview moves the mark');
  await act(async () => { await sleep(NUDGE_IDLE_COMMIT_MS + 80); });
  const saved = nudgeSaves(m.saves.slice(before));
  assert.equal(saved.length, 1, 'one save for the whole burst');
  assert.equal(saved[0].context.action, 'nudge');
  assert.equal(saved[0].context.checkpointPolicy, 'normal', 'one undo step');
  assert.equal(saved[0].next.objects[0].left, 103);
  assert.equal(saved[0].next.objects[0].top, 110);
});

test('a held key (60 auto-repeat presses) is still one save', async () => {
  const m = await mountLayer([rect('a', 100, 100)]);
  await m.select(0, 101, 120);
  const before = m.saves.length;
  await act(async () => {
    for (let i = 0; i < 60; i += 1) { key('ArrowLeft', { repeat: i > 0 }); await sleep(2); }
  });
  assert.equal(m.saves.length, before, 'no per-press save');
  await act(async () => { await sleep(NUDGE_IDLE_COMMIT_MS + 80); });
  const saved = nudgeSaves(m.saves.slice(before));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].next.objects[0].left, 40);
});

test('the step is in page units whatever the zoom (a wider page on screen moves the same 1 unit)', async () => {
  const m = await mountLayer([rect('a', 100, 100)]);
  Object.defineProperty(m.svg, 'clientWidth', { configurable: true, value: 1600 });
  await m.select(0, 101, 120);
  await act(async () => { key('ArrowRight'); await sleep(NUDGE_IDLE_COMMIT_MS + 80); });
  assert.equal(nudgeSaves(m.saves).at(-1).next.objects[0].left, 101);
});

test('another key or a pointerdown saves the burst first, before that input runs', async () => {
  const m = await mountLayer([rect('a', 100, 100)]);
  await m.select(0, 101, 120);
  await act(async () => { key('ArrowRight'); key('ArrowRight'); });
  let savesWhenMetaArrived = null;
  const probe = () => { savesWhenMetaArrived = nudgeSaves(m.saves).length; };
  window.addEventListener('keydown', probe);
  await act(async () => { key('Meta', { metaKey: true }); });
  window.removeEventListener('keydown', probe);
  assert.equal(savesWhenMetaArrived, 1, 'Cmd (for Cmd+Z / Cmd+C) sees the nudge already saved');
  assert.equal(nudgeSaves(m.saves)[0].next.objects[0].left, 102);

  await act(async () => { key('ArrowDown'); });
  await act(async () => { m.svg.dispatchEvent(pointer('pointerdown', 390, 390, 5)); });
  assert.equal(nudgeSaves(m.saves).length, 2, 'a click saves the running burst at once');
});

test('arrows are left alone while typing, with the right-click menu open, or with nothing selected', async () => {
  const m = await mountLayer([rect('a', 100, 100)]);
  // nothing selected: the key is not consumed, so the page scrolls as before
  let event;
  await act(async () => { event = key('ArrowDown'); });
  assert.equal(event.defaultPrevented, false);

  await m.select(0, 101, 120);
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  await act(async () => { event = key('ArrowLeft', {}, input); });
  assert.equal(event.defaultPrevented, false, 'the text field keeps its caret keys');
  input.remove();

  const menu = document.createElement('div');
  menu.setAttribute('data-annotation-context-menu', 'true');
  document.body.appendChild(menu);
  await act(async () => { event = key('ArrowRight'); await sleep(NUDGE_IDLE_COMMIT_MS + 80); });
  assert.equal(event.defaultPrevented, false, 'the open menu owns the arrows');
  menu.remove();
  assert.equal(nudgeSaves(m.saves).length, 0, 'the mark never moved');
});

test('a locked mark does not move and the key keeps its normal job', async () => {
  const m = await mountLayer([rect('a', 100, 100, { data: { id: 'a', lockedBy: 'owner' } })]);
  await m.select(0, 101, 120);
  let event;
  await act(async () => { event = key('ArrowRight', { shiftKey: true }); await sleep(NUDGE_IDLE_COMMIT_MS + 80); });
  assert.equal(event.defaultPrevented, false);
  assert.equal(nudgeSaves(m.saves).length, 0);
});

test('a group selection nudges every movable member by the same amount in one save', async () => {
  const m = await mountLayer([rect('a', 100, 100), rect('b', 200, 200)]);
  await m.select(0, 101, 120);
  const hitB = m.svg.querySelector('[data-annotation-index="1"] [data-shape-hit-target="rect"]');
  await act(async () => {
    hitB.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: 201, clientY: 220, shiftKey: true, pointerId: 2 }));
    hitB.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: 201, clientY: 220, shiftKey: true, pointerId: 2 }));
  });
  const before = m.saves.length;
  await act(async () => { key('ArrowUp', { shiftKey: true }); key('ArrowUp'); });
  assert.equal(m.saves.length, before);
  await act(async () => { await sleep(NUDGE_IDLE_COMMIT_MS + 80); });
  const saved = nudgeSaves(m.saves.slice(before));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].next.objects[0].top, 89);
  assert.equal(saved[0].next.objects[1].top, 189);
});
