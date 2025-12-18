import React, { useState, useRef, useCallback } from 'react';
import Icon from './Icons';
import { useDragToReorder } from './utils/useDragToReorder';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

const TabBar = ({ tabs, activeTabId, onTabClick, onTabClose, onTabReorder, onPageDrop }) => {
  const [dragOverTabId, setDragOverTabId] = useState(null);
  const tabBarRef = useRef(null);
  

  // Use drag-to-reorder for tabs (excluding home tab)
  const pdfTabs = tabs.filter(t => !t.isHome);
  const {
    draggingState: tabDraggingState,
    virtualOrder: tabVirtualOrder,
    handleGrab: handleTabGrab,
    registerItemRef: registerTabRef,
    containerRef: tabContainerRef
  } = useDragToReorder(pdfTabs, (reorderedPdfTabs) => {
    // Recombine with home tab at the beginning
    const homeTab = tabs.find(t => t.isHome);
    if (homeTab) {
      onTabReorder([homeTab, ...reorderedPdfTabs]);
    } else {
      onTabReorder(reorderedPdfTabs);
    }
  }, {
    itemHeight: 40,
    gap: 0,
    dragHandleSelector: '[data-tab-drag-handle]'
  });
  
  // Combine home tab with reordered PDF tabs for display
  const displayTabs = (() => {
    const homeTab = tabs.find(t => t.isHome);
    if (!homeTab) return tabVirtualOrder || pdfTabs.map((tab, idx) => ({ item: tab, index: idx }));
    
    const homeTabDisplay = { item: homeTab, index: 0 };
    const pdfTabsDisplay = tabVirtualOrder || pdfTabs.map((tab, idx) => ({ item: tab, index: idx + 1 }));
    return [homeTabDisplay, ...pdfTabsDisplay];
  })();

  const handleTabCloseClick = (e, tabId) => {
    e.stopPropagation();
    onTabClose(tabId);
  };


  const handlePageDragOver = (e, targetTabId) => {
    // Check if this is a page drag by checking dataTransfer types
    const types = Array.from(e.dataTransfer.types || []);
    if (!types.includes('application/pdf-page')) {
      return; // Not a page drag
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // We can't read the data in dragOver, but we can check types
    // Store the target tab for visual feedback
    // The actual data will be read in the drop handler
    e.dataTransfer.dropEffect = 'move';
    setDragOverTabId(targetTabId);
  };

  const handlePageDragLeave = (e, targetTabId) => {
    // Only clear if we're actually leaving the tab (not just moving to a child element)
    const relatedTarget = e.relatedTarget;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDragOverTabId(null);
    }
  };

  const handlePageDrop = (e, targetTabId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTabId(null);
    
    try {
      const data = e.dataTransfer.getData('application/pdf-page');
      if (!data) return;
      
      const pageData = JSON.parse(data);
      if (pageData.tabId === targetTabId) return; // Can't drop on same tab
      
      if (onPageDrop) {
        onPageDrop(pageData.tabId, pageData.pageNumber, targetTabId);
      }
    } catch (err) {
      console.error('Error handling page drop:', err);
    }
  };


  return (
    <div
      ref={tabBarRef}
      style={{
        display: 'flex',
        background: '#1e1e1e',
        borderBottom: '1px solid #3a3a3a',
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        scrollbarWidth: 'thin',
        scrollbarColor: '#555 #1e1e1e'
      }}
    >
      <style>{`
        .tab-bar::-webkit-scrollbar {
          height: 6px;
        }
        .tab-bar::-webkit-scrollbar-track {
          background: #1e1e1e;
        }
        .tab-bar::-webkit-scrollbar-thumb {
          background: #555;
          border-radius: 3px;
        }
        .tab-bar::-webkit-scrollbar-thumb:hover {
          background: #666;
        }
      `}</style>
      <div
        ref={tabContainerRef}
        className="tab-bar"
        style={{
          display: 'flex',
          minWidth: '100%',
          height: '40px'
        }}
      >
        {displayTabs
          .sort((a, b) => {
            // Always put home tab first
            if (a.item.isHome) return -1;
            if (b.item.isHome) return 1;
            return a.index - b.index;
          })
          .map(({ item: tab }) => {
            const isActive = tab.id === activeTabId;
            const isDragging = tabDraggingState?.itemId === tab.id;
            const isHome = tab.isHome;

            return (
              <div
                key={tab.id}
                ref={(el) => {
                  // Only register PDF tabs for drag-to-reorder
                  if (!isHome) {
                    registerTabRef(tab.id, el);
                  }
                }}
                onClick={() => onTabClick(tab.id)}
                onDragOver={(e) => !isHome && handlePageDragOver(e, tab.id)}
                onDragLeave={(e) => !isHome && handlePageDragLeave(e, tab.id)}
                onDrop={(e) => !isHome && handlePageDrop(e, tab.id)}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  minWidth: isHome ? '240px' : '200px',
                  maxWidth: isHome ? '240px' : '300px',
                  width: isHome ? '240px' : 'auto',
                  height: '40px',
                  padding: '0 12px',
                  background: dragOverTabId === tab.id ? '#3a3a3a' : (isActive ? '#2b2b2b' : '#252525'),
                  borderRight: '1px solid #3a3a3a',
                  borderTop: isActive ? '2px solid #4A90E2' : (dragOverTabId === tab.id ? '2px solid #4A90E2' : '2px solid transparent'),
                  cursor: 'pointer',
                  userSelect: 'none',
                  opacity: isDragging ? 0.5 : 1,
                  transition: 'background 0.15s ease, border-color 0.15s ease',
                  fontFamily: FONT_FAMILY,
                  fontSize: '13px',
                  color: isActive ? '#ddd' : '#999'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = '#2a2a2a';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = '#252525';
                  }
                }}
              >
                {/* Drag handle - hidden for home tab */}
                {!isHome && (
                  <div
                    data-tab-drag-handle
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleTabGrab(e, tab.id);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'grab',
                      padding: '4px',
                      marginRight: '8px',
                      color: '#666',
                      fontSize: '12px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#999';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#666';
                    }}
                  >
                    <Icon name="grip" size={12} />
                  </div>
                )}

                {/* Tab icon - home icon for home tab, blue circle for PDFs with unsaved changes */}
                {isHome ? (
                  <Icon 
                    name="home" 
                    size={14} 
                    style={{ marginRight: '8px', flexShrink: 0 }} 
                  />
                ) : tab.hasUnsavedAnnotations ? (
                  <span
                    style={{
                      width: '5px',
                      height: '5px',
                      borderRadius: '50%',
                      background: '#4A90E2',
                      display: 'inline-block',
                      marginRight: '8px',
                      flexShrink: 0
                    }}
                    title="Unsaved changes (Cmd/Ctrl+S to save)"
                  />
                ) : (
                  <div style={{ width: '14px', marginRight: '8px', flexShrink: 0 }} />
                )}

                {/* Tab title */}
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontWeight: isActive ? '500' : '400'
                  }}
                  title={tab.name}
                >
                  {tab.name}
                </span>

                {/* Close button - hidden for home tab */}
                {!isHome && (
                  <button
                    onClick={(e) => handleTabCloseClick(e, tab.id)}
                    style={{
                      marginLeft: '8px',
                      padding: '4px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#666',
                      transition: 'all 0.15s ease',
                      flexShrink: 0
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#3a3a3a';
                      e.currentTarget.style.color = '#ddd';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#666';
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default TabBar;

