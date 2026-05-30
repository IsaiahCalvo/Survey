// ============================================================================
// PROTOTYPE — THROWAWAY. NOT PRODUCTION. Delete when it has answered its question.
// ============================================================================
// QUESTION: Can we own the PDF renderer with pdf.js (already in this app) and get
// buttery zoom/scroll PLUS crisp deep zoom on our heaviest survey/CAD sheets —
// or do we need EmbedPDF (PDFium-WASM, ships a tiling pipeline)?
//
// This is a standalone route (?spike=renderer in dev). It does NOT import or
// touch PDFViewer.jsx / the Syncfusion lifecycle. It reuses only pdfjs-dist +
// the worker, exactly like viewerShared.js does.
//
// Arm A (pdf.js): FULLY WIRED here — direct page.render to a DPR-correct canvas,
//   transform-during-gesture then reraster-on-settle, RenderTask cancellation,
//   a live frame-time meter, and a deliberate canvas-size clamp that SHOWS the
//   "crispness cliff" (where pdf.js would blur and tiling becomes necessary).
// Arm B (EmbedPDF): placeholder — wired in the next pass (needs npm i).
//
// A test SVG annotation overlay is mounted via the same viewBox="0 0 W H"
// contract the real app uses, to prove the overlay stays pixel-locked to the
// page through zoom and 90/270 rotation.
//
// HOW TO READ THE VERDICT: load your heaviest large-format CAD/survey sheet with
// the file picker (the bundled default is small — not a real stress test), then
// zoom to 400% and 1600%. Watch the FPS/worst-frame meter while zooming, and
// watch the "canvas" readout: if it turns red ("clamped"), that is the exact
// point pdf.js-direct goes blurry and we'd need tiling. Record findings in
// src/prototype/NOTES.md.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Chromium canvas limits are ~32767px/dimension and a few hundred MP of area.
// For a SMOOTH budget we clamp well under that; exceeding the clamp is exactly
// the "crispness cliff" we want to make visible.
const MAX_CANVAS_DIM = 16384;
const MAX_CANVAS_AREA = 80 * 1024 * 1024; // ~80 MP smooth budget

const DEFAULT_DOC = '/debug-fixtures/text-search-glyph-lab.pdf';

const QUICK_ZOOMS = [
  { label: 'Fit', value: 'fit' },
  { label: '100%', value: 1 },
  { label: '400%', value: 4 },
  { label: '1600%', value: 16 },
];

