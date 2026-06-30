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
import ToastHost from './components/ToastHost';
import SurveySpacesRail from './SurveySpacesRail';
import TabBar from './TabBar';
import YDocProvider from './components/collab/YDocProvider.jsx';
import { ARROWHEAD_STYLE_LABELS } from './components/Callout/types';
import { AuthModal } from './components/AuthModal';
import { FORM_TOOL_IDS } from './components/formDesignerTools';
import { ZOOM_MODES } from './utils/zoomController';
import { createPortal } from 'react-dom';
import { getNetworkLogSnapshot } from './utils/networkLogger';
import { sanitizeConsoleLogText } from './utils/consoleLogFilter';
import { showToast } from './utils/toast';
import { useAuth } from './contexts/AuthContext';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useMSGraph } from './contexts/MSGraphContext';
import { useOptionalAuth } from './components/OptionalAuthPrompt';
import { useTemplates } from './hooks/useDatabase';

import { FONT_FAMILY, REVIEW_TOOL_IDS, ZOOM_MODE_OPTIONS, appDebug, coerceScrollMode, ensureRgbaOpacity, getWindowTrackpadInteractionDebugSavePayload, hexToRgba, writeSaveLogExtraFiles } from './viewerShared';
// Lazy boundary: the dashboard paints without pulling in the viewer (and its
// fabric / annotation / Excel weight). The viewer chunk fetches the first time
// a PDF tab is opened.
const PDFViewer = lazy(() => import('./PDFViewer').then((m) => ({ default: m.PDFViewer })));
// Lazy boundary: the compact color picker only renders deep inside the bottom
// toolbar when a rich-text or annotation color picker is explicitly opened.
const CompactColorPicker = lazy(() => import('./components/CompactColorPicker'));

