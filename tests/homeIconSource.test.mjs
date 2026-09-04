import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const iconsSource = await readFile(new URL('../src/Icons.jsx', import.meta.url), 'utf8');

test('Home uses the requested SVG Repo house geometry with theme-aware color', () => {
  assert.match(iconsSource, /CC0 source: https:\/\/www\.svgrepo\.com\/svg\/504469\/house/);
  assert.match(iconsSource, /homeTab: \(size, color, style, className\) => \([\s\S]*?viewBox="0 0 192 192"/);
  assert.match(iconsSource, /d="M41\.733 160\.134v-59\.2H21\.999L96 31\.865l74 69\.067h-19\.733v59\.201H110\.8v-44\.4H81\.2v44\.4z"/);
  assert.match(iconsSource, /stroke=\{color\} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round"/);
});
