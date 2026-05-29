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

export async function extractPdfOutlineBookmarks(pdf) {
    if (!pdf?.getOutline) return [];

    let outlineItems = null;
    try {
      outlineItems = await pdf.getOutline();
    } catch {
      return [];
    }

    if (!Array.isArray(outlineItems) || outlineItems.length === 0) {
      return [];
    }

    const imported = [];

    const walkOutline = async (items, parentId = null, path = []) => {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (!item) continue;

        const childItems = Array.isArray(item.items) ? item.items : [];
        const hasChildren = childItems.length > 0;
        const pageNumber = await resolvePdfOutlinePageNumber(pdf, item.dest);
        const hasValidPage = Boolean(pageNumber);

        // Skip non-navigable external outline entries unless they contain children.
        if (!hasChildren && !hasValidPage) {
          continue;
        }

        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const fallbackName = hasChildren ? `Section ${index + 1}` : `Bookmark ${index + 1}`;
        const name = title || fallbackName;
        const nextPath = [...path, name];
        const sourceId = `pdfjs:${nextPath.join('>')}#${index}`;
        const id = `pdf:${sourceId}`;
        const pageIds = hasValidPage ? [pageNumber] : [];

        imported.push({
          id,
          name,
          type: hasChildren ? 'folder' : 'bookmark',
          pageIds,
          parentId,
          children: [],
          source: 'pdf',
          sourceId,
          outlinePath: nextPath,
          order: index,
          dest: {
            pageNumber: hasValidPage ? pageNumber : null
          },
          isFromPDF: true
        });

        if (hasChildren) {
          await walkOutline(childItems, id, nextPath);
        }
      }
    };

    await walkOutline(outlineItems, null, []);
    return imported;
  }
