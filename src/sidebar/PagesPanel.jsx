/**
 * PagesPanel.jsx — sidebar thumbnail strip for page navigation and page operations.
 *
 * Default export PagesPanel renders lazy (IntersectionObserver) page thumbnails
 * rendered via pdf.js (fast low-res then crisp upgrade through a LIFO queue), plus
 * click-to-navigate, drag reorder (onReorderPages), and a right-click context menu
 * for cut/copy/paste/duplicate/rotate/mirror/reset/delete. Honors pageTransformations.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Icon from '../Icons';
import Spinner from '../components/Spinner';
import { useTooltip } from '../components/Tooltip';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const FAST_THUMBNAIL_SCALE = 0.15; // Ultra-fast, low-res (was 0.2)
const CRISP_THUMBNAIL_SCALE = 0.5; // Slower, high-res
const THUMBNAIL_DPR_CAP = 1;
const CRISP_DPR_CAP = 2;
const THUMBNAIL_JPEG_QUALITY = 0.72;
const EAGER_PRELOAD_COUNT = 6;
const CONCURRENCY_LIMIT = 4;


const PagesPanel = ({
  pdfDoc,
  numPages,
  pageNum,
  onNavigateToPage,
  onDuplicatePage,
  onInsertBlankPage,
  onDeletePage,
  onCutPage,
  onCopyPage,
  onPastePage,
  clipboardPage,
  clipboardType,
  onRotatePage,
  onMirrorPage,
  onResetPage,
  onReorderPages,
  pageTransformations = {},
  getThumbnail,
  shouldShowPage,
  activeSpacePages,
  scale,
  onPageDragStart,
  tabId,
  mobileMode = false,
}) => {
  // KAL-65: sidebar controls use the app's instant shared tooltip, never a
  // native title= (the OS tooltip takes ~1.5s and is OS-styled, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  const [thumbnails, setThumbnails] = useState({});
  const [pageAspectRatios, setPageAspectRatios] = useState({});
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedPage, setSelectedPage] = useState(pageNum);
  const [mobileSelectMode, setMobileSelectMode] = useState(false);
  const [mobileSelectedPages, setMobileSelectedPages] = useState(() => new Set());
  const [draggedPage, setDraggedPage] = useState(null);
  const [dragOverPage, setDragOverPage] = useState(null);
  const contextMenuRef = useRef(null);
  const thumbnailRefs = useRef({});
  const observerRef = useRef(null);
  const containerRef = useRef(null);
  const isMountedRef = useRef(true);
  const thumbnailsRef = useRef({});

  // Queue State
  const queueRef = useRef({
    fast: [], // LIFO stack for fast thumbs
    crisp: [] // LIFO stack for crisp thumbs
  });
  const activeTasksRef = useRef(new Map()); // Map<pageNumber, { cancel: () => void, type: 'fast'|'crisp' }>
  const runningWorkersRef = useRef(0);
  const pendingRequestsRef = useRef(new Set()); // Track pages currently in queue or running

  useEffect(() => {
    thumbnailsRef.current = thumbnails;
  }, [thumbnails]);

  const getRotationDelta = useCallback((pageNumber) => {
    const transform = pageTransformations?.[pageNumber];
    if (!transform) return 0;
    const baseRotation = Number.isFinite(transform.baseRotation) ? transform.baseRotation : 0;
    const rotation = Number.isFinite(transform.rotation) ? transform.rotation : baseRotation;
    return ((rotation - baseRotation) % 360 + 360) % 360;
  }, [pageTransformations]);

  const getDisplayAspectRatio = useCallback((pageNumber, ratioPercent) => {
    const ratio = Number.isFinite(ratioPercent) && ratioPercent > 0 ? ratioPercent : 129;
    const rotationDelta = getRotationDelta(pageNumber);
    if (rotationDelta % 180 !== 0) {
      return 10000 / ratio;
    }
    return ratio;
  }, [getRotationDelta]);

  const normalizeThumbnailResult = useCallback((result) => {
    if (!result) return null;
    if (typeof result === 'string') {
      return {
        src: result,
        width: null,
        height: null,
        containerWidth: null,
        containerHeight: null,
        source: null,
        elementId: null,
        quality: 'unknown'
      };
    }
    if (typeof result === 'object') {
      const src = typeof result.src === 'string' ? result.src : '';
      if (!src.trim()) return null;
      return {
        src,
        width: Number.isFinite(result.width) && result.width > 0 ? result.width : null,
        height: Number.isFinite(result.height) && result.height > 0 ? result.height : null,
        containerWidth: Number.isFinite(result.containerWidth) && result.containerWidth > 0 ? result.containerWidth : null,
        containerHeight: Number.isFinite(result.containerHeight) && result.containerHeight > 0 ? result.containerHeight : null,
        source: result.source || null,
        elementId: typeof result.elementId === 'string' && result.elementId.trim() ? result.elementId : null,
        quality: result.quality || 'unknown'
      };
    }
    return null;
  }, []);

  const isLikelyBlackThumbnailSrc = useCallback((src) => (
    new Promise((resolve) => {
      if (typeof src !== 'string' || src.trim() === '') {
        resolve(false);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const width = Math.max(8, Math.min(24, img.naturalWidth || img.width || 0));
          const height = Math.max(8, Math.min(24, img.naturalHeight || img.height || 0));
          if (width <= 0 || height <= 0) {
            resolve(false);
            return;
          }
          const probeCanvas = document.createElement('canvas');
          probeCanvas.width = width;
          probeCanvas.height = height;
          const probeContext = probeCanvas.getContext('2d', { willReadFrequently: true });
          if (!probeContext) {
            resolve(false);
            return;
          }
          probeContext.drawImage(img, 0, 0, width, height);
          const { data } = probeContext.getImageData(0, 0, width, height);
          if (!data || data.length === 0) {
            resolve(false);
            return;
          }

          const totalPixels = width * height;
          let opaquePixels = 0;
          let darkOpaquePixels = 0;
          let minLuminance = 255;
          let maxLuminance = 0;

          for (let offset = 0; offset < data.length; offset += 4) {
            const r = data[offset];
            const g = data[offset + 1];
            const b = data[offset + 2];
            const a = data[offset + 3];
            const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
            if (luminance < minLuminance) minLuminance = luminance;
            if (luminance > maxLuminance) maxLuminance = luminance;
            if (a >= 220) {
              opaquePixels += 1;
              if (luminance <= 12) {
                darkOpaquePixels += 1;
              }
            }
          }

          const opaqueRatio = opaquePixels / totalPixels;
          const darkOpaqueRatio = opaquePixels > 0 ? (darkOpaquePixels / opaquePixels) : 0;
          const contrast = maxLuminance - minLuminance;
          resolve(opaqueRatio >= 0.9 && darkOpaqueRatio >= 0.94 && contrast <= 10);
        } catch {
          resolve(false);
        }
      };
      img.onerror = () => resolve(false);
      img.src = src;
    })
  ), []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // Cancel all running tasks
      activeTasksRef.current.forEach(task => task.cancel());
      activeTasksRef.current.clear();
      queueRef.current.fast = [];
      queueRef.current.crisp = [];
    };
  }, []);

  const allowedPages = useMemo(() => {
    const normalizePageNumbers = (pages) => {
      if (!Array.isArray(pages)) return [];
      const seen = new Set();
      const normalized = [];
      pages.forEach((value) => {
        const pageNumber = Number.parseInt(value, 10);
        if (!Number.isFinite(pageNumber)) return;
        if (pageNumber < 1 || pageNumber > numPages) return;
        if (seen.has(pageNumber)) return;
        seen.add(pageNumber);
        normalized.push(pageNumber);
      });
      return normalized;
    };

    if (Array.isArray(activeSpacePages) && activeSpacePages.length > 0) {
      return normalizePageNumbers(activeSpacePages);
    }

    if (typeof shouldShowPage === 'function') {
      return Array.from({ length: numPages }, (_, i) => i + 1).filter((pageNumber) => shouldShowPage(pageNumber));
    }

    return Array.from({ length: numPages }, (_, i) => i + 1);
  }, [activeSpacePages, shouldShowPage, numPages]);

  // Update selected page when pageNum prop changes
  useEffect(() => {
    if (allowedPages.includes(pageNum)) {
      setSelectedPage(pageNum);
    } else if (allowedPages.length > 0) {
      setSelectedPage(allowedPages[0]);
    } else {
      setSelectedPage(null);
    }
  }, [pageNum, allowedPages]);

  // Generate aspect ratios for all pages (lightweight, runs once)
  useEffect(() => {
    if (!pdfDoc || typeof getThumbnail === 'function') return;

    const getAspectRatios = async () => {
      const ratios = {};
      for (let i = 1; i <= numPages; i++) {
        try {
          const page = await pdfDoc.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          ratios[i] = (viewport.height / viewport.width) * 100; // percentage for paddingBottom
        } catch (error) {
          console.error(`Error getting aspect ratio for page ${i}:`, error);
          ratios[i] = 129; // default to letter size ratio
        }
      }
      setPageAspectRatios(ratios);
    };

    getAspectRatios();
  }, [pdfDoc, numPages, getThumbnail]);

  useEffect(() => {
    setThumbnails({});
    setPageAspectRatios({});

    // Reset Queue
    activeTasksRef.current.forEach(task => task.cancel());
    activeTasksRef.current.clear();
    queueRef.current.fast = [];
    queueRef.current.crisp = [];
    pendingRequestsRef.current.clear();
    runningWorkersRef.current = 0;
  }, [pdfDoc, numPages, getThumbnail]);

  const applyThumbnailResult = useCallback((pageNumber, normalized) => {
    if (!isMountedRef.current || !normalized) return;

    const ratioWidth = normalized.width || normalized.containerWidth;
    const ratioHeight = normalized.height || normalized.containerHeight;
    if (ratioWidth && ratioHeight) {
      setPageAspectRatios((prev) => {
        const ratioValue = (ratioHeight / ratioWidth) * 100;
        if (prev[pageNumber] && Math.abs(prev[pageNumber] - ratioValue) < 0.5) {
          return prev;
        }
        return {
          ...prev,
          [pageNumber]: ratioValue
        };
      });
    } else if (normalized.src) {
      const img = new Image();
      img.onload = () => {
        if (!isMountedRef.current) return;
        const width = img.naturalWidth || img.width || null;
        const height = img.naturalHeight || img.height || null;
        if (!width || !height) return;
        setPageAspectRatios((prev) => {
          const ratioValue = (height / width) * 100;
          if (prev[pageNumber] && Math.abs(prev[pageNumber] - ratioValue) < 0.5) {
            return prev;
          }
          return {
            ...prev,
            [pageNumber]: ratioValue
          };
        });
      };
      img.src = normalized.src;
    }

    setThumbnails((prev) => ({
      ...prev,
      [pageNumber]: normalized
    }));
  }, []);

  const renderPdfJsThumbnail = useCallback(async (pageNumber, quality = 'fast', onCancel) => {
    if (!pdfDoc) return null;
    const page = await pdfDoc.getPage(pageNumber);

    const scale = quality === 'crisp' ? CRISP_THUMBNAIL_SCALE : FAST_THUMBNAIL_SCALE;
    const dprCap = quality === 'crisp' ? CRISP_DPR_CAP : THUMBNAIL_DPR_CAP;

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;

    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.scale(dpr, dpr);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, viewport.width, viewport.height);

    const renderTask = page.render({
      canvasContext: context,
      viewport,
      background: 'rgb(255, 255, 255)'
    });

    if (onCancel) {
      onCancel(() => renderTask.cancel());
    }

    try {
      await renderTask.promise;
    } catch (error) {
      if (error?.name === 'RenderingCancelledException') {
        throw error;
      }
      throw error;
    }

    return {
      src: canvas.toDataURL('image/jpeg', THUMBNAIL_JPEG_QUALITY),
      width: viewport.width,
      height: viewport.height,
      source: 'pdfjs',
      quality
    };
  }, [pdfDoc]);

  const processQueue = useCallback(async () => {
    if (runningWorkersRef.current >= CONCURRENCY_LIMIT) return;

    // LIFO Strategy: Pop from end of array
    // Prioritize FAST (initial load) over CRISP (enhancement)
    let job = queueRef.current.fast.pop(); // Try fast first
    let type = 'fast';

    if (!job) {
      job = queueRef.current.crisp.pop(); // Then crisp
      type = 'crisp';
    }

    if (!job) return; // No jobs

    const { pageNumber } = job;
    runningWorkersRef.current++;

    // Register active task for cancellation
    let cancelRender = null;
    const cancelAuth = () => {
      if (cancelRender) cancelRender();
    };
    activeTasksRef.current.set(pageNumber, { cancel: cancelAuth, type });

    try {
      let thumbnailResult = null;

      // For fast thumbnails, we check if Pdfjs provided one (unlikely given previous issues, but safe optimization)
      if (type === 'fast' && typeof getThumbnail === 'function') {
        // ... (existing logic for external provider if needed, mostly unused now)
      }

      if (!thumbnailResult && pdfDoc) {
        thumbnailResult = await renderPdfJsThumbnail(pageNumber, type, (cancelFn) => {
          cancelRender = cancelFn;
        });
      }

      if (isMountedRef.current && thumbnailResult) {
        let normalized = normalizeThumbnailResult(thumbnailResult);

        applyThumbnailResult(pageNumber, normalized);

        // Schedule upgrade if fast
        if (type === 'fast') {
          // Add to crisp queue
          queueRef.current.crisp.push({ pageNumber });
          // Trigger queue check
          processQueue();
        }
      }
    } catch (error) {
      if (error?.name === 'RenderingCancelledException') {
        // Expected when cancelled
      } else {
        console.error(`Error processing thumbnail ${pageNumber} (${type}):`, error);
      }
    } finally {
      runningWorkersRef.current--;
      activeTasksRef.current.delete(pageNumber);
      pendingRequestsRef.current.delete(pageNumber); // Only remove from pending once fully done or cancelled
      if (isMountedRef.current) {
        processQueue(); // Loop
      }
    }
  }, [pdfDoc, getThumbnail, applyThumbnailResult, renderPdfJsThumbnail, normalizeThumbnailResult]);

  const scheduleThumbnail = useCallback((pageNumber, priority = 'fast') => {
    if (!Number.isFinite(pageNumber) || pageNumber < 1) return;

    // Check if already has a better or equal thumbnail
    const existing = thumbnailsRef.current[pageNumber];
    if (existing?.quality === 'crisp') return;
    if (priority === 'fast' && existing?.quality === 'fast') {
      if (queueRef.current.crisp.find(j => j.pageNumber === pageNumber)) return;
      queueRef.current.crisp.push({ pageNumber });
      processQueue();
      return;
    }

    // Check if already in queue or processing
    if (activeTasksRef.current.has(pageNumber)) return;

    // Add to appropriate queue
    // Remove if already exists to move to end (LIFO behavior for re-requests)
    const targetQueue = priority === 'fast' ? queueRef.current.fast : queueRef.current.crisp;
    const existingIndex = targetQueue.findIndex(j => j.pageNumber === pageNumber);
    if (existingIndex !== -1) {
      targetQueue.splice(existingIndex, 1);
    }

    targetQueue.push({ pageNumber });
    pendingRequestsRef.current.add(pageNumber);
    processQueue();
  }, [processQueue]);

  // Public entry point (replacing generateThumbnail)
  const generateThumbnail = useCallback((pageNumber, { force = false } = {}) => {
    scheduleThumbnail(pageNumber, 'fast');
  }, [scheduleThumbnail]);

  // Cancel thumbnail (when scrolling away)
  const cancelThumbnail = useCallback((pageNumber) => {
    // Remove from queues
    const fastIdx = queueRef.current.fast.findIndex(j => j.pageNumber === pageNumber);
    if (fastIdx !== -1) queueRef.current.fast.splice(fastIdx, 1);

    const crispIdx = queueRef.current.crisp.findIndex(j => j.pageNumber === pageNumber);
    if (crispIdx !== -1) queueRef.current.crisp.splice(crispIdx, 1);

    // Cancel active task
    const active = activeTasksRef.current.get(pageNumber);
    if (active) {
      active.cancel();
    }

    pendingRequestsRef.current.delete(pageNumber);
  }, []);

  // Set up Intersection Observer for lazy loading thumbnails
  useEffect(() => {
    const hasProvider = typeof getThumbnail === 'function';
    if (!hasProvider && !pdfDoc) return;
    if (!hasProvider && Object.keys(pageAspectRatios).length === 0) return;
    if (allowedPages.length === 0) return;

    // Clean up existing observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    // Proactively render initial pages so the panel doesn't stay in a loading state.
    allowedPages.slice(0, EAGER_PRELOAD_COUNT).forEach((pageNumber) => {
      generateThumbnail(pageNumber);
    });

    if (typeof IntersectionObserver !== 'function') {
      return;
    }

    // Create new observer
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const pageNumber = Number.parseInt(entry.target.dataset.pageNumber, 10);
            generateThumbnail(pageNumber);
          } else {
            // Cancel if scrolled out
            const pageNumber = Number.parseInt(entry.target.dataset.pageNumber, 10);
            cancelThumbnail(pageNumber);
          }
        });
      },
      {
        root: containerRef.current,
        rootMargin: '240px 0px',
        threshold: 0.01
      }
    );

    // Observe currently mounted thumbnail containers.
    allowedPages.forEach((pageNumber) => {
      const ref = thumbnailRefs.current[pageNumber];
      if (ref) {
        observerRef.current.observe(ref);
      }
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [allowedPages, generateThumbnail, cancelThumbnail, getThumbnail, pageAspectRatios, pdfDoc]);

  useEffect(() => {
    if (allowedPages.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const preloadMargin = 260;

    allowedPages.forEach((pageNumber) => {
      const ref = thumbnailRefs.current[pageNumber];
      if (!ref) return;
      const rect = ref.getBoundingClientRect();
      const isNearViewport = rect.bottom >= (containerRect.top - preloadMargin)
        && rect.top <= (containerRect.bottom + preloadMargin);
      if (isNearViewport) {
        generateThumbnail(pageNumber);
      }
    });
  }, [allowedPages, generateThumbnail, pageNum]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
        setContextMenu(null);
      }
    };

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu]);

  // Scroll to selected page
  useEffect(() => {
    if (selectedPage && thumbnailRefs.current[selectedPage]) {
      thumbnailRefs.current[selectedPage].scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [selectedPage]);

  const handleContextMenu = useCallback((e, pageNumber) => {
    e.preventDefault();
    e.stopPropagation();
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1000;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    setContextMenu({
      pageNumber,
      x: Math.max(8, Math.min(e.clientX, viewportWidth - 196)),
      y: Math.max(8, Math.min(e.clientY, viewportHeight - 420))
    });
  }, []);

  const movePageByOffset = useCallback((pageNumber, offset) => {
    const index = allowedPages.indexOf(pageNumber);
    const targetPage = allowedPages[index + offset];
    if (index < 0 || !targetPage || !onReorderPages) return;
    onReorderPages(pageNumber, targetPage);
    setContextMenu(null);
  }, [allowedPages, onReorderPages]);

  const handlePageClick = useCallback((pageNumber) => {
    if (mobileMode && mobileSelectMode) {
      setMobileSelectedPages((current) => {
        const next = new Set(current);
        if (next.has(pageNumber)) next.delete(pageNumber);
        else next.add(pageNumber);
        return next;
      });
      return;
    }
    setSelectedPage(pageNumber);
    if (onNavigateToPage) {
      onNavigateToPage(pageNumber);
    }
  }, [mobileMode, mobileSelectMode, onNavigateToPage]);

  const handlePageDoubleClick = useCallback((pageNumber) => {
    if (onNavigateToPage) {
      onNavigateToPage(pageNumber);
    }
  }, [onNavigateToPage]);

  const handleDuplicate = useCallback((pageNumber) => {
    if (onDuplicatePage) {
      onDuplicatePage(pageNumber);
    }
    setContextMenu(null);
  }, [onDuplicatePage]);


  const handleDelete = useCallback((pageNumber) => {
    if (onDeletePage && window.confirm(`Delete page ${pageNumber}?`)) {
      onDeletePage(pageNumber);
    }
    setContextMenu(null);
  }, [onDeletePage]);

  const handleCut = useCallback((pageNumber) => {
    if (onCutPage) {
      onCutPage(pageNumber);
    }
    setContextMenu(null);
  }, [onCutPage]);

  const handleCopy = useCallback((pageNumber) => {
    if (onCopyPage) {
      onCopyPage(pageNumber);
    }
    setContextMenu(null);
  }, [onCopyPage]);

  const handlePaste = useCallback((pageNumber) => {
    if (onPastePage && clipboardPage) {
      onPastePage(pageNumber, clipboardPage, clipboardType);
    }
    setContextMenu(null);
  }, [onPastePage, clipboardPage, clipboardType]);

  const handleRotate = useCallback((pageNumber) => {
    if (onRotatePage) {
      onRotatePage(pageNumber);
    }
    setContextMenu(null);
  }, [onRotatePage]);

  const handleMirrorHorizontal = useCallback((pageNumber) => {
    if (onMirrorPage) {
      onMirrorPage(pageNumber, 'horizontal');
    }
    setContextMenu(null);
  }, [onMirrorPage]);

  const handleMirrorVertical = useCallback((pageNumber) => {
    if (onMirrorPage) {
      onMirrorPage(pageNumber, 'vertical');
    }
    setContextMenu(null);
  }, [onMirrorPage]);

  const handleReset = useCallback((pageNumber) => {
    if (onResetPage) {
      onResetPage(pageNumber);
    }
    setContextMenu(null);
  }, [onResetPage]);

  // Handle drag start for internal reordering
  const handleDragStart = useCallback((e, pageNumber) => {
    setDraggedPage(pageNumber);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/pdf-page-internal', pageNumber.toString());

    // Also set data for external drag (to tabs)
    if (onPageDragStart && tabId) {
      e.dataTransfer.setData('application/pdf-page', JSON.stringify({
        tabId,
        pageNumber,
        pdfDoc: null
      }));
    }
  }, [onPageDragStart, tabId]);

  // Handle drag over for internal reordering
  const handleDragOver = useCallback((e, targetPageNumber) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if this is an internal drag
    const types = Array.from(e.dataTransfer.types || []);
    if (types.includes('application/pdf-page-internal')) {
      e.dataTransfer.dropEffect = 'move';
      if (draggedPage !== null && draggedPage !== targetPageNumber) {
        setDragOverPage(targetPageNumber);
      }
    } else if (types.includes('application/pdf-page')) {
      // External drag to tab - allow it
      e.dataTransfer.dropEffect = 'move';
    }
  }, [draggedPage]);

  // Handle drag leave
  const handleDragLeave = useCallback((e) => {
    const relatedTarget = e.relatedTarget;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDragOverPage(null);
    }
  }, []);

  // Handle drop for internal reordering
  const handleDrop = useCallback((e, targetPageNumber) => {
    e.preventDefault();
    e.stopPropagation();

    const types = Array.from(e.dataTransfer.types || []);

    // Check if this is an internal reorder
    if (types.includes('application/pdf-page-internal')) {
      const sourcePageNumber = parseInt(e.dataTransfer.getData('application/pdf-page-internal'));
      if (sourcePageNumber && sourcePageNumber !== targetPageNumber && onReorderPages) {
        onReorderPages(sourcePageNumber, targetPageNumber);
      }
    }

    setDraggedPage(null);
    setDragOverPage(null);
  }, [onReorderPages]);

  // Handle drag end to reset state if drag is cancelled
  const handleDragEnd = useCallback(() => {
    setDraggedPage(null);
    setDragOverPage(null);
  }, []);

  return (
    <div className={mobileMode ? 'mobile-pages-panel' : undefined} style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: FONT_FAMILY,
      background: 'var(--surface-1)'
    }}>
      {mobileMode && (
        <div className="mobile-pages-counter">
          <span>{pageNum}</span>
          <strong>/ {numPages} pages</strong>
        </div>
      )}
      {/* Thumbnail List */}
      <div
        ref={containerRef}
        className={mobileMode ? 'mobile-pages-track' : undefined}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}
      >
        {allowedPages.map(pageNumber => {
          const isSelected = pageNumber === selectedPage;
          const isMobileSelected = mobileSelectedPages.has(pageNumber);
          const thumbnailMeta = thumbnails[pageNumber];
          const thumbnailSrc = typeof thumbnailMeta === 'string' ? thumbnailMeta : thumbnailMeta?.src;
          const rawRatio = pageAspectRatios[pageNumber] || 129;
          const displayRatio = getDisplayAspectRatio(pageNumber, rawRatio);
          // Off-screen thumbnail rows skip layout/paint; estimate each row's
          // height from the same per-page aspect ratio that drives the live
          // thumbnail box so the scrollbar geometry stays stable.
          const estimatedRowHeight = Math.round(8 + (150 * displayRatio) / 100);
          const transformState = pageTransformations[pageNumber] || { rotation: 0, mirrorH: false, mirrorV: false };
          const rotationDelta = getRotationDelta(pageNumber);
          const transforms = [];
          if (rotationDelta) {
            transforms.push(`rotate(${rotationDelta}deg)`);
          }
          if (transformState.mirrorH) {
            transforms.push('scaleX(-1)');
          }
          if (transformState.mirrorV) {
            transforms.push('scaleY(-1)');
          }
          const thumbnailTransform = transforms.length > 0 ? transforms.join(' ') : 'none';

          return (
            <div
              key={pageNumber}
              className={mobileMode ? `mobile-page-card${isSelected ? ' is-active' : ''}${isMobileSelected ? ' is-selected' : ''}` : undefined}
              ref={el => { thumbnailRefs.current[pageNumber] = el; }}
              data-page-number={pageNumber}
              draggable={!mobileMode}
              onDragStart={(e) => {
                handleDragStart(e, pageNumber);
                if (onPageDragStart && tabId) {
                  onPageDragStart(tabId, pageNumber);
                }
              }}
              onDragOver={(e) => handleDragOver(e, pageNumber)}
              onDragLeave={handleDragLeave}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(e, pageNumber)}
              onContextMenu={(e) => handleContextMenu(e, pageNumber)}
              onClick={() => handlePageClick(pageNumber)}
              onDoubleClick={() => handlePageDoubleClick(pageNumber)}
              style={{
                position: 'relative',
                padding: mobileMode ? '8px' : '4px',
                /* Phone: the card takes its grid cell (two columns, see
                   .mobile-pages-track in mobilePdfViewer.css); no fixed box. */
                boxSizing: 'border-box',
                background: isSelected ? 'var(--surface-3)' : (dragOverPage === pageNumber ? 'var(--surface-3)' : 'transparent'),
                border: isSelected ? '1px solid var(--accent)' : (dragOverPage === pageNumber ? '1px solid var(--accent)' : '1px solid transparent'),
                borderRadius: '4px',
                cursor: mobileMode ? 'pointer' : (draggedPage === pageNumber ? 'grabbing' : 'grab'),
                touchAction: mobileMode ? 'pan-y' : undefined,
                opacity: draggedPage === pageNumber ? 0.82 : 1,
                zIndex: draggedPage === pageNumber ? 1 : 'auto',
                transition: draggedPage === pageNumber ? 'none' : 'background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease',
                contentVisibility: mobileMode ? 'visible' : 'auto',
                containIntrinsicSize: `0 ${estimatedRowHeight}px`
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = 'var(--hover)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {/* Page Number Badge */}
              <div style={{
                position: 'absolute',
                top: '6px',
                right: '6px',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: 'var(--surface-3)',
                color: 'var(--text-1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                fontWeight: '600',
                fontFamily: FONT_FAMILY,
                zIndex: 1,
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.3)'
              }}>
                {pageNumber}
              </div>

              {/* UX 2026-07-12 — Mobile clipboard indicator: when this page is the
                  cut/copy source, surface a green-bordered badge at the top-left of
                  the card so the user can see which page is on the clipboard before
                  pasting. Demo parity: PageThumb clipboard badge (styles.ts:1174-1187).
                  Desktop cards never show this (mobileMode-gated). */}
              {mobileMode && clipboardPage === pageNumber && (
                <div
                  className="mobile-page-clipboard-badge"
                  aria-label={clipboardType === 'cut' ? `Page ${pageNumber} cut to clipboard` : `Page ${pageNumber} copied to clipboard`}
                  {...tip(clipboardType === 'cut' ? 'Cut — ready to paste' : 'Copied — ready to paste', 'below')}
                >
                  <Icon name="copy" size={12} color="var(--accent)" />
                </div>
              )}

              {mobileMode && (
                <button
                  type="button"
                  aria-label={`Page ${pageNumber} actions`}
                  {...tip(`Page ${pageNumber} actions`, 'below')}
                  onClick={(event) => handleContextMenu(event, pageNumber)}
                  style={{
                    position: 'absolute',
                    right: 6,
                    bottom: 6,
                    width: 30,
                    height: 30,
                    padding: 0,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--text-2)',
                    /* UX: the overflow button sits ON a page thumbnail, so it needs a
                       plate it can be read against without hiding the page. --surface-1 at
                       the same 84% it always had; the channels used to be the retired
                       ramp's #12151c typed out as rgba(), which the hex sweep never saw. */
                    background: 'color-mix(in srgb, var(--surface-1) 84%, transparent)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    zIndex: 2,
                  }}
                >
                  <Icon name="more" size={16} color="currentColor" />
                </button>
              )}

              {mobileMode && mobileSelectMode && (
                <span className={`mobile-page-select-indicator${isMobileSelected ? ' is-selected' : ''}`} aria-hidden="true">
                  {isMobileSelected ? <Icon name="check" size={13} color="currentColor" /> : null}
                </span>
              )}

              {/* Thumbnail */}
              <div className={mobileMode ? 'mobile-page-preview' : undefined} style={{
                position: 'relative',
                width: '100%',
                paddingBottom: `${displayRatio}%`,
                background: '#ffffff',
                borderRadius: '2px',
                overflow: 'hidden'
              }}>
                {thumbnailSrc ? (
                  <img
                    src={thumbnailSrc}
                    alt={`Page ${pageNumber}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      display: 'block',
                      transform: thumbnailTransform,
                      transformOrigin: 'center center'
                    }}
                  />
                ) : (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: 'var(--text-3)',
                    fontSize: '10px'
                  }}>
                    Loading...
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {/* UX (KAL-73): two distinct empty-looking states, deliberately kept apart.
            Before the document reports a page count the panel is still LOADING —
            it shows the shared 18px ring with "Loading pages…" so a slow PDF never
            looks like an empty or broken panel. Only once the page count exists
            does a zero-length list mean the active space genuinely filters
            everything out, which is the real empty state below. */}
        {!numPages ? (
          <div style={{
            padding: '32px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--text-3)',
            fontSize: '12px'
          }}>
            <Spinner size={18} />
            Loading pages…
          </div>
        ) : allowedPages.length === 0 && (
          <div style={{
            padding: '32px 16px',
            textAlign: 'center',
            color: 'var(--text-3)',
            fontSize: '12px'
          }}>
            No pages are visible in this space. Add pages to the active space to see them here.
          </div>
        )}
      </div>

      {mobileMode && (
        <div className="mobile-pages-actions" role="toolbar" aria-label="Page actions">
          <button
            type="button"
            onClick={() => onInsertBlankPage?.(pageNum)}
            disabled={!onInsertBlankPage}
          >
            <Icon name="plus" size={16} color="currentColor" />
            <span>Add</span>
          </button>
          <i />
          <button
            type="button"
            onClick={() => handlePaste(pageNum)}
            disabled={!clipboardPage}
          >
            <Icon name="copy" size={15} color="currentColor" />
            <span>Paste</span>
          </button>
          <i />
          <button
            type="button"
            aria-pressed={mobileSelectMode}
            onClick={() => {
              setMobileSelectMode((active) => {
                if (active) setMobileSelectedPages(new Set());
                return !active;
              });
            }}
          >
            <Icon name="check" size={16} color="currentColor" />
            <span>{mobileSelectMode ? 'Done' : 'Select'}</span>
          </button>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          {/* UX: mobile parity (Phase D) — demo's near-invisible dismiss layer
              (rgba(0,0,0,0.01); never dims the page — styles.ts:856-860). Tap
              off the menu to close. Desktop uses the existing outside-click
              dismiss (no scrim). */}
          {mobileMode && (
            <div
              onPointerDown={() => setContextMenu(null)}
              style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.01)' }}
            />
          )}
        <div
          ref={contextMenuRef}
          style={mobileMode ? {
            // UX: demo page context-menu chrome (188px, radius 9, #181B20 /
            // #3C424D, 6px pad, no shadow) — styles.ts:861-871, App.tsx:817.
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: '9px',
            padding: '6px',
            zIndex: 10000,
            width: '188px',
            maxHeight: 'calc(100dvh - 16px)',
            overflowY: 'auto',
            fontFamily: FONT_FAMILY
          } : {
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--surface-3)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '4px',
            zIndex: 10000,
            minWidth: '180px',
            maxHeight: 'calc(100dvh - 16px)',
            overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            fontFamily: FONT_FAMILY
          }}
        >
          {mobileMode && (
            <>
              {/* UX: demo menus lead with a muted title row + divider
                  (FloatingContextMenu, styles.ts:872-889). */}
              <div style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 800, padding: '4px 6px' }}>{`Page ${contextMenu.pageNumber}`}</div>
              <div style={{ height: 1, margin: '3px 0', background: 'var(--surface-3)' }} />
              <button
                type="button"
                disabled={allowedPages.indexOf(contextMenu.pageNumber) <= 0}
                onClick={() => movePageByOffset(contextMenu.pageNumber, -1)}
                style={{ width: '100%', padding: '8px 12px', background: 'transparent', border: 0, borderRadius: 4, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', opacity: allowedPages.indexOf(contextMenu.pageNumber) <= 0 ? 0.4 : 1 }}
              >
                <Icon name="chevronUp" size={14} color="currentColor" />
                Move up
              </button>
              <button
                type="button"
                disabled={allowedPages.indexOf(contextMenu.pageNumber) >= allowedPages.length - 1}
                onClick={() => movePageByOffset(contextMenu.pageNumber, 1)}
                style={{ width: '100%', padding: '8px 12px', background: 'transparent', border: 0, borderRadius: 4, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', opacity: allowedPages.indexOf(contextMenu.pageNumber) >= allowedPages.length - 1 ? 0.4 : 1 }}
              >
                <Icon name="chevronDown" size={14} color="currentColor" />
                Move down
              </button>
              <div style={{ height: 1, margin: '3px 5px', background: 'var(--surface-3)' }} />
            </>
          )}
          <button
            onClick={() => handleCut(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: 'var(--text-2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="scissors" size={14} color="var(--text-3)" />
            Cut
          </button>
          <button
            onClick={() => handleCopy(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: 'var(--text-2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="copy" size={14} color="var(--text-3)" />
            Copy
          </button>
          <button
            onClick={() => handlePaste(contextMenu.pageNumber)}
            disabled={!clipboardPage}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: clipboardPage ? 'pointer' : 'not-allowed',
              color: clipboardPage ? 'var(--text-2)' : 'var(--text-disabled)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              opacity: clipboardPage ? 1 : 0.5
            }}
            onMouseEnter={(e) => {
              if (clipboardPage) {
                e.currentTarget.style.background = 'var(--hover)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Icon name="paste" size={14} color={clipboardPage ? "var(--text-3)" : "var(--text-disabled)"} />
            Paste
          </button>
          <button
            onClick={() => handleDuplicate(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: 'var(--text-2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="duplicate" size={14} color="var(--text-3)" />
            Duplicate
          </button>
          <div style={{
            height: '1px',
            background: 'var(--surface-3)',
            margin: '4px 0'
          }} />
          <button
            onClick={() => handleRotate(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: 'var(--text-2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="rotate" size={14} color="var(--text-3)" />
            Rotate
          </button>
          <button
            onClick={() => handleMirrorHorizontal(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: 'var(--text-2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="flipHorizontal" size={14} color="var(--text-3)" />
            Mirror horizontally
          </button>
          <button
            onClick={() => handleMirrorVertical(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: 'var(--text-2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="flipVertical" size={14} color="var(--text-3)" />
            Mirror vertically
          </button>
          <button
            onClick={() => handleReset(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: 'var(--text-2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="reset" size={14} color="var(--text-3)" />
            Reset
          </button>
          <div style={{
            height: '1px',
            background: 'var(--surface-3)',
            margin: '4px 0'
          }} />
          <button
            onClick={() => handleDelete(contextMenu.pageNumber)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              color: mobileMode ? 'var(--danger-text)' : 'var(--danger-text)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = mobileMode ? 'var(--surface-2)' : 'var(--surface-3)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Icon name="trash" size={14} color={mobileMode ? 'var(--danger)' : 'var(--danger)'} />
            Delete
          </button>
        </div>
        </>
      )}
    </div>
  );
};

export default PagesPanel;
