/**
 * Input modality — the input the user is USING (touch audit 2026-10-13, T3/M1).
 *
 * Intended UX: selection grabber hit pads follow the press, not the device's
 * primary pointer. A touch laptop (primary pointer: fine) gets finger-sized
 * pads after a finger press; an iPad (primary pointer: coarse) gets tight pads
 * once its mouse is used. Before any press the primary pointer decides.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectInitialInputModality,
  getInputModality,
  installInputModalityTracking,
  modalityFromPointerEvent,
  normalizeInputModality,
  resetInputModalityForTests,
  setInputModality,
  subscribeInputModality,
} from '../src/utils/inputModality.js';
import {
  getHandleHitPadPx,
  getMarkHitBandWidth,
  resolveHandleHitPadPageSize,
} from '../src/utils/handleHitPad.js';

const fakeWindow = (coarse) => {
  const handlers = {};
  return {
    matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? coarse : false }),
    addEventListener: (type, fn, opts) => { handlers[type] = { fn, opts }; },
    fire(type, init) { handlers[type]?.fn({ type, buttons: 0, screenX: 0, screenY: 0, ...init }); },
    handlers,
  };
};

const withFakeDocument = (fn) => {
  const attrs = {};
  const prev = globalThis.document;
  globalThis.document = {
    documentElement: {
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = String(v); },
    },
  };
  try { return fn(attrs); } finally {
    if (prev === undefined) delete globalThis.document; else globalThis.document = prev;
  }
};

test('pointer types normalise to mouse / pen / touch; anything else is ignored', () => {
  assert.equal(normalizeInputModality('mouse'), 'mouse');
  assert.equal(normalizeInputModality('pen'), 'pen');
  assert.equal(normalizeInputModality('TOUCH'), 'touch');
  assert.equal(normalizeInputModality(''), null);
  assert.equal(normalizeInputModality(undefined), null);
  assert.equal(normalizeInputModality('kinect'), null);
});

test('before any press the primary pointer decides: coarse -> touch, fine -> mouse', () => {
  assert.equal(detectInitialInputModality(fakeWindow(true)), 'touch');
  assert.equal(detectInitialInputModality(fakeWindow(false)), 'mouse');
  assert.equal(detectInitialInputModality(undefined), 'mouse');
  assert.equal(detectInitialInputModality({ matchMedia: () => { throw new Error('x'); } }), 'mouse');
});

test('a press of any kind reports its own type', () => {
  resetInputModalityForTests();
  assert.equal(modalityFromPointerEvent({ type: 'pointerdown', pointerType: 'touch' }), 'touch');
  assert.equal(modalityFromPointerEvent({ type: 'pointerdown', pointerType: 'pen', screenX: 1, screenY: 1 }), 'pen');
  assert.equal(modalityFromPointerEvent({ type: 'pointerdown', pointerType: 'mouse', screenX: 1, screenY: 1 }), 'mouse');
  assert.equal(modalityFromPointerEvent({ type: 'pointerdown', pointerType: '' }), null);
});

test('a hovering mouse or pen switches, a finger never hovers, a drag or a still pointer says nothing', () => {
  resetInputModalityForTests();
  assert.equal(modalityFromPointerEvent({ type: 'pointermove', pointerType: 'mouse', buttons: 0, screenX: 10, screenY: 10 }), 'mouse');
  // same spot again (layout moved under a resting cursor): not a real move
  assert.equal(modalityFromPointerEvent({ type: 'pointermove', pointerType: 'mouse', buttons: 0, screenX: 10, screenY: 10 }), null);
  assert.equal(modalityFromPointerEvent({ type: 'pointermove', pointerType: 'mouse', buttons: 0, screenX: 12, screenY: 10 }), 'mouse');
  assert.equal(modalityFromPointerEvent({ type: 'pointermove', pointerType: 'pen', buttons: 0, screenX: 40, screenY: 40 }), 'pen');
  assert.equal(modalityFromPointerEvent({ type: 'pointermove', pointerType: 'touch', buttons: 1, screenX: 5, screenY: 5 }), null);
  assert.equal(modalityFromPointerEvent({ type: 'pointermove', pointerType: 'mouse', buttons: 1, screenX: 90, screenY: 90 }), null);
  assert.equal(modalityFromPointerEvent({ type: 'pointerup', pointerType: 'mouse' }), null);
});

test('set + subscribe: listeners hear each change once; the root gets data-input', () => {
  withFakeDocument((attrs) => {
    resetInputModalityForTests();
    const win = fakeWindow(false);
    installInputModalityTracking(win);
    assert.equal(attrs['data-input'], 'mouse', 'root marked before any press');
    const heard = [];
    const off = subscribeInputModality((m) => heard.push(m));
    assert.equal(setInputModality('touch'), true);
    assert.equal(setInputModality('touch'), false, 'unchanged is a no-op');
    assert.equal(setInputModality('bogus'), false);
    assert.equal(getInputModality(), 'touch');
    assert.equal(attrs['data-input'], 'touch');
    off();
    setInputModality('pen');
    assert.deepEqual(heard, ['touch']);
    assert.equal(attrs['data-input'], 'pen');
  });
});

test('touch laptop: fine primary pointer, a finger press switches to touch, the mouse switches back', () => {
  withFakeDocument((attrs) => {
    resetInputModalityForTests();
    const win = fakeWindow(false);
    installInputModalityTracking(win);
    // capture + passive: we see the press first and never block it
    assert.deepEqual(win.handlers.pointerdown.opts, { capture: true, passive: true });
    assert.equal(getInputModality(), 'mouse');
    win.fire('pointerdown', { pointerType: 'touch' });
    assert.equal(getInputModality(), 'touch');
    assert.equal(attrs['data-input'], 'touch');
    win.fire('pointermove', { pointerType: 'mouse', screenX: 300, screenY: 200 });
    assert.equal(getInputModality(), 'mouse');
    assert.equal(attrs['data-input'], 'mouse');
  });
});

test('iPad: coarse primary pointer starts touch; mouse press -> mouse, pen press -> pen', () => {
  withFakeDocument(() => {
    resetInputModalityForTests();
    const prevWindow = globalThis.window;
    const win = fakeWindow(true);
    globalThis.window = win;
    try {
      installInputModalityTracking(win);
      assert.equal(getInputModality(), 'touch');
      win.fire('pointerdown', { pointerType: 'mouse', screenX: 1, screenY: 1 });
      assert.equal(getInputModality(), 'mouse');
      win.fire('pointerdown', { pointerType: 'pen', screenX: 1, screenY: 1 });
      assert.equal(getInputModality(), 'pen');
    } finally {
      if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
    }
  });
});

test('hit pads per input: mouse 20, pen 32, finger 44 (screen px, any zoom)', () => {
  assert.equal(getHandleHitPadPx('mouse'), 20);
  assert.equal(getHandleHitPadPx('pen'), 32);
  assert.equal(getHandleHitPadPx('touch'), 44);
  for (const inverseScale of [0.5, 1, 2]) {
    const page = (inputKind) => resolveHandleHitPadPageSize({ inputKind, inverseScale, minPadPageUnits: 11 * inverseScale });
    assert.ok(Math.abs(page('mouse') / inverseScale - 20) < 1e-9);
    assert.ok(Math.abs(page('pen') / inverseScale - 32) < 1e-9);
    assert.ok(Math.abs(page('touch') / inverseScale - 44) < 1e-9);
  }
  // inputKind wins over the legacy primary-pointer boolean
  assert.equal(resolveHandleHitPadPageSize({ isCoarsePointer: true, inputKind: 'mouse', inverseScale: 1, minPadPageUnits: 11 }), 20);
  assert.equal(resolveHandleHitPadPageSize({ isCoarsePointer: false, inputKind: 'touch', inverseScale: 1, minPadPageUnits: 11 }), 44);
  // legacy callers keep working
  assert.equal(resolveHandleHitPadPageSize({ isCoarsePointer: true, inverseScale: 1, minPadPageUnits: 11 }), 44);
});

test('very small marks: pen and finger pads still shrink to the handle spacing, never below the dot', () => {
  // corners 16 px apart: the pads tile at 16
  assert.equal(resolveHandleHitPadPageSize({ inputKind: 'touch', inverseScale: 1, neighbourSpacingPageUnits: 16, minPadPageUnits: 11 }), 16);
  assert.equal(resolveHandleHitPadPageSize({ inputKind: 'pen', inverseScale: 1, neighbourSpacingPageUnits: 16, minPadPageUnits: 11 }), 16);
  // 6 px apart: the 11 px dot stays fully grabbable
  assert.equal(resolveHandleHitPadPageSize({ inputKind: 'touch', inverseScale: 1, neighbourSpacingPageUnits: 6, minPadPageUnits: 11 }), 11);
  // 38 px apart: finger shrinks to 38, pen keeps 32
  assert.equal(resolveHandleHitPadPageSize({ inputKind: 'touch', inverseScale: 1, neighbourSpacingPageUnits: 38, minPadPageUnits: 11 }), 38);
  assert.equal(resolveHandleHitPadPageSize({ inputKind: 'pen', inverseScale: 1, neighbourSpacingPageUnits: 38, minPadPageUnits: 11 }), 32);
});

test('mark hit band per input: 4 / 8 / 12 CSS px a side', () => {
  assert.equal(getMarkHitBandWidth({ inkWidth: 0, unitsPerPx: 1, inputKind: 'mouse' }), 8);
  assert.equal(getMarkHitBandWidth({ inkWidth: 0, unitsPerPx: 1, inputKind: 'pen' }), 16);
  assert.equal(getMarkHitBandWidth({ inkWidth: 0, unitsPerPx: 1, inputKind: 'touch' }), 24);
  assert.equal(getMarkHitBandWidth({ inkWidth: 0, unitsPerPx: 1, isCoarsePointer: true, inputKind: 'mouse' }), 8);
});
