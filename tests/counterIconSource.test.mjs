import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

test('Counter uses the approved supplied pin-and-one asset', async () => {
  const [icon, icons] = await Promise.all([
    read('../src/assets/icons/counter.svg').then(strip),
    read('../src/Icons.jsx'),
  ]);

  assert.match(icons, /import counterIconUrl from '.\/assets\/icons\/counter\.svg'/);
  assert.match(icons, /counter:.*renderMaskIcon\(counterIconUrl,/);
  assert.match(icon, /viewBox="0 0 936 934"/);
  assert.doesNotMatch(icon, /<script|onload\s*=|<!DOCTYPE|<!ENTITY/i);
});

test('Counter removes the export background and cuts the one out of the pin', async () => {
  const icon = strip(await read('../src/assets/icons/counter.svg'));
  assert.match(icon, /<mask id="counter-number-cutout"/);
  assert.match(icon, /mask="url\(#counter-number-cutout\)"/);
  assert.match(icon, /<path[^>]+fill="#000"[^>]+scale\(1\.35\)/);
  assert.doesNotMatch(icon, /<rect[^>]+fill="#fff"[^>]*\/?>\s*<\/svg>/);
});

test('Counter numeral keeps the approved larger scale', async () => {
  const icon = strip(await read('../src/assets/icons/counter.svg'));
  assert.match(icon, /transform="translate\(463\.64 491\.04\) scale\(1\.35\) translate\(-463\.64 -491\.04\)"/);
});
