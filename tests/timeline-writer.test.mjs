import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { writeNarrative } from '../debug/lib/timeline-writer.mjs';

// Shared test fixtures
const MANIFEST = {
  scenario: 'zoom-flicker',
  result: 'pass',
  startTime: '2026-03-13T04:07:42.432Z',
  endTime: '2026-03-13T04:07:46.901Z',
  captureStartMs: 900,
  criteriaResults: {
    canvasContainersPresent: { pass: true, value: 7 },
    noConsoleErrors: { pass: true, errorCount: 0 },
  },
  artifacts: [
    { type: 'screenshot', filename: 'step-00_1000ms_baseline-initial-state.png' },
    { type: 'screenshot', filename: 'step-01_2000ms_before-zoom-100pct.png' },
    { type: 'screenshot', filename: 'step-01_3000ms_after-zoom-100pct.png' },
  ],
};

/**
 * Build a minimal timeline with state entries for steps 0 and 1.
 */
function buildTimeline() {
  return [
    // Step 0: baseline
    {
      sessionMs: 1000, step: 0, action: 'baseline',
      zoomLevel: 50, renderedScale: 0.5, targetScale: 0.5,
      freezeState: { scaleConfirmPending: false, zoomOverlayTransformActive: false },
      canvasContainerCount: 7, pageStatus: {}, mutations: [], signals: [],
      _source: 'state', _index: 0,
    },
    // Step 1: zoom to 100%
    {
      sessionMs: 2000, step: 1, action: 'zoom-to-100',
      zoomLevel: 100, renderedScale: 0.5, targetScale: 1.0,
      freezeState: { scaleConfirmPending: true, zoomOverlayTransformActive: true },
      canvasContainerCount: 7, pageStatus: {}, mutations: [], signals: [],
      _source: 'state', _index: 1,
    },
    // Performance mark during step 1
    {
      sessionMs: 2100, type: 'mark', name: 'zoom_start',
      detail: { from: 50, to: 100 },
      _source: 'performance', _index: 0,
    },
    // Step 1 end state
    {
      sessionMs: 3000, step: 1, action: 'zoom-to-100',
      zoomLevel: 100, renderedScale: 1.0, targetScale: 1.0,
      freezeState: { scaleConfirmPending: false, zoomOverlayTransformActive: false },
      canvasContainerCount: 7, pageStatus: {}, mutations: [], signals: [],
      _source: 'state', _index: 2,
    },
  ];
}

const TEMP_DIR = join(process.cwd(), '.test-temp-timeline-writer');

