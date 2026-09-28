// w58 (owner 2026-09-28) — hold Command (Mac) / Control (Windows, Linux) to
// move the selection from anywhere inside its box. These pin the key choice
// per platform (web and the Electron desktop app run the same page), the
// stuck-key safety, and the size of the move zone on a tiny mark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  isMacLikePlatform,
  isMoveModifierEvent,
  resolveModifierMoveZone,
  isPointInBoxes,
  attachMoveModifierListeners,
  getMoveModifierHeld,
} from '../src/utils/moveModifier.js';

test('Command is the key on a Mac (web and desktop app), Control elsewhere', () => {
  assert.equal(isMacLikePlatform({ platform: 'MacIntel' }), true);
  // Electron on Apple silicon still reports MacIntel; userAgentData wins when present.
  assert.equal(isMacLikePlatform({ userAgentData: { platform: 'macOS' }, platform: '' }), true);
  assert.equal(isMacLikePlatform({ platform: 'Win32' }), false);
  assert.equal(isMacLikePlatform({ userAgentData: { platform: 'Windows' } }), false);
  assert.equal(isMacLikePlatform({ platform: 'Linux x86_64' }), false);
  assert.equal(isMacLikePlatform(null), false);

  // Mac: Meta counts, Control does not (Control+click is the right-click menu there).
  assert.equal(isMoveModifierEvent({ metaKey: true, ctrlKey: false }, true), true);
  assert.equal(isMoveModifierEvent({ metaKey: false, ctrlKey: true }, true), false);
  // Windows / Linux: Control counts, the Windows key does not.
  assert.equal(isMoveModifierEvent({ metaKey: false, ctrlKey: true }, false), true);
  assert.equal(isMoveModifierEvent({ metaKey: true, ctrlKey: false }, false), false);
  // AltGr (Ctrl + Alt) types @ / { on many Windows layouts: not the move key.
  assert.equal(isMoveModifierEvent({ ctrlKey: true, altKey: true }, false), false);
  assert.equal(isMoveModifierEvent(null, true), false);
});

function fakeWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    fire(type, event = {}) {
      for (const fn of Array.from(listeners.get(type) || [])) fn(event);
    },
    count() {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },
  };
}

test('key state follows key down / up and never sticks after leaving the window', () => {
  const win = fakeWindow();
  const doc = { ...fakeWindow(), visibilityState: 'visible' };
  const detach = attachMoveModifierListeners(win, { mac: true, doc });

  win.fire('keydown', { key: 'Meta', metaKey: true });
  assert.equal(getMoveModifierHeld(), true, 'Cmd down -> held (no mouse move needed)');
  // Cmd+C etc. keep the key held; the listener never consumes the key.
  win.fire('keydown', { key: 'c', metaKey: true });
  assert.equal(getMoveModifierHeld(), true);
  win.fire('keyup', { key: 'Meta', metaKey: false });
  assert.equal(getMoveModifierHeld(), false, 'Cmd up -> released');

  // Cmd+Tab away: the key-up never arrives, blur clears it.
  win.fire('keydown', { key: 'Meta', metaKey: true });
  win.fire('blur');
  assert.equal(getMoveModifierHeld(), false, 'window blur clears it');

  // Tab switch.
  win.fire('keydown', { key: 'Meta', metaKey: true });
  doc.visibilityState = 'hidden';
  doc.fire('visibilitychange');
  assert.equal(getMoveModifierHeld(), false, 'hidden tab clears it');
  doc.visibilityState = 'visible';

  // A missed key-up heals on the next pointer move (event carries the truth).
  win.fire('keydown', { key: 'Meta', metaKey: true });
  win.fire('pointermove', { metaKey: false, ctrlKey: false });
  assert.equal(getMoveModifierHeld(), false, 'pointer move re-reads the key');
  // ...and a key pressed while another window had focus is picked up the same way.
  win.fire('pointermove', { metaKey: true });
  assert.equal(getMoveModifierHeld(), true);

  detach();
  assert.equal(getMoveModifierHeld(), false, 'detaching clears the state');
  assert.equal(win.count(), 0, 'every window listener removed');
  assert.equal(doc.count(), 0, 'visibility listener removed');
});

