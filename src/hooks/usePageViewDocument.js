// usePageViewDocument — PDFViewer's side of instant page operations.
//
// A page operation (move, delete, insert blank, duplicate/copy, rotate) is
// shown at once by swapping the viewer's pdf.js document for an in-memory
// page view over the SAME loaded document (utils/pageViewDocument.js); the
// rewritten bytes reach the tab later from the background save
// (usePageOperations). This hook owns that swap: it updates pdfDoc, the page
// count and the per-page sizes in one tick, and remembers which saved files
// already match the screen so the load effect does not re-open them.

import { useCallback, useRef } from 'react';
import { applyPageViewOperation, getPageViewBase, getPageViewSizes } from '../utils/pageViewDocument.js';

export function usePageViewDocument({
  pdfDoc,
  pageObjects,
  pageSizesRef,
  pageRenderCacheRef,
  setPdfDoc,
  setNumPages,
  setPageSizes,
  setPageHeights,
}) {
  const docRef = useRef(null);
  docRef.current = pdfDoc;
  const pageObjectsRef = useRef({});
  pageObjectsRef.current = pageObjects;
  // Files written by the background save: already on screen.
  const currentFilesRef = useRef(new WeakSet());

  const show = useCallback((nextDoc) => {
    docRef.current = nextDoc;
    setPdfDoc(nextDoc);
    setNumPages(nextDoc.numPages);
    const sizes = getPageViewSizes(nextDoc) || {};
    const heights = {};
    Object.entries(sizes).forEach(([page, size]) => { heights[page] = size.height; });
    pageSizesRef.current = sizes;
    setPageSizes(sizes);
    setPageHeights(heights);
    pageRenderCacheRef.current?.clear?.();
    // Pages not measured yet (an operation right after open) fill in from the
    // cached pdf.js pages.
    const missing = [];
    for (let page = 1; page <= nextDoc.numPages; page += 1) {
      if (!sizes[page]) missing.push(page);
    }
    if (missing.length === 0) return;
    Promise.all(missing.map((page) => nextDoc.getPage(page).then((proxy) => {
      const viewport = proxy.getViewport({ scale: 1 });
      return [page, { width: viewport.width, height: viewport.height }];
    }).catch(() => null))).then((measured) => {
      if (docRef.current !== nextDoc) return;
      const found = Object.fromEntries(measured.filter(Boolean));
      setPageSizes((prev) => ({ ...prev, ...found }));
      setPageHeights((prev) => ({
        ...prev,
        ...Object.fromEntries(Object.entries(found).map(([page, size]) => [page, size.height])),
      }));
    });
  }, [pageRenderCacheRef, pageSizesRef, setNumPages, setPageHeights, setPageSizes, setPdfDoc]);

  const applyPageView = useCallback((operation) => {
    const previous = docRef.current;
    if (!previous) return undefined;
    show(applyPageViewOperation(previous, operation, {
      sizesByPage: pageSizesRef.current,
      pagesByNumber: pageObjectsRef.current,
    }));
    return previous;
  }, [pageSizesRef, show]);

  const restorePageView = useCallback((previous) => {
    if (!previous || getPageViewBase(previous) !== getPageViewBase(docRef.current)) return;
    show(previous);
  }, [show]);

  const markFileCurrent = useCallback((file) => {
    if (file) currentFilesRef.current.add(file);
  }, []);
  const isFileCurrent = useCallback((file) => Boolean(file && currentFilesRef.current.has(file)), []);
  // True while a page view over `pdf` replaced it on screen (its own page
  // numbers no longer match the viewer's).
  const isViewOver = useCallback((pdf) => (
    docRef.current !== pdf && getPageViewBase(docRef.current) === pdf
  ), []);

  return { applyPageView, restorePageView, markFileCurrent, isFileCurrent, isViewOver };
}
