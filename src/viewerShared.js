/**
 * viewerShared.js — shared constants + helper functions for the PDF viewer.
 *
 * This is NOT the application root (that is AppShell.jsx). It is a leaf module
 * of pure constants and helpers, imported by the viewer (PDFViewer.jsx) and the
 * app shell (AppShell.jsx). It was historically named App.jsx — a leftover from
 * before the viewer/shell/dashboard were extracted out of it — and was renamed
 * to match what it actually is (2026-05-29).
 *
 * What lives here:
 *   - Supabase client + auth/session helpers
 *   - annotation <-> Fabric.js object conversion
 *   - page/screen coordinate + scale math (pure helpers)
 *   - annotation persistence (local storage + cloud)
 *   - survey-marker helpers
 *   - shared UI constants (fonts, colors, defaults)
 *
 * Import direction: this file does NOT import AppShell.jsx, PDFViewer.jsx, or
 * Dashboard.jsx, so there are no import cycles among the top-level files.
 */
// pdf.js is NOT imported here anymore. It used to be pulled in eagerly just to
// set GlobalWorkerOptions.workerSrc at module load, which forced pdf.js into the
// first-paint entry chunk. Worker config now happens lazily via
// utils/pdfWorkerConfig.loadPdfjs(), called right before each getDocument.
import { recordAnnotationBackupWrite } from './utils/annotationPreviewDiag.js';
import { projectAnnotationForHistoryPreview, slimHistoryPreviewBefore } from './utils/historyPreviewAnnotation.js';
import { deepClone } from './utils/deepClone.js';
import { boundsOfPoints, maxOf, minOf } from './utils/arrayExtrema.js';
import { normalizeCalloutsForSync } from './utils/calloutSyncPayload.js';
import { getCalloutIdsFromHistoryMeta } from './utils/calloutHistoryScope.js';
import { ZOOM_MODES } from './utils/zoomController.js';
// Phase 29 — per-user Y.UndoManager hook + user-action wrappers. handleUndo and
// handleRedo bodies route through these so trackedOrigins reference equality
// (Pitfall 7) holds across the bridge and the keyboard handler call sites.
// Phase 35 Plan 04 — bulk-delete modals + undo toast layer. The planner
// builds the BulkDeletePlan in scope of viewerId/documentOwnerId; the modal
// branches on plan.mode; the toast hook owns the 5/6s auto-dismiss.
// FabricTextCanvas removed — text tool now creates text-only callouts via CalloutCanvas
// Plan 14-03 Task 3 (CALL-10): callout edit-mode adapter. Converts React
// callouts <-> plain Fabric JSON so FabricEditCanvas's existing
// loadCalloutAnnotation at :1937 can enliven them without any edits to
// FabricEditCanvas.jsx (protected file). toFabricGroup is used when
// entering edit mode; fromFabricGroup is used in the save-callback
// wrapper on edit-mode exit.
import { COLORS } from './theme.js';
// Phase 21: cloud sync for all annotation types — see
// .planning/phases/21-cloud-sync-all-annotations/CONTEXT.md
import { normalizePageRegions } from './utils/annotationVisibilityRules.js';
import { getRegionOutlineCoordinates } from './utils/regionOutline.js';
import { coercePageNumber } from './utils/bookmarkPageIds.js';
import { getMarkLockedBy } from './lib/collab/permissionScope.js';
export { coercePageNumber, normalizeBookmarkPageIds } from './utils/bookmarkPageIds.js';
export { escapeCSVValue } from './utils/csvValue.js';

export const NATIVE_TEXT_MARKUP_TOOLS = new Set(['text-highlight', 'underline', 'strikeout', 'squiggly']);
const SELECT_DELETE_ONLY_IMPORTED_TEXT_MARKUP_TYPES = new Set(['underline', 'strikeout', 'squiggly']);
export const REVIEW_TOOL_IDS = ['text', 'callout'];

export const appDebug = (...args) => {
  if (typeof window === 'undefined' || window.__APP_DEBUG !== true) return;
  try { console.debug(...args); } catch { /* ignore debug logging failures */ }
};

export const getWindowTrackpadInteractionDebugSavePayload = () => {
  if (typeof window === 'undefined') {
    return { dump: null, extraFiles: [] };
  }

  try {
    if (typeof window.__trackpadZoomDebug?.dump === 'function') {
      const dump = window.__trackpadZoomDebug.dump();
      const lines = [];
      lines.push(`# Trackpad Interaction Debug - ${dump?.metadata?.capturedAt || new Date().toISOString()}`);
      lines.push(`events=${dump?.summary?.eventCount ?? 0}`);
      lines.push(`sessions=${dump?.summary?.sessionCount ?? 0}`);
      lines.push(`rawWheel=${dump?.summary?.totals?.rawWheel ?? 0}`);
      lines.push(`rawZoomWheel=${dump?.summary?.totals?.rawZoomWheel ?? 0}`);
      lines.push(`rawScrollWheel=${dump?.summary?.totals?.rawScrollWheel ?? 0}`);
      lines.push(`processedZoom=${dump?.summary?.totals?.processedZoom ?? 0}`);
      lines.push(`skippedZoom=${dump?.summary?.totals?.skippedZoom ?? 0}`);
      lines.push(`processedScroll=${dump?.summary?.totals?.processedScroll ?? 0}`);
      lines.push(`nativeScroll=${dump?.summary?.totals?.nativeScroll ?? 0}`);
      lines.push(`pointerPanMoves=${dump?.summary?.totals?.pointerPanMoves ?? 0}`);
      lines.push(`zoomAvgLatencyMs=${dump?.summary?.zoomAvgLatencyMs ?? 'n/a'}`);
      lines.push(`zoomMaxLatencyMs=${dump?.summary?.zoomMaxLatencyMs ?? 'n/a'}`);
      lines.push(`zoomAvgRequestedDeltaPct=${dump?.summary?.zoomAvgRequestedDeltaPct ?? 'n/a'}`);
      lines.push(`zoomAvgActualDeltaPct=${dump?.summary?.zoomAvgActualDeltaPct ?? 'n/a'}`);
      lines.push(`scrollAvgLatencyMs=${dump?.summary?.scrollAvgLatencyMs ?? 'n/a'}`);
      lines.push(`scrollMaxLatencyMs=${dump?.summary?.scrollMaxLatencyMs ?? 'n/a'}`);
      lines.push('');
      lines.push('## Recent sessions');
      (dump?.summary?.recentSessions || []).forEach((session) => {
        lines.push(`- #${session.id} ${session.family}/${session.direction || 'unknown'} events=${session.eventCount} raw=${session.rawWheelCount} processed=${session.processedCount} ignored=${session.ignoredCount} zoomReq=${session.zoomRequestedAbs ?? 0} zoomActual=${session.zoomActualAbs ?? 0} maxLatency=${session.maxLatencyMs ?? 0}ms`);
      });
      return {
        dump,
        extraFiles: [
          { name: 'trackpad-interaction-debug.json', content: JSON.stringify(dump, null, 2) },
          { name: 'trackpad-interaction-summary.txt', content: lines.join('\n') },
        ],
      };
    }
  } catch (error) {
    return {
      dump: { summary: { error: error?.message || String(error) } },
      extraFiles: [],
    };
  }

  const dataset = window.document?.documentElement?.dataset || {};
  return {
    dump: {
      summary: {
        markerOnly: true,
        enabled: dataset.trackpadDebugEnabled || null,
        eventCount: Number(dataset.trackpadDebugEvents || 0),
        sessionCount: Number(dataset.trackpadDebugSessions || 0),
        lastType: dataset.trackpadDebugLastType || null,
        lastFamily: dataset.trackpadDebugLastFamily || null,
      },
    },
    extraFiles: [],
  };
};

export const writeSaveLogExtraFiles = async (api, dir, extraFiles) => {
  if (!api || typeof api.writeFile !== 'function' || !dir || !Array.isArray(extraFiles)) return;
  await Promise.all(extraFiles.map((file) => {
    if (!file || typeof file.name !== 'string') return Promise.resolve();
    const content = typeof file.content === 'string'
      ? file.content
      : JSON.stringify(file.content ?? null, null, 2);
    return api.writeFile(`${dir}/${file.name}`, content).catch((err) => {
      console.warn('[SaveLog] extra file write failed', file.name, err?.message || err);
    });
  }));
};

export const isSelectDeleteOnlyImportedTextMarkupType = (type) => (
  (() => {
    const normalized = String(type || '').toLowerCase().replace(/[^a-z]/g, '');
    return SELECT_DELETE_ONLY_IMPORTED_TEXT_MARKUP_TYPES.has(normalized) || normalized.includes('strike');
  })()
);

const getSelectDeleteOnlyTextMarkupBounds = (obj) => {
  if (!obj || !isSelectDeleteOnlyImportedTextMarkupType(obj.pdfAnnotationType || obj.data?.pdfAnnotationType)) {
    return null;
  }
  const type = String(obj.type || '').toLowerCase();
  if (type === 'rect') {
    const left = Number(obj.left);
    const top = Number(obj.top);
    const width = Number(obj.width);
    const height = Number(obj.height);
    if ([left, top, width, height].every(Number.isFinite) && width >= 0 && height >= 0) {
      return { left, top, right: left + width, bottom: top + height };
    }
  }
  if (type === 'path' && Array.isArray(obj.path)) {
    const xs = [];
    const ys = [];
    obj.path.forEach((segment) => {
      if (!Array.isArray(segment)) return;
      for (let i = 1; i < segment.length; i += 2) {
        const x = Number(segment[i]);
        const y = Number(segment[i + 1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          xs.push(x);
          ys.push(y);
        }
      }
    });
    if (xs.length > 0 && ys.length > 0) {
      // Linear, not a spread: an imported path's coordinate list is unbounded
      // and a spread over it overflows the call stack (see arrayExtrema.js).
      return {
        left: minOf(xs),
        top: minOf(ys),
        right: maxOf(xs),
        bottom: maxOf(ys)
      };
    }
  }
  return null;
};

const distanceToSegment = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};

const getPathPointDistance = (path, point) => {
  if (!Array.isArray(path) || !point) return Infinity;
  let current = null;
  let minDistance = Infinity;
  const addLine = (next) => {
    if (current && Number.isFinite(next.x) && Number.isFinite(next.y)) {
      minDistance = Math.min(minDistance, distanceToSegment(point, current, next));
    }
    current = next;
  };

  path.forEach((segment) => {
    if (!Array.isArray(segment) || segment.length < 3) return;
    const command = segment[0];
    if (command === 'M') {
      current = { x: Number(segment[1]), y: Number(segment[2]) };
      return;
    }
    if (command === 'L') {
      addLine({ x: Number(segment[1]), y: Number(segment[2]) });
      return;
    }
    if ((command === 'Q' || command === 'C') && current) {
      let previous = current;
      const samples = 10;
      for (let i = 1; i <= samples; i += 1) {
        const t = i / samples;
        const mt = 1 - t;
        const next = command === 'Q'
          ? {
              x: mt * mt * current.x + 2 * mt * t * Number(segment[1]) + t * t * Number(segment[3]),
              y: mt * mt * current.y + 2 * mt * t * Number(segment[2]) + t * t * Number(segment[4])
            }
          : {
              x: mt * mt * mt * current.x + 3 * mt * mt * t * Number(segment[1]) + 3 * mt * t * t * Number(segment[3]) + t * t * t * Number(segment[5]),
              y: mt * mt * mt * current.y + 3 * mt * mt * t * Number(segment[2]) + 3 * mt * t * t * Number(segment[4]) + t * t * t * Number(segment[6])
            };
        minDistance = Math.min(minDistance, distanceToSegment(point, previous, next));
        previous = next;
      }
      current = previous;
    }
  });

  return minDistance;
};

export const isPointOnSelectDeleteOnlyTextMarkup = (obj, point, tolerance = 2) => {
  const bounds = getSelectDeleteOnlyTextMarkupBounds(obj);
  if (!bounds || !point) return false;
  const type = String(obj?.type || '').toLowerCase();
  if (type === 'path') {
    const strokeWidth = Math.max(1, Number(obj.strokeWidth) || 1);
    return getPathPointDistance(obj.path, point) <= (strokeWidth / 2 + tolerance);
  }
  return point.x >= bounds.left - tolerance
    && point.x <= bounds.right + tolerance
    && point.y >= bounds.top - tolerance
    && point.y <= bounds.bottom + tolerance;
};

