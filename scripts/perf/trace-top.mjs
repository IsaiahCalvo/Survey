#!/usr/bin/env node
// Summarise a Chrome trace (drag-frames.mjs TRACE=1): time per event name on
// the renderer main thread and the compositor / raster threads, so a slow
// drag can be split into script, style, layout, paint and raster (software
// raster runs on ThreadPoolForegroundWorker threads).
//
//   node scripts/perf/trace-top.mjs run-multi.trace.json
import fs from 'node:fs';

const [file] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const events = Array.isArray(raw) ? raw : raw.traceEvents;
const threadName = new Map();
for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args.name);
const WATCH = /^(CrRendererMain|Compositor|CompositorTileWorker.*|ThreadPoolForegroundWorker.*|VizCompositorThread|CrGpuMain)$/;
const NAMES = new Set(['FunctionCall', 'EventDispatch', 'TimerFire', 'FireAnimationFrame', 'RunMicrotasks', 'v8.run', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'PaintImage', 'Layerize', 'Commit', 'RasterTask', 'ImageDecodeTask', 'UpdateLayer', 'ScheduleStyleRecalculation', 'HitTest', 'GPUTask', 'Animation', 'ProxyMain::BeginMainFrame', 'ThreadProxy::BeginMainFrame', 'PaintArtifactCompositor::Update', 'RasterTask']);
const sums = new Map();
for (const e of events) {
  if (e.ph !== 'X' || !NAMES.has(e.name)) continue;
  const thread = threadName.get(`${e.pid}:${e.tid}`) || '?';
  if (!WATCH.test(thread)) continue;
  const key = `${thread.replace(/\d+$/, '')} ${e.name}`;
  const cur = sums.get(key) || { ms: 0, n: 0 };
  cur.ms += (e.dur || 0) / 1000;
  cur.n += 1;
  sums.set(key, cur);
}
for (const [k, v] of [...sums].sort((a, b) => b[1].ms - a[1].ms).slice(0, 30)) {
  console.log(`${v.ms.toFixed(0).padStart(7)} ms ${String(v.n).padStart(5)}x  ${k}`);
}
