import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-pages-context-menu-dismiss.spec.mjs
// Unique leftover after Style/Width dismiss.
// Pages context page-click dismiss while a creation tool is armed.
// Distinct from leftover-18 / Style dismiss / Fit dismiss / Select caret.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Pages context dismisses on capture pointerdown, not swallowed mousedown', () => {
  const panel = read('src/sidebar/PagesPanel.jsx');
  const start = panel.indexOf('Close context menu when clicking outside');
  assert.notEqual(start, -1);
  const slice = panel.slice(start, start + 1800);
  assert.match(slice, /addEventListener\('pointerdown', handleClickOutside, true\)/);
  assert.match(slice, /removeEventListener\('pointerdown', handleClickOutside, true\)/);
  assert.doesNotMatch(slice, /addEventListener\('mousedown', handleClickOutside\)/);
  assert.match(slice, /data-svg-annotation-layer/);
  assert.match(slice, /preventDefault\(\)/);
  assert.match(slice, /stopPropagation\(\)/);
  assert.match(slice, /onPageSurface/);
  assert.doesNotMatch(slice, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(slice, /setCopyModeActive\(true\)/);
  assert.doesNotMatch(slice, /zoomGeneration/);
  assert.match(panel, /data-pages-context-menu="true"/);
});

test('annotation context dismisses on capture pointerdown, not swallowed mousedown', () => {
  const hook = read('src/hooks/useAnnotationContextMenu.jsx');
  const start = hook.indexOf('Dismiss the annotation context menu on outside click');
  assert.notEqual(start, -1);
  const slice = hook.slice(start, start + 2200);
  assert.match(slice, /addEventListener\('pointerdown', close, true\)/);
  assert.match(slice, /removeEventListener\('pointerdown', close, true\)/);
  assert.doesNotMatch(slice, /addEventListener\('mousedown', close, true\)/);
  assert.match(slice, /data-svg-annotation-layer/);
  assert.match(slice, /onPageSurface/);
  assert.doesNotMatch(slice, /zoomGeneration/);
});

test('live spec covers Pages context dismiss intended + break + edge; skip leftover-18 and Style/Fit replay', () => {
  const spec = read('debug/scenarios/e2e-pages-context-menu-dismiss.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Pages context dismiss intended \+ break \+ edge/);
  assert.match(spec, /390 Pages context dismiss edge/);
  assert.match(spec, /click-outside must close Pages context/);
  assert.match(spec, /Pages dismiss must not start a rubber-band/);
  assert.match(spec, /Space stays temporary-pan/);
  assert.match(spec, /hubPreview has no Pages/);
  assert.match(spec, /file\.id must stay null/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Control\+2/);
  assert.doesNotMatch(spec, /Fit options menu must close/);
  assert.doesNotMatch(spec, /click-outside must close Style/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);
  assert.doesNotMatch(spec, /getByRole\('tab', \{ name: 'Home'/);
  assert.doesNotMatch(spec, /name: 'Close tab'[^;\n]*\.click\(/);

  const styleDismiss = read('debug/scenarios/e2e-style-width-menu-dismiss.spec.mjs');
  assert.match(styleDismiss, /click-outside must close Style/);
  assert.doesNotMatch(styleDismiss, /click-outside must close Pages context/);
});