export const getPdfjsTextMarkupMode = (tool) => {
  switch (tool) {
    case 'text-highlight':
      return 'SurveyMarker';
    case 'underline':
      return 'Underline';
    case 'strikeout':
      return 'Strikethrough';
    case 'squiggly':
      return 'Squiggly';
    default:
      return null;
  }
};

export const coercePdfjsZoomPercent = (...values) => {
  for (const value of values) {
    if (value == null) continue;
    const parsed = typeof value === 'string'
      ? parseFloat(value.replace('%', ''))
      : Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 100;
};

export const isSuspiciousWheelZoomPercent = (reportedPercent, trustedPercent) => (
  Number.isFinite(reportedPercent) &&
  Number.isFinite(trustedPercent) &&
  reportedPercent <= 10 &&
  trustedPercent >= 25 &&
  trustedPercent / Math.max(1, reportedPercent) >= 2
);

const PDFJS_PDF_SURFACE_SELECTOR = [
  'img[id*="_tileimg_"]',
  'img[id*="_pageCanvas_"]',
  'canvas[id*="_pageCanvas_"]',
  '.survey-pdfjs-page-canvas',
  '.survey-pdfjs-text-layer',
  '.survey-pdfjs-image-canvas'
].join(',');

export const hasPdfjsPdfSurface = (host) => !!host?.querySelector?.(PDFJS_PDF_SURFACE_SELECTOR);

export const hasVisiblePdfjsSpinner = (host) => {
  if (!host?.querySelectorAll) return false;
  const spinners = Array.from(host.querySelectorAll([
    '.survey-pdfjs-spinner-pane:not(.survey-pdfjs-spin-hide)',
    '.survey-pdfjs-spinner-pane[aria-hidden="false"]'
  ].join(',')));
  return spinners.some((spinner) => {
    if (!spinner?.isConnected) return false;
    if (spinner.classList?.contains?.('survey-pdfjs-spin-hide')) return false;
    if (spinner.getAttribute?.('aria-hidden') === 'true') return false;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(spinner);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity || 1) <= 0.01
      ) {
        return false;
      }
    }
    const rect = spinner.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  });
};

// PDF.js worker setup moved to utils/pdfWorkerConfig.loadPdfjs() (lazy, so pdf.js
// stays out of the first-paint bundle). Verbosity stays at the pdf.js default.

// Consistent font stack for the entire application
export const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif'; // design.md primary stack (DOM CSS only — never feed into Fabric)
export const REGION_EDIT_TOOL = 'region-edit';

// UX 2026-09-16 (desktop sizing pass): the glyph sizes for the document
// chrome. The box sizes live in styles.css as --chrome-* custom properties;
// these mirror the glyph ones because <Icon size> takes a NUMBER (some icons
// render as an <svg width>, others as a CSS mask), so a var() string will not
// do. Keep the two in step.
// REFERENCE = Drawboard PDF on the web: an 18px glyph inside a 34px tool
// button (ratio 0.53) and a ~14px glyph inside a 24px value chip. Before this
// pass Survey's top row alone mixed 14 / 15 / 18 / 20 / 22.
// 2026-09-16 (desktop sweep): nothing in the top row is drawn larger than
// CHROME_GLYPH any more. Pan used to render at 20 and the Select cursor at 22,
// on the argument that they under-fill their own viewBox — both are 18 now, and
// their artwork carries the row's weight at 18 because both assets are drawn on
// the house 24 grid at the house 1.5 stroke (src/assets/icons/pan-hand-closed.svg
// and selection-cursor-rounded.svg). tests/selectModes.test.mjs pins the size.
// PASS 7 (boards 8-14, owner-approved artboards): the document chrome's tool
// glyph is 16 inside a 28px button — the ratio the boards draw. It was 18-in-34.
// The RAIL keeps 18 (see RAIL_GLYPH below): the boards changed the three document
// bars, not the 48px rails, so the two tiers are separate constants now instead
// of one shared number.
export const CHROME_GLYPH = 16;
export const CHROME_FIELD_GLYPH = 14;

// UX 2026-09-16 (desktop sweep): the RAIL tier — the left document rail and the
// right Survey rail. Same idea as the chrome tokens above: one control box and
// one glyph size, so a rail never mixes its own numbers. Two sizes per rail,
// because a rail holds two kinds of control:
//   - a TAB (Pages, Search, Bookmarks, Spaces, Survey): the full width of the
//     48px rail, 40px tall, RAIL_GLYPH inside it.
//   - everything else (the collapse/expand chevron at the top, Version history
//     in the collaboration footer, and the whole zoom / page / fit footer):
//     a RAIL_CONTROL square with a RAIL_CONTROL_GLYPH inside it.
// Before this pass one rail could show 14, 16, 17, 18 and 20 in a single 48px
// column, and its footer mixed 24px, 28px and 36x28 boxes.
// RAIL_CONTROL / RAIL_CONTROL_GLYPH are the chrome's own value-chip pair (24 and
// 14) rather than new numbers — a rail footer control and a value chip are the
// same size of thing.
export const RAIL_GLYPH = 18;
export const RAIL_CONTROL = 24;
export const RAIL_CONTROL_GLYPH = CHROME_FIELD_GLYPH;
// The one rail control that hangs a caret beside its glyph (Fit options) needs
// the extra width, exactly as the top bar's Select split button does. Its caret
// is the dropdown caret size (10), not the glyph size — see the CARETS note in
// styles.css: a caret beside a full-size glyph has to stay out of its way.
export const RAIL_SPLIT_CONTROL_W = 36;
export const RAIL_CARET = 10;

// Survey audit (2026-10-01): entity colours are user data and may hold a
// value that is not a colour this code can read - the old default "Removed"
// entity was saved as 'var(--text-3)', which turned into rgba(NaN, NaN, NaN).
// Read #rgb / #rrggbb / #rrggbbaa (with or without '#') and rgb()/rgba();
// anything else falls back to ENTITY_FALLBACK_HEX, a plain grey, so a marker
// and the Excel export always get a real colour. Saved data is not rewritten.
export const ENTITY_FALLBACK_HEX = '#959eae';
const ENTITY_FALLBACK_RGB = [149, 158, 174];
export const parseColorRgb = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i);
  if (rgbMatch) {
    const rgb = rgbMatch.slice(1, 4).map(Number);
    return rgb.every((n) => n <= 255) ? rgb : null;
  }
  const hexMatch = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!hexMatch) return null;
  let digits = hexMatch[1];
  if (digits.length === 3) digits = digits.split('').map((d) => d + d).join('');
  return [0, 2, 4].map((i) => parseInt(digits.substring(i, i + 2), 16));
};

// Convert hex color to rgba with default opacity (default 0.2, but surveyMarkers use 1.0)
export const hexToRgba = (hex, opacity = 0.2) => {
  const rgb = parseColorRgb(hex) || ENTITY_FALLBACK_RGB;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity})`;
};

// Ensure color is in rgba format with specified opacity (default 0.2, but surveyMarkers use 1.0)
export const ensureRgbaOpacity = (color, opacity = 0.2) => {
  if (!color) return `rgba(227, 209, 251, ${opacity})`; // Default purple

  // If already rgba, ensure opacity is correct
  if (color.startsWith('rgba')) {
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgbaMatch) {
      return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${opacity})`;
    }
  }

  // If hex, convert to rgba
  if (color.startsWith('#')) {
    return hexToRgba(color, opacity);
  }

  // Fallback to default
  return `rgba(227, 209, 251, ${opacity})`;
};

export const DEFAULT_SURVEY_MARKER_OPACITY = 0.4;
export const INTERACTION_PERF_MIN_HOLD_MS = 900;
export const INTERACTION_PERF_SCROLL_HOLD_MS = 1800;
export const INTERACTION_PERF_DRAW_HOLD_MS = 1600;
const PDFJS_OVERLAY_PREFETCH_PAGES = 2;
export const PDFJS_OVERLAY_ROOT_MARGIN = '720px 0px';
export const PDFJS_OVERLAY_WINDOW_LINGER_MS = 260;
export const PDFJS_INTERACTION_SETTLE_MS = 240;
export const PDFJS_INTERACTION_PROXY_OBJECT_THRESHOLD = 180;
export const PDFJS_INTERACTION_PROXY_CALLOUT_THRESHOLD = 30;
export const PDFJS_INTERACTION_PROXY_FORCE_OBJECT_THRESHOLD = 320;
export const PDFJS_INTERACTION_MAX_RESIDENT_PAGES = 12;
export const PDFJS_INTERACTION_COMMIT_MAX_PAGES_PER_FRAME = 1;
export const PDFJS_INTERACTION_COMMIT_FRAME_BUDGET_MS = 6;
export const PDFJS_INTERACTION_COMMIT_FRAME_SPACING_MS = 24;
export const PDFJS_INTERACTION_EVENT_THROTTLE_MS = 96;
export const PDFJS_INTERACTION_MARK_THROTTLE_MS = 96;
export const PDFJS_INTERACTION_VISIBLE_PAGE_REFRESH_MS = 160;
export const PDFJS_ZOOM_OVERLAY_SETTLE_MS = 1400;
const PDFJS_BASE_SCROLL_SENSITIVITY = 1.08;
const PDFJS_SCROLL_ZOOM_OUT_GAIN = 1;
const PDFJS_SCROLL_ZOOM_IN_GAIN = 0.9;
export const PDFJS_DIAGONAL_SCROLL_SENSITIVITY = 0.95;
export const PDFJS_LARGE_WHEEL_SCROLL_SENSITIVITY = 1;
export const PDFJS_SCROLL_MAX_STEP_PX = 220;
export const PDFJS_SCROLL_MIN_STEP_PX = 16;
export const PDFJS_SCROLL_FRAME_MAX_PX = 180;
export const PDFJS_WHEEL_SCROLL_BATCH_MS = 24;
// Trackpad pinch/wheel zoom sensitivity. Keep this centralized so both
// Pdfjs wheel paths stay cursor-anchored and feel equally responsive.
const PDFJS_WHEEL_ZOOM_EXPONENT = 0.004;
const PDFJS_WHEEL_ZOOM_MAX_STEP_PERCENT = 24;
export const PDFJS_WHEEL_ZOOM_BATCH_MS = 3;
export const PDFJS_WHEEL_ZOOM_STALE_DROP_MS = 260;
export const PDFJS_ZOOM_SNAPSHOT_VIEWPORT_MARGIN_PX = 420;
export const TOOLBAR_ZOOM_STEP_FACTOR = 1.25;
export const PDFJS_INTERACTION_FORCE_PROXY_ALL_PAGES = true;
export const ZOOM_ONLY_INTERACTION_REASONS = new Set([
  'wheel-zoom', 'pdfjs-wheel-zoom', 'pdfjs-zoom-change', 'overlay-wheel-zoom'
]);
export const PDFJS_SCROLL_DELAY_MS = 8;

// Keep enough PDF pages resident that revisiting nearby drawing sheets does not
// briefly blank/rebuild the page under already-rendered annotations. Pdfjs
// removes canvases outside this initial window, which caused 1s+ page revisit
// stalls on the Package 2 test PDF. Ten keeps the active drawing range warm
// without making Pdfjs keep too many offscreen canvases/spinners busy.
export const PDFJS_INITIAL_RENDER_PAGES = 10;
export const PDFJS_RESTRICT_ZOOM_REQUEST_DURING_INTERACTION = true;
const PDFJS_CANVAS_PRESENTATION_ENABLED_KEY = 'pdfjs_canvas_presentation_enabled_v1';
const OVERLAY_LAG_RECORDER_AUTO_KEY = 'pdfjs_overlay_lag_auto_v2';
export const OVERLAY_LAG_RECORDER_AUTO_SAMPLE_PAGE_LIMIT = 6;
export const OVERLAY_LAG_RECORDER_AUTO_MAX_SAMPLES = 12000;
export const OVERLAY_LAG_RECORDER_AUTO_SAMPLE_INTERVAL_MS = 180;
export const OVERLAY_LAG_RECORDER_DEBUG_UI_INTERVAL_MS = 1000;
export const OVERLAY_LAG_RECORDER_PERF_ENTRY_LIMIT = 6000;
export const OVERLAY_LAG_RECORDER_EVENT_TIMING_THRESHOLD_MS = 24;
export const TRACKPAD_INTERACTION_DEBUG_MAX_EVENTS = 24000;
export const TRACKPAD_INTERACTION_DEBUG_MAX_SESSIONS = 1200;
export const TRACKPAD_INTERACTION_DEBUG_SESSION_GAP_MS = 220;
export const TRACKPAD_INTERACTION_CONSOLE_INTERVAL_MS = 180;
export const OVERLAY_LAG_RECORDER_WORK_CATEGORIES = [
  'annotationRestoration',
  'pageRenderCatchup',
  'pdfjsInternals',
  'measurementWork'
];
export const OVERLAY_LAG_RECORDER_ATTRIBUTION_MIN_MS = 8;
export const OVERLAY_LAG_RECORDER_ATTRIBUTION_MIN_FRAME_RATIO = 0.2;
const DOCUMENT_SYNC_STRUCTURAL_DISABLED_KEY = 'document_sync_structural_disabled';
const DOCUMENT_SYNC_STRUCTURAL_DISABLED_TTL_MS = 10 * 60 * 1000;
const HISTORY_DEBUG_CONSOLE_KEY = 'pdf_history_debug_console';

