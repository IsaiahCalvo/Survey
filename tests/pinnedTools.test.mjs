// Pinned tools (beta 'pinned-tools'): the pin list, what a pin holds, the
// dock's placement maths and arming a pin against a fake viewer
// (src/pinnedTools/pinnedTools.js, src/pinnedTools/pinSession.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PINNABLE_TOOLS, chooseDockPlacement, createPinnedToolsStore, dropDurationMs, makePin, movePin,
  pinBadge, pinDescription, pinFaceColor, pinKindForTool, pinStyleFor, reorderIndexAt,
  sanitizePinnedToolsState,
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
  assert.deepEqual(pinStyleFor('eraser', { strokeWidth: 9 }), {});
  assert.equal(pinStyleFor('text', { strokeWidth: 9, strokeColor: '#000000' }).strokeWidth, undefined);
  assert.equal(pinKindForTool('rect', 'cloud').id, 'cloud');
  assert.equal(pinKindForTool('rect', 'dashed').id, 'rect');
  assert.equal(pinKindForTool('pan', 'solid'), null);
  assert.ok(PINNABLE_TOOLS.every((kind) => kind.id !== 'symbol'), 'the Symbols tool is gone for good');
});

test('pinned tools: the face shows colour and width like Drawboard', () => {
  const pen = makePin('pen', { strokeColor: '#0000ff', strokeWidth: 0.5 }, 'a');
  assert.equal(pinFaceColor(pen), '#0000ff');
  assert.equal(pinBadge(pen), '.5');
  assert.equal(pinDescription(pen), 'Pen, blue, .5 wide');
  const counter = makePin('counter', { strokeColor: '#000000', fillColor: '#ef4444', strokeWidth: 14 }, 'b');
  assert.equal(pinFaceColor(counter), '#ef4444');
  assert.equal(pinBadge(makePin('eraser', {}, 'c')), '');
  assert.equal(pinDescription(makePin('line', { strokeColor: '#ff0000', strokeWidth: 2, lineStyle: 'dashed' }, 'd')), 'Line, red, 2 wide, dashed');
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
