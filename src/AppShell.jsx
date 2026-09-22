// AppShell — application root: tab management, auth/entity state, chrome host
// divs, the top-right zoom/page pill (reads bottomToolbarApi), and the router
// between Dashboard (home) and PDFViewer (open document).
//
// Extracted from App.jsx. Imports PDFViewer + shared module helpers from
// ./App (one-directional — App.jsx never imports AppShell, so no cycle).
// The entry point (main.jsx) and DevTestRoute import the default from here.
//
// AppShell RECEIVES the rail/toolbar handler bundles that PDFViewer publishes
// (setLeftRailApi / setRightRailApi / setBottomToolbarApi). The 2026-05-13
// identity-churn guard that prevents a max-update-depth render loop (compare
// next vs previous; treat function-only identity changes as "unchanged") lives
// in PDFViewer's publisher effects, not here — preserve that contract.
// (Note: CLAUDE.md still says the guard lives in AppShell; that line is stale.)

import Dashboard from './Dashboard';
import DocumentLockBanner from './components/DocumentLockBanner.jsx';
import Icon from './Icons';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
import PDFSidebar from './PDFSidebar';
import SaveLogBanner from './components/SaveLogBanner';
import Spinner from './components/Spinner';
import ToastHost from './components/ToastHost';
import AnnotationSizeControl, { ANNOTATION_SIZE_PRESETS } from './components/AnnotationSizeControl';
import AnnotationDropdown from './components/AnnotationDropdown';
import { QuickColourDots } from './components/QuickStyleControls';
import BodyPortal from './components/BodyPortal.js';
import { COUNTER_SIZE_MAX, COUNTER_SIZE_MIN, ANNOTATION_WIDTH_DECIMALS } from './utils/annotationSize';
import { matchedQuickColour } from './utils/quickStylePresets';
import SurveySpacesRail from './SurveySpacesRail';
import TabBar from './TabBar';
import {
  MobilePdfViewerDock,
  MobilePdfViewerHeader,
  MobilePdfViewerToolRail,
} from './mobile/MobilePdfViewerChrome';
import YDocProvider from './components/collab/YDocProvider.jsx';
import { ARROWHEAD_STYLE_LABELS } from './components/Callout/types';
import { AuthModal } from './components/AuthModal';
import { FORM_TOOL_IDS } from './components/formDesignerTools';
import { ZOOM_MODES } from './utils/zoomController';
import { createPortal } from 'react-dom';
import { getNetworkLogSnapshot } from './utils/networkLogger';
import { sanitizeConsoleLogText } from './utils/consoleLogFilter';
import { showToast } from './utils/toast';
import { randomUUID } from './utils/randomUUIDPolyfill';
import { getDocumentOpenKey, isSameDocumentTab } from './utils/documentTabIdentity.js';
import { schedulePdfViewerPrefetch } from './utils/pdfViewerPrefetch';
import { shouldWarnBeforeUnloadForTab } from './utils/beforeUnloadGuard.js';
import { getSelectFamilyIconName, getSelectFamilyLabel, getSelectModeIconName, isSelectFamilyTool, isSelectModeActive, SELECT_MODE_OPTIONS, SELECT_MODE_SHORT_LABELS } from './utils/selectModes.js';
import { computeTextMarkupPickerPosition } from './utils/pdfTextMarkup.js';
import { getLiveZoomViewerId, isLiveZoomEventForViewer, LIVE_ZOOM_EVENT } from './utils/liveZoomEvents.js';
import { useAuth } from './contexts/AuthContext';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMSGraph } from './contexts/MSGraphContext';
import { useOptionalAuth } from './components/OptionalAuthPrompt';
import { useStorage, useTemplates } from './hooks/useDatabase';

import { CHROME_GLYPH, FONT_FAMILY, RAIL_CARET, RAIL_CONTROL, RAIL_CONTROL_GLYPH, RAIL_SPLIT_CONTROL_W, REVIEW_TOOL_IDS, ZOOM_MODE_OPTIONS, appDebug, coerceScrollMode, ensureRgbaOpacity, getWindowTrackpadInteractionDebugSavePayload, hexToRgba, writeSaveLogExtraFiles } from './viewerShared';
import { TooltipContext, makeTooltipBinding } from './components/Tooltip';

function RailLiveZoomText({ fallback, viewerId }) {
  const [livePercentage, setLivePercentage] = useState(null);

  useEffect(() => {
    setLivePercentage(null);
    const onLiveZoom = (event) => {
      if (!isLiveZoomEventForViewer(event?.detail, viewerId)) return;
      const percentage = Number(event?.detail?.percentage);
      if (Number.isFinite(percentage)) setLivePercentage(percentage);
    };
    window.addEventListener(LIVE_ZOOM_EVENT, onLiveZoom);
    return () => window.removeEventListener(LIVE_ZOOM_EVENT, onLiveZoom);
  }, [viewerId]);

  return <>{livePercentage ?? fallback}%</>;
}

// Lazy boundary: the dashboard paints without pulling in the viewer (and its
// fabric / annotation / Excel weight). The viewer chunk fetches the first time
// a PDF tab is opened.
const loadPDFViewerModule = () => import('./PDFViewer');
const PDFViewer = lazy(() => loadPDFViewerModule().then((m) => ({ default: m.PDFViewer })));
// Lazy boundary: the compact color picker only renders deep inside the bottom
// toolbar when a rich-text or annotation color picker is explicitly opened.
const CompactColorPicker = lazy(() => import('./components/CompactColorPicker'));

/* Dev build stamp (git hash · dev-server start time, injected by vite.config's
   __BUILD_STAMP__ define). It used to render as a fixed chip in the bottom-left
   corner; the owner removed it 2026-08-07 — "any time I want to know what build
   I'm in, I should be able to just see my console logs", and on mobile the chip
   collided with the left rail. The information still matters (a stale tab served
   by a dead dev server once burned an entire bug hunt), so it is logged ONCE at
   module load instead of occupying screen space. */
if (import.meta.env.DEV && typeof __BUILD_STAMP__ !== 'undefined' && __BUILD_STAMP__) {
  console.info(`[build] ${__BUILD_STAMP__}`);
}

/**
 * The colour channel the tool-properties colour controls write to, and the one
 * function that writes it.
 *
 * UX 2026-09-17 (quick styles): the quick colour dots and the swatch's picker
 * are two ways into the SAME paint, so they resolve it here rather than each
 * working it out for itself. Press a dot and you change exactly what the
 * picker's current tab would have changed; the dot the gold ring sits on is
 * always the colour the picker would open showing. Before this, the picker's
 * rules (the shape fill/border tab, the text-markup palette's own handler, the
 * "one side of a shape must stay visible" rule) lived inside the picker's own
 * render block, where a second caller could not reach them without copying
 * them — and a copy is how the two would eventually disagree.
 */
const resolveAnnotationPaint = (bottomToolbarApi, colorPickerTab) => {
  if (!bottomToolbarApi) return null;
  const tool = bottomToolbarApi.contextTool;
  const isShape = (tool === 'rect' || tool === 'ellipse' || tool === 'polygon' || tool === 'text' || tool === 'callout' || tool === 'counter')
    && !!bottomToolbarApi.handleFillColorChange;
  const isTextMarkupPalette = ['text-markup', 'text-select'].includes(bottomToolbarApi.contextTool);
  const onFillTab = isShape && colorPickerTab === 'fill';
  // 2026-05-25: rectangle / ellipse / polygon keep one side visible — either
  // the fill or the border may be transparent, never both at once.
  const shapeOneVisibleRule = tool === 'rect' || tool === 'ellipse' || tool === 'polygon';

  // One channel — the fill side or the stroke side — with the colour it holds,
  // the opacity it holds, and the write that changes it.
  const channel = (useFill) => ({
    // The picker tab this channel IS, so the swatch can open the picker on the
    // channel the dots act on without a second copy of the rule below.
    tab: useFill ? 'fill' : 'border',
    color: useFill ? (bottomToolbarApi.fillColor || '#ff0000') : bottomToolbarApi.strokeColor,
    opacity: useFill ? ((bottomToolbarApi.fillOpacity ?? 100) / 100) : ((bottomToolbarApi.strokeOpacity ?? 100) / 100),
    apply: (hex, alpha) => {
      if (isTextMarkupPalette && bottomToolbarApi.handleTextMarkupPaintChange) {
        bottomToolbarApi.handleTextMarkupPaintChange(hex, Math.round(alpha * 100));
        return;
      }
      if (useFill) {
        const otherAlpha = (bottomToolbarApi.strokeOpacity ?? 100) / 100;
        if (shapeOneVisibleRule && alpha <= 0 && otherAlpha <= 0) {
          bottomToolbarApi.handleStrokeOpacityChange(100);
        }
        bottomToolbarApi.handleFillColorChange(hex);
        bottomToolbarApi.handleFillOpacityChange(Math.round(alpha * 100));
      } else {
        const otherAlpha = (bottomToolbarApi.fillOpacity ?? 100) / 100;
        if (shapeOneVisibleRule && alpha <= 0 && otherAlpha <= 0) {
          bottomToolbarApi.handleFillOpacityChange(100);
        }
        bottomToolbarApi.handleStrokeColorChange(hex);
        bottomToolbarApi.handleStrokeOpacityChange(Math.round(alpha * 100));
      }
    },
  });

  const picker = channel(onFillTab);
  // UX 2026-09-17: WHICH COLOUR A QUICK DOT CHANGES. The dots change the paint
  // you can see, which for every tool but one is the line: the stroke of a pen
  // or an arrow, the border of a rectangle, ellipse, polygon, text box or
  // callout. That is also the paint the two controls standing beside them act
  // on — the line width and the line type — so the whole quick cluster reads
  // as one idea. The counter is the exception and takes the fill, because a
  // pin's colour IS its fill and its stroke is only the number printed on it.
  // Deliberately NOT the picker's current tab: a tab defaulting to Fill would
  // have pointed the dots at a new rectangle's fill, which is white at 0%
  // opacity, so every dot press would have been invisible and the row would
  // have read as a dead control. The traffic runs the other way instead — the
  // picker OPENS on this channel's tab (quick.tab, applied where the tab state
  // lives) and the swatch beside the dots SHOWS this channel, so the dots, the
  // gold ring and the swatch are three views of one colour.
  const quick = tool === 'counter' && isShape ? channel(true) : channel(false);

  return {
    isShape,
    isTextMarkupPalette,
    onFillTab,
    shapeOneVisibleRule,
    color: picker.color,
    opacity: picker.opacity,
    apply: picker.apply,
    quick,
  };
};

/*
 * PASS 7 (boards 9-12 + 15): the four LINE STYLES and the drawing each one
 * shows. The drawing is the same glyph in the pill and in the menu row, at two
 * sizes, so what the row promises is what the pill reports back.
 */
const LINE_STYLE_OPTIONS = Object.freeze([
  Object.freeze({ value: 'solid', label: 'Solid' }),
  Object.freeze({ value: 'dashed', label: 'Dashed' }),
  Object.freeze({ value: 'dotted', label: 'Dotted' }),
  Object.freeze({ value: 'cloud', label: 'Cloud' }),
]);

const LINE_STYLE_SAMPLE_ICONS = Object.freeze({
  solid: 'lineSampleSolid',
  dashed: 'lineSampleDashed',
  dotted: 'lineSampleDotted',
  cloud: 'lineSampleCloud',
});

/*
 * PASS 7 (board 15): the six ARROWHEADS the boards offer, in board order, each
 * drawn as the head it will put on the line. The app carries three more styles
 * (open triangle, diamond, slash) that only ever arrive from an imported PDF;
 * the list below prepends whichever of those is live so the pill never lies
 * about a mark the user has selected.
 */
const ARROWHEAD_MENU_OPTIONS = Object.freeze([
  Object.freeze({ value: 'none', label: 'None', icon: 'arrowheadNone' }),
  Object.freeze({ value: 'solidTriangle', label: 'Solid', icon: 'arrowheadSolid' }),
  Object.freeze({ value: 'vShape', label: 'Open', icon: 'arrowheadOpen' }),
  Object.freeze({ value: 'openCircle', label: 'Circle', icon: 'arrowheadCircle' }),
  Object.freeze({ value: 'square', label: 'Square', icon: 'arrowheadSquare' }),
  Object.freeze({ value: 'horizontalLine', label: 'Bar', icon: 'arrowheadBar' }),
]);

/*
 * PASS 7 (boards 10 + 16, owner ruling): ARROW ENDS is one dropdown with three
 * values and the same three Lucide glyphs on desktop and in the phone sheet.
 * It writes the two pieces of state the app already has:
 *   End  — the head sits on the finish only        (bothEnds off)
 *   Both — the head is mirrored onto the start too (bothEnds on)
 *   None — no head at either end                   (head style 'none')
 * so nothing new is stored, and picking a head in the Arrowhead pill moves this
 * control back off None by itself.
 */
const ARROW_ENDS_OPTIONS = Object.freeze([
  Object.freeze({ value: 'end', label: 'End', icon: 'moveRight' }),
  Object.freeze({ value: 'both', label: 'Both', icon: 'moveHorizontal' }),
  Object.freeze({ value: 'none', label: 'None', icon: 'minus' }),
]);

/**
 * Whether the tool-properties row is showing a colour control at all, i.e.
 * whether the quick colour dots have a swatch to stand beside. The three arms
 * are the three swatch variants rendered below — stroke-only, counter,
 * fill+border — so a dot can never appear beside a row with no colour to
 * change. Rich-text edit mode is the one deliberate exception: the swatch
 * there paints the text box's own fill and border while the sub-row owns the
 * font colour, and four dots that look like font colours but are not would be
 * a trap.
 */
const showsColorSwatch = (api) => {
  if (!api || api.activeTool === 'eraser' || api.richTextEditor) return false;
  const tool = api.contextTool;
  if (['pen', 'highlighter', 'arrow', 'line', 'polyline', 'text-markup', 'text-select'].includes(tool)) return true;
  if (tool === 'counter') return !!api.handleFillColorChange;
  return ['rect', 'ellipse', 'polygon', 'text', 'callout'].includes(tool) && !!api.handleFillColorChange;
};

