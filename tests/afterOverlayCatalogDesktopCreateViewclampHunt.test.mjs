// Genuine hunt of desktop first-create / view-clamp / tool-pref remount
// leftovers after tip a9c0fd3f / product 162aa1f5. No unique LIVE leftover.
// Do not invent Font family chrome, richTextEditor, Line /AP, callout
// Rotation, user-settable callout verticalAlign, leftover-18 hosts, or
// stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop first-create / view-clamp writers already ride Width Fill dash Cloud Arrowhead MANUAL', () => {
  const commit = read('src/utils/annotationCreationCommit.js');
  assert.match(commit, /pdfCloudIntensity: Math.max\(1, Number\(cloudIntensity\) \|\| 2\)/);
  assert.match(commit, /json.strokeDashArray = \[6, 4\]/);
  assert.match(commit, /json.strokeDashArray = \[2, 4\]/);
  assert.match(commit, /data: \(tool === 'arrow' && arrowheadStyle\) \? \{ id, arrowheadStyle \}/);

  const prefs = read('src/hooks/useDatabase.js');
  assert.match(prefs, /rect: \{ strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 0, strokeOpacity: 100, lineBorderStyle: 'solid', cloudIntensity: 2 \}/);
  assert.match(prefs, /line: \{ strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100, lineBorderStyle: 'solid' \}/);
  assert.match(prefs, /arrow: \{ strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100, lineBorderStyle: 'solid', arrowheadStyle: 'solidTriangle' \}/);

  const zoom = read('src/utils/zoomController.js');
  assert.match(zoom, /MANUAL: 'manual'/);
  assert.match(zoom, /mode = ZOOM_MODES.MANUAL/);
});

test('live spec covers desktop first-create + view-clamp + remount + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-after-overlay-catalog-desktop-create-viewclamp-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop first-create Width 8/);
  assert.match(spec, /desktop first-create Fill 40/);
  assert.match(spec, /desktop first-create Cloud Bump 8/);
  assert.match(spec, /desktop first-create Line Width 5/);
  assert.match(spec, /desktop first-create Open circle/);
  assert.match(spec, /selectDesktopFit\(page, 'Fit page'\)/);
  assert.match(spec, /commitZoomPercent\(page, 200\)/);
  assert.match(spec, /e2e-keep-tool-prefs/);
  assert.match(spec, /tool-pref remount must keep Cloud Bump 8/);
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
