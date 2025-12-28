import React, { useRef, useState, useCallback, useEffect } from 'react';
import CalloutComponent from './CalloutComponent';
import { createCallout, hexToRgba } from './types';

// Debug logging system - stores logs globally for easy access
if (!window.__CALLOUT_DEBUG_LOGS__) {
  window.__CALLOUT_DEBUG_LOGS__ = [];
}

const debugLog = (category, message, data = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    category,
    message,
    data
  };
  window.__CALLOUT_DEBUG_LOGS__.push(entry);
  // Keep only last 100 entries
  if (window.__CALLOUT_DEBUG_LOGS__.length > 100) {
    window.__CALLOUT_DEBUG_LOGS__.shift();
  }
  console.log(`[Callout ${category}]`, message, data);
};

// Expose helper to get logs
window.getCalloutLogs = () => {
  console.table(window.__CALLOUT_DEBUG_LOGS__);
  return window.__CALLOUT_DEBUG_LOGS__;
};

window.clearCalloutLogs = () => {
  window.__CALLOUT_DEBUG_LOGS__ = [];
  console.log('Callout logs cleared');
};

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
  selectionRect, // { left, top, right, bottom, isWindowSelection } for drag selection
}) => {
  const canvasRef = useRef(null);
  const calloutsContainerRef = useRef(null);
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

  const handleMouseDown = useCallback((e) => {
    // Only start callout creation when clicking directly on the canvas background
    // When clicking on existing callouts, their handlers will handle selection/dragging
    if (e.target !== canvasRef.current) {
      return;
    }

    const pos = getMousePosition(e);

    // If callout tool is active and clicking on empty space, start creation
    if (isCalloutToolActive && dragTarget.type === 'none') {
      setCreationState({
        isCreating: true,
        arrowTip: pos,
        currentMouse: pos,
      });
      setSelectedCalloutId(null);
    }
  }, [isCalloutToolActive, dragTarget, getMousePosition, setSelectedCalloutId]);

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
          const dx = (pos.x - refPos.x) / pageWidth;
          const dy = (pos.y - refPos.y) / pageHeight;
          return {
            ...callout,
            arrowTip: { x: callout.arrowTip.x + dx, y: callout.arrowTip.y + dy },
            knee: { x: callout.knee.x + dx, y: callout.knee.y + dy },
            textBoxPosition: { x: callout.textBoxPosition.x + dx, y: callout.textBoxPosition.y + dy },
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

      setCallouts(prev => [...prev.map(c => ({ ...c, isSelected: false })), newCallout]);
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
    // Skip if we just created a callout (click fires after mouseup)
    if (justCreatedRef.current) {
      justCreatedRef.current = false;
      return;
    }
    // Skip if we were just dragging (click fires after mouseup)
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    // Deselect if clicking on empty space (not on a callout)
    if (e.target === canvasRef.current) {
      setSelectedCalloutId(null);
      setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
    }
  }, [setSelectedCalloutId, setCallouts]);

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
  }, [callouts]);

  const selectCallout = useCallback((id) => {
    setSelectedCalloutId(id);
    setCallouts(prev => prev.map(c => ({ ...c, isSelected: c.id === id })));
  }, [setSelectedCalloutId, setCallouts]);

  const updateCallout = useCallback((id, updates) => {
    setCallouts(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
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

  // Handle clicking outside callouts to deselect (for select/pan tools)
  useEffect(() => {
    if (!selectedCalloutId) return;
    if (activeTool !== 'select' && activeTool !== 'pan' && activeTool !== 'callout') return;

    const handleDocumentClick = (e) => {
      // Don't deselect if clicking inside the callouts container on a callout element
      const calloutsContainer = calloutsContainerRef.current;
      if (!calloutsContainer) return;

      // Check if click is on any callout element (they have pointerEvents: auto)
      // We can check if the target or any ancestor is inside our callouts container
      // and has data attributes or specific classes
      const target = e.target;

      // If click is inside a callout element, don't deselect
      // Callout elements are inside calloutsContainer and have pointer events
      if (calloutsContainer.contains(target)) {
        // Check if the target is actually a callout element (not the container itself)
        if (target !== calloutsContainer) {
          return; // Click was on a callout, don't deselect
        }
      }

      // Click was outside callouts, deselect
      setSelectedCalloutId(null);
      setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
    };

    // Use capture phase to get the event before it bubbles
    document.addEventListener('mousedown', handleDocumentClick, true);
    return () => document.removeEventListener('mousedown', handleDocumentClick, true);
  }, [selectedCalloutId, activeTool, setSelectedCalloutId, setCallouts]);

  // Handle drag selection rectangle from PageAnnotationLayer
  useEffect(() => {
    if (!selectionRect) return;

    const { left, top, right, bottom, isWindowSelection } = selectionRect;

    debugLog('SELECTION', `Selection rect received - ${isWindowSelection ? 'WINDOW (L→R)' : 'CROSSING (R→L)'} - rect:[${left.toFixed(0)},${top.toFixed(0)} → ${right.toFixed(0)},${bottom.toFixed(0)}] page:${pageWidth}x${pageHeight}`, {});

    // Find callouts that match the selection criteria
    const pageCalloutsLocal = callouts.filter(c => c.pageNumber === pageNumber);

    debugLog('SELECTION', `Found ${pageCalloutsLocal.length} callouts on page ${pageNumber}`, {});

    const selectedIds = [];

    pageCalloutsLocal.forEach(callout => {
      // Get text box bounds in pixels (primary selection target)
      const textBoxLeft = callout.textBoxPosition.x * pageWidth;
      const textBoxTop = callout.textBoxPosition.y * pageHeight;
      const textBoxRight = textBoxLeft + (callout.textBoxWidth * pageWidth);
      const textBoxBottom = textBoxTop + (callout.textBoxHeight * pageHeight);

      // Also get arrow tip and knee positions for crossing selection
      const arrowX = callout.arrowTip.x * pageWidth;
      const arrowY = callout.arrowTip.y * pageHeight;
      const kneeX = callout.knee.x * pageWidth;
      const kneeY = callout.knee.y * pageHeight;

      // Full bounds including all parts (for crossing selection)
      const fullBoundsLeft = Math.min(textBoxLeft, arrowX, kneeX);
      const fullBoundsTop = Math.min(textBoxTop, arrowY, kneeY);
      const fullBoundsRight = Math.max(textBoxRight, arrowX, kneeX);
      const fullBoundsBottom = Math.max(textBoxBottom, arrowY, kneeY);

      debugLog('SELECTION', `Callout ${callout.id.slice(-8)} textBox:[${textBoxLeft.toFixed(0)},${textBoxTop.toFixed(0)} → ${textBoxRight.toFixed(0)},${textBoxBottom.toFixed(0)}]`, {});

      if (isWindowSelection) {
        // Window selection (L→R): Text box must be FULLY contained
        const checks = {
          leftCheck: textBoxLeft >= left,
          topCheck: textBoxTop >= top,
          rightCheck: textBoxRight <= right,
          bottomCheck: textBoxBottom <= bottom
        };
        const isTextBoxContained = checks.leftCheck && checks.topCheck && checks.rightCheck && checks.bottomCheck;

        debugLog('SELECTION', `WINDOW check ${callout.id.slice(-8)}: L:${textBoxLeft.toFixed(0)}>=${left.toFixed(0)}?${checks.leftCheck} T:${textBoxTop.toFixed(0)}>=${top.toFixed(0)}?${checks.topCheck} R:${textBoxRight.toFixed(0)}<=${right.toFixed(0)}?${checks.rightCheck} B:${textBoxBottom.toFixed(0)}<=${bottom.toFixed(0)}?${checks.bottomCheck} => ${isTextBoxContained}`, {});

        if (isTextBoxContained) {
          selectedIds.push(callout.id);
        }
      } else {
        // Crossing selection (R→L): Any part of callout needs to intersect
        const intersects = !(
          fullBoundsRight < left ||
          fullBoundsLeft > right ||
          fullBoundsBottom < top ||
          fullBoundsTop > bottom
        );

        debugLog('SELECTION', `CROSSING check ${callout.id.slice(-8)}: intersects=${intersects}`, {});

        if (intersects) {
          selectedIds.push(callout.id);
        }
      }
    });

    debugLog('SELECTION', `Result: ${selectedIds.length} selected out of ${pageCalloutsLocal.length}`, {});

    // Select the first matching callout (for now, single selection)
    // TODO: Support multi-selection if needed
    if (selectedIds.length > 0) {
      setSelectedCalloutId(selectedIds[0]);
      setCallouts(prev => prev.map(c => ({ ...c, isSelected: selectedIds.includes(c.id) })));
    }
  }, [selectionRect, callouts, pageNumber, pageWidth, pageHeight, setSelectedCalloutId, setCallouts]);

  // Filter callouts for this page
  const pageCallouts = callouts.filter(c => c.pageNumber === pageNumber);

  // Determine if callouts should be interactive based on active tool
  // - callout: Full interactivity (create, select, drag)
  // - select, pan: Can select and drag callouts
  // - eraser: Can click to delete callouts
  // - All other tools (pen, highlighter, etc.): No pointer events
  const interactiveTools = ['callout', 'select', 'pan', 'eraser'];
  const calloutsInteractive = interactiveTools.includes(activeTool);

  return (
    <>
      {/* Canvas for callout creation (only active when callout tool selected) */}
      <div
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          cursor: isCalloutToolActive ? 'crosshair' : 'default',
          pointerEvents: isCalloutToolActive ? 'auto' : 'none',
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
      </div>

      {/* Callouts container - separate from creation canvas for proper event handling */}
      <div
        ref={calloutsContainerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none', // Container passes through, children can capture
          zIndex: 10, // Ensure callouts are above the Fabric canvas
        }}
      >
        {pageCallouts.map(callout => (
          <CalloutComponent
            key={callout.id}
            callout={callout}
            isSelected={callout.id === selectedCalloutId}
            onSelect={() => selectCallout(callout.id)}
            onStartDrag={startDrag}
            onUpdate={(updates) => updateCallout(callout.id, updates)}
            onDelete={() => deleteCallout(callout.id)}
            shouldFocus={callout.id === newCalloutId}
            pageWidth={pageWidth}
            pageHeight={pageHeight}
            activeTool={activeTool}
            isInteractive={calloutsInteractive}
          />
        ))}
      </div>

      {/* DEBUG: Visual overlay showing calculated textbox bounds (red dashed rectangles) */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 9999,
        }}
      >
        {pageCallouts.map(callout => {
          const textBoxLeft = callout.textBoxPosition.x * pageWidth;
          const textBoxTop = callout.textBoxPosition.y * pageHeight;
          const textBoxW = callout.textBoxWidth * pageWidth;
          const textBoxH = callout.textBoxHeight * pageHeight;
          return (
            <rect
              key={`debug-${callout.id}`}
              x={textBoxLeft}
              y={textBoxTop}
              width={textBoxW}
              height={textBoxH}
              fill="none"
              stroke="red"
              strokeWidth={2}
              strokeDasharray="4,4"
              opacity={0.8}
            />
          );
        })}
      </svg>

    </>
  );
};

export default CalloutCanvas;
