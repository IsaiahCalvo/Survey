import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Callout, CreationState, DragTarget, Point, defaultCalloutStyle } from '@/types/callout';
import { CalloutComponent } from './CalloutComponent';
import { v4 as uuidv4 } from 'uuid';

type ToolType = 'select' | 'callout';

interface PDFCanvasProps {
  callouts: Callout[];
  setCallouts: React.Dispatch<React.SetStateAction<Callout[]>>;
  selectedCalloutId: string | null;
  setSelectedCalloutId: React.Dispatch<React.SetStateAction<string | null>>;
  activeTool: ToolType;
}

export const PDFCanvas: React.FC<PDFCanvasProps> = ({
  callouts,
  setCallouts,
  selectedCalloutId,
  setSelectedCalloutId,
  activeTool,
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [creationState, setCreationState] = useState<CreationState>({
    isCreating: false,
    arrowTip: null,
    currentMouse: null,
  });
  const [dragTarget, setDragTarget] = useState<DragTarget>({ type: 'none' });
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [newCalloutId, setNewCalloutId] = useState<string | null>(null);
  const wholeMoveInitialPosRef = useRef<Point | null>(null);
  const wholeMoveInitialCalloutPosRef = useRef<{ arrowTip: Point; knee: Point; textBoxPosition: Point } | null>(null);
  const cornerResizeInitialStateRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const getMousePosition = useCallback((e: React.MouseEvent): Point => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const pos = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:36',message:'getMousePosition',data:{clientX:e.clientX,clientY:e.clientY,rectLeft:rect.left,rectTop:rect.top,posX:pos.x,posY:pos.y,ctrlKey:e.ctrlKey,metaKey:e.metaKey},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    return pos;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start callout creation when clicking directly on the canvas background
    // When clicking on existing callouts, their handlers will handle selection/dragging
    if (e.target !== canvasRef.current) return;

    const pos = getMousePosition(e);

    // If callout tool is active and clicking on empty space, start creation
    if (activeTool === 'callout' && dragTarget.type === 'none') {
      setCreationState({
        isCreating: true,
        arrowTip: pos,
        currentMouse: pos,
      });
      setSelectedCalloutId(null);
    }
  }, [activeTool, dragTarget, getMousePosition, setSelectedCalloutId]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
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
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:76',message:'Drag move start',data:{dragTargetType:dragTarget.type,dragTargetId:dragTarget.type !== 'none' ? dragTarget.calloutId : null,isWholeMove,ctrlKey:e.ctrlKey,metaKey:e.metaKey,posX:pos.x,posY:pos.y,dragOffsetX:dragOffset.x,dragOffsetY:dragOffset.y,wholeMoveInitialPos:wholeMoveInitialPosRef.current,clientX:e.clientX,clientY:e.clientY},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      setCallouts(prevCallouts => prevCallouts.map(callout => {
        if (dragTarget.type === 'whole' && dragTarget.calloutId === callout.id) {
          // Use the initial position ref if available, otherwise fall back to dragOffset
          const refPos = wholeMoveInitialPosRef.current || dragOffset;
          const dx = pos.x - refPos.x;
          const dy = pos.y - refPos.y;
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:86',message:'Whole drag calc',data:{dx,dy,refPosX:refPos.x,refPosY:refPos.y,oldArrowTipX:callout.arrowTip.x,oldArrowTipY:callout.arrowTip.y,oldKneeX:callout.knee.x,oldKneeY:callout.knee.y,oldTextBoxX:callout.textBoxPosition.x,oldTextBoxY:callout.textBoxPosition.y},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          return {
            ...callout,
            arrowTip: { x: callout.arrowTip.x + dx, y: callout.arrowTip.y + dy },
            knee: { x: callout.knee.x + dx, y: callout.knee.y + dy },
            textBoxPosition: { x: callout.textBoxPosition.x + dx, y: callout.textBoxPosition.y + dy },
          };
        }
        
        if (dragTarget.calloutId !== callout.id) return callout;

        if (isWholeMove && dragTarget.type !== 'whole') {
          // Convert to whole movement - capture initial mouse and callout positions on first conversion
          if (!wholeMoveInitialPosRef.current || !wholeMoveInitialCalloutPosRef.current) {
            wholeMoveInitialPosRef.current = pos;
            wholeMoveInitialCalloutPosRef.current = {
              arrowTip: { ...callout.arrowTip },
              knee: { ...callout.knee },
              textBoxPosition: { ...callout.textBoxPosition },
            };
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:107',message:'Capturing initial whole move pos',data:{initialPosX:pos.x,initialPosY:pos.y,textBoxX:callout.textBoxPosition.x,textBoxY:callout.textBoxPosition.y},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix-v2',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
          }
          const refPos = wholeMoveInitialPosRef.current;
          const refCalloutPos = wholeMoveInitialCalloutPosRef.current;
          const dx = pos.x - refPos.x;
          const dy = pos.y - refPos.y;
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:117',message:'Converted to whole move',data:{dx,dy,refPosX:refPos.x,refPosY:refPos.y,refTextBoxX:refCalloutPos.textBoxPosition.x,refTextBoxY:refCalloutPos.textBoxPosition.y,originalDragType:dragTarget.type,oldArrowTipX:callout.arrowTip.x,oldArrowTipY:callout.arrowTip.y,oldKneeX:callout.knee.x,oldKneeY:callout.knee.y,oldTextBoxX:callout.textBoxPosition.x,oldTextBoxY:callout.textBoxPosition.y},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix-v2',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          // Calculate position based on initial callout position + mouse movement
          return {
            ...callout,
            arrowTip: { x: refCalloutPos.arrowTip.x + dx, y: refCalloutPos.arrowTip.y + dy },
            knee: { x: refCalloutPos.knee.x + dx, y: refCalloutPos.knee.y + dy },
            textBoxPosition: { x: refCalloutPos.textBoxPosition.x + dx, y: refCalloutPos.textBoxPosition.y + dy },
          };
        }

        switch (dragTarget.type) {
          case 'arrowTip':
            return { ...callout, arrowTip: pos };
          case 'knee':
            return { ...callout, knee: pos };
          case 'textBox':
            return { ...callout, textBoxPosition: { x: pos.x - dragOffset.x, y: pos.y - dragOffset.y } };
          case 'textBoxCorner': {
            const corner = dragTarget.corner;
            const initial = cornerResizeInitialStateRef.current;
            if (!initial) {
              // Fallback if initial state wasn't captured (shouldn't happen)
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:147',message:'ERROR: No initial state for corner resize',data:{corner},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
              // #endregion
              return callout;
            }
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:155',message:'Corner resize calc start',data:{corner,posX:pos.x,posY:pos.y,currentX:callout.textBoxPosition.x,currentY:callout.textBoxPosition.y,currentWidth:callout.textBoxWidth,currentHeight:callout.textBoxHeight,initialX:initial.x,initialY:initial.y,initialWidth:initial.width,initialHeight:initial.height,hasInitialState:!!cornerResizeInitialStateRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,C,D'})}).catch(()=>{});
            // #endregion
            let newX = callout.textBoxPosition.x;
            let newY = callout.textBoxPosition.y;
            let newWidth = callout.textBoxWidth;
            let newHeight = callout.textBoxHeight;

            if (corner === 'nw') {
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:167',message:'NW corner calc BEFORE',data:{posX:pos.x,posY:pos.y,initialX:initial.x,initialY:initial.y,initialWidth:initial.width,initialHeight:initial.height,currentX:callout.textBoxPosition.x,currentY:callout.textBoxPosition.y,currentWidth:callout.textBoxWidth,currentHeight:callout.textBoxHeight},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,C,D'})}).catch(()=>{});
              // #endregion
              // For NW corner, keep bottom-right corner fixed (standard resize behavior)
              // The mouse position represents where the NW corner should be
              // Bottom-right corner stays at: (initial.x + initial.width, initial.y + initial.height)
              const fixedRightX = initial.x + initial.width;
              const fixedBottomY = initial.y + initial.height;
              // Width is distance from mouse x to fixed right edge
              newWidth = Math.max(80, fixedRightX - pos.x);
              // Height is distance from mouse y to fixed bottom edge
              newHeight = Math.max(32, fixedBottomY - pos.y);
              // Calculate new position to keep bottom-right corner fixed
              newX = fixedRightX - newWidth;
              newY = fixedBottomY - newHeight;
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:175',message:'NW corner calc AFTER',data:{fixedRightX,fixedBottomY,newX,newY,newWidth,newHeight},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
              // #endregion
            } else if (corner === 'ne') {
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:185',message:'NE corner calc BEFORE',data:{posX:pos.x,posY:pos.y,initialX:initial.x,initialY:initial.y,initialWidth:initial.width,initialHeight:initial.height,currentX:callout.textBoxPosition.x,currentY:callout.textBoxPosition.y,currentWidth:callout.textBoxWidth,currentHeight:callout.textBoxHeight},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B,C,D'})}).catch(()=>{});
              // #endregion
              // For NE corner, keep top-left corner position fixed
              // The mouse position represents where the top-right corner should be
              const initialTopRightX = initial.x + initial.width;
              const initialTopRightY = initial.y;
              const dx = pos.x - initialTopRightX;
              const dy = pos.y - initialTopRightY;
              newWidth = Math.max(80, initial.width + dx);
              newHeight = Math.max(32, initial.height - dy);
              // Keep position fixed - only resize, don't move
              newX = initial.x;
              newY = initial.y;
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:195',message:'NE corner calc AFTER',data:{dx,dy,initialTopRightX,initialTopRightY,newX,newY,newWidth,newHeight},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
            } else if (corner === 'sw') {
              // For SW corner, opposite corner (NE) should stay fixed at (initial.x + initial.width, initial.y)
              const oppositeX = initial.x + initial.width;
              const oppositeY = initial.y;
              newWidth = Math.max(80, oppositeX - pos.x);
              newHeight = Math.max(32, pos.y - oppositeY);
              newX = oppositeX - newWidth;
              newY = oppositeY; // Top edge stays fixed
            } else if (corner === 'se') {
              // For SE corner, opposite corner (NW) should stay fixed at (initial.x, initial.y)
              newWidth = Math.max(80, pos.x - initial.x);
              newHeight = Math.max(32, pos.y - initial.y);
              newX = initial.x; // Left edge stays fixed
              newY = initial.y; // Top edge stays fixed
            }

            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:218',message:'Corner resize final result',data:{corner,newX,newY,newWidth,newHeight,initialX:initial.x,initialY:initial.y,initialWidth:initial.width,initialHeight:initial.height,positionDeltaX:newX-initial.x,positionDeltaY:newY-initial.y,widthDelta:newWidth-initial.width,heightDelta:newHeight-initial.height},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,C,D'})}).catch(()=>{});
            // #endregion
            return {
              ...callout,
              textBoxPosition: { x: newX, y: newY },
              textBoxWidth: newWidth,
              textBoxHeight: newHeight,
            };
          }
          default:
            return callout;
        }
      }));

      // Don't update dragOffset during whole movement - it causes the offset issue
      // The wholeMoveInitialPosRef or original dragOffset should remain constant during the drag
    }
  }, [creationState.isCreating, dragTarget, dragOffset, getMousePosition, setCallouts]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const pos = getMousePosition(e);

    // Complete creation
    if (creationState.isCreating && creationState.arrowTip) {
      const id = uuidv4();
      const knee: Point = {
        x: (creationState.arrowTip.x + pos.x) / 2,
        y: creationState.arrowTip.y - 40,
      };
      
      const newCallout: Callout = {
        id,
        arrowTip: creationState.arrowTip,
        knee,
        textBoxPosition: pos,
        textBoxWidth: 120,
        textBoxHeight: 32,
        text: '',
        style: { ...defaultCalloutStyle },
        isSelected: true,
      };

      setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })).concat(newCallout));
      setSelectedCalloutId(id);
      setNewCalloutId(id);
      
      setCreationState({
        isCreating: false,
        arrowTip: null,
        currentMouse: null,
      });
      return;
    }

    // End drag - reset whole move refs and corner resize refs
    wholeMoveInitialPosRef.current = null;
    wholeMoveInitialCalloutPosRef.current = null;
    cornerResizeInitialStateRef.current = null;
    setDragTarget({ type: 'none' });
  }, [creationState, getMousePosition, setCallouts, setSelectedCalloutId]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    // Deselect if clicking on empty space
    if (e.target === canvasRef.current) {
      setSelectedCalloutId(null);
      setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
    }
  }, [setSelectedCalloutId, setCallouts]);

  const startDrag = useCallback((target: DragTarget, offset: Point) => {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:264',message:'startDrag called',data:{targetType:target.type,targetId:target.type !== 'none' ? target.calloutId : null,corner:target.type === 'textBoxCorner' ? target.corner : null,offsetX:offset.x,offsetY:offset.y},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    setDragTarget(target);
    setDragOffset(offset);
    // Capture initial state immediately when drag starts (not on first mouse move)
    if (target.type === 'textBoxCorner' && target.calloutId) {
      const callout = callouts.find(c => c.id === target.calloutId);
      if (callout) {
        cornerResizeInitialStateRef.current = {
          x: callout.textBoxPosition.x,
          y: callout.textBoxPosition.y,
          width: callout.textBoxWidth,
          height: callout.textBoxHeight,
        };
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/8e2221fa-c083-4299-966a-5f1b3d4ef2f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PDFCanvas.tsx:276',message:'Corner resize initial state captured at startDrag',data:{corner:target.corner,initialX:callout.textBoxPosition.x,initialY:callout.textBoxPosition.y,initialWidth:callout.textBoxWidth,initialHeight:callout.textBoxHeight},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
      } else {
        cornerResizeInitialStateRef.current = null;
      }
    } else {
      cornerResizeInitialStateRef.current = null;
    }
  }, [callouts]);

  const selectCallout = useCallback((id: string) => {
    setSelectedCalloutId(id);
    setCallouts(prev => prev.map(c => ({ ...c, isSelected: c.id === id })));
  }, [setSelectedCalloutId, setCallouts]);

  const updateCallout = useCallback((id: string, updates: Partial<Callout>) => {
    setCallouts(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }, [setCallouts]);

  // Clear newCalloutId after focus
  useEffect(() => {
    if (newCalloutId) {
      const timer = setTimeout(() => setNewCalloutId(null), 100);
      return () => clearTimeout(timer);
    }
  }, [newCalloutId]);

  return (
    <div className="flex-1 overflow-auto bg-canvas-bg p-8">
      <div
        ref={canvasRef}
        className="relative bg-page-bg shadow-page mx-auto"
        style={{ 
          width: '816px', 
          height: '1056px',
          cursor: activeTool === 'callout' ? 'crosshair' : 'default',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleCanvasClick}
      >
        {/* Creation preview line */}
        {creationState.isCreating && creationState.arrowTip && creationState.currentMouse && (
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{ width: '100%', height: '100%' }}
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
                  fill="hsl(var(--callout-line))"
                  opacity={0.6}
                />
              </marker>
            </defs>
            <polyline
              points={`${creationState.currentMouse.x},${creationState.currentMouse.y} ${(creationState.arrowTip.x + creationState.currentMouse.x) / 2},${creationState.arrowTip.y - 40} ${creationState.arrowTip.x},${creationState.arrowTip.y}`}
              fill="none"
              stroke="hsl(var(--callout-line))"
              strokeWidth={2}
              strokeDasharray="5,5"
              opacity={0.6}
              markerEnd="url(#arrowhead-preview)"
            />
          </svg>
        )}

        {/* Render callouts */}
        {callouts.map(callout => (
          <CalloutComponent
            key={callout.id}
            callout={callout}
            isSelected={callout.id === selectedCalloutId}
            onSelect={() => selectCallout(callout.id)}
            onStartDrag={startDrag}
            onUpdate={(updates) => updateCallout(callout.id, updates)}
            shouldFocus={callout.id === newCalloutId}
          />
        ))}
      </div>
    </div>
  );
};
