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

import { createDoubleTapTracker } from '../src/utils/doubleTapEditEntry.js';
import { createMultiTouchTapGate } from '../src/utils/multiTouchTapGate.js';

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

// ---------------------------------------------------------------------------
// The same recogniser, driven finger by finger.
//
// The pointer bookkeeping and the tap pairing are the real modules; only the
// five decision lines of PDFViewer's pointerup handler are mirrored here (the
// source-parity test below pins that mirror to the live code).
// ---------------------------------------------------------------------------

const TOUCH_SLOP_PX = 12;

function createRecogniser() {
  const downPointers = createMultiTouchTapGate();
  const tracker = createDoubleTapTracker();
  let editorsOpened = 0;
  let clock = 0;
  return {
    get editorsOpened() { return editorsOpened; },
    /** A finger lands. */
    down(pointerId, x, y) {
      downPointers.press(pointerId, { x, y });
      if (downPointers.size > 1) {
        downPointers.bail();
        tracker.reset();
      }
    },
    /** A finger lifts, `after` ms later. */
    up(pointerId, x, y, after = 120) {
      clock += after;
      const { start, bailed } = downPointers.lift(pointerId);
      if (bailed) { tracker.reset(); return; }
      if (!start) return;
      if (Math.hypot(x - start.x, y - start.y) > TOUCH_SLOP_PX) { tracker.reset(); return; }
      const { isDoubleTap } = tracker.register({
        key: 'annotation:1:4',
        target: { kind: 'annotation', pageNumber: 1, annotationIndex: 4 },
        x,
        y,
        t: clock,
        pointerType: 'touch',
        tool: 'pan',
      });
      if (isDoubleTap) editorsOpened += 1;
    },
    /** One finger down and straight back up at the same spot. */
    tap(pointerId, x, y, after = 120) {
      this.down(pointerId, x, y);
      this.up(pointerId, x, y, after);
    },
  };
}

test('a single finger tapping twice still opens the editor', () => {
  // Guards the harness itself: if this ever stops opening an editor, the
  // multi-touch tests below prove nothing.
  const r = createRecogniser();
  r.tap(1, 200, 300);
  r.tap(1, 201, 302, 140);
  assert.equal(r.editorsOpened, 1);
});

test('a third finger tapping mid-pinch cannot open the editor', () => {
  const r = createRecogniser();
  // pinch: thumb lands, index lands 8px away (inside the touch slop) and slides
  // outwards, then the THUMB lifts first while the index still rests.
  r.down(1, 200, 300);
  r.down(2, 208, 300);
  r.up(1, 200, 300, 200);
  // a third finger now taps the same spot twice while finger 2 is still down
  r.tap(3, 200, 300, 150);
  r.tap(3, 201, 301, 140);
  assert.equal(
    r.editorsOpened,
    0,
    'the bail must stay latched while ANY finger is still down — clearing the '
    + 'down records when the second finger arrived made the first lift read as '
    + '"every finger is up", and the taps that followed paired normally',
  );
});

test('the bail lifts once every finger is up, so ordinary taps still work', () => {
  const r = createRecogniser();
  r.down(1, 200, 300);
  r.down(2, 208, 300);
  r.up(1, 200, 300, 200);
  r.tap(3, 200, 300, 150);
  r.up(2, 208, 300, 150); // last finger off the glass
  assert.equal(r.editorsOpened, 0);
  // and a genuine double tap after the gesture is over is honoured
  r.tap(1, 200, 300, 400);
  r.tap(1, 201, 301, 140);
  assert.equal(r.editorsOpened, 1);
});

test('PDFViewer drives that same gate, and never drops a finger that is still down', () => {
  const recogniser = readRecogniserSource();
  assert.match(recogniser, /const downPointers = createMultiTouchTapGate\(\);/);
  assert.match(recogniser, /downPointers\.press\(event\.pointerId, \{ x: event\.clientX, y: event\.clientY \}\)/);
  assert.match(recogniser, /if \(downPointers\.size > 1\) \{[\s\S]{0,400}downPointers\.bail\(\);/);
  assert.match(recogniser, /const \{ start, bailed \} = downPointers\.lift\(event\.pointerId\);/);
  assert.match(recogniser, /if \(bailed\) \{ tracker\.reset\(\); return; \}/);
  // Records are dropped one pointer at a time, as each finger actually lifts.
  assert.doesNotMatch(
    recogniser,
    /downPointers\.clear\(\)/,
    'wiping the down records when the bail latches makes the first lift look '
    + 'like "every finger is up", which unlatches the bail mid-pinch',
  );
  assert.match(viewerSource, /import \{ createMultiTouchTapGate \} from '\.\/utils\/multiTouchTapGate'/);
});
