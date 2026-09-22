import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getAnnotationSizePreviewThickness } from '../src/utils/annotationSize.js';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const componentSource = read('../src/components/AnnotationSizeControl.jsx');
const styleSource = read('../src/components/AnnotationSizeControl.css');

test('counter size menu exposes the exact approved preset sequence', () => {
  assert.match(
    componentSource,
    /counter:\s*\[5, 8, 12, 16, 24, 32, 48, 64\]/,
  );
});

test('annotation size presets render as an accessible vertical list with row previews', () => {
  assert.match(componentSource, /role="listbox"/);
  assert.match(componentSource, /role="option"/);
  assert.match(componentSource, /annotation-size-control__preset-preview/);
  assert.doesNotMatch(componentSource, /annotation-size-control__preset-check/);
  assert.doesNotMatch(componentSource, /annotation-size-control__custom/);

  const presetListRule = styleSource.match(/\.annotation-size-control__presets\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(presetListRule, /display:\s*flex/);
  assert.match(presetListRule, /flex-direction:\s*column/);
  assert.doesNotMatch(presetListRule, /grid-template-columns/);
  // DELIBERATE ASSERTION CHANGE (2026-09-16, desktop sweep): the literal 126px is
  // replaced by the token. This assertion was the only reason the stylesheet
  // declared `width: 126px` twice — a dead first declaration purely to satisfy a
  // text match, with `width: var(--chrome-menu-w, 126px)` under it winning the
  // cascade. Owner ruling of this pass: one shared size scale, written in one
  // place. Asserting the token is also stricter: a hard-coded literal here would
  // now fail, which is the drift the test is for.
  // DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7 — owner-approved board 15):
  // a menu is as wide as the FIELD it opens from, so the width is no longer one
  // shared number. The pill passes its own width token in and the menu takes it
  // as a MINIMUM, growing only when a row's own text ("50 pt") would not fit.
  // The sample column moved with it: 68px was sized for a 126px menu, and board
  // 15 draws a 24px sample at the head of every row in every chrome menu, so the
  // column is the shared --chrome-menu-sample-w now. Both are still tokens, which
  // is what this assertion is really for.
  assert.match(
    styleSource,
    /\.annotation-size-control__popover\s*\{[^}]*min-width:\s*var\(--chrome-menu-field-w, var\(--chrome-menu-w, 126px\)\)/s,
  );
  assert.match(styleSource, /grid-template-columns:\s*var\(--chrome-menu-sample-w, 24px\)\s+1fr/);
  assert.doesNotMatch(styleSource, /grid-template-columns:[^;]*\s+16px/);
  // DELIBERATE ASSERTION CHANGE (2026-09-17, revision-2 palette approved by the
  // owner): the checked row's colours are the shared tokens now, and it gained
  // the same 2px gold edge every other checked row in the app carries, so the
  // Width list and the Style list cannot look like two different products. The
  // literals it used to pin (#f4f6f8 on #2b313a) were this one stylesheet's own
  // near-white and near-grey, in the app's ramp nowhere. What the assertion
  // guards — that the checked row is visibly distinct from hover — still holds,
  // more strongly: hover is now a surface step BELOW the checked row.
  // DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7 — owner ruling, board 15):
  // the CURRENT row in a chrome menu is gold text and nothing else. No tick, no
  // fill, no gold edge: the pill above the menu already shows the current value,
  // so the row only has to agree with it, and a filled row plus a gold edge made
  // the menu louder than the 36px bar it hangs off. Hover remains a surface step,
  // so the current row still reads differently from the row under the pointer.
  assert.match(
    styleSource,
    /button\.is-active\s*\{[^}]*color:\s*var\(--accent\)[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s,
  );
});

test('every counter preset through 64 receives a distinct preview thickness', () => {
  const counterPresets = [5, 8, 12, 16, 24, 32, 48, 64];
  const thicknesses = counterPresets.map((preset) => (
    getAnnotationSizePreviewThickness(preset, 5, 64)
  ));

  assert.equal(new Set(thicknesses).size, counterPresets.length);
  for (let index = 1; index < thicknesses.length; index += 1) {
    assert.ok(thicknesses[index] > thicknesses[index - 1]);
    assert.ok(thicknesses[index] - thicknesses[index - 1] >= 1);
  }
});

test('annotation size listbox uses roving focus and standard navigation keys', () => {
  assert.match(componentSource, /tabIndex=\{focusedPresetIndex === index \? 0 : -1\}/);
  assert.match(componentSource, /onFocus=\{\(\) => setFocusedPresetIndex\(index\)\}/);
  assert.match(componentSource, /presetOptionRefs\.current\[nextIndex\]\?\.focus\(\)/);
  assert.match(componentSource, /if \(nextOpen\) \{\s*setFocusedPresetIndex\(selectedPresetIndex >= 0 \? selectedPresetIndex : 0\)/s);
  assert.match(componentSource, /onOpenChange=\{handleOpenChange\}/);

  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.match(componentSource, new RegExp(`event\\.key === '${key}'`));
  }
});
