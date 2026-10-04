import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import useStableHandler from '../src/hooks/useStableHandler.js';

test('useStableHandler returns one function identity that forwards its arguments', () => {
  const seen = [];
  let stable = null;
  function Probe({ tag }) {
    const fn = useStableHandler((x) => { seen.push([tag, x]); return tag; });
    stable = fn;
    return null;
  }
  renderToStaticMarkup(createElement(Probe, { tag: 'a' }));
  assert.equal(typeof stable, 'function');
  // The server renderer runs no effects, so the first handler is what it calls.
  assert.equal(stable(1), 'a');
  assert.deepEqual(seen, [['a', 1]]);
});

const appShell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');

test('AppShell keeps the hidden home screen and tab strip memoised with stable handlers', () => {
  assert.match(appShell, /const MemoDashboard = memo\(Dashboard\)/);
  assert.match(appShell, /<MemoDashboard[\s\S]{0,120}onDocumentSelect=\{stableDocumentSelect\}[\s\S]{0,40}onBack=\{stableBack\}/);
  assert.match(appShell, /onShowAuthModal=\{stableShowAuthModal\}/);
  assert.match(appShell, /<MemoTabBar[\s\S]{0,200}onTabClick=\{stableTabClick\}/);
  assert.match(appShell, /const SurveySpacesRail = memo\(SurveySpacesRailChunk\.Component\)/);
  assert.match(appShell, /onCollapseChange=\{handleRightRailCollapseChange\}/);
});