export const getSmoothPdfjsWheelZoom = (currentZoom, wheelDelta) => {
  const safeCurrent = Number.isFinite(Number(currentZoom)) ? Number(currentZoom) : 100;
  const safeDelta = Number.isFinite(Number(wheelDelta)) ? Number(wheelDelta) : 0;
  const factor = Math.exp(safeDelta * PDFJS_WHEEL_ZOOM_EXPONENT);
  const targetZoom = safeCurrent * factor;
  const cappedZoom = safeCurrent + Math.max(
    -PDFJS_WHEEL_ZOOM_MAX_STEP_PERCENT,
    Math.min(PDFJS_WHEEL_ZOOM_MAX_STEP_PERCENT, targetZoom - safeCurrent)
  );
  return Math.max(10, Math.min(400, cappedZoom));
};

export const getPdfjsZoomAwareScrollGain = (zoomScale) => {
  const safeZoom = Math.max(0.5, Math.min(4, Number(zoomScale) || 1));
  const zoomT = Math.max(-1, Math.min(1, Math.log2(safeZoom)));
  const targetGain = zoomT < 0
    ? 1 + ((PDFJS_SCROLL_ZOOM_OUT_GAIN - 1) * -zoomT)
    : 1 - ((1 - PDFJS_SCROLL_ZOOM_IN_GAIN) * zoomT);
  return PDFJS_BASE_SCROLL_SENSITIVITY * targetGain;
};

export const getNormalizedWheelDeltas = (event) => {
  const rawX = Number(event?.deltaX) || 0;
  const rawY = Number(event?.deltaY) || 0;
  if (event?.deltaMode === 1) {
    return { x: rawX * 16, y: rawY * 16 };
  }
  if (event?.deltaMode === 2) {
    const pageSize = typeof window !== 'undefined' ? Math.max(1, window.innerHeight || 800) : 800;
    return { x: rawX * pageSize, y: rawY * pageSize };
  }
  return { x: rawX, y: rawY };
};

export const clampWheelDelta = (value, maxStep) => {
  const numeric = Number(value) || 0;
  const limit = Math.max(PDFJS_SCROLL_MIN_STEP_PX, Number(maxStep) || PDFJS_SCROLL_MAX_STEP_PX);
  if (Math.abs(numeric) <= limit) return numeric;
  return Math.sign(numeric) * limit;
};
export const HISTORY_DEBUG_TRACE_LIMIT = 250;
export const HISTORY_PAGE_PREVIEW_LIMIT = 12;
export const HISTORY_OBJECT_CHANGE_PREVIEW_LIMIT = 10;
export const HISTORY_SAVELOG_EVENT_LIMIT = 180;
export const PHASE_2_DEBUG_INDICATORS = false; // 2026-04-29 user-waived flip: removes the leftover blue debug tint over the PDF overlay div that was used during Phase 2 development.

const roundHistoryDebugNumber = (value, digits = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number(numeric.toFixed(digits));
};

export const hashHistoryString = (value = '') => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const toHistoryObjectDebug = (object, index) => ({
  index,
  type: object?.type || null,
  partType: object?.partType || object?.data?.type || null,
  name: object?.name || null,
  annotationId: object?.annotationId || null,
  pdfAnnotationId: object?.pdfAnnotationId || null,
  left: roundHistoryDebugNumber(object?.left),
  top: roundHistoryDebugNumber(object?.top),
  width: roundHistoryDebugNumber(object?.width),
  height: roundHistoryDebugNumber(object?.height),
  scaleX: roundHistoryDebugNumber(object?.scaleX, 4),
  scaleY: roundHistoryDebugNumber(object?.scaleY, 4),
  angle: roundHistoryDebugNumber(object?.angle)
});

export const getHistoryObjectDiffType = (previousObject, nextObject) => {
  if (!previousObject) return 'added';
  if (!nextObject) return 'removed';

  const moved = previousObject.left !== nextObject.left || previousObject.top !== nextObject.top;
  const resized = (
    previousObject.width !== nextObject.width ||
    previousObject.height !== nextObject.height ||
    previousObject.scaleX !== nextObject.scaleX ||
    previousObject.scaleY !== nextObject.scaleY
  );
  const rotated = previousObject.angle !== nextObject.angle;

  if (moved && !resized && !rotated) return 'move';
  // w55: dragging a left/top handle resizes AND shifts left/top — that is a
  // resize to the person doing it, not a move.
  if (resized && !rotated) return 'resize';
  if (rotated && !moved && !resized) return 'rotate';
  if (moved || resized || rotated) return 'transform';
  return 'update';
};

export const getHistoryObjectSignature = (object) => [
  object?.type || '',
  object?.partType || '',
  object?.name || '',
  object?.annotationId || '',
  object?.pdfAnnotationId || '',
  object?.left ?? '',
  object?.top ?? '',
  object?.width ?? '',
  object?.height ?? '',
  object?.scaleX ?? '',
  object?.scaleY ?? '',
  object?.angle ?? ''
].join('|');

export const getHistoryAnnotationId = (annotation) => (
  annotation?.data?.id
  || annotation?.data?.annoId
  || annotation?.id
  || annotation?.annotationId
  || annotation?.pdfAnnotationId
  || null
);

const getHistoryAnnotationType = (annotation) => (
  annotation?.data?.annotationType
  || annotation?.data?.type
  || annotation?.pdfAnnotationType
  || annotation?.type
  || null
);

