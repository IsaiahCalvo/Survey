import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  PdfViewerComponent,
  Magnification,
  Navigation,
  BookmarkView,
  TextSelection,
  TextSearch,
  Annotation,
  Print,
  LinkAnnotation,
  FormFields,
  FormDesigner,
  Inject
} from '@syncfusion/ej2-react-pdfviewer';

const MAX_BOOKMARK_RETRIES = 20;
const TEXT_SEARCH_NATIVE_HIGHLIGHT_COLOR = 'rgba(255, 230, 0, 0.52)';

// UX 2026-04-22 (Windows load failure) — Syncfusion's PDF form-field parser
// (`FormFieldsBase.GetFormFields`, called unconditionally from
// `PdfRenderer.loadDocument`, regardless of `enableFormFields`) calls
// `_dictionary.has(...)` on every field it walks. On certain Acrobat-saved
// PDFs the field's `_dictionary` isn't a real `PdfDictionary`, which throws
// `TypeError: _dictionary.has is not a function`. In the unminified source
// the identifier survives as `annotDictionary.has is not a function`; in the
// production (minified) build the var is mangled and the error surfaces as
// `it.has is not a function` (or any short-name variant). Match both shapes.
const hasIsNotAFunctionRegex = /(?:^|[.\s])has is not a function/i;
const looksLikeHasIsNotAFunctionFailure = (candidate, depth = 0) => {
  if (!candidate || depth > 3) return false;
  if (typeof candidate === 'string') return hasIsNotAFunctionRegex.test(candidate);
  if (typeof candidate !== 'object') return false;

  const messageFields = [
    candidate.message,
    candidate.errorMessage,
    candidate.errorDescription,
  ];
  for (const field of messageFields) {
    if (typeof field === 'string' && hasIsNotAFunctionRegex.test(field)) {
      return true;
    }
  }

  if (typeof candidate.stack === 'string' && hasIsNotAFunctionRegex.test(candidate.stack)) {
    return true;
  }

  // Syncfusion wraps the underlying error in `.error` / `.reason` on some
  // event shapes — recurse one level in so we don't miss the match.
  if (candidate.error && looksLikeHasIsNotAFunctionFailure(candidate.error, depth + 1)) return true;
  if (candidate.reason && looksLikeHasIsNotAFunctionFailure(candidate.reason, depth + 1)) return true;

  return false;
};

const coercePositiveInt = (value, fallback = null) => {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  const rounded = Math.trunc(next);
  return rounded > 0 ? rounded : fallback;
};

const coerceZoom = (value, fallback = 100) => {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(10, Math.min(1000, next));
};

const TEXT_MARKUP_ANNOTATION_TYPES = new Set([
  'highlight',
  'underline',
  'strikethrough',
  'strikeout',
  'squiggly',
  'textmarkup',
  'text markup'
]);

const readNumberField = (source, fields, fallback = null) => {
  if (!source || typeof source !== 'object') return fallback;
  for (const field of fields) {
    const value = source[field];
    const next = Number(value);
    if (Number.isFinite(next)) return next;
  }
  return fallback;
};

const normalizePdfViewerBounds = (bounds) => {
  if (!bounds) return [];
  if (typeof bounds === 'string') {
    try {
      return normalizePdfViewerBounds(JSON.parse(bounds));
    } catch {
      return [];
    }
  }
  const sourceBounds = Array.isArray(bounds) ? bounds : [bounds];
  return sourceBounds
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const x = readNumberField(entry, ['x', 'X', 'left', 'Left']);
      const y = readNumberField(entry, ['y', 'Y', 'top', 'Top']);
      const width = readNumberField(entry, ['width', 'Width']);
      const height = readNumberField(entry, ['height', 'Height']);
      const right = readNumberField(entry, ['right', 'Right']);
      const bottom = readNumberField(entry, ['bottom', 'Bottom']);
      if (x === null || y === null) return null;
      const resolvedWidth = width ?? (right !== null ? right - x : null);
      const resolvedHeight = height ?? (bottom !== null ? bottom - y : null);
      if (!Number.isFinite(resolvedWidth) || !Number.isFinite(resolvedHeight)) return null;
      return { x, y, width: resolvedWidth, height: resolvedHeight };
    })
    .filter(Boolean);
};

const getAnnotationKind = (annotation) => {
  const candidates = [
    annotation?.textMarkupAnnotationType,
    annotation?.shapeAnnotationType,
    annotation?.annotationType,
    annotation?.type,
    annotation?.subject,
    annotation?.annotationSettings?.type
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toLowerCase();
    }
  }
  return '';
};

const isTextMarkupAnnotation = (annotation) => {
  const kind = getAnnotationKind(annotation);
  if (TEXT_MARKUP_ANNOTATION_TYPES.has(kind)) return true;
  return Array.isArray(annotation?.bounds) && annotation.bounds.length > 0 && kind.includes('highlight');
};

const getAnnotationId = (annotation) => (
  annotation?.annotationId ||
  annotation?.id ||
  annotation?.annotName ||
  annotation?.AnnotName ||
  annotation?.name ||
  null
);

const pointTouchesBounds = (point, bounds, radius) => (
  point.x >= bounds.x - radius &&
  point.x <= bounds.x + bounds.width + radius &&
  point.y >= bounds.y - radius &&
  point.y <= bounds.y + bounds.height + radius
);

const getTextMarkupModule = (viewer) => (
  viewer?.annotationModule?.textMarkupAnnotationModule ||
  viewer?.annotation?.textMarkupAnnotationModule ||
  viewer?.textMarkupAnnotationModule ||
  null
);

const getSyncfusionDocumentId = (viewer) => (
  viewer?.viewerBase?.documentId ||
  viewer?.pdfViewerBase?.documentId ||
  viewer?.documentId ||
  ''
);

const getTextMarkupPageIndex = (annotation, fallbackPageIndex = null) => {
  const rawPage = readNumberField(annotation, ['pageNumber', 'pageIndex', 'page'], null);
  if (Number.isFinite(fallbackPageIndex)) return fallbackPageIndex;
  if (!Number.isFinite(rawPage)) return fallbackPageIndex;
  return rawPage;
};

const getTextMarkupAnnotationCanvas = (viewer, annotation, pageIndex) => {
  const viewerBase = viewer?.viewerBase || viewer?.pdfViewerBase;
  const canvasId = annotation?.textMarkupAnnotationType === 'Highlight'
    ? '_blendAnnotationsIntoCanvas_'
    : '_annotationCanvas_';
  if (!viewerBase) return null;
  if (canvasId === '_blendAnnotationsIntoCanvas_') {
    return viewerBase.getElement?.(`${canvasId}${pageIndex}`) || null;
  }
  return viewerBase.getAnnotationCanvas?.(canvasId, pageIndex) || null;
};

const getTextMarkupBoundsList = (annotation) => (
  normalizePdfViewerBounds(annotation?.bounds || annotation?.Bounds || annotation?.rect || annotation?.Rect)
);

const TEXT_MARKUP_HANDLE_HIT_SIZE = 24;
const TEXT_MARKUP_SELECTION_GLOW_ATTR = 'data-betasafe-text-markup-selection-glow';

const clearTextMarkupSelectionGlow = (viewer) => {
  const root = viewer?.element || document;
  root?.querySelectorAll?.(`[${TEXT_MARKUP_SELECTION_GLOW_ATTR}="true"]`)
    ?.forEach((element) => element.remove());
};

const clearTextMarkupSelectionState = (viewer) => {
  clearTextMarkupSelectionGlow(viewer);
  const textMarkupModule = getTextMarkupModule(viewer);
  if (!textMarkupModule) return;
  textMarkupModule.currentTextMarkupAnnotation = null;
  textMarkupModule.selectTextMarkupCurrentPage = null;
  textMarkupModule.isDropletClicked = false;
  textMarkupModule.isExtended = false;
  textMarkupModule.isLeftDropletClicked = false;
  textMarkupModule.isRightDropletClicked = false;
};

const installTextMarkupDropletHandlers = (viewer) => {
  const textMarkupModule = getTextMarkupModule(viewer);
  if (!textMarkupModule) return;
  if (!textMarkupModule.__betasafeDropletState) {
    textMarkupModule.__betasafeDropletState = {
      activePointerId: null,
      activeSide: null,
      pendingMove: null,
      moveFrame: null
    };
  }
  const state = textMarkupModule.__betasafeDropletState;

  const findTextTarget = (event) => {
    const directTarget = event?.target?.closest?.('.e-pv-text');
    if (directTarget) return directTarget;
    if (!document.elementsFromPoint || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    return document.elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element?.closest?.('.e-pv-text'))
      .find(Boolean) || null;
  };

  const startResize = (side, event = null) => {
    state.activePointerId = Number.isFinite(event?.pointerId) ? event.pointerId : null;
    state.activeSide = side;
    textMarkupModule.isDropletClicked = true;
    textMarkupModule.isExtended = true;
    textMarkupModule.isLeftDropletClicked = side === 'left';
    textMarkupModule.isRightDropletClicked = side === 'right';
    try {
      event?.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is not available for synthetic mouse events.
    }
    try {
      textMarkupModule.pdfViewer?.textSelectionModule?.initiateSelectionByTouch?.();
      textMarkupModule.pdfViewer.textSelectionModule.selectionRangeArray = [];
    } catch {
      // Syncfusion initializes this lazily on some documents.
    }
  };

  const handleMove = (event) => {
    if (!state.activeSide || !textMarkupModule.isDropletClicked) return;
    if (
      state.activePointerId !== null &&
      Number.isFinite(event.pointerId) &&
      event.pointerId !== state.activePointerId
    ) {
      return;
    }
    state.pendingMove = event;
    if (state.moveFrame) return;
    state.moveFrame = window.requestAnimationFrame(() => {
      state.moveFrame = null;
      const moveEvent = state.pendingMove;
      state.pendingMove = null;
      if (!moveEvent || !textMarkupModule.isDropletClicked) return;
      textMarkupModule.isLeftDropletClicked = state.activeSide === 'left';
      textMarkupModule.isRightDropletClicked = state.activeSide === 'right';
      const target = findTextTarget(moveEvent);
      if (!target || typeof textMarkupModule.textSelect !== 'function') return;
      textMarkupModule.textSelect(target, moveEvent.clientX, moveEvent.clientY);
    });
  };

  const endResize = () => {
    state.activePointerId = null;
    state.activeSide = null;
    state.pendingMove = null;
    if (state.moveFrame) {
      window.cancelAnimationFrame(state.moveFrame);
      state.moveFrame = null;
    }
  };

  const bind = (element, side) => {
    if (!element || element.__betasafeDropletSide === side) return;
    element.addEventListener('pointerdown', (event) => startResize(side, event));
    element.addEventListener('mousedown', (event) => startResize(side, event));
    element.__betasafeDropletSide = side;
  };

  if (!textMarkupModule.__betasafeDropletMethodsPatched) {
    ['updateDropletStyles', 'updateCurrentResizerPosition'].forEach((methodName) => {
      const original = textMarkupModule[methodName];
      if (typeof original !== 'function') return;
      textMarkupModule[methodName] = function patchedTextMarkupDropletMethod(...args) {
        const result = original.apply(this, args);
        syncTextMarkupDropletAppearance(viewer, false);
        if (typeof window !== 'undefined') {
          window.requestAnimationFrame(() => syncTextMarkupDropletAppearance(viewer, false));
        }
        return result;
      };
    });
    textMarkupModule.__betasafeDropletMethodsPatched = true;
  }

  bind(textMarkupModule.dropDivAnnotationLeft, 'left');
  bind(textMarkupModule.dropElementLeft, 'left');
  bind(textMarkupModule.dropDivAnnotationRight, 'right');
  bind(textMarkupModule.dropElementRight, 'right');
  if (!textMarkupModule.__betasafeDropletHandlersInstalled) {
    document.addEventListener('pointermove', handleMove, true);
    document.addEventListener('mousemove', handleMove, true);
    document.addEventListener('pointerup', endResize, true);
    document.addEventListener('mouseup', endResize, true);
    document.addEventListener('pointercancel', endResize, true);
    window.addEventListener('blur', endResize);
    textMarkupModule.__betasafeDropletHandlersInstalled = true;
  }
};

const getTextMarkupPageDiv = (viewer, pageIndex) => {
  const viewerBase = viewer?.viewerBase || viewer?.pdfViewerBase;
  const viewerId = viewer?.element?.id || '';
  return viewerBase?.getElement?.(`_pageDiv_${pageIndex}`) ||
    document.getElementById(`${viewerId}_pageDiv_${pageIndex}`) ||
    viewer?.element?.querySelector?.(`[id$="_pageDiv_${pageIndex}"]`) ||
    null;
};

