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
import { CHROME_GLYPH } from './viewerShared';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

// Module scope so it keeps a stable component identity across PDFSidebar renders.
const HistoryButton = ({ isActive, onClick }) => {
  // KAL-65: sidebar controls use the app's instant shared tooltip, never a
  // native title= (the OS tooltip takes ~1.5s and is OS-styled, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
  return (
  <button
    type="button"
    {...tip('Version history', 'right')}
    aria-label="Version history"
    onClick={onClick}
    style={{
      width: '28px',
      height: '28px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      border: 0,
      color: isActive ? '#d8a84e' : '#e8e2d4',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '12px',
      fontFamily: FONT_FAMILY,
      fontWeight: 500,
      padding: 0,
      whiteSpace: 'nowrap'
    }}
  >
    <Icon name="history" size={17} color="currentColor" />
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
      ? { label: 'Version history', icon: 'history' }
      : null;
  // UX 2026-09-16 (phone reach pass): only the hub tray (Pages / Search /
  // Bookmarks) gets the taller second detent — drag it up and it grows to 70%
  // of the screen so you can see far more page thumbnails at once, the way
  // Drawboard PDF's phone page list does. Spaces and Version history are
  // content-measured standalone sheets and keep their single height.
  const { motionStyle: sheetMotionStyle, dragHandlers: sheetDragHandlers, requestClose: requestSheetClose, expanded: sheetExpanded } =
    useMobileSheetMotion(closePanel, { expandable: mobileMode && !mobileStandalonePanel });
  const expandedNavigationTabs = mobileMode
    ? tabs.filter((tab) => tab.id !== 'spaces')
    : tabs.concat(
      typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
        ? [{ id: '__savelog', label: 'Save log', icon: 'document' }]
        : []
    );
  const mobilePanelBaseHeight = (() => {
    if (activeTab === 'history') return 264;
    if (activeTab === 'spaces') {
      // 2026-07-12 (demo parity defect #4): size the sheet from the panel's
      // MEASURED content, so it hugs real rows like the demo drawer hugged its
      // known-height RN rows. Chrome around the measured panel: 18px grab
      // handle (.mobile-pdf-sheet__handle) + 44px exit footer
      // (.mobile-spaces-exit-footer) + 12px sheet bottom padding (S3). The
      // shared .mobile-pdf-sheet max-height (100dvh - chrome top - 18px)
      // still clamps tall content. Predicted formula remains as the
      // pre-measurement fallback for the first frame.
      if (mobileSpacesContentHeight != null) {
        return 18 + mobileSpacesContentHeight + 44 + 12;
      }
      return Math.max(238, 106 + (spaces?.length || 0) * 54 + mobileSpacesPageRows * 50);
    }
    if (activeTab === 'search') return searchResults?.length ? 232 : 292;
    // 2026-07-12 (demo parity defect #5): drop the 238px floor — the demo
    // sizes bookmarks as min(286, 84 + max(n,1)*42) so one bookmark gets a
    // snug 126px sheet instead of a mostly-empty 238px one.
    if (activeTab === 'bookmarks') return Math.min(286, 84 + Math.max(bookmarks?.length || 0, 1) * 42);
    return 310;
  })();

  return (
    <>
    {mobileMode && !isCollapsed && (
      <button
        type="button"
        className="mobile-pdf-sheet-backdrop"
        aria-label="Close document panel"
        onClick={requestSheetClose}
      />
    )}
    <div className={`${mobileMode ? 'mobile-pdf-sheet ' : ''}${mobileMode && sheetExpanded ? 'is-expanded ' : ''}${isCollapsed ? 'is-collapsed' : ''}`} style={{
      // The tall detent overrides the content-measured height. It has to be
      // written here, not from the stylesheet: this inline custom property
      // always wins over a rule, so a CSS-only override would be ignored.
      '--mobile-sheet-height': mobileMode
        ? (sheetExpanded ? SHEET_EXPANDED_HEIGHT : `calc(${mobilePanelBaseHeight}px + var(--mobile-bottom-inset))`)
        : undefined,
      width: mobileMode ? (isCollapsed ? '0px' : '100%') : (isCollapsed ? '48px' : '272px'),
      height: '100%',
      background: '#12151c',
      borderRight: mobileMode ? 'none' : '1px solid #2a3140',
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
        onTouchStart={mobileMode ? sheetDragHandlers.onTouchStart : undefined}
        onTouchMove={mobileMode ? sheetDragHandlers.onTouchMove : undefined}
        onTouchEnd={mobileMode ? sheetDragHandlers.onTouchEnd : undefined}
        style={{
        height: '35px',
        padding: '0 8px',
        borderBottom: '1px solid #2a3140',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        background: '#12151c'
      }}>
        <button
          onClick={toggleCollapse}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#8d96a6',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#2a3140'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <Icon name={mobileMode ? 'chevronDown' : (isCollapsed ? 'chevronRight' : 'chevronLeft')} size={16} color="#8d96a6" />
        </button>
      </div>

      {!isCollapsed && (
        <>
          {mobileMode && activeTab === 'history' && (
            <button
              type="button"
              className="mobile-history-close"
              aria-label="Close version history"
              onClick={requestSheetClose}
            >
              <Icon name="close" size={17} color="currentColor" />
            </button>
          )}
          {/* Tab Navigation */}
          {mobileStandalonePanel ? null : (
          <div className={mobileMode ? 'mobile-pdf-hub-tabs' : undefined} style={{
            display: 'flex',
            borderBottom: '1px solid #2a3140',
            background: '#12151c',
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
                    flex: '1 1 0',
                    minWidth: 0,
                    maxWidth: 'none',
                    padding: '10px 2px',
                    background: isActive ? '#181c24' : 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '2px solid #d8a84e' : '2px solid transparent',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    color: isActive ? '#e8e2d4' : '#8d96a6',
                    fontWeight: isActive ? '500' : '400',
                    fontFamily: FONT_FAMILY,
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = '#181c24';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <Icon
                    name={tab.icon}
                    size={16}
                    color={isActive ? '#d8a84e' : '#8d96a6'}
                    style={tab.icon === 'pages' ? { boxSizing: 'content-box', marginTop: '3px' } : undefined}
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
            {mobileMode && (
              <button
                type="button"
                className="mobile-pdf-hub-close"
                aria-label="Close document hub"
                onClick={requestSheetClose}
              >
                <Icon name="close" size={16} color="currentColor" />
              </button>
            )}
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
            background: '#12151c'
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
              />
              {mobileMode && (
                <div className="mobile-spaces-exit-footer">
                  <button
                    type="button"
                    onClick={() => {
                      onExitSpaceMode?.();
                      closePanel();
                    }}
                  >
                    Exit Spaces / Regions
                  </button>
                </div>
              )}
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
          background: '#12151c',
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
                  e.currentTarget.style.background = '#181c24';
                }}
                onMouseLeave={(e) => {
                  tabTip.onMouseLeave(e);
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <Icon
                  name={tab.icon}
                  size={CHROME_GLYPH}
                  color="#8d96a6"
                  style={{ width: `${CHROME_GLYPH}px`, height: `${CHROME_GLYPH}px`, flexShrink: 0 }}
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
        <div style={{
          borderTop: '1px solid #2a3140',
          padding: isCollapsed ? '10px 6px' : '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
          background: '#12151c'
        }}>
          <SyncStatusChip
            status={cloudSyncStatus}
            queueSize={cloudSyncQueueSize}
            enabled
            compact={isCollapsed}
            onRetry={cloudSyncOnRetry}
          />
          {documentId && <HistoryButton isActive={activeTab === 'history'} onClick={openHistoryPanel} />}
          <PresenceAvatars
            presence={presence}
            currentUserId={currentUserId}
            currentUserEmail={currentUserEmail}
            currentUserDisplayName={currentUserDisplayName}
            enabled
            compact={isCollapsed}
          />
        </div>
      )}
    </div>
    </>
  );
});

PDFSidebar.displayName = 'PDFSidebar';

export default PDFSidebar;
