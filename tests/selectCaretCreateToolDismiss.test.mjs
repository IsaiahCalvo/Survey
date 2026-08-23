import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-select-caret-create-tool-dismiss.spec.mjs
// Unique leftover after Survey/Spaces dismiss.
// Select caret page-click dismiss after keyboard-arming a create tool.
// Distinct from leftover-18 / Select caret arm-then-toggle / Style dismiss.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Select caret menu dismisses on capture pointerdown, not swallowed mousedown', () => {
  const shell = read('src/AppShell.jsx');
  const start = shell.indexOf('keyboard-arming Pen/Line while this menu is open');
  assert.notEqual(start, -1);
  const slice = shell.slice(start, start + 1600);
  assert.match(slice, /addEventListener\('pointerdown', onDown, true\)/);
  assert.match(slice, /removeEventListener\('pointerdown', onDown, true\)/);
  assert.doesNotMatch(slice, /addEventListener\('mousedown', onDown, true\)/);
  assert.match(slice, /data-svg-annotation-layer/);
  assert.match(slice, /preventDefault\(\)/);
  assert.match(slice, /stopPropagation\(\)/);
  assert.match(slice, /onPageSurface/);
  assert.match(slice, /data-select-mode-menu/);
  assert.doesNotMatch(slice, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(slice, /setCopyModeActive\(true\)/);
  assert.doesNotMatch(slice, /zoomGeneration/);
});

test('live spec covers Select caret create-tool dismiss intended + break + edge; skip leftover-18 and Survey/Spaces replay', () => {
  const spec = read('debug/scenarios/e2e-select-caret-create-tool-dismiss.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Select caret create-tool dismiss intended \+ break \+ edge/);
  assert.match(spec, /390 Select caret create-tool dismiss edge/);
  assert.match(spec, /click-outside must close Selection Mode after P/);
  assert.match(spec, /click-outside must close Selection Mode after L/);
  assert.match(spec, /Pen-armed dismiss must not start a stroke/);
  assert.match(spec, /Space stays temporary-pan/);
  assert.match(spec, /hubPreview has no Select caret/);
  assert.match(spec, /file\.id must stay null/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Control\+2/);
  assert.doesNotMatch(spec, /click-outside must close template picker/);
  assert.doesNotMatch(spec, /click-outside must close Style/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);
  assert.doesNotMatch(spec, /getByRole\('tab', \{ name: 'Home'/);
  assert.doesNotMatch(spec, /name: 'Close tab'[^;\n]*\.click\(/);

  const surveyDismiss = read('debug/scenarios/e2e-survey-spaces-menu-dismiss.spec.mjs');
  assert.match(surveyDismiss, /click-outside must close template picker/);
  assert.doesNotMatch(surveyDismiss, /click-outside must close Selection Mode after P/);
});
