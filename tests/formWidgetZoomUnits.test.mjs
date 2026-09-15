// Form-widget chrome must be expressed in PAGE UNITS, never in fixed CSS px.
//
// Owner report, 2026-09-15: "the content within checkboxes and text input
// fields does not stay aligned within the checkboxes or text input fields …
// the border around checkboxes grows and shrinks at a different rate than
// other annotations do."
//
// Measured in the running app before the fix (prog-07-form-fields.pdf, fit-page
// through 400%):
//
//   checkbox control border   1px, 1px, 1px, 1px, 1px   (should be 1.12 … 4)
//   red checkbox border       2px, 2px, 2px, 2px, 2px   (should be 2.24 … 8)
//   text field control border 1px, 1.5px, 2px, 3px, 4px (already correct)
//
// TWO separate fixed-px borders caused it:
//
//   1. The checkbox rule declared `border-width: var(--pdf-widget-border-width)`
//      with the variable carrying a fixed `Npx` — and because the declaration
//      is !important it ALSO beat the `input.style.borderWidth = N * scale`
//      write in syncScaleFactor, which had been dead code ever since. The
//      variable now carries a bare page-unit NUMBER and the stylesheet
//      multiplies it by --total-scale-factor.
//   2. pdf.js writes the widget CONTAINER's border as a fixed
//      `${data.borderStyle.width}px` inline style on the <section>
//      (annotation_layer #createContainer) and never revisits it, so every
//      PDF-declared widget outline stayed a hairline at any zoom. The layer now
//      stashes the declared width and re-expresses it in page units on resize.
//
// Because the control is box-sizing:border-box, a non-scaling border also
// squeezed the padding box the tick glyph is sized against
// (background-size: 82%): the glyph's share of its own box ran from 0.783 at
// fit-page to 0.947 at 400%, a 21% relative drift, and the control's left edge
// walked 0.21% of the page width. After the fix that share holds to 0.033 and
// the edge to 0.0004 — the residual in both is Chromium's half-pixel border
// quantisation, which the text fields have always had too.
//
// These assertions read the component as TEXT. They cannot catch a rendering
// regression, but the defect they guard is a one-token edit away in every case.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/PdfjsFormLayer.jsx', import.meta.url), 'utf8');

// The injected <style> block, without the surrounding JS.
const styleBlock = (() => {
  const start = source.indexOf('style.textContent = `');
  const end = source.indexOf('`;', start);
  assert.ok(start > 0 && end > start, 'the form-layer stylesheet must still be a template literal');
  return source.slice(start, end);
})();

const declarations = styleBlock
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('/*') && !line.startsWith('*') && !line.startsWith('//'));

test('the layer still derives --total-scale-factor from the scale it maintains', () => {
  // pdf.js sizes widget TEXT as calc(Npx * var(--total-scale-factor)) and only
  // consumes the variable; its own stylesheet, which defines it, is never
  // imported here. Without this line every field falls back to a fixed px
  // font and the text stops scaling with its box.
  assert.match(styleBlock, /--total-scale-factor:\s*var\(--scale-factor,\s*1\)/);
});

test('every length in the widget chrome scales with the page', () => {
  // A bare `Npx` in a border-width / padding / font-size declaration is the
  // defect. Sizes that are deliberately zoom-independent (border-radius: 0,
  // margin: 0, width/height: 100%) carry no px at all, so this is a clean
  // filter rather than an allowlist.
  const offenders = declarations.filter((line) => {
    if (!/^(border|padding|font-size|font|margin|inset)\b/.test(line) && !/border-width:/.test(line)) return false;
    const withoutScaledCalcs = line.replace(/calc\([^;]*var\(--(total-)?scale-factor[^;]*\)/g, '');
    return /\d+(\.\d+)?px/.test(withoutScaledCalcs);
  });

  assert.deepEqual(offenders, [], 'these declarations pin a CSS px size that will not follow zoom');
});

test('the checkbox border multiplies its page-unit width by the page scale', () => {
  const rule = styleBlock.slice(
    styleBlock.indexOf('.buttonWidgetAnnotation.checkBox input {'),
    styleBlock.indexOf('.buttonWidgetAnnotation.checkBox input:checked'),
  );
  assert.ok(rule.length > 0, 'the checkbox rule must still exist');
  assert.match(
    rule,
    /border-width:\s*calc\(var\(--pdf-widget-border-width[^)]*\)\s*\*\s*var\(--total-scale-factor[^)]*\)\s*\*\s*1px\)\s*!important/,
    'the checkbox outline must ride --total-scale-factor like every other annotation stroke',
  );
});

