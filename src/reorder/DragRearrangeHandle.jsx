import React from 'react';
import Icon from '../Icons';

const handleStyle = (isDragging, style = {}) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  background: '#1f1f1f',
  border: '1px solid #2d2d2d',
  color: '#777',
  cursor: isDragging ? 'grabbing' : 'grab',
  flexShrink: 0,
  transition: 'background 0.15s ease, color 0.15s ease, border 0.15s ease',
  ...style,
});

export default function DragRearrangeHandle({
  isDragging = false,
  title = 'Drag to rearrange',
  style,
  onClick,
  onDragStart,
  onDragEnd,
  ...props
}) {
  return (
    <span
      draggable
      data-drag-rearrange-handle
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onDragStart={(event) => {
        event.stopPropagation();
        onDragStart?.(event);
      }}
      onDragEnd={onDragEnd}
      onMouseEnter={(event) => {
        event.currentTarget.style.color = '#bbb';
        event.currentTarget.style.background = '#262626';
        event.currentTarget.style.border = '1px solid #3a3a3a';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = '#777';
        event.currentTarget.style.background = '#1f1f1f';
        event.currentTarget.style.border = '1px solid #2d2d2d';
      }}
      style={handleStyle(isDragging, style)}
      {...props}
    >
      <Icon name="grip" size={11} />
    </span>
  );
}