export default function RendererSpike() {
  const scrollerRef = useRef(null);
  const stageRef = useRef(null);     // transform wrapper (instant CSS zoom during gesture)
  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const renderTaskRef = useRef(null);
  const settleTimerRef = useRef(null);

  const [fileName, setFileName] = useState('(loading default…)');
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [baseSize, setBaseSize] = useState({ w: 612, h: 792 }); // page size in PDF points (rotation 0)
  const [scale, setScale] = useState(1);       // committed (rasterized) scale
  const [liveZoom, setLiveZoom] = useState(1); // transient gesture multiplier (CSS only)
  const [rotation, setRotation] = useState(0); // 0 | 90 | 270
  const [arm, setArm] = useState('pdfjs');

  const [stats, setStats] = useState({
    rasterMs: 0, canvasW: 0, canvasH: 0, clamped: false, rasterScale: 1,
  });
  const [perf, setPerf] = useState({ fps: 0, worstFrame: 0, heapMB: 0 });

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

  // ---- load a document -----------------------------------------------------
  const loadDoc = useCallback(async (src, name) => {
    try {
      if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch {} }
      const task = pdfjsLib.getDocument({ url: src, isEvalSupported: false });
      const pdf = await task.promise;
      pdfRef.current = pdf;
      setNumPages(pdf.numPages);
      // Pick the largest page by area — the heaviest crispness test.
      let biggest = 1, biggestArea = 0;
      const probe = Math.min(pdf.numPages, 60);
      for (let i = 1; i <= probe; i++) {
        const pg = await pdf.getPage(i);
        const vp = pg.getViewport({ scale: 1, rotation: 0 });
        const area = vp.width * vp.height;
        if (area > biggestArea) { biggestArea = area; biggest = i; }
      }
      setFileName(name || src);
      setRotation(0);
      setScale(1);
      setLiveZoom(1);
      setPageNum(biggest);
    } catch (e) {
      setFileName(`ERROR: ${e?.message || e}`);
    }
  }, []);

  useEffect(() => {
    // default doc on mount
    loadDoc(DEFAULT_DOC, 'text-search-glyph-lab.pdf (small default — load your heaviest sheet!)');
  }, [loadDoc]);

  // ---- render the current page (Arm A: pdf.js direct) ----------------------
  useEffect(() => {
    if (arm !== 'pdfjs') return;
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || !pageNum) return;

    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(pageNum);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1, rotation });
      setBaseSize({ w: base.width, h: base.height });

      // Desired backing resolution = display CSS size * scale * DPR.
      let rasterScale = scale * dpr;
      let vw = base.width * rasterScale;
      let vh = base.height * rasterScale;

      // Clamp to the smooth budget — exceeding it is the crispness cliff.
      let clamped = false;
      const dimOver = Math.max(vw, vh) / MAX_CANVAS_DIM;
      const areaOver = Math.sqrt((vw * vh) / MAX_CANVAS_AREA);
      const over = Math.max(dimOver, areaOver, 1);
      if (over > 1) {
        clamped = true;
        rasterScale = rasterScale / over;
        vw = base.width * rasterScale;
        vh = base.height * rasterScale;
      }

      const viewport = page.getViewport({ scale: rasterScale, rotation });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      // Display size = the true target (scale, in CSS px). If clamped, the
      // browser upscales the smaller bitmap → visible blur (the cliff).
      canvas.style.width = `${base.width * scale}px`;
      canvas.style.height = `${base.height * scale}px`;

      const ctx = canvas.getContext('2d', { alpha: false });
      if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch {} }
      const t0 = performance.now();
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch (e) {
        if (e?.name === 'RenderingCancelledException') return;
        throw e;
      }
      const t1 = performance.now();
      if (cancelled) return;
      const heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0;
      setStats({
        rasterMs: Math.round(t1 - t0),
        canvasW: canvas.width, canvasH: canvas.height,
        clamped, rasterScale: Number(rasterScale.toFixed(3)),
      });
      setPerf((p) => ({ ...p, heapMB }));
    })();

    return () => { cancelled = true; };
  }, [arm, pageNum, scale, rotation, dpr]);

  // ---- frame-time meter (rAF) ---------------------------------------------
  useEffect(() => {
    let raf, last = performance.now(), worst = 0, worstResetAt = last;
    const tick = (now) => {
      const dt = now - last;
      last = now;
      if (dt > worst) worst = dt;
      if (now - worstResetAt > 1500) { // rolling 1.5s worst-frame window
        setPerf((p) => ({ ...p, fps: Math.round(1000 / Math.max(dt, 0.0001)), worstFrame: Math.round(worst) }));
        worst = 0; worstResetAt = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- zoom: transform-during-gesture, reraster-on-settle ------------------
  const commitSettle = useCallback(() => {
    setScale((s) => {
      const next = Math.max(0.1, Math.min(40, s * liveZoomRef.current));
      return next;
    });
    setLiveZoom(1);
    liveZoomRef.current = 1;
  }, []);

  // keep a ref of liveZoom so the wheel handler (attached once) reads latest
  const liveZoomRef = useRef(1);
  useEffect(() => { liveZoomRef.current = liveZoom; }, [liveZoom]);

  const onWheel = useCallback((e) => {
    if (!(e.ctrlKey || e.metaKey)) return; // plain wheel = native scroll/pan
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.002); // smooth multiplicative zoom
    const nextLive = Math.max(0.05, Math.min(50, liveZoomRef.current * factor));
    liveZoomRef.current = nextLive;
    setLiveZoom(nextLive);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(commitSettle, 160);
  }, [commitSettle]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const applyQuickZoom = (v) => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    setLiveZoom(1); liveZoomRef.current = 1;
    if (v === 'fit') {
      const el = scrollerRef.current;
      if (el) {
        const fit = Math.min((el.clientWidth - 40) / baseSize.w, (el.clientHeight - 40) / baseSize.h);
        setScale(Math.max(0.1, fit));
      }
    } else {
      setScale(v);
    }
  };

  const effectivePct = Math.round(scale * liveZoom * 100);
  const overlayW = baseSize.w;
  const overlayH = baseSize.h;

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#2a2d31', color: '#e8e8e8', fontFamily: 'system-ui, sans-serif' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', background: '#1c1e21', borderBottom: '1px solid #000' }}>
        <strong style={{ color: '#ffcf5c' }}>⚙ Renderer Spike — PROTOTYPE</strong>
        <label style={{ cursor: 'pointer', background: '#3a7afe', padding: '5px 10px', borderRadius: 5, fontSize: 13 }}>
          Load PDF…
          <input
            type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadDoc(URL.createObjectURL(f), f.name);
            }}
          />
        </label>
        <span style={{ fontSize: 12, opacity: 0.8, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12 }}>
          Page{' '}
          <input type="number" min={1} max={numPages || 1} value={pageNum}
            onChange={(e) => setPageNum(Math.max(1, Math.min(numPages || 1, Number(e.target.value) || 1)))}
            style={{ width: 56, background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: '2px 4px' }} />
          {' '}/ {numPages}
        </span>
      </div>

      {/* arm switch */}
      <div style={{ display: 'flex', gap: 0, background: '#16181a', borderBottom: '1px solid #000' }}>
        {['pdfjs', 'embedpdf'].map((a) => (
          <button key={a} onClick={() => setArm(a)}
            style={{
              flex: 1, padding: '7px 0', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: arm === a ? '#3a7afe' : 'transparent', color: arm === a ? '#fff' : '#9aa0a6',
            }}>
            {a === 'pdfjs' ? 'Arm A — pdf.js (live)' : 'Arm B — EmbedPDF (coming next)'}
          </button>
        ))}
      </div>

      {/* stage */}
      <div ref={scrollerRef} style={{ flex: 1, overflow: 'auto', position: 'relative', background: '#3a3d42' }}>
        {arm === 'pdfjs' ? (
          <div style={{ minWidth: '100%', minHeight: '100%', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 20, boxSizing: 'border-box' }}>
            <div ref={stageRef}
              style={{
                position: 'relative',
                transform: `scale(${liveZoom})`, transformOrigin: 'center top',
                transition: 'none', willChange: 'transform',
              }}>
              <canvas ref={canvasRef} style={{ display: 'block', boxShadow: '0 4px 24px rgba(0,0,0,0.5)', background: '#fff' }} />
              {/* test annotation overlay — viewBox="0 0 W H" page-point contract */}
              <svg
                viewBox={`0 0 ${overlayW} ${overlayH}`}
                style={{ position: 'absolute', left: 0, top: 0, width: baseSize.w * scale, height: baseSize.h * scale, pointerEvents: 'none' }}
                preserveAspectRatio="none">
                <rect x="2" y="2" width={overlayW - 4} height={overlayH - 4} fill="none" stroke="#ff2d55" strokeWidth="2" />
                <line x1="0" y1="0" x2={overlayW} y2={overlayH} stroke="#0a84ff" strokeWidth="1.5" />
                <circle cx={overlayW / 2} cy={overlayH / 2} r={Math.min(overlayW, overlayH) * 0.12} fill="none" stroke="#30d158" strokeWidth="2" />
                <rect x={overlayW * 0.1} y={overlayH * 0.1} width={overlayW * 0.18} height={overlayH * 0.08} fill="rgba(255,159,10,0.35)" stroke="#ff9f0a" strokeWidth="1.5" />
                <text x={overlayW * 0.1} y={overlayH * 0.1 - 4} fill="#ff9f0a" fontSize={Math.max(8, overlayW * 0.012)}>overlay-locked</text>
              </svg>
            </div>
          </div>
        ) : (
          <div style={{ padding: 40, maxWidth: 720, lineHeight: 1.6 }}>
            <h2 style={{ color: '#ffcf5c' }}>Arm B — EmbedPDF (PDFium-WASM)</h2>
            <p>Not wired yet. Next pass: <code>npm i @embedpdf/core @embedpdf/engines</code>, mount its
              headless scroller + tiling/zoom plugins on the same heaviest sheet, mount the same
              SVG overlay on top, and measure the identical frame-time / crispness / memory numbers
              so we compare on data, not vibes.</p>
            <p style={{ opacity: 0.7 }}>Build out Arm A first (it answers most of the question — whether pdf.js stays crisp on your heaviest sheets). Only if Arm A blurs/janks do we need this arm to decide.</p>
          </div>
        )}
      </div>

      {/* floating bottom bar — controls + live meters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 14px', background: '#1c1e21', borderTop: '1px solid #000', fontSize: 13, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {QUICK_ZOOMS.map((q) => (
            <button key={q.label} onClick={() => applyQuickZoom(q.value)}
              style={{ background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer' }}>{q.label}</button>
          ))}
        </div>
        <button onClick={() => setRotation((r) => (r === 0 ? 90 : r === 90 ? 270 : 0))}
          style={{ background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer' }}>
          Rotate: {rotation}°
        </button>
        <span style={{ color: '#9aa0a6' }}>zoom <strong style={{ color: '#fff' }}>{effectivePct}%</strong> <span style={{ opacity: 0.6 }}>(ctrl/⌘+scroll)</span></span>
        <span style={{ color: '#9aa0a6' }}>fps <strong style={{ color: perf.fps >= 55 ? '#30d158' : perf.fps >= 30 ? '#ffd60a' : '#ff453a' }}>{perf.fps}</strong></span>
        <span style={{ color: '#9aa0a6' }}>worst frame <strong style={{ color: perf.worstFrame <= 18 ? '#30d158' : perf.worstFrame <= 33 ? '#ffd60a' : '#ff453a' }}>{perf.worstFrame}ms</strong></span>
        <span style={{ color: '#9aa0a6' }}>raster <strong style={{ color: '#fff' }}>{stats.rasterMs}ms</strong></span>
        <span style={{ color: stats.clamped ? '#ff453a' : '#9aa0a6' }}>
          canvas <strong>{stats.canvasW}×{stats.canvasH}</strong> ({Math.round((stats.canvasW * stats.canvasH) / 1048576)}MP)
          {stats.clamped ? ` ⚠ CLAMPED (blurred — tiling needed; raster ${stats.rasterScale}×)` : ''}
        </span>
        {perf.heapMB ? <span style={{ color: '#9aa0a6' }}>heap <strong style={{ color: '#fff' }}>{perf.heapMB}MB</strong></span> : null}
      </div>
    </div>
  );
}
