// Long press → context menu on every touch screen (docs/GESTURE-CONTRACT.md
// L1; Drawboard touch audit 2026-10-13, T1/S2). iPads and touch laptops use the
// desktop layout now, and there the long press used to do nothing because it
// was gated on the phone layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LONG_PRESS_MS,
  LONG_PRESS_MOVE_CANCEL_PX,
  TOUCH_MENU_ROW_PX,
  contextMenuInputOf,
  createLongPressTracker,
  isTouchMenuInput,
  longPressMayArm,
  markLongPressEvent,
} from '../src/utils/touchLongPress.js';
import { DRAW_MODES } from '../src/utils/pencilMode.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { seq += 1; timers.set(seq, { fn, at: now + ms }); return seq; },
    clearTimer: (id) => { timers.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) { timers.delete(id); t.fn(); }
      }
    },
    pending: () => timers.size,
  };
}

test('the numbers: 380 ms still, 10 px slop, 44 px touch rows', () => {
  assert.equal(LONG_PRESS_MS, 380);
  assert.equal(LONG_PRESS_MOVE_CANCEL_PX, 10);
  assert.equal(TOUCH_MENU_ROW_PX, 44);
});

test('who may arm it: finger and pen by default; Pencil only = the pen only; never a mouse', () => {
  assert.equal(longPressMayArm('touch', DRAW_MODES.TOUCH), true);
  assert.equal(longPressMayArm('pen', DRAW_MODES.TOUCH), true);
  assert.equal(longPressMayArm('touch', DRAW_MODES.PEN), false, 'Pencil only: a finger navigates (P2)');
  assert.equal(longPressMayArm('pen', DRAW_MODES.PEN), true, 'Pencil only: the pen still opens the menu');
  assert.equal(longPressMayArm('mouse', DRAW_MODES.TOUCH), false);
  assert.equal(longPressMayArm('mouse', DRAW_MODES.PEN), false);
  assert.equal(longPressMayArm(undefined), false);
});

test('fires once after the delay when held still (small wobble allowed)', () => {
  const clock = fakeClock();
  const fired = [];
  const press = createLongPressTracker({ onFire: (p) => fired.push(p), setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  press.start(100, 200, 'touch');
  press.move(106, 194); // inside the 10 px slop
  clock.advance(379);
  assert.equal(fired.length, 0);
  clock.advance(1);
  assert.deepEqual(fired, [{ x: 100, y: 200, input: 'touch' }]);
  assert.equal(press.isArmed(), false);
  clock.advance(1000);
  assert.equal(fired.length, 1, 'only once');
});

test('a drag past the slop, a lift or a second finger cancels it — never mid-gesture', () => {
  const clock = fakeClock();
  const fired = [];
  const press = createLongPressTracker({ onFire: (p) => fired.push(p), setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  // Pan / stroke: moved 11 px, then held still for a long time.
  press.start(0, 0, 'touch');
  press.move(11, 0);
  clock.advance(2000);
  assert.equal(fired.length, 0);
  // Moving back inside the slop does not re-arm it.
  press.move(0, 0);
  clock.advance(2000);
  assert.equal(fired.length, 0);
  // Lift before the delay.
  press.start(0, 0, 'pen');
  clock.advance(200);
  press.cancel();
  clock.advance(2000);
  assert.equal(fired.length, 0);
  assert.equal(clock.pending(), 0);
  // A restart (the Apple Pencil's touch after its pointer) keeps one timer.
  press.start(5, 5, 'pen');
  press.start(5, 5, 'pen');
  assert.equal(clock.pending(), 1);
  clock.advance(380);
  assert.equal(fired.length, 1);
});

test('the menu learns what opened it', () => {
  const synthetic = markLongPressEvent({ type: 'contextmenu' }, 'touch');
  assert.equal(contextMenuInputOf(synthetic), 'touch');
  assert.equal(contextMenuInputOf(markLongPressEvent({}, 'pen')), 'pen');
  assert.equal(contextMenuInputOf(markLongPressEvent({}, 'mouse')), 'mouse', 'a mouse is never tagged');
  // A touch screen's own long-press contextmenu (Chrome: a PointerEvent).
  assert.equal(contextMenuInputOf({ pointerType: 'touch' }), 'touch');
  assert.equal(contextMenuInputOf({ pointerType: 'pen' }), 'pen');
  assert.equal(contextMenuInputOf({ pointerType: 'mouse' }), 'mouse');
  assert.equal(contextMenuInputOf({}), 'mouse');
  assert.equal(contextMenuInputOf(null), 'mouse');
  assert.equal(isTouchMenuInput('touch'), true);
  assert.equal(isTouchMenuInput('pen'), true);
  assert.equal(isTouchMenuInput('mouse'), false);
});

test('wiring: every touch surface arms it (not the phone flag); Pencil only and the pen are honoured', () => {
  const viewer = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(viewer, /if \(!el \|\| !touchSurface \|\| !mobileLongPressContextMenu\) return undefined;/);
  assert.doesNotMatch(viewer, /!isMobileSurface \|\| !mobileLongPressContextMenu/);
  assert.match(viewer, /longPressMayArm\(input, drawMode\(\)\)/);
  assert.match(viewer, /addEventListener\('pointerdown', onPenDown/);
  assert.match(viewer, /markLongPressEvent\(ev, input\)/);
  const pdfViewer = read('src/PDFViewer.jsx');
  assert.match(pdfViewer, /mobileLongPressContextMenu=\{activeTool === 'pan' \|\| activeTool === 'select'\}/);
  assert.doesNotMatch(pdfViewer, /mobileLongPressContextMenu=\{mobileMode &&/);
});

test('wiring: a menu opened by touch on the desktop layout gets 44 px rows; the phone menu keeps its own', () => {
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(menu, /input: contextMenuInputOf\(event\)/);
  assert.match(menu, /const touchRows = !isMobileMenu && isTouchMenuInput\(ctx\.input\);/);
  assert.match(menu, /data-touch-rows=\{touchRows \? 'true' : undefined\}/);
  const css = read('src/styles/touchTargets.css');
  assert.match(css, /\[data-annotation-context-menu\]\[data-touch-rows='true'\] \[role='menuitem'\] \{[^}]*min-height: 44px;/);
});
