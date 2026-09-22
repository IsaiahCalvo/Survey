/**
 * Desktop tool-bar review, pass 7 (2026-09-22).
 *
 * A reviewer drove the real desktop chrome at 1280 and 1440 and found nine
 * defects in the armed tool's settings. Each one is guarded here so the bar
 * cannot slide back: the file reads the sources as TEXT, the way
 * annotationDropdownUniformity and quickStyleRow already do, because the
 * controls are JSX inside two very large components and there is no renderer
 * in the node suite.
 *
 * Every number in here was MEASURED in headless chromium against the running
 * app (http://localhost:5360/?testPdf=clickable-link-test.pdf) at both widths;
 * the measurement is quoted beside the assertion it justifies.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const APP_SHELL = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const STYLES = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const PDF_VIEWER = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const QUICK_STYLE_JSX = readFileSync(new URL('../src/components/QuickStyleControls.jsx', import.meta.url), 'utf8');
const QUICK_STYLE_CSS = readFileSync(new URL('../src/components/QuickStyleControls.css', import.meta.url), 'utf8');

/** Strip JS/JSX comments so a word inside a "why" note cannot pass for markup. */
/* JSX comment braces come off FIRST — strip the /* … *\/ inside them and the
   bare { } they were wrapped in survive as code. */
const codeOnly = (source) => source
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const APP_SHELL_CODE = codeOnly(APP_SHELL);

/* ------------------------------------------------------------------ item 1 */

test('the desktop chrome renders no native <select> at all', () => {
  // MEASURED before: selecting a highlight put a 62x28 grey browser widget in
  // a row of 20px pills. After: 0 <select> elements in the document at 1280
  // and 1440, with a 118x20 .chrome-pill in its place.
  assert.equal(
    /<select[\s>]/.test(APP_SHELL_CODE),
    false,
    'AppShell must not render a native <select>; every setting is a .chrome-pill dropdown',
  );
});

test('Blend is a setting pill with plain words, a sample and a menu its own width', () => {
  assert.match(APP_SHELL, /label="Blend"/);
  // Plain words, not the file-format ones.
  assert.match(APP_SHELL, /value: 'layered', label: 'See-through'/);
  assert.match(APP_SHELL, /value: 'uniform', label: 'Solid'/);
  assert.equal(/label: 'Layered'/.test(APP_SHELL), false);
  assert.equal(/label: 'Uniform'/.test(APP_SHELL), false);
  // The pill and its menu take the same token, so the menu is the field width.
  assert.match(APP_SHELL, /width="var\(--chrome-field-w-blend\)"/);
  assert.match(APP_SHELL, /contentWidth="var\(--chrome-field-w-blend\)"/);
  // MEASURED: "See-through" is 64px at 11px/600; 118px is the first width that
  // holds it unclipped AND matches the menu's own natural 117.6px.
  assert.match(STYLES, /--chrome-field-w-blend:\s*118px/);
});

/* ------------------------------------------------------------------ item 2 */

