// Pinned tools (beta 'pinned-tools'): the pin list, what a pin holds, the
// dock's placement maths and arming a pin against a fake viewer
// (src/pinnedTools/pinnedTools.js, src/pinnedTools/pinSession.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PINNABLE_TOOLS, chooseDockPlacement, createPinnedToolsStore, dropDurationMs, magnetPull, makePin, movePin,
  pinBadge, pinDescription, pinFaceColor, pinKindForTool, pinStyleFor, reorderIndexAt, reorderShift,
  sanitizePinnedToolsState, slotsThatFit, visiblePinCount, COMPACT_DOCK_SLOTS, CARRIED_DOCK_SLOTS,
} from '../src/pinnedTools/pinnedTools.js';
import { armPin, endPinSession, pinEditFromViewer, sessionStatus, startingStyleFor } from '../src/pinnedTools/pinSession.js';
import { FEATURE_FLAGS, isFeatureOn } from '../src/featureFlags.js';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}

// A stand-in for PDFViewer's published API: one remembered setting per tool
// (and per Cloud key), one shared line style, one armed tool.
function fakeViewer(prefs = {}) {
  const viewer = {
    prefs: {
      pen: { strokeColor: '#ff0000', strokeWidth: 3, strokeOpacity: 100 },
      rect: { strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100, fillColor: '#ffffff', fillOpacity: 0 },
      cloud: { strokeColor: '#c42747', strokeWidth: 2.5, strokeOpacity: 100 },
      ...prefs,
    },
    lineBorderStyle: 'solid',
    activeTool: 'pan',
    owner: 'viewer-1',
  };
  viewer.api = () => ({
    __ownerToken: viewer.owner,
    activeTool: viewer.activeTool,
    lineBorderStyle: viewer.lineBorderStyle,
    setActiveTool: (tool) => { viewer.activeTool = tool; },
    setToolLineBorderStyle: (style) => { viewer.lineBorderStyle = style; },
    readToolStyle: (tool, lineStyle = viewer.lineBorderStyle) => {
      const key = lineStyle === 'cloud' && tool === 'rect' ? 'cloud' : tool;
      const own = viewer.prefs[tool] || {};
      const stroke = viewer.prefs[key] || {};
      return { ...own, ...stroke, fillColor: own.fillColor, fillOpacity: own.fillOpacity, lineStyle };
    },
    writeToolStyle: (tool, style) => {
      if (style.lineStyle) viewer.lineBorderStyle = style.lineStyle;
      const key = viewer.lineBorderStyle === 'cloud' && tool === 'rect' ? 'cloud' : tool;
      const pick = (fields) => Object.fromEntries(fields.filter((f) => style[f] !== undefined).map((f) => [f, style[f]]));
      viewer.prefs[key] = { ...viewer.prefs[key], ...pick(['strokeColor', 'strokeOpacity', 'strokeWidth']) };
      viewer.prefs[tool] = { ...viewer.prefs[tool], ...pick(['fillColor', 'fillOpacity']) };
    },
  });
  return viewer;
}

