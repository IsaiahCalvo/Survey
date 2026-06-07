/**
 * PDFViewerEngineSelector.jsx — the single seam where the PDF page-drawing
 * engine is chosen (Phase 37 — Syncfusion → owned pdf.js cutover).
 *
 * PDFViewer mounts this instead of mounting a concrete engine directly. The
 * selector reads `getPDFViewerEngine()` and renders the matching engine
 * container, forwarding the ref and ALL props straight through so the chosen
 * engine satisfies the same imperative contract (see pdfEngineContract.js).
 *
 * Stage 0: only the Syncfusion branch is wired; it is a transparent pass-through
 * (no prop renamed, no behavior added). The pdf.js branch is built in Stage 2.
 */
import { forwardRef } from 'react';
import SyncfusionPDFContainer from './SyncfusionPDFContainer';
import PdfjsViewerContainer from './PdfjsViewerContainer';
import { getPDFViewerEngine, PDF_VIEWER_ENGINE_PDFJS } from '../viewerShared';

const PDFViewerEngineSelector = forwardRef(function PDFViewerEngineSelector(props, ref) {
  const engine = getPDFViewerEngine();

  // Exactly one engine mounts. Default is Syncfusion; the owned pdf.js engine is
  // reachable only via the dev override (window.__DEV_OVERRIDE_PDF_VIEWER_ENGINE).
  if (engine === PDF_VIEWER_ENGINE_PDFJS) {
    return <PdfjsViewerContainer ref={ref} {...props} />;
  }

  return <SyncfusionPDFContainer ref={ref} {...props} />;
});

export default PDFViewerEngineSelector;
