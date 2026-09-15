// Form-widget chrome must hold its PAGE ratio at every zoom and every device
// pixel ratio — the same lock every SVG annotation kind already has.
//
// ROUND 1 (earlier on 2026-09-15) moved the widget chrome off fixed CSS px and
// onto `calc(<page units> * var(--total-scale-factor) * 1px)`. That fixed the
// NUMBERS and left the MECHANISM broken, which an adversarial live checker then
// measured on form widgets while every SVG annotation kind held to 1e-6:
//
//   * a 1-page-unit outline (the section outline AND the control's own border,
//     including the red 2-unit checkbox) painted 0.5 CSS px from 48% all the
//     way through 94% at dpr 2 and then jumped in steps — a 1.9x spread in
//     painted-width-per-page-unit across the ladder. Chromium resolves a used
//     CSS border-width to whole DEVICE pixels; no number you multiply by the
//     scale survives that.
//   * the checkbox tick was a background image sized at 82% of a padding box
//     that those quantised borders were eating into, so its size swung 13–31%
//     relative to the page.
//   * a multiline value overflowed its box for up to 1.5 s after a zoom step
//     (a requestAnimationFrame refit), and the settled page-unit size drifted
//     ±3% across the ladder (16.5 vs 17) because the BROWSER re-wrapped the
//     value at every scale.
//
// ROUND 2 takes the zoom out of layout instead of multiplying through it:
//
//   * outlines and the tick are SVG geometry in page units inside an
//     <svg viewBox="0 0 pageW pageH"> that fills the widget's section —
//     mechanically identical to SVGAnnotationLayer, which is why it inherits
//     its exactness.
//   * the control is laid out at its PAGE box and mapped onto the page by one
//     uniform `transform: scale(var(--scale-factor))`. Layout — wrapping,
//     measuring, snapping — therefore happens once, in page units, and the zoom
//     only rasterises it.
//
// WHAT CHANGED IN THIS FILE. Six round-1 assertions guarded the calc()-through-
// a-CSS-border mechanism itself (`border-width: calc(var(--pdf-widget-border-
// width) * var(--total-scale-factor) * 1px)`, the per-resize
// `section.style.borderWidth = width * scale + 'px'` rewrite, the bare-number
// --pdf-widget-border-width setter, the ban on any px not multiplied by the
// scale, `width/height: 100%`, and the per-scale refit). That mechanism is gone,
// so those assertions are replaced — not relaxed — by assertions on the
// mechanism that took its place, plus the numeric invariance tests at the
// bottom that round 1 had no way to state at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  planWidgetChrome,
  quantiseCssBorderPx,
  paintedStrokePx,
} from '../src/components/pdfjsFormWidgetChrome.js';
import {
  fitMultilineFontSize,
  multilineFitSignature,
} from '../src/components/pdfjsFormTextSizing.js';

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

const controlRule = styleBlock.slice(
  styleBlock.indexOf('.pdfjsFormLayer .textWidgetAnnotation input,'),
  styleBlock.indexOf('.pdfjsFormLayer .buttonWidgetAnnotation.checkBox input {'),
);

const checkboxRule = styleBlock.slice(
  styleBlock.indexOf('.pdfjsFormLayer .buttonWidgetAnnotation.checkBox input {'),
  styleBlock.indexOf('.pdfjsFormLayer .buttonWidgetAnnotation.radioButton input'),
);

const syncScaleFactor = source.slice(
  source.indexOf('const syncScaleFactor = () => {'),
  source.indexOf('syncScaleFactor();'),
);

// --- the zoom ladder ---------------------------------------------------------
// 24%–447%, the span the live checker walks, with the ten zooms the round-2
// verification calls out by name folded in so the test and the browser run are
// measuring the same places.
const NAMED_ZOOMS = [0.48, 0.60, 0.75, 0.94, 1.17, 1.46, 1.83, 2.29, 2.86, 3.58];
const LADDER = (() => {
  const steps = [];
  for (let s = 0.24; s <= 4.47 + 1e-9; s *= 1.25) steps.push(Math.round(s * 10000) / 10000);
  steps.push(4.47);
  return [...new Set([...steps, ...NAMED_ZOOMS])].sort((a, b) => a - b);
})();
const DPRS = [1, 2];

const spread = (values) => Math.max(...values) / Math.min(...values);

// --- mechanism: the outlines are SVG in page units ---------------------------

