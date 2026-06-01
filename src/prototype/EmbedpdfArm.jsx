// ============================================================================
// PROTOTYPE — THROWAWAY. Arm B: EmbedPDF (PDFium-WASM, plugin-composed).
// ============================================================================
// "Plug and play" the open-source EmbedPDF stack and reuse what it gives us:
//   • @embedpdf/engines       — PDFium compiled to WASM, in a Web Worker
//   • plugin-viewport/scroll  — continuous, virtualized multi-page scroll
//   • plugin-render           — base raster per page
//   • plugin-tiling           — hi-res tiles over the visible area = crisp DEEP
//                               zoom on huge survey/CAD sheets (the thing
//                               pdf.js-direct can't do without DIY tiling)
//   • plugin-zoom             — ZoomGestureWrapper = ctrl/⌘+wheel zoom anchored
//                               at the cursor (verified in the plugin source)
// We mount our SAME InteractiveOverlay inside the page wrapper so the identical
// page-locked annotations render on top, and a metrics bridge reports zoom % +
// mounted-page count so the head-to-head is measured the same way as Arm A.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPluginRegistration } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import { usePdfiumEngine } from '@embedpdf/engines/react';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager';
import { DocumentContent } from '@embedpdf/plugin-document-manager/react';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport';
import { Viewport } from '@embedpdf/plugin-viewport/react';
import { ScrollPluginPackage, ScrollStrategy } from '@embedpdf/plugin-scroll';
import { Scroller, useScroll, useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { RenderPluginPackage } from '@embedpdf/plugin-render';
import { RenderLayer } from '@embedpdf/plugin-render/react';
import { TilingPluginPackage } from '@embedpdf/plugin-tiling';
import { TilingLayer } from '@embedpdf/plugin-tiling/react';
import { ZoomPluginPackage, ZoomMode } from '@embedpdf/plugin-zoom';
import { ZoomGestureWrapper, useZoom } from '@embedpdf/plugin-zoom/react';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager';
import { ConsoleLogger, LevelLogger, LogLevel } from '@embedpdf/models';
import InteractiveOverlay from './InteractiveOverlay';

// Self-hosted PDFium WASM (copied from node_modules into public/) so the spike
// works offline and doesn't depend on a CDN.
//
// MUST be ABSOLUTE for the off-thread worker engine. EmbedPDF's worker is an inline
// Blob (`new Worker(blob:…, {type:'module'})`), so the worker's base URL is the
// opaque `blob:…` origin. Inside it, `fetch('/pdfium.wasm')` throws
// "Failed to parse URL from /pdfium.wasm" — a root-relative path can't resolve
// against a blob: base — the worker's wasmInit rejects, and because EmbedPDF posts
// that failure as an id-less {type:'wasmError'} the main thread doesn't match, the
// engine hangs forever at "Opening document…". (THIS was the real worker hang —
// not COI headers, not the logger. Root cause confirmed 2026-05-31 by probing a
// module worker: relative fetch fails, absolute fetch returns 200.) The main-thread
// (worker:false) engine never hit this because the page can resolve a root path.
const WASM_URL =
  typeof window !== 'undefined' ? new URL('/pdfium.wasm', window.location.origin).href : '/pdfium.wasm';

// Logger passed to the worker engine. MUST be one of EmbedPDF's own Logger classes —
// they cross the worker boundary via serializeLogger()/deserializeLogger(). A raw
// browser `console` is NOT recognized: serializeLogger(console) returns undefined and
// deserializeLogger(undefined) throws in the worker (a separate latent crash, fixed
// here too). Wrapped at Warn so init failures still surface but per-tile debug spam
// doesn't taint the perf meters.
const SPIKE_LOGGER = new LevelLogger(new ConsoleLogger(), LogLevel.Warn);

// One rendered page: EmbedPDF's base raster + hi-res tiles + our page-locked
// overlay. Seeds default annotations via an effect (never during render).
function PageContent({ docId, pageIndex, width, height, annsByPage, ensureSeed, onAnnsChange }) {
  // CRITICAL — overlay must live in STABLE page-point space, not zoomed pixels.
  // EmbedPDF applies zoom by RESIZING the page box: the `width`/`height` the
  // Scroller hands us are the current ZOOMED pixel size, and it passes NO `scale`.
  // So `width` is not a fixed page space — it rides the zoom. If we seed/viewBox
  // off raw `width`, the cached point coords explode against a shrinking viewBox
  // (at 16% zoom the box is ~196px wide but the shapes stay ~1224 units → 3× off
  // and floating beside the page — the long-standing "annotations don't stay
  // pinned on zoom" bug). EmbedPDF commits the new zoom level and the new page
  // box size together, so `width / currentZoomLevel` always recovers the fixed
  // base page size in PDF points. That base equals pdf.js's getViewport({scale:1})
  // space, so the overlay stays pinned at every zoom AND the shared seed cache is
  // consistent across both arms.
  const { state: zoomState } = useZoom(docId);
  const zoom = zoomState?.currentZoomLevel || 1;
  const pointW = width / zoom;
  const pointH = height / zoom;
  useEffect(() => { ensureSeed(pageIndex, pointW, pointH); }, [pageIndex, pointW, pointH, ensureSeed]);
  return (
    <div style={{ width, height, position: 'relative' }}>
      <RenderLayer documentId={docId} pageIndex={pageIndex} style={{ position: 'absolute', inset: 0 }} />
      <TilingLayer documentId={docId} pageIndex={pageIndex} />
      <InteractiveOverlay
        pageWidth={pointW}
        pageHeight={pointH}
        annotations={annsByPage[pageIndex]}
        onChange={(next) => onAnnsChange(pageIndex, next)}
      />
    </div>
  );
}

// Reports EmbedPDF's live zoom % + mounted-page count up to the shared bar.
function MetricsBridge({ docId, onMetrics }) {
  const { state: zoomState, provides: zoomProvides } = useZoom(docId);
  const { state: scrollState } = useScroll(docId);
  const scrollCap = useScrollCapability();
  const capRef = useRef(scrollCap);
  capRef.current = scrollCap; // useScrollCapability returns a fresh object each render
  const [mounted, setMounted] = useState(0);

  // Expose EmbedPDF's zoom controls so the shared quick-zoom buttons drive it.
  useEffect(() => {
    if (!zoomProvides) return undefined;
    const api = {
      in: () => zoomProvides.zoomIn?.(),
      out: () => zoomProvides.zoomOut?.(),
      fit: () => zoomProvides.requestZoom?.(ZoomMode.FitWidth),
      set: (n) => zoomProvides.requestZoom?.(n),
    };
    window.__spikeEmbed = api;
    return () => { if (window.__spikeEmbed === api) delete window.__spikeEmbed; };
  }, [zoomProvides]);

  // Subscribe to onScroll EXACTLY ONCE (the capability object's identity churns
  // every render; re-subscribing each render would thrash during scrolling).
  // Retry via rAF until the capability is ready, then read the latest via capRef.
  useEffect(() => {
    let off, raf;
    const trySub = () => {
      const provides = capRef.current?.provides;
      if (provides?.onScroll) {
        try {
          off = provides.onScroll((payload) => {
            const m = payload?.metrics || payload;
            if (m?.renderedPageIndexes) setMounted(m.renderedPageIndexes.length);
            else if (m?.visiblePages) setMounted(m.visiblePages.length);
          });
        } catch { /* best-effort */ }
      } else {
        raf = requestAnimationFrame(trySub);
      }
    };
    trySub();
    return () => { if (raf) cancelAnimationFrame(raf); if (typeof off === 'function') off(); };
  }, []);

  // Depend on PRIMITIVES, not the hook's state objects (those get fresh
  // references each render and would loop: report → setState → re-render →
  // new object → report again → "Maximum update depth exceeded").
  const zoomPct = Math.round((zoomState?.currentZoomLevel || 1) * 100);
  const currentPage = scrollState?.currentPage;
  const totalPages = scrollState?.totalPages;
  useEffect(() => {
    onMetrics?.({ zoomPct, currentPage, totalPages, mounted });
  }, [zoomPct, currentPage, totalPages, mounted, onMetrics]);

  return null;
}

export default function EmbedpdfArm({ fileSrc, fileKey, annsByPage, ensureSeed, onAnnsChange, onMetrics, onStatus }) {
  // worker:true → PDFium runs OFF the main thread. This is the whole point: the
  // previous worker:false ran every page raster on the compositor thread, so each
  // zoom-commit froze the UI (358ms worst-frame in the comparison log vs pdf.js's
  // 41ms — an unfair ~8.7x gap that measured a config flag, not the library).
  //
  // The old comment claimed the worker needs cross-origin-isolation headers (COOP
  // same-origin + COEP require-corp) that would break MSAL. That rationale is
  // FALSE: EmbedPDF's pdfium.wasm is single-threaded — no SharedArrayBuffer, no
  // pthreads, the WASM shared-memory bit is unset — and the worker is a plain
  // inline-Blob module Worker over postMessage. It does NOT need crossOriginIsolated,
  // so this flip touches no headers and no MSAL. (Verified against the installed
  // binary + @embedpdf/engines v2.14.3 source, 2026-05-31 — see
  // docs/audits/EMBEDPDF-WORKER-FIX-AND-PERF.md.)
  //
  // RESOLVED: the old comment's "hangs on open-document in the Vite dev server" was
  // NOT a dev-server or COI-header problem. The worker engine fetches the wasm from
  // wasmUrl inside a blob: worker, where a root-relative '/pdfium.wasm' fails to
  // parse — so wasmInit rejected and the engine hung at "Opening document…". Passing
  // an ABSOLUTE WASM_URL (above) fixes it; the worker now fetches the wasm, inits
  // off-thread, and opens the document. SPIKE_LOGGER fixes a separate logger crash.
  const { engine, isLoading, error } = usePdfiumEngine({ ...(WASM_URL ? { wasmUrl: WASM_URL } : {}), worker: true, logger: SPIKE_LOGGER });

  // ORIENTATION (re-verified in-browser 2026-06-01 by the ACTUAL raster pixels, not the
  // CSS box). EmbedPDF has two open modes and we measured both on a /Rotate-270 page:
  //   • normalizeRotation:TRUE (the library default) renders a PORTRAIT raster
  //     (natural 1527×2360) — it does NOT bake /Rotate. Forcing the page box to the
  //     landscape `rotatedSize` then just STRETCHES that portrait raster sideways, and
  //     the tiles (also portrait) overlay un-rotated on top → the "double image" bug.
  //   • normalizeRotation:FALSE makes PDFium honor /Rotate and render a true UPRIGHT
  //     landscape raster. That's what we want. We own the engine instance, so we force
  //     it on openDocumentBuffer (the URL open path delegates to it).
  // Trade-off: in false-mode EmbedPDF's Scroller still computes the page SLOT from
  // `rotatedSize` = transformSize(size, rotation), which double-rotates the rotated pages
  // to a portrait slot — so a landscape page sits in a portrait slot (the "pages 6–11
  // spaced weird" gap). That's a real EmbedPDF scroller limitation we have NOT solved
  // here; correct orientation + pinned overlays win over a tighter gap, and it's a data
  // point for the pdf.js-vs-EmbedPDF verdict (Arm A lays these out cleanly because we own
  // the layout). The page layer therefore renders at width/height (the upright display
  // size in false-mode), NOT rotatedWidth/rotatedHeight.
  const patchedEngine = useMemo(() => {
    if (engine && !engine.__forceNoNormalize) {
      const orig = engine.openDocumentBuffer?.bind(engine);
      if (orig) engine.openDocumentBuffer = (file, options) => orig(file, { ...(options || {}), normalizeRotation: false });
      engine.__forceNoNormalize = true;
    }
    return engine;
  }, [engine]);

  const plugins = useMemo(() => [
    createPluginRegistration(DocumentManagerPluginPackage, {
      // full-fetch (not range-request) — our dev fixture server returns 200 with
      // the whole body even for Range requests, which stalls auto-detection.
      initialDocuments: [{ url: fileSrc, documentId: 'spike-doc', name: 'spike', mode: 'full-fetch' }],
    }),
    createPluginRegistration(ViewportPluginPackage),
    createPluginRegistration(ScrollPluginPackage, {
      defaultStrategy: ScrollStrategy.Vertical,
      defaultPageGap: 16,
      defaultBufferSize: 2,
    }),
    // withAnnotations:true bakes the PDF's embedded annotations (the 3049 ink /
    // 6 square / 1 freetext markups on the rotated pages) into the rendered page
    // image — same as pdf.js's canvas render. Off by default in EmbedPDF, which is
    // why Arm B showed blank markups. The render plugin's config is shared by the
    // tiling layer too (tiling renders via this plugin's renderPageRect), so this
    // one flag bakes annotations into both the base raster and the hi-res tiles,
    // and they inherit the page's baked /Rotate orientation + stay pinned on zoom.
    createPluginRegistration(RenderPluginPackage, { withAnnotations: true }),
    createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 5, extraRings: 0 }),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(ZoomPluginPackage, {
      defaultZoomLevel: ZoomMode.FitWidth,
      minZoom: 0.1,
      maxZoom: 60,
    }),
  ], [fileSrc]);

  useEffect(() => {
    if (error) onStatus?.(`ENGINE ERROR: ${error.message}`);
    else if (isLoading || !engine) onStatus?.('loading PDFium WASM…');
    else onStatus?.('engine ready');
  }, [engine, isLoading, error, onStatus]);

  if (error) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#ff8a8a', padding: 30, textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 16, marginBottom: 8 }}>PDFium engine failed to load</div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>{error.message}</div>
        </div>
      </div>
    );
  }
  if (isLoading || !engine) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#cfd2d6' }}>
        Loading PDFium WASM engine…
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#3a3d42' }}>
      <EmbedPDF key={fileKey} engine={patchedEngine} plugins={plugins}>
        {({ activeDocumentId }) =>
          activeDocumentId ? (
            <DocumentContent documentId={activeDocumentId}>
              {({ isLoaded, isError }) => {
                if (isError) return <div style={{ color: '#ff8a8a', padding: 30 }}>Failed to open document.</div>;
                if (!isLoaded) return <div style={{ color: '#cfd2d6', padding: 30 }}>Opening document…</div>;
                return (
                  <>
                    <MetricsBridge docId={activeDocumentId} onMetrics={onMetrics} />
                    <Viewport documentId={activeDocumentId} style={{ position: 'absolute', inset: 0, backgroundColor: '#3a3d42' }}>
                      <ZoomGestureWrapper documentId={activeDocumentId}>
                        <Scroller
                          documentId={activeDocumentId}
                          // Render at width/height — in normalizeRotation:false these are
                          // the upright DISPLAY size (a /Rotate-270 page reports landscape
                          // here, matching its upright raster). Do NOT use rotatedWidth/
                          // rotatedHeight: the Scroller double-rotates those to portrait,
                          // which would stretch the upright raster sideways.
                          renderPage={({ pageIndex, width, height }) => (
                            <PageContent
                              docId={activeDocumentId}
                              pageIndex={pageIndex}
                              width={width}
                              height={height}
                              annsByPage={annsByPage}
                              ensureSeed={ensureSeed}
                              onAnnsChange={onAnnsChange}
                            />
                          )}
                        />
                      </ZoomGestureWrapper>
                    </Viewport>
                  </>
                );
              }}
            </DocumentContent>
          ) : (
            <div style={{ color: '#cfd2d6', padding: 30 }}>No active document.</div>
          )
        }
      </EmbedPDF>
    </div>
  );
}
