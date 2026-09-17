/**
 * DragRearrangeHandle.jsx — grip-icon drag handle for rearrangeable list rows.
 *
 * Default-exports DragRearrangeHandle, a <span> rendering the "grip" Icon with
 * grab/grabbing cursor states and hover color feedback. Supports native HTML5
 * drag (setDragImage from the closest [data-drag-rearrange-row]) and stops
 * click/dragstart propagation. Used as the drag affordance in reorder lists.
 */
import Icon from '../Icons';

const DEFAULT_HANDLE_COLOR = 'var(--text-2)';
const HOVER_HANDLE_COLOR = 'var(--text-1)';

const handleStyle = (isDragging, style = {}) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  color: DEFAULT_HANDLE_COLOR,
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
        event.currentTarget.style.color = HOVER_HANDLE_COLOR;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = style?.color || DEFAULT_HANDLE_COLOR;
      }}
      style={handleStyle(isDragging, style)}
      {...props}
    >
      <Icon name="grip" size={11} />
    </span>
  );
}
