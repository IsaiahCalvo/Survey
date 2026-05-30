// ============================================================================
// PROTOTYPE — THROWAWAY. NOT PRODUCTION. Delete src/prototype/ + the
// `?spike=renderer` block in src/main.jsx once the verdict is recorded.
// ============================================================================
// THE QUESTION: replace Syncfusion by OWNING the renderer on pdf.js, or adopt
// EmbedPDF (PDFium-WASM, ships tiling)? This is a real two-arm mini-viewer so the
// comparison is on data, not vibes. Both arms do the SAME hard things:
//   • continuous, virtualized multi-page scroll (100+ pages)
//   • cursor-anchored zoom that HOLDS its level (no snap-back)
//   • real, interactive, page-locked annotations on top
//   • the same fps / worst-frame / memory meters
// Arm A = pdf.js we own and drive. Arm B = EmbedPDF plugins, plug-and-play.
//
// HOW TO READ IT: load your heaviest survey/CAD sheet (or a bundled fixture),
// zoom deep with ctrl/⌘+scroll on BOTH arms, and watch the bottom bar. On Arm A,
// when "canvas" turns red CLAMPED that's the pdf.js-direct crispness cliff. Arm B
// should stay crisp there via tiling. Record the call in src/prototype/NOTES.md.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import PdfjsArm from './PdfjsArm';
import EmbedpdfArm from './EmbedpdfArm';
import { makeDefaultAnnotations } from './InteractiveOverlay';
import { useFrameMeter } from './spikeMetrics';

const FIXTURES = [
  { label: '120-page (scroll test)', url: '/debug-fixtures/spike-120-pages.pdf' },
  { label: 'Large sheet (deep-zoom)', url: '/debug-fixtures/spike-large-sheet.pdf' },
  { label: 'Real package (36pg)', url: '/debug-fixtures/Package%202%20-%20Rev%204%20--%20IC.pdf' },
  { label: 'Small default', url: '/debug-fixtures/text-search-glyph-lab.pdf' },
];

const QUICK = [['Fit', 'fit'], ['100%', 1], ['400%', 4], ['1600%', 16]];

