import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// Owner 2026-10-14: the Survey Marker's FREEHAND mode shows Lucide "brush"
// (lucide-static v1.57.0) on the desktop tool bar and the phone rail chip and
// menu. Rectangle and Smart fill keep their own glyphs for now (the owner is
// sending custom ones later).
test('the brush glyph is Lucide brush at the house stroke', async () => {
  const icons = await read('../src/Icons.jsx');
  const block = icons.match(/\n {4}brush: \(size, color, style, className\) => \([\s\S]*?\n {4}\),\n/);
  assert.ok(block, 'Icons.jsx defines a brush renderer');
  const glyph = block[0];
  assert.match(glyph, /viewBox="0 0 24 24" fill="none"/);
  assert.match(glyph, /stroke=\{color\} strokeWidth="1\.5" strokeLinecap="round" strokeLinejoin="round"/);
  assert.match(glyph, /d="m11 10 3 3"/);
  assert.match(glyph, /d="M6\.5 21A3\.5 3\.5 0 1 0 3 17\.5a2\.62 2\.62 0 0 1-\.708 1\.792A1 1 0 0 0 3 21z"/);
  assert.match(glyph, /d="M9\.969 17\.031 21\.378 5\.624a1 1 0 0 0-3\.002-3\.002L6\.967 14\.031"/);
  assert.match(icons, /lucide-static v1\.57\.0/);
});

test('freehand marker mode uses the brush icon on desktop and phone', async () => {
  const [desktop, phone] = await Promise.all([
    read('../src/survey/SurveyMarkerModeTools.jsx'),
    read('../src/mobile/MobileSurveyRail.jsx'),
  ]);
  assert.match(desktop, /\{ mode: 'freehand', label: 'Freehand marker', icon: 'brush' \}/);
  assert.match(phone, /\{ mode: 'freehand', label: 'Freehand', icon: 'brush' \}/);
  // Rectangle and Smart fill are unchanged by this pass.
  assert.match(desktop, /\{ mode: 'rectangle', label: 'Rectangle marker', icon: 'rect' \}/);
  assert.match(phone, /\{ mode: 'rectangle', label: 'Rectangle', icon: 'rect' \}/);
  assert.match(phone, /icon: smartFill\.icon \|\| 'paintBucket'/);
  // The Highlighter TOOL keeps its own glyph; only the marker mode moved.
  for (const source of [desktop, phone]) {
    assert.doesNotMatch(source, /mode: 'freehand'[^}]*icon: 'highlighter'/);
  }
});
