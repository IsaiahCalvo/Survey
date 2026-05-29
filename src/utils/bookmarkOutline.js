// Bookmark / PDF outline helpers — id generation + outline page-number resolution. Lifted verbatim from PDFViewer; all capture-free.

import { coercePageNumber } from '../viewerShared';

export function generateBookmarkId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function resolvePdfOutlinePageNumber(pdf, destination) {
    if (!pdf || destination === null || destination === undefined) return null;

    let resolvedDestination = destination;
    try {
      if (typeof resolvedDestination === 'string') {
        resolvedDestination = await pdf.getDestination(resolvedDestination);
      }
    } catch (error) {
      return null;
    }

    if (!Array.isArray(resolvedDestination) || resolvedDestination.length === 0) {
      return null;
    }

    const pageRef = resolvedDestination[0];
    try {
      if (typeof pageRef === 'number') {
        return coercePageNumber(pageRef + 1, pdf.numPages);
      }
      if (pageRef && typeof pageRef === 'object') {
        const pageIndex = await pdf.getPageIndex(pageRef);
        return coercePageNumber(pageIndex + 1, pdf.numPages);
      }
    } catch (error) {
      return null;
    }

    return null;
  }