export default function App() {
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
          detail: { type: 'error', message: 'Save Log unavailable outside desktop app' }
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
  const [documents, setDocuments] = useState([]);
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
  // input. Typing is clamped to 10–500 (the app's allowable zoom range).
  const [isEditingRailZoom, setIsEditingRailZoom] = useState(false);


  // UX 2026-05-13: App-level bottom toolbar state. The chrome-bottom host
  // mounts with final rail dimensions as soon as a PDF tab is active; the active
  // PDFViewer will publish the live toolbar API into this object in the next
  // wiring step.
  const [bottomToolbarApi, setBottomToolbarApi] = useState(null);

  // 2026-05-25: Arrowhead picker — opens below the trigger and shows every
  // option at once (no native select scroll). Closed on outside click.
  const [showArrowheadMenu, setShowArrowheadMenu] = useState(false);
  useEffect(() => {
    if (!showArrowheadMenu) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('[data-arrowhead-menu]')) return;
      setShowArrowheadMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showArrowheadMenu]);

  // 2026-05-25: Color picker active tab for shapes (rectangle / ellipse).
  // 'fill' swaps the picker to read/write fillColor; 'border' swaps to strokeColor.
  const [colorPickerTab, setColorPickerTab] = useState('fill');

  const [showAlignGrid, setShowAlignGrid] = useState(false);
  useEffect(() => {
    if (!showAlignGrid) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('[data-align-grid]')) return;
      setShowAlignGrid(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showAlignGrid]);

  const [showFontColorPicker, setShowFontColorPicker] = useState(false);
  useEffect(() => {
    if (!showFontColorPicker) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('[data-font-color-picker]')) return;
      setShowFontColorPicker(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showFontColorPicker]);

  const [showFontFamilyMenu, setShowFontFamilyMenu] = useState(false);
  useEffect(() => {
    if (!showFontFamilyMenu) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('[data-font-family-menu]')) return;
      setShowFontFamilyMenu(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showFontFamilyMenu]);

  const [showFontSizeMenu, setShowFontSizeMenu] = useState(false);
  useEffect(() => {
    if (!showFontSizeMenu) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('[data-font-size-menu]')) return;
      setShowFontSizeMenu(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showFontSizeMenu]);

  useEffect(() => {
    if (!bottomToolbarApi?.richTextEditor) {
      setShowFontColorPicker(false);
      setShowAlignGrid(false);
      setShowFontFamilyMenu(false);
      setShowFontSizeMenu(false);
    }
  }, [bottomToolbarApi?.richTextEditor]);

  // 2026-05-25: Border-style picker for lines and arrows.
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  useEffect(() => {
    if (!showStyleMenu) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('[data-style-menu]')) return;
      setShowStyleMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showStyleMenu]);

  const [showCounterSeriesMenu, setShowCounterSeriesMenu] = useState(false);
  useEffect(() => {
    if (!showCounterSeriesMenu) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('[data-counter-series-menu]')) return;
      setShowCounterSeriesMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showCounterSeriesMenu]);

  useEffect(() => {
    if (bottomToolbarApi?.contextTool !== 'counter') {
      setShowCounterSeriesMenu(false);
    }
  }, [bottomToolbarApi?.contextTool]);

  const [showEraserTypeMenu, setShowEraserTypeMenu] = useState(false);
  useEffect(() => {
    if (!showEraserTypeMenu) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('[data-eraser-type-menu]')) return;
      setShowEraserTypeMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showEraserTypeMenu]);

  useEffect(() => {
    if (bottomToolbarApi?.activeTool !== 'eraser') {
      setShowEraserTypeMenu(false);
    }
  }, [bottomToolbarApi?.activeTool]);

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

  // Tab management state
  const HOME_TAB_ID = 'home-tab';
  const [tabs, setTabs] = useState([{ id: HOME_TAB_ID, name: 'Home', file: null, isHome: true }]); // Array of { id, name, file, isHome? }
  const [activeTabId, setActiveTabId] = useState(HOME_TAB_ID);
  // Track PDFs that are currently being opened to prevent duplicate opens
  const openingPdfsRef = useRef(new Set());

  // Template management state
  const [appTemplates, setAppTemplates] = useState([]);

  const handleTemplatesChange = useCallback((nextTemplates) => {
    const normalized = Array.isArray(nextTemplates) ? nextTemplates : [];
    setAppTemplates(normalized);
  }, []);

  const [entities, setEntities] = useState(() => [
    { id: `entity-${Date.now()}-1`, name: 'GC', color: '#E3D1FB' },
    { id: `entity-${Date.now()}-2`, name: 'Subcontractor', color: '#FFF5C3' },
    { id: `entity-${Date.now()}-3`, name: 'My Company', color: '#CBDCFF' },
    { id: `entity-${Date.now()}-4`, name: '100% Complete', color: '#B2FFB2' },
    { id: `entity-${Date.now()}-5`, name: 'Removed', color: '#BBBBBB' }
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
  const generateTabId = () => `tab-${crypto.randomUUID()}`;

  const handleDocumentSelect = (file, filePath = null) => {
    if (!file) {
      console.error('No file provided to handleDocumentSelect');
      return;
    }

    // Create a unique key for this PDF (name + size + path)
    const pdfKey = `${file.name}-${file.size}-${filePath || ''}`;

    // Check if this PDF is already being opened (prevents duplicate opens when app is slow)
    if (openingPdfsRef.current.has(pdfKey)) {
      return;
    }

    // Check if this file is already open in a tab (excluding home tab)
    const existingTab = tabs.find(tab => {
      // Compare by name and size for uniqueness, and make sure it's not the home tab
      // Also check path if available for more robust matching
      if (tab.isHome || !tab.file) return false;

      const sameName = tab.file.name === file.name;
      const sameSize = tab.file.size === file.size;
      const samePath = tab.filePath && filePath ? tab.filePath === filePath : true;

      return sameName && sameSize && samePath;
    });

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

  const handleTabClick = (tabId) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      // Exit selection mode when switching tabs
      if (dashboardRef.current?.exitSelectionMode) {
        dashboardRef.current.exitSelectionMode();
      }

      setActiveTabId(tabId);
      if (tab.isHome) {
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

  // Hardening (audit 2026-04-30 #3): track per-tab "has any annotations" so
  // the beforeunload guard below can warn the user before they close a
  // local-only PDF (no Supabase row) with annotations on it. Distinct from
  // hasUnsavedAnnotations because we want to warn even after a localStorage
  // save — closing the window/tab on a local-only PDF with annotations is
  // always a "you might be losing work" moment until the file is exported.
  const handleAnnotationsExistChange = useCallback((hasAny, targetTabId) => {
    if (!targetTabId) return;
    setTabs(prev =>
      prev.map(tab =>
        tab.id === targetTabId ? { ...tab, hasAnyAnnotations: hasAny } : tab,
      ),
    );
  }, []);

  // Hardening (audit 2026-04-30 #3): warn before window unload when the
  // active tab is a local-only PDF (no cloud row) that has annotations.
  // Browsers show a generic "leave site?" prompt and let the user cancel.
  // Cloud-synced PDFs are out of scope here — their work is already
  // persisted server-side, so the warning would be noise.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (event) => {
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (!activeTab || activeTab.isHome) return undefined;
      const file = activeTab.file;
      if (!file) return undefined;
      // Only warn for local-only PDFs (no Supabase row). Cloud PDFs are
      // already persisted; their work survives a window close.
      if (file.id) return undefined;
      if (!activeTab.hasAnyAnnotations) return undefined;
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
  const handleUpdatePDFFile = useCallback((newFile, targetTabId) => {
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
  }, [selectedPDF, activeTabId]);

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
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F5F5F5',
        fontFamily: FONT_FAMILY
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'center' }}>
            <Icon name="document" size={24} />
          </div>
          <div style={{ fontSize: '16px', color: '#666' }}>Loading document...</div>
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
    <>
      {/* UX 2026-04-22: Save Log banner mounts at the outermost App level so
          it's visible on the dashboard / templates / auth / any view, not
          only inside the PDF viewer. Listens for a window event the Save
          Log handler dispatches. */}
      <SaveLogBanner />
      <ToastHost />
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {tabs.length > 0 && ( // Show tab bar if there are any tabs (including home)
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
        <div
          id="chrome-top-host"
          style={{
            display: isViewerVisible ? 'flex' : 'none',
            flexShrink: 0,
            padding: '8px 12px',
            background: '#2d2d2d',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            rowGap: '6px',
            columnGap: '8px',
            fontSize: '13px',
            fontFamily: FONT_FAMILY,
            color: '#ddd',
            position: 'relative',
            zIndex: 5500
          }}
        >
          {/* UX 2026-05-29 (right-rail redesign): page / zoom / fit controls
              relocated out of the old 48px right strip into a compact horizontal
              pill pinned to the TOP-RIGHT corner. This is a faithful copy of
              Walkthrough's expanded (railOpen) zoom-controls layout:
              [ − %% + ] | [ ‹ n · N › ] | [ Fit ▾ ]. Every handler still comes
              from bottomToolbarApi (published by PDFViewer), so the zoom
              invariants — zoomGeneration, container-aware canvas sizing, the
              Pdfjs scale-confirm pipeline — are completely untouched; only
              the buttons moved. The fit popup opens DOWNWARD now (top:100%). */}
          {bottomToolbarApi && (
            <div style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              border: 'none',
              background: 'transparent',
              borderRadius: 0,
              padding: 0,
              zIndex: 1
            }}>
              {/* Zoom group: − value + */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px', height: '32px', padding: '0 4px' }}>
                <button
                  onClick={bottomToolbarApi.zoomOut}
                  title="Zoom out"
                  style={{ height: '28px', width: '28px', display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', color: '#cfcfcf', borderRadius: '4px', fontSize: '14px', lineHeight: 1, cursor: 'pointer' }}
                >−</button>
                {isEditingRailZoom ? (
                  <input
                    ref={bottomToolbarApi.zoomInputRef}
                    type="text"
                    autoFocus
                    value={bottomToolbarApi.zoomInputValue}
                    onChange={bottomToolbarApi.handleZoomInputChange}
                    onKeyDown={(e) => {
                      bottomToolbarApi.handleZoomInputKeyDown(e);
                      if (e.key === 'Enter' || e.key === 'Escape') setIsEditingRailZoom(false);
                    }}
                    onBlur={(e) => {
                      bottomToolbarApi.handleZoomInputBlur(e);
                      setIsEditingRailZoom(false);
                    }}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Zoom percentage"
                    style={{ width: '5ch', background: 'transparent', color: '#cfcfcf', border: 'none', padding: 0, margin: 0, fontSize: '11px', fontFamily: FONT_FAMILY, fontVariantNumeric: 'tabular-nums', textAlign: 'center', outline: 'none', lineHeight: 1 }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingRailZoom(true)}
                    onDoubleClick={() => setIsEditingRailZoom(true)}
                    aria-label="Edit zoom percentage"
                    title="Click to type a zoom percentage"
                    style={{ minWidth: '5ch', textAlign: 'center', background: 'transparent', border: 'none', color: '#cfcfcf', fontSize: '11px', fontFamily: FONT_FAMILY, fontVariantNumeric: 'tabular-nums', padding: '0 2px', cursor: 'pointer', lineHeight: 1 }}
                  >
                    {bottomToolbarApi.zoomInputValue || Math.round((bottomToolbarApi.manualZoomScale || 1) * 100)}%
                  </button>
                )}
                <button
                  onClick={bottomToolbarApi.zoomIn}
                  title="Zoom in"
                  style={{ height: '28px', width: '28px', display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', color: '#cfcfcf', borderRadius: '4px', fontSize: '14px', lineHeight: 1, cursor: 'pointer' }}
                >+</button>
              </div>

              <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.18)' }} />

              {/* Page group: ‹ n · N › */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px', height: '32px', padding: '0 4px' }}>
                <button
                  onClick={bottomToolbarApi.goToPreviousPage}
                  disabled={bottomToolbarApi.pageNum <= 1}
                  title="Previous page"
                  style={{ height: '24px', width: '24px', display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', color: '#cfcfcf', borderRadius: '4px', cursor: bottomToolbarApi.pageNum <= 1 ? 'not-allowed' : 'pointer', opacity: bottomToolbarApi.pageNum <= 1 ? 0.35 : 1 }}
                >
                  <Icon name="chevronLeft" size={14} />
                </button>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', fontFamily: FONT_FAMILY, fontVariantNumeric: 'tabular-nums' }}>
                  {isEditingRailPage ? (
                    <input
                      ref={bottomToolbarApi.pageInputRef}
                      type="text"
                      data-page-number-input
                      autoFocus
                      value={bottomToolbarApi.pageInputValue}
                      onChange={bottomToolbarApi.handlePageInputChange}
                      onKeyDown={(e) => {
                        bottomToolbarApi.handlePageInputKeyDown(e);
                        if (e.key === 'Enter' || e.key === 'Escape') setIsEditingRailPage(false);
                      }}
                      onBlur={(e) => {
                        bottomToolbarApi.handlePageInputBlur(e);
                        setIsEditingRailPage(false);
                      }}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label="Current page"
                      style={{ width: '3ch', padding: 0, background: 'transparent', color: '#4A90E2', border: 'none', fontSize: '11px', fontFamily: FONT_FAMILY, fontWeight: '600', fontVariantNumeric: 'tabular-nums', textAlign: 'center', outline: 'none', lineHeight: 1 }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditingRailPage(true)}
                      onDoubleClick={() => setIsEditingRailPage(true)}
                      aria-label="Edit page number"
                      title="Click to jump to a page"
                      style={{ background: 'transparent', border: 'none', color: '#4A90E2', fontSize: '11px', fontFamily: FONT_FAMILY, fontWeight: '600', fontVariantNumeric: 'tabular-nums', padding: '0 2px', cursor: 'pointer', lineHeight: 1 }}
                    >
                      {bottomToolbarApi.pageNum}
                    </button>
                  )}
                  <span aria-hidden="true" style={{ color: '#888' }}>·</span>
                  <span style={{ color: '#888' }}>{bottomToolbarApi.numPages}</span>
                </span>
                <button
                  onClick={bottomToolbarApi.goToNextPage}
                  disabled={bottomToolbarApi.pageNum >= bottomToolbarApi.numPages}
                  title="Next page"
                  style={{ height: '24px', width: '24px', display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', color: '#cfcfcf', borderRadius: '4px', cursor: bottomToolbarApi.pageNum >= bottomToolbarApi.numPages ? 'not-allowed' : 'pointer', opacity: bottomToolbarApi.pageNum >= bottomToolbarApi.numPages ? 0.35 : 1 }}
                >
                  <Icon name="chevronRight" size={14} />
                </button>
              </div>

              <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.18)' }} />

              {/* Fit group: single button + downward dropdown */}
              {(() => {
                const mode = bottomToolbarApi.zoomMode;
                const iconMode = (mode === ZOOM_MODES.FIT_WIDTH || mode === ZOOM_MODES.FIT_HEIGHT) ? mode : ZOOM_MODES.FIT_PAGE;
                const renderFitIcon = (m) => {
                  const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.7 };
                  if (m === ZOOM_MODES.FIT_WIDTH) {
                    return (
                      <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: '15px', height: '15px' }}>
                        <rect x="4" y="5" width="16" height="14" rx="1.5" {...stroke} />
                        <path d="M7 12h10M7 12l3-3M7 12l3 3M17 12l-3-3M17 12l-3 3" {...stroke} />
                      </svg>
                    );
                  }
                  if (m === ZOOM_MODES.FIT_HEIGHT) {
                    return (
                      <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: '15px', height: '15px' }}>
                        <rect x="5" y="4" width="14" height="16" rx="1.5" {...stroke} />
                        <path d="M12 7v10M12 7l-3 3M12 7l3 3M12 17l-3-3M12 17l3-3" {...stroke} />
                      </svg>
                    );
                  }
                  return (
                    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: '15px', height: '15px' }}>
                      <rect x="6" y="3" width="12" height="18" rx="1.5" {...stroke} />
                      <path d="M9 7h6M9 11h6M9 15h4" {...stroke} />
                    </svg>
                  );
                };
                return (
                  <div ref={bottomToolbarApi.zoomMenuRef} style={{ position: 'relative' }}>
                    <button
                      onClick={bottomToolbarApi.toggleZoomMenu}
                      aria-haspopup="listbox"
                      aria-expanded={bottomToolbarApi.isZoomMenuOpen}
                      aria-label="Fit options"
                      data-active={mode !== ZOOM_MODES.MANUAL}
                      title={`Page fit: ${bottomToolbarApi.zoomDropdownLabel}`}
                      style={{ height: '30px', display: 'flex', alignItems: 'center', gap: '6px', padding: '0 10px', border: 'none', background: 'transparent', color: mode !== ZOOM_MODES.MANUAL ? '#e0e0e0' : '#cfcfcf', borderRadius: '4px', fontSize: '11px', fontFamily: FONT_FAMILY, cursor: 'pointer' }}
                    >
                      {renderFitIcon(iconMode)}
                      <span>{bottomToolbarApi.zoomDropdownLabel}</span>
                      <svg viewBox="0 0 12 12" aria-hidden="true" style={{ width: '11px', height: '11px', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.8 }}>
                        <path d={bottomToolbarApi.isZoomMenuOpen ? 'M2.5 7.5 6 4 9.5 7.5' : 'M2.5 4.5 6 8 9.5 4.5'} />
                      </svg>
                    </button>
                    {bottomToolbarApi.isZoomMenuOpen && (
                      <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '6px', background: 'rgb(30, 30, 30)', border: '1px solid #3a3a3a', borderRadius: '2px', boxShadow: '0 10px 24px rgba(0,0,0,0.45)', width: '144px', zIndex: 6000, padding: '2px' }}>
                        {ZOOM_MODE_OPTIONS.map((option) => {
                          if (option.id === ZOOM_MODES.MANUAL) return null;
                          const isActive = option.id === bottomToolbarApi.zoomMode;
                          return (
                            <button
                              key={option.id}
                              onClick={() => bottomToolbarApi.handleZoomModeSelect(option.id)}
                              data-active={isActive}
                              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', background: 'transparent', border: 'none', borderRadius: '2px', textAlign: 'left', cursor: 'pointer', color: isActive ? '#e0e0e0' : '#bbb', fontSize: '11px', fontFamily: FONT_FAMILY }}
                            >
                              {renderFitIcon(option.id)}
                              <span>{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
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
            position: 'absolute',
            left: '12px',
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <button
              onClick={topToolbarApi.onUndo || (() => {})}
              disabled={!topToolbarApi.canUndo}
              className="btn btn-default btn-sm"
              title="Undo"
              style={{
                padding: '4px 8px',
                opacity: topToolbarApi.canUndo ? 1 : 0.4,
                cursor: topToolbarApi.canUndo ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Icon name="undo" size={14} />
            </button>
            <button
              onClick={topToolbarApi.onRedo || (() => {})}
              disabled={!topToolbarApi.canRedo}
              className="btn btn-default btn-sm"
              title="Redo"
              style={{
                padding: '4px 8px',
                opacity: topToolbarApi.canRedo ? 1 : 0.4,
                cursor: topToolbarApi.canRedo ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transform: 'matrix(1, 0, 0, 1, 0, -0.591158) rotate(180deg) scaleX(-1)'
              }}
            >
              <Icon name="redo" size={14} />
            </button>
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
            <div data-tool-toolbar="true" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* 2026-05-26: Pan + Select sit in their own absolute block to
                  the LEFT of the centered annotation cluster. This mirrors
                  the right-side tool properties block so the annotation
                  icons stay centered on the screen — only the side blocks
                  shift as their contents change. */}
              <div style={{
                position: 'absolute',
                right: '100%',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                paddingRight: '8px',
                whiteSpace: 'nowrap'
              }}>
              {[
                { id: 'pan', label: 'Pan', iconName: 'pan' },
                { id: 'select', label: 'Select', iconName: 'cursor' }
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    bottomToolbarApi.setActiveTool(t.id);
                    bottomToolbarApi.setActiveCategoryDropdown(null);
                  }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    bottomToolbarApi.setTooltip({
                      visible: true,
                      text: t.label,
                      x: rect.left + rect.width / 2,
                      y: rect.bottom + 10,
                      placement: 'below'
                    });
                  }}
                  onMouseLeave={() => bottomToolbarApi.setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                  className={`btn btn-icon ${bottomToolbarApi.activeTool === t.id ? 'btn-active' : ''}`}
                >
                  <Icon name={t.iconName} size={16} />
                </button>
              ))}

              <div style={{ width: '1px', height: '20px', background: '#555', margin: '0 4px' }} />
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
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  bottomToolbarApi.setTooltip({
                    visible: true,
                    text: 'Draw',
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10,
                    placement: 'below'
                  });
                }}
                onMouseLeave={() => bottomToolbarApi.setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                className={`btn btn-md ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'draw' || ['pen', 'highlighter', 'text-highlight', 'eraser'].includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}
                title="Draw"
              >
                <Icon name="pen" size={18} />
              </button>

              {/* Shapes category */}
              <button
                onClick={() => {
                  const isActive = bottomToolbarApi.activeCategoryDropdown === 'shape';
                  bottomToolbarApi.setActiveCategoryDropdown(isActive ? null : 'shape');
                  if (!isActive) {
                    if (!['rect', 'ellipse', 'line', 'arrow', 'counter'].includes(bottomToolbarApi.activeTool)) {
                      bottomToolbarApi.setActiveTool(bottomToolbarApi.lastShapeTool);
                    }
                  }
                }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  bottomToolbarApi.setTooltip({
                    visible: true,
                    text: 'Shapes',
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10,
                    placement: 'below'
                  });
                }}
                onMouseLeave={() => bottomToolbarApi.setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                className={`btn btn-md ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'shape' || ['rect', 'ellipse', 'line', 'arrow', 'counter'].includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}
                title="Shapes"
              >
                <Icon name="rect" size={18} />
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
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  bottomToolbarApi.setTooltip({
                    visible: true,
                    text: 'Text',
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10,
                    placement: 'below'
                  });
                }}
                onMouseLeave={() => bottomToolbarApi.setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                className={`btn btn-md ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'review' || REVIEW_TOOL_IDS.includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}
                title="Text"
              >
                <Icon name="text" size={18} />
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
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  bottomToolbarApi.setTooltip({
                    visible: true,
                    text: 'Forms',
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10,
                    placement: 'below'
                  });
                }}
                onMouseLeave={() => bottomToolbarApi.setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                className={`btn btn-md ${bottomToolbarApi.activeTool !== 'pan' && bottomToolbarApi.activeTool !== 'select' && (bottomToolbarApi.activeCategoryDropdown === 'forms' || FORM_TOOL_IDS.includes(bottomToolbarApi.activeTool)) ? 'btn-active' : 'btn-default'}`}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px' }}
                title="Forms"
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
                position: 'absolute',
                left: '100%',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                paddingLeft: '8px',
                whiteSpace: 'nowrap'
              }}>
              <div style={{ width: '1px', height: '20px', background: '#555', margin: '0 4px' }} />

              {/* Color swatch + Width input. Color picker now flips DOWN
                  (top: 100%) since the swatch lives at the top of the
                  viewport instead of the bottom — popping up would shoot
                  off-screen.
                  2026-05-25: Pen + highlighter render the swatch as a flat
                  solid-disc circle (no fill/border ring) per the new
                  context-aware strip contract — visual reference is
                  prototype-context-toolbar.html. Other tools keep the
                  rectangle swatch until they migrate. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
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
                  <div data-rich-text-toolbar style={{ width: '100%', height: '34px', background: '#2b2b2b', borderBottom: '1px solid #3a3a3a', borderTop: 'none', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', zIndex: 10, boxSizing: 'border-box' }}>
                    {/* 2026-05-26: Order — font color, font size, B / I / U / S,
                        alignment. Matches the user's requested left-to-right
                        sequence so the chrome reads as one cohesive row. Font
                        family was removed from the strip in this pass per the
                        same request. */}
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
                          width: '24px',
                          height: '24px',
                          padding: 0,
                          borderRadius: '50%',
                          border: 'none',
                          position: 'relative',
                          overflow: 'hidden',
                          boxSizing: 'border-box',
                          cursor: 'pointer',
                        }}
                        title="Font color"
                        aria-label="Font color"
                      >
                        <span
                          className="ctx-color-fill"
                          style={{ background: bottomToolbarApi.richTextEditor?.state?.fontColor || '#1e293b' }}
                        />
                      </button>
                      {showFontColorPicker && (
                        <div style={{
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
                    {/* Font family — custom dropdown so it opens strictly
                        downward and styling matches the rest of the chrome.
                        Single-name fonts only per the Fabric cursor-drift
                        gotcha (2026-04-08). */}
                    {(() => {
                      const FONT_FAMILIES = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];
                      const currentFamily = bottomToolbarApi.richTextEditor?.state?.fontFamily || 'Arial';
                      return (
                        <div data-font-family-menu style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onClick={() => setShowFontFamilyMenu((v) => !v)}
                            style={{
                              height: '24px',
                              padding: '0 8px',
                              minWidth: '110px',
                              background: '#444',
                              color: '#ddd',
                              border: '1px solid transparent',
                              borderRadius: '5px',
                              fontSize: '12px',
                              fontFamily: FONT_FAMILY,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '6px',
                            }}
                            title="Font"
                            aria-label="Font"
                          >
                            <span style={{ fontFamily: currentFamily, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentFamily}</span>
                            <span style={{ color: '#888', fontSize: '9px' }}>▼</span>
                          </button>
                          {showFontFamilyMenu && (
                            <div style={{
                              position: 'absolute',
                              top: 'calc(100% + 6px)',
                              left: 0,
                              zIndex: 5600,
                              background: '#1e2026',
                              border: '1px solid #383d46',
                              borderRadius: '6px',
                              padding: '4px',
                              boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
                              minWidth: '160px',
                              maxHeight: '280px',
                              overflowY: 'auto',
                            }}>
                              {FONT_FAMILIES.map((f) => {
                                const on = f === currentFamily;
                                return (
                                  <button
                                    key={f}
                                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onClick={() => {
                                      bottomToolbarApi.richTextEditor?.api?.setFontFamily?.(f);
                                      setShowFontFamilyMenu(false);
                                    }}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      padding: '6px 10px',
                                      background: on ? 'rgba(216,168,78,0.12)' : 'transparent',
                                      color: on ? '#d8a84e' : '#ddd',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontFamily: f,
                                      fontSize: '13px',
                                    }}
                                  >
                                    {f}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
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
                        <div data-font-size-menu style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onClick={() => setShowFontSizeMenu((v) => !v)}
                            style={{
                              height: '24px',
                              padding: '0 8px',
                              minWidth: '58px',
                              background: '#444',
                              color: '#ddd',
                              border: '1px solid transparent',
                              borderRadius: '5px',
                              fontSize: '12px',
                              fontFamily: FONT_FAMILY,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '6px',
                            }}
                            title="Font size"
                            aria-label="Font size"
                          >
                            <span>{currentSize}</span>
                            <span style={{ color: '#888', fontSize: '9px' }}>▼</span>
                          </button>
                          {showFontSizeMenu && (
                            <div style={{
                              position: 'absolute',
                              top: 'calc(100% + 6px)',
                              left: 0,
                              zIndex: 5600,
                              background: '#1e2026',
                              border: '1px solid #383d46',
                              borderRadius: '6px',
                              padding: '4px',
                              boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
                              minWidth: '72px',
                              maxHeight: '280px',
                              overflowY: 'auto',
                            }}>
                              {sizes.map((s) => {
                                const on = s === currentSize;
                                return (
                                  <button
                                    key={s}
                                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onClick={() => {
                                      bottomToolbarApi.richTextEditor?.api?.setFontSize?.(s);
                                      setShowFontSizeMenu(false);
                                    }}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      padding: '6px 10px',
                                      background: on ? 'rgba(216,168,78,0.12)' : 'transparent',
                                      color: on ? '#d8a84e' : '#ddd',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontFamily: FONT_FAMILY,
                                      fontSize: '13px',
                                    }}
                                  >
                                    {s}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* Bold / Italic / Underline / Strikethrough toggles. */}
                    {[
                      ['B', 'bold', 'toggleBold', { fontWeight: 700 }],
                      ['I', 'italic', 'toggleItalic', { fontStyle: 'italic' }],
                      ['U', 'underline', 'toggleUnderline', { textDecoration: 'underline' }],
                      ['S', 'strike', 'toggleStrike', { textDecoration: 'line-through' }],
                    ].map(([label, stateKey, apiKey, fontStyleOverride]) => {
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
                          style={{
                            width: '28px',
                            height: '24px',
                            padding: 0,
                            background: isOn ? 'rgba(216,168,78,0.18)' : '#444',
                            color: isOn ? '#d8a84e' : '#ddd',
                            border: '1px solid transparent',
                            borderRadius: '5px',
                            fontSize: '13px',
                            fontFamily: FONT_FAMILY,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            ...fontStyleOverride,
                          }}
                          title={label === 'B' ? 'Bold' : label === 'I' ? 'Italic' : label === 'U' ? 'Underline' : 'Strikethrough'}
                          aria-label={label === 'B' ? 'Bold' : label === 'I' ? 'Italic' : label === 'U' ? 'Underline' : 'Strikethrough'}
                          aria-pressed={isOn}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {/* Alignment — 28x26 trigger with 3x3 mini-grid, opens a
                        "Text alignment" popover that picks horizontal +
                        vertical anchor at once. */}
                    {(() => {
                      const hAlign = bottomToolbarApi.richTextEditor?.state?.textAlign || 'left';
                      const vAlign = bottomToolbarApi.richTextEditor?.state?.verticalAlign || 'top';
                      const labelFor = (v, h) => `${v}-${h === 'center' ? 'center' : h}`;
                      const isCellActive = (v, h) => v === vAlign && h === hAlign;
                      return (
                        <div data-align-grid style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            fontSize: '10.5px',
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            color: '#9ca3af',
                            fontFamily: FONT_FAMILY,
                          }}>Align</span>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onClick={() => setShowAlignGrid((v) => !v)}
                            style={{
                              width: '28px',
                              height: '26px',
                              padding: 0,
                              background: '#2a2e36',
                              border: '1px solid #383d46',
                              borderRadius: '5px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            title="Text alignment"
                            aria-label="Text alignment"
                          >
                            <span style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(3, 4px)',
                              gridTemplateRows: 'repeat(3, 4px)',
                              gap: '2px',
                            }}>
                              {['top', 'middle', 'bottom'].flatMap((v) => ['left', 'center', 'right'].map((h) => {
                                const on = isCellActive(v, h);
                                return (
                                  <span key={labelFor(v, h)} style={{
                                    width: '4px',
                                    height: '4px',
                                    borderRadius: '1px',
                                    background: on ? '#d8a84e' : 'rgba(168,176,191,0.4)',
                                    boxShadow: on ? '0 0 0 1px rgba(216,168,78,0.25)' : 'none',
                                  }} />
                                );
                              }))}
                            </span>
                          </button>
                          {showAlignGrid && (
                            <div style={{
                              position: 'absolute',
                              top: 'calc(100% + 6px)',
                              right: 0,
                              zIndex: 5600,
                              background: '#1e2026',
                              border: '1px solid #383d46',
                              borderRadius: '8px',
                              padding: '10px',
                              boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
                            }}>
                              <div style={{
                                fontSize: '10.5px',
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                                color: '#9ca3af',
                                marginBottom: '8px',
                                fontFamily: FONT_FAMILY,
                              }}>Text alignment</div>
                              <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 26px)',
                                gap: '4px',
                              }}>
                                {['top', 'middle', 'bottom'].flatMap((v) => ['left', 'center', 'right'].map((h) => {
                                  const on = isCellActive(v, h);
                                  return (
                                    <button
                                      key={labelFor(v, h)}
                                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                      onClick={() => {
                                        bottomToolbarApi.richTextEditor?.api?.setTextAlign?.(h);
                                        bottomToolbarApi.richTextEditor?.api?.setVerticalAlign?.(v);
                                        setShowAlignGrid(false);
                                      }}
                                      style={{
                                        appearance: 'none',
                                        width: '26px',
                                        height: '26px',
                                        background: on ? 'rgba(216,168,78,0.10)' : '#14171c',
                                        border: on ? '1px solid #d8a84e' : '1px solid #2a2e36',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: 0,
                                      }}
                                      title={`${v} ${h}`}
                                      aria-label={`${v} ${h}`}
                                    >
                                      <span style={{
                                        width: '6px',
                                        height: '6px',
                                        borderRadius: '50%',
                                        background: on ? '#d8a84e' : '#5a606a',
                                      }} />
                                    </button>
                                  );
                                }))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>,
                  document.getElementById('chrome-sub-toolbar-host')
                )}
                <>
                {/* 2026-05-25: Eraser hides the color swatch entirely — only
                    the diameter input below remains visible for that tool. */}
                {bottomToolbarApi.activeTool !== 'eraser' && (
                  <>
                {!bottomToolbarApi.richTextEditor && (bottomToolbarApi.contextTool === 'pen' || bottomToolbarApi.contextTool === 'highlighter' || bottomToolbarApi.contextTool === 'arrow' || bottomToolbarApi.contextTool === 'line') ? (
                  /* 2026-05-25: Stroke-only swatch (pen, highlighter, arrow,
                     line). Checker pattern shows through low-opacity strokes
                     and a faint hairline ring lifts pure black off the dark
                     toolbar — both behaviours come from .ctx-color-swatch. */
                  <button
                    onClick={() => bottomToolbarApi.setShowAnnotationColorPicker(!bottomToolbarApi.showAnnotationColorPicker)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="ctx-color-swatch"
                    style={{
                      width: '24px',
                      height: '24px',
                      padding: 0,
                      borderRadius: '50%',
                      border: 'none',
                      position: 'relative',
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                      cursor: 'pointer'
                    }}
                    title="Color"
                    aria-label="Color"
                  >
                    <span
                      className="ctx-color-fill"
                      style={{
                        background: ensureRgbaOpacity(bottomToolbarApi.strokeColor || '#000000', (bottomToolbarApi.strokeOpacity ?? 100) / 100)
                      }}
                    />
                  </button>
                ) : bottomToolbarApi.contextTool === 'counter' && bottomToolbarApi.handleFillColorChange ? (
                  /* 2026-05-25: Counter swatch — a literal preview of the pin.
                     Background disc = fill colour (pin colour), the centred
                     "1" = stroke colour (number colour). Updates live as the
                     user picks colours so they always see what the next pin
                     will look like, instead of an abstract ring + disc. */
                  <button
                    onClick={() => {
                      bottomToolbarApi.setShowAnnotationColorPicker(!bottomToolbarApi.showAnnotationColorPicker);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="ctx-color-swatch"
                    style={{
                      width: '24px',
                      height: '24px',
                      padding: 0,
                      borderRadius: '50%',
                      border: 'none',
                      boxSizing: 'border-box',
                      position: 'relative',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="Counter colors"
                    aria-label="Counter colors"
                  >
                    <span
                      className="ctx-color-fill"
                      style={{
                        background: ensureRgbaOpacity(bottomToolbarApi.fillColor || '#ef4444', (bottomToolbarApi.fillOpacity ?? 100) / 100)
                      }}
                    />
                    <span style={{
                      position: 'relative',
                      zIndex: 2,
                      fontSize: '12px',
                      fontWeight: 700,
                      lineHeight: 1,
                      color: ensureRgbaOpacity(bottomToolbarApi.strokeColor || '#ffffff', (bottomToolbarApi.strokeOpacity ?? 100) / 100),
                      fontFamily: FONT_FAMILY,
                      pointerEvents: 'none'
                    }}>1</span>
                  </button>
                ) : (bottomToolbarApi.contextTool === 'rect' || bottomToolbarApi.contextTool === 'ellipse' || bottomToolbarApi.contextTool === 'text' || bottomToolbarApi.contextTool === 'callout' || !!bottomToolbarApi.richTextEditor) && bottomToolbarApi.handleFillColorChange ? (
                  /* 2026-05-25: Fill + border swatch. Checker shows through
                     low-opacity fills, faint hairline lifts black borders. */
                  <button
                    onClick={() => {
                      bottomToolbarApi.setShowAnnotationColorPicker(!bottomToolbarApi.showAnnotationColorPicker);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="ctx-color-swatch"
                    style={{
                      width: '24px',
                      height: '24px',
                      padding: 0,
                      borderRadius: '50%',
                      border: `2px solid ${ensureRgbaOpacity(bottomToolbarApi.strokeColor || '#000000', (bottomToolbarApi.strokeOpacity ?? 100) / 100)}`,
                      boxSizing: 'border-box',
                      position: 'relative',
                      overflow: 'hidden',
                      cursor: 'pointer'
                    }}
                    title="Color"
                    aria-label="Color"
                  >
                    <span
                      className="ctx-color-fill"
                      style={{
                        background: ensureRgbaOpacity(bottomToolbarApi.fillColor || '#ffffff', (bottomToolbarApi.fillOpacity ?? 100) / 100)
                      }}
                    />
                  </button>
                ) : null}

                {!bottomToolbarApi.richTextEditor
                  && bottomToolbarApi.contextTool === 'counter'
                  && bottomToolbarApi.onNewCounterSeries
                  && (() => {
                    const seriesList = Array.isArray(bottomToolbarApi.counterSeriesList)
                      ? bottomToolbarApi.counterSeriesList
                      : [];
                    const activeSeries = seriesList.find((s) => s.seriesId === bottomToolbarApi.activeCounterSeriesId);
                    const seriesLabel = activeSeries?.label || 'Counter Series';
                    return (
                      <div data-counter-series-menu style={{ position: 'relative' }}>
                        <button
                          onClick={() => setShowCounterSeriesMenu((open) => !open)}
                          onMouseDown={(e) => e.stopPropagation()}
                          style={{
                            height: '24px',
                            padding: '0 22px 0 8px',
                            background: '#444',
                            color: '#ddd',
                            border: '1px solid transparent',
                            borderRadius: '5px',
                            fontSize: '12px',
                            fontFamily: FONT_FAMILY,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            backgroundImage:
                              'linear-gradient(45deg, transparent 50%, #aaa 50%), linear-gradient(135deg, #aaa 50%, transparent 50%)',
                            backgroundPosition: 'calc(100% - 11px) 10px, calc(100% - 7px) 10px',
                            backgroundSize: '4px 4px, 4px 4px',
                            backgroundRepeat: 'no-repeat',
                          }}
                          title="Counter series"
                          aria-label="Counter series"
                          aria-expanded={showCounterSeriesMenu}
                        >
                          <span style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            background: activeSeries?.color || bottomToolbarApi.fillColor || '#ef4444',
                            border: '1px solid rgba(255,255,255,0.15)',
                            flexShrink: 0,
                          }} />
                          <span>{seriesLabel}</span>
                        </button>
                        {showCounterSeriesMenu && (
                          <div style={{
                            position: 'absolute',
                            top: 'calc(100% + 4px)',
                            left: 0,
                            background: '#1e1e1e',
                            border: '1px solid #444',
                            borderRadius: '6px',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                            padding: '4px',
                            zIndex: 5600,
                            minWidth: '160px',
                            color: '#DDD',
                            fontFamily: FONT_FAMILY,
                            fontSize: '12px',
                          }}>
                            <div style={{
                              padding: '4px 8px',
                              fontSize: '10px',
                              color: '#888',
                              textTransform: 'uppercase',
                              fontWeight: 600,
                              borderBottom: '1px solid #333',
                              marginBottom: '4px',
                            }}>
                              Counter Series
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                bottomToolbarApi.onNewCounterSeries();
                                setShowCounterSeriesMenu(false);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                width: '100%',
                                gap: '8px',
                                padding: '6px 10px',
                                background: 'transparent',
                                border: 'none',
                                borderRadius: '4px',
                                color: '#DDD',
                                textAlign: 'left',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontFamily: 'inherit',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a2a'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              + New Count
                            </button>
                            {seriesList.length > 0 && (
                              <div style={{
                                padding: '6px 8px 4px',
                                color: '#888',
                                fontSize: '10px',
                                textTransform: 'uppercase',
                                fontWeight: 600,
                              }}>
                                Continue Count
                              </div>
                            )}
                            {seriesList.map((series) => {
                              const isActive = series.seriesId === bottomToolbarApi.activeCounterSeriesId;
                              return (
                                <button
                                  key={series.seriesId}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    bottomToolbarApi.onSwitchCounterSeries(series.seriesId);
                                    setShowCounterSeriesMenu(false);
                                  }}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    width: '100%',
                                    gap: '8px',
                                    padding: '6px 10px',
                                    background: isActive ? '#2a2a2a' : 'transparent',
                                    border: 'none',
                                    borderRadius: '4px',
                                    color: '#DDD',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontFamily: 'inherit',
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a2a'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? '#2a2a2a' : 'transparent'; }}
                                >
                                  <span style={{
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    background: series.color,
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    flexShrink: 0,
                                  }} />
                                  <span style={{ flex: 1 }}>{series.label}</span>
                                  <span style={{ fontSize: '10px', color: '#888' }}>{series.count}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                {bottomToolbarApi.showAnnotationColorPicker && (() => {
                  const isShape = (bottomToolbarApi.contextTool === 'rect' || bottomToolbarApi.contextTool === 'ellipse' || bottomToolbarApi.contextTool === 'text' || bottomToolbarApi.contextTool === 'callout' || bottomToolbarApi.contextTool === 'counter')
                    && bottomToolbarApi.handleFillColorChange;
                  const isCounter = bottomToolbarApi.contextTool === 'counter';
                  const secondTabLabel = isCounter ? 'Number' : 'Border';
                  const onFillTab = isShape && colorPickerTab === 'fill';
                  // 2026-05-25: Shapes (rectangle + ellipse) follow one rule —
                  // at least one side must stay visible. Either the fill or
                  // the border can be transparent, but never both at the same
                  // time. When the user takes the side they're editing to 0
                  // while the other side is already at 0, the other side gets
                  // bumped to fully opaque so the shape stays visible. Text
                  // and Callout opt out (their borders + fills are optional).
                  const shapeOneVisibleRule = bottomToolbarApi.contextTool === 'rect'
                    || bottomToolbarApi.contextTool === 'ellipse';
                  const currentColor = onFillTab ? (bottomToolbarApi.fillColor || '#ff0000') : bottomToolbarApi.strokeColor;
                  const currentOpacity = onFillTab ? ((bottomToolbarApi.fillOpacity ?? 100) / 100) : (bottomToolbarApi.strokeOpacity / 100);
                  const applyChange = (hex, alpha) => {
                    if (onFillTab) {
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
                  };
                  return (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: '50%',
                      marginTop: '10px',
                      transform: 'translate(-50%, 0)',
                      zIndex: 2000
                    }}>
                      {isShape && (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          background: '#1e1e1e',
                          border: '1px solid #333',
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
                                onClick={() => setColorPickerTab(k)}
                                onMouseDown={(e) => e.stopPropagation()}
                                style={{
                                  background: on ? 'rgba(216,168,78,0.08)' : 'transparent',
                                  color: on ? '#eee' : '#888',
                                  fontWeight: 600,
                                  fontSize: 12,
                                  padding: '8px 0',
                                  border: 0,
                                  borderRight: i === 0 ? '1px solid #333' : 0,
                                  cursor: 'pointer',
                                  position: 'relative'
                                }}
                              >
                                {label}
                                {on && (
                                  <span style={{
                                    position: 'absolute', left: 0, right: 0, bottom: 0,
                                    height: 2, background: '#d8a84e'
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
                          onChange={applyChange}
                          onClose={() => bottomToolbarApi.setShowAnnotationColorPicker(false)}
                          firstPreset={(shapeOneVisibleRule && !onFillTab)
                            ? { kind: 'match', color: bottomToolbarApi.fillColor || '#ffffff', opacity: (bottomToolbarApi.fillOpacity ?? 100) / 100 }
                            : 'transparent'}
                        />
                      </Suspense>
                    </div>
                  );
                })()}
                  </>
                )}

                {bottomToolbarApi.activeTool === 'eraser' && bottomToolbarApi.setEraserMode && (
                  <div data-eraser-type-menu style={{ position: 'relative' }}>
                    <button
                      onClick={() => setShowEraserTypeMenu((open) => !open)}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        height: '24px',
                        padding: '0 22px 0 8px',
                        background: '#444',
                        color: '#ddd',
                        border: '1px solid transparent',
                        borderRadius: '5px',
                        fontSize: '12px',
                        fontFamily: FONT_FAMILY,
                        cursor: 'pointer',
                        backgroundImage:
                          'linear-gradient(45deg, transparent 50%, #aaa 50%), linear-gradient(135deg, #aaa 50%, transparent 50%)',
                        backgroundPosition: 'calc(100% - 11px) 10px, calc(100% - 7px) 10px',
                        backgroundSize: '4px 4px, 4px 4px',
                        backgroundRepeat: 'no-repeat'
                      }}
                      title="Eraser type"
                      aria-label="Eraser type"
                      aria-expanded={showEraserTypeMenu}
                    >
                      {bottomToolbarApi.eraserMode === 'entire' ? 'Full Stroke' : 'Partial Erase'}
                    </button>
                    {showEraserTypeMenu && (
                      <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        background: '#1e1e1e',
                        border: '1px solid #444',
                        borderRadius: '6px',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                        padding: '4px',
                        zIndex: 5600,
                        minWidth: '142px',
                        whiteSpace: 'nowrap'
                      }}>
                        {[
                          ['partial', 'Partial Erase'],
                          ['entire', 'Full Stroke Erase']
                        ].map(([value, label]) => {
                          const isOn = bottomToolbarApi.eraserMode === value;
                          return (
                            <button
                              key={value}
                              onClick={() => {
                                bottomToolbarApi.setEraserMode(value);
                                setShowEraserTypeMenu(false);
                              }}
                              style={{
                                display: 'block',
                                width: '100%',
                                padding: '6px 10px',
                                background: isOn ? 'rgba(216,168,78,0.12)' : 'transparent',
                                color: isOn ? '#d8a84e' : '#ddd',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                textAlign: 'left',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={(e) => { if (!isOn) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                              onMouseLeave={(e) => { if (!isOn) e.currentTarget.style.background = 'transparent'; }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {(bottomToolbarApi.contextTool === 'pen'
                  || bottomToolbarApi.contextTool === 'highlighter'
                  || bottomToolbarApi.contextTool === 'arrow'
                  || bottomToolbarApi.contextTool === 'line'
                  || bottomToolbarApi.contextTool === 'rect'
                  || bottomToolbarApi.contextTool === 'ellipse'
                  || bottomToolbarApi.contextTool === 'text'
                  || bottomToolbarApi.contextTool === 'callout'
                  || bottomToolbarApi.contextTool === 'counter'
                  || bottomToolbarApi.activeTool === 'eraser') && (
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="no-spin-buttons"
                  value={bottomToolbarApi.activeTool === 'eraser' ? bottomToolbarApi.eraserSizeInputValue : bottomToolbarApi.strokeWidthInputValue}
                  onChange={bottomToolbarApi.activeTool === 'eraser' ? bottomToolbarApi.handleEraserSizeInputChange : bottomToolbarApi.handleStrokeWidthInputChange}
                  onFocus={() => bottomToolbarApi.activeTool === 'eraser' ? bottomToolbarApi.setIsEraserSizeFocused(true) : bottomToolbarApi.setIsStrokeWidthFocused(true)}
                  onBlur={bottomToolbarApi.activeTool === 'eraser' ? bottomToolbarApi.handleEraserSizeInputBlur : bottomToolbarApi.handleStrokeWidthInputBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.target.blur();
                    }
                  }}
                  style={{
                    width: '36px',
                    height: '20px',
                    padding: '4px 4px',
                    background: '#444',
                    color: '#ddd',
                    border: '1px solid transparent',
                    borderRadius: '5px',
                    fontSize: '12px',
                    fontFamily: FONT_FAMILY,
                    textAlign: 'center'
                  }}
                  title="Width"
                />
                )}
                {/* 2026-05-25: Style picker — solid/dashed/dotted for line + arrow;
                    solid/dashed/dotted/cloud for rectangle; solid/dashed/dotted
                    for ellipse (no cloud option). Always opens downward. */}
                {(bottomToolbarApi.contextTool === 'arrow' || bottomToolbarApi.contextTool === 'line' || bottomToolbarApi.contextTool === 'rect' || bottomToolbarApi.contextTool === 'ellipse' || bottomToolbarApi.contextTool === 'text' || bottomToolbarApi.contextTool === 'callout') && bottomToolbarApi.setLineBorderStyle && (
                  <div data-style-menu style={{ position: 'relative' }}>
                    <button
                      onClick={() => setShowStyleMenu(!showStyleMenu)}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        height: '24px',
                        padding: '0 22px 0 8px',
                        background: '#444',
                        color: '#ddd',
                        border: '1px solid transparent',
                        borderRadius: '5px',
                        fontSize: '12px',
                        fontFamily: FONT_FAMILY,
                        cursor: 'pointer',
                        backgroundImage:
                          'linear-gradient(45deg, transparent 50%, #aaa 50%), linear-gradient(135deg, #aaa 50%, transparent 50%)',
                        backgroundPosition: 'calc(100% - 11px) 10px, calc(100% - 7px) 10px',
                        backgroundSize: '4px 4px, 4px 4px',
                        backgroundRepeat: 'no-repeat'
                      }}
                      title="Style"
                      aria-label="Style"
                    >
                      {{ solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', cloud: 'Cloud' }[bottomToolbarApi.lineBorderStyle] || 'Solid'}
                    </button>
                    {showStyleMenu && (
                      <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        background: '#1e1e1e',
                        border: '1px solid #444',
                        borderRadius: '6px',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                        padding: '4px',
                        zIndex: 5600,
                        minWidth: '120px',
                        whiteSpace: 'nowrap'
                      }}>
                        {[
                          ['solid','Solid'],
                          ['dashed','Dashed'],
                          ['dotted','Dotted'],
                          ...(bottomToolbarApi.contextTool === 'rect' ? [['cloud','Cloud']] : [])
                        ].map(([val, label]) => {
                          const isOn = bottomToolbarApi.lineBorderStyle === val;
                          return (
                            <button
                              key={val}
                              onClick={() => {
                                bottomToolbarApi.setLineBorderStyle(val);
                                setShowStyleMenu(false);
                              }}
                              style={{
                                display: 'block',
                                width: '100%',
                                padding: '6px 10px',
                                background: isOn ? 'rgba(216,168,78,0.12)' : 'transparent',
                                color: isOn ? '#d8a84e' : '#ddd',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                textAlign: 'left',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={(e) => { if (!isOn) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                              onMouseLeave={(e) => { if (!isOn) e.currentTarget.style.background = 'transparent'; }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {/* 2026-05-25: Bump number input — only shows for rectangle when
                    the border style is Cloud. Drives how big the cloud's wave
                    bumps render. Mirrors the width input visual. */}
                {bottomToolbarApi.contextTool === 'rect' && bottomToolbarApi.lineBorderStyle === 'cloud' && bottomToolbarApi.setCloudIntensity && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#bbb', fontSize: '11px', fontFamily: FONT_FAMILY }}>
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
                        background: '#444',
                        color: '#ddd',
                        border: '1px solid transparent',
                        borderRadius: '5px',
                        fontSize: '12px',
                        fontFamily: FONT_FAMILY,
                        textAlign: 'center'
                      }}
                      title="Cloud bump size"
                    />
                  </label>
                )}
                {/* 2026-05-25: Arrow tool (or selected callout) — custom
                    arrowhead menu that always opens downward and shows every
                    option at once (native select scrolls / picks its own
                    direction). Callouts have their own arrowhead end so the
                    same picker drives both. */}
                {(bottomToolbarApi.contextTool === 'arrow' || bottomToolbarApi.contextTool === 'callout') && bottomToolbarApi.setArrowheadStyle && (
                  <div data-arrowhead-menu style={{ position: 'relative' }}>
                    <button
                      onClick={() => setShowArrowheadMenu(!showArrowheadMenu)}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        height: '24px',
                        padding: '0 22px 0 8px',
                        background: '#444',
                        color: '#ddd',
                        border: '1px solid transparent',
                        borderRadius: '5px',
                        fontSize: '12px',
                        fontFamily: FONT_FAMILY,
                        cursor: 'pointer',
                        backgroundImage:
                          'linear-gradient(45deg, transparent 50%, #aaa 50%), linear-gradient(135deg, #aaa 50%, transparent 50%)',
                        backgroundPosition: 'calc(100% - 11px) 10px, calc(100% - 7px) 10px',
                        backgroundSize: '4px 4px, 4px 4px',
                        backgroundRepeat: 'no-repeat'
                      }}
                      title="Arrowhead"
                      aria-label="Arrowhead"
                    >
                      {ARROWHEAD_STYLE_LABELS[bottomToolbarApi.arrowheadStyle] || 'Solid Triangle'}
                    </button>
                    {showArrowheadMenu && (
                      <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        background: '#1e1e1e',
                        border: '1px solid #444',
                        borderRadius: '6px',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                        padding: '4px',
                        zIndex: 5600,
                        minWidth: '160px',
                        whiteSpace: 'nowrap'
                      }}>
                        {Object.entries(ARROWHEAD_STYLE_LABELS).map(([val, label]) => {
                          const isOn = bottomToolbarApi.arrowheadStyle === val;
                          return (
                            <button
                              key={val}
                              onClick={() => {
                                bottomToolbarApi.setArrowheadStyle(val);
                                setShowArrowheadMenu(false);
                              }}
                              style={{
                                display: 'block',
                                width: '100%',
                                padding: '6px 10px',
                                background: isOn ? 'rgba(216,168,78,0.12)' : 'transparent',
                                color: isOn ? '#d8a84e' : '#ddd',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                textAlign: 'left',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={(e) => {
                                if (!isOn) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                              }}
                              onMouseLeave={(e) => {
                                if (!isOn) e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
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
                      height: '24px',
                      padding: '0 8px',
                      background: bottomToolbarApi.richTextEditor ? 'rgba(216,168,78,0.18)' : '#444',
                      color: bottomToolbarApi.richTextEditor
                        ? '#d8a84e'
                        : bottomToolbarApi.canEnterTextEdit ? '#ddd' : '#666',
                      border: '1px solid transparent',
                      borderRadius: '5px',
                      fontSize: '13px',
                      fontWeight: 600,
                      fontFamily: FONT_FAMILY,
                      cursor: bottomToolbarApi.canEnterTextEdit ? 'pointer' : 'not-allowed',
                      opacity: bottomToolbarApi.canEnterTextEdit ? 1 : 0.5,
                      lineHeight: 1,
                    }}
                    title={bottomToolbarApi.canEnterTextEdit
                      ? 'Edit text'
                      : 'Select a text box or callout to edit its text'}
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
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex' }}>
          <div
            id="chrome-left-host"
            style={{
              display: isViewerVisible ? 'flex' : 'none',
              flex: '0 0 48px',
              width: '48px',
              flexShrink: 0,
              minWidth: '48px',
              alignSelf: 'stretch',
              background: '#252525',
              color: '#ddd',
              fontFamily: FONT_FAMILY,
              overflow: 'visible',
              position: 'relative',
              zIndex: 5600
            }}
          >
            {leftRailApi && <PDFSidebar {...leftRailApi} />}
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
                display: isViewerVisible ? 'block' : 'none',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                background: '#2b2b2b',
                cursor: 'default',
                zIndex: 5400
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
                    background: '#1f1f1f',
                    zIndex: isVisible ? 5000 : 4000, // Keep lower z-index when hidden
                    display: isVisible ? 'block' : 'none'
                  }}
                >
                  <YDocProvider docId={tab.file?.id}>
                    {/* KAL-49 — document lock banner. Mounted as a sibling
                        inside YDocProvider so it sees the same per-tab Y.Doc
                        scope (the lock state is a document-level concept and
                        keys on the same documentId). */}
                    <DocumentLockBanner
                      documentId={tab.file?.id || null}
                      viewerUserId={user?.id || null}
                    />
                    <Suspense fallback={null}>
                    <PDFViewer
                      pdfFile={tab.file}
                      pdfFilePath={tab.filePath}
                      onBack={handleBack}
                      tabId={tab.id}
                      isActive={isVisible}
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
              flex: '0 0 48px',
              flexShrink: 0,
              width: '48px',
              minWidth: '48px',
              overflow: 'visible',
              alignSelf: 'stretch',
              background: '#252525',
              color: '#ddd',
              fontFamily: FONT_FAMILY,
              flexDirection: 'column',
              alignItems: 'center',
              padding: 0,
              gap: 0,
              position: 'relative',
              zIndex: 5600
            }}
          >
            {rightRailApi && <SurveySpacesRail {...rightRailApi} />}
            {/* Spacer pushes the bottom slot to the bottom of the rail. */}
            <div style={{ flex: 1 }} />

            {/* Bottom slot — page nav above zoom controls. All handlers come
                from bottomToolbarApi which PDFViewer already publishes.
                UX 2026-05-14: Sizing matched to the Walkthrough reference
                app — smaller buttons (24-28px), 10px tabular-nums fonts,
                and a middle dot between current page and total instead of
                a slash. Tighter overall to fit the 48px-wide rail more
                neatly. */}
            {false /* UX 2026-05-29: page/zoom/fit moved to the top-right pill above; this vertical strip is retired and chrome-right-host is the Survey rail. */ && bottomToolbarApi && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                {/* Page previous — chevron up because vertical layout */}
                <button
                  onClick={bottomToolbarApi.goToPreviousPage}
                  disabled={bottomToolbarApi.pageNum <= 1}
                  title="Previous page"
                  style={{
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#bbb',
                    cursor: bottomToolbarApi.pageNum <= 1 ? 'not-allowed' : 'pointer',
                    opacity: bottomToolbarApi.pageNum <= 1 ? 0.35 : 1
                  }}
                >
                  <Icon name="chevronUp" size={14} />
                </button>

                {/* Current page — Walkthrough-style: a plain accent-colored
                    number by default, click or double-click to edit. The
                    input only mounts while editing so the dot above and
                    total below stay perfectly centered around a single
                    number glyph. */}
                {isEditingRailPage ? (
                  <input
                    ref={bottomToolbarApi.pageInputRef}
                    type="text"
                    data-page-number-input
                    autoFocus
                    value={bottomToolbarApi.pageInputValue}
                    onChange={bottomToolbarApi.handlePageInputChange}
                    onKeyDown={(e) => {
                      bottomToolbarApi.handlePageInputKeyDown(e);
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        setIsEditingRailPage(false);
                      }
                    }}
                    onBlur={(e) => {
                      bottomToolbarApi.handlePageInputBlur(e);
                      setIsEditingRailPage(false);
                    }}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Current page"
                    style={{
                      width: '28px',
                      padding: 0,
                      background: 'transparent',
                      color: '#4A90E2',
                      border: 'none',
                      fontSize: '11px',
                      fontFamily: FONT_FAMILY,
                      fontWeight: '600',
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'center',
                      outline: 'none',
                      lineHeight: 1
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingRailPage(true)}
                    onDoubleClick={() => setIsEditingRailPage(true)}
                    aria-label="Edit page number"
                    title="Click to jump to a page"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#4A90E2',
                      fontSize: '11px',
                      fontFamily: FONT_FAMILY,
                      fontWeight: '600',
                      fontVariantNumeric: 'tabular-nums',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      lineHeight: 1
                    }}
                  >
                    {bottomToolbarApi.pageNum}
                  </button>
                )}

                {/* Middle dot — sits between current page input above and
                    total page count below, matching the Walkthrough slim
                    rail convention. Tabular-nums on the total keeps "9"
                    and "99" centered identically. */}
                <span aria-hidden="true" style={{
                  color: '#888',
                  fontSize: '14px',
                  lineHeight: 0.5,
                  fontFamily: FONT_FAMILY
                }}>·</span>
                <span style={{
                  color: '#888',
                  fontSize: '10px',
                  fontFamily: FONT_FAMILY,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1
                }}>
                  {bottomToolbarApi.numPages}
                </span>

                {/* Page next — chevron down */}
                <button
                  onClick={bottomToolbarApi.goToNextPage}
                  disabled={bottomToolbarApi.pageNum >= bottomToolbarApi.numPages}
                  title="Next page"
                  style={{
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#bbb',
                    cursor: bottomToolbarApi.pageNum >= bottomToolbarApi.numPages ? 'not-allowed' : 'pointer',
                    opacity: bottomToolbarApi.pageNum >= bottomToolbarApi.numPages ? 0.35 : 1
                  }}
                >
                  <Icon name="chevronDown" size={14} />
                </button>

                {/* Divider between page nav and zoom — Walkthrough's
                    rail-collapsed divider style (1px tall, 32px wide). */}
                <div style={{ width: '32px', height: '1px', background: '#3a3a3a', margin: '4px 0' }} />

                {/* Zoom in (plus). 28×28 button, plain English '+' glyph so
                    the rail reads cleanly without leaning on the icon set
                    for character-based buttons. */}
                <button
                  onClick={bottomToolbarApi.zoomIn}
                  title="Zoom in"
                  style={{
                    width: '28px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#bbb',
                    fontSize: '16px',
                    lineHeight: 1,
                    cursor: 'pointer'
                  }}
                >
                  <Icon name="plus" size={14} />
                </button>

                {/* Zoom percentage — Walkthrough-style: shows the value as
                    "100%" with no input box by default, click swaps to an
                    editable input. Centered in the rail. The handlers
                    already clamp on commit (10%–500%) and during typing
                    (max 500%), matching the app's actual zoom range. */}
                {isEditingRailZoom ? (
                  <input
                    ref={bottomToolbarApi.zoomInputRef}
                    type="text"
                    autoFocus
                    value={bottomToolbarApi.zoomInputValue}
                    onChange={bottomToolbarApi.handleZoomInputChange}
                    onKeyDown={(e) => {
                      bottomToolbarApi.handleZoomInputKeyDown(e);
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        setIsEditingRailZoom(false);
                      }
                    }}
                    onBlur={(e) => {
                      bottomToolbarApi.handleZoomInputBlur(e);
                      setIsEditingRailZoom(false);
                    }}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Zoom percentage"
                    style={{
                      width: '36px',
                      background: 'transparent',
                      color: '#bbb',
                      border: 'none',
                      padding: 0,
                      margin: 0,
                      fontSize: '10px',
                      fontFamily: FONT_FAMILY,
                      fontWeight: '500',
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'center',
                      outline: 'none',
                      lineHeight: 1
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingRailZoom(true)}
                    onDoubleClick={() => setIsEditingRailZoom(true)}
                    aria-label="Edit zoom percentage"
                    title="Click to type a zoom percentage"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#bbb',
                      fontSize: '10px',
                      fontFamily: FONT_FAMILY,
                      fontWeight: '500',
                      fontVariantNumeric: 'tabular-nums',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      lineHeight: 1,
                      textAlign: 'center'
                    }}
                  >
                    {bottomToolbarApi.zoomInputValue || Math.round((bottomToolbarApi.manualZoomScale || 1) * 100)}%
                  </button>
                )}

                {/* Zoom out (minus) */}
                <button
                  onClick={bottomToolbarApi.zoomOut}
                  title="Zoom out"
                  style={{
                    width: '28px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#bbb',
                    fontSize: '16px',
                    lineHeight: 1,
                    cursor: 'pointer'
                  }}
                >
                  <Icon name="minus" size={14} />
                </button>

                {/* Page-fit button — matches the Walkthrough slim-rail
                    pattern exactly: a 36×28 cell with the current fit
                    mode's icon centered (page / width / height SVG) and
                    a small left-pointing chevron pinned to the left edge
                    indicating the popup expands to the LEFT. Popup width
                    144 px, anchored to the rail's left edge. */}
                {(() => {
                  const mode = bottomToolbarApi.zoomMode;
                  // Fall back to fit-page icon when mode is MANUAL or unknown.
                  const iconMode = (mode === ZOOM_MODES.FIT_WIDTH || mode === ZOOM_MODES.FIT_HEIGHT) ? mode : ZOOM_MODES.FIT_PAGE;
                  const renderFitIcon = (m) => {
                    const stroke = {
                      fill: 'none',
                      stroke: 'currentColor',
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                      strokeWidth: 1.7
                    };
                    if (m === ZOOM_MODES.FIT_WIDTH) {
                      return (
                        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: '16px', height: '16px' }}>
                          <rect x="4" y="5" width="16" height="14" rx="1.5" {...stroke} />
                          <path d="M7 12h10M7 12l3-3M7 12l3 3M17 12l-3-3M17 12l-3 3" {...stroke} />
                        </svg>
                      );
                    }
                    if (m === ZOOM_MODES.FIT_HEIGHT) {
                      return (
                        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: '16px', height: '16px' }}>
                          <rect x="5" y="4" width="14" height="16" rx="1.5" {...stroke} />
                          <path d="M12 7v10M12 7l-3 3M12 7l3 3M12 17l-3-3M12 17l3-3" {...stroke} />
                        </svg>
                      );
                    }
                    // fit-page (default)
                    return (
                      <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: '16px', height: '16px' }}>
                        <rect x="6" y="3" width="12" height="18" rx="1.5" {...stroke} />
                        <path d="M9 7h6M9 11h6M9 15h4" {...stroke} />
                      </svg>
                    );
                  };
                  return (
                    <div
                      ref={bottomToolbarApi.zoomMenuRef}
                      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                    >
                      <button
                        onClick={bottomToolbarApi.toggleZoomMenu}
                        aria-haspopup="listbox"
                        aria-expanded={bottomToolbarApi.isZoomMenuOpen}
                        aria-label="Fit options"
                        data-active={mode !== ZOOM_MODES.MANUAL}
                        title={`Page fit: ${bottomToolbarApi.zoomDropdownLabel}`}
                        style={{
                          position: 'relative',
                          width: '36px',
                          height: '28px',
                          padding: 0,
                          background: 'transparent',
                          border: 'none',
                          borderRadius: '2px',
                          color: mode !== ZOOM_MODES.MANUAL ? '#e0e0e0' : '#bbb',
                          cursor: 'pointer'
                        }}
                      >
                        {/* Left-edge chevron — points LEFT to signal the
                            popup expands leftward when clicked. */}
                        <svg
                          viewBox="0 0 12 12"
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            left: '2px',
                            top: '50%',
                            width: '12px',
                            height: '12px',
                            transform: 'translateY(-50%)',
                            fill: 'none',
                            stroke: 'currentColor',
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                            strokeWidth: 1.8
                          }}
                        >
                          <path d="M7.5 2.5 4 6l3.5 3.5" />
                        </svg>
                        {/* Fit icon centered. */}
                        <span style={{
                          position: 'absolute',
                          left: '50%',
                          top: '50%',
                          transform: 'translate(-50%, -50%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          {renderFitIcon(iconMode)}
                        </span>
                      </button>

                  {bottomToolbarApi.isZoomMenuOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        right: '100%',
                        marginRight: '6px',
                        background: 'rgb(30, 30, 30)',
                        border: '1px solid #3a3a3a',
                        borderRadius: '2px',
                        boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
                        width: '144px',
                        zIndex: 6000,
                        padding: '2px'
                      }}
                    >
                      {ZOOM_MODE_OPTIONS.map((option) => {
                        if (option.id === ZOOM_MODES.MANUAL) return null;
                        const isActive = option.id === bottomToolbarApi.zoomMode;
                        return (
                          <button
                            key={option.id}
                            onClick={() => bottomToolbarApi.handleZoomModeSelect(option.id)}
                            data-active={isActive}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '6px 8px',
                              background: 'transparent',
                              border: 'none',
                              borderRadius: '2px',
                              textAlign: 'left',
                              cursor: 'pointer',
                              color: isActive ? '#e0e0e0' : '#bbb',
                              fontSize: '11px',
                              fontFamily: FONT_FAMILY
                            }}
                          >
                            {renderFitIcon(option.id)}
                            <span>{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
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
    </>
  );
}
