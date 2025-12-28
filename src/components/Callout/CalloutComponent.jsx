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
  activeTool,
  isCalloutToolActive,
}) => {
  // Callouts are interactive (selectable/movable) when:
  // - Callout tool is active, OR
  // - Pan/selection tool is active ('pan' or 'select'), OR
  // - No specific draw tool is active
  // But NOT when eraser is active (eraser should delete, not select)
  const isInteractive = activeTool !== 'eraser' && (
    isCalloutToolActive ||
    activeTool === 'pan' ||
    activeTool === 'select' ||
    activeTool === 'text-select'
  );

  // Show resize handles (corners, knee, arrow tip) when:
  // - Callout tool is active AND callout is selected, OR
  // - Select tool is active AND callout is selected, OR
  // - Pan tool is active AND callout is selected
  const showResizeHandles = (isCalloutToolActive || activeTool === 'select' || activeTool === 'pan') && isSelected;
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

    // If eraser tool is active, delete the callout
    if (activeTool === 'eraser') {
      e.preventDefault();
      onDelete();
      return;
    }

    if (!isEditing) {
      e.preventDefault(); // Prevent text selection during drag
      hasDraggedRef.current = false;
      mouseDownPositionRef.current = { x: e.clientX, y: e.clientY };

      // Check if Control/Command is held to move the entire callout
      const isWholeMove = e.ctrlKey || e.metaKey;

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

      if (isWholeMove) {
        // For whole callout movement, use mouse position relative to the canvas
        const canvasElement = e.currentTarget.closest('[data-callout-canvas]');
        let offset;
        if (canvasElement) {
          const canvasRect = canvasElement.getBoundingClientRect();
          offset = {
            x: e.clientX - canvasRect.left,
            y: e.clientY - canvasRect.top,
          };
        } else {
          // Fallback: calculate using text box position and page dimensions
          // This should rarely happen, but provides a backup
          const rect = e.currentTarget.getBoundingClientRect();
          offset = {
            x: textBoxPosition.x + (e.clientX - rect.left),
            y: textBoxPosition.y + (e.clientY - rect.top),
          };
        }
        onStartDrag({ type: 'whole', calloutId: callout.id }, offset);
      } else {
        // For text box only movement, use offset relative to text box
        const rect = e.currentTarget.getBoundingClientRect();
        const offset = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
        onStartDrag({ type: 'textBox', calloutId: callout.id }, offset);
      }
    }
  }, [activeTool, callout.id, isEditing, isSelected, onDelete, onSelect, onStartDrag, textBoxPosition]);

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
    // This means: first click selects, second click enters edit mode
    if (wasSelectedBeforeClickRef.current && !didDrag) {
      setIsEditing(true);
      textareaRef.current?.focus();
    }
    // If not already selected, the callout was just selected by handleTextBoxMouseDown
    // Don't enter edit mode - just select (which is already done)
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
    
    // Check if Control/Command is held to move the entire callout
    const isWholeMove = e.ctrlKey || e.metaKey;
    
    onSelect();
    
    if (isWholeMove) {
      // For whole callout movement, use mouse position relative to the canvas
      // Try closest() first, then traverse manually if needed
      let canvasElement = e.currentTarget.closest && e.currentTarget.closest('[data-callout-canvas]');
      if (!canvasElement) {
        // Fallback: traverse up manually
        canvasElement = e.currentTarget;
        while (canvasElement && canvasElement !== document.body) {
          if (canvasElement.getAttribute && canvasElement.getAttribute('data-callout-canvas') === 'true') {
            break;
          }
          canvasElement = canvasElement.parentElement || canvasElement.parentNode;
        }
      }
      
      let offset;
      if (canvasElement && canvasElement !== document.body && canvasElement.getBoundingClientRect) {
        const canvasRect = canvasElement.getBoundingClientRect();
        offset = {
          x: e.clientX - canvasRect.left,
          y: e.clientY - canvasRect.top,
        };
      } else {
        // Fallback: use the handle position (arrowTip or knee) as offset
        const handlePos = targetType === 'arrowTip' ? arrowTip : knee;
        offset = {
          x: handlePos.x,
          y: handlePos.y,
        };
      }
      onStartDrag({ type: 'whole', calloutId: callout.id }, offset);
    } else {
      onStartDrag({ type: targetType, calloutId: callout.id }, { x: 0, y: 0 });
    }
  }, [callout.id, onSelect, onStartDrag, arrowTip, knee]);

  const handleLineMouseDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    // If eraser tool is active, delete the callout
    if (activeTool === 'eraser') {
      onDelete();
      return;
    }
    
    // Check if Control/Command is held to move the entire callout
    const isWholeMove = e.ctrlKey || e.metaKey;
    
    onSelect();
    
    if (isWholeMove) {
      // For whole callout movement, use mouse position relative to the canvas
      // SVG elements might not support closest(), so traverse up manually
      let canvasElement = e.currentTarget;
      while (canvasElement && canvasElement !== document.body) {
        if (canvasElement.getAttribute && canvasElement.getAttribute('data-callout-canvas') === 'true') {
          break;
        }
        canvasElement = canvasElement.parentElement || canvasElement.parentNode;
      }
      
      let offset;
      if (canvasElement && canvasElement !== document.body && canvasElement.getBoundingClientRect) {
        const canvasRect = canvasElement.getBoundingClientRect();
        offset = {
          x: e.clientX - canvasRect.left,
          y: e.clientY - canvasRect.top,
        };
      } else {
        // Fallback: use arrow tip position as offset
        offset = {
          x: arrowTip.x,
          y: arrowTip.y,
        };
      }
      onStartDrag({ type: 'whole', calloutId: callout.id }, offset);
    }
  }, [activeTool, callout.id, onDelete, onSelect, onStartDrag, arrowTip]);

  const handleLineClick = useCallback((e) => {
    e.stopPropagation();
    // If eraser tool, don't select (already handled in mouseDown)
    if (activeTool === 'eraser') {
      return;
    }
    onSelect();
  }, [activeTool, onSelect]);

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
  
  // Calculate line 2 hit area end point (stop before arrow tip to allow triangle clicks)
  // The hit area triangle is 30px wide (3x scale), so stop about 32px before the tip
  const line2HitAreaEnd = (() => {
    const dx = arrowTip.x - knee.x;
    const dy = arrowTip.y - knee.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 35) {
      // If line is very short, just use the tip
      return arrowTip;
    }
    // Stop 32px before the arrow tip (to clear the larger 3x triangle hit area)
    const stopDistance = 32;
    const ratio = (length - stopDistance) / length;
    return {
      x: knee.x + dx * ratio,
      y: knee.y + dy * ratio,
    };
  })();

  // Calculate arrow head triangle points
  // Create a triangle pointing from knee to arrow tip
  // scale parameter: 1 = original size (10x7), larger = bigger hit area
  const calculateArrowHeadPoints = (scale = 1) => {
    const dx = arrowTip.x - knee.x;
    const dy = arrowTip.y - knee.y;
    const angle = Math.atan2(dy, dx);

    // Base triangle dimensions: 10px wide, 7px tall (matching the marker)
    const width = 10 * scale;
    const height = 7 * scale;

    // Base triangle points (pointing right, with tip at origin)
    const basePoints = [
      { x: -width, y: -height / 2 },  // Left base point
      { x: 0, y: 0 },                  // Tip (at origin)
      { x: -width, y: height / 2 },    // Right base point
    ];

    // Rotate and translate to arrow tip position
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    return basePoints.map(point => ({
      x: arrowTip.x + (point.x * cos - point.y * sin),
      y: arrowTip.y + (point.x * sin + point.y * cos),
    }));
  };

  // Visible triangle (original size, matches the SVG marker)
  const arrowHeadPoints = calculateArrowHeadPoints(1);
  const arrowHeadPointsString = arrowHeadPoints.map(p => `${p.x},${p.y}`).join(' ');

  // Larger invisible hit area triangle (3x bigger for easier clicking)
  const arrowHeadHitAreaPoints = calculateArrowHeadPoints(3);
  const arrowHeadHitAreaPointsString = arrowHeadHitAreaPoints.map(p => `${p.x},${p.y}`).join(' ');
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CalloutComponent.jsx:470',message:'Arrow head points string',data:{pointsString:arrowHeadPointsString,isInteractive},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion

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
          pointerEvents: 'auto', // Always block events to prevent tools from passing through callouts
        }}
        ref={(el) => {
          if (el) {
            // #region agent log
            const svgStyle = window.getComputedStyle(el);
            fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CalloutComponent.jsx:495',message:'SVG element ref',data:{svgPointerEvents:svgStyle.pointerEvents,childrenCount:el.children.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
          }
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
          style={{ pointerEvents: 'stroke', cursor: isInteractive ? 'pointer' : 'default' }}
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
        {/* Stop before arrow tip to allow triangle polygon to be clickable */}
        <line
          x1={line2Start.x}
          y1={line2Start.y}
          x2={line2HitAreaEnd.x}
          y2={line2HitAreaEnd.y}
          stroke="transparent"
          strokeWidth={16}
          style={{ pointerEvents: 'stroke', cursor: isInteractive ? 'pointer' : 'default' }}
          onMouseDown={(e) => {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CalloutComponent.jsx:577',message:'Line 2 hit area mousedown',data:{clientX:e.clientX,clientY:e.clientY,line2StartX:line2Start.x,line2StartY:line2Start.y,line2HitAreaEndX:line2HitAreaEnd.x,line2HitAreaEndY:line2HitAreaEnd.y,arrowTipX:arrowTip.x,arrowTipY:arrowTip.y},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            handleLineMouseDown(e);
          }}
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

        {/* Invisible larger hit area triangle (3x size) for easier clicking */}
        <polygon
          points={arrowHeadHitAreaPointsString}
          fill="transparent"
          style={{ pointerEvents: 'auto', cursor: isInteractive ? 'pointer' : 'default' }}
          onMouseDown={handleLineMouseDown}
          onClick={handleLineClick}
        />

        {/* Visible arrow head triangle (original size) */}
        <polygon
          points={arrowHeadPointsString}
          fill={hexToRgba(style.borderColor, style.borderOpacity)}
          style={{ pointerEvents: 'none' }}
        />

        {/* Hit area for knee - invisible circle for easier clicking */}
        <circle
          cx={knee.x}
          cy={knee.y}
          r={12}
          fill="transparent"
          style={{ pointerEvents: 'auto', cursor: isInteractive ? 'pointer' : 'default' }}
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
          cursor: isInteractive ? (isEditing ? 'text' : 'move') : 'default',
          pointerEvents: 'auto', // Always block events to prevent tools from passing through, even when not interactive
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
        {showResizeHandles && (
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
      {showResizeHandles && (
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
      {showResizeHandles && (
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
