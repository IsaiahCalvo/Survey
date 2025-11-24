import React, { useRef, useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDndContext } from '@dnd-kit/core';
import Icon from '../Icons';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

const DraggableBookmark = ({
  item,
  isNested = false,
  parentId = null,
  isEditMode,
  onNavigate,
  onRename,
  onDelete,
  onUpdate,
  numPages,
  isSelected,
  onSelect,
  recentlyDropped = false
}) => {
  const { active } = useDndContext();
  const isDraggingAny = !!active;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: {
      type: 'bookmark',
      item,
      parentId: parentId || null,
    },
    disabled: !isEditMode,
  });

  const [editName, setEditName] = useState(item.name || '');
  const [editPageNumber, setEditPageNumber] = useState(
    item.pageIds && item.pageIds.length > 0 ? item.pageIds[0].toString() : ''
  );

  const inputRef = useRef(null);
  const pageInputRef = useRef(null);
  const elementRef = useRef(null);
  const dimensionsRef = useRef(null);

  // Update dimensions before drag starts
  useEffect(() => {
    if (elementRef.current && !isDragging) {
      const rect = elementRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        dimensionsRef.current = { width: rect.width, height: rect.height };
      }
    }
  });

  // Sync editName when item.name changes
  useEffect(() => {
    if (item && item.name !== undefined) {
      setEditName(item.name || '');
    }
  }, [item.name]);

  // Sync editPageNumber when item.pageIds changes
  useEffect(() => {
    if (item && item.pageIds && Array.isArray(item.pageIds) && item.pageIds.length > 0) {
      setEditPageNumber(item.pageIds[0].toString());
    } else {
      setEditPageNumber('');
    }
  }, [item.pageIds]);

  const saveRename = () => {
    if (item && item.id && editName.trim() && editName !== item.name && onRename) {
      onRename(item.id, editName.trim());
    }
  };

  const handlePageInputChange = (value) => {
    const sanitized = value.replace(/[^\d]/g, '');
    if (!sanitized) {
      setEditPageNumber('');
      return;
    }
    const numericValue = parseInt(sanitized, 10);
    if (isNaN(numericValue) || numericValue < 1) {
      setEditPageNumber('');
      return;
    }
    if (numPages && numericValue > numPages) {
      setEditPageNumber(numPages.toString());
      return;
    }
    setEditPageNumber(numericValue.toString());
  };

  const savePageNumber = () => {
    if (!item || !item.id || !onUpdate) return;
    const originalPage = item.pageIds && item.pageIds.length > 0 ? item.pageIds[0].toString() : '';
    const trimmedValue = editPageNumber.trim();
    if (!trimmedValue) {
      setEditPageNumber(originalPage);
      return;
    }
    const pageNum = parseInt(trimmedValue, 10);
    if (isNaN(pageNum) || pageNum < 1 || (numPages && pageNum > numPages)) {
      if (numPages && pageNum > numPages) {
        alert(`Please enter a page number between 1 and ${numPages}.`);
      } else {
        alert('Please enter a valid page number.');
      }
      setEditPageNumber(originalPage);
      return;
    }
    const currentPageIds = item.pageIds || [];
    if (currentPageIds[0] !== pageNum) {
      onUpdate(item.id, { pageIds: [pageNum] });
    }
  };

  const handleClick = (e) => {
    if (isEditMode) {
      e.stopPropagation();
      if (inputRef.current && !e.target.closest('button')) {
        inputRef.current.focus();
        inputRef.current.select();
      }
      return;
    }

    if (onSelect) {
      onSelect(item.id);
    }
    if (item.pageIds && item.pageIds.length > 0) {
      onNavigate(item.pageIds);
    }
  };

  const pageValueString = (editPageNumber || '').toString();
  const pageInputCharCount = Math.max(3, pageValueString.length || 0);
  const pageInputWidth = `${pageInputCharCount + 0.5}ch`;

  const resolvedTransition = transition || 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging
      ? 'transform 0ms linear, opacity 60ms ease-out'
      : `${resolvedTransition}, opacity 160ms ease-out`,
    opacity: isDragging ? 0 : 1,
    willChange: 'transform, opacity',
    width: isDragging && dimensionsRef.current ? `${dimensionsRef.current.width}px` : 'auto',
    minWidth: isDragging && dimensionsRef.current ? `${dimensionsRef.current.width}px` : undefined,
    height: isDragging && dimensionsRef.current ? `${dimensionsRef.current.height}px` : 'auto',
    minHeight: isDragging && dimensionsRef.current ? `${dimensionsRef.current.height}px` : undefined,
    paddingLeft: isNested ? '16px' : '0',
    marginBottom: '1px',
  };

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        elementRef.current = el;
      }}
      style={style}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: isEditMode ? '2px 5px' : '4px 7px',
          borderRadius: '6px',
          cursor: isEditMode ? 'default' : 'pointer',
          background: isSelected ? '#3a3a3a' : 'transparent',
          border: recentlyDropped ? '2px solid rgba(74, 144, 226, 0.6)' : '1px solid transparent',
          boxShadow: recentlyDropped ? '0 4px 16px rgba(59, 130, 246, 0.08)' : 'none',
          transition: 'background 0.15s ease, border-color 0.2s ease, box-shadow 0.2s ease',
          fontSize: '13px',
          color: '#ddd',
          gap: isEditMode ? '8px' : '0',
          pointerEvents: isDragging ? 'none' : 'auto',
        }}
        onClick={handleClick}
        onMouseEnter={(e) => {
          if (!isSelected && !isEditMode) {
            e.currentTarget.style.background = '#2b2b2b';
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected && !isEditMode) {
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        <div
          style={{
            width: isNested ? '32px' : '27px',
            flexShrink: 0
          }}
        />

        {isEditMode ? (
          <div style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            minWidth: 0
          }}>
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#3a3a3a';
                saveRename();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  saveRename();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  setEditName(item.name);
                  e.currentTarget.blur();
                }
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '3px 3px',
                background: '#2b2b2b',
                color: '#ddd',
                border: '1px solid #3a3a3a',
                borderRadius: '4px',
                fontSize: '12px',
                fontFamily: FONT_FAMILY,
                outline: 'none',
                transition: 'border-color 0.15s ease',
                textAlign: 'left'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = '#4A90E2'}
            />
            <input
              ref={pageInputRef}
              type="text"
              value={editPageNumber}
              onChange={(e) => handlePageInputChange(e.target.value)}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#3a3a3a';
                savePageNumber();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  savePageNumber();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  const originalPage = item.pageIds && item.pageIds.length > 0 ? item.pageIds[0].toString() : '';
                  setEditPageNumber(originalPage);
                  e.currentTarget.blur();
                }
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: pageInputWidth,
                padding: '3px 4px',
                background: '#2b2b2b',
                color: '#ddd',
                border: '1px solid #3a3a3a',
                borderRadius: '4px',
                fontSize: '11px',
                fontFamily: FONT_FAMILY,
                outline: 'none',
                transition: 'border-color 0.15s ease',
                textAlign: 'center',
                flexShrink: 0,
                marginLeft: '8px',
                appearance: 'textfield',
                WebkitAppearance: 'none',
                MozAppearance: 'textfield'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = '#4A90E2'}
              placeholder="Page"
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </div>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            minWidth: 0
          }}>
            <span style={{
              fontSize: '13px',
              color: '#ddd',
              userSelect: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'left'
            }}>
              {item.name}
            </span>
            {item.pageIds && item.pageIds.length > 0 && (
              <span style={{
                color: '#999',
                fontSize: '11px',
                fontFamily: FONT_FAMILY,
                flexShrink: 0,
                marginLeft: '8px'
              }}>
                Page {item.pageIds[0]}
              </span>
            )}
          </div>
        )}

        {isEditMode && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (item && item.id && item.name && window.confirm(`Delete bookmark "${item.name}"?`)) {
                  onDelete(item.id);
                }
              }}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '2px 4px',
                cursor: 'pointer',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#3a1f1f'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              title="Delete"
            >
              <Icon name="trash" size={12} color="#ff6b6b" />
            </button>
            <div
              {...attributes}
              {...listeners}
              style={{
                cursor: isDraggingAny ? 'grabbing' : 'grab',
                color: '#888',
                fontSize: '16px',
                userSelect: 'none',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                touchAction: 'none'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#aaa';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#888';
              }}
              title="Drag to reorder"
            >
              ☰
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DraggableBookmark;
