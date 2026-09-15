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
