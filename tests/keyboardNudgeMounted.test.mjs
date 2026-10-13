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

// A key press: keydown then keyup (a real press). `hold: true` sends the
// keydown only — the key stays down (auto-repeat sends more keydowns).
function key(k, init = {}, target = document.body) {
  const { hold = false, ...eventInit } = init;
  const event = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...eventInit });
  target.dispatchEvent(event);
  if (!hold) target.dispatchEvent(new window.KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true, ...eventInit }));
  return event;
}
const release = (k) => window.dispatchEvent(new window.KeyboardEvent('keyup', { key: k, bubbles: true }));

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
    for (let i = 0; i < 60; i += 1) { key('ArrowLeft', { repeat: i > 0, hold: true }); await sleep(2); }
    release('ArrowLeft');
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
  assert.ok(m.svg.querySelector('[data-selection-lock-badge]'), 'the locked mark is selected — its lock badge shows (else this test proves nothing)');
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

test('Delete right after a nudge (same idle window): the nudge saves first, then the delete — no revert', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  mounted = root;
  const log = [];
  let page = { objects: [rect('a', 100, 100), rect('b', 250, 250)] };
  const props = () => ({
    pageNumber: 1, width: 400, height: 400, annotations: page,
    callouts: [], surveyMarkers: [], activeTool: 'select', selectedCalloutIds: new Set(),
    onSelectedCalloutIdsChange: () => {}, onSelectionChange: () => {},
    selectedModuleId: null, showSurveyPanel: false, selectedSpaceId: null,
    activeSpaceId: null, activeRegions: [], activeRegionId: null, spaces: [],
    layerVisibility: {}, viewerId: 'owner', documentOwnerId: 'owner',
    onSaveAnnotations: (next, context) => {
      log.push({ action: context?.action, ids: next.objects.map((o) => `${o.id}@${o.left}`) });
      page = next;
      root.render(React.createElement(SVGAnnotationLayer, props()));
    },
  });
  await act(async () => root.render(React.createElement(SVGAnnotationLayer, props())));
  const svg = document.querySelector('[data-svg-annotation-layer="1"]');
  Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 400 });
  const hit = svg.querySelector('[data-annotation-index="1"] [data-shape-hit-target="rect"]');
  await act(async () => { hit.dispatchEvent(pointer('pointerdown', 251, 270)); hit.dispatchEvent(pointer('pointerup', 251, 270)); });
  await act(async () => { key('ArrowLeft'); key('ArrowLeft'); key('Delete'); });
  await act(async () => { await sleep(NUDGE_IDLE_COMMIT_MS + 80); });
  const nudgeAt = log.findIndex((entry) => entry.action === 'nudge');
  assert.ok(nudgeAt >= 0, JSON.stringify(log));
  assert.deepEqual(log[nudgeAt].ids, ['a@100', 'b@248']);
  assert.deepEqual(page.objects.map((o) => o.id), ['a'], `b deleted: ${JSON.stringify(log)}`);
  assert.equal(page.objects[0].left, 100, 'the other mark is untouched');
  assert.equal(log.filter((entry) => entry.action === 'nudge').length, 1, 'no second nudge save after the delete');
});

test('the preview is gone once the saved page comes back (no double move)', async () => {
  // A stateful host, like the viewer: every save becomes the next props.
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  mounted = root;
  let page = { objects: [rect('a', 100, 100)] };
  const props = () => ({
    pageNumber: 1, width: 400, height: 400, annotations: page,
    callouts: [], surveyMarkers: [], activeTool: 'select', selectedCalloutIds: new Set(),
    onSelectedCalloutIdsChange: () => {}, onSelectionChange: () => {},
    selectedModuleId: null, showSurveyPanel: false, selectedSpaceId: null,
    activeSpaceId: null, activeRegions: [], activeRegionId: null, spaces: [],
    layerVisibility: {}, viewerId: 'owner', documentOwnerId: 'owner',
    onSaveAnnotations: (next) => { page = next; root.render(React.createElement(SVGAnnotationLayer, props())); },
  });
  await act(async () => root.render(React.createElement(SVGAnnotationLayer, props())));
  const svg = document.querySelector('[data-svg-annotation-layer="1"]');
  Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 400 });
  const hit = svg.querySelector('[data-annotation-index="0"] [data-shape-hit-target="rect"]');
  await act(async () => { hit.dispatchEvent(pointer('pointerdown', 101, 120)); hit.dispatchEvent(pointer('pointerup', 101, 120)); });
  await act(async () => { key('ArrowRight'); key('ArrowRight'); key('ArrowRight'); });
  const node = () => svg.querySelector('[data-annotation-index="0"]');
  const nudgeTranslates = () => {
    const found = [];
    for (let el = node(); el && el !== svg; el = el.parentElement) {
      const t = el.getAttribute('transform');
      if (t && /translate\(3,? 0\)/.test(t)) found.push(t);
    }
    return found;
  };
  assert.equal(nudgeTranslates().length, 1, 'the burst previews as one translate');
  await act(async () => { await sleep(NUDGE_IDLE_COMMIT_MS + 80); });
  assert.equal(page.objects[0].left, 103);
  assert.deepEqual(nudgeTranslates(), [], 'no leftover nudge translate on top of the saved move');
});

