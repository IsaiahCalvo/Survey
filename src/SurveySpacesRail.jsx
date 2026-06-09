// SurveySpacesRail — the survey right rail. Renders the Survey panel docked on
// the right side of the viewer: the module/category controls, the survey-marker
// toolbar, and the export block (Open / Push / Pull / Live Sync). Published to
// the app shell via the rightRailApi object (mirrors the leftRailApi pattern);
// it talks to the shell purely through props, so it can be developed on its own.
//
// NAME NOTE: "Spaces" in the filename refers to the module/space data duality and
// the "Copy to Spaces" survey-marker action — this component renders NO Spaces
// tab or Spaces UI. The Spaces panel lives in the LEFT rail (PDFSidebar).
// Accurate rename candidate: SurveyRail.jsx.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Icon from './Icons';
import EntityIndicator from './components/EntityIndicator';
import DragRearrangeHandle from './reorder/DragRearrangeHandle';
import { SortableRearrangeList, SortableRearrangeRow } from './reorder/SortableRearrangeList';
import { moveItemById } from './reorder/flatReorderUtils.js';
import { COLORS } from './theme';
import reviewWarningIcon from './assets/review-warning.svg';
import { syncMessagePresentation } from './services/excelSyncStatus';
import { compareSurveyMarkersForOrder } from './utils/surveyMarkerOrdering';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

const getElementCenterY = (element) => {
  const rect = element?.getBoundingClientRect?.();
  return rect ? rect.top + rect.height / 2 : null;
};

