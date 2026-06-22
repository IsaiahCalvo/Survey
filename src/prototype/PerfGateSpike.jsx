// ============================================================================
// PERF-GATE SPIKE — THROWAWAY. Milestone "Renderer Ownership" Phase 1.
// ============================================================================
// THE QUESTION (the only real unknown before we rip out Pdfjs): does the
// owned pdf.js renderer hold ~60fps / <18ms worst frame during a cursor-zoom
// sweep while a HEAVY annotation overlay (hundreds of page-space SVG shapes — the
// same viewBox technique the real SVGAnnotationLayer uses) rides on top?
//
// HOW TO READ IT: Load your heaviest real survey/CAD sheet (or a fixture). Flip
// to "Stress overlay" and crank the density. Scroll around to feel it, then hold
// ctrl/⌘+scroll to zoom in and out and WATCH THE BOTTOM BAR:
//   • fps green ≥55, worst-frame green ≤18ms  → GATE PASSES (overlay holds).
//   • worst-frame red >33ms during the sweep  → the overlay stalls zoom; record it.
// "mounted pages" proves virtualization holds on big docs (only near-viewport
// pages mount). Route: ?spike=perfgate
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import PdfjsArm from './PdfjsArm';
import { useFrameMeter } from './spikeMetrics';
import { createSpikeLog } from './spikeLogger';

const FIXTURES = [
  { label: '120-page (scroll test)', url: '/debug-fixtures/spike-120-pages.pdf' },
  { label: 'Large sheet (deep-zoom)', url: '/debug-fixtures/spike-large-sheet.pdf' },
  { label: 'Real package (36pg)', url: '/debug-fixtures/Package%202%20-%20Rev%204%20--%20IC.pdf' },
];
const QUICK = [['Fit', 'fit'], ['100%', 1], ['400%', 4], ['1600%', 16]];
const DENSITIES = [100, 300, 600, 1000];

