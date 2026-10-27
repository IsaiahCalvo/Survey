import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clampNewTextBoxToPage } from '../src/utils/textEditCommit.js';

test('new text box near right/bottom edge is pulled fully onto the page', () => {
  assert.deepEqual(
    clampNewTextBoxToPage({ left: 580, top: 780, width: 160, height: 30, pageWidth: 612, pageHeight: 792 }),
    { left: 452, top: 762 },
  );
});

test('in-page box is unchanged; negative coords pin to 0; oversize pins to 0', () => {
  assert.deepEqual(clampNewTextBoxToPage({ left: 100, top: 50, width: 160, height: 30, pageWidth: 612, pageHeight: 792 }), { left: 100, top: 50 });
  assert.deepEqual(clampNewTextBoxToPage({ left: -10, top: -5, width: 160, height: 30, pageWidth: 612, pageHeight: 792 }), { left: 0, top: 0 });
  assert.deepEqual(clampNewTextBoxToPage({ left: 50, top: 50, width: 900, height: 30, pageWidth: 612, pageHeight: 792 }), { left: 0, top: 50 });
});

test('unknown page size leaves position alone', () => {
  assert.deepEqual(clampNewTextBoxToPage({ left: 700, top: 10, width: 160, height: 30, pageWidth: 0, pageHeight: undefined }), { left: 700, top: 10 });
});

test('phone and desktop share one single-name default font (Helvetica)', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const m = viewer.match(/const base = \{\s*fontColor: '#1e293b',\s*fontFamily: '([^']+)'/);
  assert.ok(m, 'textStyleDefaults initializer not found');
  assert.equal(m[1], 'Helvetica');
  const overlay = readFileSync(new URL('../src/components/TextEditOverlay.jsx', import.meta.url), 'utf8');
  assert.match(overlay, /const DEFAULT_FONT_FAMILY = 'Helvetica';/);
  assert.match(overlay, /clampNewTextBoxToPage\(/);
});

test('a new text box starts plain black and a new callout starts bold, each keeping its own Aa row', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /return \{ text: \{ \.\.\.base, fontColor: '#000000', bold: false \}, callout: base \};/);
  assert.match(viewer, /newTextStyle=\{textStyleDefaultsByTool\.text\}/);
  assert.match(viewer, /bold: textStyleDefaultsByTool\.callout\.bold,/);
  assert.match(viewer, /setTextStyleDefaultsByTool\(\(prev\) => \(\{ \.\.\.prev, \[textStyleTool\]: write\.defaults \}\)\)/);
});
