import React, { useRef, useState, useCallback, useEffect } from 'react';
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
    const pos = getMousePosition(e);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CalloutCanvas.jsx:67',message:'CalloutCanvas handleMouseDown called',data:{isCalloutToolActive,dragTargetType:dragTarget.type,pageNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    // Only handle mouse events when callout tool is active
    // When other tools are active, individual callout components handle their own events via pointerEvents: 'auto'
    if (!isCalloutToolActive) {
      return; // Let events pass through to Fabric canvas
    }

    // If callout tool is active and clicking on empty space, start creation
    if (dragTarget.type === 'none') {
      setCreationState({
        isCreating: true,
        arrowTip: pos,
        currentMouse: pos,
      });
      setSelectedCalloutId(null);
    }
  }, [isCalloutToolActive, dragTarget, getMousePosition, setSelectedCalloutId, pageNumber]);

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

      // Store spaceId/moduleId if provided (for survey mode filtering)
      if (selectedSpaceId) {
        newCallout.spaceId = selectedSpaceId;
      }
      if (selectedModuleId) {
        newCallout.moduleId = selectedModuleId;
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

  // Filter callouts for this page and by survey mode if needed
  const pageCallouts = callouts.filter(c => 
    c.pageNumber === pageNumber &&
    (selectedSpaceId === null || c.spaceId === selectedSpaceId) &&
    (selectedModuleId === null || c.moduleId === selectedModuleId || !c.moduleId) && // If callout has no moduleId, it's always visible
    (!c.moduleId || (showSurveyPanel && selectedModuleId !== null && c.moduleId === selectedModuleId)) // Survey mode filtering
  );

  // #region agent log
  // Block pointer events if callout tool is active OR if there are callouts on this page
  // This prevents eraser/selection tools from passing through callouts to Fabric objects below
  // When callout tool is active, use 'auto' to enable callout creation/editing
  // When callouts exist, use 'auto' to block events from passing through (callouts should block other tools)
  // Only use 'none' when no callouts exist and callout tool is not active
  const pointerEventsValue = (isCalloutToolActive || pageCallouts.length > 0) ? 'auto' : 'none';
  fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CalloutCanvas.jsx:362',message:'CalloutCanvas pointerEvents check',data:{isCalloutToolActive,pageCalloutsCount:pageCallouts.length,pointerEventsValue,pageNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run8',hypothesisId:'P'})}).catch(()=>{});
  // #endregion

  return (
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
          onStartDrag={startDrag}
          onUpdate={(updates) => updateCallout(callout.id, updates)}
          onDelete={() => deleteCallout(callout.id)}
          shouldFocus={callout.id === newCalloutId}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          activeTool={activeTool}
          isInteractive={isCalloutToolActive}
        />
      ))}
    </div>
  );
};

export default CalloutCanvas;
