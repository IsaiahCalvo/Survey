// Pencil-only mode, gutter pan and middle-button pan (drawboardAudit C2/C3/C5;
// docs/GESTURE-CONTRACT.md rules P1-P6, G1, M1): the routing rules, the
// remembered setting, and the window/capture finger gate.
//
// One jsdom window for the file: the gate installs its window/capture
// listeners once, at module load, exactly as in the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><body>
  <div id="rail"><button id="rail-button">Zoom in</button></div>
  <div id="scroller" data-mobile-pdf-surface="true" data-interaction-mode="TextSelection">
    <div data-pdfjs-content="true" id="content">
      <div class="survey-pdfjs-page-div" id="v_pageDiv_0" data-page-number="1">
        <canvas id="page-canvas"></canvas>
        <svg id="layer"><g data-annotation-index="3"><rect id="anno" width="10" height="10"></rect></g></svg>
        <div data-mini-toolbar><button id="mini">Delete</button></div>
        <section class="annotationLayer"><section data-annotation-id="w1" class="textWidgetAnnotation"><input id="field" /></section></section>
      </div>
    </div>
  </div>
</body>`, { pretendToBeVisual: true, url: 'http://localhost/' });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;

const storage = new Map();
const fakeStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)); },
};
Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true });

const mod = await import('../src/utils/pencilMode.js');
const {
  DRAW_MODES, DRAW_MODE_STORAGE_KEY, PEN_SEEN_STORAGE_KEY,
  getPencilModeState, isPencilOnly, isPenDown, loadPencilModeState, notePenSeen, setDrawMode, subscribePencilMode,
  pointerMayUseTool, resolveViewerPressRoute, resolveTouchStartRoute, hasStylusTouch, isGatedFingerTarget,
  subscribeGatedPointers, __resetPencilModeForTests,
} = mod;

const $ = (id) => document.getElementById(id);
const finger = { touchType: 'direct' };
const stylus = { touchType: 'stylus' };

function pointer(type, el, { pointerType = 'touch', pointerId = 7, button = 0 } = {}) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button, clientX: 5, clientY: 5 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  el.dispatchEvent(event);
  return event;
}

/** What reaches a tool listener on the SVG layer (and a later window listener). */
function toolSpy() {
  const seen = [];
  const onTool = (event) => seen.push(`${event.type}:${event.pointerType}`);
  const types = ['pointerdown', 'pointermove', 'pointerup', 'click'];
  types.forEach((type) => $('layer').addEventListener(type, onTool));
  return { seen, stop: () => types.forEach((type) => $('layer').removeEventListener(type, onTool)) };
}

test('P0: the setting is offered only after a pen was used; Pencil-only never sticks without it', () => {
  storage.clear();
  assert.deepEqual(loadPencilModeState(fakeStorage), { drawMode: 'touch', penSeen: false });
  storage.set(DRAW_MODE_STORAGE_KEY, 'pen');
  assert.equal(loadPencilModeState(fakeStorage).drawMode, 'touch', 'no pen seen: mode stays touch');
  storage.set(PEN_SEEN_STORAGE_KEY, 'true');
  assert.deepEqual(loadPencilModeState(fakeStorage), { drawMode: 'pen', penSeen: true });
  storage.set(DRAW_MODE_STORAGE_KEY, 'garbage');
  assert.equal(loadPencilModeState(fakeStorage).drawMode, 'touch');
  const throwing = { getItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadPencilModeState(throwing), { drawMode: 'touch', penSeen: false }, 'blocked storage falls back');
});

test('P0: the first pen press reveals the setting and remembers it, but does not switch the mode', () => {
  storage.clear();
  __resetPencilModeForTests({ drawMode: 'touch', penSeen: false });
  let calls = 0;
  const unsubscribe = subscribePencilMode(() => { calls += 1; });
  pointer('pointerdown', $('anno'), { pointerType: 'pen', pointerId: 3 });
  assert.equal(getPencilModeState().penSeen, true);
  assert.equal(getPencilModeState().drawMode, 'touch');
  assert.equal(storage.get(PEN_SEEN_STORAGE_KEY), 'true');
  assert.equal(isPenDown(), true);
  pointer('pointerup', $('anno'), { pointerType: 'pen', pointerId: 3 });
  assert.equal(isPenDown(), false);
  notePenSeen();
  assert.equal(calls, 1, 'one change notification');
  setDrawMode('pen');
  assert.equal(storage.get(DRAW_MODE_STORAGE_KEY), 'pen');
  assert.equal(isPencilOnly(), true);
  setDrawMode('nonsense');
  assert.equal(getPencilModeState().drawMode, 'pen');
  unsubscribe();
});

test('P1: the pointer type decides who may use the tool, never the tool itself', () => {
  assert.equal(pointerMayUseTool('pen', 'pen'), true);
  assert.equal(pointerMayUseTool('mouse', 'pen'), true);
  assert.equal(pointerMayUseTool('touch', 'pen'), false);
  assert.equal(pointerMayUseTool('touch', 'touch'), true);
});

test('G1/M1/P2: desktop press routing — gutter, middle button, Pan, Pencil-only finger', () => {
  const route = (o) => resolveViewerPressRoute({ drawMode: 'touch', ...o });
  // Pen tool armed, press on the page: the tool runs.
  assert.equal(route({ pointerType: 'mouse' }), 'pass');
  assert.equal(route({ pointerType: 'pen' }), 'pass');
  // Grey margin: pans with any tool, mouse or pen.
  assert.equal(route({ pointerType: 'mouse', onGutter: true }), 'pan');
  assert.equal(route({ pointerType: 'pen', onGutter: true }), 'pan');
  // Right-click in the margin keeps its menu.
  assert.equal(route({ pointerType: 'mouse', button: 2, onGutter: true }), 'pass');
  // Middle button: pans anywhere, any tool.
  assert.equal(route({ pointerType: 'mouse', button: 1 }), 'pan');
  assert.equal(route({ pointerType: 'mouse', button: 1, onGutter: true }), 'pan');
  // Pan tool / Space.
  assert.equal(route({ pointerType: 'mouse', panArmed: true }), 'pan');
  // A finger on the pointer-driven surface: tool in 'touch' mode, pan in 'pen' mode.
  assert.equal(route({ pointerType: 'touch' }), 'pass');
  assert.equal(route({ pointerType: 'touch', drawMode: 'pen' }), 'pan');
});

test('P2-P5: touchstart routing on the phone/tablet surface', () => {
  const r = (o) => resolveTouchStartRoute({ drawMode: 'touch', penDown: false, toolIsPan: false, ...o });
  // Pencil or Touch (today): one finger runs the tool, two pinch, Pan pans.
  assert.equal(r({ touches: [finger], changedTouches: [finger] }), 'tool');
  assert.equal(r({ touches: [finger, finger], changedTouches: [finger] }), 'pinch');
  assert.equal(r({ touches: [finger], changedTouches: [finger], toolIsPan: true }), 'pan');
  // Pencil only: one finger pans with ANY tool, two fingers pinch.
  assert.equal(r({ drawMode: 'pen', touches: [finger], changedTouches: [finger] }), 'pan');
  assert.equal(r({ drawMode: 'pen', touches: [finger, finger], changedTouches: [finger] }), 'pinch');
  // Pencil only: the Apple Pencil's own contact is the pen's (tool).
  assert.equal(r({ drawMode: 'pen', touches: [stylus], changedTouches: [stylus] }), 'pen-tool');
  // Pencil only: a finger landing while the pen writes is ignored (no pan, no pinch).
  assert.equal(r({ drawMode: 'pen', touches: [stylus, finger], changedTouches: [finger] }), 'ignore');
  assert.equal(r({ drawMode: 'pen', touches: [finger], changedTouches: [finger], penDown: true }), 'ignore');
  // ...and the pen landing on a resting finger still draws.
  assert.equal(r({ drawMode: 'pen', touches: [finger, stylus], changedTouches: [stylus] }), 'pen-tool');
  // Pencil or Touch too (Codex: drawing panned the page in the native app):
  // a finger/knuckle landing beside a writing pen is set aside, never a pinch.
  assert.equal(r({ touches: [stylus], changedTouches: [stylus] }), 'pen-tool');
  assert.equal(r({ touches: [stylus, finger], changedTouches: [finger] }), 'ignore');
  assert.equal(r({ touches: [finger], changedTouches: [finger], penDown: true }), 'ignore');
  assert.equal(r({ touches: [finger, finger], changedTouches: [finger], penDown: true }), 'ignore');
  assert.equal(hasStylusTouch([finger, stylus]), true);
  assert.equal(hasStylusTouch(undefined), false);
});

test('P2: in Pencil-only mode the gate keeps finger pointer events (and their click) from every tool', () => {
  __resetPencilModeForTests({ drawMode: 'pen', penSeen: true });
  const spy = toolSpy();
  const told = [];
  const unsubscribe = subscribeGatedPointers((event, kind) => told.push(`${kind}:${event.type}`));
  pointer('pointerdown', $('anno'));
  pointer('pointermove', $('anno'));
  pointer('pointerup', $('anno'));
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(click, 'pointerType', { value: 'touch' });
  $('anno').dispatchEvent(click);
  assert.deepEqual(spy.seen, [], 'no finger event reached the tool layer');
  assert.equal(click.defaultPrevented, true);
  assert.deepEqual(told, ['finger:pointerdown', 'finger:pointermove', 'finger:pointerup']);
  // The pen still reaches the tool.
  pointer('pointerdown', $('anno'), { pointerType: 'pen', pointerId: 9 });
  pointer('pointerup', $('anno'), { pointerType: 'pen', pointerId: 9 });
  assert.deepEqual(spy.seen, ['pointerdown:pen', 'pointerup:pen']);
  assert.ok(told.includes('pen-down:pointerdown'));
  unsubscribe();
  spy.stop();
});

test('P2: controls, form fields and everything outside the viewer keep working with a finger', () => {
  __resetPencilModeForTests({ drawMode: 'pen', penSeen: true });
  assert.equal(isGatedFingerTarget($('anno')), true);
  assert.equal(isGatedFingerTarget($('content')), true, 'the grey margin pans too');
  assert.equal(isGatedFingerTarget($('mini')), false, 'a toolbar button on the page');
  assert.equal(isGatedFingerTarget($('field')), false, 'a live form field');
  assert.equal(isGatedFingerTarget($('rail-button')), false, 'chrome outside the viewer');
  let reached = 0;
  const onDown = () => { reached += 1; };
  $('mini').addEventListener('pointerdown', onDown);
  pointer('pointerdown', $('mini'), { pointerId: 11 });
  pointer('pointerup', $('mini'), { pointerId: 11 });
  $('mini').removeEventListener('pointerdown', onDown);
  assert.equal(reached, 1);
});

test('P1: in Pencil-or-Touch mode the gate does nothing', () => {
  __resetPencilModeForTests({ drawMode: 'touch', penSeen: true });
  const spy = toolSpy();
  pointer('pointerdown', $('anno'), { pointerId: 12 });
  pointer('pointerup', $('anno'), { pointerId: 12 });
  assert.deepEqual(spy.seen, ['pointerdown:touch', 'pointerup:touch']);
  spy.stop();
});

test('P3 in Pencil-or-Touch mode: while the pen writes, a finger never reaches the tools', () => {
  __resetPencilModeForTests({ drawMode: 'touch', penSeen: true });
  const spy = toolSpy();
  pointer('pointerdown', $('anno'), { pointerType: 'pen', pointerId: 21 });
  pointer('pointerdown', $('anno'), { pointerId: 22 });
  pointer('pointermove', $('anno'), { pointerId: 22 });
  pointer('pointerup', $('anno'), { pointerId: 22 });
  pointer('pointerup', $('anno'), { pointerType: 'pen', pointerId: 21 });
  assert.deepEqual(spy.seen, ['pointerdown:pen', 'pointerup:pen']);
  // Pen lifted: the finger runs the tool again.
  pointer('pointerdown', $('anno'), { pointerId: 23 });
  pointer('pointerup', $('anno'), { pointerId: 23 });
  assert.deepEqual(spy.seen.slice(2), ['pointerdown:touch', 'pointerup:touch']);
  spy.stop();
});

test('the viewer wires the rules in (source contract)', async () => {
  const viewerSrc = await readFile(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(viewerSrc, /if \(isPencilOnly\(\) \|\| isPenDown\(\) \|\| hasStylusTouch\(event\.touches\)\) \{/,
    'a pen on the glass routes touchstart in Pencil-or-Touch mode too (no pinch/pan from a resting finger)');
  const src = await readFile(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(src, /resolveViewerPressRoute\(\{/, 'desktop onPointerDown routes through the shared rule');
  assert.match(src, /isGutterPress = \(event\) => event\.target === el/, 'the gutter is the scroller or the content node only');
  assert.match(src, /addEventListener\('mousedown', stopMiddleDefault/, 'no autoscroll circle on a middle press');
  assert.match(src, /addEventListener\('auxclick', stopMiddleDefault/, 'no middle-click link open');
  assert.match(src, /resolveTouchStartRoute\(\{/, 'phone touchstart routes through the shared rule');
  assert.match(src, /mode: 'ignore'/, 'a resting finger is set aside while the pen writes');
  // Batch-5 merge (layout detection x Pencil-only): the pointer pan leaves
  // fingers to the touch handlers on EVERY touch surface (iPad, touch laptop
  // in the desktop layout too), keyed on the attribute the touch handlers
  // follow - not the phone-layout one, or a tablet palm pans in Pencil-only.
  assert.match(src, /event\.pointerType === 'touch' && el\.getAttribute\('data-touch-pdf-surface'\) === 'true'\) return;/,
    'gated fingers on a touch surface are left to the touch handlers');
  assert.match(src, /data-touch-pdf-surface=\{touchSurface \? 'true' : 'false'\}/);
  assert.match(src, /if \(!el \|\| !touchSurface\) return undefined;/, 'the touch handlers follow touchSurface');
  const shell = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  const phone = await readFile(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
  assert.match(shell, /<PencilModeControl\s+surface="desktop"/);
  assert.match(phone, /<PencilModeControl\s+surface="phone"/);
  assert.equal(DRAW_MODES.PEN, 'pen');
});
