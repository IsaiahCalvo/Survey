import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAnomalies } from '../debug/lib/anomaly-detector.mjs';
import { mergeTimeline } from '../debug/lib/timeline-merger.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE_DIR = join(import.meta.dirname, '..', 'debug', 'fixtures', 'mock-session');

/**
 * Helper to build a minimal manifest with screenshot artifacts.
 */
function makeManifest(screenshots = []) {
  return {
    scenario: 'test',
    result: 'pass',
    captureStartMs: 0,
    artifacts: screenshots.map(f => ({ type: 'screenshot', filename: f })),
  };
}

/**
 * Validate anomaly schema: type, severity, sessionMs, page, detail, refs.
 */
function assertAnomalySchema(anomaly) {
  assert.equal(typeof anomaly.type, 'string', 'type should be a string');
  assert.ok(
    ['critical', 'warning', 'info'].includes(anomaly.severity),
    `severity should be critical/warning/info, got: ${anomaly.severity}`
  );
  assert.equal(typeof anomaly.sessionMs, 'number', 'sessionMs should be a number');
  assert.ok(
    anomaly.page === null || typeof anomaly.page === 'number',
    `page should be number or null, got: ${typeof anomaly.page}`
  );
  assert.equal(typeof anomaly.detail, 'string', 'detail should be a string');
  assert.equal(typeof anomaly.refs, 'object', 'refs should be an object');
}

// Test 1: Schema validation
test('detectAnomalies returns array of anomaly objects with required schema', () => {
  const timeline = mergeTimeline(FIXTURE_DIR);
  const manifest = JSON.parse(
    readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf-8')
  );
  const anomalies = detectAnomalies(timeline, manifest);
  assert.ok(Array.isArray(anomalies), 'result should be an array');
  for (const anomaly of anomalies) {
    assertAnomalySchema(anomaly);
  }
});

// Test 2: Canvas container drop to 0 detected as critical
test('canvas container drop to 0 detected as severity=critical', () => {
  // The mock fixture has canvasContainerCount=0 at sessionMs 3000
  const timeline = [
    { sessionMs: 1000, _source: 'state', _index: 0, canvasContainerCount: 7, step: 0, action: 'baseline', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 1, targetScale: 1, mutations: [] },
    { sessionMs: 2000, _source: 'state', _index: 1, canvasContainerCount: 0, step: 1, action: 'zoom', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 1, targetScale: 1, mutations: [] },
  ];
  const manifest = makeManifest(['step-00_1000ms_baseline.png']);
  const anomalies = detectAnomalies(timeline, manifest);
  const drops = anomalies.filter(a => a.type === 'canvas_container_drop');
  assert.ok(drops.length >= 1, 'should detect at least one canvas container drop');
  assert.equal(drops[0].severity, 'critical');
  assert.equal(drops[0].sessionMs, 2000);
});

// Test 3: Freeze overhang beyond 3000ms detected as critical
test('freeze overhang beyond 3000ms detected as severity=critical', () => {
  const timeline = [
    { sessionMs: 1000, _source: 'state', _index: 0, canvasContainerCount: 7, step: 0, action: 'zoom', freezeState: { zoomOverlayTransformActive: true, scaleConfirmPending: true }, renderedScale: 1, targetScale: 1, mutations: [] },
    { sessionMs: 5000, _source: 'state', _index: 1, canvasContainerCount: 7, step: 1, action: 'settled', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 1, targetScale: 1, mutations: [] },
  ];
  const manifest = makeManifest([]);
  const anomalies = detectAnomalies(timeline, manifest);
  const overhangs = anomalies.filter(a => a.type === 'freeze_overhang');
  assert.ok(overhangs.length >= 1, 'should detect freeze overhang');
  assert.equal(overhangs[0].severity, 'critical');
});

// Test 4: Scale divergence beyond 3000ms detected as warning
test('scale divergence beyond 3000ms detected as severity=warning', () => {
  const timeline = [
    { sessionMs: 1000, _source: 'state', _index: 0, canvasContainerCount: 7, step: 0, action: 'zoom', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 0.5, targetScale: 1, mutations: [] },
    { sessionMs: 5000, _source: 'state', _index: 1, canvasContainerCount: 7, step: 1, action: 'settled', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 1, targetScale: 1, mutations: [] },
  ];
  const manifest = makeManifest([]);
  const anomalies = detectAnomalies(timeline, manifest);
  const divergences = anomalies.filter(a => a.type === 'scale_divergence');
  assert.ok(divergences.length >= 1, 'should detect scale divergence');
  assert.equal(divergences[0].severity, 'warning');
});