test('a slow key-repeat start (held key, no repeat for a while) is still one undo step', async () => {
  const m = await mountLayer([rect('a', 100, 100)]);
  await m.select(0, 101, 120);
  const before = m.saves.length;
  await act(async () => {
    key('ArrowRight', { hold: true });
    await sleep(NUDGE_IDLE_COMMIT_MS + 300); // the OS "delay until repeat"
    for (let i = 0; i < 5; i += 1) key('ArrowRight', { repeat: true, hold: true });
  });
  assert.equal(nudgeSaves(m.saves.slice(before)).length, 0, 'nothing saved while the key is held');
  await act(async () => {
    release('ArrowRight');
    await sleep(NUDGE_IDLE_COMMIT_MS + 80);
  });
  const saved = nudgeSaves(m.saves.slice(before));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].next.objects[0].left, 106);
});

test('Undo (flushPendingNudges) saves a running burst first', async () => {
  const { flushPendingNudges } = await vite.ssrLoadModule('/src/utils/annotationFamilyRules.js');
  const m = await mountLayer([rect('a', 100, 100)]);
  await m.select(0, 101, 120);
  await act(async () => { key('ArrowDown', { shiftKey: true }); });
  assert.equal(nudgeSaves(m.saves).length, 0);
  await act(async () => { flushPendingNudges(); });
  const saved = nudgeSaves(m.saves);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].next.objects[0].top, 110);
});

// The viewer turns this order into ONE undo step (the callout frames open the
// page's gesture baseline, the normal save closes it) — verified in the live
// app (w57 report); here we pin the order the hook must keep.
test('a shape + callout burst: callout frames first, then the one normal save, then the no-op commit signal', async () => {
  const calls = [];
  const callout = {
    id: 'c1', pageNumber: 1,
    arrowTip: { x: 0.1, y: 0.6 }, knee: { x: 0.2, y: 0.6 },
    textBoxPosition: { x: 0.3, y: 0.55 }, textBoxWidth: 0.2, textBoxHeight: 0.1,
    text: 'c', style: {},
  };
  const m = await mountLayer([rect('a', 100, 100)], {
    callouts: [callout],
    // the host keeps the callout selected (this prop is the source of truth)
    selectedCalloutIds: new Set(['c1']),
    onUpdateCalloutLive: (id, patch) => calls.push(['live', id, patch.textBoxPosition.x]),
    onUpdateCallout: (id) => calls.push(['commit', id]),
    onSaveAnnotations: (next, context) => calls.push(['save', context?.action, context?.checkpointPolicy]),
  });
  await m.select(0, 101, 120);
  calls.length = 0;
  await act(async () => { key('ArrowRight'); key('ArrowRight'); });
  assert.deepEqual(calls, [], 'nothing written during the burst');
  await act(async () => { await sleep(NUDGE_IDLE_COMMIT_MS + 80); });
  const kinds = calls.map((c) => c[0]);
  assert.deepEqual(kinds, ['live', 'save', 'commit'], JSON.stringify(calls));
  assert.equal(calls[0][2], 0.3 + 2 / 400);
  assert.deepEqual(calls[1], ['save', 'nudge', 'normal']);
});
