import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { coercePageNumber } from '../src/utils/bookmarkPageIds.js';

// Source contracts for V-05 page-nav keyboard (intended + break + edge).
// Live proof: debug/scenarios/e2e-page-nav-keyboard.spec.mjs
// Distinct from V-06 thumbnail click, UL-07 page input, Fit height,
// mobile page input, and leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('goToPage rejects out-of-range pages; overlay lists Home/End and arrows', () => {
  assert.equal(coercePageNumber(1, 120), 1);
  assert.equal(coercePageNumber(120, 120), 120);
  assert.equal(coercePageNumber(2, 120), 2);
  assert.equal(coercePageNumber(0, 120), null);
  assert.equal(coercePageNumber(-1, 120), null);
  assert.equal(coercePageNumber(121, 120), null);
  assert.equal(coercePageNumber(2, 1), null);
  assert.equal(coercePageNumber(1, 1), 1);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /Previous\/Next page/);
  assert.match(overlay, /First page/);
  assert.match(overlay, /Last page/);
  assert.match(overlay, /keys: \['Home'\]/);
  assert.match(overlay, /keys: \['End'\]/);
  assert.match(overlay, /keys: \['←', '→'\]/);
});

test('viewer window listener maps ←/→ Home/End and skips form fields', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /e\.key === 'Home' && !isFormField/);
  assert.match(viewer, /goToPage\(1\)/);
  assert.match(viewer, /e\.key === 'End' && !isFormField/);
  assert.match(viewer, /goToPage\(numPages \|\| 1\)/);
  assert.match(viewer, /e\.key === 'ArrowLeft' && !isFormField/);
  assert.match(viewer, /goToPreviousPage\(\)/);
  assert.match(viewer, /e\.key === 'ArrowRight' && !isFormField/);
  assert.match(viewer, /goToNextPage\(\)/);
  assert.match(viewer, /activeElement\.tagName === 'INPUT'/);
  assert.match(viewer, /activeElement\.tagName === 'TEXTAREA'/);
  assert.match(viewer, /goToPage\(pageNum - 1, \{ fallback: 'previous' \}\)/);
  assert.match(viewer, /goToPage\(pageNum \+ 1, \{ fallback: 'next' \}\)/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers intended + first/last clamp + INPUT steal + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-page-nav-keyboard.spec.mjs');
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /ArrowRight must move a page/);
  assert.match(spec, /ArrowLeft must move a page/);
  assert.match(spec, /End must jump to last page/);
  assert.match(spec, /Home must jump to first page/);
  assert.match(spec, /ArrowLeft on first page must no-op/);
  assert.match(spec, /Home on first page must no-op/);
  assert.match(spec, /ArrowRight on last page must clamp/);
  assert.match(spec, /End on last page must clamp/);
  assert.match(spec, /page INPUT chords must not steal/);
  assert.match(spec, /zoom INPUT chords must not steal/);
  assert.match(spec, /page-1 rect must survive End\/Home/);
  assert.match(spec, /1-page ArrowRight must stay 1/);
  assert.match(spec, /1-page End must stay 1/);
  assert.match(spec, /390 ArrowRight must move a page/);
  assert.match(spec, /390 End must jump to last page/);
  assert.match(spec, /390 page INPUT chords must not steal/);
  assert.match(spec, /hubPreview/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
