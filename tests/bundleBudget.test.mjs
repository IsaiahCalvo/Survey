import test from 'node:test';
import assert from 'node:assert/strict';
import { overBudget, preloadList, staticImports } from '../scripts/bundle-budget.mjs';

test('static imports count, lazy imports do not', () => {
  const source = 'import"./a.js";import{t as e}from"./b.js";export*from"./c.js";const x=()=>import("./lazy.js");';
  assert.deepEqual(staticImports(source), ['./a.js', './b.js', './c.js']);
});

test('the entry preload list is read from Vite\'s map', () => {
  const source = 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./main-1.js","./main-2.css"])))=>i.map(i=>d[i]);';
  assert.deepEqual(preloadList(source), ['./main-1.js', './main-2.css']);
  assert.deepEqual(preloadList('import"./a.js";'), []);
});

test('only a big jump fails: over 10% and over the byte floor', () => {
  const budget = { firstLoadJs: 700_000, firstLoadCss: 60_000, allJs: 4_600_000 };
  assert.deepEqual(overBudget(budget, budget), []);
  // +60 KB first-load JS is under 10% of 700 KB.
  assert.deepEqual(overBudget({ ...budget, firstLoadJs: 760_000 }, budget), []);
  assert.equal(overBudget({ ...budget, firstLoadJs: 800_000 }, budget).length, 1);
  // +15 KB CSS is over both the 10 KB floor and 10%.
  assert.equal(overBudget({ ...budget, firstLoadCss: 75_000 }, budget).length, 1);
  // A tiny budget never fails on a few bytes.
  assert.deepEqual(overBudget({ firstLoadJs: 3000, firstLoadCss: 0, allJs: 0 }, { firstLoadJs: 2000, firstLoadCss: 0, allJs: 0 }), []);
});
