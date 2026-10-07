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
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CALM_LIST_AUTO_SCROLL } from '../reorder/dragAutoScroll.js';
import { pageHasTransform } from '../utils/disabledActions.js';
import Icon from '../Icons';
import Spinner from '../components/Spinner';
import { useTooltip } from '../components/Tooltip';
import { watchLightPopover } from '../components/dismissRules.js';
import { placeAnchoredMenu } from '../utils/floatingUiGeometry.js';
import { PageMenuList } from './PageActionsMenu.jsx';
import { availableActions, buildPageMenuItems, runPageMenuAction } from './pageMenuItems.js';
import { copyPagesAfter, duplicatePages, movePagesNextTo, movePagesToIndex } from '../utils/pageSelectionOperations.js';
import { thumbnailBoxStyle } from './pageThumbnailBox.js';
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
// Phone: how long a still finger on a card takes to lift the page for a drag
// (a swipe that starts sooner scrolls the list). Let go without moving and
// the page menu opens instead (the long-press).
const PAGE_DRAG_TOUCH_DELAY_MS = 300;
// The lifted page rides above the sheets (7400) and below the page menu.
const PAGE_DRAG_OVERLAY_Z = 8500;
const PAGE_SLIDE = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
// The slots are measured all through a drag, not once at pick-up: pages
// further down draw their pictures (and take their real shape) while the list
// scrolls under a carried page, and a slot measured before that would send
// the drop to the wrong place ("dragging during a thumbnail load").
const PAGE_DRAG_MEASURING = { droppable: { strategy: MeasuringStrategy.WhileDragging, frequency: 100 } };

// Desktop: the strip is one column, so a carried page only moves up / down.
const restrictToVerticalAxis = ({ transform }) => ({ ...transform, x: 0 });

function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  ));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setReduced(list.matches);
    list.addEventListener?.('change', onChange);
    return () => list.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

// One card of the strip as a dnd-kit sortable item; the card itself is drawn
// by the render prop (the whole card is the drag target, no handle).
function SortablePageCard({ id, reducedMotion, children }) {
  const sortable = useSortable({
    id,
    // Not "sortable": the phone sheet's swipe-to-close treats a touch on a
    // [aria-roledescription="sortable"] as someone else's gesture, and the
    // sheet must still close from a swipe on the cards (it stands aside once
    // a drag is live - useMobileSheetMotion).
    attributes: { roleDescription: 'page' },
    transition: reducedMotion ? null : PAGE_SLIDE,
    // A drop lands at once (owner 2026-10-07: "super smooth and instant"):
    // the cards are already in their new order in the drop's own render, so
    // no card glides in from where it used to be.
    animateLayoutChanges: () => false,
  });
  return children(sortable);
}

// The page menu's rows and list: sidebar/PageActionsMenu.jsx and
// sidebar/pageMenuItems.js (one list, shared with the viewer's page menu).

