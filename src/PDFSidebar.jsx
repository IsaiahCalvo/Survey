import React, { useState, useCallback } from 'react';
import Icon from './Icons';
import PagesPanel from './sidebar/PagesPanel';
import SearchTextPanel from './sidebar/SearchTextPanel';
import BookmarksPanel from './sidebar/BookmarksPanel';
import SpacesPanel from './sidebar/SpacesPanel';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

const PDFSidebar = ({
  pdfDoc,
  numPages,
  pageNum,
  onNavigateToPage,
  onNavigateToMatch,
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
  onSpaceAssignPages,
  onSpaceRenamePage,
  onSpaceRemovePage,
  onReorderSpaces,
  onExportSpaceCSV,
  onExportSpacePDF,
  isRegionSelectionActive,
  shouldShowPage,
  activeSpacePages,
  scale,
  tabId,
  onPageDrop,
  onToggleCollapse
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState('pages'); // 'pages' | 'search' | 'bookmarks' | 'spaces'
  const [hoveredTabId, setHoveredTabId] = useState(null);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed(prev => {
      const next = !prev;
      if (typeof onToggleCollapse === 'function') {
        onToggleCollapse(next);
      }
      return next;
    });
  }, [onToggleCollapse]);

  const tabs = [
    { id: 'pages', label: 'Pages', icon: 'pages' },
    { id: 'search', label: 'Search Text', icon: 'search' },
    { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
    { id: 'spaces', label: 'Spaces', icon: 'folder' }
  ];

  return (
    <div style={{
      width: isCollapsed ? '48px' : '280px',
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
        padding: '8px',
        borderBottom: '1px solid #3a3a3a',
        display: 'flex',
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
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: '10px 8px',
                  background: activeTab === tab.id ? '#2b2b2b' : 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab.id ? '2px solid #4A90E2' : '2px solid transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  color: activeTab === tab.id ? '#ddd' : '#999',
                  fontWeight: activeTab === tab.id ? '500' : '400',
                  fontFamily: FONT_FAMILY,
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                  minWidth: '70px'
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== tab.id) {
                    e.currentTarget.style.background = '#2b2b2b';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab.id) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <Icon 
                  name={tab.icon} 
                  size={16} 
                  color={activeTab === tab.id ? '#4A90E2' : '#999'}
                />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Panel Content */}
          <div style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: '#252525'
          }}>
            {activeTab === 'pages' && (
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
                shouldShowPage={shouldShowPage}
                activeSpacePages={activeSpacePages}
                scale={scale}
                tabId={tabId}
                onPageDragStart={onPageDrop ? () => {} : undefined}
              />
            )}
            {activeTab === 'search' && (
              <SearchTextPanel
                pdfDoc={pdfDoc}
                numPages={numPages}
                onNavigateToPage={onNavigateToPage}
                onNavigateToMatch={onNavigateToMatch}
                searchResults={searchResults}
                currentMatchIndex={currentMatchIndex}
                onSearchResultsChange={onSearchResultsChange}
                onCurrentMatchIndexChange={onCurrentMatchIndexChange}
              />
            )}
            {activeTab === 'bookmarks' && (
              <BookmarksPanel
                bookmarks={bookmarks}
                onBookmarkCreate={onBookmarkCreate}
                onBookmarkUpdate={onBookmarkUpdate}
                onBookmarkDelete={onBookmarkDelete}
                onNavigateToPage={onNavigateToPage}
                pageNum={pageNum}
                numPages={numPages}
              />
            )}
            {activeTab === 'spaces' && (
              <SpacesPanel
                spaces={spaces}
                activeSpaceId={activeSpaceId}
                onSpaceCreate={onSpaceCreate}
                onSpaceUpdate={onSpaceUpdate}
                onSpaceDelete={onSpaceDelete}
                onSetActiveSpace={onSetActiveSpace}
                onExitSpaceMode={onExitSpaceMode}
                onRequestRegionEdit={onRequestRegionEdit}
                onSpaceAssignPages={onSpaceAssignPages}
                onSpaceRenamePage={onSpaceRenamePage}
                onSpaceRemovePage={onSpaceRemovePage}
                onReorderSpaces={onReorderSpaces}
                onExportSpaceCSV={onExportSpaceCSV}
                onExportSpacePDF={onExportSpacePDF}
                isRegionSelectionActive={isRegionSelectionActive}
                numPages={numPages}
              />
            )}
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
          position: 'relative'
        }}>
          {tabs.map(tab => (
            <div
              key={tab.id}
              style={{
                position: 'relative'
              }}
              onMouseEnter={() => setHoveredTabId(tab.id)}
              onMouseLeave={() => setHoveredTabId(null)}
            >
              <button
                onClick={() => {
                  setIsCollapsed(false);
                  if (typeof onToggleCollapse === 'function') {
                    onToggleCollapse(false);
                  }
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
    </div>
  );
};

export default PDFSidebar;
