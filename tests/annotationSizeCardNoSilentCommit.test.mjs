import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/AnnotationSizeControl.jsx', import.meta.url), 'utf8');

test('slider is marked dirty only by a real value change', () => {
  const sets = src.match(/slidingRef\.current = true/g) || [];
  assert.equal(sets.length, 1, 'only onChange may mark the slider dirty');
  const onChange = src.slice(src.indexOf('onChange={(event) => {', src.indexOf('annotation-size-card__slider')));
  assert.match(onChange.slice(0, 200), /slidingRef\.current = true/);
});

test('size fields carry no native title tooltip', () => {
  assert.doesNotMatch(src, /\btitle:\s*label\b/);
});