// The drawn width of a card's thumbnail (its page box, not the whole card):
// thumbnails are drawn at the size they are shown.
const thumbnailBoxWidth = (card) => (
  card?.querySelector?.('[data-page-preview]')?.clientWidth || card?.clientWidth || 0
);

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
  // a moved page keeps its DOM node and already-decoded image. Its turn is
  // left out: a rotated page is still the same card (and stays selected).
  const cardKeys = useMemo(() => {
    const keys = {};
    const seen = new Map();
    allowedPages.forEach((pageNumber) => {
      const upright = pageViewUprightKey(pdfDoc, pageNumber - 1);
      const key = upright ? upright.key : pageViewKey(pdfDoc, pageNumber - 1);
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
      const cardWidth = thumbnailBoxWidth(thumbnailRefs.current[pageNumber]);
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
    const cardWidth = thumbnailBoxWidth(thumbnailRefs.current[pageNumber]) || 160;
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

  // The current page's card scrolls into view when it is off screen (the
  // viewer moved to another page). A card already in view stays put, and a
  // page change that follows a drop (the viewer's current page moved with
  // the pages) never scrolls the strip away from where the pages were put.
  const lastDropAtRef = useRef(0);
  useEffect(() => {
    const card = selectedPage ? thumbnailRefs.current[selectedPage] : null;
    const container = containerRef.current;
    if (!card || !container) return;
    if (Date.now() - lastDropAtRef.current < 2500) return;
    const box = container.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    if (rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedPage]);

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
    // The phone bar's More button passes its own box (anchorRect).
    const card = !contextMenu.anchorRect && (mobileMode || contextMenu.fromButton) ? thumbnailRefs.current[contextMenu.pageNumber] : null;
    const anchorEl = card?.querySelector('[data-page-menu-anchor]');
    const position = placeAnchoredMenu({
      anchor: anchorEl ? anchorEl.getBoundingClientRect() : (contextMenu.anchorRect || { left: contextMenu.x, top: contextMenu.y }),
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

  // A click that ends a drag (or a phone press that opened the menu) does
  // nothing else.
  const suppressClickRef = useRef(false);

  const pageByCardKey = useMemo(() => {
    const map = new Map();
    allowedPages.forEach((pageNumber) => map.set(cardKeys[pageNumber], pageNumber));
    return map;
  }, [allowedPages, cardKeys]);

  // ---- A drop lands in the very next frame (owner 2026-10-07: "there's some
  // lag when I let go ... super smooth and instant"). The strip shows the new
  // order at once (dropOrder, this panel only), and the page change itself -
  // the viewer, the marks, the background save - runs right after that frame
  // is painted. dropOrder belongs to the document it was made on: the change
  // swaps in a new page view, and from then on the real order is shown.
  const [dropOrder, setDropOrder] = useState(null);
  // The panel hears of the new page view a render or two after the viewer
  // (through the app shell), so the drop order stays until then; a different
  // document (the change landed, or failed and was rolled back) ends it.
  if (dropOrder && dropOrder.doc !== pdfDoc) setDropOrder(null);
  const visiblePages = dropOrder && dropOrder.doc === pdfDoc && dropOrder.pages.length === allowedPages.length
    ? dropOrder.pages
    : allowedPages;
  const pendingDropRef = useRef(null);
  const flushPendingDrop = useCallback(() => {
    const run = pendingDropRef.current;
    if (run) run();
  }, []);
  useEffect(() => flushPendingDrop, [flushPendingDrop]);

  // ---- Selection (owner 2026-10-07: "Pages should also have a select feature
  // so that you can copy multiple, delete multiple, rearrange multiple, and
  // drag multiple"), like Finder / Drawboard:
  //   - desktop: click = that page only (and go to it); Ctrl/Cmd+click adds or
  //     removes a page; Shift+click selects the run from the last clicked
  //     page; Ctrl/Cmd+A (after a click in the strip) selects every page;
  //     Escape goes back to the current page;
  //   - phone: "Select" in the Pages sheet; a tap ticks / unticks a page and
  //     the bar below acts on the ticked pages.
  // Kept by card key (what a card shows), so it follows its pages through a
  // move or a turn. With one page or none picked it follows the current page.
  const [selection, setSelection] = useState({ keys: [], anchor: null });
  const selectMode = mobileMode && mobileSelectMode;
  // Pages an action picked for the new selection (the copies of a
  // duplicate, a pasted block), applied once its new page order is shown.
  const pendingSelectionRef = useRef(null);
  if (pendingSelectionRef.current && pendingSelectionRef.current.doc !== pdfDoc) {
    const { pages } = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    const keys = (pages || []).map((pageNumber) => cardKeys[pageNumber]).filter(Boolean);
    if (keys.length > 0) setSelection({ keys, anchor: keys[keys.length - 1] });
  }
  const selectedKeySet = useMemo(
    () => new Set(selection.keys.filter((key) => pageByCardKey.has(key))),
    [selection.keys, pageByCardKey],
  );
  const selectedPages = useMemo(
    () => allowedPages.filter((pageNumber) => selectedKeySet.has(cardKeys[pageNumber])),
    [allowedPages, cardKeys, selectedKeySet],
  );
  const multiSelected = selectedPages.length > 1;

  useEffect(() => {
    if (selectMode) return;
    const key = selectedPage ? cardKeys[selectedPage] : null;
    setSelection((prev) => {
      const live = prev.keys.filter((k) => pageByCardKey.has(k));
      if (live.length > 1) return live.length === prev.keys.length ? prev : { ...prev, keys: live };
      if (!key) return live.length === prev.keys.length ? prev : { keys: live, anchor: prev.anchor };
      if (live.length === 1 && live[0] === key && prev.keys.length === 1) return prev;
      return { keys: [key], anchor: key };
    });
  }, [selectedPage, cardKeys, pageByCardKey, selectMode]);

  // The latest values for the window listeners and the drag handlers.
  const liveRef = useRef({});
  liveRef.current = { selectedPages, selectedKeySet, visiblePages, cardKeys, selectedPage, selectMode, contextMenu };

  const selectRange = useCallback((pageNumber, { add = false } = {}) => {
    const { visiblePages: pages, cardKeys: keysOf, selectedPage: current } = liveRef.current;
    setSelection((prev) => {
      const anchorKey = prev.anchor && pageByCardKey.has(prev.anchor) ? prev.anchor : keysOf[current];
      const from = pages.findIndex((p) => keysOf[p] === anchorKey);
      const to = pages.indexOf(pageNumber);
      if (to < 0) return prev;
      const start = from < 0 ? to : Math.min(from, to);
      const end = from < 0 ? to : Math.max(from, to);
      const run = pages.slice(start, end + 1).map((p) => keysOf[p]);
      const keys = add ? [...new Set([...prev.keys.filter((k) => pageByCardKey.has(k)), ...run])] : run;
      return { keys, anchor: anchorKey || keysOf[pageNumber] };
    });
  }, [pageByCardKey]);

  const togglePage = useCallback((pageNumber) => {
    const { cardKeys: keysOf, selectedPage: current, selectMode: picking } = liveRef.current;
    const key = keysOf[pageNumber];
    setSelection((prev) => {
      let live = prev.keys.filter((k) => pageByCardKey.has(k));
      // Desktop: a lone selection is the current page; Ctrl+click adds to it.
      if (!picking && live.length === 0 && keysOf[current]) live = [keysOf[current]];
      const keys = live.includes(key) ? live.filter((k) => k !== key) : [...live, key];
      return { keys, anchor: key };
    });
  }, [pageByCardKey]);

  const handlePageClick = useCallback((pageNumber, event) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    flushPendingDrop();
    if (selectMode) {
      togglePage(pageNumber);
      return;
    }
    if (!mobileMode && event && (event.metaKey || event.ctrlKey)) {
      togglePage(pageNumber);
      return;
    }
    if (!mobileMode && event?.shiftKey) {
      selectRange(pageNumber);
      return;
    }
    const key = cardKeys[pageNumber];
    setSelection({ keys: key ? [key] : [], anchor: key || null });
    setSelectedPage(pageNumber);
    if (onNavigateToPage) {
      onNavigateToPage(pageNumber);
    }
  }, [cardKeys, flushPendingDrop, mobileMode, onNavigateToPage, selectMode, selectRange, togglePage]);

  const handlePageDoubleClick = useCallback((pageNumber) => {
    if (onNavigateToPage) {
      onNavigateToPage(pageNumber);
    }
  }, [onNavigateToPage]);

  // Desktop keys while the strip is in use (its last press was in it):
  // Ctrl/Cmd+A selects every page, Escape drops back to the current page.
  const panelRootRef = useRef(null);
  const panelActiveRef = useRef(false);
  const dragLiveRef = useRef(false);
  useEffect(() => {
    if (mobileMode || typeof window === 'undefined') return undefined;
    const onPointerDown = (event) => {
      panelActiveRef.current = Boolean(panelRootRef.current?.contains(event.target));
    };
    const onKeyDown = (event) => {
      const root = panelRootRef.current;
      if (!root || root.getClientRects().length === 0) return;
      if (!panelActiveRef.current && !root.contains(document.activeElement)) return;
      const target = event.target;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || ''))) return;
      const { visiblePages: pages, cardKeys: keysOf, selectedPages: picked, selectedPage: current, contextMenu: menu } = liveRef.current;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && String(event.key).toLowerCase() === 'a') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const all = pages.map((p) => keysOf[p]);
        setSelection({ keys: all, anchor: all[0] || null });
        return;
      }
      if (event.key === 'Escape' && !dragLiveRef.current && !menu && picked.length > 1) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const key = keysOf[current];
        setSelection({ keys: key ? [key] : [], anchor: key || null });
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [mobileMode]);

  // A right-click anywhere on a card, or its "..." button (fromButton: the
  // menu then sits beside the button, as on the phone). On a card that is part
  // of a selection of several pages the menu acts on all of them ("3 pages");
  // on any other card it acts on that page, which becomes the selection.
  const handleContextMenu = useCallback((e, pageNumber, { fromButton = false } = {}) => {
    e.preventDefault();
    e.stopPropagation();
    flushPendingDrop();
    const { selectedKeySet: picked, selectedPages: pages, cardKeys: keysOf, selectMode: picking } = liveRef.current;
    const key = keysOf[pageNumber];
    const onSelection = picked.has(key) && pages.length > 1;
    if (!onSelection && !picking && key) setSelection({ keys: [key], anchor: key });
    // The press point only; the menu is placed once it has been measured
    // (placeContextMenu above).
    setContextMenu({ pageNumber, pages: onSelection ? pages : null, x: e.clientX, y: e.clientY, fromButton });
  }, [flushPendingDrop]);

  const clipboardHasPages = Array.isArray(clipboardPage) ? clipboardPage.length > 0 : Boolean(clipboardPage);
  const onClipboard = useCallback((pageNumber) => (
    Array.isArray(clipboardPage) ? clipboardPage.includes(pageNumber) : clipboardPage === pageNumber
  ), [clipboardPage]);

  // Run a change to several pages; `nextPages` (if any) become the selection
  // once the change is on screen.
  const actOnPages = useCallback((run, nextPages = null) => {
    if (nextPages) pendingSelectionRef.current = { doc: pdfDoc, pages: nextPages };
    Promise.resolve(run()).then((ok) => {
      if (!ok && pendingSelectionRef.current?.doc === pdfDoc) pendingSelectionRef.current = null;
    }, () => { pendingSelectionRef.current = null; });
  }, [pdfDoc]);

  // Paste the clipboard (one page or several) above / below a page. A
  // pasted block becomes the selection.
  const pasteAt = useCallback((anchor, position = 'below') => {
    if (!onPastePage || !clipboardHasPages) return;
    if (Array.isArray(clipboardPage)) {
      const count = Math.max(anchor, ...clipboardPage);
      const plan = clipboardType === 'cut'
        ? movePagesNextTo(count, clipboardPage, anchor, position)
        : copyPagesAfter(count, clipboardPage, position === 'above' ? anchor - 1 : anchor);
      actOnPages(() => onPastePage(anchor, clipboardPage, clipboardType, position), plan.selection);
      return;
    }
    onPastePage(anchor, clipboardPage, clipboardType, position);
  }, [actOnPages, clipboardHasPages, clipboardPage, clipboardType, onPastePage]);

  // The phone action bar's Paste: below the current page.
  const handlePaste = useCallback((pageNumber) => {
    pasteAt(pageNumber, 'below');
    setContextMenu(null);
  }, [pasteAt]);

  // The page menu: the one shared list (sidebar/pageMenuItems.js), run
  // through these page operations. The viewer's page menu runs the same list.
  const pageMenuHandlers = useMemo(() => ({
    select: mobileMode ? (pageNumber) => {
      const key = cardKeys[pageNumber];
      setMobileSelectMode(true);
      setSelection({ keys: key ? [key] : [], anchor: key || null });
    } : undefined,
    move: onReorderPages ? movePageByOffset : undefined,
    cut: onCutPage,
    copy: onCopyPage,
    paste: onPastePage ? (pageNumber, position) => pasteAt(pageNumber, position) : undefined,
    duplicate: onDuplicatePage,
    insertBlank: onInsertBlankPage,
    rotate: onRotatePage,
    mirror: onMirrorPage,
    reset: onResetPage,
    delete: onDeletePage
      ? (pageNumber) => { if (window.confirm(`Delete page ${pageNumber}?`)) onDeletePage(pageNumber); }
      : undefined,
  }), [cardKeys, mobileMode, movePageByOffset, onReorderPages, onCutPage, onCopyPage, onPastePage, pasteAt, onDuplicatePage, onInsertBlankPage, onRotatePage, onMirrorPage, onResetPage, onDeletePage]);

  // The same items on a selection of several pages: each is ONE change and
  // ONE Undo step for all of them (hooks/usePageOperations.js).
  const selectionHandlers = useMemo(() => ({
    cut: onCutPage ? (pages) => onCutPage(pages) : undefined,
    copy: onCopyPage ? (pages) => onCopyPage(pages) : undefined,
    paste: onPastePage
      ? (pages, position) => pasteAt(position === 'above' ? pages[0] : pages[pages.length - 1], position)
      : undefined,
    duplicate: onDuplicatePage
      ? (pages) => actOnPages(() => onDuplicatePage(pages), duplicatePages(numPages, pages).selection)
      : undefined,
    rotate: onRotatePage ? (pages, delta) => actOnPages(() => onRotatePage(pages, delta)) : undefined,
    delete: onDeletePage
      ? (pages) => { if (window.confirm(`Delete ${pages.length} pages?`)) actOnPages(() => onDeletePage(pages)); }
      : undefined,
  }), [actOnPages, numPages, onCutPage, onCopyPage, onPastePage, pasteAt, onDuplicatePage, onRotatePage, onDeletePage]);

  const pickPageMenuItem = useCallback((key) => {
    const menu = contextMenu;
    // Closed first: Delete asks a question, and the menu must not sit over it.
    setContextMenu(null);
    if (!menu) return;
    if (menu.pages && menu.pages.length > 1) runPageMenuAction(key, menu.pages, selectionHandlers);
    else if (menu.pageNumber) runPageMenuAction(key, menu.pageNumber, pageMenuHandlers);
  }, [contextMenu, pageMenuHandlers, selectionHandlers]);

  // The phone select bar: an item on the ticked pages.
  const runOnSelection = useCallback((key) => {
    const pages = liveRef.current.selectedPages;
    if (pages.length > 1) runPageMenuAction(key, pages, selectionHandlers);
    else if (pages.length === 1) runPageMenuAction(key, pages[0], pageMenuHandlers);
  }, [pageMenuHandlers, selectionHandlers]);

  const leaveSelectMode = useCallback(() => {
    setMobileSelectMode(false);
    setSelection({ keys: [], anchor: null });
  }, []);

  // ---- Drag to reorder (owner 2026-10-07: "I don't need a handle ... click
  // and drag on it", desktop and phone; @dnd-kit like the bookmark and tab
  // lists). The whole card is the drag target:
  //   - desktop: the mouse moves 5px with the button down -> drag (a click,
  //     a right-click and the "..." button stay what they were);
  //   - phone: a finger held still 300ms lifts the page (a swipe before that
  //     scrolls the list). Then, like an iPhone home-screen icon: move ->
  //     drag; let go without moving -> the page menu opens (the long-press);
  //   - keyboard: Space / Enter on a focused card picks it up, arrows move,
  //     Space / Enter drops, Escape cancels.
  // Dragging a page of a selection of several carries them all (owner: "I
  // should be able to drag and drop multiple things"): they land as one block,
  // in their order, where the carried page lands. One Undo step either way.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: PAGE_DRAG_TOUCH_DELAY_MS, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragActiveId, setDragActiveId] = useState(null);
  // The pages riding along ({ keys, pages }) when several are carried.
  const [dragBlock, setDragBlock] = useState(null);
  const dragStartRef = useRef(null);
  // A drop that moves pages lands at once: the overlay goes in the drop's
  // own frame and the page is already in its slot (owner 2026-10-07: "super
  // smooth and instant"). Only a cancelled drag glides back to where it was.
  const [dropGlide, setDropGlide] = useState(true);
  const reducedMotion = usePrefersReducedMotion();
  const sortableIds = useMemo(() => visiblePages.map((pageNumber) => cardKeys[pageNumber]), [visiblePages, cardKeys]);

  const endDrag = useCallback(() => {
    setDragActiveId(null);
    setDragBlock(null);
    dragLiveRef.current = false;
    if (typeof document !== 'undefined') document.body.classList.remove('drag-rearrange-dragging');
  }, []);
  useEffect(() => endDrag, [endDrag]);

  const handleDndStart = useCallback(({ active, activatorEvent }) => {
    // A drop still on its way to the viewer goes first: this drag starts
    // from the real order.
    flushPendingDrop();
    setContextMenu(null);
    setDropGlide(true);
    const { selectedKeySet: picked, selectedPages: pages, selectMode: picking } = liveRef.current;
    const carriesSelection = picked.has(active.id) && pages.length > 1 && (!mobileMode || picking);
    const block = carriesSelection ? { keys: new Set(picked), pages } : null;
    dragStartRef.current = { touch: activatorEvent?.type === 'touchstart', block };
    // Desktop: picking up a page outside the selection selects just it.
    if (!carriesSelection && !mobileMode) setSelection({ keys: [active.id], anchor: active.id });
    setDragBlock(block);
    setDragActiveId(active.id);
    dragLiveRef.current = true;
    // Sheets and other gestures leave a live reorder alone (useMobileSheetMotion).
    document.body.classList.add('drag-rearrange-dragging');
  }, [flushPendingDrop, mobileMode]);

  // Show `finalPages` now; run the page change once that frame is painted.
  const landDrop = useCallback((finalPages, run, nextSelection = null) => {
    const doc = pdfDoc;
    lastDropAtRef.current = Date.now();
    setDropOrder({ doc, pages: finalPages });
    const dispatch = () => {
      if (pendingDropRef.current !== dispatch) return;
      pendingDropRef.current = null;
      if (nextSelection) pendingSelectionRef.current = { doc, pages: nextSelection };
      let result;
      try { result = run(); } catch (error) { result = false; console.error('Page drop failed:', error); }
      Promise.resolve(result).then((ok) => {
        if (ok) return;
        // Nothing changed: back to the real order.
        if (pendingSelectionRef.current?.doc === doc) pendingSelectionRef.current = null;
        setDropOrder((current) => (current && current.doc === doc ? null : current));
      }, () => setDropOrder(null));
    };
    pendingDropRef.current = dispatch;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(dispatch, 0));
    // A hidden tab runs no frames.
    setTimeout(dispatch, 120);
  }, [pdfDoc]);

  const handleDndEnd = useCallback(({ active, over, delta }) => {
    const start = dragStartRef.current;
    endDrag();
    suppressClickRef.current = true;
    requestAnimationFrame(() => { suppressClickRef.current = false; });
    const source = pageByCardKey.get(active.id);
    const target = over ? pageByCardKey.get(over.id) : null;
    const block = start?.block;
    if (import.meta.env?.DEV && typeof window !== 'undefined') {
      // Dev-only probe for the drag harness (scratch Playwright checks).
      window.__surveyLastPageDrop = { source, target, carried: block ? block.pages.length : 1 };
    }
    if (source && target && source !== target && onReorderPages) {
      const ids = sortableIds;
      const moved = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
      if (block && block.pages.length > 1) {
        // The carried page's new slot, with the other selected pages lifted
        // out of the list: the whole block goes there, in page order.
        const riders = new Set([...block.keys].filter((key) => key !== active.id));
        const rest = moved.filter((key) => !riders.has(key));
        const at = rest.indexOf(active.id);
        const blockKeys = block.pages.map((pageNumber) => cardKeys[pageNumber]);
        const finalPages = [...rest.slice(0, at), ...blockKeys, ...rest.slice(at + 1)].map((key) => pageByCardKey.get(key));
        // As a slot among ALL the document's pages that stay (the strip may
        // show only the pages of the active space).
        const lifted = new Set(block.pages);
        const stay = [];
        for (let page = 1; page <= numPages; page += 1) if (!lifted.has(page)) stay.push(page);
        const above = at > 0 ? pageByCardKey.get(rest[at - 1]) : null;
        const below = at + 1 < rest.length ? pageByCardKey.get(rest[at + 1]) : null;
        let index = 0;
        if (above != null) index = stay.indexOf(above) + 1;
        else if (below != null) index = Math.max(0, stay.indexOf(below));
        if (finalPages.every((pageNumber, i) => pageNumber === visiblePages[i])) return;
        setDropGlide(false);
        landDrop(
          finalPages,
          () => onReorderPages(block.pages, { index, pageCount: numPages }),
          movePagesToIndex(numPages, block.pages, index).selection,
        );
        return;
      }
      setDropGlide(false);
      landDrop(moved.map((key) => pageByCardKey.get(key)), () => onReorderPages(source, target));
      return;
    }
    // Phone: held, lifted and let go in place = the long-press page menu.
    if (start?.touch && source && Math.hypot(delta?.x || 0, delta?.y || 0) < 8) {
      const anchor = thumbnailRefs.current[source]?.querySelector('[data-page-menu-anchor]')?.getBoundingClientRect();
      setContextMenu({
        pageNumber: source,
        pages: block && block.pages.length > 1 ? block.pages : null,
        x: anchor?.left ?? 0,
        y: anchor?.top ?? 0,
        fromButton: true,
      });
    }
  }, [cardKeys, endDrag, landDrop, numPages, onReorderPages, pageByCardKey, sortableIds, visiblePages]);

  const dropAnimation = useMemo(() => (reducedMotion || !dropGlide ? null : {
    duration: 180,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }),
  }), [reducedMotion, dropGlide]);

  const dragModifiers = useMemo(() => (mobileMode ? [] : [restrictToVerticalAxis]), [mobileMode]);

  // Let go outside the strip (over the page, the toolbar, off the sheet):
  // no slot, so the drag cancels and the page glides back.
  const pageCollisions = useCallback((args) => {
    const box = containerRef.current?.getBoundingClientRect();
    const rect = args.collisionRect;
    const point = args.pointerCoordinates
      || (rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null);
    if (box && point && (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom)) {
      return [];
    }
    return closestCenter(args);
  }, []);

  // The lifted page carried by a drag (DragOverlay; owner 2026-10-07: "I just
  // want to be picking up and moving that page"): the page itself - its
  // picture in its own box, raised on the app's lift shadow - placed exactly
  // over the card's picture, with no card box around it. Several pages ride
  // as a small stack with their count.
  const renderLiftedPage = (pageNumber, count = 1) => {
    const meta = thumbnails[pageNumber];
    const src = typeof meta === 'string' ? meta : meta?.src;
    const ratio = getDisplayAspectRatio(pageNumber, pageAspectRatios[pageNumber] || 129);
    const state = pageTransformations[pageNumber] || {};
    const turn = (getRotationDelta(pageNumber) + (Number(meta?.cssRotate) || 0)) % 360;
    const imageTransform = [
      turn ? `rotate(${turn}deg)` : '',
      state.mirrorH ? 'scaleX(-1)' : '',
      state.mirrorV ? 'scaleY(-1)' : '',
    ].filter(Boolean).join(' ') || 'none';
    const sheet = {
      position: 'absolute',
      inset: 0,
      background: '#ffffff',
      borderRadius: 2,
      boxShadow: 'var(--drag-lift-shadow)',
    };
    return (
      <div
        data-page-drag-overlay={pageNumber}
        data-page-drag-count={count}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          // The card's padding + border: the page sits where it sat.
          padding: mobileMode ? 9 : 5,
          display: 'grid',
          placeItems: mobileMode ? 'center' : 'start center',
          cursor: 'grabbing',
        }}
      >
        <div style={{ position: 'relative', ...thumbnailBoxStyle(ratio / 100) }}>
          {count > 2 ? <div aria-hidden="true" style={{ ...sheet, transform: 'translate(6px, 6px)' }} /> : null}
          {count > 1 ? <div aria-hidden="true" style={{ ...sheet, transform: 'translate(3px, 3px)' }} /> : null}
          <div data-page-drag-sheet="" style={{ ...sheet, overflow: 'hidden' }}>
            {src ? (
              <img
                src={src}
                alt=""
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: imageTransform, transformOrigin: 'center center' }}
              />
            ) : null}
          </div>
          {count > 1 ? <span className="pages-drag-count" aria-label={`${count} pages`}>{count}</span> : null}
        </div>
      </div>
    );
  };

  const allPicked = selectedPages.length > 0 && selectedPages.length === allowedPages.length;

  return (
    <div
      ref={panelRootRef}
      className={mobileMode ? 'mobile-pages-panel' : 'pages-panel'}
      data-pages-panel=""
      data-pages-selecting={selectMode ? '' : undefined}
      style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: FONT_FAMILY,
      background: 'var(--panel-bg)'
    }}>
      {mobileMode && (selectMode ? (
        <div className="mobile-pages-counter is-selecting">
          <button
            type="button"
            onClick={() => {
              if (allPicked) setSelection({ keys: [], anchor: null });
              else setSelection({ keys: allowedPages.map((p) => cardKeys[p]), anchor: null });
            }}
          >
            {allPicked ? 'Select none' : 'Select all'}
          </button>
          <strong aria-live="polite">{selectedPages.length} selected</strong>
          <button type="button" onClick={leaveSelectMode}>Done</button>
        </div>
      ) : (
        <div className="mobile-pages-counter">
          <span>{pageNum}</span>
          <strong>/ {numPages} pages</strong>
        </div>
      ))}
      {/* Thumbnail List */}
      <DndContext
        sensors={sensors}
        collisionDetection={pageCollisions}
        modifiers={dragModifiers}
        autoScroll={CALM_LIST_AUTO_SCROLL}
        measuring={PAGE_DRAG_MEASURING}
        onDragStart={handleDndStart}
        onDragEnd={handleDndEnd}
        onDragCancel={endDrag}
      >
      <SortableContext items={sortableIds} strategy={mobileMode ? rectSortingStrategy : verticalListSortingStrategy}>
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
        {visiblePages.map((pageNumber, slotIndex) => {
          const cardKey = cardKeys[pageNumber];
          const isCurrent = pageNumber === selectedPage;
          // Selected: a ticked page in the phone's Select mode; on desktop the
          // selection (one page = the current page).
          const isPicked = selectMode
            ? selectedKeySet.has(cardKey)
            : (!mobileMode && (selectedKeySet.size > 0 ? selectedKeySet.has(cardKey) : isCurrent));
          const isRider = Boolean(dragBlock && dragBlock.keys.has(cardKey) && cardKey !== dragActiveId);
          // The number this slot shows (a dropped page shows its new number
          // in the drop's own frame).
          const shownNumber = visiblePages === allowedPages ? pageNumber : allowedPages[slotIndex];
          const thumbnailMeta = thumbnails[pageNumber];
          const thumbnailSrc = typeof thumbnailMeta === 'string' ? thumbnailMeta : thumbnailMeta?.src;
          const rawRatio = pageAspectRatios[pageNumber] || 129;
          const displayRatio = getDisplayAspectRatio(pageNumber, rawRatio);
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
          const menuOpen = contextMenu && (contextMenu.pages ? contextMenu.pages.includes(pageNumber) : contextMenu.pageNumber === pageNumber);

          return (
            <SortablePageCard key={cardKey} id={cardKey} reducedMotion={reducedMotion}>
            {({ setNodeRef, attributes, listeners, transform, transition, isDragging }) => (
            <div
              {...attributes}
              {...listeners}
              // A mouse press never moves focus onto the card (it would take
              // the viewer's keys - hold Space to pan, Delete - with it, and
              // the browser would start its own image drag). Keyboard users
              // reach a card with Tab; Enter picks it up (Space stays the
              // viewer's pan key), arrows move it, Enter drops, Escape cancels.
              onMouseDown={(event) => {
                listeners?.onMouseDown?.(event);
                if (event.button === 0) event.preventDefault();
              }}
              className={mobileMode
                ? `mobile-page-card${isCurrent && !selectMode ? ' is-active' : ''}${selectMode && isPicked ? ' is-selected' : ''}`
                : `pages-panel-card${isCurrent ? ' is-active' : ''}${isPicked ? ' is-selected' : ''}${menuOpen ? ' is-menu-open' : ''}`}
              ref={el => { thumbnailRefs.current[pageNumber] = el; setNodeRef(el); }}
              data-page-number={pageNumber}
              data-page-key={cardKey}
              data-page-card=""
              data-drag-placeholder={isDragging ? '' : undefined}
              data-drag-rider={isRider ? '' : undefined}
              aria-label={`Page ${shownNumber}`}
              data-selected={isPicked ? '' : undefined}
              onContextMenu={(e) => handleContextMenu(e, pageNumber)}
              onClick={(event) => handlePageClick(pageNumber, event)}
              onDoubleClick={() => handlePageDoubleClick(pageNumber)}
              style={{
                position: 'relative',
                padding: mobileMode ? '8px' : '4px',
                /* Phone: the card takes its grid cell (two columns, see
                   .mobile-pages-track in mobilePdfViewer.css); no fixed box. */
                boxSizing: 'border-box',
                // Owner 2026-10-07 ("a gold box bigger than the page ... I
                // want that gold box just to outline the page"): the card
                // itself has no selected fill or border; the selected outline
                // and the drop slot hug the page picture (styles.css
                // .pages-panel-card.is-selected [data-page-preview]).
                border: '1px solid transparent',
                borderRadius: '4px',
                cursor: mobileMode ? 'pointer' : (isDragging ? 'grabbing' : 'grab'),
                transform: CSS.Translate.toString(transform),
                touchAction: mobileMode ? 'pan-y' : undefined,
                // No iOS image callout / text selection on a long-press.
                WebkitTouchCallout: mobileMode ? 'none' : undefined,
                WebkitUserSelect: mobileMode ? 'none' : undefined,
                userSelect: mobileMode ? 'none' : undefined,
                transition: [transition, 'background 0.15s ease, opacity 0.15s ease'].filter(Boolean).join(', '),
                // Every card is laid out (2026-10-07): with content-visibility
                // auto, a card the drop moved in the DOM was skipped for a
                // frame and drawn at its guessed height - the strip jumped.
                contentVisibility: 'visible',
              }}
            >
              {/* UX 2026-07-12 — Mobile clipboard indicator: when this page is the
                  cut/copy source, surface a green-bordered badge at the top-left of
                  the card so the user can see which page is on the clipboard before
                  pasting. Demo parity: PageThumb clipboard badge (styles.ts:1174-1187).
                  Desktop cards never show this (mobileMode-gated). */}
              {mobileMode && !selectMode && onClipboard(pageNumber) && (
                <div
                  className="mobile-page-clipboard-badge"
                  aria-label={clipboardType === 'cut' ? `Page ${pageNumber} cut to clipboard` : `Page ${pageNumber} copied to clipboard`}
                  {...tip(clipboardType === 'cut' ? 'Cut — ready to paste' : 'Copied — ready to paste', 'below')}
                >
                  <Icon name={clipboardType === 'cut' ? 'scissors' : 'copy'} size={12} color="var(--accent)" />
                </div>
              )}

              {selectMode && (
                <span className={`mobile-page-select-indicator${isPicked ? ' is-selected' : ''}`} aria-hidden="true">
                  {isPicked ? <Icon name="check" size={13} color="currentColor" /> : null}
                </span>
              )}

              {/* Thumbnail */}
              {/* Owner 2026-10-07 ("the pages are being shown too big"):
                  the thumbnail fits one square box, keeping the page's shape
                  (sidebar/pageThumbnailBox.js), centred in its card. A sheet
                  turned on its side is no taller than a letter page. */}
              <div className={mobileMode ? 'mobile-page-preview' : 'pages-panel-preview'} data-drag-keep-fill data-page-preview="" style={{
                position: 'relative',
                ...thumbnailBoxStyle(displayRatio / 100),
                margin: '0 auto',
                background: '#ffffff',
                borderRadius: '2px',
                overflow: 'hidden'
              }}>
                {/* Page number: on the page's top-right corner. */}
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
                  pointerEvents: 'none',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.3)'
                }}>
                  {shownNumber}
                </div>
                {thumbnailSrc ? (
                  <img
                    src={thumbnailSrc}
                    alt={`Page ${shownNumber}`}
                    draggable={false}
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
                {/* The page's "..." menu button, bottom-right on the page.
                    Owner 2026-10-07 ("the three dots ... should be visible on
                    all pages, whether it's selected or not"): always shown,
                    desktop and phone; on desktop a calm small dot at rest
                    (.pages-panel-more in styles.css). It opens the same menu
                    as a right-click. */}
                <button
                    type="button"
                    className={mobileMode ? undefined : 'pages-panel-more'}
                    aria-label={`Page ${shownNumber} actions`}
                    aria-haspopup="menu"
                    aria-expanded={Boolean(menuOpen)}
                    {...tip(`Page ${shownNumber} actions`, 'below')}
                    onClick={(event) => handleContextMenu(event, pageNumber, { fromButton: true })}
                    onDoubleClick={(event) => event.stopPropagation()}
                    // A press on the button is the button's, never a drag.
                    onMouseDown={(event) => event.stopPropagation()}
                    onTouchStart={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    style={mobileMode ? {
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
                    } : {
                      position: 'absolute',
                      right: 0,
                      bottom: 0,
                      width: 32,
                      height: 32,
                      padding: 0,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'transparent',
                      border: 0,
                      cursor: 'pointer',
                      zIndex: 2,
                    }}
                  >
                    <span
                      data-page-menu-anchor="true"
                      aria-hidden="true"
                      style={mobileMode ? {
                        width: 28,
                        height: 28,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: '50%',
                        background: 'var(--surface-3)',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
                      } : undefined}
                    >
                      <Icon name="moreHorizontal" size={mobileMode ? 18 : 14} color="currentColor" />
                    </span>
                  </button>
              </div>
            </div>
            )}
            </SortablePageCard>
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
      </SortableContext>
      {/* The lifted page (portalled: the phone sheet is transformed, which
          would offset a fixed overlay inside it). */}
      {typeof document !== 'undefined' && createPortal(
        <DragOverlay dropAnimation={dropAnimation} zIndex={PAGE_DRAG_OVERLAY_Z}>
          {dragActiveId != null && pageByCardKey.has(dragActiveId)
            ? renderLiftedPage(pageByCardKey.get(dragActiveId), dragBlock ? dragBlock.pages.length : 1)
            : null}
        </DragOverlay>,
        document.body,
      )}
      </DndContext>

      {mobileMode && !selectMode && (
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
            disabled={!clipboardHasPages}
          >
            <Icon name="paste" size={15} color="currentColor" />
            <span>Paste</span>
          </button>
          <i />
          <button
            type="button"
            aria-pressed={false}
            onClick={() => {
              setMobileSelectMode(true);
              setSelection({ keys: [], anchor: null });
            }}
          >
            {/* listChecks: the desktop's Select glyph (owner 2026-10-02). */}
            <Icon name="listChecks" size={16} color="currentColor" />
            <span>Select</span>
          </button>
        </div>
      )}
      {/* Phone Select mode: the bar acts on the ticked pages (More holds the
          rest of the page menu: cut, paste, rotate). */}
      {mobileMode && selectMode && (
        <div className="mobile-pages-actions" role="toolbar" aria-label="Selected pages actions">
          <button type="button" disabled={selectedPages.length === 0 || !onCopyPage} onClick={() => runOnSelection('copy')}>
            <Icon name="copy" size={15} color="currentColor" />
            <span>Copy</span>
          </button>
          <i />
          <button type="button" disabled={selectedPages.length === 0 || !onDuplicatePage} onClick={() => runOnSelection('duplicate')}>
            <Icon name="duplicate" size={15} color="currentColor" />
            <span>Duplicate</span>
          </button>
          <i />
          <button
            type="button"
            disabled={selectedPages.length === 0 || selectedPages.length >= numPages || !onDeletePage}
            onClick={() => runOnSelection('delete')}
          >
            <Icon name="trash" size={15} color="currentColor" />
            <span>Delete</span>
          </button>
          <i />
          <button
            type="button"
            aria-haspopup="menu"
            disabled={selectedPages.length === 0}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setContextMenu({
                pageNumber: selectedPages[0],
                pages: selectedPages.length > 1 ? selectedPages : null,
                x: rect.left,
                y: rect.top,
                anchorRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
                fromButton: true,
              });
            }}
          >
            <Icon name="moreHorizontal" size={16} color="currentColor" />
            <span>More</span>
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
          role="menu"
          aria-label={contextMenu.pages && contextMenu.pages.length > 1
            ? `${contextMenu.pages.length} pages actions`
            : `Page ${contextMenu.pageNumber} actions`}
          // Polish 3 (2026-10-04): the one popup corner and shadow
          // (--radius-md / --shadow-popover, as AnnotationDropdown and the
          // phone More menu). The fills are unchanged (menu shades: owner
          // decision pending).
          style={mobileMode ? {
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-popover)',
            padding: '6px',
            zIndex: PAGE_MENU_Z,
            // As wide as its longest row ("Mirror horizontally"), at least
            // the old 188px.
            width: 'max-content',
            minWidth: '188px',
            maxWidth: 'calc(100vw - 32px)',
            overflowY: 'auto',
            fontFamily: FONT_FAMILY
          } : {
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--surface-3)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '4px',
            zIndex: PAGE_MENU_Z,
            minWidth: '180px',
            overflowY: 'auto',
            boxShadow: 'var(--shadow-popover)',
            fontFamily: FONT_FAMILY
          }}
        >
          {/* The one page menu list (sidebar/pageMenuItems.js), shared
              with the viewer's page menu. The phone adds Move up / down and
              Select. On a selection of several pages: "3 pages" and the
              actions that apply to them all. Owner 2026-10-06: an item with
              nothing to act on is disabled (Paste with an empty clipboard,
              Reset with nothing to undo, Delete on the only page). */}
          <PageMenuList
            mobile={mobileMode}
            onPick={pickPageMenuItem}
            dangerHoverBg={mobileMode ? 'var(--surface-2)' : 'var(--surface-3)'}
            items={buildPageMenuItems({
              pageNumber: contextMenu.pageNumber,
              pageNumbers: contextMenu.pages,
              pageCount: numPages,
              clipboardPage,
              clipboardType,
              hasTransform: pageHasTransform(pageTransformations?.[contextMenu.pageNumber]),
              select: mobileMode && !selectMode,
              move: mobileMode ? {
                canUp: allowedPages.indexOf(contextMenu.pageNumber) > 0,
                canDown: allowedPages.indexOf(contextMenu.pageNumber) < allowedPages.length - 1,
              } : null,
              available: availableActions(pageMenuHandlers),
            })}
          />
        </div>
        </>,
        document.body,
      )}
    </div>
  );
};

export default PagesPanel;
