import assert from 'node:assert/strict';
import test from 'node:test';

import { fitMultilineFontSize, getPdfjsFormTextSizing, multilineFitSignature } from '../src/components/pdfjsFormTextSizing.js';

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

// --- multilineFitSignature (2026-09-15 zoom lock, round 2) --------------------
// The fit is now ZOOM-INVARIANT, not merely re-derived per zoom: the control is
// laid out at its page box and scaled by a transform, so the browser wraps the
// value once and `measure` always reports page units. The signature states what
// the answer is allowed to depend on, and the caller skips the work when it is
// unchanged — which is what makes a zoom step cost nothing and leaves no window
// where the value overflows its box waiting for a refit.

test('the fit signature is the page box, the starting size and the text — nothing else', () => {
  const base = { pageWidth: 231, pageHeight: 75, startFontSize: 17, value: 'a\nb' };
  const signature = multilineFitSignature(base);

  assert.equal(multilineFitSignature({ ...base }), signature, 'same inputs, same signature');
  assert.notEqual(multilineFitSignature({ ...base, pageWidth: 232 }), signature);
  assert.notEqual(multilineFitSignature({ ...base, pageHeight: 76 }), signature);
  assert.notEqual(multilineFitSignature({ ...base, startFontSize: 16.5 }), signature);
  assert.notEqual(multilineFitSignature({ ...base, value: 'a\nb\nc' }), signature);
  // A caller that tried to feed the zoom in gets the same answer anyway: there
  // is no parameter for it, which is the point.
  assert.equal(multilineFitSignature({ ...base, scale: 3.58 }), signature);
});

test('the fit signature survives the float noise a measured page box carries', () => {
  // The page box is derived from pdf.js's own percentage, so it can arrive as
  // 230.99999999999997 at one zoom and 231 at the next. Rounding to 1/1000 of a
  // page unit keeps that from re-fitting (and re-wrapping) for nothing, while
  // still catching a real page-box change.
  assert.equal(
    multilineFitSignature({ pageWidth: 230.99999999999997, pageHeight: 75, startFontSize: 17, value: 'x' }),
    multilineFitSignature({ pageWidth: 231, pageHeight: 75, startFontSize: 17, value: 'x' }),
  );
  assert.notEqual(
    multilineFitSignature({ pageWidth: 231.01, pageHeight: 75, startFontSize: 17, value: 'x' }),
    multilineFitSignature({ pageWidth: 231, pageHeight: 75, startFontSize: 17, value: 'x' }),
  );
});

test('the fit signature treats an empty and a missing value alike', () => {
  assert.equal(
    multilineFitSignature({ pageWidth: 10, pageHeight: 10, startFontSize: 9 }),
    multilineFitSignature({ pageWidth: 10, pageHeight: 10, startFontSize: 9, value: '' }),
  );
  assert.equal(typeof multilineFitSignature(), 'string', 'never throws on a half-built target');
});