const getHistoryPathVisualBounds = (path) => {
  if (!Array.isArray(path)) return null;
  const points = [];
  path.forEach((command) => {
    if (!Array.isArray(command)) return;
    for (let i = 1; i < command.length - 1; i += 2) {
      const x = Number(command[i]);
      const y = Number(command[i + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
    }
  });
  if (points.length === 0) return null;
  // Linear, not a spread: a history path's point list is unbounded (arrayExtrema).
  const { minX, minY, maxX, maxY } = boundsOfPoints(points);
  return {
    left: minX,
    top: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
};

const cloneHistoryPayloadValue = (value) => deepClone(value);

const getHistoryAnnotationVisualBounds = (annotation) => {
  if (!annotation || typeof annotation !== 'object') return null;
  const strokeWidth = Number(annotation.strokeWidth) || 1;
  const scaleX = Number.isFinite(Number(annotation.scaleX)) ? Number(annotation.scaleX) : 1;
  const scaleY = Number.isFinite(Number(annotation.scaleY)) ? Number(annotation.scaleY) : 1;
  let left = Number(annotation.left);
  let top = Number(annotation.top);
  let width = Math.abs((Number(annotation.width) || 0) * scaleX);
  let height = Math.abs((Number(annotation.height) || 0) * scaleY);

  if (
    Number.isFinite(Number(annotation.x1))
    && Number.isFinite(Number(annotation.y1))
    && Number.isFinite(Number(annotation.x2))
    && Number.isFinite(Number(annotation.y2))
  ) {
    const x1 = Number(annotation.x1);
    const y1 = Number(annotation.y1);
    const x2 = Number(annotation.x2);
    const y2 = Number(annotation.y2);
    left = Number.isFinite(left) ? left + Math.min(x1, x2) : Math.min(x1, x2);
    top = Number.isFinite(top) ? top + Math.min(y1, y2) : Math.min(y1, y2);
    width = Math.max(width, Math.abs(x2 - x1));
    height = Math.max(height, Math.abs(y2 - y1));
  }

  const pathBounds = getHistoryPathVisualBounds(annotation.path);
  if (pathBounds && (pathBounds.width > width || pathBounds.height > height || left === 0 || top === 0)) {
    left = pathBounds.left;
    top = pathBounds.top;
    width = Math.max(width, pathBounds.width);
    height = Math.max(height, pathBounds.height);
  }

  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  const padding = Math.max(6, strokeWidth + 4);
  return {
    coordinateSpace: 'page-fabric',
    left: roundHistoryDebugNumber(left - padding),
    top: roundHistoryDebugNumber(top - padding),
    width: roundHistoryDebugNumber(Math.max(8, width + padding * 2)),
    height: roundHistoryDebugNumber(Math.max(8, height + padding * 2)),
    angle: roundHistoryDebugNumber(annotation.angle),
  };
};

const buildHistoryRestoreAction = (action) => {
  if (!action || typeof action !== 'object') return null;
  if (action.type === 'fabric:delete' && action.annotation) {
    const annotation = cloneHistoryPayloadValue(action.annotation);
    if (!annotation) return null;
    return {
      type: 'fabric:create',
      pageNumber: action.pageNumber,
      annotationId: action.annotationId || getHistoryAnnotationId(annotation),
      annotation,
      index: Number.isInteger(action.index) ? action.index : null,
    };
  }
  if (action.type === 'fabric:batch' && Array.isArray(action.deleted) && action.deleted.length > 0) {
    const created = action.deleted
      .map((entry) => {
        const annotation = cloneHistoryPayloadValue(entry?.annotation);
        if (!annotation) return null;
        return {
          id: entry.id || getHistoryAnnotationId(annotation),
          annotation,
          index: Number.isInteger(entry.index) ? entry.index : null,
        };
      })
      .filter((entry) => entry?.id && entry.annotation);
    if (created.length === 0) return null;
    return {
      type: 'fabric:batch',
      pageNumber: action.pageNumber,
      created,
      deleted: [],
      updated: [],
    };
  }
  return null;
};

const normalizeHistoryLaneLabel = (source) => {
  const text = String(source || '').toLowerCase();
  if (text.includes('local')) return 'local annotation history';
  if (text.includes('callout')) return 'callout history';
  if (text.includes('yjs') || text.includes('crdt')) return 'Yjs/CRDT history';
  if (text.includes('legacy')) return 'legacy history';
  return source || null;
};

const normalizeHistoryActionType = (actionType, annotation = null, fallback = null) => {
  const type = String(actionType || '').toLowerCase();
  const dataType = String(annotation?.data?.type || annotation?.type || '').toLowerCase();
  const source = String(fallback || '').toLowerCase();
  if (type.includes('create') || source.includes('create')) return 'create';
  if (type.includes('delete') || source.includes('delete')) return 'delete';
  if (type.includes('undo')) return 'undo';
  if (type.includes('redo')) return 'redo';
  if (source.includes('callout')) return source.includes('create') ? 'create' : 'callout edit';
  if (source.includes('text')) return 'text edit';
  if (type.includes('update') || source.includes('modified') || source.includes('update')) {
    if (dataType === 'callout') return 'callout edit';
    if (dataType === 'textbox' || dataType === 'text') return 'text edit';
    return 'move';
  }
  return actionType || fallback || null;
};

// History option A: the fields that make up the color a person sees. A width,
// opacity or line-style change is not a color change.
const HISTORY_COLOR_FIELDS = [
  (a) => a?.stroke,
  (a) => a?.fill,
  (a) => a?.data?.color,
  (a) => a?.data?.strokeColor,
  (a) => a?.data?.fillColor,
  (a) => a?.data?.style?.fontColor,
];
const historyColorFieldsDiffer = (before, after) => HISTORY_COLOR_FIELDS
  .some((read) => JSON.stringify(read(before) ?? null) !== JSON.stringify(read(after) ?? null));

const inferHistoryUpdateType = (before, after) => {
  if (!before || !after) return null;
  const moved = before.left !== after.left || before.top !== after.top;
  const resized = before.width !== after.width || before.height !== after.height
    || before.scaleX !== after.scaleX || before.scaleY !== after.scaleY;
  const rotated = before.angle !== after.angle;
  const textChanged = before.text !== after.text || before.data?.text !== after.data?.text;
  // fabric 7 serializes type capitalized ('Textbox') — compare lowercased.
  const annotationType = String(getHistoryAnnotationType(after || before) || '').toLowerCase();
  // w56: a change that only sets / clears the user lock reads "locked" /
  // "unlocked" in History, not "edited".
  const lockBefore = getMarkLockedBy(before);
  const lockAfter = getMarkLockedBy(after);
  if (lockBefore !== lockAfter && !moved && !resized && !rotated && !textChanged) {
    return lockAfter ? 'lock' : 'unlock';
  }
  if (annotationType === 'callout') return 'callout edit';
  if (textChanged) return annotationType === 'textbox' || annotationType === 'text' ? 'text edit' : 'callout edit';
  if (rotated && !moved && !resized) return 'rotate';
  // w55: dragging a left/top handle resizes AND shifts left/top — that is a
  // resize to the person doing it, not a move.
  if (resized && !rotated) return 'resize';
  if (moved && !resized && !rotated) return 'move';
  if (moved || resized || rotated) return 'move';
  // RULED 2026-09-28 owner: History option A — a change of the mark's color
  // (and nothing else about its shape) reads "changed the color of a …" and
  // gets a Before / After peek.
  if (historyColorFieldsDiffer(before, after)) return 'recolor';
  // w56 (live two-user test 2026-09-28): nothing moved and no text changed —
  // a colour / width / style change. It is "edited text" only on a text box;
  // a restyled pen stroke or shape reads "edited a pen stroke" etc. in
  // History (buildSummary's generic line), never "edited text".
  return annotationType === 'textbox' || annotationType === 'text' ? 'text edit' : 'restyle';
};

// RULED 2026-09-28 owner: History option A — a Survey Marker step (w53 family
// action, a History restore of a marker) reads as a Survey Marker row and
// carries the marker's box so History can show and highlight it.
const summarizeSurveyMarkerHistoryAction = (action) => {
  const changes = Array.isArray(action.changes) ? action.changes : [];
  const first = changes[0] || {};
  const record = (first.after?.bounds && first.after?.pageNumber ? first.after : null) || first.before || first.after || null;
  const kinds = new Set(changes.map((change) => {
    if (change.before == null && change.after != null) return 'create';
    if (change.after == null) return 'delete';
    const b = change.before || {};
    const a = change.after || {};
    if ((b.lockedBy || null) !== (a.lockedBy || null)) return a.lockedBy ? 'lock' : 'unlock';
    // w54 Cut picks up the placement; Paste puts it back (same record).
    const placedBefore = Boolean(b.bounds && b.pageNumber);
    const placedAfter = Boolean(a.bounds && a.pageNumber);
    if (placedBefore && !placedAfter) return 'unplace';
    if (!placedBefore && placedAfter) return 'place';
    if (JSON.stringify(b.bounds ?? null) !== JSON.stringify(a.bounds ?? null)
      || (b.pageNumber ?? null) !== (a.pageNumber ?? null)) return 'move';
    return 'survey marker edit';
  }));
  const bounds = record?.bounds || null;
  const preview = bounds
    ? {
      type: 'surveyMarker',
      left: Number(bounds.x) || 0,
      top: Number(bounds.y) || 0,
      width: Number(bounds.width) || 0,
      height: Number(bounds.height) || 0,
      angle: Number(bounds.angle) || 0,
      surveyMarker: { name: typeof record?.name === 'string' ? record.name : '' },
    }
    : null;
  const beforeBounds = first.before?.bounds || null;
  return {
    actionType: kinds.size === 1 ? [...kinds][0] : 'survey marker edit',
    rawActionType: action.type,
    annotationType: 'surveyMarker',
    annotationId: first.id || null,
    annotationIds: changes.length > 1 ? changes.map((change) => change.id) : undefined,
    pageNumber: record?.pageNumber ?? null,
    itemCount: changes.length,
    historySource: 'local annotation history',
    previewAnnotation: preview,
    previewBefore: beforeBounds && first.after
      ? {
        type: 'surveyMarker',
        left: Number(beforeBounds.x) || 0,
        top: Number(beforeBounds.y) || 0,
        width: Number(beforeBounds.width) || 0,
        height: Number(beforeBounds.height) || 0,
        angle: Number(beforeBounds.angle) || 0,
      }
      : undefined,
    restoreAction: null,
  };
};

export const summarizeHistoryActionForLog = (action) => {
  if (!action || typeof action !== 'object') return null;
  if (action.type === 'survey-marker:batch') return summarizeSurveyMarkerHistoryAction(action);
  const firstAnnotation = action.annotation || action.after || action.before;
  const batchCreated = Array.isArray(action.created) ? action.created : [];
  const batchDeleted = Array.isArray(action.deleted) ? action.deleted : [];
  const batchUpdated = Array.isArray(action.updated) ? action.updated : [];
  const batchFirst = batchCreated[0]?.annotation || batchDeleted[0]?.annotation || batchUpdated[0]?.after || batchUpdated[0]?.before || null;
  // Outline ink (capsule eraser, a3380bbf) breaks the spotlight's fabric-shaped
  // contract (absolute path commands, left/top of 0, duplicate geometry) —
  // project it down to a compact preview; other types pass through unchanged.
  const previewAnnotation = projectAnnotationForHistoryPreview(
    action.type === 'fabric:delete'
      ? action.annotation
      : action.type === 'fabric:update'
        ? action.after
        : firstAnnotation || batchFirst,
  );
  const ids = [
    action.annotationId,
    ...batchCreated.map((entry) => entry?.id),
    ...batchDeleted.map((entry) => entry?.id),
    ...batchUpdated.map((entry) => entry?.id),
  ].filter(Boolean);
  // w56: a batch that only locks / unlocks (right-click Lock on a selection)
  // reads "locked N annotations", not "edited a …".
  const batchLockToggle = action.type === 'fabric:batch'
    && batchCreated.length === 0 && batchDeleted.length === 0 && batchUpdated.length > 0
    ? (() => {
      const kinds = new Set(batchUpdated.map((entry) => inferHistoryUpdateType(entry?.before, entry?.after)));
      return kinds.size === 1 && (kinds.has('lock') || kinds.has('unlock')) ? [...kinds][0] : null;
    })()
    : null;
  // History option A: one mark's update inside a batch (an erase that trims a
  // stroke, a single-mark group edit) reads like a plain update of that mark.
  const singleUpdate = action.type === 'fabric:update'
    ? { before: action.before, after: action.after }
    : (action.type === 'fabric:batch' && batchUpdated.length === 1
      && batchCreated.length === 0 && batchDeleted.length === 0
      ? batchUpdated[0]
      : null);
  const inferredActionType = action.type === 'fabric:update'
    ? inferHistoryUpdateType(action.before, action.after)
    : (batchLockToggle
      || (singleUpdate ? inferHistoryUpdateType(singleUpdate.before, singleUpdate.after) : null)
      || normalizeHistoryActionType(action.type, firstAnnotation || batchFirst));
  // History option A: the mark as it was before an edit, so History can show
  // a "Before" ghost (old place, size or color). Only for a one-mark edit, and
  // projected + bounded like previewAnnotation.
  const previewBefore = singleUpdate?.before && singleUpdate?.after
    ? slimHistoryPreviewBefore(projectAnnotationForHistoryPreview(singleUpdate.before))
    : null;
  return {
    actionType: inferredActionType,
    rawActionType: action.type || null,
    annotationType: getHistoryAnnotationType(firstAnnotation || batchFirst),
    annotationId: action.annotationId || getHistoryAnnotationId(firstAnnotation) || ids[0] || null,
    annotationIds: ids.length > 1 ? ids : undefined,
    pageNumber: action.pageNumber ?? null,
    itemCount: ids.length || (action.type ? 1 : 0),
    historySource: 'local annotation history',
    visualBounds: getHistoryAnnotationVisualBounds(previewAnnotation),
    previewAnnotation: cloneHistoryPayloadValue(previewAnnotation),
    previewBefore: previewBefore ? cloneHistoryPayloadValue(previewBefore) : undefined,
    restoreAction: buildHistoryRestoreAction(action),
  };
};

export const summarizeHistoryMetaForLog = (meta) => {
  if (!meta || typeof meta !== 'object') return null;
  const context = meta.context || {};
  const hasScopedCalloutIds = getCalloutIdsFromHistoryMeta(meta).length > 0;
  const lane = meta.reason?.startsWith?.('callouts:') || (meta.reason === 'delete:batch' && hasScopedCalloutIds)
    ? 'callout history'
    : 'legacy history';
  return {
    actionType: normalizeHistoryActionType(meta.reason, null, meta.reason),
    rawActionType: meta.reason || null,
    annotationType: context.calloutId || context.calloutIds ? 'callout' : context.pageNumber ? 'fabric' : null,
    annotationId: context.annotationId || context.calloutId || context.annotationId || null,
    annotationIds: Array.isArray(context.calloutIds) ? context.calloutIds : undefined,
    pageNumber: context.pageNumber ?? null,
    checkpointId: meta.checkpointId ?? null,
    order: meta.checkpointId ?? null,
    createdAt: meta.createdAt || null,
    historySource: lane,
  };
};

export const shouldScopeCalloutHistoryRestore = (meta) => {
  const reason = typeof meta?.reason === 'string' ? meta.reason : '';
  if (reason.startsWith('callouts:')) return true;
  return reason === 'delete:batch' && getCalloutIdsFromHistoryMeta(meta).length > 0;
};

export const shouldEchoHistoryDebugEvent = (event) => (
  event?.type === 'local_annotation_history_added'
  || event?.type === 'checkpoint_added'
  || event?.type === 'checkpoint_added_annotation_fast'
  || event?.type === 'yjs_history_added'
  || event?.type === 'undo_choice'
  || event?.type === 'redo_choice'
  || event?.type?.endsWith?.('_undo_applied')
  || event?.type?.endsWith?.('_redo_applied')
  || event?.type === 'yjs_undo_invoked'
  || event?.type === 'yjs_redo_invoked'
  || event?.type === 'yjs_history_popped'
);

export const compactHistoryEventForLog = (event) => {
  if (!event || typeof event !== 'object') return event;
  return {
    seq: event.seq,
    order: event.order ?? event.checkpointId ?? null,
    at: event.at,
    event: event.type,
    actionType: normalizeHistoryActionType(event.actionType || event.rawActionType, null, event.reason),
    rawActionType: event.rawActionType || event.reason || event.actionType || null,
    annotationType: event.annotationType || null,
    annotationId: event.annotationId || null,
    annotationIds: event.annotationIds || undefined,
    pageNumber: event.pageNumber ?? event.context?.pageNumber ?? null,
    lane: normalizeHistoryLaneLabel(event.historySource || event.chosenSource),
    receivedStack: event.receivedStack || null,
    chosenStack: event.chosenStack || null,
    chosenLane: normalizeHistoryLaneLabel(event.chosenSource || event.historySource),
    decisionReason: event.decisionReason || null,
    checkedLanes: event.checkedLanes || undefined,
    undoDepth: event.undoDepth ?? event.localUndoDepth ?? event.legacyUndoDepth ?? event.yUndoDepth ?? null,
    redoDepth: event.redoDepth ?? event.localRedoDepth ?? event.legacyRedoDepth ?? event.yRedoDepth ?? null,
    localCandidate: event.localCandidate || undefined,
    legacyCandidate: event.legacyCandidate || undefined,
    yjsCandidate: event.yjsCandidate ? {
      historySource: normalizeHistoryLaneLabel(event.yjsCandidate.historySource),
      undoDepth: event.yjsCandidate.undoDepth,
      redoDepth: event.yjsCandidate.redoDepth,
      topMeta: event.yjsCandidate.topMeta ? {
        pageNumber: event.yjsCandidate.topMeta.pageNumber ?? null,
        historyDiagnostics: event.yjsCandidate.topMeta.historyDiagnostics || undefined,
      } : undefined,
    } : undefined,
  };
};

export const mapYjsMeta = (meta) => {
  if (!meta || typeof meta.get !== 'function') return {};
  const out = {};
  try {
    meta.forEach((value, key) => { out[key] = value; });
  } catch (_) {
    // diagnostics only
  }
  return out;
};

export const readHistoryDebugConsoleEnabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(HISTORY_DEBUG_CONSOLE_KEY) === '1';
  } catch {
    return false;
  }
};

export const writeHistoryDebugConsoleEnabled = (enabled) => {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) {
      window.sessionStorage.setItem(HISTORY_DEBUG_CONSOLE_KEY, '1');
    } else {
      window.sessionStorage.removeItem(HISTORY_DEBUG_CONSOLE_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
};

export const readDocumentSyncStructuralDisabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(DOCUMENT_SYNC_STRUCTURAL_DISABLED_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return (Date.now() - ts) < DOCUMENT_SYNC_STRUCTURAL_DISABLED_TTL_MS;
  } catch {
    return false;
  }
};

export const writeDocumentSyncStructuralDisabled = (disabled) => {
  if (typeof window === 'undefined') return;
  try {
    if (disabled) {
      window.sessionStorage.setItem(DOCUMENT_SYNC_STRUCTURAL_DISABLED_KEY, String(Date.now()));
    } else {
      window.sessionStorage.removeItem(DOCUMENT_SYNC_STRUCTURAL_DISABLED_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
};

export const readPdfjsLiveStableOverlayEnabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(PDFJS_CANVAS_PRESENTATION_ENABLED_KEY);
    if (raw === null || raw === undefined) return true;
    const normalized = String(raw).trim().toLowerCase();
    return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
  } catch {
    return false;
  }
};

export const readPdfjsDualLayerEnabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(PDFJS_CANVAS_PRESENTATION_ENABLED_KEY);
    if (raw === null || raw === undefined) return true;
    const normalized = String(raw).trim().toLowerCase();
    return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
  } catch {
    return false;
  }
};

