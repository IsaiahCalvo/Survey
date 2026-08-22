import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { coercePageNumber } from '../src/utils/bookmarkPageIds.js';

// Source contracts for UL-07 page-number field (intended + break + edge).
// Live proof: debug/scenarios/e2e-page-number-field.spec.mjs
// Distinct from V-05 keyboard, V-06 thumbnail click, UL-06 Zoom %, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('rail page number field strips letters, rejects out of range, Escape skips blur-commit', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const skipPageInputCommitRef = useRef\(false\)/);
  assert.match(viewer, /const digitsOnly = e\.target\.value\.replace/);
  assert.match(viewer, /const commitPageInput = useCallback\(\(liveValue\) =>/);
  assert.match(viewer, /const fromDom = pageInputRef\.current/);
  assert.match(viewer, /const raw = fromDom != null \? fromDom : \(liveValue != null \? liveValue : pageInputValue\)/);
  assert.match(viewer, /if \(!isNaN\(value\) && value >= 1 && value <= numPages\)/);
  assert.match(viewer, /goToPage\(value\)/);
  assert.match(viewer, /setPageInputValue\(String\(pageNum\)\)/);
  assert.match(viewer, /commitPageInput\(e\.currentTarget\?\.value\)/);
  assert.match(viewer, /skipPageInputCommitRef\.current = true/);
  assert.match(viewer, /if \(skipPageInputCommitRef\.current\)/);
  assert.match(viewer, /commitPageInput\(e\?\.target\?\.value\)/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /aria-label="Current page"/);
  assert.match(shell, /aria-label="Edit page number"/);
  assert.match(shell, /if \(e\.key === 'Enter' \|\| e\.key === 'Escape'\) setIsEditingRailPage\(false\)/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /aria-label="Page number"/);
  assert.match(mobile, /aria-label="Jump to page"/);
  assert.match(mobile, /handlePageInputKeyDown/);
  assert.match(mobile, /handlePageInputBlur/);

  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.doesNotMatch(overlay, /Page number/);
  assert.match(overlay, /description: 'Previous\/Next page'/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('coercePageNumber rejects 0 / over-max / letters and keeps 1…max', () => {
  assert.equal(coercePageNumber(8, 120), 8);
  assert.equal(coercePageNumber('12', 120), 12);
  assert.equal(coercePageNumber(1, 1), 1);
  assert.equal(coercePageNumber(0, 120), null);
  assert.equal(coercePageNumber(121, 120), null);
  assert.equal(coercePageNumber(99, 1), null);
  assert.equal(coercePageNumber('', 120), null);
  assert.equal(coercePageNumber('abc', 120), null);
  assert.equal(coercePageNumber(-3, 120), null);
});

test('live spec covers intended + clamp + Escape + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-page-number-field.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /typed 8 must commit page 8/);
  assert.match(spec, /click-away blur must commit page 12/);
  assert.match(spec, /0 must restore page 12/);
  assert.match(spec, /121 must restore page 12/);
  assert.match(spec, /empty Enter must restore page 12/);
  assert.match(spec, /letters must restore page 12/);
  assert.match(spec, /Escape must restore page 1 and not commit 8/);
  assert.match(spec, /append without select-all/);
  assert.match(spec, /page-1 rect must survive page jump/);
  assert.match(spec, /Pen-armed 3 must commit/);
  assert.match(spec, /1-page 0 must stay 1/);
  assert.match(spec, /1-page 99 must stay 1/);
  assert.match(spec, /390 typed 8 must commit page 8/);
  assert.match(spec, /390 Escape must restore page 8 and not commit 12/);
  assert.match(spec, /hubPreview/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
