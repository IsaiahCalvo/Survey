import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadPdfjs } from '../utils/pdfWorkerConfig.js';
import { buildBrowserPrintLayout } from '../utils/browserPrintLayout.js';

const PRINT_RENDER_SCALE = 2;
const EMPTY_RENDER_STATE = { ready: false, pages: [], error: '', pageNumber: 0, pageCount: 0, inputs: null };

const sameInputs = (left, right) => (
  Boolean(left && right)
  && left.pdfFile === right.pdfFile
  && left.annotationsByPage === right.annotationsByPage
  && left.callouts === right.callouts
  && left.surveyMarkers === right.surveyMarkers
  && left.spaces === right.spaces
  && left.pageSizes === right.pageSizes
);

const BrowserPrintDocument = forwardRef(function BrowserPrintDocument({
  pdfFile,
  annotationsByPage,
  callouts,
  surveyMarkers,
  spaces,
  pageSizes,
}, ref) {
  const currentInputs = { pdfFile, annotationsByPage, callouts, surveyMarkers, spaces, pageSizes };
  const latestInputsRef = useRef(currentInputs);
  const [renderState, setRenderState] = useState(EMPTY_RENDER_STATE);
  const loadingTaskRef = useRef(null);
  const preparingPromiseRef = useRef(null);
  const printWhenReadyRef = useRef(false);
  const mountedRef = useRef(true);
  const readyForCurrentInputs = renderState.ready && sameInputs(renderState.inputs, currentInputs);
  const readyRef = useRef(readyForCurrentInputs);
  readyRef.current = readyForCurrentInputs;

  const preparePrint = useCallback(() => {
    if (!pdfFile || typeof document === 'undefined') return Promise.resolve(false);
    printWhenReadyRef.current = true;
    if (preparingPromiseRef.current) return preparingPromiseRef.current;

    const jobInputs = currentInputs;
    setRenderState({ ...EMPTY_RENDER_STATE, inputs: jobInputs });

    let loadingTask = null;
    const promise = (async () => {
      try {
        const [{
          buildPrintableRegularAnnotationPayload,
          savePDFWithFlattenedRegularAnnotationsForPrint,
        }, pdfjsLib] = await Promise.all([
          import('../utils/pdfAnnotationsPdfLib.js'),
          loadPdfjs(),
        ]);
        if (!mountedRef.current) return false;
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
        if (!mountedRef.current || !sameInputs(jobInputs, latestInputsRef.current)) return false;

        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
        loadingTaskRef.current = loadingTask;
        const pdf = await loadingTask.promise;
        if (!mountedRef.current) return false;
        const pages = [];
        setRenderState((current) => ({ ...current, pageCount: pdf.numPages }));

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (!mountedRef.current || !sameInputs(jobInputs, latestInputsRef.current)) return false;
          setRenderState((current) => ({ ...current, pageNumber, pageCount: pdf.numPages }));
          const page = await pdf.getPage(pageNumber);
          try {
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
            if (!mountedRef.current || !sameInputs(jobInputs, latestInputsRef.current)) return false;
            pages.push({
              pageNumber,
              widthPt: viewport.width / PRINT_RENDER_SCALE,
              heightPt: viewport.height / PRINT_RENDER_SCALE,
              src: canvas.toDataURL('image/jpeg', 0.94),
            });
          } finally {
            page.cleanup();
          }
        }

        setRenderState({
          ready: true,
          pages,
          error: '',
          pageNumber: pdf.numPages,
          pageCount: pdf.numPages,
          inputs: jobInputs,
        });
        return true;
      } catch (error) {
        console.error('[BrowserPrint] failed to prepare print pages:', error);
        if (mountedRef.current && sameInputs(jobInputs, latestInputsRef.current)) {
          printWhenReadyRef.current = false;
          setRenderState({ ...EMPTY_RENDER_STATE, error: error?.message || String(error), inputs: jobInputs });
        }
        return false;
      } finally {
        try { await loadingTask?.destroy?.(); } catch {}
        if (loadingTaskRef.current === loadingTask) loadingTaskRef.current = null;
      }
    })();

    preparingPromiseRef.current = promise;
    promise.finally(() => {
      if (preparingPromiseRef.current === promise) preparingPromiseRef.current = null;
    });
    return promise;
  }, [annotationsByPage, callouts, pageSizes, pdfFile, spaces, surveyMarkers]);

  useImperativeHandle(ref, () => ({ print: preparePrint }), [preparePrint]);

  useEffect(() => {
    if (!readyForCurrentInputs || !printWhenReadyRef.current) return;
    printWhenReadyRef.current = false;
    window.print();
  }, [readyForCurrentInputs]);

  useEffect(() => {
    latestInputsRef.current = currentInputs;
    if (!renderState.inputs || sameInputs(renderState.inputs, currentInputs)) return;
    const shouldRestart = printWhenReadyRef.current;
    try { loadingTaskRef.current?.destroy?.(); } catch {}
    loadingTaskRef.current = null;
    preparingPromiseRef.current = null;
    printWhenReadyRef.current = false;
    setRenderState(EMPTY_RENDER_STATE);
    if (shouldRestart) preparePrint();
  }, [annotationsByPage, callouts, pageSizes, pdfFile, preparePrint, renderState.inputs, spaces, surveyMarkers]);

  useEffect(() => {
    const handleBeforePrint = () => {
      if (!readyRef.current) printWhenReadyRef.current = false;
    };
    const handleAfterPrint = () => {
      printWhenReadyRef.current = false;
      setRenderState(EMPTY_RENDER_STATE);
    };
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try { loadingTaskRef.current?.destroy?.(); } catch {}
    };
  }, []);

  const layout = useMemo(
    () => buildBrowserPrintLayout(readyForCurrentInputs ? renderState.pages : []),
    [readyForCurrentInputs, renderState.pages],
  );
  if (typeof document === 'undefined') return null;

  const preparing = !renderState.ready
    && sameInputs(renderState.inputs, currentInputs)
    && preparingPromiseRef.current !== null
    && !renderState.error;
  const progressText = renderState.pageCount > 0
    ? `Preparing print… page ${Math.max(1, renderState.pageNumber)} of ${renderState.pageCount}`
    : 'Preparing print…';

  return createPortal(
    <>
      {(preparing || renderState.error) && (
        <div className="survey-browser-print-progress" role="status" aria-live="polite">
          {renderState.error ? 'Could not prepare the document for print. Please try again.' : progressText}
        </div>
      )}
      <div
        data-browser-print-document="true"
        data-browser-print-ready={readyForCurrentInputs ? 'true' : 'false'}
        data-browser-print-page-count={layout.pages.length}
        data-browser-print-error={renderState.error || undefined}
        aria-hidden="true"
      >
        <style>{`
          ${layout.pageCss}
          @media screen {
            [data-browser-print-document] { display: none !important; }
            .survey-browser-print-progress {
              position: fixed;
              left: 50%;
              top: 24px;
              z-index: 2147483647;
              transform: translateX(-50%);
              padding: 12px 18px;
              border: 1px solid #5f5130;
              border-radius: 8px;
              background: #171717;
              color: #f6d77b;
              box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
              font: 600 14px/1.4 system-ui, sans-serif;
            }
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
            .survey-browser-print-placeholder {
              display: flex !important;
              min-height: 9in;
              align-items: center;
              justify-content: center;
              box-sizing: border-box;
              padding: 0.75in;
              color: #111;
              font: 700 18pt/1.4 system-ui, sans-serif;
              text-align: center;
            }
          }
        `}</style>
        {layout.pages.length === 0 && (
          <section className="survey-browser-print-placeholder">
            Document is still preparing for print — please cancel and retry.
          </section>
        )}
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
      </div>
    </>,
    document.body,
  );
});

export default BrowserPrintDocument;
