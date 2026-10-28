// Owner 2026-10-27 (replacing 2026-10-26's check-check): a mode toggle's Done
// is the edit-list icon with its pen turned into a check, bare like the other
// header icons - not a check on a round disc (the 2026-10-06 look), and never
// an X. Edit -> Done morphs only the pen; the rows stay put.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planMorph, morphFrame } from '../src/utils/iconMorph.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('src/components/SectionIconButton.css');
const component = read('src/components/SectionIconButton.jsx');
const icons = read('src/Icons.jsx');

const ROWS = 'M3 6h18M3 12h9M3 18h5';

test('Done is the edit-list rows with a check where the pen was', () => {
  assert.match(component, /export const SECTION_DONE_ICON = 'editListDone';/);
  const done = /editListDone: \(size, color, style, className\) =>[\s\S]*?<\/svg>/.exec(icons)?.[0] || '';
  const edit = /editList: \(size, color, style, className\) =>[\s\S]*?<\/svg>/.exec(icons)?.[0] || '';
  assert.ok(done.includes(`d="${ROWS}"`) && edit.includes(`d="${ROWS}"`), 'Done keeps the edit icon\'s own rows');
  assert.ok(done.includes('d="M13 17l3 3 5-6"'), 'the check sits where the pen was');
  assert.doesNotMatch(icons, /checkCheck:/, 'the old double check is gone');
});

test('Edit -> Done moves only the pen: the rows stay still through the morph', () => {
  const pairs = planMorph('editList', 'editListDone');
  const still = pairs.filter((p) => p.a.every((pt, k) => Math.hypot(pt[0] - p.b[k][0], pt[1] - p.b[k][1]) < 1e-6));
  assert.equal(still.length, 3, 'all three rows stay put');
  const moving = pairs.filter((p) => !still.includes(p));
  assert.ok(moving.length >= 1, 'the pen becomes the check');
  for (const t of [0.25, 0.5, 0.75]) {
    for (const piece of morphFrame(moving, t)) assert.ok(piece.pts.every(([x, y]) => x >= 1.5 && x <= 22.5 && y >= 1.5 && y <= 22.5));
  }
});

test('every Done glyph in the app is the same one', () => {
  const viewer = read('src/PDFViewer.jsx');
  const phone = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.doesNotMatch(viewer, /name="checkCheck"/);
  assert.match(viewer, /surveyBarFit\.plan\.done === 'glyph' \? <Icon name="editListDone"/);
  assert.match(phone, /<Icon name=\{SECTION_DONE_ICON\}/);
});

test('Done has no disc or plate behind it', () => {
  assert.doesNotMatch(css, /\.section-icon-btn\.is-active[^{]*::before/);
  assert.doesNotMatch(css, /\.section-icon-btn\.is-active[^{]*\{[^}]*background/);
  assert.match(css, /\.section-icon-btn\.is-active \{\s*color: var\(--text-1\);\s*\}/);
});
