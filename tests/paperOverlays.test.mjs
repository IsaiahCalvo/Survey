// Nightly 'paper-overlays' (Drawboard Projects VT-46): a paper pattern over
// every page, view only, for this sitting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PAPER_LAYER_COUNT,
  PAPER_NONE,
  PAPER_OVERLAY_ATTR,
  PAPER_OVERLAY_GROUPS,
  PAPER_OVERLAY_KINDS,
  applyPaperOverlay,
  getPaperOverlay,
  paperOverlayKind,
  paperOverlayVars,
  setPaperOverlay,
} from '../src/utils/paperOverlays.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('23 kinds in three groups, every name its own, blank first', () => {
  assert.deepEqual(PAPER_OVERLAY_GROUPS.map((g) => g.kinds.length), [5, 15, 3]);
  assert.equal(PAPER_OVERLAY_KINDS.length, 23);
  assert.equal(PAPER_OVERLAY_KINDS[0].id, PAPER_NONE);
  const names = PAPER_OVERLAY_KINDS.map((k) => k.label);
  assert.equal(new Set(names).size, names.length, 'no name shown twice');
  assert.equal(new Set(PAPER_OVERLAY_KINDS.map((k) => k.id)).size, 23);
  assert.ok(!names.some((n) => /cm"/.test(n)), 'no inch mark after cm');
  for (const k of PAPER_OVERLAY_KINDS) assert.ok(k.layers.length <= PAPER_LAYER_COUNT, k.id);
});

test('vars give every layer, blank ones none; numbers stay bare points', () => {
  const blank = paperOverlayVars(PAPER_NONE);
  for (let n = 1; n <= PAPER_LAYER_COUNT; n += 1) assert.equal(blank[`--paper-${n}-img`], 'none');
  const quarter = paperOverlayVars('graph-quarter-in');
  assert.match(quarter['--paper-1-img'], /^url\("data:image\/svg\+xml,/);
  assert.equal(quarter['--paper-1-w'], '72', 'a 1" tile of four 1/4" squares');
  assert.equal(quarter['--paper-1-repeat'], 'repeat');
  assert.equal(quarter['--paper-2-img'], 'none');
  const gregg = paperOverlayVars('gregg');
  assert.equal(gregg['--paper-2-xp'], '50', 'the middle line sits half way across');
  const cornell = paperOverlayVars('cornell');
  assert.equal(cornell['--paper-3-yp'], '100');
  assert.equal(cornell['--paper-3-y'], '-144', 'the summary line 2" up from the bottom');
  assert.equal(paperOverlayKind('nope').id, PAPER_NONE);
});

test('set puts the vars on the root, blank takes them off; nothing is stored', () => {
  const props = new Map();
  const attrs = new Map();
  const root = {
    style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) },
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
  };
  assert.equal(setPaperOverlay('hex-1in', { root }), 'hex-1in');
  assert.equal(getPaperOverlay(), 'hex-1in');
  assert.equal(attrs.get(PAPER_OVERLAY_ATTR), 'hex-1in');
  assert.equal(props.get('--paper-1-repeat'), 'repeat');
  applyPaperOverlay(PAPER_NONE, root);
  assert.equal(attrs.size, 0);
  assert.equal(props.size, 0);
  setPaperOverlay(PAPER_NONE, { root });
  const src = readFileSync(new URL('../src/utils/paperOverlays.js', import.meta.url), 'utf8');
  assert.ok(!/localStorage|sessionStorage/.test(src), 'a view setting for this sitting only');
});

test('CSS paints under the marks, hides in print; flag is beta with a migration', () => {
  const css = readFileSync(new URL('../src/styles/paperOverlays.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-paper-overlay\] \.survey-pdfjs-page-div > \.survey-pdfjs-page-canvas \+ div::before/);
  assert.match(css, /@media print[\s\S]*display: none/);
  assert.match(css, /var\(--survey-page-scale, 1\)/);
  assert.equal(FEATURE_FLAGS['paper-overlays'].stage, 'rollout');
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /isFeatureOn\('paper-overlays'\)/);
  const migration = readFileSync(new URL('../supabase/migrations/20261116020000_paper_overlays_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'paper-overlays', 'off'/);
});
