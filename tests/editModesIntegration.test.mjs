/**
 * Cross-slice wiring for the Pan/Select edit-modes integration
 * (claude/edit-modes-integration, 2026-09-15).
 *
 * Three slices were built in parallel against main and each owned one half of
 * the same interaction surface:
 *   - claude/edit-pan-hit-layer  — LABELS every editor-bearing carrier in the
 *     DOM (data-edit-entry-kind) and surfaces it from resolveAnnotationAt.
 *   - claude/edit-pan-dblclick   — RECOGNISES the double-click / double-tap and
 *     dispatches the editor.
 *   - claude/edit-pan-forms      — keeps PDF form widgets live and off-limits
 *     to every other gesture owner.
 *
 * Merged, they have to be one system rather than three parallel ones. These
 * tests pin the seams that only exist after the merge; each slice's own
 * behaviour stays covered by its own file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  isEditEntryAnnotation,
  normalizeAnnotationEditType,
  opensTextEditor,
  resolveEditEntryKind,
  resolveEditTypeForAnnotation,
} from '../src/utils/annotationEditRoute.js';

const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const containerSource = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// 1. One routing module, carrying both slices' APIs
// ---------------------------------------------------------------------------

test('annotationEditRoute serves the dispatcher AND the hit layer from one mapping', () => {
  // Both slices created this file independently with the same rules in two
  // different shapes. The record shape won (the dispatcher logs skipReason and
  // passes a caller-supplied raw type); the hit layer's label sits on top of it
  // and must agree with it for every type, in both directions.
  for (const annotation of [
    { type: 'textbox' }, { type: 'IText' }, { type: 'text' },
    { type: 'line' }, { type: 'polygon' }, { type: 'polyline' },
    { type: 'rect', data: { type: 'counter' } },
    { type: 'circle', data: { type: 'counter' } },
    { type: 'path' }, { type: 'Path' }, { type: 'rect' }, { type: 'circle' },
    { type: 'ellipse' }, { type: 'triangle' }, { type: 'image' }, { type: 'stamp' },
    {}, null,
  ]) {
    const opensSomething = resolveEditTypeForAnnotation(annotation).editType != null;
    assert.equal(
      isEditEntryAnnotation(annotation),
      opensSomething,
      `label and route disagree for ${JSON.stringify(annotation)}`,
    );
  }
  // and the label is specific about WHICH editor, so the DOM attribute alone is
  // enough to route without re-deriving from the model
  assert.equal(resolveEditEntryKind({ type: 'Textbox' }), 'text');
  assert.equal(resolveEditEntryKind({ type: 'rect', data: { type: 'counter' } }), 'counter');
  assert.equal(resolveEditEntryKind({ type: 'polyline' }), 'poly');
  assert.equal(opensTextEditor({ type: 'IText' }), true);
  assert.equal(normalizeAnnotationEditType('IText'), 'i-text');
});

// ---------------------------------------------------------------------------
// 2. The hit layer's label is consumed, not decorative
// ---------------------------------------------------------------------------

test('the double-tap recogniser prefers the carrier the hit layer labelled', () => {
  // Where two annotations overlap the two taps can resolve different carriers.
  // The one the hit layer stamped is the one that actually opens an editor, so
  // it is tried first — ordering only, so an unlabelled carrier is still tried.
  assert.match(viewerSource, /\.sort\(\(a, b\) => \(b\.editEntryKind \? 1 : 0\) - \(a\.editEntryKind \? 1 : 0\)\);/);
  // and the label is in the one diagnostic line that answers "did my
  // double-click register, and on what?"
  assert.match(viewerSource, /\[EditEntryGesture\][\s\S]{0,200}editEntryKind=\$\{hit\.editEntryKind\}/);
});

// ---------------------------------------------------------------------------
// 3. A live form widget outranks the edit-entry gesture
// ---------------------------------------------------------------------------

test('a double-click on a live form widget never opens an annotation editor', () => {
  // The widget owns its own double-click (select-a-word in a text field, a fast
  // double toggle on a checkbox). The recogniser's DOM bail-out only catches
  // the control itself; a click on the section padding would otherwise reach an
  // annotation that merely overlaps the field's box.
  const recogniser = viewerSource.slice(
    viewerSource.indexOf('const tracker = createDoubleTapTracker();'),
    viewerSource.indexOf("window.addEventListener('pointercancel', onCancel, true);"),
  );
  assert.ok(recogniser.length > 0, 'the double-tap recogniser was not found');
  const bail = recogniser.indexOf('isLiveFormWidgetTarget(event.target)');
  const hitTest = recogniser.indexOf('const hit = resolveAnnotationAt(event);');
  assert.ok(bail > 0, 'the recogniser must consult isLiveFormWidgetTarget');
  assert.ok(bail < hitTest, 'the widget bail-out must run before the hit test');
});

test('one definition of "this pointer belongs to a form control" survived the merge', () => {
  // The hit-layer slice inlined the selector in PdfjsViewerContainer; the forms
  // slice extracted it. After the merge the helper is the only copy, and the
  // separate pan-escape marker stays a separate concern.
  assert.match(containerSource, /import \{ isLiveFormWidgetTarget \} from '\.\.\/utils\/formWidgetPointerTargets\.js'/);
  assert.equal(
    (containerSource.match(/\.pdfjsFormLayer\[data-interactive="true"\] section/g) || []).length,
    0,
    'the inlined widget selector must be gone from the container — the helper owns it',
  );
  assert.match(containerSource, /\[data-pan-interactive="true"\]/);
});

// ---------------------------------------------------------------------------
// 4. Both edit entries keep the tool the gesture started in
// ---------------------------------------------------------------------------

test('an editor opened from EITHER entry puts Pan back after the quick-click', () => {
  // Drawboard parity: a double-click in Pan opens the editor and leaves Pan
  // armed. Our Pan single-click auto-arms Select, so the first of the two
  // clicks flips the tool and the edit entry has to flip it back.
  //
  // The dblclick slice did that inside its pointer recogniser only. The
  // hit-layer slice separately armed the SVG layer's NATIVE onDoubleClick under
  // Pan — a second entry, with no restore. Reproduced live on 2026-09-15: the
  // first double-click after a fresh load took the native route and stranded
  // the user in Rectangle Select. The restore now lives in the one dispatcher
  // both entries call.
  assert.match(viewerSource, /const noteEditEntryOpened = \(\) => \{[\s\S]{0,700}queueMicrotask\(\(\) => setActiveTool\('pan'\)\);/);
  // called on BOTH branches of the dispatcher — callout and plain annotation
  assert.equal((viewerSource.match(/\n\s*noteEditEntryOpened\(\);/g) || []).length, 2);
  assert.match(viewerSource, /handleRequestCalloutEditMode\(annotationIndex, pageNumber, \{ caretAnchor \}\);\s*\n\s*noteEditEntryOpened\(\);/);
});

test('the Pan quick-click cannot re-arm Select behind an editor that just opened', () => {
  // The quick-click listener re-subscribes on every tool change, so whether it
  // runs before or after the edit entry flips run to run — and when it runs
  // after, it is still holding a stale `activeTool === 'pan'` closure.
  const effect = viewerSource.slice(
    viewerSource.indexOf('const QUICK_CLICK_PX = 4;'),
    viewerSource.indexOf("window.addEventListener('pointerdown', onDown, true);"),
  );
  // MECHANISM CHANGED 2026-09-15, same day it was written: this asserted a
  // 600ms timer (`Date.now() - editEntryOpenedAtRef.current < ...`). The timer
  // also swallowed the NEXT tap — dismiss the editor, tap another annotation
  // straight away, and nothing was selected. It is a latch now: raised when an
  // editor opens, dropped on the first press after that editor has closed.
  assert.match(effect, /if \(panQuickClickSuppressedRef\.current\) return;/);
  // and it records when it auto-armed Select, so the dispatcher knows this is
  // the same gesture — on the callout branch as well as the annotation one
  assert.equal((effect.match(/panQuickClickAutoSelectAtRef\.current = Date\.now\(\);/g) || []).length, 2);
});

test('the quick-click starts answering again the moment the editor is gone', () => {
  // No dead zone after a dismiss. The latch is dropped by the press itself,
  // gated on the editor really being unmounted (openEditTargetRef mirrors it,
  // callouts included) — never on a clock, which is what stranded the user.
  const effect = viewerSource.slice(
    viewerSource.indexOf('const QUICK_CLICK_PX = 4;'),
    viewerSource.indexOf("window.addEventListener('pointerdown', onDown, true);"),
  );
  assert.match(
    effect,
    /panQuickClickSuppressedRef\.current && !openEditTargetRef\.current[\s\S]{0,120}panQuickClickSuppressedRef\.current = false;/,
  );
  assert.doesNotMatch(effect, /PAN_EDIT_ENTRY_RESTORE_MS/,
    'a time window must never gate the quick-click again');
  // The editor entry is what raises it, on both branches of the dispatcher.
  assert.match(viewerSource, /panQuickClickSuppressedRef\.current = true;/);
});
