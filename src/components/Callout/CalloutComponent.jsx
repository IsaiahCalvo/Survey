import React, { useRef, useEffect, useCallback, useState } from 'react';
import { hexToRgba, ARROWHEAD_STYLES, defaultCalloutStyle } from './types';
import CalloutContextMenu from './CalloutContextMenu';
import CalloutEditModal from './CalloutEditModal';

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
  onDeselect,
  onStartDrag,
  onUpdate,
  onDelete,
  shouldFocus,
  pageWidth,
  pageHeight,
  activeTool,
  isCalloutToolActive,
  clipboardCallout,
  clipboardCalloutType,
  onCutCallout,
  onCopyCallout,
  onPasteCallout,
  pageNumber,
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

  // Callout elements should receive pointer events when:
  // - Callout tool is active (for editing)
  // - Pan/selection tool is active (for selecting)
  // - Eraser tool is active (for deleting)
  // But NOT when other drawing tools are active (pen, rect, etc.) - let clicks pass through to Fabric canvas
  const shouldReceivePointerEvents =
    isCalloutToolActive ||
    activeTool === 'pan' ||
    activeTool === 'select' ||
    activeTool === 'text-select' ||
    activeTool === 'eraser';

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
  const [contextMenu, setContextMenu] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editModalAnchor, setEditModalAnchor] = useState(null);
  const longPressTimerRef = useRef(null);
  const touchStartPositionRef = useRef(null);

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
      // Close context menu when callout is deselected
      setContextMenu(null);
      // Blur the textarea if it's focused
      if (textareaRef.current && document.activeElement === textareaRef.current) {
        textareaRef.current.blur();
      }
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
      const isModifierKey = e.ctrlKey || e.metaKey; // Ctrl on Windows/Linux, Cmd on Mac
      const isWholeMove = isModifierKey;

      // Capture DOM references before creating closure
      const targetElement = e.currentTarget;
      const canvasElement = targetElement.closest('[data-callout-canvas]');

      const handleMouseMove = (moveEvent) => {
        if (mouseDownPositionRef.current && !hasDraggedRef.current) {
          const dx = Math.abs(moveEvent.clientX - mouseDownPositionRef.current.x);
          const dy = Math.abs(moveEvent.clientY - mouseDownPositionRef.current.y);
          if (dx > 5 || dy > 5) {
            hasDraggedRef.current = true;
            // If Control/Command key is held and we've started dragging, start the drag operation
            if (isModifierKey && isInteractive) {
              // For whole callout movement, use mouse position relative to the canvas
              let offset;
              if (canvasElement) {
                const canvasRect = canvasElement.getBoundingClientRect();
                offset = {
                  x: mouseDownPositionRef.current.x - canvasRect.left,
                  y: mouseDownPositionRef.current.y - canvasRect.top,
                };
              } else {
                // Fallback: calculate using text box position and page dimensions
                const rect = targetElement.getBoundingClientRect();
                offset = {
                  x: textBoxPosition.x + (mouseDownPositionRef.current.x - rect.left),
                  y: textBoxPosition.y + (mouseDownPositionRef.current.y - rect.top),
                };
              }
              onStartDrag({ type: 'whole', calloutId: callout.id }, offset);
            }
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

      const handleMouseUp = (upEvent) => {
        // Check if mouse moved significantly (even if hasDragged wasn't set yet)
        let mouseMoved = false;
        if (mouseDownPositionRef.current && upEvent) {
          const dx = Math.abs(upEvent.clientX - mouseDownPositionRef.current.x);
          const dy = Math.abs(upEvent.clientY - mouseDownPositionRef.current.y);
          const distance = Math.sqrt(dx * dx + dy * dy);
          mouseMoved = distance > 5;
        }
        
        // If Control/Command key was held and no drag occurred AND mouse didn't move, show context menu
        // Don't show if mouse moved (even if hasDragged wasn't set) - this was a drag operation
        if (isModifierKey && isInteractive && !hasDraggedRef.current && !mouseMoved) {
          setContextMenu({
            visible: true,
            x: mouseDownPositionRef.current.x,
            y: mouseDownPositionRef.current.y,
          });
        }

        if (mouseMoveHandlerRef.current) {
          document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
          mouseMoveHandlerRef.current = null;
        }
        if (mouseUpHandlerRef.current) {
          document.removeEventListener('mouseup', mouseUpHandlerRef.current);
          mouseUpHandlerRef.current = null;
        }
      };

      mouseUpHandlerRef.current = (upEvent) => handleMouseUp(upEvent);
      document.addEventListener('mouseup', mouseUpHandlerRef.current);

      isInClickSequenceRef.current = true;
      wasSelectedBeforeClickRef.current = isSelected;
      onSelect();

      // Only start drag immediately if Control/Command is NOT held (normal drag)
      // If Control/Command is held, wait to see if it's a drag or click
      if (isWholeMove) {
        // Don't start drag immediately - wait to see if mouse moves
        // If mouse moves, handleMouseMove will start the drag
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
  }, [activeTool, callout.id, isEditing, isSelected, isInteractive, onDelete, onSelect, onStartDrag, textBoxPosition]);

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
    
    const isModifierKey = e.ctrlKey || e.metaKey; // Ctrl on Windows/Linux, Cmd on Mac
    const isWholeMove = isModifierKey;
    
    // Track mouse position and drag state
    hasDraggedRef.current = false;
    mouseDownPositionRef.current = { x: e.clientX, y: e.clientY };
    
    // Capture DOM references before creating closure
    const targetElement = e.currentTarget;
    let canvasElement = targetElement.closest && targetElement.closest('[data-callout-canvas]');
    if (!canvasElement) {
      // Fallback: traverse up manually
      canvasElement = targetElement;
      while (canvasElement && canvasElement !== document.body) {
        if (canvasElement.getAttribute && canvasElement.getAttribute('data-callout-canvas') === 'true') {
          break;
        }
        canvasElement = canvasElement.parentElement || canvasElement.parentNode;
      }
    }
    
    onSelect();
    
    const handleMouseMove = (moveEvent) => {
      if (mouseDownPositionRef.current && !hasDraggedRef.current) {
        const dx = Math.abs(moveEvent.clientX - mouseDownPositionRef.current.x);
        const dy = Math.abs(moveEvent.clientY - mouseDownPositionRef.current.y);
        if (dx > 5 || dy > 5) {
          hasDraggedRef.current = true;
          // If Control/Command key is held and we've started dragging, start the drag operation
          if (isModifierKey && isInteractive) {
            // For whole callout movement, use mouse position relative to the canvas
            let offset;
            if (canvasElement && canvasElement !== document.body && canvasElement.getBoundingClientRect) {
              const canvasRect = canvasElement.getBoundingClientRect();
              offset = {
                x: mouseDownPositionRef.current.x - canvasRect.left,
                y: mouseDownPositionRef.current.y - canvasRect.top,
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
          }
        }
      }
    };

    const handleMouseUp = () => {
      // If Control/Command key was held and no drag occurred, show context menu
      if (isModifierKey && isInteractive && !hasDraggedRef.current) {
        setContextMenu({
          visible: true,
          x: mouseDownPositionRef.current.x,
          y: mouseDownPositionRef.current.y,
        });
      }

      if (mouseMoveHandlerRef.current) {
        document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
        mouseMoveHandlerRef.current = null;
      }
      if (mouseUpHandlerRef.current) {
        document.removeEventListener('mouseup', mouseUpHandlerRef.current);
        mouseUpHandlerRef.current = null;
      }
    };

    // Set up mouse move and up handlers
    if (mouseMoveHandlerRef.current) {
      document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
    }
    if (mouseUpHandlerRef.current) {
      document.removeEventListener('mouseup', mouseUpHandlerRef.current);
    }

    mouseMoveHandlerRef.current = handleMouseMove;
    document.addEventListener('mousemove', handleMouseMove);

    mouseUpHandlerRef.current = handleMouseUp;
    document.addEventListener('mouseup', handleMouseUp);
    
    // Only start drag immediately if Command is NOT held (normal drag)
    // If Command is held, wait to see if it's a drag or click
    if (isWholeMove) {
      // Don't start drag immediately - wait to see if mouse moves
      // If mouse moves, handleMouseMove will start the drag
    } else {
      onStartDrag({ type: targetType, calloutId: callout.id }, { x: 0, y: 0 });
    }
  }, [callout.id, isInteractive, onSelect, onStartDrag, arrowTip, knee]);

  const handleLineMouseDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    
    // If eraser tool is active, delete the callout
    if (activeTool === 'eraser') {
      onDelete();
      return;
    }
    
    const isModifierKey = e.ctrlKey || e.metaKey; // Ctrl on Windows/Linux, Cmd on Mac
    const isWholeMove = isModifierKey;
    
    // Track mouse position and drag state
    hasDraggedRef.current = false;
    mouseDownPositionRef.current = { x: e.clientX, y: e.clientY };
    
    // Capture DOM references before creating closure
    // SVG elements might not support closest(), so traverse up manually
    let canvasElement = e.currentTarget;
    while (canvasElement && canvasElement !== document.body) {
      if (canvasElement.getAttribute && canvasElement.getAttribute('data-callout-canvas') === 'true') {
        break;
      }
      canvasElement = canvasElement.parentElement || canvasElement.parentNode;
    }
    
    onSelect();
    
    const handleMouseMove = (moveEvent) => {
      if (mouseDownPositionRef.current && !hasDraggedRef.current) {
        const dx = Math.abs(moveEvent.clientX - mouseDownPositionRef.current.x);
        const dy = Math.abs(moveEvent.clientY - mouseDownPositionRef.current.y);
        if (dx > 5 || dy > 5) {
          hasDraggedRef.current = true;
          // If Control/Command key is held and we've started dragging, start the drag operation
          if (isModifierKey && isInteractive) {
            // For whole callout movement, use mouse position relative to the canvas
            let offset;
            if (canvasElement && canvasElement !== document.body && canvasElement.getBoundingClientRect) {
              const canvasRect = canvasElement.getBoundingClientRect();
              offset = {
                x: mouseDownPositionRef.current.x - canvasRect.left,
                y: mouseDownPositionRef.current.y - canvasRect.top,
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
        }
      }
    };

    const handleMouseUp = () => {
      // If Control/Command key was held and no drag occurred, show context menu
      if (isModifierKey && isInteractive && !hasDraggedRef.current) {
        setContextMenu({
          visible: true,
          x: mouseDownPositionRef.current.x,
          y: mouseDownPositionRef.current.y,
        });
      }

      if (mouseMoveHandlerRef.current) {
        document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
        mouseMoveHandlerRef.current = null;
      }
      if (mouseUpHandlerRef.current) {
        document.removeEventListener('mouseup', mouseUpHandlerRef.current);
        mouseUpHandlerRef.current = null;
      }
    };

    // Set up mouse move and up handlers
    if (mouseMoveHandlerRef.current) {
      document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
    }
    if (mouseUpHandlerRef.current) {
      document.removeEventListener('mouseup', mouseUpHandlerRef.current);
    }

    mouseMoveHandlerRef.current = handleMouseMove;
    document.addEventListener('mousemove', handleMouseMove);

    mouseUpHandlerRef.current = handleMouseUp;
    document.addEventListener('mouseup', handleMouseUp);
    
    // Only start drag immediately if Control/Command is NOT held (normal drag)
    // If Control/Command is held, wait to see if it's a drag or click
    if (isWholeMove) {
      // Don't start drag immediately - wait to see if mouse moves
      // If mouse moves, handleMouseMove will start the drag
    }
  }, [activeTool, callout.id, isInteractive, onDelete, onSelect, onStartDrag, arrowTip]);

  const handleLineClick = useCallback((e) => {
    e.stopPropagation();
    // If eraser tool, don't select (already handled in mouseDown)
    if (activeTool === 'eraser') {
      return;
    }
    onSelect();
  }, [activeTool, onSelect]);

  // Right-click handler
  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const isModifierKey = e.ctrlKey || e.metaKey;
    
    // Only show context menu when callout is interactive
    if (!isInteractive) return;
    
    // Don't show context menu if a drag operation has occurred or is in progress
    // This prevents the context menu from appearing during Control/Command+Drag operations
    if (hasDraggedRef.current) {
      return;
    }
    
    // If Control/Command is held AND there's a mousedown position, this is likely a drag operation
    // Block the context menu to prevent it from showing during Control/Command+Drag
    if (isModifierKey && mouseDownPositionRef.current) {
      const dx = Math.abs(e.clientX - mouseDownPositionRef.current.x);
      const dy = Math.abs(e.clientY - mouseDownPositionRef.current.y);
      const distance = Math.sqrt(dx * dx + dy * dy);
      // If mouse has moved more than 5px, treat it as a drag and don't show context menu
      if (distance > 5) {
        return;
      }
      // Even if distance is small, if Control/Command is held and mousedown exists, 
      // this might be the start of a drag - block context menu to be safe
      return;
    }
    
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
  }, [isInteractive]);

  // Long-press handler for mobile
  const handleTouchStart = useCallback((e) => {
    if (!isInteractive) return;
    
    const touch = e.touches[0];
    const startX = touch.clientX;
    const startY = touch.clientY;
    
    // Store start position to detect movement
    touchStartPositionRef.current = { x: startX, y: startY };
    
    // Start long press timer
    longPressTimerRef.current = setTimeout(() => {
      // Only trigger if timer wasn't cancelled (no movement detected)
      if (longPressTimerRef.current) {
        setContextMenu({
          visible: true,
          x: touch.clientX,
          y: touch.clientY,
        });
        // Prevent native context menu AFTER showing ours
        e.preventDefault();
      }
    }, 500);
  }, [isInteractive]);

  const handleTouchMove = useCallback((e) => {
    // Cancel long press if user moves finger (allows scrolling/text selection)
    if (longPressTimerRef.current) {
      const touch = e.touches[0];
      const currentX = touch.clientX;
      const currentY = touch.clientY;
      const startPos = touchStartPositionRef.current;
      
      if (startPos) {
        // Calculate movement distance
        const moveDistance = Math.sqrt(
          Math.pow(currentX - startPos.x, 2) + 
          Math.pow(currentY - startPos.y, 2)
        );
        
        // If moved more than 5px, cancel the timer (allow normal behavior)
        if (moveDistance > 5) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          touchStartPositionRef.current = null;
        }
      }
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    // Cancel timer if touch ends before 500ms
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPositionRef.current = null;
  }, []);

  // Context menu action handlers
  const handleCut = useCallback(() => {
    if (onCutCallout) {
      onCutCallout(callout.id);
    }
    setContextMenu(null);
  }, [callout.id, onCutCallout]);

  const handleCopy = useCallback(() => {
    if (onCopyCallout) {
      onCopyCallout(callout.id);
    }
    setContextMenu(null);
  }, [callout.id, onCopyCallout]);

  const handlePaste = useCallback(() => {
    if (onPasteCallout) {
      // Paste at text box position with offset
      // The handler will apply the offset
      onPasteCallout(pageNumber, callout.textBoxPosition);
    }
    setContextMenu(null);
  }, [callout.textBoxPosition, onPasteCallout, pageNumber]);

  const handleDelete = useCallback(() => {
    onDelete();
    setContextMenu(null);
  }, [onDelete]);

  const handleEdit = useCallback(() => {
    // Calculate anchor position when opening modal
    let anchor = null;
    if (textareaRef.current) {
      const textBoxRect = textareaRef.current.getBoundingClientRect();
      if (textBoxRect) {
        anchor = {
          x: textBoxRect.right + 20,
          y: textBoxRect.top,
        };
      }
    }
    // Fallback to center if textarea not available
    if (!anchor) {
      anchor = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      };
    }
    setEditModalAnchor(anchor);
    setShowEditModal(true);
    setContextMenu(null);
  }, []);

  // Close edit modal when callout is deleted
  useEffect(() => {
    if (!isSelected && showEditModal) {
      setShowEditModal(false);
    }
  }, [isSelected, showEditModal]);


  // Merge callout style with defaults to ensure all properties exist
  const style = { ...defaultCalloutStyle, ...callout.style };

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

  // Connector geometry: textbox border → knee → arrow base
  // We use a single continuous SVG path with stroke-linejoin for smooth corners at the knee
  const connectorStart = lineEndPoint;
  const connectorKnee = knee;

  // Arrow dimensions scale with line thickness for proper proportions
  // Arrow width is 3x the line thickness, height is 2x
  const arrowWidth = style.lineThickness * 3;
  const arrowHeight = style.lineThickness * 2;

  // Calculate arrow base point (where the stroke should end, not at the tip)
  // to prevent the stroke from bleeding through the arrowhead
  const arrowBasePoint = (() => {
    const dx = arrowTip.x - knee.x;
    const dy = arrowTip.y - knee.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) return arrowTip;

    // End the stroke at the arrow base (arrowWidth back from tip)
    const ratio = Math.max(0, (length - arrowWidth) / length);
    return {
      x: knee.x + dx * ratio,
      y: knee.y + dy * ratio,
    };
  })();

  // Build the SVG path: M (move to start) L (line to knee) L (line to arrow base)
  const connectorPathD = `M ${connectorStart.x} ${connectorStart.y} L ${connectorKnee.x} ${connectorKnee.y} L ${arrowBasePoint.x} ${arrowBasePoint.y}`;

  // Calculate hit area path end point (stop before arrow tip to allow triangle clicks)
  // The hit area triangle is 3x the arrow size, plus account for stroke width
  const hitAreaEndPoint = (() => {
    const dx = arrowTip.x - knee.x;
    const dy = arrowTip.y - knee.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    // Stop distance = hit area arrow width (3x) + some margin
    const stopDistance = arrowWidth * 3 + 10;
    if (length < stopDistance + 20) {
      return arrowBasePoint; // Use arrow base for short lines
    }
    const ratio = (length - stopDistance) / length;
    return {
      x: knee.x + dx * ratio,
      y: knee.y + dy * ratio,
    };
  })();

  // Hit area path for click detection (single continuous path)
  const hitAreaPathD = `M ${connectorStart.x} ${connectorStart.y} L ${connectorKnee.x} ${connectorKnee.y} L ${hitAreaEndPoint.x} ${hitAreaEndPoint.y}`;

  // Calculate arrow head triangle points
  // Create a triangle pointing from knee to arrow tip
  // scale parameter: 1 = visible arrow, larger = bigger hit area
  const calculateArrowHeadPoints = (scale = 1) => {
    const dx = arrowTip.x - knee.x;
    const dy = arrowTip.y - knee.y;
    const angle = Math.atan2(dy, dx);

    // Arrow dimensions scale with line thickness (already calculated above)
    const width = arrowWidth * scale;
    const height = arrowHeight * scale;

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

  // Visible triangle (scaled to line thickness)
  const arrowHeadPoints = calculateArrowHeadPoints(1);
  const arrowHeadPointsString = arrowHeadPoints.map(p => `${p.x},${p.y}`).join(' ');

  // Larger invisible hit area triangle (3x bigger for easier clicking)
  const arrowHeadHitAreaPoints = calculateArrowHeadPoints(3);
  const arrowHeadHitAreaPointsString = arrowHeadHitAreaPoints.map(p => `${p.x},${p.y}`).join(' ');

  // Get current arrowhead style (default to solid triangle for backwards compatibility)
  const currentArrowheadStyle = style.arrowheadStyle || ARROWHEAD_STYLES.SOLID_TRIANGLE;

  // Calculate additional arrowhead geometry for different styles
  const dx = arrowTip.x - knee.x;
  const dy = arrowTip.y - knee.y;
  const arrowAngle = Math.atan2(dy, dx);

  // Render the appropriate arrowhead based on style
  const renderArrowhead = () => {
    const color = hexToRgba(style.borderColor, style.borderOpacity);
    const strokeW = Math.max(2, style.lineThickness);

    switch (currentArrowheadStyle) {
      case ARROWHEAD_STYLES.NONE:
        return null;

      case ARROWHEAD_STYLES.SOLID_TRIANGLE:
        return (
          <polygon
            points={arrowHeadPointsString}
            fill={color}
            stroke={color}
            strokeWidth={1}
            style={{ pointerEvents: shouldReceivePointerEvents ? 'auto' : 'none', cursor: isInteractive ? 'pointer' : 'default' }}
            onMouseDown={handleLineMouseDown}
            onClick={handleLineClick}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          />
        );

      case ARROWHEAD_STYLES.V_SHAPE: {
        // V-shape: two lines forming a V
        const armLength = arrowWidth;
        const armAngle = Math.PI / 6; // 30 degrees spread
        const arm1X = arrowTip.x - armLength * Math.cos(arrowAngle - armAngle);
        const arm1Y = arrowTip.y - armLength * Math.sin(arrowAngle - armAngle);
        const arm2X = arrowTip.x - armLength * Math.cos(arrowAngle + armAngle);
        const arm2Y = arrowTip.y - armLength * Math.sin(arrowAngle + armAngle);
        const vShapePoints = `${arm1X},${arm1Y} ${arrowTip.x},${arrowTip.y} ${arm2X},${arm2Y}`;
        return (
          <polyline
            points={vShapePoints}
            fill="none"
            stroke={color}
            strokeWidth={strokeW}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: shouldReceivePointerEvents ? 'auto' : 'none', cursor: isInteractive ? 'pointer' : 'default' }}
            onMouseDown={handleLineMouseDown}
            onClick={handleLineClick}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          />
        );
      }

      case ARROWHEAD_STYLES.OPEN_CIRCLE: {
        const radius = arrowWidth / 2;
        return (
          <circle
            cx={arrowTip.x}
            cy={arrowTip.y}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeW}
            style={{ pointerEvents: shouldReceivePointerEvents ? 'auto' : 'none', cursor: isInteractive ? 'pointer' : 'default' }}
            onMouseDown={handleLineMouseDown}
            onClick={handleLineClick}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          />
        );
      }

      case ARROWHEAD_STYLES.OPEN_TRIANGLE:
        return (
          <polygon
            points={arrowHeadPointsString}
            fill="none"
            stroke={color}
            strokeWidth={strokeW}
            strokeLinejoin="round"
            style={{ pointerEvents: shouldReceivePointerEvents ? 'auto' : 'none', cursor: isInteractive ? 'pointer' : 'default' }}
            onMouseDown={handleLineMouseDown}
            onClick={handleLineClick}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          />
        );

      case ARROWHEAD_STYLES.HORIZONTAL_LINE: {
        // Perpendicular line at the end of the arrow
        const halfLength = arrowWidth / 2;
        const perpAngle = arrowAngle + Math.PI / 2;
        const lineX1 = arrowTip.x + halfLength * Math.cos(perpAngle);
        const lineY1 = arrowTip.y + halfLength * Math.sin(perpAngle);
        const lineX2 = arrowTip.x - halfLength * Math.cos(perpAngle);
        const lineY2 = arrowTip.y - halfLength * Math.sin(perpAngle);
        return (
          <line
            x1={lineX1}
            y1={lineY1}
            x2={lineX2}
            y2={lineY2}
            stroke={color}
            strokeWidth={strokeW}
            strokeLinecap="round"
            style={{ pointerEvents: shouldReceivePointerEvents ? 'auto' : 'none', cursor: isInteractive ? 'pointer' : 'default' }}
            onMouseDown={handleLineMouseDown}
            onClick={handleLineClick}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          />
        );
      }

      default:
        // Default to solid triangle
        return (
          <polygon
            points={arrowHeadPointsString}
            fill={color}
            stroke={color}
            strokeWidth={1}
            style={{ pointerEvents: shouldReceivePointerEvents ? 'auto' : 'none', cursor: isInteractive ? 'pointer' : 'default' }}
            onMouseDown={handleLineMouseDown}
            onClick={handleLineClick}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          />
        );
    }
  };

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
          pointerEvents: 'none', // SVG container doesn't block - individual elements handle their own events
        }}
      >
        {/* Hit area for connector path - invisible wider stroke for easier clicking */}
        <path
          d={hitAreaPathD}
          stroke="transparent"
          strokeWidth={16}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
          style={{ pointerEvents: shouldReceivePointerEvents ? 'stroke' : 'none', cursor: isInteractive ? 'pointer' : 'default' }}
          onMouseDown={handleLineMouseDown}
          onClick={handleLineClick}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
        />

        {/* Connector path: Textbox border → Knee → Arrow base */}
        {/* Single continuous path with stroke-linejoin for smooth corners at the knee */}
        <path
          d={connectorPathD}
          stroke={hexToRgba(style.borderColor, style.borderOpacity)}
          strokeWidth={style.lineThickness}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
          style={{ pointerEvents: 'none' }}
        />

        {/* Invisible larger hit area for arrowhead (for easier clicking) */}
        {/* Only show if arrowhead style is not NONE */}
        {currentArrowheadStyle !== ARROWHEAD_STYLES.NONE && (
          <polygon
            points={arrowHeadHitAreaPointsString}
            fill="transparent"
            style={{ pointerEvents: shouldReceivePointerEvents ? 'auto' : 'none', cursor: isInteractive ? 'pointer' : 'default' }}
            onMouseDown={handleLineMouseDown}
            onClick={handleLineClick}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          />
        )}

        {/* Visible arrowhead - style-dependent rendering */}
        {renderArrowhead()}

        {/* Hit area for knee - invisible circle for easier clicking */}
        <circle
          cx={knee.x}
          cy={knee.y}
          r={12}
          fill="transparent"
          style={{ pointerEvents: shouldReceivePointerEvents ? 'auto' : 'none', cursor: isInteractive ? 'pointer' : 'default' }}
          onMouseDown={handleLineMouseDown}
          onClick={handleLineClick}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
        />
      </svg>


      {/* Text box */}
      <div
        style={{
          position: 'absolute',
          left: textBoxPosition.x,
          top: textBoxPosition.y,
          cursor: isInteractive ? (isEditing ? 'text' : 'move') : 'default',
          pointerEvents: shouldReceivePointerEvents ? 'auto' : 'none', // Only block events when callout/selection/eraser tools are active
        }}
        onMouseDown={handleTextBoxMouseDown}
        onMouseUp={handleTextBoxMouseUp}
        onClick={handleTextBoxClick}
        onDoubleClick={handleTextBoxDoubleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
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
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
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
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
        />
      )}

      {/* Context Menu */}
      <CalloutContextMenu
        visible={contextMenu?.visible || false}
        x={contextMenu?.x || 0}
        y={contextMenu?.y || 0}
        onClose={() => {
          setContextMenu(null);
        }}
        onDeselect={onDeselect}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onDelete={handleDelete}
        onEdit={handleEdit}
        hasClipboard={!!clipboardCallout}
      />

      {/* Edit Modal */}
      <CalloutEditModal
        visible={showEditModal}
        callout={callout}
        onUpdate={onUpdate}
        onClose={() => {
          setShowEditModal(false);
          setEditModalAnchor(null);
        }}
        anchorPosition={editModalAnchor}
      />
    </>
  );
};

export default CalloutComponent;
