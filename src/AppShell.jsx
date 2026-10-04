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
import QuietLoading, { openingLabel } from './components/QuietLoading';
import ToastHost from './components/ToastHost';
import AnnotationSizeControl, { ANNOTATION_SIZE_PRESETS } from './components/AnnotationSizeControl';
import AnnotationDropdown from './components/AnnotationDropdown';
import { QuickColourDots, QuickPaintSwatch } from './components/QuickStyleControls';
import BodyPortal from './components/BodyPortal.js';
import AnchoredPopover from './components/AnchoredPopover';
import ToolbarOverflowMenu from './components/ToolbarOverflowMenu';
import useResponsiveToolbar from './hooks/useResponsiveToolbar.js';
import useLoadoutTransition, { useDropInRow, useLeavingRow, useRowCrossfade } from './hooks/useLoadoutTransition.js';
import { PHONE_LAYOUT_MAX_WIDTH, placeUnderOpenerAvoiding, slotDefinition, TEXT_ROW_CAPTION_ROOM, TEXT_ROW_PARTS, textRowLook, TIGHT_SPACING } from './utils/responsiveToolbar.js';
import { recentPressedControl, registerLightPopover } from './components/dismissRules.js';
import { COUNTER_SIZE_MAX, COUNTER_SIZE_MIN, ANNOTATION_WIDTH_DECIMALS } from './utils/annotationSize';
import SurveySpacesRail from './SurveySpacesRail';
import ActiveSpaceChip from './sidebar/ActiveSpaceChip';
import TabBar from './TabBar';
import {
  MobilePdfViewerDock,
  MobilePdfViewerHeader,
  MobilePdfViewerToolRail,
} from './mobile/MobilePdfViewerChrome';
import { createKeyboardViewportController } from './mobile/keyboardViewport';
import YDocProvider from './components/collab/YDocProvider.jsx';
import { ARROWHEAD_MENU_ORDER, ARROWHEAD_SHORT_LABELS } from './components/Callout/types';
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
import { getSelectFamilyLabel, getSelectModeIconName, isSelectFamilyTool, isSelectModeActive, SELECT_MODE_OPTIONS } from './utils/selectModes.js';
import { computeTextMarkupPickerPosition } from './utils/pdfTextMarkup.js';
import { getLiveZoomViewerId, isLiveZoomEventForViewer, LIVE_ZOOM_EVENT } from './utils/liveZoomEvents.js';
import { useAuth } from './contexts/AuthContext';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMSGraph } from './contexts/MSGraphContext';
import { useOptionalAuth } from './components/OptionalAuthPrompt';
import { useStorage, useTemplates } from './hooks/useDatabase';
import { composeTextColor, splitTextColor } from './utils/textColorOpacity';

import { CHROME_GLYPH, FONT_FAMILY, RAIL_CARET, RAIL_CONTROL, RAIL_CONTROL_GLYPH, RAIL_SPLIT_CONTROL_W, REVIEW_TOOL_IDS, ZOOM_MODE_OPTIONS, appDebug, coerceScrollMode, ensureRgbaOpacity, getWindowTrackpadInteractionDebugSavePayload, hexToRgba, writeSaveLogExtraFiles } from './viewerShared';
// Owner 2026-09-22: undo/redo draw at 14 (the phone's HISTORY_GLYPH) - see MobilePdfViewerChrome.
const HISTORY_GLYPH = 14;
import { TooltipContext, makeTooltipBinding } from './components/Tooltip';
import { useViewerTopOverlayRef } from './utils/viewerTopOverlay.js';
import DismissBarrier from './components/DismissBarrier.jsx';
import { sanitizeZoomInput } from './utils/pageNavigationMath.js';
import { showsColourRule, showsPaintSwatch, showsQuickColourDots } from './utils/toolbarColourGroup.js';
import { isAreaEditing, REGION_TOOLBAR_OPENING_STATE, resolveToolBarGroup, showsFormatRow } from './utils/toolbarRows.js';

// The dot between the current page and the page total in the right-rail
// footer: a drawn 2px circle in the total's grey (see the rail audit note at
// its use — a font glyph's metrics put it off-centre). The half-pixel drop
// matches the digits' ink, which the browser snaps ~0.5-1px below their box
// centre: measured at 2x, the ink gap is 9.5px above the dot and 10px below.
const RAIL_PAGE_DOT_STYLE = Object.freeze({
  display: 'block',
  width: '2px',
  height: '2px',
  borderRadius: '50%',
  background: 'var(--text-3)',
  flexShrink: 0,
  transform: 'translateY(0.5px)',
});

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

// Owner 2026-10-02 (footer lock: "these numbers need to be able to add digits
// and decrease digits without shifting anything around"): every number in the
// rail footer sits in a box as wide as its widest real value, so a value
// gaining or losing a digit never moves the buttons beside it. The widest
// value is laid down invisibly in the same grid cell as the real one - the box
// is then exactly that wide in whatever font the platform draws, with
// tabular figures so every digit is the same width. The value is centred in
// it. An edit field passed as `field` fills the same box, so opening it does
// not move anything either.
// Desktop zoom tops out at 4000% (PdfjsViewerContainer MAX_SCALE 40).
const FOOTER_ZOOM_WIDEST = '4000%';
function FooterSlot({ widest, field = null, children = null }) {
  return (
    <span data-footer-slot style={{ position: 'relative', display: 'inline-grid', flexShrink: 0, alignSelf: 'stretch', alignItems: 'center', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
      {[].concat(widest).map((text) => (
        <span key={text} aria-hidden="true" style={{ gridArea: '1 / 1', visibility: 'hidden' }}>{text}</span>
      ))}
      {field || <span style={{ gridArea: '1 / 1', justifySelf: 'center' }}>{children}</span>}
    </span>
  );
}
const footerSlotFieldStyle = { position: 'absolute', inset: 0, width: '100%', boxSizing: 'border-box' };

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
    // `meta` is the picker's drag phase (CompactColorPicker, UX 2026-09-23):
    // { phase: 'preview' } while a slider is dragged, { phase: 'commit' } on
    // release, undefined for a click or key press. One picker change is up to
    // three writes below, and a drag must land as ONE undo step, so every
    // write but the LAST is sent as 'settle' (saved and remembered as the
    // tool's setting, but no undo step) and only the last one carries the
    // commit — which records the whole drag, from the value it started on, in
    // one step.
    apply: (hex, alpha, meta) => {
      const leading = meta?.phase === 'commit' ? { phase: 'settle' } : meta;
      if (isTextMarkupPalette && bottomToolbarApi.handleTextMarkupPaintChange) {
        bottomToolbarApi.handleTextMarkupPaintChange(hex, Math.round(alpha * 100), meta);
        return;
      }
      if (useFill) {
        const otherAlpha = (bottomToolbarApi.strokeOpacity ?? 100) / 100;
        if (shapeOneVisibleRule && alpha <= 0 && otherAlpha <= 0) {
          bottomToolbarApi.handleStrokeOpacityChange(100, leading);
        }
        bottomToolbarApi.handleFillColorChange(hex, leading);
        bottomToolbarApi.handleFillOpacityChange(Math.round(alpha * 100), meta);
      } else {
        const otherAlpha = (bottomToolbarApi.fillOpacity ?? 100) / 100;
        if (shapeOneVisibleRule && alpha <= 0 && otherAlpha <= 0) {
          bottomToolbarApi.handleFillOpacityChange(100, leading);
        }
        bottomToolbarApi.handleStrokeColorChange(hex, leading);
        bottomToolbarApi.handleStrokeOpacityChange(Math.round(alpha * 100), meta);
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

/**
 * PASS 7 (board 12): the ONE source the text-formatting bar reads and writes.
 *
 * The bar has two jobs, and they are the same job: while a text box is open for
 * editing it formats THAT text, and while the text box or callout tool is merely
 * armed it formats the text the NEXT one will carry. Both are a `{ state, api }`
 * pair with the same field names, so the bar is written once and neither case is
 * a special case.
 *
 * UX 2026-09-23: with ONE text box or callout selected (context tool 'text' /
 * 'callout' too), PDFViewer publishes that object's own text style in
 * `textStyleDefaults` and writes the change back to it, so the bar formats the
 * selection, never the next box (utils/selectedTextFormatting.js).
 *
 * Returns null when neither applies, which is every other tool.
 */
const resolveTextFormatting = (api) => {
  if (!api) return null;
  // A live editor already publishes exactly this shape (PDFViewer's rich-text
  // bridge), and it wins: what is on screen is what the user is looking at.
  if (api.richTextEditor) return api.richTextEditor;
  const armed = api.contextTool === 'text' || api.contextTool === 'callout';
  if (!armed || typeof api.onTextStyleDefaultsChange !== 'function') return null;
  const defaults = api.textStyleDefaults;
  if (!defaults) return null;
  // `meta` is the colour picker's drag phase; PDFViewer uses it when the
  // source is a SELECTED text box or callout (one undo step per drag). The
  // third argument is ONLY what this control changed: a picked mark is
  // patched with that alone, so this render's (possibly stale) other fields
  // never overwrite a collaborator's newer size / bold / font.
  const patch = (fields, meta) => api.onTextStyleDefaultsChange({ ...defaults, ...fields }, meta, fields);
  const toggle = (key) => () => patch({ [key]: !defaults[key] });
  return {
    state: defaults,
    api: {
      setFontColor: (hex, meta) => patch({ fontColor: hex }, meta),
      setFontFamily: (family) => patch({ fontFamily: family }),
      setFontSize: (size) => patch({ fontSize: size }),
      toggleBold: toggle('bold'),
      toggleItalic: toggle('italic'),
      toggleUnderline: toggle('underline'),
      toggleStrike: toggle('strike'),
      setTextAlign: (value) => patch({ textAlign: value }),
      setVerticalAlign: (value) => patch({ verticalAlign: value }),
    },
  };
};

/*
 * PASS 7 (boards 9-12 + 15): the four LINE STYLES and the drawing each one
 * shows. The drawing is the same glyph in the pill and in the menu row, at two
 * sizes, so what the row promises is what the pill reports back.
 */
/* Owner Test 41 (2026-10-04): a folded alignment pill shows its group's
   current choice, so the bar still says how the text is aligned. */
const TEXT_ALIGN_GLYPH = Object.freeze({ left: 'alignLeft', center: 'alignCenter', right: 'alignRight' });
const TEXT_VALIGN_GLYPH = Object.freeze({ top: 'alignTop', middle: 'alignMiddle', bottom: 'alignBottom' });
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
/* The words come from the shared ARROWHEAD_SHORT_LABELS, which the phone's arrow
   sheet reads too, so the same head is never "Solid" on one screen and
   "Solid Triangle" on the other. Only the drawing is the bar's own. */
const ARROWHEAD_MENU_ICONS = Object.freeze({
  none: 'arrowheadNone',
  solidTriangle: 'arrowheadSolid',
  vShape: 'arrowheadOpen',
  openCircle: 'arrowheadCircle',
  square: 'arrowheadSquare',
  horizontalLine: 'arrowheadBar',
});

const ARROWHEAD_MENU_OPTIONS = Object.freeze(ARROWHEAD_MENU_ORDER.map((value) => Object.freeze({
  value,
  label: ARROWHEAD_SHORT_LABELS[value],
  icon: ARROWHEAD_MENU_ICONS[value],
})));

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
  // `arrowEndsNone` is the set's own minus: the same 2 -> 22 rule the other two
  // ends draw, which is what board 16 shows and what "all the same length" means.
  Object.freeze({ value: 'none', label: 'None', icon: 'arrowEndsNone' }),
]);

/*
 * PASS 7 (2026-09-22, owner ruling): a text mark's BLEND — the one setting the
 * highlight tools carry beyond colour and it was the last native <select> left
 * in the desktop chrome: a grey 62x28 browser widget sitting among 20px pills,
 * reading "Layered / Uniform", which are the file-format words, not the user's.
 *
 *   See-through ('layered') — every mark keeps its own paint, so two that cross
 *                             deepen where they overlap. Stays an editable
 *                             native PDF highlight.
 *   Solid       ('uniform')  — one strength across the whole mark, crossing or
 *                             not. Exports as a flat mask so other PDF readers
 *                             match Survey.
 *
 * The sample on the left of the pill says the same thing without words: two
 * overlapping translucent squares for See-through, one opaque square for Solid.
 * Drawn here rather than in the icon set because it is a STATE glyph made of
 * the swatch shapes the chrome already uses, like the chosen-state check in
 * QuickStyleControls — the shared icon set is one stroke weight and cannot show
 * a fill at two opacities.
 */
const BLEND_SAMPLE_SEE_THROUGH = (size) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <rect x="1.5" y="3.5" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.45" />
    <rect x="6.5" y="3.5" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.45" />
  </svg>
);

const BLEND_SAMPLE_SOLID = (size) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <rect x="1.5" y="3.5" width="13" height="8" rx="1.5" fill="currentColor" opacity="0.9" />
  </svg>
);

const BLEND_MODE_OPTIONS = Object.freeze([
  Object.freeze({ value: 'layered', label: 'See-through' }),
  Object.freeze({ value: 'uniform', label: 'Solid' }),
]);

