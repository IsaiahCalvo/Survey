// Owner 2026-11-03: a page and its saved marks show in the same frame. The
// pages hold (blank sheets) only while the document's marks are unknown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shouldHoldPagesForMarks } from '../src/utils/pageMarksHold.js';

const doc = 'doc-1';
const hold = (hydration, extra = {}) => shouldHoldPagesForMarks({ storeEnabled: true, documentId: doc, hydration, ...extra });

test('pages hold while the store has painted nothing for this document', () => {
  assert.equal(hold({ ready: false, source: 'pending', documentId: doc }), true);
  assert.equal(hold({ ready: true, source: 'annotation-doc', documentId: 'other' }), true, 'another document\'s state');
  assert.equal(hold(null), true);
});

test('the hold ends at the first paint, the open, a failed open, marks already shown, or the time limit', () => {
  assert.equal(hold({ ready: false, source: 'preview', documentId: doc }), false);
  assert.equal(hold({ ready: true, source: 'annotation-doc', documentId: doc }), false);
  assert.equal(hold({ ready: false, source: 'unavailable', documentId: doc }), false);
  assert.equal(hold({ ready: false, source: 'pending', documentId: doc }, { viewerShowsMarks: true }), false);
  assert.equal(hold({ ready: false, source: 'pending', documentId: doc }, { expired: true }), false);
});

test('a document without the store never holds', () => {
  assert.equal(shouldHoldPagesForMarks({ storeEnabled: false, documentId: doc, hydration: null }), false);
  assert.equal(shouldHoldPagesForMarks({ storeEnabled: true, documentId: null, hydration: null }), false);
});

test('every mark of a page mounts in one frame (no staged reveal)', () => {
  const layer = fs.readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /const stagedAnnotations = filteredAnnotations;/);
  assert.doesNotMatch(layer, /REVEAL_STEP|setRevealCount/);
});

test('the marks overlay waits for the page bitmap, and the hold hides only the drawing', () => {
  const css = fs.readFileSync(new URL('../src/styles/pageReveal.css', import.meta.url), 'utf8');
  assert.match(css, /\.survey-pdfjs-page-div:not\(\[data-raster-shown\]\) > \[data-pdfjs-page-overlay-host\]\s*\{\s*opacity: 0;/);
  assert.match(css, /\[data-hold-pages="true"\] \.survey-pdfjs-page-div > :not\(\[data-pdfjs-page-overlay-host\]\)\s*\{\s*opacity: 0;/);
});
