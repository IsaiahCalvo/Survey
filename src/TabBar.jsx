/**
 * TabBar.jsx — horizontal browser-style tab strip for the Home tab + open PDF documents.
 *
 * Default-export component built on @dnd-kit for drag-to-reorder of PDF tabs
 * (Home tab is pinned, non-draggable); calls onTabClick / onTabClose /
 * onTabReorder and accepts cross-tab page drops via `application/pdf-page`.
 * Each tab shows an unsaved-annotation dot and a red dual-write-pending dot
 * sourced from a single useDocsPendingDualWrite() Set (called once, never in
 * the .map loop, to keep React hook counts stable when a tab closes).
 */
import { useState, useRef, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from './Icons';
// Phase 30 — per-tab subscription to the dual-write retry queue. Each tab
// renders its own dot independently when its documentId has at least one
// non-quarantined queue entry. CONTEXT.md AC-13 / 30-UI-SPEC.md Surface 3.
import { useDocsPendingDualWrite } from './hooks/useTabPendingDualWrite.js';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const TAB_HEIGHT = 32;
const HOME_TAB_WIDTH = 148;
const PDF_TAB_MIN_WIDTH = 168;
const PDF_TAB_MAX_WIDTH = 280;
const TAB_BAR_BG = 'var(--surface-0)';
const TAB_IDLE_BG = 'var(--surface-1)';
const TAB_ACTIVE_BG = 'var(--surface-2)';
const TAB_HOVER_BG = 'var(--surface-3)';
const TAB_BORDER = 'var(--border)';
const TAB_TEXT = 'var(--text-3)';
const TAB_TEXT_ACTIVE = 'var(--text-1)';
const TAB_ACCENT = 'var(--accent)';

const restrictTabsToHorizontalAxis = ({ transform }) => ({
  ...transform,
  y: 0,
});

const createTabBoundsModifier = () => ({ active, activeNodeRect, transform }) => {
  const activeIdValue = String(active?.id ?? '');
  const activeNode = Array.from(document.querySelectorAll('[data-pdf-tab-id]'))
    .find((node) => node.dataset.pdfTabId === activeIdValue);
  const listNode = activeNode?.closest?.('[data-pdf-tab-list]');

  if (!activeNodeRect || !activeNode || !listNode) {
    return transform;
  }

  const itemRects = Array.from(listNode.querySelectorAll('[data-pdf-tab-id]'))
    .map((node) => ({
      left: node.offsetLeft,
      right: node.offsetLeft + node.offsetWidth,
    }))
    .filter((rect) => rect.right > rect.left);

  if (!itemRects.length) {
    return transform;
  }

  const left = Math.min(...itemRects.map((rect) => rect.left));
  const right = Math.max(...itemRects.map((rect) => rect.right));

  return {
    ...transform,
    x: Math.min(
      Math.max(transform.x, left - activeNode.offsetLeft),
      right - (activeNode.offsetLeft + activeNode.offsetWidth)
    ),
  };
};

const moveArrayItem = (items, fromIndex, toIndex) => {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const nextItems = items.slice();
  const [moved] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, moved);
  return nextItems;
};

