import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('eraser save path short-circuits precise no-op before history and state save', () => {
  const app = readFileSync(resolve(ROOT, 'src/viewerShared.js'), 'utf8')
    + '\n' + readFileSync(resolve(ROOT, 'src/PDFViewer.jsx'), 'utf8');
  const noopIndex = app.indexOf("reason: 'eraser:precise-noop'");
  const recordIndex = app.indexOf('recordAnnotationCommit({', noopIndex);
  const stateIndex = app.indexOf('setAnnotationsByPage(prev => {', noopIndex);

  assert.ok(noopIndex > 0, 'expected eraser precise no-op branch');
  assert.ok(recordIndex > noopIndex, 'expected commit recording after no-op branch');
  assert.ok(stateIndex > noopIndex, 'expected state save after no-op branch');
});

test('eraser save path publishes precise ids for cloud sync fan-out', () => {
  const app = readFileSync(resolve(ROOT, 'src/viewerShared.js'), 'utf8')
    + '\n' + readFileSync(resolve(ROOT, 'src/PDFViewer.jsx'), 'utf8');

  assert.ok(app.includes("new CustomEvent('annotations:precise-fabric-commit'"), 'expected precise commit event');
  assert.ok(app.includes('deletedIds: eraserDeletedIds'), 'expected deleted id payload');
  assert.ok(app.includes('changedIds: eraserChangedIds'), 'expected changed id payload');
});

test('cloud sync consumes eraser precise ids instead of whole-page changed diff', () => {
  const hook = readFileSync(resolve(ROOT, 'src/hooks/useAnnotationCloudSync.js'), 'utf8');

  assert.ok(hook.includes("window.addEventListener('annotations:precise-fabric-commit'"), 'expected precise event listener');
  assert.ok(hook.includes('? preciseFabricCommit.changedIds'), 'expected changed fan-out limited to precise ids');
  assert.ok(hook.includes('resolveFabricDeletedIds({'), 'expected delete ids to resolve through explicit intent helper');
  assert.ok(hook.includes('preciseFabricCommit,'), 'expected eraser precise delete ids to remain first priority');
});

test('fabric sync flush rechecks pointer state and defers while pointer is down', () => {
  const hook = readFileSync(resolve(ROOT, 'src/hooks/useAnnotationCloudSync.js'), 'utf8');
  const runIndex = hook.indexOf('const runFabricPush = async () => {');
  const pointerIndex = hook.indexOf('if (pointerDownRef.current) {', runIndex);
  const pushIndex = hook.indexOf('[CloudSync][hook] fabric push debounce elapsed', runIndex);

  assert.ok(runIndex > 0, 'expected fabric push runner');
  assert.ok(pointerIndex > runIndex, 'expected pointer check inside fabric push runner');
  assert.ok(pointerIndex < pushIndex, 'expected pointer deferral before pushing');
  assert.ok(hook.includes('fabric push deferred at flush'), 'expected flush-time pointer deferral log');
});