export default function RendererSpike() {
  const [arm, setArm] = useState('pdfjs');
  const [file, setFile] = useState({ src: FIXTURES[0].url, key: 1, name: FIXTURES[0].label });
  const [status, setStatus] = useState({ pdfjs: '', embedpdf: '' });
  // metrics tracked PER ARM so the bar always shows the visible arm's numbers
  // (and one arm never clobbers the other's readout).
  const [armMetrics, setArmMetrics] = useState({ pdfjs: {}, embedpdf: {} });
  const { perf, bumpActivity } = useFrameMeter();

  // shared, page-locked annotations (identical in both arms — PDF points are
  // renderer-independent), keyed by page index.
  const [annsByPage, setAnnsByPage] = useState({});
  const annsRef = useRef(annsByPage);
  useEffect(() => { annsRef.current = annsByPage; }, [annsByPage]);

  const ensureSeed = useCallback((idx, w, h) => {
    if (annsRef.current[idx]) return;
    setAnnsByPage((prev) => (prev[idx] ? prev : { ...prev, [idx]: makeDefaultAnnotations(w, h, idx) }));
  }, []);
  const onAnnsChange = useCallback((idx, next) => {
    setAnnsByPage((prev) => ({ ...prev, [idx]: next }));
  }, []);

  // revoke the previous local blob URL so picking file after file doesn't leak
  const objUrlRef = useRef(null);
  const revokePrev = () => { if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; } };
  useEffect(() => () => revokePrev(), []);

  const loadFixture = (f) => { revokePrev(); setFile((p) => ({ src: f.url, key: p.key + 1, name: f.label })); setAnnsByPage({}); };
  const loadLocal = (f) => {
    revokePrev();
    const url = URL.createObjectURL(f);
    objUrlRef.current = url;
    setFile((p) => ({ src: url, key: p.key + 1, name: f.name }));
    setAnnsByPage({});
  };

  // STABLE callbacks per arm. (Returning a fresh fn each render here would make
  // the arms' status/metrics effects re-run every render → update-depth loop.)
  const setPdfStatus = useCallback((s) => setStatus((prev) => ({ ...prev, pdfjs: s })), []);
  const setEmbedStatus = useCallback((s) => setStatus((prev) => ({ ...prev, embedpdf: s })), []);
  const onMetricsPdf = useCallback((m) => setArmMetrics((prev) => ({ ...prev, pdfjs: { ...prev.pdfjs, ...m } })), []);
  const onMetricsEmbed = useCallback((m) => setArmMetrics((prev) => ({ ...prev, embedpdf: { ...prev.embedpdf, ...m } })), []);

  // mark "gesture active" windows for the worst-frame meter
  useEffect(() => {
    const bump = () => bumpActivity();
    window.addEventListener('wheel', bump, { passive: true });
    window.addEventListener('pointermove', bump, { passive: true });
    return () => { window.removeEventListener('wheel', bump); window.removeEventListener('pointermove', bump); };
  }, [bumpActivity]);

  const doQuick = (val) => {
    if (arm === 'pdfjs') window.__spikePdfjs?.zoomTo(val === 'fit' ? 'fitw' : val);
    else if (val === 'fit') window.__spikeEmbed?.fit?.();
    else window.__spikeEmbed?.set?.(val);
  };

  const m = armMetrics[arm] || {};
  const C = { text: '#9aa0a6', good: '#30d158', warn: '#ffd60a', bad: '#ff453a', white: '#fff' };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#2a2d31', color: '#e8e8e8', fontFamily: 'system-ui, sans-serif' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: '#1c1e21', borderBottom: '1px solid #000', flexWrap: 'wrap' }}>
        <strong style={{ color: '#ffcf5c' }}>⚙ Renderer Spike</strong>
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
        <span style={{ fontSize: 12, opacity: 0.8, marginLeft: 'auto', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.name} · {status[arm]}
        </span>
      </div>

      {/* arm switch */}
      <div style={{ display: 'flex', background: '#16181a', borderBottom: '1px solid #000' }}>
        {[['pdfjs', 'Arm A — pdf.js (we own it)'], ['embedpdf', 'Arm B — EmbedPDF (PDFium-WASM + tiling)']].map(([a, label]) => (
          <button key={a} onClick={() => setArm(a)}
            style={{ flex: 1, padding: '7px 0', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: arm === a ? '#3a7afe' : 'transparent', color: arm === a ? '#fff' : '#9aa0a6' }}>
            {label}
          </button>
        ))}
      </div>

      {/* stage — only the ACTIVE arm is mounted so the fps / memory meters
          measure one renderer cleanly (the other arm can't pollute them).
          Switching re-initializes the arm; EmbedPDF shows a brief WASM load. */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {arm === 'pdfjs' ? (
          <PdfjsArm
            fileSrc={file.src} fileKey={file.key}
            annsByPage={annsByPage} ensureSeed={ensureSeed} onAnnsChange={onAnnsChange}
            onMetrics={onMetricsPdf} onStatus={setPdfStatus}
          />
        ) : (
          <EmbedpdfArm
            fileSrc={file.src} fileKey={file.key}
            annsByPage={annsByPage} ensureSeed={ensureSeed} onAnnsChange={onAnnsChange}
            onMetrics={onMetricsEmbed} onStatus={setEmbedStatus}
          />
        )}
      </div>

      {/* bottom bar — shared controls + live meters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', background: '#1c1e21', borderTop: '1px solid #000', fontSize: 13, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {QUICK.map(([label, val]) => (
            <button key={label} onClick={() => doQuick(val)}
              style={{ background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer' }}>{label}</button>
          ))}
          {arm === 'pdfjs' && (
            <button onClick={() => window.__spikePdfjs?.rotate?.()}
              style={{ background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer' }}>Rotate</button>
          )}
        </div>
        <span style={{ color: C.text }}>zoom <strong style={{ color: C.white }}>{m.zoomPct ?? '—'}%</strong> <span style={{ opacity: 0.6 }}>(ctrl/⌘+scroll)</span></span>
        <span style={{ color: C.text }}>fps <strong style={{ color: perf.fps >= 55 ? C.good : perf.fps >= 30 ? C.warn : C.bad }}>{perf.fps}</strong></span>
        <span style={{ color: C.text }}>worst frame <strong style={{ color: perf.worstFrame <= 18 ? C.good : perf.worstFrame <= 33 ? C.warn : C.bad }}>{perf.worstFrame}ms</strong></span>
        <span style={{ color: C.text }}>mounted pages <strong style={{ color: C.white }}>{m.mounted ?? '—'}</strong></span>
        {arm === 'pdfjs' ? (
          <>
            <span style={{ color: C.text }}>raster <strong style={{ color: C.white }}>{m.rasterMs ?? '—'}ms</strong></span>
            <span style={{ color: m.clamped ? C.bad : C.text }}>
              canvas <strong>{m.backingW || 0}×{m.backingH || 0}</strong> ({Math.round(((m.backingW || 0) * (m.backingH || 0)) / 1048576)}MP)
              {m.clamped ? ' ⚠ CLAMPED (blurred — tiling needed)' : ''}
            </span>
          </>
        ) : (
          <span style={{ color: C.text }}>page <strong style={{ color: C.white }}>{m.currentPage ?? '—'}{m.totalPages ? ` / ${m.totalPages}` : ''}</strong> <span style={{ opacity: 0.6 }}>(tiling = crisp deep zoom)</span></span>
        )}
        {perf.heapMB ? <span style={{ color: C.text }}>heap <strong style={{ color: C.white }}>{perf.heapMB}MB</strong></span> : null}
      </div>
    </div>
  );
}