function TabItem({
  tab,
  isActive,
  isHome,
  isSorting = false,
  isDragging = false,
  dragOverTabId,
  hasPendingDualWrite,
  onTabClick,
  onTabClose,
  onPageDragOver,
  onPageDragLeave,
  onPageDrop,
  sortableAttributes = {},
  sortableListeners = {},
  setNodeRef = null,
  style: sortableStyle = {},
}) {
  const handleTabCloseClick = (e) => {
    e.stopPropagation();
    onTabClose(tab.id);
  };

  return (
    <div
      ref={setNodeRef}
      {...sortableAttributes}
      {...sortableListeners}
      data-pdf-tab-id={!isHome ? tab.id : undefined}
      onClick={() => onTabClick(tab.id)}
      onDragOver={(e) => !isHome && onPageDragOver(e, tab.id)}
      onDragLeave={(e) => !isHome && onPageDragLeave(e, tab.id)}
      onDrop={(e) => !isHome && onPageDrop(e, tab.id)}
      style={{
        ...sortableStyle,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minWidth: isHome ? `${HOME_TAB_WIDTH}px` : `${PDF_TAB_MIN_WIDTH}px`,
        maxWidth: isHome ? `${HOME_TAB_WIDTH}px` : `${PDF_TAB_MAX_WIDTH}px`,
        width: isHome ? `${HOME_TAB_WIDTH}px` : 'auto',
        height: `${TAB_HEIGHT}px`,
        padding: '0 10px',
        background: dragOverTabId === tab.id ? TAB_HOVER_BG : (isActive ? TAB_ACTIVE_BG : TAB_IDLE_BG),
        borderRight: `1px solid ${TAB_BORDER}`,
        borderTop: isActive ? `2px solid ${TAB_ACCENT}` : (dragOverTabId === tab.id ? `2px solid ${TAB_ACCENT}` : '2px solid transparent'),
        cursor: isHome ? 'pointer' : (isDragging ? 'grabbing' : 'grab'),
        userSelect: 'none',
        opacity: isDragging ? 0.92 : 1,
        transition: isDragging
          ? 'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease'
          : [sortableStyle.transition, 'background 0.15s ease', 'border-color 0.15s ease', 'box-shadow 0.15s ease'].filter(Boolean).join(', '),
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        color: isActive ? TAB_TEXT_ACTIVE : TAB_TEXT,
        zIndex: isDragging ? 5 : undefined,
        boxShadow: isDragging ? '0 10px 26px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(216,168,78,0.28)' : 'none',
        touchAction: isHome ? undefined : 'none',
      }}
      onMouseEnter={(e) => {
        if (!isActive && !isSorting) {
          e.currentTarget.style.background = TAB_HOVER_BG;
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive && !isSorting) {
          e.currentTarget.style.background = TAB_IDLE_BG;
        }
      }}
    >
      {isHome ? (
        <Icon
          name="homeTab"
          size={13}
          style={{ marginRight: '7px', flexShrink: 0 }}
        />
      ) : tab.hasUnsavedAnnotations ? (
        <span
          style={{
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: TAB_ACCENT,
            display: 'inline-block',
            marginRight: '7px',
            flexShrink: 0
          }}
          title="Unsaved changes (Cmd/Ctrl+S to save)"
        />
      ) : (
        <div style={{ width: '12px', marginRight: '7px', flexShrink: 0 }} />
      )}

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

      {!isHome && hasPendingDualWrite && (
        <span
          role="status"
          aria-label="This document has unsaved changes"
          title="This document has unsaved changes"
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--danger)',
            display: 'inline-block',
            marginRight: '7px',
            flexShrink: 0
          }}
        />
      )}

      {!isHome && (
        <button
          onClick={handleTabCloseClick}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            marginLeft: '7px',
            padding: '3px',
            background: 'transparent',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-disabled)',
            transition: 'all 0.15s ease',
            flexShrink: 0
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = TAB_HOVER_BG;
            e.currentTarget.style.color = TAB_TEXT_ACTIVE;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = TAB_TEXT;
          }}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  );
}

function SortablePdfTab(props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({ id: props.tab.id });

  return (
    <TabItem
      {...props}
      isDragging={isDragging}
      isSorting={isSorting}
      setNodeRef={setNodeRef}
      sortableAttributes={attributes}
      sortableListeners={listeners}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
    />
  );
}

