import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = fs.readFileSync(
  path.join(root, 'src/dev/EraserTwoClientRaceHarness.jsx'),
  'utf8',
);
const main = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');
const canvas = fs.readFileSync(
  path.join(root, 'src/components/FabricEraserCanvas.jsx'),
  'utf8',
);
const viewer = fs.readFileSync(path.join(root, 'src/PDFViewer.jsx'), 'utf8');

test('race route is dev-only and mounts the real production eraser', () => {
  assert.match(main, /if \(import\.meta\.env\.DEV\)/);
  assert.match(main, /params\.get\('eraserRace'\)/);
  assert.match(main, /import\('\.\/dev\/EraserTwoClientRaceHarness'\)/);
  assert.match(harness, /<FabricEraserCanvas/);
  assert.match(harness, /createProductionPaperInk\(\{/);
  assert.doesNotMatch(harness, /annotationId:\s*TARGET_ID/);
  assert.match(harness, /onPointerDownCapture=\{requestScheduledAction\}/);
});

test('synthetic race document explicitly uses the local-only eraser permission lane', () => {
  assert.match(harness, /isLocalOnlyDocument=\{true\}/);
  assert.doesNotMatch(harness, /viewerId=/);
  assert.doesNotMatch(harness, /documentOwnerId=/);
});

test('mounted clients exchange real Y.Doc updates and persist cold-reload truth', () => {
  assert.match(harness, /new BroadcastChannel\(`survey-eraser-race-\$\{session\}`\)/);
  assert.match(harness, /Y\.applyUpdate\(harness\.doc, base64ToBytes\(message\.update\), 'mounted-broadcast'\)/);
  assert.match(harness, /localStorage\.setItem\(/);
  assert.match(harness, /Y\.encodeStateAsUpdate\(harness\.doc\)/);
  assert.match(harness, /syncByPageToDoc\(harness\.doc/);
});

test('mounted and production commits expose the exact materialization acknowledgment', () => {
  assert.match(harness, /eraserMutation:\s*\{/);
  assert.match(harness, /objectMutations: diagnostics\.objectMutations/);
  assert.match(harness, /return \{ requireMutationAck: true \}/);
  assert.match(harness, /data-eraser-materialized-mutation-ids=\{acknowledgments\.join\(' '\)\}/);
  assert.match(canvas, /requireMutationAck: outcome\.requireMutationAck/);
  assert.match(canvas, /data-eraser-materialized-mutation-ids/);
  assert.match(viewer, /commitEraserMutationToDoc\(\{/);
  assert.match(viewer, /data-eraser-materialized-mutation-ids=/);
});

test('same target supports edit, move, and delete while A holds the pointer', () => {
  assert.match(harness, /action === 'delete'/);
  assert.match(harness, /action === 'move'/);
  assert.match(harness, /remoteAction: 'edit'/);
  assert.match(harness, /kind: 'schedule-action'/);
  assert.match(harness, /record\('a-pointer-down'/);
});
