import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSpikeLog } from '../src/prototype/spikeLogger.js';

test('the feature demo is the only PDF.js spike route and owns performance mode', async () => {
  const [mainSource, featureSource] = await Promise.all([
    readFile(new URL('../src/main.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/prototype/FeatureSpike.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(mainSource, /spike === 'features'/);
  assert.doesNotMatch(mainSource, /spike === '(?:renderer|perfgate)'/);
  assert.match(featureSource, /data-testid="performance-mode-toggle"/);
  assert.match(featureSource, /data-testid="performance-gate"/);
  assert.match(featureSource, /mode', 'performance'/);
  assert.match(featureSource, /onRasterEvent={onRasterEvent}/);
  assert.match(featureSource, /onZoomPhase={onZoomPhase}/);
});

test('performance logs use the single-engine PDF.js format', () => {
  const log = createSpikeLog();
  log.setContext({ file: 'Stress PDF (120pg)', fileKind: 'fixture' });
  log.event('file', { file: 'Stress PDF (120pg)', fileKind: 'fixture' });
  log.sample({ zoomPct: 400, fps: 58, worstFrameMs: 17, mounted: 2, rasterMs: 12 });
  log.gesture({
    cursorX: 100,
    cursorY: 200,
    ticks: 4,
    durationS: 0.2,
    ticksPerSec: 20,
    deltaPerSec: -800,
    startZoomPct: 100,
    endZoomPct: 400,
    zoomPctPerSec: 1500,
    worstFrameMs: 17,
  });

  const output = log.build();
  assert.match(output, /^PDF\.JS FEATURE PERFORMANCE LOG/);
  assert.match(output, /worst frame: 17ms \(min 58fps\)/);
  assert.match(output, /zoom: 400%–400%/);
  assert.doesNotMatch(output, /EmbedPDF|COMPARISON|per tab/i);
  assert.match(log.filename(), /^PDF\.js feature performance .+\.log$/);
});
