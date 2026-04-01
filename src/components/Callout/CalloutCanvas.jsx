import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import CalloutComponent from './CalloutComponent';
import { createCallout, hexToRgba } from './types';

/**
 * CalloutCanvas - Manages callout creation and drag interactions
 * Renders on top of the PDF page
 *
 * @param {Object} props
 * @param {Array} props.callouts - Array of callout objects for this page
 * @param {Function} props.setCallouts - Update callouts
 * @param {string|null} props.selectedCalloutId - Currently selected callout ID
 * @param {Function} props.setSelectedCalloutId - Set selected callout
 * @param {boolean} props.isCalloutToolActive - Whether callout tool is selected
 * @param {number} props.pageNumber - Current page number (1-indexed)
 * @param {number} props.pageWidth - Page width in pixels at current scale
 * @param {number} props.pageHeight - Page height in pixels at current scale
 * @param {Object} props.defaultStyle - Default style for new callouts
 */
const CalloutCanvas = ({
  callouts,
  setCallouts,
  selectedCalloutId,
  setSelectedCalloutId,
  isCalloutToolActive,
  activeTool,
  pageNumber,
  pageWidth,
  pageHeight,
  defaultStyle,
  selectedSpaceId,
  selectedModuleId,
  showSurveyPanel,
  clipboardCallout,
  clipboardCalloutType,
  onCutCallout,
  onCopyCallout,
  onPasteCallout,
}) => {
  const canvasRef = useRef(null);
  const [creationState, setCreationState] = useState({
    isCreating: false,
    arrowTip: null,
    currentMouse: null,
  });
  const [dragTarget, setDragTarget] = useState({ type: 'none' });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [newCalloutId, setNewCalloutId] = useState(null);
  const wholeMoveInitialPosRef = useRef(null);
  const wholeMoveInitialCalloutPosRef = useRef(null);
  const cornerResizeInitialStateRef = useRef(null);
  const justCreatedRef = useRef(false);
  const wasDraggingRef = useRef(false);
  const lastCreationTimeRef = useRef(0);

  // Convert pixel position to percentage of page
  const toPercent = useCallback((pixelPoint) => ({
    x: pixelPoint.x / pageWidth,
    y: pixelPoint.y / pageHeight,
  }), [pageWidth, pageHeight]);

  // Convert percentage to pixel position
  const toPixels = useCallback((percentPoint) => ({
    x: percentPoint.x * pageWidth,
    y: percentPoint.y * pageHeight,
  }), [pageWidth, pageHeight]);

  const getMousePosition = useCallback((e) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  // Filter callouts for this page and by survey mode if needed
  // Compute this early so it's available in callbacks
  const pageCallouts = useMemo(() => callouts.filter(c => 
    c.pageNumber === pageNumber &&
    (selectedSpaceId === null || c.spaceId === selectedSpaceId) &&
    (selectedModuleId === null || c.moduleId === selectedModuleId || !c.moduleId) && // If callout has no moduleId, it's always visible
    (!c.moduleId || (showSurveyPanel && selectedModuleId !== null && c.moduleId === selectedModuleId)) // Survey mode filtering
  ), [callouts, pageNumber, selectedSpaceId, selectedModuleId, showSurveyPanel]);

  // Helper function to calculate distance from a point to a line segment
  const distanceToLineSegment = useCallback((point, lineStart, lineEnd) => {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) {
      xx = lineStart.x;
      yy = lineStart.y;
    } else if (param > 1) {
      xx = lineEnd.x;
      yy = lineEnd.y;
    } else {
      xx = lineStart.x + param * C;
      yy = lineStart.y + param * D;
    }

    const dx = point.x - xx;
    const dy = point.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const handleMouseDown = useCallback((e) => {
    // Don't process clicks if they're on the edit modal or any modal overlay
    const target = e.target;
    if (target && (target.closest && (target.closest('[data-callout-edit-modal]') || target.closest('[data-callout-modal-overlay]')))) {
      return; // Ignore clicks on modal
    }
    
    const pos = getMousePosition(e);

    // If select or pan tool is active and a callout is selected, check if clicking on empty space
    if ((activeTool === 'select' || activeTool === 'pan') && selectedCalloutId) {
      
      // Check if click position is within any callout's bounds
      // Convert click position to percentage coordinates
      const clickPercent = toPercent(pos);
      let isClickOnAnyCallout = false;
      
      for (const callout of pageCallouts) {
        // Check if click is within text box bounds
        const textBoxLeft = callout.textBoxPosition.x;
        const textBoxTop = callout.textBoxPosition.y;
        const textBoxRight = textBoxLeft + callout.textBoxWidth;
        const textBoxBottom = textBoxTop + callout.textBoxHeight;
        
        if (clickPercent.x >= textBoxLeft && clickPercent.x <= textBoxRight &&
            clickPercent.y >= textBoxTop && clickPercent.y <= textBoxBottom) {
          isClickOnAnyCallout = true;
          break;
        }
        
        // Check if click is near arrow tip (within 20px radius)
        const arrowTipPixels = toPixels(callout.arrowTip);
        const distance = Math.sqrt(
          Math.pow(pos.x - arrowTipPixels.x, 2) + Math.pow(pos.y - arrowTipPixels.y, 2)
        );
        if (distance < 20) {
          isClickOnAnyCallout = true;
          break;
        }
        
        // Check if click is near knee (within 20px radius)
        const kneePixels = toPixels(callout.knee);
        const kneeDistance = Math.sqrt(
          Math.pow(pos.x - kneePixels.x, 2) + Math.pow(pos.y - kneePixels.y, 2)
        );
        if (kneeDistance < 20) {
          isClickOnAnyCallout = true;
          break;
        }
        
        // Check if click is near the line (within 10px of the line segments)
        // Line from text box center to knee to arrow tip
        const textBoxCenter = {
          x: textBoxLeft + callout.textBoxWidth / 2,
          y: textBoxTop + callout.textBoxHeight / 2
        };
        const textBoxCenterPixels = toPixels(textBoxCenter);
        
        // Distance to line segment from text center to knee
        const distToLine1 = distanceToLineSegment(pos, textBoxCenterPixels, kneePixels);
        // Distance to line segment from knee to arrow tip
        const distToLine2 = distanceToLineSegment(pos, kneePixels, arrowTipPixels);
        
        if (distToLine1 < 10 || distToLine2 < 10) {
          isClickOnAnyCallout = true;
          break;
        }
      }
      
      // If clicking on empty space (not within any callout bounds), deselect
      if (!isClickOnAnyCallout) {
        // Blur any active text inputs before deselecting
        if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')) {
          document.activeElement.blur();
        }
        setSelectedCalloutId(null);
        setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
        // Don't return - let the event continue to Fabric canvas for pan/select behavior
      }
    }

    // Only handle mouse events when callout tool is active
    // When other tools are active, individual callout components handle their own events via pointerEvents: 'auto'
    if (!isCalloutToolActive) {
      return; // Let events pass through to Fabric canvas
    }

    // If callout tool is active and clicking on empty space, start creation
    if (dragTarget.type === 'none') {
      console.log('[CalloutCanvas] mouseDown — starting creation at', pos, 'page:', pageNumber);
      setCreationState({
        isCreating: true,
        arrowTip: pos,
        currentMouse: pos,
      });
      setSelectedCalloutId(null);
    }
  }, [isCalloutToolActive, dragTarget, getMousePosition, setSelectedCalloutId, pageNumber, activeTool, selectedCalloutId, setCallouts, toPercent, toPixels, distanceToLineSegment, pageCallouts]);

  const handleMouseMove = useCallback((e) => {
    const pos = getMousePosition(e);

    // Handle creation preview
    if (creationState.isCreating) {
      setCreationState(prev => ({
        ...prev,
        currentMouse: pos,
      }));
      return;
    }

    // Handle dragging
    if (dragTarget.type !== 'none') {
      const isWholeMove = e.ctrlKey || e.metaKey;

      // Reset whole move refs when not doing whole movement
      if (!isWholeMove) {
        wholeMoveInitialPosRef.current = null;
        wholeMoveInitialCalloutPosRef.current = null;
      }

      setCallouts(prevCallouts => prevCallouts.map(callout => {
        if (callout.pageNumber !== pageNumber) return callout;

        if (dragTarget.type === 'whole' && dragTarget.calloutId === callout.id) {
          const refPos = wholeMoveInitialPosRef.current || dragOffset;
          const refCalloutPos = wholeMoveInitialCalloutPosRef.current;
          
          if (!refCalloutPos) {
            // Fallback if refs not initialized (shouldn't happen, but safety check)
            return callout;
          }
          
          const dx = (pos.x - refPos.x) / pageWidth;
          const dy = (pos.y - refPos.y) / pageHeight;
          return {
            ...callout,
            arrowTip: { x: refCalloutPos.arrowTip.x + dx, y: refCalloutPos.arrowTip.y + dy },
            knee: { x: refCalloutPos.knee.x + dx, y: refCalloutPos.knee.y + dy },
            textBoxPosition: { x: refCalloutPos.textBoxPosition.x + dx, y: refCalloutPos.textBoxPosition.y + dy },
          };
        }

        if (dragTarget.calloutId !== callout.id) return callout;

        if (isWholeMove && dragTarget.type !== 'whole') {
          // Convert to whole movement
          if (!wholeMoveInitialPosRef.current || !wholeMoveInitialCalloutPosRef.current) {
            wholeMoveInitialPosRef.current = pos;
            wholeMoveInitialCalloutPosRef.current = {
              arrowTip: { ...callout.arrowTip },
              knee: { ...callout.knee },
              textBoxPosition: { ...callout.textBoxPosition },
            };
          }
          const refPos = wholeMoveInitialPosRef.current;
          const refCalloutPos = wholeMoveInitialCalloutPosRef.current;
          const dx = (pos.x - refPos.x) / pageWidth;
          const dy = (pos.y - refPos.y) / pageHeight;
          return {
            ...callout,
            arrowTip: { x: refCalloutPos.arrowTip.x + dx, y: refCalloutPos.arrowTip.y + dy },
            knee: { x: refCalloutPos.knee.x + dx, y: refCalloutPos.knee.y + dy },
            textBoxPosition: { x: refCalloutPos.textBoxPosition.x + dx, y: refCalloutPos.textBoxPosition.y + dy },
          };
        }

        const posPercent = toPercent(pos);

        switch (dragTarget.type) {
          case 'arrowTip':
            return { ...callout, arrowTip: posPercent };
          case 'knee':
            return { ...callout, knee: posPercent };
          case 'textBox': {
            const offsetPercent = {
              x: dragOffset.x / pageWidth,
              y: dragOffset.y / pageHeight,
            };
            return {
              ...callout,
              textBoxPosition: {
                x: posPercent.x - offsetPercent.x,
                y: posPercent.y - offsetPercent.y,
              },
            };
          }
          case 'textBoxCorner': {
            const corner = dragTarget.corner;
            const initial = cornerResizeInitialStateRef.current;
            if (!initial) return callout;

            // Convert initial state from percentage to pixels for calculation
            const initialPixels = {
              x: initial.x * pageWidth,
              y: initial.y * pageHeight,
              width: initial.width * pageWidth,
              height: initial.height * pageHeight,
            };

            let newX = initialPixels.x;
            let newY = initialPixels.y;
            let newWidth = initialPixels.width;
            let newHeight = initialPixels.height;

            const minWidth = 80;
            const minHeight = 32;

            if (corner === 'nw') {
              const fixedRightX = initialPixels.x + initialPixels.width;
              const fixedBottomY = initialPixels.y + initialPixels.height;
              newWidth = Math.max(minWidth, fixedRightX - pos.x);
              newHeight = Math.max(minHeight, fixedBottomY - pos.y);
              newX = fixedRightX - newWidth;
              newY = fixedBottomY - newHeight;
            } else if (corner === 'ne') {
              const fixedBottomY = initialPixels.y + initialPixels.height;
              newWidth = Math.max(minWidth, pos.x - initialPixels.x);
              newHeight = Math.max(minHeight, fixedBottomY - pos.y);
              newX = initialPixels.x;
              newY = fixedBottomY - newHeight;
            } else if (corner === 'sw') {
              const fixedRightX = initialPixels.x + initialPixels.width;
              newWidth = Math.max(minWidth, fixedRightX - pos.x);
              newHeight = Math.max(minHeight, pos.y - initialPixels.y);
              newX = fixedRightX - newWidth;
              newY = initialPixels.y;
            } else if (corner === 'se') {
              newWidth = Math.max(minWidth, pos.x - initialPixels.x);
              newHeight = Math.max(minHeight, pos.y - initialPixels.y);
              newX = initialPixels.x;
              newY = initialPixels.y;
            }

            return {
              ...callout,
              textBoxPosition: { x: newX / pageWidth, y: newY / pageHeight },
              textBoxWidth: newWidth / pageWidth,
              textBoxHeight: newHeight / pageHeight,
            };
          }
          default:
            return callout;
        }
      }));
    }
  }, [creationState.isCreating, dragTarget, dragOffset, getMousePosition, setCallouts, toPercent, pageNumber, pageWidth, pageHeight]);

  const handleMouseUp = useCallback((e) => {
    const pos = getMousePosition(e);

    // Complete creation
    if (creationState.isCreating && creationState.arrowTip) {
      // Dedup guard: prevent double creation from rapid event firing
      const now = Date.now();
      const timeSinceLast = now - lastCreationTimeRef.current;
      console.log('[CalloutCanvas] mouseUp — creation attempt, timeSinceLast:', timeSinceLast, 'page:', pageNumber);
      if (timeSinceLast < 500) {
        console.log('[CalloutCanvas] mouseUp — BLOCKED by dedup guard (within 500ms)');
        setCreationState({ isCreating: false, arrowTip: null, currentMouse: null });
        return;
      }
      lastCreationTimeRef.current = now;

      const arrowTipPercent = toPercent(creationState.arrowTip);
      const textBoxPercent = toPercent(pos);

      // Default knee position: midpoint horizontally, offset above arrow tip
      const kneePercent = {
        x: (arrowTipPercent.x + textBoxPercent.x) / 2,
        y: arrowTipPercent.y - 40 / pageHeight, // 40px offset converted to percentage
      };

      // Default text box size: 120x32 pixels converted to percentage
      const textBoxWidthPercent = 120 / pageWidth;
      const textBoxHeightPercent = 32 / pageHeight;

      const newCallout = createCallout(
        pageNumber,
        arrowTipPercent,
        kneePercent,
        textBoxPercent,
        textBoxWidthPercent,
        textBoxHeightPercent
      );

      // Apply default style if provided
      if (defaultStyle) {
        newCallout.style = { ...newCallout.style, ...defaultStyle };
      }

      // Store spaceId/moduleId if provided (for survey mode filtering)
      if (selectedSpaceId) {
        newCallout.spaceId = selectedSpaceId;
      }
      if (selectedModuleId) {
        newCallout.moduleId = selectedModuleId;
      }

      console.log('[CalloutCanvas] mouseUp — CREATING callout', newCallout.id, 'total before:', 'unknown');
      setCallouts(prev => {
        console.log('[CalloutCanvas] setCallouts — prev count:', prev.length, '→ new count:', prev.length + 1);
        return [...prev.map(c => ({ ...c, isSelected: false })), newCallout];
      });
      setSelectedCalloutId(newCallout.id);
      setNewCalloutId(newCallout.id);
      justCreatedRef.current = true; // Prevent click handler from deselecting

      setCreationState({
        isCreating: false,
        arrowTip: null,
        currentMouse: null,
      });
      return;
    }

    // End drag
    wholeMoveInitialPosRef.current = null;
    wholeMoveInitialCalloutPosRef.current = null;
    cornerResizeInitialStateRef.current = null;
    setDragTarget({ type: 'none' });
  }, [creationState, getMousePosition, setCallouts, setSelectedCalloutId, toPercent, pageNumber, pageWidth, pageHeight, defaultStyle]);

  const handleCanvasClick = useCallback((e) => {
    const pos = getMousePosition(e);
    
    // Skip if we just created a callout (click fires after mouseup)
    if (justCreatedRef.current) {
      console.log('[CalloutCanvas] click — SKIPPED (justCreated guard)');
      justCreatedRef.current = false;
      return;
    }
    // Skip if we were just dragging (click fires after mouseup)
    if (wasDraggingRef.current) {
      console.log('[CalloutCanvas] click — SKIPPED (wasDragging guard)');
      wasDraggingRef.current = false;
      return;
    }
    console.log('[CalloutCanvas] click — processing, tool:', activeTool, 'selectedId:', selectedCalloutId);
    
    // If select or pan tool is active and a callout is selected, check if clicking on empty space
    if ((activeTool === 'select' || activeTool === 'pan') && selectedCalloutId) {
      // Check if click position is within any callout's bounds (same logic as handleMouseDown)
      const clickPercent = toPercent(pos);
      let isClickOnAnyCallout = false;
      
      for (const callout of pageCallouts) {
        const textBoxLeft = callout.textBoxPosition.x;
        const textBoxTop = callout.textBoxPosition.y;
        const textBoxRight = textBoxLeft + callout.textBoxWidth;
        const textBoxBottom = textBoxTop + callout.textBoxHeight;
        
        if (clickPercent.x >= textBoxLeft && clickPercent.x <= textBoxRight &&
            clickPercent.y >= textBoxTop && clickPercent.y <= textBoxBottom) {
          isClickOnAnyCallout = true;
          break;
        }
        
        const arrowTipPixels = toPixels(callout.arrowTip);
        const distance = Math.sqrt(
          Math.pow(pos.x - arrowTipPixels.x, 2) + Math.pow(pos.y - arrowTipPixels.y, 2)
        );
        if (distance < 20) {
          isClickOnAnyCallout = true;
          break;
        }
        
        const kneePixels = toPixels(callout.knee);
        const kneeDistance = Math.sqrt(
          Math.pow(pos.x - kneePixels.x, 2) + Math.pow(pos.y - kneePixels.y, 2)
        );
        if (kneeDistance < 20) {
          isClickOnAnyCallout = true;
          break;
        }
        
        const textBoxCenter = {
          x: textBoxLeft + callout.textBoxWidth / 2,
          y: textBoxTop + callout.textBoxHeight / 2
        };
        const textBoxCenterPixels = toPixels(textBoxCenter);
        const distToLine1 = distanceToLineSegment(pos, textBoxCenterPixels, kneePixels);
        const distToLine2 = distanceToLineSegment(pos, kneePixels, arrowTipPixels);
        
        if (distToLine1 < 10 || distToLine2 < 10) {
          isClickOnAnyCallout = true;
          break;
        }
      }
      
      // If clicking on empty space (not within any callout bounds), deselect
      if (!isClickOnAnyCallout) {
        // Blur any active text inputs before deselecting
        if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')) {
          document.activeElement.blur();
        }
        setSelectedCalloutId(null);
        setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
        return;
      }
    }
    
    // Deselect if clicking on empty space (not on a callout) - for callout tool
    if (e.target === canvasRef.current) {
      // Blur any active text inputs before deselecting
      if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')) {
        document.activeElement.blur();
      }
      setSelectedCalloutId(null);
      setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
    }
  }, [setSelectedCalloutId, setCallouts, activeTool, selectedCalloutId, getMousePosition, toPercent, toPixels, distanceToLineSegment, pageCallouts]);

  const startDrag = useCallback((target, offset) => {
    setDragTarget(target);
    setDragOffset(offset);
    wasDraggingRef.current = true;

    // Capture initial state for corner resize
    if (target.type === 'textBoxCorner' && target.calloutId) {
      const callout = callouts.find(c => c.id === target.calloutId);
      if (callout) {
        cornerResizeInitialStateRef.current = {
          x: callout.textBoxPosition.x,
          y: callout.textBoxPosition.y,
          width: callout.textBoxWidth,
          height: callout.textBoxHeight,
        };
      }
    }

    // Initialize whole move refs when starting a whole drag
    if (target.type === 'whole' && target.calloutId) {
      const callout = callouts.find(c => c.id === target.calloutId);
      if (callout) {
        wholeMoveInitialPosRef.current = offset;
        wholeMoveInitialCalloutPosRef.current = {
          arrowTip: { ...callout.arrowTip },
          knee: { ...callout.knee },
          textBoxPosition: { ...callout.textBoxPosition },
        };
      }
    }
  }, [callouts]);

  const selectCallout = useCallback((id) => {
    setSelectedCalloutId(id);
    setCallouts(prev => prev.map(c => ({ ...c, isSelected: c.id === id })));
  }, [setSelectedCalloutId, setCallouts]);

  const deselectCallout = useCallback(() => {
    setSelectedCalloutId(null);
    setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
  }, [setSelectedCalloutId, setCallouts]);

  const updateCallout = useCallback((id, updates) => {
    setCallouts(prev => prev.map(c => {
      if (c.id === id) {
        // If updates contain style properties, merge them into the style object
        const styleUpdates = {};
        const otherUpdates = {};
        
        // List of style properties
        const styleProps = [
          'borderColor', 'borderOpacity', 'fillColor', 'fillOpacity', 'lineThickness',
          'arrowheadStyle', 'fontFamily', 'fontSize', 'fontColor', 'textAlign',
          'bold', 'italic', 'underline', 'strikethrough'
        ];
        
        Object.keys(updates).forEach(key => {
          if (styleProps.includes(key)) {
            styleUpdates[key] = updates[key];
          } else {
            otherUpdates[key] = updates[key];
          }
        });
        
        // Merge style updates into existing style
        const updatedStyle = styleUpdates && Object.keys(styleUpdates).length > 0
          ? { ...c.style, ...styleUpdates }
          : c.style;
        
        return {
          ...c,
          ...otherUpdates,
          style: updatedStyle
        };
      }
      return c;
    }));
  }, [setCallouts]);

  const deleteCallout = useCallback((id) => {
    setCallouts(prev => prev.filter(c => c.id !== id));
    if (selectedCalloutId === id) {
      setSelectedCalloutId(null);
    }
  }, [setCallouts, selectedCalloutId, setSelectedCalloutId]);

  // Clear newCalloutId after focus
  useEffect(() => {
    if (newCalloutId) {
      const timer = setTimeout(() => setNewCalloutId(null), 100);
      return () => clearTimeout(timer);
    }
  }, [newCalloutId]);

  // Use document-level listeners for drag operations when not in callout tool mode
  // This allows dragging to work even when canvas has pointerEvents: 'none'
  useEffect(() => {
    const isDragging = dragTarget.type !== 'none';

    if (!isDragging || isCalloutToolActive) {
      return; // No need for document listeners if not dragging or callout tool is active
    }

    const handleDocumentMouseMove = (e) => {
      handleMouseMove(e);
    };

    const handleDocumentMouseUp = (e) => {
      handleMouseUp(e);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [dragTarget.type, isCalloutToolActive, handleMouseMove, handleMouseUp]);

  // Pointer events logic:
  // - When callout tool is active: 'auto' to enable callout creation on the canvas
  // - When pan/select tool is active AND a callout is selected: 'auto' to enable clicking off to deselect
  // - When other tools are active: 'none' to let clicks pass through to Fabric canvas
  // Individual CalloutComponent elements have their own pointerEvents based on shouldReceivePointerEvents
  const pointerEventsValue = isCalloutToolActive ||
    ((activeTool === 'pan' || activeTool === 'select') && selectedCalloutId)
    ? 'auto' : 'none';

  return (
    <div
      ref={canvasRef}
      data-callout-canvas="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        cursor: isCalloutToolActive ? 'crosshair' : 'default',
        pointerEvents: pointerEventsValue,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleCanvasClick}
    >
      {/* Creation preview line */}
      {creationState.isCreating && creationState.arrowTip && creationState.currentMouse && (
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <defs>
            <marker
              id="arrowhead-preview"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill="#1e293b"
                opacity={0.6}
              />
            </marker>
          </defs>
          <polyline
            points={`${creationState.currentMouse.x},${creationState.currentMouse.y} ${(creationState.arrowTip.x + creationState.currentMouse.x) / 2},${creationState.arrowTip.y - 40} ${creationState.arrowTip.x},${creationState.arrowTip.y}`}
            fill="none"
            stroke="#1e293b"
            strokeWidth={2}
            strokeDasharray="5,5"
            opacity={0.6}
            markerEnd="url(#arrowhead-preview)"
          />
        </svg>
      )}

      {/* Render callouts */}
      {pageCallouts.map(callout => (
        <CalloutComponent
          key={callout.id}
          callout={callout}
          isSelected={callout.id === selectedCalloutId}
          onSelect={() => selectCallout(callout.id)}
          onDeselect={deselectCallout}
          onStartDrag={startDrag}
          onUpdate={(updates) => updateCallout(callout.id, updates)}
          onDelete={() => deleteCallout(callout.id)}
          shouldFocus={callout.id === newCalloutId}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          activeTool={activeTool}
          isCalloutToolActive={isCalloutToolActive}
          clipboardCallout={clipboardCallout}
          clipboardCalloutType={clipboardCalloutType}
          onCutCallout={onCutCallout}
          onCopyCallout={onCopyCallout}
          onPasteCallout={onPasteCallout}
          pageNumber={pageNumber}
        />
      ))}
    </div>
  );
};

export default CalloutCanvas;
