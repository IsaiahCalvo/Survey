const data = JSON.parse(require('fs').readFileSync(process.argv[2] || '1.log', 'utf8'));
const s = data.summary;
console.log('=== SUMMARY ===');
console.log('Samples:', s.sampleCount, '| Duration:', (s.durationMs/1000).toFixed(1)+'s');
console.log('Frame avg:', s.frameMsAvg.toFixed(1)+'ms | P95:', s.frameMsP95.toFixed(1)+'ms | Max:', s.frameMsMax.toFixed(1)+'ms');
console.log('Jank frames:', s.jankFrames, '/', s.sampleCount, '=', s.jankFrameRatePct.toFixed(1)+'%');
console.log('Missing overlays max:', s.missingOverlayCountMax, '| samples with missing:', s.samplesWithMissingOverlay, '('+s.samplesWithMissingOverlayPct+'%)');
console.log('Scale mismatch max:', s.scaleMismatchMax, '| P95:', s.scaleMismatchP95);
console.log('Worst drift px max:', s.worstDriftPxMax, '| P95:', s.worstDriftPxP95);
console.log();

const samples = data.samples;
const zoomSamples = samples.filter(s => s.interactionEventDeltas && s.interactionEventDeltas.syncfusionZoomChange > 0);
const jankSamples = samples.filter(s => s.frameMs > 100);
const highJank = samples.filter(s => s.frameMs > 300);

console.log('=== ZOOM ACTIVITY ===');
console.log('Samples with zoom events:', zoomSamples.length);
console.log('Jank samples (>100ms):', jankSamples.length);
console.log('High jank (>300ms):', highJank.length);
console.log();

// Analyze viewer scale transitions to identify zoom-in vs zoom-out
console.log('=== SCALE TRANSITIONS ===');
let prevScale = null;
let zoomInJank = [], zoomOutJank = [];
for (const sam of samples) {
  if (prevScale != null && sam.viewerScale !== prevScale) {
    if (sam.frameMs > 50) {
      if (sam.viewerScale > prevScale) zoomInJank.push(sam);
      else zoomOutJank.push(sam);
    }
  }
  prevScale = sam.viewerScale;
}
console.log('Zoom-in jank samples (>50ms):', zoomInJank.length);
if (zoomInJank.length > 0) {
  const avg = zoomInJank.reduce((a,b) => a + b.frameMs, 0) / zoomInJank.length;
  console.log('  Avg frame:', avg.toFixed(1)+'ms');
  console.log('  Max frame:', Math.max(...zoomInJank.map(s => s.frameMs))+'ms');
}
console.log('Zoom-out jank samples (>50ms):', zoomOutJank.length);
if (zoomOutJank.length > 0) {
  const avg = zoomOutJank.reduce((a,b) => a + b.frameMs, 0) / zoomOutJank.length;
  console.log('  Avg frame:', avg.toFixed(1)+'ms');
  console.log('  Max frame:', Math.max(...zoomOutJank.map(s => s.frameMs))+'ms');
}
console.log();

// Show missing overlay events (annotations disappearing)
const missingOverlaySamples = samples.filter(s => s.missingOverlayCount > 0);
console.log('=== MISSING OVERLAYS (annotations disappearing) ===');
console.log('Samples with missing overlays:', missingOverlaySamples.length);
if (missingOverlaySamples.length > 0) {
  for (const sam of missingOverlaySamples.slice(0, 15)) {
    console.log('  t=' + sam.tMs.toFixed(0) + 'ms frame=' + sam.frameMs + 'ms missing=' + sam.missingOverlayCount + ' pages=' + JSON.stringify(sam.missingOverlayPages) + ' viewerScale=' + sam.viewerScale + ' appScale=' + sam.appScale + ' phase=' + sam.interactionPhase);
  }
  if (missingOverlaySamples.length > 15) console.log('  ... and', missingOverlaySamples.length - 15, 'more');
}
console.log();

// Show container mutation events (potential PAL remounts)
const mutationSamples = samples.filter(s => s.interactionEventDeltas && s.interactionEventDeltas.syncfusionContainerMutation > 0);
console.log('=== CONTAINER MUTATIONS (potential PAL remounts) ===');
console.log('Samples with mutations:', mutationSamples.length);
for (const sam of mutationSamples.slice(0, 10)) {
  console.log('  t=' + sam.tMs.toFixed(0) + 'ms frame=' + sam.frameMs + 'ms mutations=' + sam.interactionEventDeltas.syncfusionContainerMutation + ' viewerScale=' + sam.viewerScale + ' missing=' + sam.missingOverlayCount);
}
console.log();

// Show the worst 10 jank frames with context
console.log('=== TOP 10 WORST FRAMES ===');
const sorted = [...samples].sort((a, b) => b.frameMs - a.frameMs).slice(0, 10);
for (const sam of sorted) {
  const zoomDelta = sam.interactionEventDeltas ? sam.interactionEventDeltas.syncfusionZoomChange : 0;
  const mutDelta = sam.interactionEventDeltas ? sam.interactionEventDeltas.syncfusionContainerMutation : 0;
  console.log('  t=' + sam.tMs.toFixed(0) + 'ms frame=' + sam.frameMs + 'ms viewerScale=' + sam.viewerScale + ' appScale=' + sam.appScale + ' zoomEvents=' + zoomDelta + ' mutations=' + mutDelta + ' missing=' + sam.missingOverlayCount + ' phase=' + sam.interactionPhase);
}
console.log();

// Show overlay transform deltas across zoom periods
const transformSamples = samples.filter(s => s.overlayTransformDeltas && (s.overlayTransformDeltas.writes > 0 || s.overlayTransformDeltas.resets > 0));
console.log('=== OVERLAY TRANSFORM ACTIVITY ===');
console.log('Samples with transform writes/resets:', transformSamples.length);
for (const sam of transformSamples.slice(0, 15)) {
  const td = sam.overlayTransformDeltas;
  console.log('  t=' + sam.tMs.toFixed(0) + 'ms frame=' + sam.frameMs + 'ms writes=' + td.writes + ' resets=' + td.resets + ' skips=' + td.skips + ' viewerScale=' + sam.viewerScale);
}