const TabBar = ({ tabs, activeTabId, onTabClick, onTabClose, onTabReorder, onPageDrop }) => {
  const [dragOverTabId, setDragOverTabId] = useState(null);
  const tabBarRef = useRef(null);

  // Phase 30 — fix 2026-04-29: previously each tab in the .map() loop called
  // useTabPendingDualWrite individually; the hook count changed when a tab
  // was closed, triggering React's "Rendered fewer hooks than expected"
  // crash on every PDF close. Now we call the hook ONCE at the top with no
  // arguments and get back a Set of documentIds with stuck queue entries.
  // The .map() consults the Set — no hooks inside the loop.
  const pendingDualWriteDocIds = useDocsPendingDualWrite();

  // Use drag-to-reorder for tabs (excluding home tab)
  const pdfTabs = tabs.filter(t => !t.isHome);
  const homeTab = tabs.find(t => t.isHome);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const tabModifiers = useMemo(() => [
    restrictTabsToHorizontalAxis,
    createTabBoundsModifier(),
  ], []);

  const handleTabDragEnd = useCallback(({ active, over }) => {
    if (!over || active.id === over.id) return;

    const fromIndex = pdfTabs.findIndex((tab) => tab.id === active.id);
    const toIndex = pdfTabs.findIndex((tab) => tab.id === over.id);
    const reorderedPdfTabs = moveArrayItem(pdfTabs, fromIndex, toIndex);

    if (reorderedPdfTabs === pdfTabs) return;

    flushSync(() => {
      onTabReorder(homeTab ? [homeTab, ...reorderedPdfTabs] : reorderedPdfTabs);
    });
  }, [homeTab, onTabReorder, pdfTabs]);

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
        background: TAB_BAR_BG,
        borderBottom: `1px solid ${TAB_BORDER}`,
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        scrollbarWidth: 'thin',
        scrollbarColor: `${TAB_BORDER} ${TAB_BAR_BG}`
      }}
    >
      <style>{`
        .tab-bar::-webkit-scrollbar {
          height: 6px;
        }
        .tab-bar::-webkit-scrollbar-track {
          background: ${TAB_BAR_BG};
        }
        .tab-bar::-webkit-scrollbar-thumb {
          background: ${TAB_BORDER};
          border-radius: 3px;
        }
        .tab-bar::-webkit-scrollbar-thumb:hover {
          background: var(--surface-3);
        }
      `}</style>
      <div
        className="tab-bar"
        style={{
          display: 'flex',
          minWidth: '100%',
          height: `${TAB_HEIGHT}px`
        }}
      >
        {homeTab && (
          <TabItem
            tab={homeTab}
            isActive={homeTab.id === activeTabId}
            isHome
            dragOverTabId={dragOverTabId}
            hasPendingDualWrite={false}
            onTabClick={onTabClick}
            onTabClose={onTabClose}
            onPageDragOver={handlePageDragOver}
            onPageDragLeave={handlePageDragLeave}
            onPageDrop={handlePageDrop}
          />
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={tabModifiers}
          onDragEnd={handleTabDragEnd}
        >
          <SortableContext items={pdfTabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
            <div data-pdf-tab-list style={{ display: 'flex', height: `${TAB_HEIGHT}px` }}>
              {pdfTabs.map((tab) => {
                // Phase 30 — per-tab dual-write dot. We do NOT call a hook here
                // (closing a tab would change the hook count and crash render).
                // Consult the Set computed once at the top of TabBar instead.
                const tabDocId = tab.documentId || tab.id;
                const hasPendingDualWrite = pendingDualWriteDocIds.has(tabDocId);
                const isActive = tab.id === activeTabId;

                return (
                  <SortablePdfTab
                    key={tab.id}
                    tab={tab}
                    isActive={isActive}
                    isHome={false}
                    dragOverTabId={dragOverTabId}
                    hasPendingDualWrite={hasPendingDualWrite}
                    onTabClick={onTabClick}
                    onTabClose={onTabClose}
                    onPageDragOver={handlePageDragOver}
                    onPageDragLeave={handlePageDragLeave}
                    onPageDrop={handlePageDrop}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
};

export default TabBar;