test('Control is the key on Windows / Linux; Command there does nothing', () => {
  const win = fakeWindow();
  const detach = attachMoveModifierListeners(win, { mac: false, doc: null });
  win.fire('keydown', { key: 'Meta', metaKey: true, ctrlKey: false });
  assert.equal(getMoveModifierHeld(), false);
  win.fire('keydown', { key: 'Control', metaKey: false, ctrlKey: true });
  assert.equal(getMoveModifierHeld(), true);
  win.fire('keyup', { key: 'Control', ctrlKey: false });
  assert.equal(getMoveModifierHeld(), false);
  detach();
});

test('move zone: a tiny mark zoomed out still gets a comfortable grab area', () => {
  // A 3 x 3 dot at 25 % zoom: 4 page units per screen pixel.
  const zone = resolveModifierMoveZone([{ left: 100, top: 200, width: 3, height: 3 }], { inverseScale: 4 });
  // At least 24 screen px (96 page units) square, centred on the dot.
  assert.equal(zone.width, 96);
  assert.equal(zone.height, 96);
  assert.equal(zone.left + zone.width / 2, 101.5);
  assert.equal(zone.top + zone.height / 2, 201.5);
  assert.equal(zone.angle, 0);
});

test('move zone: a big mark gets its own box plus a few screen pixels', () => {
  const zone = resolveModifierMoveZone([{ left: 10, top: 20, width: 200, height: 100 }], { inverseScale: 1 });
  assert.deepEqual(
    { left: zone.left, top: zone.top, width: zone.width, height: zone.height },
    { left: 6, top: 16, width: 208, height: 108 },
  );
});

test('move zone: one tilted mark keeps its tilt; several marks use the union', () => {
  const single = resolveModifierMoveZone([{ left: 0, top: 0, width: 100, height: 20, angle: 30 }], { inverseScale: 1 });
  assert.equal(single.angle, 30);
  assert.equal(single.cx, 50);
  assert.equal(single.cy, 10);

  const union = resolveModifierMoveZone([
    { left: 0, top: 0, width: 10, height: 10 },
    { left: 100, top: 50, width: 10, height: 10 },
  ], { inverseScale: 1, padScreenPx: 0, minScreenPx: 0 });
  assert.deepEqual(
    { left: union.left, top: union.top, width: union.width, height: union.height, angle: union.angle },
    { left: 0, top: 0, width: 110, height: 60, angle: 0 },
  );

  // A rotated member contributes its turned corners to the union.
  const withTilt = resolveModifierMoveZone([
    { left: 0, top: 0, width: 10, height: 10 },
    { left: 50, top: 0, width: 20, height: 0, angle: 90 },
  ], { inverseScale: 1, padScreenPx: 0, minScreenPx: 0 });
  assert.ok(Math.abs(withTilt.top - -10) < 1e-9);
  assert.ok(Math.abs(withTilt.height - 20) < 1e-9);
});

test('press on the mark itself vs. beside it (a rotate grabber can overlap a tiny mark)', () => {
  const boxes = [{ left: 10, top: 10, width: 10, height: 10 }];
  assert.equal(isPointInBoxes({ x: 15, y: 15 }, boxes), true);
  assert.equal(isPointInBoxes({ x: 10, y: 20 }, boxes), true, 'edges count');
  assert.equal(isPointInBoxes({ x: 21, y: 15 }, boxes), false);
  // A box turned 45 degrees: its corner area is outside, its turned tip inside.
  const turned = [{ left: 0, top: 0, width: 10, height: 10, angle: 45 }];
  assert.equal(isPointInBoxes({ x: 0.5, y: 0.5 }, turned), false);
  assert.equal(isPointInBoxes({ x: 5, y: -1.9 }, turned), true);
  assert.equal(isPointInBoxes({ x: NaN, y: 0 }, boxes), false);
  assert.equal(isPointInBoxes({ x: 15, y: 15 }, null), false);
});

