// ============================================================================
// PROTOTYPE — THROWAWAY. Comparison logger for the renderer spike.
// ============================================================================
// Records everything needed to diagnose/compare pdf.js vs EmbedPDF across
// testing rounds: what the user did, the trackpad zoom-input rate, the actual
// PDF zoom rate, cursor position, worst frame times, and — tagged on EVERY
// entry — which tab (pdf.js / embedpdf) and which file (bundled fixture vs a
// local desktop file). "Save log" downloads a timestamped text file the user
// drops into their Logs folder and points back at us.
// ============================================================================

function pad(n) { return String(n).padStart(2, '0'); }

function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export function createSpikeLog() {
  const startDate = new Date();
  const startPerf = performance.now();
  const events = [];
  let ctx = { tab: 'pdfjs', file: '(none)', fileKind: 'fixture' };
  const filesSeen = new Set();
  const rel = () => Number(((performance.now() - startPerf) / 1000).toFixed(2));
  const push = (type, data) => { events.push({ rel: rel(), tab: ctx.tab, file: ctx.file, type, ...data }); };

  const tabLabel = (t) => (t === 'embedpdf' ? 'EmbedPDF' : 'pdf.js');

  return {
    setContext(next) {
      ctx = { ...ctx, ...next };
      if (next.file) filesSeen.add(`${next.file} [${ctx.fileKind}]`);
    },
    getTab: () => ctx.tab,
    event(type, data) { push(type, data || {}); },
    sample(s) { push('sample', s); },
    gesture(g) { push('zoom-gesture', g); },
    count: () => events.length,

    build() {
      const dur = rel();
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const lines = [];
      lines.push('PDF RENDER COMPARISON LOG');
      lines.push(`Generated:        ${stamp(new Date())}`);
      lines.push(`Session start:    ${stamp(startDate)}`);
      lines.push(`Session duration: ${dur}s`);
      lines.push(`Device pixel ratio: ${dpr}`);
      lines.push(`Files used:       ${[...filesSeen].join(', ') || '(none)'}`);
      lines.push('');

      // ---- per-tab summary ----
      lines.push('== SUMMARY (per tab) ==');
      for (const tab of ['pdfjs', 'embedpdf']) {
        const ev = events.filter((e) => e.tab === tab);
        if (!ev.length) continue;
        const gestures = ev.filter((e) => e.type === 'zoom-gesture');
        const samples = ev.filter((e) => e.type === 'sample');
        const zooms = samples.map((s) => s.zoomPct).filter((z) => typeof z === 'number');
        const worst = Math.max(0, ...samples.map((s) => s.worstFrameMs || 0), ...gestures.map((g) => g.worstFrameMs || 0));
        const fpsVals = samples.map((s) => s.fps).filter((f) => typeof f === 'number' && f > 0); // ignore warm-up 0s
        const minFps = fpsVals.length ? Math.min(...fpsVals) : 999;
        const rasters = samples.map((s) => s.rasterMs).filter((r) => typeof r === 'number' && r > 0);
        const avgRaster = rasters.length ? Math.round(rasters.reduce((a, b) => a + b, 0) / rasters.length) : 0;
        const maxMounted = Math.max(0, ...samples.map((s) => s.mounted || 0));
        const clampedHit = samples.some((s) => s.clamped);
        lines.push(
          `[${tabLabel(tab)}]  gestures: ${gestures.length}  |  zoom: ${zooms.length ? Math.min(...zooms) + '%–' + Math.max(...zooms) + '%' : 'n/a'}  |  ` +
          `worst frame: ${worst}ms${minFps < 999 ? ` (min ${minFps}fps)` : ''}  |  avg raster: ${avgRaster}ms  |  max mounted: ${maxMounted}${clampedHit ? '  |  CLAMPED hit' : ''}`
        );
      }
      lines.push('');

      // ---- zoom gestures (input rate vs actual zoom rate) ----
      const gestures = events.filter((e) => e.type === 'zoom-gesture');
      if (gestures.length) {
        lines.push('== ZOOM GESTURES (trackpad input rate vs actual PDF zoom rate) ==');
        for (const g of gestures) {
          lines.push(
            `t=${g.rel}s [${tabLabel(g.tab)}] cursor(${g.cursorX},${g.cursorY})  ` +
            `input: ${g.ticks} ticks / ${g.durationS}s = ${g.ticksPerSec}/s (Δ${g.deltaPerSec}/s)  ` +
            `zoom: ${g.startZoomPct}%→${g.endZoomPct}% (${g.zoomPctPerSec}%/s)  worst ${g.worstFrameMs}ms`
          );
        }
        lines.push('');
      }

      // ---- discrete events ----
      const ev = events.filter((e) => ['tab', 'file', 'drag', 'rotate', 'quickzoom', 'config', 'zoom-gesture-start', 'zoom-settle'].includes(e.type));
      if (ev.length) {
        lines.push('== EVENTS ==');
        for (const e of ev) {
          if (e.type === 'tab') lines.push(`t=${e.rel}s  TAB → ${tabLabel(e.to)}`);
          else if (e.type === 'file') lines.push(`t=${e.rel}s  LOAD file="${e.file}" [${e.fileKind}]`);
          else if (e.type === 'drag') lines.push(`t=${e.rel}s [${tabLabel(e.tab)}]  DRAG annotation (page ${e.page})`);
          else if (e.type === 'rotate') lines.push(`t=${e.rel}s [${tabLabel(e.tab)}]  ROTATE`);
          else if (e.type === 'quickzoom') lines.push(`t=${e.rel}s [${tabLabel(e.tab)}]  QUICK ZOOM ${e.label}`);
          else if (e.type === 'config') lines.push(`t=${e.rel}s  CONFIG stress=${e.stress ? 'ON' : 'off'} shapes/page=${e.shapesPerPage}`);
          else if (e.type === 'zoom-gesture-start') lines.push(`t=${e.rel}s  ZOOM START @ ${e.atPct}%`);
          else if (e.type === 'zoom-settle') lines.push(`t=${e.rel}s  ZOOM SETTLE ${e.fromPct}% → ${e.toPct}% (re-raster begins)`);
        }
        lines.push('');
      }

      // ---- dropped frames (the catches) ----
      const longFrames = events.filter((e) => e.type === 'long-frame');
      lines.push(`== DROPPED FRAMES (>33ms during interaction): ${longFrames.length} ==`);
      if (longFrames.length) {
        const worstLF = Math.max(...longFrames.map((e) => e.ms));
        lines.push(`worst single frame: ${worstLF}ms`);
        for (const e of longFrames) lines.push(`t=${e.rel}s  ${e.ms}ms frame @ ${e.zoomPct}%`);
      } else {
        lines.push('(none — no visible catches captured)');
      }
      lines.push('');

      // ---- page raster timings (base re-raster + deep-zoom tiles) ----
      const rasterEvents = events.filter((e) => e.type === 'raster');
      if (rasterEvents.length) {
        const base = rasterEvents.filter((e) => e.kind === 'base');
        const tiles = rasterEvents.filter((e) => e.kind === 'tile');
        const stat = (arr) => {
          if (!arr.length) return 'none';
          const ms = arr.map((e) => e.ms);
          return `${arr.length} renders, avg ${Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)}ms, worst ${Math.max(...ms)}ms`;
        };
        lines.push('== PAGE RASTERS ==');
        lines.push(`base page re-raster: ${stat(base)}`);
        lines.push(`deep-zoom tiles:     ${stat(tiles)}`);
        const slowest = [...rasterEvents].sort((a, b) => b.ms - a.ms).slice(0, 12);
        lines.push('slowest renders:');
        for (const e of slowest) lines.push(`  t=${e.rel}s  ${e.kind} p${e.page}  ${e.ms}ms  ${e.mp}MP @ ${e.zoomPct}%`);
        lines.push('');
      }

      // ---- full timeline samples ----
      const samples = events.filter((e) => e.type === 'sample');
      lines.push(`== TIMELINE (${samples.length} samples while interacting) ==`);
      for (const s of samples) {
        lines.push(
          `t=${s.rel}s [${tabLabel(s.tab)}] zoom=${s.zoomPct ?? '—'}% cursor(${s.cursorX ?? '—'},${s.cursorY ?? '—'}) ` +
          `fps=${s.fps ?? '—'} worst=${s.worstFrameMs ?? '—'}ms mounted=${s.mounted ?? '—'} raster=${s.rasterMs ?? '—'}ms${s.clamped ? ' CLAMPED' : ''} file="${s.file}"`
        );
      }
      return lines.join('\n') + '\n';
    },

    filename() { return `PDF render comparison ${stamp(new Date())}.log`; },

    // Browser download (fallback). Goes to the OS Downloads folder.
    save() {
      const text = this.build();
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.filename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return this.filename();
    },

    // Dev-server save: POST the log to the Vite middleware, which writes it into
    // the project's Logs/ folder with the same chronological filename scheme. A
    // browser can't write to a project path directly, so this is the only way to
    // land logs in Logs/. Returns the saved relative path (e.g. "Logs/PDF render …").
    async saveToServer() {
      const filename = this.filename();
      const text = this.build();
      const res = await fetch('/__save-spike-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, text }),
      });
      if (!res.ok) throw new Error(`server save failed: ${res.status}`);
      const data = await res.json().catch(() => ({}));
      return data.path || `Logs/${filename}`;
    },
  };
}
