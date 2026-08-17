import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const componentSource = read('../src/components/AnnotationSizeControl.jsx');
const styleSource = read('../src/components/AnnotationSizeControl.css');

test('annotation size presets render as an accessible vertical list with row previews', () => {
  assert.match(componentSource, /role="listbox"/);
  assert.match(componentSource, /role="option"/);
  assert.match(componentSource, /annotation-size-control__preset-preview/);
  assert.match(componentSource, /annotation-size-control__preset-check/);
  assert.doesNotMatch(componentSource, /annotation-size-control__custom/);

  const presetListRule = styleSource.match(/\.annotation-size-control__presets\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(presetListRule, /display:\s*flex/);
  assert.match(presetListRule, /flex-direction:\s*column/);
  assert.doesNotMatch(presetListRule, /grid-template-columns/);
  assert.match(styleSource, /\.annotation-size-control__popover\s*\{[^}]*width:\s*164px/s);
  assert.match(styleSource, /button\.is-active\s*\{[^}]*color:\s*#f4f6f8[^}]*background:\s*#2b313a/s);
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