export const writePdfjsDualLayerEnabled = (enabled) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PDFJS_CANVAS_PRESENTATION_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage errors.
  }
};

export const readOverlayLagRecorderAutoEnabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(OVERLAY_LAG_RECORDER_AUTO_KEY);
    if (raw === null || raw === undefined) return false;
    const normalized = String(raw).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'on';
  } catch {
    return false;
  }
};

export const writeOverlayLagRecorderAutoEnabled = (enabled) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OVERLAY_LAG_RECORDER_AUTO_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage errors.
  }
};

export const cloneOverlayRecorderPayload = (value) => deepClone(value);

export const roundOverlayRecorderValue = (value, digits = 3) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number(numeric.toFixed(digits));
};

export const percentileOverlayRecorder = (values = [], percentile = 0.95) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(percentile * (sorted.length - 1))));
  return sorted[index];
};

export const getPdfjsOverlayPrefetchPages = (viewerScale) => {
  const numericScale = Number(viewerScale);
  if (!Number.isFinite(numericScale) || numericScale <= 0) {
    return PDFJS_OVERLAY_PREFETCH_PAGES;
  }
  if (numericScale >= 3) return 0;
  if (numericScale >= 2) return 1;
  return PDFJS_OVERLAY_PREFETCH_PAGES;
};

export const measurePdfjsPageScale = (pageNumber, pageSizes, pageContainers, fallbackScale = 1) => {
  const safeFallback = Number.isFinite(fallbackScale) && fallbackScale > 0 ? fallbackScale : 1;
  if (!Number.isFinite(pageNumber)) {
    return safeFallback;
  }

  const pageSize = pageSizes?.[pageNumber];
  const pageHost = pageContainers?.[pageNumber];
  if (!pageSize || !pageHost || !Number.isFinite(pageSize.width) || pageSize.width <= 0) {
    return safeFallback;
  }

  const contentBox =
    pageHost.querySelector?.('.survey-pdfjs-page-canvas') ||
    pageHost.querySelector?.('canvas') ||
    pageHost;
  const hostWidth = contentBox?.clientWidth || pageHost.clientWidth || 0;
  const widthScale = hostWidth > 0 ? hostWidth / pageSize.width : NaN;
  const measuredScale = Number.isFinite(widthScale) && widthScale > 0 ? widthScale : safeFallback;
  return Math.max(0.1, Math.round(measuredScale * 100000) / 100000);
};

export const measurePdfjsPageHostScale = (pageNumber, pageSizes, pageContainers, fallbackScale = 1) => {
  const safeFallback = Number.isFinite(fallbackScale) && fallbackScale > 0 ? fallbackScale : 1;
  if (!Number.isFinite(pageNumber)) {
    return safeFallback;
  }

  const pageSize = pageSizes?.[pageNumber];
  const pageHost = pageContainers?.[pageNumber];
  if (!pageSize || !pageHost || !Number.isFinite(pageSize.width) || pageSize.width <= 0) {
    return safeFallback;
  }

  const hostWidth = Number(pageHost.clientWidth || pageHost.getBoundingClientRect?.().width || 0);
  const widthScale = hostWidth > 0 ? hostWidth / pageSize.width : NaN;
  const measuredScale = Number.isFinite(widthScale) && widthScale > 0 ? widthScale : safeFallback;
  return Math.max(0.1, Math.round(measuredScale * 100000) / 100000);
};

export const normalizeInteractionMeasuredScale = (measuredScale, viewerScale, fallbackScale = 1) => {
  const safeFallback = Number.isFinite(fallbackScale) && fallbackScale > 0
    ? fallbackScale
    : (Number.isFinite(viewerScale) && viewerScale > 0 ? viewerScale : 1);
  const safeViewerScale = Number.isFinite(viewerScale) && viewerScale > 0 ? viewerScale : safeFallback;
  const measured = Number(measuredScale);
  if (!Number.isFinite(measured) || measured <= 0) {
    return safeFallback;
  }

  // Guard against transient container widths during Pdfjs relayout.
  const minExpected = safeViewerScale * 0.55;
  const maxExpected = safeViewerScale * 1.8;
  if (measured < minExpected || measured > maxExpected) {
    return safeFallback;
  }

  return measured;
};

export const parseCssTransformScaleX = (transformValue) => {
  if (!transformValue || transformValue === 'none') {
    return 1;
  }

  const scaleMatch = transformValue.match(/^scale\(([^)]+)\)$/);
  if (scaleMatch) {
    const value = Number.parseFloat(scaleMatch[1].split(',')[0]?.trim());
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  const scale3dMatch = transformValue.match(/^scale3d\(([^)]+)\)$/);
  if (scale3dMatch) {
    const values = scale3dMatch[1]
      .split(',')
      .map((value) => Number.parseFloat(value.trim()))
      .filter((value) => Number.isFinite(value));
    if (values.length > 0) {
      return values[0] > 0 ? values[0] : 1;
    }
  }

  const matrixMatch = transformValue.match(/^matrix\(([^)]+)\)$/);
  if (matrixMatch) {
    const values = matrixMatch[1]
      .split(',')
      .map((value) => Number.parseFloat(value.trim()))
      .filter((value) => Number.isFinite(value));
    if (values.length >= 2) {
      return Math.hypot(values[0], values[1]) || 1;
    }
  }

  const matrix3dMatch = transformValue.match(/^matrix3d\(([^)]+)\)$/);
  if (matrix3dMatch) {
    const values = matrix3dMatch[1]
      .split(',')
      .map((value) => Number.parseFloat(value.trim()))
      .filter((value) => Number.isFinite(value));
    if (values.length >= 3) {
      return Math.hypot(values[0], values[1], values[2]) || 1;
    }
  }

  return 1;
};

// Normalize surveyMarker colors while preserving any opacity saved on the template
export const normalizeSurveyMarkerColor = (color, fallbackOpacity = DEFAULT_SURVEY_MARKER_OPACITY) => {
  if (!color || typeof color !== 'string') {
    return null;
  }

  const trimmed = color.trim();
  const rgbaMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);

  if (rgbaMatch) {
    const [, r, g, b, opacityStr] = rgbaMatch;
    if (opacityStr !== undefined) {
      const parsedOpacity = parseFloat(opacityStr);
      const clampedOpacity = Number.isFinite(parsedOpacity)
        ? Math.min(1, Math.max(0, parsedOpacity))
        : fallbackOpacity;
      return `rgba(${r}, ${g}, ${b}, ${clampedOpacity})`;
    }
    return `rgba(${r}, ${g}, ${b}, ${fallbackOpacity})`;
  }

  // Hex, or anything unreadable (a saved 'var(--text-3)', 'rgba(NaN, ...)'):
  // hexToRgba falls back to the grey ENTITY_FALLBACK_HEX (survey audit
  // 2026-10-01) instead of handing the page an invalid fill.
  return hexToRgba(trimmed, fallbackOpacity);
};

export const getCategoryGlyphLabel = (name) => {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return '?';

  const initials = words
    .map((word) => word.match(/[A-Za-z0-9]/)?.[0] || '')
    .join('')
    .toUpperCase();

  return initials.slice(0, 3) || '?';
};

// Extract hex color from rgba or hex string (for indicator display)
export const getHexFromColor = (color) => {
  if (!color) return null;
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }
  if (color.startsWith('#')) {
    return color;
  }
  return null;
};

const getHexFromEntityColor = (color) => {
  if (!color) return '#E3D1FB';
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }
  if (color.startsWith('#')) {
    return color;
  }
  return '#E3D1FB';
};

export const getOpacityFromEntityColor = (color) => {
  if (!color) return 100;

  // Extract opacity from rgba string
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match && match[4]) {
      // Convert opacity from 0-1 range to 0-100 range
      const opacity = parseFloat(match[4]);
      return Math.round(opacity * 100);
    }
  }

  // For hex colors or if no opacity found, default to 100%
  return 100;
};

export const handleModalOptionMouseEnter = (event) => {
  event.currentTarget.style.background = COLORS.modal.panelHover;
  event.currentTarget.style.borderColor = COLORS.modal.borderActive;
  event.currentTarget.style.boxShadow = COLORS.modal.hoverGlow;
};

export const handleModalOptionMouseLeave = (
  event,
  background = COLORS.modal.panel,
  borderColor = COLORS.modal.borderStrong
) => {
  event.currentTarget.style.background = background;
  event.currentTarget.style.borderColor = borderColor;
  event.currentTarget.style.boxShadow = 'none';
};

export const handleModalSecondaryButtonMouseEnter = (event) => {
  event.currentTarget.style.background = COLORS.modal.secondaryButtonHover;
  event.currentTarget.style.borderColor = COLORS.modal.borderActive;
  event.currentTarget.style.boxShadow = COLORS.modal.hoverGlow;
};

export const handleModalSecondaryButtonMouseLeave = (event) => {
  event.currentTarget.style.background = COLORS.modal.secondaryButton;
  event.currentTarget.style.borderColor = COLORS.modal.borderStrong;
  event.currentTarget.style.boxShadow = 'none';
};

export const handleModalPrimaryButtonMouseEnter = (event) => {
  event.currentTarget.style.background = COLORS.modal.primaryButtonHover;
  event.currentTarget.style.borderColor = COLORS.modal.borderActive;
  event.currentTarget.style.boxShadow = COLORS.modal.hoverGlow;
};

export const handleModalPrimaryButtonMouseLeave = (event) => {
  event.currentTarget.style.background = COLORS.modal.primaryButton;
  event.currentTarget.style.borderColor = COLORS.modal.borderStrong;
  event.currentTarget.style.boxShadow = 'none';
};

export const coerceScrollMode = (value) => (value === 'single' ? 'single' : 'continuous');

const normalizeOutlinePathSegments = (segments) => {
  if (!Array.isArray(segments)) return [];
  return segments
    .map((segment) => String(segment || '').trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean);
};

const normalizeOutlineLooseKey = (value) => {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.pdf\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return cleaned;
};

