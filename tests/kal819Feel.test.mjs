// KAL-819: Survey feels smooth (Nightly, the suite look).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveRefitPivotX } from '../src/utils/viewerSideOverlay.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a re-fit pivots on the one point that carries the old page box onto the new one', () => {
  // A panel opens: the page shrinks from 1304 px at x=68 to 984 px at x=388.
  const pivot = resolveRefitPivotX({ fromLeft: 68, fromWidth: 1304, toLeft: 388, toWidth: 984, fallback: 0 });
  const z = 984 / 1304;
  const map = (x) => pivot + (x - pivot) * z;
  assert.ok(Math.abs(map(68) - 388) < 1e-6, 'left edge lands');
  assert.ok(Math.abs(map(68 + 1304) - (388 + 984)) < 1e-6, 'right edge lands');
  // No change in width: no single pivot, so the fallback.
  assert.equal(resolveRefitPivotX({ fromLeft: 0, fromWidth: 500, toLeft: 40, toWidth: 500, fallback: 7 }), 7);
  assert.equal(resolveRefitPivotX({ fromLeft: 0, fromWidth: 0, toLeft: 40, toWidth: 500, fallback: 7 }), 7);
});

test('the band re-fit eases (Nightly) and the left panel stops covering the page as it closes', () => {
  const container = read('../src/components/PdfjsViewerContainer.jsx');
  assert.match(container, /const \[bandRefitGlides\] = useState\(\(\) => isFeatureOn\('one-look'\)\);/);
  assert.match(container, /const flipFromNode = band && bandRefitGlides && !prefersReducedMotion\(\)/);
  assert.match(container, /anchor\.elastic = true;\s*releaseElastic\(\);/);
  const sidebar = read('../src/PDFSidebar.jsx');
  assert.match(sidebar, /\(panelLeavesAtOnce \? !isCollapsed : layoutOpen\) \? 'side' : undefined/);
});

test('hover, press and selected read one timing under the suite look', () => {
  const tokens = read('../src/styles/tokens.css');
  const start = tokens.indexOf('EVEN STATE TIMING');
  assert.ok(start > tokens.indexOf('THE SUITE LOOK'), 'after the suite colour blocks (tests/suiteLook.test.mjs reads the first one)');
  const block = tokens.slice(tokens.indexOf('html[data-look="suite"] {', start), tokens.indexOf('\n}', start));
  assert.match(block, /--state-time: var\(--motion-state\);/);
  assert.match(block, /--state-ease: var\(--ease-out\);/);
  assert.match(block, /--state-all:/);
  // Never a layout property: a hover must not move or resize anything.
  for (const prop of ['width', 'height', 'top', 'left', 'right', 'bottom', 'padding', 'margin', ' all ']) {
    assert.ok(!block.includes(`${prop} var(--motion-state)`), prop);
  }
  // Outside the suite look the old numbers stay (the fallback).
  assert.match(read('../src/home/hub.css'), /transition: background var\(--state-time, 90ms\) var\(--state-ease, ease-out\);/);
});

test('the Home search box shows the focus ring', () => {
  assert.match(read('../src/home/hub.css'), /\.survey-hub \.hub-search:focus-within \{\s*outline: 2px solid var\(--focus\);/);
});

test('a reload draws the window frame before the app code has run', () => {
  const html = read('../index.html');
  assert.match(html, /<div id="root"><div class="boot-frame" aria-hidden="true"><\/div><\/div>/);
  assert.match(html, /html\[data-look="suite"\] \.boot-frame \{[\s\S]{0,120}height: 32px;/);
});
