import React, { useRef, useEffect, useCallback, useState } from 'react';
import { hexToRgba } from './types';

/**
 * CalloutComponent - Renders a single callout annotation
 * Ported from reference Callout app
 *
 * @param {Object} props
 * @param {Object} props.callout - Callout data object
 * @param {boolean} props.isSelected - Whether this callout is selected
 * @param {Function} props.onSelect - Called when callout is selected
 * @param {Function} props.onStartDrag - Called to start a drag operation
 * @param {Function} props.onUpdate - Called to update callout properties
 * @param {Function} props.onDelete - Called to delete the callout
 * @param {boolean} props.shouldFocus - Whether to focus textarea (for new callouts)
 * @param {number} props.pageWidth - Page width in pixels at current scale
 * @param {number} props.pageHeight - Page height in pixels at current scale
 */
const CalloutComponent = ({
  callout,
  isSelected,
  onSelect,
  onStartDrag,
  onUpdate,
  onDelete,
  shouldFocus,
  pageWidth,
  pageHeight,
}) => {
  const textareaRef = useRef(null);
  const [isEditing, setIsEditing] = useState(false);
  const wasSelectedBeforeClickRef = useRef(false);
  const isInClickSequenceRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const mouseDownPositionRef = useRef(null);
  const mouseMoveHandlerRef = useRef(null);
  const mouseUpHandlerRef = useRef(null);
  const prevIsSelectedRef = useRef(isSelected);

  // Convert percentage positions to pixels
  const toPixels = useCallback((point) => ({
    x: point.x * pageWidth,
    y: point.y * pageHeight,
  }), [pageWidth, pageHeight]);

  // Get pixel positions
  const arrowTip = toPixels(callout.arrowTip);
  const knee = toPixels(callout.knee);
  const textBoxPosition = toPixels(callout.textBoxPosition);
  const textBoxWidth = callout.textBoxWidth * pageWidth;
  const textBoxHeight = callout.textBoxHeight * pageHeight;

  // Focus textarea when newly created
  useEffect(() => {
    if (shouldFocus && textareaRef.current) {
      setIsEditing(true);
      textareaRef.current.focus();
    }
  }, [shouldFocus]);

  // Track selection state for click-to-edit logic
  useEffect(() => {
    if (!isInClickSequenceRef.current) {
      wasSelectedBeforeClickRef.current = isSelected;
    }
  }, [isSelected]);

  // Exit editing mode when deselected, and remove if empty
  useEffect(() => {
    // Check if we're transitioning from selected to deselected
    const wasSelected = prevIsSelectedRef.current;
    prevIsSelectedRef.current = isSelected;

    if (!isSelected) {
      setIsEditing(false);
      // Only delete if we were previously selected (not on initial mount)
      if (wasSelected && (!callout.text || callout.text.trim() === '')) {
        onDelete();
      }
    }
  }, [isSelected, callout.text, onDelete]);

  // Auto-resize textarea height based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.max(32, textareaRef.current.scrollHeight);
      textareaRef.current.style.height = `${newHeight}px`;

      // Update callout height if changed (convert back to percentage)
      const newHeightPercent = newHeight / pageHeight;
      if (Math.abs(newHeightPercent - callout.textBoxHeight) > 0.001) {
        onUpdate({ textBoxHeight: newHeightPercent });
      }
    }
  }, [callout.text, textBoxWidth, pageHeight, callout.textBoxHeight, onUpdate]);

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      if (mouseMoveHandlerRef.current) {
        document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
      }
      if (mouseUpHandlerRef.current) {
        document.removeEventListener('mouseup', mouseUpHandlerRef.current);
      }
    };
  }, []);

  const handleTextBoxMouseDown = useCallback((e) => {
    e.stopPropagation();

    if (!isEditing) {
      e.preventDefault(); // Prevent text selection during drag
      hasDraggedRef.current = false;
      mouseDownPositionRef.current = { x: e.clientX, y: e.clientY };

      const handleMouseMove = (moveEvent) => {
        if (mouseDownPositionRef.current && !hasDraggedRef.current) {
          const dx = Math.abs(moveEvent.clientX - mouseDownPositionRef.current.x);
          const dy = Math.abs(moveEvent.clientY - mouseDownPositionRef.current.y);
          if (dx > 5 || dy > 5) {
            hasDraggedRef.current = true;
          }
        }
      };

      if (mouseMoveHandlerRef.current) {
        document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
      }
      if (mouseUpHandlerRef.current) {
        document.removeEventListener('mouseup', mouseUpHandlerRef.current);
      }

      mouseMoveHandlerRef.current = handleMouseMove;
      document.addEventListener('mousemove', handleMouseMove);

      const handleMouseUp = () => {
        if (mouseMoveHandlerRef.current) {
          document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
          mouseMoveHandlerRef.current = null;
        }
        if (mouseUpHandlerRef.current) {
          document.removeEventListener('mouseup', mouseUpHandlerRef.current);
          mouseUpHandlerRef.current = null;
        }
      };

      mouseUpHandlerRef.current = handleMouseUp;
      document.addEventListener('mouseup', handleMouseUp);

      isInClickSequenceRef.current = true;
      wasSelectedBeforeClickRef.current = isSelected;
      onSelect();

      const rect = e.currentTarget.getBoundingClientRect();
      const offset = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      onStartDrag({ type: 'textBox', calloutId: callout.id }, offset);
    }
  }, [callout.id, isEditing, isSelected, onSelect, onStartDrag]);

  const handleTextBoxMouseUp = useCallback(() => {
    if (mouseMoveHandlerRef.current) {
      document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
      mouseMoveHandlerRef.current = null;
    }
  }, []);

  const handleTextBoxClick = useCallback((e) => {
    e.stopPropagation();

    if (mouseMoveHandlerRef.current) {
      document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
      mouseMoveHandlerRef.current = null;
    }

    const didDrag = hasDraggedRef.current;
    isInClickSequenceRef.current = false;
    hasDraggedRef.current = false;
    mouseDownPositionRef.current = null;

    // Only enter editing if it was already selected and no drag occurred
    if (wasSelectedBeforeClickRef.current && !didDrag) {
      setIsEditing(true);
      textareaRef.current?.focus();
    }
  }, []);

  const handleTextBoxDoubleClick = useCallback((e) => {
    e.stopPropagation();
    setIsEditing(true);
    textareaRef.current?.focus();
  }, []);

  const handleTextareaBlur = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleCornerMouseDown = useCallback((e, corner) => {
    e.stopPropagation();
    e.preventDefault(); // Prevent text selection during drag
    onSelect();
    onStartDrag({ type: 'textBoxCorner', calloutId: callout.id, corner }, { x: 0, y: 0 });
  }, [callout.id, onSelect, onStartDrag]);

  const handleHandleMouseDown = useCallback((e, targetType) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    onStartDrag({ type: targetType, calloutId: callout.id }, { x: 0, y: 0 });
  }, [callout.id, onSelect, onStartDrag]);

  const handleLineMouseDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
  }, [onSelect]);

  const handleLineClick = useCallback((e) => {
    e.stopPropagation();
    onSelect();
  }, [onSelect]);

  const { style } = callout;

  // Calculate text box center for line connection
  const textBoxCenter = {
    x: textBoxPosition.x + textBoxWidth / 2,
    y: textBoxPosition.y + textBoxHeight / 2,
  };

  // Find the closest point on the text box border to the knee
  const getClosestBorderPoint = () => {
    const halfW = textBoxWidth / 2;
    const halfH = textBoxHeight / 2;
    const cx = textBoxPosition.x + halfW;
    const cy = textBoxPosition.y + halfH;

    const dx = knee.x - cx;
    const dy = knee.y - cy;

    if (dx === 0 && dy === 0) {
      return { x: cx, y: cy - halfH };
    }

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    const scaleX = absDx > 0 ? halfW / absDx : Infinity;
    const scaleY = absDy > 0 ? halfH / absDy : Infinity;

    const scale = Math.min(scaleX, scaleY);

    const intersectionPoint = {
      x: cx + dx * scale,
      y: cy + dy * scale,
    };

    const tolerance = 0.1;
    const leftEdge = textBoxPosition.x;
    const rightEdge = textBoxPosition.x + textBoxWidth;
    const topEdge = textBoxPosition.y;
    const bottomEdge = textBoxPosition.y + textBoxHeight;

    const onLeftEdge = Math.abs(intersectionPoint.x - leftEdge) < tolerance;
    const onRightEdge = Math.abs(intersectionPoint.x - rightEdge) < tolerance;
    const onTopEdge = Math.abs(intersectionPoint.y - topEdge) < tolerance;
    const onBottomEdge = Math.abs(intersectionPoint.y - bottomEdge) < tolerance;

    if (onLeftEdge || onRightEdge || onTopEdge || onBottomEdge) {
      if (onLeftEdge) intersectionPoint.x = leftEdge;
      if (onRightEdge) intersectionPoint.x = rightEdge;
      if (onTopEdge) intersectionPoint.y = topEdge;
      if (onBottomEdge) intersectionPoint.y = bottomEdge;
    } else {
      if (scaleX < scaleY) {
        intersectionPoint.x = dx > 0 ? rightEdge : leftEdge;
        intersectionPoint.y = cy + dy * scaleX;
        intersectionPoint.y = Math.max(topEdge, Math.min(bottomEdge, intersectionPoint.y));
      } else {
        intersectionPoint.y = dy > 0 ? bottomEdge : topEdge;
        intersectionPoint.x = cx + dx * scaleY;
        intersectionPoint.x = Math.max(leftEdge, Math.min(rightEdge, intersectionPoint.x));
      }
    }

    return intersectionPoint;
  };

  const lineEndPoint = getClosestBorderPoint();

  // Line 1: textbox border → knee
  const line1Start = lineEndPoint;
  const line1End = knee;

  // Line 2: knee → arrow tip
  const line2Start = knee;
  const line2End = arrowTip;

  return (
    <>
      {/* SVG for lines */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none', // Let events pass through except for hit areas
        }}
      >
        <defs>
          <marker
            id={`arrowhead-${callout.id}`}
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill={hexToRgba(style.borderColor, style.borderOpacity)}
            />
          </marker>
        </defs>

        {/* Hit area for Line 1 - invisible wider stroke for easier clicking */}
        <line
          x1={line1Start.x}
          y1={line1Start.y}
          x2={line1End.x}
          y2={line1End.y}
          stroke="transparent"
          strokeWidth={16}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onMouseDown={handleLineMouseDown}
          onClick={handleLineClick}
        />

        {/* Line 1: Textbox to knee */}
        <line
          x1={line1Start.x}
          y1={line1Start.y}
          x2={line1End.x}
          y2={line1End.y}
          stroke={hexToRgba(style.borderColor, style.borderOpacity)}
          strokeWidth={style.lineThickness}
          style={{ pointerEvents: 'none' }}
        />

        {/* Hit area for Line 2 - invisible wider stroke for easier clicking */}
        <line
          x1={line2Start.x}
          y1={line2Start.y}
          x2={line2End.x}
          y2={line2End.y}
          stroke="transparent"
          strokeWidth={16}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onMouseDown={handleLineMouseDown}
          onClick={handleLineClick}
        />

        {/* Line 2: Knee to arrow tip */}
        <line
          x1={line2Start.x}
          y1={line2Start.y}
          x2={line2End.x}
          y2={line2End.y}
          stroke={hexToRgba(style.borderColor, style.borderOpacity)}
          strokeWidth={style.lineThickness}
          markerEnd={`url(#arrowhead-${callout.id})`}
          style={{ pointerEvents: 'none' }}
        />

        {/* Hit area for arrowhead - invisible circle for easier clicking */}
        <circle
          cx={arrowTip.x}
          cy={arrowTip.y}
          r={12}
          fill="transparent"
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          onMouseDown={handleLineMouseDown}
          onClick={handleLineClick}
        />

        {/* Hit area for knee - invisible circle for easier clicking */}
        <circle
          cx={knee.x}
          cy={knee.y}
          r={12}
          fill="transparent"
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          onMouseDown={handleLineMouseDown}
          onClick={handleLineClick}
        />
      </svg>


      {/* Text box */}
      <div
        style={{
          position: 'absolute',
          left: textBoxPosition.x,
          top: textBoxPosition.y,
          cursor: isEditing ? 'text' : 'move',
          pointerEvents: 'auto',
        }}
        onMouseDown={handleTextBoxMouseDown}
        onMouseUp={handleTextBoxMouseUp}
        onClick={handleTextBoxClick}
        onDoubleClick={handleTextBoxDoubleClick}
      >
        <textarea
          ref={textareaRef}
          value={callout.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          onBlur={handleTextareaBlur}
          className="callout-text-box"
          style={{
            width: textBoxWidth,
            minHeight: 32,
            backgroundColor: style.fillColor === 'transparent' ? 'transparent' : hexToRgba(style.fillColor, style.fillOpacity),
            borderColor: hexToRgba(style.borderColor, style.borderOpacity),
            borderWidth: style.lineThickness,
            borderStyle: 'solid',
            color: style.fontColor,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.bold ? 'bold' : 'normal',
            fontStyle: style.italic ? 'italic' : 'normal',
            textDecoration: [
              style.underline ? 'underline' : '',
              style.strikethrough ? 'line-through' : '',
            ].filter(Boolean).join(' ') || 'none',
            textAlign: style.textAlign || 'left',
            pointerEvents: isEditing ? 'auto' : 'none',
            cursor: isEditing ? 'text' : 'move',
            userSelect: isEditing ? 'text' : 'none',
            WebkitUserSelect: isEditing ? 'text' : 'none',
            padding: '4px 8px',
            borderRadius: '4px',
            outline: 'none',
            resize: 'none',
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        />

        {/* Resize handles for text box corners */}
        {isSelected && (
          <>
            <div
              style={{
                position: 'absolute',
                top: -6,
                left: -6,
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: '#ffffff',
                border: '2px solid #3b82f6',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
                cursor: 'nw-resize',
                zIndex: 20,
              }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'nw')}
              onClick={(e) => e.stopPropagation()}
            />
            <div
              style={{
                position: 'absolute',
                top: -6,
                right: -6,
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: '#ffffff',
                border: '2px solid #3b82f6',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
                cursor: 'ne-resize',
                zIndex: 20,
              }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'ne')}
              onClick={(e) => e.stopPropagation()}
            />
            <div
              style={{
                position: 'absolute',
                bottom: -6,
                left: -6,
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: '#ffffff',
                border: '2px solid #3b82f6',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
                cursor: 'sw-resize',
                zIndex: 20,
              }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'sw')}
              onClick={(e) => e.stopPropagation()}
            />
            <div
              style={{
                position: 'absolute',
                bottom: -6,
                right: -6,
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: '#ffffff',
                border: '2px solid #3b82f6',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
                cursor: 'se-resize',
                zIndex: 20,
              }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'se')}
              onClick={(e) => e.stopPropagation()}
            />
          </>
        )}
      </div>

      {/* Knee handle */}
      {isSelected && (
        <div
          style={{
            position: 'absolute',
            left: knee.x - 6,
            top: knee.y - 6,
            width: 12,
            height: 12,
            borderRadius: 3,
            backgroundColor: '#ffffff',
            border: '2px solid #3b82f6',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
            cursor: 'move',
            zIndex: 20,
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => handleHandleMouseDown(e, 'knee')}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {/* Arrow tip handle */}
      {isSelected && (
        <div
          style={{
            position: 'absolute',
            left: arrowTip.x - 6,
            top: arrowTip.y - 6,
            width: 12,
            height: 12,
            borderRadius: 3,
            backgroundColor: '#ffffff',
            border: '2px solid #3b82f6',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
            cursor: 'move',
            zIndex: 20,
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => handleHandleMouseDown(e, 'arrowTip')}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </>
  );
};

export default CalloutComponent;
