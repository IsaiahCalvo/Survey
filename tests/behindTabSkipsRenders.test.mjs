// Speed: every open document tab stays mounted, and each AppShell render (a
// tool switch, a zoom step, the front tab's chrome) rendered every tab's
// whole viewer. With the 240-sheet set open behind the sample, ten tool
// switches cost 1,075 ms of script; with a tab behind skipping those renders,
// 854 ms. See /mnt/project-files/perf/speed-round-3.md, Round 15.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { behindTabPropsEqual } from '../src/utils/behindTabProps.js';

const props = (over = {}) => ({ isActive: false, pdfFile: { id: 'a' }, onBack: () => {}, mobileMode: false, ...over });

test('a tab behind with the same props skips the render', () => {
  const p = props();
  assert.equal(behindTabPropsEqual(p, { ...p }), true);
});

test('the front tab always renders, and so does a tab coming to or leaving the front', () => {
  const p = props();
  assert.equal(behindTabPropsEqual({ ...p, isActive: true }, { ...p, isActive: true }), false);
  assert.equal(behindTabPropsEqual(p, { ...p, isActive: true }), false);
  assert.equal(behindTabPropsEqual({ ...p, isActive: true }, p), false);
});

test('a tab behind renders when any prop changes, is added or is removed', () => {
  const p = props();
  assert.equal(behindTabPropsEqual(p, { ...p, pdfFile: { id: 'a' } }), false, 'a new object counts as changed');
  assert.equal(behindTabPropsEqual(p, { ...p, onBack: () => {} }), false, 'a new handler counts as changed');
  assert.equal(behindTabPropsEqual(p, { ...p, documentLocked: true }), false);
  const { mobileMode, ...without } = p;
  assert.equal(behindTabPropsEqual(p, without), false);
});

const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');

test('wiring: the lazy viewer is memo()-wrapped with the behind-tab compare', () => {
  assert.match(shell, /default: memo\(m\.PDFViewer, behindTabPropsEqual\)/);
});

test('every prop AppShell hands the viewer keeps its identity (no inline functions, objects or arrays)', () => {
  const start = shell.indexOf('<PDFViewer\n');
  assert.ok(start > 0);
  const block = shell.slice(start, shell.indexOf('/>', start));
  const values = [...block.matchAll(/(\w+)=\{([^}]*)\}/g)].map(([, key, value]) => [key, value.trim()]);
  assert.ok(values.length > 20, 'found the viewer props');
  for (const [key, value] of values) {
    assert.doesNotMatch(value, /=>|^\{|^\[|function\b/, `${key} is built inline, so a tab behind would render every time`);
  }
  // useTemplates returns a new refetch every render.
  assert.ok(values.some(([key, value]) => key === 'onRefetchTemplates' && value === 'stableRefetchTemplates'));
});
