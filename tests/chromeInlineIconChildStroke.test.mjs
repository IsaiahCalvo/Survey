import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { HOUSE_STROKE, stripComments } from './helpers/inlineIconStrokes.mjs';

/*
 * ADVERSARIAL VERIFICATION, 2026-09-16 (verify-r3-desktop), fixed 2026-09-16
 * (r4-desktop), LIST RETIRED 2026-09-16 (r5-icons).
 *
 * Owner ruling: ONE icon set, one stroke weight — the house 1.5 on the 24 grid.
 *
 * tests/chromeInlineIconConsistency.test.mjs already guarded chrome that draws an
 * icon with a hand-written inline <svg>. It had two holes, and a real defect
 * lived in each of them:
 *
 *   1. Its parser read `strokeWidth` only off the <svg> OPENING TAG. An inline
 *      icon that put the weight on its <path> (which is how most of them are
 *      written) was skipped entirely.
 *   2. Its file list did not include src/components/TextEditOverlay.jsx, which
 *      is where the ux-polish pass ADDED two new chrome glyphs.
 *
 * Measured live in the Browser pane, desktop 1440x900, claude/ux-polish at
 * 4d0c3b0d5, real PDF open, text editor opened with a real drag on the
 * text-creation surface:
 *
 *   "Discard changes" (the cross) ... 12px box, viewBox 0 0 12 12,
 *                                     stroke 1.8  = 3.6 house units  (240% of 1.5)
 *   "Keep text"       (the tick) .... 13px box, viewBox 0 0 12 12,
 *                                     stroke 1.9  = 3.8 house units  (253% of 1.5)
 *   every chrome glyph beside them .. 1.5 house units
 *
 * The pair did not even match itself: two different boxes (12 and 13) and two
 * different weights (1.8 and 1.9) on one matched tick/cross. And in the Survey
 * spaces rail, the group-expand chevron drew stroke 2.5 on the 24 grid (167% of
 * the house weight) from path data BYTE-IDENTICAL to the shared
 * <Icon name="chevronDown" /> the Width and Line-style dropdowns render at 1.5 —
 * so the same chevron painted at two weights in one app.
 *
 * THE FIX (r4-desktop): all three glyphs were deleted and replaced with the
 * shared <Icon> — 'close' and 'check' at one 12px box for the pair, 'chevronDown'
 * at 14px in the rail. Nothing is hand-drawn in either file any more.
 *
 * RULED DECISION 1 (r4-desktop) — why the assertions below are not the ones this
 * file shipped with. It shipped asserting (a) `checked >= 3`, that the parser had
 * found at least three inline glyphs to measure, and (b) that the inline
 * <svg width/height> pairs in TextEditOverlay.jsx were all "12x12". Both
 * assertions described the broken tree: they can only hold while the glyphs are
 * still hand-drawn, and the fix the file itself demanded is to stop hand-drawing
 * them. Asserting on inline <svg> in these files would now be an assertion that
 * they must keep their bespoke glyphs, which is the opposite of the ruling. So
 * each assertion follows its glyph: (a) becomes "these two files hand-draw no
 * glyph at all", the stronger statement, and (b) becomes "the tick and the cross
 * are shared icons at ONE box size".
 *
 * RULED DECISION 2 (r5-icons) — the FIXED_FILES weight scan is gone. It asked the
 * house-weight question of two named files through the shared helper, which is
 * exactly what tests/chromeInlineIconWholeTree.test.mjs now asks of every .jsx
 * under src/, these two included. verify-r4-final proved a two-file list is not
 * worth keeping: eight glyphs in five files were off the weight, and the list
 * named none of them. Two copies of one question, one of them narrower, is not
 * two guards.
 *
 * What is left is everything the whole-tree walk CANNOT say, and only that. The
 * walk measures weights; it does not know that these two files were fixed by
 * DELETING their glyphs rather than retuning them, that the tick and the cross
 * are a matched pair that must share one size, or that one particular path string
 * is the shared chevron's. Those are per-defect facts, so they are asserted
 * against the files they are facts about, by name, rather than through a list
 * that pretends to be coverage.
 */