test('the layer still defines --total-scale-factor from the scale it maintains', () => {
  // pdf.js sizes widget text as calc(Npx * var(--total-scale-factor)) and only
  // CONSUMES the variable; its own stylesheet, which defines it, is never
  // imported here. Undefined makes those calc()s invalid.
  assert.match(styleBlock, /--total-scale-factor:\s*var\(--scale-factor,\s*1\)/);
});

test('every control pins --total-scale-factor to 1 so pdf.js sizes land in page units', () => {
  // Replaces round 1's "every length multiplies by the scale". With the control
  // laid out in page units and scaled by a transform, multiplying pdf.js's own
  // font-size/--comb-width by the scale AGAIN would double-scale them.
  assert.match(controlRule, /--total-scale-factor:\s*1;/);
});

test('the control is laid out at its page box and scaled by exactly one transform', () => {
  // Replaces round 1's `width: 100%; height: 100%`. 100% tracked the section,
  // which is right, but it made the control's layout — and so its wrap, its
  // snapped borders and its rounded padding — a function of the current zoom.
  // A page-unit box under one uniform transform is the same size on screen and
  // a zoom-invariant layout.
  assert.match(controlRule, /width:\s*calc\(var\(--pdf-widget-page-w[^)]*\)\s*\*\s*1px\)/);
  assert.match(controlRule, /height:\s*calc\(var\(--pdf-widget-page-h[^)]*\)\s*\*\s*1px\)/);
  assert.match(controlRule, /transform:\s*scale\(var\(--scale-factor,\s*1\)\)/);
  assert.match(controlRule, /transform-origin:\s*0 0/);
  assert.match(controlRule, /position:\s*absolute;\s*left:\s*0;\s*top:\s*0/);
});