const extractSourceLeafFromBookmark = (bookmark) => {
  const sourceId = typeof bookmark?.sourceId === 'string' ? bookmark.sourceId : '';
  if (!sourceId) return '';
  const match = sourceId.match(/^pdfjs:[^:]+:(.+)$/);
  if (!match) return '';
  const pathWithOrder = match[1] || '';
  const path = pathWithOrder.replace(/#\d+$/, '');
  const segments = path.split('>').map((part) => String(part || '').trim()).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : '';
};

export const buildOutlinePageLookup = (outlineBookmarks = []) => {
  const fullPathMap = new Map();
  const suffixCandidates = new Map();
  const titleCandidates = new Map();
  const looseTitleCandidates = new Map();

  outlineBookmarks.forEach((bookmark) => {
    if (!bookmark || bookmark.type === 'folder') return;
    const page = coercePageNumber(bookmark?.pageIds?.[0], Number.POSITIVE_INFINITY);
    if (!page) return;

    const normalizedPath = normalizeOutlinePathSegments(bookmark.outlinePath);
    if (!normalizedPath.length) return;

    const fullKey = normalizedPath.join('>');
    fullPathMap.set(fullKey, page);

    const suffixKey = normalizedPath.slice(-2).join('>');
    if (suffixKey) {
      const existing = suffixCandidates.get(suffixKey) || [];
      existing.push(page);
      suffixCandidates.set(suffixKey, existing);
    }

    const titleKey = normalizedPath[normalizedPath.length - 1];
    if (titleKey) {
      const existing = titleCandidates.get(titleKey) || [];
      existing.push(page);
      titleCandidates.set(titleKey, existing);

      const looseTitleKey = normalizeOutlineLooseKey(titleKey);
      if (looseTitleKey) {
        const looseExisting = looseTitleCandidates.get(looseTitleKey) || [];
        looseExisting.push(page);
        looseTitleCandidates.set(looseTitleKey, looseExisting);
      }
    }
  });

  const uniqueSuffixMap = new Map();
  suffixCandidates.forEach((pages, key) => {
    const uniquePages = Array.from(new Set(pages));
    if (uniquePages.length === 1) {
      uniqueSuffixMap.set(key, uniquePages[0]);
    }
  });

  const uniqueTitleMap = new Map();
  const consensusTitleMap = new Map();
  titleCandidates.forEach((pages, key) => {
    const uniquePages = Array.from(new Set(pages));
    if (uniquePages.length === 1) {
      uniqueTitleMap.set(key, uniquePages[0]);
      consensusTitleMap.set(key, uniquePages[0]);
    } else if (uniquePages.length > 1) {
      // Multiple distinct pages — no consensus, skip
    }
  });

  const uniqueLooseTitleMap = new Map();
  const consensusLooseTitleMap = new Map();
  looseTitleCandidates.forEach((pages, key) => {
    const uniquePages = Array.from(new Set(pages));
    if (uniquePages.length === 1) {
      uniqueLooseTitleMap.set(key, uniquePages[0]);
      consensusLooseTitleMap.set(key, uniquePages[0]);
    }
  });

  return {
    fullPathMap,
    uniqueSuffixMap,
    uniqueTitleMap,
    uniqueLooseTitleMap,
    consensusTitleMap,
    consensusLooseTitleMap
  };
};

export const resolveBookmarkPageFromOutlineLookup = (bookmark, lookup) => {
  if (!bookmark || !lookup) return null;
  const normalizedPath = normalizeOutlinePathSegments(bookmark.outlinePath);
  const normalizedName = String(bookmark?.name || '').trim().replace(/\s+/g, ' ').toLowerCase();

  if (normalizedPath.length > 0) {
    const fullKey = normalizedPath.join('>');
    if (lookup.fullPathMap.has(fullKey)) {
      return lookup.fullPathMap.get(fullKey);
    }

    const suffixKey = normalizedPath.slice(-2).join('>');
    if (suffixKey && lookup.uniqueSuffixMap.has(suffixKey)) {
      return lookup.uniqueSuffixMap.get(suffixKey);
    }

    const titleKey = normalizedPath[normalizedPath.length - 1];
    if (titleKey && lookup.uniqueTitleMap.has(titleKey)) {
      return lookup.uniqueTitleMap.get(titleKey);
    }

    const looseTitleKey = normalizeOutlineLooseKey(titleKey);
    if (looseTitleKey && lookup.uniqueLooseTitleMap?.has(looseTitleKey)) {
      return lookup.uniqueLooseTitleMap.get(looseTitleKey);
    }
  }

  if (normalizedName && lookup.uniqueTitleMap.has(normalizedName)) {
    return lookup.uniqueTitleMap.get(normalizedName);
  }

  const normalizedNameLoose = normalizeOutlineLooseKey(normalizedName);
  if (normalizedNameLoose && lookup.uniqueLooseTitleMap?.has(normalizedNameLoose)) {
    return lookup.uniqueLooseTitleMap.get(normalizedNameLoose);
  }

  const sourceLeaf = extractSourceLeafFromBookmark(bookmark);
  const normalizedSourceLeaf = String(sourceLeaf || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (normalizedSourceLeaf && lookup.uniqueTitleMap.has(normalizedSourceLeaf)) {
    return lookup.uniqueTitleMap.get(normalizedSourceLeaf);
  }

  const normalizedSourceLoose = normalizeOutlineLooseKey(normalizedSourceLeaf);
  if (normalizedSourceLoose && lookup.uniqueLooseTitleMap?.has(normalizedSourceLoose)) {
    return lookup.uniqueLooseTitleMap.get(normalizedSourceLoose);
  }

  // Consensus fallback: title appears multiple times but all point to the same page
  if (normalizedName && lookup.consensusTitleMap?.has(normalizedName)) {
    return lookup.consensusTitleMap.get(normalizedName);
  }
  if (normalizedNameLoose && lookup.consensusLooseTitleMap?.has(normalizedNameLoose)) {
    return lookup.consensusLooseTitleMap.get(normalizedNameLoose);
  }
  if (normalizedSourceLeaf && lookup.consensusTitleMap?.has(normalizedSourceLeaf)) {
    return lookup.consensusTitleMap.get(normalizedSourceLeaf);
  }
  if (normalizedSourceLoose && lookup.consensusLooseTitleMap?.has(normalizedSourceLoose)) {
    return lookup.consensusLooseTitleMap.get(normalizedSourceLoose);
  }

  return null;
};

export const sanitizeFilename = (value, fallback = 'export') => {
  if (!value || typeof value !== 'string') return fallback;
  const sanitized = value.trim().replace(/[^a-z0-9_-]+/gi, '_');
  return sanitized || fallback;
};

export const dataURLToUint8Array = (dataUrl) => {
  const base64 = dataUrl.split(',')[1];
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const traceRegionPath = (ctx, region, scaleFactor = 1) => {
  if (!ctx || !region || !Array.isArray(region.coordinates) || region.coordinates.length < 4) {
    return false;
  }

  // Curved (freehand) areas export the same smooth outline the editor draws.
  const coords = getRegionOutlineCoordinates(region);
  ctx.moveTo(coords[0] * scaleFactor, coords[1] * scaleFactor);
  for (let i = 2; i < coords.length; i += 2) {
    ctx.lineTo(coords[i] * scaleFactor, coords[i + 1] * scaleFactor);
  }
  ctx.closePath();
  return true;
};

export const applyRegionMaskToCanvasContext = (context, regions, scaleFactor = 1) => {
  const validRegions = normalizePageRegions(regions);
  if (!context || validRegions.length === 0) {
    return;
  }

  // Solid overlay
  context.save();
  context.fillStyle = 'rgba(40, 40, 40, 0.55)';
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  context.globalCompositeOperation = 'destination-out';
  validRegions.forEach(region => {
    context.beginPath();
    if (traceRegionPath(context, region, scaleFactor)) {
      context.fill();
    }
  });
  context.globalCompositeOperation = 'source-over';
  context.restore();

  // Hatched overlay
  context.save();
  const hatchCanvas = document.createElement('canvas');
  hatchCanvas.width = 12;
  hatchCanvas.height = 12;
  const hatchCtx = hatchCanvas.getContext('2d');
  hatchCtx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  hatchCtx.lineWidth = 1;
  hatchCtx.beginPath();
  hatchCtx.moveTo(0, 12);
  hatchCtx.lineTo(12, 0);
  hatchCtx.stroke();
  hatchCtx.beginPath();
  hatchCtx.moveTo(-4, 12);
  hatchCtx.lineTo(8, 0);
  hatchCtx.stroke();

  const pattern = context.createPattern(hatchCanvas, 'repeat');
  if (pattern) {
    context.fillStyle = pattern;
    context.globalAlpha = 0.35;
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'destination-out';
    validRegions.forEach(region => {
      context.beginPath();
      if (traceRegionPath(context, region, scaleFactor)) {
        context.fill();
      }
    });
    context.globalCompositeOperation = 'source-over';
  }
  context.restore();
};

const normalizeName = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

export const hasNameConflict = (
  items,
  candidateName,
  {
    getName = (item) => item?.name,
    getId = (item) => item?.id,
    ignoreId,
    predicate
  } = {}
) => {
  if (!Array.isArray(items)) return false;
  const normalizedCandidate = normalizeName(candidateName);
  if (!normalizedCandidate) return false;

  const shouldIgnore = typeof ignoreId !== 'undefined';

  return items.some((item) => {
    if (!item) return false;
    if (predicate && !predicate(item)) return false;
    if (shouldIgnore && getId(item) === ignoreId) return false;
    const existingName = normalizeName(getName(item));
    return existingName && existingName === normalizedCandidate;
  });
};

export const ZOOM_MODE_LABELS = {
  [ZOOM_MODES.FIT_PAGE]: 'Fit page',
  [ZOOM_MODES.FIT_WIDTH]: 'Fit width',
  [ZOOM_MODES.FIT_HEIGHT]: 'Fit height',
  [ZOOM_MODES.MANUAL]: 'Manual %'
};

const ZOOM_MODE_DESCRIPTIONS = {
  [ZOOM_MODES.FIT_PAGE]: 'Show the entire page within the viewport.',
  [ZOOM_MODES.FIT_WIDTH]: 'Fill the viewer width. Scroll vertically for height.',
  [ZOOM_MODES.FIT_HEIGHT]: 'Fill the viewer height. Horizontal scroll may appear.',
  [ZOOM_MODES.MANUAL]: 'Use a specific zoom percentage.'
};

export const ZOOM_MODE_OPTIONS = [
  {
    id: ZOOM_MODES.FIT_PAGE,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.FIT_PAGE],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.FIT_PAGE]
  },
  {
    id: ZOOM_MODES.FIT_WIDTH,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.FIT_WIDTH],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.FIT_WIDTH]
  },
  {
    id: ZOOM_MODES.FIT_HEIGHT,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.FIT_HEIGHT],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.FIT_HEIGHT]
  },
  {
    id: ZOOM_MODES.MANUAL,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.MANUAL],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.MANUAL]
  }
];

export const MANUAL_ZOOM_SESSION_KEY = 'pdfViewerManualZoomScale';

// ==========================================
// DATA PERSISTENCE LAYER
// ==========================================

export const generateUUID = () => crypto.randomUUID();

// Store structure: { [pdfId]: { items: {}, annotations: {} } }
// Items: { [itemId]: { itemId, itemType, name, quantity, installationData, commissioningData, ... } }
// Annotations: { [annotationId]: { annotationId, pdfCoordinates, displayType, spaceId, itemId, itemType, notesData } }

export const getPDFId = (file) => {
  if (!file) return null;
  // Page mutations produce a new File with a different byte size. Preserve
  // the original identity so bookmarks, page transforms and annotations stay
  // attached to the document throughout the editing session.
  return file._surveyPdfId || `${file.name}-${file.size}`;
};

export const loadPDFData = (pdfId) => {
  if (!pdfId) return { items: {}, annotations: {} };
  try {
    const data = localStorage.getItem(`pdfData_${pdfId}`);
    if (!data) return { items: {}, annotations: {} };
    const parsed = JSON.parse(data);
    return {
      items: parsed.items || {},
      annotations: parsed.annotations || {}
    };
  } catch (e) {
    // console.error('Error loading PDF data:', e);
    return { items: {}, annotations: {} };
  }
};

export const savePDFData = (pdfId, items, annotations) => {
  if (!pdfId) return;
  try {
    const data = { items, annotations };
    localStorage.setItem(`pdfData_${pdfId}`, JSON.stringify(data));
  } catch (e) {
    console.error('Error saving PDF data:', e);
  }
};

// Inline (base64) note photos/videos are what push this cache past the ~5MB
// localStorage quota, and one failed setItem used to stop caching EVERY marker
// of the document. When the full map does not fit, drop the bytes of the
// largest inline media first (the item keeps its name, marked cacheOmitted —
// see normalizeNoteMedia in services/surveyMediaService.js) until it fits, so
// every marker's other fields keep caching. Warns once per document.
const surveyMarkerCacheWarned = new Set();
const warnSurveyMarkerCacheOnce = (pdfId, message, error) => {
  if (surveyMarkerCacheWarned.has(pdfId)) return;
  surveyMarkerCacheWarned.add(pdfId);
  console.warn(`[surveyMarkers cache] ${message}`, error || '');
};
const SURVEY_MARKER_CACHE_MAX_TRIES = 8;

