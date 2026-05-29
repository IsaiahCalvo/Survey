/**
 * TemplateReorderRows.jsx — dnd-kit sortable row components for the template editor.
 *
 * Exports three memoized rows: TemplateModuleSortableRow, TemplateCategorySortableRow
 * (drag handle + select checkbox + inline name input) and EntitySortableRow
 * (drag handle + color/opacity swatch + name input + delete). Each uses useSortable
 * for drag-to-reorder; rendered by the template reorder/management UI under src/home.
 */
import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../Icons';
import DragRearrangeHandle from '../reorder/DragRearrangeHandle';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

const getHexFromEntityColor = (color) => {
  if (!color) return '#E3D1FB';
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }
  if (color.startsWith('#')) {
    return color;
  }
  return '#E3D1FB';
};

const getOpacityFromEntityColor = (color) => {
  if (!color) return 100;
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match && match[4]) {
      return Math.round(parseFloat(match[4]) * 100);
    }
  }
  return 100;
};

export const TemplateModuleSortableRow = React.memo(function TemplateModuleSortableRow({
  module,
  isSelected,
  nameValue,
  onToggleSelect,
  onNameChange,
  onNameKeyDown,
  disabled
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: module.id,
    disabled
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 180ms cubic-bezier(0.2, 0, 0.2, 1)',
    width: '100%',
    position: 'relative',
    zIndex: isDragging ? 1 : 'auto',
    opacity: isDragging ? 0.82 : 1
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
          padding: '4px 6px',
          borderRadius: '8px',
          background: isDragging ? 'rgba(58, 58, 58, 0.55)' : 'transparent',
          border: isSelected ? '1px solid rgba(74, 144, 226, 0.45)' : '1px solid transparent',
          transition: 'background 0.18s ease, border-color 0.18s ease'
        }}
      >
        <style>
          {`@keyframes annotationHydrationSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}
        </style>
        <div
          {...attributes}
          {...listeners}
          style={{
            cursor: disabled ? 'default' : (isDragging ? 'grabbing' : 'grab'),
            color: '#888',
            fontSize: '16px',
            userSelect: 'none',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            touchAction: 'none'
          }}
          aria-label="Drag to rearrange module"
        >
          ☰
        </div>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(module.id)}
          style={{ cursor: 'pointer', width: '16px', height: '16px', flexShrink: 0 }}
        />
        <input
          type="text"
          value={nameValue}
          onChange={(e) => onNameChange(module.id, e.target.value)}
          onKeyDown={(e) => onNameKeyDown(module.id, e)}
          style={{
            flex: 1,
            padding: '6px 8px',
            borderRadius: '6px',
            border: '1px solid #4A90E2',
            outline: 'none',
            background: '#141414',
            color: '#eaeaea',
            fontFamily: FONT_FAMILY,
            fontSize: '13px',
            minWidth: 0
          }}
        />
      </div>
    </div>
  );
});

export const TemplateCategorySortableRow = React.memo(function TemplateCategorySortableRow({
  category,
  isSelected,
  nameValue,
  onToggleSelect,
  onNameChange,
  onNameKeyDown,
  disabled
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: category.id,
    disabled
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 180ms cubic-bezier(0.2, 0, 0.2, 1)',
    width: '100%',
    position: 'relative',
    zIndex: isDragging ? 1 : 'auto',
    opacity: isDragging ? 0.82 : 1
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
          padding: '4px 6px',
          borderRadius: '8px',
          background: isDragging ? 'rgba(58, 58, 58, 0.55)' : 'transparent',
          border: isSelected ? '1px solid rgba(74, 144, 226, 0.45)' : '1px solid transparent',
          transition: 'background 0.18s ease, border-color 0.18s ease'
        }}
      >
        <div
          {...attributes}
          {...listeners}
          style={{
            cursor: disabled ? 'default' : (isDragging ? 'grabbing' : 'grab'),
            color: '#888',
            fontSize: '16px',
            userSelect: 'none',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            touchAction: 'none'
          }}
          aria-label="Drag to rearrange category"
        >
          ☰
        </div>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(category.id)}
          style={{ cursor: 'pointer', width: '16px', height: '16px', flexShrink: 0 }}
        />
        <input
          type="text"
          value={nameValue}
          onChange={(e) => onNameChange(category.id, e.target.value)}
          onKeyDown={(e) => onNameKeyDown(category.id, e)}
          style={{
            flex: 1,
            padding: '6px 8px',
            borderRadius: '6px',
            border: '1px solid #4A90E2',
            outline: 'none',
            background: '#141414',
            color: '#eaeaea',
            fontFamily: FONT_FAMILY,
            fontSize: '13px',
            minWidth: 0
          }}
        />
      </div>
    </div>
  );
});

export const EntitySortableRow = React.memo(function EntitySortableRow({
  entity,
  selectedColorPickerId,
  onOpenColorPicker,
  onNameChange,
  onDelete,
  isAnyDragging
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: entity.id
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 180ms cubic-bezier(0.2, 0, 0.2, 1)',
    width: '100%',
    position: 'relative',
    zIndex: isDragging ? 1 : 'auto'
  };

  const isColorPickerSelected = selectedColorPickerId === entity.id;
  const currentHex = getHexFromEntityColor(entity.color);
  const currentOpacity = getOpacityFromEntityColor(entity.color);

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          padding: '8px 10px',
          background: '#1b1b1b',
          border: isDragging ? '1px solid rgba(74, 144, 226, 0.6)' : '1px solid #2f2f2f',
          borderRadius: '8px',
          boxShadow: isDragging ? '0 8px 24px rgba(0, 0, 0, 0.45)' : 'none',
          opacity: isDragging ? 0.65 : 1,
          transition: 'border 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease'
        }}
      >
        <DragRearrangeHandle
          {...attributes}
          {...listeners}
          data-entity-drag-handle
          isDragging={isDragging}
        />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flex: 1 }}>
          <div data-color-picker-area style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <div
                style={{
                  width: '40px',
                  height: '28px',
                  border: isColorPickerSelected ? '2px solid #4A90E2' : '1px solid #2f2f2f',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  position: 'relative',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  background: '#ffffff'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenColorPicker(entity.id, currentHex, currentOpacity);
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: currentHex || '#E3D1FB',
                    opacity: currentOpacity / 100,
                    mixBlendMode: 'multiply',
                    borderRadius: '5px'
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: '9px',
                  color: '#666',
                  lineHeight: 1,
                  textAlign: 'center',
                  opacity: 0.7
                }}
              >
                {currentOpacity}%
              </div>
            </div>
          </div>
          <input
            type="text"
            value={entity.name}
            onChange={(e) => onNameChange(entity.id, e.target.value)}
            placeholder="Entity name (e.g., GC, Subcontractor)"
            style={{
              flex: 1,
              padding: '6px 8px',
              background: '#141414',
              color: '#ddd',
              border: '1px solid #2f2f2f',
              borderRadius: '6px',
              outline: 'none',
              fontSize: '13px',
              height: '28px',
              boxSizing: 'border-box'
            }}
          />
        </div>
        <button
          data-entity-delete
          onClick={onDelete}
          title="Delete"
          className="btn btn-danger btn-icon-only btn-sm"
          style={{
            padding: '6px',
            minWidth: '28px',
            minHeight: '28px',
            flexShrink: 0,
            display: isAnyDragging ? 'none' : 'flex'
          }}
        >
          <Icon name="close" size={11} />
        </button>
      </div>
    </div>
  );
});
