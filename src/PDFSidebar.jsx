/**
 * PDFSidebar.jsx — collapsible left rail for the PDF viewer.
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
import RevisionsPanel from './components/revisions/RevisionsPanel';
import { SHEET_EXPANDED_HEIGHT, useMobileSheetMotion } from './mobile/useMobileSheetMotion';
import { useTooltip } from './components/Tooltip';
import { RAIL_CONTROL, RAIL_CONTROL_GLYPH, RAIL_GLYPH } from './viewerShared';
import { useViewerSideOccluderRef } from './utils/viewerSideOverlay.js';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

// Module scope so it keeps a stable component identity across PDFSidebar renders.
const HistoryButton = ({ isActive, onClick, round = false }) => {
  // KAL-65: sidebar controls use the app's instant shared tooltip, never a
  // native title= (the OS tooltip takes ~1.5s and is OS-styled, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  return (
  <button
    type="button"
    {...tip('History', 'right')}
    aria-label="History"
    onClick={onClick}
    // UX 2026-09-16 (desktop sweep): the shared rail control box and glyph. It
    // was a 17px glyph in a 28px box, so the one button in the left rail's
    // collaboration footer used a size nothing else in that rail used — a 48px
    // column showing 14, 16, 17 and 18 at once.
    style={{
      width: round ? '24px' : `${RAIL_CONTROL}px`,
      height: round ? '24px' : `${RAIL_CONTROL}px`,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      border: 0,
      color: isActive ? 'var(--accent)' : 'var(--text-2)',
      borderRadius: round ? '50%' : '6px',
      cursor: 'pointer',
      fontSize: '12px',
      fontFamily: FONT_FAMILY,
      fontWeight: 500,
      padding: 0,
      whiteSpace: 'nowrap'
    }}
  >
    {round ? (
      /* Owner 2026-09-23: in the one-row footer the history control is a
         circle about the size of the active-user faces (22px) and the same
         24px height as the sync pill beside it, filled and edged like it, so the
         row reads as three matching tokens. The circle is a child, not the
         button's own background, so the app's glyph-only press rule shrinks
         the whole circle instead of wiping its fill. */
      <span style={{
        width: '24px',
        height: '24px',
        boxSizing: 'border-box',
        borderRadius: '50%',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon name="history" size={14} color="currentColor" />
      </span>
    ) : (
      <Icon name="history" size={RAIL_CONTROL_GLYPH} color="currentColor" />
    )}
  </button>
  );
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
    document.documentElement.style.setProperty('--app-sidebar-width', mobileMode ? '44px' : (isCollapsed ? '48px' : '272px'));
  }, [isCollapsed, mobileMode]);
  const [activeTab, setActiveTab] = useState('pages'); // 'pages' | 'search' | 'bookmarks' | 'spaces' | 'history'
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

  const toggleCollapse = useCallback(() => {
    if (!isCollapsed && activeTab === 'history') {
      setActiveTab('pages');
    }
    setIsCollapsed(prev => !prev);
  }, [activeTab, isCollapsed]);

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

  const handleMobileSpacesMetricsChange = useCallback(({ expandedPageRows = 0, contentHeight = null } = {}) => {
    setMobileSpacesPageRows(expandedPageRows);
    setMobileSpacesContentHeight(
      Number.isFinite(contentHeight) && contentHeight > 0 ? Math.ceil(contentHeight) : null
    );
  }, []);

  const togglePanel = useCallback((panelId, options = {}) => {
    if (!isCollapsed && activeTab === panelId) {
      closePanel();
      return;
    }
    openPanel(panelId, options);
  }, [activeTab, closePanel, isCollapsed, openPanel]);

  // Spaces chunk A (phone): Edit areas draws on the page, so the Spaces sheet
  // and its backdrop leave while the region tool is on (the backdrop swallowed
  // the first touch and every drag), and the sheet comes back - with the space
  // that was being edited still open - on Confirm / Cancel.
  const regionEditHidSheetRef = React.useRef(false);
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
    closePanel,
    togglePanel,
    openSearchPanel: ({ focus = true, select = true } = {}) => {
      openPanel('search', { focus, select });
    }
  }), [closePanel, openPanel, togglePanel]);

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

  const openHistoryPanel = useCallback(() => {
    setIsCollapsed(false);
    setActiveTab('history');
  }, []);

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
  // Spaces. Each opens at Standard, climbs to Expanded (70%) on a pull up, and
  // to full screen on a second pull; pulling down steps back one height at a
  // time. History (a long feed since option A, 2026-09-28) opts in too.
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
    expanded: sheetExpanded,
    fullscreen: sheetFullscreen,
  } = useMobileSheetMotion(closePanel, {
      expandable: browsePanel,
      fullscreenable: browsePanel,
      open: mobileMode && !isCollapsed,
    });
  const expandedNavigationTabs = mobileMode
    ? tabs.filter((tab) => tab.id !== 'spaces')
    : tabs.concat(
      typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
        ? [{ id: '__savelog', label: 'Save log', icon: 'document' }]
        : []
    );
  // RULED CHANGE 2026-09-21 (pass 7 / DESIGN-SYSTEM.md "Standard is the starting
  // height for every current phone panel"): ONE height for every tab, and it is
  // the shared Standard token. This supersedes every per-tab number that used to
  // live here — Pages/Search/Bookmarks 310, Version history 264, and Spaces
  // measured off its own rows — each of which made the tray a different size
  // depending on which panel was in it. Every panel inside is flex:1, so the one
  // height simply lets each fill the tray and its empty state centre itself (see
  // .mobile-bookmark-empty / .mobile-search-empty). A long list is what the
  // Expanded and full-screen detents above are for.
  const MOBILE_PANEL_STANDARD = 'var(--mobile-panel-standard)';

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
      className={`${mobileMode ? 'mobile-pdf-sheet ' : ''}${mobileMode && sheetExpanded ? 'is-expanded ' : ''}${mobileMode && sheetFullscreen ? 'is-fullscreen ' : ''}${isCollapsed ? 'is-collapsed' : ''}`} style={{
      // The tall detent overrides the content-measured height. It has to be
      // written here, not from the stylesheet: this inline custom property
      // always wins over a rule, so a CSS-only override would be ignored.
      // The taller detents override the Standard height. They have to be written
      // here, not from the stylesheet: this inline custom property always wins
      // over a rule, so a CSS-only override would be ignored.
      '--mobile-sheet-height': mobileMode
        ? (sheetFullscreen
          ? 'calc(100dvh - var(--app-chrome-top, 34px) - 18px)'
          : (sheetExpanded ? SHEET_EXPANDED_HEIGHT : MOBILE_PANEL_STANDARD))
        : undefined,
      width: mobileMode ? (isCollapsed ? '0px' : '100%') : (isCollapsed ? '48px' : '272px'),
      height: '100%',
      background: 'var(--surface-1)',
      borderRight: mobileMode ? 'none' : '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      // The height leg eases the step between the compact and tall detents
      // with the same 260ms spring curve the sheet's spring-back uses.
      transition: 'width 0.2s ease, height 0.26s cubic-bezier(0.22, 1.15, 0.36, 1)',
      flexShrink: 0,
      // Phase F: finger-follow / spring-back / slide-down exit (mobile only).
      ...(mobileMode ? sheetMotionStyle : null)
    }}>
      {/* Collapse/Expand Button */}
      <div
        className={mobileMode ? 'mobile-pdf-sheet__handle' : undefined}
        style={{
        height: '35px',
        padding: '0 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        // UX 2026-09-16: when the rail is collapsed to its 48px strip, the
        // toggle is the top icon of a single icon column, so it sits on that
        // column's centre line like everything below it. Right-aligning it
        // there left it 3.5px off-axis from Pages / Search / Bookmarks /
        // Spaces. Expanded, it keeps its right-edge home.
        justifyContent: (!mobileMode && isCollapsed) ? 'center' : 'flex-end',
        background: 'var(--surface-1)'
      }}>
        <button
          onClick={toggleCollapse}
          // UX 2026-09-16 (desktop sweep): the shared rail control box and glyph.
          // It was a 16px chevron in a padding-derived 24px box — a fourth glyph
          // size in a rail that already ran 17 and 18. The box measures the same
          // 24 as before, so the 35px strip and the icon column's centre line are
          // unchanged; nothing moves.
          style={{
            background: 'transparent',
            border: 'none',
            // UX 2026-09-22 (desktop critic round): resting chrome icon =
            // --text-2, and a chrome button's corner is the house 6, not a
            // rail-only 4. See the note on the rail tabs below.
            color: 'var(--text-2)',
            cursor: 'pointer',
            ...(mobileMode
              ? { padding: '4px' }
              : { padding: 0, width: `${RAIL_CONTROL}px`, height: `${RAIL_CONTROL}px` }),
            borderRadius: 'var(--chrome-radius)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <Icon name={mobileMode ? 'chevronDown' : (isCollapsed ? 'chevronRight' : 'chevronLeft')} size={mobileMode ? 16 : RAIL_CONTROL_GLYPH} color="var(--text-2)" />
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Owner 2026-09-30: no close X on a phone sheet. History closes with
              a swipe down (anywhere on it); it has no tap-outside cover, so a
              tap on the page still picks a mark (w64). */}
          {/* Tab Navigation */}
          {mobileStandalonePanel ? null : (
          <div className={mobileMode ? 'mobile-pdf-hub-tabs' : undefined} style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-1)',
            overflow: 'hidden',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            width: '100%',
            boxSizing: 'border-box'
          }}>
            <style>{`
              .sidebar-tabs::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            {expandedNavigationTabs.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  className={mobileMode ? `mobile-pdf-hub-tab${isActive ? ' is-active' : ''}` : undefined}
                  {...tip(tab.label, 'below')}
                  onClick={() => {
                    if (tab.id === '__savelog') {
                      // UX 2026-04-22: Mobile-only tile that fires the Save Log
                      // banner without switching panels. Kept alongside Pages /
                      // Search / Bookmarks / Spaces so the user can submit a
                      // log from anywhere inside a PDF.
                      const buf = window.__consoleLogBuffer;
                      const consoleText = Array.isArray(buf) && buf.length > 0
                        ? buf.join('\n')
                        : '(no console output captured)';
                      window.dispatchEvent(new CustomEvent('save-log-banner-start', {
                        detail: { consoleText }
                      }));
                      return;
                    }
                    setActiveTab(tab.id);
                  }}
                  style={{
                    /* Owner 2026-09-23 ("evenly spaced across"): on desktop
                       each tab starts at its label's width and the spare room
                       is shared out equally, so the GAPS between the words
                       match. Equal-width tabs ('1 1 0') left short words like
                       "Pages" floating wide and "Search text" / "Bookmarks"
                       crowding each other. */
                    flex: mobileMode ? '1 1 0' : '1 1 auto',
                    minWidth: 0,
                    maxWidth: 'none',
                    // UX 2026-09-17: 9px on the desktop, where the glyph above
                    // is 2px bigger (RAIL_GLYPH). 9 + 18 = 10 + 16, so the tab
                    // strip keeps the height it has and the panel's content
                    // starts exactly where it did.
                    padding: mobileMode ? '10px 2px' : '9px 2px',
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
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'var(--hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {/* UX 2026-09-16: every tab icon draws in the same box with
                      no nudge. The Pages glyph used to carry a 3px top margin,
                      which grew its tab's centred column and pushed BOTH its
                      icon and its label 1.5px below the other three, visibly
                      breaking the row of labels. The glyph's own ink is already
                      centred in its box.
                      UX 2026-09-17 (desktop sweep): that box is RAIL_GLYPH on
                      the desktop, not a literal 16. Pages / Search / Bookmarks /
                      Spaces are the same four tabs whether the panel is open or
                      collapsed, and the collapsed rail already draws them at
                      RAIL_GLYPH (--rail-glyph 18) — so the same control changed
                      glyph size by 2px (11%) when the panel opened. The tab's
                      own height does not move with it: the vertical padding
                      below drops by the 2px the glyph gains, so the strip is the
                      same height it was and nothing under it shifts. The phone
                      keeps 16: its glyph sizes come from the phone tier's own
                      tokens, not the desktop rail's. */}
                  {/* UX 2026-09-22: the resting grey is --text-2, the same one
                      the collapsed rail draws — see the note there. */}
                  <Icon
                    name={tab.icon}
                    size={mobileMode ? 16 : RAIL_GLYPH}
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
          {/* UX 2026-09-16: the panel body fades and slides in 6px from the
              left edge it is anchored to (140ms), so opening Pages reads as
              the panel arriving rather than the page jumping. Drawboard's own
              panel opens with a short fade. Desktop only — on mobile the sheet
              already owns its slide-up motion (useMobileSheetMotion), and
              stacking a second animation on top would fight it. The shared
              class in styles.css honours prefers-reduced-motion. */}
          <div className={mobileMode ? undefined : 'survey-surface-in-left'} style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--surface-1)'
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
                // UX 2026-09-23 (owner: phone Spaces panel polished): Exit is a
                // quiet red word at the end of the list, not a footer band.
                onExitSpacesAction={mobileMode ? () => {
                  onExitSpaceMode?.();
                  closePanel();
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
        </>
      )}

      {/* Collapsed State - Show Icons Only */}
      {isCollapsed && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '8px',
          gap: '4px',
          background: 'var(--surface-1)',
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
            // KAL-65: this rail used to grow its own hover-triggered tooltip
            // div (positioned via hoveredTabId) alongside the native title=
            // below — two custom tooltips stacking on the same button. The
            // shared tip() binder replaces both; placement 'right' matches
            // the removed div's left:100% / translateY(-50%) anchor exactly.
            const tabTip = tip(tab.label, 'right');
            return (
            <div
              key={tab.id}
              style={{
                position: 'relative'
              }}
            >
              <button
                {...tabTip}
                aria-label={tab.label}
                onClick={() => {
                  if (tab.id === '__savelog') {
                    // UX 2026-04-22: Mobile-only Save Log in collapsed
                    // vertical rail so the user can trigger it without
                    // expanding the sidebar first.
                    const buf = window.__consoleLogBuffer;
                    const consoleText = Array.isArray(buf) && buf.length > 0
                      ? buf.join('\n')
                      : '(no console output captured)';
                    window.dispatchEvent(new CustomEvent('save-log-banner-start', {
                      detail: { consoleText }
                    }));
                    return;
                  }
                  setIsCollapsed(false);
                  setActiveTab(tab.id);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 'var(--chrome-radius, 6px)',
                  // UX 2026-09-16 (desktop sizing pass): the rail tab keeps its
                  // 40px height — nothing moves — but the glyph drops to the
                  // shared chrome size (18px, --chrome-glyph) and the padding
                  // is split so the glyph FITS. At 10px padding around a 20px
                  // glyph the content box wanted 40px inside a 31px-wide rail,
                  // so the glyph overflowed its own button.
                  padding: '11px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s ease',
                  minWidth: '28px',
                  minHeight: '28px',
                  width: '100%'
                }}
                onMouseEnter={(e) => {
                  tabTip.onMouseEnter(e);
                  e.currentTarget.style.background = 'var(--hover)';
                }}
                onMouseLeave={(e) => {
                  tabTip.onMouseLeave(e);
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {/* UX 2026-09-22 (desktop critic round): ONE grey for a
                    resting chrome icon, and it is --text-2. Intended UX: the
                    left rail, the right rail and the top bar are one tier of
                    chrome, so an icon that is merely sitting there must be the
                    same weight in all three. They used to disagree — these rail
                    tabs and the Survey button drew --text-3 while Version
                    history, Fit, Export and every top-bar tool glyph drew
                    --text-2, which read as two different rails. Gold still
                    marks the active one; --text-3 is left to real subtext. */}
                <Icon
                  name={tab.icon}
                  size={RAIL_GLYPH}
                  color="var(--text-2)"
                  style={{ width: `${RAIL_GLYPH}px`, height: `${RAIL_GLYPH}px`, flexShrink: 0 }}
                />
              </button>
            </div>
            );
          })}
        </div>
      )}

      {/* 2026-04-25 — Collaboration footer (sync chip on top, presence row
          below) anchored at the bottom of the rail. Lives here so it stays
          on screen for every page — the previous top-toolbar location
          scrolled off with the PDF area on page change.
          Hidden entirely when cloud sync is disabled (free tier or no PDF). */}
      {cloudSyncEnabled && !mobileMode && (
        <div style={isCollapsed ? {
          borderTop: '1px solid var(--border)',
          padding: '10px 6px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
          background: 'var(--surface-1)'
        } : {
          /* Owner 2026-09-23: the expanded footer is ONE row - active users
             on the left, sync status in the middle, version history on the
             right as a face-sized circle - so it takes a single short band
             instead of three stacked lines. Equal side columns keep the
             status pill in the true middle whatever the sides hold (one face
             or three plus "+N"); a long status label trims with an ellipsis.
             Faces, pill and circle are all ~24-26px so the row reads as one
             family of round tokens. */
          borderTop: '1px solid var(--border)',
          padding: '8px 12px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
          alignItems: 'center',
          columnGap: '8px',
          background: 'var(--surface-1)'
        }}>
          {isCollapsed ? (
            <>
              <SyncStatusChip
                status={cloudSyncStatus}
                queueSize={cloudSyncQueueSize}
                enabled
                compact
                onRetry={cloudSyncOnRetry}
              />
              {documentId && <HistoryButton isActive={activeTab === 'history'} onClick={openHistoryPanel} />}
              <PresenceAvatars
                presence={presence}
                currentUserId={currentUserId}
                currentUserEmail={currentUserEmail}
                currentUserDisplayName={currentUserDisplayName}
                enabled
                compact
              />
            </>
          ) : (
            <>
              <div style={{ justifySelf: 'start', minWidth: 0, display: 'flex', alignItems: 'center' }}>
                <PresenceAvatars
                  presence={presence}
                  currentUserId={currentUserId}
                  currentUserEmail={currentUserEmail}
                  currentUserDisplayName={currentUserDisplayName}
                  enabled
                  row
                />
              </div>
              <div style={{ minWidth: 0, maxWidth: '100%', display: 'flex', justifyContent: 'center' }}>
                <SyncStatusChip
                  status={cloudSyncStatus}
                  queueSize={cloudSyncQueueSize}
                  enabled
                  row
                  onRetry={cloudSyncOnRetry}
                />
              </div>
              <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center' }}>
                {documentId && <HistoryButton round isActive={activeTab === 'history'} onClick={openHistoryPanel} />}
              </div>
            </>
          )}
        </div>
      )}
    </div>
    </>
  );
});

PDFSidebar.displayName = 'PDFSidebar';

export default PDFSidebar;
