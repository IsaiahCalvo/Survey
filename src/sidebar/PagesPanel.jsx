/**
 * PagesPanel.jsx — sidebar thumbnail strip for page navigation and page operations.
 *
 * Default export PagesPanel renders lazy (IntersectionObserver) page thumbnails
 * rendered via pdf.js (fast low-res then crisp upgrade through a LIFO queue), plus
 * click-to-navigate, drag reorder (onReorderPages), and a right-click context menu
 * for cut/copy/paste/duplicate/rotate/mirror/reset/delete. Honors pageTransformations.
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import Spinner from '../components/Spinner';
import { useTooltip } from '../components/Tooltip';
import { watchLightPopover } from '../components/dismissRules.js';
import { placeAnchoredMenu } from '../utils/floatingUiGeometry.js';
import { getPageViewBase, pageViewKey, pageViewUprightKey } from '../utils/pageViewDocument.js';
import {
  getCachedPageThumbnails,
  rememberPageThumbnails,
  encodeCanvasToDataUrl,
  predecodeImage,
  takePriorityJob,
} from './pagesPanelThumbnailCache.js';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const FAST_THUMBNAIL_SCALE = 0.15; // Ultra-fast, low-res (was 0.2)
const CRISP_THUMBNAIL_SCALE = 0.5; // Slower, high-res
const THUMBNAIL_DPR_CAP = 1;
// The crisp pass draws at the card's on-screen width x devicePixelRatio (up
// to 3), never larger than the old fixed 0.5 x 2 = 1.0 page scale. A phone
// card is ~155px wide, so a letter page is ~465px, not 612px: ~40% fewer
// pixels to draw and encode for the same sharpness on screen.
const CRISP_DPR_CAP = 3;
const CRISP_MAX_PIXEL_SCALE = 1;
const THUMBNAIL_JPEG_QUALITY = 0.72;
const EAGER_PRELOAD_COUNT = 6;
// pdf.js paints a page on the main thread in ~15ms slices, one slice per task
// per frame: four at once could take a whole 60ms frame (2026-10-01 profile).
const CONCURRENCY_LIMIT = 2;
// While the list is moving, only the cheap low-res pass runs; crisp redraws
// wait until it has been still this long.
const SCROLL_SETTLE_MS = 180;
// Once the list is still, low-res images for pages just off screen (this many
// cards either side) are drawn one at a time, so scrolling to them shows a
// picture instead of an empty box.
const IDLE_PREFILL_DELAY_MS = 400;
const IDLE_PREFILL_SPAN = 16;
// The page menu's layer: above the phone dock (6750), sheets and popovers
// (up to 7400), below modals (10000+), the tooltip and toasts.
const PAGE_MENU_Z = 9000;


// Thumbnails drawn for `previousDoc`, re-addressed to the pages of `nextDoc`
// (a page view over the same document). null when the documents differ.
function remapThumbnailsToView(previousDoc, nextDoc, previousThumbs) {
  if (!previousDoc || !nextDoc || previousDoc === nextDoc) return null;
  if (getPageViewBase(previousDoc) !== getPageViewBase(nextDoc)) return null;
  const byKey = new Map();
  const byUpright = new Map();
  for (let page = 1; page <= (previousDoc.numPages || 0); page += 1) {
    const thumb = previousThumbs?.[page];
    if (!thumb || thumb.quality === 'stale') continue;
    byKey.set(pageViewKey(previousDoc, page - 1), thumb);
    const upright = pageViewUprightKey(previousDoc, page - 1);
    byUpright.set(upright ? upright.key : pageViewKey(previousDoc, page - 1), { thumb, rotation: upright?.rotation || 0 });
  }
  const thumbnails = {};
  const ratios = {};
  for (let page = 1; page <= (nextDoc.numPages || 0); page += 1) {
    const exact = byKey.get(pageViewKey(nextDoc, page - 1));
    if (exact) {
      thumbnails[page] = exact;
      if (exact.width && exact.height) ratios[page] = (exact.height / exact.width) * 100;
      continue;
    }
    const upright = pageViewUprightKey(nextDoc, page - 1);
    const source = byUpright.get(upright ? upright.key : pageViewKey(nextDoc, page - 1));
    if (!source) continue;
    const turn = (((upright?.rotation || 0) - source.rotation) % 360 + 360) % 360;
    thumbnails[page] = { ...source.thumb, quality: 'stale', cssRotate: turn };
    if (source.thumb.width && source.thumb.height) {
      ratios[page] = turn % 180 !== 0
        ? (source.thumb.width / source.thumb.height) * 100
        : (source.thumb.height / source.thumb.width) * 100;
    }
  }
  return { thumbnails, ratios };
}

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
  // A reopened panel starts with everything it drew for this document
  // (pagesPanelThumbnailCache.js): a drawn thumbnail never goes blank again.
  const [thumbnails, setThumbnails] = useState(() => getCachedPageThumbnails(pdfDoc)?.thumbnails || {});
  const [pageAspectRatios, setPageAspectRatios] = useState(() => getCachedPageThumbnails(pdfDoc)?.ratios || {});
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
  const thumbnailsRef = useRef(thumbnails);
  const lastScrollAtRef = useRef(0);
  const settleTimerRef = useRef(null);
  const pendingResultsRef = useRef(new Map());
  const flushFrameRef = useRef(0);
  const idleFillTimerRef = useRef(null);
  const idleFillRef = useRef(() => {});

  // Queue State
  const queueRef = useRef({
    fast: [], // LIFO stack for fast thumbs
    crisp: [] // LIFO stack for crisp thumbs
  });
  const activeTasksRef = useRef(new Map()); // Map<pageNumber, { cancel: () => void, type: 'fast'|'crisp' }>
  const runningWorkersRef = useRef(0);
  const pendingRequestsRef = useRef(new Set()); // Track pages currently in queue or running

  // thumbnailsRef is written wherever thumbnails change (a finished image in
  // applyThumbnailResult, a document change below) and is never copied back
  // from state: a render that commits after a batched flush but before that
  // flush's own render would otherwise drop the newest images from the ref,
  // and their pages were queued and drawn a second time.

  // Write-through: whatever is on screen for this document survives the
  // panel closing (the phone sheet unmounts it).
  useEffect(() => {
    rememberPageThumbnails(pdfDoc, thumbnails, pageAspectRatios);
  }, [pdfDoc, thumbnails, pageAspectRatios]);

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
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      if (idleFillTimerRef.current) clearTimeout(idleFillTimerRef.current);
      if (flushFrameRef.current) cancelAnimationFrame(flushFrameRef.current);
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

  // A card is keyed by what it shows (pageViewDocument), not its number, so
  // a moved page keeps its DOM node and already-decoded image.
  const cardKeys = useMemo(() => {
    const keys = {};
    const seen = new Map();
    allowedPages.forEach((pageNumber) => {
      const key = pageViewKey(pdfDoc, pageNumber - 1);
      const count = seen.get(key) || 0;
      seen.set(key, count + 1);
      keys[pageNumber] = `${key}#${count}`;
    });
    return keys;
  }, [allowedPages, pdfDoc]);

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

  // Owner 2026-10-01 (instant page operations): a page operation swaps in a
  // page view over the same loaded document (utils/pageViewDocument.js). Keep
  // every thumbnail already drawn, moved to its page's new slot, in the SAME
  // render that shows the new page order (derived state, no blank frame); a
  // just-rotated page shows its old image turned until the new one is drawn.
  const [thumbnailDoc, setThumbnailDoc] = useState(pdfDoc);
  if (thumbnailDoc !== pdfDoc) {
    setThumbnailDoc(pdfDoc);
    const remapped = remapThumbnailsToView(thumbnailDoc, pdfDoc, thumbnailsRef.current);
    if (remapped) {
      thumbnailsRef.current = remapped.thumbnails;
      setThumbnails(remapped.thumbnails);
      setPageAspectRatios(remapped.ratios);
    } else {
      // A different document: start from what was drawn for IT (if it was
      // open before), never from the previous document's images.
      const cached = getCachedPageThumbnails(pdfDoc);
      thumbnailsRef.current = cached?.thumbnails || {};
      setThumbnails(cached?.thumbnails || {});
      setPageAspectRatios(cached?.ratios || {});
    }
    pendingResultsRef.current.clear();
  }
  // The images themselves follow the document in the render above (derived
  // state); this only drops the previous document's queued work.
  useEffect(() => {
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
      // Applied with the image itself in the batched flush below.
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

    // Several thumbnails finishing close together land in ONE render of the
    // list (one per frame at most), not one full-list render each.
    pendingResultsRef.current.set(pageNumber, normalized);
    thumbnailsRef.current = { ...thumbnailsRef.current, [pageNumber]: normalized };
    if (!flushFrameRef.current) {
      flushFrameRef.current = requestAnimationFrame(() => {
        flushFrameRef.current = 0;
        if (!isMountedRef.current || pendingResultsRef.current.size === 0) return;
        const batch = Object.fromEntries(pendingResultsRef.current);
        pendingResultsRef.current.clear();
        setThumbnails((prev) => ({ ...prev, ...batch }));
        setPageAspectRatios((prev) => {
          let next = prev;
          Object.entries(batch).forEach(([page, thumb]) => {
            const w = thumb.width || thumb.containerWidth;
            const h = thumb.height || thumb.containerHeight;
            if (!w || !h) return;
            const ratioValue = (h / w) * 100;
            if (prev[page] && Math.abs(prev[page] - ratioValue) < 0.5) return;
            if (next === prev) next = { ...prev };
            next[page] = ratioValue;
          });
          return next;
        });
      });
    }
  }, []);

  const renderPdfJsThumbnail = useCallback(async (pageNumber, quality = 'fast', onCancel) => {
    if (!pdfDoc) return null;
    const page = await pdfDoc.getPage(pageNumber);

    const dprCap = quality === 'crisp' ? CRISP_DPR_CAP : THUMBNAIL_DPR_CAP;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    let scale = quality === 'crisp' ? CRISP_THUMBNAIL_SCALE : FAST_THUMBNAIL_SCALE;
    if (quality === 'crisp') {
      const cardWidth = thumbnailRefs.current[pageNumber]?.clientWidth || 0;
      const base = page.getViewport({ scale: 1 });
      const sideways = getRotationDelta(pageNumber) % 180 !== 0;
      const pageWidth = sideways ? base.height : base.width;
      if (cardWidth > 0 && pageWidth > 0) {
        scale = Math.min(cardWidth / pageWidth, CRISP_MAX_PIXEL_SCALE / dpr);
      }
    }

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;

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

    const src = await encodeCanvasToDataUrl(canvas, 'image/jpeg', THUMBNAIL_JPEG_QUALITY);
    // Free the bitmap now: iOS caps total canvas memory and collects
    // detached canvases late.
    canvas.width = 0;
    canvas.height = 0;
    if (!src) return null;
    return {
      src,
      width: viewport.width,
      height: viewport.height,
      source: 'pdfjs',
      quality
    };
  }, [pdfDoc, getRotationDelta]);

  // The page the viewer has already drawn is the quickest first image there
  // is: one downscale copy of its finished raster (no pdf.js work, a few ms),
  // the same idea as pdf.js's own viewer thumbnails. Only a visible viewer
  // canvas of the same shape counts (inactive tabs are display:none). It stays
  // quality 'fast', so the pdf.js crisp pass still replaces it once the list
  // is still (that pass also draws PDF-native annotations, which the viewer
  // raster leaves to the app's own layers).
  const seedThumbnailFromViewer = useCallback(async (pageNumber) => {
    if (!pdfDoc || typeof document === 'undefined') return null;
    const source = [...document.querySelectorAll(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"] > canvas`)]
      .find((c) => c.width > 0 && c.height > 0 && !(c.width === 300 && c.height === 150) && c.getClientRects().length > 0);
    if (!source) return null;
    const page = await pdfDoc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const pageRatio = base.width / base.height;
    if (Math.abs((source.width / source.height) - pageRatio) > pageRatio * 0.02) return null;
    // One CSS pixel per card pixel: a quick, small first image (encoded in a
    // millisecond or two); the crisp pass sharpens it.
    const dpr = 1;
    const cardWidth = thumbnailRefs.current[pageNumber]?.clientWidth || 160;
    const width = Math.max(1, Math.min(source.width, Math.round(cardWidth * dpr)));
    const height = Math.max(1, Math.round(width / pageRatio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    const src = await encodeCanvasToDataUrl(canvas, 'image/jpeg', THUMBNAIL_JPEG_QUALITY);
    canvas.width = 0;
    canvas.height = 0;
    if (!src) return null;
    return { src, width: base.width, height: base.height, source: 'viewer', quality: 'fast' };
  }, [pdfDoc]);

  const isPageOnScreen = useCallback((pageNumber) => {
    const container = containerRef.current;
    const card = thumbnailRefs.current[pageNumber];
    if (!container || !card) return false;
    const box = container.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    return rect.bottom > box.top && rect.top < box.bottom;
  }, []);

  const processQueue = useCallback(async () => {
    if (runningWorkersRef.current >= CONCURRENCY_LIMIT) return;

    // LIFO, on-screen pages first. FAST (first image) always before CRISP.
    let job = takePriorityJob(queueRef.current.fast, isPageOnScreen);
    let type = 'fast';

    if (!job && queueRef.current.crisp.length > 0) {
      // Crisp redraws wait for the list to stop moving, so a fling only
      // pays for the cheap low-res pass.
      const sinceScroll = Date.now() - lastScrollAtRef.current;
      if (sinceScroll < SCROLL_SETTLE_MS) {
        if (!settleTimerRef.current) {
          settleTimerRef.current = setTimeout(() => {
            settleTimerRef.current = null;
            if (!isMountedRef.current) return;
            for (let i = 0; i < CONCURRENCY_LIMIT; i += 1) processQueue();
          }, SCROLL_SETTLE_MS - sinceScroll + 10);
        }
        return;
      }
      job = takePriorityJob(queueRef.current.crisp, isPageOnScreen);
      type = 'crisp';
    }

    if (!job) {
      if (runningWorkersRef.current === 0) idleFillRef.current();
      return; // No jobs
    }

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

      if (type === 'fast') {
        thumbnailResult = await seedThumbnailFromViewer(pageNumber).catch(() => null);
      }

      if (!thumbnailResult && pdfDoc) {
        thumbnailResult = await renderPdfJsThumbnail(pageNumber, type, (cancelFn) => {
          cancelRender = cancelFn;
        });
      }

      if (isMountedRef.current && thumbnailResult) {
        let normalized = normalizeThumbnailResult(thumbnailResult);
        // Decoded before it is shown: the swap never paints an empty box.
        if (normalized?.src) await predecodeImage(normalized.src);

        applyThumbnailResult(pageNumber, normalized);

        // Schedule upgrade if fast (an idle prefill of an off-screen page
        // stops at low-res; it is upgraded when it scrolls into view).
        if (type === 'fast' && !job.prefill) {
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
  }, [pdfDoc, applyThumbnailResult, renderPdfJsThumbnail, normalizeThumbnailResult, isPageOnScreen, seedThumbnailFromViewer]);

  const scheduleThumbnail = useCallback((pageNumber, priority = 'fast') => {
    if (!Number.isFinite(pageNumber) || pageNumber < 1) return;

    // Check if already has a better or equal thumbnail
    const existing = thumbnailsRef.current[pageNumber];
    if (existing?.quality === 'crisp') return;
    // 'stale' (a moved/rotated stand-in) is redrawn like a missing thumbnail.
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

  // Idle prefill: while the list is still and nothing else is queued, draw the
  // low-res image of the nearest undrawn page within IDLE_PREFILL_SPAN cards
  // of the screen, one at a time. Any scroll pushes it back.
  idleFillRef.current = () => {
    if (idleFillTimerRef.current || !isMountedRef.current) return;
    idleFillTimerRef.current = setTimeout(() => {
      idleFillTimerRef.current = null;
      if (!isMountedRef.current) return;
      if (runningWorkersRef.current > 0 || queueRef.current.fast.length > 0 || queueRef.current.crisp.length > 0) return;
      if (Date.now() - lastScrollAtRef.current < IDLE_PREFILL_DELAY_MS) { idleFillRef.current(); return; }
      const container = containerRef.current;
      if (!container || container.getClientRects().length === 0) return;
      let first = -1;
      let last = -1;
      allowedPages.forEach((pageNumber, index) => {
        if (!isPageOnScreen(pageNumber)) return;
        if (first === -1) first = index;
        last = index;
      });
      if (first === -1) return;
      let next = null;
      for (let step = 1; step <= IDLE_PREFILL_SPAN && next == null; step += 1) {
        for (const index of [last + step, first - step]) {
          const pageNumber = allowedPages[index];
          if (pageNumber && !thumbnailsRef.current[pageNumber] && !activeTasksRef.current.has(pageNumber)) {
            next = pageNumber;
            break;
          }
        }
      }
      if (next == null) return;
      queueRef.current.fast.unshift({ pageNumber: next, prefill: true });
      processQueue();
    }, IDLE_PREFILL_DELAY_MS);
  };

  // Only "do we know any page shapes yet" gates the observer. It used to
  // depend on the whole ratio map, so every new thumbnail tore the observer
  // down and rebuilt it (and re-queued the first pages) mid-scroll.
  const hasAspectRatios = Object.keys(pageAspectRatios).length > 0;

  // Set up Intersection Observer for lazy loading thumbnails
  useEffect(() => {
    const hasProvider = typeof getThumbnail === 'function';
    if (!hasProvider && !pdfDoc) return;
    if (!hasProvider && !hasAspectRatios) return;
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
  }, [allowedPages, generateThumbnail, cancelThumbnail, getThumbnail, hasAspectRatios, pdfDoc]);

  // Remember when the list last moved (crisp redraws wait for it to settle).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onScroll = () => { lastScrollAtRef.current = Date.now(); };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

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

  // Page right-click menu: a light popover under the shared dismiss rules
  // (src/components/dismissRules.js, owner 2026-09-23) — an outside press
  // closes it and still does its job (R1), a press on the bare page only
  // closes it (R2), Escape closes it (R5).
  useEffect(() => {
    if (!contextMenu) return undefined;
    return watchLightPopover({
      contains: (target) => !contextMenuRef.current || contextMenuRef.current.contains(target),
      close: () => setContextMenu(null),
    });
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
    // The press point only; the menu is placed once it has been measured
    // (placeContextMenu below).
    setContextMenu({ pageNumber, x: e.clientX, y: e.clientY });
  }, []);

  // Owner 2026-10-01 (iPhone): the page menu was drawn inside the Pages sheet,
  // so the dock painted over its last rows (Delete sat under the dock) and it
  // opened on top of the very thumbnail it acts on. It now renders in a
  // portal on <body> above the dock and sheets (below modals), and is placed
  // from its measured size before paint:
  //   - phone: beside the page's "..." button, inside the band between the
  //     top bar and the dock, covering as little of that thumbnail as the
  //     width allows (placeAnchoredMenu), scrolling if taller than the band;
  //   - desktop: at the right-click point, flipped to stay in the window.
  const placeContextMenu = useCallback(() => {
    const el = contextMenuRef.current;
    if (!el || !contextMenu || typeof window === 'undefined') return;
    el.style.maxHeight = 'none';
    const rect = el.getBoundingClientRect();
    const vv = window.visualViewport;
    let top = 0;
    let bottom = vv ? Math.min(window.innerHeight, vv.offsetTop + vv.height) : window.innerHeight;
    if (mobileMode) {
      const header = document.querySelector('[data-mobile-pdf-header]')?.getBoundingClientRect();
      if (header && header.height > 0) top = Math.max(top, header.bottom);
      const dock = document.querySelector('.mobile-pdf-dock')?.getBoundingClientRect();
      if (dock && dock.height > 0 && dock.top < bottom) bottom = dock.top;
    }
    const card = mobileMode ? thumbnailRefs.current[contextMenu.pageNumber] : null;
    const anchorEl = card?.querySelector('[data-page-menu-anchor]');
    const position = placeAnchoredMenu({
      anchor: anchorEl ? anchorEl.getBoundingClientRect() : { left: contextMenu.x, top: contextMenu.y },
      avoid: anchorEl ? card.getBoundingClientRect() : null,
      width: rect.width,
      height: rect.height,
      bounds: { left: 0, top, right: window.innerWidth, bottom },
    });
    el.style.left = `${position.left}px`;
    el.style.top = `${position.top}px`;
    el.style.maxHeight = position.maxHeight == null ? '' : `${position.maxHeight}px`;
  }, [contextMenu, mobileMode]);

  useLayoutEffect(() => {
    if (!contextMenu) return undefined;
    placeContextMenu();
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    window.addEventListener('resize', placeContextMenu);
    vv?.addEventListener('resize', placeContextMenu);
    return () => {
      window.removeEventListener('resize', placeContextMenu);
      vv?.removeEventListener('resize', placeContextMenu);
    };
  }, [contextMenu, placeContextMenu]);

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
    // The browser draws the dragged picture from the card as it looks right
    // now, so for that one moment it wears the app's one picked-up look
    // (states.css [data-drag-lifted], owner 2026-10-01); a frame later the card
    // left behind goes back to its own (dimmed) look.
    const card = e.currentTarget;
    if (card?.setAttribute) {
      card.setAttribute('data-drag-lifted', '');
      requestAnimationFrame(() => card.removeAttribute('data-drag-lifted'));
    }
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
          const thumbnailTurn = (rotationDelta + (Number(thumbnailMeta?.cssRotate) || 0)) % 360;
          if (thumbnailTurn) {
            transforms.push(`rotate(${thumbnailTurn}deg)`);
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
              key={cardKeys[pageNumber]}
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
                // The page a drag will land on shows the app's one drag slot
                // (a quiet dashed outline, no gold - owner 2026-10-01).
                background: dragOverPage === pageNumber ? 'var(--drag-slot-bg)' : (isSelected ? 'var(--surface-3)' : 'transparent'),
                border: dragOverPage === pageNumber ? 'var(--drag-slot-border)' : (isSelected ? '1px solid var(--accent)' : '1px solid transparent'),
                borderRadius: '4px',
                cursor: mobileMode ? 'pointer' : (draggedPage === pageNumber ? 'grabbing' : 'grab'),
                touchAction: mobileMode ? 'pan-y' : undefined,
                // The card left behind while its page is carried.
                opacity: draggedPage === pageNumber ? 0.45 : 1,
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
                  <Icon name={clipboardType === 'cut' ? 'scissors' : 'copy'} size={12} color="var(--accent)" />
                </div>
              )}

              {mobileMode && mobileSelectMode && (
                <span className={`mobile-page-select-indicator${isMobileSelected ? ' is-selected' : ''}`} aria-hidden="true">
                  {isMobileSelected ? <Icon name="check" size={13} color="currentColor" /> : null}
                </span>
              )}

              {/* Thumbnail */}
              <div className={mobileMode ? 'mobile-page-preview' : undefined} data-drag-keep-fill style={{
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
                ) : null}
                {/* Owner 2026-10-01: no "Loading..." text. A page not drawn
                    yet is the plain paper box above, in the page's own shape;
                    its low-res image lands in it a moment later. */}
                {mobileMode && (
                  <button
                    type="button"
                    aria-label={`Page ${pageNumber} actions`}
                    {...tip(`Page ${pageNumber} actions`, 'below')}
                    onClick={(event) => handleContextMenu(event, pageNumber)}
                    style={{
                      /* Owner 2026-10-01 (iPhone): the old control was a see-through
                         bordered square straddling the thumbnail's corner, so the card
                         border, the paper edge, its own border and the page lines all
                         stacked up in one corner ("a layered bun"). Now: a 44px
                         invisible touch area holding ONE solid 28px circle. It lives
                         inside the paper box, so the circle always sits on the page,
                         8px in from its corner, even on a landscape page whose paper
                         is shorter than the card. Styled like the page-number badge
                         (top right), with the level ⋯ glyph. */
                      position: 'absolute',
                      right: 0,
                      bottom: 0,
                      width: 44,
                      height: 44,
                      padding: 0,
                      display: 'grid',
                      placeItems: 'center',
                      color: 'var(--text-1)',
                      background: 'transparent',
                      border: 0,
                      zIndex: 2,
                    }}
                  >
                    <span
                      data-page-menu-anchor="true"
                      aria-hidden="true"
                      style={{
                        width: 28,
                        height: 28,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: '50%',
                        background: 'var(--surface-3)',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
                      }}
                    >
                      <Icon name="moreHorizontal" size={18} color="currentColor" />
                    </span>
                  </button>
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
            <Icon name="paste" size={15} color="currentColor" />
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

      {/* Context Menu — portalled to <body> (see placeContextMenu). */}
      {contextMenu && typeof document !== 'undefined' && createPortal(
        <>
          {/* UX: mobile parity (Phase D) — demo's near-invisible dismiss layer
              (rgba(0,0,0,0.01); never dims the page — styles.ts:856-860). Tap
              off the menu to close. Desktop uses the existing outside-click
              dismiss (no scrim). */}
          {mobileMode && (
            <div
              onPointerDown={() => setContextMenu(null)}
              style={{ position: 'fixed', inset: 0, zIndex: PAGE_MENU_Z - 1, background: 'rgba(0,0,0,0.01)' }}
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
            zIndex: PAGE_MENU_Z,
            width: '188px',
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
            zIndex: PAGE_MENU_Z,
            minWidth: '180px',
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
        </>,
        document.body,
      )}
    </div>
  );
};

export default PagesPanel;