const BLEND_MODE_SAMPLES = Object.freeze({
  layered: BLEND_SAMPLE_SEE_THROUGH,
  uniform: BLEND_SAMPLE_SOLID,
});

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
      ? window.matchMedia(`(max-width: ${PHONE_LAYOUT_MAX_WIDTH}px)`).matches
      : false
  ));
  // Owner Test 41 (2026-10-04): the desktop rows now give ground step by step
  // and fit every width above this switch (down to 554px with no side panel),
  // so there is no width where the rails cover a control. The switch stays at
  // 720px with the viewer's own touch surface (PdfjsViewerContainer) and the
  // stylesheets' 720px phone rules; see PHONE_LAYOUT_MAX_WIDTH.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(`(max-width: ${PHONE_LAYOUT_MAX_WIDTH}px)`);
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
  // UX 2026-09-23 (owner: right rail audit): a click OUTSIDE the rail's page
  // or zoom field (e.g. on the PDF) leaves the field and commits what you
  // typed — the house "first click out of a field only dismisses the field"
  // rule (DismissBarrier). The PDF canvas swallows mousedown focus changes,
  // so the field used to stay open, still holding your typed page, until you
  // clicked some other chrome. Escape is left to the field itself (cancel).
  // Dismiss rules (2026-09-23, src/components/dismissRules.js): this is R3 —
  // a TYPING barrier, so it ends the typing on the first outside press and is
  // never mistaken for an open popover by the bare-page guard (R2).
  const railFieldRefs = useMemo(
    () => [bottomToolbarApi?.pageInputRef, bottomToolbarApi?.zoomInputRef].filter(Boolean),
    [bottomToolbarApi?.pageInputRef, bottomToolbarApi?.zoomInputRef]
  );
  const dismissRailFields = useCallback(() => {
    setIsEditingRailPage(false);
    setIsEditingRailZoom(false);
  }, []);
  // Same rule for the Fit menu: PDFViewer closes it on a document mousedown,
  // which never fires over the PDF (the canvas cancels pointerdown, and with
  // it the mousedown), so a click on the page left the menu open.
  const railFitMenuRefs = useMemo(
    () => [bottomToolbarApi?.zoomMenuRef].filter(Boolean),
    [bottomToolbarApi?.zoomMenuRef]
  );
  const dismissRailFitMenu = useCallback(() => {
    if (bottomToolbarApi?.isZoomMenuOpen) bottomToolbarApi.toggleZoomMenu?.();
  }, [bottomToolbarApi]);

  // PASS 7 (board 14, owner ruling 2026-09-22): the Select tool has NO caret and
  // NO selection-mode pop-up on either platform. Clicking Select arms the family
  // and the three modes are picked in the Box / Lasso / Text segmented toggle the
  // bar shows beside it, so the anchor state, the outside-click watcher and the
  // Escape handler this button used to need are all gone with the menu.

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
  // A pressed B / I / U / S or alignment toggle (see the text format row): the
  // phone's filled segment, a --surface-3 plate under --text-1 ink. The plate
  // is a background IMAGE because states.css section 5 wipes every chrome
  // glyph button's background-COLOR on hover and press (!important), which
  // would flash the plate away under the pointer.
  const textToggleStyle = (on) => (on
    ? { color: 'var(--text-1)', backgroundImage: 'linear-gradient(var(--surface-3), var(--surface-3))' }
    : { color: 'var(--text-2)' });

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
  // PASS 7 (2026-09-22): the text-mark BLEND pill — the last native <select> in
  // the desktop chrome, now the same dropdown every other setting uses.
  const showBlendMenu = openAnnotationDropdown === 'blend';
  const setShowBlendMenu = useCallback((next) => setDropdownOpen('blend', next), [setDropdownOpen]);
  // 2026-05-25: Color picker active tab for shapes (rectangle / ellipse).
  // 'fill' swaps the picker to read/write fillColor; 'border' swaps to strokeColor.
  // UX 2026-09-17: it opens on 'border', not 'fill', because that is the channel
  // the four quick dots beside it act on (see resolveAnnotationPaint). It used
  // to open on Fill while the dots set the border, so two neighbouring controls
  // showed two different colours of the same shape — and on a fresh rectangle
  // the tab showed white at 0% opacity, i.e. nothing at all.
  const [colorPickerTab, setColorPickerTab] = useState('border');
  const annotationColorPickerRef = useRef(null);
  // w42 (2026-09-26): the controls the two desktop colour pickers open UNDER —
  // the rainbow "custom colour" disc of the quick colours, or the combined
  // swatch of a two-colour tool. Looked up when the picker is placed, so a
  // re-rendered swatch keeps its picker.
  const fontColorGroupRef = useRef(null);
  // The shape/stroke picker can be opened from the tool bar's colours or from
  // a paint button on the text-selection bar below it, so the control whose
  // press opened it is remembered for as long as it stays open (the same
  // "opener" the dismiss rules use to make a second press a toggle).
  const colourPickerOpenerRef = useRef(null);
  const getAnnotationColourAnchor = useCallback(() => {
    if (!colourPickerOpenerRef.current?.isConnected) {
      const pressed = recentPressedControl();
      colourPickerOpenerRef.current = pressed?.closest?.('#chrome-top-host, #chrome-sub-toolbar-host') ? pressed : null;
    }
    if (colourPickerOpenerRef.current?.isConnected) return colourPickerOpenerRef.current;
    // w44: the colours live in the formatting row (row 2) now.
    const bar = document.querySelector('[data-chrome-format-row]') || document.getElementById('chrome-top-host');
    return bar?.querySelector('[data-quick-colour-custom], [data-quick-paint-swatch]')
      || bar?.querySelector('[data-quick-colours]')
      || bar?.querySelector('[data-chrome-settings-holder]')
      || null;
  }, []);
  useEffect(() => {
    if (!bottomToolbarApi?.showAnnotationColorPicker) colourPickerOpenerRef.current = null;
  }, [bottomToolbarApi?.showAnnotationColorPicker]);
  // The text-mark palette's measured size, for placing it under its opener.
  const [textMarkupPickerSize, setTextMarkupPickerSize] = useState(null);
  const textMarkupPaletteOpen = !!bottomToolbarApi?.showAnnotationColorPicker
    && ['text-markup', 'text-select'].includes(bottomToolbarApi?.contextTool);
  useLayoutEffect(() => {
    const node = annotationColorPickerRef.current;
    if (!textMarkupPaletteOpen || !node) return undefined;
    const measure = () => setTextMarkupPickerSize((current) => (
      current && current.width === node.offsetWidth && current.height === node.offsetHeight
        ? current
        : { width: node.offsetWidth, height: node.offsetHeight }
    ));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [textMarkupPaletteOpen]);
  const getFontColourAnchor = useCallback(() => (
    fontColorGroupRef.current?.querySelector('[data-quick-colour-custom]')
      || fontColorGroupRef.current
      || null
  ), []);
  // The one resolved paint the colour controls in the tool-properties row all
  // read and write: the quick colour dots, the swatch's ring, and the picker
  // itself. See resolveAnnotationPaint above.
  const annotationPaint = resolveAnnotationPaint(bottomToolbarApi, colorPickerTab);
  // PASS 7 (board 12): the THIRD BAR is shown while the text box or callout tool
  // is merely ARMED, not only once a text box is open for editing. Board 12 is
  // the text-box tool's board and it draws three bars; the formatting a mark is
  // about to be created with is as worth seeing as the formatting it already has,
  // and the user used to have to draw a box and double-click into it to find out
  // what font the next one would use.
  const [showTextFormatBar, setShowTextFormatBar] = useState(true);
  const textFormatSource = resolveTextFormatting(bottomToolbarApi);
  // UX 2026-09-23 (owner: text colour opacity everywhere text colour is
  // picked). The text colour carries its own opacity (utils/textColorOpacity):
  // the picker edits both, and a quick dot changes the colour but keeps the
  // opacity, the way a highlight's dots keep its strength.
  const textColorParts = splitTextColor(textFormatSource?.state?.fontColor || '#1e293b');
  // The bar is the live editor's whenever there is one; armed, it is the tool's
  // defaults and the "Aa" button decides whether it is on screen.
  // w43 (2026-09-26, owner report): the "Aa" button is the ONLY switch for
  // this bar, in every state - armed, selected AND while a box is open for
  // typing. It used to be forced on during an edit (the Aa went gold and
  // inert), and clicking it then closed the editor instead. Now the bar shows
  // exactly when the user last asked for it; the editor keeps the caret.
  const showTextFormatting = !!textFormatSource && showTextFormatBar;
  // PASS 7: the cluster's own chosen mark is the shared one now — a preset disc
  // rings in its OWN colour, and when the colour is not one of the three the
  // rainbow disc wears the mark instead (QuickColourDots works that out for
  // itself from the value it is given). The combined swatch carries no mark at
  // all, because boards 9, 11 and 12 draw none on it: it IS the current colour.
  // The old `quickColourOnSwatch` flag, which put the mark on the legacy swatch,
  // went with that swatch.
  // UX 2026-09-17: and it goes back to that channel's tab whenever the armed
  // tool changes which channel the dots act on — Counter takes the fill (a
  // pin's colour IS its fill), every other tool takes the border. Only that
  // switch resets it: a user who reaches for the Fill tab on a rectangle keeps
  // Fill while they stay on shapes.
  // Owner 2026-10-02 (Test 16): the picker always OPENS on its left tab —
  // Fill for a shape — because people read left to right. The quick dots
  // still act on quick.tab (the border); only the opening tab changed.
  const quickPaintTab = annotationPaint?.isShape ? 'fill' : annotationPaint?.quick?.tab;
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

  // Dismiss rules R1–R6 (owner 2026-09-23; src/components/dismissRules.js,
  // docs/DISMISS-RULES.md). The handler above is R1 already: it closes the
  // formatting popovers and never consumes, so the same press opens the other
  // dropdown, switches tool or selects the annotation. Registering the open
  // layer adds R2 (a press on the bare page only closes it — no stray stroke)
  // and R5 (Escape closes the topmost popover only: the series context menu
  // before its series menu).
  const formattingPopoverOpen = !!openAnnotationDropdown
    || showFontColorPicker
    || !!counterSeriesContextMenu
    || !!bottomToolbarApi?.showAnnotationColorPicker;
  useEffect(() => {
    if (!formattingPopoverOpen) return undefined;
    return registerLightPopover({
      contains: (target) => Boolean(target?.closest?.('[data-annotation-size-control], [data-annotation-size-popover], .annotation-dropdown, [data-annotation-dropdown-popover], [data-counter-series-menu], [data-counter-series-context-menu], [data-annotation-color-trigger], [data-annotation-color-picker], [data-font-color-picker], [data-style-menu], [data-arrowhead-menu], [data-arrow-ends-menu], [data-font-family-menu], [data-font-size-menu]')),
      close: (_event, reason) => {
        if (reason === 'escape' && counterSeriesContextMenu) {
          setCounterSeriesContextMenu(null);
          counterSeriesContextTriggerRef.current?.focus?.();
          return;
        }
        setOpenAnnotationDropdown(null);
        setShowFontColorPicker(false);
        setCounterSeriesContextMenu(null);
        bottomToolbarApi?.setShowAnnotationColorPicker?.(false);
      },
    });
  }, [bottomToolbarApi?.setShowAnnotationColorPicker, counterSeriesContextMenu, formattingPopoverOpen]);

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
    // A real hex grey: a CSS variable cannot be read by hexToRgba, the page's
    // marker fill or the Excel export (survey audit 2026-10-01).
    { id: `entity-${Date.now()}-5`, name: 'Removed', color: '#959eae' }
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

    // Clear the opening flag after a short delay to allow the tab to be created
    // This ensures that if the same PDF is clicked again, it will find the existing tab
    setTimeout(() => {
      openingPdfsRef.current.delete(pdfKey);
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

  // w42 (2026-09-26, owner report from an 840px split view): the desktop tool
  // bar adapts to narrow windows instead of letting its settings run into
  // Export. Order and reasons: src/utils/responsiveToolbar.js. At 1200px and up
  // (so every normal window) the plan is the bar exactly as it always was.
  // RULED 2026-09-26 owner: flip rows (w44) — the tool bar holds the tool
  // groups and the chosen group's tools; the settings moved down to the
  // formatting row (row 2), which the same hook plans. See utils/toolbarRows.js.
  const topToolbarHostRef = useRef(null);
  // Row 2 (formatting) and row 3 (text formatting) are fixed slots at the top
  // of the sub-toolbar host, in that order, so the rows always stack the same
  // way whatever else drops into the host. Kept in state so the portals that
  // fill them render as soon as the slots exist.
  const formatRowRef = useRef(null);
  const [formatRowEl, setFormatRowEl] = useState(null);
  const [textFormatRowEl, setTextFormatRowEl] = useState(null);
  const attachFormatRow = useCallback((element) => {
    formatRowRef.current = element;
    setFormatRowEl(element);
  }, []);
  // The settings this render put in More, for the hook to weigh bringing back.
  const toolbarOverflowSlotsRef = useRef([]);
  const toolbarPlan = useResponsiveToolbar({
    hostRef: topToolbarHostRef,
    formatRowRef,
    enabled: Boolean(isViewerVisible && !isMobileViewer && bottomToolbarApi),
    overflowSlotsRef: toolbarOverflowSlotsRef,
  });
  // Which group's tools the tool bar shows right of the group icons, and
  // whether the formatting row is on screen (utils/toolbarRows.js).
  const toolBarGroup = bottomToolbarApi
    ? resolveToolBarGroup({ ...bottomToolbarApi, contextTool: bottomToolbarApi.toolBarContextTool ?? bottomToolbarApi.contextTool })
    : null;
  const formatRowShown = !isMobileViewer && !!isViewerVisible && showsFormatRow(bottomToolbarApi);
  // RULED 2026-09-26 owner: fixed centred groups + animated loadouts (w47).
  // The loadout (the tools right of the group icons) and row 2's settings
  // crossfade when their set of controls changes, and row 2 fades out when it
  // goes (it stays drawn, data-leaving, for its 140ms fade).
  // Desktop only; instant with prefers-reduced-motion. See
  // utils/loadoutTransition.js for the motion and why.
  // RULED 2026-09-27 owner: morphing icons + one motion language (w49). The
  // crossfade is now: a tool icon in a slot both sets share MORPHS into the
  // new one in place (pen → rectangle → text box), other shared slots stay,
  // extra slots grow in / shrink out from their centres, and nothing slides
  // sideways but a row gliding to its new centre — 200ms ease-in-out for all.
  // (RULED 2026-09-28: row 2 now crossfades as a whole instead — below.)
  const [loadoutSlotEl, setLoadoutSlotEl] = useState(null);
  const [loadoutGhostLayerEl, setLoadoutGhostLayerEl] = useState(null);
  const [formatHolderEl, setFormatHolderEl] = useState(null);
  const [formatGhostLayerEl, setFormatGhostLayerEl] = useState(null);
  const chromeMotion = Boolean(isViewerVisible && !isMobileViewer);
  useLoadoutTransition(loadoutSlotEl, loadoutGhostLayerEl, chromeMotion);
  // RULED 2026-09-28 owner: one motion for row 2 (in-place crossfade), row 3
  // drops down. Row 2 no longer shares the tool bar's morph / grow / shrink:
  // when its set of controls changes the WHOLE row crossfades in place (old
  // out ~90ms, new in ~140ms at its final centred spot, no sideways
  // motion); an unchanged set never animates. See useRowCrossfade.
  // RULED 2026-09-28 owner: row 2 downward swap (w51): the swap is now one
  // downward flow — old row sinks and fades, new row comes down into place a
  // beat later (~185ms), clipped to row 2's band. Same hook, same rule.
  useRowCrossfade(formatHolderEl, formatGhostLayerEl, chromeMotion);
  // Row 2 leaves the way it arrives (useLeavingRow): it stays drawn while it
  // fades, never blinks on a one-render gap, and runs back if wanted again.
  const { leaving: formatRowLeaving, fading: formatRowFading } = useLeavingRow(formatRowEl, formatRowShown, chromeMotion);
  // RULED 2026-09-27 owner: rows 2/3 centred (w48). Rows 2 and 3 are centred
  // under the group icons and never move while their controls are unchanged.
  // RULED 2026-09-28 owner: one motion for row 2 (in-place crossfade), row 3
  // drops down — w48's re-centre GLIDE is gone: a row whose controls change
  // is simply drawn at its new centre (row 2 crossfades there).
  const [textBarEl, setTextBarEl] = useState(null);
  // RULED 2026-09-26 owner: select modes in top bar (w46). With Select armed
  // and nothing picked, Select's Box / Lasso / Text modes sit in the TOOL BAR
  // right of the group icons, where a group's tools go (as pen / highlighter /
  // eraser do for Draw) — and so they do for a picked mark that belongs to no
  // drawing group (a text highlight, or marks of several kinds picked
  // together). Row 2 carries only settings that apply (the text-mark colours
  // in Text mode, a picked mark's settings) and is hidden when none do; it lies
  // over the page, so the page does not move as it comes and goes.
  // RULED 2026-09-27 owner: rows 2/3 centred, animated (w48, was w47's fixed
  // spot under the icons). Row 3 (the Aa bar) is centred under the group icons
  // like row 2 (planTextRow via useResponsiveToolbar), keeping room for the
  // "Text" caption that hangs off its left. Until it has been measured it
  // starts at that caption room.
  // RULED 2026-09-28 owner: row 3 drops down — it appears by coming down from
  // under row 2 (~150ms) and leaves back up (~110ms), never covering row 2 or
  // moving anything; it no longer glides sideways (useDropInRow).
  const textFormatRowLeft = toolbarPlan.textRowLeft
    ?? ((toolbarPlan.formatUsableLeft ?? 0) + 10 + TEXT_ROW_CAPTION_ROOM);
  // Owner Test 41 (2026-10-04): how far row 3 has given ground in a narrow row
  // (tighter gutters, folded alignment / style groups, a shorter font pill).
  const textRowLookNow = textRowLook(toolbarPlan.textRowStep || 'full');
  // A row-3 toggle group, or — folded — one compact pill showing `glyph`
  // whose card holds the very same toggle buttons (same look, same
  // keep-the-caret mousedown). A pick in a one-of-three group (alignment)
  // closes the card; B / I / U / S stay open so several can be set at once.
  // `buttons` false (no vertical alignment for callout text) draws nothing.
  const renderTextRowFold = (folded, menuKey, label, glyph, glyphSize, closeOnPick, buttons) => {
    if (!buttons) return null;
    if (!folded) return buttons;
    return (
      <AnnotationDropdown
        open={openAnnotationDropdown === menuKey}
        onOpenChange={(next) => setDropdownOpen(menuKey, next)}
        label={label}
        preview={<Icon name={glyph} size={glyphSize} color="currentColor" />}
        compact
        contentWidth="0px"
        dataMarker="data-text-row-fold"
        preserveFocus
        // A toggle hands focus back to the text being edited; that must not
        // count as leaving the card (a press anywhere else still closes it —
        // the formatting popovers' shared mousedown handler).
        outsideBoundarySelector="[contenteditable], [data-rich-text-toolbar]"
      >
        <div
          role="toolbar"
          aria-label={label}
          style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          onClick={closeOnPick ? () => setDropdownOpen(menuKey, false) : undefined}
        >
          {buttons}
        </div>
      </AnnotationDropdown>
    );
  };
  useDropInRow(textBarEl, textFormatRowEl, chromeMotion);
  const selectArmed = !!bottomToolbarApi && isSelectFamilyTool(bottomToolbarApi.activeTool);
  const selectModesInToolBar = selectArmed && toolBarGroup === 'select';
  // Owner 2026-10-01 (Spaces toolbar): "it shouldn't be in a floating toolbar
  // ... make it into a sub-toolbar option." While a Space's areas are being
  // edited the tool bar is in AREAS mode: the area shapes and the Add /
  // Subtract mode stand where a group's tools go (the loadout, so they morph
  // in like any group switch), the app's own Select picks areas (one Select,
  // V as always), Pan and zoom stay, and row 2 holds the actions (Delete area,
  // Full page, Cancel, Done). The drawing groups wait, dimmed, until Done or
  // Cancel. RegionSelectionTool publishes the state; PDFViewer forwards it.
  // The tool publishes its state a render after the viewer enters the mode;
  // until then the bar draws the tool's opening state (Rectangle, Add), so
  // the Areas tools take over in the same frame as the mode and morph in as
  // one change instead of the old set leaving first.
  const regionApi = !isMobileViewer && isAreaEditing(bottomToolbarApi)
    ? (bottomToolbarApi.regionToolbarApi || REGION_TOOLBAR_OPENING_STATE)
    : null;
  const areasMode = Boolean(regionApi);
  const areasPanArmed = areasMode && bottomToolbarApi?.activeTool === 'pan';
  // A group left open from before (Draw's row) must not draw its tools beside
  // the Areas tools.
  useEffect(() => {
    if (areasMode && bottomToolbarApi?.activeCategoryDropdown) {
      bottomToolbarApi.setActiveCategoryDropdown?.(null);
    }
  }, [areasMode, bottomToolbarApi]);
  // A popover whose opener sits in row 2 closes when the row goes away (Pan,
  // Survey Marker placement, closing the document): its anchor has no box left
  // to open under. Desktop only — the phone draws its own pickers.
  useEffect(() => {
    if (isMobileViewer || formatRowShown) return;
    setOpenAnnotationDropdown(null);
    setShowFontColorPicker(false);
    if (bottomToolbarApi?.showAnnotationColorPicker) bottomToolbarApi.setShowAnnotationColorPicker?.(false);
  }, [formatRowShown, isMobileViewer, bottomToolbarApi]);
  // 2026-10-01: the dock stays usable under an open sheet, so a dock button can
  // now be pressed while the Active users sheet (the tool rail's own state) is
  // up. Opening another panel asks the rail to slide that sheet away, keeping
  // one phone sheet at a time.
  const [mobileAuxCloseRequestKey, setMobileAuxCloseRequestKey] = useState(0);

  const openMobileDocumentPanel = useCallback((panelId) => {
    setMobileSurveyCollapseRequestKey((key) => key + 1);
    setMobileAuxCloseRequestKey((key) => key + 1);
    leftRailApi?.ref?.current?.togglePanel?.(panelId);
  }, [leftRailApi]);

  const toggleMobileDocumentHub = useCallback(() => {
    const activePanel = ['pages', 'search', 'bookmarks'].includes(mobileDocumentPanelState.activePanel)
      ? mobileDocumentPanelState.activePanel
      : 'pages';
    openMobileDocumentPanel(activePanel);
  }, [mobileDocumentPanelState.activePanel, openMobileDocumentPanel]);

  const openMobileSurveyPanel = useCallback(() => {
    // Opening Survey over an open Pages / Spaces sheet: that sheet holds still
    // until Survey takes its place (a dock switch keeps the sheet standing and
    // fades the content, see useMobileSheetMotion PANEL TO PANEL). Survey opens
    // a render or two later, through the right rail's API.
    leftRailApi?.ref?.current?.closePanel?.(mobileSurveyPanelOpen ? undefined : { handover: true });
    setMobileAuxCloseRequestKey((key) => key + 1);
    if (mobileSurveyPanelOpen) {
      setMobileSurveyCollapseRequestKey((key) => key + 1);
      return;
    }
    setMobileSurveyRequestKey((key) => key + 1);
    if (!rightRailApi?.showSurveyPanel) {
      rightRailApi?.handleSurveyToggle?.();
    }
  }, [leftRailApi, mobileSurveyPanelOpen, rightRailApi]);

  // Spaces chunk B: the active space, named outside the Spaces panel - a chip
  // in the desktop tool bar and under the phone's top bar. Its words open the
  // Spaces panel, its x turns the space off (the panel switch's handler).
  const activeSpaceForChip = useMemo(() => {
    const id = leftRailApi?.activeSpaceId;
    if (!id) return null;
    const space = (leftRailApi?.spaces || []).find((entry) => entry?.id === id);
    if (!space) return null;
    return { id, name: space.name || 'Space', pageCount: space.assignedPages?.length || 0 };
  }, [leftRailApi?.activeSpaceId, leftRailApi?.spaces]);
  const openSpacesFromChip = useCallback(() => {
    if (isMobileViewer) {
      if (mobileDocumentPanelState.isOpen && mobileDocumentPanelState.activePanel === 'spaces') return;
      openMobileDocumentPanel('spaces');
      return;
    }
    leftRailApi?.ref?.current?.openPanel?.('spaces');
  }, [isMobileViewer, leftRailApi, mobileDocumentPanelState, openMobileDocumentPanel]);
  const turnOffSpaceFromChip = useCallback(() => {
    leftRailApi?.onExitSpaceMode?.();
  }, [leftRailApi]);

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

  // UX 2026-09-22 (owner bug): on a phone the on-screen keyboard used to push
  // the whole app shell up — header, tool rail and dock all moved — because the
  // browser reveals a focused field by scrolling the document. Drawboard PDF
  // keeps its chrome still and scrolls only the page; so do we now.
  //
  // The controller publishes --keyboard-inset on <html> and re-pins the
  // document to 0,0 on every viewport event; mobilePdfViewer.css pins body and
  // spends the inset on the PDF scroller alone. Mounted only for the phone
  // viewer, which is the only surface with page-level text editing and fixed
  // chrome; it tears itself down (clearing the var) when the viewer closes.
  useEffect(() => {
    if (!isMobileViewer) return undefined;
    const controller = createKeyboardViewportController();
    return () => controller.dispose();
  }, [isMobileViewer]);

  // The sub-toolbar host lies over the top of the PDF scroll area; registering it
  // lets the viewer add scroll room so the page can be scrolled out from under
  // every strip in it (owner 2026-09-23, src/utils/viewerTopOverlay.js).
  const subToolbarHostRef = useViewerTopOverlayRef();

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    let rafId = 0;
    const reserveFormatRowForBanner = selectArmed && !isMobileViewer;
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

      // RULED 2026-09-26 owner: select modes in top bar (w46). In Select mode
      // row 2 now comes and goes as a mark is picked and dropped (it has
      // nothing to show for Box / Lasso with nothing picked). The storage
      // banner hangs below the chrome, so it anchors as if row 2 were always
      // up while Select is armed: picking or dropping a mark never moves it.
      let bannerTop = chromeBottom;
      const formatRow = subHost?.querySelector?.('[data-chrome-format-row="true"]');
      if (reserveFormatRowForBanner && formatRow && formatRow.style.display === 'none') {
        const barH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chrome-bar-h')) || 36;
        bannerTop = chromeBottom + barH;
      }
      document.documentElement.style.setProperty('--app-banner-top', `${Math.round(bannerTop)}px`);
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
    selectArmed,
    isMobileViewer,
  ]);


  // Find the tab associated with the selected PDF to pass the correct tabId
  // This ensures that even if we are on Home tab, the PDFViewer still gets the correct tabId prop
  const pdfTab = tabs.find(t => t.file === selectedPDF && !t.isHome);
  const viewerTabId = pdfTab ? pdfTab.id : activeTabId;
  const viewerViewState = pdfTab ? pdfTab.viewState : null;

  // w42 (2026-09-26): each setting in the tool bar's settings row that may
  // collapse or move goes through toolbarSlot. `render(compact)` draws the
  // control; the plan says whether it sits in the bar (full or compact) or in
  // the More menu (always full there, on a row with its name). `canCompact` is
  // false while a pill says "Mixed" — its drawing would show one value for
  // marks that differ. The JSX below runs top to bottom, so every slot has
  // been seen by the time the More menu at the end of the row is built.
  // PASS 7 (board 14, owner ruling): SELECT's setting is the Box / Lasso / Text
  // segmented toggle — the same three modes the phone shows, on the same quiet
  // well, with the chosen word and glyph in gold. Three modes are few enough to
  // show, and showing them means the user can see which one is live without
  // opening anything.
  // RULED 2026-09-26 owner: select modes in top bar (w46). "The selection
  // tool options, like box, lasso, or text, shouldn't be in a sub-tool group.
  // Those need to be to the very right, just like every other annotation type
  // of tool, like pen, highlighter, and eraser." So they are drawn exactly as
  // a group's tools are (PDFViewer's tool-bar tools): the same 28px
  // .chrome-subcontrol buttons on the same gutter, the same glyph size, the
  // same neutral hover (styles.css [data-select-mode-toggle]) and the gold
  // glyph for the live mode (btn-active) — no segmented well, no words. The
  // full name ("Rectangle Select" …) is the tooltip and the accessible name.
  // Shown only while Select is armed with nothing picked, or with a pick no
  // drawing group makes (selectModesInToolBar).
  const renderSelectModeToggle = () => (
                  <div
                    data-select-mode-toggle="true"
                    role="group"
                    aria-label="Selection mode"
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--chrome-tool-gap)' }}
                  >
                    {SELECT_MODE_OPTIONS.map((opt) => {
                      const selected = isSelectModeActive(opt, bottomToolbarApi.selectionMode);
                      return (
                        <button
                          key={opt.mode}
                          type="button"
                          className={`btn chrome-subcontrol ${selected ? 'btn-active' : 'btn-ghost'}`}
                          aria-pressed={selected}
                          // w49: the glyph, so a group switch can morph it.
                          data-morph-icon={getSelectModeIconName(opt.mode)}
                          onClick={() => {
                            bottomToolbarApi.setSelectionMode?.(opt.mode);
                            bottomToolbarApi.setActiveTool(opt.tool);
                          }}
                          {...chromeTip(opt.label, 'below')}
                          aria-label={opt.label}
                        >
                          <Icon name={getSelectModeIconName(opt.mode)} size={CHROME_GLYPH} />
                        </button>
                      );
                    })}
                  </div>
  );

  // Areas mode (owner 2026-10-01, see regionApi above). The shapes and the
  // mode toggle are the loadout's 28px .chrome-subcontrol buttons with the
  // gold-glyph armed state, like pen / highlighter / eraser; a rule between
  // the two pairs. While Pan or Select is armed no shape is lit, but Add /
  // Subtract still say which way the next shape will go.
  const renderAreaTools = () => {
    const drawing = regionApi.toolType !== 'move' && !areasPanArmed;
    const tool = (key, label, icon, active, onClick) => (
      <button
        key={key}
        type="button"
        className={`btn chrome-subcontrol ${active ? 'btn-active' : 'btn-ghost'}`}
        aria-pressed={active}
        data-morph-icon={icon}
        data-area-tool={key}
        onClick={onClick}
        {...chromeTip(label, 'below')}
        aria-label={label}
      >
        <Icon name={icon} size={CHROME_GLYPH} />
      </button>
    );
    return (
      <div
        data-area-tools="true"
        role="group"
        aria-label="Area tools"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--chrome-tool-gap)' }}
      >
        {tool('rectangle', 'Rectangle area', 'areaRect', drawing && regionApi.toolType === 'rectangular', () => regionApi.setToolType?.('rectangular'))}
        {tool('freehand', 'Freehand area', 'areaFreehand', drawing && regionApi.toolType === 'freehand', () => regionApi.setToolType?.('freehand'))}
        <div className="chrome-divider" />
        {tool('add', 'Add to area', 'plus', regionApi.selectionMode === 'add', () => regionApi.setSelectionMode?.('add'))}
        {tool('subtract', 'Subtract from area', 'minus', regionApi.selectionMode === 'subtract', () => regionApi.setSelectionMode?.('subtract'))}
      </div>
    );
  };
  // Row 2 in Areas mode: what can be done to the areas, then how to leave -
  // Cancel neutral, Done the one gold button. Full page asks first (inline,
  // in this row) when it would replace areas already drawn.
  const renderAreaActions = () => {
    if (regionApi.fullPageConfirmPending) {
      return (
        <div data-area-actions="confirm-full-page" style={{ display: 'flex', alignItems: 'center', gap: 'var(--chrome-gap)' }}>
          <span style={{ color: 'var(--text-2)', fontSize: '12px' }}>Replace these areas with the full page?</span>
          <button type="button" className="btn btn-sm btn-default" onClick={regionApi.cancelFullPage}>Keep areas</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={regionApi.confirmFullPage}>Use full page</button>
        </div>
      );
    }
    return (
      <div data-area-actions="true" style={{ display: 'flex', alignItems: 'center', gap: 'var(--chrome-gap)' }}>
        <span style={{ color: 'var(--text-2)', fontSize: '12px', fontWeight: 600, marginRight: '4px' }}>Areas</span>
        <button
          type="button"
          className="btn btn-sm btn-default"
          disabled={!regionApi.canDelete}
          onClick={regionApi.deleteSelected}
          {...chromeTip(regionApi.canDelete ? 'Delete the picked areas' : 'Pick an area with Select to delete it', 'below')}
        >
          Delete area
        </button>
        {regionApi.canSetFullPage && (
          <button
            type="button"
            className="btn btn-sm btn-default"
            onClick={regionApi.setFullPage}
            {...chromeTip('Use the whole page as the area', 'below')}
          >
            Full page
          </button>
        )}
        <div className="chrome-divider" />
        <button type="button" className="btn btn-sm btn-default" onClick={regionApi.cancel} {...chromeTip('Leave without saving', 'below')}>
          Cancel
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={regionApi.confirm} {...chromeTip('Save the areas (Enter)', 'below')}>
          Done
        </button>
      </div>
    );
  };

  const toolbarOverflowItems = [];
  toolbarOverflowSlotsRef.current = [];
  const toolbarSlot = (id, render, { canCompact = true, label } = {}) => {
    if (toolbarPlan.overflow.includes(id)) {
      const definition = slotDefinition(id);
      toolbarOverflowSlotsRef.current.push({ id, divider: id === 'aa', canCompact });
      toolbarOverflowItems.push({
        id,
        label: definition?.selfLabelled ? null : (label || definition?.label),
        node: render(false),
      });
      return null;
    }
    const compact = canCompact && toolbarPlan.compact.includes(id);
    return (
      <div
        data-toolbar-slot={id}
        data-toolbar-compact={compact ? 'true' : 'false'}
        data-toolbar-can-compact={canCompact ? 'true' : 'false'}
        style={{ display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' }}
      >
        {render(compact)}
      </div>
    );
  };

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
            // The header layer sits above the sheets' layer, so the chip
            // would float over a tall or keyboard-lifted sheet: it steps
            // aside while any phone sheet is up (the Spaces sheet names the
            // space itself, the dock's layers button stays gold).
            activeSpace={(mobileDocumentPanelState.isOpen || mobileSurveyPanelOpen || mobileAuxPanel) ? null : activeSpaceForChip}
            onOpenSpaces={openSpacesFromChip}
            onTurnOffSpace={turnOffSpaceFromChip}
          />
        ) : (
        <div
          id="chrome-top-host"
          ref={topToolbarHostRef}
          data-toolbar-anchor={toolbarPlan.anchor}
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
              {/* Spaces chunk B: the active space, left of Export. While it
                  shows, IT carries data-toolbar-export, so the tool bar's plan
                  (useResponsiveToolbar) keeps the tools clear of the chip. */}
              {activeSpaceForChip && (
                <ActiveSpaceChip
                  data-toolbar-export="true"
                  name={activeSpaceForChip.name}
                  pageCount={activeSpaceForChip.pageCount}
                  onOpen={openSpacesFromChip}
                  onTurnOff={turnOffSpaceFromChip}
                />
              )}
              {/* Export annotated PDF — browser-visible entry point for the
                  same handler the desktop File menu drives. */}
              <button
                data-toolbar-export={activeSpaceForChip ? undefined : 'true'}
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
                // UX 2026-09-22 (owner): a plain icon button like the phone's
                // - no box, no border, glyph 14 (HISTORY_GLYPH) so the solid
                // arrowheads sit level with the 16px open-stroke tool glyphs.
                className="btn chrome-control chrome-history"
                aria-label="Undo"
                style={{
                  opacity: topToolbarApi.canUndo ? 1 : 0.4,
                  cursor: topToolbarApi.canUndo ? 'pointer' : 'not-allowed',
                  pointerEvents: topToolbarApi.canUndo ? 'auto' : 'none'
                }}
              >
                <Icon name="undo" size={HISTORY_GLYPH} />
              </button>
            </span>
            <span {...chromeTip('Redo', 'below')} style={{ display: 'inline-flex' }}>
              <button
                onClick={topToolbarApi.onRedo || (() => {})}
                disabled={!topToolbarApi.canRedo}
                // UX 2026-09-16: see Undo — shared top-bar control size + glyph.
                className="btn chrome-control chrome-history"
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
                <Icon name="redo" size={HISTORY_GLYPH} />
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
            <div
              data-tool-toolbar="true"
              style={{
                position: 'relative',
                // RULED 2026-09-26 owner: fixed centred groups + animated
                // loadouts (w47). The plan's `shift` centres THESE icons
                // (Draw / Shapes / Text) on the canvas between the rails,
                // keeping room on their right for the widest loadout and on
                // their left for Pan / Select, clear of Undo/Redo
                // (useResponsiveToolbar). It depends on the window only —
                // never on the tool, the pick, the loadout or (owner
                // 2026-10-01) an open side panel — so the icons never move as
                // you work. Negative = right of the bar centre.
                left: toolbarPlan.shift ? `${-toolbarPlan.shift}px` : undefined,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--chrome-tool-gap)',
              }}
            >
              {/* 2026-05-26: Pan + Select sit in their own absolute block to
                  the LEFT of the centered annotation cluster. This mirrors
                  the right-side tool properties block so the annotation
                  icons stay centered on the screen — only the side blocks
                  shift as their contents change.
                  RULED 2026-09-27 owner: Pan/Select beside the groups (w48,
                  undoes w47's pin at the far left). Owner: "the Pan and
                  Select are supposed to stay next to the other tool groups;
                  I was just saying to keep it on the left." They hang off
                  the icons' left edge at a fixed offset, so they never move
                  with the tool either; the plan keeps them clear of
                  Undo/Redo at narrow widths. */}
              <div data-toolbar-left-block="true" style={{
                // Narrow shells: flow inline before the annotation icons.
                ...(isNarrowShell
                  ? { position: 'static' }
                  : { position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)' }),
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--chrome-tool-gap)',
                // This row states its own gutter so the rule inside it subtracts
                // the right number (see .chrome-divider in styles.css). Without
                // this the rule sat 10px from Select and 8px from Draw.
                // 2026-09-22: the tool gutter is now the same 6px as the
                // settings row, so the two agree, but the declaration stays —
                // it is what keeps the divider's 8px inset honest if either
                // gutter ever moves again.
                '--chrome-row-gap': 'var(--chrome-tool-gap)',
                whiteSpace: 'nowrap'
              }}>
              {[
                { id: 'pan', label: 'Pan', iconName: 'pan' },
                { id: 'select', label: 'Select', iconName: 'selectGroup' }
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
                  ? (areasMode
                    ? (regionApi.toolType === 'move' && !areasPanArmed)
                    : (bottomToolbarApi.activeTool === 'select' || isTextSelect))
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
                  type="button"
                  data-tool-group="true"
                  data-select-tool={isSelect ? 'true' : undefined}
                  aria-label={label}
                  onClick={() => {
                    if (isSelect && areasMode) {
                      // Areas mode: the same Select picks and moves areas.
                      regionApi.setToolType?.('move');
                      return;
                    }
                    if (isSelect) {
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
                      cluster — CHROME_GLYPH (16) inside the 28px button.
                      2026-10-04 (owner, Test 34): Select draws its own GROUP
                      glyph, the plain rounded cursor, like Draw / Shapes / Text
                      do; the live mode shows in the Box / Lasso / Text row. */}
                  <Icon
                    name={t.iconName}
                    size={CHROME_GLYPH}
                  />
                </button>
                </div>
                );
              })}

              {/* PASS 7 (boards 8-14): the rule between two tool GROUPS. It is
                  16px tall with 8px of clear space either side, against the 6px
                  gutter between two chips inside one group — the rule plus that
                  wider air is what tells the eye where a group ends. Both
                  numbers come from the shared .chrome-divider class, so no bar
                  can write its own. */}
              <div className="chrome-divider" />
              </div>

              {/* Draw category */}
              <button
                onClick={() => {
                  /* UX 2026-09-22 (desktop critic round): a second click on the
                     LIT category button is a NO-OP — the sub-row stays open.
                     Intended UX: while one of a group's tools is armed you can
                     always see and change WHICH tool it is. The old toggle
                     closed the sub-row but left the tool armed, so you were
                     still about to draw with no row on screen to say so and no
                     way to pick a different tool — a live, invisible tool.
                     Closing the row is not how you disarm; Pan, Select or
                     Escape is. Reference behaviour matched: Drawboard PDF,
                     whose tool group keeps its sub-row for as long as one of
                     that group's tools is the armed tool. Shapes and Text below
                     carry the same guard, so all three behave alike. */
                  if (bottomToolbarApi.activeCategoryDropdown === 'draw') return;
                  bottomToolbarApi.setActiveCategoryDropdown('draw');
                  if (!['pen', 'highlighter', 'text-highlight', 'eraser'].includes(bottomToolbarApi.activeTool)) {
                    bottomToolbarApi.setActiveTool(bottomToolbarApi.lastDrawTool, { source: 'category-tab' });
                  }
                }}
                {...chromeTip('Draw', 'below')}
                className={`btn chrome-control ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'draw' || ['pen', 'highlighter', 'text-highlight', 'eraser'].includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                data-tool-group="true"
                aria-label="Draw"
                disabled={areasMode}
              >
                <Icon name="drawGroup" size={CHROME_GLYPH} />
              </button>

              {/* Shapes category */}
              <button
                onClick={() => {
                  /* UX 2026-09-22: see Draw above — a second click on the lit
                     Shapes button keeps the shape row, because closing it used
                     to leave a shape tool armed and unseeable. */
                  if (bottomToolbarApi.activeCategoryDropdown === 'shape') return;
                  bottomToolbarApi.setActiveCategoryDropdown('shape');
                  if (!['rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'counter'].includes(bottomToolbarApi.activeTool)) {
                    bottomToolbarApi.setActiveTool(bottomToolbarApi.lastShapeTool, { source: 'category-tab' });
                  }
                }}
                {...chromeTip('Shapes', 'below')}
                className={`btn chrome-control ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'shape' || ['rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'counter'].includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                data-tool-group="true"
                aria-label="Shapes"
                disabled={areasMode}
              >
                <Icon name="shapes" size={CHROME_GLYPH} />
              </button>

              {/* Text category */}
              <button
                onClick={() => {
                  /* UX 2026-09-22: see Draw above — a second click on the lit
                     Text button keeps its row, for the same reason. */
                  if (bottomToolbarApi.activeCategoryDropdown === 'review') return;
                  bottomToolbarApi.setActiveCategoryDropdown('review');
                  if (!REVIEW_TOOL_IDS.includes(bottomToolbarApi.activeTool)) {
                    bottomToolbarApi.setActiveTool(bottomToolbarApi.lastReviewTool, { source: 'category-tab' });
                  }
                }}
                {...chromeTip('Text', 'below')}
                className={`btn chrome-control ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'review' || REVIEW_TOOL_IDS.includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                data-tool-group="true"
                aria-label="Text"
                disabled={areasMode}
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

              {/* RULED 2026-09-26 owner: flip rows (w44). Right of the group
                  icons the tool bar now shows the TOOLS inside the chosen
                  group — pen / highlighter / eraser, rectangle … counter, text
                  box / callout (PDFViewer draws them into #chrome-subtools-host),
                  or Select's Box / Lasso / Text modes. In Select mode a picked
                  mark brings its own group's tools here, and pressing one arms
                  it. Like the settings that used to sit here, the block hangs
                  off the right edge of the icon cluster, so it grows to the
                  right without nudging the Pan / Select or group icons.
                  RULED 2026-09-26 owner: fixed centred groups + animated
                  loadouts (w47). This block is the LOADOUT slot: its anchor
                  (the icons' right edge) is fixed, and when the set of tools
                  in it changes the old set fades out and the new one fades in
                  with a 6px slide out of the icons (useLoadoutTransition; the
                  outgoing copy is drawn in the ghost layer just below, laid
                  over the same box, so nothing around it moves).
                  RULED 2026-09-27 owner: morphing icons + one motion language
                  (w49). No slide any more: a slot both sets share keeps its
                  place and its icon MORPHS into the new tool's (the morph is
                  drawn in the ghost layer over the live button), a slot only
                  one set has grows in / shrinks out from its centre. */}
              <div
                ref={setLoadoutSlotEl}
                data-toolbar-subtools="true"
                style={{
                  // Narrow shells: flow inline after the annotation icons.
                  ...(isNarrowShell
                    ? { position: 'static' }
                    : {
                        position: 'absolute',
                        left: '100%',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 'max-content',
                      }),
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--chrome-tool-gap)',
                  '--chrome-row-gap': 'var(--chrome-tool-gap)',
                  whiteSpace: 'nowrap'
                }}
              >
                {/* The rule between the group icons and the group's tools —
                    the same shared rule, same 8px inset, as the one on the
                    cluster's other edge. Only there when tools follow it. */}
                {((toolBarGroup && toolBarGroup !== 'select') || selectModesInToolBar || areasMode) && (
                  <div className="chrome-divider" />
                )}
                {areasMode && renderAreaTools()}
                {/* RULED 2026-09-26 owner: select modes in top bar (w46).
                    Select's Box / Lasso / Text modes stand where a group's
                    tools go — with nothing picked, or a pick no drawing group
                    makes (see selectModesInToolBar). */}
                {selectModesInToolBar && renderSelectModeToggle()}
                <div
                  id="chrome-subtools-host"
                  data-chrome-subtools-host="true"
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--chrome-tool-gap)' }}
                />
              </div>
              {/* w47: where the outgoing loadout fades out — the same box as
                  the icon cluster, so the copy (which keeps the slot's own
                  left: 100% placement) lands exactly over the old set. Never
                  takes a click. */}
              <div
                ref={setLoadoutGhostLayerEl}
                data-loadout-ghost-layer="true"
                aria-hidden="true"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              />

              {/* 2026-05-26: Tool properties (divider + color swatch + width +
                  any tool-specific extras like the arrowhead dropdown + Aa).
                  RULED 2026-09-26 owner: flip rows (w44). The armed tool's
                  settings — colours, width, line style, ends, Aa, More — moved
                  down from the tool bar into the FORMATTING ROW (row 2), where
                  a group's tools used to be. In Select mode it shows the picked
                  mark's settings (w41). They start under the Pan button at a
                  spot the window alone decides (useResponsiveToolbar), so the
                  colours never jump sideways when you switch tools, and the row
                  has its whole width for them before anything collapses or
                  moves into More.
                  RULED 2026-09-26 owner: centre rows on canvas (w45). The
                  settings are now CENTRED on the uncovered canvas span rather
                  than starting under Pan (formatLeft is worked out from the
                  row's drawn width), so another tool's row re-centres, but a
                  row whose content is unchanged never moves.
                  RULED 2026-09-26 owner: fixed centred groups + animated
                  loadouts (w47). No more re-centring: the settings START at
                  one fixed spot — level with the Draw / Shapes / Text icons'
                  left edge, slid left only as far as the widest tool's row
                  needs at this width (rowStart) — and grow rightward, so the
                  colours stay put as you switch tools. A changed set of
                  settings crossfades like the loadout above (the ghost layer
                  sits in row 2 itself), and while row 2 is leaving the live
                  settings are hidden so only the fading copy shows.
                  RULED 2026-09-27 owner: rows 2/3 centred, animated (w48).
                  Owner: "the subtool bar items are not centered." The
                  settings are CENTRED under the group icons again (w47's
                  crossfade and leave are kept); a row whose controls change
                  re-centres by GLIDING there (useRowSlide), never a snap, and
                  a row whose controls are unchanged never moves.
                  RULED 2026-09-27 owner: morphing icons + one motion language
                  (w49). A changed setting shrinks out and its replacement
                  grows in at the same spot (no sideways slide), so the only
                  sideways motion is the re-centring glide — wider rows spread
                  left, narrower ones draw right, the same for every group.
                  RULED 2026-09-28 owner: one motion for row 2 (in-place
                  crossfade), row 3 drops down. The glide and the per-setting
                  grow / shrink are gone: when the set of settings changes the
                  whole row crossfades in place, already at its new centre
                  (useRowCrossfade); an unchanged set never animates. */}
              {formatRowEl && createPortal(
              <>
              <div
                ref={setFormatHolderEl}
                data-chrome-settings-holder="true"
                style={{
                  position: 'absolute',
                  left: toolbarPlan.formatLeft ?? 10,
                  visibility: formatRowFading ? 'hidden' : undefined,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  /* max-content so the box always measures what it holds
                     (w42): an absolutely placed box would otherwise shrink to
                     the room left of the row's right edge. */
                  width: 'max-content',
                  display: 'flex',
                  alignItems: 'center',
                  // w42: stage 1 of a narrow row tightens the gutters between
                  // the settings and the space around their rules. The rules'
                  // own margins read --chrome-row-gap / --chrome-divider-inset
                  // (see .chrome-divider), so all three move together.
                  ...(toolbarPlan.tight ? {
                    '--chrome-settings-gap': `${TIGHT_SPACING.gap}px`,
                    '--chrome-row-gap': `${TIGHT_SPACING.gap}px`,
                    '--chrome-divider-inset': `${TIGHT_SPACING.inset}px`,
                  } : {}),
                  gap: 'var(--chrome-settings-gap, var(--chrome-gap))',
                  whiteSpace: 'nowrap',
                  fontSize: '13px',
                  fontFamily: FONT_FAMILY,
                  color: 'var(--text-2)',
                }}
              >
              {/* Color swatch + Width input. Color picker now flips DOWN
                  (top: 100%) since the swatch lives at the top of the
                  viewport instead of the bottom — popping up would shoot
                  off-screen.
                  2026-05-25: Pen + highlighter render the swatch as a flat
                  solid-disc circle (no fill/border ring) per the new
                  context-aware strip contract — visual reference is
                  prototype-context-toolbar.html. Other tools keep the
                  rectangle swatch until they migrate. */}
              <div data-toolbar-settings-row="true" style={{ display: 'flex', alignItems: 'center', gap: 'var(--chrome-settings-gap, var(--chrome-gap))', position: 'relative' }}>
                {areasMode && renderAreaActions()}
                {showTextFormatting && textFormatRowEl && createPortal(
                  /* 2026-05-26: the formatting controls drop into the sub-row
                     beneath the top strip (mirrors the Draw / Shape category
                     sub-rows). The inline strip's swatch, width input and Aa
                     button stay put — only these controls live down here, so the
                     user keeps the usual chrome.
                     2026-05-25: Bridge contract — state comes from the source's
                     `state` field (per-selection aware); writes route through its
                     `api`. The data-rich-text-toolbar attribute opts these
                     buttons out of the edit canvas's document-level click-outside
                     handler so clicks don't commit-and-close the editor.
                     PASS 7 (board 12): the third bar is 36px like the two above
                     it, and its controls sit on the settings gutter.
                     RULED 2026-09-27 owner: rows 2/3 centred, animated (w48):
                     centred under the group icons like row 2.
                     RULED 2026-09-28 owner: row 3 drops down — it comes down
                     from under row 2 as it appears and goes back up as it
                     leaves (useDropInRow); no sideways glide.
                     RULED 2026-09-26 owner: centre rows on canvas (w45). It is
                     CENTRED on the same span no side panel covers as rows 1
                     and 2 (w44 had it left-aligned with row 2); a bar too wide
                     for the span keeps its start and runs off the right. The
                     "Text" caption hangs off its left, so the start keeps
                     room for it. It shows while the text box or callout tool is
                     ARMED as well as while a box is open — see
                     resolveTextFormatting, which hands this one bar either the
                     live editor or the tool's own defaults. Armed, it sits UNDER
                     the Text category row, which is board 12's third bar; in
                     edit mode that category row is closed, so there are two. */
                  /* Owner Test 41 (2026-10-04): in a narrow row the bar gives
                     ground in steps (textRowLook, planned by
                     useResponsiveToolbar); the first one tightens its gutters
                     and rules the way row 2 does. */
                  <div data-rich-text-toolbar ref={setTextBarEl}
                    data-text-row-step={textRowLookNow.step}
                    data-text-row-valign={bottomToolbarApi?.textVerticalAlignSupported !== false ? 'true' : 'false'}
                    style={{
                      width: '100%', height: 'var(--chrome-bar-h)', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', borderTop: 'none', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: `${textFormatRowLeft}px`, gap: 'var(--chrome-row-gap)', zIndex: 10, boxSizing: 'border-box',
                      ...(textRowLookNow.tight ? {
                        '--chrome-row-gap': `${TIGHT_SPACING.gap}px`,
                        '--chrome-divider-inset': `${TIGHT_SPACING.inset}px`,
                      } : {}),
                    }}
                  >
                    {/* PASS 7 (board 12): the order is colour, then font and
                        size, then B / I / U / S, then the two alignments —
                        appearance, then shape, then position, each pair behind
                        its own rule. */}
                    {/* PASS 7 (board 12): the text colour is the SAME cluster the
                        drawing tools show - three preset discs and the rainbow
                        custom disc, which opens the shared picker - acting on the
                        text instead of on a stroke. The chosen disc wears a ring
                        in its own colour with a white check.

                        This bar used to show the cluster AND a separate round
                        font-colour swatch beside it: five circles, two of which
                        meant the same thing, because the cluster had no way to
                        open a picker when it was built. The custom disc is that
                        way, so the extra swatch is gone and board 12's four
                        circles are what the bar draws. */}
                    {/* 2026-09-22 (owner): bar 3's row of discs is the TEXT
                        colour, and nothing said so — the other groups all read
                        as what they are. A short muted word to its left, at the
                        chrome label size, says it without costing the bar a
                        control. */}
                    {/* MEASURED 2026-09-22: in the flow, this caption pushed the
                        whole formatting group 13.7px to the RIGHT of centre
                        while the rows above it sat dead centre — 21.4px of word
                        plus a 6px gutter, shared between the two ends. A caption
                        is not a control, so it is taken out of the flow and hung
                        off the left edge of the group it names: the bar then
                        centres the CONTROLS, which is what the eye reads and
                        what bars 1 and 2 centre. */}
                    <div ref={fontColorGroupRef} data-font-color-picker style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                      {textRowLookNow.caption && <span
                        data-text-colour-label
                        style={{
                          position: 'absolute',
                          right: '100%',
                          marginRight: 'var(--chrome-gap)',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: 'var(--text-3)',
                          font: '600 11px/1 Helvetica, Arial, sans-serif',
                          letterSpacing: '-0.01em',
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                        }}
                      >
                        Text
                      </span>}
                      {/* Owner Test 41 (2026-10-04): beside a side panel in a
                          narrow window the four discs become ONE disc in the
                          current colour, opening the same picker (whose
                          presets hold the three). */}
                      {textRowLookNow.oneColour ? (
                        <QuickPaintSwatch
                          ring={textColorParts.hex}
                          center={textColorParts.hex}
                          label="Text color"
                          onOpen={() => setShowFontColorPicker((v) => !v)}
                        />
                      ) : (
                        <QuickColourDots
                          value={textColorParts.hex}
                          onPick={(hex) => textFormatSource?.api?.setFontColor?.(composeTextColor(hex, textColorParts.opacity))}
                          onOpenPicker={() => setShowFontColorPicker((v) => !v)}
                        />
                      )}
                      {showFontColorPicker && (
                        /* UX 2026-09-16: same 140ms fade-and-slide as every
                           other popover (Drawboard's 100ms fade+grow in).
                           w42 (2026-09-26): drawn in the top layer under the
                           rainbow disc that opened it and kept inside the
                           window (AnchoredPopover), so the rails can never
                           cover it. Out there it is no longer inside the text
                           bar's element, so it carries the bar's two markers
                           itself: a press in it still counts as a press on the
                           text bar (the editor stays open) and inside this
                           picker. */
                        <AnchoredPopover getAnchor={getFontColourAnchor}>
                        <div
                          className="survey-surface-in"
                          data-font-color-picker="true"
                          data-rich-text-toolbar="true"
                          style={{
                          position: 'absolute',
                          top: '100%',
                          left: '50%',
                          marginTop: '10px',
                          transform: 'translate(-50%, 0)',
                          zIndex: 2000,
                        }}>
                          <Suspense fallback={null}>
                            <CompactColorPicker
                              color={textColorParts.hex}
                              opacity={textColorParts.opacity}
                              /* 5% floor: below it text stops reading at all
                                 (the same floor a highlight keeps). */
                              minOpacity={0.05}
                              marginRight="0"
                              onChange={(hex, alpha, meta) => {
                                // The Transparent cell hands 0; text is never
                                // made invisible, so it keeps its opacity.
                                // `meta` (drag phase) rides along so a slider
                                // drag is one undo step on the text it edits.
                                const nextAlpha = alpha > 0 ? alpha : textColorParts.opacity;
                                textFormatSource?.api?.setFontColor?.(composeTextColor(hex, nextAlpha), meta);
                              }}
                              onClose={() => setShowFontColorPicker(false)}
                              firstPreset="none"
                            />
                          </Suspense>
                        </div>
                        </AnchoredPopover>
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
                      const currentFamily = textFormatSource?.state?.fontFamily || 'Arial';
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
                          onSelect={(family) => textFormatSource?.api?.setFontFamily?.(family)}
                          /* Board 12: 104px — the widest font name the list
                             offers ("Times New Roman") has to fit without the
                             pill resizing as the user changes font. Owner
                             Test 41: a narrow row shortens it (a long name
                             ends in "..."); the list keeps its full width. */
                          width={textRowLookNow.shortFont ? `${TEXT_ROW_PARTS.shortFont}px` : 'var(--chrome-field-w-font)'}
                          className={textRowLookNow.shortFont ? 'text-row-font--short' : ''}
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
                      const currentSize = textFormatSource?.state?.fontSize ?? 16;
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
                          onSelect={(size) => textFormatSource?.api?.setFontSize?.(size)}
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
                    {/* Bold / Italic / Underline / Strikethrough toggles. Owner
                        Test 41 (2026-10-04): in a narrow row each group below
                        can fold into ONE pill whose card holds the very same
                        toggles (renderTextRowFold; the order they fold in is
                        TEXT_ROW_STEPS). */}
                    {renderTextRowFold(textRowLookNow.foldStyle, 'text-style', 'Text style', 'formatBold', 13, false, [
                      ['formatBold', 'bold', 'toggleBold', 'Bold'],
                      ['formatItalic', 'italic', 'toggleItalic', 'Italic'],
                      ['formatUnderline', 'underline', 'toggleUnderline', 'Underline'],
                      ['formatStrikethrough', 'strike', 'toggleStrike', 'Strikethrough'],
                    ].map(([iconName, stateKey, apiKey, title]) => {
                      const isOn = !!textFormatSource?.state?.[stateKey];
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
                          onClick={() => textFormatSource?.api?.[apiKey]?.()}
                          className="chrome-text-toggle"
                          // PASS 7 (board 12): 22x20 with a 13px glyph, on no
                          // fill at rest. Owner 2026-10-02 (phone/desktop
                          // consistency): a pressed toggle is the phone's
                          // filled segment - a --surface-3 plate and --text-1
                          // ink - not a gold glyph; these are settings, not
                          // the active tool.
                          style={textToggleStyle(isOn)}
                          {...chromeTip(title, 'below')}
                          aria-label={title}
                          aria-pressed={isOn}
                        >
                          <Icon name={iconName} size={13} />
                        </button>
                      );
                    }))}
                    {/* PASS 7 (board 12, owner ruling): alignment is SIX
                        buttons in two groups — left / centre / right, then top /
                        middle / bottom — behind their own rules. It used to be
                        one 3x3 dot grid behind a dropdown, which meant the bar
                        never showed how the text was aligned and setting one
                        axis meant re-picking the other. Both axes are now
                        visible and independent. */}
                    <div className="chrome-divider" />
                    {renderTextRowFold(textRowLookNow.foldAlign, 'text-align', 'Text alignment', TEXT_ALIGN_GLYPH[textFormatSource?.state?.textAlign] || 'alignLeft', 14, true, [
                      ['alignLeft', 'left', 'Align left'],
                      /* US spelling, app-wide ruling (owner 2026-09-22): the UI
                         says "Color" and "center", never the British form. */
                      ['alignCenter', 'center', 'Align center'],
                      ['alignRight', 'right', 'Align right'],
                    ].map(([iconName, value, title]) => {
                      const on = (textFormatSource?.state?.textAlign || 'left') === value;
                      return (
                        <button
                          key={value}
                          className="chrome-text-toggle"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onClick={() => textFormatSource?.api?.setTextAlign?.(value)}
                          style={textToggleStyle(on)}
                          {...chromeTip(title, 'below')}
                          aria-label={title}
                          aria-pressed={on}
                        >
                          <Icon name={iconName} size={14} color="currentColor" />
                        </button>
                      );
                    }))}
                    {/* Review 2026-09-23: hidden for callout text, which is
                        always vertically centred (PDFViewer
                        textVerticalAlignSupported). */}
                    {bottomToolbarApi?.textVerticalAlignSupported !== false && <div className="chrome-divider" />}
                    {renderTextRowFold(textRowLookNow.foldVertical, 'text-valign', 'Vertical alignment', TEXT_VALIGN_GLYPH[textFormatSource?.state?.verticalAlign] || 'alignTop', 14, true, bottomToolbarApi?.textVerticalAlignSupported !== false && [
                      ['alignTop', 'top', 'Align to the top'],
                      ['alignMiddle', 'middle', 'Align to the middle'],
                      ['alignBottom', 'bottom', 'Align to the bottom'],
                    ].map(([iconName, value, title]) => {
                      const on = (textFormatSource?.state?.verticalAlign || 'top') === value;
                      return (
                        <button
                          key={value}
                          className="chrome-text-toggle"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onClick={() => textFormatSource?.api?.setVerticalAlign?.(value)}
                          style={textToggleStyle(on)}
                          {...chromeTip(title, 'below')}
                          aria-label={title}
                          aria-pressed={on}
                        >
                          <Icon name={iconName} size={14} color="currentColor" />
                        </button>
                      );
                    }))}
                  </div>,
                  textFormatRowEl
                )}
                <>
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
                {/* PASS 7 (boards 8-12, owner rulings) — THE COLOUR CLUSTER.
                    Both controls in here are the shared ones the phone strip
                    shows (src/components/QuickStyleControls.jsx), at the same
                    size, so "my red" is the same button on both screens.

                    A SINGLE-COLOUR tool (pen, highlighter, line, arrow, a text
                    mark) gets the three preset discs and the rainbow custom
                    disc. Pressing a preset applies straight away — to the armed
                    tool and to a selected mark — through the very same paint the
                    picker writes, so a disc and the picker can never mean
                    different things. The rainbow disc is the way out to
                    everything else (hex, opacity, the full grid, the spectrum).

                    A MULTI-COLOUR tool (rectangle, ellipse, polygon, text box,
                    callout, counter) gets ONE combined swatch instead: the fill
                    in the centre with the border as a 2px ring, or the counter's
                    own pin with its number. Two colours cannot be told apart by
                    three discs, so the discs would have had to lie about one of
                    them; pressing the swatch opens the picker on the channel the
                    swatch is showing, where the Border and Fill tabs say which
                    is which.

                    WHAT WENT: the legacy "Color" swatch that used to stand to
                    the right of the discs — a big flat filled circle with its
                    own .ctx-color-swatch styling and its own chosen-state ring.
                    On a single-colour tool it was a fourth circle repeating what
                    the three discs already showed; on a multi-colour tool it was
                    the combined swatch drawn by hand, upside down (the disc was
                    the border and the ring was the fill). Boards 8-12 draw
                    neither. */}
                {showsQuickColourDots(bottomToolbarApi) && annotationPaint && (
                  <QuickColourDots
                    // w41: picked marks in different colours ring no dot.
                    value={bottomToolbarApi.selectionMixed?.strokeColor ? null : annotationPaint.quick.color}
                    customActive={bottomToolbarApi.selectionMixed?.strokeColor ? false : undefined}
                    onPick={(hex) => annotationPaint.quick.apply(hex, annotationPaint.quick.opacity)}
                    onOpenPicker={() => {
                      setColorPickerTab(annotationPaint.isShape ? 'fill' : annotationPaint.quick.tab);
                      bottomToolbarApi.setShowAnnotationColorPicker(!bottomToolbarApi.showAnnotationColorPicker);
                    }}
                  />
                )}
                {showsPaintSwatch(bottomToolbarApi) && annotationPaint && (() => {
                  const isCounter = bottomToolbarApi.contextTool === 'counter';
                  /* The swatch previews the paint the next mark will carry, or
                     the selected mark's own paint when one is picked — the same
                     two sources every other preview in the bar reads, with the
                     same per-tool fallbacks the hand-drawn swatches used.
                     A counter rings in its PIN colour and centres its NUMBER
                     colour; every other shape rings in its BORDER and centres
                     its FILL. */
                  const pinColour = bottomToolbarApi.selectedFillColor ?? ensureRgbaOpacity(bottomToolbarApi.fillColor || '#ef4444', (bottomToolbarApi.fillOpacity ?? 100) / 100);
                  const numberColour = bottomToolbarApi.selectedStrokeColor ?? ensureRgbaOpacity(bottomToolbarApi.strokeColor || '#ffffff', (bottomToolbarApi.strokeOpacity ?? 100) / 100);
                  const borderColour = bottomToolbarApi.selectedStrokeColor ?? ensureRgbaOpacity(bottomToolbarApi.strokeColor || '#000000', (bottomToolbarApi.strokeOpacity ?? 100) / 100);
                  const fillColour = bottomToolbarApi.selectedFillColor ?? ensureRgbaOpacity(bottomToolbarApi.fillColor || '#ffffff', (bottomToolbarApi.fillOpacity ?? 100) / 100);
                  return (
                    /* data-annotation-color-trigger: the shared dismiss boundary
                       (the capture-phase effect above) has to count a press on a
                       colour control as INSIDE the picker, or the press that
                       should close the popover would close and reopen it. */
                    <span
                      data-annotation-color-trigger
                      style={{ display: 'inline-flex', alignItems: 'center' }}
                    >
                      <QuickPaintSwatch
                        variant={isCounter ? 'counter' : 'shape'}
                        ring={isCounter ? pinColour : borderColour}
                        center={isCounter ? numberColour : fillColour}
                        onOpen={() => {
                          setColorPickerTab(annotationPaint.isShape ? 'fill' : annotationPaint.quick.tab);
                          bottomToolbarApi.setShowAnnotationColorPicker(!bottomToolbarApi.showAnnotationColorPicker);
                        }}
                      />
                    </span>
                  );
                })()}

                {/* PASS 7 (boards 8-12): the rule between the COLOUR group and
                    the value pills. The bar reads colour | rule | numbers, so a
                    glance separates "what it looks like" from "how big it is". */}
                {/* w43: the rule stands whenever EITHER colour control shows
                    (see showsColourRule), so it never comes and goes as a text
                    box opens and closes for typing. */}
                {showsColourRule(bottomToolbarApi, !!annotationPaint) && <div className="chrome-divider" />}

                {!bottomToolbarApi.richTextEditor
                  && bottomToolbarApi.contextTool === 'counter'
                  && bottomToolbarApi.onNewCounterSeries
                  && (() => {
                    const seriesList = Array.isArray(bottomToolbarApi.counterSeriesList)
                      ? bottomToolbarApi.counterSeriesList
                      : [];
                    const activeSeries = seriesList.find((s) => s.seriesId === bottomToolbarApi.activeCounterSeriesId);
                    /* PASS 7 (boards 11 + 15, owner ruling): the pill NAMES THE
                       COUNT it is on — "Count 1" — the way the width pill says
                       "2 pt". It used to fall back to the words "Counter
                       series", which is the control's job description, not its
                       value: 76px of text in a 51px slot, so it arrived chopped
                       on a fresh document, which is exactly when a user is most
                       likely to look at it.
                       A count only enters counterSeriesList once it has a pin,
                       so before the first pin (and right after "New") there is
                       no entry to read. The next count's number is the one the
                       next pin will carry: one past however many exist. */
                    const seriesLabel = activeSeries?.label || `Count ${seriesList.length + 1}`;
                    return toolbarSlot('series', () => (
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
                              aria-label="New count"
                            >
                              {/* PASS 7 (owner ruling, 2026-09-22): the series
                                  menu is WORDS ONLY, and that includes this
                                  row. It read "New count" beside a plus glyph —
                                  a drawing and two words under three rows that
                                  are one word and a number. "New" is what it
                                  does; the full phrase stays the accessible
                                  name for a screen reader. */}
                              New
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
                              borderRadius: 'var(--radius-md)',
                              boxShadow: 'var(--shadow-popover)',
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
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                              onFocus={(e) => { e.currentTarget.style.boxShadow = 'inset 0 0 0 2px var(--focus)'; }}
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
                                color: 'var(--danger-text)',
                                textAlign: 'left',
                                cursor: 'pointer',
                                font: 'inherit',
                                fontSize: '12px',
                                outline: 'none',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--danger-soft)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                              onFocus={(e) => { e.currentTarget.style.boxShadow = 'inset 0 0 0 2px var(--focus)'; }}
                              onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
                            >
                              Delete
                            </button>
                          </div>
                        ), document.body)}
                      </AnnotationDropdown>
                    ), { canCompact: false });
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
                  // w42 (2026-09-26): the palette opens under the control that
                  // opened it (the tool bar's colours, or a paint button on the
                  // text-selection bar) like every other popover, unless there
                  // it would cover the selected text — then it keeps its own
                  // placement clear of the selection, as before.
                  const textMarkupOpener = isTextMarkupPalette ? getAnnotationColourAnchor() : null;
                  const textMarkupUnderOpener = textMarkupOpener
                    ? placeUnderOpenerAvoiding({
                        anchorRect: textMarkupOpener.getBoundingClientRect(),
                        popoverWidth: textMarkupPickerSize?.width || 210,
                        popoverHeight: textMarkupPickerSize?.height || 258,
                        viewportWidth: window.innerWidth,
                        viewportHeight: window.innerHeight,
                        avoidRect: bottomToolbarApi.textMarkupSelectionRect,
                      })
                    : null;
                  const textMarkupPickerPosition = isTextMarkupPalette
                    ? (textMarkupUnderOpener || computeTextMarkupPickerPosition(bottomToolbarApi.textMarkupSelectionRect, {
                        viewportWidth: window.innerWidth,
                        viewportHeight: window.innerHeight,
                        hostBottom: textMarkupPaletteHostRect?.bottom || 35,
                      }))
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
                      {/* PASS 7 (board 19): the Border / Fill tabs are the
                          PICKER'S OWN now — a 26px segment in a 3px well at the
                          top of the 276px panel, the same tablist the phone sheet
                          shows (boards 17 and 18). This bar used to draw them
                          itself, as a 260px strip glued above the panel with a
                          gold underline under the chosen word: two tab designs
                          for one control, on two screens, and the only one the
                          boards draw is the picker's. */}
                      <Suspense fallback={null}>
                        <CompactColorPicker
                          color={currentColor}
                          opacity={currentOpacity}
                          outsideBoundaryRef={annotationColorPickerRef}
                          /* Owner 2026-09-23: Fill first, then Border, the
                             order the Templates entity picker uses, everywhere
                             in the app. A counter's two channels are its pin
                             and the number printed on it, so the second word is
                             "Number" there. */
                          tabs={isShape ? {
                            items: [
                              { id: 'fill', label: 'Fill' },
                              { id: 'border', label: secondTabLabel },
                            ],
                            active: colorPickerTab,
                            onSelect: (id) => setColorPickerTab(id),
                          } : null}
                          onChange={applyChange}
                          onClose={() => bottomToolbarApi.setShowAnnotationColorPicker(false)}
                          firstPreset={(shapeOneVisibleRule && !onFillTab)
                            ? { kind: 'match', color: bottomToolbarApi.fillColor || '#ffffff', opacity: (bottomToolbarApi.fillOpacity ?? 100) / 100 }
                            : 'transparent'}
                        />
                      </Suspense>
                    </div>
                  );
                  // w42 (2026-09-26, owner report): the tool bar's picker opens
                  // UNDER the swatch or rainbow disc that opened it, slides
                  // only as far as it must to stay inside the window, and sits
                  // in the top layer above both rails. It used to hang from the
                  // middle of the whole settings row, inside the bar's own
                  // layer — off to the right of the swatch, and under the
                  // right rail on a narrow window.
                  return isTextMarkupPalette
                    ? <BodyPortal>{picker}</BodyPortal>
                    : <AnchoredPopover getAnchor={getAnnotationColourAnchor}>{picker}</AnchoredPopover>;
                })()}
                {/* PASS 7 (2026-09-22, owner ruling): BLEND. This was a bare
                    native <select> — a grey 62x28 browser widget wearing the
                    file-format words "Layered / Uniform" in a row of 20px
                    pills, and the only control in the desktop chrome that did
                    not look like the chrome. It is the shared setting pill now,
                    with the sample-then-word layout every other pill has, and
                    it says what the two modes DO: See-through marks deepen
                    where they cross, a Solid mark is one strength throughout.
                    Its accessible name stays "Blend"; the long explanation of
                    what each mode means for the exported PDF moved onto the
                    rows' own titles, where it is read at the moment of choosing
                    rather than hovered at rest. */}
                {['text-markup', 'text-select'].includes(bottomToolbarApi.contextTool) && bottomToolbarApi.setTextMarkupOverlapMode && (() => {
                  const blendValue = bottomToolbarApi.textMarkupOverlapMode === 'uniform' ? 'uniform' : 'layered';
                  return toolbarSlot('blend', (compact) => (
                    <AnnotationDropdown
                      compact={compact}
                      open={showBlendMenu}
                      onOpenChange={setShowBlendMenu}
                      label="Blend"
                      value={blendValue}
                      options={BLEND_MODE_OPTIONS}
                      onSelect={(next) => bottomToolbarApi.setTextMarkupOverlapMode(next)}
                      dataMarker="data-blend-menu"
                      preview={BLEND_MODE_SAMPLES[blendValue](14)}
                      renderOption={(option) => (
                        <>
                          <span className="annotation-dropdown__sample" aria-hidden="true">
                            {BLEND_MODE_SAMPLES[option.value](16)}
                          </span>
                          <span>{option.label}</span>
                        </>
                      )}
                      width="var(--chrome-field-w-blend)"
                      contentWidth="var(--chrome-field-w-blend)"
                    />
                  ));
                })()}
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
                  || bottomToolbarApi.activeTool === 'eraser')
                  // w41: hidden when the picked mark(s) have no width that can
                  // change (a partly erased or imported pen stroke).
                  && (bottomToolbarApi.activeTool === 'eraser'
                    || bottomToolbarApi.selectionCapabilities?.width !== false) && toolbarSlot('width', (compact) => (
                <AnnotationSizeControl
                  compact={compact}
                  mixed={bottomToolbarApi.activeTool !== 'eraser' && !!bottomToolbarApi.selectionMixed?.width}
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
                ), {
                  canCompact: !(bottomToolbarApi.activeTool !== 'eraser' && bottomToolbarApi.selectionMixed?.width),
                  label: bottomToolbarApi.contextTool === 'counter' || bottomToolbarApi.activeTool === 'eraser' ? 'Size' : 'Width',
                })}
                {bottomToolbarApi.contextTool === 'counter'
                  && bottomToolbarApi.selectedCounterSeriesId
                  && bottomToolbarApi.onSelectedCounterSeriesStartChange && (() => {
                    const startLocked = bottomToolbarApi.selectedCounterSeriesSize !== 1;
                    const startTitle = startLocked
                      ? 'Start number is set after a second counter is added'
                      : 'Start number';
                    return toolbarSlot('start', () => (
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
                    ), { canCompact: false });
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
                    w43 (2026-09-26): the text box and callout offer Cloud
                    too - it clouds the BOX border (a callout's leader stays
                    straight); see utils/textCloudBorder.js.
                    A stale 'cloud' carried over from a shape tool reads as
                    Solid on a tool that cannot cloud (arrow/line);
                    creation already treats it as solid, so the label matches
                    what will be drawn. Polygon and polyline read the same
                    picker because they are stroked shapes like line and rect. */}
                {(bottomToolbarApi.contextTool === 'arrow' || bottomToolbarApi.contextTool === 'line' || bottomToolbarApi.contextTool === 'rect' || bottomToolbarApi.contextTool === 'ellipse' || bottomToolbarApi.contextTool === 'polygon' || bottomToolbarApi.contextTool === 'polyline' || bottomToolbarApi.contextTool === 'text' || bottomToolbarApi.contextTool === 'callout') && bottomToolbarApi.setLineBorderStyle && (
                  (() => {
                  const styleValue = bottomToolbarApi.lineBorderStyle === 'cloud' && !bottomToolbarApi.supportsCloudStyle ? 'solid' : bottomToolbarApi.lineBorderStyle;
                  // w41: picked marks with different line styles read "Mixed"
                  // (no row ticked) until one is chosen for all of them.
                  const styleMixed = !!bottomToolbarApi.selectionMixed?.lineStyle;
                  if (bottomToolbarApi.selectionCapabilities?.lineStyle === false) return null;
                  return toolbarSlot('style', (compact) => (
                  <AnnotationDropdown
                    compact={compact}
                    open={showStyleMenu}
                    onOpenChange={setShowStyleMenu}
                    label="Style"
                    value={styleMixed ? '__mixed' : styleValue}
                    triggerContent={styleMixed ? 'Mixed' : undefined}
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
                  ), { canCompact: !styleMixed });
                  })()
                )}
                {/* 2026-05-25: Bump number input — shows only when the border
                    style is Cloud, on the same shapes that offer Cloud at all
                    (see supportsCloudStyle above). Drives how big the cloud's
                    wave bumps render. Mirrors the width input visual. */}
                {bottomToolbarApi.supportsCloudStyle && bottomToolbarApi.lineBorderStyle === 'cloud' && bottomToolbarApi.setCloudIntensity && toolbarSlot('bump', () => (
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
                ), { canCompact: false })}
                {/* 2026-05-25: Arrow tool (or selected callout) — custom
                    arrowhead menu that always opens downward and shows every
                    option at once (native select scrolls / picks its own
                    direction). Callouts have their own arrowhead end so the
                    same picker drives both. */}
                {(bottomToolbarApi.contextTool === 'arrow' || bottomToolbarApi.contextTool === 'callout') && bottomToolbarApi.setArrowheadStyle && (() => {
                  const live = bottomToolbarApi.arrowheadStyle;
                  const options = ARROWHEAD_MENU_OPTIONS.some((option) => option.value === live)
                    ? ARROWHEAD_MENU_OPTIONS
                    : [{ value: live, label: ARROWHEAD_SHORT_LABELS[live] || 'Arrowhead', icon: 'arrowheadOpen' }, ...ARROWHEAD_MENU_OPTIONS];
                  const iconFor = (value) => options.find((option) => option.value === value)?.icon || 'arrowheadSolid';
                  const headMixed = !!bottomToolbarApi.selectionMixed?.arrowheadStyle;
                  return toolbarSlot('arrowhead', (compact) => (
                  <AnnotationDropdown
                    compact={compact}
                    open={showArrowheadMenu}
                    onOpenChange={setShowArrowheadMenu}
                    label="Arrowhead"
                    value={headMixed ? '__mixed' : live}
                    triggerContent={headMixed ? 'Mixed' : undefined}
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
                  ), { canCompact: !headMixed });
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
                  // w41: picked arrows with different ends read "Mixed".
                  const endsMixed = !!(bottomToolbarApi.selectionMixed?.arrowBothEnds
                    || bottomToolbarApi.selectionMixed?.arrowheadStyle);
                  return toolbarSlot('ends', (compact) => (
                  <AnnotationDropdown
                    compact={compact}
                    open={showArrowEndsMenu}
                    onOpenChange={setShowArrowEndsMenu}
                    label="Arrow ends"
                    value={endsMixed ? '__mixed' : endsValue}
                    triggerContent={endsMixed ? 'Mixed' : undefined}
                    options={ARROW_ENDS_OPTIONS}
                    onSelect={(next) => {
                      // w41: several picked arrows take the ends in one
                      // write, each keeping its own head style.
                      if (typeof bottomToolbarApi.setGroupArrowEnds === 'function') {
                        bottomToolbarApi.setGroupArrowEnds(next);
                        return;
                      }
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
                  ), { canCompact: !endsMixed });
                })()}
                {/* PASS 7 (2026-09-22 review): the rule that closes the value
                    group before "Aa". Every other group in bars 1-3 is fenced
                    off by a hairline — colour | numbers | style — but the Aa sat
                    hard against the line-style pill with nothing between them,
                    so a control that OPENS A WHOLE BAR read as one more setting
                    of the shape. Same shared rule, same 8px inset. */}
                {(bottomToolbarApi.onEnterTextEdit || textFormatSource)
                  && (bottomToolbarApi.contextTool === 'text'
                      || bottomToolbarApi.contextTool === 'callout'
                      || !!bottomToolbarApi.richTextEditor)
                  // w42: the rule goes wherever the Aa goes (into More with it).
                  && !toolbarPlan.overflow.includes('aa') && (
                  <div className="chrome-divider" data-chrome-divider-before-aa="true" data-toolbar-slot-divider="aa" />
                )}
                {/* 2026-05-25 / PASS 7 (board 12): the "Aa" that owns the
                    formatting bar. It renders on the text box and callout tools
                    and whenever a text box is open for editing.

                    WHAT IT DOES, in the order the user means it:
                      - a box is open for editing → the bar is the editor's and
                        cannot be hidden, so Aa is simply gold and inert;
                      - the bar is showing and something editable is selected →
                        drop into that text, the same act as double-clicking it;
                      - otherwise → show or hide the bar.
                    It is GOLD exactly when the bar is on screen and changes
                    nothing else (owner ruling on selected states), so the button
                    and the bar always agree. It used to be permanently grey and
                    disabled while the tool was merely armed, because entering
                    edit mode was the only thing it could do and there was nothing
                    selected to enter. */}
                {(bottomToolbarApi.onEnterTextEdit || textFormatSource)
                  && (bottomToolbarApi.contextTool === 'text'
                      || bottomToolbarApi.contextTool === 'callout'
                      || !!bottomToolbarApi.richTextEditor) && toolbarSlot('aa', () => (
                  <button
                    // w43 (2026-09-26, owner report): Aa does ONE thing to
                    // the chrome - it shows or hides the formatting bar - and
                    // then puts the caret in the text. While a box is open the
                    // editor keeps focus (mousedown never moves it and
                    // data-rich-text-toolbar tells the editor this is not a
                    // click-away); with a text box or callout picked, showing
                    // the bar drops into its text, like a double-click. The
                    // button never changes size or label, and the main bar
                    // lays out the same whether a box is open or only picked,
                    // so nothing in it moves (tests/textFormatToggleNoShift).
                    onClick={() => {
                      const nextShown = !showTextFormatBar;
                      setShowTextFormatBar(nextShown);
                      const editor = bottomToolbarApi.richTextEditor;
                      if (editor) {
                        editor.api?.focus?.();
                        return;
                      }
                      if (nextShown && bottomToolbarApi.canEnterTextEdit) {
                        bottomToolbarApi.onEnterTextEdit();
                      }
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      // Keep the caret where it is when a box is open.
                      if (bottomToolbarApi.richTextEditor) e.preventDefault();
                    }}
                    data-rich-text-toolbar="true"
                    className="chrome-text-toggle"
                    style={{
                      // PASS 7 (board 12): the "Aa" is a 20px-tall label on no
                      // fill, 12px/800 — a word, not a chip. When the bar is up
                      // it turns gold and changes nothing else.
                      width: 'auto',
                      minWidth: 'auto',
                      padding: '0 7px',
                      color: showTextFormatting ? 'var(--accent)' : 'var(--text-2)',
                      font: `800 12px/1 ${FONT_FAMILY}`,
                      letterSpacing: '-0.02em',
                      cursor: 'pointer',
                    }}
                    {...chromeTip(showTextFormatting ? 'Hide text formatting' : 'Text formatting', 'below')}
                    aria-label="Edit text"
                    aria-pressed={showTextFormatting}
                  >
                    Aa
                  </button>
                ), { canCompact: false })}
                {/* w42 (2026-09-26): the More (⋯) button — only there while a
                    narrow window has moved settings into it. See
                    ToolbarOverflowMenu and src/utils/responsiveToolbar.js. */}
                <ToolbarOverflowMenu
                  items={toolbarOverflowItems}
                  tooltip={chromeTip('More settings', 'below')}
                />
                </>
              </div>
              </div>
              {/* w47: where row 2's outgoing settings fade out — AFTER the
                  live settings, so any selector finds the live ones first
                  (the copies carry no hooks anyway). */}
              <div
                ref={setFormatGhostLayerEl}
                data-loadout-ghost-layer="true"
                aria-hidden="true"
                /* RULED 2026-09-28 owner: row 2 downward swap (w51): the old
                   settings sink as they fade — clipped to row 2's band so
                   they never draw onto the page below. */
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'clip' }}
              />
              </>,
              formatRowEl
              )}
            </div>
          )}
        </div>
        )}
        <div className={isMobileViewer ? 'mobile-pdf-work-area' : undefined} style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex' }}>
          {/* Phone: the host is exactly the rail (--mobile-rail-w, 36px on
              board 1). It used to be a fixed 44px and left an 8px empty strip
              beside the rail; the owner spotted it on 2026-09-22. */}
          <div
            id="chrome-left-host"
            style={{
              display: isViewerVisible ? 'flex' : 'none',
              flexGrow: 0,
              flexBasis: isMobileViewer ? 'var(--mobile-rail-w)' : '48px',
              width: isMobileViewer ? 'var(--mobile-rail-w)' : '48px',
              flexShrink: 0,
              minWidth: isMobileViewer ? 'var(--mobile-rail-w)' : '48px',
              alignSelf: 'stretch',
              background: 'var(--panel-bg)',
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
                auxCloseRequestKey={mobileAuxCloseRequestKey}
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
                underneath keeps its full height.
                2026-09-23 (owner): it still never pushes the page down, but the
                viewer gives the page matching scroll room above page 1, so you
                can scroll the top of the page out from underneath the strips. */}
            <div
              id="chrome-sub-toolbar-host"
              ref={subToolbarHostRef}
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
            >
              {/* RULED 2026-09-26 owner: flip rows (w44). Desktop only: the
                  FORMATTING ROW (row 2 — the armed tool's or picked mark's
                  settings) and, under it, the slot for the Aa text-formatting
                  bar (row 3). Fixed slots, in this order, ahead of anything
                  else that drops into this host (the Survey row, the
                  text-selection bar), so the rows always stack the same way.
                  Row 2 is one fixed 36px bar that is on screen exactly while it
                  has settings to show (utils/toolbarRows.js showsFormatRow): it
                  never changes height as the tool changes, and it drops in with
                  the same 140ms fade the tool row used to. The phone draws
                  neither slot, so its layout is untouched. */}
              {/* w44 review: both slots are always drawn (the phone keeps row 2
                  hidden and row 3 empty, 0px tall), so they are never re-added
                  after the Survey row or the text-selection bar that drop into
                  this host too — the rows always stack in this order. */}
              {/* w46 (owner 2026-09-26: select modes in top bar): the Survey
                  row's slot comes FIRST, right under the tool bar. In Select
                  mode row 2 now comes and goes as a mark is picked and dropped
                  (it has nothing to show for Box / Lasso with nothing picked);
                  drawn above it, the Survey row never moves when it does. The
                  two only share the screen in Select mode — any drawing tool
                  closes the Survey row. */}
              <div id="chrome-survey-row-slot" data-chrome-survey-row-slot="true" />
              {/* RULED 2026-09-26 owner: fixed centred groups + animated
                  loadouts (w47). Row 2 drops in with the 140ms fade it always
                  had and now also LEAVES that way: for 140ms after it has
                  nothing left to show it stays drawn (data-leaving, no
                  clicks) and fades up and out (useLeavingRow), its old
                  settings held in the ghost layer inside it. It never blinks
                  on a one-render gap, runs back if wanted again mid-fade, and
                  goes at once with prefers-reduced-motion.
                  RULED 2026-09-28 owner: one motion for row 2 (in-place
                  crossfade): it now fades in and out IN PLACE (140ms in,
                  90ms out) — no drop, no drift up.
                  RULED 2026-09-28 owner: row 2 downward swap (w51): it now
                  drops in like row 3 (8px down from under the tool bar,
                  150ms, clipped at its top) and, leaving, its settings sink
                  while it fades — the same downward flow as its swap. */}
              <div
                  ref={attachFormatRow}
                  data-chrome-format-row="true"
                  role="toolbar"
                  aria-label="Formatting"
                  data-toolbar-tight={toolbarPlan.tight ? 'true' : undefined}
                  data-leaving={formatRowLeaving ? 'true' : undefined}
                  className="chrome-row-drop-in"
                  style={{
                    display: formatRowShown || formatRowLeaving ? 'block' : 'none',
                    position: 'relative',
                    width: '100%',
                    height: 'var(--chrome-bar-h)',
                    background: 'var(--surface-2)',
                    borderBottom: '1px solid var(--border)',
                    boxSizing: 'border-box',
                  }}
                />
              <div ref={setTextFormatRowEl} data-chrome-text-format-row="true" />
            </div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
            {/* Polish 3 (2026-10-04): the home screen stays mounted under an
                open document (the viewer layer covers it), but it was still in
                the Tab order - a keyboard user tabbed from the tool bar into
                Documents, Projects, Upload and the account menu they could not
                see. While a document is on screen the home is inert: no focus,
                no clicks, not read out. display: contents, so the wrapper adds
                no box and the layout is untouched. */}
            <div inert={isViewerVisible ? '' : undefined} style={{ display: 'contents' }}>
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
            </div>
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
                    <Suspense fallback={<QuietLoading label={openingLabel(tab.file?.name)} background="var(--surface-0)" />}>
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
              and zoom controls now live in the top-right toolbar pill.
              Polish 3 (2026-10-04): both rail hosts paint --panel-bg, the one
              docked-chrome colour (tokens.css, ONE SURFACE RULE). This one was
              --surface-1, which showed under the zoom / page stack as a darker
              band at the bottom of the rail. */}
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
              background: isMobileViewer ? 'transparent' : 'var(--panel-bg)',
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
                // UX 2026-09-22 (desktop critic round): the house radius is 6
                // and a rail button is not an exception. This footer ran 4 here,
                // 3 on its two number fields and 2 on Fit — four corners in one
                // 48px column, against 6 everywhere else in the chrome.
                // Colour: a resting chrome icon is --text-2, the same grey the
                // top bar's tool glyphs and the left rail's tabs now draw.
                borderRadius: 'var(--chrome-radius)',
                color: disabled ? 'var(--text-disabled)' : 'var(--text-2)',
                cursor: disabled ? 'not-allowed' : 'pointer'
              });
              // The expanded row lives inside the open panel (see below). The
              // panel reports its collapse to this component one frame after
              // it changes, so until an OPEN panel element exists the rail
              // keeps drawing the vertical stack - never a row over nothing.
              const railPanelEl = rightRailCollapsed
                ? null
                : document.querySelector('#chrome-right-host .survey-rail:not(.is-collapsed)');
              // Footer lock (owner 2026-10-02): the zoom and page values and
              // their edit fields share one box style, so opening a field puts
              // it exactly where the value was. The zoom reads 11px in the
              // open panel's row (the rail's smallest text) and 10px in the
              // collapsed 48px stack. The page box is as wide as this
              // document's page count ("120" -> 3 digits) for as long as the
              // document is open, so paging 9 -> 10 -> 100 moves nothing.
              const footerFieldBoxStyle = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxSizing: 'content-box', height: 'var(--chrome-field-h)', padding: '0 2px', borderRadius: 'var(--chrome-radius)', lineHeight: 1, fontSize: railPanelEl ? '11px' : '10px', fontVariantNumeric: 'tabular-nums' };
              const pageSlotWidest = '0'.repeat(String(Math.max(1, Number(api.numPages) || 0)).length);
              // Editable zoom % — Walkthru-style: plain "100%" by default,
              // click swaps to an input (it only mounts while editing so the
              // resting layout stays a single centered value). The handlers
              // clamp to 1-4000, the PDF engine's actual zoom range.
              const zoomValue = isEditingRailZoom ? (
                <>
                <span style={{ ...footerFieldBoxStyle, fontFamily: FONT_FAMILY, fontWeight: '500' }}>
                <FooterSlot widest={FOOTER_ZOOM_WIDEST} field={(
                <input
                  ref={api.zoomInputRef}
                  type="text"
                  autoFocus
                  /* UX 2026-09-23 (owner: right rail audit): the value you
                     clicked is selected, so typing REPLACES it (the phone page
                     field already did this). With the caret parked at the end,
                     clicking "101%" and typing 150 gave 101150 -> 4000%, and
                     clicking page "1" and typing 17 gave 117 -> nothing. */
                  onFocus={(e) => e.target.select()}
                  /* Uncontrolled while it is open (it mounts fresh per edit):
                     its value comes back from PDFViewer a render late, and a
                     controlled field snapped back to that stale value between
                     fast keystrokes and dropped digits. The DOM value is
                     filtered here and is what Enter / blur commit. */
                  defaultValue={api.zoomInputValue}
                  onChange={(e) => {
                    const clean = sanitizeZoomInput(e.target.value);
                    if (clean !== e.target.value) e.target.value = clean;
                    api.handleZoomInputChange(e);
                  }}
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
                  /* UX 2026-09-22: while you type, the box is the same height
                     and the same ink as the value it replaced, so the rail does
                     not twitch when it swaps in. */
                  style={{ ...footerSlotFieldStyle, background: 'transparent', color: 'var(--text-2)', border: 'none', padding: 0, margin: 0, fontSize: 'inherit', fontFamily: FONT_FAMILY, fontWeight: '500', fontVariantNumeric: 'tabular-nums', height: 'var(--chrome-field-h)', textAlign: 'center', outline: 'none', lineHeight: 1 }}
                />
                )} />
                </span>
                <DismissBarrier active insideRefs={railFieldRefs} mode="typing" onDismiss={dismissRailFields} dismissOnEscape={false} />
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingRailZoom(true)}
                  onDoubleClick={() => setIsEditingRailZoom(true)}
                  aria-label="Edit zoom percentage"
                  {...chromeTip('Zoom level — click to type a percentage', 'left')}
                  /* UX 2026-09-22 (desktop critic round): a value you can click
                     into is a FIELD, so it is the chrome's field height (20)
                     and the house radius (6). It measured 12px tall with a 3px
                     corner — a hit target half the size of every other field in
                     the app, in a column that also held a 13px one. */
                  style={{ ...footerFieldBoxStyle, background: 'transparent', border: 'none', color: 'var(--text-2)', fontFamily: FONT_FAMILY, fontWeight: '500', cursor: 'pointer', textAlign: 'center' }}
                >
                  <FooterSlot widest={FOOTER_ZOOM_WIDEST}>
                    <RailLiveZoomText
                      fallback={api.zoomInputValue || Math.round((api.manualZoomScale || 1) * 100)}
                      viewerId={getLiveZoomViewerId(activeTabId)}
                    />
                  </FooterSlot>
                </button>
              );
              // Editable current page — plain accent-colored number by
              // default (Walkthru style), click or double-click to jump.
              const pageValue = isEditingRailPage ? (
                <>
                <span style={{ ...footerFieldBoxStyle, fontSize: '11px', fontFamily: FONT_FAMILY, fontWeight: '600' }}>
                <FooterSlot widest={pageSlotWidest} field={(
                <input
                  ref={api.pageInputRef}
                  type="text"
                  data-page-number-input
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  /* Uncontrolled while open — same reason as the zoom field. */
                  defaultValue={api.pageInputValue}
                  onChange={(e) => {
                    const clean = e.target.value.replace(/\D/g, '');
                    if (clean !== e.target.value) e.target.value = clean;
                    api.handlePageInputChange(e);
                  }}
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
                  style={{ ...footerSlotFieldStyle, padding: 0, background: 'transparent', color: 'var(--text-1)', border: 'none', fontSize: '11px', fontFamily: FONT_FAMILY, fontWeight: '600', fontVariantNumeric: 'tabular-nums', height: 'var(--chrome-field-h)', textAlign: 'center', outline: 'none', lineHeight: 1 }}
                />
                )} />
                </span>
                <DismissBarrier active insideRefs={railFieldRefs} mode="typing" onDismiss={dismissRailFields} dismissOnEscape={false} />
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingRailPage(true)}
                  onDoubleClick={() => setIsEditingRailPage(true)}
                  aria-label="Edit page number"
                  {...chromeTip('Page — click to jump', 'left')}
                  /* UX 2026-09-22: the page number is the zoom field's twin —
                     same field height, same house radius.
                     Owner 2026-10-02: --text-1, as on the phone's page pill -
                     gold is for the active tool and the primary button only. */
                  style={{ ...footerFieldBoxStyle, background: 'transparent', border: 'none', color: 'var(--text-1)', fontSize: '11px', fontFamily: FONT_FAMILY, fontWeight: '600', cursor: 'pointer' }}
                >
                  <FooterSlot widest={pageSlotWidest}>{api.activeSpaceHasNoPages ? 0 : api.pageNum}</FooterSlot>
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
              // Polish 3 (2026-10-04): corner and shadow are now the shared
              // popup tokens (--radius-md / --shadow-popover) that
              // AnnotationDropdown's popover uses.
              const fitMenu = (anchorStyle) => (
                <div style={{ position: 'absolute', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-popover)', minWidth: '140px', zIndex: 6000, padding: '2px', ...anchorStyle }}>
                  <DismissBarrier active insideRefs={railFitMenuRefs} onDismiss={dismissRailFitMenu} />
                  {ZOOM_MODE_OPTIONS.map((option) => {
                    if (option.id === ZOOM_MODES.MANUAL) return null;
                    const isActive = option.id === api.zoomMode;
                    return (
                      <button
                        key={option.id}
                        onClick={() => api.handleZoomModeSelect(option.id)}
                        data-active={isActive}
                        /* Owner 2026-10-02 (phone/desktop consistency): the
                           phone's menu - a label, and a check on the chosen
                           row (which steps up to --text-1). No fit glyphs on
                           either platform; 28px rows here. */
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minHeight: '28px', padding: '4px 9px', background: 'transparent', border: 'none', borderRadius: '4px', textAlign: 'left', cursor: 'pointer', color: isActive ? 'var(--text-1)' : 'var(--text-2)', fontSize: '11px', fontFamily: FONT_FAMILY }}
                      >
                        <span>{option.label}</span>
                        {isActive && <Icon name="check" size={RAIL_CONTROL_GLYPH} color="currentColor" />}
                      </button>
                    );
                  })}
                </div>
              );

              if (!railPanelEl) {
                // Collapsed 48px rail — vertical stack. position:relative +
                // zIndex 2 keeps it above (and clickable over) the collapsed
                // survey overlay, which is absolute at the rail's full
                // height with zIndex 1; transparent background lets the
                // host/panel color (--panel-bg) show through.
                return (
                  <div data-chrome-rail="true" style={{ position: 'relative', zIndex: 2, width: '100%', borderTop: '1px solid var(--border)', padding: '8px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: 'transparent' }}>
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
                        — the Walkthru slim-rail convention.
                        UX 2026-09-23 (owner: right rail audit, "the dot seems
                        lower, in favour of the last page"): measured, it was —
                        11.5px of space above it against 8px below, because the
                        page number is a 20px field and the total was a bare
                        10px line, and the dot was a font glyph squeezed to a
                        0.5 line height. Now the dot is a drawn 2px circle (no
                        font metrics to drift) and the total sits in the same
                        20px box as the page number, so the stack is
                        field / gap / dot / gap / field and the dot lands on the
                        midpoint of the two numbers by construction. */}
                    <span aria-hidden="true" data-rail-page-dot style={RAIL_PAGE_DOT_STYLE} />
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'var(--chrome-field-h)', color: 'var(--text-3)', fontSize: '10px', fontFamily: FONT_FAMILY, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                      {api.activeSpaceHasNoPages ? 0 : api.numPages}
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
                        /* UX 2026-09-22 (desktop critic round): Fit keeps the
                           shared footer corner (6) — its own 2px was the third
                           radius in this column.
                           Polish 3 (2026-10-04): no gold. Gold is for the active
                           tool and the primary button only (owner 2026-10-02),
                           and a fit mode is on almost all the time, so the rail
                           always carried a gold mark. Same inks as the open
                           panel's Fit button: --text-2 when a fit mode is on,
                           --text-3 on a manual zoom. */
                        style={{ ...footerBtn(), position: 'relative', width: `${RAIL_SPLIT_CONTROL_W}px`, color: fitMode !== ZOOM_MODES.MANUAL ? 'var(--text-2)' : 'var(--text-3)' }}
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
                          /* UX 2026-09-23 (rail audit): centred with
                             top/bottom/margin, not a translate, so the
                             rail's glyph hover-grow / press-tighten transform
                             (states.css) can reach both marks — an inline
                             transform here silently cancelled it. */
                          style={{ position: 'absolute', left: '2px', top: 0, bottom: 0, margin: 'auto 0' }}
                        />
                        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {renderFitIcon(fitIconMode, RAIL_CONTROL_GLYPH)}
                        </span>
                      </button>
                      {api.isZoomMenuOpen && fitMenu({ right: '100%', bottom: 0, marginRight: '6px' })}
                    </div>
                  </div>
                );
              }

              // Expanded 320px survey panel — horizontal row pinned to the
              // panel bottom: [ − % + ] | [ ‹ n · N › ] | [ Fit ▴ ].
              // 2026-09-30 (owner: "it stretches, and it's missing its left
              // border when stretched"): the row is portalled INTO the panel
              // element and spans its content box, so the panel's own left
              // border runs down beside it and the row rides the panel's
              // expand / collapse motion frame for frame (it used to be a
              // separate 320px box that jumped to full width at once while the
              // panel was still growing).
              // Footer lock (owner 2026-10-02: "the minus or plus, the arrows
              // of the page navigation, the icon of the page fit - all that
              // stuff needs to be locked down"): every control and number box
              // has a fixed width and never shrinks (a squeezed flex item was
              // what slid the minus 22px left at 4000%), and the row spreads
              // them edge to edge with space-between. Nothing in the row then
              // depends on a value, so nothing moves while you zoom or page.
              // space-between can only overflow to the RIGHT, so even an
              // unexpectedly wide font never pushes the minus out past the
              // panel's left edge. The 20px icon boxes and 3px minimum gap are
              // what make a 4-digit page count fit the 320px panel.
              const footerRowBtn = { width: '20px', flexShrink: 0 };
              const fitLabelWidest = ZOOM_MODE_OPTIONS.map((option) => (option.id === ZOOM_MODES.MANUAL ? 'Manual' : option.label));
              const footerRow = (
                <div
                  data-rail-footer-row="true"
                  // Owner 2026-10-02: a chrome region - its icons take the one
                  // hover / press / chosen look (states.css section 5).
                  data-chrome-rail="true"
                  // Polish 3: the panel's own --panel-bg, not a darker band;
                  // the top hairline already marks where the footer starts.
                  style={{ position: 'absolute', left: 0, right: 0, bottom: 0, boxSizing: 'border-box', zIndex: 2, background: 'var(--panel-bg)', borderTop: '1px solid var(--border)', padding: '6px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3px' }}
                >
                  <button
                    onClick={api.zoomOut}
                    {...chromeTip('Zoom out', 'above')}
                    aria-label="Zoom out"
                    style={{ ...footerBtn(), ...footerRowBtn }}
                  >
                    <Icon name="minus" size={RAIL_CONTROL_GLYPH} />
                  </button>
                  {zoomValue}
                  <button
                    onClick={api.zoomIn}
                    {...chromeTip('Zoom in', 'above')}
                    aria-label="Zoom in"
                    style={{ ...footerBtn(), ...footerRowBtn }}
                  >
                    <Icon name="plus" size={RAIL_CONTROL_GLYPH} />
                  </button>

                  <div style={{ width: '1px', height: '20px', flexShrink: 0, background: 'var(--surface-3)' }} />

                  {/* Page nav — left/right chevrons because horizontal row. */}
                  <span {...chromeTip('Previous page', 'above')} style={{ display: 'inline-flex', flexShrink: 0 }}>
                    <button
                      onClick={api.goToPreviousPage}
                      disabled={atFirstPage}
                      aria-label="Previous page"
                      style={{ ...footerBtn(atFirstPage), ...footerRowBtn, pointerEvents: atFirstPage ? 'none' : 'auto' }}
                    >
                      <Icon name="chevronLeft" size={RAIL_CONTROL_GLYPH} />
                    </button>
                  </span>
                  {/* UX 2026-09-23 (rail audit): the same drawn dot as the
                      vertical stack, and the total takes the page field's 4px
                      side padding, so the dot sits the same distance from both
                      numbers (it was 7px from the page, 3px from the total).
                      Footer lock: both numbers sit in boxes as wide as the
                      page count, so the total's box is always full. */}
                  <span style={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: '3px', fontSize: '11px', fontFamily: FONT_FAMILY, fontVariantNumeric: 'tabular-nums' }}>
                    {pageValue}
                    <span aria-hidden="true" data-rail-page-dot style={RAIL_PAGE_DOT_STYLE} />
                    <span style={{ ...footerFieldBoxStyle, color: 'var(--text-3)' }}>
                      <FooterSlot widest={pageSlotWidest}>{api.activeSpaceHasNoPages ? 0 : api.numPages}</FooterSlot>
                    </span>
                  </span>
                  <span {...chromeTip('Next page', 'above')} style={{ display: 'inline-flex', flexShrink: 0 }}>
                    <button
                      onClick={api.goToNextPage}
                      disabled={atLastPage}
                      aria-label="Next page"
                      style={{ ...footerBtn(atLastPage), ...footerRowBtn, pointerEvents: atLastPage ? 'none' : 'auto' }}
                    >
                      <Icon name="chevronRight" size={RAIL_CONTROL_GLYPH} />
                    </button>
                  </span>

                  <div style={{ width: '1px', height: '20px', flexShrink: 0, background: 'var(--surface-3)' }} />

                  {/* Page-fit trigger — icon + current-mode label + chevron
                      pointing UP because the popup opens upward here.
                      Footer lock (owner 2026-10-02): the label sits in a box
                      as wide as the longest mode word, and a manual zoom reads
                      just "Manual" - "Manual 4000%" repeated the zoom number
                      two controls to the left and, at 73px, could not fit the
                      320px panel beside everything else. The tooltip still
                      says "Page fit: Manual 4000%". */}
                  <div ref={api.zoomMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
                    <button
                      onClick={api.toggleZoomMenu}
                      aria-haspopup="listbox"
                      aria-expanded={api.isZoomMenuOpen}
                      aria-label="Fit options"
                      data-active={fitMode !== ZOOM_MODES.MANUAL}
                      // Icon + short word: it presses like every chrome icon
                      // (states.css section 5), with no hover plate.
                      className="chrome-icon-btn"
                      {...chromeTip(`Page fit: ${api.zoomDropdownLabel}`, 'above')}
                      style={{ ...footerBtn(), width: 'auto', height: `${RAIL_CONTROL}px`, gap: '4px', padding: '0 4px', color: fitMode !== ZOOM_MODES.MANUAL ? 'var(--text-2)' : 'var(--text-3)', fontSize: '11px', fontFamily: FONT_FAMILY }}
                    >
                      {renderFitIcon(fitIconMode, RAIL_CONTROL_GLYPH)}
                      <FooterSlot widest={fitLabelWidest}>{fitMode === ZOOM_MODES.MANUAL ? 'Manual' : api.zoomDropdownLabel}</FooterSlot>
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
              return createPortal(footerRow, railPanelEl);
            })()}
          </div>
        </div>
        {/* Owner 2026-10-01 ("once it's collapsed, its collapsed version
            refreshes"): the dock used to unmount the moment a phone panel
            opened and mount again only after the panel had finished sliding
            down, so it vanished under a rising sheet and popped back in, in one
            frame, as the sheet landed. It stays mounted, and it keeps its
            resting look - a highlight lit only while a panel is open would
            switch off on the frame the sheet lands, the same pop in miniature.
            Owner 2026-10-01 (iPhone: "the panel needs to show over the bottom
            bar ... and I should be able to see the bottom bar"): every sheet
            now stands ON the dock (mobilePdfViewer.css, SHEETS STAND ON THE
            DOCK), so the dock is never covered and stays usable while a panel
            is open - its buttons switch panels (each handler closes the one
            that is open) - and a closing sheet tucks away behind it. */}
        {isMobileViewer && (
          <MobilePdfViewerDock
            onOpenPanel={openMobileDocumentPanel}
            onToggleHub={toggleMobileDocumentHub}
            onOpenSurvey={openMobileSurveyPanel}
            hubMode={['pages', 'search', 'bookmarks'].includes(mobileDocumentPanelState.activePanel) ? mobileDocumentPanelState.activePanel : 'pages'}
            spacesActive={Boolean(leftRailApi?.activeSpaceId)}
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