const readSource = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('the two files that hand-drew glyphs draw none', async () => {
  // The three offenders here were all fixed by DELETING the inline <svg>, not by
  // retuning its numbers. So the regression guard is the absence: an inline <svg>
  // reappearing in either file is a glyph that escaped the shared set again, and
  // the whole-tree walk would wave a correctly-weighted one through.
  const strays = [];
  for (const file of ['src/components/TextEditOverlay.jsx', 'src/SurveySpacesRail.jsx']) {
    const source = stripComments(await readSource(file));
    for (const match of source.matchAll(/<svg\b/g)) {
      strays.push(`${file}:${source.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(
    strays,
    [],
    `hand-written inline <svg> back in chrome that was moved to <Icon>: ${strays.join(', ')}`,
  );
});

test('the text editor tick and cross are one shared glyph at one size', async () => {
  // A matched pair. They are the two most prominent chrome glyphs on the page
  // while a text box is open, and they sit side by side 8px apart, so any
  // difference between them reads immediately. They shipped at 12px and 13px.
  const source = await readSource('src/components/TextEditOverlay.jsx');
  const icons = [...source.matchAll(/<Icon\s+name="(check|close)"\s+size=\{([^}]+)\}/g)]
    .map((match) => ({ name: match[1], size: match[2].trim() }));
  assert.deepEqual(
    icons.map((icon) => icon.name).sort(),
    ['check', 'close'],
    'the tick and the cross must both come from the shared Icon set',
  );
  assert.equal(
    new Set(icons.map((icon) => icon.size)).size,
    1,
    `the tick and the cross must be drawn at one size, found ${icons.map((i) => i.size).join(', ')}`,
  );
  // One named constant, so the pair cannot drift apart by a stray edit to one of
  // the two call sites.
  // RULED 2026-09-23 (owner: smaller tick/cross, clear of the box): 10px glyph.
  assert.match(source, /const ACTION_GLYPH_SIZE = 10;/);
  assert.equal(icons[0].size, 'ACTION_GLYPH_SIZE');
});

test('the shared chevron in the spaces rail is the shared Icon', async () => {
  const source = await readSource('src/SurveySpacesRail.jsx');
  assert.match(source, /<Icon name="chevronDown" size=\{14\}/);
  assert.doesNotMatch(
    stripComments(source),
    /M6 9L12 15L18 9/,
    `the rail must not redraw the shared chevron's path at its own weight (house ${HOUSE_STROKE})`,
  );
});

test('the shared chevron path belongs to src/Icons.jsx and nowhere else', async () => {
  // The r4 pass fixed this path in SurveySpacesRail and verify-r4-final found it
  // again, byte for byte, in RegionSelectionTool at a heavier weight. Both render
  // <Icon> now. A third copy at the RIGHT weight would be invisible to the
  // whole-tree weight walk and still be a second chevron to maintain, so the
  // copies are counted across the tree, not just measured.
  const { readdir } = await import('node:fs/promises');
  const src = new URL('../src/', import.meta.url);
  const walk = async (dir, prefix = '') => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) out.push(...await walk(new URL(`${entry.name}/`, dir), rel));
      else if (/\.(jsx?|css)$/.test(entry.name)) out.push(rel);
    }
    return out;
  };
  const files = await walk(src);
  assert.ok(files.length > 100, `the walk found only ${files.length} files - it is not walking src/`);

  const copies = [];
  for (const file of files) {
    const source = stripComments(await readFile(new URL(file, src), 'utf8'));
    for (const match of source.matchAll(/M6 9L12 15L18 9/g)) {
      copies.push(`src/${file}:${source.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(
    copies.length,
    1,
    `the set holds exactly one chevronDown; found ${copies.length}: ${copies.join(', ')}`,
  );
  assert.match(copies[0], /^src\/Icons\.jsx:/, `the one copy must be the shared set's, not ${copies[0]}`);
});