describe('writeNarrative', () => {
  before(() => {
    mkdirSync(TEMP_DIR, { recursive: true });
  });

  after(() => {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  it('produces header with scenario name, result, duration, anomaly counts', () => {
    const timeline = buildTimeline();
    const anomalies = [];
    const md = writeNarrative(timeline, anomalies, MANIFEST, TEMP_DIR);

    assert.ok(md.includes('zoom-flicker'), 'Should include scenario name');
    assert.ok(md.includes('PASS'), 'Should include result');
    assert.ok(/duration/i.test(md), 'Should include duration');
    assert.ok(/anomal/i.test(md), 'Should mention anomalies');
  });

  it('includes verdict based on anomaly severity (critical -> requires investigation)', () => {
    const timeline = buildTimeline();
    const anomalies = [
      {
        type: 'canvas_container_drop', severity: 'critical',
        sessionMs: 2500, page: null,
        detail: 'Canvas container count dropped to 0',
        refs: { stateIndex: 1, screenshot: null },
      },
    ];
    const md = writeNarrative(timeline, anomalies, MANIFEST, TEMP_DIR);
    assert.ok(/requiring? investigation/i.test(md), 'Critical anomalies should trigger investigation verdict');
  });

  it('includes verdict for warnings-only (review recommended)', () => {
    const timeline = buildTimeline();
    const anomalies = [
      {
        type: 'scale_divergence', severity: 'warning',
        sessionMs: 2500, page: null,
        detail: 'renderedScale != targetScale',
        refs: { stateIndex: 1, screenshot: null },
      },
    ];
    const md = writeNarrative(timeline, anomalies, MANIFEST, TEMP_DIR);
    assert.ok(/review recommended/i.test(md), 'Warning-only session should recommend review');
  });

  it('produces per-step sections with step number and time range', () => {
    const timeline = buildTimeline();
    const anomalies = [];
    const md = writeNarrative(timeline, anomalies, MANIFEST, TEMP_DIR);

    assert.ok(/## Step 0/i.test(md), 'Should have Step 0 section');
    assert.ok(/## Step 1/i.test(md), 'Should have Step 1 section');
  });

  it('inserts inline anomaly callouts with severity within step sections', () => {
    const timeline = buildTimeline();
    const anomalies = [
      {
        type: 'canvas_container_drop', severity: 'critical',
        sessionMs: 2500, page: null,
        detail: 'Canvas container count dropped to 0',
        refs: { stateIndex: 1, screenshot: 'step-01_2000ms_before-zoom-100pct.png' },
      },
    ];
    const md = writeNarrative(timeline, anomalies, MANIFEST, TEMP_DIR);

    assert.ok(md.includes('CRITICAL'), 'Should include severity in callout');
    assert.ok(md.includes('canvas_container_drop'), 'Should include anomaly type in callout');
    assert.ok(md.includes('Canvas container count dropped'), 'Should include detail in callout');
  });

  it('summarizes rapid DOM mutations as count + time span (noise collapsing)', () => {
    const mutations = [];
    for (let i = 0; i < 5; i++) {
      mutations.push({
        type: 'removed', pageNumber: 6, sessionMs: 2100 + i * 10,
      });
    }
    const timeline = [
      {
        sessionMs: 2000, step: 1, action: 'zoom-to-100',
        zoomLevel: 100, renderedScale: 0.5, targetScale: 1.0,
        freezeState: { scaleConfirmPending: true },
        canvasContainerCount: 7, pageStatus: {},
        mutations,
        signals: [],
        _source: 'state', _index: 0,
      },
      {
        sessionMs: 3000, step: 1, action: 'zoom-to-100',
        zoomLevel: 100, renderedScale: 1.0, targetScale: 1.0,
        freezeState: { scaleConfirmPending: false },
        canvasContainerCount: 7, pageStatus: {},
        mutations: [],
        signals: [],
        _source: 'state', _index: 1,
      },
    ];
    const md = writeNarrative(timeline, [], MANIFEST, TEMP_DIR);

    // Should summarize mutations as a count, not list each one
    assert.ok(/page 6/i.test(md), 'Should reference page 6');
    assert.ok(/5 times/i.test(md) || /5 mutations/i.test(md) || /5x/i.test(md),
      'Should summarize mutation count');
  });

  it('shows CDP metrics only when exceeding thresholds', () => {
    const timeline = [
      // Start of step 1
      {
        sessionMs: 2000, step: 1, action: 'zoom-to-100',
        zoomLevel: 100, renderedScale: 0.5, targetScale: 1.0,
        freezeState: {}, canvasContainerCount: 7, pageStatus: {},
        mutations: [], signals: [],
        _source: 'state', _index: 0,
      },
      // CDP at start
      {
        sessionMs: 2010, type: 'cdp', name: 'Metrics',
        metrics: { LayoutCount: 10, TaskDuration: 0.5, RecalcStyleCount: 5 },
        _source: 'performance', _index: 0,
      },
      // CDP at end (LayoutCount delta = 30 > 20 threshold)
      {
        sessionMs: 2900, type: 'cdp', name: 'Metrics',
        metrics: { LayoutCount: 40, TaskDuration: 0.55, RecalcStyleCount: 8 },
        _source: 'performance', _index: 1,
      },
      // End state
      {
        sessionMs: 3000, step: 1, action: 'zoom-to-100',
        zoomLevel: 100, renderedScale: 1.0, targetScale: 1.0,
        freezeState: {}, canvasContainerCount: 7, pageStatus: {},
        mutations: [], signals: [],
        _source: 'state', _index: 1,
      },
    ];
    const md = writeNarrative(timeline, [], MANIFEST, TEMP_DIR);

    // LayoutCount delta = 30 exceeds threshold of 20, so it should be shown
    assert.ok(/LayoutCount/i.test(md), 'Should display LayoutCount delta (30 > 20 threshold)');
  });

  it('produces clean output with no callout blocks for clean session', () => {
    const timeline = buildTimeline();
    const anomalies = [];
    const md = writeNarrative(timeline, anomalies, MANIFEST, TEMP_DIR);

    assert.ok(/no anomalies detected/i.test(md), 'Clean session should state no anomalies');
    assert.ok(!md.includes('> **CRITICAL'), 'Should have no critical callouts');
    assert.ok(!md.includes('> **WARNING'), 'Should have no warning callouts');
  });
});
