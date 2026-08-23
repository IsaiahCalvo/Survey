import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Official leftover after Select caret create-tool dismiss.
// annotationFormattingPopoverContract still required exclusive-layer mousedown
// after Style/Width product SHA switched that layer to capture pointerdown.
// Distinct from leftover-18 / dismiss-family replay / 8448.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official exclusive-layer contract matches live capture pointerdown', () => {
  const official = read('tests/annotationFormattingPopoverContract.test.mjs');
  assert.match(official, /document\\.addEventListener\\\('pointerdown', onDown, true\\\)/);
  assert.match(official, /document\\.removeEventListener\\\('pointerdown', onDown, true\\\)/);
  assert.match(official, /document\\.addEventListener\\\('mousedown', onDown, true\\\)/);
  assert.match(official, /doesNotMatch\(/);
  assert.match(official, /capture pointerdown before the page layer swallows mousedown/);
  assert.doesNotMatch(official, /dismissal must run in capture phase before toolbar triggers stop propagation/);

  const shell = read('src/AppShell.jsx');
  const start = shell.indexOf('Formatting popovers share one exclusive layer');
  assert.notEqual(start, -1);
  const slice = shell.slice(start, start + 2800);
  assert.match(slice, /addEventListener\('pointerdown', onDown, true\)/);
  assert.doesNotMatch(slice, /addEventListener\('mousedown', onDown, true\)/);
  assert.match(slice, /onPageSurface/);
  assert.match(slice, /preventDefault\(\)/);
  assert.doesNotMatch(slice, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(slice, /zoomGeneration/);
});

test('live hunt goes beyond Select caret dismiss and skips leftover-18 / dismiss replay', () => {
  const hunt = read('debug/scenarios/e2e-after-select-caret-independent-hunt.spec.mjs');
  assert.match(hunt, /testPdf=clickable-link-test\.pdf/);
  assert.match(hunt, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(hunt, /testPdf=kal441-form-fields\.pdf/);
  assert.match(hunt, /testPdf=e2e-sticky-note\.pdf/);
  assert.match(hunt, /hubPreview=1/);
  assert.match(hunt, /AFTER_SELECT_CARET_INDEPENDENT_HUNT/);
  assert.match(hunt, /Match case/);
  assert.match(hunt, /Whole word/);
  assert.match(hunt, /highlighterCaret/);
  assert.match(hunt, /formsButton/);
  assert.match(hunt, /noteButton/);
  assert.doesNotMatch(hunt, /file\.id\s*=/);
  assert.doesNotMatch(hunt, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(hunt, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(hunt, /selectMenuAfterPenPageClick/);
  assert.doesNotMatch(hunt, /click-outside must close Style/);
  assert.doesNotMatch(hunt, /click-outside must close Selection Mode after P/);
  assert.doesNotMatch(hunt, /viewBox `0 0 792 612`/);
  assert.doesNotMatch(hunt, /rotatePageSpaceInk|page-rotate-remap/);
  assert.doesNotMatch(hunt, /handleTabClick/);
  assert.doesNotMatch(hunt, /name: 'Close tab'[^;\n]*\.click\(/);

  const prior = read('debug/scenarios/e2e-after-survey-spaces-independent-hunt.spec.mjs');
  assert.match(prior, /AFTER_SURVEY_SPACES_INDEPENDENT_HUNT/);
  assert.doesNotMatch(prior, /testPdf=kal441-form-fields\.pdf/);
  assert.doesNotMatch(prior, /testPdf=e2e-sticky-note\.pdf/);
});