export default function PerfGateSpike() {
  const [file, setFile] = useState({ src: FIXTURES[0].url, key: 1, name: FIXTURES[0].label });
  const [status, setStatus] = useState('');
  const [metrics, setMetrics] = useState({});
  const [stress, setStress] = useState(false);          // heavy overlay on/off
  const [density, setDensity] = useState(300);          // shapes per page
  const [annsByPage, setAnnsByPage] = useState({});
  const { perf, bumpActivity } = useFrameMeter();

  // ---- perf log (records every cursor-zoom gesture + worst frame) -----------
  const logRef = useRef(null);
  if (!logRef.current) logRef.current = createSpikeLog();
  const log = logRef.current;
  const [logCount, setLogCount] = useState(0);
  const [savedMsg, setSavedMsg] = useState('');
  const perfRef = useRef(perf);
  const zoomRef = useRef(0);
  const cursorRef = useRef({ x: 0, y: 0 });
  const lastActivityRef = useRef(-1e9);
  useEffect(() => { perfRef.current = perf; }, [perf]);
  useEffect(() => { zoomRef.current = metrics.zoomPct || 0; }, [metrics.zoomPct]);

  const objUrlRef = useRef(null);
  const revokePrev = () => { if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; } };
  useEffect(() => () => revokePrev(), []);

  const loadFixture = (f) => { revokePrev(); setAnnsByPage({}); setFile((p) => ({ src: f.url, key: p.key + 1, name: f.label })); };
  const loadLocal = (f) => {
    revokePrev();
    const url = URL.createObjectURL(f);
    objUrlRef.current = url;
    setAnnsByPage({});
    setFile((p) => ({ src: url, key: p.key + 1, name: f.name }));
  };

  // Reset the synthetic swarm whenever density or stress-mode flips so pages
  // re-seed at the new count (the renderer skips pages that already have anns).
  useEffect(() => { setAnnsByPage({}); }, [density, stress]);

  const onAnns = useCallback((idx, next) => setAnnsByPage((prev) => ({ ...prev, [idx]: next })), []);
  const onMetrics = useCallback((m) => setMetrics((prev) => ({ ...prev, ...m })), []);
  const onStatus = useCallback((s) => setStatus(s), []);
  // every page re-raster (base + deep-zoom tile) and every zoom start/settle land
  // in the log so a saved file shows exactly what the viewer was doing at each catch.
  const onRasterEvent = useCallback((r) => { log.event('raster', r); setLogCount(log.count()); }, [log]);
  const onZoomPhase = useCallback((phase, data) => { log.event(`zoom-${phase}`, data || {}); setLogCount(log.count()); }, [log]);

  // dropped-frame detector: timestamps any frame longer than 33ms (a visible catch)
  // while you're actively interacting, with the live zoom level.
  useEffect(() => {
    let raf; let last = performance.now();
    const tick = (now) => {
      const gap = now - last; last = now;
      if (gap > 33 && (now - lastActivityRef.current) < 1200) {
        log.event('long-frame', { ms: Math.round(gap), zoomPct: zoomRef.current });
        setLogCount(log.count());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [log]);

  // record the current test config into the log whenever it changes
  useEffect(() => {
    const fileKind = file.src.startsWith('blob:') ? 'local desktop' : 'fixture';
    log.setContext({ file: file.name, fileKind });
    log.event('file', { file: file.name, fileKind });
    setLogCount(log.count());
  }, [file.key, log]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    log.event('config', { stress, shapesPerPage: stress ? density : 0 });
    setLogCount(log.count());
  }, [stress, density, log]);

  // cursor + wheel: keep the frame meter live AND aggregate each ctrl/⌘-zoom
  // gesture into one log entry tagged with its worst frame time.
  useEffect(() => {
    const gesture = { current: null };
    let flushTimer = null;
    const flush = () => {
      const g = gesture.current; gesture.current = null;
      if (!g || g.ticks < 1) return;
      const durS = Math.max(0.001, (g.lastPerf - g.startPerf) / 1000);
      const endZoom = zoomRef.current;
      log.gesture({
        cursorX: g.cursorX, cursorY: g.cursorY, ticks: g.ticks,
        durationS: Number(durS.toFixed(2)), ticksPerSec: Math.round(g.ticks / durS),
        deltaPerSec: Math.round(g.totalDeltaY / durS),
        startZoomPct: g.startZoom, endZoomPct: endZoom,
        zoomPctPerSec: Math.round((endZoom - g.startZoom) / durS),
        worstFrameMs: Math.round(g.worst), stress, shapesPerPage: stress ? density : 0,
      });
      setLogCount(log.count());
    };
    const onMove = (e) => { lastActivityRef.current = performance.now(); bumpActivity(); cursorRef.current = { x: Math.round(e.clientX), y: Math.round(e.clientY) }; };
    const onWheel = (e) => {
      lastActivityRef.current = performance.now(); bumpActivity();
      if (!(e.ctrlKey || e.metaKey)) return;
      const now = performance.now();
      if (!gesture.current) gesture.current = { ticks: 0, totalDeltaY: 0, startPerf: now, lastPerf: now, startZoom: zoomRef.current, cursorX: Math.round(e.clientX), cursorY: Math.round(e.clientY), worst: 0 };
      const g = gesture.current;
      g.ticks += 1; g.totalDeltaY += e.deltaY; g.lastPerf = now;
      g.worst = Math.max(g.worst, perfRef.current.worstFrame || 0);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 220);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('wheel', onWheel); if (flushTimer) clearTimeout(flushTimer); };
  }, [bumpActivity, log, stress, density]);

  // periodic timeline sampler — only while actively interacting
  useEffect(() => {
    const id = setInterval(() => {
      if (performance.now() - lastActivityRef.current > 1200) return;
      log.sample({ zoomPct: zoomRef.current, cursorX: cursorRef.current.x, cursorY: cursorRef.current.y, fps: perfRef.current.fps, worstFrameMs: perfRef.current.worstFrame, mounted: metrics.mounted, rasterMs: metrics.rasterMs });
      setLogCount(log.count());
    }, 250);
    return () => clearInterval(id);
  }, [log, metrics.mounted, metrics.rasterMs]);

  const saveLog = useCallback(async () => {
    try {
      const savedPath = await log.saveToServer();
      setSavedMsg(`saved → ${savedPath}`);
    } catch {
      const fn = log.save();
      setSavedMsg(`downloaded "${fn}"`);
    }
    setTimeout(() => setSavedMsg(''), 6000);
  }, [log]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); saveLog(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveLog]);

  const doQuick = (val) => { window.__spikePdfjs?.zoomTo(val === 'fit' ? 'fitw' : val); log.event('quickzoom', { label: String(val) }); setLogCount(log.count()); };
  const C = { text: '#9aa0a6', good: '#30d158', warn: '#ffd60a', bad: '#ff453a', white: '#fff' };
  const fpsColor = perf.fps >= 55 ? C.good : perf.fps >= 30 ? C.warn : C.bad;
  const worstColor = perf.worstFrame <= 18 ? C.good : perf.worstFrame <= 33 ? C.warn : C.bad;

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#2a2d31', color: '#e8e8e8', fontFamily: 'system-ui, sans-serif' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: '#1c1e21', borderBottom: '1px solid #000', flexWrap: 'wrap' }}>
        <strong style={{ color: '#ffcf5c' }}>⚡ Perf-Gate Spike</strong>
        <label style={{ cursor: 'pointer', background: '#3a7afe', padding: '5px 10px', borderRadius: 5, fontSize: 13 }}>
          Load PDF…
          <input type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadLocal(f); }} />
        </label>
        {FIXTURES.map((f) => (
          <button key={f.url} onClick={() => loadFixture(f)}
            style={{ background: file.name === f.label ? '#2b5fd0' : '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer', fontSize: 12 }}>
            {f.label}
          </button>
        ))}
        <span style={{ fontSize: 12, opacity: 0.8, marginLeft: 'auto', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.name} · {status}
        </span>
      </div>

      {/* overlay controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 14px', background: '#16181a', borderBottom: '1px solid #000', flexWrap: 'wrap', fontSize: 13 }}>
        <button onClick={() => setStress((v) => !v)}
          style={{ background: stress ? '#b8860b' : '#333', color: stress ? '#fff' : '#ddd', border: '1px solid #555', borderRadius: 5, padding: '5px 12px', cursor: 'pointer', fontWeight: stress ? 700 : 400 }}>
          {stress ? '🔥 Stress overlay ON' : 'Stress overlay OFF'}
        </button>
        {stress && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.text }}>
            shapes / page:
            {DENSITIES.map((d) => (
              <button key={d} onClick={() => setDensity(d)}
                style={{ background: density === d ? '#3a7afe' : '#333', color: density === d ? '#fff' : '#ddd', border: '1px solid #555', borderRadius: 4, padding: '3px 9px', cursor: 'pointer' }}>{d}</button>
            ))}
          </span>
        )}
        <span style={{ color: C.text, opacity: 0.85 }}>
          Imported markups are always shown + draggable. {stress ? 'Stress swarm added on top — hold ⌘/ctrl + scroll to zoom, watch worst-frame stay green.' : 'Scroll + ⌘/ctrl-scroll to explore; flip the swarm on to load-test.'}
        </span>
      </div>

      {/* stage */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <PdfjsArm
          fileSrc={file.src}
          fileKey={file.key}
          editMode
          stressShapesPerPage={stress ? density : 0}
          annsByPage={annsByPage}
          onAnnsChange={onAnns}
          onMetrics={onMetrics}
          onStatus={onStatus}
          onRasterEvent={onRasterEvent}
          onZoomPhase={onZoomPhase}
        />
      </div>

      {/* bottom bar — live meters + gate thresholds */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', background: '#1c1e21', borderTop: '1px solid #000', fontSize: 13, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {QUICK.map(([label, val]) => (
            <button key={label} onClick={() => doQuick(val)}
              style={{ background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer' }}>{label}</button>
          ))}
          <button onClick={() => window.__spikePdfjs?.rotate?.()}
            style={{ background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer' }}>Rotate</button>
        </div>
        <span style={{ color: C.text }}>zoom <strong style={{ color: C.white }}>{metrics.zoomPct ?? '—'}%</strong></span>
        <span style={{ color: C.text }}>fps <strong style={{ color: fpsColor }}>{perf.fps}</strong></span>
        <span style={{ color: C.text }}>worst frame <strong style={{ color: worstColor }}>{perf.worstFrame}ms</strong></span>
        <span style={{ color: C.text }}>mounted pages <strong style={{ color: C.white }}>{metrics.mounted ?? '—'}</strong></span>
        <span style={{ color: C.text }}>raster <strong style={{ color: C.white }}>{metrics.rasterMs ?? '—'}ms</strong></span>
        {perf.heapMB ? <span style={{ color: C.text }}>heap <strong style={{ color: C.white }}>{perf.heapMB}MB</strong></span> : null}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: C.text, fontSize: 12 }}>
            gate: fps <strong style={{ color: C.good }}>≥55</strong> · worst <strong style={{ color: C.good }}>≤18ms</strong>{stress ? ` · ${density}/pg` : ''}
          </span>
          {savedMsg ? <span style={{ color: C.good, fontSize: 12 }}>{savedMsg}</span> : null}
          <span style={{ color: C.text, fontSize: 12 }}>log <strong style={{ color: C.white }}>{logCount}</strong></span>
          <button onClick={saveLog} title="Save to Logs/ (⌘⇧L)"
            style={{ background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 12px', cursor: 'pointer', fontWeight: 600 }}>
            💾 Save log <span style={{ opacity: 0.7, fontWeight: 400, fontSize: 11 }}>⌘⇧L</span>
          </button>
        </div>
      </div>
    </div>
  );
}
