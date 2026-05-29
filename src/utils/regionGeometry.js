// Geometry / page-resolution helpers for the viewer (page distance sort, region-area checks, DOM page-element + bounds-center math). Lifted verbatim from PDFViewer; all capture-free.

export function sortSyncfusionPagesByDistance(pages, originPage) {
  return [...pages]
    .filter((pageNumber) => Number.isFinite(pageNumber) && pageNumber > 0)
    .sort((left, right) => {
      const leftDistance = Math.abs(left - originPage);
      const rightDistance = Math.abs(right - originPage);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return left - right;
    });
}

export function hasValidRegionAreas(page) {
    if (!page || !Array.isArray(page.regions) || page.regions.length === 0) {
      return false;
    }
    return page.regions.some(region => {
      if (!region || !Array.isArray(region.coordinates)) {
        return false;
      }
      const coords = region.coordinates;
      return (region.shapeType === 'rectangular' && coords.length >= 8) ||
        (region.shapeType === 'polygon' && coords.length >= 6);
    });
  }

export function resolvePageContentElement(pageContainerNode) {
    if (!pageContainerNode || typeof pageContainerNode.querySelector !== 'function') {
      return pageContainerNode;
    }

    const syncfusionPageCanvas = pageContainerNode.querySelector('.e-pv-page-canvas');
    if (syncfusionPageCanvas) return syncfusionPageCanvas;

    const canvasNodes = Array.from(pageContainerNode.querySelectorAll('canvas'));
    if (canvasNodes.length === 0) return pageContainerNode;

    return canvasNodes.reduce((bestCanvas, canvasNode) => {
      const canvasArea = (Number(canvasNode.clientWidth) || Number(canvasNode.width) || 0) *
        (Number(canvasNode.clientHeight) || Number(canvasNode.height) || 0);
      const bestArea = bestCanvas
        ? (Number(bestCanvas.clientWidth) || Number(bestCanvas.width) || 0) *
          (Number(bestCanvas.clientHeight) || Number(bestCanvas.height) || 0)
        : -1;
      return canvasArea > bestArea ? canvasNode : bestCanvas;
    }, null) || pageContainerNode;
  }

export function getBoundsCenter(bounds) {
    if (!bounds || typeof bounds !== 'object') return null;
    const x = Number(bounds.x ?? bounds.left);
    const y = Number(bounds.y ?? bounds.top);
    const width = Number(bounds.width ?? (
      bounds.right !== undefined && Number.isFinite(x) ? Number(bounds.right) - x : 0
    ));
    const height = Number(bounds.height ?? (
      bounds.bottom !== undefined && Number.isFinite(y) ? Number(bounds.bottom) - y : 0
    ));
    const centerX = Number.isFinite(Number(bounds.centerX)) ? Number(bounds.centerX) : x + width / 2;
    const centerY = Number.isFinite(Number(bounds.centerY)) ? Number(bounds.centerY) : y + height / 2;
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;
    return {
      centerX,
      centerY,
      width: Number.isFinite(width) ? Math.max(width, 1) : 1,
      height: Number.isFinite(height) ? Math.max(height, 1) : 1
    };
  }
