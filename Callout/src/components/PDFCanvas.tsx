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
  const justFinishedDragRef = useRef(false);

  const getMousePosition = useCallback((e: React.MouseEvent): Point => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getMousePosition(e);

    // Ignore clicks on children (handles, textboxes) which manage their own selection logic
    if (e.target !== e.currentTarget) return;



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

      setCallouts(prevCallouts => prevCallouts.map(callout => {
        if (dragTarget.type === 'whole' && dragTarget.calloutId === callout.id) {
          const dx = pos.x - dragOffset.x;
          const dy = pos.y - dragOffset.y;
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
          const dx = pos.x - dragOffset.x;
          const dy = pos.y - dragOffset.y;
          return {
            ...callout,
            arrowTip: { x: callout.arrowTip.x + dx, y: callout.arrowTip.y + dy },
            knee: { x: callout.knee.x + dx, y: callout.knee.y + dy },
            textBoxPosition: { x: callout.textBoxPosition.x + dx, y: callout.textBoxPosition.y + dy },
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
            let newX = callout.textBoxPosition.x;
            let newY = callout.textBoxPosition.y;
            let newWidth = callout.textBoxWidth;
            let newHeight = callout.textBoxHeight;

            if (corner === 'nw') {
              const dx = pos.x - callout.textBoxPosition.x;
              const dy = pos.y - callout.textBoxPosition.y;
              newX = pos.x;
              newY = pos.y;
              newWidth = Math.max(80, callout.textBoxWidth - dx);
              newHeight = Math.max(32, callout.textBoxHeight - dy);
            } else if (corner === 'ne') {
              const dy = pos.y - callout.textBoxPosition.y;
              newY = pos.y;
              newWidth = Math.max(80, pos.x - callout.textBoxPosition.x);
              newHeight = Math.max(32, callout.textBoxHeight - dy);
            } else if (corner === 'sw') {
              const dx = pos.x - callout.textBoxPosition.x;
              newX = pos.x;
              newWidth = Math.max(80, callout.textBoxWidth - dx);
              newHeight = Math.max(32, pos.y - callout.textBoxPosition.y);
            } else if (corner === 'se') {
              newWidth = Math.max(80, pos.x - callout.textBoxPosition.x);
              newHeight = Math.max(32, pos.y - callout.textBoxPosition.y);
            }

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

      if (dragTarget.type === 'whole' || (e.ctrlKey || e.metaKey)) {
        setDragOffset(pos);
      }
    }
  }, [creationState.isCreating, dragTarget, dragOffset, getMousePosition, setCallouts]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const pos = getMousePosition(e);

    // #region agent log
    fetch('http://127.0.0.1:9005/ingest/7b725b9a-7d16-46bd-9304-b1b637020992', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'PDFCanvas.tsx:handleMouseUp', message: 'Mouse up event', data: { dragTargetType: dragTarget.type, dragTargetCalloutId: dragTarget.type !== 'none' ? (dragTarget as any).calloutId : null, selectedCalloutId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
    // #endregion

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

    // Track if we just finished a drag to prevent click from deselecting
    const wasDragging = dragTarget.type !== 'none';

    // #region agent log
    fetch('http://127.0.0.1:9005/ingest/7b725b9a-7d16-46bd-9304-b1b637020992', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'PDFCanvas.tsx:handleMouseUp:endDrag', message: 'Ending drag', data: { wasDragging, dragTargetType: dragTarget.type, selectedCalloutId }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
    // #endregion

    if (wasDragging && (dragTarget.type === 'knee' || dragTarget.type === 'arrowTip')) {
      justFinishedDragRef.current = true;

    }

    // End drag
    setDragTarget({ type: 'none' });
  }, [creationState, dragTarget, getMousePosition, setCallouts, setSelectedCalloutId, selectedCalloutId]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {

    // Don't deselect if we just finished dragging (prevents deselection after dragging handles)
    if (justFinishedDragRef.current) {

      justFinishedDragRef.current = false; // Reset the flag after checking
      return;
    }

    // Deselect if clicking on empty space
    if (e.target === canvasRef.current) {

      setSelectedCalloutId(null);
      setCallouts(prev => prev.map(c => ({ ...c, isSelected: false })));
    }
  }, [setSelectedCalloutId, setCallouts]);

  const startDrag = useCallback((target: DragTarget, offset: Point) => {

    setDragTarget(target);
    setDragOffset(offset);
  }, []);

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
