import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HOUSE_STROKE, offHouseWeight } from './helpers/inlineIconStrokes.mjs';

/*
 * ADVERSARIAL VERIFICATION, 2026-09-16 (verify-r4-final). THIS TEST FAILS ON
 * claude/ux-polish @ 4304f1f52. It is committed failing on purpose.
 *
 * The r4 desktop pass claims: "every chrome SVG in the live desktop DOM paints
 * at the house 1.5 stroke on the 24 grid". Both existing guards
 * (chromeInlineIconConsistency, chromeInlineIconChildStroke) ask that question
 * of a HAND-WRITTEN LIST of six files. The list is the hole: the same defect the
 * pass fixed in src/SurveySpacesRail.jsx is still live one file over.
 *
 * MEASURED IN THE LIVE DESKTOP DOM, Browser pane at 1440x900, real PDF open,
 * Survey > Spaces > a space with page 1 > Region 1 > "Edit region areas on the
 * page", reading getComputedStyle().strokeWidth off every painted child of every
 * <svg> outside the page host and normalising onto the 24 grid:
 *
 *   { grid: 24, strokeWidth: 2.5, units: 2.5, box: "14x14", at: "716,850",
 *     d: "M6 9L12 15L18 9", label: "Rectangular" }
 *
 * That is the region-selection toolbar's Rectangular/Freehand dropdown chevron,
 * src/RegionSelectionTool.jsx:2775. 2.5 house units is 167% of the house 1.5,
 * and its path data is BYTE-IDENTICAL to the shared <Icon name="chevronDown" />
 * the Width and Line-style dropdowns render at 1.5 - word for word the defect
 * commit aa5c1f835 removed from the spaces rail.
 *
 * chromeInlineIconChildStroke already asserts
 *     doesNotMatch(source, /M6 9L12 15L18 9/)
 * but only against src/SurveySpacesRail.jsx.
 *
 * So this file stops maintaining a list. It walks every .jsx under src/ and
 * measures whatever hand-writes an inline <svg>, with a narrow, documented
 * exemption for files that draw PDF CONTENT or annotation ink rather than
 * chrome - their stroke weight is the user's, not the icon set's.
 *
 * TO MAKE IT PASS: move each offender to the shared <Icon>, or draw it at the
 * house weight. Do NOT widen EXEMPT to silence a chrome glyph.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/*
 * These draw the document, not the chrome: annotation ink, selection marquees,
 * eraser trails, collaborator outlines, search highlights and the dev/prototype
 * harnesses. Their stroke widths are page geometry and have nothing to do with
 * the icon set. src/Icons.jsx is the set itself and is guarded by
 * tests/iconSetConsistency.test.mjs.
 */
const EXEMPT = new Set([
  'Icons.jsx',
  'components/FabricEraserCanvas.jsx',
  'components/SVGAnnotationLayer.jsx',
  'components/SVGSelectionOverlay.jsx',
  'components/SearchHighlightLayer.jsx',
  'components/collab/CollaboratorOutlineOverlay.jsx',
  'SpaceRegionOverlay.jsx',
  'dev/EraserTwoClientRaceHarness.jsx',
  'prototype/AtomicEraseHarness.jsx',
  'prototype/InteractiveOverlay.jsx',
]);

/*
 * SMALL STATE GLYPHS, added 2026-09-21. Not an exemption for a file — an
 * allowance for three specific path shapes, wherever they appear, and nothing
 * else in those files is waved through.
 *
 * RULING: DESIGN-SYSTEM.md, the size contract behind the approved pass-7
 * boards, says "use 1.5px strokes ... UNLESS the source icon needs another
 * weight" and "use inline SVG for small state glyphs". Boards 1-12 and 17-19
 * draw the chosen-colour check at stroke 2.6 (and 3 in a grid cell) and the
 * custom disc's plus at 1.8, because these render at 10-13px: a 1.5 stroke
 * inside a 10px check paints at half a device pixel and vanishes.
 *
 * These are STATE marks on a colour swatch, not members of the icon set. Every
 * one of them is matched by its exact path data, so a chrome glyph cannot hide
 * behind the allowance.
 */
const STATE_GLYPHS = [
  // The chosen-colour check (boards 1-12, 17-19), drawn at 2.6.
  { d: 'M5 12.5L9.5 17L19 7.5', weight: 2.6 },
  // The custom colour disc's plus (boards 1, 3, 10, 12), drawn at 1.8.
  { d: 'M12 6V18', weight: 1.8 },
  { d: 'M6 12H18', weight: 1.8 },
];

/*
 * An offender is a state glyph only when BOTH hold: the file really draws that
 * path, and the weight the parser measured is that glyph's board weight. Line
 * numbers are deliberately not used — the parser reports the <svg>'s own offset
 * rather than the painted child's, so a line lookup would be a guess.
 */
const isStateGlyph = (offender, source) => STATE_GLYPHS.some(({ d, weight }) => (
  source.includes(d) && offender.includes(`strokes ${weight} on a`)
));

const walk = async (dir, prefix = '') => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.jsx')) out.push(rel);
  }
  return out;
};

test('every chrome file that hand-draws an inline icon draws it at the house weight', async () => {
  const files = (await walk(SRC)).filter((file) => !EXEMPT.has(file)).sort();
  assert.ok(files.length > 50, `the walk found only ${files.length} .jsx files - it is not walking src/`);

  const offenders = [];
  for (const file of files) {
    const source = await readFile(path.join(SRC, file), 'utf8');
    offenders.push(
      ...offHouseWeight(source, `src/${file}`).filter((o) => !isStateGlyph(o, source)),
    );
  }

  assert.deepEqual(
    offenders,
    [],
    `chrome glyphs off the house ${HOUSE_STROKE} weight that the six-file list does `
    + `not look at:\n  ${offenders.join('\n  ')}`,
  );
});

test('the region toolbar does not redraw the shared chevron at its own weight', async () => {
  // The single worst one: identical path data to <Icon name="chevronDown" />,
  // painted at 2.5 instead of 1.5, live in the desktop DOM at 716,850.
  const source = await readFile(path.join(SRC, 'RegionSelectionTool.jsx'), 'utf8');
  assert.ok(
    !/M6 9L12 15L18 9/.test(source),
    'src/RegionSelectionTool.jsx:2775 hand-draws the shared chevronDown path at '
    + 'strokeWidth 2.5 on a 24 grid (2.5 house units, 167% of 1.5). Render '
    + '<Icon name="chevronDown" size={14} /> instead, as SurveySpacesRail.jsx now does.',
  );
});
