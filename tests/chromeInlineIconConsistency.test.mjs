import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/*
 * ADVERSARIAL VERIFICATION, 2026-09-16 (verify-icons-defects).
 *
 * Owner ruling: the app renders ONE icon set on desktop, web mobile and iOS,
 * and every glyph in it carries the same stroke weight.
 *
 * tests/iconSetConsistency.test.mjs enforces that across src/Icons.jsx and
 * src/assets/icons. It cannot see chrome that draws an icon with a hand-written
 * inline <svg> instead of <Icon>, and two such glyphs are off the house weight
 * in the shipped desktop chrome. Measured live in the Browser pane at 1440x900
 * with a real PDF open:
 *
 *   Fit options (bottom status bar) .... 12px box, 1.8px painted = 3.6 grid units
 *   every icon beside it in that row ... 14px box, 0.875px painted = 1.5 units
 *
 * 3.6 against the house 1.5 is 140% over — the widest icon-weight break left in
 * the app, and it sits between Zoom out and the page steppers.
 *
 * These tests fail on purpose. They pass once the glyphs below are drawn at the
 * house weight (or moved into src/Icons.jsx, which is the better fix: the same
 * pass already replaced AnnotationSizeControl's bespoke 10x6 chevron with the
 * shared <Icon name="chevronDown" />).
 */

const HOUSE_STROKE = 1.5;
const TOLERANCE = 0.03;

const CHROME_FILES = [
  'src/AppShell.jsx',
  'src/SurveySpacesRail.jsx',
  'src/PDFSidebar.jsx',
  'src/mobile/MobilePdfViewerChrome.jsx',
  'src/components/AnnotationSizeControl.jsx',
];

/**
 * Every inline <svg ...> opening tag in a chrome file, with the grid it is drawn
 * on and the stroke width declared on it, normalised onto the house 24 grid.
 */
const inlineIconSvgs = (source, file) => {
  const found = [];
  for (const match of source.matchAll(/<svg\b[^>]*>/g)) {
    const tag = match[0];
    const viewBox = /viewBox=["']([^"']+)["']/.exec(tag);
    if (!viewBox) continue;
    const grid = Number(viewBox[1].trim().split(/[\s,]+/)[2]);
    if (!Number.isFinite(grid) || grid <= 0) continue;

    const stroke = /strokeWidth:\s*([\d.]+)/.exec(tag) || /strokeWidth=["']?\{?([\d.]+)/.exec(tag);
    if (!stroke) continue;

    const line = source.slice(0, match.index).split('\n').length;
    found.push({
      file,
      line,
      grid,
      declared: Number(stroke[1]),
      units: Number(((Number(stroke[1]) * 24) / grid).toFixed(3)),
    });
  }
  return found;
};

test('chrome that draws an icon inline uses the house stroke weight', async () => {
  const offenders = [];
  for (const file of CHROME_FILES) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const icon of inlineIconSvgs(source, file)) {
      if (Math.abs(icon.units - HOUSE_STROKE) > TOLERANCE) {
        offenders.push(
          `${icon.file}:${icon.line} draws stroke ${icon.declared} on a ${icon.grid} grid `
          + `= ${icon.units} house units (want ${HOUSE_STROKE})`,
        );
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `chrome icons off the house ${HOUSE_STROKE} weight:\n  ${offenders.join('\n  ')}`,
  );
});
