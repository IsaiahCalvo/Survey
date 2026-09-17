import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  HOUSE_STROKE,
  inlineIconStrokes,
  offHouseWeight,
} from './helpers/inlineIconStrokes.mjs';

/*
 * ADVERSARIAL VERIFICATION, 2026-09-16 (verify-icons-defects), widened
 * 2026-09-16 (r4-desktop).
 *
 * Owner ruling: the app renders ONE icon set on desktop, web mobile and iOS,
 * and every glyph in it carries the same stroke weight.
 *
 * tests/iconSetConsistency.test.mjs enforces that across src/Icons.jsx and
 * src/assets/icons. It cannot see chrome that draws an icon with a hand-written
 * inline <svg> instead of <Icon>, which is what this file is for. Glyphs it
 * caught: the bottom status bar's Fit options (12px box, 1.8 painted = 3.6 house
 * units against the 1.5 beside it), then — once the parser below learned to read
 * a weight declared on a CHILD element — the text editor's tick and cross
 * (3.6 and 3.8) and the Survey spaces rail's group-expand chevron (2.5).
 *
 * THE PARSER NOW LIVES IN tests/helpers/inlineIconStrokes.mjs. It shipped here
 * reading strokeWidth only off the <svg> OPENING TAG, which is the minority
 * spelling — three real defects hid on child elements underneath it. The
 * child-stroke parser written to expose them (chromeInlineIconChildStroke) was
 * folded into that shared helper so this file and that one ask the same
 * question of the same chrome and can never drift apart again.
 *
 * The fix for a failure here is to draw the glyph at the house weight, or
 * better, to move it into src/Icons.jsx and render <Icon>: that is what
 * AnnotationSizeControl's bespoke 10x6 chevron, the AppShell carets, the rail's
 * image/video glyphs and the text editor's tick/cross all did in the end.
 */

/*
 * Every chrome file that hand-writes at least one inline <svg>, plus the ones
 * that used to and must not regress. src/components/TextEditOverlay.jsx joined
 * the list when it grew the tick/cross pair.
 */
const CHROME_FILES = [
  'src/AppShell.jsx',
  'src/SurveySpacesRail.jsx',
  'src/PDFSidebar.jsx',
  'src/mobile/MobilePdfViewerChrome.jsx',
  'src/components/AnnotationSizeControl.jsx',
  'src/components/TextEditOverlay.jsx',
];

const readChrome = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('chrome that draws an icon inline uses the house stroke weight', async () => {
  const offenders = [];
  for (const file of CHROME_FILES) {
    offenders.push(...offHouseWeight(await readChrome(file), file));
  }
  assert.deepEqual(
    offenders,
    [],
    `chrome icons off the house ${HOUSE_STROKE} weight:\n  ${offenders.join('\n  ')}`,
  );
});

test('the shared parser reads a weight declared on a child, not only on the <svg>', async () => {
  // The guard on the guard. Every glyph this file was written to catch has since
  // been fixed or moved to <Icon>, so a scan of the real tree finds nothing —
  // which is also exactly what a parser that had silently stopped working would
  // report. This fixture keeps the parser honest: it declares its weight on the
  // <path> and inside a scaled <g>, the two spellings the original parser here
  // was blind to, and the defect must still be measured at its painted size.
  const fixture = `
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M3 3 L9 9" stroke="#475569" strokeWidth="1.8" fill="none" />
    </svg>
    <svg width="24" height="24" viewBox="0 0 24 24">
      <g transform="scale(1.2)">
        <path d="M2 2 L18 18" stroke="#000" strokeWidth="1.25" />
      </g>
      <path d="M1 1 L23 23" stroke="none" strokeWidth="9" />
    </svg>
  `;
  const measured = inlineIconStrokes(fixture, 'fixture');
  assert.deepEqual(
    measured.map((icon) => icon.units),
    [3.6, 1.5],
    'the 12-grid child stroke must normalise to 3.6, the scaled group to the '
    + 'house 1.5, and a stroke="none" shape must not be measured at all',
  );
  assert.deepEqual(offHouseWeight(fixture, 'fixture').length, 1);
});
