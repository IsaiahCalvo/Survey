import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadPdfjs } from '../utils/pdfWorkerConfig.js';
import { buildBrowserPrintLayout } from '../utils/browserPrintLayout.js';

const PRINT_RENDER_SCALE = 2;

export default function BrowserPrintDocument({
  pdfFile,
  annotationsByPage,
  callouts,
  surveyMarkers,
  spaces,
  pageSizes,
}) {
  const [renderState, setRenderState] = useState({ ready: false, pages: [], error: '' });

  useEffect(() => {
    if (!pdfFile || typeof document === 'undefined') {
      setRenderState({ ready: false, pages: [], error: '' });
      return undefined;
    }

    let cancelled = false;
    let loadingTask = null;
    const timer = window.setTimeout(async () => {
      setRenderState((current) => ({ ...current, ready: false, error: '' }));
      try {
        const [{
          buildPrintableRegularAnnotationPayload,
          savePDFWithFlattenedRegularAnnotationsForPrint,
        }, pdfjsLib] = await Promise.all([
          import('../utils/pdfAnnotationsPdfLib.js'),
          loadPdfjs(),
        ]);
        const printablePayload = buildPrintableRegularAnnotationPayload({
          annotationsByPage,
          callouts,
          surveyMarkers,
          spaces,
        });
        const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
          pdfFile,
          printablePayload.annotationsByPage,
          pageSizes,
          {
            returnBytes: true,
            actionType: 'pdf-browser-print-flattened-regular-annotations',
            documentId: pdfFile?.id || pdfFile?.name || null,
            callouts: printablePayload.callouts,
            spaces,
            printableDiagnostics: printablePayload.diagnostics,
          },
        );
        if (cancelled) return;
        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
        const pdf = await loadingTask.promise;
        const pages = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: PRINT_RENDER_SCALE });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.ceil(viewport.width));
          canvas.height = Math.max(1, Math.ceil(viewport.height));
          const context = canvas.getContext('2d', { alpha: false });
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({
            canvasContext: context,
            viewport,
            annotationMode: pdfjsLib.AnnotationMode.ENABLE,
          }).promise;
          pages.push({
            pageNumber,
            widthPt: viewport.width / PRINT_RENDER_SCALE,
            heightPt: viewport.height / PRINT_RENDER_SCALE,
            src: canvas.toDataURL('image/jpeg', 0.94),
          });
          page.cleanup();
        }
        if (!cancelled) setRenderState({ ready: true, pages, error: '' });
      } catch (error) {
        console.error('[BrowserPrint] failed to prepare print pages:', error);
        if (!cancelled) {
          setRenderState({ ready: false, pages: [], error: error?.message || String(error) });
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      try { loadingTask?.destroy?.(); } catch {}
    };
  }, [annotationsByPage, callouts, pageSizes, pdfFile, spaces, surveyMarkers]);

  const layout = useMemo(() => buildBrowserPrintLayout(renderState.pages), [renderState.pages]);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-browser-print-document="true"
      data-browser-print-ready={renderState.ready ? 'true' : 'false'}
      data-browser-print-page-count={layout.pages.length}
      data-browser-print-error={renderState.error || undefined}
      aria-hidden="true"
    >
      <style>{`
        ${layout.pageCss}
        @media screen {
          [data-browser-print-document] { display: none !important; }
        }
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: auto !important;
            height: auto !important;
            overflow: visible !important;
            background: #fff !important;
          }
          body > *:not([data-browser-print-document]) { display: none !important; }
          body > [data-browser-print-document] {
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            width: auto !important;
            height: auto !important;
          }
          .survey-browser-print-sheet {
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            break-after: page;
            page-break-after: always;
            background: #fff !important;
          }
          .survey-browser-print-sheet:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .survey-browser-print-sheet > img {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            object-fit: fill !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
      {layout.pages.map((page) => (
        <section
          key={page.pageNumber}
          className="survey-browser-print-sheet"
          data-browser-print-page={page.pageNumber}
          style={{
            page: page.pageName,
            width: `${page.widthPt}pt`,
            height: `${page.heightPt}pt`,
          }}
        >
          <img src={page.src} alt={`PDF page ${page.pageNumber}`} />
        </section>
      ))}
    </div>,
    document.body,
  );
}
