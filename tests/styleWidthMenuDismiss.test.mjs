import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-style-width-menu-dismiss.spec.mjs
// Unique leftover after Fit-options dismiss.
// Style / Width page-click dismiss while a creation tool is armed.
// Distinct from leftover-18 / Fit apply / Fit dismiss / Select caret arm.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('formatting exclusive layer dismisses on capture pointerdown, not swallowed mousedown', () => {
  const shell = read('src/AppShell.jsx');
  const start = shell.indexOf('Formatting popovers share one exclusive layer');
  assert.notEqual(start, -1);
  const slice = shell.slice(start, start + 2800);
  assert.match(slice, /addEventListener\('pointerdown', onDown, true\)/);
  assert.match(slice, /removeEventListener\('pointerdown', onDown, true\)/);
  assert.doesNotMatch(slice, /addEventListener\('mousedown', onDown, true\)/);
  assert.match(slice, /data-svg-annotation-layer/);
  assert.match(slice, /preventDefault\(\)/);
  assert.match(slice, /stopPropagation\(\)/);
  assert.match(slice, /onPageSurface/);
  assert.doesNotMatch(slice, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(slice, /setCopyModeActive\(true\)/);
  assert.doesNotMatch(slice, /zoomGeneration/);

  assert.match(shell, /dataMarker="data-style-menu"/);
  const size = read('src/components/AnnotationSizeControl.jsx');
  assert.match(size, /data-annotation-size-popover/);
});

test('live spec covers Style / Width dismiss intended + break + edge; skip leftover-18 and Fit replay', () => {
  const spec = read('debug/scenarios/e2e-style-width-menu-dismiss.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Style \/ Width menu dismiss intended \+ break \+ edge/);
  assert.match(spec, /390 Style dismiss edge/);
  assert.match(spec, /click-outside must close Style/);
  assert.match(spec, /click-outside must close Width presets/);
  assert.match(spec, /Style dismiss must not start a rubber-band/);
  assert.match(spec, /Space on Style stays temporary-pan/);
  assert.match(spec, /hubPreview has no Style/);
  assert.match(spec, /file\.id must stay null/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Control\+2/);
  assert.doesNotMatch(spec, /Fit options menu must close/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);
  assert.doesNotMatch(spec, /getByRole\('tab', \{ name: 'Home'/);
  assert.doesNotMatch(spec, /name: 'Close tab'[^;\n]*\.click\(/);

  const fitDismiss = read('debug/scenarios/e2e-fit-options-menu-dismiss.spec.mjs');
  assert.match(fitDismiss, /click-outside must close Fit options/);
  assert.doesNotMatch(fitDismiss, /click-outside must close Style/);
});