test('--pdf-widget-border-width is set as a bare page-unit number, never as px', () => {
  // The moment it carries a unit, the calc() above becomes invalid and the
  // border silently falls back to the 1px default at every zoom.
  const setter = source.match(/setProperty\('--pdf-widget-border-width',\s*(.*)\);/);
  assert.ok(setter, 'the layer must still publish the widget border width');
  assert.doesNotMatch(setter[1], /px/, `page units only, got: ${setter[1]}`);
  assert.match(setter[1], /String\(meta\.visualStyle\.borderWidth\)/);
});

test('pdf.js’s fixed-px widget container border is captured and rescaled on every resize', () => {
  // Capture: read what pdf.js declared, before anything overwrites it.
  assert.match(
    source,
    /const declared = parseFloat\(section\.style\.borderWidth\);/,
    'the declared container border must be stashed at render time',
  );
  assert.match(source, /section\.dataset\.pdfWidgetContainerBorder = String\(declared\)/);

  // Rescale: inside syncScaleFactor, in page units off the measured scale.
  const sync = source.slice(source.indexOf('const syncScaleFactor = () => {'), source.indexOf('syncScaleFactor();'));
  assert.ok(sync.length > 0, 'syncScaleFactor must still exist');
  assert.match(sync, /section\[data-pdf-widget-container-border\]/);
  assert.match(sync, /section\.style\.borderWidth = `\$\{sourceWidth \* measuredScale\}px`/);
});

test('the dead per-zoom write that the !important rule used to beat is gone', () => {
  // `input.style.borderWidth = ...` is a normal inline declaration and loses to
  // the !important checkbox rule. Leaving it in place is how the defect hid for
  // so long: the code looked like it scaled the border and never did.
  assert.doesNotMatch(source, /input\.style\.borderWidth\s*=/);
});

test('the multiline value is re-fitted on every scale change, not once at mount', () => {
  const sync = source.slice(source.indexOf('const syncScaleFactor = () => {'), source.indexOf('syncScaleFactor();'));
  assert.match(sync, /refitMultilineWidgets\(multilineFitTargets\)/,
    'a zoom must re-derive the fit; a single mount-time pass makes the answer depend on the zoom the field mounted at');
  assert.match(source, /fitMultilineFontSize/);
  // And the applied size stays a page-unit number times the page scale.
  const refit = source.slice(source.indexOf('function refitMultilineWidgets('), source.indexOf('export default function PdfjsFormLayer'));
  const applications = refit.match(/style\.fontSize = `calc\(\$\{[a-zA-Z]+\}px \* var\(--total-scale-factor\)\)`/g) || [];
  assert.equal(applications.length, 2, 'both the probe write and the final write must be page-unit calcs');
});

test('a form control is a block box so no text baseline can displace it', () => {
  // The defect this guards is invisible above ~140% zoom and severe below it:
  // an inline-block replaced element sits on its section's baseline, and the
  // section inherits the app's fixed 16px font, so the strut stays a constant
  // CSS px while the widget box shrinks with zoom. Measured at 57%: the text
  // field's control sat 7.1 CSS px low inside an 11.3px box, the checkbox's
  // 3.7px low. `display: block` removes the control from the inline formatting
  // context and both offsets go to exactly 0 at every zoom.
  const rule = styleBlock.slice(
    styleBlock.indexOf('.pdfjsFormLayer .textWidgetAnnotation input,'),
    styleBlock.indexOf('.pdfjsFormLayer .buttonWidgetAnnotation.checkBox input {'),
  );
  assert.ok(rule.length > 0, 'the shared control rule must still exist');
  assert.match(rule, /display:\s*block;/);
  assert.match(rule, /box-sizing:\s*border-box;/);
  assert.match(rule, /width:\s*100%;\s*height:\s*100%;/);
});

// --- the surface next door ---------------------------------------------------
// The form layer is the odd one out because pdf.js builds it out of real HTML
// controls whose chrome is CSS px. Every OTHER annotation kind is inside an SVG
// whose viewBox IS the page box, which is what makes its geometry page-unit for
// free — and the live harness confirmed it: ink, square, circle, free text,
// stamp, highlight, underline, squiggly, strikeout and redact all held their
// normalised position and size to 0.0000 across the whole zoom ladder, through
// scroll and through a Pan-tool drag. These two assertions guard the mechanism
// that gives them that, since losing it would silently un-lock every kind at
// once.

test('the SVG annotation layer keeps the page box as its coordinate system', () => {
  const svgLayer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(
    svgLayer,
    /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/,
    'annotation geometry is stored in page units; the viewBox is the only thing that turns them into screen px',
  );
});

test('the SVG annotation layer still owns zoom with no JavaScript coordination', () => {
  // CLAUDE.md invariant. A scale multiplication inside this layer is how the
  // old 5-timer Syncfusion zoom system started.
  const svgLayer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(svgLayer, /transform:\s*`?scale\(/, 'the viewBox is the sole zoom transform');
});