export const saveSurveyMarkers = (pdfId, surveyMarkers) => {
  if (!pdfId) return false;
  const key = `surveyMarkers_${pdfId}`;
  let fullError = null;
  try {
    localStorage.setItem(key, JSON.stringify(surveyMarkers));
    return true;
  } catch (e) {
    fullError = e;
  }
  const heavy = [];
  for (const [id, marker] of Object.entries(surveyMarkers || {})) {
    for (const noteKey of ['note', 'notes']) {
      const note = marker?.[noteKey];
      if (!note || typeof note !== 'object') continue;
      for (const field of ['photos', 'videos']) {
        (Array.isArray(note[field]) ? note[field] : []).forEach((item, index) => {
          const url = item && typeof item === 'object' ? item.dataUrl : null;
          if (typeof url === 'string' && url) heavy.push({ id, noteKey, field, index, bytes: url.length });
        });
      }
    }
  }
  heavy.sort((a, b) => b.bytes - a.bytes);
  const reduced = { ...surveyMarkers };
  for (let i = 0; i < heavy.length; i += 1) {
    const { id, noteKey, field, index } = heavy[i];
    const marker = reduced[id];
    const list = marker[noteKey][field].slice();
    list[index] = { name: list[index]?.name, dataUrl: null, cacheOmitted: true };
    reduced[id] = { ...marker, [noteKey]: { ...marker[noteKey], [field]: list } };
    // Try after each of the largest few, then only once everything is dropped.
    if (i < SURVEY_MARKER_CACHE_MAX_TRIES - 1 || i === heavy.length - 1) {
      try {
        localStorage.setItem(key, JSON.stringify(reduced));
        warnSurveyMarkerCacheOnce(pdfId, `Too large for this device's cache; cached ${pdfId} without ${i + 1} inline photo/video file(s).`, fullError);
        return true;
      } catch { /* drop the next one */ }
    }
  }
  // The previous snapshot stays (setItem is atomic on failure).
  warnSurveyMarkerCacheOnce(pdfId, `Could not cache survey markers for ${pdfId} on this device.`, fullError);
  return false;
};

export const saveAnnotationsByPage = (pdfId, annotationsByPage) => {
  if (!pdfId) return false;
  try {
    const data = JSON.stringify(annotationsByPage);
    if (typeof data !== 'string') return false;
    localStorage.setItem(`annotationsByPage_${pdfId}`, data);
    return true;
  } catch {
    // These entries may be the only copy of local/offline edits, not a cache.
    // Never evict another document to make room or claim this backup succeeded.
    // setItem is atomic on failure, so the prior saved snapshot remains intact.
    return false;
  }
};

export const loadAnnotationsByPage = (pdfId) => {
  if (!pdfId) return {};
  try {
    const data = localStorage.getItem(`annotationsByPage_${pdfId}`);
    if (!data) return {};
    return JSON.parse(data);
  } catch (e) {
    console.error('Error loading annotationsByPage:', e);
    return {};
  }
};

const cloudRenderCacheKey = (pdfId) => `cloudRenderAnnotationsByPage_${pdfId}`;

export const countAnnotationPageObjects = (pages) => Object.values(pages || {}).reduce(
  (sum, page) => sum + (Array.isArray(page?.objects) ? page.objects.length : 0),
  0
);

export const summarizeAnnotationCountsForSaveExport = (annotationsByPage, callouts = [], surveyMarkers = {}) => {
  const byType = {};
  let totalObjects = 0;
  let importedPdfObjects = 0;
  for (const page of Object.values(annotationsByPage || {})) {
    if (!page || !Array.isArray(page.objects)) continue;
    for (const obj of page.objects) {
      totalObjects += 1;
      const type = obj?.data?.annotationType || obj?.type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
      if (obj?.isPdfImported || obj?.pdfAnnotationId) importedPdfObjects += 1;
    }
  }
  const calloutCount = Array.isArray(callouts) ? callouts.length : 0;
  if (calloutCount > 0) byType.callout = (byType.callout || 0) + calloutCount;
  const surveyMarkerCount = surveyMarkers && typeof surveyMarkers === 'object'
    ? Object.keys(surveyMarkers).length
    : 0;
  if (surveyMarkerCount > 0) byType.surveyMarker = (byType.surveyMarker || 0) + surveyMarkerCount;
  return {
    totalObjects,
    calloutCount,
    surveyMarkerCount,
    importedPdfObjects,
    byType
  };
};

const PDF_IMPORTED_EDIT_MARKER_KEYS = new Set([
  'pdfImportedEditState',
  'pdfImportedEditedAt',
  'pdfImportedEditedBy',
  'pdfImportedEditSource',
  // w33: provenance the store does not keep (annotationMarkCodec.js
  // UNSTORED_DATA_FIELDS). A copy that still carries it is not an edit.
  'pdfInkSourceGeometry',
]);

const isPdfImportedAnnotationObject = (obj) => Boolean(obj?.isPdfImported || obj?.pdfAnnotationId);
const isEditedPdfImportedAnnotationObject = (obj) => (
  isPdfImportedAnnotationObject(obj)
  && (
    obj?.pdfImportedEditState === 'edited'
    || obj?.data?.pdfImportedEditState === 'edited'
  )
);

const getPdfImportedAnnotationKey = (obj) => (
  obj?.id
  || obj?.data?.id
  || obj?.annotationId
  || (obj?.pdfAnnotationId ? `pdf:${obj.pdfAnnotationId}` : null)
);

const getPdfAppearanceCompositeId = (obj) => (
  obj?.data?.pdfAppearanceCompositeId
  || obj?.pdfAppearanceCompositeId
  || null
);

const sanitizePdfImportedObjectForEditCompare = (value) => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePdfImportedObjectForEditCompare(entry));
  }
  const out = {};
  Object.entries(value).forEach(([key, entry]) => {
    if (PDF_IMPORTED_EDIT_MARKER_KEYS.has(key)) return;
    out[key] = sanitizePdfImportedObjectForEditCompare(entry);
  });
  return out;
};

const getPdfImportedEditComparable = (obj) => {
  try {
    return JSON.stringify(sanitizePdfImportedObjectForEditCompare(obj || null));
  } catch (_) {
    return null;
  }
};

const shouldStampPdfImportedEditStateForSource = (source, previousObject, nextObject) => {
  if (!isPdfImportedAnnotationObject(nextObject)) return false;
  if (nextObject?.pdfImportedEditState === 'edited' || nextObject?.data?.pdfImportedEditState === 'edited') {
    return false;
  }
  const normalizedSource = String(source || '').toLowerCase();
  if (normalizedSource.includes('import') || normalizedSource.includes('hydrate') || normalizedSource.includes('sync')) {
    return false;
  }
  if (!previousObject) {
    return normalizedSource === 'object:modified' || normalizedSource.includes('paste');
  }
  return getPdfImportedEditComparable(previousObject) !== getPdfImportedEditComparable(nextObject);
};

export const markEditedImportedPdfAnnotationsOnPage = (incomingPage, previousPage, { source, userId, pageNumber } = {}) => {
  const objects = Array.isArray(incomingPage?.objects) ? incomingPage.objects : [];
  if (objects.length === 0) return incomingPage;

  const previousByKey = new Map();
  (Array.isArray(previousPage?.objects) ? previousPage.objects : []).forEach((obj) => {
    const key = getPdfImportedAnnotationKey(obj);
    if (key) previousByKey.set(key, obj);
  });

  const normalizedSource = String(source || '').toLowerCase();
  const suppressCompositePropagation = (
    normalizedSource.includes('import')
    || normalizedSource.includes('hydrate')
    || normalizedSource.includes('sync')
  );
  const dirtyCompositeIds = new Set();
  if (!suppressCompositePropagation) {
    const previousCompositeKeys = new Map();
    const incomingCompositeKeys = new Map();
    const addCompositeKey = (target, obj) => {
      const compositeId = getPdfAppearanceCompositeId(obj);
      const key = getPdfImportedAnnotationKey(obj);
      if (!compositeId || !key) return;
      if (!target.has(compositeId)) target.set(compositeId, []);
      target.get(compositeId).push(key);
    };
    (Array.isArray(previousPage?.objects) ? previousPage.objects : []).forEach((obj) => (
      addCompositeKey(previousCompositeKeys, obj)
    ));
    objects.forEach((obj) => {
      addCompositeKey(incomingCompositeKeys, obj);
      const key = getPdfImportedAnnotationKey(obj);
      const previousObject = key ? previousByKey.get(key) : null;
      const compositeId = getPdfAppearanceCompositeId(obj);
      if (
        compositeId
        && (
          isEditedPdfImportedAnnotationObject(obj)
          || shouldStampPdfImportedEditStateForSource(source, previousObject, obj)
        )
      ) {
        dirtyCompositeIds.add(compositeId);
      }
    });
    const allCompositeIds = new Set([
      ...previousCompositeKeys.keys(),
      ...incomingCompositeKeys.keys(),
    ]);
    allCompositeIds.forEach((compositeId) => {
      const previousKeys = (previousCompositeKeys.get(compositeId) || []).sort();
      const incomingKeys = (incomingCompositeKeys.get(compositeId) || []).sort();
      if (JSON.stringify(previousKeys) !== JSON.stringify(incomingKeys)) {
        dirtyCompositeIds.add(compositeId);
      }
    });
  }

  let editedCount = 0;
  const editedAt = new Date().toISOString();
  const markedObjects = objects.map((obj) => {
    const key = getPdfImportedAnnotationKey(obj);
    const previousObject = key ? previousByKey.get(key) : null;
    const compositeId = getPdfAppearanceCompositeId(obj);
    const shouldStamp = (
      shouldStampPdfImportedEditStateForSource(source, previousObject, obj)
      || (compositeId && dirtyCompositeIds.has(compositeId))
    );
    if (!shouldStamp) return obj;
    if (
      obj?.pdfImportedEditState === 'edited'
      && obj?.data?.pdfImportedEditState === 'edited'
    ) {
      return obj;
    }
    editedCount += 1;
    const stamp = {
      ...obj,
      pdfImportedEditState: 'edited',
      pdfImportedEditedAt: editedAt,
      pdfImportedEditedBy: userId || null,
      pdfImportedEditSource: source || null,
      data: {
        ...(obj.data || {}),
        pdfImportedEditState: 'edited',
      },
    };
    return stamp;
  });

  if (editedCount === 0) return incomingPage;
  appDebug('[PDFImportedEditExport] edit marker stamped ' + JSON.stringify({
    pageNumber: pageNumber || incomingPage?.pageNumber || null,
    source: source || null,
    editedImportedCopies: editedCount,
    reason: 'imported PDF annotation changed in app state; export must write the app-edited copy instead of skipping it as an unedited native duplicate.'
  }));
  return {
    ...(incomingPage || {}),
    objects: markedObjects,
  };
};

// w29 (open speed): a document whose marks do not fit in localStorage
// (Package 2: 3,071 imported ink marks, many MB of JSON) failed this save on
// EVERY change after ~70 ms of JSON.stringify on the main thread, and left an
// older, smaller copy behind to paint next time. After a save does not fit,
// the old copy is removed and saves are skipped while the page holds at least
// that many marks (this session).
const cloudRenderCacheTooLarge = new Map(); // pdfId -> object count that did not fit

export const saveCloudRenderAnnotationsByPage = (pdfId, metadata, annotationsByPage) => {
  if (!pdfId) return;
  const objectCount = countAnnotationPageObjects(annotationsByPage);
  const tooLargeAt = cloudRenderCacheTooLarge.get(pdfId);
  if (tooLargeAt != null && objectCount >= tooLargeAt) return;
  try {
    localStorage.setItem(cloudRenderCacheKey(pdfId), JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      documentId: metadata?.documentId || null,
      cutoverTs: metadata?.cutoverTs || null,
      annotationsByPage: annotationsByPage || {}
    }));
    cloudRenderCacheTooLarge.delete(pdfId);
  } catch (e) {
    if (e?.name !== 'QuotaExceededError' && e?.code !== 22) {
      console.warn('[Cloud render cache] save failed:', e);
      return;
    }
    cloudRenderCacheTooLarge.set(pdfId, objectCount);
    try { localStorage.removeItem(cloudRenderCacheKey(pdfId)); } catch { /* storage unavailable */ }
  }
};