test('pinned tools: a beta flag, so stable never shows it', () => {
  assert.equal(FEATURE_FLAGS['pinned-tools'].stage, 'beta');
  const storage = memoryStorage({ 'survey.flag.pinned-tools': '1' });
  assert.equal(isFeatureOn('pinned-tools', { storage, env: {} }), false);
  assert.equal(isFeatureOn('pinned-tools', { storage: memoryStorage(), env: { VITE_RELEASE_CHANNEL: 'nightly' } }), true);
  const migration = readFileSync(new URL('../supabase/migrations/20261025093000_pinned_tools_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'pinned-tools', 'off'/);
});

test('pinned tools: a pin keeps only the settings its tool uses', () => {
  assert.deepEqual(pinStyleFor('pen', { strokeColor: '#00F', strokeWidth: 6, strokeOpacity: 80, fillColor: '#ff0000' }),
    { strokeColor: '#0000ff', strokeOpacity: 80, strokeWidth: 6 });
  assert.deepEqual(pinStyleFor('rect', { strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 0, lineStyle: 'dashed' }),
    { strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 0, lineStyle: 'dashed' });
  // A clouded rectangle is the Cloud pin; a plain Rectangle pin never clouds.
  assert.equal(pinStyleFor('rect', { lineStyle: 'cloud' }).lineStyle, 'solid');
  assert.equal(pinStyleFor('cloud', { lineStyle: 'solid' }).lineStyle, 'cloud');
  assert.equal(pinStyleFor('ellipse', { lineStyle: 'cloud' }).lineStyle, 'cloud');
  assert.equal(pinStyleFor('arrow', { lineStyle: 'cloud' }).lineStyle, 'solid');
  // The eraser keeps its size only; a text box keeps its border width and style.
  assert.deepEqual(pinStyleFor('eraser', { strokeWidth: 9, strokeColor: '#ff0000' }), { strokeWidth: 9 });
  assert.deepEqual(pinStyleFor('text', { strokeWidth: 9, strokeColor: '#000000', lineStyle: 'cloud' }),
    { strokeColor: '#000000', strokeWidth: 9, lineStyle: 'cloud' });
  assert.equal(pinKindForTool('rect', 'cloud').id, 'cloud');
  assert.equal(pinKindForTool('rect', 'dashed').id, 'rect');
  assert.equal(pinKindForTool('pan', 'solid'), null);
  assert.ok(PINNABLE_TOOLS.every((kind) => kind.id !== 'symbol'), 'the Symbols tool is gone for good');
});

test('pinned tools: the face shows colour and width like Drawboard', () => {
  const pen = makePin('pen', { strokeColor: '#0000ff', strokeWidth: 0.5 }, 'a');
  assert.equal(pinFaceColor(pen), '#0000ff');
  assert.equal(pinBadge(pen), '.5');
  assert.equal(pinDescription(pen), 'Pen, blue, .5 pt');
  const counter = makePin('counter', { strokeColor: '#000000', fillColor: '#ef4444', strokeWidth: 14 }, 'b');
  assert.equal(pinFaceColor(counter), '#ef4444');
  assert.equal(pinBadge(makePin('eraser', {}, 'c')), '');
  assert.equal(pinBadge(makePin('eraser', { strokeWidth: 20 }, 'c')), '20');
  assert.equal(pinDescription(makePin('line', { strokeColor: '#ff0000', strokeWidth: 2, lineStyle: 'dashed' }, 'd')), 'Line, red, 2 pt, dashed');
});

test('pinned tools: every pin follows one rule - the settings row\'s colour and size', () => {
  // What the settings row holds for a tool armed with its defaults (useDatabase
  // DEFAULT_TOOL_PREFERENCES; the eraser's Size box starts at 20).
  const row = {
    pen: { strokeColor: '#ff0000', strokeWidth: 3 },
    highlighter: { strokeColor: '#ffff00', strokeWidth: 20, strokeOpacity: 50 },
    eraser: { strokeWidth: 20 },
    rect: { strokeColor: '#ff0000', strokeWidth: 2 },
    ellipse: { strokeColor: '#ff0000', strokeWidth: 2 },
    polygon: { strokeColor: '#ff0000', strokeWidth: 2 },
    cloud: { strokeColor: '#c42747', strokeWidth: 2.5 },
    polyline: { strokeColor: '#ff0000', strokeWidth: 2 },
    line: { strokeColor: '#ff0000', strokeWidth: 2 },
    arrow: { strokeColor: '#ff0000', strokeWidth: 2 },
    counter: { strokeColor: '#ef4444', fillColor: '#ef4444', strokeWidth: 14 },
    text: { strokeColor: '#000000', strokeWidth: 1 },
    callout: { strokeColor: '#ff0000', strokeWidth: 2 },
  };
  assert.deepEqual(Object.keys(row).sort(), PINNABLE_TOOLS.map((kind) => kind.id).sort(), 'every pinnable tool is covered');
  for (const [kind, style] of Object.entries(row)) {
    const pin = makePin(kind, style, kind);
    assert.ok(pinBadge(pin), `${kind} shows its size`);
    assert.equal(pinBadge(pin), String(style.strokeWidth).replace(/^0(?=\.)/, ''));
    if (kind === 'eraser') assert.equal(pinFaceColor(pin), null, 'the eraser has no colour');
    else assert.equal(pinFaceColor(pin), kind === 'counter' ? style.fillColor : style.strokeColor, `${kind} shows its colour`);
  }
});

test('pinned tools: no limit on pins, saved per browser, bad saves are cleaned', () => {
  const storage = memoryStorage();
  const store = createPinnedToolsStore({ storage });
  for (let i = 0; i < 25; i += 1) store.addPin(makePin('pen', { strokeColor: '#ff0000', strokeWidth: i + 1 }));
  assert.equal(store.getState().pins.length, 25, 'Drawboard stops at 7; Survey has no limit');
  const again = createPinnedToolsStore({ storage });
  assert.equal(again.getState().pins.length, 25);
  const first = again.getState().pins[0].id;
  again.movePin(first, 3);
  assert.equal(again.getState().pins[3].id, first);
  again.removePin(first);
  assert.equal(again.getState().pins.length, 24);
  again.setPlacement('bottom');
  again.setPlacement('nowhere');
  assert.equal(again.getState().placement, 'bottom');
  const cleaned = sanitizePinnedToolsState({ placement: 'up', pins: [{ kind: 'symbol' }, { id: 'x', kind: 'pen' }, { id: 'x', kind: 'pen' }] });
  assert.equal(cleaned.placement, 'right');
  assert.deepEqual(cleaned.pins.map((pin) => pin.id), ['x']);
  const broken = createPinnedToolsStore({ storage: memoryStorage({ 'survey:pinned-tools.v1': '{nope' }) });
  assert.deepEqual(broken.getState().pins, []);
});

test('pinned tools: dock placement while dragging, glide time, reorder slot', () => {
  assert.equal(chooseDockPlacement({ left: 10, right: 50, bottom: 300 }, 1000, 800), 'left');
  assert.equal(chooseDockPlacement({ left: 900, right: 940, bottom: 300 }, 1000, 800), 'right');
  assert.equal(chooseDockPlacement({ left: 400, right: 600, bottom: 790 }, 1000, 800), 'bottom');
  // Just out of the bottom band: keeps bottom on the way out, not on the way in.
  const edge = 800 - 72 - 5;
  assert.equal(chooseDockPlacement({ left: 400, right: 600, bottom: edge }, 1000, 800, 'bottom'), 'bottom');
  assert.equal(chooseDockPlacement({ left: 400, right: 600, bottom: edge }, 1000, 800, null), 'left');
  const rect = (left, top) => ({ left, top, width: 40, height: 40 });
  assert.equal(dropDurationMs(rect(0, 0), rect(0, 0)), 240);
  assert.equal(dropDurationMs(rect(0, 0), rect(2000, 0)), 320);
  const slots = [{ top: 0, height: 28 }, { top: 30, height: 28 }, { top: 60, height: 28 }];
  assert.equal(reorderIndexAt({ x: 0, y: 5 }, slots, true), 0);
  assert.equal(reorderIndexAt({ x: 0, y: 50 }, slots, true), 2);
  assert.equal(reorderIndexAt({ x: 0, y: 99 }, slots, true), 3);
  assert.deepEqual(movePin(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
});

test('pinned tools: three pens, each with its own colour and width; the Pen tool keeps its own', () => {
  const viewer = fakeViewer();
  const blue = makePin('pen', { strokeColor: '#0000ff', strokeWidth: 6 }, 'blue');
  const black = makePin('pen', { strokeColor: '#000000', strokeWidth: 1 }, 'black');

  let session = armPin(viewer.api(), null, blue, 0);
  assert.equal(viewer.activeTool, 'pen');
  assert.equal(viewer.prefs.pen.strokeColor, '#0000ff');
  assert.equal(viewer.prefs.pen.strokeWidth, 6);
  assert.equal(sessionStatus(session, viewer.api(), 10), 'keep');

  // Switching pins of the same tool keeps the Pen tool's own settings saved.
  session = armPin(viewer.api(), session, black, 20);
  assert.equal(viewer.prefs.pen.strokeColor, '#000000');
  assert.equal(session.snapshots.plain.strokeColor, '#ff0000');

  // Editing the width in the settings row while the black pin is armed edits that pin.
  // The first look fills in the opacity the pin did not carry.
  assert.deepEqual(pinEditFromViewer(session, black, viewer.api(), 30), { strokeColor: '#000000', strokeOpacity: 100, strokeWidth: 1 });
  viewer.prefs.pen = { ...viewer.prefs.pen, strokeWidth: 2 };
  assert.deepEqual(pinEditFromViewer(session, black, viewer.api(), 40), { strokeColor: '#000000', strokeOpacity: 100, strokeWidth: 2 });

  // Arming another tool leaves the pin and gives Pen its own red 3 back.
  viewer.activeTool = 'select';
  assert.equal(sessionStatus(session, viewer.api(), 50), 'end');
  endPinSession(session);
  assert.deepEqual([viewer.prefs.pen.strokeColor, viewer.prefs.pen.strokeWidth], ['#ff0000', 3]);
});

test('pinned tools: a Cloud pin borrows the Cloud key and the shared line style', () => {
  const viewer = fakeViewer();
  viewer.lineBorderStyle = 'dashed';
  const cloud = makePin('cloud', { strokeColor: '#00ff00', strokeWidth: 4 }, 'cloud');
  const session = armPin(viewer.api(), null, cloud, 0);
  assert.equal(viewer.activeTool, 'rect');
  assert.equal(viewer.lineBorderStyle, 'cloud');
  assert.equal(viewer.prefs.cloud.strokeColor, '#00ff00');
  assert.equal(viewer.prefs.rect.strokeColor, '#ff0000', 'the plain rectangle is untouched');
  assert.equal(sessionStatus(session, viewer.api(), 2), 'keep');
  viewer.activeTool = 'pen';
  assert.equal(sessionStatus(session, viewer.api(), 5), 'end');
  endPinSession(session);
  assert.equal(viewer.prefs.cloud.strokeColor, '#c42747');
  assert.equal(viewer.lineBorderStyle, 'dashed');
});

test('pinned tools: a new pin starts from the tool\'s own settings, not an armed pin\'s', () => {
  const viewer = fakeViewer();
  const blue = makePin('pen', { strokeColor: '#0000ff', strokeWidth: 6 }, 'blue');
  const session = armPin(viewer.api(), null, blue, 0);
  assert.equal(startingStyleFor(viewer.api(), session, 'pen').strokeColor, '#ff0000');
  assert.equal(startingStyleFor(viewer.api(), session, 'rect').strokeWidth, 2);
  assert.equal(startingStyleFor(viewer.api(), null, 'cloud').strokeColor, '#c42747');
});

test('pinned tools: another document tab ends the pin and the first viewer gets its settings back', () => {
  const viewer = fakeViewer();
  const session = armPin(viewer.api(), null, makePin('pen', { strokeColor: '#0000ff', strokeWidth: 6 }, 'p'), 0);
  viewer.owner = 'viewer-2';
  assert.equal(sessionStatus(session, viewer.api(), 5), 'end');
  assert.equal(sessionStatus(session, null, 5), 'end');
});

// Item 1 of the 2026-10-26 note: "how it feels like the magnet works" in
// walkthu. The pull is walkthu's getMagnetizedTranslation.
test('pinned tools: the zone pulls the carried dock in, harder near the edge', () => {
  const W = 1000;
  const H = 800;
  const box = (left, top, w = 42, h = 200) => ({ left, right: left + w, top, bottom: top + h });
  const leftHome = { x: 31, y: 418, bottom: 518 };
  // With its edge at the middle of the page area there is no pull at all.
  const mid = magnetPull(box(500, 300), 'left', W, H, leftHome);
  assert.ok(Math.abs(mid.x) < 1e-9 && Math.abs(mid.y) < 1e-9);
  // Closer to the edge, a stronger share of the way home.
  const far = magnetPull(box(300, 300), 'left', W, H, leftHome);
  const near = magnetPull(box(60, 300), 'left', W, H, leftHome);
  const share = (pull, b) => pull.x / (leftHome.x - (b.left + b.right) / 2);
  assert.ok(share(far, box(300, 300)) > 0 && share(far, box(300, 300)) < share(near, box(60, 300)));
  assert.ok(share(near, box(60, 300)) <= 0.86 + 1e-9, 'never all the way: the grip stays near the pointer');
  // Right is the mirror image.
  const right = magnetPull(box(1000 - 60 - 42, 300), 'right', W, H, { x: 1000 - 31, y: 418, bottom: 518 });
  assert.ok(right.x > 0);
  // The bottom band pulls only down, at most 56% of the way.
  const home = { x: 500, y: 767, bottom: 788 };
  const low = magnetPull({ left: 400, right: 600, top: 740, bottom: 782 }, 'bottom', W, H, home);
  assert.equal(low.x, 0);
  assert.ok(low.y > 0 && low.y <= (788 - 782) * 0.56 + 1e-9);
  // Near the bottom band the side magnet lets go of the height.
  const sideLow = magnetPull(box(40, 560, 42, 200), 'left', W, H, leftHome);
  assert.ok(Math.abs(sideLow.y) < 1e-9 && Math.abs(sideLow.x) < 1e-9);
  assert.deepEqual(magnetPull(box(10, 10), null, W, H, leftHome), { x: 0, y: 0 });
});

test('pinned tools: the other pins slide aside to open the dragged pin\'s slot', () => {
  // [A, B, C, D]: A dragged to the third place -> [B, C, A, D].
  assert.deepEqual([0, 1, 2, 3].map((i) => reorderShift(i, 0, 2)), [0, -1, -1, 0]);
  // D dragged to the front -> [D, A, B, C].
  assert.deepEqual([0, 1, 2, 3].map((i) => reorderShift(i, 3, 0)), [1, 1, 1, 0]);
  // Dropped where it started: nothing moves.
  assert.deepEqual([0, 1, 2, 3].map((i) => reorderShift(i, 1, 1)), [0, 0, 0, 0]);
  assert.equal(reorderShift(2, -1, 0), 0);
});

test('pinned tools: the dock toggle draws Lucide\'s pin', () => {
  const source = readFileSync(new URL('../src/components/PinnedToolsDock.jsx', import.meta.url), 'utf8');
  assert.match(source, /M9 10\.76a2 2 0 0 1-1\.11 1\.79l-1\.78\.9A2 2 0 0 0 5 15\.24V16/);
  assert.doesNotMatch(source, /M9 4h6l-1 6 3 3H7l3-3-1-6Z/);
});

test('pinned tools: a big dock never scrolls pins out of sight - the rest wait behind "+N"', () => {
  // 32px pins, 2px apart: 484px of room holds 14 slots.
  assert.equal(slotsThatFit(484, 34, 2), 14);
  assert.equal(slotsThatFit(Infinity, 34, 2), Infinity);
  assert.equal(slotsThatFit(10, 34, 2), 1);
  // All fit: all shown. Too many: one fewer than the slots, "+N" takes the last.
  assert.equal(visiblePinCount(17, 17), 17);
  assert.equal(visiblePinCount(17, 14), 13);
  assert.equal(visiblePinCount(0, 14), 0);
  assert.equal(visiblePinCount(17, 1), 1);
  // The compact dock is 7 slots long and a carried dock 6, as Isaiah asked
  // for ("shows 5 different icons or 7").
  assert.equal(visiblePinCount(17, COMPACT_DOCK_SLOTS), 6);
  assert.equal(visiblePinCount(17, CARRIED_DOCK_SLOTS), 5);
  assert.equal(visiblePinCount(6, COMPACT_DOCK_SLOTS), 6);
});

test('pinned tools: the compact choice is saved with the dock', () => {
  const storage = memoryStorage();
  const store = createPinnedToolsStore({ storage });
  assert.equal(store.getState().compact, false);
  store.setCompact(true);
  assert.equal(createPinnedToolsStore({ storage }).getState().compact, true);
  assert.equal(sanitizePinnedToolsState({ compact: 'yes' }).compact, false);
});
