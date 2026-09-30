// textEditEscapeCommit.test.mjs — the "Escape keeps your text" contract.
//
// Drawboard PDF closes a text editor on Escape and KEEPS what you typed
// (measured in the 2026-09-16 web reference pass). Survey used to throw it
// away, and the researcher reproduced the loss twice from scratch, once losing
// the note across a reload as well. These tests guard the three moving parts of
// the fix so it cannot silently regress:
//
//   1. TextEditOverlay's Escape branch commits (and commits synchronously).
//   2. PDFViewer's select-family Escape listener keeps its hands off a live
//      editor, so it can never unmount the editor before that commit lands.
//   3. The tick/cross pair: tick commits, cross discards, and both are sized
//      and placed for a finger, above the on-screen keyboard.
//
// Source-level assertions, in the same spirit as the PDFViewer parked-logic
// guards: the behaviour lives in React event wiring that the Node runner has no
// DOM to exercise, so the contract is pinned against the source text.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { buildNewTextCommitJSON } from '../src/utils/textEditCommit.js';

const overlaySrc = readFileSync(
  new URL('../src/components/TextEditOverlay.jsx', import.meta.url),
  'utf8',
);
const viewerSrc = readFileSync(
  new URL('../src/PDFViewer.jsx', import.meta.url),
  'utf8',
);

/** The body of the overlay's document-capture Escape handler. */
function escapeHandlerBody() {
  const marker = "if (e.key === 'Escape') {";
  const start = overlaySrc.indexOf(marker);
  assert.ok(start > -1, 'TextEditOverlay must still handle Escape itself');
  return overlaySrc.slice(start, start + 260);
}

