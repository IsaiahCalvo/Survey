// Form widgets stay live in Pan and in EVERY Select-family mode.
//
// THE DEFECT THIS LOCKS DOWN (measured live on prog-07-form-fields.pdf before
// the fix, branch claude/edit-pan-forms):
//
//   * Under Rectangle/Lasso Select the SVG annotation root is
//     `pointer-events: auto` across the whole page — that root is what
//     marquee-selects blank pixels — and its wrapper sits at zIndex 100 in the
//     same stacking context as the form layer, which sat at zIndex 12.
//     elementsFromPoint over a checkbox returned the svg root FIRST and the
//     <input> second, so not one widget click ever reached a control.
//   * Under Text Select the layer was not even armed (`interactive` covered
//     only pan + select), so a form field was un-fillable in that mode.
//   * Nothing told the pan-drag start, the mobile touch capture, the pan
//     quick-click selection or the pan hover glow that a form control is not
//     page background, so each of them could claim a widget's pointer.
//
// Reference behaviour (Drawboard PDF, verified by two researchers on the web
// build and the Mac app): "Form fields are fully live in BOTH modes: a single
// click toggles a checkbox and a single click focuses a text field for typing,
// with no tool change and no selection chrome. Widgets are never selectable as
// annotations."

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LIVE_FORM_WIDGET_SELECTOR,
  isLiveFormWidgetTarget,
} from '../src/utils/formWidgetPointerTargets.js';

const formLayerSource = readFileSync(new URL('../src/components/PdfjsFormLayer.jsx', import.meta.url), 'utf8');
const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const containerSource = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');

// --- the layer wins the hit test -------------------------------------------

// ASSERTION DELIBERATELY REVERSED 2026-09-15, same day it was written.
// It originally demanded z > 100 — "the widget layer must clear the annotation
// wrapper". That was the wrong contract and it shipped a regression: at 101 the
// widget layer painted OVER the per-page SVG overlay, so every annotation drawn
// across a form field went invisible and unclickable, and a marquee started
// inside a field's box turned into native text selection (six adversarial
// verifiers, prog-07-form-fields.pdf). Paint order and hit test are separate
// questions: markup always paints on top, and the widget wins the CLICK by
// pointer routing instead (SVGAnnotationLayer hands a press that never moved
// down to the control). tests/formLayerAnnotationStacking.test.mjs guards the
// paint order; this guards the same number from the other side.
test('the widget layer paints under the SVG annotation wrapper, at one fixed z', () => {
  // The wrapper it has to stay under. If this number ever moves, the widget
  // layer has to move with it or markup starts disappearing over fields again.
  assert.match(viewerSource, /pointerEvents: 'none',\s*\n\s*zIndex: 100,/,
    'the SVG annotation wrapper is expected at zIndex 100');
  const declared = formLayerSource.match(/const FORM_LAYER_Z_INDEX = (\d+);/);
  assert.ok(declared, 'the widget layer z-index must be a named constant, not a literal in the JSX');
  const z = Number(declared[1]);
  assert.ok(z < 100, `the widget layer must stay under the annotation wrapper, got ${z}`);
  assert.match(formLayerSource, /style=\{\{ position: 'absolute', inset: 0, zIndex: FORM_LAYER_Z_INDEX \}\}/);
});

