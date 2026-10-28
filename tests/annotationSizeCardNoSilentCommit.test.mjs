import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/AnnotationSizeControl.jsx', import.meta.url), 'utf8');

test('size fields carry no native title tooltip', () => {
  assert.doesNotMatch(src, /\btitle:\s*label\b/);
});
