import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inlineIconStrokes,
  offHouseWeight,
} from './helpers/inlineIconStrokes.mjs';

/*
 * ADVERSARIAL VERIFICATION, 2026-09-16 (verify-icons-defects), widened
 * 2026-09-16 (r4-desktop), LIST RETIRED 2026-09-16 (r5-icons).
 *
 * Owner ruling: the app renders ONE icon set on desktop, web mobile and iOS,
 * and every glyph in it carries the same stroke weight.
 *
 * tests/iconSetConsistency.test.mjs enforces that across src/Icons.jsx and
 * src/assets/icons. It cannot see chrome that draws an icon with a hand-written
 * inline <svg> instead of <Icon>, which is what this file was written for.
 * Glyphs it caught: the bottom status bar's Fit options (12px box, 1.8 painted =
 * 3.6 house units against the 1.5 beside it), then — once the parser learned to
 * read a weight declared on a CHILD element — the text editor's tick and cross
 * (3.6 and 3.8) and the Survey spaces rail's group-expand chevron (2.5).
 *
 * RULED DECISION — the six-file list is gone, and so is the scan that walked it.
 * This file shipped asking the weight question of a HAND-WRITTEN LIST of chrome
 * files, and the list was the hole: verify-r4-final found the SAME chevron defect
 * one file over from the one that had just been fixed, plus seven more glyphs in
 * four other files, none of them on the list. A list can only ever cover the
 * defects someone already found. tests/chromeInlineIconWholeTree.test.mjs now
 * walks every .jsx under src/ and asks the same question through the same
 * helper, which covers all six names this file used to hold and every file that
 * will ever be added. Keeping the scan here as well would be a second, weaker
 * copy of that test, so it was deleted rather than left to rot.
 *
 * What stays is the part the whole-tree walk cannot do for itself: keeping the
 * shared PARSER honest. Every glyph these tests were written to catch has since
 * been fixed, so a scan of the real tree finds nothing — which is also exactly
 * what a parser that had silently stopped working would report. The fixture
 * below is the difference between those two answers.
 *
 * THE PARSER LIVES IN tests/helpers/inlineIconStrokes.mjs. It shipped here
 * reading strokeWidth only off the <svg> OPENING TAG, which is the minority
 * spelling — three real defects hid on child elements underneath it. The
 * child-stroke parser written to expose them (chromeInlineIconChildStroke) was
 * folded into that shared helper so every caller asks the same question of the
 * same chrome and they can never drift apart again.
 *
 * The fix for a whole-tree failure is to draw the glyph at the house weight, or
 * better, to move it into src/Icons.jsx and render <Icon>: that is what
 * AnnotationSizeControl's bespoke 10x6 chevron, the AppShell carets, the rail's
 * image/video glyphs, the text editor's tick/cross, the locate banner's dismiss
 * cross, the region toolbar's chevron, the storage banner's warning triangle,
 * the team modal's role caret and the template category caret all did in the end.
 */

test('the shared parser reads a weight declared on a child, not only on the <svg>', () => {
  // The guard on the guard. This fixture declares its weight on the <path> and
  // inside a scaled <g>, the two spellings the original parser here was blind
  // to, and the defect must still be measured at its painted size.
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

test('the whole-tree guard is the one that walks the chrome now', async () => {
  // The scan this file used to run is gone, so the thing it was protecting has
  // to be shown to exist. If chromeInlineIconWholeTree is ever deleted or
  // narrowed back to a list, this fails and says where the coverage went.
  const source = await import('node:fs/promises')
    .then(({ readFile }) => readFile(new URL('./chromeInlineIconWholeTree.test.mjs', import.meta.url), 'utf8'));
  assert.match(
    source,
    /const walk = async \(dir/,
    'chromeInlineIconWholeTree must still walk the tree rather than read a file list',
  );
  assert.match(source, /offHouseWeight\(source, `src\/\$\{file\}`\)/);
  for (const file of [
    // The six names this file used to carry. They are covered by the walk
    // because the walk covers everything, and none of them may be exempted
    // from it — an EXEMPT entry is for ink the user drew, not for chrome.
    'AppShell.jsx',
    'SurveySpacesRail.jsx',
    'PDFSidebar.jsx',
    'mobile/MobilePdfViewerChrome.jsx',
    'components/AnnotationSizeControl.jsx',
    'components/TextEditOverlay.jsx',
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`'${file.replace('/', '\\/')}'`),
      `${file} is chrome and must not be exempted from the whole-tree walk`,
    );
  }
});
