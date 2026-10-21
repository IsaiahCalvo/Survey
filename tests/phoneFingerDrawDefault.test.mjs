// Phone finger-draw guard (docs/GESTURE-CONTRACT.md P6): a phone with no pen
// seen must let one finger run the active tool. Desktop/tablet may move the
// default to Pencil only, but a phone without a pen would then have no way
// to draw (the Pencil-only control is offered only once a pen was used).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
// An iPhone 13 portrait screen: the phone media query matches.
dom.window.matchMedia = (query) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} });

const storage = new Map();
const fakeStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)); },
};
Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true });

const { isPhoneLayout } = await import('../src/utils/layoutMode.js');
const {
  DRAW_MODES, DRAW_MODE_STORAGE_KEY, loadPencilModeState, pointerMayUseTool,
  resolveTouchStartRoute, resolveViewerPressRoute,
} = await import('../src/utils/pencilMode.js');

const finger = { identifier: 1, touchType: 'direct' };

test('phone-sized device is recognised as a phone', () => {
  assert.equal(isPhoneLayout(dom.window), true);
});

test('phone with no pen seen: default draw mode lets a finger draw', () => {
  storage.clear();
  const { drawMode, penSeen } = loadPencilModeState(fakeStorage);
  assert.equal(penSeen, false);
  assert.equal(drawMode, DRAW_MODES.TOUCH);
  assert.equal(pointerMayUseTool('touch', drawMode), true);
  assert.equal(resolveViewerPressRoute({ pointerType: 'touch', drawMode }), 'pass');
  assert.equal(resolveTouchStartRoute({ touches: [finger], changedTouches: [finger], drawMode }), 'tool');
});

test('phone with no pen seen ignores a stored Pencil-only mode (finger still draws)', () => {
  storage.clear();
  storage.set(DRAW_MODE_STORAGE_KEY, DRAW_MODES.PEN);
  const { drawMode } = loadPencilModeState(fakeStorage);
  assert.equal(drawMode, DRAW_MODES.TOUCH);
  assert.equal(pointerMayUseTool('touch', drawMode), true);
});
