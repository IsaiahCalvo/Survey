// Snapshot tool box maths (Nightly 'snapshot-tool').
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SNAPSHOT_HANDLES,
  boxFromCorners,
  boxToPixels,
  dragBox,
  isBigEnough,
  moveBoxEdge,
  renderTargetPx,
} from '../src/utils/snapshotArea.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const near = (a, b) => Object.keys(b).forEach((k) => assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${k}: ${a[k]} vs ${b[k]}`));

test('a box from any two corners, kept on the page', () => {
  near(boxFromCorners({ x: 0.6, y: 0.4 }, { x: 0.2, y: 0.1 }), { x: 0.2, y: 0.1, w: 0.4, h: 0.3 });
  near(boxFromCorners({ x: -1, y: 0.5 }, { x: 2, y: 0.5 }), { x: 0, y: 0.5, w: 1, h: 0 });
});

test('a click is not a box', () => {
  assert.equal(isBigEnough({ x: 0, y: 0, w: 0.001, h: 0.2 }, 1000, 1000), false);
  assert.equal(isBigEnough({ x: 0, y: 0, w: 0.01, h: 0.01 }, 1000, 1000), true);
  assert.equal(isBigEnough(null, 1000, 1000), false);
});

test('handles move their edges; past the far edge the box flips; move stays on the page', () => {
  const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };
  near(moveBoxEdge(box, 'e', 0.1, 0.5), { x: 0.2, y: 0.2, w: 0.5, h: 0.2 });
  near(moveBoxEdge(box, 'nw', -0.1, -0.1), { x: 0.1, y: 0.1, w: 0.5, h: 0.3 });
  near(moveBoxEdge(box, 'w', 0.6, 0), { x: 0.6, y: 0.2, w: 0.2, h: 0.2 });
  near(moveBoxEdge(box, 'move', 0.9, -0.9), { x: 0.6, y: 0, w: 0.4, h: 0.2 });
  assert.equal(SNAPSHOT_HANDLES.length, 8);
});

test('render size: twice the page in points, inside limits', () => {
  assert.equal(renderTargetPx(612, 792), 1584);
  assert.equal(renderTargetPx(2448, 3168), 4096);
  assert.equal(renderTargetPx(100, 100), 600);
});

test('the box as pixels never leaves the canvas and is at least 1 x 1', () => {
  assert.deepEqual(boxToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 400, 200), { sx: 100, sy: 100, sw: 200, sh: 50 });
  assert.deepEqual(boxToPixels({ x: 1, y: 1, w: 0, h: 0 }, 400, 200), { sx: 399, sy: 199, sw: 1, sh: 1 });
});

test('flag and wiring', () => {
  assert.equal(FEATURE_FLAGS['snapshot-tool'].stage, 'beta');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /isFeatureOn\('snapshot-tool'\)/);
  assert.match(viewer, /snapshotToolEnabled \? \[\{ id: 'snapshot'/);
  assert.match(viewer, /<SnapshotTool[\s\S]{0,80}active=\{activeTool === 'snapshot'\}/);
  const migration = readFileSync(new URL('../supabase/migrations/20261112091000_snapshot_tool_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'snapshot-tool', 'off'/);
});

test('the release point makes the box, not the last rendered move', () => {
  const start = { x: 0.1, y: 0.1 };
  assert.deepEqual(dragBox({ mode: 'new', start }, { x: 0.4, y: 0.3 }), boxFromCorners(start, { x: 0.4, y: 0.3 }));
  const from = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 };
  assert.deepEqual(dragBox({ mode: 'move', start, from }, { x: 0.15, y: 0.1 }), moveBoxEdge(from, 'move', 0.05, 0));
  assert.equal(dragBox({ mode: 'se', start, from: null }, { x: 0.5, y: 0.5 }), null);
  assert.equal(dragBox(null, start), null);
  // The tool reads the box from the release, never from the snap state.
  const src = readFileSync(new URL('../src/components/SnapshotTool.jsx', import.meta.url), 'utf8');
  const onUp = src.slice(src.indexOf('const onUp = '), src.indexOf('const onCancel = '));
  assert.match(onUp, /const box = dragBox\(drag, at\);/);
  assert.doesNotMatch(onUp, /snapRef\.current/);
});

test('phones get Snapshot too; a finger runs it only where fingers run tools', () => {
  const src = readFileSync(new URL('../src/components/SnapshotTool.jsx', import.meta.url), 'utf8');
  assert.match(src, /!pointerMayUseTool\(event\.pointerType\)/);
  const phone = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
  assert.match(phone, /\{ id: 'snapshot', label: 'Snapshot', icon: 'snapshot', flag: 'snapshot-tool' \}/);
});