const getNearestVerticalScrollContainer = (element) => {
  if (typeof window === 'undefined') return null;
  let current = element?.parentElement || null;
  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    if (
      /auto|scroll|overlay/.test(style.overflowY || '')
      && current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return document.scrollingElement || document.documentElement;
};

const preserveElementViewportY = (element, mutateLayout) => {
  const beforeY = getElementCenterY(element);
  const scrollContainer = getNearestVerticalScrollContainer(element);

  mutateLayout();

  if (beforeY == null || !scrollContainer) return;
  const afterY = getElementCenterY(element);
  if (afterY == null) return;

  const deltaY = afterY - beforeY;
  if (Math.abs(deltaY) < 0.5) return;

  if (scrollContainer === document.scrollingElement || scrollContainer === document.documentElement) {
    window.scrollBy(0, deltaY);
  } else {
    scrollContainer.scrollTop += deltaY;
  }
};

const SurveyMarkerLeadingSelect = ({
  selected,
  onClick,
  title,
  ariaLabel,
  category = false
}) => (
  <button
    type="button"
    className={`survey-marker-leading-control survey-marker-leading-check${category ? ' survey-marker-leading-control-category' : ''}${selected ? ' is-selected' : ''}`}
    title={title}
    aria-label={ariaLabel}
    aria-pressed={selected}
    onClick={(event) => {
      event.stopPropagation();
      onClick?.(event);
    }}
  >
    <span className="survey-marker-leading-checkbox" aria-hidden="true">
      {selected && <span className="survey-marker-leading-checkmark">✓</span>}
    </span>
  </button>
);

const formatConflictFieldLabel = (field) => {
  if (!field) return null;
  if (field === 'item') return 'Item name';
  if (field === 'entity') return 'Entity';
  if (field === 'notes') return 'Notes';
  if (field === 'changedBy') return 'Changed by';
  if (field === 'changedDate') return 'Changed date';
  if (String(field).startsWith('answer:')) return 'Checklist answer';
  return String(field);
};

const SurveyMarkerReviewIndicator = ({
  markerId,
  message,
  conflict,
  onKeepApp,
  onUseExcel
}) => {
  if (!message) return null;

  const conflictFields = Array.isArray(conflict?.conflictFields)
    ? [...new Set(conflict.conflictFields.map(formatConflictFieldLabel).filter(Boolean))]
    : [];

  return (
    <span className="survey-marker-review-wrap">
      <button
        type="button"
        className="survey-marker-review-button"
        aria-label={message}
        aria-describedby={`survey-marker-review-${markerId || (conflict ? 'conflict' : 'review')}`}
        onClick={(event) => event.stopPropagation()}
      >
        <img src={reviewWarningIcon} alt="" width={15} height={15} aria-hidden="true" />
      </button>
      <span
        id={`survey-marker-review-${markerId || (conflict ? 'conflict' : 'review')}`}
        className="survey-marker-review-tooltip"
        role="tooltip"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="survey-marker-review-tooltip-title">
          {conflict ? 'Excel sync conflict' : 'Excel sync review'}
        </span>
        <span className="survey-marker-review-tooltip-body">
          {message}
        </span>
        {conflictFields.length > 0 && (
          <span className="survey-marker-review-tooltip-meta">
            Affected: {conflictFields.join(', ')}
          </span>
        )}
        {conflict && (
          <span className="survey-marker-review-tooltip-actions">
            <button type="button" onClick={onKeepApp}>Keep app</button>
            <button type="button" onClick={onUseExcel}>Use Excel</button>
          </span>
        )}
      </span>
    </span>
  );
};

const SurveySpacesRail = ({
  activeSpaceId,
  annotationsByPage,
  applyLayoutDrivenZoom,
  categorySelectModeActive,
  copiedItemSelection,
  copyModeActive,
  DEFAULT_SURVEY_MARKER_OPACITY,
  deleteAnnotations,
  deleteCategory = () => {},
  documentSyncEnabled,
  expandedCategories,
  expandedSurveyMarkers,
  exportMenuRef,
  features,
  getCanvasAnnotationVisibilityState,
  getCategoryName,
  getModuleDataKey,
  getModuleName,
  getSurveyAnnotationVisibilityState,
  graphClient,
  handleCancelRegionEdit,
  handleDeleteSurveyMarkerItem,
  handleExitSpaceMode,
  handleExportSpaceToCSV,
  handleExportSpaceToPDF,
  handleExportSurveyToExcel,
  handleLocateItemOnPDF,
  handleReorderSurveyCategories = () => {},
  handleReorderSpaces,
  handleRequestRegionEdit,
  handleSetActiveSpace,
  handleSpaceAssignPages,
  handleSpaceCreate,
  handleSpaceDelete,
  handleSpaceRemovePage,
  handleSpaceRenamePage,
  handleSpaceUpdate,
  handleSurveyToggle,
  handleSyncFromExcel,
  handleToggleCanvasAnnotations,
  handleToggleRegionOverlay,
  handleToggleSurveyAnnotations,
  hexToRgba,
  isExporting,
  isRegionOverlayEnabled,
  isRegionOverlayToggleEnabled,
  itemSelectModeActive,
  items,
  lastSyncMessage,
  linkedExcelExists,
  liveSyncEnabled,
  liveSyncStatus,
  liveSyncSupported,
  msLogin,
  msNeedsReconnect,
  normalizeSurveyMarkerColor,
  numPages,
  onRequestCreateTemplate,
  pdfFile,
  scale,
  selectedCategories,
  selectedCategoryId,
  selectedItemsInCategory,
  selectedModuleId,
  selectedSpaceId,
  selectedTemplate,
  setActiveCategoryDropdown,
  setActiveTool,
  setAnnotations,
  setAnnotationsByPage,
  setCategorySelectModeActive,
  setCategorySelectModeForCategory,
  setCopiedItemSelection,
  setCopyModeActive,
  setExpandedCategories,
  setExpandedSurveyMarkers,
  setItemSelectModeActive,
  setItems,
  setLiveSyncEnabled,
  setNewSurveyMarkersByPage,
  setNoteDialogContent,
  setNoteDialogOpen,
  setPendingLocationItem,
  setSelectedCategories,
  setSelectedCategoryId,
  setSelectedItemsInCategory,
  setSelectedModuleId,
  setSelectedSpaceId,
  setShowExportMenu,
  setShowSpaceSelection,
  setShowSurveyPanel,
  setSurveyMarkers,
  setSurveyMarkersToRemoveByPage,
  showExportMenu,
  showRegionSelection,
  showSurveyPanel,
  spaces,
  surveyMarkers,
  surveyReviewByMarkerId = {},
  surveyConflictByMarkerId = {},
  onResolveExcelConflict = null,
  user,
  expandRequestKey = 0,
  onCollapseChange = null,
}) => {
  const [isSurveyPanelCollapsed, setIsSurveyPanelCollapsed] = useState(true);
  const [openEntityDropdownId, setOpenEntityDropdownId] = useState(null);
  const [railIconHover, setRailIconHover] = useState(null);
  const surveyMarkerDragRestoreRef = useRef(null);

  useEffect(() => {
    if (showSurveyPanel) {
      setIsSurveyPanelCollapsed(false);
    }
  }, [showSurveyPanel]);

  useEffect(() => {
    if (expandRequestKey > 0) {
      setIsSurveyPanelCollapsed(false);
    }
  }, [expandRequestKey]);

  useEffect(() => {
    if (typeof onCollapseChange === 'function') {
      onCollapseChange(isSurveyPanelCollapsed);
    }
  }, [isSurveyPanelCollapsed, onCollapseChange]);

  useEffect(() => {
    if (!openEntityDropdownId) return undefined;
    const closeEntityDropdown = (event) => {
      if (event.target?.closest?.('.survey-marker-entity-select-wrap')) return;
      setOpenEntityDropdownId(null);
    };
    const closeEntityDropdownOnEscape = (event) => {
      if (event.key === 'Escape') setOpenEntityDropdownId(null);
    };
    document.addEventListener('mousedown', closeEntityDropdown, true);
    document.addEventListener('keydown', closeEntityDropdownOnEscape, true);
    return () => {
      document.removeEventListener('mousedown', closeEntityDropdown, true);
      document.removeEventListener('keydown', closeEntityDropdownOnEscape, true);
    };
  }, [openEntityDropdownId]);

  // O(1) entity-by-id lookup for the per-marker render loop below (entity ids are
  // unique, so a Map.get matches the old entities.find first-and-only result).
  const entitiesMap = useMemo(() => {
    const entities = selectedTemplate?.entities || [];
    return new Map(entities.map((e) => [e.id, e]));
  }, [selectedTemplate?.entities]);

  // O(1) item-by-name+type lookup for the per-marker render loop below.
  // Replaces repeated O(|items|) Object.values(items).find(name && itemType)
  // scans. Names+itemType pairs are unique per item, so Map.get matches the
  // old find first-and-only result.
  const itemsByNameType = useMemo(() => {
    const m = new Map();
    Object.values(items).forEach(item => {
      if (item?.name != null && item?.itemType != null) {
        const k = `${item.name}\0${item.itemType}`;
        // First-match wins, exactly like the original Object.values(items).find():
        // if two items share name+type, keep the earliest (do not overwrite).
        if (!m.has(k)) m.set(k, item);
      }
    });
    return m;
  }, [items]);

  const commitSurveyMarkerName = (annotationId, categoryId, previousName, nextRawName, fallbackName) => {
    const nextName = (nextRawName || '').trim() || fallbackName;
    const oldName = (previousName || '').trim() || fallbackName;
    if (!annotationId || nextName === oldName) return;

    const currentMarker = surveyMarkers[annotationId] || {};
    setSurveyMarkers(prev => ({
      ...prev,
      [annotationId]: {
        ...(prev[annotationId] || {}),
        name: nextName
      }
    }));

    if (!selectedTemplate || !selectedModuleId || !categoryId) return;
    const categoryName = getCategoryName(selectedTemplate, selectedModuleId, categoryId);
    const itemFromMarkerId = currentMarker.itemId ? items[currentMarker.itemId] : null;
    const matchingItem = itemFromMarkerId || itemsByNameType.get(`${oldName}\0${categoryName}`);
    if (!matchingItem?.itemId) return;

    setItems(prev => ({
      ...prev,
      [matchingItem.itemId]: {
        ...(prev[matchingItem.itemId] || matchingItem),
        name: nextName
      }
    }));
  };

  const surveyMarkerRowActionStyle = {
    width: '22px',
    height: '22px',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background 0.2s, color 0.2s',
    marginLeft: 0,
    flex: '0 0 22px',
    transform: 'none',
    boxShadow: 'none'
  };

  const toggleSurveyMarkerExpanded = (annotationId) => {
    if (!annotationId) return;
    setExpandedSurveyMarkers(prev => ({
      ...prev,
      [annotationId]: !prev[annotationId]
    }));
  };

  const getEntitySwatchStyle = (color) => {
    const exactColor = color || null;
    return {
      backgroundColor: '#fff',
      borderColor: exactColor ? 'rgba(255, 255, 255, 0.58)' : '#777',
      '--survey-marker-entity-swatch-color': exactColor || 'transparent'
    };
  };

  const restoreSurveyMarkerAfterDrag = useCallback((delayMs = 180) => {
    const restoreState = surveyMarkerDragRestoreRef.current;
    if (!restoreState?.annotationId) return;

    if (restoreState.fallbackTimer) {
      clearTimeout(restoreState.fallbackTimer);
    }
    if (restoreState.restoreTimer) {
      clearTimeout(restoreState.restoreTimer);
    }

    restoreState.restoreTimer = setTimeout(() => {
      const latestRestoreState = surveyMarkerDragRestoreRef.current;
      const annotationId = latestRestoreState?.annotationId;
      if (annotationId) {
        setExpandedSurveyMarkers(prev => (
          prev[annotationId] ? prev : { ...prev, [annotationId]: true }
        ));
      }
      surveyMarkerDragRestoreRef.current = null;
    }, delayMs);
  }, [setExpandedSurveyMarkers]);

  useEffect(() => () => {
    const restoreState = surveyMarkerDragRestoreRef.current;
    if (restoreState?.fallbackTimer) clearTimeout(restoreState.fallbackTimer);
    if (restoreState?.restoreTimer) clearTimeout(restoreState.restoreTimer);
  }, []);

  const markSurveyMarkerDragStarted = useCallback(() => {
    const restoreState = surveyMarkerDragRestoreRef.current;
    if (!restoreState) return;
    restoreState.dragStarted = true;
    if (restoreState.fallbackTimer) {
      clearTimeout(restoreState.fallbackTimer);
      restoreState.fallbackTimer = null;
    }
  }, []);

  const collapseSurveyMarkerBeforeDrag = useCallback((annotationId, { restoreAfterDrag = false } = {}) => {
    if (!annotationId) return;

    if (restoreAfterDrag) {
      const existingRestoreState = surveyMarkerDragRestoreRef.current;
      if (existingRestoreState?.fallbackTimer) clearTimeout(existingRestoreState.fallbackTimer);
      if (existingRestoreState?.restoreTimer) clearTimeout(existingRestoreState.restoreTimer);
      surveyMarkerDragRestoreRef.current = {
        annotationId,
        dragStarted: false,
        fallbackTimer: setTimeout(() => {
          const restoreState = surveyMarkerDragRestoreRef.current;
          if (restoreState?.annotationId === annotationId && !restoreState.dragStarted) {
            restoreSurveyMarkerAfterDrag(0);
          }
        }, 650),
        restoreTimer: null,
      };
    }

    setOpenEntityDropdownId(prev => (
      prev === `${annotationId}:entity` ? null : prev
    ));
    setExpandedSurveyMarkers(prev => {
      if (!prev[annotationId]) return prev;
      return {
        ...prev,
        [annotationId]: false
      };
    });
  }, [restoreSurveyMarkerAfterDrag, setExpandedSurveyMarkers]);

  const reorderSurveyMarkersInCategory = useCallback((orderedMarkers, activeId, overId) => {
    if (!Array.isArray(orderedMarkers) || !overId || activeId === overId) return;

    const reorderedMarkers = moveItemById(orderedMarkers, activeId, overId);
    if (reorderedMarkers === orderedMarkers) return;

    setSurveyMarkers(prev => {
      let changed = false;
      const next = { ...prev };

      reorderedMarkers.forEach((marker, index) => {
        const markerId = marker.id;
        const existing = next[markerId];
        if (!existing) return;

        const nextOrder = index + 1;
        if (existing.surveyMarkerOrder !== nextOrder) {
          next[markerId] = {
            ...existing,
            surveyMarkerOrder: nextOrder
          };
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [setSurveyMarkers]);

  return (
          <>
            {/* Panel */}
            {/* UX 2026-05-29: the right rail starts at the same y-coordinate as
                chrome-sub-toolbar-host. It overlays the right edge of that strip
                instead of pushing or sitting below it, mirroring the left rail's
                top collapse row. */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                height: '100%',
                width: isSurveyPanelCollapsed ? '48px' : '320px',
                background: '#252525',
                borderLeft: '1px solid #3a3a3a',
                zIndex: 1,
                display: 'flex',
                flexDirection: 'column',
	                animation: 'slideInRight 0.3s ease-out',
                transition: 'width 0.2s ease, right 0.2s ease, top 0.2s ease, height 0.2s ease'
              }}
            >
              {/* Collapsed strip — Survey icon only, with a hover tooltip.
                  Mirrors the left rail's collapsed button metrics while keeping
                  Survey in its own persistent right-side home. */}
              {isSurveyPanelCollapsed && (
                <>
                  <div style={{
                    height: '35px',
                    padding: '0 8px',
                    borderBottom: '1px solid #3a3a3a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    background: '#252525',
                    flexShrink: 0
                  }}>
                    <button
                      onClick={() => {
                        setIsSurveyPanelCollapsed(false);
                        requestAnimationFrame(() => { applyLayoutDrivenZoom(); });
                      }}
                      aria-label="Expand panel"
                      style={{ background: 'transparent', border: 'none', color: '#999', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Icon name="chevronLeft" size={16} color="#999" />
                    </button>
                  </div>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '8px',
                    gap: '4px',
                    background: '#252525',
                    position: 'relative',
                    flex: 1
                  }}>
                    <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
                      <button
                        onClick={() => {
                          setRailIconHover(null);
                          if (showSurveyPanel) {
                            setIsSurveyPanelCollapsed(false);
                          } else {
                            setIsSurveyPanelCollapsed(false);
                            handleSurveyToggle();
                          }
                          requestAnimationFrame(() => { applyLayoutDrivenZoom(); });
                        }}
                        aria-label="Survey"
                        title="Survey"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: showSurveyPanel ? '#4A90E2' : '#999',
                          cursor: 'pointer',
                          padding: '10px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'background 0.15s',
                          minWidth: '28px',
                          minHeight: '28px',
                          width: '100%'
                        }}
                        onMouseEnter={(e) => {
                          setRailIconHover('survey');
                          e.currentTarget.style.background = '#2b2b2b';
                        }}
                        onMouseLeave={(e) => {
                          setRailIconHover(null);
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <Icon
                          name="survey"
                          size={20}
                          color="currentColor"
                          style={{ width: '20px', height: '20px', flexShrink: 0 }}
                        />
                      </button>
                      {railIconHover === 'survey' && (
                        <div style={{ position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: '8px', background: '#1a1a1a', color: '#ddd', padding: '6px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid #3a3a3a', whiteSpace: 'nowrap', fontFamily: FONT_FAMILY, pointerEvents: 'none', zIndex: 10000, boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)' }}>
                          Survey
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {!isSurveyPanelCollapsed && (
                <>
                  {/* Collapse row: mirrors the left rail's top strip. */}
                  <div
                    style={{
                      height: '35px',
                      padding: '0 8px',
                      borderBottom: '1px solid #3a3a3a',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      background: '#252525',
                      flexShrink: 0
                    }}
                  >
                    <button
                      onClick={() => {
                        setIsSurveyPanelCollapsed(prev => !prev);
                        requestAnimationFrame(() => {
                          applyLayoutDrivenZoom();
                        });
                      }}
                      aria-label="Collapse Survey panel"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgb(153, 153, 153)',
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Icon name="chevronRight" size={16} color="#999" />
                    </button>
                  </div>

                  {selectedTemplate && showSurveyPanel ? (
                  <>
                  {/* Template title lives below the rail tabs, not in the collapse row. */}
                  <div style={{
                    padding: '12px 12px 10px',
                    borderBottom: '1px solid #3a3a3a',
                    background: '#252525',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flexShrink: 0
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h2
                        style={{
                          margin: 0,
                          fontSize: '18px',
                          fontWeight: '600',
                          color: '#fff',
                          fontFamily: FONT_FAMILY,
                          letterSpacing: '-0.2px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {categorySelectModeActive && selectedModuleId
                          ? ((selectedTemplate.modules || selectedTemplate.spaces || []).find(m => m.id === selectedModuleId)?.name || 'Survey')
                          : (selectedTemplate.name || 'Survey')}
                      </h2>
                      {!categorySelectModeActive && selectedTemplate.linkedExcelPath && lastSyncMessage && (() => {
                        // Color the banner by the message's tone so warnings (close Excel,
                        // needs your choice, queued) and successes (synced/saved) no longer
                        // look identical to neutral info. See services/excelSyncStatus.
                        const tone = syncMessagePresentation(lastSyncMessage);
                        return (
                          <div style={{
                            marginTop: '6px',
                            fontSize: '11px',
                            color: tone.color,
                            padding: '4px 8px',
                            background: tone.background,
                            borderRadius: '4px',
                            border: tone.border
                          }}>
                            {lastSyncMessage}
                          </div>
                        );
                      })()}
                    </div>
                    <button
                      onClick={() => {
                        if (categorySelectModeActive) {
                          setCategorySelectModeActive(false);
                          setCategorySelectModeForCategory(null);
                          setSelectedCategories({});
                        } else {
                          setShowSurveyPanel(false);
                          setIsSurveyPanelCollapsed(true);
                          setSelectedSpaceId(null);
                          setSelectedModuleId(null);
                          setSelectedCategoryId(null);
                          setActiveCategoryDropdown(null);
                          setActiveTool('select');
                        }
                      }}
                      className="btn btn-icon btn-icon-sm"
                      aria-label="Close Survey panel"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ddd',
                        padding: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>

                  {/* Modules Tabs */}
                  {((selectedTemplate.modules || selectedTemplate.spaces) || []).length > 0 && (
                    <div style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid #3a3a3a',
                      background: '#252525',
                      display: 'flex',
                      gap: '6px',
                      overflowX: 'auto',
                      flexShrink: 0
                    }}>
                      {(selectedTemplate.modules || selectedTemplate.spaces || []).map(module => (
                        <button
                          key={module.id}
                          onClick={() => {
                            setSelectedModuleId(module.id);
                            setSelectedCategoryId(null); // Reset category when switching modules
                            setActiveCategoryDropdown('survey');
                            setActiveTool('survey-marker');
                            // Exit select mode when switching modules
                            setCopyModeActive(false);
                            setCopiedItemSelection({});
                            if (categorySelectModeActive) {
                              setSelectedCategories({});
                            }
                          }}
                          className="btn btn-sm"
                          style={{
                            background: selectedModuleId === module.id ? '#4A90E2' : '#3A3A3A',
                            color: selectedModuleId === module.id ? '#fff' : '#DDD',
                            border: selectedModuleId === module.id ? '1px solid #4A90E2' : '1px solid #444',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            borderRadius: '6px'
                          }}
                        >
                          {module.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Panel Content */}
                  <div style={{
                    flex: categorySelectModeActive ? '1 1 auto' : 1,
                    overflowY: 'auto',
                    padding: '12px 10px',
                    fontFamily: FONT_FAMILY,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0
                  }}>
                    {selectedModuleId ? (() => {
                      const module = (selectedTemplate.modules || selectedTemplate.spaces || [])?.find(m => m.id === selectedModuleId);
                      if (!module) return null;

                      // Get surveyMarkers for this module, grouped by category
                      const surveyMarkersByCategory = {};
                      Object.entries(surveyMarkers).forEach(([annotationId, surveyMarker]) => {
                        const surveyMarkerModuleId = surveyMarker.moduleId;
                        if (surveyMarkerModuleId === selectedModuleId && surveyMarker.categoryId) {
                          if (!surveyMarkersByCategory[surveyMarker.categoryId]) {
                            surveyMarkersByCategory[surveyMarker.categoryId] = [];
                          }
                          // IMPORTANT: Always use the key from surveyMarkers as the authoritative ID
                          // This ensures consistency when selecting/looking up survey markers
                          surveyMarkersByCategory[surveyMarker.categoryId].push({
                            ...surveyMarker,
                            id: annotationId  // Use the key, not surveyMarker.id
                          });
                        }
                      });

                      // Sort surveyMarkers within each category by user order, then Excel row order.
                      Object.keys(surveyMarkersByCategory).forEach(categoryId => {
                        surveyMarkersByCategory[categoryId].sort(compareSurveyMarkersForOrder);
                      });

                      // Show categories list first (before surveyMarkers)
                      const hasSurveyMarkers = Object.keys(surveyMarkersByCategory).length > 0;

                      return (
                        <div>
                          {/* Select toggle button + Create Category */}
                          {!copyModeActive ? (() => {
                            const categoriesForModule = module.categories || [];
                            const selectedCategoryCount = Object.keys(selectedCategories).filter(id => selectedCategories[id]).length;
                            const hasSelectedCategories = selectedCategoryCount > 0;

                            const createCategory = () => {
                              if (!selectedTemplate?.id || !selectedModuleId) {
                                alert('Please select a template and module before creating a category.');
                                return;
                              }
                              onRequestCreateTemplate?.({
                                mode: 'edit',
                                templateId: selectedTemplate.id,
                                moduleId: selectedModuleId,
                                startAddingCategory: true
                              });
                            };

                            const deleteSelectedCategories = () => {
                              const selectedCatIds = Object.keys(selectedCategories).filter(id => selectedCategories[id]);
                              if (selectedCatIds.length === 0) {
                                alert('Please select at least one category to delete.');
                                return;
                              }
                              if (!confirm(`Are you sure you want to delete ${selectedCatIds.length} categor${selectedCatIds.length !== 1 ? 'ies' : 'y'} and all items within?`)) {
                                return;
                              }

                              selectedCatIds.forEach(catId => {
                                const surveyMarkersInCategory = Object.entries(surveyMarkers).filter(([_, h]) => {
                                  const hModuleId = h.moduleId;
                                  return hModuleId === selectedModuleId && h.categoryId === catId;
                                });

                                surveyMarkersInCategory.forEach(([annotationId, surveyMarker]) => {
                                  if (surveyMarker.pageNumber && surveyMarker.bounds) {
                                    setSurveyMarkersToRemoveByPage(prev => ({
                                      ...prev,
                                      [surveyMarker.pageNumber]: [...(prev[surveyMarker.pageNumber] || []), surveyMarker.bounds]
                                    }));
                                  }
                                });

                                setSurveyMarkers(prev => {
                                  const updated = { ...prev };
                                  surveyMarkersInCategory.forEach(([annotationId]) => {
                                    delete updated[annotationId];
                                  });
                                  return updated;
                                });

                                const documentId = pdfFile?.id;
                                const surveyMarkerIdsToDelete = surveyMarkersInCategory.map(([id]) => id);
                                if (documentId && user?.id && documentSyncEnabled && surveyMarkerIdsToDelete.length > 0) {
                                  deleteAnnotations(documentId, surveyMarkerIdsToDelete).catch(err => {
                                    console.error('[App] Error deleting annotations from Supabase:', err);
                                  });
                                }

                                deleteCategory(selectedModuleId, catId);
                              });

                              setCategorySelectModeActive(false);
                              setCategorySelectModeForCategory(null);
                              setSelectedCategories({});
                            };

                            return (
                              <div className="survey-marker-category-action-row">
                                <div className="survey-marker-category-action-strip">
                                  {categorySelectModeActive ? (
                                    <div className="survey-marker-select-toolbar" role="toolbar" aria-label="Category selection actions">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCategorySelectModeActive(false);
                                          setCategorySelectModeForCategory(null);
                                          setSelectedCategories({});
                                        }}
                                        className="survey-marker-select-mode-toggle"
                                      >
                                        Done
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const newSelection = {};
                                          categoriesForModule.forEach(category => {
                                            newSelection[category.id] = true;
                                          });
                                          setSelectedCategories(newSelection);
                                        }}
                                        disabled={categoriesForModule.length === 0}
                                        className="survey-marker-select-action"
                                      >
                                        All
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const selectedCatIds = Object.keys(selectedCategories).filter(id => selectedCategories[id]);
                                          if (selectedCatIds.length === 0) {
                                            alert('Please select at least one category to move or copy.');
                                            return;
                                          }
                                          alert(`Move/Copy functionality for ${selectedCatIds.length} categories to be implemented.`);
                                        }}
                                        disabled={!hasSelectedCategories}
                                        className="survey-marker-select-action"
                                      >
                                        Move/Copy
                                      </button>
                                      <button
                                        type="button"
                                        onClick={deleteSelectedCategories}
                                        disabled={!hasSelectedCategories}
                                        className="survey-marker-select-action survey-marker-select-action-icon survey-marker-select-action-danger"
                                        title="Delete"
                                        aria-label="Delete selected categories"
                                      >
                                        <Icon name="trash" size={12} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCategorySelectModeActive(true);
                                        setSelectedCategories({});
                                      }}
                                      className="survey-marker-category-select-button"
                                    >
                                      Select
                                    </button>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={createCategory}
                                  className="survey-marker-category-create-button"
                                  title="Create Category"
                                  aria-label="Create Category"
                                >
                                  <Icon name="plus" size={14} />
                                </button>
                              </div>
                            );
                          })() : copyModeActive ? (
                            <div style={{
                              marginBottom: '12px',
                              display: 'flex',
                              gap: '8px',
                              alignItems: 'center',
                              paddingBottom: '8px',
                              borderBottom: '1px solid #333'
                            }}>
                              {/* Select All checkbox */}
                              {(() => {
                                // IMPORTANT: Use the key from surveyMarkers as the authoritative ID
                                const allSurveyMarkerIds = Object.entries(surveyMarkers)
                                  .filter(([annotationId, h]) => {
                                    const hModuleId = h.moduleId;
                                    return hModuleId === selectedModuleId;
                                  })
                                  .map(([annotationId, h]) => annotationId);  // Use the key, not h.id
                                const moduleSelectedCount = allSurveyMarkerIds.filter(id => copiedItemSelection[id] === true).length;
                                const moduleAllSelected = moduleSelectedCount === allSurveyMarkerIds.length && allSurveyMarkerIds.length > 0;

                                return (
                                  <label style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    cursor: 'pointer',
                                    userSelect: 'none'
                                  }}>
                                    <input
                                      type="checkbox"
                                      checked={moduleAllSelected}
                                      onChange={(e) => {
                                        const newSelection = { ...copiedItemSelection };
                                        allSurveyMarkerIds.forEach(id => {
                                          if (!moduleAllSelected) {
                                            newSelection[id] = true;
                                          } else {
                                            delete newSelection[id];
                                          }
                                        });
                                        setCopiedItemSelection(newSelection);
                                      }}
                                      style={{ cursor: 'pointer' }}
                                    />
                                    <span style={{ color: '#ddd', fontSize: '13px', fontWeight: '400' }}>
                                      Select All
                                    </span>
                                  </label>
                                );
                              })()}

                              <div style={{ width: '1px', height: '16px', background: '#444' }} />

                              {/* Copy to Spaces button */}
                              <button
                                onClick={() => {
                                  const selectedIds = Object.keys(copiedItemSelection).filter(id => copiedItemSelection[id]);
                                  selectedIds.forEach(id => {
                                  });
                                  if (selectedIds.length === 0) return;
                                  setShowSpaceSelection(true);
                                }}
                                disabled={!Object.values(copiedItemSelection).some(Boolean)}
                                style={{
                                  padding: 0,
                                  background: 'transparent',
                                  border: 'none',
                                  color: Object.values(copiedItemSelection).some(Boolean) ? '#999' : '#555',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: Object.values(copiedItemSelection).some(Boolean) ? 'pointer' : 'not-allowed'
                                }}
                                onMouseEnter={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#ddd';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#999';
                                  }
                                }}
                              >
                                Copy to Spaces
                              </button>

                              {/* Delete button */}
                              <button
                                onClick={() => {
                                  const selectedIds = Object.keys(copiedItemSelection).filter(id => copiedItemSelection[id]);
                                  if (selectedIds.length === 0) return;

                                  // Confirm deletion
                                  if (!confirm(`Are you sure you want to delete ${selectedIds.length} item${selectedIds.length !== 1 ? 's' : ''}?`)) {
                                    return;
                                  }

                                  // Capture surveyMarkers before deletion (state is async)
                                  const surveyMarkersToDelete = selectedIds.map(id => surveyMarkers[id]).filter(Boolean);

                                  // Delete surveyMarkers from surveyMarkers
                                  setSurveyMarkers(prev => {
                                    const updated = { ...prev };
                                    selectedIds.forEach(id => {
                                      delete updated[id];
                                    });

                                    // Check if all items in the current space have been deleted
                                    // If so, exit copy mode automatically
                                    if (selectedSpaceId) {
                                      const remainingSurveyMarkers = Object.entries(updated)
                                        .filter(([_, h]) => h.spaceId === selectedSpaceId);
                                      if (remainingSurveyMarkers.length === 0) {
                                        // Use setTimeout to ensure state updates are processed
                                        setTimeout(() => {
                                          setCopyModeActive(false);
                                          setCopiedItemSelection({});
                                        }, 0);
                                      }
                                    }

                                    return updated;
                                  });

                                  // Trigger removal from canvas via surveyMarkersToRemoveByPage (same as working ✕ button)
                                  surveyMarkersToDelete.forEach(surveyMarker => {
                                    const pageNum = surveyMarker.pageNumber;
                                    const bounds = surveyMarker.bounds;

                                    if (pageNum && bounds) {
                                      setSurveyMarkersToRemoveByPage(prev => ({
                                        ...prev,
                                        [pageNum]: [...(prev[pageNum] || []), bounds]
                                      }));
                                    }
                                  });

                                  // Clear the removal queue after a short delay to allow processing
                                  setTimeout(() => {
                                    surveyMarkersToDelete.forEach(surveyMarker => {
                                      const pageNum = surveyMarker.pageNumber;
                                      if (pageNum) {
                                        setSurveyMarkersToRemoveByPage(prev => {
                                          const updated = { ...prev };
                                          delete updated[pageNum];
                                          return updated;
                                        });
                                      }
                                    });
                                  }, 100);

                                  // Delete surveyMarker rectangles from PDF canvas (annotationsByPage) - keep for backward compatibility
                                  surveyMarkersToDelete.forEach(surveyMarker => {
                                    const pageNum = surveyMarker.pageNumber;
                                    if (pageNum && annotationsByPage[pageNum]) {
                                      setAnnotationsByPage(prev => {
                                        const pageAnnotations = prev[pageNum];
                                        if (!pageAnnotations || !pageAnnotations.objects) return prev;

                                        // Get the current scale for coordinate conversion
                                        const currentScale = scale;

                                        // Filter out surveyMarker rectangles that match this surveyMarker's bounds
                                        const filteredObjects = pageAnnotations.objects.filter(obj => {
                                          // Check if this is a surveyMarker rectangle (with any opacity)
                                          if (obj.type !== 'rect') return true;
                                          if (!obj.fill || typeof obj.fill !== 'string') return true;
                                          if (!obj.fill.includes('rgba')) return true;

                                          // Canvas coordinates are at canvas scale, need to normalize for comparison
                                          const objX = (obj.left || 0) / currentScale;
                                          const objY = (obj.top || 0) / currentScale;
                                          const objWidth = (obj.width || 0) / currentScale;
                                          const objHeight = (obj.height || 0) / currentScale;

                                          const bounds = surveyMarker.bounds || {};
                                          const surveyMarkerX = bounds.x || bounds.left || 0;
                                          const surveyMarkerY = bounds.y || bounds.top || 0;
                                          const surveyMarkerWidth = bounds.width || (bounds.right ? bounds.right - bounds.left : 0) || 0;
                                          const surveyMarkerHeight = bounds.height || (bounds.bottom ? bounds.bottom - bounds.top : 0) || 0;

                                          // Check if bounds match (with tolerance in normalized coordinates)
                                          const tolerance = 5 / currentScale; // Convert tolerance to normalized coordinates
                                          if (Math.abs(objX - surveyMarkerX) < tolerance &&
                                            Math.abs(objY - surveyMarkerY) < tolerance &&
                                            Math.abs(objWidth - surveyMarkerWidth) < tolerance &&
                                            Math.abs(objHeight - surveyMarkerHeight) < tolerance) {
                                            return false; // Remove this object
                                          }
                                          return true; // Keep this object
                                        });

                                        return {
                                          ...prev,
                                          [pageNum]: {
                                            ...pageAnnotations,
                                            objects: filteredObjects
                                          }
                                        };
                                      });
                                    }
                                  });

                                  // Delete associated items and annotations
                                  surveyMarkersToDelete.forEach(surveyMarker => {

                                    // Find associated item by matching name and category
                                    const categoryName = getCategoryName(selectedTemplate, surveyMarker.moduleId, surveyMarker.categoryId);
                                    const matchingItem = itemsByNameType.get(`${surveyMarker.name}\0${categoryName}`);

                                    if (matchingItem) {
                                      // Find and delete annotations for this item in this space
                                      setAnnotations(prev => {
                                        const updated = { ...prev };
                                        Object.values(updated).forEach(ann => {
                                          if (ann.itemId === matchingItem.itemId && ann.spaceId === surveyMarker.moduleId) {
                                            delete updated[ann.annotationId];
                                          }
                                        });
                                        return updated;
                                      });

                                      // Check if item has data in other modules - if not, delete the item
                                      const surveyMarkerModuleId = surveyMarker.moduleId;
                                      const moduleName = getModuleName(selectedTemplate, surveyMarkerModuleId);
                                      const dataKey = getModuleDataKey(moduleName);
                                      const item = items[matchingItem.itemId];

                                      if (item) {
                                        // Remove the module-specific data
                                        const updatedItem = { ...item };
                                        delete updatedItem[dataKey];

                                        // Check if item has any module data left
                                        const allModules = selectedTemplate?.modules || selectedTemplate?.spaces || [];
                                        const hasOtherModuleData = allModules.some(module => {
                                          const moduleId = module.id;
                                          if (moduleId === surveyMarkerModuleId) return false;
                                          const otherModuleName = getModuleName(selectedTemplate, moduleId);
                                          const otherDataKey = getModuleDataKey(otherModuleName);
                                          return updatedItem[otherDataKey] && Object.keys(updatedItem[otherDataKey]).length > 0;
                                        });

                                        if (hasOtherModuleData) {
                                          // Item exists in other modules, just remove this module's data
                                          setItems(prev => ({
                                            ...prev,
                                            [matchingItem.itemId]: updatedItem
                                          }));
                                        } else {
                                          // Item doesn't exist in other spaces, delete it entirely
                                          setItems(prev => {
                                            const updated = { ...prev };
                                            delete updated[matchingItem.itemId];
                                            return updated;
                                          });
                                        }
                                      }
                                    }
                                  });

                                  // Delete from Supabase document_annotations table
                                  const documentId = pdfFile?.id;
                                  if (documentId && user?.id && documentSyncEnabled) {
                                    deleteAnnotations(documentId, selectedIds).catch(err => {
                                      console.error('[App] Error deleting annotations from Supabase:', err);
                                    });
                                  }

                                  // Clear selection (copy mode will be automatically exited if all items in space are deleted)
                                  setCopiedItemSelection({});
                                }}
                                disabled={!Object.values(copiedItemSelection).some(Boolean)}
                                style={{
                                  padding: 0,
                                  background: 'transparent',
                                  border: 'none',
                                  color: Object.values(copiedItemSelection).some(Boolean) ? '#cc4444' : '#555',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: Object.values(copiedItemSelection).some(Boolean) ? 'pointer' : 'not-allowed'
                                }}
                                onMouseEnter={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#ff6666';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#cc4444';
                                  }
                                }}
                              >
                                Delete
                              </button>

                              <div style={{ marginLeft: 'auto' }} />

                              {/* Cancel button */}
                              <button
                                onClick={() => {
                                  setCopyModeActive(false);
                                  setCopiedItemSelection({});
                                }}
                                style={{
                                  padding: 0,
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#999',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: 'pointer'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.color = '#ddd'}
                                onMouseLeave={(e) => e.currentTarget.style.color = '#999'}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : null}

                          {/* Categories List */}
                          <div style={{ marginBottom: '20px' }}>
                            <h3 style={{
                              fontSize: '13px',
                              fontWeight: '600',
                              color: '#e8e8e8',
                              margin: '0 2px 8px',
                              fontFamily: FONT_FAMILY
                            }}>
                              Select Category to Highlight
                            </h3>

                            {module.categories && module.categories.length > 0 ? (
                              <SortableRearrangeList
                                ids={module.categories.map((category) => category.id)}
                                onReorder={(activeId, overId) => handleReorderSurveyCategories(selectedModuleId, activeId, overId)}
                                variableHeight
                                gap={6}
                                dropSettleMs={160}
                                suppressDropTransforms
                              >
                                {module.categories.map(category => {
                                  const categorySurveyMarkers = surveyMarkersByCategory[category.id] || [];
                                  const surveyMarkerCount = categorySurveyMarkers.length;
                                  const isExpanded = expandedCategories[category.id];
                                  const isArrowActive = isExpanded || selectedCategoryId === category.id;

                                  // Calculate category checkbox state for copy mode
                                  const categorySelectedCount = categorySurveyMarkers.filter(h => copiedItemSelection[h.id] === true).length;
                                  const categoryAllSelected = categorySelectedCount === categorySurveyMarkers.length && categorySurveyMarkers.length > 0;

                                  // Category-level selection state
                                  const isCategorySelected = selectedCategories[category.id] === true;
                                  const isCategorySelectModeActive = categorySelectModeActive;
                                  const isCategoryActive = (isCategorySelectModeActive && isCategorySelected) || selectedCategoryId === category.id;
                                  const buttonTextColor = isCategoryActive ? '#4A90E2' : '#ddd';
                                  const buttonSubTextColor = isCategoryActive ? '#4A90E2' : '#999';

                                  // Item-level selection state
                                  const isItemSelectModeActiveForCategory = itemSelectModeActive[category.id] === true;
                                  const selectedItemsForCategory = selectedItemsInCategory[category.id] || {};
                                  const itemSelectedCount = Object.values(selectedItemsForCategory).filter(Boolean).length;

                                  return (
                                    <SortableRearrangeRow
                                      key={category.id}
                                      id={category.id}
                                      wrapperStyle={{ overflow: 'visible' }}
                                    >
                                      {({ attributes, listeners, isDragging }) => {
                                        const isCategorySelectable = copyModeActive || isCategorySelectModeActive;
                                        const isCategorySelectionSelected = isCategorySelectModeActive
                                          ? isCategorySelected
                                          : categoryAllSelected;
                                        const toggleCategorySelection = () => {
                                          if (isCategorySelectModeActive) {
                                            setSelectedCategories(prev => ({
                                              ...prev,
                                              [category.id]: !prev[category.id]
                                            }));
                                            return;
                                          }

                                          if (copyModeActive) {
                                            const newSelection = { ...copiedItemSelection };
                                            categorySurveyMarkers.forEach(h => {
                                              if (!categoryAllSelected) {
                                                newSelection[h.id] = true;
                                              } else {
                                                delete newSelection[h.id];
                                              }
                                            });
                                            setCopiedItemSelection(newSelection);
                                          }
                                        };

                                        return (
                                    <div
                                      className={`survey-marker-category-card${isCategoryActive ? ' is-active' : ''}`}
                                      style={{
                                        opacity: isDragging ? 0.72 : 1,
                                        transition: isDragging ? 'none' : undefined
                                      }}
                                    >
                                      <div
                                        data-drag-rearrange-row
                                        className="survey-marker-category-row"
                                      >
                                        {isCategorySelectable ? (
                                          <SurveyMarkerLeadingSelect
                                            selected={isCategorySelectionSelected}
                                            category
                                            onClick={toggleCategorySelection}
                                            title={isCategorySelectionSelected ? 'Deselect category' : 'Select category'}
                                            ariaLabel={`${isCategorySelectionSelected ? 'Deselect' : 'Select'} ${category.name || 'Untitled Category'}`}
                                          />
                                        ) : (
                                          <DragRearrangeHandle
                                            {...attributes}
                                            {...listeners}
                                            isDragging={isDragging}
                                            title="Drag category to rearrange"
                                            style={{ width: 28, height: 28, marginLeft: 0 }}
                                          />
                                        )}

                                        <div className="survey-marker-category-body">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (isCategorySelectModeActive) {
                                                  toggleCategorySelection();
                                                  return;
                                                }
                                                if (copyModeActive) {
                                                  // In copy mode, don't change category selection or hide panel
                                                  return;
                                                }

                                                // Set selected category
                                                setSelectedCategoryId(category.id);
                                                // Minimize survey panel
                                                setIsSurveyPanelCollapsed(true);
                                                // Switch to surveyMarker tool
                                                setActiveTool('survey-marker');
                                              }}
                                              className="survey-marker-category-main"
                                              style={{
                                                color: buttonTextColor,
                                              }}
                                            >
                                              <span className="survey-marker-category-main-label">
                                                {category.name || 'Untitled Category'}
                                              </span>
                                              <span
                                                className="survey-marker-category-main-count"
                                                style={{ color: buttonSubTextColor }}
                                              >
                                                {surveyMarkerCount}
                                              </span>
                                            </button>
                                            {surveyMarkerCount > 0 && (
                                              <button
                                                className="survey-marker-category-arrow"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setExpandedCategories(prev => ({
                                                    ...prev,
                                                    [category.id]: !prev[category.id]
                                                  }));
                                                }}
                                                style={{
                                                  color: isArrowActive ? '#4A90E2' : '#fff'
                                                }}
                                              >
                                                <span
                                                  style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                                    transition: 'transform 0.2s ease'
                                                  }}
                                                >
                                                  <svg
                                                    width="16"
                                                    height="16"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    style={{ width: '14px', height: '14px' }}
                                                  >
                                                    <path
                                                      d="M6 9L12 15L18 9"
                                                      stroke="currentColor"
                                                      strokeWidth="2.5"
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                    />
                                                  </svg>
                                                </span>
                                              </button>
                                            )}
                                          </div>
                                      </div>

                                      {/* Expanded surveyMarkers list */}
                                      {isExpanded && surveyMarkerCount > 0 && (
                                        <div style={{
                                          marginTop: '5px',
                                          padding: '0 0 1px',
                                          background: 'transparent',
                                          border: '1px solid transparent',
                                          borderRadius: '4px'
                                        }}>
                                          {!copyModeActive && (
                                            <div
                                              className={`survey-marker-inline-select-row${categorySelectModeActive ? ' is-placeholder' : ''}`}
                                              aria-hidden={categorySelectModeActive ? 'true' : undefined}
                                            >
                                              {categorySelectModeActive ? null : !isItemSelectModeActiveForCategory ? (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setItemSelectModeActive(prev => ({
                                                      ...prev,
                                                      [category.id]: true
                                                    }));
                                                    setSelectedItemsInCategory(prev => ({
                                                      ...prev,
                                                      [category.id]: {}
                                                    }));
                                                  }}
                                                  className="survey-marker-select-mode-toggle"
                                                >
                                                  Select
                                                </button>
                                              ) : (
                                                <div className="survey-marker-select-toolbar" role="toolbar" aria-label="Item selection actions">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setItemSelectModeActive(prev => {
                                                    const updated = { ...prev };
                                                    delete updated[category.id];
                                                    return updated;
                                                  });
                                                  setSelectedItemsInCategory(prev => {
                                                    const updated = { ...prev };
                                                    delete updated[category.id];
                                                    return updated;
                                                  });
                                                }}
                                                className="survey-marker-select-mode-toggle"
                                              >
                                                Done
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const newSelection = {};
                                                  categorySurveyMarkers.forEach(h => {
                                                    newSelection[h.id] = true;
                                                  });
                                                  setSelectedItemsInCategory(prev => ({
                                                    ...prev,
                                                    [category.id]: newSelection
                                                  }));
                                                }}
                                                className="survey-marker-select-action"
                                              >
                                                All
                                              </button>

                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const selectedItemIds = Object.keys(selectedItemsForCategory).filter(id => selectedItemsForCategory[id]);
                                                  if (selectedItemIds.length === 0) {
                                                    alert('Please select at least one item to copy.');
                                                    return;
                                                  }
                                                  // Store selected items for copy operation
                                                  setCopiedItemSelection(prev => {
                                                    const newSelection = { ...prev };
                                                    selectedItemIds.forEach(id => {
                                                      newSelection[id] = true;
                                                    });
                                                    return newSelection;
                                                  });
                                                  setShowSpaceSelection(true);
                                                }}
                                                disabled={itemSelectedCount === 0}
                                                className="survey-marker-select-action"
                                              >
                                                Copy
                                              </button>

                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const selectedItemIds = Object.keys(selectedItemsForCategory).filter(id => selectedItemsForCategory[id]);
                                                  if (selectedItemIds.length === 0) {
                                                    alert('Please select at least one item to delete.');
                                                    return;
                                                  }
                                                  if (!confirm(`Are you sure you want to delete ${selectedItemIds.length} item${selectedItemIds.length !== 1 ? 's' : ''}?`)) {
                                                    return;
                                                  }

                                                  // Delete selected items
                                                  selectedItemIds.forEach(annotationId => {
                                                    handleDeleteSurveyMarkerItem(annotationId);
                                                  });

                                                  // Clear selection and exit item select mode if no items left
                                                  const selectedSet = new Set(selectedItemIds);
                                                  const remainingItems = categorySurveyMarkers.filter(h => !selectedSet.has(h.id));
                                                  if (remainingItems.length === 0) {
                                                    setItemSelectModeActive(prev => {
                                                      const updated = { ...prev };
                                                      delete updated[category.id];
                                                      return updated;
                                                    });
                                                    setSelectedItemsInCategory(prev => {
                                                      const updated = { ...prev };
                                                      delete updated[category.id];
                                                      return updated;
                                                    });
                                                  } else {
                                                    setSelectedItemsInCategory(prev => {
                                                      const updated = { ...prev };
                                                      updated[category.id] = {};
                                                      return updated;
                                                    });
                                                  }
                                                }}
                                                disabled={itemSelectedCount === 0}
                                                className="survey-marker-select-action survey-marker-select-action-icon survey-marker-select-action-danger"
                                                title="Delete"
                                                aria-label="Delete selected items"
                                              >
                                                <Icon name="trash" size={12} />
                                              </button>
                                                </div>
                                              )}
                                            </div>
                                          )}

                                          <SortableRearrangeList
                                            ids={categorySurveyMarkers.map((surveyMarker) => surveyMarker.id)}
                                            onReorder={(activeId, overId) => reorderSurveyMarkersInCategory(categorySurveyMarkers, activeId, overId)}
                                            onDragStart={markSurveyMarkerDragStarted}
                                            onDragEnd={() => restoreSurveyMarkerAfterDrag()}
                                            onDragCancel={() => restoreSurveyMarkerAfterDrag()}
                                            variableHeight
                                            gap={5}
                                            dropSettleMs={160}
                                            suppressDropTransforms
                                          >
                                          {categorySurveyMarkers.map((surveyMarker, surveyMarkerIndex) => {
                                            const annotationId = surveyMarker.id;
                                            const isSurveyMarkerExpanded = expandedSurveyMarkers[annotationId];
                                            const baseCategoryName = category?.name?.trim() || 'Untitled Category';
                                            const fallbackName = `${baseCategoryName} ${surveyMarkerIndex + 1}`;
                                            const surveyMarkerName = surveyMarkers[annotationId]?.name || surveyMarker.name || fallbackName;
                                            const entityDropdownId = `${annotationId}:entity`;
                                            const isEntityDropdownOpenForMarker = openEntityDropdownId === entityDropdownId;
                                            const reviewMessage = surveyReviewByMarkerId[annotationId] || '';
                                            const reviewConflict = surveyConflictByMarkerId[annotationId] || null;

                                            return (
                                              <SortableRearrangeRow
                                                key={surveyMarker.id}
                                                id={surveyMarker.id}
                                                wrapperStyle={{
                                                  overflow: 'visible',
                                                  ...(isEntityDropdownOpenForMarker ? { zIndex: 30 } : {})
                                                }}
                                              >
                                                {({ attributes, listeners, isDragging }) => {
                                                  const prepareSurveyMarkerDrag = (anchorElement = null) => {
                                                    if (!isSurveyMarkerExpanded && !isEntityDropdownOpenForMarker) return;
                                                    preserveElementViewportY(anchorElement, () => {
                                                      flushSync(() => {
                                                        collapseSurveyMarkerBeforeDrag(annotationId, {
                                                          restoreAfterDrag: isSurveyMarkerExpanded
                                                        });
                                                      });
                                                    });
                                                  };
                                                  const dragListeners = {
                                                    ...(listeners || {}),
                                                    onPointerDown: (event) => {
                                                      prepareSurveyMarkerDrag(event.currentTarget);
                                                      listeners?.onPointerDown?.(event);
                                                    },
                                                    onKeyDown: (event) => {
                                                      if (event.key === ' ' || event.key === 'Enter') {
                                                        prepareSurveyMarkerDrag();
                                                      }
                                                      listeners?.onKeyDown?.(event);
                                                    }
                                                  };
                                                  const isMarkerSelectable = copyModeActive || isItemSelectModeActiveForCategory;
                                                  const isMarkerSelected = isItemSelectModeActiveForCategory
                                                    ? selectedItemsForCategory[annotationId] === true
                                                    : copiedItemSelection[annotationId] === true;
                                                  const toggleMarkerSelection = () => {
                                                    const nextSelected = !isMarkerSelected;
                                                    if (isItemSelectModeActiveForCategory) {
                                                      setSelectedItemsInCategory(prev => ({
                                                        ...prev,
                                                        [category.id]: {
                                                          ...(prev[category.id] || {}),
                                                          [annotationId]: nextSelected
                                                        }
                                                      }));
                                                      return;
                                                    }

                                                    setCopiedItemSelection(prev => {
                                                      const newSelection = { ...prev };
                                                      if (nextSelected) {
                                                        newSelection[annotationId] = true;
                                                      } else {
                                                        delete newSelection[annotationId];
                                                      }
                                                      return newSelection;
                                                    });
                                                  };
                                                  return (
                                              <div
                                                id={`highlight-item-${surveyMarker.id}`}
                                                data-drag-rearrange-row
                                                style={{
                                                background: isDragging ? 'rgba(74, 144, 226, 0.12)' : 'transparent',
                                                border: '1px solid #444',
                                                borderRadius: '4px',
                                                overflow: (isEntityDropdownOpenForMarker || reviewMessage) ? 'visible' : 'hidden',
                                                flexShrink: 0,
                                                opacity: isDragging ? 0.72 : 1,
                                                boxShadow: isDragging ? '0 10px 22px rgba(0, 0, 0, 0.34), inset 0 0 0 1px rgba(74, 144, 226, 0.3)' : 'none',
                                                transition: isDragging ? 'none' : 'background 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease'
                                              }}>
                                                {/* SurveyMarker header - clickable to expand */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                  {isMarkerSelectable ? (
                                                    <SurveyMarkerLeadingSelect
                                                      selected={isMarkerSelected}
                                                      onClick={toggleMarkerSelection}
                                                      title={isMarkerSelected ? 'Deselect item' : 'Select item'}
                                                      ariaLabel={`${isMarkerSelected ? 'Deselect' : 'Select'} ${surveyMarkerName}`}
                                                    />
                                                  ) : (
                                                    <DragRearrangeHandle
                                                      {...attributes}
                                                      {...dragListeners}
                                                      isDragging={isDragging}
                                                      title="Drag to rearrange"
                                                      style={{ width: 22, height: 24, marginLeft: 0 }}
                                                    />
                                                  )}

                                                  <div style={{
                                                    flex: 1,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '7px',
                                                    padding: '4px 5px 4px 6px',
                                                    minWidth: 0
                                                  }}>

                                                      {(() => {
                                                        // Get entity entity for indicator - data-driven from category item's entity field
                                                        let indicatorColor = null;
                                                        let indicatorTooltip = null;
                                                        if (selectedTemplate && selectedModuleId) {
                                                          const surveyMarkerData = surveyMarkers[annotationId];
                                                          const categoryName = getCategoryName(selectedTemplate, selectedModuleId, category.id);
                                                          const surveyMarkerName = surveyMarkerData?.name || surveyMarker.name || '';
                                                          const matchingItem = itemsByNameType.get(`${surveyMarkerName}\0${categoryName}`);

                                                          // Try to get entityId from item's module data first, then from surveyMarkerData
                                                          let entityId = null;
                                                          if (matchingItem) {
                                                            const moduleName = getModuleName(selectedTemplate, selectedModuleId);
                                                            const dataKey = getModuleDataKey(moduleName);
                                                            const moduleData = matchingItem[dataKey] || {};
                                                            entityId = moduleData.entityId;
                                                          }
                                                          // Fallback to surveyMarkerData if not found in item
                                                          if (!entityId && surveyMarkerData?.entityId) {
                                                            entityId = surveyMarkerData.entityId;
                                                          }

                                                          if (entityId) {
                                                            const entity = entitiesMap.get(entityId);
                                                            if (entity) {
                                                              // Use the exact color from entity.color without transformation
                                                              indicatorColor = entity.color;
                                                              indicatorTooltip = entity.name;
                                                            }
                                                          }
                                                        }

                                                        return (
                                                          <EntityIndicator
                                                            color={indicatorColor}
                                                            size={16}
                                                            tooltipText={indicatorTooltip}
                                                          />
                                                        );
                                                      })()}
                                                      <button
                                                        type="button"
                                                        className="survey-marker-expand-toggle"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          toggleSurveyMarkerExpanded(annotationId);
                                                        }}
                                                        title={isSurveyMarkerExpanded ? 'Collapse' : 'Expand'}
                                                        aria-label={isSurveyMarkerExpanded ? 'Collapse marker details' : 'Expand marker details'}
                                                        style={{
                                                          width: '18px',
                                                          height: '20px',
                                                          padding: 0,
                                                          background: 'transparent',
                                                          border: 0,
                                                          color: isSurveyMarkerExpanded ? '#4A90E2' : '#bbb',
                                                          cursor: 'pointer',
                                                          display: 'flex',
                                                          alignItems: 'center',
                                                          justifyContent: 'center',
                                                          flexShrink: 0,
                                                          transform: isSurveyMarkerExpanded ? 'rotate(90deg)' : 'none',
                                                          transition: 'color 0.15s ease, transform 0.15s ease'
                                                        }}
                                                      >
                                                        <Icon name="chevronRight" size={12} />
                                                      </button>
                                                      <span className="survey-marker-name-fit" data-value={surveyMarkerName || ' '}>
                                                        <input
                                                          type="text"
                                                          size={1}
                                                          className="survey-marker-name-inline"
                                                          defaultValue={surveyMarkerName}
                                                          key={`${annotationId}:${surveyMarkerName}`}
                                                          title="Click to rename"
                                                          aria-label={`Rename ${surveyMarkerName}`}
                                                          onClick={(e) => e.stopPropagation()}
                                                          onDoubleClick={(e) => e.currentTarget.select()}
                                                          onInput={(e) => {
                                                            if (e.currentTarget.parentElement) {
                                                              e.currentTarget.parentElement.dataset.value = e.currentTarget.value || ' ';
                                                            }
                                                          }}
                                                          onBlur={(e) => {
                                                            const nextName = (e.currentTarget.value || '').trim() || fallbackName;
                                                            e.currentTarget.value = nextName;
                                                            if (e.currentTarget.parentElement) {
                                                              e.currentTarget.parentElement.dataset.value = nextName || ' ';
                                                            }
                                                            commitSurveyMarkerName(annotationId, category.id, surveyMarkerName, nextName, fallbackName);
                                                          }}
                                                          onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                              e.currentTarget.blur();
                                                            } else if (e.key === 'Escape') {
                                                              e.currentTarget.value = surveyMarkerName;
                                                              if (e.currentTarget.parentElement) {
                                                                e.currentTarget.parentElement.dataset.value = surveyMarkerName || ' ';
                                                              }
                                                              e.currentTarget.blur();
                                                            }
                                                          }}
                                                        />
                                                      </span>
                                                      <div
                                                        className="survey-marker-expand-spacer"
                                                        title={isSurveyMarkerExpanded ? 'Collapse' : 'Expand'}
                                                        aria-hidden="true"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          toggleSurveyMarkerExpanded(annotationId);
                                                        }}
                                                      />
                                                  </div>

                                                  {/* Item-level Notes button */}
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      const surveyMarkerData = surveyMarkers[annotationId];
                                                      const existingNote = surveyMarkerData?.note;

                                                      if (existingNote) {
                                                        setNoteDialogContent({
                                                          text: existingNote.text || '',
                                                          photos: existingNote.photos || [],
                                                          videos: existingNote.videos || []
                                                        });
                                                      } else {
                                                        setNoteDialogContent({ text: '', photos: [], videos: [] });
                                                      }

                                                      // For item-level notes, we only need the annotationId
                                                      setNoteDialogOpen(annotationId);
                                                    }}
                                                    style={{
                                                      ...surveyMarkerRowActionStyle,
                                                      background: 'transparent',
                                                      border: 'none',
                                                      color: surveyMarkers[annotationId]?.note?.text ? '#4A90E2' : '#999',
                                                      opacity: 0.78
                                                    }}
                                                    onMouseEnter={(e) => {
                                                      e.currentTarget.style.opacity = '1';
                                                      e.currentTarget.style.background = '#444';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                      e.currentTarget.style.opacity = '0.78';
                                                      e.currentTarget.style.background = 'transparent';
                                                    }}
                                                    title={surveyMarkers[annotationId]?.note?.text ? "Edit item notes" : "Add item notes"}
                                                    aria-label={surveyMarkers[annotationId]?.note?.text ? "Edit item notes" : "Add item notes"}
                                                  >
                                                    <Icon name="pen" size={13} />
                                                  </button>

                                                  <SurveyMarkerReviewIndicator
                                                    markerId={annotationId}
                                                    message={reviewMessage}
                                                    conflict={reviewConflict}
                                                    onKeepApp={(e) => {
                                                      e.stopPropagation();
                                                      onResolveExcelConflict && onResolveExcelConflict(annotationId, 'app');
                                                    }}
                                                    onUseExcel={(e) => {
                                                      e.stopPropagation();
                                                      onResolveExcelConflict && onResolveExcelConflict(annotationId, 'excel');
                                                    }}
                                                  />

                                                  {/* Locate Button (Magnifying Glass) */}
                                                  <div
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      // Check if item has location (bounds and pageNumber)
                                                      const hasLocation = surveyMarker.bounds && surveyMarker.pageNumber;

                                                      if (hasLocation) {
                                                        handleLocateItemOnPDF(surveyMarker);
                                                      } else {
                                                        // Prompt to surveyMarker
                                                        setPendingLocationItem(surveyMarker);
                                                      }
                                                    }}
                                                    style={{
                                                      ...surveyMarkerRowActionStyle,
                                                      color: (surveyMarker.bounds && surveyMarker.pageNumber) ? '#4A90E2' : '#F5A623', // Blue if located, Orange if not
                                                    }}
                                                    onMouseEnter={(e) => {
                                                      e.currentTarget.style.background = '#444';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                      e.currentTarget.style.background = 'transparent';
                                                    }}
                                                    title={surveyMarker.bounds && surveyMarker.pageNumber ? "Jump to this marker" : "Set location on PDF"}
                                                  >
                                                    <Icon name="search" size={14} />
                                                  </div>

                                                </div>

                                                {/* Entity selector */}
                                                {
                                                  isSurveyMarkerExpanded && selectedTemplate && selectedModuleId && (() => {
                                                    // Find the item associated with this surveyMarker
                                                    const surveyMarkerData = surveyMarkers[annotationId];
                                                    const categoryName = getCategoryName(selectedTemplate, selectedModuleId, category.id);
                                                    const surveyMarkerName = surveyMarkerData?.name || surveyMarker.name || '';
                                                    const matchingItem = itemsByNameType.get(`${surveyMarkerName}\0${categoryName}`);

                                                    // Get module-specific data
                                                    const moduleName = getModuleName(selectedTemplate, selectedModuleId);
                                                    const dataKey = getModuleDataKey(moduleName);
                                                    const moduleData = matchingItem?.[dataKey] || {};

                                                    // Get current entity status from item's module-specific data (preferred) or from survey marker annotation (legacy)
                                                    const currentEntityId = moduleData.entityId || surveyMarkerData?.entityId;
                                                    const entities = selectedTemplate?.entities || [];
                                                    const currentEntity = currentEntityId ? entities.find(entity => entity.id === currentEntityId) : null;
                                                    const selectedEntityColor = currentEntity?.color || moduleData.entityColor || surveyMarkerData?.entityColor;
                                                    const selectedEntityName = currentEntity?.name || moduleData.entityName || surveyMarkerData?.entityName || 'None';
                                                    const isEntityDropdownOpen = openEntityDropdownId === entityDropdownId;
                                                    const entityOptions = [
                                                      { id: '', name: 'None', color: null },
                                                      ...entities.map(entity => ({
                                                        id: entity.id,
                                                        name: entity.name,
                                                        color: entity.color
                                                      }))
                                                    ];
                                                    const handleEntitySelection = (entityId) => {
                                                      const entity = entityId ? entities.find(e => e.id === entityId) : null;

                                                      // Update survey marker annotation - the useEffect will automatically rebuild newSurveyMarkersByPage
                                                      setSurveyMarkers(prev => {
                                                        const updated = {
                                                          ...prev,
                                                          [annotationId]: {
                                                            ...prev[annotationId],
                                                            entityId: entity?.id,
                                                            entityName: entity?.name,
                                                            entityColor: entity?.color
                                                          }
                                                        };
                                                        return updated;
                                                      });

                                                      // Update item's module-specific data if matchingItem exists
                                                      if (matchingItem) {
                                                        if (entity) {
                                                          // Update item with entity status
                                                          const updatedItem = {
                                                            ...matchingItem,
                                                            [dataKey]: {
                                                              ...moduleData,
                                                              entityId: entity.id,
                                                              entityName: entity.name,
                                                              entityColor: entity.color
                                                            }
                                                          };

                                                          setItems(prev => ({
                                                            ...prev,
                                                            [matchingItem.itemId]: updatedItem
                                                          }));

                                                          // Update all annotations for this item in this space with the new color
                                                          setAnnotations(prev => {
                                                            const updated = { ...prev };
                                                            Object.values(updated).forEach(ann => {
                                                              if (ann.itemId === matchingItem.itemId && ann.spaceId === selectedSpaceId) {
                                                                updated[ann.annotationId] = {
                                                                  ...ann,
                                                                  entityId: entity.id,
                                                                  entityName: entity.name,
                                                                  entityColor: entity.color
                                                                };
                                                              }
                                                            });
                                                            return updated;
                                                          });
                                                        } else {
                                                          // Remove entity status from item
                                                          const updatedItem = {
                                                            ...matchingItem,
                                                            [dataKey]: {
                                                              ...moduleData,
                                                              entityId: undefined,
                                                              entityName: undefined,
                                                              entityColor: undefined
                                                            }
                                                          };

                                                          setItems(prev => ({
                                                            ...prev,
                                                            [matchingItem.itemId]: updatedItem
                                                          }));

                                                          // Update all annotations for this item in this space
                                                          setAnnotations(prev => {
                                                            const updated = { ...prev };
                                                            Object.values(updated).forEach(ann => {
                                                              if (ann.itemId === matchingItem.itemId && ann.spaceId === selectedSpaceId) {
                                                                updated[ann.annotationId] = {
                                                                  ...ann,
                                                                  entityId: undefined,
                                                                  entityName: undefined,
                                                                  entityColor: undefined
                                                                };
                                                              }
                                                            });
                                                            return updated;
                                                          });
                                                        }
                                                      }
                                                    };

                                                    return (
                                                      <div style={{
                                                        padding: '6px 8px',
                                                        background: '#333',
                                                        borderTop: '1px solid #444',
                                                        marginTop: '0'
                                                      }}>
                                                        <div className="survey-marker-entity-row">
                                                          <span className="survey-marker-entity-label">
                                                            Entity
                                                          </span>
                                                          <div className="survey-marker-entity-select-wrap">
                                                            <button
                                                              type="button"
                                                              className="survey-marker-entity-trigger"
                                                              aria-haspopup="listbox"
                                                              aria-expanded={isEntityDropdownOpen}
                                                              onClick={(e) => {
                                                                e.stopPropagation();
                                                                setOpenEntityDropdownId(isEntityDropdownOpen ? null : entityDropdownId);
                                                              }}
                                                            >
                                                              <span className="survey-marker-entity-trigger-content">
                                                                <span
                                                                  className="survey-marker-entity-swatch"
                                                                  style={getEntitySwatchStyle(selectedEntityColor)}
                                                                />
                                                                <span className="survey-marker-entity-trigger-label">
                                                                  {selectedEntityName}
                                                                </span>
                                                              </span>
                                                              <span className={`survey-marker-entity-caret${isEntityDropdownOpen ? ' is-open' : ''}`}>
                                                                <Icon name="chevronDown" size={12} />
                                                              </span>
                                                            </button>
                                                            {isEntityDropdownOpen && (
                                                              <div
                                                                className="survey-marker-entity-options"
                                                                role="listbox"
                                                                aria-label="Entity"
                                                                onClick={(e) => e.stopPropagation()}
                                                              >
                                                                {entityOptions.map(option => {
                                                                  const optionValue = option.id || '';
                                                                  const isSelectedOption = (currentEntityId || '') === optionValue;
                                                                  return (
                                                                    <button
                                                                      key={optionValue || 'none'}
                                                                      type="button"
                                                                      className={`survey-marker-entity-option${isSelectedOption ? ' is-selected' : ''}`}
                                                                      role="option"
                                                                      aria-selected={isSelectedOption}
                                                                      onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleEntitySelection(optionValue);
                                                                        setOpenEntityDropdownId(null);
                                                                      }}
                                                                    >
                                                                      <span
                                                                        className="survey-marker-entity-option-swatch"
                                                                        style={getEntitySwatchStyle(option.color)}
                                                                      />
                                                                      <span className="survey-marker-entity-option-label">
                                                                        {option.name}
                                                                      </span>
                                                                    </button>
                                                                  );
                                                                })}
                                                              </div>
                                                            )}
                                                          </div>
                                                        </div>
                                                      </div>
                                                    );
                                                  })()
                                                }

                                                {/* Expanded checklist items — active items only.
                                                    KAL-44: archived items are rendered separately
                                                    below so new markers don't see them as active
                                                    prompts, but old responses still surface. */}
                                                {
                                                  isSurveyMarkerExpanded && category.checklist && category.checklist.filter(item => item && item.archived !== true).map(item => {
                                                    const response = surveyMarkers[annotationId]?.checklistResponses?.[item.id] || {};
                                                    const isSelected = response.selection;
                                                    return (
                                                      <div key={item.id} style={{
                                                        padding: '6px 8px',
                                                        background: '#333',
                                                        borderTop: '1px solid #444',
                                                        marginTop: '0'
                                                      }}>
                                                        <div style={{
                                                          display: 'flex',
                                                          alignItems: 'center',
                                                          gap: '8px',
                                                          marginBottom: '4px',
                                                          flexWrap: 'wrap'
                                                        }}>
                                                          <span style={{
                                                            color: '#DDD',
                                                            fontSize: '12px',
                                                            flex: '1',
                                                            minWidth: '150px'
                                                          }}>
                                                            {item.text}
                                                          </span>
                                                          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                                            {['Y', 'N', 'N/A'].map(option => (
                                                              <button
                                                                key={option}
                                                                type="button"
                                                                onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  setSurveyMarkers(prev => {
                                                                    const updated = {
                                                                      ...prev,
                                                                      [annotationId]: {
                                                                        ...prev[annotationId],
                                                                        checklistResponses: {
                                                                          ...prev[annotationId]?.checklistResponses,
                                                                          [item.id]: {
                                                                            ...prev[annotationId]?.checklistResponses?.[item.id],
                                                                            selection: option
                                                                          }
                                                                        }
                                                                      }
                                                                    };

                                                                    // Check if all checklist items are Y or N/A.
                                                                    // KAL-44: archived items don't gate auto-complete; only
                                                                    // active items count toward "all complete".
                                                                    const updatedSurveyMarker = updated[annotationId];
                                                                    const activeChecklist = (category.checklist || []).filter(it => it && it.archived !== true);
                                                                    if (updatedSurveyMarker && activeChecklist.length > 0 && selectedTemplate && selectedSpaceId) {
                                                                      const allItemsComplete = activeChecklist.every(checklistItem => {
                                                                        const response = updatedSurveyMarker.checklistResponses?.[checklistItem.id];
                                                                        const selection = response?.selection;
                                                                        return selection === 'Y' || selection === 'N/A';
                                                                      });

                                                                      // Find the item associated with this surveyMarker
                                                                      const surveyMarkerData = updated[annotationId];
                                                                      const categoryName = getCategoryName(selectedTemplate, selectedModuleId, category.id);
                                                                      const surveyMarkerName = surveyMarkerData?.name || surveyMarker.name || '';
                                                                      const matchingItem = itemsByNameType.get(`${surveyMarkerName}\0${categoryName}`);

                                                                      // Get module-specific data
                                                                      const moduleName = getModuleName(selectedTemplate, selectedModuleId);
                                                                      const dataKey = getModuleDataKey(moduleName);
                                                                      const moduleData = matchingItem?.[dataKey] || {};

                                                                      // If all items are Y or N/A, automatically set entity to "Complete"
                                                                      if (allItemsComplete) {
                                                                        // Find the "Complete" entity
                                                                        const entities = selectedTemplate.entities || [];
                                                                        const completeEntity = entities.find(e =>
                                                                          e.name.toLowerCase().includes('complete')
                                                                        );

                                                                        if (completeEntity) {
                                                                          const entityColor = normalizeSurveyMarkerColor(completeEntity.color) || completeEntity.color || hexToRgba('#E3D1FB', DEFAULT_SURVEY_MARKER_OPACITY);
                                                                          // Update item's module-specific data with Complete entity status
                                                                          if (matchingItem) {
                                                                            const updatedItem = {
                                                                              ...matchingItem,
                                                                              [dataKey]: {
                                                                                ...moduleData,
                                                                                entityId: completeEntity.id,
                                                                                entityName: completeEntity.name,
                                                                                entityColor: entityColor
                                                                              }
                                                                            };

                                                                            setItems(prev => ({
                                                                              ...prev,
                                                                              [matchingItem.itemId]: updatedItem
                                                                            }));

                                                                            // Update all annotations for this item in this module with the new color
                                                                            setAnnotations(prev => {
                                                                              const updatedAnns = { ...prev };
                                                                              Object.values(updatedAnns).forEach(ann => {
                                                                                const annModuleId = ann.moduleId || ann.spaceId; // Support legacy spaceId
                                                                                if (ann.itemId === matchingItem.itemId && annModuleId === selectedModuleId) {
                                                                                  updatedAnns[ann.annotationId] = {
                                                                                    ...ann,
                                                                                    entityId: completeEntity.id,
                                                                                    entityName: completeEntity.name,
                                                                                    entityColor: entityColor
                                                                                  };
                                                                                }
                                                                              });
                                                                              return updatedAnns;
                                                                            });

                                                                            // Update surveyMarker color on PDF
                                                                            if (surveyMarkerData?.pageNumber && surveyMarkerData?.bounds) {
                                                                              setNewSurveyMarkersByPage(prev => {
                                                                                const pageSurveyMarkers = prev[surveyMarkerData.pageNumber] || [];
                                                                                // Remove any existing surveyMarker with this annotationId or same bounds (regardless of needsEntity or color)
                                                                                const filtered = pageSurveyMarkers.filter(h => {
                                                                                  // Keep surveyMarkers that don't match by ID or bounds
                                                                                  const hasMatchingId = h.annotationId === annotationId;
                                                                                  const hasMatchingBounds = h.x === surveyMarkerData.bounds.x &&
                                                                                    h.y === surveyMarkerData.bounds.y &&
                                                                                    h.width === surveyMarkerData.bounds.width &&
                                                                                    h.height === surveyMarkerData.bounds.height;
                                                                                  // Remove if it matches by ID or bounds
                                                                                  return !hasMatchingId && !hasMatchingBounds;
                                                                                });
                                                                                return {
                                                                                  ...prev,
                                                                                  [surveyMarkerData.pageNumber]: [
                                                                                    ...filtered,
                                                                                    {
                                                                                      ...surveyMarkerData.bounds,
                                                                                      color: entityColor,
                                                                                      annotationId: annotationId
                                                                                    }
                                                                                  ]
                                                                                };
                                                                              });
                                                                            }
                                                                          }

                                                                          // Update survey marker annotation with Complete entity status
                                                                          updated[annotationId] = {
                                                                            ...updated[annotationId],
                                                                            entityId: completeEntity.id,
                                                                            entityName: completeEntity.name,
                                                                            entityColor: entityColor
                                                                          };
                                                                        }
                                                                      } else {
                                                                        // Not all items are Y or N/A - remove entity status (set to None)
                                                                        if (matchingItem) {
                                                                          const updatedItem = {
                                                                            ...matchingItem,
                                                                            [dataKey]: {
                                                                              ...moduleData,
                                                                              entityId: undefined,
                                                                              entityName: undefined,
                                                                              entityColor: undefined
                                                                            }
                                                                          };

                                                                          setItems(prev => ({
                                                                            ...prev,
                                                                            [matchingItem.itemId]: updatedItem
                                                                          }));

                                                                          // Update all annotations for this item in this space
                                                                          setAnnotations(prev => {
                                                                            const updatedAnns = { ...prev };
                                                                            Object.values(updatedAnns).forEach(ann => {
                                                                              if (ann.itemId === matchingItem.itemId && ann.spaceId === selectedSpaceId) {
                                                                                updatedAnns[ann.annotationId] = {
                                                                                  ...ann,
                                                                                  entityId: undefined,
                                                                                  entityName: undefined,
                                                                                  entityColor: undefined
                                                                                };
                                                                              }
                                                                            });
                                                                            return updatedAnns;
                                                                          });

                                                                          // Update surveyMarker on PDF - revert to "needs entity" state (transparent with dashed outline)
                                                                          if (surveyMarkerData?.pageNumber && surveyMarkerData?.bounds) {
                                                                            setNewSurveyMarkersByPage(prev => {
                                                                              const pageSurveyMarkers = prev[surveyMarkerData.pageNumber] || [];
                                                                              // Remove any existing surveyMarker with this annotationId or same bounds (regardless of needsEntity or color)
                                                                              const filtered = pageSurveyMarkers.filter(h => {
                                                                                // Keep surveyMarkers that don't match by ID or bounds
                                                                                const hasMatchingId = h.annotationId === annotationId;
                                                                                const hasMatchingBounds = h.x === surveyMarkerData.bounds.x &&
                                                                                  h.y === surveyMarkerData.bounds.y &&
                                                                                  h.width === surveyMarkerData.bounds.width &&
                                                                                  h.height === surveyMarkerData.bounds.height;
                                                                                // Remove if it matches by ID or bounds
                                                                                return !hasMatchingId && !hasMatchingBounds;
                                                                              });
                                                                              // Add "needs entity" surveyMarker (transparent with dashed outline)
                                                                              return {
                                                                                ...prev,
                                                                                [surveyMarkerData.pageNumber]: [
                                                                                  ...filtered,
                                                                                  {
                                                                                    ...surveyMarkerData.bounds,
                                                                                    needsEntity: true,
                                                                                    annotationId: annotationId
                                                                                  }
                                                                                ]
                                                                              };
                                                                            });
                                                                          }
                                                                        }

                                                                        // Update survey marker annotation to remove entity status
                                                                        updated[annotationId] = {
                                                                          ...updated[annotationId],
                                                                          entityId: undefined,
                                                                          entityName: undefined,
                                                                          entityColor: undefined
                                                                        };
                                                                      }
                                                                    }

                                                                    return updated;
                                                                  });
                                                                }}
                                                                style={{
                                                                  minWidth: '28px',
                                                                  padding: '4px 6px',
                                                                  fontSize: '11px',
                                                                  fontWeight: '400',
                                                                  border: 'none',
                                                                  borderRadius: '3px',
                                                                  cursor: 'pointer',
                                                                  background: isSelected === option
                                                                    ? option === 'Y'
                                                                      ? '#B8E6D4'
                                                                      : option === 'N'
                                                                        ? '#FFB3BA'
                                                                        : '#777'
                                                                    : '#D3D3D3',
                                                                  color: isSelected === option ? '#FFFFFF' : '#333333',
                                                                  transition: 'all 0.2s ease'
                                                                }}
                                                              >
                                                                {option}
                                                              </button>
                                                            ))}
                                                          </div>
                                                        </div>
                                                      </div>
                                                    );
                                                  })
                                                }

                                                {/* KAL-44 — Archived items section.
                                                    Items that were archived from the template
                                                    after this marker recorded a response. The
                                                    response payload stays intact under its
                                                    original item id; we render the last-known
                                                    label in a quiet section so the data is
                                                    still inspectable but isn't an active prompt
                                                    for new markers (new markers won't have a
                                                    response under that id, so this section is
                                                    empty for them). */}
                                                {
                                                  isSurveyMarkerExpanded && (() => {
                                                    const responses = surveyMarkers[annotationId]?.checklistResponses || {};
                                                    const archivedItems = (category.checklist || []).filter(it => it && it.archived === true);
                                                    const archivedWithResponses = archivedItems.filter(it => Object.prototype.hasOwnProperty.call(responses, it.id));
                                                    if (archivedWithResponses.length === 0) return null;
                                                    return (
                                                      <div
                                                        data-testid={`archived-checklist-${annotationId}`}
                                                        style={{
                                                          padding: '6px 8px',
                                                          background: '#2a2a2a',
                                                          borderTop: '2px solid #555',
                                                          marginTop: '0',
                                                        }}
                                                      >
                                                        <div style={{
                                                          fontSize: '10px',
                                                          color: '#888',
                                                          textTransform: 'uppercase',
                                                          letterSpacing: '0.6px',
                                                          marginBottom: '4px',
                                                          fontWeight: 600,
                                                        }}>
                                                          Archived ({archivedWithResponses.length})
                                                        </div>
                                                        {archivedWithResponses.map(item => {
                                                          const response = responses[item.id] || {};
                                                          const sel = response.selection;
                                                          const label = item.lastKnownLabel || item.text || 'Archived item';
                                                          return (
                                                            <div
                                                              key={item.id}
                                                              data-archived-response-id={item.id}
                                                              style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '8px',
                                                                padding: '3px 0',
                                                                opacity: 0.78,
                                                              }}
                                                            >
                                                              <span
                                                                title={`Archived${item.archivedAt ? ` ${new Date(item.archivedAt).toLocaleString()}` : ''} — read-only historical response`}
                                                                style={{
                                                                  color: '#bbb',
                                                                  fontSize: '12px',
                                                                  flex: 1,
                                                                  fontStyle: 'italic',
                                                                  textDecoration: 'line-through',
                                                                  textDecorationColor: '#666',
                                                                }}
                                                              >
                                                                {label}
                                                              </span>
                                                              <span
                                                                style={{
                                                                  minWidth: '28px',
                                                                  padding: '2px 6px',
                                                                  fontSize: '10px',
                                                                  fontWeight: 600,
                                                                  borderRadius: '3px',
                                                                  background: sel === 'Y'
                                                                    ? '#7aa78f'
                                                                    : sel === 'N'
                                                                      ? '#a77a7a'
                                                                      : sel
                                                                        ? '#666'
                                                                        : '#444',
                                                                  color: sel ? '#FFFFFF' : '#999',
                                                                  textAlign: 'center',
                                                                }}
                                                              >
                                                                {sel || '—'}
                                                              </span>
                                                            </div>
                                                          );
                                                        })}
                                                      </div>
                                                    );
                                                  })()
                                                }
                                              </div>
                                                  );
                                                }}
                                              </SortableRearrangeRow>
                                            );
                                          })}
                                          </SortableRearrangeList>
                                        </div>
                                      )
                                      }
                                    </div>
                                        );
                                      }}
                                    </SortableRearrangeRow>
                                  );
                                })}
                              </SortableRearrangeList>
                            ) : (
                              <div style={{ color: '#999', fontSize: '14px', padding: '20px', textAlign: 'center' }}>
                                <div>No categories available for this space.</div>
                                {selectedTemplate && selectedModuleId && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!selectedTemplate?.id || !selectedModuleId) {
                                        alert('Please select a template and module before creating a category.');
                                        return;
                                      }
                                      onRequestCreateTemplate?.({
                                        mode: 'edit',
                                        templateId: selectedTemplate.id,
                                        moduleId: selectedModuleId,
                                        startAddingCategory: true
                                      });
                                    }}
                                    style={{
                                      marginTop: '12px',
                                      padding: '10px 18px',
                                      borderRadius: '20px',
                                      border: '1px solid #4A90E2',
                                      background: '#2a2a2a',
                                      color: '#FFFFFF',
                                      fontSize: '13px',
                                      fontWeight: 500,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '6px',
                                      transition: 'background 0.2s ease, border-color 0.2s ease'
                                    }}
                                    onMouseEnter={(event) => {
                                      event.currentTarget.style.background = '#3a3a3a';
                                      event.currentTarget.style.borderColor = '#5AA0F2';
                                    }}
                                    onMouseLeave={(event) => {
                                      event.currentTarget.style.background = '#2a2a2a';
                                      event.currentTarget.style.borderColor = '#4A90E2';
                                    }}
                                  >
                                    Create Category
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })() : (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                        <p>Select a space to view categories</p>
                      </div>
                    )}
                  </div>
                  </>
                  ) : (
                    <div style={{
                      flex: 1,
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      background: '#252525',
                      fontFamily: FONT_FAMILY
                    }}>
                      <div style={{
                        padding: '12px 12px 10px',
                        borderBottom: '1px solid #3a3a3a',
                        background: '#252525',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        flexShrink: 0
                      }}>
                        <h2 style={{
                          flex: 1,
                          minWidth: 0,
                          margin: 0,
                          fontSize: '18px',
                          fontWeight: '600',
                          color: '#fff',
                          fontFamily: FONT_FAMILY,
                          letterSpacing: '-0.2px'
                        }}>
                          Survey
                        </h2>
                      </div>
                      <div style={{
                        flex: 1,
                        minHeight: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '12px',
                        padding: '24px',
                        color: '#999',
                        textAlign: 'center'
                      }}>
                        <Icon name="survey" size={28} color="#999" />
                        <div style={{ color: '#ddd', fontSize: '14px', fontWeight: 600 }}>
                          No template selected
                        </div>
                        <button
                          type="button"
                          onClick={handleSurveyToggle}
                          className="btn btn-sm btn-primary"
                          style={{
                            whiteSpace: 'nowrap',
                            background: '#4A90E2',
                            border: '1px solid #3277c7',
                            color: '#fff'
                          }}
                        >
                          Select Template
                        </button>
                      </div>
                    </div>
                  )}


                </>
              )}

              {/* Microsoft Reconnect Banner */}
              {!isSurveyPanelCollapsed && msNeedsReconnect && selectedTemplate?.isOneDrive && (
                <div style={{
                  padding: '10px 12px',
                  borderTop: '1px solid #3a3a3a',
                  background: COLORS.modal.panel,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: COLORS.modal.textPrimary, fontSize: '12px', fontWeight: 600, marginBottom: '2px', fontFamily: FONT_FAMILY }}>
                      Microsoft session expired
                    </div>
                    <div style={{ color: COLORS.modal.textMuted, fontSize: '11px', fontFamily: FONT_FAMILY }}>
                      Reconnect to sync with OneDrive
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={msLogin}
                    style={{
                      background: COLORS.modal.primaryButton,
                      border: `1px solid ${COLORS.modal.borderActive}`,
                      color: COLORS.modal.textPrimary,
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      fontFamily: FONT_FAMILY
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = COLORS.modal.primaryButtonHover;
                      e.currentTarget.style.boxShadow = COLORS.modal.hoverGlow;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = COLORS.modal.primaryButton;
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    Reconnect
                  </button>
                </div>
              )}

              {/* Export / Sync Button at Bottom */}
              {!isSurveyPanelCollapsed && selectedTemplate && (
                <div style={{
                  padding: '12px',
                  borderTop: '1px solid #3a3a3a',
                  background: '#252525',
                  position: 'relative' // For dropdown positioning
                }}>
                  {/* Only show dropdown when file exists (linkedExcelExists === true) */}
                  {(!selectedTemplate.linkedExcelPath || linkedExcelExists !== true) ? (
                    <button
                      type="button"
                      onClick={handleExportSurveyToExcel}
                      disabled={isExporting}
                      style={{
                        width: '100%',
                        background: isExporting ? '#6c7a89' : '#4A90E2',
                        border: isExporting ? '1px solid #5a6673' : '1px solid #3277c7',
                        color: '#fff',
                        fontSize: '14px',
                        fontWeight: 600,
                        padding: '10px 16px',
                        borderRadius: '6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        cursor: isExporting ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s',
                        opacity: isExporting ? 0.7 : 1
                      }}
                      onMouseEnter={(e) => {
                        if (!isExporting) e.currentTarget.style.background = '#357abd';
                      }}
                      onMouseLeave={(e) => {
                        if (!isExporting) e.currentTarget.style.background = '#4A90E2';
                      }}
                    >
                      {isExporting ? 'EXPORTING...' : 'EXPORT'}
                    </button>
                  ) : (
                    <div ref={exportMenuRef} style={{ display: 'flex', width: '100%' }}>
                      <button
                        type="button"
                        onClick={() => handleExportSurveyToExcel()} // Default action: Export new
                        disabled={isExporting}
                        style={{
                          flex: 1,
                          background: isExporting ? '#6c7a89' : '#4A90E2',
                          borderTop: isExporting ? '1px solid #5a6673' : '1px solid #3277c7',
                          borderBottom: isExporting ? '1px solid #5a6673' : '1px solid #3277c7',
                          borderLeft: isExporting ? '1px solid #5a6673' : '1px solid #3277c7',
                          borderRight: 'none',
                          borderTopLeftRadius: '6px',
                          borderBottomLeftRadius: '6px',
                          color: '#fff',
                          fontSize: '14px',
                          fontWeight: 600,
                          padding: '10px 16px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          cursor: isExporting ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s',
                          opacity: isExporting ? 0.7 : 1
                        }}
                        onMouseEnter={(e) => {
                          if (!isExporting) e.currentTarget.style.background = '#357abd';
                        }}
                        onMouseLeave={(e) => {
                          if (!isExporting) e.currentTarget.style.background = '#4A90E2';
                        }}
                      >
                        {isExporting ? 'EXPORTING...' : 'EXPORT'}
                      </button>
                      <button
                        type="button"
                        onClick={() => !isExporting && setShowExportMenu(!showExportMenu)}
                        disabled={isExporting}
                        style={{
                          width: '40px',
                          background: isExporting ? '#6c7a89' : '#4A90E2',
                          borderTop: isExporting ? '1px solid #5a6673' : '1px solid #3277c7',
                          borderBottom: isExporting ? '1px solid #5a6673' : '1px solid #3277c7',
                          borderRight: isExporting ? '1px solid #5a6673' : '1px solid #3277c7',
                          borderLeft: '1px solid rgba(0,0,0,0.1)',
                          borderTopRightRadius: '6px',
                          borderBottomRightRadius: '6px',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: isExporting ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s',
                          opacity: isExporting ? 0.7 : 1
                        }}
                        onMouseEnter={(e) => {
                          if (!isExporting) e.currentTarget.style.background = '#357abd';
                        }}
                        onMouseLeave={(e) => {
                          if (!isExporting) e.currentTarget.style.background = '#4A90E2';
                        }}
                      >
                        {isExporting ? (
                          <div
                            style={{
                              width: '14px',
                              height: '14px',
                              border: '2px solid rgba(255,255,255,0.3)',
                              borderTop: '2px solid #fff',
                              borderRadius: '50%',
                              animation: 'spin 0.8s linear infinite'
                            }}
                          />
                        ) : (
                          <Icon name={showExportMenu ? "chevronUp" : "chevronDown"} size={16} />
                        )}
                        <style>{`
                          @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                          }
                        `}</style>
                      </button>

                      {showExportMenu && (
                        <div style={{
                          position: 'absolute',
                          bottom: '100%',
                          left: '12px',
                          right: '12px',
                          marginBottom: '8px',
                          background: '#333',
                          border: '1px solid #444',
                          borderRadius: '6px',
                          boxShadow: '0 -4px 12px rgba(0,0,0,0.3)',
                          zIndex: 100,
                          overflow: 'hidden'
                        }}>
                          <div
                            onClick={async () => {
                              const excelPath = selectedTemplate.linkedExcelPath;
                              const isOneDrive = selectedTemplate.isOneDrive;


                              if (!excelPath) {
                                alert('No Excel file is linked to this survey.');
                                setShowExportMenu(false);
                                return;
                              }

                              // Check if the path is actually a local file path (even if isOneDrive flag is set)
                              // Local paths start with / and contain /Users/ or /Library/ or drive letters on Windows
                              const isLocalFilePath = excelPath.startsWith('/Users/') ||
                                excelPath.startsWith('/Library/') ||
                                excelPath.match(/^[A-Za-z]:[\\/]/) || // Windows drive letter
                                excelPath.includes('/CloudStorage/'); // OneDrive sync folder

                              // For OneDrive API paths (like /Documents/file.xlsx), try to construct local sync folder path
                              if (isOneDrive && !isLocalFilePath && window.electronAPI) {
                                try {
                                  // Get home directory and find OneDrive folders
                                  const homeDir = await window.electronAPI.getHomeDir();
                                  const cloudStoragePath = `${homeDir}/Library/CloudStorage`;

                                  console.log('Looking for OneDrive file. Excel path:', excelPath);
                                  console.log('Home dir:', homeDir);
                                  console.log('CloudStorage path:', cloudStoragePath);

                                  // List CloudStorage directory to find OneDrive folders
                                  const cloudStorageContents = await window.electronAPI.listDir(cloudStoragePath);
                                  console.log('CloudStorage contents:', cloudStorageContents);

                                  const oneDriveFolders = cloudStorageContents.filter(name =>
                                    name.startsWith('OneDrive') || name.includes('OneDrive')
                                  );
                                  console.log('OneDrive folders found:', oneDriveFolders);

                                  // Build list of possible paths
                                  const possibleLocalPaths = [];

                                  // Add CloudStorage OneDrive folders
                                  for (const folder of oneDriveFolders) {
                                    possibleLocalPaths.push(`${cloudStoragePath}/${folder}${excelPath}`);
                                  }

                                  // Also try legacy OneDrive locations in home directory
                                  possibleLocalPaths.push(`${homeDir}/OneDrive${excelPath}`);
                                  possibleLocalPaths.push(`${homeDir}/OneDrive - Personal${excelPath}`);

                                  console.log('Trying these local paths:', possibleLocalPaths);

                                  let localPathFound = null;
                                  for (const localPath of possibleLocalPaths) {
                                    try {
                                      const exists = await window.electronAPI.fileExists(localPath);
                                      console.log(`Checking ${localPath}: ${exists ? 'EXISTS' : 'not found'}`);
                                      if (exists) {
                                        localPathFound = localPath;
                                        break;
                                      }
                                    } catch (e) {
                                      console.log(`Error checking ${localPath}:`, e);
                                      // Continue trying other paths
                                    }
                                  }

                                  if (localPathFound) {
                                    console.log('Found local file at:', localPathFound);
                                    // Open the local file directly
                                    const result = await window.electronAPI.openPath(localPathFound);
                                    if (result) {
                                      console.error('Failed to open local OneDrive file:', result);
                                      alert(`Failed to open Excel file:\n${result}`);
                                    }
                                    setShowExportMenu(false);
                                    return;
                                  }

                                  // If local file not found, fall through to web approach
                                  console.log('Local OneDrive file not found, trying web approach...');
                                } catch (err) {
                                  console.error('Error searching for local OneDrive file:', err);
                                  // Fall through to web approach
                                }
                              }

                              // Handle OneDrive API files - try desktop Excel first, fall back to web
                              if (isOneDrive && !isLocalFilePath) {
                                console.log('Trying web approach for OneDrive file...');
                                console.log('graphClient available:', !!graphClient);
                                try {
                                  // Get the file's web URL from OneDrive
                                  if (graphClient) {
                                    console.log('Fetching file metadata from Graph API:', `/me/drive/root:${excelPath}`);
                                    const driveItem = await graphClient.api(`/me/drive/root:${excelPath}`).get();
                                    console.log('Drive item response:', driveItem);
                                    console.log('webUrl:', driveItem?.webUrl);
                                    console.log('downloadUrl:', driveItem?.['@microsoft.graph.downloadUrl']);

                                    // Get webUrl, or construct one from the downloadUrl/id
                                    let webUrl = driveItem?.webUrl;

                                    // If no webUrl, try to open the file directly using downloadUrl
                                    if (!webUrl && driveItem?.['@microsoft.graph.downloadUrl']) {
                                      // For personal OneDrive, construct the web URL
                                      // Format: https://onedrive.live.com/edit.aspx?cid=<driveId>&resid=<itemId>
                                      const downloadUrl = driveItem['@microsoft.graph.downloadUrl'];
                                      console.log('No webUrl, using downloadUrl to open file');

                                      // Open the download URL which should trigger Excel to open
                                      window.open(downloadUrl, '_blank');
                                      setShowExportMenu(false);
                                      return;
                                    }

                                    if (webUrl) {
                                      console.log('Opening with webUrl:', webUrl);

                                      // In Electron, use shell.openExternal to open the URL
                                      // This will open in the default browser and Excel Online can handle it
                                      if (window.electronAPI?.openExternal) {
                                        try {
                                          await window.electronAPI.openExternal(webUrl);
                                          console.log('Opened webUrl with shell.openExternal');
                                        } catch (e) {
                                          console.error('Failed to open with openExternal:', e);
                                          // Fallback to window.open
                                          window.open(webUrl, '_blank');
                                        }
                                      } else {
                                        // Not in Electron, just open in new tab
                                        window.open(webUrl, '_blank');
                                      }
                                    } else {
                                      alert('Could not get the OneDrive file URL. Please open the file manually from OneDrive.');
                                    }
                                  } else {
                                    alert('Please sign in to Microsoft to open OneDrive files.');
                                  }
                                } catch (err) {
                                  console.error('Error opening OneDrive file:', err);
                                  alert(`Error opening OneDrive file:\n${err.message}`);
                                }
                                setShowExportMenu(false);
                                return;
                              }

                              // Handle local files
                              if (window.electronAPI) {
                                try {
                                  // Check if file exists first
                                  const exists = await window.electronAPI.fileExists(excelPath);

                                  if (!exists) {
                                    alert(`Excel file not found at:\n${excelPath}\n\nThe file may have been moved or deleted.`);
                                    setShowExportMenu(false);
                                    return;
                                  }

                                  const result = await window.electronAPI.openPath(excelPath);
                                  if (result) {
                                    // shell.openPath returns an error string if it fails, empty string on success
                                    console.error('Failed to open Excel file:', result);
                                    alert(`Failed to open Excel file:\n${result}\n\nPath: ${excelPath}`);
                                  }
                                } catch (err) {
                                  console.error('Error opening Excel file:', err);
                                  alert(`Error opening Excel file:\n${err.message}\n\nPath: ${excelPath}`);
                                }
                              } else {
                                alert('This feature is only available in the desktop app.');
                              }
                              setShowExportMenu(false);
                            }}
                            style={{
                              padding: '12px 16px',
                              color: '#fff',
                              fontSize: '14px',
                              cursor: 'pointer',
                              borderBottom: '1px solid #444',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#444'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Icon name="document" size={16} />
                            Open Excel
                          </div>
                          <div
                            onClick={() => {
                              handleExportSurveyToExcel(selectedTemplate.linkedExcelPath);
                              setShowExportMenu(false);
                            }}
                            style={{
                              padding: '12px 16px',
                              color: '#fff',
                              fontSize: '14px',
                              cursor: 'pointer',
                              borderBottom: '1px solid #444',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#444'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Icon name="upload" size={16} />
                            Push to Excel
                          </div>
                          {/* "Pull from Excel" reads the last SAVED copy from disk, which on
                              a local file open in Excel is stale and overlaps the automatic
                              import-on-save — so it's only offered for OneDrive workbooks. */}
                          {selectedTemplate?.isOneDrive && (
                          <div
                            onClick={() => {
                              handleSyncFromExcel();
                              setShowExportMenu(false);
                            }}
                            style={{
                              padding: '12px 16px',
                              color: '#fff',
                              fontSize: '14px',
                              cursor: 'pointer',
                              borderBottom: '1px solid #444',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#444'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Icon name="download" size={16} />
                            Pull from Excel
                          </div>
                          )}
                          {selectedTemplate?.isOneDrive && (
                            <div
                              onClick={() => {
                                if (liveSyncSupported === false) return;
                                setLiveSyncEnabled(!liveSyncEnabled);
                              }}
                              style={{
                                padding: '12px 16px',
                                color: liveSyncEnabled && liveSyncStatus === 'connected'
                                  ? '#3498db'
                                  : liveSyncStatus === 'connecting'
                                    ? '#f39c12'
                                    : liveSyncStatus === 'error' || liveSyncSupported === false
                                      ? '#e74c3c'
                                      : '#fff',
                                fontSize: '14px',
                                cursor: liveSyncSupported === false ? 'not-allowed' : 'pointer',
                                opacity: liveSyncSupported === false ? 0.6 : 1,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}
                              onMouseEnter={(e) => {
                                if (liveSyncSupported !== false) {
                                  e.currentTarget.style.background = '#444';
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                              }}
                              title={
                                liveSyncSupported === false
                                  ? 'Live sync requires Microsoft 365 Business account'
                                  : liveSyncEnabled && liveSyncStatus === 'connected'
                                    ? 'Live sync is active - changes sync in real-time'
                                    : liveSyncStatus === 'connecting'
                                      ? 'Connecting to Excel...'
                                      : liveSyncStatus === 'error'
                                        ? 'Live sync error - click to retry'
                                        : 'Enable live sync for real-time Excel updates'
                              }
                            >
                              <span style={{ fontSize: '14px' }}>
                                {liveSyncStatus === 'connecting'
                                  ? '...'
                                  : liveSyncEnabled && liveSyncStatus === 'connected'
                                    ? '●'
                                    : '○'}
                              </span>
                              Live Sync
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
  );
};

export default SurveySpacesRail;