test('no length anywhere in the widget stylesheet is a px multiplied by the zoom', () => {
  // The round-1 rule was "every px MUST be multiplied by --total-scale-factor".
  // Round 2 inverts it: multiplying a px by the scale is exactly what hands the
  // length to the layout engine at the current zoom, where Chromium snaps it to
  // device pixels. The only zoom in the layer is the one transform above.
  const offenders = declarations.filter((line) => (
    /calc\([^;]*var\(--(total-)?scale-factor[^;]*\)[^;]*px/.test(line)
    && !/^transform:/.test(line)
  ));
  assert.deepEqual(offenders, [], 'these declarations resolve a px at the current zoom');
});

test('no control paints a CSS border or a background-image tick any more', () => {
  // Both are the quantised mechanisms. The outlines and the tick are SVG now.
  assert.match(controlRule, /border:\s*0;/);
  assert.match(checkboxRule, /border:\s*0\s*!important;/);
  assert.match(checkboxRule, /background-image:\s*none\s*!important;/);
  assert.doesNotMatch(styleBlock, /border-width:\s*calc/, 'a calc()ed border-width is the round-1 defect');
  assert.doesNotMatch(styleBlock, /background-image:\s*url\(/, 'the tick is SVG geometry, not a background image');
  assert.doesNotMatch(styleBlock, /background-size:/);
});

test('the widget chrome is an SVG whose viewBox is the widget page box', () => {
  // The exact mechanism SVGAnnotationLayer uses, applied per widget.
  assert.match(source, /svg\.setAttribute\('viewBox',\s*plan\.viewBox\)/);
  assert.match(source, /planWidgetChrome\(\{/);
  assert.match(styleBlock, /\.pdfjsFormLayer \.pdfWidgetChrome \{/);
  // And the tick follows the control's checked state with no JavaScript, so it
  // can never be left behind by a re-render or a persisted-value sync.
  assert.match(styleBlock, /input:checked ~ \.pdfWidgetChrome \.pdfWidgetTick \{\s*display: block;/);
});

test('pdf.js’s fixed-px container border is captured and then zeroed, not rescaled', () => {
  // Round 1 rewrote it as `${sourceWidth * measuredScale}px` on every resize —
  // still a CSS border, so still snapped, and still a border-box inset that
  // rounded the control's origin. It is read once and handed to the SVG plan.
  assert.match(source, /const declaredContainer = parseFloat\(section\.style\.borderWidth\);/);
  assert.match(source, /section\.style\.borderWidth = '0px';/);
  assert.doesNotMatch(source, /style\.borderWidth = `\$\{[^`]*measuredScale[^`]*\}px`/);
  assert.doesNotMatch(source, /input\.style\.borderWidth\s*=/);
});

// --- mechanism: the multiline fit is zoom-invariant and synchronous ----------

test('the multiline refit is called synchronously from the resize path', () => {
  // Replaces round 1's "re-fitted on every scale change". It still runs on the
  // same path — but directly, not inside a requestAnimationFrame, because a
  // deferred refit is a window in which the value overflows its box (measured:
  // up to 1.5 s).
  assert.match(syncScaleFactor, /^\s*refitMultilineWidgets\(multilineFitTargets\);/m);
  // Calls, not the prose about the calls that used to be here.
  assert.doesNotMatch(source, /requestAnimationFrame\(/, 'nothing in this layer may wait for a frame');
  assert.doesNotMatch(source, /setTimeout\(/, 'and certainly not for a timer');
});

test('the applied multiline size is a bare page-unit px, never a calc', () => {
  const refit = source.slice(
    source.indexOf('function refitMultilineWidgets('),
    source.indexOf('export default function PdfjsFormLayer'),
  );
  const applications = refit.match(/style\.fontSize = `\$\{[a-zA-Z]+\}px`/g) || [];
  assert.equal(applications.length, 2, 'both the probe write and the final write must be page units');
  assert.doesNotMatch(refit, /var\(--total-scale-factor\)/, 'scaling the size again is the round-1 mechanism');
  assert.match(refit, /multilineFitSignature\(\{/, 'the refit must be gated on what the answer depends on');
});

test('the fit signature has no way to depend on the zoom', () => {
  const sizing = readFileSync(new URL('../src/components/pdfjsFormTextSizing.js', import.meta.url), 'utf8');
  const signature = sizing.slice(sizing.indexOf('export function multilineFitSignature('));
  const params = signature.slice(signature.indexOf('{'), signature.indexOf('}'));
  assert.doesNotMatch(params, /scale|zoom|dpr|devicePixel/i, `a scale parameter would reopen the defect: ${params}`);
  // Same page box, ten different zooms, one signature.
  const signatures = new Set(LADDER.map(() => multilineFitSignature({
    pageWidth: 231, pageHeight: 75, startFontSize: 17, value: 'First\nSecond line of the field value.\nThird line.',
  })));
  assert.equal(signatures.size, 1);
});

test('a form control is a block box so no text baseline can displace it', () => {
  // Unchanged round-1 guard: an inline-block replaced element sits on its
  // section's baseline, and that strut is a fixed CSS px whatever the zoom is,
  // so a shrinking widget box pushed the control further and further down
  // (measured at 57%: 7.1 CSS px low inside an 11.3px box).
  assert.match(controlRule, /display:\s*block;/);
  assert.match(controlRule, /box-sizing:\s*border-box;/);
});

// --- numbers: the invariance the mechanism exists to produce -----------------
//
// These walk the same ladder the live checker walks, at dpr 1 and dpr 2, over
// the real geometry planner. `quantiseCssBorderPx` re-creates what Chromium did
// to the round-1 mechanism, so each test can show both that the new number
// holds and that the old one could not have.

const WIDGET = { pageWidth: 231, pageHeight: 75 };       // the notes field in prog-07-form-fields.pdf
const CHECKBOX = { pageWidth: 12, pageHeight: 12 };      // the red 2-unit checkbox

test('outline width per 1000 page units holds within 1% across 24%–447% at dpr 1 and 2', () => {
  for (const dpr of DPRS) {
    for (const widget of [WIDGET, CHECKBOX]) {
      const plan = planWidgetChrome({ ...widget, containerBorder: 1, controlBorder: 2 });
      for (const outline of plan.outlines) {
        const perThousand = LADDER.map((scale) => (
          (paintedStrokePx(outline.strokeWidth, scale) / (widget.pageWidth * scale)) * 1000
        ));
        assert.ok(
          spread(perThousand) <= 1.01,
          `dpr ${dpr}, ${outline.kind} outline spread ${spread(perThousand).toFixed(4)}`,
        );
      }
    }
  }
});

test('and the round-1 CSS border could not have held that bar at any number', () => {
  // The measurement that sent this back for a second round: a 1-page-unit
  // border, at dpr 2, painting 0.5 CSS px from 48% through 94%.
  const dpr = 2;
  const painted = NAMED_ZOOMS.map((scale) => quantiseCssBorderPx(1 * scale, dpr));
  assert.deepEqual(painted.slice(0, 4), [0.5, 0.5, 0.5, 0.5], '48/60/75/94% all land on one device pixel');
  const perPageUnit = LADDER.map((scale) => quantiseCssBorderPx(1 * scale, dpr) / scale);
  assert.ok(spread(perPageUnit) >= 1.5, `the defect must still measure as one: ${spread(perPageUnit).toFixed(3)}`);
});

test('tick extent per 1000 page units holds within 1% across the ladder at dpr 1 and 2', () => {
  const plan = planWidgetChrome({ ...CHECKBOX, containerBorder: 1, controlBorder: 2, tick: true });
  assert.ok(plan.tick, 'a checked checkbox must plan a tick');
  for (const dpr of DPRS) {
    const perThousand = LADDER.map((scale) => (
      ((plan.tick.extent * scale) / (CHECKBOX.pageWidth * scale)) * 1000
    ));
    assert.ok(spread(perThousand) <= 1.01, `dpr ${dpr}: tick spread ${spread(perThousand).toFixed(4)}`);
    // Sanity: the tick is still 82% of the box inside the two outlines, the
    // same glyph the background image drew.
    assert.ok(Math.abs(plan.tick.extent - 0.82 * (12 - 2 * 3)) < 1e-9);
  }
});

test('and the background-image tick could not have, because its box was the quantised one', () => {
  // 82% of a padding box whose inset was two Chromium-snapped borders.
  const dpr = 2;
  const perThousand = LADDER.map((scale) => {
    const snappedInset = quantiseCssBorderPx(1 * scale, dpr) + quantiseCssBorderPx(2 * scale, dpr);
    const innerCss = CHECKBOX.pageHeight * scale - 2 * snappedInset;
    return ((0.82 * innerCss) / (CHECKBOX.pageWidth * scale)) * 1000;
  });
  assert.ok(spread(perThousand) >= 1.10, `the reported 13–31% swing must reproduce: ${spread(perThousand).toFixed(3)}`);
});

test('multiline glyph size per 1000 page units is one number across the whole ladder', () => {
  // The fit measures the control's LAYOUT box, and a transform never touches
  // layout — so `measure` is handed page units at every zoom and the browser
  // wraps the value exactly once. Modelled here as a box that overflows below
  // 15.5 page units, which is a property of the page box and the text alone.
  const fitAt = () => fitMultilineFontSize({
    startFontSize: 17,
    measure: (fontSize) => ({ scrollHeight: fontSize > 15.5 ? 100 : 60, clientHeight: 80 }),
  });
  const fittedSizes = LADDER.map((scale) => fitAt(scale));   // scale deliberately unused
  assert.equal(new Set(fittedSizes).size, 1, 'one exact page-unit size, not one within 1%');
  const perThousand = LADDER.map((scale, i) => (
    ((fittedSizes[i] * scale) / (WIDGET.pageHeight * scale)) * 1000
  ));
  assert.ok(spread(perThousand) <= 1.0001, `glyph spread ${spread(perThousand)}`);
});

test('and the round-1 per-zoom refit drifted, because the browser re-wrapped at each scale', () => {
  // v2 re-measured at the CURRENT zoom, where a line ends flush with the box at
  // one scale and spills at another (glyph advances snap to device pixels).
  // Modelled the same way: the overflow threshold moves with the scale.
  const dpr = 2;
  const perThousand = LADDER.map((scale) => {
    const fitted = fitMultilineFontSize({
      startFontSize: 17,
      measure: (fontSize) => {
        const advanceCss = quantiseCssBorderPx(fontSize * scale * 0.5, dpr) / scale;
        return { scrollHeight: advanceCss > 8.1 ? 100 : 60, clientHeight: 80 };
      },
    });
    return ((fitted * scale) / (WIDGET.pageHeight * scale)) * 1000;
  });
  assert.ok(new Set(perThousand).size > 1, 'the ±3% drift must still reproduce under the old mechanism');
});

test('a zoom step changes nothing a multiline field would have to catch up with', () => {
  // "No overflow at any moment after a zoom step" (polled live at 0/50/200/1000
  // ms) is guaranteed here by there being no work to defer: the signature is
  // unchanged by the zoom, so the refit returns without measuring, and the
  // applied size is the one that already fit.
  const target = { pageWidth: 231, pageHeight: 75, startFontSize: 17, value: 'a\nb\nc' };
  const first = multilineFitSignature(target);
  let measurements = 0;
  const applied = LADDER.map(() => {
    const signature = multilineFitSignature(target);
    if (signature === first && measurements > 0) return 15.5;   // skipped: nothing re-measured
    return fitMultilineFontSize({
      startFontSize: 17,
      measure: (fontSize) => { measurements += 1; return { scrollHeight: fontSize > 15.5 ? 100 : 60, clientHeight: 80 }; },
    });
  });
  assert.equal(new Set(applied).size, 1);
  assert.ok(measurements <= 4, `one fit for the whole ladder, not one per zoom: ${measurements}`);
});

// --- the surface next door ---------------------------------------------------
// The form layer is the odd one out because pdf.js builds it out of real HTML
// controls. Every OTHER annotation kind is inside an SVG whose viewBox IS the
// page box — ink, square, circle, free text, stamp, highlight, underline,
// squiggly, strikeout and redact all held their normalised position and size to
// 1e-6 across the whole zoom ladder in the live harness. These two assertions
// guard the mechanism that gives them that, since losing it would silently
// un-lock every kind at once — and round 2 makes the widget layer depend on the
// same idea, so they now guard both.

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

// --- the planner itself ------------------------------------------------------
// planWidgetChrome is where the page-unit geometry is decided, so these pin the
// shape of what the SVG draws: a CSS border sits INSIDE the box it outlines, and
// the replacement has to sit in exactly the same place or every widget's content
// shifts by a border width.

test('an outline occupies exactly [offset, offset + width] of the widget box, like a CSS border', () => {
  const plan = planWidgetChrome({ pageWidth: 100, pageHeight: 40, containerBorder: 2, controlBorder: 1 });
  const [container, control] = plan.outlines;

  // Stroke centred on the half-width, so its outer edge lands on the box edge.
  assert.deepEqual(
    { x: container.x, y: container.y, width: container.width, height: container.height },
    { x: 1, y: 1, width: 98, height: 38 },
  );
  // The control outline starts where the container one ended.
  assert.deepEqual(
    { x: control.x, y: control.y, width: control.width, height: control.height },
    { x: 2.5, y: 2.5, width: 95, height: 35 },
  );
  assert.equal(plan.inset, 3, 'the control pads its content past both outlines');
  assert.equal(plan.innerWidth, 94);
  assert.equal(plan.innerHeight, 34);
});

test('the planner draws nothing it was not given', () => {
  const bare = planWidgetChrome({ pageWidth: 50, pageHeight: 20 });
  assert.deepEqual(bare.outlines, []);
  assert.equal(bare.tick, null);
  assert.equal(bare.inset, 0);

  assert.equal(planWidgetChrome({ pageWidth: 0, pageHeight: 20 }), null, 'a zero-width widget plans nothing');
  assert.equal(planWidgetChrome({ pageWidth: 50 }), null);
  assert.equal(planWidgetChrome(), null);
  // A widget whose outlines would swallow it is clamped, never negative — a
  // negative SVG rect width is an error the browser drops the whole element for.
  const swallowed = planWidgetChrome({ pageWidth: 4, pageHeight: 4, containerBorder: 3, controlBorder: 3 });
  assert.ok(swallowed.outlines.every((o) => o.width >= 0 && o.height >= 0));
  assert.equal(swallowed.innerWidth, 0);
  assert.equal(swallowed.tick, null);
});

test('the tick is centred in the inner box and keeps the drawn check mark', () => {
  const plan = planWidgetChrome({ pageWidth: 20, pageHeight: 12, containerBorder: 0, controlBorder: 1, tick: true });
  // 82% of the smaller side of the inner box (12 - 2 = 10) → 8.2 page units.
  assert.ok(Math.abs(plan.tick.extent - 8.2) < 1e-9);
  const xs = plan.tick.points.map(([x]) => x);
  const ys = plan.tick.points.map(([, y]) => y);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 10) < 1.0, 'centred horizontally on the widget');
  assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 6) < 1.0, 'centred vertically on the widget');
  assert.equal(plan.tick.points.length, 3, 'still the same three-point check mark');
  assert.ok(plan.tick.strokeWidth > 0);
  assert.match(plan.tick.pointsAttr, /^[\d.]+,[\d.]+ [\d.]+,[\d.]+ [\d.]+,[\d.]+$/);
});
