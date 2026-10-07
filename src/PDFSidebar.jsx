/**
 * PDFSidebar.jsx — the left rail for the PDF viewer: a 48px icon column that
 * stays on screen, with the open tab's panel beside it (desktop), or the
 * phone's bottom sheet.
 *
 * Default-export forwardRef component that hosts the Pages / Search Text /
 * Bookmarks / Spaces tab panels plus a Version History panel, and anchors the
 * collaboration footer (SyncStatusChip + PresenceAvatars) at the bottom.
 * Publishes its width as the `--app-sidebar-width` CSS var; exposes an
 * `openSearchPanel` imperative handle. Rendered by App into the chrome host.
 */
import React, { useState, useCallback, useImperativeHandle, lazy, Suspense } from 'react';
import Icon from './Icons';
import PagesPanel from './sidebar/PagesPanel';
// Lazy so pdf.js (statically imported by SearchTextPanel for text-layer rendering)
// stays out of the first-paint bundle; it loads when the viewer's rail mounts.
const SearchTextPanel = lazy(() => import('./sidebar/SearchTextPanel'));
import BookmarksPanel from './sidebar/BookmarksPanel';
import SpacesPanel from './sidebar/SpacesPanel';
import SyncStatusChip from './components/SyncStatusChip';
import PresenceAvatars from './components/PresenceAvatars';
import { withDevFakePresence } from './components/presenceIdentity.js';
import RevisionsPanel from './components/revisions/RevisionsPanel';
import { useMobileSheetMotion } from './mobile/useMobileSheetMotion';
import { useTooltip } from './components/Tooltip';
import { RAIL_CONTROL, RAIL_CONTROL_GLYPH, RAIL_GLYPH } from './viewerShared';
import { useViewerSideOccluderRef } from './utils/viewerSideOverlay.js';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

// Module scope so it keeps a stable component identity across PDFSidebar renders.
// Owner 2026-10-07 (Drawboard rail): History is a rail control like the tabs
// above it - it opens its panel, and pressed again while that panel is open it
// closes it (onClick is the sidebar's togglePanel('history')).
const HistoryButton = ({ isActive, onClick }) => {
  // KAL-65: sidebar controls use the app's instant shared tooltip, never a
  // native title= (the OS tooltip takes ~1.5s and is OS-styled, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  return (
  <button
    type="button"
    {...tip('History', 'right')}
    aria-label="History"
    aria-expanded={isActive}
    aria-controls={isActive ? 'left-rail-panel' : undefined}
    className={`chrome-icon-btn${isActive ? ' is-active' : ''}`}
    onClick={onClick}
    // UX 2026-09-16 (desktop sweep): the shared rail control box and glyph. It
    // was a 17px glyph in a 28px box, so the one button in the left rail's
    // collaboration footer used a size nothing else in that rail used — a 48px
    // column showing 14, 16, 17 and 18 at once.
    // Owner 2026-10-07: the rail no longer opens into a wide one-row footer, so
    // the round "face-sized" History variant that row used is gone.
    style={{
      width: `${RAIL_CONTROL}px`,
      height: `${RAIL_CONTROL}px`,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      border: 0,
      color: isActive ? 'var(--accent)' : 'var(--text-2)',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '12px',
      fontFamily: FONT_FAMILY,
      fontWeight: 500,
      padding: 0,
      whiteSpace: 'nowrap'
    }}
  >
    <Icon name="history" size={RAIL_CONTROL_GLYPH} color="currentColor" />
  </button>
  );
};

// Owner 2026-10-07 ("study how Drawboard does its collapsible sidebar ... let's
// just copy that"; scratchpad railDrawboard/DRAWBOARD-SIDEBAR.md): the desktop
// rail is ALWAYS its 48px icon column. A tab opens its panel beside the rail,
// the open tab pressed again closes it, another tab swaps the panel in place.
// There is no collapse row and no chevron any more, open or closed.
const LEFT_RAIL_W = 48;
const LEFT_PANEL_W = 272;
const PANEL_TITLES = {
  pages: 'Pages',
  search: 'Search text',
  bookmarks: 'Bookmarks',
  spaces: 'Spaces',
  history: 'History',
};