const getTextMarkupPageContainer = (viewer) => (
  viewer?.viewerBase?.pageContainer ||
  viewer?.pdfViewerBase?.pageContainer ||
  viewer?.element?.querySelector?.('.e-pv-page-container') ||
  viewer?.element ||
  null
);

const renderTextMarkupSelectionGlow = (viewer) => {
  const textMarkupModule = getTextMarkupModule(viewer);
  const annotation = textMarkupModule?.currentTextMarkupAnnotation;
  const pageIndex = Number(textMarkupModule?.selectTextMarkupCurrentPage);
  if (!annotation || !Number.isFinite(pageIndex) || typeof document === 'undefined') return;

  const boundsList = getTextMarkupBoundsList(annotation);
  if (!boundsList.length) {
    clearTextMarkupSelectionGlow(viewer);
    return;
  }
  const pageDiv = getTextMarkupPageDiv(viewer, pageIndex);
  if (!pageDiv?.getBoundingClientRect) {
    clearTextMarkupSelectionGlow(viewer);
    return;
  }
  const pageRect = pageDiv.getBoundingClientRect();
  const pageSize = viewer?.viewerBase?.pageSize?.[pageIndex] || {};
  const pageWidth = Number(pageSize.width) || pageRect.width;
  const pageHeight = Number(pageSize.height) || pageRect.height;
  if (!pageRect.width || !pageRect.height || !pageWidth || !pageHeight) {
    clearTextMarkupSelectionGlow(viewer);
    return;
  }

  const root = viewer?.element || document;
  const existing = Array.from(root.querySelectorAll?.(`[${TEXT_MARKUP_SELECTION_GLOW_ATTR}="true"]`) || []);
  const used = new Set();
  const setStyle = (element, key, value) => {
    if (element.style[key] !== value) element.style[key] = value;
  };

  boundsList.forEach((bounds, index) => {
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    const glow = existing[index] || document.createElement('div');
    used.add(glow);
    if (!glow.hasAttribute(TEXT_MARKUP_SELECTION_GLOW_ATTR)) {
      glow.setAttribute(TEXT_MARKUP_SELECTION_GLOW_ATTR, 'true');
    }
    setStyle(glow, 'position', 'absolute');
    setStyle(glow, 'left', `${(bounds.x / pageWidth) * pageRect.width}px`);
    setStyle(glow, 'top', `${(bounds.y / pageHeight) * pageRect.height}px`);
    setStyle(glow, 'width', `${Math.max(2, (bounds.width / pageWidth) * pageRect.width)}px`);
    setStyle(glow, 'height', `${Math.max(2, (bounds.height / pageHeight) * pageRect.height)}px`);
    setStyle(glow, 'pointerEvents', 'none');
    setStyle(glow, 'borderRadius', '4px');
    setStyle(glow, 'background', 'rgba(74, 144, 226, 0.10)');
    setStyle(glow, 'boxShadow', '0 0 0 2px rgba(74, 144, 226, 0.75), 0 0 10px rgba(74, 144, 226, 0.65)');
    setStyle(glow, 'zIndex', '10019');
    if (glow.parentElement !== pageDiv) pageDiv.appendChild(glow);
  });
  existing.forEach((element) => {
    if (!used.has(element)) element.remove();
  });
};

const syncTextMarkupDropletAppearance = (viewer, scheduleFollowUp = true) => {
  const textMarkupModule = getTextMarkupModule(viewer);
  const zoomFactor = Math.max(0.1, Number(viewer?.viewerBase?.getZoomFactor?.() || 1));
  if (textMarkupModule) {
    // Syncfusion multiplies dropletHeight by zoom. Normalize the rendered
    // hit target to a viewport-sized value so zoom does not change usability.
    textMarkupModule.dropletHeight = Math.max(10, Math.min(64, TEXT_MARKUP_HANDLE_HIT_SIZE / zoomFactor));
    installTextMarkupDropletHandlers(viewer);
  }
  if (typeof document === 'undefined') return;
  const viewerId = viewer?.element?.id || '';
  const selector = viewerId
    ? `#${viewerId}_droplet_left, #${viewerId}_droplet_right, #${viewerId}_dropletspan_left, #${viewerId}_dropletspan_right`
    : '.e-pv-drop, .e-pv-droplet';
  document.querySelectorAll(selector).forEach((element) => {
    element.style.setProperty('display', 'none', 'important');
    element.style.setProperty('visibility', 'hidden', 'important');
    element.style.setProperty('pointer-events', 'none', 'important');
  });
  renderTextMarkupSelectionGlow(viewer);
  if (scheduleFollowUp && typeof window !== 'undefined') {
    window.requestAnimationFrame(() => syncTextMarkupDropletAppearance(viewer, false));
  }
};

const collectTextMarkupAnnotations = (viewer, pageNumber = null) => {
  const annotations = [];
  const seen = new Set();
  const addAnnotation = (annotation, fallbackPageIndex = null) => {
    if (!isTextMarkupAnnotation(annotation)) return;
    const id = getAnnotationId(annotation);
    const pageIndex = getTextMarkupPageIndex(annotation, fallbackPageIndex);
    const key = `${id || annotations.length}:${Number.isFinite(pageIndex) ? pageIndex : 'unknown'}`;
    if (seen.has(key)) return;
    seen.add(key);
    annotations.push({ annotation, pageIndex });
  };

  const targetPageNumber = Number(pageNumber);
  const targetPageIndex = Number.isFinite(targetPageNumber) ? targetPageNumber - 1 : null;
  const pageIndexes = Number.isFinite(targetPageIndex)
    ? [targetPageIndex]
    : [];

  const textMarkupModule = getTextMarkupModule(viewer);
  if (typeof textMarkupModule?.getAnnotations === 'function') {
    const indexes = pageIndexes.length > 0
      ? pageIndexes
      : Array.from({ length: Math.max(0, coercePositiveInt(viewer?.pageCount, 0)) }, (_, index) => index);
    indexes.forEach((pageIndex) => {
      try {
        const pageAnnotations = textMarkupModule.getAnnotations(pageIndex, null);
        if (Array.isArray(pageAnnotations)) {
          pageAnnotations.forEach((annotation) => addAnnotation(annotation, pageIndex));
        }
      } catch {
        // Syncfusion throws for pages that have not initialized their annotation store.
      }
    });
  }

  const documentId = getSyncfusionDocumentId(viewer);
  const storeObject = documentId
    ? viewer?.annotationsCollection?.get?.(`${documentId}_annotations_textMarkup`)
    : null;
  if (Array.isArray(storeObject)) {
    storeObject.forEach((pageEntry) => {
      const entryPageIndex = readNumberField(pageEntry, ['pageIndex', 'pageNumber', 'page'], null);
      if (pageIndexes.length > 0 && Number.isFinite(entryPageIndex) && !pageIndexes.includes(entryPageIndex)) return;
      if (Array.isArray(pageEntry?.annotations)) {
        pageEntry.annotations.forEach((annotation) => addAnnotation(annotation, entryPageIndex));
      }
    });
  }

  [
    viewer?.annotationCollection,
    viewer?.annotationModule?.annotationCollection,
    viewer?.annotation?.annotationCollection,
    viewer?.annotationModule?.textMarkupAnnotationModule?.annotationCollection,
    viewer?.textMarkupAnnotationModule?.annotationCollection
  ].filter(Array.isArray).forEach((collection) => {
    collection.forEach((annotation) => addAnnotation(annotation, targetPageIndex));
  });

  return annotations;
};

const selectTextMarkupAnnotation = (viewer, annotation, pageIndex, event = null) => {
  const textMarkupModule = getTextMarkupModule(viewer);
  if (!textMarkupModule || !annotation || !Number.isFinite(pageIndex)) return false;
  if (!textMarkupModule.dropDivAnnotationLeft && typeof textMarkupModule.createAnnotationSelectElement === 'function') {
    try {
      textMarkupModule.createAnnotationSelectElement();
    } catch {
      // Syncfusion may already have created the droplet elements.
    }
  }
  syncTextMarkupDropletAppearance(viewer);
  const canvas = getTextMarkupAnnotationCanvas(viewer, annotation, pageIndex);
  if (!canvas) return false;
  try {
    const markupType = annotation.textMarkupAnnotationType;
    if (markupType) {
      textMarkupModule.currentTextMarkupAddMode = markupType;
    }
    textMarkupModule.currentTextMarkupAnnotation = annotation;
    textMarkupModule.selectTextMarkupCurrentPage = pageIndex;
    if (typeof textMarkupModule.onTextMarkupMouseUp === 'function' && event) {
      textMarkupModule.onTextMarkupMouseUp(annotation, event, canvas, pageIndex);
    } else if (typeof textMarkupModule.selectAnnotation === 'function') {
      textMarkupModule.selectAnnotation(annotation, canvas, pageIndex, event || undefined, false);
    } else if (typeof textMarkupModule.annotationDivSelect === 'function') {
      textMarkupModule.annotationDivSelect(annotation, pageIndex);
    }
    textMarkupModule.currentTextMarkupAnnotation = annotation;
    textMarkupModule.selectTextMarkupCurrentPage = pageIndex;
    textMarkupModule.updateCurrentResizerPosition?.(annotation);
    textMarkupModule.showHideDropletDiv?.(false);
    textMarkupModule.updateDropletStyles?.(markupType);
    syncTextMarkupDropletAppearance(viewer);
    return true;
  } catch (error) {
    console.warn('[SyncfusionPDFContainer] Failed to select text markup annotation:', error);
    return false;
  }
};

const deleteTextMarkupAnnotation = (viewer, annotation, pageIndex) => {
  const textMarkupModule = getTextMarkupModule(viewer);
  if (!textMarkupModule || !annotation || !Number.isFinite(pageIndex)) return false;
  try {
    clearTextMarkupSelectionGlow(viewer);
    textMarkupModule.currentTextMarkupAnnotation = annotation;
    textMarkupModule.selectTextMarkupCurrentPage = pageIndex;
    if (typeof textMarkupModule.deleteTextMarkupAnnotation === 'function') {
      textMarkupModule.deleteTextMarkupAnnotation();
      return true;
    }
  } catch (error) {
    console.warn('[SyncfusionPDFContainer] Failed to delete text markup annotation:', error);
  }
  return false;
};