test('move zone: nothing selected -> no zone', () => {
  assert.equal(resolveModifierMoveZone([], { inverseScale: 1 }), null);
  assert.equal(resolveModifierMoveZone([null, { left: NaN, top: 0, width: 1, height: 1 }]), null);
});

// Source wiring guards: the layer hides every resize grabber kind while the
// key is held, keeps the rotate grabber, and the hook arms the SAME drags the
// plain body drag uses.
const layerSrc = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
const hookSrc = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');

test('layer: grabbers hide while the key is held, rotate grabber stays, zone sits below the chrome', () => {
  assert.match(layerSrc, /hideResizeHandles=\{textMarkupSelectionChrome\.hideResizeHandles \|\| modifierMoveActive\}/);
  // A line's end / bend grabbers give way to a plain dashed frame.
  assert.match(layerSrc, /if \(isLineType && !lineInBboxMode && modifierMoveActive\) \{[\s\S]{0,400}moveOnly=\{true\}/);
  // Read-only documents never get the move zone.
  assert.match(layerSrc, /modifierMoveActive = \(\(\) => \{[\s\S]{0,600}data-readonly/);
  // Pages with nothing selected do not re-render on every Cmd press.
  assert.match(layerSrc, /useMoveModifierHeld\(familySelectionSize > 0 && activeTool === 'select'\)/);
  assert.match(layerSrc, /!modifierMoveActive && worldPoints\.map/);
  assert.match(layerSrc, /&& !modifierMoveActive;\n/, 'callout knee / tip / corner grabbers hide');
  assert.match(layerSrc, /hideResizeHandles=\{modifierMoveActive\}/, 'Survey Marker grabbers hide');
  // Rotation is never hidden by the modifier.
  assert.doesNotMatch(layerSrc, /hideRotationHandle=\{[^}]*modifierMoveActive/);
  const zoneAt = layerSrc.indexOf('data-modifier-move-zone="true"');
  const chromeAt = layerSrc.indexOf('{/* Selection overlays — rendered on top of all annotations */}');
  const svgEnd = layerSrc.indexOf('</svg>', zoneAt);
  assert.ok(zoneAt > chromeAt && chromeAt > 0, 'move zone renders on top of the selection chrome');
  assert.ok(svgEnd > zoneAt && layerSrc.slice(zoneAt, svgEnd).split('\n').length < 25, 'move zone is the last thing in the page svg');
  // A press on a rotate grabber outside the marks is handed to it.
  assert.match(layerSrc, /if \(isPointInBoxes\(pagePoint, modifierMoveZone\?\.markBoxes\)\) return null;/);
  assert.match(layerSrc, /rotateEl\.dispatchEvent\(new PointerEvent\('pointerdown'/);
  // Text Select keeps native text drags; only the Select tool gets the zone.
  assert.match(layerSrc, /if \(!moveModifierHeld \|\| activeTool !== 'select' \|\| !isSelectTool\) return false;/);
});

test('hook: modifier move reuses the body-drag machinery', () => {
  const start = hookSrc.indexOf('const startModifierMove = useCallback');
  assert.ok(start > 0);
  const body = hookSrc.slice(start, hookSrc.indexOf('// Return API', start));
  assert.match(body, /if \(total > 1\) return startFamilyGroupMove\(e\);/, 'several members -> group move');
  assert.match(body, /if \(!canMoveAnnotation\(obj\)\) return false;/, 'locked / text markup never move');
  assert.match(body, /mode: 'move',/, 'one mark -> single move');
  assert.match(body, /partType: 'whole',/, 'one callout -> whole-callout move');
  assert.match(body, /if \(!callout \|\| isUserLocked\(callout\)\) return false;/, 'locked callout stays');
  assert.match(body, /svgEl\.setPointerCapture/, 'capture on the page svg survives the zone unmounting');
});
