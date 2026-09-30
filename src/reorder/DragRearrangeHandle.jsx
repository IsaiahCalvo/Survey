/**
 * DragRearrangeHandle.jsx — grip-icon drag handle for rearrangeable list rows.
 *
 * Default-exports DragRearrangeHandle, a <span> rendering the "grip" Icon with
 * grab/grabbing cursor states and hover color feedback. Supports native HTML5
 * drag (setDragImage from the closest [data-drag-rearrange-row]) and stops
 * click/dragstart propagation. Used as the drag affordance in reorder lists.
 */
import Icon, { CHEVRON_DOWN_PATH } from '../Icons';

/*
 * MORPH GRIP (owner 2026-09-23, after morphicons.com). A row whose panel is
 * open below it shows a DOWN ARROW where its grip was, so you can see the row
 * can be folded back up; tapping the arrow folds it and the arrow becomes the
 * grip again. The six grip dots slide into a V along the arrow's two arms,
 * then the arrow's line draws over them; closing plays it backwards. Each dot
 * moves by its own offset, so this is one SVG, no swap and no flash.
 */
const GRIP_DOTS = [
  // [grip cx, cy, dx, dy] — dx/dy carry the dot onto the V (6,9)-(12,15)-(18,9)
  [9, 5, -3, 4],
  [9, 12, -0.6, -0.6],
  [9, 19, 1.8, -5.2],
  [15, 5, 3, 4],
  [15, 12, 0.6, -0.6],
  [15, 19, -1.8, -5.2],
];
function MorphGrip({ open, size = 12 }) {
  return (
    <svg
      className={`morph-grip${open ? ' is-open' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      {GRIP_DOTS.map(([cx, cy, dx, dy]) => (
        <circle
          key={`${cx}-${cy}`}
          className="morph-grip__dot"
          cx={cx}
          cy={cy}
          r="1.5"
          fill="currentColor"
          style={{ '--dx': `${dx}px`, '--dy': `${dy}px` }}
        />
      ))}
      <path
        className="morph-grip__arrow"
        d={CHEVRON_DOWN_PATH}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="1"
      />
    </svg>
  );
}

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
  // When a boolean, the grip is a MorphGrip: true shows the down arrow and a
  // tap calls onCollapse instead of starting anything. Undefined = plain grip.
  collapseOpen,
  onCollapse,
  ...props
}) {
  const morphs = typeof collapseOpen === 'boolean';
  return (
    <span
      draggable={nativeDraggable}
      data-drag-rearrange-handle
      // Shared "this is a drag grip" marker (see reorder/dragAutoScroll.js):
      // ancestor gesture recognisers (phone sheet swipe-down) ignore touches
      // that start inside [data-drag-handle].
      data-drag-handle=""
      title={morphs && collapseOpen ? 'Collapse' : title}
      aria-expanded={morphs ? collapseOpen : undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (morphs && collapseOpen) { onCollapse?.(event); return; }
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
      {morphs ? <MorphGrip open={collapseOpen} /> : <Icon name="grip" size={11} />}
    </span>
  );
}