// Test 5: Race condition (dom_pageAdded -> pal_mount gap > 100ms) detected as warning
test('race condition gap > 100ms detected as severity=warning', () => {
  const timeline = [
    { sessionMs: 1000, _source: 'state', _index: 0, canvasContainerCount: 7, step: 0, action: 'zoom', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 1, targetScale: 1, mutations: [{ type: 'added', pageNumber: 6, sessionMs: 1000 }] },
    { sessionMs: 1200, _source: 'performance', _index: 0, type: 'mark', name: 'pal_mount', detail: { page: 6 } },
  ];
  const manifest = makeManifest([]);
  const anomalies = detectAnomalies(timeline, manifest);
  const races = anomalies.filter(a => a.type === 'race_condition');
  assert.ok(races.length >= 1, 'should detect race condition');
  assert.equal(races[0].severity, 'warning');
  assert.equal(races[0].page, 6);
});

// Test 6: Race condition escalated to critical when screenshot falls within gap
test('race condition escalated to severity=critical when screenshot in gap', () => {
  const timeline = [
    { sessionMs: 1000, _source: 'state', _index: 0, canvasContainerCount: 7, step: 0, action: 'zoom', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 1, targetScale: 1, mutations: [{ type: 'added', pageNumber: 6, sessionMs: 1000 }] },
    { sessionMs: 1200, _source: 'performance', _index: 0, type: 'mark', name: 'pal_mount', detail: { page: 6 } },
  ];
  // Screenshot at 1100ms falls within the [1000, 1200] gap
  const manifest = makeManifest(['step-01_1100ms_during-zoom.png']);
  const anomalies = detectAnomalies(timeline, manifest);
  const races = anomalies.filter(a => a.type === 'race_condition');
  assert.ok(races.length >= 1, 'should detect race condition');
  assert.equal(races[0].severity, 'critical');
});

// Test 7: Race condition gap 50-100ms detected as info
test('race condition gap 50-100ms detected as severity=info', () => {
  const timeline = [
    { sessionMs: 1000, _source: 'state', _index: 0, canvasContainerCount: 7, step: 0, action: 'zoom', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 1, targetScale: 1, mutations: [{ type: 'added', pageNumber: 6, sessionMs: 1000 }] },
    { sessionMs: 1075, _source: 'performance', _index: 0, type: 'mark', name: 'pal_mount', detail: { page: 6 } },
  ];
  const manifest = makeManifest([]);
  const anomalies = detectAnomalies(timeline, manifest);
  const races = anomalies.filter(a => a.type === 'race_condition');
  assert.ok(races.length >= 1, 'should detect info-level race condition');
  assert.equal(races[0].severity, 'info');
});

// Test 8: Race condition gap < 50ms produces no anomaly
test('race condition gap < 50ms produces no anomaly', () => {
  const timeline = [
    { sessionMs: 1000, _source: 'state', _index: 0, canvasContainerCount: 7, step: 0, action: 'zoom', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 1, targetScale: 1, mutations: [{ type: 'added', pageNumber: 6, sessionMs: 1000 }] },
    { sessionMs: 1030, _source: 'performance', _index: 0, type: 'mark', name: 'pal_mount', detail: { page: 6 } },
  ];
  const manifest = makeManifest([]);
  const anomalies = detectAnomalies(timeline, manifest);
  const races = anomalies.filter(a => a.type === 'race_condition');
  assert.equal(races.length, 0, 'should not detect race condition for gap < 50ms');
});

// Test 9: Clean session returns empty array
test('clean session with no anomalies returns empty array', () => {
  const timeline = [
    { sessionMs: 1000, _source: 'state', _index: 0, canvasContainerCount: 7, step: 0, action: 'baseline', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 1, targetScale: 1, mutations: [] },
    { sessionMs: 2000, _source: 'state', _index: 1, canvasContainerCount: 7, step: 1, action: 'zoom', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 1, targetScale: 1, mutations: [] },
  ];
  const manifest = makeManifest([]);
  const anomalies = detectAnomalies(timeline, manifest);
  assert.equal(anomalies.length, 0, 'should return empty array for clean session');
});

// Test 10: Each anomaly refs includes screenshot filename and stateIndex
test('anomaly refs includes screenshot filename and stateIndex where applicable', () => {
  const timeline = [
    { sessionMs: 1000, _source: 'state', _index: 0, canvasContainerCount: 0, step: 0, action: 'zoom', freezeState: { zoomOverlayTransformActive: false, scaleConfirmPending: false }, renderedScale: 1, targetScale: 1, mutations: [] },
  ];
  const manifest = makeManifest(['step-00_1000ms_baseline.png']);
  const anomalies = detectAnomalies(timeline, manifest);
  assert.ok(anomalies.length >= 1, 'should have at least one anomaly');
  const anomaly = anomalies[0];
  assert.ok('screenshot' in anomaly.refs, 'refs should have screenshot field');
  assert.ok('stateIndex' in anomaly.refs, 'refs should have stateIndex field');
});
