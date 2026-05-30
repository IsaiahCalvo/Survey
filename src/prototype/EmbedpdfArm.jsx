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
import InteractiveOverlay from './InteractiveOverlay';

// Self-hosted PDFium WASM (copied from node_modules into public/) so the spike
// works offline and doesn't depend on a CDN. Set to undefined to fall back to
// EmbedPDF's default jsDelivr CDN.
const WASM_URL = '/pdfium.wasm';

// One rendered page: EmbedPDF's base raster + hi-res tiles + our page-locked
// overlay. Seeds default annotations via an effect (never during render).
function PageContent({ docId, pageIndex, width, height, scale, annsByPage, ensureSeed, onAnnsChange }) {
  const pointW = scale ? width / scale : width;
  const pointH = scale ? height / scale : height;
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
  // worker:false → PDFium runs on the MAIN THREAD. The off-thread worker engine
  // hangs on open-document in our Vite dev server (it wants cross-origin-isolation
  // headers — COOP same-origin + COEP require-corp — which we deliberately don't
  // set, for MSAL). Main-thread raster is a FAIR comparison to Arm A (pdf.js also
  // rasterizes on the main thread). EmbedPDF's worker mode could be smoother still
  // in the real app once those headers are set — note that when judging smoothness.
  const { engine, isLoading, error } = usePdfiumEngine({ ...(WASM_URL ? { wasmUrl: WASM_URL } : {}), worker: false });

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
    createPluginRegistration(RenderPluginPackage),
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
      <EmbedPDF key={fileKey} engine={engine} plugins={plugins}>
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
                          renderPage={({ pageIndex, width, height, scale }) => (
                            <PageContent
                              docId={activeDocumentId}
                              pageIndex={pageIndex}
                              width={width}
                              height={height}
                              scale={scale}
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
