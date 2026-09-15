import assert from 'node:assert/strict';
import test from 'node:test';

import { fitMultilineFontSize, getPdfjsFormTextSizing } from '../src/components/pdfjsFormTextSizing.js';

test('multiline widget keeps a non-zero DA font size and fits its own line boxes', () => {
  const sizing = getPdfjsFormTextSizing({
    fieldType: 'Tx',
    multiLine: true,
    rect: [319.5, 499.5, 550.5, 574.5],
    fieldValue: 'First line\nSecond line\nThird line',
    borderStyle: { width: 1 },
    defaultAppearanceData: { fontSize: 17 },
  });

  assert.equal(sizing.fontSize, 17);
  assert.equal(sizing.autoSized, false);
  assert.equal('lineHeight' in sizing, false, 'the textarea keeps its own line height');
});

test('multiline widget auto-sizes only when DA font size is zero', () => {
  const sizing = getPdfjsFormTextSizing({
    fieldType: 'Tx',
    multiLine: true,
    rect: [0, 0, 200, 56],
    fieldValue: 'First\nSecond',
    borderStyle: { width: 1 },
    defaultAppearanceData: { fontSize: 0 },
  });

  assert.equal(sizing.fontSize, 20);
  assert.equal(sizing.autoSized, true);
});

test('missing or invalid DA font size does not trigger auto-size', () => {
  const base = {
    fieldType: 'Tx',
    multiLine: true,
    rect: [0, 0, 200, 56],
    fieldValue: 'First\nSecond',
  };

  assert.equal(getPdfjsFormTextSizing(base), null);
  assert.equal(getPdfjsFormTextSizing({
    ...base,
    defaultAppearanceData: { fontSize: -1 },
  }), null);
});

// --- fitMultilineFontSize (2026-09-15 zoom lock) ------------------------------
// The multiline shrink loop used to run ONCE inside a requestAnimationFrame at
// mount, so whichever zoom the field mounted at decided the size forever and
// every other zoom clipped the value ("Third line." cut off at fit-page in
// prog-07-form-fields.pdf). The loop is now a pure function over an injected
// measurement, so the caller can re-derive it per scale and the loop itself can
// be tested without a browser.

test('multiline fit returns the starting size when the value already fits', () => {
  const asked = [];
  const fitted = fitMultilineFontSize({
    startFontSize: 17,
    measure: (fontSize) => { asked.push(fontSize); return { scrollHeight: 60, clientHeight: 80 }; },
  });

  assert.equal(fitted, 17);
  assert.deepEqual(asked, [17], 'a fitting value costs exactly one measurement');
});

test('multiline fit shrinks in 0.5-unit steps until the wrapped text stops overflowing', () => {
  // Overflows until 15.5; the loop must stop the moment it fits, not keep going.
  const fitted = fitMultilineFontSize({
    startFontSize: 17,
    measure: (fontSize) => ({ scrollHeight: fontSize > 15.5 ? 100 : 60, clientHeight: 80 }),
  });

  assert.equal(fitted, 15.5);
});

test('multiline fit treats a one-pixel overflow as fitting', () => {
  // The live measurement carries sub-pixel rounding; a 1px slack is what keeps
  // a field from shrinking a step for nothing.
  assert.equal(fitMultilineFontSize({
    startFontSize: 12,
    measure: () => ({ scrollHeight: 81, clientHeight: 80 }),
  }), 12);

  assert.equal(fitMultilineFontSize({
    startFontSize: 12,
    measure: () => ({ scrollHeight: 82, clientHeight: 80 }),
  }), 6, 'a 2px overflow that never resolves shrinks all the way to the floor');
});

test('multiline fit never shrinks below the readable floor', () => {
  const fitted = fitMultilineFontSize({
    startFontSize: 17,
    measure: () => ({ scrollHeight: 1000, clientHeight: 10 }),
  });

  assert.equal(fitted, 6);
  assert.ok(fitted >= 6);
});

test('multiline fit keeps the starting size when the measurement is unusable', () => {
  // No DOM, a detached element, a zero-size box mid-teardown: never return NaN
  // into a CSS calc().
  assert.equal(fitMultilineFontSize({ startFontSize: 17, measure: () => null }), 17);
  assert.equal(fitMultilineFontSize({ startFontSize: 17, measure: () => ({ scrollHeight: NaN, clientHeight: 80 }) }), 17);
  assert.equal(fitMultilineFontSize({ startFontSize: 17, measure: () => { throw new Error('detached'); } }), 17);
  assert.equal(fitMultilineFontSize({ startFontSize: 17 }), 17, 'no measure function at all');
  assert.equal(fitMultilineFontSize({ startFontSize: 0, measure: () => ({ scrollHeight: 100, clientHeight: 10 }) }), 0);
});

test('multiline fit is a pure function of the current measurement, not of call history', () => {
  // Statelessness is what makes the per-zoom refit safe: the same zoom always
  // produces the same size no matter which zooms the reader passed through.
  const measure = (fontSize) => ({ scrollHeight: fontSize > 14 ? 100 : 60, clientHeight: 80 });
  const first = fitMultilineFontSize({ startFontSize: 17, measure });
  const second = fitMultilineFontSize({ startFontSize: 17, measure });
  const afterAnotherBox = fitMultilineFontSize({
    startFontSize: 17,
    measure: () => ({ scrollHeight: 10, clientHeight: 80 }),
  });
  const third = fitMultilineFontSize({ startFontSize: 17, measure });

  assert.equal(first, 14);
  assert.equal(second, 14);
  assert.equal(afterAnotherBox, 17);
  assert.equal(third, 14);
});
