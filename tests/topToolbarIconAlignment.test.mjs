import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/Icons.jsx', import.meta.url), 'utf8');

test('top toolbar Draw and Text marks use the shared optical alignment offsets', () => {
  assert.match(source, /drawGroupIconUrl,[\s\S]{0,180}translateY\(-2px\)/);
  assert.match(source, /text: \(size, color, style, className\)[\s\S]{0,220}translateY\(2px\)[\s\S]{0,180}translate\(12 12\) scale\(1\.2\) translate\(-12 -12\)/);
});
