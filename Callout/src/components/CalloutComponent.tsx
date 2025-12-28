import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Callout, DragTarget, Point } from '@/types/callout';

type Corner = 'nw' | 'ne' | 'se' | 'sw';

interface CalloutComponentProps {
  callout: Callout;
  isSelected: boolean;
  onSelect: () => void;
  onStartDrag: (target: DragTarget, offset: Point) => void;
  onUpdate: (updates: Partial<Callout>) => void;
  shouldFocus: boolean;
}

// Helper function to convert hex color to rgba
const hexToRgba = (hex: string, opacity: number): string => {
  if (hex === 'transparent') return 'transparent';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

export const CalloutComponent: React.FC<CalloutComponentProps> = ({
  callout,
  isSelected,
  onSelect,
  onStartDrag,
  onUpdate,
  shouldFocus,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const wasSelectedBeforeClickRef = useRef(false);
  const isInClickSequenceRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const mouseDownPositionRef = useRef<Point | null>(null);
  const mouseMoveHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const mouseUpHandlerRef = useRef<(() => void) | null>(null);

  // Focus textarea when newly created
  useEffect(() => {
    if (shouldFocus && textareaRef.current) {
      setIsEditing(true);
      textareaRef.current.focus();
    }
  }, [shouldFocus]);

  // Track selection state for click-to-edit logic (but only when not in a click sequence)
  useEffect(() => {
    // Only update the ref if we're NOT in the middle of a click sequence
    // This prevents the useEffect from overwriting the value we set in mouseDown
    if (!isInClickSequenceRef.current) {
      wasSelectedBeforeClickRef.current = isSelected;
    }
  }, [isSelected]);

  // Exit editing mode when deselected
  useEffect(() => {
    if (!isSelected) {
      setIsEditing(false);
    }
  }, [isSelected]);

  // Auto-resize textarea height based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.max(32, textareaRef.current.scrollHeight);
      textareaRef.current.style.height = `${newHeight}px`;
      if (newHeight !== callout.textBoxHeight) {
        onUpdate({ textBoxHeight: newHeight });
      }
    }
  }, [callout.text, callout.textBoxWidth]);

  const handleTextBoxMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    
    // If not editing, start drag for moving
    if (!isEditing) {
      // Reset drag tracking for this interaction
      hasDraggedRef.current = false;
      mouseDownPositionRef.current = { x: e.clientX, y: e.clientY };
      
      // Set up document-level mousemove listener to track drag
      const handleMouseMove = (e: MouseEvent) => {
        if (mouseDownPositionRef.current && !hasDraggedRef.current) {
          const dx = Math.abs(e.clientX - mouseDownPositionRef.current.x);
          const dy = Math.abs(e.clientY - mouseDownPositionRef.current.y);
          // If mouse moved more than 5 pixels, consider it a drag
          if (dx > 5 || dy > 5) {
            hasDraggedRef.current = true;
          }
        }
      };
      
      // Clean up previous handlers if they exist
      if (mouseMoveHandlerRef.current) {
        document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
      }
      if (mouseUpHandlerRef.current) {
        document.removeEventListener('mouseup', mouseUpHandlerRef.current);
      }
      
      // Set up mouse move handler
      mouseMoveHandlerRef.current = handleMouseMove;
      document.addEventListener('mousemove', handleMouseMove);
      
      // Set up mouse up handler to clean up when mouse is released anywhere
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
      
      // Mark that we're starting a click sequence to prevent useEffect from overwriting our ref
      isInClickSequenceRef.current = true;
      // Store whether it was selected before this click
      // This is checked in handleTextBoxClick to determine if we should enter editing mode
      wasSelectedBeforeClickRef.current = isSelected;
      onSelect();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const offset: Point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CalloutComponent.tsx:127',message:'textBox drag start',data:{clientX:e.clientX,clientY:e.clientY,rectLeft:rect.left,rectTop:rect.top,rectWidth:rect.width,rectHeight:rect.height,offsetX:offset.x,offsetY:offset.y,textBoxX:callout.textBoxPosition.x,textBoxY:callout.textBoxPosition.y},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      onStartDrag({ type: 'textBox', calloutId: callout.id }, offset);
    }
  }, [callout.id, isEditing, isSelected, onSelect, onStartDrag]);
  
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

  const handleTextBoxMouseUp = useCallback(() => {
    // Clean up mouse move listener when mouse is released
    if (mouseMoveHandlerRef.current) {
      document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
      mouseMoveHandlerRef.current = null;
    }
  }, []);

  const handleTextBoxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Clean up mouse move listener
    if (mouseMoveHandlerRef.current) {
      document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
      mouseMoveHandlerRef.current = null;
    }
    
    // Check if a drag operation occurred - if so, don't enter editing mode
    const didDrag = hasDraggedRef.current;
    
    // Clear the click sequence flag and drag tracking
    isInClickSequenceRef.current = false;
    hasDraggedRef.current = false;
    mouseDownPositionRef.current = null;
    
    // Only enter editing mode if:
    // 1. It was already selected before this click (second click scenario)
    // 2. No drag occurred (just a click, not click-and-drag)
    if (wasSelectedBeforeClickRef.current && !didDrag) {
      setIsEditing(true);
      textareaRef.current?.focus();
    }
    // If it wasn't selected before, this is the first click - just select (already handled in mouseDown)
    // If a drag occurred, don't enter editing mode
  }, [callout.id, isSelected, isEditing]);

  const handleTextBoxDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Double click always enters editing mode immediately
    setIsEditing(true);
    textareaRef.current?.focus();
  }, []);

  const handleCornerMouseDown = useCallback((e: React.MouseEvent, corner: Corner) => {
    e.stopPropagation();
    onSelect();
    onStartDrag({ type: 'textBoxCorner', calloutId: callout.id, corner }, { x: 0, y: 0 });
  }, [callout.id, onSelect, onStartDrag]);

  const handleHandleMouseDown = useCallback((e: React.MouseEvent, targetType: 'arrowTip' | 'knee') => {
    e.stopPropagation();
    onSelect();
    onStartDrag({ type: targetType, calloutId: callout.id }, { x: 0, y: 0 });
  }, [callout.id, onSelect, onStartDrag]);

  const handleLineMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  }, [onSelect]);

  const handleLineClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  }, [onSelect]);

  const handleArrowAreaMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  }, [onSelect]);

  const handleArrowAreaClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  }, [onSelect]);

  const handleKneeAreaMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  }, [onSelect]);

  const handleKneeAreaClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  }, [onSelect]);

  const { arrowTip, knee, textBoxPosition, textBoxWidth, textBoxHeight, text, style } = callout;

  // Calculate text box center for line connection
  const textBoxCenter: Point = {
    x: textBoxPosition.x + textBoxWidth / 2,
    y: textBoxPosition.y + textBoxHeight / 2,
  };

  // Find the closest point on the text box border to the knee
  const getClosestBorderPoint = (): Point => {
    const halfW = textBoxWidth / 2;
    const halfH = textBoxHeight / 2;
    const cx = textBoxPosition.x + halfW;
    const cy = textBoxPosition.y + halfH;
    
    // Direction from center to knee
    const dx = knee.x - cx;
    const dy = knee.y - cy;
    
    if (dx === 0 && dy === 0) {
      return { x: cx, y: cy - halfH };
    }
    
    // Calculate intersection with box edges using proper line-box intersection
    // We need to find where the line from center to knee intersects the rectangle border
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    
    // Calculate scale factors for each axis
    const scaleX = absDx > 0 ? halfW / absDx : Infinity;
    const scaleY = absDy > 0 ? halfH / absDy : Infinity;
    
    // Use the smaller scale to ensure we hit the border
    const scale = Math.min(scaleX, scaleY);
    
    // Calculate intersection point
    const intersectionPoint = {
      x: cx + dx * scale,
      y: cy + dy * scale,
    };
    
    // Verify the point is on the border (within numerical precision)
    const tolerance = 0.1;
    const leftEdge = textBoxPosition.x;
    const rightEdge = textBoxPosition.x + textBoxWidth;
    const topEdge = textBoxPosition.y;
    const bottomEdge = textBoxPosition.y + textBoxHeight;
    
    const onLeftEdge = Math.abs(intersectionPoint.x - leftEdge) < tolerance;
    const onRightEdge = Math.abs(intersectionPoint.x - rightEdge) < tolerance;
    const onTopEdge = Math.abs(intersectionPoint.y - topEdge) < tolerance;
    const onBottomEdge = Math.abs(intersectionPoint.y - bottomEdge) < tolerance;
    
    // Clamp to ensure point is exactly on the border
    if (onLeftEdge || onRightEdge || onTopEdge || onBottomEdge) {
      // Point is on border, ensure exact coordinates
      if (onLeftEdge) intersectionPoint.x = leftEdge;
      if (onRightEdge) intersectionPoint.x = rightEdge;
      if (onTopEdge) intersectionPoint.y = topEdge;
      if (onBottomEdge) intersectionPoint.y = bottomEdge;
    } else {
      // Fallback: clamp to nearest edge
      if (scaleX < scaleY) {
        // Hit vertical edge
        intersectionPoint.x = dx > 0 ? rightEdge : leftEdge;
        intersectionPoint.y = cy + dy * scaleX;
        // Clamp y to top/bottom
        intersectionPoint.y = Math.max(topEdge, Math.min(bottomEdge, intersectionPoint.y));
      } else {
        // Hit horizontal edge
        intersectionPoint.y = dy > 0 ? bottomEdge : topEdge;
        intersectionPoint.x = cx + dx * scaleY;
        // Clamp x to left/right
        intersectionPoint.x = Math.max(leftEdge, Math.min(rightEdge, intersectionPoint.x));
      }
    }
    
    return intersectionPoint;
  };

  const lineEndPoint = getClosestBorderPoint();

  // Define the two lines:
  // Line 1: Always connects textbox border point to knee
  const line1Start = lineEndPoint;  // Textbox border connection point
  const line1End = knee;             // Knee connection point
  
  // Line 2: Always connects knee to arrow tip
  const line2Start = knee;           // Knee connection point
  const line2End = arrowTip;         // Arrow tip connection point

  return (
    <>
      {/* SVG for lines */}
      <svg
        className="absolute inset-0"
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
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
        
        {/* Line 1: Textbox to knee - always connected */}
        <line
          x1={line1Start.x}
          y1={line1Start.y}
          x2={line1End.x}
          y2={line1End.y}
          stroke={hexToRgba(style.borderColor, style.borderOpacity)}
          strokeWidth={style.lineThickness}
          style={{ pointerEvents: 'stroke' }}
          onMouseDown={handleLineMouseDown}
          onClick={handleLineClick}
        />

        {/* Line 2: Knee to arrow tip - always connected */}
        <line
          x1={line2Start.x}
          y1={line2Start.y}
          x2={line2End.x}
          y2={line2End.y}
          stroke={hexToRgba(style.borderColor, style.borderOpacity)}
          strokeWidth={style.lineThickness}
          markerEnd={`url(#arrowhead-${callout.id})`}
          style={{ pointerEvents: 'stroke' }}
          onMouseDown={handleLineMouseDown}
          onClick={handleLineClick}
        />
      </svg>

      {/* Clickable area around arrow tip for selection - only when not selected to avoid conflicts with handles */}
      {!isSelected && (
        <div
          className="absolute cursor-pointer"
          style={{
            left: arrowTip.x - 12,
            top: arrowTip.y - 12,
            width: 24,
            height: 24,
            zIndex: 1,
          }}
          onMouseDown={handleArrowAreaMouseDown}
          onClick={handleArrowAreaClick}
        />
      )}

      {/* Clickable area around knee for selection - only when not selected to avoid conflicts with handles */}
      {!isSelected && (
        <div
          className="absolute cursor-pointer"
          style={{
            left: knee.x - 12,
            top: knee.y - 12,
            width: 24,
            height: 24,
            zIndex: 1,
          }}
          onMouseDown={handleKneeAreaMouseDown}
          onClick={handleKneeAreaClick}
        />
      )}

      {/* Text box */}
      <div
        className="absolute cursor-move"
        style={{
          left: textBoxPosition.x,
          top: textBoxPosition.y,
        }}
        onMouseDown={handleTextBoxMouseDown}
        onMouseUp={handleTextBoxMouseUp}
        onClick={handleTextBoxClick}
        onDoubleClick={handleTextBoxDoubleClick}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          className="callout-text-box"
          style={{
            width: textBoxWidth,
            minHeight: 32,
            backgroundColor: style.fillColor === 'transparent' ? 'transparent' : hexToRgba(style.fillColor, style.fillOpacity),
            borderColor: hexToRgba(style.borderColor, style.borderOpacity),
            borderWidth: style.lineThickness,
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
          }}
        />

        {/* Resize handles for text box corners */}
        {isSelected && (
          <>
            <div
              className="handle-style absolute cursor-nw-resize"
              style={{ top: -6, left: -6 }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'nw')}
            />
            <div
              className="handle-style absolute cursor-ne-resize"
              style={{ top: -6, right: -6 }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'ne')}
            />
            <div
              className="handle-style absolute cursor-sw-resize"
              style={{ bottom: -6, left: -6 }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'sw')}
            />
            <div
              className="handle-style absolute cursor-se-resize"
              style={{ bottom: -6, right: -6 }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'se')}
            />
          </>
        )}
      </div>

      {/* Knee handle */}
      {isSelected && (
        <div
          className="handle-style absolute cursor-move"
          style={{
            left: knee.x - 6,
            top: knee.y - 6,
          }}
          onMouseDown={(e) => handleHandleMouseDown(e, 'knee')}
        />
      )}

      {/* Arrow tip handle */}
      {isSelected && (
        <div
          className="handle-style absolute cursor-move"
          style={{
            left: arrowTip.x - 6,
            top: arrowTip.y - 6,
          }}
          onMouseDown={(e) => handleHandleMouseDown(e, 'arrowTip')}
        />
      )}
    </>
  );
};
