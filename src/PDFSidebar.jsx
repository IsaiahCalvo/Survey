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

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

// Module scope so it keeps a stable component identity across PDFSidebar renders.
const HistoryButton = ({ isActive, onClick }) => (
  <button
    type="button"
    title="Version History"
    aria-label="Version History"
    onClick={onClick}
    style={{
      width: '28px',
      height: '28px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      border: 0,
      color: isActive ? '#4A90E2' : '#ddd',
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
}, ref) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  // 2026-04-29: publish the live sidebar width as a CSS variable so the
  // StorageFailureBanner overlay can anchor inside the PDF area without
  // running over the sidebar's vertical tool rail (Pages / Search /
  // Bookmarks / Spaces).
  React.useEffect(() => {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.style.setProperty('--app-sidebar-width', isCollapsed ? '48px' : '272px');
  }, [isCollapsed]);
  const [activeTab, setActiveTab] = useState('pages'); // 'pages' | 'search' | 'bookmarks' | 'spaces' | 'history'
  const [hoveredTabId, setHoveredTabId] = useState(null);
  const [searchFocusRequestToken, setSearchFocusRequestToken] = useState(0);
  const [searchSelectOnFocus, setSearchSelectOnFocus] = useState(true);
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

  useImperativeHandle(ref, () => ({
    openSearchPanel: ({ focus = true, select = true } = {}) => {
      setIsCollapsed(false);
      setActiveTab('search');
      if (focus) {
        setSearchSelectOnFocus(Boolean(select));
        setSearchFocusRequestToken((prev) => prev + 1);
      }
    }
  }), [onToggleCollapse]);

  // 2026-04-25 (revised) — Survey is back in the top toolbar; this rail
  // owns the four navigation tabs only. The collaboration footer below the
  // tab content carries the sync status chip + live presence row instead.
  const tabs = [
    { id: 'pages', label: 'Pages', icon: 'pages' },
    { id: 'search', label: 'Search Text', icon: 'search' },
    { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
    { id: 'spaces', label: 'Spaces', icon: 'folder' }
  ];

  const openHistoryPanel = useCallback(() => {
    setIsCollapsed(false);
    setActiveTab('history');
  }, []);

  return (
    <div style={{
      width: isCollapsed ? '48px' : '272px',
      height: '100%',
      background: '#252525',
      borderRight: '1px solid #3a3a3a',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.2s ease',
      flexShrink: 0
    }}>
      {/* Collapse/Expand Button */}
      <div style={{
        height: '35px',
        padding: '0 8px',
        borderBottom: '1px solid #3a3a3a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        background: '#252525'
      }}>
        <button
          onClick={toggleCollapse}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#999',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <Icon name={isCollapsed ? 'chevronRight' : 'chevronLeft'} size={16} color="#999" />
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Tab Navigation */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid #3a3a3a',
            background: '#252525',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }}>
            <style>{`
              .sidebar-tabs::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            {tabs.concat(
              typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
                ? [{ id: '__savelog', label: 'Save Log', icon: 'document' }]
                : []
            ).map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  title={tab.label}
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
                    flex: 1,
                    padding: '10px 8px',
                    background: isActive ? '#2b2b2b' : 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '2px solid #4A90E2' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    color: isActive ? '#ddd' : '#999',
                    fontWeight: isActive ? '500' : '400',
                    fontFamily: FONT_FAMILY,
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                    minWidth: '70px'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = '#2b2b2b';
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
                    color={isActive ? '#4A90E2' : '#999'}
                    style={tab.icon === 'pages' ? { boxSizing: 'content-box', marginTop: '3px' } : undefined}
                  />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Panel Content */}
          <div style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: '#252525'
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
                onReorderSpaces={onReorderSpaces}
                onExportSpaceCSV={onExportSpaceCSV}
                onExportSpacePDF={onExportSpacePDF}
                isRegionSelectionActive={isRegionSelectionActive}
                regionSelectionPage={regionSelectionPage}
                numPages={numPages}
                features={features}
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
              />
            </div>

            {/* Version History Panel */}
            <div style={{ display: activeTab === 'history' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              <RevisionsPanel
                documentId={documentId}
                user={user}
                embedded
                onNavigateToPage={onNavigateToPage}
                onRestoreHistoryActivity={onRestoreHistoryActivity}
                onCascadeRestoreRegion={onCascadeRestoreRegion}
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
          background: '#252525',
          position: 'relative',
          // 2026-04-25 — flex:1 lets the collaboration footer at the bottom
          // sit at the actual bottom of the rail instead of stacking right
          // below the last icon.
          flex: 1
        }}>
          {tabs.concat(
            typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
              ? [{ id: '__savelog', label: 'Save Log', icon: 'document' }]
              : []
          ).map(tab => (
            <div
              key={tab.id}
              style={{
                position: 'relative'
              }}
              onMouseEnter={() => setHoveredTabId(tab.id)}
              onMouseLeave={() => setHoveredTabId(null)}
            >
              <button
                title={tab.label}
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
                  borderRadius: '6px',
                  padding: '10px',
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
                  e.currentTarget.style.background = '#2b2b2b';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <Icon
                  name={tab.icon}
                  size={20}
                  color="#999"
                  style={{ width: '20px', height: '20px', flexShrink: 0 }}
                />
              </button>
              {hoveredTabId === tab.id && (
                <div
                  style={{
                    position: 'absolute',
                    left: '100%',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    marginLeft: '8px',
                    background: '#1a1a1a',
                    color: '#ddd',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontFamily: FONT_FAMILY,
                    whiteSpace: 'nowrap',
                    zIndex: 1000,
                    pointerEvents: 'none',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                    border: '1px solid #3a3a3a'
                  }}
                >
                  {tab.label}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 2026-04-25 — Collaboration footer (sync chip on top, presence row
          below) anchored at the bottom of the rail. Lives here so it stays
          on screen for every page — the previous top-toolbar location
          scrolled off with the PDF area on page change.
          Hidden entirely when cloud sync is disabled (free tier or no PDF). */}
      {cloudSyncEnabled && (
        <div style={{
          borderTop: '1px solid #3a3a3a',
          padding: isCollapsed ? '10px 6px' : '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
          background: '#252525'
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
  );
});

PDFSidebar.displayName = 'PDFSidebar';

export default PDFSidebar;
