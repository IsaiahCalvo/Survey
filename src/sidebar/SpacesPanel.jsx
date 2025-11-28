import React, { useState, useCallback, useMemo, useRef } from 'react';
import Icon from '../Icons';
import { parsePageRangeInput, formatPageList } from '../utils/pageRangeParser';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  DragOverlay
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

const SpaceDragOverlay = React.memo(function SpaceDragOverlay({
  space
}) {
  if (!space) return null;

  return (
    <div
      style={{
        background: '#2b2b2b',
        borderRadius: '8px',
        border: '1px solid rgba(74, 144, 226, 0.6)',
        padding: '10px 12px',
        minWidth: '220px',
        maxWidth: '260px',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.45)',
        opacity: 0.9,
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        fontFamily: FONT_FAMILY
      }}
    >
      <div style={{ fontSize: '13px', fontWeight: 600, color: '#e6e6e6' }}>
        {space.name}
      </div>
    </div>
  );
});

const SpaceSortableCard = React.memo(function SpaceSortableCard({
  space,
  isActive,
  isSelected,
  isExpanded,
  isEditing,
  editingName,
  pageSummary,
  pageCount,
  regionCount,
  pageInputValue,
  pageError,
  onToggleExpand,
  onSpaceClick,
  onRenameClick,
  onEditingNameChange,
  onSaveRename,
  onCancelRename,
  onDelete,
  onExportSpaceCSV,
  onExportSpacePDF,
  onPageInputChange,
  onAssignPages,
  onRenameRegion,
  onRequestRegionEdit,
  onRemovePage,
  onExitSpace,
  isRegionSelectionActive = false
}) {
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isExportHovered, setIsExportHovered] = useState(false);
  const [editingRegionId, setEditingRegionId] = useState(null);
  const [editingRegionValue, setEditingRegionValue] = useState('');
  const editingRegionInputRef = useRef(null);
  const exportControlAnchorRef = useRef(null);
  React.useEffect(() => {
    if (!isExpanded) {
      setIsExportMenuOpen(false);
      setEditingRegionId(null);
      setEditingRegionValue('');
    }
  }, [isExpanded]);
  React.useEffect(() => {
    if (!isExportMenuOpen) return;

    const handleOutsideClick = (event) => {
      if (!exportControlAnchorRef.current) return;
      if (!exportControlAnchorRef.current.contains(event.target)) {
        setIsExportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isExportMenuOpen]);
  React.useEffect(() => {
    setEditingRegionId(null);
    setEditingRegionValue('');
  }, [space.id]);

  React.useEffect(() => {
    if (editingRegionId !== null) {
      requestAnimationFrame(() => {
        editingRegionInputRef.current?.focus();
        editingRegionInputRef.current?.select();
      });
    }
  }, [editingRegionId]);
  const isExportActive = isExportHovered || isExportMenuOpen;

  const commitRegionRename = useCallback((pageId, triggerRegionEdit = false) => {
    if (editingRegionId !== pageId) {
      return;
    }
    const labelToSave = editingRegionValue.trim();
    onRenameRegion?.(space.id, pageId, labelToSave);
    setEditingRegionId(null);
    setEditingRegionValue('');
    if (triggerRegionEdit) {
      onRequestRegionEdit?.(space.id, pageId);
    }
  }, [editingRegionId, editingRegionValue, onRenameRegion, onRequestRegionEdit, space.id]);


  const cancelRegionRename = useCallback(() => {
    setEditingRegionId(null);
    setEditingRegionValue('');
  }, []);

  const handleRegionEditClick = useCallback((pageId, currentLabel) => {
    setEditingRegionId(pageId);
    setEditingRegionValue(currentLabel);
  }, []);


  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: space.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 180ms cubic-bezier(0.2, 0, 0.2, 1)',
    marginBottom: '8px'
  };

  const isHighlighted = isSelected || isActive;
  const headerBackground = isHighlighted ? '#3a3a3a' : 'transparent';
  const headerHoverBackground = isHighlighted ? '#3a3a3a' : '#2b2b2b';

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          background: '#2b2b2b',
          border: isHighlighted ? '1px solid transparent' : '1px solid #3a3a3a',
          borderRadius: '8px',
          overflow: isExpanded ? 'visible' : 'hidden',
          boxShadow: isHighlighted
            ? '0 4px 16px rgba(0, 0, 0, 0.18)'
            : '0 1px 2px rgba(0, 0, 0, 0.05)',
          opacity: isDragging ? 0.75 : 1,
          transform: isDragging ? 'scale(0.98)' : 'none',
          transition: 'opacity 0.18s ease, transform 0.18s ease'
        }}
      >
        <div
          onClick={() => onSpaceClick(space.id)}
          onDoubleClick={() => onToggleExpand(space.id)}
          style={{
            padding: '10px 10px 10px 6px',
            cursor: 'pointer',
            background: headerBackground,
            transition: 'background 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          onMouseEnter={(e) => {
            if (!isSelected && !isActive) {
              e.currentTarget.style.background = headerHoverBackground;
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected && !isActive) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          <div
            {...attributes}
            {...listeners}
            data-space-drag-handle
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '20px',
              height: '20px',
              borderRadius: '6px',
              color: '#666',
              fontSize: '16px',
              cursor: isDragging ? 'grabbing' : 'grab',
              userSelect: 'none',
              touchAction: 'none',
              background: isDragging ? '#3a3a3a' : 'transparent'
            }}
            title="Drag to reorder"
          >
            ☰
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(space.id);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              padding: '2px 4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            <Icon
              name={isExpanded ? 'chevronDown' : 'chevronRight'}
              size={12}
            />
          </button>

          {isEditing ? (
            <input
              type="text"
              value={editingName}
              onChange={(e) => onEditingNameChange(e.target.value)}
              onBlur={onSaveRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onSaveRename();
                } else if (e.key === 'Escape') {
                  onCancelRename();
                }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              style={{
                flex: 1,
                padding: '4px 8px',
                background: '#2b2b2b',
                color: '#ddd',
                border: '1px solid #4A90E2',
                borderRadius: '4px',
                fontSize: '13px',
                fontFamily: FONT_FAMILY,
                outline: 'none'
              }}
            />
          ) : (
            <>
              <span
                style={{
                  flex: 1,
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#ddd',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {space.name}
              </span>
              <div style={{
                display: 'flex',
                gap: '4px',
                alignItems: 'center',
                marginLeft: 'auto'
              }}>
                {isSelected && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onExitSpace?.(space.id);
                    }}
                    style={{
                      background: '#4A90E2',
                      border: 'none',
                      color: '#ffffff',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: FONT_FAMILY,
                      transition: 'background 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#357abd';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#4A90E2';
                    }}
                    title="Exit Space"
                  >
                    Exit
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRenameClick(space.id, space.name);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '4px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  title="Rename"
                >
                  <Icon name="edit" size={12} color="#666" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(space.id);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '4px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#ffebee'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  title="Delete"
                >
                  <Icon name="trash" size={12} color="#d32f2f" />
                </button>
              </div>
            </>
          )}
        </div>

        {isExpanded && (
          <div style={{
            padding: '10px 12px 16px 12px',
            background: '#2b2b2b',
            borderTop: '1px solid #3a3a3a',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontSize: '12px',
            color: '#999',
            position: 'relative'
          }}>
            <div style={{
              display: 'flex',
              flexWrap: 'nowrap',
              gap: '8px',
              alignItems: 'center'
            }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAssignPages(space.id);
                }}
                style={{
                  padding: '6px 10px',
                  background: '#4A90E2',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: FONT_FAMILY,
                  whiteSpace: 'nowrap'
                }}
              >
                Add Pages
              </button>
              <div
                ref={exportControlAnchorRef}
                style={{ position: 'relative', display: 'inline-flex' }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setIsExportMenuOpen((open) => !open)}
                  onMouseEnter={() => setIsExportHovered(true)}
                  onMouseLeave={() => setIsExportHovered(false)}
                  style={{
                    padding: '6px',
                    background: isExportActive ? '#4A90E2' : '#3a3a3a',
                    border: '1px solid #4A90E2',
                    color: isExportActive ? '#ffffff' : '#4A90E2',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: FONT_FAMILY,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease'
                  }}
                >
                  <Icon name="upload" size={14} color={isExportActive ? '#ffffff' : '#4A90E2'} />
                </button>
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: 'calc(100% + 8px)',
                    transform: 'translateY(-50%)',
                    background: '#1f1f1f',
                    color: '#fff',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 500,
                    opacity: isExportActive ? 1 : 0,
                    pointerEvents: 'none',
                    transition: 'opacity 0.2s ease',
                    whiteSpace: 'nowrap'
                  }}
                >
                  Export
                </div>
                {isExportMenuOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: '#1f1f1f',
                      border: '1px solid #3a3a3a',
                      borderRadius: '6px',
                      boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: 'auto',
                      width: 'max-content',
                      zIndex: 10,
                      overflow: 'hidden'
                    }}
                  >
                    <button
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        onExportSpaceCSV?.(space.id);
                      }}
                      style={{
                        padding: '8px 12px',
                        background: 'transparent',
                        color: '#ddd',
                        border: 'none',
                        fontSize: '12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontFamily: FONT_FAMILY
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      CSV
                    </button>
                    <button
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        onExportSpacePDF?.(space.id);
                      }}
                      style={{
                        padding: '8px 12px',
                        background: 'transparent',
                        color: '#ddd',
                        border: 'none',
                        fontSize: '12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontFamily: FONT_FAMILY
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      PDF
                    </button>
                  </div>
                )}
              </div>
              <div style={{
                position: 'absolute',
                top: '10px',
                right: '12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '2px'
              }}>
                <span style={{
                  color: '#777',
                  fontSize: '10px',
                  fontWeight: 400,
                  lineHeight: '1.2',
                  textAlign: 'right'
                }}>
                  {pageCount} page{pageCount !== 1 ? 's' : ''}
                </span>
                {regionCount > 0 && (
                  <span style={{
                    color: '#777',
                    fontSize: '10px',
                    fontWeight: 400,
                    lineHeight: '1.2',
                    textAlign: 'right'
                  }}>
                    {regionCount} region{regionCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <input
                type="text"
                value={pageInputValue}
                placeholder="Add pages (e.g. 3, 6-9, 12)"
                onChange={(e) => onPageInputChange(space.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onAssignPages(space.id);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  background: '#1f1f1f',
                  color: '#ddd',
                  border: '1px solid #3a3a3a',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontFamily: FONT_FAMILY
                }}
              />
              {pageError && (
                <div style={{ color: '#ff8a80', fontSize: '11px' }}>
                  {pageError}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ color: '#ccc', fontSize: '12px', fontWeight: 500 }}>
                Included Pages
              </div>
              {pageCount === 0 ? (
                <div style={{ color: '#777', fontSize: '12px' }}>
                  No pages added yet.
                </div>
              ) : (
                <ul style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  {space.assignedPages
                    ?.slice()
                    .sort((a, b) => (a.pageId || 0) - (b.pageId || 0))
                    .map(page => {
                      const regionLabel = typeof page.label === 'string' && page.label.trim().length > 0
                        ? page.label.trim()
                        : `Region ${page.pageId}`;
                      const isEditingRegion = editingRegionId === page.pageId;

                      return (
                        <li
                          key={page.pageId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 8px',
                            background: '#1f1f1f',
                            border: '1px solid #333',
                            borderRadius: '6px'
                          }}
                        >
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {isEditingRegion ? (
                              <input
                                ref={editingRegionInputRef}
                                type="text"
                                value={editingRegionValue}
                                onChange={(e) => setEditingRegionValue(e.target.value)}
                                onBlur={() => {
                                  if (isRegionSelectionActive) {
                                    return;
                                  }
                                  commitRegionRename(page.pageId, false);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitRegionRename(page.pageId, true);
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelRegionRename();
                                  }
                                }}
                                style={{
                                  width: '100%',
                                  padding: '4px 6px',
                                  background: '#1f1f1f',
                                  color: '#ddd',
                                  border: '1px solid #4A90E2',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  fontWeight: 500,
                                  fontFamily: FONT_FAMILY,
                                  outline: 'none'
                                }}
                              />
                            ) : (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRegionEditClick(page.pageId, regionLabel);
                                  }}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    padding: '4px',
                                    cursor: 'pointer',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#666'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = '#333';
                                    e.currentTarget.style.color = '#ddd';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'transparent';
                                    e.currentTarget.style.color = '#666';
                                  }}
                                  title="Rename Region"
                                >
                                  <Icon name="edit" size={12} />
                                </button>
                                <div style={{ color: '#ddd', fontWeight: 500 }}>
                                  {regionLabel}
                                </div>
                              </>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isEditingRegion) {
                                  commitRegionRename(page.pageId, true);
                                } else {
                                  // Only trigger geometry edit, NOT rename
                                  onRequestRegionEdit?.(space.id, page.pageId);
                                }
                              }}
                              onMouseDown={(e) => {
                                if (isEditingRegion) {
                                  e.preventDefault();
                                }
                              }}
                              style={{
                                padding: '6px 10px',
                                background: '#3a3a3a',
                                color: '#fff',
                                border: isEditingRegion ? '1px solid #4A90E2' : '1px solid transparent',
                                borderRadius: '4px',
                                fontSize: '11px',
                                cursor: 'pointer',
                                fontFamily: FONT_FAMILY,
                                boxShadow: isEditingRegion ? '0 0 0 1px rgba(74, 144, 226, 0.35)' : 'none'
                              }}
                            >
                              Edit
                            </button>
                            <button
                              title="Delete"
                              onClick={() => onRemovePage(space.id, page.pageId)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                padding: '4px',
                                cursor: 'pointer',
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#ffebee'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                              <Icon name="trash" size={12} color="#d32f2f" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

const SpacesPanel = ({
  spaces,
  activeSpaceId,
  onSpaceCreate,
  onSpaceUpdate,
  onSpaceDelete,
  onSetActiveSpace,
  onExitSpaceMode,
  onRequestRegionEdit,
  onSpaceAssignPages,
  onSpaceRenamePage,
  onSpaceRemovePage,
  onReorderSpaces,
  onExportSpaceCSV,
  onExportSpacePDF,
  isRegionSelectionActive = false,
  numPages
}) => {
  const [newSpaceName, setNewSpaceName] = useState('');
  const [editingSpace, setEditingSpace] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [expandedSpaces, setExpandedSpaces] = useState(new Set());
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [pageInputs, setPageInputs] = useState({});
  const [pageErrors, setPageErrors] = useState({});
  const [activeDragSpaceId, setActiveDragSpaceId] = useState(null);
  const previousSpaceIdsRef = useRef(new Set(spaces.map(space => space.id)));

  const spaceSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6
      }
    })
  );

  const activeDragSpace = useMemo(
    () => spaces.find(space => space.id === activeDragSpaceId) || null,
    [activeDragSpaceId, spaces]
  );

  const handleCreateSpace = useCallback(() => {
    const name = newSpaceName.trim() || `Space ${spaces.length + 1}`;
    if (onSpaceCreate) {
      onSpaceCreate({
        name,
        assignedPages: []
      });
    }
    setNewSpaceName('');
  }, [newSpaceName, spaces.length, onSpaceCreate]);

  const handleRename = useCallback((spaceId, currentName) => {
    setEditingSpace(spaceId);
    setEditingName(currentName);
  }, []);

  const saveRename = useCallback(() => {
    if (editingSpace && editingName.trim() && onSpaceUpdate) {
      onSpaceUpdate(editingSpace, { name: editingName.trim() });
    }
    setEditingSpace(null);
    setEditingName('');
  }, [editingSpace, editingName, onSpaceUpdate]);

  const handleEditingNameChange = useCallback((value) => {
    setEditingName(value);
  }, []);

  const handleRenameCancel = useCallback(() => {
    setEditingSpace(null);
    setEditingName('');
  }, []);

  const handleDelete = useCallback((spaceId) => {
    if (window.confirm('Delete this space? This will not delete the pages, only the space assignment.')) {
      if (onSpaceDelete) {
        onSpaceDelete(spaceId);
      }
    }
  }, [onSpaceDelete]);

  const handleToggleExpand = useCallback((spaceId) => {
    setExpandedSpaces(prev => {
      const next = new Set(prev);
      if (next.has(spaceId)) {
        next.delete(spaceId);
      } else {
        next.add(spaceId);
      }
      return next;
    });
  }, []);

  const handleSpaceClick = useCallback((spaceId) => {
    setSelectedSpaceId(spaceId);
    if (onSetActiveSpace) {
      onSetActiveSpace(spaceId);
    }
  }, [onSetActiveSpace]);

  const handleExitSpace = useCallback((spaceId) => {
    if (selectedSpaceId === spaceId) {
      setSelectedSpaceId(null);
    }
    if (activeSpaceId === spaceId && onExitSpaceMode) {
      onExitSpaceMode();
    }
  }, [selectedSpaceId, activeSpaceId, onExitSpaceMode]);

  const handlePageInputChange = useCallback((spaceId, value) => {
    setPageInputs(prev => ({
      ...prev,
      [spaceId]: value
    }));
    setPageErrors(prev => ({
      ...prev,
      [spaceId]: null
    }));
  }, []);

  const handleAssignPages = useCallback((spaceId) => {
    const rawInput = (pageInputs[spaceId] || '').trim();
    const { pages, errors } = parsePageRangeInput(rawInput, {
      min: 1,
      max: typeof numPages === 'number' && numPages > 0 ? numPages : Infinity
    });

    if (errors.length > 0) {
      setPageErrors(prev => ({
        ...prev,
        [spaceId]: errors.join(' ')
      }));
      return;
    }

    if (pages.length === 0) {
      setPageErrors(prev => ({
        ...prev,
        [spaceId]: 'Enter one or more page numbers.'
      }));
      return;
    }

    if (onSpaceAssignPages) {
      onSpaceAssignPages(spaceId, pages);
    }

    setPageInputs(prev => ({
      ...prev,
      [spaceId]: ''
    }));
    setPageErrors(prev => ({
      ...prev,
      [spaceId]: null
    }));
  }, [pageInputs, numPages, onSpaceAssignPages]);

  React.useEffect(() => {
    const previousIds = previousSpaceIdsRef.current;
    const currentIds = new Set(spaces.map(space => space.id));
    const newlyAddedIds = spaces
      .map(space => space.id)
      .filter((spaceId) => spaceId != null && !previousIds.has(spaceId));

    if (newlyAddedIds.length > 0) {
      setExpandedSpaces(prev => {
        const next = new Set(prev);
        newlyAddedIds.forEach(id => next.add(id));
        return next;
      });
    }

    previousSpaceIdsRef.current = currentIds;
  }, [spaces]);

  const renderPageSummary = useCallback((assignedPages = []) => {
    const ids = assignedPages
      .map(entry => entry?.pageId)
      .filter(pageId => typeof pageId === 'number' && !Number.isNaN(pageId));
    return formatPageList(ids);
  }, []);

  const handleRemovePage = useCallback((spaceId, pageId) => {
    if (!onSpaceRemovePage) return;
    onSpaceRemovePage(spaceId, pageId);
  }, [onSpaceRemovePage]);

  const handleSpaceDragStart = useCallback(({ active }) => {
    setActiveDragSpaceId(active.id);
  }, []);

  const handleSpaceDragEnd = useCallback(({ active, over }) => {
    setActiveDragSpaceId(null);
    if (!over || active.id === over.id) return;
    if (!onReorderSpaces) return;
    const fromIndex = spaces.findIndex(space => space.id === active.id);
    const toIndex = spaces.findIndex(space => space.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;
    onReorderSpaces(fromIndex, toIndex);
  }, [onReorderSpaces, spaces]);

  const handleSpaceDragCancel = useCallback(() => {
    setActiveDragSpaceId(null);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: FONT_FAMILY,
      background: '#252525'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px',
        background: '#252525',
        borderBottom: '1px solid #3a3a3a'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '13px',
          fontWeight: '600',
          color: '#ddd',
          marginBottom: '12px'
        }}>
          Spaces
        </h3>

        {/* Create Space Input */}
        <div style={{
          display: 'flex',
          gap: '8px'
        }}>
          <input
            type="text"
            placeholder="New space name"
            value={newSpaceName}
            onChange={(e) => setNewSpaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleCreateSpace();
              }
            }}
            style={{
              flex: 1,
              padding: '8px 10px',
              background: '#2b2b2b',
              color: '#ddd',
              border: '1px solid #3a3a3a',
              borderRadius: '6px',
              fontSize: '13px',
              fontFamily: FONT_FAMILY,
              outline: 'none'
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = '#4A90E2'}
            onBlur={(e) => e.currentTarget.style.borderColor = '#d0d0d0'}
          />
          <button
            onClick={handleCreateSpace}
            style={{
              padding: '8px 12px',
              background: '#4A90E2',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONT_FAMILY
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#357abd'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#4A90E2'}
          >
            <Icon name="plus" size={14} color="#ffffff" />
          </button>
        </div>
      </div>

      {/* Spaces List */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px'
      }}>
        {spaces.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: '#999',
            fontSize: '13px'
          }}>
            No spaces yet. Create a space to filter pages by visibility.
          </div>
        ) : (
          <DndContext
            sensors={spaceSensors}
            collisionDetection={closestCenter}
            onDragStart={handleSpaceDragStart}
            onDragEnd={handleSpaceDragEnd}
            onDragCancel={handleSpaceDragCancel}
          >
            <SortableContext
              items={spaces.map(space => space.id)}
              strategy={verticalListSortingStrategy}
            >
              {spaces.map((space) => {
                const isActive = activeSpaceId === space.id;
                const isSelected = selectedSpaceId === space.id;
                const isExpanded = expandedSpaces.has(space.id);
                const pageCount = space.assignedPages?.length || 0;
                const regionCount = space.assignedPages?.reduce((sum, p) => sum + (p.regions?.length || 0), 0) || 0;
                return (
                  <SpaceSortableCard
                    key={space.id}
                    space={space}
                    isActive={isActive}
                    isSelected={isSelected}
                    isExpanded={isExpanded}
                    isEditing={editingSpace === space.id}
                    editingName={editingName}
                    pageSummary={renderPageSummary(space.assignedPages)}
                    pageCount={pageCount}
                    regionCount={regionCount}
                    pageInputValue={pageInputs[space.id] || ''}
                    pageError={pageErrors[space.id]}
                    onToggleExpand={handleToggleExpand}
                    onSpaceClick={handleSpaceClick}
                    onRenameClick={handleRename}
                    onEditingNameChange={handleEditingNameChange}
                    onSaveRename={saveRename}
                    onCancelRename={handleRenameCancel}
                    onDelete={handleDelete}
                    onExitSpace={handleExitSpace}
                    onExportSpaceCSV={(spaceId) => onExportSpaceCSV?.(spaceId)}
                    onExportSpacePDF={(spaceId) => onExportSpacePDF?.(spaceId)}
                    onPageInputChange={handlePageInputChange}
                    onAssignPages={handleAssignPages}
                    onRenameRegion={onSpaceRenamePage}
                    onRequestRegionEdit={(spaceId, pageId) => onRequestRegionEdit?.(spaceId, pageId)}
                    onRemovePage={handleRemovePage}
                    isRegionSelectionActive={isRegionSelectionActive}
                  />
                );
              })}
            </SortableContext>
            <DragOverlay>
              {activeDragSpace && (
                <SpaceDragOverlay
                  space={activeDragSpace}
                />
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
};

export default SpacesPanel;