const selectTextMarkupAtPagePoint = (viewer, pageNumber, point, radius = 4, event = null) => {
  if (!viewer || !point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
  const targetPageIndex = Number(pageNumber) - 1;
  const hitRadius = Math.max(0, Number(radius) || 0);
  const matches = collectTextMarkupAnnotations(viewer, pageNumber)
    .filter(({ annotation, pageIndex }) => {
      if (Number.isFinite(targetPageIndex) && Number.isFinite(pageIndex) && pageIndex !== targetPageIndex) return false;
      return getTextMarkupBoundsList(annotation).some((bounds) => pointTouchesBounds(point, bounds, hitRadius));
    });

  const selected = matches[0];
  if (!selected) return null;
  if (!selectTextMarkupAnnotation(viewer, selected.annotation, selected.pageIndex, event)) return null;
  return {
    id: getAnnotationId(selected.annotation) || null,
    type: selected.annotation?.textMarkupAnnotationType || getAnnotationKind(selected.annotation),
    pageIndex: selected.pageIndex,
    pageNumber: selected.pageIndex + 1
  };
};

const resolvePageCountFromArgs = (args, viewer) => {
  const candidates = [];
  if (args && typeof args === 'object') {
    candidates.push(args.pageCount);
    if (args.pageData && typeof args.pageData === 'object') {
      candidates.push(args.pageData.pageCount);
      candidates.push(args.pageData.pagecount);
    }
    if (typeof args.pageData === 'string') {
      try {
        const parsed = JSON.parse(args.pageData);
        candidates.push(parsed?.pageCount);
        candidates.push(parsed?.pagecount);
      } catch {
        // no-op
      }
    }
  }
  candidates.push(viewer?.pageCount);

  for (const candidate of candidates) {
    const resolved = coercePositiveInt(candidate, null);
    if (resolved) {
      return resolved;
    }
  }

  return 0;
};

const getSourceByteLength = (source) => {
  if (!source) return 0;
  if (typeof source === 'string') return source.length;
  if (source instanceof Uint8Array) return source.byteLength;
  if (source instanceof ArrayBuffer) return source.byteLength;
  if (ArrayBuffer.isView(source)) return source.byteLength;
  return 0;
};

const makeDocumentKey = (source) => {
  if (!source) return 'none';
  if (typeof source === 'string') {
    return `str:${source.length}:${source.slice(0, 32)}`;
  }
  const length = getSourceByteLength(source);
  let first = 0;
  if (source instanceof Uint8Array && source.length > 0) {
    first = source[0];
  } else if (ArrayBuffer.isView(source) && source.byteLength > 0) {
    first = source[0];
  } else if (source instanceof ArrayBuffer && source.byteLength > 0) {
    first = new Uint8Array(source)[0];
  }
  return `bin:${length}:${first}`;
};

const SyncfusionPDFContainer = forwardRef(({
  id,
  resourceUrl,
  documentSource,
  interactionMode = 'Pan',
  initialRenderPages = 6,
  scrollDelayMs = 160,
  suspendContainerRefresh = false,
  restrictZoomRequest = false,
  textHighlightModeActive = false,
  textHighlightColor = '#ffff00',
  textHighlightOpacity = 0.5,
  textMarkupMode = null,
  textMarkupColor = null,
  textMarkupOpacity = null,
  className = '',
  style = {},
  onDocumentLoaded,
  onDocumentLoadFailed,
  onPageChanged,
  onZoomChanged,
  onPageRendered,
  onTextSelectionEnd,
  onPDFBookmarksAvailable,
  onPageContainersChange,
  onDebugEvent,
  onDocumentUnload,
  // KAL-47: Survey-native form designer wiring.
  // Survey owns the UI; we just bridge Syncfusion events back to App so
  // the custom Forms toolbar / properties panel can react. Designer mode
  // (`viewer.designerMode`) is toggled imperatively via the ref so we never
  // surface Syncfusion's own form-designer chrome.
  formDesignerEnabled = false,
  onFormFieldAdd,
  onFormFieldSelect,
  onFormFieldUnselect,
  onFormFieldRemove,
  onFormFieldPropertiesChange,
  onFormFieldClick,
  onFormFieldDoubleClick
}, ref) => {
  const viewerRef = useRef(null);
  const readyRef = useRef(false);
  const pageObserverRef = useRef(null);
  const refreshFrameRef = useRef(null);
  const loadedDocumentKeyRef = useRef(null);
  const lastDocumentSourceRef = useRef(null);
  const bookmarkRetryRef = useRef(null);
  const thumbnailCacheRef = useRef(new Map());
  const pageContainerMapRef = useRef({});
  const suspendContainerRefreshRef = useRef(suspendContainerRefresh === true);
  const pendingRefreshReasonRef = useRef(null);
  // UX 2026-04-22 (Windows load failure): track per-document state for the
  // pdf-lib sanitize-and-retry path so we don't loop. Keyed by documentKey.
  const sanitizedRetryAttemptedRef = useRef(new Set());
  // Keep the latest documentSource bytes available to `handleDocumentLoadFailed`
  // without adding it to that callback's dep array (which would rebuild the
  // callback on every byte mutation and cause unnecessary re-renders).
  const currentDocumentSourceRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [resourcesReady, setResourcesReady] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoomValue, setZoomValue] = useState(100);
  const getViewerInstance = useCallback(() => viewerRef.current, []);
  const normalizedScrollDelayMs = useMemo(
    () => {
      const delay = Number(scrollDelayMs);
      return Math.max(0, Math.min(1000, Number.isFinite(delay) ? delay : 100));
    },
    [scrollDelayMs]
  );

  const emitDebugEvent = useCallback((type, payload = {}) => {
    onDebugEvent?.({
      type,
      at: Date.now(),
      ...payload
    });
  }, [onDebugEvent]);

  const clearBookmarkRetry = useCallback(() => {
    if (bookmarkRetryRef.current) {
      clearTimeout(bookmarkRetryRef.current);
      bookmarkRetryRef.current = null;
    }
  }, []);

  const patchSignatureStoreGuard = useCallback(() => {
    const viewer = getViewerInstance();
    const signatureModule = viewer?.viewerBase?.signatureModule;
    if (!signatureModule || signatureModule.__surveySignatureStoreGuardPatched) {
      return;
    }

    const originalStoreSignatureData = signatureModule.storeSignatureData;
    if (typeof originalStoreSignatureData !== 'function') {
      return;
    }

    signatureModule.storeSignatureData = function patchedStoreSignatureData(...args) {
      try {
        return originalStoreSignatureData.apply(this, args);
      } catch (error) {
        const message = String(error?.message || '');
        if (message.includes('addAction')) {
          return;
        }
        throw error;
      }
    };
    signatureModule.__surveySignatureStoreGuardPatched = true;
  }, [getViewerInstance]);

  const getViewerElement = useCallback(() => {
    const viewer = getViewerInstance();
    return viewer?.element || null;
  }, [getViewerInstance]);

  const getViewerContainer = useCallback(() => {
    const viewer = getViewerInstance();
    return (
      viewer?.viewerBase?.viewerContainer ||
      viewer?.element?.querySelector('.e-pv-viewer-container') ||
      null
    );
  }, [getViewerInstance]);

  const getPageLayerContainer = useCallback(() => {
    const viewer = getViewerInstance();
    return (
      viewer?.viewerBase?.pageContainer ||
      viewer?.element?.querySelector('.e-pv-page-container') ||
      null
    );
  }, [getViewerInstance]);

  const computePageContainerMap = useCallback(() => {
    const host = getViewerElement();
    if (!host) {
      return {};
    }

    const next = {};
    const pageDivs = host.querySelectorAll('.e-pv-page-div');
    pageDivs.forEach((pageDiv) => {
      if (!pageDiv) return;

      let resolvedPage = coercePositiveInt(pageDiv.dataset?.pageNumber, null);
      if (!resolvedPage) {
        const idMatch = pageDiv.id?.match(/_pageDiv_(\d+)$/);
        if (idMatch) {
          resolvedPage = Number(idMatch[1]) + 1;
        }
      }
      if (!resolvedPage) {
        const attrValue = pageDiv.getAttribute?.('data-page-number');
        resolvedPage = coercePositiveInt(attrValue, null);
      }
      if (!resolvedPage) {
        return;
      }

      pageDiv.dataset.pageNumber = String(resolvedPage);
      next[resolvedPage] = pageDiv;
    });

    return next;
  }, [getViewerElement]);

  const emitPageContainerMap = useCallback((next, reason = 'unspecified') => {
    const prev = pageContainerMapRef.current;
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    const changed =
      prevKeys.length !== nextKeys.length ||
      nextKeys.some((key) => prev[key] !== next[key]);

    if (!changed) {
      return;
    }

    pageContainerMapRef.current = next;
    onPageContainersChange?.(next, { reason, count: nextKeys.length });
    emitDebugEvent('page_containers_changed', {
      count: nextKeys.length,
      reason
    });
  }, [emitDebugEvent, onPageContainersChange]);

  const refreshPageContainers = useCallback((reason = 'refresh') => {
    const next = computePageContainerMap();
    emitPageContainerMap(next, reason);
  }, [computePageContainerMap, emitPageContainerMap]);

  const schedulePageContainerRefresh = useCallback((reason = 'schedule') => {
    if (refreshFrameRef.current !== null) return;
    const raf = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (cb) => setTimeout(cb, 16);
    refreshFrameRef.current = raf(() => {
      refreshFrameRef.current = null;
      refreshPageContainers(reason);
    });
  }, [refreshPageContainers]);

  const requestPageContainerRefresh = useCallback((reason = 'schedule') => {
    if (suspendContainerRefreshRef.current) {
      pendingRefreshReasonRef.current = reason;
      return;
    }
    schedulePageContainerRefresh(reason);
  }, [schedulePageContainerRefresh]);

  const clearRefreshFrame = useCallback(() => {
    if (refreshFrameRef.current === null) return;
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(refreshFrameRef.current);
    } else {
      clearTimeout(refreshFrameRef.current);
    }
    refreshFrameRef.current = null;
  }, []);

  useEffect(() => {
    suspendContainerRefreshRef.current = suspendContainerRefresh === true;
    if (suspendContainerRefreshRef.current) {
      return;
    }
    if (!pendingRefreshReasonRef.current) {
      return;
    }
    const pendingReason = pendingRefreshReasonRef.current;
    pendingRefreshReasonRef.current = null;
    schedulePageContainerRefresh(`resume:${pendingReason}`);
  }, [schedulePageContainerRefresh, suspendContainerRefresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleClearTextMarkupSelection = () => {
      clearTextMarkupSelectionState(getViewerInstance());
    };
    window.addEventListener('betasafe:clear-text-markup-selection', handleClearTextMarkupSelection);
    return () => {
      window.removeEventListener('betasafe:clear-text-markup-selection', handleClearTextMarkupSelection);
    };
  }, [getViewerInstance]);

  const disconnectPageObserver = useCallback(() => {
    if (pageObserverRef.current) {
      pageObserverRef.current.disconnect();
      pageObserverRef.current = null;
    }
  }, []);

  const connectPageObserver = useCallback(() => {
    disconnectPageObserver();
    const pageLayer = getPageLayerContainer();
    if (!pageLayer) {
      return;
    }
    const observer = new MutationObserver(() => {
      emitDebugEvent('page_container_mutation');
      requestPageContainerRefresh('mutation');
    });
    observer.observe(pageLayer, { childList: true });
    pageObserverRef.current = observer;
  }, [disconnectPageObserver, emitDebugEvent, getPageLayerContainer, requestPageContainerRefresh]);

  const normalizePdfBookmarks = useCallback((payloadOverride = null) => {
    const viewer = getViewerInstance();
    const bookmarkModule = viewer?.bookmark || viewer?.bookmarkView || viewer?.bookmarkViewModule;
    if (!bookmarkModule) return [];

    let payload = payloadOverride;
    try {
      if (!payload) {
        payload = bookmarkModule.getBookmarks?.();
      }
    } catch (error) {
      console.warn('[SyncfusionPDFContainer] Failed to get bookmarks:', error);
    }
    if (typeof payload === 'string') {
      payload = null;
    }

    const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);
    const readBookmarksArray = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (Array.isArray(value.bookMark)) return value.bookMark;
      if (Array.isArray(value.bookmarks)) return value.bookmarks;
      if (Array.isArray(value.Bookmarks)) return value.Bookmarks;
      return [];
    };
    const readDestinations = (value) => {
      if (!value) return null;
      if (Array.isArray(value)) return value;
      if (Array.isArray(value.bookMarkDestination)) return value.bookMarkDestination;
      if (Array.isArray(value.bookmarksDestination)) return value.bookmarksDestination;
      if (Array.isArray(value.BookmarksDestination)) return value.BookmarksDestination;
      if (value.bookMarkDestination && typeof value.bookMarkDestination === 'object') return value.bookMarkDestination;
      if (value.bookmarksDestination && typeof value.bookmarksDestination === 'object') return value.bookmarksDestination;
      if (value.BookmarksDestination && typeof value.BookmarksDestination === 'object') return value.BookmarksDestination;
      return typeof value === 'object' ? value : null;
    };

    const readDestinationMap = (container) => {
      if (!container || Array.isArray(container) || typeof container !== 'object') return null;
      return container;
    };

    const readDestinationArray = (container) => {
      if (!container) return [];
      if (Array.isArray(container)) return container;
      if (typeof container !== 'object') return [];
      const numericKeys = Object.keys(container).filter((key) => Number.isFinite(Number(key)));
      if (!numericKeys.length) return [];
      return numericKeys
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => container[key]);
    };

    const rawBookmarks = readBookmarksArray(
      payload?.bookmarks ||
      payload?.Bookmarks ||
      payload?.bookMark ||
      bookmarkModule.bookmarks ||
      bookmarkModule.Bookmarks
    );
    const destinations = readDestinations(
      payload?.bookmarksDestination ||
      payload?.BookmarksDestination ||
      payload?.bookMarkDestination ||
      bookmarkModule.bookmarksDestination ||
      bookmarkModule.BookmarksDestination
    );
    const destinationMap = readDestinationMap(destinations);
    const destinationArray = readDestinationArray(destinations);

    const resolveName = (bookmark) => {
      const name = bookmark?.Title ?? bookmark?.title ?? bookmark?.name;
      if (typeof name === 'string' && name.trim()) {
        return name.trim();
      }
      return 'Untitled';
    };

    const resolveDest = (bookmark) => {
      const rawIdCandidates = [
        bookmark?.Id,
        bookmark?.id,
        bookmark?.BookmarkId,
        bookmark?.bookmarkId,
        bookmark?.UniqueId,
        bookmark?.uniqueId
      ].filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
      const keyCandidates = Array.from(new Set(rawIdCandidates.map((value) => String(value))));
      const numericCandidates = Array.from(new Set(
        keyCandidates
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
          .map((value) => Math.trunc(value))
      ));

      const matchesEntryId = (entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const entryIdCandidates = [
          entry?.Id,
          entry?.id,
          entry?.BookmarkId,
          entry?.bookmarkId,
          entry?.UniqueId,
          entry?.uniqueId
        ].filter((value) => value !== undefined && value !== null);
        if (entryIdCandidates.length === 0) return false;
        return entryIdCandidates.some((entryId) => keyCandidates.includes(String(entryId)));
      };

      let destination = null;
      if (destinationMap) {
        for (const key of keyCandidates) {
          if (Object.prototype.hasOwnProperty.call(destinationMap, key)) {
            destination = destinationMap[key];
            break;
          }
        }
      }

      if (!destination && destinationMap) {
        for (const numericKey of numericCandidates) {
          const keyVariants = [numericKey, String(numericKey), numericKey - 1, String(numericKey - 1)];
          for (const variant of keyVariants) {
            if (Object.prototype.hasOwnProperty.call(destinationMap, variant)) {
              destination = destinationMap[variant];
              break;
            }
          }
          if (destination) break;
        }
      }

      if (!destination && destinationArray.length > 0) {
        destination = destinationArray.find((entry) => matchesEntryId(entry)) || null;
      }

      if (!destination && destinationMap) {
        destination = Object.values(destinationMap).find((entry) => matchesEntryId(entry)) || null;
      }

      if (!destination) {
        console.warn('[SyncfusionPDFContainer] Could not resolve destination for bookmark:', {
          name: resolveName(bookmark),
          ids: keyCandidates,
          numericIds: numericCandidates
        });
      }

      const readNumber = (value) => {
        const next = Number(value);
        return Number.isFinite(next) ? next : null;
      };

      const readPageIndex = (...candidates) => {
        for (const candidate of candidates) {
          const asNumber = readNumber(candidate);
          if (asNumber !== null) {
            const nextIndex = Math.trunc(asNumber);
            if (nextIndex >= 0) return nextIndex;
          }
        }
        return null;
      };

      const readPageNumber = (...candidates) => {
        for (const candidate of candidates) {
          const asNumber = readNumber(candidate);
          if (asNumber !== null) {
            const nextPage = Math.trunc(asNumber);
            if (nextPage > 0) return nextPage;
          }
        }
        return null;
      };

      let pageIndex = null;
      if (Array.isArray(destination) && destination.length > 0) {
        pageIndex = readPageIndex(destination[0]);
      }
      if (pageIndex === null) {
        pageIndex = readPageIndex(
          destination?.PageIndex,
          destination?.pageIndex
        );
      }
      if (pageIndex === null) {
        const oneBasedPage = readPageNumber(
          destination?.PageNumber,
          destination?.pageNumber,
          bookmark?.PageNumber,
          bookmark?.pageNumber,
          bookmark?.Page,
          bookmark?.page
        );
        if (oneBasedPage !== null) {
          pageIndex = oneBasedPage - 1;
        }
      }
      if (pageIndex === null) {
        const bookmarkIndex = readPageIndex(bookmark?.PageIndex, bookmark?.pageIndex);
        if (bookmarkIndex !== null && bookmarkIndex > 0) {
          pageIndex = bookmarkIndex;
        }
      }

      const pageNumber = Number.isFinite(pageIndex) ? pageIndex + 1 : null;
      const y = readNumber(destination?.Y ?? destination?.y);
      const zoom = readNumber(destination?.Zoom ?? destination?.zoom);

      return {
        pageIndex,
        pageNumber,
        y,
        zoom,
        fit: destination ? 'XYZ' : null
      };
    };

    const makeSourceId = (bookmark, pathKey) => {
      const rawId = bookmark?.Id ?? bookmark?.id;
      if (rawId !== undefined && rawId !== null) {
        // Raw Syncfusion bookmark ids are not always globally unique.
        // Include structural path context so nested folders keep stable unique ids.
        return `syncfusion:${rawId}:${pathKey}`;
      }
      return `syncfusion:${pathKey}`;
    };

    const extracted = [];
    const walk = (bookmark, parentId = null, path = [], order = 0) => {
      const name = resolveName(bookmark);
      const nextPath = [...path, name];
      const pathKey = nextPath.join('>');
      const sourceId = makeSourceId(bookmark, `${pathKey}#${order}`);
      const idValue = `pdf:${sourceId}`;
      const childNodes = asArray(bookmark?.Child ?? bookmark?.child ?? bookmark?.children);
      const dest = resolveDest(bookmark);
      const pageNumber = Number.isFinite(dest.pageNumber) ? dest.pageNumber : null;
      const pageIds = pageNumber ? [pageNumber] : [];

      extracted.push({
        id: idValue,
        name,
        type: childNodes.length > 0 ? 'folder' : 'bookmark',
        pageIds,
        parentId,
        source: 'pdf',
        sourceId,
        outlinePath: nextPath,
        order,
        dest,
        isFromPDF: true
      });

      childNodes.forEach((child, index) => {
        walk(child, idValue, nextPath, index);
      });
    };

    asArray(rawBookmarks).forEach((bookmark, index) => {
      walk(bookmark, null, [], index);
    });

    return extracted;
  }, [getViewerInstance]);

  const scheduleBookmarkExtraction = useCallback((attempt = 0) => {
    const viewer = getViewerInstance();
    const bookmarkModule = viewer?.bookmark || viewer?.bookmarkView || viewer?.bookmarkViewModule;

    let rendererPayload = null;
    if (bookmarkModule && attempt === 0 && !bookmarkModule.bookmarks && bookmarkModule.createRequestForBookmarks) {
      try {
        bookmarkModule.createRequestForBookmarks();
      } catch (error) {
        console.warn('[SyncfusionPDFContainer] Unable to request bookmarks:', error);
      }
    }

    if (viewer?.pdfRendererModule?.getBookmarks) {
      try {
        rendererPayload = viewer.pdfRendererModule.getBookmarks({
          bookmarkStyles: true,
          uniqueId: viewer?.viewerBase?.documentId
        });
      } catch (error) {
        console.warn('[SyncfusionPDFContainer] Renderer bookmark read failed:', error);
      }
    }

    const bookmarks = normalizePdfBookmarks(rendererPayload);
    if (bookmarks.length > 0) {
      onPDFBookmarksAvailable?.(bookmarks);
      emitDebugEvent('bookmarks_available', { count: bookmarks.length, attempt });
      return;
    }

    if (attempt >= MAX_BOOKMARK_RETRIES) {
      return;
    }

    const delay = attempt === 0 ? 200 : 250;
    bookmarkRetryRef.current = setTimeout(() => {
      scheduleBookmarkExtraction(attempt + 1);
    }, delay);
  }, [emitDebugEvent, getViewerInstance, normalizePdfBookmarks, onPDFBookmarksAvailable]);

  const getRenderedPageCanvas = useCallback((targetPage) => {
    const knownContainer = pageContainerMapRef.current[targetPage];
    const pageContainer = knownContainer ||
      getViewerElement()?.querySelector?.(`.e-pv-page-div[data-page-number="${targetPage}"]`) ||
      null;
    if (!pageContainer) {
      return null;
    }

    const canvasNodes = Array.from(pageContainer.querySelectorAll('canvas'));
    if (!canvasNodes.length) {
      return null;
    }

    let bestCanvas = null;
    let bestScore = -1;
    canvasNodes.forEach((canvasNode) => {
      const width = Number(canvasNode.width) || Math.round(canvasNode.clientWidth) || 0;
      const height = Number(canvasNode.height) || Math.round(canvasNode.clientHeight) || 0;
      if (width <= 0 || height <= 0) return;
      const area = width * height;
      const isPageCanvas = canvasNode.classList?.contains('e-pv-page-canvas');
      const score = area + (isPageCanvas ? 1_000_000_000_000 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestCanvas = canvasNode;
      }
    });

    return bestCanvas;
  }, [getViewerElement]);

  const isLikelyBlackThumbnail = useCallback((canvasNode) => {
    if (!canvasNode) return false;
    const sourceWidth = Number(canvasNode.width) || 0;
    const sourceHeight = Number(canvasNode.height) || 0;
    if (sourceWidth <= 0 || sourceHeight <= 0) return false;

    try {
      const probeWidth = Math.max(8, Math.min(24, sourceWidth));
      const probeHeight = Math.max(8, Math.min(24, sourceHeight));
      const probeCanvas = document.createElement('canvas');
      probeCanvas.width = probeWidth;
      probeCanvas.height = probeHeight;
      const probeContext = probeCanvas.getContext('2d', { willReadFrequently: true });
      if (!probeContext) return false;

      probeContext.drawImage(canvasNode, 0, 0, probeWidth, probeHeight);
      const { data } = probeContext.getImageData(0, 0, probeWidth, probeHeight);
      const totalPixels = probeWidth * probeHeight;
      if (!data || totalPixels <= 0) return false;

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

      return opaqueRatio >= 0.9 && darkOpaqueRatio >= 0.94 && contrast <= 10;
    } catch {
      return false;
    }
  }, []);

  const getThumbnailDataUrl = useCallback((pageNumber, options = {}) => {
    const { timeout = 2500, interval = 100, targetWidth = 220 } = options;
    const targetPage = coercePositiveInt(pageNumber, null);
    if (!targetPage) {
      return Promise.resolve(null);
    }

    const cached = thumbnailCacheRef.current.get(targetPage);
    if (cached) {
      return Promise.resolve(cached);
    }

    return new Promise((resolve) => {
      const startedAt = Date.now();

      const attemptRead = () => {
        const pageCanvas = getRenderedPageCanvas(targetPage);
        const sourceWidth = Number(pageCanvas?.width) || Math.round(pageCanvas?.clientWidth || 0);
        const sourceHeight = Number(pageCanvas?.height) || Math.round(pageCanvas?.clientHeight || 0);

        if (pageCanvas && sourceWidth > 0 && sourceHeight > 0) {
          try {
            const ratio = Math.min(1, targetWidth / sourceWidth);
            const outputWidth = Math.max(1, Math.round(sourceWidth * ratio));
            const outputHeight = Math.max(1, Math.round(sourceHeight * ratio));

            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = outputWidth;
            thumbCanvas.height = outputHeight;
            const thumbContext = thumbCanvas.getContext('2d', { alpha: false });
            if (!thumbContext) {
              resolve(null);
              return;
            }

            thumbContext.fillStyle = '#fff';
            thumbContext.fillRect(0, 0, outputWidth, outputHeight);
            thumbContext.drawImage(pageCanvas, 0, 0, outputWidth, outputHeight);

            if (isLikelyBlackThumbnail(thumbCanvas)) {
              emitDebugEvent('thumbnail_black_placeholder', {
                pageNumber: targetPage
              });
              if (Date.now() - startedAt >= timeout) {
                resolve(null);
              } else {
                setTimeout(attemptRead, interval);
              }
              return;
            }

            const thumbnail = {
              src: thumbCanvas.toDataURL('image/jpeg', 0.82),
              width: outputWidth,
              height: outputHeight,
              containerWidth: outputWidth,
              containerHeight: outputHeight,
              source: 'syncfusion-render-canvas'
            };
            thumbnailCacheRef.current.set(targetPage, thumbnail);
            emitDebugEvent('thumbnail_ready', {
              pageNumber: targetPage,
              source: 'render-canvas'
            });
            resolve(thumbnail);
            return;
          } catch (error) {
            console.warn('[SyncfusionPDFContainer] Thumbnail snapshot failed:', error);
            resolve(null);
            return;
          }
        }

        if (Date.now() - startedAt >= timeout) {
          resolve(null);
          return;
        }

        setTimeout(attemptRead, interval);
      };

      attemptRead();
    });
  }, [emitDebugEvent, getRenderedPageCanvas, isLikelyBlackThumbnail]);

  const resolveBookmarkDestination = useCallback((sourceId = null, destOverride = null, preferSourceLookup = false) => {
    const parseNumber = (value) => {
      const next = Number(value);
      return Number.isFinite(next) ? next : null;
    };
    const readPageIndex = (value) => {
      const next = parseNumber(value);
      if (next === null) return null;
      const index = Math.trunc(next);
      return index >= 0 ? index : null;
    };
    const readPageNumber = (value) => {
      const next = parseNumber(value);
      if (next === null) return null;
      const page = Math.trunc(next);
      return page > 0 ? page : null;
    };

    const resolveFromOverride = (value) => {
      if (!value || typeof value !== 'object') return null;

      let pageIndex = null;
      let y = 0;

      const directIndex = readPageIndex(
        value.pageIndex ?? value.PageIndex ?? value.index ?? value.Index
      );
      if (directIndex !== null) {
        pageIndex = directIndex;
      } else {
        const oneBasedPage = readPageNumber(
          value.pageNumber ??
          value.PageNumber ??
          value.page ??
          value.Page ??
          value.pageId ??
          value.PageId
        );
        if (oneBasedPage !== null) {
          pageIndex = oneBasedPage - 1;
        }
      }

      if (pageIndex === null) {
        return null;
      }

      const directY = parseNumber(value.y ?? value.Y);
      if (directY !== null) {
        y = directY;
      }

      return { pageIndex, y, pageNumber: pageIndex + 1 };
    };

    const readDestinationStore = (bookmarkModule) => (
      bookmarkModule?.bookmarksDestination ||
      bookmarkModule?.BookmarksDestination ||
      bookmarkModule?.bookMarkDestination ||
      null
    );

    const readDestinationContainer = (destinationStore) => {
      if (!destinationStore) return null;
      if (Array.isArray(destinationStore)) return destinationStore;
      return (
        destinationStore?.bookMarkDestination ||
        destinationStore?.bookmarksDestination ||
        destinationStore?.BookmarksDestination ||
        destinationStore
      );
    };

    const readDestinationMap = (container) => {
      if (!container || Array.isArray(container) || typeof container !== 'object') {
        return null;
      }
      return container;
    };

    const readDestinationArray = (container) => {
      if (!container) return [];
      if (Array.isArray(container)) return container;
      if (typeof container !== 'object') return [];
      const numericKeys = Object.keys(container).filter((key) => Number.isFinite(Number(key)));
      if (!numericKeys.length) return [];
      return numericKeys
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => container[key]);
    };

    const resolveFromDestinationEntry = (entry) => {
      if (!entry || typeof entry !== 'object') return null;

      let pageIndex = null;
      let y = 0;
      const resolvedIndex = readPageIndex(
        entry.PageIndex ?? entry.pageIndex ?? entry.Index ?? entry.index
      );
      if (resolvedIndex === null) {
        const oneBasedPage = readPageNumber(
          entry.PageNumber ?? entry.pageNumber
        );
        if (oneBasedPage === null) return null;
        pageIndex = oneBasedPage - 1;
      } else {
        pageIndex = resolvedIndex;
      }

      const resolvedY = parseNumber(entry.Y ?? entry.y);
      if (resolvedY !== null) {
        y = resolvedY;
      }

      return { pageIndex, y, pageNumber: pageIndex + 1 };
    };

    const resolveFromSource = () => {
      const viewer = getViewerInstance();
      const bookmarkModule = viewer?.bookmark || viewer?.bookmarkView || viewer?.bookmarkViewModule;
      if (!sourceId) return null;

      // First try matching against normalized bookmark entries, which carry stable source ids.
      try {
        const normalized = normalizePdfBookmarks();
        if (Array.isArray(normalized) && normalized.length > 0) {
          const exact = normalized.find((entry) => (
            entry?.sourceId === sourceId ||
            entry?.id === sourceId ||
            entry?.id === `pdf:${sourceId}`
          )) || null;

          if (exact) {
            const fromDest = resolveFromOverride(exact.dest);
            if (fromDest) {
              return fromDest;
            }

            const firstPage = Array.isArray(exact.pageIds) ? exact.pageIds[0] : null;
            const oneBasedPage = readPageNumber(firstPage);
            if (oneBasedPage !== null) {
              return { pageIndex: oneBasedPage - 1, y: 0, pageNumber: oneBasedPage };
            }
          }
        }
      } catch {
        // Ignore normalization read errors and continue with module destination lookup.
      }

      if (!bookmarkModule) return null;

      const rawIdMatch = String(sourceId).match(/^syncfusion:([^:]+)/);
      const rawIdText = rawIdMatch ? rawIdMatch[1] : null;
      const rawIdNumber = parseNumber(rawIdText);

      const destinationStore = readDestinationStore(bookmarkModule);
      const destinationContainer = readDestinationContainer(destinationStore);
      const destinationMap = readDestinationMap(destinationContainer);
      const destinationArray = readDestinationArray(destinationContainer);

      if (destinationArray.length === 0 && !destinationMap) {
        return null;
      }

      let matched = null;
      if (rawIdText !== null && destinationMap) {
        matched = destinationMap[rawIdText] ?? null;
      }
      if (rawIdNumber !== null) {
        const index = Math.trunc(rawIdNumber);
        if (!matched && destinationMap) {
          matched =
            destinationMap[index] ??
            destinationMap[String(index)] ??
            destinationMap[index - 1] ??
            destinationMap[String(index - 1)] ??
            null;
        }
        if (!matched && destinationArray.length > 0) {
          matched = destinationArray[index] ?? destinationArray[index - 1] ?? null;
        }
      }
      if (!matched && rawIdText !== null && destinationArray.length > 0) {
        matched = destinationArray.find((entry) => {
          const entryId = entry?.Id ?? entry?.id ?? entry?.BookmarkId ?? entry?.bookmarkId;
          return entryId !== undefined && entryId !== null && String(entryId) === String(rawIdText);
        }) || null;
      }
      if (!matched) return null;

      return resolveFromDestinationEntry(matched);
    };

    if (preferSourceLookup) {
      const sourceResolved = resolveFromSource();
      if (sourceResolved) return sourceResolved;
      return resolveFromOverride(destOverride);
    }

    const overrideResolved = resolveFromOverride(destOverride);
    if (overrideResolved) return overrideResolved;
    return resolveFromSource();
  }, [getViewerInstance, normalizePdfBookmarks]);

  const scrollViewerToPage = useCallback((page) => {
    const target = coercePositiveInt(page, null);
    if (!target) return false;

    const host = getViewerElement();
    const container = getViewerContainer();
    if (!host || !container) return false;

    const pageElement =
      pageContainerMapRef.current[target] ||
      host.querySelector(`.e-pv-page-div[data-page-number="${target}"]`) ||
      host.querySelector(`[id$="_pageDiv_${target - 1}"]`) ||
      null;

    if (!pageElement) return false;

    const containerRect = container.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    const deltaTop = pageRect.top - containerRect.top;
    const nextTop = Math.max(container.scrollTop + deltaTop, 0);

    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: nextTop, behavior: 'smooth' });
    } else {
      container.scrollTop = nextTop;
    }

    return true;
  }, [getViewerContainer, getViewerElement]);

  useImperativeHandle(ref, () => ({
    goToPage: (page) => {
      const viewer = getViewerInstance();
      const target = coercePositiveInt(page, null);
      if (!target || !viewer) return false;
      if (viewer?.navigationModule?.goToPage) {
        viewer.navigationModule.goToPage(target);
        return true;
      }
      if (viewer?.navigation?.goToPage) {
        viewer.navigation.goToPage(target);
        return true;
      }
      return scrollViewerToPage(target);
    },
    goToBookmarkSource: (sourceId, destOverride = null, preferSourceLookup = false) => {
      const viewer = getViewerInstance();
      const bookmarkModule = viewer?.bookmark || viewer?.bookmarkView || viewer?.bookmarkViewModule;
      if (!viewer) return false;

      const rawIdMatch = sourceId ? String(sourceId).match(/^syncfusion:([^:]+)/) : null;
      const rawIdText = rawIdMatch ? rawIdMatch[1] : null;
      const rawIdNumber = Number(rawIdText);

      // Prefer Syncfusion's native bookmark-id navigation when available.
      // It resolves bookmark destinations internally from the same source used by the sidebar.
      if (Number.isFinite(rawIdNumber) && typeof bookmarkModule?.navigateToBookmark === 'function') {
        try {
          bookmarkModule.navigateToBookmark(rawIdNumber, '', '');
          return true;
        } catch {
          // Fall through to destination-based resolution.
        }
      }

      const resolved = resolveBookmarkDestination(sourceId, destOverride, preferSourceLookup);
      if (!resolved) return false;

      if (typeof bookmarkModule?.goToBookmark === 'function') {
        bookmarkModule.goToBookmark(resolved.pageIndex, resolved.y ?? 0);
        return true;
      }
      if (typeof viewer?.bookmark?.goToBookmark === 'function') {
        viewer.bookmark.goToBookmark(resolved.pageIndex, resolved.y ?? 0);
        return true;
      }
      if (typeof viewer?.navigationModule?.goToPage === 'function') {
        viewer.navigationModule.goToPage(resolved.pageNumber);
        return true;
      }
      if (typeof viewer?.navigation?.goToPage === 'function') {
        viewer.navigation.goToPage(resolved.pageNumber);
        return true;
      }
      return scrollViewerToPage(resolved.pageNumber);
    },
    resolveBookmarkPageFromSource: (sourceId, destOverride = null, preferSourceLookup = true) => {
      const resolved = resolveBookmarkDestination(sourceId, destOverride, preferSourceLookup);
      return resolved?.pageNumber ?? null;
    },
    getPageCount: () => {
      const viewer = getViewerInstance();
      return coercePositiveInt(viewer?.pageCount, pageCount || 0) || 0;
    },
    getCurrentPage: () => {
      const viewer = getViewerInstance();
      return coercePositiveInt(viewer?.currentPageNumber, currentPage || 1) || 1;
    },
    getZoomValue: () => {
      const viewer = getViewerInstance();
      return coerceZoom(viewer?.zoomValue, zoomValue || 100);
    },
    getPageContainer: (page) => {
      const target = coercePositiveInt(page, null);
      if (!target) return null;
      const known = pageContainerMapRef.current[target];
      if (known) return known;
      const host = getViewerElement();
      if (!host) return null;
      return host.querySelector(`.e-pv-page-div[data-page-number="${target}"]`) || null;
    },
    getPageContainers: () => ({ ...pageContainerMapRef.current }),
    getViewerContainer,
    getPageLayerContainer,
    getThumbnailDataUrl,
    getPDFBookmarks: () => normalizePdfBookmarks(),
    // UX 2026-04-22: Print menu wiring. Called from the Electron "Print PDF…"
    // menu item (Cmd+P). Uses Syncfusion's built-in print module so the PDF
    // prints cleanly (rasterized pages), not the whole Electron chrome.
    print: () => {
      const viewer = getViewerInstance();
      console.log('[Print] menu invoked — viewer ready:', !!viewer, 'pageCount:', viewer?.pageCount);
      if (!viewer) {
        console.warn('[Print] no viewer instance available');
        return false;
      }
      try {
        if (viewer?.printModule?.print) {
          console.log('[Print] calling viewer.printModule.print()');
          viewer.printModule.print();
          return true;
        }
        if (typeof viewer?.print === 'function') {
          console.log('[Print] calling viewer.print()');
          viewer.print();
          return true;
        }
        console.warn('[Print] no print method found on viewer, falling back to window.print');
        window.print();
        return true;
      } catch (err) {
        console.error('[Print] error while printing:', err);
        return false;
      }
    },
    load: (source, password = '') => {
      const viewer = getViewerInstance();
      viewer?.load?.(source, password);
    },
    saveAsBlob: async () => {
      const viewer = getViewerInstance();
      if (typeof viewer?.saveAsBlob !== 'function') return null;
      return viewer.saveAsBlob();
    },
    findTextAsync: async (query, matchCase = false) => {
      const viewer = getViewerInstance();
      const textSearchModule = viewer?.textSearchModule;
      if (!query || typeof textSearchModule?.findTextAsync !== 'function') return null;
      return textSearchModule.findTextAsync(query, matchCase);
    },
    searchText: (query, matchCase = false) => {
      const viewer = getViewerInstance();
      const textSearchModule = viewer?.textSearchModule;
      if (!query || typeof textSearchModule?.searchText !== 'function') return false;
      textSearchModule.cancelTextSearch?.();
      textSearchModule.searchText(query, matchCase);
      return true;
    },
    refreshTextSearchHighlights: (query, matchCase = false, options = null) => {
      const viewer = getViewerInstance();
      const textSearchModule = viewer?.textSearchModule;
      const normalizedQuery = typeof query === 'string' ? query.trim() : '';
      if (!normalizedQuery || !textSearchModule) return false;
      try {
        const hasSearchMatches = Array.isArray(textSearchModule.searchMatches) &&
          textSearchModule.searchMatches.some((matches) => Array.isArray(matches) && matches.length > 0);
        if (
          textSearchModule.searchString !== normalizedQuery ||
          !hasSearchMatches
        ) {
          if (typeof textSearchModule.searchText !== 'function') return false;
          textSearchModule.searchText(normalizedQuery, matchCase);
          return true;
        }

        textSearchModule.searchString = normalizedQuery;
        textSearchModule.isMatchCase = matchCase;
        textSearchModule.programaticalSearch = true;
        textSearchModule.isSingleSearch = true;
        const activeMatchIndex = Number(
          typeof options === 'object' && options
            ? options.activeMatchIndex
            : NaN
        );
        if (
          Number.isInteger(activeMatchIndex) &&
          activeMatchIndex >= 0 &&
          Array.isArray(textSearchModule.searchMatches)
        ) {
          let remaining = activeMatchIndex;
          for (let pageIndex = 0; pageIndex < textSearchModule.searchMatches.length; pageIndex += 1) {
            const matches = textSearchModule.searchMatches[pageIndex];
            const matchCount = Array.isArray(matches) ? matches.length : 0;
            if (remaining < matchCount) {
              textSearchModule.searchPageIndex = pageIndex;
              textSearchModule.searchIndex = remaining;
              break;
            }
            remaining -= matchCount;
          }
        }
        const host = getViewerElement();
        const highlightRoot = host || document;
        highlightRoot
          ?.querySelectorAll?.('.e-pv-search-text-highlight, .e-pv-search-text-highlightother')
          ?.forEach((element) => element.remove());
        if (typeof textSearchModule.highlightOthers === 'function') {
          textSearchModule.highlightOthers(true);
        }
        return true;
      } catch (error) {
        console.warn('[SyncfusionPDFContainer] Failed to refresh text search highlights:', error);
        return false;
      }
    },
    searchToMatch: async (query, matchIndex = 0, matchCase = false) => {
      const viewer = getViewerInstance();
      const textSearchModule = viewer?.textSearchModule;
      if (!query || typeof textSearchModule?.searchText !== 'function') return false;

      textSearchModule.cancelTextSearch?.();
      textSearchModule.searchText(query, matchCase);

      const targetIndex = Math.max(0, Math.trunc(Number(matchIndex) || 0));
      if (targetIndex === 0 || typeof textSearchModule?.searchNext !== 'function') return true;

      for (let step = 0; step < targetIndex; step += 1) {
        await new Promise(resolve => setTimeout(resolve, step === 0 ? 70 : 24));
        textSearchModule.searchNext();
      }

      return true;
    },
    cancelTextSearch: () => {
      const viewer = getViewerInstance();
      viewer?.textSearchModule?.cancelTextSearch?.();
    },
    selectTextMarkupAtPoint: (pageNumber, point, radius = 4, event = null) => {
      const viewer = getViewerInstance();
      return selectTextMarkupAtPagePoint(viewer, pageNumber, point, radius, event);
    },
    selectTextMarkupAtClientPoint: (clientX, clientY, radius = 4, event = null) => {
      const viewer = getViewerInstance();
      if (!viewer || !Number.isFinite(Number(clientX)) || !Number.isFinite(Number(clientY))) return null;
      const host = getViewerElement();
      const pageDivs = Array.from(host?.querySelectorAll?.('.e-pv-page-div, [id*="_pageDiv_"]') || []);
      for (const pageDiv of pageDivs) {
        const rect = pageDiv.getBoundingClientRect();
        if (
          clientX < rect.left ||
          clientX > rect.right ||
          clientY < rect.top ||
          clientY > rect.bottom
        ) {
          continue;
        }
        const pageIndexMatch = String(pageDiv.id || '').match(/_pageDiv_(\d+)$/);
        const pageIndexFromId = pageIndexMatch ? Number(pageIndexMatch[1]) : null;
        const pageNumber = coercePositiveInt(pageDiv.dataset?.pageNumber, null) ||
          (Number.isFinite(pageIndexFromId) ? pageIndexFromId + 1 : null);
        if (!pageNumber) continue;
        const pageIndex = pageNumber - 1;
        const zoom = Math.max(0.1, Number(viewer?.viewerBase?.getZoomFactor?.() || 1));
        const syncfusionPageSize = viewer?.viewerBase?.pageSize?.[pageIndex] || {};
        const pageWidth = Number(syncfusionPageSize.width) || rect.width / zoom;
        const pageHeight = Number(syncfusionPageSize.height) || rect.height / zoom;
        const point = {
          x: ((clientX - rect.left) / rect.width) * pageWidth,
          y: ((clientY - rect.top) / rect.height) * pageHeight
        };
        const selected = selectTextMarkupAtPagePoint(viewer, pageNumber, point, radius, event);
        if (selected) return selected;
      }
      return null;
    },
    deleteSelectedTextMarkupAnnotation: () => {
      const viewer = getViewerInstance();
      const textMarkupModule = getTextMarkupModule(viewer);
      const annotation = textMarkupModule?.currentTextMarkupAnnotation;
      const pageIndex = Number(textMarkupModule?.selectTextMarkupCurrentPage);
      if (!annotation || !Number.isFinite(pageIndex)) return false;
      return deleteTextMarkupAnnotation(viewer, annotation, pageIndex);
    },
    eraseTextMarkupAtPoints: (pageNumber, points = [], radius = 0) => {
      const viewer = getViewerInstance();
      if (!viewer || !Array.isArray(points) || points.length === 0) return 0;

      const targetPage = Number(pageNumber);
      const targetsToDelete = [];
      const seen = new Set();
      for (const { annotation, pageIndex } of collectTextMarkupAnnotations(viewer, pageNumber)) {
        if (Number.isFinite(targetPage) && Number.isFinite(pageIndex) && pageIndex !== targetPage - 1) continue;
        const boundsList = getTextMarkupBoundsList(annotation);
        const touched = boundsList.some((bounds) => points.some((point) => pointTouchesBounds(point, bounds, radius)));
        if (!touched) continue;

        const id = getAnnotationId(annotation);
        const key = `${id || targetsToDelete.length}:${Number.isFinite(pageIndex) ? pageIndex : 'unknown'}`;
        if (!seen.has(key)) {
          seen.add(key);
          targetsToDelete.push({ annotation, pageIndex, id });
        }
      }

      const annotationApi = viewer.annotationModule || viewer.annotation;
      let deleted = 0;
      targetsToDelete.forEach(({ annotation, pageIndex, id }) => {
        try {
          if (deleteTextMarkupAnnotation(viewer, annotation, pageIndex)) {
            deleted += 1;
            return;
          }
          if (id && typeof annotationApi?.deleteAnnotationById === 'function') {
            annotationApi.deleteAnnotationById(id);
            deleted += 1;
            return;
          }
          if (id && typeof annotationApi?.selectAnnotation === 'function') {
            annotationApi.selectAnnotation(id);
            if (typeof annotationApi?.deleteAnnotation === 'function') {
              annotationApi.deleteAnnotation();
              deleted += 1;
            }
          }
        } catch (error) {
          console.warn('[SyncfusionPDFContainer] Failed to delete text markup annotation:', error);
        }
      });
      return deleted;
    },
    clearTextSelection: () => {
      const viewer = getViewerInstance();
      clearTextMarkupSelectionState(viewer);
      viewer?.textSelectionModule?.clearTextSelection?.();
    },
    navigationModule: {
      goToPage: (page) => {
        const viewer = getViewerInstance();
        const target = coercePositiveInt(page, null);
        if (!target || !viewer) return false;
        if (viewer?.navigationModule?.goToPage) {
          viewer.navigationModule.goToPage(target);
          return true;
        }
        if (viewer?.navigation?.goToPage) {
          viewer.navigation.goToPage(target);
          return true;
        }
        return scrollViewerToPage(target);
      }
    },
    magnificationModule: {
      zoomTo: (nextZoom) => {
        const viewer = getViewerInstance();
        viewer?.magnificationModule?.zoomTo?.(nextZoom);
      },
      fitToPage: () => {
        const viewer = getViewerInstance();
        viewer?.magnificationModule?.fitToPage?.();
      },
      fitToWidth: () => {
        const viewer = getViewerInstance();
        viewer?.magnificationModule?.fitToWidth?.();
      },
      initiateMouseZoom: (x, y, nextZoom) => {
        const viewer = getViewerInstance();
        viewer?.magnificationModule?.initiateMouseZoom?.(x, y, nextZoom);
      }
    },
    textSelectionModule: {
      clearTextSelection: () => {
        const viewer = getViewerInstance();
        clearTextMarkupSelectionState(viewer);
        viewer?.textSelectionModule?.clearTextSelection?.();
      }
    },
    get viewerBase() {
      const viewer = getViewerInstance();
      return viewer?.viewerBase;
    },
    get element() {
      return getViewerElement();
    },
    get pageCount() {
      const viewer = getViewerInstance();
      return coercePositiveInt(viewer?.pageCount, pageCount || 0) || 0;
    },
    get currentPageNumber() {
      const viewer = getViewerInstance();
      return coercePositiveInt(viewer?.currentPageNumber, currentPage || 1) || 1;
    },
    get zoomValue() {
      const viewer = getViewerInstance();
      return coerceZoom(viewer?.zoomValue, zoomValue || 100);
    },

    // KAL-47: imperative wrapper around Syncfusion's FormDesigner API.
    // We intentionally expose only the operations Survey needs — create,
    // place-mode, select, update, delete, list — so the App layer cannot
    // accidentally drive Syncfusion's built-in form-designer chrome.
    setDesignerMode: (enabled) => {
      const viewer = getViewerInstance();
      if (!viewer) return false;
      const next = enabled === true;
      try {
        viewer.designerMode = next;
        return true;
      } catch (err) {
        console.warn('[KAL-47] setDesignerMode failed', err);
        return false;
      }
    },
    setFormFieldMode: (formFieldType, options) => {
      const viewer = getViewerInstance();
      const designerModule = viewer?.formDesignerModule;
      if (!viewer || !designerModule || typeof designerModule.setFormFieldMode !== 'function') {
        return false;
      }
      try {
        // Designer mode must be ON for the placement crosshair to react.
        if (viewer.designerMode !== true) viewer.designerMode = true;
        designerModule.setFormFieldMode(formFieldType, options);
        return true;
      } catch (err) {
        console.warn('[KAL-47] setFormFieldMode failed', { formFieldType, err });
        return false;
      }
    },
    addFormField: (formFieldType, options) => {
      const viewer = getViewerInstance();
      const designerModule = viewer?.formDesignerModule;
      if (!viewer || !designerModule || typeof designerModule.addFormField !== 'function') {
        return null;
      }
      try {
        return designerModule.addFormField(formFieldType, options);
      } catch (err) {
        console.warn('[KAL-47] addFormField failed', { formFieldType, err });
        return null;
      }
    },
    updateFormField: (formFieldId, options) => {
      const viewer = getViewerInstance();
      const designerModule = viewer?.formDesignerModule;
      if (!viewer || !designerModule || typeof designerModule.updateFormField !== 'function') {
        return false;
      }
      try {
        designerModule.updateFormField(formFieldId, options);
        return true;
      } catch (err) {
        console.warn('[KAL-47] updateFormField failed', { formFieldId, err });
        return false;
      }
    },
    deleteFormField: (formFieldIdOrObject) => {
      const viewer = getViewerInstance();
      if (!viewer) return false;
      // Syncfusion exposes a delete on the form-designer module; if not
      // present we fall back to the form-fields module's deleteFormField.
      const designerModule = viewer.formDesignerModule;
      const formFieldsModule = viewer.formFieldsModule;
      try {
        if (designerModule && typeof designerModule.deleteFormField === 'function') {
          designerModule.deleteFormField(formFieldIdOrObject);
          return true;
        }
        if (formFieldsModule && typeof formFieldsModule.deleteFormField === 'function') {
          formFieldsModule.deleteFormField(formFieldIdOrObject);
          return true;
        }
      } catch (err) {
        console.warn('[KAL-47] deleteFormField failed', err);
      }
      return false;
    },
    selectFormField: (formFieldId) => {
      const viewer = getViewerInstance();
      const designerModule = viewer?.formDesignerModule;
      if (!viewer || !designerModule || typeof designerModule.selectFormField !== 'function') {
        return false;
      }
      try {
        designerModule.selectFormField(formFieldId);
        return true;
      } catch (err) {
        console.warn('[KAL-47] selectFormField failed', { formFieldId, err });
        return false;
      }
    },
    getFormFieldCollection: () => {
      const viewer = getViewerInstance();
      if (!viewer) return [];
      // Two surfaces in different Syncfusion builds; prefer the public one.
      const coll = viewer.formFieldCollections || viewer.formFieldCollection || [];
      return Array.isArray(coll) ? coll.slice() : [];
    }
  }), [
    currentPage,
    getPageLayerContainer,
    getThumbnailDataUrl,
    getViewerContainer,
    getViewerElement,
    getViewerInstance,
    normalizePdfBookmarks,
    pageCount,
    resolveBookmarkDestination,
    scrollViewerToPage,
    zoomValue
  ]);

  const handleCreated = useCallback(() => {
    readyRef.current = true;
    patchSignatureStoreGuard();
    setIsReady(true);
    emitDebugEvent('viewer_created');
    requestPageContainerRefresh('viewer_created');
    connectPageObserver();
    // KAL-47: dev-only window hook so the standalone Playwright verify
    // script (and ad-hoc devtools sessions) can poke at the Syncfusion
    // viewer without scraping internal DOM. Skipped in production builds
    // because Vite tree-shakes the import.meta.env.PROD branch.
    if (typeof window !== 'undefined') {
      try {
        // eslint-disable-next-line no-underscore-dangle
        window.__syncfusionPdfViewer__ = getViewerInstance();
      } catch {/* never hard-fail the viewer for a debug hook */}
    }
  }, [connectPageObserver, emitDebugEvent, getViewerInstance, patchSignatureStoreGuard, requestPageContainerRefresh]);

  const handleResourcesLoaded = useCallback(() => {
    setResourcesReady(true);
    emitDebugEvent('resources_loaded');
    requestPageContainerRefresh('resources_loaded');
    connectPageObserver();
  }, [connectPageObserver, emitDebugEvent, requestPageContainerRefresh]);

  const handleDocumentLoad = useCallback((args) => {
    const viewer = getViewerInstance();
    const resolvedPageCount = resolvePageCountFromArgs(args, viewer);
    const resolvedCurrent = coercePositiveInt(
      args?.currentPageNumber ?? viewer?.currentPageNumber ?? 1,
      1
    );
    const resolvedZoom = coerceZoom(args?.zoomValue ?? viewer?.zoomValue ?? 100, 100);

    setPageCount(resolvedPageCount);
    setCurrentPage(resolvedCurrent);
    setZoomValue(resolvedZoom);

    thumbnailCacheRef.current.clear();
    requestPageContainerRefresh('document_load');
    connectPageObserver();

    clearBookmarkRetry();
    scheduleBookmarkExtraction(0);

    onDocumentLoaded?.({
      pageCount: resolvedPageCount,
      currentPageNumber: resolvedCurrent,
      zoomValue: resolvedZoom,
      raw: args
    });
    emitDebugEvent('document_load', {
      pageCount: resolvedPageCount,
      currentPageNumber: resolvedCurrent,
      zoomValue: resolvedZoom
    });

    // UX 2026-04-22 (hyperlink diag): opt-in DOM scan for Syncfusion link
    // layers. Enable with `window.__HYPERLINK_DIAG = true`.
    setTimeout(() => {
      try {
        if (typeof window === 'undefined' || window.__HYPERLINK_DIAG !== true) return;
        const host = viewer?.element;
        if (!host) { console.debug('[HyperlinkDiag] no viewer element'); return; }
        const hyperlinks = host.querySelectorAll('[class*="hyperlink"], a[href], [href]');
        console.debug('[HyperlinkDiag] post-load scan', {
          hyperlinkCount: hyperlinks.length,
          samples: Array.from(hyperlinks).slice(0, 5).map((el) => ({
            tag: el.tagName,
            className: el.className,
            href: el.getAttribute?.('href'),
            rect: el.getBoundingClientRect()
          }))
        });
        const pageDivs = host.querySelectorAll('.e-pv-page-div');
        pageDivs.forEach((pageDiv, i) => {
          const pageHyperlinks = pageDiv.querySelectorAll('[class*="hyperlink"], a[href]');
          console.debug(`[HyperlinkDiag] page ${i + 1} layers`, {
            hyperlinkChildren: pageHyperlinks.length,
            layerClasses: Array.from(pageDiv.children).map((c) => c.className || c.tagName)
          });
        });
      } catch (err) {
        if (typeof window !== 'undefined' && window.__HYPERLINK_DIAG === true) {
          console.debug('[HyperlinkDiag] post-load scan threw', err?.message);
        }
      }
    }, 800);
  }, [
    clearBookmarkRetry,
    connectPageObserver,
    getViewerInstance,
    onDocumentLoaded,
    scheduleBookmarkExtraction,
    requestPageContainerRefresh
  ]);

  // UX 2026-04-22 (Windows load failure): shared pdf-lib sanitization path.
  // Callable from both the synchronous `viewer.load()` try/catch AND from the
  // async `documentLoadFailed` event (on Windows, Syncfusion 32.1.19 raises
  // the `.has is not a function` TypeError from inside its promise chain so
  // the sync catch never fires — the event path is the only hook).
  //
  // Strips every `/Widget` annotation from each page's `/Annots` array and
  // replaces the catalog `/AcroForm` with an empty `{Fields: []}` dict so
  // Syncfusion's unconditional `GetFormFields` walk finds nothing to parse.
  // Returns a Promise<boolean> indicating whether a retry load was issued.
  const sanitizeAndReloadDocument = useCallback(async (bytes) => {
    const viewer = getViewerInstance();
    if (!viewer?.load || !bytes) return false;
    try {
      const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef } = await import('pdf-lib');
      const doc = await PDFDocument.load(bytes, {
        updateMetadata: false,
        ignoreEncryption: true,
      });
      doc.catalog.set(
        PDFName.of('AcroForm'),
        doc.context.obj({ Fields: [] })
      );
      const SUBTYPE = PDFName.of('Subtype');
      const ANNOTS = PDFName.of('Annots');
      const pages = doc.getPages();
      const nameOf = (value) => {
        if (!value) return '';
        if (typeof value === 'string') return value;
        if (typeof value.toString === 'function') return value.toString();
        return '';
      };
      for (const page of pages) {
        const node = page.node;
        let arr = node.get(ANNOTS);
        if (!arr) continue;
        if (arr instanceof PDFRef) {
          arr = doc.context.lookup(arr);
        }
        if (!(arr instanceof PDFArray)) continue;
        const keep = [];
        const size = arr.size();
        for (let i = 0; i < size; i += 1) {
          const entry = arr.get(i);
          let dict = entry;
          if (entry instanceof PDFRef) {
            dict = doc.context.lookup(entry);
          }
          if (!(dict instanceof PDFDict)) continue;
          const sub = dict.get(SUBTYPE);
          if (nameOf(sub) === '/Widget') continue;
          keep.push(entry);
        }
        if (keep.length !== size) {
          node.set(ANNOTS, doc.context.obj(keep));
        }
      }
      const sanitized = await doc.save({ useObjectStreams: false });
      const viewerAfter = getViewerInstance();
      if (!viewerAfter?.load) return false;
      viewerAfter.load(sanitized, '');
      return true;
    } catch (retryError) {
      emitDebugEvent('document_sanitize_failed', {
        message: String(retryError?.message || retryError || 'unknown'),
      });
      return false;
    }
  }, [emitDebugEvent, getViewerInstance]);

  const handleDocumentLoadFailed = useCallback((args) => {
    loadedDocumentKeyRef.current = null;
    emitDebugEvent('document_load_failed');

    // UX 2026-04-22 (Windows load failure): if Syncfusion's form-field
    // parser blew up with `.has is not a function` (any minified shape),
    // sanitize the bytes and retry ONCE before telling the parent that the
    // document failed to load. We only retry per unique document bytes to
    // avoid loops if sanitization itself can't save the file.
    if (looksLikeHasIsNotAFunctionFailure(args)) {
      const bytes = currentDocumentSourceRef.current;
      const retryKey = bytes ? makeDocumentKey(bytes) : null;
      const alreadyRetried = retryKey
        ? sanitizedRetryAttemptedRef.current.has(retryKey)
        : true;
      if (bytes && !alreadyRetried) {
        sanitizedRetryAttemptedRef.current.add(retryKey);
        emitDebugEvent('document_sanitize_retry', { trigger: 'documentLoadFailed' });
        sanitizeAndReloadDocument(bytes).then((retried) => {
          if (!retried) {
            // Sanitize couldn't help — surface the original failure.
            onDocumentLoadFailed?.(args);
          }
        });
        return;
      }
    }

    onDocumentLoadFailed?.(args);
  }, [emitDebugEvent, onDocumentLoadFailed, sanitizeAndReloadDocument]);

  const handlePageChange = useCallback((args) => {
    const viewer = getViewerInstance();
    const resolvedCount = resolvePageCountFromArgs(args, viewer) || pageCount;
    const maxPages = resolvedCount > 0 ? resolvedCount : Number.POSITIVE_INFINITY;
    const resolvedCurrent = coercePositiveInt(
      args?.currentPageNumber ?? viewer?.currentPageNumber ?? currentPage,
      null
    );
    const resolvedPrevious = coercePositiveInt(
      args?.previousPageNumber,
      null
    );

    const safeCurrent = resolvedCurrent && resolvedCurrent <= maxPages ? resolvedCurrent : currentPage;
    const safePrevious = resolvedPrevious && resolvedPrevious <= maxPages ? resolvedPrevious : null;

    if (resolvedCount > 0) {
      setPageCount(resolvedCount);
    }
    setCurrentPage(safeCurrent);
    onPageChanged?.({
      currentPageNumber: safeCurrent,
      previousPageNumber: safePrevious,
      pageCount: resolvedCount || pageCount,
      raw: args
    });
    emitDebugEvent('page_change', {
      currentPageNumber: safeCurrent,
      previousPageNumber: safePrevious,
      pageCount: resolvedCount || pageCount
    });
  }, [currentPage, emitDebugEvent, getViewerInstance, onPageChanged, pageCount]);

  const handleZoomChange = useCallback((args) => {
    const viewer = getViewerInstance();
    const nextZoom = coerceZoom(args?.zoomValue ?? viewer?.zoomValue ?? zoomValue, zoomValue);
    setZoomValue(nextZoom);
    onZoomChanged?.({
      zoomValue: nextZoom,
      raw: args
    });
    emitDebugEvent('zoom_change', {
      zoomValue: nextZoom
    });
  }, [emitDebugEvent, getViewerInstance, onZoomChanged, zoomValue]);

  const handlePageRenderComplete = useCallback((args) => {
    emitDebugEvent('page_render_complete');
    requestPageContainerRefresh('page_render_complete');
    onPageRendered?.(args);
  }, [emitDebugEvent, onPageRendered, requestPageContainerRefresh]);

  const handleTextSelectionEnd = useCallback((args) => {
    onTextSelectionEnd?.(args);
  }, [onTextSelectionEnd]);

  const handleAjaxRequestSuccess = useCallback((args) => {
    if (!args || args.action !== 'Bookmarks') {
      return;
    }
    clearBookmarkRetry();
    const bookmarks = normalizePdfBookmarks(args.data);
    if (bookmarks.length > 0) {
      onPDFBookmarksAvailable?.(bookmarks);
      emitDebugEvent('bookmarks_available', { count: bookmarks.length, source: 'ajax' });
      return;
    }
    scheduleBookmarkExtraction(0);
  }, [clearBookmarkRetry, emitDebugEvent, normalizePdfBookmarks, onPDFBookmarksAvailable, scheduleBookmarkExtraction]);

  const handleDocumentUnload = useCallback(() => {
    clearBookmarkRetry();
    disconnectPageObserver();
    loadedDocumentKeyRef.current = null;
    lastDocumentSourceRef.current = null;
    currentDocumentSourceRef.current = null;
    // UX 2026-04-22: clear the sanitize-retry ledger so re-opening a file is
    // allowed to retry again from scratch.
    sanitizedRetryAttemptedRef.current = new Set();
    thumbnailCacheRef.current.clear();
    setPageCount(0);
    setCurrentPage(1);
    setZoomValue(100);
    pageContainerMapRef.current = {};
    pendingRefreshReasonRef.current = null;
    onPageContainersChange?.({}, { reason: 'document_unload', count: 0 });
    onDocumentUnload?.();
    emitDebugEvent('document_unload');
  }, [clearBookmarkRetry, disconnectPageObserver, emitDebugEvent, onDocumentUnload, onPageContainersChange]);

  // KAL-47: bridge Syncfusion FormDesigner events to App handlers.
  // We only forward — the App owns selection state, the properties panel,
  // and decides what to do (e.g. open the FormFieldPropertiesPanel popover).
  const handleFormFieldAdd = useCallback((args) => {
    onFormFieldAdd?.(args);
  }, [onFormFieldAdd]);
  const handleFormFieldSelect = useCallback((args) => {
    onFormFieldSelect?.(args);
  }, [onFormFieldSelect]);
  const handleFormFieldUnselect = useCallback((args) => {
    onFormFieldUnselect?.(args);
  }, [onFormFieldUnselect]);
  const handleFormFieldRemove = useCallback((args) => {
    onFormFieldRemove?.(args);
  }, [onFormFieldRemove]);
  const handleFormFieldPropertiesChange = useCallback((args) => {
    onFormFieldPropertiesChange?.(args);
  }, [onFormFieldPropertiesChange]);
  const handleFormFieldClick = useCallback((args) => {
    onFormFieldClick?.(args);
  }, [onFormFieldClick]);
  const handleFormFieldDoubleClick = useCallback((args) => {
    onFormFieldDoubleClick?.(args);
  }, [onFormFieldDoubleClick]);

  // KAL-47: keep `viewer.designerMode` in sync with the App's Form mode.
  // Designer mode is the only way `addFormField` / `setFormFieldMode`
  // produce interactive editing handles. We toggle it here imperatively
  // so Survey can flip in/out of Forms mode without touching component-
  // level props (which would force a viewer recreate on every change).
  useEffect(() => {
    const viewer = getViewerInstance();
    if (!viewer) return;
    const next = formDesignerEnabled === true;
    if (viewer.designerMode !== next) {
      try {
        viewer.designerMode = next;
      } catch (err) {
        console.warn('[KAL-47] failed to toggle designerMode', err);
      }
    }
  }, [formDesignerEnabled, getViewerInstance, isReady]);

  useEffect(() => {
    if (!isReady || !resourcesReady || !documentSource) return;

    let cancelled = false;
    let retryTimer = null;

    // UX 2026-04-22: Expose the current bytes to the async
    // `handleDocumentLoadFailed` callback so it can sanitize-and-retry on
    // Windows, where Syncfusion's `.has is not a function` crash surfaces
    // via the `documentLoadFailed` event (not a sync throw).
    currentDocumentSourceRef.current = documentSource;

    // Clear any prior retry record when the underlying bytes change so the
    // sanitize-retry path will fire again for a brand-new document.
    const documentKey = makeDocumentKey(documentSource);
    if (lastDocumentSourceRef.current !== documentSource) {
      sanitizedRetryAttemptedRef.current.delete(documentKey);
    }

    const attemptLoad = () => {
      if (cancelled) return;
      const viewer = getViewerInstance();
      if (!viewer?.load) {
        retryTimer = setTimeout(attemptLoad, 40);
        return;
      }

      if (
        loadedDocumentKeyRef.current === documentKey &&
        lastDocumentSourceRef.current === documentSource
      ) {
        return;
      }

      lastDocumentSourceRef.current = documentSource;
      loadedDocumentKeyRef.current = documentKey;
      thumbnailCacheRef.current.clear();
      clearBookmarkRetry();

      try {
        viewer.load(documentSource, '');
      } catch (error) {
        // UX 2026-04-22: see `handleDocumentLoadFailed` for the full story.
        // This sync branch catches the Mac Phase 15 UAT-3 shape; the async
        // event branch catches the Windows minified shape. Both funnel into
        // the same `sanitizeAndReloadDocument` helper.
        if (looksLikeHasIsNotAFunctionFailure(error)) {
          if (!sanitizedRetryAttemptedRef.current.has(documentKey)) {
            sanitizedRetryAttemptedRef.current.add(documentKey);
            emitDebugEvent('document_sanitize_retry', { trigger: 'viewer.load-throw' });
            sanitizeAndReloadDocument(documentSource).then((retried) => {
              if (!retried) {
                loadedDocumentKeyRef.current = null;
                onDocumentLoadFailed?.(error);
              }
            });
            return;
          }
        }
        loadedDocumentKeyRef.current = null;
        onDocumentLoadFailed?.(error);
      }
    };

    attemptLoad();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [
    clearBookmarkRetry,
    documentSource,
    emitDebugEvent,
    getViewerInstance,
    isReady,
    onDocumentLoadFailed,
    resourcesReady,
    sanitizeAndReloadDocument
  ]);

  useEffect(() => {
    const viewer = getViewerInstance();
    if (!viewer) return;
    if (viewer.interactionMode !== interactionMode) {
      viewer.interactionMode = interactionMode;
    }
    if (viewer.viewerBase) {
      if (interactionMode === 'Pan') {
        viewer.viewerBase.initiatePanning?.();
      } else if (interactionMode === 'TextSelection') {
        viewer.viewerBase.initiateTextSelectMode?.();
      }
    }
  }, [getViewerInstance, interactionMode]);

  const textMarkupSelectorSettings = useMemo(() => {
    const zoomScale = Math.max(0.1, (Number(zoomValue) || 100) / 100);
    const resizerSize = Math.max(4, Math.min(7, 6 / Math.sqrt(zoomScale)));
    return {
      selectionBorderColor: '#4a90e2',
      selectionBorderThickness: 1,
      selectorLineDashArray: [4, 4],
      resizerBorderColor: '#4a90e2',
      resizerFillColor: '#ffffff',
      resizerShape: 'Circle',
      resizerSize
    };
  }, [zoomValue]);

  useEffect(() => {
    const viewer = getViewerInstance();
    if (!viewer) return;

    const mode = textMarkupMode || (textHighlightModeActive ? 'Highlight' : 'None');
    const color = textMarkupColor || textHighlightColor;
    const opacity = textMarkupOpacity ?? textHighlightOpacity;
    try {
      viewer.enableTextMarkupResizer = true;
      syncTextMarkupDropletAppearance(viewer);
      viewer.highlightSettings = {
        ...(viewer.highlightSettings || {}),
        color,
        opacity,
        enableTextMarkupResizer: true,
        annotationSelectorSettings: textMarkupSelectorSettings
      };
      viewer.underlineSettings = {
        ...(viewer.underlineSettings || {}),
        color,
        opacity,
        enableTextMarkupResizer: true,
        annotationSelectorSettings: textMarkupSelectorSettings
      };
      viewer.strikethroughSettings = {
        ...(viewer.strikethroughSettings || {}),
        color,
        opacity,
        enableTextMarkupResizer: true,
        annotationSelectorSettings: textMarkupSelectorSettings
      };
      viewer.squigglySettings = {
        ...(viewer.squigglySettings || {}),
        color,
        opacity,
        enableTextMarkupResizer: true,
        annotationSelectorSettings: textMarkupSelectorSettings
      };
      const annotationApi = viewer.annotationModule || viewer.annotation;
      if (mode === 'None') {
        const textMarkupModule = getTextMarkupModule(viewer);
        if (textMarkupModule) {
          textMarkupModule.isTextMarkupAnnotationMode = false;
          textMarkupModule.currentTextMarkupAddMode = '';
        }
      } else {
        annotationApi?.setAnnotationMode?.(mode);
      }
    } catch (error) {
      console.warn('[SyncfusionPDFContainer] Failed to set text highlight mode:', error);
    }
  }, [getViewerInstance, textHighlightColor, textHighlightModeActive, textHighlightOpacity, textMarkupColor, textMarkupMode, textMarkupOpacity, textMarkupSelectorSettings]);

  useEffect(() => {
    const viewer = getViewerInstance();
    const root = viewer?.element;
    if (!viewer || !root || typeof MutationObserver === 'undefined') return undefined;
    let frame = null;
    const apply = () => {
      frame = null;
      syncTextMarkupDropletAppearance(viewer, false);
    };
    const scheduleApply = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };
    const observer = new MutationObserver(scheduleApply);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
    scheduleApply();
    return () => {
      observer.disconnect();
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [getViewerInstance, zoomValue]);

  // UX 2026-04-23: Cmd+P no longer fires Syncfusion's built-in print directly.
  // The top-level App component owns a custom PrintPanel component and opens
  // it in response to `onPrintPdf`; Syncfusion's print module is still used as
  // the real-printer fallback once the panel's Print button is pressed.

  useEffect(() => {
    const viewer = getViewerInstance();
    if (!viewer) return;

    const nextRestrictZoomRequest = restrictZoomRequest === true;
    if (viewer.restrictZoomRequest !== nextRestrictZoomRequest) {
      viewer.restrictZoomRequest = nextRestrictZoomRequest;
    }

    const currentDelay = Number(viewer.scrollSettings?.delayPageRequestTimeOnScroll);
    if (!Number.isFinite(currentDelay) || Math.abs(currentDelay - normalizedScrollDelayMs) > 0.5) {
      viewer.scrollSettings = {
        ...(viewer.scrollSettings || {}),
        delayPageRequestTimeOnScroll: normalizedScrollDelayMs
      };
    }
  }, [getViewerInstance, normalizedScrollDelayMs, restrictZoomRequest]);

  useEffect(() => () => {
    clearTextMarkupSelectionState(getViewerInstance());
    clearRefreshFrame();
    clearBookmarkRetry();
    disconnectPageObserver();
  }, [clearBookmarkRetry, clearRefreshFrame, disconnectPageObserver, getViewerInstance]);

  const mergedStyle = useMemo(() => ({
    width: '100%',
    height: '100%',
    ...style
  }), [style]);

  return (
    <PdfViewerComponent
      id={id}
      ref={viewerRef}
      serviceUrl=""
      resourceUrl={resourceUrl}
      className={className}
      style={mergedStyle}
      enableToolbar={false}
      enableNavigationToolbar={false}
      enableAnnotationToolbar={false}
      enableFormDesignerToolbar={false}
      enableCommentPanel={false}
      enableDownload={false}
      enablePrint={true}
      enableAnnotation={true}
      enableFormFields={true}
      // KAL-47: `enableFormDesigner` actually controls whether the
      // FormDesigner module is loaded at all (PdfViewer.requiredModules
      // gates on this flag). It does NOT show built-in toolbar UI because
      // `enableToolbar={false}` and `enableFormDesignerToolbar={false}`
      // keep both toolbars hidden. We need this on so `formDesignerModule`
      // exists for Survey's custom Forms toolbar to call.
      enableFormDesigner={true}
      enablePageOrganizer={false}
      enableHyperlink={true}
      hyperlinkOpenState="NewTab"
      hyperlinkClick={(args) => {
        if (typeof window !== 'undefined' && window.__HYPERLINK_DIAG === true) {
          console.debug('[HyperlinkDiag] hyperlinkClick FIRED', {
            url: args?.hyperlink,
            keys: args ? Object.keys(args) : null
          });
        }
        const url = args?.hyperlink;
        if (!url || typeof url !== 'string') return;
        try { args.cancel = true; } catch {}
        const api = typeof window !== 'undefined' ? window.electronAPI : null;
        if (api && typeof api.openExternal === 'function') {
          api.openExternal(url).catch(() => {
            window.open(url, '_blank', 'noopener,noreferrer');
          });
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      }}
      hyperlinkMouseOver={(args) => {
        if (typeof window !== 'undefined' && window.__HYPERLINK_DIAG === true) {
          console.debug('[HyperlinkDiag] hyperlinkMouseOver FIRED', {
            url: args?.hyperlink,
            hasElement: !!args?.element
          });
        }
        const el = args?.element;
        if (el && el.style) el.style.cursor = 'pointer';
      }}
      enableTextSearch={true}
      textSearchColorSettings={{
        searchHighlightColor: TEXT_SEARCH_NATIVE_HIGHLIGHT_COLOR,
        searchColor: TEXT_SEARCH_NATIVE_HIGHLIGHT_COLOR
      }}
      enableThumbnail={false}
      enableBookmark={true}
      enableTextSelection={true}
      enableTextMarkupAnnotation={true}
      enableTextMarkupResizer={true}
      highlightSettings={{ color: textHighlightColor, opacity: textHighlightOpacity, enableTextMarkupResizer: true, annotationSelectorSettings: textMarkupSelectorSettings }}
      underlineSettings={{ color: textMarkupColor || textHighlightColor, opacity: textMarkupOpacity ?? textHighlightOpacity, enableTextMarkupResizer: true, annotationSelectorSettings: textMarkupSelectorSettings }}
      strikethroughSettings={{ color: textMarkupColor || textHighlightColor, opacity: textMarkupOpacity ?? textHighlightOpacity, enableTextMarkupResizer: true, annotationSelectorSettings: textMarkupSelectorSettings }}
      squigglySettings={{ color: textMarkupColor || textHighlightColor, opacity: textMarkupOpacity ?? textHighlightOpacity, enableTextMarkupResizer: true, annotationSelectorSettings: textMarkupSelectorSettings }}
      restrictZoomRequest={restrictZoomRequest}
      showNotificationDialog={false}
      contextMenuSettings={{ contextMenuAction: 'None', contextMenuItems: [] }}
      initialRenderPages={initialRenderPages}
      interactionMode={interactionMode}
      tileRenderingSettings={{ enableTileRendering: true }}
      scrollSettings={{ delayPageRequestTimeOnScroll: normalizedScrollDelayMs }}
      created={handleCreated}
      resourcesLoaded={handleResourcesLoaded}
      documentLoad={handleDocumentLoad}
      documentLoadFailed={handleDocumentLoadFailed}
      pageChange={handlePageChange}
      zoomChange={handleZoomChange}
      pageRenderComplete={handlePageRenderComplete}
      textSelectionEnd={handleTextSelectionEnd}
      ajaxRequestSuccess={handleAjaxRequestSuccess}
      documentUnload={handleDocumentUnload}
      formFieldAdd={handleFormFieldAdd}
      formFieldSelect={handleFormFieldSelect}
      formFieldUnselect={handleFormFieldUnselect}
      formFieldRemove={handleFormFieldRemove}
      formFieldPropertiesChange={handleFormFieldPropertiesChange}
      formFieldClick={handleFormFieldClick}
      formFieldDoubleClick={handleFormFieldDoubleClick}
    >
      <Inject services={[Magnification, Navigation, BookmarkView, TextSelection, TextSearch, Annotation, Print, LinkAnnotation, FormFields, FormDesigner]} />
    </PdfViewerComponent>
  );
});

SyncfusionPDFContainer.displayName = 'SyncfusionPDFContainer';

export default SyncfusionPDFContainer;