const PDFSidebar = React.forwardRef(({
  pdfDoc,
  pdfDocumentKey,
  numPages,
  pageNum,
  onNavigateToPage,
  onNavigateToMatch,
  onFindTextMatches,
  onClearTextSearch,
  searchResults,
  currentMatchIndex,
  onSearchResultsChange,
  onCurrentMatchIndexChange,
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
  pageTransformations,
  getThumbnail,
  bookmarks,
  onBookmarkCreate,
  onBookmarkUpdate,
  onBookmarkDelete,
  spaces,
  onSpaceCreate,
  onSpaceUpdate,
  onSpaceDelete,
  activeSpaceId,
  onSetActiveSpace,
  onExitSpaceMode,
  onRequestRegionEdit,
  onCancelRegionEdit,
  onSpaceAssignPages,
  onSpaceRenamePage,
  onSpaceRemovePage,
  getSpaceRemovalImpact = null,
  onNavigateToSpacePage = null,
  onReorderSpaces,
  onExportSpaceCSV,
  onExportSpacePDF,
  isRegionSelectionActive,
  regionSelectionPage = null,
  shouldShowPage,
  activeSpacePages,
  scale,
  tabId,
  onPageDrop,
  onToggleCollapse,
  features,
  canManageSpaces = false,
  getCanvasAnnotationVisibilityState = null,
  onToggleCanvasAnnotations = null,
  getSurveyAnnotationVisibilityState = null,
  onToggleSurveyAnnotations = null,
  selectedSpaceId = null,
  onToggleRegionOverlay = null,
  getRegionOverlayEnabled = null,
  isRegionOverlayToggleEnabled = null,
  showSurveyPanel = false,
  selectedModuleId = null,
  // 2026-04-25 — Collaboration footer at the bottom of the rail. The chip
  // and presence pile used to live in the top-right corner but the toolbar
  // they sat in scrolls with the PDF area, so they vanished on page change.
  // The sidebar rail stays put, so anchoring them here keeps them visible
  // for every page.
  cloudSyncStatus = null,
  cloudSyncQueueSize = 0,
  cloudSyncEnabled = false,
  cloudSyncOnRetry = null,
  presence = [],
  currentUserId = null,
  currentUserEmail = null,
  currentUserDisplayName = null,
  documentId = null,
  user = null,
  onRestoreHistoryActivity = null,
  onCascadeRestoreRegion = null,
  onRestoreHistoryContext = null,
  // w55: false for viewers / a locked document — History hides Restore.
  canRestoreHistory = false,
  // RULED 2026-09-28 owner: History option A — viewer hooks for the feed
  // (which marks exist now, where one is now, zoom to it).
  getHistoryMarkIndex = null,
  locateHistoryMark = null,
  focusHistoryMark = null,
  mobileMode = false,
  onPanelStateChange = null,
}, ref) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  // 2026-04-29: publish the live sidebar width as a CSS variable so the
  // StorageFailureBanner overlay can anchor inside the PDF area without
  // running over the sidebar's vertical tool rail (Pages / Search /
  // Bookmarks / Spaces).
  React.useEffect(() => {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.style.setProperty('--app-sidebar-width', mobileMode ? '44px' : `${isCollapsed ? LEFT_RAIL_W : LEFT_RAIL_W + LEFT_PANEL_W}px`);
  }, [isCollapsed, mobileMode]);
  const [activeTab, setActiveTab] = useState('pages'); // 'pages' | 'search' | 'bookmarks' | 'spaces' | 'history'
  // Desktop (owner 2026-10-07, Drawboard rail): a closed panel stays drawn for
  // the 140ms it takes to fade back into the rail - the reverse of its arrival -
  // instead of vanishing in one frame. A timer, not animationend, ends it, so
  // reduced motion (no animation) cannot strand it on screen.
  const [panelLeaving, setPanelLeaving] = useState(false);
  const panelWasOpenRef = React.useRef(false);
  React.useLayoutEffect(() => {
    if (mobileMode) return undefined;
    if (!isCollapsed) {
      panelWasOpenRef.current = true;
      setPanelLeaving(false);
      return undefined;
    }
    if (!panelWasOpenRef.current) return undefined;
    panelWasOpenRef.current = false;
    setPanelLeaving(true);
    const timer = window.setTimeout(() => setPanelLeaving(false), 140);
    return () => window.clearTimeout(timer);
  }, [isCollapsed, mobileMode]);
  const footerPresence = withDevFakePresence({ presence, currentUserId, currentUserEmail, currentUserDisplayName });
  const tip = useTooltip();
  // RULED 2026-09-23 (coordinator: auto refits keep the view; fits use the
  // band between panels): the open desktop panel covers the left ~224px of the
  // PDF; fits size and centre the page beside it (utils/viewerSideOverlay.js).
  const sideOccluderRef = useViewerSideOccluderRef();
  const [searchFocusRequestToken, setSearchFocusRequestToken] = useState(0);
  const [searchSelectOnFocus, setSearchSelectOnFocus] = useState(true);
  const [mobileSpacesPageRows, setMobileSpacesPageRows] = useState(0);
  // 2026-07-12 (demo parity defect #4): the spaces sheet follows its REAL
  // rendered content height (measured by SpacesPanel) instead of predicting
  // row heights that drifted from the restyled desktop rows. Null until the
  // first measurement lands; the predicted formula is the fallback.
  const [mobileSpacesContentHeight, setMobileSpacesContentHeight] = useState(null);
  const onToggleCollapseRef = React.useRef(onToggleCollapse);

  React.useEffect(() => {
    onToggleCollapseRef.current = onToggleCollapse;
  }, [onToggleCollapse]);

  React.useEffect(() => {
    if (typeof onToggleCollapseRef.current === 'function') {
      onToggleCollapseRef.current(isCollapsed);
    }
  }, [isCollapsed]);

  const openPanel = useCallback((panelId = 'pages', { focus = panelId === 'search', select = true } = {}) => {
    const validPanel = ['pages', 'search', 'bookmarks', 'spaces', 'history'].includes(panelId)
      ? panelId
      : 'pages';
    setIsCollapsed(false);
    setActiveTab(validPanel);
    if (validPanel === 'search' && focus) {
      setSearchSelectOnFocus(Boolean(select));
      setSearchFocusRequestToken((prev) => prev + 1);
    }
  }, []);

  const closePanel = useCallback(() => {
    setIsCollapsed(true);
  }, []);
  // Owner 2026-10-01 (iPhone: closing from the dock was abrupt): on the phone a
  // close asked for from outside the sheet - its dock button pressed again,
  // another panel opening, Spaces' Done - slides the sheet down behind the dock
  // exactly like a swipe or a tap outside, then collapses it. The hook's
  // requestClose lands in this ref below. `{ handover: true }` (AppShell, when
  // the dock is opening Survey in its place) lets the next panel take over in
  // place instead (useMobileSheetMotion, PANEL TO PANEL).
  const mobileSheetCloseRef = React.useRef(null);
  const closePanelSmoothly = useCallback((closeOptions) => {
    if (mobileMode && mobileSheetCloseRef.current) {
      mobileSheetCloseRef.current(closeOptions?.handover === true ? { handover: true } : undefined);
      return;
    }
    closePanel();
  }, [closePanel, mobileMode]);

  const handleMobileSpacesMetricsChange = useCallback(({ expandedPageRows = 0, contentHeight = null } = {}) => {
    setMobileSpacesPageRows(expandedPageRows);
    setMobileSpacesContentHeight(
      Number.isFinite(contentHeight) && contentHeight > 0 ? Math.ceil(contentHeight) : null
    );
  }, []);

  const togglePanel = useCallback((panelId, options = {}) => {
    if (!isCollapsed && activeTab === panelId) {
      closePanelSmoothly();
      return;
    }
    openPanel(panelId, options);
  }, [activeTab, closePanelSmoothly, isCollapsed, openPanel]);

  // Spaces chunk A (phone): Edit areas draws on the page, so the Spaces sheet
  // and its backdrop leave while the region tool is on (the backdrop swallowed
  // the first touch and every drag), and the sheet comes back - with the space
  // that was being edited still open - on Confirm / Cancel.
  const regionEditHidSheetRef = React.useRef(false);
  // Spaces chunk B: which spaces are open survives the panel closing (the
  // phone sheet unmounts SpacesPanel each time it closes).
  const spacesExpandedStoreRef = React.useRef(null);
  const [regionEditReturnSpaceId, setRegionEditReturnSpaceId] = useState(null);
  React.useEffect(() => {
    if (!mobileMode) return;
    const spacesSheetOpen = !isCollapsed && activeTab === 'spaces';
    if (isRegionSelectionActive) {
      if (spacesSheetOpen) {
        regionEditHidSheetRef.current = true;
        setRegionEditReturnSpaceId(activeSpaceId || null);
        closePanel();
      }
    } else if (regionEditHidSheetRef.current) {
      regionEditHidSheetRef.current = false;
      openPanel('spaces');
    }
    // Only the region tool turning on / off moves the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRegionSelectionActive, mobileMode]);

  useImperativeHandle(ref, () => ({
    openPanel,
    closePanel: closePanelSmoothly,
    togglePanel,
    openSearchPanel: ({ focus = true, select = true } = {}) => {
      openPanel('search', { focus, select });
    }
  }), [closePanelSmoothly, openPanel, togglePanel]);

  React.useEffect(() => {
    if (!mobileMode || typeof onPanelStateChange !== 'function') return;
    onPanelStateChange({ isOpen: !isCollapsed, activePanel: activeTab });
  }, [activeTab, isCollapsed, mobileMode, onPanelStateChange]);

  // 2026-04-25 (revised) — Survey is back in the top toolbar; this rail
  // owns the four navigation tabs only. The collaboration footer below the
  // tab content carries the sync status chip + live presence row instead.
  const tabs = [
    { id: 'pages', label: 'Pages', icon: 'pages' },
    { id: 'search', label: mobileMode ? 'Search' : 'Search text', icon: 'search' },
    { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
    { id: 'spaces', label: 'Spaces', icon: 'layers' }
  ];

  const toggleHistoryPanel = useCallback(() => {
    togglePanel('history');
  }, [togglePanel]);

  // Phase F (motion & feel): finger-follow drag + velocity dismiss (dy>82 or
  // vy>0.65) + spring-back + slide-down exit, replacing the old flat 48px
  // touchend delta. Demo SurveySetupSheet.tsx:51-96 / inv-demo §17.
  const mobileStandalonePanel = mobileMode && activeTab === 'spaces'
    ? { label: 'Spaces', icon: 'layers' }
    : mobileMode && activeTab === 'history'
      ? { label: 'History', icon: 'history' }
      : null;
  // PASS 7 (2026-09-21, DESIGN-SYSTEM.md "Phone bottom panels"): the browse
  // panels are the ones with content that can run long, so they are the ones
  // that can be pulled taller: Pages, Search and Bookmarks (the hub tray) and
  // Spaces. Each opens at Standard and has one taller height, Full (owner
  // 2026-10-01: two heights, "the small one and the big one"): a pull up goes
  // there, a pull down comes back. History (a long feed since option A,
  // 2026-09-28) opts in too.
  // 2026-09-17: the hook also owns the slide-UP entrance (the CSS keyframe that
  // used to do it fought this transform), so it needs the sheet's open state —
  // this element stays mounted and only toggles .is-collapsed.
  // RULED 2026-09-28 owner: History option A — History is a long feed now,
  // so it can be pulled taller like the other browse panels.
  const browsePanel = mobileMode;
  const {
    motionStyle: sheetMotionStyle,
    backdropStyle: sheetBackdropStyle,
    sheetProps,
    requestClose: requestSheetClose,
    fullscreen: sheetFullscreen,
  } = useMobileSheetMotion(closePanel, {
      expandable: browsePanel,
      open: mobileMode && !isCollapsed,
      // Owner 2026-10-01: a dock switch between the hub, Spaces and History
      // keeps the sheet up and fades the new panel in. The hub's own three
      // tabs are one panel here, so flipping them inside the sheet stays as
      // it was.
      contentKey: activeTab === 'spaces' || activeTab === 'history' ? activeTab : 'hub',
    });
  mobileSheetCloseRef.current = mobileMode ? requestSheetClose : null;
  // The phone hub's three tabs (Spaces has its own dock button).
  const expandedNavigationTabs = tabs.filter((tab) => tab.id !== 'spaces');
  // RULED CHANGE 2026-09-21 (pass 7 / DESIGN-SYSTEM.md "Standard is the starting
  // height for every current phone panel"): ONE height for every tab, and it is
  // the shared Standard token. This supersedes every per-tab number that used to
  // live here — Pages/Search/Bookmarks 310, Version history 264, and Spaces
  // measured off its own rows — each of which made the tray a different size
  // depending on which panel was in it. Every panel inside is flex:1, so the one
  // height simply lets each fill the tray and its empty state centre itself (see
  // .mobile-bookmark-empty / .mobile-search-empty). A long list is what the
  // Full height above is for.
  const MOBILE_PANEL_STANDARD = 'var(--mobile-panel-standard)';
  // The open panel's frame: a column beside the desktop rail (owner
  // 2026-10-07, Drawboard rail); none on the phone, where the hub tabs and the
  // panel are the sheet's own children.
  const PanelFrame = mobileMode ? React.Fragment : 'div';
  const panelFrameProps = mobileMode ? {} : {
    // While it fades out after closing it is no longer the tabs' panel.
    id: isCollapsed ? undefined : 'left-rail-panel',
    role: isCollapsed ? undefined : 'region',
    'aria-label': isCollapsed ? undefined : PANEL_TITLES[activeTab],
    'aria-hidden': isCollapsed ? 'true' : undefined,
    // UX 2026-09-16: the panel fades and slides in 6px from the rail it is
    // anchored to (140ms), and back out the same way when it closes
    // (styles.css honours reduced motion).
    className: `left-rail__panel ${isCollapsed ? 'survey-surface-out-left' : 'survey-surface-in-left'}`,
    style: {
      pointerEvents: isCollapsed ? 'none' : undefined,
      width: `${LEFT_PANEL_W}px`,
      flex: `0 0 ${LEFT_PANEL_W}px`,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--panel-bg)',
      borderLeft: '1px solid var(--border)',
      boxSizing: 'border-box',
    },
  };

  return (
    <>
    {/* w64 (owner 2026-09-29): with History open, tapping a mark on the page
        shows that mark's history, so the History sheet leaves the page
        above it live (no dim, no tap-to-close cover — like a Maps sheet).
        It closes with a swipe down anywhere on it (owner 2026-09-30: no
        close X on a phone sheet). */}
    {mobileMode && !isCollapsed && activeTab !== 'history' && (
      <button
        type="button"
        className="mobile-pdf-sheet-backdrop"
        aria-label="Close document panel"
        onClick={requestSheetClose}
        style={sheetBackdropStyle}
      />
    )}
    <div
      // Text search centres a picked match in the part of the PDF you can see,
      // so the open panel marks itself as covering the viewer: a side panel on
      // desktop, a bottom sheet on the phone (see utils/searchMatchNavigation).
      data-viewer-occluder={isCollapsed ? undefined : (mobileMode ? 'sheet' : 'side')}
      ref={mobileMode ? undefined : sideOccluderRef}
      // Phone: swipe down anywhere on the sheet + the keyboard lift (owner
      // 2026-09-30, see useMobileSheetMotion).
      {...(mobileMode ? sheetProps : null)}
      className={`${mobileMode ? 'mobile-pdf-sheet ' : 'left-rail '}${mobileMode && sheetFullscreen ? 'is-fullscreen ' : ''}${isCollapsed ? 'is-collapsed' : ''}`} style={{
      // The two heights (owner 2026-10-01: "the small one and the big one").
      // Full has to be written here, not only from the stylesheet: this inline
      // custom property always wins over a non-important rule.
      '--mobile-sheet-height': mobileMode
        ? (sheetFullscreen ? 'var(--mobile-panel-full)' : MOBILE_PANEL_STANDARD)
        : undefined,
      // Desktop (owner 2026-10-07, Drawboard rail): the 48px icon column, plus
      // the 272px panel beside it while a tab is open.
      width: mobileMode ? (isCollapsed ? '0px' : '100%') : `${isCollapsed ? LEFT_RAIL_W : LEFT_RAIL_W + LEFT_PANEL_W}px`,
      height: '100%',
      background: 'var(--panel-bg)',
      borderRight: mobileMode ? 'none' : '1px solid var(--border)',
      display: 'flex',
      flexDirection: mobileMode ? 'column' : 'row',
      // Phone: every height change (detents, the keyboard) is the sheet
      // hook's resize glide now (2026-10-01), so no CSS height leg here - a
      // second engine on the same property would fight it.
      transition: mobileMode ? 'none' : 'width 0.2s ease, height 0.26s cubic-bezier(0.22, 1.15, 0.36, 1)',
      flexShrink: 0,
      // Phase F: finger-follow / spring-back / slide-down exit (mobile only).
      ...(mobileMode ? sheetMotionStyle : null)
    }}>
      {/* Phone: the sheet's grab handle - a swipe down anywhere closes it, as
          does a tap outside or its dock button again. Owner 2026-10-07: the
          invisible "Collapse sidebar" chevron that used to fill this row is
          gone (no collapse arrow anywhere). */}
      {mobileMode && (
        <div className="mobile-pdf-sheet__handle" aria-hidden="true" style={{
          height: '35px',
          padding: '0 8px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          background: 'var(--panel-bg)'
        }} />
      )}

      {/* Desktop: the rail itself - always on screen. Owner 2026-10-07
          ("get rid of the collapse sidebar row and arrow entirely ... if they
          want to go to it, they just click on one of the tabs"), copied from
          Drawboard (scratchpad railDrawboard/DRAWBOARD-SIDEBAR.md): a tab
          opens its panel, the open tab pressed again closes it, another tab
          swaps the panel in place. The tabs start at the top of the rail, where
          the collapse row used to be. */}
      {!mobileMode && (
        <div className="left-rail__column" style={{
          width: `${LEFT_RAIL_W}px`,
          flex: `0 0 ${LEFT_RAIL_W}px`,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel-bg)',
          // Above the panel, which slides out from under it.
          position: 'relative',
          zIndex: 1
        }}>
        <div data-chrome-rail="true" role="toolbar" aria-label="Document panels" aria-orientation="vertical" style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '8px',
          gap: '4px',
          background: 'var(--panel-bg)',
          position: 'relative',
          // 2026-04-25 — flex:1 lets the collaboration footer at the bottom
          // sit at the actual bottom of the rail instead of stacking right
          // below the last icon.
          flex: 1
        }}>
          {tabs.concat(
            typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
              ? [{ id: '__savelog', label: 'Save log', icon: 'document' }]
              : []
          ).map(tab => {
            // KAL-65: the shared instant tooltip, to the right of the rail.
            const tabTip = tip(tab.label, 'right');
            const isOpenTab = !isCollapsed && activeTab === tab.id;
            const isPanelTab = tab.id !== '__savelog';
            return (
            <div
              key={tab.id}
              style={{
                position: 'relative'
              }}
            >
              <button
                type="button"
                {...tabTip}
                aria-label={tab.label}
                // A tab is a disclosure for its panel: it says whether its
                // panel is the one showing.
                aria-expanded={isPanelTab ? isOpenTab : undefined}
                aria-controls={isOpenTab ? 'left-rail-panel' : undefined}
                // The open tab is marked like an armed tool - gold glyph, no
                // plate (src/styles/states.css section 5).
                className={`chrome-icon-btn${isOpenTab ? ' is-active' : ''}`}
                onClick={() => {
                  if (tab.id === '__savelog') {
                    // UX 2026-04-22: Save Log fires its banner without
                    // switching panels.
                    const buf = window.__consoleLogBuffer;
                    const consoleText = Array.isArray(buf) && buf.length > 0
                      ? buf.join('\n')
                      : '(no console output captured)';
                    window.dispatchEvent(new CustomEvent('save-log-banner-start', {
                      detail: { consoleText }
                    }));
                    return;
                  }
                  togglePanel(tab.id);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: isOpenTab ? 'var(--accent)' : 'var(--text-2)',
                  borderRadius: 'var(--chrome-radius, 6px)',
                  // UX 2026-09-16 (desktop sizing pass): a 40px tab around the
                  // shared 18px chrome glyph, padding split so the glyph fits.
                  padding: '11px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '28px',
                  minHeight: '28px',
                  width: '100%'
                }}
              >
                {/* UX 2026-09-22 (desktop critic round): ONE grey for a
                    resting chrome icon, and it is --text-2 - the left rail,
                    the right rail and the top bar are one tier of chrome. Gold
                    marks the open one. */}
                <Icon
                  name={tab.icon}
                  size={RAIL_GLYPH}
                  color="currentColor"
                  style={{ width: `${RAIL_GLYPH}px`, height: `${RAIL_GLYPH}px`, flexShrink: 0 }}
                />
              </button>
            </div>
            );
          })}
        </div>

        {/* 2026-04-25 — Collaboration footer (sync chip, History, presence)
            anchored at the bottom of the rail. Lives here so it stays on
            screen for every page. Hidden entirely when cloud sync is disabled
            (free tier or no PDF). Owner 2026-10-07: the rail no longer widens,
            so this is always the rail's vertical stack (the wide one-row
            footer of the old expanded sidebar is gone). */}
        {/* Dev only: `?fakePeers=N` fills the presence row with N fake people
            (presenceIdentity.js) and shows the footer without cloud sync. */}
        {(cloudSyncEnabled || footerPresence.fake) && (
          <div data-chrome-rail="true" data-presence-footer="collapsed" style={{
            borderTop: '1px solid var(--border)',
            padding: '10px 6px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            background: 'var(--panel-bg)'
          }}>
            <SyncStatusChip
              status={cloudSyncStatus}
              queueSize={cloudSyncQueueSize}
              enabled
              compact
              onRetry={cloudSyncOnRetry}
            />
            {documentId && <HistoryButton isActive={!isCollapsed && activeTab === 'history'} onClick={toggleHistoryPanel} />}
            <PresenceAvatars
              presence={footerPresence.presence}
              currentUserId={footerPresence.currentUserId}
              currentUserEmail={footerPresence.currentUserEmail}
              currentUserDisplayName={footerPresence.currentUserDisplayName}
              enabled
              compact
            />
          </div>
        )}
        </div>
      )}

      {(!isCollapsed || (!mobileMode && panelLeaving)) && (
        // Desktop: the open panel, a column beside the rail. Phone: no frame -
        // the hub tabs and the panel stay the sheet's own children, which its
        // panel-to-panel fade animates one by one (mobilePdfViewer.css).
        <PanelFrame {...panelFrameProps}>
          {/* Desktop: the open panel says what it is, where Drawboard puts its
              panel title ("Pages", "Search"...); the rail's gold tab is the
              other half of that answer. The same 40px band as the Survey
              panel's header on the right. */}
          {!mobileMode && (
            <div className="left-rail__head">
              <h2 className="left-rail__title">{PANEL_TITLES[activeTab]}</h2>
            </div>
          )}
          {/* Owner 2026-09-30: no close X on a phone sheet. History closes with
              a swipe down (anywhere on it); it has no tap-outside cover, so a
              tap on the page still picks a mark (w64). */}
          {/* Phone: the hub's tab row (Pages / Search / Bookmarks). Desktop has
              no tab row any more - the rail beside the panel is the tabs
              (owner 2026-10-07). */}
          {(!mobileMode || mobileStandalonePanel) ? null : (
          <div className="mobile-pdf-hub-tabs" style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            background: 'var(--panel-bg)',
            overflow: 'hidden',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            width: '100%',
            boxSizing: 'border-box'
          }}>
            {expandedNavigationTabs.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  className={`mobile-pdf-hub-tab${isActive ? ' is-active' : ''}`}
                  {...tip(tab.label, 'below')}
                  // The phone hides the word under the glyph (mobilePdfViewer.css),
                  // so the button carries its own name for screen readers.
                  aria-label={tab.label}
                  aria-pressed={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    maxWidth: 'none',
                    padding: '10px 2px',
                    background: isActive ? 'var(--surface-2)' : 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    color: isActive ? 'var(--text-1)' : 'var(--text-2)',
                    fontWeight: isActive ? '500' : '400',
                    fontFamily: FONT_FAMILY,
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {/* Owner 2026-10-01 (iPhone): "I would prefer them to be
                      bigger. I don't want the actual row that they're in to
                      grow." The phone's Pages / Search / Bookmarks tab glyphs
                      draw at 22 (were 16) inside the same 34x32 tab, so the
                      40px tab row keeps its height. */}
                  <Icon
                    name={tab.icon}
                    size={22}
                    color={isActive ? 'var(--accent)' : 'var(--text-2)'}
                  />
                  <span style={{
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>{tab.label}</span>
                </button>
              );
            })}
            {/* Owner 2026-09-30: the row holds only the three tabs; the sheet
                closes by a tap outside it or a swipe down. */}
          </div>
          )}

          {/* Panel Content */}
          {/* The desktop panel's arrival (fade + 6px slide from the rail) is
              on the frame above, so the title and the body move together. */}
          <div style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--panel-bg)'
          }}>
            {/* Persistence: Keep all panels mounted but hide inactive ones using display: none */}

            {/* Pages Panel */}
            <div style={{ display: activeTab === 'pages' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              <PagesPanel
                pdfDoc={pdfDoc}
                numPages={numPages}
                pageNum={pageNum}
                onNavigateToPage={onNavigateToPage}
                onDuplicatePage={onDuplicatePage}
                onInsertBlankPage={onInsertBlankPage}
                onDeletePage={onDeletePage}
                onCutPage={onCutPage}
                onCopyPage={onCopyPage}
                onPastePage={onPastePage}
                clipboardPage={clipboardPage}
                clipboardType={clipboardType}
                onRotatePage={onRotatePage}
                onMirrorPage={onMirrorPage}
                onResetPage={onResetPage}
                onReorderPages={onReorderPages}
                pageTransformations={pageTransformations}
                getThumbnail={getThumbnail}
                shouldShowPage={shouldShowPage}
                activeSpacePages={activeSpacePages}
                scale={scale}
                tabId={tabId}
                onPageDragStart={onPageDrop ? () => { } : undefined}
                mobileMode={mobileMode}
              />
            </div>

            {/* Search Panel */}
            <div style={{ display: activeTab === 'search' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              <Suspense fallback={null}>
              <SearchTextPanel
                pdfDoc={pdfDoc}
                pdfDocumentKey={pdfDocumentKey}
                numPages={numPages}
                onNavigateToPage={onNavigateToPage}
                onNavigateToMatch={onNavigateToMatch}
                onFindTextMatches={onFindTextMatches}
                onClearTextSearch={onClearTextSearch}
                searchResults={searchResults}
                currentMatchIndex={currentMatchIndex}
                onSearchResultsChange={onSearchResultsChange}
                onCurrentMatchIndexChange={onCurrentMatchIndexChange}
                isActive={activeTab === 'search'}
                focusRequestToken={searchFocusRequestToken}
                selectOnFocus={searchSelectOnFocus}
                mobileMode={mobileMode}
                onRequestSheetClose={mobileMode ? requestSheetClose : undefined}
              />
              </Suspense>
            </div>

            {/* Bookmarks Panel */}
            <div style={{ display: activeTab === 'bookmarks' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              <BookmarksPanel
                bookmarks={bookmarks}
                onBookmarkCreate={onBookmarkCreate}
                onBookmarkUpdate={onBookmarkUpdate}
                onBookmarkDelete={onBookmarkDelete}
                onNavigateToPage={onNavigateToPage}
                pageNum={pageNum}
                numPages={numPages}
                mobileMode={mobileMode}
              />
            </div>

            {/* Spaces Panel */}
            <div style={{ display: activeTab === 'spaces' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              <SpacesPanel
                spaces={spaces}
                activeSpaceId={activeSpaceId}
                onSpaceCreate={onSpaceCreate}
                onSpaceUpdate={onSpaceUpdate}
                onSpaceDelete={onSpaceDelete}
                onSetActiveSpace={onSetActiveSpace}
                onExitSpaceMode={onExitSpaceMode}
                onRequestRegionEdit={onRequestRegionEdit}
                onCancelRegionEdit={onCancelRegionEdit}
                onSpaceAssignPages={onSpaceAssignPages}
                onSpaceRenamePage={onSpaceRenamePage}
                onSpaceRemovePage={onSpaceRemovePage}
                getSpaceRemovalImpact={getSpaceRemovalImpact}
                initiallyExpandedSpaceId={mobileMode ? regionEditReturnSpaceId : null}
                expandedSpacesStoreRef={spacesExpandedStoreRef}
                onNavigateToPage={onNavigateToSpacePage}
                onReorderSpaces={onReorderSpaces}
                onExportSpaceCSV={onExportSpaceCSV}
                onExportSpacePDF={onExportSpacePDF}
                isRegionSelectionActive={isRegionSelectionActive}
                regionSelectionPage={regionSelectionPage}
                numPages={numPages}
                features={features}
                canManageSpaces={canManageSpaces}
                getCanvasAnnotationVisibilityState={getCanvasAnnotationVisibilityState}
                onToggleCanvasAnnotations={onToggleCanvasAnnotations}
                getSurveyAnnotationVisibilityState={getSurveyAnnotationVisibilityState}
                onToggleSurveyAnnotations={onToggleSurveyAnnotations}
                externalSelectedSpaceId={selectedSpaceId}
                onToggleRegionOverlay={onToggleRegionOverlay}
                getRegionOverlayEnabled={getRegionOverlayEnabled}
                isRegionOverlayToggleEnabled={isRegionOverlayToggleEnabled}
                showSurveyPanel={showSurveyPanel}
                selectedModuleId={selectedModuleId}
                mobileMode={mobileMode}
                mobilePanelVisible={mobileMode && activeTab === 'spaces' && !isCollapsed}
                onMobilePanelMetricsChange={handleMobileSpacesMetricsChange}
                // Spaces chunk B: the phone header's neutral "Done" (it took
                // over from the red "Exit Spaces / Regions" link): leaves
                // Spaces mode and closes the sheet.
                onExitSpacesAction={mobileMode ? () => {
                  onExitSpaceMode?.();
                  closePanelSmoothly();
                } : null}
              />
            </div>

            {/* Version History Panel */}
            <div style={{ display: activeTab === 'history' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              <RevisionsPanel
                documentId={documentId}
                user={user}
                embedded
                mobileMode={mobileMode}
                isActive={activeTab === 'history' && !isCollapsed}
                onNavigateToPage={onNavigateToPage}
                onRestoreHistoryActivity={onRestoreHistoryActivity}
                onCascadeRestoreRegion={onCascadeRestoreRegion}
                onRestoreHistoryContext={onRestoreHistoryContext}
                canRestore={canRestoreHistory}
                getHistoryMarkIndex={getHistoryMarkIndex}
                locateHistoryMark={locateHistoryMark}
                focusHistoryMark={focusHistoryMark}
              />
            </div>
          </div>
        </PanelFrame>
      )}

    </div>
    </>
  );
});

PDFSidebar.displayName = 'PDFSidebar';

export default PDFSidebar;
