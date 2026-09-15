/**
 * FAILING REGRESSION TEST — the double-tap edit recogniser is not multi-touch safe.
 *
 * Reproduced live 2026-09-15 in the in-app browser pane under mobile emulation
 * (375x812, coarse pointer, data-mobile-pdf-surface="true"), Pan armed, on a
 * committed text annotation:
 *
 *   1. thumb lands on the text box; index finger lands ~8px away; the index
 *      slides outwards (an ordinary pinch-to-zoom-in); the thumb lifts first.
 *   2. ~160ms later the user taps that same spot ONCE.
 *   -> the text editor opens.
 *
 *   [EditEntryGesture] tool=pan pointer=touch kind=annotation key=annotation:1:4 double=false
 *   [EditEntryGesture] tool=pan pointer=touch kind=annotation key=annotation:1:4 double=true firstTapTool=pan
 *   [App p1] edit START — type=textbox, editType=text, idx=4
 *
 * Cause: the recogniser effect in src/PDFViewer.jsx keeps ONE `downAt` slot with
 * no pointerId, so a second finger's pointerdown overwrites the first finger's.
 * When the anchored finger lifts first, its pointerup distance is measured
 * against the OTHER finger's down point. Two fingers that start within
 * DOUBLE_TAP_TOUCH_SLOP_PX (12) — the natural start of a pinch-out — therefore
 * pass the "did this gesture move?" test and the pinch is stored in the tracker
 * as a tap. The user's next genuine tap pairs with that phantom and opens an
 * editor nobody asked for.
 *
 * Measured envelope live: a phantom tap is recorded for a starting finger gap of
 * 6 / 10 / 12px and not for 14 / 20 / 30px — exactly the touch slop.
 *
 * The fix is to key the down record by pointerId (and to drop the pending pair
 * whenever more than one pointer is down), so a multi-touch gesture can never be
 * measured as a tap. This test pins that contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

/** The window-capture double-tap recogniser effect, sliced out of PDFViewer. */
function readRecogniserSource() {
  const start = viewerSource.indexOf('const tracker = createDoubleTapTracker();');
  const end = viewerSource.indexOf("window.addEventListener('pointercancel', onCancel, true);");
  assert.ok(start > 0 && end > start, 'the double-tap recogniser was not found in PDFViewer.jsx');
  return viewerSource.slice(start, end);
}

test('the double-tap recogniser tracks the pointer it measures', () => {
  const recogniser = readRecogniserSource();
  // The down record must be per-pointer. A single shared `downAt` is what lets a
  // second finger overwrite the first and turn a pinch into a tap.
  assert.match(
    recogniser,
    /pointerId/,
    'the recogniser never looks at event.pointerId, so a second finger overwrites the first '
    + "finger's down point and a pinch whose fingers start within the touch slop is measured as a tap",
  );
});

test('a gesture with a second finger down cannot be registered as a tap', () => {
  const recogniser = readRecogniserSource();
  // Either shape is fine: remember one record per pointerId and match the
  // pointerup to its OWN pointerdown, or drop the gesture outright as soon as a
  // second pointer arrives. What must not survive is a single-slot `downAt`
  // that any later pointerdown can clobber.
  const perPointerRecord = /downAt(?:Ref)?\s*(?:=|\.set\()[\s\S]{0,200}pointerId/.test(recogniser)
    || /new Map\(\)/.test(recogniser);
  const multiTouchBailOut = /(?:activePointers|downPointers|pointersDown)[\s\S]{0,120}(?:size|length)\s*>\s*1/
    .test(recogniser);
  assert.ok(
    perPointerRecord || multiTouchBailOut,
    'the recogniser keeps one shared `downAt` and never checks how many pointers are down, so an '
    + 'anchored two-finger pinch whose fingers start <12px apart leaves a phantom tap in the '
    + 'tracker and the next single tap opens the editor (reproduced live in mobile emulation)',
  );
});
