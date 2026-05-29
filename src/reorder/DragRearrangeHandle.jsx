import Icon from '../Icons';

const handleStyle = (isDragging, style = {}) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  color: '#777',
  cursor: isDragging ? 'grabbing' : 'grab',
  flexShrink: 0,
  lineHeight: 1,
  userSelect: 'none',
  touchAction: 'none',
  transition: 'color 0.15s ease, opacity 0.15s ease',
  ...style,
});

export default function DragRearrangeHandle({
  isDragging = false,
  title = 'Drag to rearrange',
  style,
  nativeDraggable = false,
  onClick,
  onDragStart,
  onDragEnd,
  ...props
}) {
  return (
    <span
      draggable={nativeDraggable}
      data-drag-rearrange-handle
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onDragStart={(event) => {
        event.stopPropagation();
        if (nativeDraggable && event.dataTransfer) {
          const row = event.currentTarget.closest('[data-drag-rearrange-row]') || event.currentTarget.parentElement;
          if (row) {
            const rect = row.getBoundingClientRect();
            event.dataTransfer.setDragImage(
              row,
              Math.max(0, event.clientX - rect.left),
              Math.max(0, event.clientY - rect.top)
            );
          }
        }
        onDragStart?.(event);
      }}
      onDragEnd={onDragEnd}
      onMouseEnter={(event) => {
        event.currentTarget.style.color = '#bbb';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = '#777';
      }}
      style={handleStyle(isDragging, style)}
      {...props}
    >
      <Icon name="grip" size={11} />
    </span>
  );
}
