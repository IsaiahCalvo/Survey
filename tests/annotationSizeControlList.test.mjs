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

  const presetListRule = styleSource.match(/\.annotation-size-control__presets\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(presetListRule, /display:\s*flex/);
  assert.match(presetListRule, /flex-direction:\s*column/);
  assert.doesNotMatch(presetListRule, /grid-template-columns/);
});
