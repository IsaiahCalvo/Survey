// Genuine hunt of desktop Callout first-create after sibling Line/Arrow
// leftovers after tip 842674c6 / product 162aa1f5. No unique LIVE leftover.
// Do not invent Font family chrome, richTextEditor, Line /AP, callout
// Rotation, user-settable callout verticalAlign, leftover-18 hosts, or
// stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop Callout first-create after sibling already stamps Width Fill dash Arrowhead', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /lineThickness: Math.max\(1, Number\(strokeWidth\) \|\| 2\)/);
  assert.match(viewer, /lineStyle: \(lineBorderStyleRef\.current === 'dashed' \|\| lineBorderStyleRef\.current === 'dotted'\)/);
  assert.match(viewer, /arrowheadStyle: arrowheadStyleRef\.current \|\| rawCallout\.style\?\.arrowheadStyle/);
  assert.match(viewer, /fillOpacity: \(fillOpacity \?\? 100\) \/ 100/);

  const prefs = read('src/hooks/useDatabase.js');
  assert.match(prefs, /callout: \{ strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 90, strokeOpacity: 100, lineBorderStyle: 'solid', arrowheadStyle: 'solidTriangle' \}/);
  assert.match(prefs, /line: \{ strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100, lineBorderStyle: 'solid' \}/);
  assert.match(prefs, /arrow: \{ strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100, lineBorderStyle: 'solid', arrowheadStyle: 'solidTriangle' \}/);
});

test('live spec covers desktop Callout after sibling + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-after-desktop-callout-sibling-first-create-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Callout first-create Width 8 after sibling Line\/Arrow/);
  assert.match(spec, /desktop Callout first-create Fill 40 after sibling/);
  assert.match(spec, /desktop Callout first-create Dashed after sibling/);
  assert.match(spec, /desktop Callout first-create Open triangle after sibling/);
  assert.match(spec, /sibling Line Width 5/);
  assert.match(spec, /sibling Arrow Width 6/);
  assert.match(spec, /must not invent 390 hex chrome/);
  assert.match(spec, /must not invent Font family chrome/);
  assert.match(spec, /0 0 612 792/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