test('the annotation overlay hands a stationary press down to the widget under it', () => {
  const layerSource = readFileSync(
    new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8',
  );
  // Routing, not stacking, is what makes a widget click work under Select.
  assert.match(layerSource, /import \{ forwardClickToFormWidget, liveFormWidgetAtPoint \}/);
  // Only a press on the SVG root itself: a press on an annotation hit target is
  // the user clicking their own markup, and markup wins.
  assert.match(layerSource, /e\.target === svgRef\.current[\s\S]{0,200}liveFormWidgetAtPoint\(e\.clientX, e\.clientY\)/);
  // ...and only a press that never travelled: a drag is a marquee or a lasso,
  // which must still work when it starts inside a field's box.
  assert.match(layerSource, /Math\.hypot\(e\.clientX - pendingWidget\.x[\s\S]{0,200}forwardClickToFormWidget\(pendingWidget\.widget\)/);
});

test('a marquee that starts inside a field does not drag-select the field text', () => {
  // MEASURED LIVE 2026-09-15 on prog-07-form-fields.pdf, Rectangle Select:
  // a rubber band begun inside the multiline 'notes' box selected the two
  // annotations it swept, correctly — and ALSO left blue text highlight strewn
  // across them ("OVER FIELD / EDIT ME / LOW CALLOUT"). The identical drag
  // begun one pixel outside the box left none. The browser anchors a selection
  // at the nearest selectable text and inside the box that is the field's own
  // value, so the anchor formed there and extended through the SVG text.
  //
  // Reference behaviour (Drawboard PDF): a rubber band is a rubber band
  // wherever it starts, and nothing highlights as text. Dragging out a widget's
  // text is not on offer here regardless — the overlay paints above the widget
  // layer, so the control never receives the press.
  const layerSource = readFileSync(
    new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8',
  );
  // The guard is armed with the pending press, in the same branch.
  assert.match(
    layerSource,
    /liveFormWidgetAtPoint\(e\.clientX, e\.clientY\)[\s\S]{0,400}armFormWidgetSelectionGuard\(\)/,
    'arm the selectstart guard where the widget press is recorded',
  );
  // It cancels selectstart rather than the pointerdown: cancelling pointerdown
  // would suppress the compatibility mouse events the rest of the viewer reads.
  assert.match(
    layerSource,
    /addEventListener\('selectstart', block, true\)/,
    'the guard must cancel selectstart, in the capture phase',
  );
  assert.doesNotMatch(
    layerSource.match(/const armFormWidgetSelectionGuard[\s\S]{0,400}?\}, \[\]\);/)?.[0] ?? '',
    /pointerdown/,
    'never arm this by cancelling pointerdown',
  );
  // And it is released on every way the gesture can end, plus unmount, so
  // ordinary text selection everywhere else is untouched.
  for (const ending of [
    /onPointerUp=\{isInteractive[\s\S]{0,400}?releaseFormWidgetSelectionGuard\(\)/,
    /onPointerCancel=\{isInteractive[\s\S]{0,200}?releaseFormWidgetSelectionGuard\(\)/,
    /useEffect\(\(\) => releaseFormWidgetSelectionGuard, \[releaseFormWidgetSelectionGuard\]\)/,
  ]) assert.match(layerSource, ending, `the guard must be released: ${ending}`);
});

test('the z-index is not tool-dependent — a widget never swaps above and below markup', () => {
  const root = formLayerSource.slice(formLayerSource.indexOf('className="pdfjsFormLayer annotationLayer"'));
  const style = root.slice(root.indexOf('style='), root.indexOf('/>'));
  assert.doesNotMatch(style, /interactive|activeTool|\?/,
    'a conditional z-index would make widgets jump over markup as the armed tool changes');
});

test('raising the layer cannot steal blank page pixels', () => {
  // Only `section` children are ever `auto`, and only while interactive. The
  // root staying `pointer-events: none` is what keeps marquee select, lasso,
  // pan-drag and native text selection working over everything else.
  assert.match(formLayerSource, /\.pdfjsFormLayer \{\s*\n\s*pointer-events: none;/);
  assert.match(formLayerSource, /\.pdfjsFormLayer section \{[^}]*pointer-events: auto/);
  assert.match(formLayerSource, /\.pdfjsFormLayer\[data-interactive="false"\] section \{ pointer-events: none; \}/);
});

// --- the layer is armed in every mode that is not a creation tool -----------

test('widgets are armed in Pan and in every Select-family mode', () => {
  const call = viewerSource.slice(
    viewerSource.indexOf('<PdfjsFormLayer'),
    viewerSource.indexOf('/>', viewerSource.indexOf('<PdfjsFormLayer')),
  );
  assert.match(call, /interactive=\{activeTool === 'pan' \|\| activeTool === 'select' \|\| activeTool === 'text-select'\}/);
  // Rectangle and Lasso both report activeTool === 'select' (they differ only
  // in selectionMode), so 'select' covers both without naming either.
  assert.match(viewerSource, /const activateSelectFamilyMode = useCallback\(\(mode\) => \{[\s\S]{0,200}setActiveTool\(next\.activeTool\)/);
});

test('creation tools still take the page back', () => {
  const call = viewerSource.slice(
    viewerSource.indexOf('<PdfjsFormLayer'),
    viewerSource.indexOf('/>', viewerSource.indexOf('<PdfjsFormLayer')),
  );
  for (const tool of ['pen', 'text', 'counter', 'eraser', 'rectangle']) {
    assert.doesNotMatch(call, new RegExp(`'${tool}'`),
      `${tool} must NOT arm the widget layer — a stroke started over a field would be eaten`);
  }
});

// --- one definition of "this pointer belongs to a form control" -------------

test('the live-widget selector is gated on the layer actually being armed', () => {
  assert.equal(LIVE_FORM_WIDGET_SELECTOR, '.pdfjsFormLayer[data-interactive="true"] section');
});

test('isLiveFormWidgetTarget resolves text nodes and tolerates junk', () => {
  const calls = [];
  const element = { closest: (sel) => { calls.push(sel); return sel === LIVE_FORM_WIDGET_SELECTOR ? {} : null; } };
  assert.equal(isLiveFormWidgetTarget(element), true);
  assert.equal(calls[0], LIVE_FORM_WIDGET_SELECTOR);
  // A touch target can be a text node; it must be resolved to its parent.
  assert.equal(isLiveFormWidgetTarget({ nodeType: 3, parentElement: element }), true);
  assert.equal(isLiveFormWidgetTarget({ nodeType: 3, parentElement: null }), false);
  assert.equal(isLiveFormWidgetTarget({ closest: () => null }), false);
  assert.equal(isLiveFormWidgetTarget(null), false);
  assert.equal(isLiveFormWidgetTarget(undefined), false);
  assert.equal(isLiveFormWidgetTarget({}), false);
});

// --- every gesture owner asks it before claiming the pointer ----------------

test('a pan drag never starts on a form control', () => {
  const handler = containerSource.slice(
    containerSource.indexOf('const onPointerDown = (event) => {'),
    containerSource.indexOf('panVelocityRef.current.start(event.clientX'),
  );
  // The bail-out must come BEFORE preventDefault: preventing pointerdown on a
  // widget suppresses its focus, click and change sequence entirely on desktop.
  const bail = handler.indexOf('isLiveFormWidgetTarget(event.target)');
  const prevent = handler.indexOf('event.preventDefault()');
  assert.ok(bail > 0, 'the pan pointerdown must consult isLiveFormWidgetTarget');
  assert.ok(bail < prevent, 'the widget bail-out must run before preventDefault');
});

test('a mobile tap on a widget is not preventDefaulted into a pan', () => {
  const guard = containerSource.slice(
    containerSource.indexOf('const isNativeInteractionTarget = (target) => {'),
    containerSource.indexOf('const onTouchStart = (event) => {'),
  );
  assert.match(guard, /isLiveFormWidgetTarget\(nativeTarget\)/);
  // The bail must happen before ANY preventDefault: preventing the touch
  // sequence on a widget kills its focus/click/change chain outright.
  // (flickPan 2026-10-07: the head now also stops a running glide first -
  // `cancelPanInertia()` no longer marks its end, the first preventDefault does.)
  const touchStartHead = containerSource.slice(
    containerSource.indexOf('const onTouchStart = (event) => {'),
    containerSource.indexOf('event.preventDefault();',
      containerSource.indexOf('const onTouchStart = (event) => {')),
  );
  assert.match(touchStartHead, /if \(isNativeInteractionTarget\(event\.target\)\) \{/,
    'a touch on a widget must reach the control, never be cancelled into a pan');
  assert.match(touchStartHead, /if \(isNativeInteractionTarget\(event\.target\)\) \{[\s\S]*?return;\s*\}/,
    'the widget bail returns before the first preventDefault');
});

test('a drag that starts on a widget still pans the page on touch', () => {
  // ASSERTION ADDED 2026-09-15 alongside a narrowing of the one above, which
  // used to pin the exact line `if (isNativeInteractionTarget(...)) return;`.
  // That shape was too strict AND too weak: it made a widget a dead patch you
  // could not scroll off (touch-action is none on the scroller, so nothing
  // moved at all), while saying nothing about the tap actually surviving.
  // Reference behaviour (Drawboard PDF on a phone): a tap belongs to the
  // control, a drag belongs to the page.
  const touchStart = containerSource.slice(
    containerSource.indexOf('const onTouchStart = (event) => {'),
    containerSource.indexOf('const onTouchMove = (event) => {'),
  );
  assert.match(touchStart, /widgetTapCandidate = \{ startX: touch\.clientX, startY: touch\.clientY \}/);
  const touchMove = containerSource.slice(
    containerSource.indexOf('const onTouchMove = (event) => {'),
    containerSource.indexOf('const onTouchEnd = (event) => {'),
  );
  // Under the slop it is still a tap and the control is left alone...
  assert.match(touchMove, /travelled <= WIDGET_TAP_TO_PAN_SLOP_PX\) return;/);
  // ...past it, the gesture becomes an ordinary page pan.
  assert.match(touchMove, /widgetTapPromotedToPan = true;[\s\S]{0,700}schedulePan\(dx, dy\);/);
});

test('a pan click on a widget fills the field and selects nothing', () => {
  const effect = viewerSource.slice(
    viewerSource.indexOf('const QUICK_CLICK_PX = 4;'),
    viewerSource.indexOf("window.addEventListener('pointerdown', onDown, true);"),
  );
  const bail = effect.indexOf('isLiveFormWidgetTarget(e.target)');
  const hitTest = effect.indexOf('const hit = resolveAnnotationAt(e);');
  assert.ok(bail > 0, 'the pan quick-click must consult isLiveFormWidgetTarget');
  assert.ok(bail < hitTest,
    'the bail-out must precede the hit test, or an annotation merely overlapping the widget box switches tool mid-typing');
  // Owner 2026-10-02 (Drawboard rule 2): a Pan click picks the mark and Pan
  // stays armed, so this effect no longer switches tool; it is still the one
  // that picks.
  assert.ok(effect.includes('setPendingSvgSelection'), 'sanity: this is the pan quick-pick effect');
});

test('the pan hover glow leaves a form control its own affordance', () => {
  const applyHover = viewerSource.slice(
    viewerSource.indexOf('const applyHover = () => {'),
    viewerSource.indexOf("document.body.style.cursor = 'pointer'"),
  );
  const bail = applyHover.indexOf('isLiveFormWidgetTarget(e.target)');
  const hitTest = applyHover.indexOf('const hit = resolveAnnotationAt(e, {');
  assert.ok(bail > 0 && bail < hitTest, 'the hover glow must bail on widgets before hit-testing');
  // Bailing has to clear whatever the previous frame left behind, or the glow
  // and the `pointer` cursor stick while the pointer sits inside the field.
  const bailBlock = applyHover.slice(bail, hitTest);
  assert.match(bailBlock, /setPendingSvgHover/);
  assert.match(bailBlock, /document\.body\.style\.cursor = ''/);
});
