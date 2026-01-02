import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Callout, DragTarget, Point } from '@/types/callout';
import { calculateCalloutConnection } from '@/lib/calloutGeometry';

type Corner = 'nw' | 'ne' | 'se' | 'sw';

interface CalloutComponentProps {
  callout: Callout;
  isSelected: boolean;
  onSelect: () => void;
  onStartDrag: (target: DragTarget, offset: Point) => void;
  onUpdate: (updates: Partial<Callout>) => void;
  shouldFocus: boolean;
}

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
  const wasSelectedRef = useRef(false);
  const [isHandleHovered, setIsHandleHovered] = useState(false);
  const prevTextBoxWidthRef = useRef(callout.textBoxWidth);
  const prevTextBoxHeightRef = useRef(callout.textBoxHeight);
  const wasEditingBeforeResizeRef = useRef(false);
  const isInitialMountRef = useRef(true);
  
  // Track isHandleHovered changes
  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:9005/ingest/7b725b9a-7d16-46bd-9304-b1b637020992', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'CalloutComponent.tsx:useEffect:isHandleHovered', message: 'Handle hover state changed', data: { calloutId: callout.id, isHandleHovered, isSelected, isEditing }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
    // #endregion
  }, [isHandleHovered, callout.id, isSelected, isEditing]);

  // Log isEditing state changes
  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7b725b9a-7d16-46bd-9304-b1b637020992', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'CalloutComponent.tsx:isEditing', message: 'isEditing state changed', data: { isEditing, isSelected, pointerEvents: isEditing ? 'auto' : 'none' }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
    // #endregion
  }, [isEditing, isSelected]);

  // Focus textarea when newly created
  useEffect(() => {
    if (shouldFocus && textareaRef.current) {
      // Clear any pending resize restoration
      wasEditingBeforeResizeRef.current = false;
      setIsEditing(true);
      // Use setTimeout to ensure focus happens after state update
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    }
  }, [shouldFocus]);

  // Track selection state for click-to-edit logic
  useEffect(() => {
    wasSelectedRef.current = isSelected;
  }, [isSelected]);

  // Exit editing mode when deselected
  useEffect(() => {
    if (!isSelected) {
      setIsEditing(false);
    }
  }, [isSelected]);

  // Track textBoxWidth and textBoxHeight changes to restore focus after resize
  // Only restore if we were editing before resize started (user-initiated resize)
  useEffect(() => {
    // Skip on initial mount to avoid interfering with normal initialization
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      prevTextBoxWidthRef.current = callout.textBoxWidth;
      prevTextBoxHeightRef.current = callout.textBoxHeight;
      return;
    }
    
    // If width or height changed, we might need to restore editing state
    const widthChanged = prevTextBoxWidthRef.current !== callout.textBoxWidth;
    const heightChanged = prevTextBoxHeightRef.current !== callout.textBoxHeight;
    
    // Only restore if we were editing before resize AND this is a significant change
    // (to avoid interfering with auto-resize based on content or normal editing)
    if ((widthChanged || heightChanged) && wasEditingBeforeResizeRef.current) {
      const widthDiff = Math.abs(prevTextBoxWidthRef.current - callout.textBoxWidth);
      const heightDiff = Math.abs(prevTextBoxHeightRef.current - callout.textBoxHeight);
      
      // Only restore if it's a significant change (likely user resize, not auto-resize)
      // Auto-resize typically only changes height slightly, user resize changes width/height more
      // Also check that we're still selected (resize should keep selection)
      if ((widthDiff > 1 || heightDiff > 5) && isSelected) {
        // Use requestAnimationFrame to ensure this happens after render
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (textareaRef.current && isSelected) {
              setIsEditing(true);
              textareaRef.current.focus();
              // Restore cursor position if possible
              const length = textareaRef.current.value.length;
              textareaRef.current.setSelectionRange(length, length);
            }
            // Reset the flag after restoring
            wasEditingBeforeResizeRef.current = false;
          }, 100);
        });
      } else {
        // Small change or not selected - just reset the flag
        wasEditingBeforeResizeRef.current = false;
      }
    }
    
    prevTextBoxWidthRef.current = callout.textBoxWidth;
    prevTextBoxHeightRef.current = callout.textBoxHeight;
  }, [callout.textBoxWidth, callout.textBoxHeight, isSelected]);

  // Auto-resize textarea height based on content
  useEffect(() => {
    if (textareaRef.current) {

      const hadFocus = document.activeElement === textareaRef.current;
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.max(32, textareaRef.current.scrollHeight);
      textareaRef.current.style.height = `${newHeight}px`;
      if (newHeight !== callout.textBoxHeight) {
        onUpdate({ textBoxHeight: newHeight });
      }
      // Restore focus if it was focused before resize
      if (hadFocus && isEditing && textareaRef.current) {
        textareaRef.current.focus();
      }

    }
  }, [callout.text, callout.textBoxWidth, isEditing, onUpdate, callout.textBoxHeight]);

  const handleTextBoxMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();


    // If not editing, start drag for moving
    if (!isEditing) {
      const wasAlreadySelected = isSelected;
      onSelect();
      // Update ref synchronously to avoid timing issues
      wasSelectedRef.current = true;

      // If it was already selected, don't start drag - let click handler enter edit mode
      if (wasAlreadySelected) {
        return;
      }

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const offset: Point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      onStartDrag({ type: 'textBox', calloutId: callout.id }, offset);
    }
  }, [callout.id, isEditing, onSelect, onStartDrag, isSelected]);

  const handleTextBoxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();


    // If callout is selected and was already selected before this click (not just selected),
    // enter editing mode. This allows clicking on an already-selected callout to edit.
    if (isSelected && wasSelectedRef.current) {
      // Clear any pending resize restoration
      wasEditingBeforeResizeRef.current = false;
      setIsEditing(true);
      // Use setTimeout to ensure focus happens after state update
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    }
  }, [isSelected]);

  const handleTextBoxDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Clear any pending resize restoration
    wasEditingBeforeResizeRef.current = false;
    setIsEditing(true);
    // Use setTimeout to ensure focus happens after state update
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, []);

  const handleCornerMouseDown = useCallback((e: React.MouseEvent, corner: Corner) => {
    e.stopPropagation();

    // Preserve editing state during resize - don't exit edit mode just because we're resizing
    // Store the editing state so we can restore it after resize completes
    wasEditingBeforeResizeRef.current = isEditing;
    onSelect();
    onStartDrag({ type: 'textBoxCorner', calloutId: callout.id, corner }, { x: 0, y: 0 });

  }, [callout.id, onSelect, onStartDrag, isEditing, isSelected]);

  const handleHandleMouseDown = useCallback((e: React.MouseEvent, targetType: 'arrowTip' | 'knee') => {
    // #region agent log
    fetch('http://127.0.0.1:9005/ingest/7b725b9a-7d16-46bd-9304-b1b637020992', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'CalloutComponent.tsx:handleHandleMouseDown', message: 'Handle mouse down', data: { calloutId: callout.id, targetType, isSelected, isHandleHovered, isEditing }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });
    // #endregion
    e.stopPropagation();
    onSelect();
    onStartDrag({ type: targetType, calloutId: callout.id }, { x: 0, y: 0 });
  }, [callout.id, onSelect, onStartDrag, isSelected]);

  const handleHandleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleHandleMouseEnter = useCallback(() => {
    // #region agent log
    fetch('http://127.0.0.1:9005/ingest/7b725b9a-7d16-46bd-9304-b1b637020992', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'CalloutComponent.tsx:handleHandleMouseEnter', message: 'Handle mouse enter', data: { calloutId: callout.id, isSelected, isEditing, willSetHovered: true }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
    // #endregion
    setIsHandleHovered(true);
  }, [callout.id, isSelected, isEditing]);

  const handleHandleMouseLeave = useCallback(() => {
    // #region agent log
    fetch('http://127.0.0.1:9005/ingest/7b725b9a-7d16-46bd-9304-b1b637020992', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'CalloutComponent.tsx:handleHandleMouseLeave', message: 'Handle mouse leave', data: { calloutId: callout.id, isSelected, isEditing, willSetHovered: false }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
    // #endregion
    setIsHandleHovered(false);
  }, [callout.id, isSelected, isEditing]);

  const { arrowTip, knee, textBoxPosition, textBoxWidth, textBoxHeight, text, style } = callout;



  const { line1Start, shouldHideLine1, line2Start } = calculateCalloutConnection(
    textBoxPosition.x,
    textBoxPosition.y,
    textBoxWidth,
    textBoxHeight,
    knee,
    arrowTip,
    style.lineThickness
  );



  return (
    <>
      {/* SVG for lines */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ width: '100%', height: '100%', opacity: style.opacity }}
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
              fill={style.borderColor}
            />
          </marker>
        </defs>

        {/* Line from text box to knee to arrow tip */}
        {!shouldHideLine1 && (
          <polyline
            points={`${line1Start.x},${line1Start.y} ${knee.x},${knee.y} ${arrowTip.x},${arrowTip.y}`}
            fill="none"
            stroke={style.borderColor}
            strokeWidth={style.lineThickness}
            markerEnd={`url(#arrowhead-${callout.id})`}
          />
        )}
        {shouldHideLine1 && (
          <polyline
            points={`${line2Start.x},${line2Start.y} ${arrowTip.x},${arrowTip.y}`}
            fill="none"
            stroke={style.borderColor}
            strokeWidth={style.lineThickness}
            markerEnd={`url(#arrowhead-${callout.id})`}
          />
        )}
      </svg>

      {/* Text box */}
      <div
        className="absolute cursor-move"
        style={{
          left: textBoxPosition.x,
          top: textBoxPosition.y,
          opacity: style.opacity,
        }}
        onMouseDown={handleTextBoxMouseDown}
        onClick={handleTextBoxClick}
        onDoubleClick={handleTextBoxDoubleClick}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {

            onUpdate({ text: e.target.value });
          }}
          onFocus={() => {

          }}
          className="callout-text-box"
          style={{
            width: textBoxWidth,
            minHeight: 32,
            backgroundColor: style.fillColor === 'transparent' ? 'transparent' : style.fillColor,
            borderColor: style.borderColor,
            borderWidth: style.lineThickness,
            color: style.fontColor,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.bold ? 'bold' : 'normal',
            fontStyle: style.italic ? 'italic' : 'normal',
            pointerEvents: isEditing ? 'auto' : 'none',
            cursor: isEditing ? 'text' : 'move',
          }}
        />

        {/* Resize handles for text box corners */}
        {(() => {
          // #region agent log
          const shouldShow = (isSelected || isHandleHovered) && !isEditing;
          fetch('http://127.0.0.1:9005/ingest/7b725b9a-7d16-46bd-9304-b1b637020992', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'CalloutComponent.tsx:render:textboxHandles', message: 'Textbox handles visibility check', data: { calloutId: callout.id, isSelected, isHandleHovered, isEditing, shouldShow }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }) }).catch(() => { });
          // #endregion
          return shouldShow;
        })() && (
          <>
            <div
              className="handle-style absolute cursor-nw-resize"
              style={{ top: -6, left: -6 }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'nw')}
              onMouseEnter={handleHandleMouseEnter}
              onMouseLeave={handleHandleMouseLeave}
            />
            <div
              className="handle-style absolute cursor-ne-resize"
              style={{ top: -6, right: -6 }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'ne')}
              onMouseEnter={handleHandleMouseEnter}
              onMouseLeave={handleHandleMouseLeave}
            />
            <div
              className="handle-style absolute cursor-sw-resize"
              style={{ bottom: -6, left: -6 }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'sw')}
              onMouseEnter={handleHandleMouseEnter}
              onMouseLeave={handleHandleMouseLeave}
            />
            <div
              className="handle-style absolute cursor-se-resize"
              style={{ bottom: -6, right: -6 }}
              onMouseDown={(e) => handleCornerMouseDown(e, 'se')}
              onMouseEnter={handleHandleMouseEnter}
              onMouseLeave={handleHandleMouseLeave}
            />
          </>
        )}
      </div>

      {/* Knee handle */}
      {(isSelected || isHandleHovered) && (
        <div
          className="handle-style absolute cursor-move"
          style={{
            left: knee.x - 6,
            top: knee.y - 6,
          }}
          onMouseDown={(e) => handleHandleMouseDown(e, 'knee')}
          onClick={handleHandleClick}
          onMouseEnter={handleHandleMouseEnter}
          onMouseLeave={handleHandleMouseLeave}
        />
      )}

      {/* Arrow tip handle */}
      {(isSelected || isHandleHovered) && (
        <div
          className="handle-style absolute cursor-move"
          style={{
            left: arrowTip.x - 6,
            top: arrowTip.y - 6,
          }}
          onMouseDown={(e) => handleHandleMouseDown(e, 'arrowTip')}
          onClick={handleHandleClick}
          onMouseEnter={handleHandleMouseEnter}
          onMouseLeave={handleHandleMouseLeave}
        />
      )}
    </>
  );
};