export default function App({ devPreviewReturnTab = null }) {
  useEffect(() => schedulePdfViewerPrefetch(loadPDFViewerModule), []);

  const { replaceDocument } = useStorage();

  // Microsoft Graph authentication hook
  const { graphClient, isAuthenticated: isMSAuthenticated, login: msLogin, account: msAccount, needsReconnect: msNeedsReconnect, ensureFreshToken, getAuthSignals: msGetAuthSignals } = useMSGraph();

  // UX 2026-04-22: Global Save Log handler — subscribes to the File menu /
  // Cmd+Shift+L shortcut from the outermost App level so it works on the
  // dashboard, template view, auth flow, or any other screen (not only
  // inside the PDF viewer). Dumps the console buffer to the local 1.log
  // file and pushes to the GitHub logs branch; toast event fires for both
  // success and failure so the user always gets visible confirmation.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const buildAnnotationDomSnapshot = () => {
      try {
        const query = (selector, root = document) => Array.from(root.querySelectorAll(selector));
        const overlays = query('[data-overlay-page]');
        const svgWrappers = query('[data-diag-svg-wrapper]');
        const drawables = query('svg path, svg rect, svg circle, svg line, svg polygon, svg polyline, svg text, svg foreignObject');
        return {
          url: window.location?.href || null,
          appOwnedOverlayRootCount: query('[data-betasafe-app-owned-overlay-root]').length,
          pdfjsPageDivCount: query('.survey-pdfjs-page-div, [id*="_pageDiv_"]').length,
          overlayCount: overlays.length,
          overlays: overlays.slice(0, 12).map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              page: element.getAttribute('data-overlay-page'),
              children: element.childElementCount,
              connected: element.isConnected,
              sourceConnected: element.getAttribute('data-source-page-connected'),
              rect: {
                top: Math.round(rect.top),
                left: Math.round(rect.left),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            };
          }),
          svgWrapperCount: svgWrappers.length,
          svgWrappers: svgWrappers.slice(0, 12).map((element) => ({
            page: element.getAttribute('data-diag-svg-wrapper'),
            visibility: window.getComputedStyle(element).visibility,
            display: window.getComputedStyle(element).display,
            children: element.childElementCount,
            hydrationGated: element.getAttribute('data-annotation-hydration-gated'),
          })),
          svgCount: query('svg').length,
          drawableCount: drawables.length,
          activeHydrationGateCount: query('[data-annotation-visual-cover-active="true"], [data-annotation-hydration-gated="true"]').length,
        };
      } catch (error) {
        return { error: error?.message || String(error) };
      }
    };
    // UX 2026-04-22: Always-on keyboard listener so the shortcut works on
    // iOS Simulator (hardware keyboard) and the Android emulator where
    // there is no Electron File menu. Desktop runs BOTH this and the menu
    // subscription — the menu fires the same event, so behavior is
    // identical whether the user clicks the menu item or hits the keys.
    const keyHandler = (event) => {
      const isShortcut = (event.metaKey || event.ctrlKey)
        && event.shiftKey
        && (event.key === 'L' || event.key === 'l');
      if (!isShortcut) return;
      event.preventDefault();
	      const buf = window.__consoleLogBuffer;
	      const rawConsoleText = Array.isArray(buf) && buf.length > 0
	        ? buf.join('\n')
	        : '(no console output captured)';
	      const builtConsoleText = typeof window.__buildSaveLogConsoleText === 'function'
	        ? window.__buildSaveLogConsoleText(rawConsoleText)
	        : rawConsoleText;
	      const consoleText = sanitizeConsoleLogText(builtConsoleText, window);
      // 2026-04-29 — Cmd+Shift+L now also writes a dated local snapshot under
      // <project>/Logs/ alongside the GitHub push. Snapshot includes console
      // text + a network trace + a small summary block. Best-effort — if the
      // electron bridge isn't there (web build) we silently skip.
      try {
        const api = window.electronAPI;
        if (api && typeof api.saveLogSnapshot === 'function') {
          const trackpadSave = getWindowTrackpadInteractionDebugSavePayload();
          api.saveLogSnapshot({
            consoleText,
            network: getNetworkLogSnapshot(),
            extraFiles: trackpadSave.extraFiles,
            summary: {
              triggeredBy: 'cmd-shift-l',
              userAgent: navigator?.userAgent || null,
              screen: { w: window.innerWidth, h: window.innerHeight },
              consoleLineCount: Array.isArray(buf) ? buf.length : 0,
              overlayPerformance: typeof window.pdfOverlayRecorder?.summary === 'function'
                ? window.pdfOverlayRecorder.summary()
                : null,
              overlayRecorderStatus: typeof window.pdfOverlayRecorder?.status === 'function'
                ? window.pdfOverlayRecorder.status()
                : null,
              trackpadInteractionDebug: trackpadSave.dump?.summary || null,
              trackpadInteractionDebugDump: trackpadSave.dump || null,
              annotationDomSnapshot: buildAnnotationDomSnapshot(),
            },
          }).then(async (res) => {
            if (res?.ok) {
              await writeSaveLogExtraFiles(api, res.dir, trackpadSave.extraFiles);
              console.log('[SaveLog] local snapshot saved at', res.dir);
            }
            else console.warn('[SaveLog] local snapshot failed', res?.error);
          }).catch((err) => console.warn('[SaveLog] local snapshot threw', err?.message || err));
        }
      } catch (snapErr) {
        console.warn('[SaveLog] snapshot trigger error', snapErr?.message || snapErr);
      }
      window.dispatchEvent(new CustomEvent('save-log-banner-start', {
        detail: { consoleText }
      }));
    };
    window.addEventListener('keydown', keyHandler);

    if (!window.electronAPI?.onSaveLogMenu) {
      return () => window.removeEventListener('keydown', keyHandler);
    }
    const unsubscribe = window.electronAPI.onSaveLogMenu(async () => {
      appDebug('[SaveLog] global menu trigger — capturing console buffer');
	      const api = window.electronAPI;
	      const buf = window.__consoleLogBuffer;
	      const rawConsoleText = Array.isArray(buf) && buf.length > 0
	        ? buf.join('\n')
	        : '(no console output captured)';
	      const builtConsoleText = typeof window.__buildSaveLogConsoleText === 'function'
	        ? window.__buildSaveLogConsoleText(rawConsoleText)
	        : rawConsoleText;
	      const consoleText = sanitizeConsoleLogText(builtConsoleText, window);

      // 2026-06-04 — BUG#1 fix: the menu path is the one that actually runs for
      // the saved bundle, but it was building console text purely from the
      // fragile in-page buffer (`buf`), which gets reset by navigations
      // (engine toggle, sign-out, PDF-open chunk re-eval). The Electron main
      // process keeps a continuous log of EVERY renderer console message across
      // the whole session, so prefer that here (exactly like the main.jsx
      // bulletproof keydown handler) and fall back to the in-page buffer only
      // when the continuous file is empty/unavailable. Best-effort + try/catch
      // so logging can never break the save.
      let finalConsoleText = consoleText;
      let finalLineCount = Array.isArray(buf) ? buf.length : 0;
      let consoleSource = 'in-page-buffer';
      try {
        if (typeof api?.readContinuousLog === 'function') {
          const mainRes = await api.readContinuousLog().catch(() => null);
          const mainText = (mainRes && mainRes.ok && typeof mainRes.text === 'string') ? mainRes.text : '';
          if (mainText && mainText.length) {
            const builtMain = typeof window.__buildSaveLogConsoleText === 'function'
              ? window.__buildSaveLogConsoleText(mainText)
              : mainText;
            finalConsoleText = sanitizeConsoleLogText(builtMain, window);
            finalLineCount = finalConsoleText
              ? finalConsoleText.split('\n').filter((l) => l.length > 0).length
              : 0;
            consoleSource = 'main-process-continuous';
          }
        }
      } catch (_e) { /* fall back to the in-page buffer text */ }

      // Local save first so a failed GitHub push still leaves the user with a
      // copy on disk.
      if (typeof api?.writeFile === 'function') {
        try {
          const ts = new Date().toISOString();
          const header = `===== SaveLog (global) @ ${ts} =====\n`;
          await api.writeFile(
            '/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log',
            header + finalConsoleText + '\n'
          );
          console.log(`[SaveLog] wrote ${finalLineCount} lines locally (source: ${consoleSource})`);
        } catch (wErr) {
          console.warn('[SaveLog] local write failed:', wErr?.message || wErr);
        }
      }

      // 2026-04-29 — same dated-snapshot save as the keyboard path.
      if (api && typeof api.saveLogSnapshot === 'function') {
        try {
          const trackpadSave = getWindowTrackpadInteractionDebugSavePayload();
          const res = await api.saveLogSnapshot({
            consoleText: finalConsoleText,
            network: getNetworkLogSnapshot(),
            extraFiles: trackpadSave.extraFiles,
            summary: {
              triggeredBy: 'menu',
              userAgent: navigator?.userAgent || null,
              screen: { w: window.innerWidth, h: window.innerHeight },
              consoleLineCount: finalLineCount,
              consoleSource,
              overlayPerformance: typeof window.pdfOverlayRecorder?.summary === 'function'
                ? window.pdfOverlayRecorder.summary()
                : null,
              overlayRecorderStatus: typeof window.pdfOverlayRecorder?.status === 'function'
                ? window.pdfOverlayRecorder.status()
                : null,
              trackpadInteractionDebug: trackpadSave.dump?.summary || null,
              trackpadInteractionDebugDump: trackpadSave.dump || null,
              annotationDomSnapshot: buildAnnotationDomSnapshot(),
            },
          });
          if (res?.ok) {
            await writeSaveLogExtraFiles(api, res.dir, trackpadSave.extraFiles);
            console.log('[SaveLog] local snapshot saved at', res.dir);
          }
          else console.warn('[SaveLog] local snapshot failed', res?.error);
        } catch (snapErr) {
          console.warn('[SaveLog] snapshot trigger error', snapErr?.message || snapErr);
        }
      }

      // UX 2026-04-22: Hand off to SaveLogBanner. The banner owns the 5-second
      // countdown + optional description entry + GitHub push so the user has
      // a chance to explain what broke before the Issue is opened. Local save
      // already finished above, so cancelling only skips the GitHub push.
      if (typeof api?.pushLogToGithub === 'function') {
        window.dispatchEvent(new CustomEvent('save-log-banner-start', {
          detail: { consoleText: finalConsoleText }
        }));
      } else {
        // Web build / no Electron shell — local save wasn't possible either.
        window.dispatchEvent(new CustomEvent('save-log-toast', {
          detail: { type: 'error', message: 'Save log unavailable outside desktop app' }
        }));
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      window.removeEventListener('keydown', keyHandler);
    };
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedPDF, setSelectedPDF] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [documents, setDocuments] = useState(() => {
    if (
      import.meta.env.DEV
      && typeof window !== 'undefined'
      && Array.isArray(window.__documentDeepLinkE2EDocuments)
    ) {
      const seededDocuments = window.__documentDeepLinkE2EDocuments;
      window.__documentDeepLinkE2EDocuments = null;
      return seededDocuments;
    }
    return [];
  });
  const deepLinkDocumentIdRef = useRef(
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('docId'),
  );
  const dashboardRef = useRef(null);

  // UX 2026-05-13: App-level top toolbar state. The chrome strip lives at the
  // app shell so it stays mounted across PDF tab switches
  // and renders instantly on cold open. The active PDFViewer publishes its
  // undo/redo state and click handlers into this object via the
  // onTopToolbarApiChange callback. When the user is on the home tab the chrome
  // host is hidden, so a stale api object here is harmless.
  const [topToolbarApi, setTopToolbarApi] = useState({
    canUndo: false,
    canRedo: false,
    onUndo: null,
    onRedo: null
  });

  // UX 2026-05-14: right-rail page number editing state. By default the
  // current page renders as a plain accent-colored number (Walkthrough
  // style); double-clicking swaps it for an editable input so the user
  // can jump to a page directly. On blur or Enter we flip back.
  const [isEditingRailPage, setIsEditingRailPage] = useState(false);

  // UX 2026-05-14: right-rail zoom percentage editing state. Same pattern
  // as the page number — plain "100%" by default, click to swap to an
  // input. Typing is clamped to 1-4000 (the PDF engine's zoom range).
  const [isEditingRailZoom, setIsEditingRailZoom] = useState(false);

  // UX 2026-07-14 (rail-footer redesign): mirrors the survey panel's
  // collapsed/expanded state (SurveySpacesRail owns it and publishes via
  // onCollapseChange). The rail footer below switches between a vertical
  // stack (collapsed 48px rail) and a horizontal row overlaying the
  // expanded 320px panel — the Walkthru reference behavior. Starts true
  // to match SurveySpacesRail's useState(true) default.
  const [rightRailCollapsed, setRightRailCollapsed] = useState(true);

  // UX 2026-07-08 (mobile design pass): on narrow viewports (Capacitor phones,
  // narrow browser windows) the top toolbar's absolutely-pinned clusters
  // (undo/redo left, pan/select and tool-properties flanking the centered
  // icons, zoom/page/fit/export right) collide and overlap. Below 720px the
  // clusters flow inline instead and the zoom pill wraps onto its own row —
  // same controls, stacked mobile layout per docs/design/design.md
  // ("Adapting Other Surfaces").
  const [isNarrowShell, setIsNarrowShell] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 720px)').matches
      : false
  ));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(max-width: 720px)');
    const onChange = () => setIsNarrowShell(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  // UX 2026-05-13: App-level bottom toolbar state. The chrome-bottom host
  // mounts with final rail dimensions as soon as a PDF tab is active; the active
  // PDFViewer will publish the live toolbar API into this object in the next
  // wiring step.
  const [bottomToolbarApi, setBottomToolbarApi] = useState(null);

  // KAL-239: the Select tool's selection-mode menu. The current selection tool
  // and its menu indicator share one button, matching Drawboard's compact
  // Select / Lasso Select / Text Select switcher. The
  // menu is a fixed-position portal anchored under the button (matching the
  // Draw sub-toolbar popups) and closes on any outside click or Escape.
  const [selectModeMenuOpen, setSelectModeMenuOpen] = useState(false);
  const [selectModeMenuAnchor, setSelectModeMenuAnchor] = useState({ top: 0, left: 0 });
  const selectModeButtonRef = useRef(null);
  const selectModeMenuRef = useRef(null);
  const selectModeTriggerToolRef = useRef(null);
  // UX: tool shortcuts close the old menu so it cannot cover the new toolbar.
  useEffect(() => {
    if (selectModeTriggerToolRef.current === bottomToolbarApi?.activeTool) {
      selectModeTriggerToolRef.current = null;
      return;
    }
    selectModeTriggerToolRef.current = null;
    setSelectModeMenuOpen(false);
  }, [bottomToolbarApi?.activeTool, bottomToolbarApi?.selectionMode]);
  useEffect(() => {
    if (!selectModeMenuOpen) return undefined;
    const el = selectModeButtonRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setSelectModeMenuAnchor({ top: r.bottom + 6, left: r.left + r.width / 2 });
    }
    const focusFrame = window.requestAnimationFrame(() => {
      const menu = selectModeMenuRef.current;
      const selected = menu?.querySelector?.('[role="menuitemradio"][aria-checked="true"]');
      (selected || menu?.querySelector?.('[role="menuitemradio"]'))?.focus?.();
    });
    const onDown = (e) => {
      if (e.target.closest && (e.target.closest('[data-select-mode-menu]') || e.target.closest('[data-select-mode-trigger]'))) return;
      setSelectModeMenuOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      setSelectModeMenuOpen(false);
      window.requestAnimationFrame(() => selectModeButtonRef.current?.focus?.());
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selectModeMenuOpen]);

  // UX 2026-07-14: every top-bar control gets the app's instant tooltip
  // (the floating chip PDFViewer renders from setTooltip), not just the
  // category buttons. Native title= tooltips take ~1.5s and look
  // OS-styled, so users read the mixed behavior as "most tools have no
  // tooltip". Spread chromeTip('Label') onto a control to opt it in;
  // reference behavior matched: the Draw/Shapes/Text category buttons.
  //
  // UX 2026-08-19 (KAL-65): a control gets chromeTip OR a native title=, never
  // both. Carrying both made the zoom and page-navigation buttons show the
  // instant chip and then fade the OS tooltip in on top of it ~1.5s later —
  // two tooltips, same words, two different styles. Controls with no visible
  // text carry an aria-label so dropping title= costs no accessible name.
  // Built from the ONE shared implementation in components/Tooltip.jsx
  // (placement geometry, styling and focus handling all live there), and
  // published to the whole viewer tree via TooltipContext below so rails and
  // sidebar panels can opt in without prop-drilling a setter.
  const chromeTip = useMemo(
    () => makeTooltipBinding(bottomToolbarApi?.setTooltip),
    [bottomToolbarApi?.setTooltip],
  );

  // UX 2026-07-14 (rail-footer redesign): page-fit mode glyphs shared by the
  // rail footer's fit trigger and its popup options. Hoisted to component
  // scope so the collapsed (vertical) and expanded (horizontal) footer
  // variants render identical icons from one source — previously duplicated
  // in the top-right pill and the retired vertical strip. `m` is a
  // ZOOM_MODES id; anything that isn't fit-width/fit-height (incl. MANUAL)
  // falls back to the fit-page glyph.
  // UX 2026-09-17 (desktop sweep): the glyph keeps its own square, whatever the
  // label beside it does. The footer's Fit control is a flex row of glyph +
  // variable-length label, and an <svg> is a flex item with flex-shrink 1 and
  // min-width auto, so a long label squeezed the icon horizontally and nothing
  // else: measured at 1280x800 with the label "Manual 88%", the 14x14 glyph
  // rendered 12.34 x 14.00 — 12% narrower than it is tall, the only glyph in the
  // app that changed aspect ratio with content. Same guard the rail tab already
  // carries (PDFSidebar.jsx). Applied here, at the one place all three Fit call
  // sites share, so the menu rows and the right-edge strip cannot pick it up
  // later either.
  const renderFitIcon = (m, size = 15) => {
    const squared = { width: `${size}px`, height: `${size}px`, minWidth: `${size}px`, flexShrink: 0 };
    if (m === ZOOM_MODES.FIT_WIDTH) {
      return <Icon name="fitWidth" size={size} style={squared} />;
    }
    if (m === ZOOM_MODES.FIT_HEIGHT) {
      return <Icon name="fitHeight" size={size} style={squared} />;
    }
    return <Icon name="fitPage" size={size} style={squared} />;
  };

  // 2026-05-25: Arrowhead picker — opens below the trigger and shows every
  // option at once (no native select scroll). Closed on outside click.
  const [openAnnotationDropdown, setOpenAnnotationDropdown] = useState(null);
  const setDropdownOpen = useCallback((key, next) => {
    setOpenAnnotationDropdown((current) => {
      const isOpen = current === key;
      const shouldOpen = typeof next === 'function' ? next(isOpen) : next;
      if (shouldOpen) return key;
      return isOpen ? null : current;
    });
  }, []);
  const showArrowheadMenu = openAnnotationDropdown === 'arrowhead';
  const setShowArrowheadMenu = useCallback((next) => setDropdownOpen('arrowhead', next), [setDropdownOpen]);
  const showFontFamilyMenu = openAnnotationDropdown === 'font-family';
  const setShowFontFamilyMenu = useCallback((next) => setDropdownOpen('font-family', next), [setDropdownOpen]);
  const showFontSizeMenu = openAnnotationDropdown === 'font-size';
  const setShowFontSizeMenu = useCallback((next) => setDropdownOpen('font-size', next), [setDropdownOpen]);
  const showStyleMenu = openAnnotationDropdown === 'style';
  const setShowStyleMenu = useCallback((next) => setDropdownOpen('style', next), [setDropdownOpen]);
  const showCounterSeriesMenu = openAnnotationDropdown === 'counter-series';
  const setShowCounterSeriesMenu = useCallback((next) => setDropdownOpen('counter-series', next), [setDropdownOpen]);
  // PASS 7: Arrow ends (End / Both / None) is a dropdown of its own now, and the
  // eraser's two kinds moved out of a dropdown into a segmented toggle — so
  // 'eraser-type' is gone from this list and 'arrow-ends' takes its place.
  const showArrowEndsMenu = openAnnotationDropdown === 'arrow-ends';
  const setShowArrowEndsMenu = useCallback((next) => setDropdownOpen('arrow-ends', next), [setDropdownOpen]);
  // 2026-05-25: Color picker active tab for shapes (rectangle / ellipse).
  // 'fill' swaps the picker to read/write fillColor; 'border' swaps to strokeColor.
  // UX 2026-09-17: it opens on 'border', not 'fill', because that is the channel
  // the four quick dots beside it act on (see resolveAnnotationPaint). It used
  // to open on Fill while the dots set the border, so two neighbouring controls
  // showed two different colours of the same shape — and on a fresh rectangle
  // the tab showed white at 0% opacity, i.e. nothing at all.
  const [colorPickerTab, setColorPickerTab] = useState('border');
  const annotationColorPickerRef = useRef(null);
  // The one resolved paint the colour controls in the tool-properties row all
  // read and write: the quick colour dots, the swatch's ring, and the picker
  // itself. See resolveAnnotationPaint above.
  const annotationPaint = resolveAnnotationPaint(bottomToolbarApi, colorPickerTab);
  // UX 2026-09-17: exactly ONE thing in the colour cluster wears the gold ring
  // at a time, and it is always where the current colour came from — the dot
  // when the colour is one of the four, the swatch when it is anything else
  // (a hex the user typed, a colour off the picker's grid, a colour carried in
  // from a selected mark). A ring that were always on the swatch as well would
  // stop meaning "current" and start reading as decoration.
  const quickColourOnSwatch = !!annotationPaint && !matchedQuickColour(annotationPaint.quick.color);
  // UX 2026-09-17: and it goes back to that channel's tab whenever the armed
  // tool changes which channel the dots act on — Counter takes the fill (a
  // pin's colour IS its fill), every other tool takes the border. Only that
  // switch resets it: a user who reaches for the Fill tab on a rectangle keeps
  // Fill while they stay on shapes.
  const quickPaintTab = annotationPaint?.quick?.tab;
  useEffect(() => {
    if (quickPaintTab) setColorPickerTab(quickPaintTab);
  }, [quickPaintTab]);

  const [showFontColorPicker, setShowFontColorPicker] = useState(false);
  useEffect(() => {
    if (!openAnnotationDropdown) return;
    setShowFontColorPicker(false);
    bottomToolbarApi?.setShowAnnotationColorPicker?.(false);
  }, [bottomToolbarApi?.setShowAnnotationColorPicker, openAnnotationDropdown]);

  useEffect(() => {
    if (!showFontColorPicker) return;
    setOpenAnnotationDropdown(null);
    bottomToolbarApi?.setShowAnnotationColorPicker?.(false);
  }, [bottomToolbarApi?.setShowAnnotationColorPicker, showFontColorPicker]);

  useEffect(() => {
    if (!showFontColorPicker) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('[data-font-color-picker]')) return;
      setShowFontColorPicker(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showFontColorPicker]);

  useEffect(() => {
    if (!bottomToolbarApi?.richTextEditor) {
      setShowFontColorPicker(false);
      setShowFontFamilyMenu(false);
      setShowFontSizeMenu(false);
    }
  }, [bottomToolbarApi?.richTextEditor]);

  const [counterSeriesContextMenu, setCounterSeriesContextMenu] = useState(null);
  const counterSeriesMenuTriggerRef = useRef(null);
  const counterSeriesContextTriggerRef = useRef(null);
  const counterSeriesContextMenuRef = useRef(null);
  useEffect(() => {
    if (bottomToolbarApi?.contextTool !== 'counter') {
      setShowCounterSeriesMenu(false);
      setCounterSeriesContextMenu(null);
    }
  }, [bottomToolbarApi?.contextTool]);

  useEffect(() => {
    if (showCounterSeriesMenu) return;
    setCounterSeriesContextMenu(null);
  }, [showCounterSeriesMenu]);

  useEffect(() => {
    if (!counterSeriesContextMenu) return;
    const liveSeries = (bottomToolbarApi?.counterSeriesList || []).find(
      (series) => series.seriesId === counterSeriesContextMenu.seriesId,
    );
    if (
      !liveSeries
      || liveSeries.count !== counterSeriesContextMenu.count
      || liveSeries.label !== counterSeriesContextMenu.label
    ) {
      setCounterSeriesContextMenu(null);
    }
  }, [bottomToolbarApi?.counterSeriesList, counterSeriesContextMenu]);

  useEffect(() => {
    if (!bottomToolbarApi?.showAnnotationColorPicker) return;
    setOpenAnnotationDropdown(null);
    setShowFontColorPicker(false);
    setCounterSeriesContextMenu(null);
  }, [bottomToolbarApi?.showAnnotationColorPicker]);

  useEffect(() => {
    if (!showCounterSeriesMenu || counterSeriesContextMenu) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShowCounterSeriesMenu(false);
      counterSeriesMenuTriggerRef.current?.focus?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [counterSeriesContextMenu, showCounterSeriesMenu]);

  useEffect(() => {
    if (!counterSeriesContextMenu) return undefined;
    const focusFirstItem = window.requestAnimationFrame(() => {
      counterSeriesContextMenuRef.current?.querySelector?.('[role="menuitem"]')?.focus?.();
    });
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setCounterSeriesContextMenu(null);
        counterSeriesContextTriggerRef.current?.focus?.();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...(counterSeriesContextMenuRef.current?.querySelectorAll?.('[role="menuitem"]') || [])];
      if (items.length === 0) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1 + items.length) % items.length
            : (currentIndex - 1 + items.length) % items.length;
      items[nextIndex].focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirstItem);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [counterSeriesContextMenu]);

  // Formatting popovers share one exclusive layer. Capture-phase dismissal
  // runs before trigger buttons stop propagation, so opening one control
  // reliably closes every peer and clicking the page closes them all.
  useEffect(() => {
    const onDown = (event) => {
      const target = event.target;
      const inside = (selector) => !!target?.closest?.(selector);
      const insideDropdown = inside('[data-annotation-size-control], [data-annotation-size-popover], .annotation-dropdown, [data-annotation-dropdown-popover], [data-counter-series-context-menu]');
      if (!insideDropdown) {
        setOpenAnnotationDropdown(null);
      }
      if (!inside('[data-annotation-color-trigger], [data-annotation-color-picker], .mobile-pdf-colorpicker-surface')) {
        bottomToolbarApi?.setShowAnnotationColorPicker?.(false);
      }
      if (!insideDropdown && !inside('[data-counter-series-menu], [data-counter-series-context-menu]')) {
        setShowCounterSeriesMenu(false);
        setCounterSeriesContextMenu(null);
      }
      if (!insideDropdown && !inside('[data-style-menu]')) setShowStyleMenu(false);
      if (!insideDropdown && !inside('[data-arrowhead-menu]')) setShowArrowheadMenu(false);
      if (!insideDropdown && !inside('[data-arrow-ends-menu]')) setShowArrowEndsMenu(false);
      if (!inside('[data-font-color-picker]')) setShowFontColorPicker(false);
      if (!insideDropdown && !inside('[data-font-family-menu]')) setShowFontFamilyMenu(false);
      if (!insideDropdown && !inside('[data-font-size-menu]')) setShowFontSizeMenu(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [bottomToolbarApi?.setShowAnnotationColorPicker]);

  // Keyboard/tool-driven selection changes do not necessarily produce a page
  // click. Treat any context change as leaving the previous popover layer.
  useEffect(() => {
    bottomToolbarApi?.setShowAnnotationColorPicker?.(false);
    setOpenAnnotationDropdown(null);
    setShowCounterSeriesMenu(false);
    setCounterSeriesContextMenu(null);
    setShowStyleMenu(false);
    setShowArrowheadMenu(false);
    setShowArrowEndsMenu(false);
  }, [bottomToolbarApi?.contextTool]);

  /*
   * LeftRail/PDFSidebar API audit (UX 2026-05-13 chrome lift)
   *
   * Ref:
   * - pdfSidebarRef
   *
   * Props currently passed to PDFSidebar:
   * - features, pdfDoc, numPages, pageNum
   * - onNavigateToPage, onNavigateToMatch
   * - searchResults, currentMatchIndex, onSearchResultsChange, onCurrentMatchIndexChange
   * - onDuplicatePage, onDeletePage, onCutPage, onCopyPage, onPastePage
   * - clipboardPage, clipboardType
   * - onRotatePage, onMirrorPage, onResetPage, onReorderPages, pageTransformations, getThumbnail
   * - bookmarks, onBookmarkCreate, onBookmarkUpdate, onBookmarkDelete
   * - spaces, onSpaceCreate, onSpaceUpdate, onSpaceDelete
   * - activeSpaceId, onSetActiveSpace, onExitSpaceMode
   * - onRequestRegionEdit, onCancelRegionEdit
   * - onSpaceAssignPages, onSpaceRenamePage, onSpaceRemovePage, onReorderSpaces
   * - onExportSpaceCSV, onExportSpacePDF
   * - isRegionSelectionActive, shouldShowPage, activeSpacePages
   * - scale, tabId, onPageDrop
   * - getCanvasAnnotationVisibilityState, onToggleCanvasAnnotations
   * - getSurveyAnnotationVisibilityState, onToggleSurveyAnnotations
   * - selectedSpaceId, onToggleRegionOverlay, getRegionOverlayEnabled, isRegionOverlayToggleEnabled
   * - showSurveyPanel, selectedModuleId
   * - cloudSyncStatus, cloudSyncQueueSize, cloudSyncEnabled, cloudSyncOnRetry
   * - presence, currentUserId, currentUserEmail, currentUserDisplayName
   * - onToggleCollapse
   *
   * Loading-state sidebar currently passes inert defaults for the subset needed
   * to keep the rail, sync chip, and presence row visible before the PDF loads.
   */
  const [leftRailApi, setLeftRailApi] = useState(null);
  const [rightRailApi, setRightRailApi] = useState(null);
  const [mobileSurveyRequestKey, setMobileSurveyRequestKey] = useState(0);
  const [mobileSurveyCollapseRequestKey, setMobileSurveyCollapseRequestKey] = useState(0);
  const [mobileSurveyPanelOpen, setMobileSurveyPanelOpen] = useState(false);
  const [mobileDocumentPanelState, setMobileDocumentPanelState] = useState({ isOpen: false, activePanel: 'pages' });
  const [mobileAuxPanel, setMobileAuxPanel] = useState(null);

  // Tab management state
  const HOME_TAB_ID = 'home-tab';
  const [tabs, setTabs] = useState([{ id: HOME_TAB_ID, name: 'Home', file: null, isHome: true }]); // Array of { id, name, file, isHome? }
  const [activeTabId, setActiveTabId] = useState(HOME_TAB_ID);
  const [documentLockedByTab, setDocumentLockedByTab] = useState({});
  // Track PDFs that are currently being opened to prevent duplicate opens
  const openingPdfsRef = useRef(new Set());

  // Template management state
  const [appTemplates, setAppTemplates] = useState(() => (
    import.meta.env.DEV
    && typeof window !== 'undefined'
    && Array.isArray(window.__surveyTransitionE2ETemplates)
      ? window.__surveyTransitionE2ETemplates
      : []
  ));

  const handleTemplatesChange = useCallback((nextTemplates) => {
    const normalized = Array.isArray(nextTemplates) ? nextTemplates : [];
    setAppTemplates(normalized);
  }, []);

  const [entities, setEntities] = useState(() => [
    { id: `entity-${Date.now()}-1`, name: 'GC', color: '#E3D1FB' },
    { id: `entity-${Date.now()}-2`, name: 'Subcontractor', color: '#FFF5C3' },
    { id: `entity-${Date.now()}-3`, name: 'My Company', color: '#CBDCFF' },
    { id: `entity-${Date.now()}-4`, name: '100% Complete', color: '#B2FFB2' },
    { id: `entity-${Date.now()}-5`, name: 'Removed', color: 'var(--text-3)' }
  ].map(entity => ({
    ...entity,
    color: hexToRgba(entity.color, 0.2)
  })));

  // Authentication state
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { showAuthModal, setShowAuthModal, handleDismiss, authPromptDismissed } = useOptionalAuth();

  // Template refetch for PDFViewer
  const { refetch: refetchTemplates } = useTemplates();

  // Clean up any old localStorage data that might be causing issues
  useEffect(() => {
    // Remove old document data to prevent quota issues
    localStorage.removeItem('pdfDocuments');
  }, []);

  // Clear preferences and settings for non-authenticated users on app load
  // Non-authenticated users should not have their preferences persisted
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      // Clear user preferences and settings
      localStorage.removeItem('dashboardViewMode');
      localStorage.removeItem('projects');
      localStorage.removeItem('templates');
      localStorage.removeItem('pdfViewerZoomPreference');
      // Note: We keep PDF-specific data (pdfData_*, surveyMarkers_*, pdfSidebar_*)
      // as they're needed for the current session, but they won't persist across sessions
      // for non-authenticated users since they're tied to specific PDF files
    }
  }, [authLoading, isAuthenticated]);

  // Generate unique tab ID
  const generateTabId = () => `tab-${randomUUID()}`;

  const handleDocumentSelect = (file, filePath = null) => {
    if (!file) {
      console.error('No file provided to handleDocumentSelect');
      return;
    }

    const pdfKey = getDocumentOpenKey(file, filePath);

    // Check if this PDF is already being opened (prevents duplicate opens when app is slow)
    if (openingPdfsRef.current.has(pdfKey)) {
      return;
    }

    // Check if this file is already open in a tab (excluding home tab)
    const existingTab = tabs.find(tab => isSameDocumentTab(tab, file, filePath));

    if (existingTab) {
      // Clear the opening flag in case it was set (shouldn't happen, but just in case)
      openingPdfsRef.current.delete(pdfKey);
      // KAL-46: when the user re-selects a document via the upload flow, a
      // previous failed parse can leave the tab's file in a stuck transient
      // state (mutated to a rewritten Blob carrying __rewrittenForParse: true,
      // or simply the original failed reference). Re-mounting the viewer
      // with that stale reference will NOT re-fire the PDF load effect and
      // the viewer hangs on the loading spinner. To make same-document
      // reopen deterministic in those cases, replace the tab's file with the
      // freshly-selected reference. For healthy already-loaded tabs we keep
      // the existing reference to preserve scroll position / in-flight work.
      const previousFile = existingTab.file;
      const previousLoadFailed = previousFile?.__rewrittenForParse === true
        || previousFile?.__pdfLoadFailed === true;
      if (previousLoadFailed) {
        setTabs(prev => prev.map(tab =>
          tab.id === existingTab.id ? { ...tab, file: file, filePath: filePath ?? tab.filePath } : tab
        ));
        setSelectedPDF(file);
      } else if (selectedPDF !== previousFile) {
        setSelectedPDF(previousFile);
      }
      setActiveTabId(existingTab.id);
      setCurrentView('viewer');
      return;
    }

    // Mark this PDF as being opened
    openingPdfsRef.current.add(pdfKey);

    // Create new tab
    const newTab = {
      id: generateTabId(),
      name: file.name,
      file: file,
      filePath: filePath, // Store file path in tab
      isHome: false,
      viewState: null // Initialize view state
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setSelectedPDF(file);
    setCurrentView('viewer');
    setIsLoading(true);

    // Clear the opening flag after a short delay to allow the tab to be created
    // This ensures that if the same PDF is clicked again, it will find the existing tab
    setTimeout(() => {
      openingPdfsRef.current.delete(pdfKey);
      setIsLoading(false);
    }, 100);
  };

  // DEV-ONLY: Auto-open test PDF when loaded via dev test route
  useEffect(() => {
    if (import.meta.env.DEV && window.__devTestPdf) {
      const file = window.__devTestPdf;
      window.__devTestPdf = null; // consume so it only fires once
      handleDocumentSelect(file);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Existing-user share emails and accepted invites land on ?docId=<id>.
  // Wait for the authenticated document list, then use the exact same open
  // path as clicking that document in the dashboard.
  useEffect(() => {
    const deepLinkDocumentId = deepLinkDocumentIdRef.current;
    if (!deepLinkDocumentId) return;
    const documentToOpen = documents.find(
      (document) => String(document?.id) === String(deepLinkDocumentId),
    );
    if (!documentToOpen) return;

    deepLinkDocumentIdRef.current = null;
    const fileToOpen = (
      import.meta.env.DEV
      && documentToOpen.__localFile instanceof File
    )
      ? documentToOpen.__localFile
      : documentToOpen;
    handleDocumentSelect(
      fileToOpen,
      documentToOpen.filePath || documentToOpen.file_path || null,
    );

    const url = new URL(window.location.href);
    url.searchParams.delete('docId');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [documents]); // eslint-disable-line react-hooks/exhaustive-deps

  const returnToDevHubPreview = () => {
    if (!import.meta.env.DEV || !devPreviewReturnTab) return false;
    const source = new URLSearchParams(window.location.search);
    const workflowE2E = source.get('workflowE2E') === '1';
    const params = new URLSearchParams({
      hubPreview: '1',
      tab: devPreviewReturnTab,
      mobileNav: workflowE2E ? 'tabs' : 'rail',
    });
    if (workflowE2E) {
      params.set('workflowE2E', '1');
      params.set('nativeShell', 'expo');
    } else {
      params.set('longDocs', '1');
    }
    window.location.assign(`/?${params.toString()}`);
    return true;
  };

  const handleTabClick = (tabId) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      // Exit selection mode when switching tabs
      if (dashboardRef.current?.exitSelectionMode) {
        dashboardRef.current.exitSelectionMode();
      }

      setActiveTabId(tabId);
      if (tab.isHome) {
        if (returnToDevHubPreview()) return;
        // Home tab - show dashboard
        // setSelectedPDF(null); // Keep selectedPDF to prevent unmounting
        setCurrentView('dashboard');
      } else {
        // PDF tab - show viewer
        setSelectedPDF(tab.file);
        setCurrentView('viewer');
      }
    }
  };

  const handleViewStateChange = useCallback((viewState, targetTabId) => {
    setTabs(prev => {
      let changed = false;
      const floatEqual = (left, right) => Math.abs(Number(left) - Number(right)) < 0.0001;
      const nextTabs = prev.map(tab => {
        // Use targetTabId if provided, otherwise fallback to activeTabId (or checking against tab.id)
        // If targetTabId is provided, we only update that specific tab.
        const isTarget = targetTabId ? tab.id === targetTabId : tab.id === activeTabId;

        if (!isTarget) {
          return tab;
        }

        const previousViewState = tab.viewState;
        if (!previousViewState) {
          changed = true;
          return { ...tab, viewState };
        }

        const unchanged =
          Number(previousViewState.pageNum) === Number(viewState.pageNum) &&
          floatEqual(previousViewState.scale, viewState.scale) &&
          String(previousViewState.zoomMode) === String(viewState.zoomMode) &&
          String(coerceScrollMode(previousViewState.scrollMode)) === String(coerceScrollMode(viewState.scrollMode)) &&
          Number(previousViewState.scrollLeft) === Number(viewState.scrollLeft) &&
          Number(previousViewState.scrollTop) === Number(viewState.scrollTop);

        if (unchanged) {
          return tab;
        }

        changed = true;
        return { ...tab, viewState };
      });

      return changed ? nextTabs : prev;
    });
  }, [activeTabId]);

  // Memoized callback to track unsaved annotations - uses targetTabId to find the correct tab
  const handleUnsavedAnnotationsChange = useCallback((hasUnsaved, targetTabId) => {
    setTabs(prev => {
      // If targetTabId is provided, use it directly.
      // Fallback to finding by selectedPDF if for some reason targetTabId is missing (legacy behavior support)
      if (targetTabId) {
        return prev.map(tab =>
          tab.id === targetTabId ? { ...tab, hasUnsavedAnnotations: hasUnsaved } : tab
        );
      }

      const pdfTab = prev.find(t => t.file === selectedPDF && !t.isHome);
      if (!pdfTab) return prev;
      return prev.map(tab =>
        tab.id === pdfTab.id ? { ...tab, hasUnsavedAnnotations: hasUnsaved } : tab
      );
    });
  }, [selectedPDF]);

  // Track whether each tab has any annotations for tab UI and diagnostics.
  const handleAnnotationsExistChange = useCallback((hasAny, targetTabId) => {
    if (!targetTabId) return;
    setTabs(prev =>
      prev.map(tab =>
        tab.id === targetTabId ? { ...tab, hasAnyAnnotations: hasAny } : tab,
      ),
    );
  }, []);

  // Warn only for unsaved local edits. A successful Cmd/Ctrl+S clears the
  // tab's dirty bit, so a clean reload must not show a false data-loss prompt.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (event) => {
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (!shouldWarnBeforeUnloadForTab(activeTab)) return undefined;
      // Modern browsers ignore the returned string and show their own
      // generic message; the truthy returnValue is what triggers the
      // confirm dialog.
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [tabs, activeTabId]);

  // Memoized callback to update PDF file
  const handleUpdatePDFFile = useCallback(async (newFile, targetTabId) => {
    const durablePath = newFile?.supabaseFilePath || newFile?.filePath || null;
    if (newFile?.id && durablePath) {
      await replaceDocument(newFile, durablePath);
    }
    setTabs(prev => {
      if (targetTabId) {
        return prev.map(tab =>
          tab.id === targetTabId ? { ...tab, file: newFile } : tab
        );
      }

      const pdfTab = prev.find(t => t.file === selectedPDF && !t.isHome);
      if (!pdfTab) return prev;
      return prev.map(tab =>
        tab.id === pdfTab.id ? { ...tab, file: newFile } : tab
      );
    });
    // Only update selectedPDF if the updated tab is the active one
    if (!targetTabId || targetTabId === activeTabId) {
      setSelectedPDF(newFile);
    }
    setDocuments((prev) => prev.map((document) => (
      document?.id === newFile?.id
        ? {
          ...document,
          size: newFile.size,
          file_size: newFile.size,
          updated_at: new Date().toISOString(),
        }
        : document
    )));
    return newFile;
  }, [selectedPDF, activeTabId, replaceDocument]);

  const handleTabClose = (tabId) => {
    // Prevent closing the home tab
    if (tabId === HOME_TAB_ID) return;

    const tabIndex = tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);

    // If closing the active tab, switch to another tab or go back to home
    if (tabId === activeTabId) {
      if (newTabs.length > 1) { // More than just home tab
        // Switch to the tab that was at the same position, or the last tab (excluding home)
        const pdfTabs = newTabs.filter(t => !t.isHome);
        if (pdfTabs.length > 0) {
          const newActiveIndex = Math.min(tabIndex - 1, pdfTabs.length - 1);
          const newActiveTab = pdfTabs[newActiveIndex >= 0 ? newActiveIndex : 0];
          setActiveTabId(newActiveTab.id);
          setSelectedPDF(newActiveTab.file);
          setCurrentView('viewer');
        } else {
          // Only home tab left
          setActiveTabId(HOME_TAB_ID);
          setSelectedPDF(null);
          setCurrentView('dashboard');
        }
      } else {
        // Only home tab left
        setActiveTabId(HOME_TAB_ID);
        setSelectedPDF(null);
        setCurrentView('dashboard');
      }
    }
  };

  const handleTabReorder = (reorderedTabs) => {
    // Ensure home tab is always first
    const homeTab = reorderedTabs.find(t => t.isHome);
    const otherTabs = reorderedTabs.filter(t => !t.isHome);
    if (homeTab) {
      setTabs([homeTab, ...otherTabs]);
    } else {
      setTabs(reorderedTabs);
    }
  };

  const handlePageDrop = (sourceTabId, pageNumber, targetTabId) => {
    // This is a placeholder - actual PDF page copying would require PDF manipulation
    // For now, we'll just show a message or implement basic structure

    // TODO: Implement actual page copying using PDF.js or a PDF manipulation library
    // This would involve:
    // 1. Getting the page from source PDF
    // 2. Creating a new PDF or modifying target PDF
    // 3. Adding the page to target PDF
    // 4. Updating the target tab's file

    showToast(`Page ${pageNumber} drag-and-drop functionality is being implemented. This feature requires PDF manipulation capabilities.`, 'info');
  };

  const handleBack = () => {
    if (returnToDevHubPreview()) return;
    // Switch to home tab instead of closing all tabs
    setActiveTabId(HOME_TAB_ID);
    // setSelectedPDF(null); // Keep selectedPDF to prevent unmounting
    setCurrentView('dashboard');
  };

  const handleCreateTemplateRequest = (options) => {
    if (options?.mode === 'edit' && options.templateId) {
      dashboardRef.current?.openEditTemplateModal?.(options.templateId, {
        moduleId: options.moduleId,
        startAddingCategory: options.startAddingCategory
      });
    } else {
      dashboardRef.current?.openTemplateModal?.();
    }
  };

  // Determine what to render based on active tab. Keep this before any
  // conditional return because hooks below depend on it.
  const activeTab = tabs.find(t => t.id === activeTabId);
  const isViewerVisible = activeTab && !activeTab.isHome && selectedPDF && currentView === 'viewer';
  const isMobileViewer = Boolean(isNarrowShell && isViewerVisible);
  const mobileViewerPanelOpen = Boolean(
    mobileDocumentPanelState.isOpen
    || mobileSurveyPanelOpen
    || mobileAuxPanel
  );

  const openMobileDocumentPanel = useCallback((panelId) => {
    setMobileSurveyCollapseRequestKey((key) => key + 1);
    leftRailApi?.ref?.current?.togglePanel?.(panelId);
  }, [leftRailApi]);

  const toggleMobileDocumentHub = useCallback(() => {
    const activePanel = ['pages', 'search', 'bookmarks'].includes(mobileDocumentPanelState.activePanel)
      ? mobileDocumentPanelState.activePanel
      : 'pages';
    openMobileDocumentPanel(activePanel);
  }, [mobileDocumentPanelState.activePanel, openMobileDocumentPanel]);

  const openMobileSurveyPanel = useCallback(() => {
    leftRailApi?.ref?.current?.closePanel?.();
    if (mobileSurveyPanelOpen) {
      setMobileSurveyCollapseRequestKey((key) => key + 1);
      return;
    }
    setMobileSurveyRequestKey((key) => key + 1);
    if (!rightRailApi?.showSurveyPanel) {
      rightRailApi?.handleSurveyToggle?.();
    }
  }, [leftRailApi, mobileSurveyPanelOpen, rightRailApi]);

  useEffect(() => {
    if (isViewerVisible) return;
    setMobileSurveyPanelOpen(false);
    setMobileDocumentPanelState({ isOpen: false, activePanel: 'pages' });
    setMobileAuxPanel(null);
  }, [isViewerVisible]);

  useEffect(() => {
    if (!mobileAuxPanel) return;
    leftRailApi?.ref?.current?.closePanel?.();
    setMobileSurveyCollapseRequestKey((key) => key + 1);
  }, [mobileAuxPanel]);

  // UX 2026-07-08 (mobile design pass): the hub stays mounted underneath the
  // viewer overlay. On narrow screens the hub's mobile layout fixes its header
  // and tab bar to the viewport and switches the page to document scrolling,
  // which bleeds through and breaks the viewer's frame. Stamp a class on
  // <html> so hub.css can neutralize those overrides while a document is open.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.documentElement.classList.toggle('survey-viewer-open', !!isViewerVisible);
    return () => document.documentElement.classList.remove('survey-viewer-open');
  }, [isViewerVisible]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    let rafId = 0;
    const updateChromeTop = () => {
      rafId = 0;
      const topHost = document.getElementById('chrome-top-host');
      if (!topHost || topHost.style.display === 'none') return;

      const topRect = topHost.getBoundingClientRect();
      let chromeBottom = topRect.bottom;
      const subHost = document.getElementById('chrome-sub-toolbar-host');
      if (subHost && subHost.style.display !== 'none') {
        const subRect = subHost.getBoundingClientRect();
        if (subRect.height > 0) {
          chromeBottom = Math.max(chromeBottom, subRect.bottom);
        }
      }

      document.documentElement.style.setProperty('--app-chrome-top', `${Math.round(chromeBottom)}px`);
    };

    const scheduleUpdate = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(updateChromeTop);
    };

    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);

    const subHost = document.getElementById('chrome-sub-toolbar-host');
    const observer = new MutationObserver(scheduleUpdate);
    if (subHost) {
      observer.observe(subHost, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', scheduleUpdate);
      observer.disconnect();
    };
  }, [
    isViewerVisible,
    bottomToolbarApi?.activeCategoryDropdown,
    bottomToolbarApi?.activeTool,
    bottomToolbarApi?.richTextEditor,
  ]);

  if (isLoading) {
    // Full-screen document loading state — warm-dark surface + the ONE shared
    // spinner per docs/design/design.md (master plan decision 3).
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface-0)', // --ink-900 page background
        fontFamily: FONT_FAMILY
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
            <Spinner size={22} thickness={2} />
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-3)', letterSpacing: 0 }}>Loading document...</div>
        </div>
      </div>
    );
  }

  // Find the tab associated with the selected PDF to pass the correct tabId
  // This ensures that even if we are on Home tab, the PDFViewer still gets the correct tabId prop
  const pdfTab = tabs.find(t => t.file === selectedPDF && !t.isHome);
  const viewerTabId = pdfTab ? pdfTab.id : activeTabId;
  const viewerViewState = pdfTab ? pdfTab.viewState : null;

  return (
    // KAL-65: one tooltip surface for the whole viewer. Rails and sidebar
    // panels call useTooltip() to opt a control in; the chip itself is
    // rendered once by PDFViewer (<FloatingTooltip>) from the state this
    // binding writes to.
    <TooltipContext.Provider value={chromeTip}>
      {/* UX 2026-04-22: Save Log banner mounts at the outermost App level so
          it's visible on the dashboard / templates / auth / any view, not
          only inside the PDF viewer. Listens for a window event the Save
          Log handler dispatches. */}
      <SaveLogBanner />
      <ToastHost />
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {tabs.length > 0 && !isNarrowShell && ( // Desktop-only: mobile navigation lives inside the home/viewer chrome.
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onTabReorder={handleTabReorder}
            onPageDrop={handlePageDrop}
          />
        )}
        {/* UX 2026-05-14: App-level top toolbar consolidating Undo/Redo plus
            every annotation tool that used to live in the bottom toolbar.
	            Survey toggle moved to the right rail; every other interactive
	            control (Pan, Select, Draw, Shapes, Text, Color swatch, Width
	            input) now lives here.
            Wraps onto a second row on narrow viewports. Z-index 5500 so the
            color picker and category popups float above the PDF. Tool
            handlers come from bottomToolbarApi which PDFViewer continues to
            publish even though the bottom-host is now gone. */}
        {isMobileViewer ? (
          <MobilePdfViewerHeader
            id="chrome-top-host"
            documentName={selectedPDF?.name || activeTab?.name || 'Document'}
            onBack={handleBack}
            topToolbarApi={topToolbarApi}
            bottomToolbarApi={bottomToolbarApi}
          />
        ) : (
        <div
          id="chrome-top-host"
          style={{
            display: isViewerVisible ? 'flex' : 'none',
            flexShrink: 0,
            // PASS 7 (boards 8-14): the tool bar is 36px tall — 4px of air
            // around the 28px tool button — and the bar carries the same
            // hairline underneath it as the two bars below. Undo/Redo and
            // Export sit 10px in from the edges. minHeight rather than height
            // so a narrow window may still wrap onto a second row instead of
            // clipping. Do not grow this padding: 4 + 28 + 4 = 36.
            minHeight: 'var(--chrome-bar-h)',
            padding: '0 10px',
            background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border)',
            boxSizing: 'border-box',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            rowGap: '4px',
            columnGap: 'var(--chrome-tool-gap)',
            fontSize: '13px',
            fontFamily: FONT_FAMILY,
            color: 'var(--text-2)',
            position: 'relative',
            zIndex: 5500
          }}
        >
          {/* UX 2026-07-14 (rail-footer redesign): the zoom / page / fit
              controls that used to fill this top-right pill moved DOWN to a
              footer pinned at the bottom of the right rail (see
              chrome-right-host below) — the Walkthru reference layout. Only
              EXPORT stays pinned top-right, so it is always reachable while
              a PDF is open (the survey rail's EXPORT is Excel-only and
              gated on a linked template). Same anchor as the old cluster:
              absolute right:12px on desktop, static full-width row on
              narrow shells. */}
          {bottomToolbarApi && typeof bottomToolbarApi.exportAnnotatedPdf === 'function' && (
            <div style={{
              // Narrow shells: flow in the wrapping toolbar on a full-width
              // second row instead of pinning over the tool cluster.
              ...(isNarrowShell
                ? { position: 'static', flexBasis: '100%', justifyContent: 'center' }
                : { position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)' }),
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--chrome-tool-gap)',
              border: 'none',
              background: 'transparent',
              borderRadius: 0,
              padding: 0,
              zIndex: 1
            }}>
              {/* Export annotated PDF — browser-visible entry point for the
                  same handler the desktop File menu drives. */}
              <button
                onClick={bottomToolbarApi.exportAnnotatedPdf}
                {...chromeTip('Export annotated PDF', 'below')}
                aria-label="Export annotated PDF"
                // UX 2026-09-16: Export takes the shared top-bar control size
                // (.chrome-control) like every other button in this row —
                // it used to be a one-off 30x30 box with a 15px glyph.
                className="chrome-control"
                style={{ border: 'none', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}
              >
                <Icon name="download" size={CHROME_GLYPH} />
              </button>
            </div>
          )}

          {/* UX 2026-05-14: Undo + Redo pinned to the LEFT via absolute
              positioning so the rest of the toolbar can center cleanly
              with justifyContent: 'center'. This mirrors the old bottom
              toolbar where tools sat centered and adjacent helpers
              flanked them. Padding inside the strip leaves 12 px for the
              Undo/Redo cluster. */}
          <div
            // KAL-301 follow-up: marks the Undo/Redo cluster so
            // RegionSelectionTool's outside-mousedown handler doesn't cancel
            // the region-edit session when these buttons are clicked (they
            // drive the region history while region editing is active).
            data-undo-redo-controls="true"
            style={{
            // Narrow shells: flow inline with the tool cluster (no pinning).
            ...(isNarrowShell
              ? { position: 'static' }
              : { position: 'absolute', left: '10px', top: 0, bottom: 0 }),
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--chrome-tool-gap)'
          }}>
            <span {...chromeTip('Undo', 'below')} style={{ display: 'inline-flex' }}>
              <button
                onClick={topToolbarApi.onUndo || (() => {})}
                disabled={!topToolbarApi.canUndo}
                // UX 2026-09-16: Undo/Redo take the shared top-bar control
                // size and glyph like every other button in this row. They
                // were a one-off 32x26 with a 14px glyph — the smallest pair
                // in a row that also held 30px and 28px controls.
                className="btn btn-default chrome-control"
                aria-label="Undo"
                style={{
                  opacity: topToolbarApi.canUndo ? 1 : 0.4,
                  cursor: topToolbarApi.canUndo ? 'pointer' : 'not-allowed',
                  pointerEvents: topToolbarApi.canUndo ? 'auto' : 'none'
                }}
              >
                <Icon name="undo" size={CHROME_GLYPH} />
              </button>
            </span>
            <span {...chromeTip('Redo', 'below')} style={{ display: 'inline-flex' }}>
              <button
                onClick={topToolbarApi.onRedo || (() => {})}
                disabled={!topToolbarApi.canRedo}
                // UX 2026-09-16: see Undo — shared top-bar control size + glyph.
                className="btn btn-default chrome-control"
                aria-label="Redo"
                style={{
                  opacity: topToolbarApi.canRedo ? 1 : 0.4,
                  cursor: topToolbarApi.canRedo ? 'pointer' : 'not-allowed',
                  pointerEvents: topToolbarApi.canRedo ? 'auto' : 'none'
                  // UX 2026-09-16: the old -0.591158px ink-centre nudge is
                  // gone. It was measured against the 14px Redo glyph; at the
                  // shared 18px size the Undo and Redo glyphs share an ink
                  // centre exactly (both 1.125px below their button centre,
                  // measured in the live page), so the nudge was now the only
                  // thing putting Redo on a different baseline from Undo.
                }}
              >
                <Icon name="redo" size={CHROME_GLYPH} />
              </button>
            </span>
          </div>

          {/* UX 2026-05-14: Tools section — Pan / Select / Draw / Shapes /
              Text / Color / Width. Inlined from the old
              bottom toolbar. Consumes bottomToolbarApi which is still
              published from PDFViewer; if no PDF is open we skip the
              section entirely. Tooltip placement is "below" so labels
              fall under the buttons (above would clip the OS chrome).
              These flow inside the centered flex container so the whole
              tool cluster sits centered while Undo/Redo float on the
              left edge. */}
          {bottomToolbarApi && (
            <div data-tool-toolbar="true" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 'var(--chrome-tool-gap)' }}>
              {/* 2026-05-26: Pan + Select sit in their own absolute block to
                  the LEFT of the centered annotation cluster. This mirrors
                  the right-side tool properties block so the annotation
                  icons stay centered on the screen — only the side blocks
                  shift as their contents change. */}
              <div style={{
                // Narrow shells: flow inline before the annotation icons.
                ...(isNarrowShell
                  ? { position: 'static' }
                  : { position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)' }),
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--chrome-tool-gap)',
                whiteSpace: 'nowrap'
              }}>
              {[
                { id: 'pan', label: 'Pan', iconName: 'pan' },
                { id: 'select', label: 'Select', iconName: 'selectCursor' }
              ].map(t => {
                // Select-family modes share one compact Drawboard-style button.
                // PASS 7 (boards 8-14, owner ruling): the button ARMS the family
                // and nothing else — it is a plain 28px tool button like every
                // other one in the cluster. Which mode is live (Box / Lasso /
                // Text) is chosen in the segmented toggle that Select shows in
                // its settings, so the caret and the popover menu that used to
                // hang off this button are gone. The cluster must never change
                // width when the armed tool changes.
                const isSelect = t.id === 'select';
                const isTextSelect = bottomToolbarApi.activeTool === 'text-select';
                const isActive = isSelect
                  ? (bottomToolbarApi.activeTool === 'select' || isTextSelect)
                  : bottomToolbarApi.activeTool === t.id;
                const label = isSelect
                  ? getSelectFamilyLabel(bottomToolbarApi.activeTool, bottomToolbarApi.selectionMode)
                  : t.label;
                return (
                <div
                  key={t.id}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
                >
                <button
                  ref={isSelect ? selectModeButtonRef : undefined}
                  type="button"
                  data-tool-group="true"
                  data-select-mode-trigger={isSelect ? 'true' : undefined}
                  aria-label={label}
                  onClick={() => {
                    if (isSelect) {
                      selectModeTriggerToolRef.current = !isActive
                        ? (isTextSelect || bottomToolbarApi.selectionMode === 'text' ? 'text-select' : 'select') : null;
                      bottomToolbarApi.setActiveTool(
                        isTextSelect || bottomToolbarApi.selectionMode === 'text'
                          ? 'text-select'
                          : 'select',
                      );
                      bottomToolbarApi.setActiveCategoryDropdown(null);
                      return;
                    }
                    bottomToolbarApi.setActiveTool(t.id);
                    bottomToolbarApi.setActiveCategoryDropdown(null);
                  }}
                  {...chromeTip(label, 'below')}
                  // PASS 7 (boards 8-14): every button in the cluster is the
                  // same 28px square with a 16px glyph. Select is no longer
                  // wider than its neighbours — it lost the caret, so it lost
                  // the extra width too.
                  className={`btn chrome-control ${isActive ? 'btn-active' : 'btn-default'}`}
                  style={isSelect ? { position: 'relative' } : undefined}
                >
                  {/* PASS 7 (boards 8-14): ONE glyph size for the whole tool
                      cluster — CHROME_GLYPH (16) inside the 28px button. Select
                      draws the live mode's own glyph (Box / Lasso / Text) so the
                      button says which mode it will arm, and it is centred now
                      that the caret beside it is gone. */}
                  <Icon
                    name={isSelect ? getSelectFamilyIconName(bottomToolbarApi.activeTool, bottomToolbarApi.selectionMode) : t.iconName}
                    size={CHROME_GLYPH}
                  />
                </button>
                </div>
                );
              })}

              {/* PASS 7 (boards 8-14): the rule between two tool GROUPS. It is
                  16px tall with 8px of clear space either side, against the 2px
                  gutter that separates two buttons inside one group — that
                  contrast is the only thing telling the eye where a group ends.
                  Both numbers come from the shared .chrome-divider class, so no
                  bar can write its own. */}
              <div className="chrome-divider" />
              </div>

              {/* Draw category */}
              <button
                onClick={() => {
                  const isActive = bottomToolbarApi.activeCategoryDropdown === 'draw';
                  bottomToolbarApi.setActiveCategoryDropdown(isActive ? null : 'draw');
                  if (!isActive) {
                    if (!['pen', 'highlighter', 'text-highlight', 'eraser'].includes(bottomToolbarApi.activeTool)) {
                      bottomToolbarApi.setActiveTool(bottomToolbarApi.lastDrawTool);
                    }
                  }
                }}
                {...chromeTip('Draw', 'below')}
                className={`btn chrome-control ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'draw' || ['pen', 'highlighter', 'text-highlight', 'eraser'].includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                data-tool-group="true"
                aria-label="Draw"
              >
                <Icon name="drawGroup" size={CHROME_GLYPH} />
              </button>

              {/* Shapes category */}
              <button
                onClick={() => {
                  const isActive = bottomToolbarApi.activeCategoryDropdown === 'shape';
                  bottomToolbarApi.setActiveCategoryDropdown(isActive ? null : 'shape');
                  if (!isActive) {
                    if (!['rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'counter'].includes(bottomToolbarApi.activeTool)) {
                      bottomToolbarApi.setActiveTool(bottomToolbarApi.lastShapeTool);
                    }
                  }
                }}
                {...chromeTip('Shapes', 'below')}
                className={`btn chrome-control ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'shape' || ['rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'counter'].includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                data-tool-group="true"
                aria-label="Shapes"
              >
                <Icon name="shapes" size={CHROME_GLYPH} />
              </button>

              {/* Text category */}
              <button
                onClick={() => {
                  const isActive = bottomToolbarApi.activeCategoryDropdown === 'review';
                  bottomToolbarApi.setActiveCategoryDropdown(isActive ? null : 'review');
                  if (!isActive) {
                    if (!REVIEW_TOOL_IDS.includes(bottomToolbarApi.activeTool)) {
                      bottomToolbarApi.setActiveTool(bottomToolbarApi.lastReviewTool);
                    }
                  }
                }}
                {...chromeTip('Text', 'below')}
                className={`btn chrome-control ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'review' || REVIEW_TOOL_IDS.includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                data-tool-group="true"
                aria-label="Text"
              >
                <Icon name="textGroup" size={CHROME_GLYPH} />
              </button>

              {/* KAL-47: Forms category. Opens the form-field subtoolbar
                  (Textbox / Checkbox / Radio / Signature) and routes
                  activeTool through the FORM_TOOL_IDS set. We do not
                  enable Pdfjs's built-in form-designer toolbar — the
                  subtoolbar is wired directly to the FormDesigner API
                  through the pdfjsViewerRef.
                  2026-05-26: Hidden for first release — feature not yet
                  ready for users. Code stays intact; flip false back to
                  true to re-enable. */}
              {false && (
              <button
                data-testid="forms-category-button"
                onClick={() => {
                  const isActive = bottomToolbarApi.activeCategoryDropdown === 'forms';
                  bottomToolbarApi.setActiveCategoryDropdown(isActive ? null : 'forms');
                  if (!isActive) {
                    if (!FORM_TOOL_IDS.includes(bottomToolbarApi.activeTool)) {
                      bottomToolbarApi.setActiveTool(lastFormTool || 'form-textbox');
                    }
                  } else {
                    // Closing dropdown: leave Forms mode so pan/select work.
                    if (FORM_TOOL_IDS.includes(bottomToolbarApi.activeTool)) {
                      bottomToolbarApi.setActiveTool('pan');
                    }
                  }
                }}
                {...chromeTip('Forms', 'below')}
                className={`btn chrome-control ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'forms' || FORM_TOOL_IDS.includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                aria-label="Forms"
              >
                <Icon name="edit" size={18} />
              </button>
              )}

              {/* 2026-05-26: Tool properties (divider + color swatch + width +
                  any tool-specific extras like the arrowhead dropdown + Aa)
                  are absolutely positioned to the right edge of the icon
                  cluster so they grow outward to the right / shrink back to
                  the left without nudging the pan-select or annotation icons.
                  User priority is icon stability over visual centering. */}
              <div style={{
                // Narrow shells: flow inline after the annotation icons.
                ...(isNarrowShell
                  ? { position: 'static' }
                  : { position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)' }),
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--chrome-gap)',
                whiteSpace: 'nowrap'
              }}>
              {/* PASS 7 (boards 8-14): the rule that separates the tool cluster
                  from the armed tool's settings. Same shared rule, same 8px
                  inset either side, as the one on the cluster's other edge. */}
              <div className="chrome-divider" />

              {/* Color swatch + Width input. Color picker now flips DOWN
                  (top: 100%) since the swatch lives at the top of the
                  viewport instead of the bottom — popping up would shoot
                  off-screen.
                  2026-05-25: Pen + highlighter render the swatch as a flat
                  solid-disc circle (no fill/border ring) per the new
                  context-aware strip contract — visual reference is
                  prototype-context-toolbar.html. Other tools keep the
                  rectangle swatch until they migrate. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--chrome-gap)', position: 'relative' }}>
                {bottomToolbarApi.richTextEditor && typeof document !== 'undefined' && document.getElementById('chrome-sub-toolbar-host') && createPortal(
                  /* 2026-05-26: Rich-text edit mode — the formatting controls
                     drop into the sub-row beneath the top strip (mirrors the
                     Draw / Shape category sub-rows). The inline strip's swatch,
                     width input, and Aa button stay put — only the rich-text
                     controls relocate, so the user keeps the usual chrome.
                     The strip-wide PDFViewer portal suppresses itself when
                     richTextEditor is non-null so the two sub-rows can't stack.
                     2026-05-25: Bridge contract — state comes from the
                     bridge's `state` field (per-selection aware); writes route
                     through the bridge's `api`. The data-rich-text-toolbar
                     attribute opts these buttons out of FabricEditCanvas's
                     document-level click-outside handler so clicks don't
                     commit-and-close the editor. */
                  /* PASS 7 (board 12): the third bar is 36px like the two above
                     it, its controls sit on the settings gutter, and it is
                     CENTRED. */
                  <div data-rich-text-toolbar style={{ width: '100%', height: 'var(--chrome-bar-h)', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', borderTop: 'none', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--chrome-gap)', zIndex: 10, boxSizing: 'border-box' }}>
                    {/* PASS 7 (board 12): the order is colour, then font and
                        size, then B / I / U / S, then the two alignments —
                        appearance, then shape, then position, each pair behind
                        its own rule. */}
                    {/* The quick text colours, the same four the drawing tools
                        show, acting on the text instead of on a stroke. */}
                    <QuickColourDots
                      value={bottomToolbarApi.richTextEditor?.state?.fontColor || '#1e293b'}
                      onPick={(hex) => bottomToolbarApi.richTextEditor?.api?.setFontColor?.(hex)}
                    />
                    {/* Font color — reuses the shared color picker, just like
                        the stroke/fill swatches above. The picker drops DOWN
                        below the swatch via an absolute wrapper (top:100%) so
                        it lines up with the other top-bar pickers. */}
                    <div data-font-color-picker style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                      <button
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onClick={() => setShowFontColorPicker((v) => !v)}
                        className="ctx-color-swatch"
                        style={{
                          width: 'var(--chrome-colour-btn)',
                          height: 'var(--chrome-colour-btn)',
                          padding: 0,
                          borderRadius: '50%',
                          border: 'none',
                          position: 'relative',
                          overflow: 'hidden',
                          boxSizing: 'border-box',
                          cursor: 'pointer',
                        }}
                        {...chromeTip('Font color', 'below')}
                        aria-label="Font color"
                      >
                        <span
                          className="ctx-color-fill"
                          style={{ background: bottomToolbarApi.richTextEditor?.state?.fontColor || '#1e293b' }}
                        />
                      </button>
                      {showFontColorPicker && (
                        /* UX 2026-09-16: same 140ms fade-and-slide as every
                           other popover (Drawboard's 100ms fade+grow in). */
                        <div className="survey-surface-in" style={{
                          position: 'absolute',
                          top: '100%',
                          left: '50%',
                          marginTop: '10px',
                          transform: 'translate(-50%, 0)',
                          zIndex: 2000,
                        }}>
                          <Suspense fallback={null}>
                            <CompactColorPicker
                              color={bottomToolbarApi.richTextEditor?.state?.fontColor || '#1e293b'}
                              opacity={1}
                              marginRight="0"
                              onChange={(hex) => {
                                bottomToolbarApi.richTextEditor?.api?.setFontColor?.(hex);
                              }}
                              onClose={() => setShowFontColorPicker(false)}
                              firstPreset="transparent"
                            />
                          </Suspense>
                        </div>
                      )}
                    </div>
                    {/* Board 12: the rule between the colour group and the
                        font pair. */}
                    <div className="chrome-divider" />
                    {/* Font family — custom dropdown so it opens strictly
                        downward and styling matches the rest of the chrome.
                        Single-name fonts only per the Fabric cursor-drift
                        gotcha (2026-04-08). */}
                    {(() => {
                      const FONT_FAMILIES = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];
                      const currentFamily = bottomToolbarApi.richTextEditor?.state?.fontFamily || 'Arial';
                      return (
                        <AnnotationDropdown
                          open={showFontFamilyMenu}
                          onOpenChange={setShowFontFamilyMenu}
                          label="Font"
                          value={currentFamily}
                          options={FONT_FAMILIES.map((family) => ({
                            value: family,
                            label: family,
                            style: { fontFamily: family },
                          }))}
                          onSelect={(family) => bottomToolbarApi.richTextEditor?.api?.setFontFamily?.(family)}
                          /* Board 12: 104px — the widest font name the list
                             offers ("Times New Roman") has to fit without the
                             pill resizing as the user changes font. */
                          width="var(--chrome-field-w-font)"
                          contentWidth="var(--chrome-field-w-font)"
                          dataMarker="data-font-family-menu"
                          preserveFocus
                        />
                      );
                    })()}
                    {/* Font size — custom dropdown of standard increments.
                        Opens strictly downward (native select can flip up
                        when many options don't fit below). If the active
                        size isn't in the preset list, it's prepended so the
                        trigger label still matches the live value. */}
                    {(() => {
                      const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72];
                      const currentSize = bottomToolbarApi.richTextEditor?.state?.fontSize ?? 16;
                      const sizes = FONT_SIZE_PRESETS.includes(currentSize)
                        ? FONT_SIZE_PRESETS
                        : [currentSize, ...FONT_SIZE_PRESETS];
                      return (
                        <AnnotationDropdown
                          open={showFontSizeMenu}
                          onOpenChange={setShowFontSizeMenu}
                          label="Font size"
                          value={currentSize}
                          /* Board 12 + the units ruling: a size field says
                             "16 pt", not "16". */
                          options={sizes.map((size) => ({ value: size, label: `${size} pt` }))}
                          onSelect={(size) => bottomToolbarApi.richTextEditor?.api?.setFontSize?.(size)}
                          width="var(--chrome-field-w-fontsize)"
                          contentWidth="var(--chrome-field-w-fontsize)"
                          dataMarker="data-font-size-menu"
                          preserveFocus
                        />
                      );
                    })()}
                    {/* Board 12: the rule between the font pair and the four
                        style toggles. */}
                    <div className="chrome-divider" />
                    {/* Bold / Italic / Underline / Strikethrough toggles. */}
                    {[
                      ['formatBold', 'bold', 'toggleBold', 'Bold'],
                      ['formatItalic', 'italic', 'toggleItalic', 'Italic'],
                      ['formatUnderline', 'underline', 'toggleUnderline', 'Underline'],
                      ['formatStrikethrough', 'strike', 'toggleStrike', 'Strikethrough'],
                    ].map(([iconName, stateKey, apiKey, title]) => {
                      const isOn = !!bottomToolbarApi.richTextEditor?.state?.[stateKey];
                      return (
                        <button
                          key={stateKey}
                          onMouseDown={(e) => {
                            // Prevent the textbox from losing its selection
                            // when the user clicks the toggle — without this
                            // the Fabric Textbox blurs and the toggle would
                            // apply to an empty range.
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={() => bottomToolbarApi.richTextEditor?.api?.[apiKey]?.()}
                          className="chrome-text-toggle"
                          // PASS 7 (board 12, owner ruling): 22x20 with a 13px
                          // glyph, on no fill at all. A pressed toggle turns its
                          // GLYPH gold and changes nothing else — the resting
                          // chip fill these carried made four filled boxes in a
                          // row that already had two filled pills in it.
                          style={{ color: isOn ? 'var(--accent)' : 'var(--text-2)' }}
                          {...chromeTip(title, 'below')}
                          aria-label={title}
                          aria-pressed={isOn}
                        >
                          <Icon name={iconName} size={13} />
                        </button>
                      );
                    })}
                    {/* PASS 7 (board 12, owner ruling): alignment is SIX
                        buttons in two groups — left / centre / right, then top /
                        middle / bottom — behind their own rules. It used to be
                        one 3x3 dot grid behind a dropdown, which meant the bar
                        never showed how the text was aligned and setting one
                        axis meant re-picking the other. Both axes are now
                        visible and independent. */}
                    <div className="chrome-divider" />
                    {[
                      ['alignLeft', 'left', 'Align left'],
                      ['alignCenter', 'center', 'Align centre'],
                      ['alignRight', 'right', 'Align right'],
                    ].map(([iconName, value, title]) => {
                      const on = (bottomToolbarApi.richTextEditor?.state?.textAlign || 'left') === value;
                      return (
                        <button
                          key={value}
                          className="chrome-text-toggle"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onClick={() => bottomToolbarApi.richTextEditor?.api?.setTextAlign?.(value)}
                          style={{ color: on ? 'var(--accent)' : 'var(--text-2)' }}
                          {...chromeTip(title, 'below')}
                          aria-label={title}
                          aria-pressed={on}
                        >
                          <Icon name={iconName} size={14} color="currentColor" />
                        </button>
                      );
                    })}
                    <div className="chrome-divider" />
                    {[
                      ['alignTop', 'top', 'Align to the top'],
                      ['alignMiddle', 'middle', 'Align to the middle'],
                      ['alignBottom', 'bottom', 'Align to the bottom'],
                    ].map(([iconName, value, title]) => {
                      const on = (bottomToolbarApi.richTextEditor?.state?.verticalAlign || 'top') === value;
                      return (
                        <button
                          key={value}
                          className="chrome-text-toggle"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onClick={() => bottomToolbarApi.richTextEditor?.api?.setVerticalAlign?.(value)}
                          style={{ color: on ? 'var(--accent)' : 'var(--text-2)' }}
                          {...chromeTip(title, 'below')}
                          aria-label={title}
                          aria-pressed={on}
                        >
                          <Icon name={iconName} size={14} color="currentColor" />
                        </button>
                      );
                    })}
                  </div>,
                  document.getElementById('chrome-sub-toolbar-host')
                )}
                <>
                {/* PASS 7 (board 14, owner ruling): SELECT's setting is the
                    Box / Lasso / Text segmented toggle — the same three modes
                    the phone shows, on the same quiet well, with the chosen
                    word and glyph in gold. It replaced a caret and a popover
                    menu hanging off the Select button: three modes are few
                    enough to show, and showing them means the user can see
                    which one is live without opening anything. */}
                {isSelectFamilyTool(bottomToolbarApi.activeTool) && (
                  <div
                    className="chrome-segmented"
                    data-select-mode-toggle="true"
                    role="group"
                    aria-label="Selection mode"
                    style={{ width: '150px' }}
                  >
                    {SELECT_MODE_OPTIONS.map((opt) => {
                      const selected = isSelectModeActive(opt, bottomToolbarApi.selectionMode);
                      return (
                        <button
                          key={opt.mode}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            bottomToolbarApi.setSelectionMode?.(opt.mode);
                            bottomToolbarApi.setActiveTool(opt.tool);
                          }}
                          {...chromeTip(opt.label, 'below')}
                          aria-label={opt.label}
                        >
                          {/* Board 14: the app's own selection glyphs at 12px —
                              a segment is 16px of usable height. */}
                          <Icon name={getSelectModeIconName(opt.mode)} size={12} color="currentColor" />
                          {SELECT_MODE_SHORT_LABELS[opt.mode]}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* PASS 7 (board 13, owner ruling): the ERASER's two kinds are a
                    segmented toggle, not a dropdown — there are only two, and
                    which one is live changes what a drag does, so it is worth
                    the width to show both. */}
                {bottomToolbarApi.activeTool === 'eraser' && bottomToolbarApi.setEraserMode && (
                  <div
                    className="chrome-segmented"
                    data-eraser-mode-toggle="true"
                    role="group"
                    aria-label="Eraser type"
                    style={{ width: '100px' }}
                  >
                    {[['partial', 'Partial', 'Partial erase'], ['entire', 'Whole', 'Full stroke erase']].map(([mode, short, full]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={bottomToolbarApi.eraserMode === mode}
                        onClick={() => bottomToolbarApi.setEraserMode(mode)}
                        {...chromeTip(full, 'below')}
                        aria-label={full}
                      >
                        {short}
                      </button>
                    ))}
                  </div>
                )}
                {/* Board 13: the rule between the eraser's kind and its size. */}
                {bottomToolbarApi.activeTool === 'eraser' && bottomToolbarApi.setEraserMode && (
                  <div className="chrome-divider" />
                )}
                {/* 2026-05-25: Eraser hides the color swatch entirely — only
                    the diameter input below remains visible for that tool. */}
                {bottomToolbarApi.activeTool !== 'eraser' && (
                  <>
                {/* UX 2026-09-17 (owner): the four default colours open the
                    row, with the swatch that opens the full picker standing
                    immediately to their right. Pressing a dot applies the
                    colour straight away — to the armed tool and to a selected
                    mark — through the very same paint path the picker uses, so
                    the dot and the picker can never mean different things.
                    They sit BEFORE the swatch because the common case is one
                    of the four, and the swatch is the way out to everything
                    else (hex, opacity, the full grid, the spectrum). */}
                {showsColorSwatch(bottomToolbarApi) && annotationPaint && (
                  <QuickColourDots
                    value={annotationPaint.quick.color}
                    onPick={(hex) => annotationPaint.quick.apply(hex, annotationPaint.quick.opacity)}
                  />
                )}
                {!bottomToolbarApi.richTextEditor && (bottomToolbarApi.contextTool === 'pen' || bottomToolbarApi.contextTool === 'highlighter' || bottomToolbarApi.contextTool === 'arrow' || bottomToolbarApi.contextTool === 'line' || bottomToolbarApi.contextTool === 'polyline' || bottomToolbarApi.contextTool === 'text-markup' || bottomToolbarApi.contextTool === 'text-select') ? (
                  /* 2026-05-25: Stroke-only swatch (pen, highlighter, arrow,
                     line). Checker pattern shows through low-opacity strokes
                     and a faint hairline ring lifts pure black off the dark
                     toolbar — both behaviours come from .ctx-color-swatch. */
                  <button
                    data-annotation-color-trigger
                    onClick={() => bottomToolbarApi.setShowAnnotationColorPicker(!bottomToolbarApi.showAnnotationColorPicker)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`ctx-color-swatch${quickColourOnSwatch ? ' is-current-color' : ''}`}
                    style={{
                      width: 'var(--chrome-colour-btn)',
                      height: 'var(--chrome-colour-btn)',
                      padding: 0,
                      borderRadius: '50%',
                      border: 'none',
                      position: 'relative',
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                      cursor: 'pointer'
                    }}
                    {...chromeTip('Color', 'below')}
                    aria-label="Color"
                  >
                    <span
                      className="ctx-color-fill"
                      style={{
                        background: bottomToolbarApi.selectedStrokeColor ?? ensureRgbaOpacity(bottomToolbarApi.strokeColor || '#000000', (bottomToolbarApi.strokeOpacity ?? 100) / 100)
                      }}
                    />
                  </button>
                ) : bottomToolbarApi.contextTool === 'counter' && bottomToolbarApi.handleFillColorChange ? (
                  /* PASS 7 (board 11, owner ruling "the counter icon is the
                     app's real pin, NEVER a circle"): the counter's colour
                     control IS a pin — the owner's own traced pin shape filled
                     with the pin colour, carrying the number in the number
                     colour. It was a round disc with a "1" on it, which showed
                     both colours truthfully but drew a shape the app never
                     draws. Both colours still update live, so the button is
                     always a preview of the next pin. */
                  <button
                    data-annotation-color-trigger
                    onClick={() => {
                      bottomToolbarApi.setShowAnnotationColorPicker(!bottomToolbarApi.showAnnotationColorPicker);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`ctx-color-swatch${quickColourOnSwatch ? ' is-current-color' : ''}`}
                    style={{
                      width: 'var(--chrome-colour-btn)',
                      height: 'var(--chrome-colour-btn)',
                      padding: 0,
                      border: 'none',
                      background: 'transparent',
                      boxSizing: 'border-box',
                      position: 'relative',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    {...chromeTip('Counter colors', 'below')}
                    aria-label="Counter colors"
                  >
                    {(() => {
                      const pinColour = bottomToolbarApi.selectedFillColor ?? ensureRgbaOpacity(bottomToolbarApi.fillColor || '#ef4444', (bottomToolbarApi.fillOpacity ?? 100) / 100);
                      const numberColour = bottomToolbarApi.selectedStrokeColor ?? ensureRgbaOpacity(bottomToolbarApi.strokeColor || '#ffffff', (bottomToolbarApi.strokeOpacity ?? 100) / 100);
                      return (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          {/* The traced pin from src/assets/icons/counter.svg, on
                              the house 24 grid: 67 units of stroke inside a
                              0.0224 group resolves to the house 1.5. */}
                          <g transform="translate(1.6 1.6) scale(0.0224)">
                            <path d="M16.64 14.53C32.51 16.06 48.52 16.04 64.42 17.17C84.3 18.58 104.24 19.47 124.15 20.54C172.46 23.14 221 24.9 269.21 28.79C311.2 32.18 353.46 32.81 395.47 35.77C437.49 38.73 479.63 39.7 521.62 43C562.5 46.22 604.72 56.56 642.66 72C785.02 129.91 889.46 257.4 913.66 410.03C920.35 452.22 920.36 494.92 915.01 537.24C910.4 573.68 901 610.28 886.95 644.23C866.32 694.11 836.9 740.48 799.81 779.75C766.71 814.79 728.26 842.48 686.57 866.19C659.41 881.64 629.18 892.19 599.35 900.86C567.56 910.1 535.15 914.56 502.15 916.64C334.46 927.2 173.19 832.76 94.22 686.11C70.5 642.04 55.77 594.61 47.28 545.43C41.58 512.41 41.99 478.36 39.82 444.99C35.52 379.05 33.34 312.95 28.8 247.02C25.11 193.32 22.63 139.51 19.72 85.75C18.82 69.26 17.52 52.77 16.94 36.26C16.7 29.6 14.39 20.75 16.64 14.53Z" fill={pinColour} stroke={pinColour} strokeWidth="67" strokeLinejoin="round" />
                            <text x="478" y="640" textAnchor="middle" fill={numberColour} fontFamily={FONT_FAMILY} fontWeight="800" fontSize="430">1</text>
                          </g>
                        </svg>
                      );
                    })()}
                  </button>
                ) : (bottomToolbarApi.contextTool === 'rect' || bottomToolbarApi.contextTool === 'ellipse' || bottomToolbarApi.contextTool === 'polygon' || bottomToolbarApi.contextTool === 'text' || bottomToolbarApi.contextTool === 'callout' || !!bottomToolbarApi.richTextEditor) && bottomToolbarApi.handleFillColorChange ? (
                  /* 2026-05-25: Border + fill swatch. Checker shows through
                     low-opacity paint, faint hairline lifts black off the bar.
                     UX 2026-09-17: the DISC is the border and the 2px ring
                     around it is the fill — the disc side and the four dots
                     beside it are the same channel, so a gold ring on this
                     swatch points at a colour the user can actually see on it.
                     It used to be the other way up, which meant a fresh
                     rectangle showed a 0%-opacity white disc next to four dots
                     setting its red border. backgroundClip keeps the white
                     checker behind the disc only, so a transparent fill reads
                     as no ring rather than as a white one. */
                  <button
                    data-annotation-color-trigger
                    onClick={() => {
                      bottomToolbarApi.setShowAnnotationColorPicker(!bottomToolbarApi.showAnnotationColorPicker);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`ctx-color-swatch${quickColourOnSwatch ? ' is-current-color' : ''}`}
                    style={{
                      width: 'var(--chrome-colour-btn)',
                      height: 'var(--chrome-colour-btn)',
                      padding: 0,
                      borderRadius: '50%',
                      border: `2px solid ${bottomToolbarApi.selectedFillColor ?? ensureRgbaOpacity(bottomToolbarApi.fillColor || '#ffffff', (bottomToolbarApi.fillOpacity ?? 100) / 100)}`,
                      backgroundClip: 'padding-box',
                      boxSizing: 'border-box',
                      position: 'relative',
                      overflow: 'hidden',
                      cursor: 'pointer'
                    }}
                    {...chromeTip('Color', 'below')}
                    aria-label="Color"
                  >
                    <span
                      className="ctx-color-fill"
                      style={{
                        background: bottomToolbarApi.selectedStrokeColor ?? ensureRgbaOpacity(bottomToolbarApi.strokeColor || '#000000', (bottomToolbarApi.strokeOpacity ?? 100) / 100)
                      }}
                    />
                  </button>
                ) : null}

                {/* PASS 7 (boards 8-12): the rule between the COLOUR group and
                    the value pills. The bar reads colour | rule | numbers, so a
                    glance separates "what it looks like" from "how big it is". */}
                {showsColorSwatch(bottomToolbarApi) && <div className="chrome-divider" />}

                {!bottomToolbarApi.richTextEditor
                  && bottomToolbarApi.contextTool === 'counter'
                  && bottomToolbarApi.onNewCounterSeries
                  && (() => {
                    const seriesList = Array.isArray(bottomToolbarApi.counterSeriesList)
                      ? bottomToolbarApi.counterSeriesList
                      : [];
                    const activeSeries = seriesList.find((s) => s.seriesId === bottomToolbarApi.activeCounterSeriesId);
                    const seriesLabel = activeSeries?.label || 'Counter series';
                    return (
                      <AnnotationDropdown
                        open={showCounterSeriesMenu}
                        onOpenChange={setShowCounterSeriesMenu}
                        label="Counter series"
                        triggerRef={counterSeriesMenuTriggerRef}
                        triggerProps={{
                          onClick: () => {
                            bottomToolbarApi.setShowAnnotationColorPicker?.(false);
                            setCounterSeriesContextMenu(null);
                          },
                        }}
                        /* PASS 7 (boards 11 + 15, owner ruling): the series pill
                           is WORDS ONLY. The coloured dot that used to lead it
                           said the same thing as the pin swatch two controls to
                           its left, and a 10px dot in an 80px pill was the
                           smallest thing in the bar. */
                        triggerContent={seriesLabel}
                        width="var(--chrome-field-w-series)"
                        contentWidth="var(--chrome-field-w-series)"
                        dataMarker="data-counter-series-menu"
                        outsideBoundarySelector="[data-counter-series-context-menu]"
                      >
                          <div className="annotation-dropdown__body">
                            {/* PASS 7 (board 15): the counts the user already
                                has come first and "New count" closes the list —
                                continuing a count is the common act, starting
                                one is the exception. The "CONTINUE COUNT"
                                caption that used to split them is gone: three
                                words of chrome above three words of content. */}
                            {seriesList.map((series) => {
                              const isActive = series.seriesId === bottomToolbarApi.activeCounterSeriesId;
                              return (
                                <button
                                  key={series.seriesId}
                                  className={`annotation-dropdown__option${isActive ? ' is-active' : ''}`}
                                  aria-haspopup="menu"
                                  aria-label={`${series.label}, ${series.count} pins`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    bottomToolbarApi.onSwitchCounterSeries(series.seriesId);
                                    bottomToolbarApi.setActiveTool?.('counter');
                                    setShowCounterSeriesMenu(false);
                                  }}
                                  onPointerDown={(e) => {
                                    if (e.button !== 2) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    counterSeriesContextTriggerRef.current = e.currentTarget;
                                    setCounterSeriesContextMenu({
                                      seriesId: series.seriesId,
                                      label: series.label,
                                      count: series.count,
                                      x: e.clientX || rect.left + Math.min(36, rect.width / 2),
                                      y: e.clientY || rect.top + Math.min(24, rect.height),
                                    });
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    counterSeriesContextTriggerRef.current = e.currentTarget;
                                    setCounterSeriesContextMenu({
                                      seriesId: series.seriesId,
                                      label: series.label,
                                      count: series.count,
                                      x: rect.left + Math.min(36, rect.width / 2),
                                      y: rect.top + Math.min(24, rect.height),
                                    });
                                  }}
                                >
                                  {/* PASS 7 (board 15, owner ruling): the series
                                      menu is WORDS ONLY — the dot and the pin
                                      tally are gone from the row. How many pins
                                      a count holds is still announced to a
                                      screen reader through aria-label above. */}
                                  <span style={{ flex: 1 }}>{series.label}</span>
                                </button>
                              );
                            })}
                            <button
                              className="annotation-dropdown__option"
                              onClick={(e) => {
                                e.stopPropagation();
                                bottomToolbarApi.onNewCounterSeries();
                                setShowCounterSeriesMenu(false);
                              }}
                            >
                              {/* Board 15: a plus glyph, not a "+" typed into
                                  the label, so the row matches every other
                                  drawing-then-words row in the chrome. */}
                              <Icon name="plus" size={13} color="currentColor" />
                              New count
                            </button>
                          </div>
                        {showCounterSeriesMenu && counterSeriesContextMenu && typeof document !== 'undefined' && createPortal((
                          <div
                            ref={counterSeriesContextMenuRef}
                            data-counter-series-context-menu
                            role="menu"
                            aria-label={`${counterSeriesContextMenu.label} actions`}
                            style={{
                              position: 'fixed',
                              left: `${Math.max(8, Math.min(counterSeriesContextMenu.x, window.innerWidth - 120))}px`,
                              top: `${Math.max(8, Math.min(counterSeriesContextMenu.y, window.innerHeight - 72))}px`,
                              width: '112px',
                              padding: '3px',
                              background: 'var(--surface-1)',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              boxShadow: '0 8px 18px rgba(0,0,0,0.42)',
                              zIndex: 5700,
                            }}
                          >
                            <button
                              role="menuitem"
                              onClick={(e) => {
                                e.stopPropagation();
                                bottomToolbarApi.onSwitchCounterSeries(counterSeriesContextMenu.seriesId);
                                bottomToolbarApi.setActiveTool?.('counter');
                                setCounterSeriesContextMenu(null);
                                setShowCounterSeriesMenu(false);
                              }}
                              style={{
                                display: 'block',
                                width: '100%',
                                height: '28px',
                                padding: '0 8px',
                                background: 'transparent',
                                border: 'none',
                                borderRadius: '4px',
                                color: 'var(--text-2)',
                                textAlign: 'left',
                                cursor: 'pointer',
                                font: 'inherit',
                                fontSize: '12px',
                                outline: 'none',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                              onFocus={(e) => { e.currentTarget.style.boxShadow = 'inset 0 0 0 1px var(--text-disabled)'; }}
                              onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
                            >
                              Continue
                            </button>
                            <button
                              role="menuitem"
                              onClick={(e) => {
                                e.stopPropagation();
                                const { seriesId } = counterSeriesContextMenu;
                                setCounterSeriesContextMenu(null);
                                const result = bottomToolbarApi.onDeleteCounterSeries?.(seriesId);
                                setShowCounterSeriesMenu(false);
                                if (result?.ok === false) {
                                  showToast('This count could not be deleted. Check your permission and try again.', 'error');
                                }
                              }}
                              style={{
                                display: 'block',
                                width: '100%',
                                height: '28px',
                                padding: '0 8px',
                                background: 'transparent',
                                border: 'none',
                                borderRadius: '4px',
                                color: 'var(--danger)',
                                textAlign: 'left',
                                cursor: 'pointer',
                                font: 'inherit',
                                fontSize: '12px',
                                outline: 'none',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(248,113,113,0.12)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                              onFocus={(e) => { e.currentTarget.style.boxShadow = 'inset 0 0 0 1px var(--text-disabled)'; }}
                              onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
                            >
                              Delete
                            </button>
                          </div>
                        ), document.body)}
                      </AnnotationDropdown>
                    );
                  })()}

                {bottomToolbarApi.showAnnotationColorPicker && (() => {
                  // 2026-05-25 / UX 2026-09-17: the fill-vs-border tab, the
                  // "one side of a shape stays visible" rule and the write
                  // itself all live in resolveAnnotationPaint above, because
                  // the quick colour dots at the head of this row go through
                  // exactly the same paint. They used to be written out here,
                  // which is fine for one caller and a drift waiting to happen
                  // for two.
                  const { isShape, onFillTab, shapeOneVisibleRule, isTextMarkupPalette, color: currentColor, opacity: currentOpacity, apply: applyChange } = annotationPaint;
                  const isCounter = bottomToolbarApi.contextTool === 'counter';
                  const secondTabLabel = isCounter ? 'Number' : 'Border';
                  const textMarkupPaletteHostRect = isTextMarkupPalette
                    ? document.getElementById('chrome-sub-toolbar-host')?.getBoundingClientRect?.()
                    : null;
                  const textMarkupPickerPosition = isTextMarkupPalette
                    ? computeTextMarkupPickerPosition(bottomToolbarApi.textMarkupSelectionRect, {
                        viewportWidth: window.innerWidth,
                        viewportHeight: window.innerHeight,
                        hostBottom: textMarkupPaletteHostRect?.bottom || 35,
                      })
                    : null;
                  const picker = (
                    /* UX 2026-09-16: the colour popover fades and slides down
                       5px as it opens (140ms), matching Drawboard's 100ms
                       fade-and-grow. It used to pop in with transition 0s.
                       The shared class animates `translate`, not `transform`,
                       so the inline translate(-50%) centring below survives. */
                    <div ref={annotationColorPickerRef} data-annotation-color-picker className="survey-surface-in" style={{
                      position: isTextMarkupPalette ? 'fixed' : 'absolute',
                      top: isTextMarkupPalette ? textMarkupPickerPosition.top : '100%',
                      left: isTextMarkupPalette ? textMarkupPickerPosition.left : '50%',
                      marginTop: isTextMarkupPalette ? 0 : '10px',
                      transform: isTextMarkupPalette ? 'none' : 'translate(-50%, 0)',
                      zIndex: isTextMarkupPalette ? 5900 : 2000
                    }}>
                      {isShape && (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          background: 'var(--surface-0)',
                          border: '1px solid var(--border)',
                          borderBottom: 'none',
                          borderRadius: '8px 8px 0 0',
                          overflow: 'hidden',
                          width: '260px',
                          marginRight: '53px'
                        }}>
                          {[['fill', 'Fill'], ['border', secondTabLabel]].map(([k, label], i) => {
                            const on = colorPickerTab === k;
                            return (
                              <button
                                key={k}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setColorPickerTab(k);
                                  bottomToolbarApi.setShowAnnotationColorPicker(true);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                style={{
                                  /* UX 2026-09-17 (owner ruling): the chosen Fill / Border tab
                                     is marked by the 2px gold underline below plus brighter
                                     ink, never by a warm wash behind the label. */
                                  background: 'transparent',
                                  color: on ? 'var(--text-2)' : 'var(--text-3)',
                                  fontWeight: 600,
                                  fontSize: 12,
                                  padding: '8px 0',
                                  border: 0,
                                  borderRight: i === 0 ? '1px solid var(--border)' : 0,
                                  cursor: 'pointer',
                                  position: 'relative'
                                }}
                              >
                                {label}
                                {on && (
                                  <span style={{
                                    position: 'absolute', left: 0, right: 0, bottom: 0,
                                    height: 2, background: 'var(--accent)'
                                  }} />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <Suspense fallback={null}>
                        <CompactColorPicker
                          color={currentColor}
                          opacity={currentOpacity}
                          marginRight="53px"
                          attachedHeader={isShape}
                          outsideBoundaryRef={annotationColorPickerRef}
                          onChange={applyChange}
                          onClose={() => bottomToolbarApi.setShowAnnotationColorPicker(false)}
                          firstPreset={(shapeOneVisibleRule && !onFillTab)
                            ? { kind: 'match', color: bottomToolbarApi.fillColor || '#ffffff', opacity: (bottomToolbarApi.fillOpacity ?? 100) / 100 }
                            : 'transparent'}
                        />
                      </Suspense>
                    </div>
                  );
                  return isTextMarkupPalette ? <BodyPortal>{picker}</BodyPortal> : picker;
                })()}
                {['text-markup', 'text-select'].includes(bottomToolbarApi.contextTool) && bottomToolbarApi.setTextMarkupOverlapMode && (
                  <select
                    aria-label="Highlight overlap mode"
                    title="Layered keeps editable native PDF highlights. Uniform keeps one visual strength and exports as a flat mask so other PDF viewers match Survey."
                    value={bottomToolbarApi.textMarkupOverlapMode || 'layered'}
                    onChange={(event) => bottomToolbarApi.setTextMarkupOverlapMode(event.target.value)}
                    style={{ height: 28, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface-1)', color: 'var(--text-1)', fontSize: 11 }}
                  >
                    <option value="layered">Layered</option>
                    <option value="uniform">Uniform</option>
                  </select>
                )}
                  </>
                )}

                {/* PASS 7 (owner ruling): the WIDTH is a dropdown only — the
                    three quick width chips that used to stand to the left of
                    the field are gone, and so is the typed field itself. A
                    width is a pill showing the stroke it will draw, the value
                    with its unit, and a chevron onto the list. */}

                {(bottomToolbarApi.contextTool === 'pen'
                  || bottomToolbarApi.contextTool === 'highlighter'
                  || bottomToolbarApi.contextTool === 'arrow'
                  || bottomToolbarApi.contextTool === 'line'
                  || bottomToolbarApi.contextTool === 'rect'
                  || bottomToolbarApi.contextTool === 'ellipse'
                  // UX: Polygon / Polyline take the same Width control as
                  // every other stroked shape — a many-sided rectangle and a
                  // many-segment line have no reason to behave differently.
                  || bottomToolbarApi.contextTool === 'polygon'
                  || bottomToolbarApi.contextTool === 'polyline'
                  || bottomToolbarApi.contextTool === 'text'
                  || bottomToolbarApi.contextTool === 'callout'
                  || bottomToolbarApi.contextTool === 'counter'
                  || bottomToolbarApi.activeTool === 'eraser') && (
                <AnnotationSizeControl
                  value={bottomToolbarApi.activeTool === 'eraser' ? bottomToolbarApi.eraserSizeInputValue : bottomToolbarApi.strokeWidthInputValue}
                  label={bottomToolbarApi.contextTool === 'counter' || bottomToolbarApi.activeTool === 'eraser' ? 'Size' : 'Width'}
                  min={bottomToolbarApi.contextTool === 'counter' ? COUNTER_SIZE_MIN : 1}
                  max={bottomToolbarApi.activeTool === 'eraser'
                    ? 100
                    : bottomToolbarApi.contextTool === 'counter'
                      ? COUNTER_SIZE_MAX
                      : 50}
                  // UX 2026-09-09: line widths keep one decimal (the Cloud
                  // style's 2.5 default); counter/eraser sizes stay whole.
                  decimals={bottomToolbarApi.activeTool === 'eraser' || bottomToolbarApi.contextTool === 'counter'
                    ? 0
                    : ANNOTATION_WIDTH_DECIMALS}
                  presets={bottomToolbarApi.activeTool === 'eraser'
                    ? ANNOTATION_SIZE_PRESETS.eraser
                    : bottomToolbarApi.contextTool === 'counter'
                      ? ANNOTATION_SIZE_PRESETS.counter
                      : ANNOTATION_SIZE_PRESETS.width}
                  onValueChange={(value) => {
                    const handler = bottomToolbarApi.activeTool === 'eraser'
                      ? bottomToolbarApi.handleEraserSizeInputChange
                      : bottomToolbarApi.handleStrokeWidthInputChange;
                    handler?.({ target: { value } });
                  }}
                  onValueCommit={(value) => {
                    const handler = bottomToolbarApi.activeTool === 'eraser'
                      ? bottomToolbarApi.handleEraserSizeInputBlur
                      : bottomToolbarApi.handleStrokeWidthInputBlur;
                    handler?.({ currentTarget: { value } });
                  }}
                  onFocusChange={(focused) => {
                    if (bottomToolbarApi.activeTool === 'eraser') {
                      bottomToolbarApi.setIsEraserSizeFocused?.(focused);
                    } else {
                      bottomToolbarApi.setIsStrokeWidthFocused?.(focused);
                    }
                  }}
                  open={openAnnotationDropdown === 'size'}
                  onOpenChange={(open) => setDropdownOpen('size', open)}
                  // PASS 7 (boards 8-13, owner ruling "width is a dropdown
                  // ONLY"): the pill presentation. Every numeric setting in the
                  // bar carries its unit, so "2" reads "2 pt". The line width
                  // leads with a stroke drawn at the weight it will paint; the
                  // eraser leads with a dot, because what it sets is the size of
                  // a round rubber; the counter's pin size leads with nothing,
                  // because a pin has no line to preview.
                  variant="pill"
                  unit="pt"
                  width="var(--chrome-field-w)"
                  preview={bottomToolbarApi.activeTool === 'eraser' ? (
                    <span
                      aria-hidden="true"
                      style={{ display: 'block', width: '8px', height: '8px', borderRadius: '50%', background: 'currentColor' }}
                    />
                  ) : bottomToolbarApi.contextTool === 'counter' ? null : (
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'block',
                        width: '12px',
                        height: 0,
                        borderTop: `${Math.max(1, Math.min(6, Math.round(Number(bottomToolbarApi.strokeWidthInputValue) || 1)))}px solid currentColor`,
                        borderRadius: '1px',
                      }}
                    />
                  )}
                />
                )}
                {bottomToolbarApi.contextTool === 'counter'
                  && bottomToolbarApi.selectedCounterSeriesId
                  && bottomToolbarApi.onSelectedCounterSeriesStartChange && (() => {
                    const startLocked = bottomToolbarApi.selectedCounterSeriesSize !== 1;
                    const startTitle = startLocked
                      ? 'Start number is set after a second counter is added'
                      : 'Start number';
                    return (
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: startLocked ? 'var(--text-disabled)' : 'var(--text-3)',
                          fontSize: '11px',
                          fontFamily: FONT_FAMILY,
                        }}
                        {...chromeTip(startTitle, 'below')}
                      >
                        Start
                        <input
                          key={`${bottomToolbarApi.selectedCounterSeriesId}:${bottomToolbarApi.selectedCounterSeriesStart}`}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          className="no-spin-buttons"
                          defaultValue={bottomToolbarApi.selectedCounterSeriesStart ?? 1}
                          disabled={startLocked}
                          onInput={(event) => {
                            event.currentTarget.value = event.currentTarget.value.replace(/[^0-9]/g, '');
                          }}
                          onBlur={(event) => {
                            const next = Math.max(1, Math.floor(Number(event.currentTarget.value) || 1));
                            event.currentTarget.value = String(next);
                            bottomToolbarApi.onSelectedCounterSeriesStartChange(next);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                          }}
                          aria-label="Counter start number"
                          style={{
                            width: '42px',
                            height: '20px',
                            padding: '4px',
                            background: 'var(--surface-3)',
                            color: 'var(--text-2)',
                            border: '1px solid transparent',
                            borderRadius: '5px',
                            fontSize: '12px',
                            fontFamily: FONT_FAMILY,
                            textAlign: 'center',
                            opacity: startLocked ? 0.55 : 1,
                          }}
                        />
                      </label>
                    );
                  })()}
                {/* 2026-05-25: Style picker — solid/dashed/dotted for line + arrow.
                    UX 2026-09-09: "Cloud" is also offered on every shape a
                    revision cloud can enclose or trace — rectangle,
                    ellipse/circle, polygon, polyline — and never on arrow,
                    counter or a single straight line, because a cloud marks out
                    a REGION. The gate is supportsCloudStyle (resolved from the
                    real selected/armed shape in PDFViewer) rather than
                    contextTool, which folds a selected polygon onto 'rect' and a
                    selected polyline onto 'line'. Always opens downward.
                    A stale 'cloud' carried over from a shape tool reads as
                    Solid on a tool that cannot cloud (arrow/line/text/callout);
                    creation already treats it as solid, so the label matches
                    what will be drawn. Polygon and polyline read the same
                    picker because they are stroked shapes like line and rect. */}
                {(bottomToolbarApi.contextTool === 'arrow' || bottomToolbarApi.contextTool === 'line' || bottomToolbarApi.contextTool === 'rect' || bottomToolbarApi.contextTool === 'ellipse' || bottomToolbarApi.contextTool === 'polygon' || bottomToolbarApi.contextTool === 'polyline' || bottomToolbarApi.contextTool === 'text' || bottomToolbarApi.contextTool === 'callout') && bottomToolbarApi.setLineBorderStyle && (
                  (() => {
                  const styleValue = bottomToolbarApi.lineBorderStyle === 'cloud' && !bottomToolbarApi.supportsCloudStyle ? 'solid' : bottomToolbarApi.lineBorderStyle;
                  return (
                  <AnnotationDropdown
                    open={showStyleMenu}
                    onOpenChange={setShowStyleMenu}
                    label="Style"
                    value={styleValue}
                    options={LINE_STYLE_OPTIONS.filter((option) => option.value !== 'cloud' || bottomToolbarApi.supportsCloudStyle)}
                    onSelect={bottomToolbarApi.setLineBorderStyle}
                    dataMarker="data-style-menu"
                    /* PASS 7 (boards 9-12 + 15): the pill shows the LINE it
                       will draw, then names it; every row in its menu is the
                       same drawing at the menu's 24px sample width. */
                    preview={<Icon name={LINE_STYLE_SAMPLE_ICONS[styleValue] || 'lineSampleSolid'} size={18} color="currentColor" />}
                    renderOption={(option) => (
                      <>
                        <span className="annotation-dropdown__sample" aria-hidden="true">
                          <Icon name={LINE_STYLE_SAMPLE_ICONS[option.value]} size={24} color="currentColor" />
                        </span>
                        <span>{option.label}</span>
                      </>
                    )}
                    width="var(--chrome-field-w-style)"
                    contentWidth="var(--chrome-field-w-style)"
                  />
                  );
                  })()
                )}
                {/* 2026-05-25: Bump number input — shows only when the border
                    style is Cloud, on the same shapes that offer Cloud at all
                    (see supportsCloudStyle above). Drives how big the cloud's
                    wave bumps render. Mirrors the width input visual. */}
                {bottomToolbarApi.supportsCloudStyle && bottomToolbarApi.lineBorderStyle === 'cloud' && bottomToolbarApi.setCloudIntensity && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-3)', fontSize: '11px', fontFamily: FONT_FAMILY }}>
                    Bump
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      className="no-spin-buttons"
                      value={bottomToolbarApi.cloudIntensity ?? 2}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '' || /^\d+$/.test(raw)) {
                          const next = raw === '' ? 1 : Math.max(1, Math.min(20, parseInt(raw, 10)));
                          bottomToolbarApi.setCloudIntensity(next);
                        }
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      style={{
                        width: '36px',
                        height: '20px',
                        padding: '4px 4px',
                        background: 'var(--surface-3)',
                        color: 'var(--text-2)',
                        border: '1px solid transparent',
                        borderRadius: '5px',
                        fontSize: '12px',
                        fontFamily: FONT_FAMILY,
                        textAlign: 'center'
                      }}
                      {...chromeTip('Cloud bump size', 'below')}
                      aria-label="Cloud bump size"
                      // UX 2026-09-10 (round 4, defect 3): a numeric chrome
                      // field yields Enter / Escape to a click-to-place draft.
                      // Enter commits this value and finishes the polygon /
                      // polyline; Escape cancels it. See draftKeyboardTarget.
                      data-draft-yields-keys="true"
                    />
                  </label>
                )}
                {/* 2026-05-25: Arrow tool (or selected callout) — custom
                    arrowhead menu that always opens downward and shows every
                    option at once (native select scrolls / picks its own
                    direction). Callouts have their own arrowhead end so the
                    same picker drives both. */}
                {(bottomToolbarApi.contextTool === 'arrow' || bottomToolbarApi.contextTool === 'callout') && bottomToolbarApi.setArrowheadStyle && (() => {
                  const live = bottomToolbarApi.arrowheadStyle;
                  const options = ARROWHEAD_MENU_OPTIONS.some((option) => option.value === live)
                    ? ARROWHEAD_MENU_OPTIONS
                    : [{ value: live, label: ARROWHEAD_STYLE_LABELS[live] || 'Arrowhead', icon: 'arrowheadOpen' }, ...ARROWHEAD_MENU_OPTIONS];
                  const iconFor = (value) => options.find((option) => option.value === value)?.icon || 'arrowheadSolid';
                  return (
                  <AnnotationDropdown
                    open={showArrowheadMenu}
                    onOpenChange={setShowArrowheadMenu}
                    label="Arrowhead"
                    value={live}
                    options={options}
                    onSelect={bottomToolbarApi.setArrowheadStyle}
                    dataMarker="data-arrowhead-menu"
                    /* PASS 7 (boards 10 + 15): the pill draws the head it will
                       put on the line, and each row draws its own. */
                    preview={<Icon name={iconFor(live)} size={15} color="currentColor" />}
                    renderOption={(option) => (
                      <>
                        <span className="annotation-dropdown__sample" aria-hidden="true">
                          <Icon name={option.icon} size={16} color="currentColor" />
                        </span>
                        <span>{option.label}</span>
                      </>
                    )}
                    width="var(--chrome-field-w-arrowhead)"
                    contentWidth="var(--chrome-field-w-arrowhead)"
                  />
                  );
                })()}
                {/* PASS 7 (boards 10 + 16, owner ruling): ARROW ENDS is a
                    dropdown of three — End, Both, None — replacing the "both
                    ends" on/off button. A toggle could only say "both or not",
                    so "no head at all" had to be found in the Arrowhead list
                    instead; the three ends now sit together in one control, with
                    the identical glyphs the phone's arrow sheet shows. Arrow
                    tool only (a callout has one end). */}
                {bottomToolbarApi.contextTool === 'arrow' && bottomToolbarApi.setArrowBothEnds && (() => {
                  const endsValue = bottomToolbarApi.arrowheadStyle === 'none'
                    ? 'none'
                    : (bottomToolbarApi.arrowBothEnds ? 'both' : 'end');
                  const iconFor = (value) => ARROW_ENDS_OPTIONS.find((option) => option.value === value)?.icon || 'moveRight';
                  return (
                  <AnnotationDropdown
                    open={showArrowEndsMenu}
                    onOpenChange={setShowArrowEndsMenu}
                    label="Arrow ends"
                    value={endsValue}
                    options={ARROW_ENDS_OPTIONS}
                    onSelect={(next) => {
                      if (next === 'none') {
                        bottomToolbarApi.setArrowheadStyle?.('none');
                        return;
                      }
                      // Coming back from None: the line needs a head again
                      // before "which ends" can mean anything, so restore the
                      // default solid head the boards show.
                      if (bottomToolbarApi.arrowheadStyle === 'none') {
                        bottomToolbarApi.setArrowheadStyle?.('solidTriangle');
                      }
                      bottomToolbarApi.setArrowBothEnds(next === 'both');
                    }}
                    dataMarker="data-arrow-ends-menu"
                    preview={<Icon name={iconFor(endsValue)} size={15} color="currentColor" />}
                    renderOption={(option) => (
                      <>
                        <span className="annotation-dropdown__sample" aria-hidden="true">
                          <Icon name={option.icon} size={16} color="currentColor" />
                        </span>
                        <span>{option.label}</span>
                      </>
                    )}
                    width="var(--chrome-field-w-ends)"
                    contentWidth="var(--chrome-field-w-ends)"
                  />
                  );
                })()}
                {/* 2026-05-25: Rich-text edit entry button. Only renders when
                    the user is on the text box / callout tool or has one of
                    those selected. Disabled when nothing editable is picked.
                    Clicking drops the user into text edit mode on the
                    selected item — same path as double-clicking the text. */}
                {bottomToolbarApi.onEnterTextEdit
                  && (bottomToolbarApi.contextTool === 'text'
                      || bottomToolbarApi.contextTool === 'callout'
                      || !!bottomToolbarApi.richTextEditor) && (
                  <button
                    onClick={() => bottomToolbarApi.onEnterTextEdit()}
                    onMouseDown={(e) => e.stopPropagation()}
                    disabled={!bottomToolbarApi.canEnterTextEdit}
                    style={{
                      height: 'var(--chrome-field-h)',
                      padding: '0 var(--chrome-field-pad-x)',
                      // UX 2026-09-17 (owner ruling): in text-edit mode the "Aa"
                      // label turns gold; the chip keeps its resting fill.
                      background: 'var(--surface-3)',
                      color: bottomToolbarApi.richTextEditor
                        ? 'var(--accent)'
                        : bottomToolbarApi.canEnterTextEdit ? 'var(--text-2)' : 'var(--text-disabled)',
                      border: '1px solid transparent',
                      borderRadius: '5px',
                      fontSize: '13px',
                      fontWeight: 600,
                      fontFamily: FONT_FAMILY,
                      cursor: bottomToolbarApi.canEnterTextEdit ? 'pointer' : 'not-allowed',
                      opacity: bottomToolbarApi.canEnterTextEdit ? 1 : 0.5,
                      lineHeight: 1,
                    }}
                    {...chromeTip(bottomToolbarApi.canEnterTextEdit
                      ? 'Edit text'
                      : 'Select a text box or callout to edit its text', 'below')}
                    aria-label="Edit text"
                    aria-pressed={!!bottomToolbarApi.richTextEditor}
                  >
                    Aa
                  </button>
                )}
                </>
              </div>
              </div>
            </div>
          )}
        </div>
        )}
        <div className={isMobileViewer ? 'mobile-pdf-work-area' : undefined} style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex' }}>
          <div
            id="chrome-left-host"
            style={{
              display: isViewerVisible ? 'flex' : 'none',
              flexGrow: 0,
              flexBasis: isMobileViewer ? '44px' : '48px',
              width: isMobileViewer ? '44px' : '48px',
              flexShrink: 0,
              minWidth: isMobileViewer ? '44px' : '48px',
              alignSelf: 'stretch',
              background: isMobileViewer ? 'var(--surface-2)' : 'var(--surface-1)',
              color: 'var(--text-2)',
              fontFamily: FONT_FAMILY,
              overflow: 'visible',
              position: 'relative',
              zIndex: 5600
            }}
          >
            {isMobileViewer && (
              <MobilePdfViewerToolRail
                bottomToolbarApi={bottomToolbarApi}
                leftRailApi={leftRailApi}
                onOpenPanel={openMobileDocumentPanel}
                onAuxPanelStateChange={setMobileAuxPanel}
              />
            )}
            {leftRailApi && (
              <PDFSidebar
                {...leftRailApi}
                mobileMode={isMobileViewer}
                onPanelStateChange={setMobileDocumentPanelState}
              />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
            {/* UX 2026-05-14: chrome-sub-toolbar-host — App-level mount point
                for the category sub-row (Draw / Shapes / Text expansion).
                Sits at the same DOM level as the rails and top bar. The
                cursor tracker treats this as outside the viewport
                naturally because it is NOT inside the pdf-container
                subtree. Positioned absolute at top:0 so the sub-row
                overlays the canvas without pushing it down — the viewer
                underneath keeps its full height. */}
            <div
              id="chrome-sub-toolbar-host"
              data-chrome-strip="true"
              style={{
                display: isViewerVisible && (
                  !isMobileViewer
                  || bottomToolbarApi?.activeTool === 'text-select'
                  || bottomToolbarApi?.contextTool === 'text-markup'
                ) ? 'block' : 'none',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                background: 'var(--surface-2)',
                cursor: 'default',
                zIndex: isMobileViewer && (
                  bottomToolbarApi?.activeTool === 'text-select'
                  || bottomToolbarApi?.contextTool === 'text-markup'
                ) ? 5800 : 5400
              }}
            />
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
            <Dashboard
              ref={dashboardRef}
              onDocumentSelect={handleDocumentSelect}
              onBack={handleBack}
              documents={documents}
              setDocuments={setDocuments}
              templates={appTemplates}
              onTemplatesChange={handleTemplatesChange}
              onShowAuthModal={() => setShowAuthModal(true)}
              entities={entities}
              setEntities={setEntities}
            />
            {tabs.map(tab => {
              if (tab.isHome) return null;

              const isVisible = tab.id === activeTabId && currentView === 'viewer';
              const tabViewState = tab.viewState;

              return (
                <div
                  key={tab.id}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'var(--surface-1)',
                    zIndex: isVisible ? 5000 : 4000, // Keep lower z-index when hidden
                    display: isVisible ? 'block' : 'none'
                  }}
                >
                  <YDocProvider docId={tab.file?.id} isActive={isVisible}>
                    {/* KAL-49 — document lock banner. Mounted as a sibling
                        inside YDocProvider so it sees the same per-tab Y.Doc
                        scope (the lock state is a document-level concept and
                        keys on the same documentId). */}
                    <DocumentLockBanner
                      documentId={tab.file?.id || null}
                      viewerUserId={user?.id || null}
                      isActive={isVisible}
                      onLockStateChange={(isLocked) => {
                        setDocumentLockedByTab((current) => (
                          current[tab.id] === isLocked
                            ? current
                            : { ...current, [tab.id]: isLocked }
                        ));
                      }}
                    />
                    <Suspense fallback={null}>
                    <PDFViewer
                      pdfFile={tab.file}
                      pdfFilePath={tab.filePath}
                      onBack={handleBack}
                      tabId={tab.id}
                      isActive={isVisible}
                      documentLocked={documentLockedByTab[tab.id] === true}
                      mobileMode={isNarrowShell}
                      onTopToolbarApiChange={setTopToolbarApi}
                      onBottomToolbarApiChange={setBottomToolbarApi}
                      onLeftRailApiChange={setLeftRailApi}
                      onRightRailApiChange={setRightRailApi}
                      onPageDrop={handlePageDrop}
                      onUpdatePDFFile={handleUpdatePDFFile}
                      onCloseAfterFailure={handleTabClose}
                      onUnsavedAnnotationsChange={handleUnsavedAnnotationsChange}
                      onAnnotationsExistChange={handleAnnotationsExistChange}
                      onRequestCreateTemplate={handleCreateTemplateRequest}
                      initialViewState={tabViewState}
                      onViewStateChange={handleViewStateChange}
                      templates={appTemplates}
                      onTemplatesChange={handleTemplatesChange}
                      onRefetchTemplates={refetchTemplates}
                      user={user}
                      isMSAuthenticated={isMSAuthenticated}
                      msLogin={msLogin}
                      graphClient={graphClient}
                      msAccount={msAccount}
                      msNeedsReconnect={msNeedsReconnect}
                      ensureFreshToken={ensureFreshToken}
                      msGetAuthSignals={msGetAuthSignals}
                      entities={entities}
                      setEntities={setEntities}
                    />
                    </Suspense>
                  </YDocProvider>
                </div>
              );
            })}
          </div>
          </div>
          {/* UX 2026-05-14/29: chrome-right-host — slim always-visible right rail.
              Pinned to the viewport's right edge. Survey owns this rail; page
              and zoom controls now live in the top-right toolbar pill. */}
          <div
            id="chrome-right-host"
            style={{
              display: isViewerVisible ? 'flex' : 'none',
              flexGrow: 0,
              flexBasis: isMobileViewer ? '0px' : '48px',
              flexShrink: 0,
              width: isMobileViewer ? '0px' : '48px',
              minWidth: isMobileViewer ? '0px' : '48px',
              overflow: 'visible',
              alignSelf: 'stretch',
              background: isMobileViewer ? 'transparent' : 'var(--surface-1)',
              color: 'var(--text-2)',
              fontFamily: FONT_FAMILY,
              flexDirection: 'column',
              alignItems: 'center',
              padding: 0,
              gap: 0,
              position: 'relative',
              zIndex: 5600
            }}
          >
            {rightRailApi && (
              <SurveySpacesRail
                {...rightRailApi}
                mobileMode={isMobileViewer}
                expandRequestKey={(rightRailApi.expandRequestKey || 0) + mobileSurveyRequestKey}
                collapseRequestKey={mobileSurveyCollapseRequestKey}
                onCollapseChange={(collapsed) => {
                  setMobileSurveyPanelOpen(!collapsed);
                  // Rail footer (below) flips vertical/horizontal off this.
                  setRightRailCollapsed(collapsed);
                  rightRailApi.onCollapseChange?.(collapsed);
                }}
              />
            )}
            {/* Spacer pushes the bottom slot to the bottom of the rail. */}
            <div style={{ flex: 1 }} />

            {/* UX 2026-07-14 (rail-footer redesign): zoom / page / fit controls
                live in a footer pinned to the BOTTOM of the right rail — the
                Walkthru reference layout. Collapsed rail (48px): a vertical
                stack in the column flow (the flex:1 spacer above pushes it
                down). Expanded survey panel (320px): the footer becomes a
                horizontal row overlaying the panel bottom (zIndex 2 above the
                panel's zIndex 1) so long survey content scrolls beneath it.
                Every handler still comes from bottomToolbarApi (published by
                PDFViewer), so the zoom invariants — zoomGeneration,
                container-aware canvas sizing, the scale-confirm pipeline —
                are completely untouched; only the buttons moved out of the
                old top-right pill. Sizing kept from the retired vertical
                strip: 24-28px buttons, 10-11px tabular-nums values, middle
                dot between current page and total. */}
            {isViewerVisible && !isMobileViewer && bottomToolbarApi && (() => {
              const api = bottomToolbarApi;
              const atFirstPage = api.pageNum <= 1;
              const atLastPage = api.pageNum >= api.numPages;
              const fitMode = api.zoomMode;
              // Fall back to fit-page icon when mode is MANUAL or unknown.
              const fitIconMode = (fitMode === ZOOM_MODES.FIT_WIDTH || fitMode === ZOOM_MODES.FIT_HEIGHT) ? fitMode : ZOOM_MODES.FIT_PAGE;
              // Shared icon-button chassis.
              // UX 2026-09-16 (desktop sweep): the BOX is part of the chassis now,
              // at the shared rail size (--rail-control / RAIL_CONTROL). Variants
              // used to spread their own width/height on top, which is how one
              // footer ended up with 28px zoom buttons beside 24px page steppers
              // beside a 36x28 Fit cell. Intended UX: one control box and one
              // glyph size for the whole rail footer, the way the Pages tabs above
              // it are one box and one glyph. Reference behaviour matched:
              // Drawboard PDF, whose status bar holds one button size end to end.
              // Only the Fit button, which hangs a caret beside its glyph, takes a
              // wider box (RAIL_SPLIT_CONTROL_W) — the same exception the top
              // bar's Select split button takes.
              const footerBtn = (disabled = false) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: `${RAIL_CONTROL}px`,
                height: `${RAIL_CONTROL}px`,
                padding: 0,
                background: 'transparent',
                border: 'none',
                borderRadius: '4px',
                color: 'var(--text-3)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.35 : 1
              });
              // Editable zoom % — Walkthru-style: plain "100%" by default,
              // click swaps to an input (it only mounts while editing so the
              // resting layout stays a single centered value). The handlers
              // clamp to 1-4000, the PDF engine's actual zoom range.
              const zoomValue = isEditingRailZoom ? (
                <input
                  ref={api.zoomInputRef}
                  type="text"
                  autoFocus
                  value={api.zoomInputValue}
                  onChange={api.handleZoomInputChange}
                  onKeyDown={(e) => {
                    api.handleZoomInputKeyDown(e);
                    if (e.key === 'Enter' || e.key === 'Escape') setIsEditingRailZoom(false);
                  }}
                  onBlur={(e) => {
                    api.handleZoomInputBlur(e);
                    setIsEditingRailZoom(false);
                  }}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label="Zoom percentage"
                  style={{ width: '36px', background: 'transparent', color: 'var(--text-3)', border: 'none', padding: 0, margin: 0, fontSize: '10px', fontFamily: FONT_FAMILY, fontWeight: '500', fontVariantNumeric: 'tabular-nums', textAlign: 'center', outline: 'none', lineHeight: 1 }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingRailZoom(true)}
                  onDoubleClick={() => setIsEditingRailZoom(true)}
                  aria-label="Edit zoom percentage"
                  {...chromeTip('Zoom level — click to type a percentage', 'left')}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: '10px', fontFamily: FONT_FAMILY, fontWeight: '500', fontVariantNumeric: 'tabular-nums', padding: '1px 4px', borderRadius: '3px', cursor: 'pointer', lineHeight: 1, textAlign: 'center' }}
                >
                  <RailLiveZoomText
                    fallback={api.zoomInputValue || Math.round((api.manualZoomScale || 1) * 100)}
                    viewerId={getLiveZoomViewerId(activeTabId)}
                  />
                </button>
              );
              // Editable current page — plain accent-colored number by
              // default (Walkthru style), click or double-click to jump.
              const pageValue = isEditingRailPage ? (
                <input
                  ref={api.pageInputRef}
                  type="text"
                  data-page-number-input
                  autoFocus
                  value={api.pageInputValue}
                  onChange={api.handlePageInputChange}
                  onKeyDown={(e) => {
                    api.handlePageInputKeyDown(e);
                    if (e.key === 'Enter' || e.key === 'Escape') setIsEditingRailPage(false);
                  }}
                  onBlur={(e) => {
                    api.handlePageInputBlur(e);
                    setIsEditingRailPage(false);
                  }}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label="Current page"
                  style={{ width: '28px', padding: 0, background: 'transparent', color: 'var(--accent)', border: 'none', fontSize: '11px', fontFamily: FONT_FAMILY, fontWeight: '600', fontVariantNumeric: 'tabular-nums', textAlign: 'center', outline: 'none', lineHeight: 1 }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingRailPage(true)}
                  onDoubleClick={() => setIsEditingRailPage(true)}
                  aria-label="Edit page number"
                  {...chromeTip('Page — click to jump', 'left')}
                  style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '11px', fontFamily: FONT_FAMILY, fontWeight: '600', fontVariantNumeric: 'tabular-nums', padding: '1px 4px', borderRadius: '3px', cursor: 'pointer', lineHeight: 1 }}
                >
                  {api.pageNum}
                </button>
              );
              // Fit-mode popup — one list for both variants; only the anchor
              // changes (LEFTWARD over the PDF when collapsed, UPWARD above
              // the footer when expanded). Outside-click close comes from
              // zoomMenuRef on the wrapper (PDFViewer's zoom-menu machinery).
              // UX 2026-09-17 (desktop sweep): this menu is the same kind of
              // thing as the line-style popover and the Select split menu, so it
              // takes their numbers. It was the outlier of the three: 28px rows
              // (pad 6px 8px) against their 34, a literal 16px glyph against
              // --rail-control-glyph 14, and a 2px radius against
              // --chrome-radius 6 — it met neither token.
              const fitMenu = (anchorStyle) => (
                <div style={{ position: 'absolute', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--chrome-radius)', boxShadow: '0 10px 24px rgba(0,0,0,0.45)', minWidth: '140px', zIndex: 6000, padding: '2px', ...anchorStyle }}>
                  {ZOOM_MODE_OPTIONS.map((option) => {
                    if (option.id === ZOOM_MODES.MANUAL) return null;
                    const isActive = option.id === api.zoomMode;
                    return (
                      <button
                        key={option.id}
                        onClick={() => api.handleZoomModeSelect(option.id)}
                        data-active={isActive}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '6px', minHeight: 'var(--chrome-menu-row-h)', padding: '4px 9px', background: 'transparent', border: 'none', borderRadius: '4px', textAlign: 'left', cursor: 'pointer', color: isActive ? 'var(--text-2)' : 'var(--text-3)', fontSize: '11px', fontFamily: FONT_FAMILY }}
                      >
                        {renderFitIcon(option.id, RAIL_CONTROL_GLYPH)}
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              );

              if (rightRailCollapsed) {
                // Collapsed 48px rail — vertical stack. position:relative +
                // zIndex 2 keeps it above (and clickable over) the collapsed
                // survey overlay, which is absolute at the rail's full
                // height with zIndex 1; transparent background lets the
                // host/panel color (#12151c) show through.
                return (
                  <div style={{ position: 'relative', zIndex: 2, width: '100%', borderTop: '1px solid var(--border)', padding: '8px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: 'transparent' }}>
                    <button
                      onClick={api.zoomIn}
                      {...chromeTip('Zoom in', 'left')}
                      aria-label="Zoom in"
                      style={footerBtn()}
                    >
                      <Icon name="plus" size={RAIL_CONTROL_GLYPH} />
                    </button>
                    {zoomValue}
                    <button
                      onClick={api.zoomOut}
                      {...chromeTip('Zoom out', 'left')}
                      aria-label="Zoom out"
                      style={footerBtn()}
                    >
                      <Icon name="minus" size={RAIL_CONTROL_GLYPH} />
                    </button>

                    <div style={{ width: '24px', height: '1px', background: 'var(--surface-3)', margin: '4px 0' }} />

                    {/* Page nav — chevron up/down because vertical layout. */}
                    <span {...chromeTip('Previous page', 'left')} style={{ display: 'inline-flex' }}>
                      <button
                        onClick={api.goToPreviousPage}
                        disabled={atFirstPage}
                        aria-label="Previous page"
                        style={{ ...footerBtn(atFirstPage), pointerEvents: atFirstPage ? 'none' : 'auto' }}
                      >
                        <Icon name="chevronUp" size={RAIL_CONTROL_GLYPH} />
                      </button>
                    </span>
                    {pageValue}
                    {/* Middle dot between current page above and total below
                        — the Walkthru slim-rail convention. */}
                    <span aria-hidden="true" style={{ color: 'var(--text-3)', fontSize: '14px', lineHeight: 0.5, fontFamily: FONT_FAMILY }}>·</span>
                    <span style={{ color: 'var(--text-3)', fontSize: '10px', fontFamily: FONT_FAMILY, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                      {api.numPages}
                    </span>
                    <span {...chromeTip('Next page', 'left')} style={{ display: 'inline-flex' }}>
                      <button
                        onClick={api.goToNextPage}
                        disabled={atLastPage}
                        aria-label="Next page"
                        style={{ ...footerBtn(atLastPage), pointerEvents: atLastPage ? 'none' : 'auto' }}
                      >
                        <Icon name="chevronDown" size={RAIL_CONTROL_GLYPH} />
                      </button>
                    </span>

                    <div style={{ width: '24px', height: '1px', background: 'var(--surface-3)', margin: '4px 0' }} />

                    {/* Page-fit — Walkthru slim-rail pattern: current mode's
                        icon centered in a 36×28 cell with a small LEFT
                        chevron pinned to the left edge signalling the popup
                        flies out LEFTWARD over the PDF. */}
                    <div ref={api.zoomMenuRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <button
                        onClick={api.toggleZoomMenu}
                        aria-haspopup="listbox"
                        aria-expanded={api.isZoomMenuOpen}
                        aria-label="Fit options"
                        data-active={fitMode !== ZOOM_MODES.MANUAL}
                        {...chromeTip(`Page fit: ${api.zoomDropdownLabel}`, 'left')}
                        style={{ ...footerBtn(), position: 'relative', width: `${RAIL_SPLIT_CONTROL_W}px`, borderRadius: '2px', color: fitMode !== ZOOM_MODES.MANUAL ? 'var(--text-2)' : 'var(--text-3)' }}
                      >
                        {/* UX 2026-09-16 (desktop sweep): the shared <Icon>, not a
                            hand-written <svg>. This caret was drawn inline at
                            stroke 1.8 in a 12px box — 3.6 units on the house 24
                            grid, 140% over the house 1.5 — so it was the heaviest
                            mark in the rail, sitting between Zoom out and the page
                            steppers. It still points LEFT: the popup flies out
                            leftward over the PDF, and the direction is the thing
                            this caret says. RAIL_CARET (10) is the dropdown caret
                            size, deliberately smaller than the glyph beside it —
                            see the CARETS note in styles.css. */}
                        <Icon
                          name="chevronLeft"
                          size={RAIL_CARET}
                          color="currentColor"
                          style={{ position: 'absolute', left: '2px', top: '50%', transform: 'translateY(-50%)' }}
                        />
                        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {renderFitIcon(fitIconMode, RAIL_CONTROL_GLYPH)}
                        </span>
                      </button>
                      {api.isZoomMenuOpen && fitMenu({ right: '100%', bottom: 0, marginRight: '6px' })}
                    </div>
                  </div>
                );
              }

              // Expanded 320px survey panel — horizontal row pinned to the
              // panel bottom: [ − % + ] | [ ‹ n · N › ] | [ Fit ▴ ]. The
              // host column stays 48px wide; this overlay reaches leftward
              // exactly like the panel itself does.
              return (
                <div style={{ position: 'absolute', right: 0, bottom: 0, width: '320px', boxSizing: 'border-box', zIndex: 2, background: 'var(--surface-1)', borderTop: '1px solid var(--border)', padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <button
                    onClick={api.zoomOut}
                    {...chromeTip('Zoom out', 'above')}
                    aria-label="Zoom out"
                    style={footerBtn()}
                  >
                    <Icon name="minus" size={RAIL_CONTROL_GLYPH} />
                  </button>
                  {zoomValue}
                  <button
                    onClick={api.zoomIn}
                    {...chromeTip('Zoom in', 'above')}
                    aria-label="Zoom in"
                    style={footerBtn()}
                  >
                    <Icon name="plus" size={RAIL_CONTROL_GLYPH} />
                  </button>

                  <div style={{ width: '1px', height: '20px', background: 'var(--surface-3)' }} />

                  {/* Page nav — left/right chevrons because horizontal row. */}
                  <span {...chromeTip('Previous page', 'above')} style={{ display: 'inline-flex' }}>
                    <button
                      onClick={api.goToPreviousPage}
                      disabled={atFirstPage}
                      aria-label="Previous page"
                      style={{ ...footerBtn(atFirstPage), pointerEvents: atFirstPage ? 'none' : 'auto' }}
                    >
                      <Icon name="chevronLeft" size={RAIL_CONTROL_GLYPH} />
                    </button>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', fontFamily: FONT_FAMILY, fontVariantNumeric: 'tabular-nums' }}>
                    {pageValue}
                    <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>·</span>
                    <span style={{ color: 'var(--text-3)' }}>{api.numPages}</span>
                  </span>
                  <span {...chromeTip('Next page', 'above')} style={{ display: 'inline-flex' }}>
                    <button
                      onClick={api.goToNextPage}
                      disabled={atLastPage}
                      aria-label="Next page"
                      style={{ ...footerBtn(atLastPage), pointerEvents: atLastPage ? 'none' : 'auto' }}
                    >
                      <Icon name="chevronRight" size={RAIL_CONTROL_GLYPH} />
                    </button>
                  </span>

                  <div style={{ width: '1px', height: '20px', background: 'var(--surface-3)' }} />

                  {/* Page-fit trigger — icon + current-mode label + chevron
                      pointing UP because the popup opens upward here. */}
                  <div ref={api.zoomMenuRef} style={{ position: 'relative' }}>
                    <button
                      onClick={api.toggleZoomMenu}
                      aria-haspopup="listbox"
                      aria-expanded={api.isZoomMenuOpen}
                      aria-label="Fit options"
                      data-active={fitMode !== ZOOM_MODES.MANUAL}
                      {...chromeTip(`Page fit: ${api.zoomDropdownLabel}`, 'above')}
                      style={{ ...footerBtn(), width: 'auto', height: `${RAIL_CONTROL}px`, gap: '6px', padding: '0 8px', color: fitMode !== ZOOM_MODES.MANUAL ? 'var(--text-2)' : 'var(--text-3)', fontSize: '11px', fontFamily: FONT_FAMILY }}
                    >
                      {renderFitIcon(fitIconMode, RAIL_CONTROL_GLYPH)}
                      <span>{api.zoomDropdownLabel}</span>
                      {/* UX 2026-09-16 (desktop sweep): the shared <Icon>, not a
                          hand-written <svg>. This caret was drawn inline at stroke
                          1.8 in an 11px box — 3.6 units on the house 24 grid, 140%
                          over the house 1.5 — so it read heavier than every glyph
                          beside it in the same footer. It keeps flipping with the
                          menu: the popup opens upward here, so the resting state
                          points up and the open state points down. */}
                      <Icon
                        name={api.isZoomMenuOpen ? 'chevronDown' : 'chevronUp'}
                        size={RAIL_CARET}
                        color="currentColor"
                      />
                    </button>
                    {api.isZoomMenuOpen && fitMenu({ right: 0, bottom: '100%', marginBottom: '6px' })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        {isMobileViewer && !mobileViewerPanelOpen && (
          <MobilePdfViewerDock
            onOpenPanel={openMobileDocumentPanel}
            onToggleHub={toggleMobileDocumentHub}
            onOpenSurvey={openMobileSurveyPanel}
            hubMode={['pages', 'search', 'bookmarks'].includes(mobileDocumentPanelState.activePanel) ? mobileDocumentPanelState.activePanel : 'pages'}
            hubOpen={mobileDocumentPanelState.isOpen && ['pages', 'search', 'bookmarks'].includes(mobileDocumentPanelState.activePanel)}
            spacesActive={Boolean(leftRailApi?.activeSpaceId) || (mobileDocumentPanelState.isOpen && mobileDocumentPanelState.activePanel === 'spaces')}
            surveyActive={Boolean(rightRailApi?.showSurveyPanel)}
          />
        )}
        {/* UX 2026-05-14: chrome-bottom-host deleted. Every tool that lived
            here moved up to chrome-top-host so the rails can extend to the
            viewport bottom. PDFViewer still publishes bottomToolbarApi so
            the top-bar tools consume the same state and handlers. */}
      </div>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onDismiss={!authPromptDismissed ? handleDismiss : null}
      />

      {/* UX 2026-05-13: KeyboardShortcutsOverlay only renders on the home tab.
          On the PDF viewer it was covering the zoom / page-fit controls in the
          bottom-right after the status bar was removed. The '?' modal still
          works on the home tab; on the viewer the screen stays clean. */}
      {!isViewerVisible && <KeyboardShortcutsOverlay />}
    </TooltipContext.Provider>
  );
}
