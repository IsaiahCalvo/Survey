import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-survey-spaces-menu-dismiss.spec.mjs
// Unique leftover after Pages context dismiss.
// Survey / Spaces page-click dismiss while a creation tool is armed.
// Distinct from leftover-18 / template re-pick apply / module Next-Prev /
// Style dismiss / Pages dismiss / Space CSV-PDF apply.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Survey rail menus dismiss on capture pointerdown, not swallowed mousedown', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const helperStart = rail.indexOf('dismissOnOutsidePageAwarePointerDown');
  assert.notEqual(helperStart, -1);
  const helper = rail.slice(helperStart, helperStart + 900);
  assert.match(helper, /data-svg-annotation-layer/);
  assert.match(helper, /preventDefault\(\)/);
  assert.match(helper, /stopPropagation\(\)/);
  assert.match(helper, /onPageSurface/);
  assert.doesNotMatch(helper, /zoomGeneration/);

  assert.match(rail, /addEventListener\('pointerdown', handlePointerDown, true\)/);
  assert.match(rail, /addEventListener\('pointerdown', closeEntityDropdown, true\)/);
  assert.doesNotMatch(rail, /addEventListener\('mousedown'/);
  assert.match(rail, /aria-label="Choose survey module"/);
  assert.doesNotMatch(rail, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(rail, /setCopyModeActive\(true\)/);
});

test('Spaces export menu dismisses on capture pointerdown, not swallowed mousedown', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const start = panel.indexOf('if (!isSpacesExportMenuOpen)');
  assert.notEqual(start, -1);
  const slice = panel.slice(start, start + 1800);
  assert.match(slice, /addEventListener\('pointerdown', handleOutsideClick, true\)/);
  assert.match(slice, /removeEventListener\('pointerdown', handleOutsideClick, true\)/);
  assert.doesNotMatch(slice, /addEventListener\('mousedown', handleOutsideClick\)/);
  assert.match(slice, /data-svg-annotation-layer/);
  assert.match(slice, /preventDefault\(\)/);
  assert.match(slice, /stopPropagation\(\)/);
  assert.match(slice, /onPageSurface/);
  assert.match(slice, /Do not apply CSV \/ PDF Pages here/);
  assert.doesNotMatch(slice, /zoomGeneration/);
});

test('live spec covers Survey / Spaces dismiss intended + break + edge; skip leftover-18 and Pages/Style replay', () => {
  const spec = read('debug/scenarios/e2e-survey-spaces-menu-dismiss.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf&surveyTransitionE2E=1/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf&surveyTransitionE2E=1/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Survey \/ Spaces menu dismiss intended \+ break \+ edge/);
  assert.match(spec, /390 Survey \/ Spaces menu dismiss edge/);
  assert.match(spec, /click-outside must close template picker/);
  assert.match(spec, /click-outside must close module picker/);
  assert.match(spec, /click-outside must close Spaces export/);
  assert.match(spec, /template dismiss must not start a rubber-band/);
  assert.match(spec, /Space stays temporary-pan/);
  assert.match(spec, /hubPreview has no Survey/);
  assert.match(spec, /file\.id must stay null/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /Control\+2/);
  assert.doesNotMatch(spec, /click-outside must close Pages context/);
  assert.doesNotMatch(spec, /click-outside must close Style/);
  assert.doesNotMatch(spec, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|page-rotate-remap/);
  assert.doesNotMatch(spec, /getByRole\('tab', \{ name: 'Home'/);
  assert.doesNotMatch(spec, /name: 'Close tab'[^;\n]*\.click\(/);
  assert.doesNotMatch(spec, /getByRole\('button', \{ name: 'CSV'[^;\n]*\.click\(/);
  assert.doesNotMatch(spec, /PDF Pages'[^;\n]*\.click\(/);

  const pagesDismiss = read('debug/scenarios/e2e-pages-context-menu-dismiss.spec.mjs');
  assert.match(pagesDismiss, /click-outside must close Pages context/);
  assert.doesNotMatch(pagesDismiss, /click-outside must close template picker/);
});