export const loadCloudRenderAnnotationsByPage = (pdfId, metadata) => {
  if (!pdfId) return null;
  try {
    const raw = localStorage.getItem(cloudRenderCacheKey(pdfId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.documentId !== (metadata?.documentId || null)) return null;
    if ((parsed?.cutoverTs || null) !== (metadata?.cutoverTs || null)) return null;
    return parsed?.annotationsByPage || {};
  } catch (e) {
    console.warn('[Cloud render cache] load failed:', e);
    return null;
  }
};

export const loadSurveyMarkers = (pdfId) => {
  if (!pdfId) return {};
  try {
    let data = localStorage.getItem(`surveyMarkers_${pdfId}`);
    if (!data) {
      // One-time migration: the survey-marker cache key was previously
      // `surveyMarkers_*`. Read the old key once, copy it forward
      // under the new name, then drop the old entry.
      const legacyKey = `surveyMarkers_${pdfId}`;
      const legacyData = localStorage.getItem(legacyKey);
      if (legacyData) {
        localStorage.setItem(`surveyMarkers_${pdfId}`, legacyData);
        localStorage.removeItem(legacyKey);
        data = legacyData;
      }
    }
    if (!data) return {};
    return JSON.parse(data);
  } catch (e) {
    console.error('Error loading survey markers:', e);
    return {};
  }
};

// Save callouts to localStorage
export const saveCallouts = (pdfId, callouts) => {
  if (!pdfId) return;
  try {
    const key = `callouts_${pdfId}`;
    const normalizedCallouts = normalizeCalloutsForSync(callouts);
    const data = JSON.stringify(normalizedCallouts);
    localStorage.setItem(key, data);
    recordAnnotationBackupWrite({
      kind: 'callout-localStorage',
      count: 1,
      calloutCount: normalizedCallouts.length,
      bytes: data.length,
    });
  } catch (e) {
    console.error('Error saving callouts:', e);
  }
};

// Load callouts from localStorage
export const loadCallouts = (pdfId) => {
  if (!pdfId) return [];
  try {
    const data = localStorage.getItem(`callouts_${pdfId}`);
    if (!data) return [];
    return JSON.parse(data);
  } catch (e) {
    console.error('Error loading callouts:', e);
    return [];
  }
};

// ==========================================
// ITEM AND ANNOTATION HELPER FUNCTIONS
// ==========================================

// Get module name from template (for readable IDs)
export const getModuleName = (template, moduleId) => {
  const module = template?.modules?.find(m => m.id === moduleId);
  return module?.name || 'Unknown Module';
};

// Get category name from template
export const getCategoryName = (template, moduleId, categoryId) => {
  const module = template?.modules?.find(m => m.id === moduleId);
  const category = module?.categories?.find(c => c.id === categoryId);
  return category?.name || 'Unknown Category';
};

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const generateDefaultSurveyMarkerName = (categoryName, surveyMarkers = []) => {
  const baseName = (categoryName && typeof categoryName === 'string' && categoryName.trim()) ? categoryName.trim() : 'Untitled Category';
  const pattern = new RegExp(`^${escapeRegExp(baseName)}\\s+(\\d+)$`, 'i');
  let maxNumber = 0;

  surveyMarkers.forEach(surveyMarker => {
    // Handle case where name might be an object (corrupted data from Excel rich text)
    const rawName = surveyMarker?.name;
    const existingName = (typeof rawName === 'string' ? rawName : String(rawName || '')).trim();
    const match = pattern.exec(existingName);
    if (match) {
      const sequence = parseInt(match[1], 10);
      if (!Number.isNaN(sequence)) {
        maxNumber = Math.max(maxNumber, sequence);
      }
    }
  });

  return `${baseName} ${maxNumber + 1}`;
};

// Get itemType from category name (assumes category.name = itemType)
const getItemType = (template, moduleId, categoryId) => {
  return getCategoryName(template, moduleId, categoryId);
};

// Create new Item object
export const createItem = (template, moduleId, categoryId, name, quantity = 1) => {
  const itemId = generateUUID();
  const itemType = getItemType(template, moduleId, categoryId);
  const moduleName = getModuleName(template, moduleId);

  // Initialize module-specific metadata based on template modules
  const metadata = {};
  if (template?.modules) {
    template.modules.forEach(module => {
      metadata[`${module.name.toLowerCase()}Data`] = {};
    });
  }

  return {
    itemId,
    itemType,
    name,
    quantity,
    ...metadata
  };
};

// Create new Annotation object
export const createAnnotation = (pdfCoordinates, displayType, template, moduleId, itemId, itemType) => {
  const annotationId = generateUUID();

  // Initialize module-specific notes data
  const notesData = {};
  if (template?.modules) {
    template.modules.forEach(module => {
      notesData[`${module.name.toLowerCase()}Data`] = {};
    });
  }

  return {
    annotationId,
    pdfCoordinates,
    displayType,
    moduleId,
    itemId: itemId || null,
    itemType: itemType || null,
    notesData
  };
};

// Get module name key for metadata (e.g., "Installation" -> "installationData")
export const getModuleDataKey = (moduleName) => {
  return `${moduleName.toLowerCase().replace(/\s+/g, '')}Data`;
};

// Get all items in a module
const getModuleItems = (items, moduleId, template) => {
  return Object.values(items).filter(item => {
    const moduleName = getModuleName(template, moduleId);
    const dataKey = getModuleDataKey(moduleName);
    return item[dataKey] && Object.keys(item[dataKey]).length > 0;
  });
};

// Filter annotations by module
export const filterAnnotationsByModule = (annotations, moduleId) => {
  return Object.fromEntries(
    Object.entries(annotations).filter(([_, ann]) => ann.moduleId === moduleId)
  );
};

// ITEM TRANSFER HELPER FUNCTIONS

// Check if category exists in destination module
export const categoryExists = (template, destModuleId, categoryName) => {
  const module = (template?.modules || template?.spaces || []).find(m => m.id === destModuleId);
  if (!module || !module.categories) return false;
  return module.categories.some(cat => cat.name === categoryName);
};

// Clone missing destination categories before an item transfer. Checklist
// identities must be fresh: reusing source IDs causes responses in one module
// to overwrite the other after persistence/reload.
export const cloneMissingTransferCategories = (
  template,
  sourceModuleId,
  destModuleId,
  categoryNames,
  makeId = generateUUID,
) => {
  const modules = template?.modules || template?.spaces || [];
  const sourceModule = modules.find((module) => module.id === sourceModuleId);
  const destinationModule = modules.find((module) => module.id === destModuleId);
  if (!sourceModule || !destinationModule) return template;

  const requested = new Set((categoryNames || []).filter(Boolean));
  const existing = new Set((destinationModule.categories || []).map((category) => category.name));
  const missing = (sourceModule.categories || [])
    .filter((category) => requested.has(category.name) && !existing.has(category.name))
    .map((category) => {
      const sourceItems = category.checklist || category.items || [];
      const clonedItems = sourceItems.map((item) => ({ ...item, id: makeId() }));
      const clone = { ...category, id: makeId(), checklist: clonedItems };
      if (Object.prototype.hasOwnProperty.call(category, 'items')) clone.items = clonedItems;
      return clone;
    });
  if (missing.length === 0) return template;

  const nextModules = modules.map((module) => (
    module.id === destModuleId
      ? { ...module, categories: [...(module.categories || []), ...missing] }
      : module
  ));
  return {
    ...template,
    modules: nextModules,
    spaces: nextModules,
    updatedAt: new Date().toISOString(),
  };
};

// Missing-category transfer is a two-resource change: the template must own
// the destination categories before document annotations may reference them.
// Keep that ordering explicit and testable so a rejected cloud write leaves
// the document untouched and the user can retry the same confirmation.
export const persistTemplateBeforeDocumentMutation = async ({
  persistTemplate,
  applyTemplate,
  applyDocument,
}) => {
  // Guest/local templates have no cloud row. They still need the same ordered
  // in-memory update, but must not manufacture a Supabase id from their local
  // template id or block the transfer on a cloud call that cannot exist.
  if (typeof persistTemplate === 'function') await persistTemplate();
  applyTemplate();
  applyDocument();
};

// Transfer items between modules with proper category checks
export const transferItems = (itemsToTransfer, sourceModuleId, destModuleId, template, items, annotations) => {
  const newItems = { ...items };
  const updatedAnnotations = { ...annotations };

  // Group by itemType to handle categories
  const itemsByType = {};
  itemsToTransfer.forEach(itemId => {
    const item = items[itemId];
    if (!item) return;
    const itemType = item.itemType;
    if (!itemsByType[itemType]) itemsByType[itemType] = [];
    itemsByType[itemType].push(item);
  });

  // Check which categories need to be created
  const categoriesToCreate = [];
  Object.keys(itemsByType).forEach(itemType => {
    if (!categoryExists(template, destModuleId, itemType)) {
      categoriesToCreate.push({ itemType, items: itemsByType[itemType] });
    }
  });

  // Handle categories that already exist - direct transfer
  Object.keys(itemsByType).forEach(itemType => {
    if (categoryExists(template, destModuleId, itemType)) {
      // Find the category ID in destination module
      const destModule = template?.modules?.find(m => m.id === destModuleId);
      const destCategory = destModule?.categories?.find(c => c.name === itemType);
      const destCategoryId = destCategory?.id || null;

      itemsByType[itemType].forEach(item => {
        // Transfer WITHOUT metadata (blank slate)
        const moduleName = getModuleName(template, destModuleId);
        const dataKey = getModuleDataKey(moduleName);

        // Initialize item with destination module data
        // Use a placeholder key so it passes getModuleItems check (which requires Object.keys().length > 0)
        newItems[item.itemId] = {
          ...item,
          [dataKey]: { _initialized: true } // Placeholder so item shows up in module
        };

        // Find source annotation to get pdfCoordinates
        const sourceAnnotation = Object.values(annotations).find(ann =>
          ann.itemId === item.itemId && ann.moduleId === sourceModuleId
        );

        if (sourceAnnotation) {
          // Create a NEW annotation for the destination module (don't modify the source one)
          const destAnnotation = createAnnotation(
            sourceAnnotation.pdfCoordinates,
            sourceAnnotation.displayType || 'highlight',
            template,
            destModuleId,
            item.itemId,
            itemType
          );

          updatedAnnotations[destAnnotation.annotationId] = destAnnotation;
        } else {
          // No source annotation found, but we still need to create one for the destination
          // Use null coordinates - this should be rare
          const destAnnotation = createAnnotation(
            null,
            'highlight',
            template,
            destModuleId,
            item.itemId,
            itemType
          );

          updatedAnnotations[destAnnotation.annotationId] = destAnnotation;
        }
      });
    }
  });

  return { newItems, updatedAnnotations, categoriesToCreate };
};

// Migrate legacy surveyMarkers to new system
export const migrateLegacySurveyMarkers = (legacySurveyMarkers, items, annotations, template) => {
  const newItems = { ...items };
  const newAnnotations = { ...annotations };

  Object.values(legacySurveyMarkers).forEach(surveyMarker => {
    // Skip if already migrated (check if item exists with this name in this module/category)
    const categoryName = getCategoryName(template, surveyMarker.moduleId, surveyMarker.categoryId);
    const existingItem = Object.values(newItems).find(item =>
      item.name === surveyMarker.name &&
      item.itemType === categoryName &&
      surveyMarker.moduleId
    );

    if (existingItem) {
      // Item already exists, just ensure annotation exists
      const existingAnnotation = Object.values(newAnnotations).find(ann =>
        ann.itemId === existingItem.itemId &&
        ann.moduleId === surveyMarker.moduleId
      );

      if (!existingAnnotation) {
        const annotation = createAnnotation(
          surveyMarker.bounds,
          'highlight',
          template,
          surveyMarker.moduleId,
          existingItem.itemId,
          categoryName
        );
        newAnnotations[annotation.annotationId] = annotation;
      }
    } else {
      // Create new item and annotation
      const item = createItem(
        template,
        surveyMarker.moduleId,
        surveyMarker.categoryId,
        surveyMarker.name || 'Untitled Item',
        1
      );

      // Set checklist responses from legacy data
      const moduleName = getModuleName(template, surveyMarker.moduleId);
      const dataKey = getModuleDataKey(moduleName);
      item[dataKey] = surveyMarker.checklistResponses || {};

      const annotation = createAnnotation(
        surveyMarker.bounds,
        'highlight',
        template,
        surveyMarker.moduleId,
        item.itemId,
        categoryName
      );

      newItems[item.itemId] = item;
      newAnnotations[annotation.annotationId] = annotation;
    }
  });

  return { items: newItems, annotations: newAnnotations };
};

// PDF Viewer Component with improved typography