test('nothing in the settings row can swallow the Escape that clears a selection', () => {
  // The select-family dismiss handler ignores Escape while focus sits in a
  // text-entry control — and a native <select> counted as one. With a highlight
  // picked and that widget focused, Escape did nothing and the bar stayed on
  // the mark's settings. MEASURED after: one Escape with the Blend pill focused
  // restores the Box / Lasso / Text toggle at 1280 and 1440.
  const guard = PDF_VIEWER.match(/if \(event\.target\?\.closest\?\.\('input, textarea, select[^\n]*\n/);
  assert.ok(guard, 'the select-family dismiss guard must still be there');
  // Every setting the armed tool shows is a button or a pill, never one of the
  // guarded tags, so the guard only ever protects real typing.
  assert.equal(/<select[\s>]/.test(APP_SHELL_CODE), false);
});

/* ------------------------------------------------------------------ item 3 */

test('the counter pill names the live count and its menu ends in New', () => {
  // MEASURED before: the pill read "Counter series" — 76px of text in a 51px
  // slot — and the menu held one row, "New count". After: "Count 1".
  assert.equal(/'Counter series';/.test(APP_SHELL_CODE), false, 'the pill must not fall back to the words "Counter series"');
  assert.match(APP_SHELL, /Count \$\{seriesList\.length \+ 1\}/);
  // Words only, per the owner's ruling on the series menu: the row READS "New"
  // and draws nothing, while the full phrase stays its accessible name.
  assert.match(APP_SHELL_CODE, />\s*New\s*<\/button>/);
  assert.match(APP_SHELL, /aria-label="New count"/);
  assert.equal(
    /<Icon name="plus"[^>]*\/>\s*\n\s*New/.test(APP_SHELL_CODE),
    false,
    'the New row must not lead with a plus glyph',
  );
  // The accessible name stays the control's job description.
  assert.match(APP_SHELL, /label="Counter series"/);
});

/* ------------------------------------------------------------------ item 4 */

test('a segmented toggle fits its well', () => {
  // MEASURED before: Box / Lasso / Text wanted 160px inside a 150px well, so
  // "Text" ran past the rounded end. After: 138.4px of segments in 150px.
  assert.match(STYLES, /--chrome-segment-pad-x:\s*3px/);
  assert.match(STYLES, /padding:\s*0 var\(--chrome-segment-pad-x\)/);
});

/* ------------------------------------------------------------------ item 5 */

test('a colour disc never paints outside its 22px button', () => {
  // 16px disc + a 1.5px gap + a 1.5px ring on every side is exactly 22px.
  // MEASURED: 22.0px of ink in a 22px button, on every disc and both widths.
  assert.match(QUICK_STYLE_CSS, /--quick-style-gap-w:\s*1\.5px/);
  assert.match(QUICK_STYLE_CSS, /--quick-style-ring-w:\s*1\.5px/);
  const ring = QUICK_STYLE_CSS.match(/0 0 0 calc\(var\(--quick-style-gap-w\)[^;]*;/g) || [];
  assert.ok(ring.length >= 1, 'the chosen-state ring must be computed from the gap and ring tokens');
});

/* ------------------------------------------------------------------ item 6 */

test('the eraser tool button is called Eraser, whichever kind is armed', () => {
  // MEASURED before: the tool row read "Partial erase", the same words the
  // Partial half of the toggle beside it carried.
  assert.match(PDF_VIEWER, /isEraser \? 'Eraser'/);
  assert.equal(
    /eraserMode === 'entire' \? 'Full stroke erase' : 'Partial erase'/.test(PDF_VIEWER),
    false,
    'the tool row must not rename itself to the eraser mode',
  );
  // The toggle's two halves keep their own, distinct, accessible names.
  assert.match(APP_SHELL, /\['partial', 'Partial', 'Partial erase'\]/);
  assert.match(APP_SHELL, /\['entire', 'Whole', 'Full stroke erase'\]/);
});

/* ------------------------------------------------------------------ item 7 */

test('a no-fill swatch has one look, defined once, for both platforms', () => {
  assert.match(QUICK_STYLE_JSX, /isNoFillColour/);
  assert.match(QUICK_STYLE_JSX, /quick-style__swatch-disc--no-fill/);
  // The centre is genuinely open: the bar shows through the ring.
  assert.match(QUICK_STYLE_CSS, /\.quick-style__swatch-disc--no-fill\s*\{[^}]*background:\s*transparent/);
});

/* ------------------------------------------------------------------ item 8 */

test('bar 1 rules off its line-style group, and bar 3 centres its controls', () => {
  // MEASURED before: no hairline between the Style pill and "Aa"; bar 3's
  // controls sat 13.7px right of centre because the "Text" caption pushed them.
  assert.match(APP_SHELL, /chrome-divider-before-aa/);
  assert.match(APP_SHELL, /data-text-colour-label/);
  // The caption is taken out of the flow so only the controls are centred.
  assert.match(APP_SHELL, /position: 'absolute',\s*\n\s*right: '100%'/);
});

/* ------------------------------------------------------------------ item 9 */

test('the settings holder is sized by its content, not by the space beside it', () => {
  // An absolutely positioned box anchored at left:100% shrink-to-fits into
  // whatever room is left, so a wide settings row could be squeezed and clip.
  // MEASURED after: holder width equals its scrollWidth in every tool state.
  assert.match(APP_SHELL, /width: 'max-content'/);
});
