import React, { useState, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../Icons';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

const DraggableBookmarkFolder = ({
  item,
  isExpanded,
  onToggle,
  isEditMode,
  onRename,
  onDelete,
  onAddToGroup,
  isSelected,
  onSelect,
  incomingPlaceholderHeight = 0,
  children
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: item.id,
    data: {
      type: 'folder',
      item,
    },
    disabled: !isEditMode,
  });

  const [editName, setEditName] = useState(item.name || '');
  const inputRef = useRef(null);

  // Sync editName when item.name changes
  useEffect(() => {
    if (item && item.name !== undefined) {
      setEditName(item.name || '');
    }
  }, [item.name]);

  const saveRename = () => {
    if (item && item.id && editName.trim() && editName !== item.name && onRename) {
      onRename(item.id, editName.trim());
    }
  };

  const handleClick = (e) => {
    if (isEditMode) {
      e.stopPropagation();
      if (inputRef.current && !e.target.closest('button') && !e.target.closest('[data-drag-handle]')) {
        inputRef.current.focus();
        inputRef.current.select();
      }
      return;
    }

    // For folders, only toggle expand and select
    if (onSelect) {
      onSelect(item.id);
    }
    if (onToggle) {
      onToggle(item.id);
    }
  };

  const resolvedTransition = transition || 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'transform 0ms linear, opacity 80ms ease-out' : resolvedTransition,
    willChange: 'transform, opacity',
    opacity: isDragging ? 0.85 : 1,
    marginBottom: '1px',
  };

  const placeholderHeight = Math.max(0, incomingPlaceholderHeight);

  return (
    <div style={style}>
      <div
        ref={setNodeRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: isEditMode ? '3px 6px' : '5px 8px',
          borderRadius: '6px',
          cursor: isEditMode ? 'default' : 'pointer',
          background: isSelected ? '#3a3a3a' : 'transparent',
          border: '1px solid transparent',
          transition: 'background 0.15s ease, border-color 0.15s ease',
          fontSize: '13px',
          color: '#ddd',
          gap: isEditMode ? '6px' : '4px'
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
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onToggle) {
              onToggle(item.id);
            }
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#999',
            cursor: 'pointer',
            padding: '2px',
            marginRight: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px',
            flexShrink: 0,
            width: '16px'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <Icon
            name={isExpanded ? 'chevronDown' : 'chevronRight'}
            size={12}
          />
        </button>

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
            <div style={{
              width: '45px',
              marginLeft: '8px',
              flexShrink: 0
            }} />
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
          </div>
        )}

        {isEditMode && (
          <>
            {onAddToGroup && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (onAddToGroup && item && item.id) {
                    onAddToGroup(item.id);
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
                onMouseEnter={(e) => e.currentTarget.style.background = '#2b3a2b'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                title="Add Bookmarks to Group"
              >
                <Icon name="plus" size={12} color="#4A90E2" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (item && item.id && item.name && window.confirm(`Delete folder "${item.name}"?`)) {
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
              data-drag-handle
              style={{
                cursor: 'grab',
                color: '#888',
                fontSize: '16px',
                userSelect: 'none',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                zIndex: 10,
                position: 'relative',
                touchAction: 'none'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.cursor = 'grab';
                e.currentTarget.style.color = '#aaa';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.cursor = 'grab';
                e.currentTarget.style.color = '#888';
              }}
              title={`Drag handle for: ${item.name || item.id}`}
            >
              ☰
            </div>
          </>
        )}
      </div>

      {isExpanded && (
        <div
          style={{
            marginLeft: '16px',
            marginTop: '2px',
            borderLeft: '2px dashed rgba(74, 144, 226, 0.2)',
            borderRadius: '4px',
            paddingLeft: '8px',
            paddingTop: '4px',
            paddingBottom: placeholderHeight ? `${placeholderHeight + 12}px` : '4px',
            background: 'rgba(0, 0, 0, 0.1)',
            transition: 'padding-bottom 0.2s ease-out'
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default DraggableBookmarkFolder;