test('Escape commits the typed text instead of discarding it', () => {
  const body = escapeHandlerBody();
  assert.match(
    body,
    /commitRef\.current\(/,
    'Escape must run the commit path — the whole point of the Drawboard contract',
  );
  assert.doesNotMatch(
    body,
    /cancelRef\.current\(/,
    'Escape must never route to the cancel path: that is the data-loss bug',
  );
});

test('the Escape commit is synchronous so it beats the editor unmounting', () => {
  // The app-level Escape listener is registered on window/capture and runs
  // first; it can null editingAnnotation in the same event. flushSync puts the
  // annotation into the page JSON before React tears the overlay down, which is
  // what makes the note survive a reload rather than only look committed.
  assert.match(escapeHandlerBody(), /commitRef\.current\(\{\s*flush:\s*true\s*\}\)/);
});

test('an empty new box leaves nothing behind when Escape closes it', () => {
  // The commit builder is the gate: blank new text yields no annotation at all.
  assert.equal(buildNewTextCommitJSON({
    text: '', left: 0, top: 0, innerWrapWidth: 148, naturalInnerHeight: 21,
  }), null);
  assert.equal(buildNewTextCommitJSON({
    text: '  \n ', left: 0, top: 0, innerWrapWidth: 148, naturalInnerHeight: 21,
  }), null);
  // ...and the overlay turns that null into a plain close, never a write.
  const start = overlaySrc.indexOf('json = buildNewTextCommitJSON({');
  assert.ok(start > -1);
  const region = overlaySrc.slice(start, start + 1400);
  assert.match(
    region,
    /if \(!json\) \{[\s\S]{0,220}onEditCancel\(\);\s*\n\s*return;/,
    'a blank new box must close without adding an annotation',
  );
});

test('the app-level Escape listener stands down while an editor is open', () => {
  const start = viewerSrc.indexOf('// UX: Escape and grey-page backdrop clicks clear every selection mode alike.');
  assert.ok(start > -1, 'the select-family clear listener must still exist');
  const region = viewerSrc.slice(start, start + 2600);
  const guard = region.match(/event\.target\?\.closest\?\.\('([^']+)'\)\) return;/);
  assert.ok(guard, 'the clear listener must keep its early-out guard');
  const selector = guard[1];
  // contenteditable="plaintext-only" is what TextEditOverlay uses, so a guard
  // written as [contenteditable="true"] misses it entirely — that is how Escape
  // used to reach this listener and unmount the editor mid-type.
  assert.doesNotMatch(
    selector,
    /\[contenteditable="true"\]/,
    'guard must match every contenteditable flavour, not only "true"',
  );
  assert.match(selector, /\[contenteditable\]:not\(\[contenteditable="false"\]\)/);
  assert.match(selector, /\[data-text-edit-overlay\]/);
});

test('the open editor shows a tick that commits and a cross that discards', () => {
  const start = overlaySrc.indexOf('data-text-edit-actions');
  assert.ok(start > -1, 'the tick/cross pair must be rendered');
  const region = overlaySrc.slice(start, start + 2600);

  const cross = region.slice(region.indexOf('Discard changes'));
  assert.match(
    cross.slice(0, 400),
    /cancelRef\.current\(\)/,
    'the cross reverts the edit (and removes a brand-new box)',
  );

  const tick = region.slice(region.indexOf('Keep text'));
  assert.match(
    tick.slice(0, 400),
    /commitRef\.current\(\{\s*flush:\s*true\s*\}\)/,
    'the tick commits, the same way Escape and an outside click do',
  );
});

test('the tick/cross pair is a finger-sized target at every zoom', () => {
  // RULED 2026-09-23 (owner: "sized a little smaller"): 20px visible disc.
  assert.match(overlaySrc, /const ACTION_BUTTON_VISUAL = 20;/, 'visible disc');
  assert.match(overlaySrc, /const ACTION_TOUCH_TARGET = 44;/, "Apple's minimum tap target");
  // Screen-constant, not page units: these are controls, like handles and the
  // marquee, so they must not grow and shrink with the document zoom.
  assert.match(overlaySrc, /position: 'fixed',\s*\n\s*left: actionAnchor\.left/);
});

test('the pair is clamped to the visual viewport so the keyboard cannot bury it', () => {
  const start = overlaySrc.indexOf('const vv = typeof window !== \'undefined\' ? window.visualViewport : null;');
  assert.ok(start > -1, 'placement must read visualViewport, not window.innerHeight');
  const region = overlaySrc.slice(start, start + 1600);
  assert.match(region, /vv\?\.height/);
  assert.match(region, /vv\?\.offsetTop/);
  // Prefer under the box, flip above it when the keyboard owns that space.
  assert.match(region, /const lowestAllowed = vTop \+ vHeight - ACTION_TOUCH_TARGET - ACTION_EDGE_MARGIN;/);
  assert.match(region, /const above = rect\.top - ACTION_BOX_GAP - ACTION_TOUCH_TARGET;/);
  // Flipping above the box is only allowed when "above" is itself on screen —
  // a box low on a phone page has the keyboard on both sides of it, and the
  // pair then pins to the last visible row rather than vanishing under it.
  assert.match(region, /top = \(above >= highestAllowed && above <= lowestAllowed\) \? above : lowestAllowed;/);
  assert.match(region, /top = Math\.max\(highestAllowed, Math\.min\(lowestAllowed, top\)\);/);
  // And the pair re-measures when the keyboard opens or the page scrolls.
  assert.match(overlaySrc, /window\.visualViewport\?\.addEventListener\?\.\('resize', schedule\)/);
});

// 2026-09-30: the editor's own reveal moved into the ONE shared keyboard
// mechanism (src/mobile/keyboardViewport.js), which every field now uses. The
// guarantees are the same: a URL-bar collapse is not a keyboard, and the scroll
// is the measured overflow, nothing more. (Behaviour: tests/mobileKeyboardViewport.)
test('opening the keyboard scrolls the box back into view by the minimum', () => {
  const start = overlaySrc.indexOf('// On-screen keyboard reveal.');
  assert.ok(start > -1, 'the keyboard reveal must exist');
  assert.match(overlaySrc, /data-keyboard-reveal-target=""/);
  const shared = readFileSync(new URL('../src/mobile/keyboardViewport.js', import.meta.url), 'utf8');
  assert.match(shared, /covered < KEYBOARD_MIN_INSET_PX\) return 0;/, 'a URL-bar collapse must not count as a keyboard');
  assert.match(shared, /export const KEYBOARD_MIN_INSET_PX = 80;/);
  assert.match(shared, /delta = Math\.max\(0, Math\.min\(rect\.bottom - bottom, rect\.top - top\)\);/, 'scroll by the measured overflow, nothing more');
});

test('the caret and preventScroll focus behaviour from the edit-modes work is intact', () => {
  // These two are load-bearing for the recent edit-modes pass; the tick/cross
  // work must not have disturbed them.
  assert.match(overlaySrc, /el\.focus\(\{ preventScroll: true \}\)/);
  assert.match(overlaySrc, /editableRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(overlaySrc, /const placeCaret = \(attempt\) => \{/);
});
