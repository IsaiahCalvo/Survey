import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
    Canvas as FabricCanvas,
    Line,
    Circle,
    Rect,
    Textbox,
    Group,
    Triangle,
    FabricObject,
    TPointerEvent,
    TPointerEventInfo,
    Control,
    Path,
} from 'fabric';
import { Callout, CalloutStyle, defaultCalloutStyle, Point } from '@/types/callout';
import { calculateCalloutConnection, MIN_TEXTBOX_TO_ARROW_DISTANCE } from '@/lib/calloutGeometry';

const MIN_HANDLE_DISTANCE = 30;
import { v4 as uuidv4 } from 'uuid';

import { ToolType } from './Toolbar';
import { Line as LineType, Arrow, defaultLineStyle } from '@/types/callout';
import { getMidpoint, shouldSnapToLinear, getCurvedPath, getCurveEndAngle } from '@/lib/lineGeometry';

interface FabricPDFCanvasProps {
    callouts: Callout[];
    setCallouts: React.Dispatch<React.SetStateAction<Callout[]>>;
    lines?: LineType[];
    setLines?: React.Dispatch<React.SetStateAction<LineType[]>>;
    arrows?: Arrow[];
    setArrows?: React.Dispatch<React.SetStateAction<Arrow[]>>;
    selectedCalloutId: string | null;
    setSelectedCalloutId: React.Dispatch<React.SetStateAction<string | null>>;
    selectedLineId?: string | null;
    setSelectedLineId?: React.Dispatch<React.SetStateAction<string | null>>;
    selectedArrowId?: string | null;
    setSelectedArrowId?: React.Dispatch<React.SetStateAction<string | null>>;
    activeTool: ToolType;
}

interface FabricCalloutGroup extends Group {
    calloutId?: string;
}

// Custom object type for callout parts
interface CalloutPart extends FabricObject {
    calloutId?: string;
    partType?: 'arrowTip' | 'knee' | 'textBoxBg' | 'text' | 'line1' | 'line2' | 'arrowHead';
}

export const FabricPDFCanvas: React.FC<FabricPDFCanvasProps> = ({
    callouts,
    setCallouts,
    lines = [],
    setLines,
    arrows = [],
    setArrows,
    selectedCalloutId,
    setSelectedCalloutId,
    selectedLineId,
    setSelectedLineId,
    selectedArrowId,
    setSelectedArrowId,
    activeTool,
}) => {

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricCanvasRef = useRef<FabricCanvas | null>(null);
    const calloutObjectsRef = useRef<Map<string, FabricObject[]>>(new Map());
    const lineObjectsRef = useRef<Map<string, Path | Line>>(new Map());
    const arrowObjectsRef = useRef<Map<string, Path | Line>>(new Map());
    const arrowHeadObjectsRef = useRef<Map<string, Triangle>>(new Map());
    const lineHandleObjectsRef = useRef<Map<string, { start: Rect; end: Rect; midpoint: Rect }>>(new Map());
    const arrowHandleObjectsRef = useRef<Map<string, { start: Rect; end: Rect; midpoint: Rect }>>(new Map());
    const linesRef = useRef<LineType[]>(lines);
    const arrowsRef = useRef<Arrow[]>(arrows);
    const draggingArrowIdRef = useRef<string | null>(null);
    const draggingLineHandleRef = useRef<{ lineId: string; handleType: 'start' | 'end' | 'midpoint' } | null>(null);
    const draggingArrowHandleRef = useRef<{ arrowId: string; handleType: 'start' | 'end' | 'midpoint' } | null>(null);
    const draggingLineBodyRef = useRef<string | null>(null);
    const lineOriginalPosRef = useRef<Map<string, { left: number; top: number; start: Point; end: Point; midpoint?: Point }>>(new Map());
    const isMouseUpRef = useRef<boolean>(false);
    const isProcessingArrowModifiedRef = useRef<boolean>(false); // Prevent re-entrant handleObjectModified calls
    const isProcessingLineModifiedRef = useRef<boolean>(false); // Prevent re-entrant handleObjectModified calls for lines
    const [isCreating, setIsCreating] = useState(false);
    const [creationStart, setCreationStart] = useState<Point | null>(null);
    const [creationToolType, setCreationToolType] = useState<'callout' | 'line' | 'arrow' | null>(null);
    const previewLinePathRef = useRef<Path | null>(null);
    const isCreatingRef = useRef(false);

    // Callout Preview Refs
    const previewLineRef = useRef<Line | null>(null);
    const previewTextBoxRef = useRef<Rect | null>(null);
    const previewLine1Ref = useRef<Line | null>(null);
    const previewLine2Ref = useRef<Line | null>(null);
    const previewArrowHeadRef = useRef<Triangle | null>(null);

    // This ref will now hold a Line object for simple dragging preview, or Path if needed
    // Using Line is more reliable for real-time updates of a straight segment
    const previewDragLineRef = useRef<Line | null>(null);

    // We can keep this just in case, but we will use previewDragLineRef for the initial drag

    const isEditingTextRef = useRef(false);

    // Creation State Refs (for real-time event handling without stale closures)
    const creationStartRef = useRef<Point | null>(null);
    const creationToolTypeRef = useRef<'callout' | 'line' | 'arrow' | null>(null);

    const [hoveredHandleCalloutId, setHoveredHandleCalloutId] = useState<string | null>(null);

    // Callout Interaction Refs
    const wasSelectedRef = useRef<string | null>(null); // Track previously selected callout for two-click edit
    const newCalloutIdRef = useRef<string | null>(null); // Track newly created callout for auto-focus
    const pendingEditRef = useRef<string | null>(null); // Track if we should enter edit mode on mouse up (two-click)
    const doubleClickTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track double-click detection
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Resize/Scale Handling
    const initialScalingStateRef = useRef<{
        calloutId: string | null;
        activeControl: string | null;
        initialLeft: number;
        initialTop: number;
        initialWidth: number;
        initialHeight: number;
        initialRight: number;
        initialBottom: number;
        hasCrossedThreshold?: boolean; // Track if we've crossed the scale threshold (past opposite edge)
        lastValidWidth?: number; // Last valid width before crossing threshold
        lastValidHeight?: number; // Last valid height before crossing threshold
    } | null>(null);

    // Collision Rollback: Store "safe" initial positions for objects before drag starts
    // Key format: `${calloutId}-${partType}`
    const lastSafeObjectPosRef = useRef<Map<string, { left: number; top: number }>>(new Map());

    // Track last position for whole-callout drag
    const lastDragPosRef = useRef<{ x: number; y: number } | null>(null);

    // Sync state to refs for event handlers
    useEffect(() => {
        linesRef.current = lines;
    }, [lines]);

    useEffect(() => {
        arrowsRef.current = arrows;
    }, [arrows]);


    // Initialize Fabric canvas
    useEffect(() => {
        if (!canvasRef.current) return;

        const canvas = new FabricCanvas(canvasRef.current, {
            width: 816,
            height: 1056,
            backgroundColor: '#ffffff',
            selection: true,
            preserveObjectStacking: true,
            uniformScaling: false, // Allow free-form resizing (non-uniform scaling) for all objects
        });

        fabricCanvasRef.current = canvas;

        // Override control rendering to draw rounded rectangles (matching arrow/knee handles)
        // Fabric.js v6 uses Control objects, we override their render method
        let originalRender: any;
        if (Control && typeof Control.prototype.render === 'function') {
            originalRender = Control.prototype.render;
            Control.prototype.render = function (ctx: CanvasRenderingContext2D, left: number, top: number, styleOverride: any, fabricObject: FabricObject) {
                // The original render centers the control at (left, top)
                // So we need to draw at (left - size/2, top - size/2)
                const size = fabricObject.cornerSize || 12;
                const stroke = !fabricObject.transparentCorners && fabricObject.cornerStrokeColor;
                const fill = fabricObject.cornerColor || '#ffffff';
                const rx = 2;

                // The original render centers the control at (left, top)
                // So we need to draw at (left - size/2, top - size/2)
                const drawLeft = left - size / 2;
                const drawTop = top - size / 2;

                ctx.save();
                ctx.fillStyle = fill;
                ctx.strokeStyle = stroke || fill;
                ctx.lineWidth = 1;

                // Draw rounded rectangle at centered position
                if (typeof (ctx as any).roundRect === 'function') {
                    ctx.beginPath();
                    (ctx as any).roundRect(drawLeft, drawTop, size, size, rx);
                    ctx.fill();
                    if (stroke) {
                        ctx.stroke();
                    }
                } else {
                    ctx.beginPath();
                    ctx.moveTo(drawLeft + rx, drawTop);
                    ctx.lineTo(drawLeft + size - rx, drawTop);
                    ctx.quadraticCurveTo(drawLeft + size, drawTop, drawLeft + size, drawTop + rx);
                    ctx.lineTo(drawLeft + size, drawTop + size - rx);
                    ctx.quadraticCurveTo(drawLeft + size, drawTop + size, drawLeft + size - rx, drawTop + size);
                    ctx.lineTo(drawLeft + rx, drawTop + size);
                    ctx.quadraticCurveTo(drawLeft, drawTop + size, drawLeft, drawTop + size - rx);
                    ctx.lineTo(drawLeft, drawTop + rx);
                    ctx.quadraticCurveTo(drawLeft, drawTop, drawLeft + rx, drawTop);
                    ctx.closePath();
                    ctx.fill();
                    if (stroke) {
                        ctx.stroke();
                    }
                }
                ctx.restore();
            };
        }

        return () => {
            // Restore original method
            if (originalRender) {
                Control.prototype.render = originalRender;
            }
            canvas.dispose();

            // Clear refs to prevent stale objects on remount
            calloutObjectsRef.current.clear();
            lineObjectsRef.current.clear();
            arrowObjectsRef.current.clear();
            arrowHeadObjectsRef.current.clear();
            lineHandleObjectsRef.current.clear();
            arrowHandleObjectsRef.current.clear();
            lineOriginalPosRef.current.clear();
        };
    }, []);

    // Convert callout data to Fabric objects
    const createCalloutObjects = useCallback((callout: Callout, isSelected: boolean): FabricObject[] => {
        const { arrowTip, knee, textBoxPosition, textBoxWidth, textBoxHeight, text, style, id } = callout;

        // Calculate connection point
        const { line1Start, shouldHideLine1: shouldHide, line2Start, effectiveKnee } = calculateCalloutConnection(
            textBoxPosition.x,
            textBoxPosition.y,
            textBoxWidth,
            textBoxHeight,
            knee,
            arrowTip,
            style.lineThickness
        );

        // Line from text box to knee
        const line1 = new Line([line1Start.x, line1Start.y, effectiveKnee.x, effectiveKnee.y], {
            stroke: style.borderColor,
            strokeWidth: style.lineThickness,
            selectable: true,
            evented: true, // Make clickable to select callout
            opacity: shouldHide ? 0 : style.opacity,
            perPixelTargetFind: true, // Use per-pixel hit detection for precise clicking
            hoverCursor: 'move',
            targetFindTolerance: 15, // Increase tolerance to make clicking easier
            hasControls: false, // No resize handles for lines
            hasBorders: false, // No selection border for lines
        }) as CalloutPart;
        line1.calloutId = id;
        line1.partType = 'line1';

        // Line from knee to arrow tip (with arrowhead direction)
        const line2 = new Line([line2Start.x, line2Start.y, arrowTip.x, arrowTip.y], {
            stroke: style.borderColor,
            strokeWidth: style.lineThickness,
            selectable: true,
            evented: true, // Make clickable to select callout
            opacity: style.opacity,
            perPixelTargetFind: true, // Use per-pixel hit detection for precise clicking
            hoverCursor: 'move',
            targetFindTolerance: 15, // Increase tolerance to make clicking easier
            hasControls: false, // No resize handles for lines
            hasBorders: false, // No selection border for lines
        }) as CalloutPart;
        line2.calloutId = id;
        line2.partType = 'line2';

        // Arrow head (triangle)
        const angleDeg = (Math.atan2(arrowTip.y - effectiveKnee.y, arrowTip.x - effectiveKnee.x) * 180) / Math.PI;
        const arrowHead = new Triangle({
            left: arrowTip.x,
            top: arrowTip.y,
            originX: 'center',
            originY: 'center',
            width: 14,
            height: 18,
            angle: angleDeg + 90,
            fill: style.borderColor,
            selectable: false,
            evented: true, // Make clickable to select callout
            opacity: style.opacity,
            targetFindTolerance: 5,
        }) as CalloutPart;
        arrowHead.calloutId = id;
        arrowHead.partType = 'arrowHead';

        // Text box background - MUST be selectable and evented
        const textBoxBg = new Rect({
            left: textBoxPosition.x,
            top: textBoxPosition.y,
            width: textBoxWidth,
            height: textBoxHeight,
            fill: style.fillColor === 'transparent' ? 'rgba(255,255,255,0.01)' : style.fillColor,
            stroke: style.borderColor,
            strokeWidth: style.lineThickness,
            strokeUniform: true,
            selectable: true,
            evented: true,
            opacity: style.opacity,
            rx: 2,
            ry: 2,
            hasControls: true,
            hasBorders: true,
            lockRotation: true,
            uniformScaling: false, // Allow free-form resizing (non-uniform scaling) for all handles
            // lockScalingFlip removed to allow flipping like test rectangle
            objectCaching: false, // Ensure strokeUniform works correctly
        }) as CalloutPart;
        textBoxBg.calloutId = id;
        textBoxBg.partType = 'textBoxBg';

        // Hide edge handles and rotate handle, keep only corner handles
        textBoxBg.setControlsVisibility({
            ml: false, // middle-left
            mr: false, // middle-right
            mt: false, // middle-top
            mb: false, // middle-bottom
            mtr: false, // rotate handle
            // Keep corner handles visible: tl, tr, bl, br (default: true)
        });



        // Customize corner handles to be white squares with blue outline
        // Note: Fabric.js controls are rendered as rectangles by default
        // We customize them via canvas-level settings when the object is selected
        textBoxBg.cornerColor = '#ffffff';
        textBoxBg.cornerStrokeColor = '#3b82f6';
        textBoxBg.cornerSize = 12;
        textBoxBg.transparentCorners = false;

        // Try setting cornerRadius if available in Fabric.js v6
        if ('cornerRadius' in textBoxBg) {
            (textBoxBg as any).cornerRadius = 2;
        }

        // Text
        const textObj = new Textbox(text || '', {
            left: textBoxPosition.x + 8,
            top: textBoxPosition.y + 4,
            width: Math.max(textBoxWidth - 16, 20),
            fontSize: style.fontSize,
            fontFamily: style.fontFamily,
            fill: style.fontColor,
            fontWeight: style.bold ? 'bold' : 'normal',
            fontStyle: style.italic ? 'italic' : 'normal',
            selectable: true,
            evented: true,
            editable: true,
            opacity: style.opacity,
            splitByGrapheme: true,
            hasControls: false,
            hasBorders: false,
        }) as CalloutPart;
        textObj.calloutId = id;
        textObj.partType = 'text';

        // Handle squares for arrow tip and knee - visible when selected
        const arrowTipHandle = new Rect({
            left: arrowTip.x - 6,
            top: arrowTip.y - 6,
            width: 12,
            height: 12,
            fill: '#ffffff',
            stroke: '#3b82f6',
            strokeWidth: 1,
            rx: 2,
            ry: 2,
            selectable: true,
            evented: true,
            hasControls: false,
            hasBorders: false,
            visible: true,
            opacity: isSelected ? 1 : 0,
        }) as CalloutPart;
        arrowTipHandle.calloutId = id;
        arrowTipHandle.partType = 'arrowTip';

        const kneeHandle = new Rect({
            left: effectiveKnee.x - 6,
            top: effectiveKnee.y - 6,
            width: 12,
            height: 12,
            fill: '#ffffff',
            stroke: '#3b82f6',
            strokeWidth: 1,
            rx: 2,
            ry: 2,
            selectable: true,
            evented: true,
            hasControls: false,
            hasBorders: false,
            visible: true,
            opacity: isSelected ? 1 : 0,
        }) as CalloutPart;
        kneeHandle.calloutId = id;
        kneeHandle.partType = 'knee';

        return [line1, line2, arrowHead, textBoxBg, textObj, arrowTipHandle, kneeHandle];
    }, []);

    // Sync callouts to canvas (diff + in-place updates to preserve selection)
    useEffect(() => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        const nextIds = new Set(callouts.map(c => c.id));

        // Remove deleted callouts
        Array.from(calloutObjectsRef.current.entries()).forEach(([id, objects]) => {
            if (!nextIds.has(id)) {
                objects.forEach(obj => canvas.remove(obj));
                calloutObjectsRef.current.delete(id);
            }
        });



        const getPart = <T extends FabricObject = FabricObject>(
            objects: FabricObject[],
            partType: CalloutPart['partType']
        ): T | undefined => {
            return objects.find(o => (o as CalloutPart).partType === partType) as T | undefined;
        };

        callouts.forEach(callout => {
            const isSelected = callout.id === selectedCalloutId;
            const existing = calloutObjectsRef.current.get(callout.id);

            // New callout
            if (!existing) {
                const objects = createCalloutObjects(callout, isSelected);
                calloutObjectsRef.current.set(callout.id, objects);
                objects.forEach(obj => canvas.add(obj));

                // Set textBoxBg as active object if callout is selected to show handles immediately
                if (isSelected) {
                    // Use setTimeout to ensure the canvas has finished rendering before setting active object
                    setTimeout(() => {
                        const textBoxBg = objects.find(o => (o as CalloutPart).partType === 'textBoxBg');
                        if (textBoxBg) {
                            canvas.setActiveObject(textBoxBg);
                            canvas.requestRenderAll();
                        }
                    }, 0);
                }
                return;
            }

            const line1 = getPart<Line>(existing, 'line1');
            const line2 = getPart<Line>(existing, 'line2');
            const arrowHead = getPart<Triangle>(existing, 'arrowHead');
            const bg = getPart<Rect>(existing, 'textBoxBg');
            const text = getPart<Textbox>(existing, 'text');
            const arrowTipHandle = getPart<Rect>(existing, 'arrowTip');
            const kneeHandle = getPart<Rect>(existing, 'knee');

            const { style } = callout;

            // Textbox
            bg?.set({
                left: callout.textBoxPosition.x,
                top: callout.textBoxPosition.y,
                width: callout.textBoxWidth,
                height: callout.textBoxHeight,
                fill: style.fillColor === 'transparent' ? 'rgba(255,255,255,0.01)' : style.fillColor,
                stroke: style.borderColor,
                strokeWidth: style.lineThickness,
                strokeUniform: true,
                opacity: style.opacity,
                uniformScaling: false, // Allow free-form resizing (non-uniform scaling) for all handles
                // lockScalingFlip removed
                hasControls: true, // Ensure controls are always enabled
                hasBorders: true, // Ensure borders are always enabled
            });



            if (text && !isEditingTextRef.current) {
                text.set({
                    left: callout.textBoxPosition.x + 8,
                    top: callout.textBoxPosition.y + 4,
                    width: Math.max(callout.textBoxWidth - 16, 20),
                    text: callout.text || '',
                    fontSize: style.fontSize,
                    fontFamily: style.fontFamily,
                    fill: style.fontColor,
                    fontWeight: style.bold ? 'bold' : 'normal',
                    fontStyle: style.italic ? 'italic' : 'normal',
                    opacity: style.opacity,
                });
            }

            // Handles - show when selected or when any handle is hovered
            const shouldShowHandles = isSelected || hoveredHandleCalloutId === callout.id;
            arrowTipHandle?.set({
                left: callout.arrowTip.x - 6,
                top: callout.arrowTip.y - 6,
                opacity: shouldShowHandles ? 1 : 0,
            });
            kneeHandle?.set({
                left: callout.knee.x - 6,
                top: callout.knee.y - 6,
                opacity: shouldShowHandles ? 1 : 0,
            });

            // Connector lines
            if (line1 && line2) {
                const { line1Start, shouldHideLine1: shouldHide, line2Start, effectiveKnee } = calculateCalloutConnection(
                    callout.textBoxPosition.x,
                    callout.textBoxPosition.y,
                    callout.textBoxWidth,
                    callout.textBoxHeight,
                    callout.knee,
                    callout.arrowTip,
                    style.lineThickness
                );

                line1.set({
                    x1: line1Start.x,
                    y1: line1Start.y,
                    x2: effectiveKnee.x,
                    y2: effectiveKnee.y,
                    stroke: style.borderColor,
                    strokeWidth: style.lineThickness,
                    opacity: shouldHide ? 0 : style.opacity,
                    perPixelTargetFind: true, // Maintain per-pixel hit detection
                    selectable: true, // Enforce selectable
                    evented: true, // Enforce evented
                });
                line1.setCoords();

                line2.set({
                    x1: line2Start.x,
                    y1: line2Start.y,
                    x2: callout.arrowTip.x,
                    y2: callout.arrowTip.y,
                    stroke: style.borderColor,
                    strokeWidth: style.lineThickness,
                    opacity: style.opacity,
                    perPixelTargetFind: true, // Maintain per-pixel hit detection
                    selectable: true, // Enforce selectable
                    evented: true, // Enforce evented
                });
                line2.setCoords();

                // Update Knee Handle position to match effective knee
                kneeHandle?.set({
                    left: effectiveKnee.x - 6,
                    top: effectiveKnee.y - 6,
                });
                kneeHandle?.setCoords();

                // Update arrow angle based on effective knee
                if (arrowHead) {
                    const angleDeg = (Math.atan2(callout.arrowTip.y - effectiveKnee.y, callout.arrowTip.x - effectiveKnee.x) * 180) / Math.PI;
                    arrowHead.set({
                        angle: angleDeg + 90,
                        selectable: true, // Enforce selectable so it can be dragged
                        evented: true,    // Enforce evented
                        hasControls: false, // Hide resize handles
                        hasBorders: false,  // Hide selection box
                        lockMovementX: false, // Allow movement
                        lockMovementY: false,
                    });
                    arrowHead.setCoords();
                }
            }
        });

        canvas.requestRenderAll();
    }, [callouts, createCalloutObjects, selectedCalloutId]);

    // Render lines and arrows
    useEffect(() => {
        const canvas = fabricCanvasRef.current;
        if (!canvas || !setLines || !setArrows) return;



        // Remove lines/arrows that no longer exist
        lineObjectsRef.current.forEach((path, id) => {
            if (!lines.find(l => l.id === id)) {
                canvas.remove(path);
                lineObjectsRef.current.delete(id);
                // Also remove line handles
                const handles = lineHandleObjectsRef.current.get(id);
                if (handles) {
                    canvas.remove(handles.start);
                    canvas.remove(handles.end);
                    canvas.remove(handles.midpoint);
                    lineHandleObjectsRef.current.delete(id);
                }
            }
        });
        arrowObjectsRef.current.forEach((path, id) => {
            if (!arrows.find(a => a.id === id)) {
                canvas.remove(path);
                arrowObjectsRef.current.delete(id);
                // Also remove arrowhead if it exists
                const arrowHead = arrowHeadObjectsRef.current.get(id);
                if (arrowHead) {
                    canvas.remove(arrowHead);
                    arrowHeadObjectsRef.current.delete(id);
                }
                // Also remove arrow handles
                const handles = arrowHandleObjectsRef.current.get(id);
                if (handles) {
                    canvas.remove(handles.start);
                    canvas.remove(handles.end);
                    canvas.remove(handles.midpoint);
                    arrowHandleObjectsRef.current.delete(id);
                }
            }
        });

        // Helper to create a handle rect for line/arrow control points
        const createHandle = (x: number, y: number, objectId: string, handleType: 'start' | 'end' | 'midpoint', objectType: 'line' | 'arrow') => {
            const handle = new Rect({
                left: x - 6,
                top: y - 6,
                width: 12,
                height: 12,
                fill: '#ffffff',
                stroke: '#3b82f6',
                strokeWidth: 2,
                rx: 2,
                ry: 2,
                originX: 'left',
                originY: 'top',
                selectable: true,
                evented: false, // Start with evented: false, will be set to true when visible/selected
                hasControls: false,
                hasBorders: false,
                visible: false, // Hidden by default, shown when selected
            });
            (handle as any).objectId = objectId;
            (handle as any).handleType = handleType;
            (handle as any).objectType = objectType;
            return handle;
        };

        // Add/update lines
        lines.forEach(line => {
            let existing = lineObjectsRef.current.get(line.id);
            const existingHandles = lineHandleObjectsRef.current.get(line.id);

            // Skip update if this line is currently being dragged (to prevent reset)
            if (draggingLineBodyRef.current === line.id || draggingLineHandleRef.current?.lineId === line.id) {
                // #region agent log
                // #endregion
                return;
            }
            // #region agent log
            // #endregion

            const isLinear = shouldSnapToLinear(line.midpoint, line.start, line.end, 1);
            const pathString = isLinear
                ? `M ${line.start.x},${line.start.y} L ${line.end.x},${line.end.y}`
                : getCurvedPath(line.start, line.end, line.midpoint);
            const isSelected = selectedLineId === line.id;


            if (existing) {

                // Update existing path
                if (isLinear) {
                    // For linear, update as Line

                    if (existing instanceof Line) {
                        (existing as Line).set({
                            x1: line.start.x,
                            y1: line.start.y,
                            x2: line.end.x,
                            y2: line.end.y,
                            selectable: activeTool === 'select',
                            visible: true,
                            hasControls: false,
                            hasBorders: false,
                            lockScalingX: true,
                            lockScalingY: true,
                            lockRotation: true,
                            perPixelTargetFind: true, // Use per-pixel hit detection for precise clicking
                            objectCaching: false, // Disable caching to prevent disappearance artifacts
                            strokeUniform: true,
                        });
                    } else {
                        // Type mismatch: existing is Path but should be Line - need to recreate
                        canvas.remove(existing);
                        const newLine = new Line([line.start.x, line.start.y, line.end.x, line.end.y], {
                            stroke: line.style.color,
                            strokeWidth: line.style.lineThickness,
                            selectable: activeTool === 'select',
                            evented: true,
                            opacity: line.style.opacity,
                            visible: true,
                            hasControls: false,
                            hasBorders: false,
                            lockScalingX: true,
                            lockScalingY: true,
                            lockRotation: true,
                            perPixelTargetFind: true, // Use per-pixel hit detection for precise clicking
                            objectCaching: false, // Disable caching to prevent disappearance artifacts
                            strokeUniform: true,
                        });
                        (newLine as any).lineId = line.id;
                        newLine.setCoords();
                        canvas.add(newLine);
                        lineObjectsRef.current.set(line.id, newLine);
                        existing = newLine;
                    }
                } else {
                    // For curved, update path
                    if (existing instanceof Path) {
                        // Recreate Path object to ensure visual consistency (Fabric.js issues with set({ path }))
                        canvas.remove(existing);
                        const newPath = new Path(pathString, {
                            stroke: line.style.color,
                            strokeWidth: line.style.lineThickness,
                            fill: '',
                            selectable: activeTool === 'select',
                            evented: true,
                            opacity: line.style.opacity,
                            visible: true,
                            hasControls: false,
                            hasBorders: false,
                            lockScalingX: true,
                            lockScalingY: true,
                            lockRotation: true,
                            perPixelTargetFind: true, // Use per-pixel hit detection for precise clicking
                            objectCaching: false, // Disable caching to prevent disappearance artifacts
                            strokeUniform: true,
                        });
                        (newPath as any).lineId = line.id;
                        newPath.setCoords();

                        // Insert at correct index if possible, or just add
                        canvas.add(newPath);
                        // Ensure it's not on top of everything if we can help it (though add puts it on top)
                        // Ideally we'd replace at index, but for now just adding is consistent with create

                        lineObjectsRef.current.set(line.id, newPath);
                        existing = newPath;
                    } else {
                        // Type mismatch: existing is Line but should be Path - need to recreate
                        canvas.remove(existing);
                        const newPath = new Path(pathString, {
                            stroke: line.style.color,
                            strokeWidth: line.style.lineThickness,
                            fill: '',
                            selectable: activeTool === 'select',
                            evented: true,
                            opacity: line.style.opacity,
                            visible: true,
                            hasControls: false,
                            hasBorders: false,
                            lockScalingX: true,
                            lockScalingY: true,
                            lockRotation: true,
                            perPixelTargetFind: true, // Use per-pixel hit detection for precise clicking
                            objectCaching: false, // Disable caching to prevent disappearance artifacts
                            strokeUniform: true,
                        });
                        (newPath as any).lineId = line.id;
                        newPath.setCoords();
                        canvas.add(newPath);
                        lineObjectsRef.current.set(line.id, newPath);
                        existing = newPath;
                    }
                }
                existing.setCoords();
                // #region agent log
                // #endregion

                // Update handle positions if they exist
                if (existingHandles) {
                    existingHandles.start.set({
                        left: line.start.x - 6,
                        top: line.start.y - 6,
                        visible: isSelected,
                        evented: isSelected, // Only capture events when visible/selected
                    });
                    existingHandles.start.setCoords();

                    existingHandles.end.set({
                        left: line.end.x - 6,
                        top: line.end.y - 6,
                        visible: isSelected,
                        evented: isSelected, // Only capture events when visible/selected
                    });
                    existingHandles.end.setCoords();

                    existingHandles.midpoint.set({
                        left: line.midpoint.x - 6,
                        top: line.midpoint.y - 6,
                        visible: isSelected,
                        evented: isSelected, // Only capture events when visible/selected
                    });
                    existingHandles.midpoint.setCoords();

                    // Ensure handles are always on top of the line
                    canvas.bringObjectToFront(existingHandles.start);
                    canvas.bringObjectToFront(existingHandles.end);
                    canvas.bringObjectToFront(existingHandles.midpoint);
                }
            } else {
                let path: Path | Line;
                if (isLinear) {
                    // Use Line for straight paths (more reliable)
                    path = new Line([line.start.x, line.start.y, line.end.x, line.end.y], {
                        stroke: line.style.color,
                        strokeWidth: line.style.lineThickness,
                        selectable: activeTool === 'select',
                        evented: true,
                        opacity: line.style.opacity,
                        visible: true,
                        hasControls: false,
                        hasBorders: false,
                        lockScalingX: true,
                        lockScalingY: true,
                        lockRotation: true,
                        perPixelTargetFind: true, // Use per-pixel hit detection for precise clicking
                        objectCaching: false, // Disable caching to prevent disappearance artifacts
                        strokeUniform: true,
                    });
                } else {
                    // Use Path for curved lines
                    path = new Path(pathString, {
                        stroke: line.style.color,
                        strokeWidth: line.style.lineThickness,
                        fill: '',
                        selectable: activeTool === 'select',
                        evented: true,
                        opacity: line.style.opacity,
                        visible: true,
                        hasControls: false,
                        hasBorders: false,
                        lockScalingX: true,
                        lockScalingY: true,
                        lockRotation: true,
                        perPixelTargetFind: true, // Use per-pixel hit detection for precise clicking
                        objectCaching: false, // Disable caching to prevent disappearance artifacts
                        strokeUniform: true,
                    });
                }
                // Store line ID on the object for selection handling
                (path as any).lineId = line.id;
                path.setCoords();
                canvas.add(path);
                lineObjectsRef.current.set(line.id, path);

                // Create handles for this line
                const startHandle = createHandle(line.start.x, line.start.y, line.id, 'start', 'line');
                const endHandle = createHandle(line.end.x, line.end.y, line.id, 'end', 'line');
                const midpointHandle = createHandle(line.midpoint.x, line.midpoint.y, line.id, 'midpoint', 'line');

                // Set visibility and evented based on selection
                startHandle.set({ visible: isSelected, evented: isSelected });
                endHandle.set({ visible: isSelected, evented: isSelected });
                midpointHandle.set({ visible: isSelected, evented: isSelected });

                canvas.add(startHandle);
                canvas.add(endHandle);
                canvas.add(midpointHandle);

                lineHandleObjectsRef.current.set(line.id, {
                    start: startHandle,
                    end: endHandle,
                    midpoint: midpointHandle,
                });

            }
        });

        // Add/update arrows
        arrows.forEach(arrow => {
            let existing = arrowObjectsRef.current.get(arrow.id);
            const existingHandles = arrowHandleObjectsRef.current.get(arrow.id);

            // Skip update if this arrow is currently being dragged (to prevent reset)
            if (draggingArrowIdRef.current === arrow.id || draggingArrowHandleRef.current?.arrowId === arrow.id) {
                return;
            }

            const isLinear = shouldSnapToLinear(arrow.midpoint, arrow.start, arrow.end, 1);
            const pathString = isLinear
                ? `M ${arrow.start.x},${arrow.start.y} L ${arrow.end.x},${arrow.end.y}`
                : getCurvedPath(arrow.start, arrow.end, arrow.midpoint);
            const isSelected = selectedArrowId === arrow.id;

            if (existing) {
                // Update existing path
                if (isLinear) {
                    // For linear, update as Line
                    if (existing instanceof Line) {
                        (existing as Line).set({
                            x1: arrow.start.x,
                            y1: arrow.start.y,
                            x2: arrow.end.x,
                            y2: arrow.end.y,
                            selectable: activeTool === 'select',
                            visible: true,
                            hasControls: false,
                            hasBorders: false,
                            lockScalingX: true,
                            lockScalingY: true,
                            lockRotation: true,
                            perPixelTargetFind: true,
                            objectCaching: false,
                            strokeUniform: true,
                        });
                    } else {
                        // Type mismatch: existing is Path but should be Line - need to recreate
                        canvas.remove(existing);
                        const newLine = new Line([arrow.start.x, arrow.start.y, arrow.end.x, arrow.end.y], {
                            stroke: arrow.style.color,
                            strokeWidth: arrow.style.lineThickness,
                            selectable: activeTool === 'select',
                            evented: true,
                            opacity: arrow.style.opacity,
                            visible: true,
                            hasControls: false,
                            hasBorders: false,
                            lockScalingX: true,
                            lockScalingY: true,
                            lockRotation: true,
                            perPixelTargetFind: true,
                            objectCaching: false,
                            strokeUniform: true,
                        });
                        (newLine as any).arrowId = arrow.id;
                        newLine.setCoords();
                        canvas.add(newLine);
                        arrowObjectsRef.current.set(arrow.id, newLine);
                        existing = newLine;
                    }
                } else {
                    // For curved, update path
                    if (existing instanceof Path) {
                        // Recreate Path object to ensure visual consistency
                        canvas.remove(existing);
                        const newPath = new Path(pathString, {
                            stroke: arrow.style.color,
                            strokeWidth: arrow.style.lineThickness,
                            fill: '',
                            selectable: activeTool === 'select',
                            evented: true,
                            opacity: arrow.style.opacity,
                            visible: true,
                            hasControls: false,
                            hasBorders: false,
                            lockScalingX: true,
                            lockScalingY: true,
                            lockRotation: true,
                            perPixelTargetFind: true,
                            objectCaching: false,
                            strokeUniform: true,
                        });
                        (newPath as any).arrowId = arrow.id;
                        newPath.setCoords();
                        canvas.add(newPath);
                        arrowObjectsRef.current.set(arrow.id, newPath);
                        existing = newPath;
                    } else {
                        // Type mismatch: existing is Line but should be Path - need to recreate
                        canvas.remove(existing);
                        const newPath = new Path(pathString, {
                            stroke: arrow.style.color,
                            strokeWidth: arrow.style.lineThickness,
                            fill: '',
                            selectable: activeTool === 'select',
                            evented: true,
                            opacity: arrow.style.opacity,
                            visible: true,
                            hasControls: false,
                            hasBorders: false,
                            lockScalingX: true,
                            lockScalingY: true,
                            lockRotation: true,
                            perPixelTargetFind: true,
                            objectCaching: false,
                            strokeUniform: true,
                        });
                        (newPath as any).arrowId = arrow.id;
                        newPath.setCoords();
                        canvas.add(newPath);
                        arrowObjectsRef.current.set(arrow.id, newPath);
                        existing = newPath;
                    }
                }
                existing.setCoords();

                // Update arrowhead
                // Update arrowhead
                let arrowHead = arrowHeadObjectsRef.current.get(arrow.id);

                // Robustness: Ensure arrow head exists and is on the current canvas
                // This handles cases where refs are stale after a remount or strict mode cycle
                if (!arrowHead || (canvas.getObjects && !canvas.getObjects().includes(arrowHead))) {
                    const angle = isLinear
                        ? Math.atan2(arrow.end.y - arrow.start.y, arrow.end.x - arrow.start.x) * (180 / Math.PI)
                        : getCurveEndAngle(arrow.start, arrow.end, arrow.midpoint);

                    arrowHead = new Triangle({
                        left: arrow.end.x,
                        top: arrow.end.y,
                        originX: 'center',
                        originY: 'center',
                        width: 10,
                        height: 7,
                        fill: arrow.style.color,
                        angle: angle + 90,
                        selectable: false,
                        evented: false,
                        opacity: arrow.style.opacity,
                        visible: true,
                    });
                    arrowHead.setCoords();
                    canvas.add(arrowHead);
                    arrowHeadObjectsRef.current.set(arrow.id, arrowHead);
                }

                if (arrowHead) {
                    const angle = isLinear
                        ? Math.atan2(arrow.end.y - arrow.start.y, arrow.end.x - arrow.start.x) * (180 / Math.PI)
                        : getCurveEndAngle(arrow.start, arrow.end, arrow.midpoint);
                    arrowHead.set({
                        left: arrow.end.x,
                        top: arrow.end.y,
                        angle: angle + 90,
                        fill: arrow.style.color,
                        opacity: arrow.style.opacity,
                        visible: true,
                    });
                    arrowHead.setCoords();
                    // Check if arrowhead is present on canvas (it might have been removed if parent was recreated?)
                    // Actually we just updated it.
                }

                // Update handle positions if they exist
                if (existingHandles) {
                    existingHandles.start.set({
                        left: arrow.start.x - 6,
                        top: arrow.start.y - 6,
                        visible: isSelected,
                        evented: isSelected,
                    });
                    existingHandles.start.setCoords();

                    existingHandles.end.set({
                        left: arrow.end.x - 6,
                        top: arrow.end.y - 6,
                        visible: isSelected,
                        evented: isSelected,
                    });
                    existingHandles.end.setCoords();

                    existingHandles.midpoint.set({
                        left: arrow.midpoint.x - 6,
                        top: arrow.midpoint.y - 6,
                        visible: isSelected,
                        evented: isSelected,
                    });
                    existingHandles.midpoint.setCoords();

                    canvas.bringObjectToFront(existingHandles.start);
                    canvas.bringObjectToFront(existingHandles.end);
                    canvas.bringObjectToFront(existingHandles.midpoint);
                }
            } else {
                let path: Path | Line;
                if (isLinear) {
                    path = new Line([arrow.start.x, arrow.start.y, arrow.end.x, arrow.end.y], {
                        stroke: arrow.style.color,
                        strokeWidth: arrow.style.lineThickness,
                        selectable: activeTool === 'select',
                        evented: true,
                        opacity: arrow.style.opacity,
                        visible: true,
                        hasControls: false,
                        hasBorders: false,
                        lockScalingX: true,
                        lockScalingY: true,
                        lockRotation: true,
                        perPixelTargetFind: true,
                        objectCaching: false,
                        strokeUniform: true,
                    });
                } else {
                    path = new Path(pathString, {
                        stroke: arrow.style.color,
                        strokeWidth: arrow.style.lineThickness,
                        fill: '',
                        selectable: activeTool === 'select',
                        evented: true,
                        opacity: arrow.style.opacity,
                        visible: true,
                        hasControls: false,
                        hasBorders: false,
                        lockScalingX: true,
                        lockScalingY: true,
                        lockRotation: true,
                        perPixelTargetFind: true,
                        objectCaching: false,
                        strokeUniform: true,
                    });
                }
                (path as any).arrowId = arrow.id;
                path.setCoords();
                canvas.add(path);
                arrowObjectsRef.current.set(arrow.id, path);

                // Add arrowhead
                const angle = isLinear
                    ? Math.atan2(arrow.end.y - arrow.start.y, arrow.end.x - arrow.start.x) * (180 / Math.PI)
                    : getCurveEndAngle(arrow.start, arrow.end, arrow.midpoint);
                const arrowHead = new Triangle({
                    left: arrow.end.x,
                    top: arrow.end.y,
                    originX: 'center',
                    originY: 'center',
                    width: 10,
                    height: 7,
                    fill: arrow.style.color,
                    angle: angle + 90,
                    selectable: false,
                    evented: false,
                    opacity: arrow.style.opacity,
                    visible: true,
                    objectCaching: false, // Ensure no caching issues
                });
                arrowHead.setCoords();
                canvas.add(arrowHead);
                arrowHeadObjectsRef.current.set(arrow.id, arrowHead);

                const startHandle = createHandle(arrow.start.x, arrow.start.y, arrow.id, 'start', 'arrow');
                const endHandle = createHandle(arrow.end.x, arrow.end.y, arrow.id, 'end', 'arrow');
                const midpointHandle = createHandle(arrow.midpoint.x, arrow.midpoint.y, arrow.id, 'midpoint', 'arrow');

                startHandle.set({ visible: isSelected, evented: isSelected });
                endHandle.set({ visible: isSelected, evented: isSelected });
                midpointHandle.set({ visible: isSelected, evented: isSelected });

                canvas.add(startHandle);
                canvas.add(endHandle);
                canvas.add(midpointHandle);

                arrowHandleObjectsRef.current.set(arrow.id, {
                    start: startHandle,
                    end: endHandle,
                    midpoint: midpointHandle,
                });
            }
        });

        canvas.requestRenderAll();
    }, [lines, arrows, activeTool, selectedLineId, selectedArrowId]);

    // Update handle visibility when selection changes (without recreating objects)
    useEffect(() => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;



        calloutObjectsRef.current.forEach((objects, calloutId) => {
            const isSelected = calloutId === selectedCalloutId;
            const textBoxBg = objects.find(o => (o as CalloutPart).partType === 'textBoxBg') as Rect | undefined;
            const activeObject = canvas.getActiveObject();
            const isTextBoxBgActive = activeObject === textBoxBg;

            // Check if any other part of THIS callout is currently active
            // If so, we might want to avoid stripping focus from it during an interaction
            const isOtherPartActive = activeObject &&
                (activeObject as CalloutPart).calloutId === calloutId &&
                activeObject !== textBoxBg;

            objects.forEach(obj => {
                const part = obj as CalloutPart;
                if (part.partType === 'arrowTip' || part.partType === 'knee') {
                    part.set('opacity', isSelected ? 1 : 0);
                    // Ensure handle is always visible for hit testing, opacity controls visual
                    part.set('visible', true);
                }
            });

            // Ensure textBoxBg is active when callout is selected to show resize handles
            // BUT: If user is interacting with another part (like dragging a line), don't steal focus yet
            if (isSelected && textBoxBg && !isTextBoxBgActive && !isOtherPartActive) {
                canvas.setActiveObject(textBoxBg);
            } else if (!isSelected && textBoxBg && isTextBoxBgActive) {
                canvas.discardActiveObject();
            }
        });

        canvas.requestRenderAll();
    }, [selectedCalloutId, callouts]);

    // Update line/arrow handle visibility when selection changes
    useEffect(() => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        // Update line handles
        lineHandleObjectsRef.current.forEach((handles, lineId) => {
            const isSelected = selectedLineId === lineId;
            handles.start.set({ visible: isSelected, evented: isSelected });
            handles.start.setCoords();
            handles.end.set({ visible: isSelected, evented: isSelected });
            handles.end.setCoords();
            handles.midpoint.set({ visible: isSelected, evented: isSelected });
            handles.midpoint.setCoords();
        });

        // Update arrow handles
        arrowHandleObjectsRef.current.forEach((handles, arrowId) => {
            const isSelected = selectedArrowId === arrowId;
            handles.start.set({ visible: isSelected, evented: isSelected });
            handles.start.setCoords();
            handles.end.set({ visible: isSelected, evented: isSelected });
            handles.end.setCoords();
            handles.midpoint.set({ visible: isSelected, evented: isSelected });
            handles.midpoint.setCoords();
        });

        canvas.requestRenderAll();
    }, [selectedLineId, selectedArrowId]);

    // Handle tool changes
    useEffect(() => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;


        if (activeTool === 'line' || activeTool === 'arrow' || activeTool === 'callout') {
            canvas.selection = false;
            canvas.defaultCursor = 'crosshair';
            canvas.hoverCursor = 'crosshair';
        } else {
            canvas.selection = true;
            canvas.defaultCursor = 'default';
            canvas.hoverCursor = 'move';
        }
    }, [activeTool]);

    // Auto-focus text when a new callout is created
    useEffect(() => {
        const canvas = fabricCanvasRef.current;
        if (!canvas || !newCalloutIdRef.current) return;

        const newCalloutId = newCalloutIdRef.current;

        // Use setTimeout to ensure the callout objects are created first
        const timer = setTimeout(() => {
            const parts = calloutObjectsRef.current.get(newCalloutId) ?? [];
            const textObj = parts.find(p => (p as CalloutPart).partType === 'text') as Textbox | undefined;

            if (textObj) {
                canvas.setActiveObject(textObj);
                textObj.enterEditing();
                canvas.requestRenderAll();

                // Validation logic: If text is empty on exit or backspace/delete pressed, remove callout
                const cleanupListeners = () => {
                    textObj.off('editing:exited', onEditingExited);
                    document.removeEventListener('keydown', onKeyDown);
                };

                const onEditingExited = () => {
                    cleanupListeners();
                    if (!textObj.text || textObj.text.trim() === '') {
                        setCallouts(prev => prev.filter(c => c.id !== newCalloutId));
                    }
                };

                const onKeyDown = (e: KeyboardEvent) => {
                    // Check if checking against valid object to avoid stale listeners
                    const active = canvas.getActiveObject();
                    if (active !== textObj || !textObj.isEditing) {
                        cleanupListeners();
                        return;
                    }

                    if ((e.key === 'Backspace' || e.key === 'Delete') && (!textObj.text || textObj.text.length === 0)) {
                        e.preventDefault();
                        textObj.exitEditing();
                    }
                };

                textObj.on('editing:exited', onEditingExited);
                document.addEventListener('keydown', onKeyDown);
            }

            // Clear the ref after focusing
            newCalloutIdRef.current = null;
        }, 50);

        return () => clearTimeout(timer);
    }, [callouts]); // Trigger when callouts change (new one added)

    // Handle canvas events
    useEffect(() => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        const handleMouseDown = (opt: TPointerEventInfo<TPointerEvent>) => {
            // Reset drag state on mouse down
            lastDragPosRef.current = null;

            // Reset mouse up flag to allow dragging to start
            isMouseUpRef.current = false;

            const target = canvas.findTarget(opt.e);
            const isModifierHeld = opt.e && ('ctrlKey' in opt.e || 'metaKey' in opt.e) &&
                ((opt.e as MouseEvent).ctrlKey || (opt.e as MouseEvent).metaKey);

            // If Ctrl/Cmd is held and clicking on a callout part, don't create new callout
            if (isModifierHeld && target) {

                return;
            }

            // Handle clicks on callout parts (lines, arrow head) to select the callout
            if (activeTool === 'select' && target) {
                console.log('[Debug] MouseDown on target:', {
                    type: target.type,
                    partType: (target as any).partType,
                    selectable: target.selectable,
                    evented: target.evented,
                    id: (target as any).calloutId,
                    activeObject: canvas.getActiveObject()?.type
                });

                const calloutPart = target as CalloutPart;
                if (calloutPart.calloutId && (calloutPart.partType === 'line1' || calloutPart.partType === 'line2' || calloutPart.partType === 'arrowHead')) {
                    // Find the textBoxBg for this callout and set it as active to show all handles
                    const parts = calloutObjectsRef.current.get(calloutPart.calloutId) ?? [];
                    const textBoxBg = parts.find(p => (p as CalloutPart).partType === 'textBoxBg');

                    // NOTE: Allow Line1/Line2/ArrowHead to be the active object for dragging.
                    // Do NOT force switch to textBoxBg here, because that kills the drag on the line.
                    if (textBoxBg) {
                        console.log('[Debug] Selecting callout via part:', calloutPart.partType);
                        // Just update state, don't swap active object yet
                        setSelectedCalloutId(calloutPart.calloutId);
                        // canvas.setActiveObject(textBoxBg); // DISABLED to allow line drag
                        canvas.requestRenderAll();
                        // return; // Don't return, let fabric handle the selection naturally
                    }
                }

                // Two-click edit: If clicking on text or textBoxBg of an already-selected callout,
                // set pending flag to enter edit mode on mouse up (if user doesn't drag)
                // BUT: Skip if we're in a double-click sequence (double-click will handle it)
                if (calloutPart.calloutId && (calloutPart.partType === 'text' || calloutPart.partType === 'textBoxBg')) {
                    // Check if we're in a double-click window - if so, don't set pending edit
                    // This means the previous click was within the double-click window
                    if (doubleClickTimeoutRef.current) {
                        clearTimeout(doubleClickTimeoutRef.current);
                        doubleClickTimeoutRef.current = null;
                        // Clear any pending edit from previous click since we're handling double-click
                        pendingEditRef.current = null;
                        return;
                    }

                    const wasAlreadySelected = wasSelectedRef.current === calloutPart.calloutId;


                    if (wasAlreadySelected && !isEditingTextRef.current) {
                        // Set a timeout to detect if this is part of a double-click
                        // If a second click comes within 300ms, clear pendingEdit and let double-click handler deal with it
                        doubleClickTimeoutRef.current = setTimeout(() => {
                            doubleClickTimeoutRef.current = null;
                        }, 300);
                        // Set pending edit flag - will enter edit mode on mouse up if no drag occurred
                        pendingEditRef.current = calloutPart.calloutId;
                    } else {
                        // Even if not already selected, set timeout to detect potential double-click
                        // This handles the case where user double-clicks on unselected callout
                        doubleClickTimeoutRef.current = setTimeout(() => {
                            doubleClickTimeoutRef.current = null;
                        }, 300);
                    }
                }
            }

            // Deselect only when clicking empty canvas in Select tool.
            if (activeTool === 'select') {

                // Handle line/arrow selection
                if (target && setSelectedLineId && setSelectedArrowId) {
                    let lineId = (target as any).lineId;
                    let arrowId = (target as any).arrowId;

                    // Support selecting by handle (which has objectId + objectType)
                    if (!lineId && !arrowId && (target as any).objectId) {
                        const objectType = (target as any).objectType;
                        if (objectType === 'line') lineId = (target as any).objectId;
                        if (objectType === 'arrow') arrowId = (target as any).objectId;
                    }

                    if (lineId) {
                        // Capture initial position for potential drag delta calculation
                        // (but don't set dragging refs yet - only set them when actual dragging starts)
                        const handleType = (target as any).handleType;
                        if (handleType) {
                            // For handles, we need to set the ref so the drag can be tracked
                            draggingLineHandleRef.current = { lineId, handleType };
                        }
                        // Note: We don't set draggingLineBodyRef.current here because that would
                        // prevent the useEffect from updating handles. It will be set in handleObjectMoving
                        // when the line actually starts being dragged.

                        // Capture initial position for drag delta calculation
                        const line = linesRef.current.find(l => l.id === lineId);
                        if (line) {
                            if (target instanceof Line) {
                                lineOriginalPosRef.current.set(lineId, {
                                    left: target.left ?? 0,
                                    top: target.top ?? 0,
                                    start: line.start,
                                    end: line.end,
                                    midpoint: line.midpoint,
                                });
                            } else if (target instanceof Path) {
                                const bounds = target.getBoundingRect();
                                lineOriginalPosRef.current.set(lineId, {
                                    left: bounds.left,
                                    top: bounds.top,
                                    start: line.start,
                                    end: line.end,
                                    midpoint: line.midpoint,
                                });
                            }
                        }

                        setSelectedLineId(lineId);
                        setSelectedCalloutId(null);
                        setSelectedArrowId(null);
                        canvas.setActiveObject(target);
                        canvas.requestRenderAll();
                        return;
                    } else if (arrowId) {
                        // Set dragging refs so useEffect knows to skip updates
                        const handleType = (target as any).handleType;
                        draggingArrowIdRef.current = arrowId;
                        if (handleType) {
                            draggingArrowHandleRef.current = { arrowId, handleType };
                        }

                        // START FIX: Capture initial position for drag delta calculation
                        const arrow = arrowsRef.current.find(a => a.id === arrowId);
                        if (arrow) {
                            if (target instanceof Line) {
                                lineOriginalPosRef.current.set(arrowId, {
                                    left: target.left ?? 0,
                                    top: target.top ?? 0,
                                    start: arrow.start,
                                    end: arrow.end,
                                    midpoint: arrow.midpoint,
                                });
                            } else if (target instanceof Path) {
                                const bounds = target.getBoundingRect();
                                lineOriginalPosRef.current.set(arrowId, {
                                    left: bounds.left,
                                    top: bounds.top,
                                    start: arrow.start,
                                    end: arrow.end,
                                    midpoint: arrow.midpoint,
                                });
                            }
                        }
                        // END FIX

                        setSelectedArrowId(arrowId);
                        setSelectedCalloutId(null);
                        setSelectedLineId(null);
                        canvas.setActiveObject(target);
                        canvas.requestRenderAll();
                        return;
                    }
                }

                if (!target && !isEditingTextRef.current) {
                    canvas.discardActiveObject();
                    canvas.requestRenderAll();
                    setSelectedCalloutId(null);
                    if (setSelectedLineId) setSelectedLineId(null);
                    if (setSelectedArrowId) setSelectedArrowId(null);
                }
                return;
            }

            // Don't start callout creation if clicking on existing object
            if (activeTool === 'callout' && !isEditingTextRef.current && !target) {
                const pointer = canvas.getScenePoint(opt.e);
                setIsCreating(true);
                isCreatingRef.current = true;
                setIsCreating(true);
                isCreatingRef.current = true;
                setCreationStart({ x: pointer.x, y: pointer.y });
                creationStartRef.current = { x: pointer.x, y: pointer.y };
                creationToolTypeRef.current = 'callout';

                const style = defaultCalloutStyle;
                const textBoxWidth = 120;
                const textBoxHeight = 40;

                // Create preview textbox
                const previewTextBox = new Rect({
                    left: pointer.x,
                    top: pointer.y,
                    width: textBoxWidth,
                    height: textBoxHeight,
                    fill: style.fillColor === 'transparent' ? 'rgba(255,255,255,0.01)' : style.fillColor,
                    stroke: style.borderColor,
                    strokeWidth: style.lineThickness,
                    strokeDashArray: [5, 5],
                    strokeUniform: true,
                    selectable: false,
                    evented: false,
                    opacity: 0.6,
                    rx: 2,
                    ry: 2,
                });
                previewTextBoxRef.current = previewTextBox;
                canvas.add(previewTextBox);

                // Create preview lines and arrowhead (will be positioned in mouse move)
                const previewLine1 = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
                    stroke: style.borderColor,
                    strokeWidth: style.lineThickness,
                    strokeDashArray: [5, 5],
                    selectable: false,
                    evented: false,
                    opacity: 0.6,
                });
                previewLine1Ref.current = previewLine1;
                canvas.add(previewLine1);

                const previewLine2 = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
                    stroke: style.borderColor,
                    strokeWidth: style.lineThickness,
                    strokeDashArray: [5, 5],
                    selectable: false,
                    evented: false,
                    opacity: 0.6,
                });
                previewLine2Ref.current = previewLine2;
                canvas.add(previewLine2);

                const previewArrowHead = new Triangle({
                    left: pointer.x,
                    top: pointer.y,
                    originX: 'center',
                    originY: 'center',
                    width: 14,
                    height: 18,
                    fill: style.borderColor,
                    selectable: false,
                    evented: false,
                    opacity: 0.6,
                });
                previewArrowHeadRef.current = previewArrowHead;
                canvas.add(previewArrowHead);
            }

            // Handle line/arrow creation
            if ((activeTool === 'line' || activeTool === 'arrow') && !isEditingTextRef.current && !target) {
                const pointer = canvas.getScenePoint(opt.e);
                setIsCreating(true);
                isCreatingRef.current = true;
                setCreationStart({ x: pointer.x, y: pointer.y });
                creationStartRef.current = { x: pointer.x, y: pointer.y };
                setCreationToolType(activeTool);
                creationToolTypeRef.current = activeTool;



                const style = defaultLineStyle;
                const start = { x: pointer.x, y: pointer.y };

                // Create preview line using fabric.Line instead of Path for better update performance
                const previewLine = new Line([start.x, start.y, start.x, start.y], {
                    stroke: style.color,
                    strokeWidth: style.lineThickness,
                    strokeDashArray: [5, 5],
                    selectable: false,
                    evented: false,
                    opacity: 0.6,
                    originX: 'center',
                    originY: 'center'
                });

                previewDragLineRef.current = previewLine;
                canvas.add(previewLine);
                canvas.requestRenderAll();

                const end = { x: pointer.x, y: pointer.y }; // Define end for arrowhead logic
                const midpoint = getMidpoint(start, end);
                const pathString = `M ${start.x},${start.y} L ${end.x},${end.y}`;

                // Create preview arrowhead for Arrow tool
                if (activeTool === 'arrow') {
                    const angle = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);
                    const arrowHead = new Triangle({
                        left: end.x,
                        top: end.y,
                        originX: 'center',
                        originY: 'center',
                        width: 10,
                        height: 7,
                        fill: style.color,
                        angle: angle + 90,
                        selectable: false,
                        evented: false,
                        opacity: 0.6,
                    });
                    previewArrowHeadRef.current = arrowHead;
                    canvas.add(arrowHead);
                }
            } else if ((activeTool === 'line' || activeTool === 'arrow')) {
            }
        };

        const handleMouseMove = (opt: TPointerEventInfo<TPointerEvent>) => {
            // Use ref to check creation state to avoid stale closure issues
            if (!isCreatingRef.current || !creationStartRef.current) {
                return;
            }

            const pointer = canvas.getScenePoint(opt.e);

            // Handle line/arrow preview
            if (creationToolTypeRef.current === 'line' || creationToolTypeRef.current === 'arrow') {
                // Double-check that we're still creating and preview exists
                if (!isCreatingRef.current || !previewDragLineRef.current || !creationStartRef.current) {
                    return;
                }



                const start = creationStartRef.current;
                const end = { x: pointer.x, y: pointer.y };

                // Update Line coordinates directly
                previewDragLineRef.current.set({
                    x1: start.x,
                    y1: start.y,
                    x2: end.x,
                    y2: end.y
                });
                previewDragLineRef.current.setCoords(); // Ensure bbox is updated

                const midpoint = getMidpoint(start, end);
                const pathString = `M ${start.x},${start.y} L ${end.x},${end.y}`;

                // Update preview arrowhead for Arrow tool
                if (creationToolTypeRef.current === 'arrow' && previewArrowHeadRef.current) {
                    const angle = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);
                    previewArrowHeadRef.current.set({
                        left: end.x,
                        top: end.y,
                        angle: angle + 90,
                    });
                    previewArrowHeadRef.current.setCoords();
                }

                canvas.requestRenderAll();
                return;
            }

            if (isCreating && creationStartRef.current) {

                const currentCreationStart = creationStartRef.current;

                // Handle callout preview (existing logic)
                const style = defaultCalloutStyle;
                const textBoxWidth = 120;
                const textBoxHeight = 40;

                // Calculate knee position (midpoint horizontally, 40px above arrow tip)
                const knee: Point = {
                    x: (currentCreationStart.x + pointer.x) / 2,
                    y: currentCreationStart.y - 40,
                };

                // Update preview textbox position
                if (previewTextBoxRef.current) {
                    previewTextBoxRef.current.set({
                        left: pointer.x,
                        top: pointer.y,
                    });
                }

                // Calculate textbox center and closest border point
                const textBoxCenterX = pointer.x + textBoxWidth / 2;
                const textBoxCenterY = pointer.y + textBoxHeight / 2;

                const { line1Start, shouldHideLine1: shouldHide, line2Start, effectiveKnee } = calculateCalloutConnection(
                    pointer.x,
                    pointer.y,
                    textBoxWidth,
                    textBoxHeight,
                    knee,
                    currentCreationStart,
                    style.lineThickness
                );

                // Update preview line 1 (from textbox to knee)
                if (previewLine1Ref.current) {
                    previewLine1Ref.current.set({
                        x1: line1Start.x,
                        y1: line1Start.y,
                        x2: effectiveKnee.x,
                        y2: effectiveKnee.y,
                        opacity: shouldHide ? 0 : 0.6,
                    });
                }

                // Update preview line 2 (from knee to arrow tip)
                if (previewLine2Ref.current) {
                    previewLine2Ref.current.set({
                        x1: line2Start.x,
                        y1: line2Start.y,
                        x2: currentCreationStart.x,
                        y2: currentCreationStart.y,
                    });
                }

                // Update preview arrowhead
                if (previewArrowHeadRef.current) {
                    const angleDeg = (Math.atan2(currentCreationStart.y - effectiveKnee.y, currentCreationStart.x - effectiveKnee.x) * 180) / Math.PI;
                    previewArrowHeadRef.current.set({
                        left: currentCreationStart.x,
                        top: currentCreationStart.y,
                        angle: angleDeg + 90,
                    });
                }

                canvas.renderAll();
            }
        };

        const handleMouseUp = (opt: TPointerEventInfo<TPointerEvent>) => {
            // Set flag to stop processing handleObjectMoving events
            isMouseUpRef.current = true;
            lastDragPosRef.current = null;

            const activeObject = canvas.getActiveObject();
            console.log('[CollisionTrack] handleMouseUp fired. ActiveObject:', activeObject ? 'Found' : 'None', 'Target:', opt.target ? 'Found' : 'None');

            // Immediately deactivate any active object to stop movement
            // REMOVED: Aggressive object locking and deactivation logic that was interfering with state sync
            // The previous logic here (setting activeObject null, discarding active object, preventing events)
            // was preventing handleObjectModified from firing correctly or completing its state updates.



            // Clear dragging state for arrow handles or arrow body if dragging
            // Also check if active object is an arrow (by checking arrows array)
            // Note: activeObject was already retrieved above and may have been discarded
            const activeObjectId = activeObject ? ((activeObject as any).arrowId || (activeObject as any).lineId) : null;
            const isActiveObjectArrow = activeObjectId && arrowsRef.current.find(a => a.id === activeObjectId);

            if (draggingArrowHandleRef.current || draggingArrowIdRef.current || isActiveObjectArrow) {

                // Stop any active object movement by deactivating it
                if (activeObject && (isActiveObjectArrow || (activeObject as any).arrowId || (activeObject as any).lineId)) {
                    // REMOVED: Redundant deactivation logic
                }

                draggingArrowIdRef.current = null;
                draggingArrowHandleRef.current = null;
                canvas.requestRenderAll();
            }

            // Clear dragging state for line handles if dragging
            // Delay clearing to allow state updates to propagate before useEffect runs
            if (draggingLineHandleRef.current || draggingLineBodyRef.current) {
                // #region agent log
                // #endregion
                // Use setTimeout to ensure state updates from setLines have been processed
                setTimeout(() => {
                    draggingLineHandleRef.current = null;
                    draggingLineBodyRef.current = null;
                    // #region agent log
                    // #endregion
                    canvas.requestRenderAll();
                }, 0);
            } // Reset mouse up flag after a short delay to allow queued events to be ignored
            // This prevents handleObjectMoving from processing events that were queued before mouseup
            setTimeout(() => {
                isMouseUpRef.current = false;
            }, 100);



            const pointer = canvas.getScenePoint(opt.e);

            // Handle line/arrow creation
            if (creationToolTypeRef.current === 'line' || creationToolTypeRef.current === 'arrow') {
                // Set ref to false FIRST to stop handleMouseMove from updating
                isCreatingRef.current = false;


                // Remove preview line immediately
                const previewDragLine = previewDragLineRef.current;
                if (previewDragLine) {
                    canvas.remove(previewDragLine);
                    previewDragLineRef.current = null;
                }

                // Cleanup old ref if it exists (sanity check)
                if (previewLinePathRef.current) {
                    canvas.remove(previewLinePathRef.current);
                    previewLinePathRef.current = null;
                }

                // Remove preview arrowhead immediately
                const previewArrowHead = previewArrowHeadRef.current;
                if (previewArrowHead) {
                    canvas.remove(previewArrowHead);
                    previewArrowHeadRef.current = null;
                }

                canvas.requestRenderAll(); // Force immediate render to remove preview

                if (setLines && setArrows && setSelectedLineId && setSelectedArrowId && creationStartRef.current) {
                    const id = uuidv4();
                    const start = creationStartRef.current;
                    const end = { x: pointer.x, y: pointer.y };
                    const midpoint = getMidpoint(start, end);

                    if (creationToolTypeRef.current === 'line') {
                        const newLine: LineType = {
                            id,
                            start,
                            end,
                            midpoint,
                            style: { ...defaultLineStyle },
                            isSelected: true,
                        };
                        setLines(prev => {
                            const updated = prev.map(l => ({ ...l, isSelected: false })).concat(newLine);
                            return updated;
                        });
                        setSelectedLineId(id);
                    } else if (creationToolTypeRef.current === 'arrow') {
                        const newArrow: Arrow = {
                            id,
                            start,
                            end,
                            midpoint,
                            style: { ...defaultLineStyle },
                            isSelected: true,
                        };
                        setArrows(prev => {
                            const updated = prev.map(a => ({ ...a, isSelected: false })).concat(newArrow);
                            return updated;
                        });
                        setSelectedArrowId(id);
                    }
                }

                setIsCreating(false);
                setCreationStart(null);
                setCreationToolType(null);
                creationStartRef.current = null;
                creationToolTypeRef.current = null;
                canvas.requestRenderAll();
                return;
            }

            if (isCreating && creationStartRef.current) {

                const currentCreationStart = creationStartRef.current;

                // Remove preview objects (for callout)
                if (previewLineRef.current) {
                    canvas.remove(previewLineRef.current);
                    previewLineRef.current = null;
                }
                if (previewTextBoxRef.current) {
                    canvas.remove(previewTextBoxRef.current);
                    previewTextBoxRef.current = null;
                }
                if (previewLine1Ref.current) {
                    canvas.remove(previewLine1Ref.current);
                    previewLine1Ref.current = null;
                }
                if (previewLine2Ref.current) {
                    canvas.remove(previewLine2Ref.current);
                    previewLine2Ref.current = null;
                }
                if (previewArrowHeadRef.current) {
                    canvas.remove(previewArrowHeadRef.current);
                    previewArrowHeadRef.current = null;
                }

                // Create new callout
                const id = uuidv4();
                const knee: Point = {
                    x: (currentCreationStart.x + pointer.x) / 2,
                    y: currentCreationStart.y - 40,
                };

                const newCallout: Callout = {
                    id,
                    arrowTip: currentCreationStart,
                    knee,
                    textBoxPosition: { x: pointer.x, y: pointer.y },
                    textBoxWidth: 120,
                    textBoxHeight: 40,
                    text: '',
                    style: { ...defaultCalloutStyle },
                    isSelected: true,
                };

                setCallouts(prev => [...prev, newCallout]);
                setSelectedCalloutId(id);
                newCalloutIdRef.current = id; // Track new callout for auto-focus
                setIsCreating(false);
                isCreatingRef.current = false;
                setCreationStart(null);
                setCreationToolType(null);
                creationStartRef.current = null;
                creationToolTypeRef.current = null;
            } else {
                // Two-click edit: Enter edit mode if pending flag is set (click without drag)
                // The double-click handler will clear pendingEditRef if it actually fires
                // So we can proceed with two-click logic here - if double-click fires, it will override
                if (pendingEditRef.current) {
                    const calloutId = pendingEditRef.current;
                    // Don't clear pendingEditRef yet - let double-click handler clear it if it fires
                    // Use a small delay to allow double-click event to fire first
                    setTimeout(() => {
                        // Only proceed if pendingEditRef is still set (double-click didn't fire)
                        if (pendingEditRef.current === calloutId) {
                            pendingEditRef.current = null;
                            const parts = calloutObjectsRef.current.get(calloutId) ?? [];
                            const textObj = parts.find(p => (p as CalloutPart).partType === 'text') as Textbox | undefined;
                            if (textObj) {
                                canvas.setActiveObject(textObj);
                                textObj.enterEditing();
                                textObj.selectAll();
                                canvas.requestRenderAll();
                            }
                        } else {
                        }
                    }, 50); // Small delay to allow double-click event to fire first
                }

                // Handle Drop Rejection for Callout Parts (Collision Logic)
                // Fallback to activeObject if target is missing (common on fast drags)
                const target = (opt.target || activeObject) as CalloutPart;
                console.log('[CollisionTrack] Target Details:', {
                    type: target?.type,
                    calloutId: target?.calloutId,
                    partType: target?.partType,
                    isCalloutPart: !!(target?.calloutId && target?.partType)
                });

                if (target && target.calloutId && target.partType) {
                    const safeKey = `${target.calloutId}-${target.partType}`;
                    const parts = getParts(target.calloutId);
                    const textBoxBg = parts.get('textBoxBg') as unknown as Rect | undefined;
                    const line2 = parts.get('line2') as unknown as Line | undefined;
                    const line1 = parts.get('line1') as unknown as Line | undefined;
                    const arrowTipHandle = parts.get('arrowTip') as unknown as Rect | undefined;
                    const kneeHandle = parts.get('knee') as unknown as Rect | undefined;

                    // Helper logic to check collision
                    const isColliding = () => {
                        if (!textBoxBg || (!arrowTipHandle && !line2)) return false;
                        const isRelevantPart = target.partType === 'arrowTip' || target.partType === 'textBoxBg' || target.partType === 'text';
                        if (!isRelevantPart) return false;

                        // Get current textbox bounds (using target's position if dragging textbox/text)
                        let boxL = textBoxBg.left ?? 0;
                        let boxT = textBoxBg.top ?? 0;
                        let boxW = textBoxBg.getScaledWidth();
                        let boxH = textBoxBg.getScaledHeight();

                        if (target.partType === 'textBoxBg') {
                            boxL = target.left ?? 0;
                            boxT = target.top ?? 0;
                        } else if (target.partType === 'text') {
                            const PADDING_X = 8;
                            const PADDING_Y = 4;
                            boxL = (target.left ?? 0) - PADDING_X;
                            boxT = (target.top ?? 0) - PADDING_Y;
                        }

                        // Get current arrow tip position (using target's position if dragging arrow)
                        let arrowX = line2!.x2 ?? 0;
                        let arrowY = line2!.y2 ?? 0;
                        if (arrowTipHandle) {
                            arrowX = (arrowTipHandle.left ?? 0) + 6;
                            arrowY = (arrowTipHandle.top ?? 0) + 6;
                        }
                        if (target.partType === 'arrowTip') {
                            arrowX = (target.left ?? 0) + 6;
                            arrowY = (target.top ?? 0) + 6;
                        }

                        // Use minimum distance required for knee to exist between textbox and arrow
                        const buffer = MIN_TEXTBOX_TO_ARROW_DISTANCE;
                        // Check if arrow tip is too close to textbox
                        return (
                            arrowX >= boxL - buffer &&
                            arrowX <= boxL + boxW + buffer &&
                            arrowY >= boxT - buffer &&
                            arrowY <= boxT + boxH + buffer
                        );
                    };

                    // Helper to check if knee handle is too close to arrow handle
                    const isKneeTouchingArrow = () => {
                        if (target.partType !== 'knee' || !kneeHandle || !arrowTipHandle) return false;

                        // Get center of each handle (handles are 12x12)
                        const kneeLeft = target.partType === 'knee' ? (target.left ?? 0) : (kneeHandle.left ?? 0);
                        const kneeTop = target.partType === 'knee' ? (target.top ?? 0) : (kneeHandle.top ?? 0);
                        const kneeCenterX = kneeLeft + 6;
                        const kneeCenterY = kneeTop + 6;

                        const arrowCenterX = (arrowTipHandle.left ?? 0) + 6;
                        const arrowCenterY = (arrowTipHandle.top ?? 0) + 6;

                        // Calculate distance between centers
                        const distance = Math.sqrt(
                            Math.pow(kneeCenterX - arrowCenterX, 2) +
                            Math.pow(kneeCenterY - arrowCenterY, 2)
                        );

                        // Check if too close (should be at least 24px to avoid handle overlap)
                        // Handles are ~12px wide. 24px center-to-center ensures >10px gap.
                        return distance < 24;
                    };

                    // Helper to check if knee handle is too close to textbox edge
                    const isKneeTouchingTextbox = () => {
                        if (target.partType !== 'knee' || !kneeHandle || !textBoxBg) return false;

                        // Get knee center
                        const kneeLeft = target.partType === 'knee' ? (target.left ?? 0) : (kneeHandle.left ?? 0);
                        const kneeTop = target.partType === 'knee' ? (target.top ?? 0) : (kneeHandle.top ?? 0);
                        const kneeCenterX = kneeLeft + 6;
                        const kneeCenterY = kneeTop + 6;

                        // Get textbox bounds
                        const boxL = textBoxBg.left ?? 0;
                        const boxT = textBoxBg.top ?? 0;
                        const boxR = boxL + textBoxBg.getScaledWidth();
                        const boxB = boxT + textBoxBg.getScaledHeight();

                        console.log(`[CollisionTrack] Knee Collision Check: Knee(${kneeCenterX},${kneeCenterY}) Box(${boxL},${boxT},${boxR},${boxB})`);

                        // Calculate distance from knee center to nearest textbox edge
                        const nearestX = Math.max(boxL, Math.min(kneeCenterX, boxR));
                        const nearestY = Math.max(boxT, Math.min(kneeCenterY, boxB));
                        const distance = Math.sqrt(
                            Math.pow(kneeCenterX - nearestX, 2) +
                            Math.pow(kneeCenterY - nearestY, 2)
                        );

                        // Check if knee is inside or too close to textbox
                        return distance < MIN_TEXTBOX_TO_ARROW_DISTANCE / 2;
                    };

                    // Helper for segment intersection
                    const doLinesIntersect = (p1: { x: number, y: number }, p2: { x: number, y: number }, p3: { x: number, y: number }, p4: { x: number, y: number }) => {
                        const denominator = ((p2.x - p1.x) * (p4.y - p3.y)) - ((p2.y - p1.y) * (p4.x - p3.x));
                        if (denominator === 0) return false;
                        const ua = (((p4.x - p3.x) * (p1.y - p3.y)) - ((p4.y - p3.y) * (p1.x - p3.x))) / denominator;
                        const ub = (((p2.x - p1.x) * (p1.y - p3.y)) - ((p2.y - p1.y) * (p1.x - p3.x))) / denominator;
                        return (ua >= 0 && ua <= 1) && (ub >= 0 && ub <= 1);
                    };

                    // Check if Line 2 (Knee to Arrow Tip) intersects Textbox
                    const isLine2IntersectingTextbox = () => {
                        if (!textBoxBg) return false;
                        let boxL = textBoxBg.left ?? 0;
                        let boxT = textBoxBg.top ?? 0;
                        const boxW = textBoxBg.getScaledWidth();
                        const boxH = textBoxBg.getScaledHeight();

                        if (target.partType === 'textBoxBg') {
                            boxL = target.left ?? 0;
                            boxT = target.top ?? 0;
                        } else if (target.partType === 'text') {
                            const PADDING_X = 8;
                            const PADDING_Y = 4;
                            boxL = (target.left ?? 0) - PADDING_X;
                            boxT = (target.top ?? 0) - PADDING_Y;
                        }

                        let kneeX = 0, kneeY = 0;
                        if (target.partType === 'knee') {
                            kneeX = (target.left ?? 0) + 6;
                            kneeY = (target.top ?? 0) + 6;
                        } else if (kneeHandle) {
                            kneeX = (kneeHandle.left ?? 0) + 6;
                            kneeY = (kneeHandle.top ?? 0) + 6;
                        } else if (line1) {
                            kneeX = line1.x2 ?? 0;
                            kneeY = line1.y2 ?? 0;
                        } else { return false; }

                        let tipX = 0, tipY = 0;
                        if (target.partType === 'arrowTip') {
                            tipX = (target.left ?? 0) + 6;
                            tipY = (target.top ?? 0) + 6;
                        } else if (arrowTipHandle) {
                            tipX = (arrowTipHandle.left ?? 0) + 6;
                            tipY = (arrowTipHandle.top ?? 0) + 6;
                        } else if (line2) {
                            tipX = line2.x2 ?? 0;
                            tipY = line2.y2 ?? 0;
                        } else { return false; }

                        const p1 = { x: kneeX, y: kneeY };
                        const p2 = { x: tipX, y: tipY };

                        console.log('[CollisionTrack] Line2 Intersect Check:', {
                            lineStart: p1,
                            lineEnd: p2,
                            box: { left: boxL, top: boxT, right: boxL + boxW, bottom: boxT + boxH },
                        });

                        // Check 4 edges
                        if (doLinesIntersect(p1, p2, { x: boxL, y: boxT }, { x: boxL + boxW, y: boxT })) { console.log('[CollisionTrack] Hit Top Edge'); return true; }
                        if (doLinesIntersect(p1, p2, { x: boxL + boxW, y: boxT }, { x: boxL + boxW, y: boxT + boxH })) { console.log('[CollisionTrack] Hit Right Edge'); return true; }
                        if (doLinesIntersect(p1, p2, { x: boxL + boxW, y: boxT + boxH }, { x: boxL, y: boxT + boxH })) { console.log('[CollisionTrack] Hit Bottom Edge'); return true; }
                        if (doLinesIntersect(p1, p2, { x: boxL, y: boxT + boxH }, { x: boxL, y: boxT })) { console.log('[CollisionTrack] Hit Left Edge'); return true; }
                        return false;
                    };

                    const c1 = isColliding();
                    const c2 = isKneeTouchingArrow();
                    const c3 = isKneeTouchingTextbox();
                    const c4 = isLine2IntersectingTextbox();
                    console.log(`[CollisionTrack] Summary: BoxTouch=${c1}, KneeOverArrow=${c2}, KneeInsideBox=${c3}, Line2CutsBox=${c4}`);




                    // Modified: Revert on 'Hard' collision (Arrow Tip inside Textbox - c1) OR Knee touching Arrow Tip (c2).
                    // We ignore Line intersections (c4) and Knee-Box (c3) due to smart positioning.
                    if (c1 || c2) {
                        console.log('[CollisionTrack] Collision DETECTED (Arrow/Box or Knee/Arrow). Attempting to revert...');

                        // COLLISION ON DROP - REJECT and snap back to initial position before drag
                        const initialPos = lastSafeObjectPosRef.current.get(safeKey);
                        if (initialPos) {
                            console.log('[CollisionTrack] Reverting to safe position:', initialPos);
                            // Get initial positions for ALL parts from storage
                            const initialTextBoxBg = lastSafeObjectPosRef.current.get(`${target.calloutId}-textBoxBg`);
                            const initialText = lastSafeObjectPosRef.current.get(`${target.calloutId}-text`);
                            const initialArrowTipHandle = lastSafeObjectPosRef.current.get(`${target.calloutId}-arrowTipHandle`);
                            const initialKneeHandle = lastSafeObjectPosRef.current.get(`${target.calloutId}-kneeHandle`);

                            // Snap back the dragged object to initial position
                            target.set({
                                left: initialPos.left,
                                top: initialPos.top
                            });
                            // Update control handles position
                            target.setCoords();

                            // Sync followers manually
                            const PADDING_X = 8;
                            const PADDING_Y = 4;
                            if (target.partType === 'textBoxBg') {
                                // textBoxBg is the target, sync text to follow
                                if (parts.get('text') && initialPos) {
                                    const textObj = parts.get('text') as unknown as Textbox;
                                    textObj.set({
                                        left: initialPos.left + PADDING_X,
                                        top: initialPos.top + PADDING_Y
                                    });
                                    textObj.setCoords();
                                }
                                // Also explicitly set textBoxBg to initial position (in case it wasn't the target)
                                if (textBoxBg && textBoxBg !== target && initialPos) {
                                    textBoxBg.set({
                                        left: initialPos.left,
                                        top: initialPos.top
                                    });
                                    textBoxBg.setCoords();
                                }
                            } else if (target.partType === 'text') {
                                // text is the target, sync textBoxBg to follow
                                if (parts.get('textBoxBg') && initialPos) {
                                    const bgRect = parts.get('textBoxBg') as unknown as Rect;
                                    bgRect.set({
                                        left: initialPos.left - PADDING_X,
                                        top: initialPos.top - PADDING_Y
                                    });
                                    bgRect.setCoords();
                                }
                                // Also update text object coordinates
                                target.setCoords();
                            }

                            // Restore ALL handles to their initial positions BEFORE calculating lines
                            const line1 = parts.get('line1') as unknown as Line | undefined;
                            const arrowHead = parts.get('arrowHead') as unknown as Triangle | undefined;
                            const kneeHandle = parts.get('knee') as unknown as Rect | undefined;

                            // Restore knee handle to initial position
                            if (kneeHandle) {
                                const kneeInitialPos = target.partType === 'knee' && initialPos
                                    ? initialPos
                                    : (initialKneeHandle || null);
                                if (kneeInitialPos) {
                                    kneeHandle.set({
                                        left: kneeInitialPos.left,
                                        top: kneeInitialPos.top
                                    });
                                    kneeHandle.setCoords();
                                }
                            }

                            // Restore arrow tip handle to initial position (if not the target)
                            if (arrowTipHandle && initialArrowTipHandle && target.partType !== 'arrowTip') {
                                arrowTipHandle.set({
                                    left: initialArrowTipHandle.left,
                                    top: initialArrowTipHandle.top
                                });
                                arrowTipHandle.setCoords();
                            }

                            // Also restore arrow tip handle if it IS the target
                            if (arrowTipHandle && target.partType === 'arrowTip' && initialPos) {
                                arrowTipHandle.set({
                                    left: initialPos.left,
                                    top: initialPos.top
                                });
                                arrowTipHandle.setCoords();
                            }

                            if (line1 && line2 && textBoxBg) {
                                // Use initial positions for all parts when calculating line geometry
                                const boxL = initialTextBoxBg ? initialTextBoxBg.left : (textBoxBg.left ?? 0);
                                const boxT = initialTextBoxBg ? initialTextBoxBg.top : (textBoxBg.top ?? 0);
                                const width = textBoxBg.getScaledWidth();
                                const height = textBoxBg.getScaledHeight();

                                // Use initial knee position
                                const kneeInitialPos = target.partType === 'knee' && initialPos
                                    ? initialPos
                                    : (initialKneeHandle || null);
                                const kneeX = kneeInitialPos ? (kneeInitialPos.left + 6) : (kneeHandle ? (kneeHandle.left! + 6) : (line1.x2 ?? 0));
                                const kneeY = kneeInitialPos ? (kneeInitialPos.top + 6) : (kneeHandle ? (kneeHandle.top! + 6) : (line1.y2 ?? 0));

                                // Use initial arrow tip position
                                const arrowX = target.partType === 'arrowTip' && initialPos
                                    ? initialPos.left + 6
                                    : (initialArrowTipHandle ? (initialArrowTipHandle.left + 6) : (arrowTipHandle ? (arrowTipHandle.left! + 6) : (line2.x2 ?? 0)));
                                const arrowY = target.partType === 'arrowTip' && initialPos
                                    ? initialPos.top + 6
                                    : (initialArrowTipHandle ? (initialArrowTipHandle.top + 6) : (arrowTipHandle ? (arrowTipHandle.top! + 6) : (line2.y2 ?? 0)));

                                const callout = callouts.find(c => c.id === target.calloutId);
                                const { line1Start, shouldHideLine1: shouldHide, line2Start, effectiveKnee } = calculateCalloutConnection(
                                    boxL, boxT, width, height, { x: kneeX, y: kneeY }, { x: arrowX, y: arrowY }, callout?.style.lineThickness ?? 0
                                );

                                // Update line1 to snap back
                                line1.set({
                                    x1: line1Start.x,
                                    y1: line1Start.y,
                                    x2: effectiveKnee.x,
                                    y2: effectiveKnee.y,
                                    opacity: shouldHide ? 0 : (line1.opacity || 1)
                                });

                                // Update line2 to snap back to initial arrow position
                                line2.set({
                                    x1: line2Start.x,
                                    y1: line2Start.y,
                                    x2: arrowX,
                                    y2: arrowY
                                });

                                // Update arrow head to snap back
                                if (arrowHead) {
                                    const ad = (Math.atan2(arrowY - effectiveKnee.y, arrowX - effectiveKnee.x) * 180) / Math.PI;
                                    arrowHead.set({
                                        angle: ad + 90,
                                        left: arrowX,
                                        top: arrowY
                                    });
                                }

                                // Update knee handle position to match effective knee (in case it changed due to clipping)
                                if (kneeHandle) {
                                    kneeHandle.set({
                                        left: effectiveKnee.x - 6,
                                        top: effectiveKnee.y - 6
                                    });
                                    kneeHandle.setCoords();
                                }
                            }

                            // Update callout state to reflect snap back to initial position for ALL parts
                            if (target.partType === 'arrowTip') {
                                setCallouts(prev => prev.map(c => {
                                    if (c.id !== target.calloutId) return c;
                                    const restoredKnee = initialKneeHandle ? { x: initialKneeHandle.left + 6, y: initialKneeHandle.top + 6 } : c.knee;
                                    return {
                                        ...c,
                                        arrowTip: { x: initialPos.left + 6, y: initialPos.top + 6 },
                                        knee: restoredKnee,
                                        textBoxPosition: initialTextBoxBg ? { x: initialTextBoxBg.left, y: initialTextBoxBg.top } : c.textBoxPosition
                                    };
                                }));
                            } else if (target.partType === 'textBoxBg') {
                                setCallouts(prev => prev.map(c => {
                                    if (c.id !== target.calloutId) return c;
                                    const restoredKnee = initialKneeHandle ? { x: initialKneeHandle.left + 6, y: initialKneeHandle.top + 6 } : c.knee;
                                    const restoredArrowTip = initialArrowTipHandle ? { x: initialArrowTipHandle.left + 6, y: initialArrowTipHandle.top + 6 } : c.arrowTip;
                                    return {
                                        ...c,
                                        textBoxPosition: { x: initialPos.left, y: initialPos.top },
                                        knee: restoredKnee,
                                        arrowTip: restoredArrowTip
                                    };
                                }));
                            } else if (target.partType === 'text') {
                                // For text, initialPos is the text position, need to subtract padding to get textBoxPosition
                                setCallouts(prev => prev.map(c => {
                                    if (c.id !== target.calloutId) return c;
                                    const restoredKnee = initialKneeHandle ? { x: initialKneeHandle.left + 6, y: initialKneeHandle.top + 6 } : c.knee;
                                    const restoredArrowTip = initialArrowTipHandle ? { x: initialArrowTipHandle.left + 6, y: initialArrowTipHandle.top + 6 } : c.arrowTip;
                                    return {
                                        ...c,
                                        textBoxPosition: { x: initialPos.left - PADDING_X, y: initialPos.top - PADDING_Y },
                                        knee: restoredKnee,
                                        arrowTip: restoredArrowTip
                                    };
                                }));
                            } else if (target.partType === 'knee') {
                                // If knee was dragged, restore textbox and arrow tip too
                                setCallouts(prev => prev.map(c => {
                                    if (c.id !== target.calloutId) return c;
                                    const restoredArrowTip = initialArrowTipHandle ? { x: initialArrowTipHandle.left + 6, y: initialArrowTipHandle.top + 6 } : c.arrowTip;
                                    const restoredKnee = initialPos ? { x: initialPos.left + 6, y: initialPos.top + 6 } : c.knee;
                                    return {
                                        ...c,
                                        knee: restoredKnee,
                                        arrowTip: restoredArrowTip,
                                        textBoxPosition: initialTextBoxBg ? { x: initialTextBoxBg.left, y: initialTextBoxBg.top } : c.textBoxPosition
                                    };
                                }));
                            }

                            canvas.requestRenderAll();
                        }
                    }
                }
            }

            // Clear safe collision state
            lastSafeObjectPosRef.current.clear();

            // Improve UX: If user was interacting with line/arrowHead, switch selection to textBoxBg
            // so they see the handles again (since lines have no handles)
            // Improve UX: If user was interacting with line/arrowHead, switch selection to textBoxBg
            // so they see the handles again (since lines have no handles)
            // Use opt.target if available, otherwise fall back to activeObject
            const activeCalloutPart = (opt.target || activeObject) as CalloutPart | null;
            if (activeCalloutPart && activeCalloutPart.calloutId &&
                (activeCalloutPart.partType === 'line1' || activeCalloutPart.partType === 'line2' || activeCalloutPart.partType === 'arrowHead')) {

                const parts = calloutObjectsRef.current.get(activeCalloutPart.calloutId);
                const textBoxBg = parts?.find(p => (p as CalloutPart).partType === 'textBoxBg');

                if (textBoxBg) {
                    // Use a small timeout to let drag finish cleanly before swapping selection
                    setTimeout(() => {
                        canvas.setActiveObject(textBoxBg);
                        canvas.requestRenderAll();
                    }, 50);
                }
            }
        };

        const handleSelection = () => {
            const activeObject = canvas.getActiveObject();

            // Handle ActiveSelection groups (created when dragging to select)
            // Check if it's a Group/ActiveSelection by checking for _objects property
            if (activeObject && '_objects' in activeObject && Array.isArray((activeObject as any)._objects)) {
                const activeSelection = activeObject as any;
                const objects = activeSelection._objects || [];

                // Find textBoxBg and calloutId from the selected objects
                let textBoxBg: Rect | undefined;
                let calloutId: string | undefined;

                // First, try to find textBoxBg directly in the selection
                for (const obj of objects) {
                    const part = obj as CalloutPart;
                    if (part.partType === 'textBoxBg') {
                        textBoxBg = obj as Rect;
                        calloutId = part.calloutId;
                        break;
                    }
                }

                // If no textBoxBg found, get calloutId from any part and find textBoxBg from callout parts
                if (!textBoxBg) {
                    for (const obj of objects) {
                        const part = obj as CalloutPart;
                        if (part.calloutId) {
                            calloutId = part.calloutId;
                            const parts = calloutObjectsRef.current.get(calloutId) ?? [];
                            textBoxBg = parts.find(p => (p as CalloutPart).partType === 'textBoxBg') as Rect | undefined;
                            if (textBoxBg) break;
                        }
                    }
                }

                // Replace ActiveSelection with textBoxBg
                if (textBoxBg && calloutId && !isEditingTextRef.current) {
                    setTimeout(() => {
                        wasSelectedRef.current = calloutId ?? null;
                        setSelectedCalloutId(calloutId);
                        canvas.setActiveObject(textBoxBg);
                        canvas.requestRenderAll();
                    }, 0);
                }
                return;
            }

            const calloutPart = activeObject as CalloutPart | null;

            if (calloutPart?.calloutId) {
                // Update wasSelectedRef for two-click edit detection
                // Use setTimeout to update after the current event cycle
                setTimeout(() => {
                    wasSelectedRef.current = calloutPart.calloutId ?? null;
                }, 0);
                setSelectedCalloutId(calloutPart.calloutId);

                const parts = calloutObjectsRef.current.get(calloutPart.calloutId) ?? [];
                const textBoxBg = parts.find(p => (p as CalloutPart).partType === 'textBoxBg') as Rect | undefined;



                // Always set textBoxBg as active when any part of the callout is selected
                // (except when editing text, to allow text editing)
                // This ensures resize handles are always visible
                if (textBoxBg && !isEditingTextRef.current) {
                    // Set textBoxBg as active for all part types except 'knee' and 'arrowTip'
                    // (to allow handle dragging, but show textBoxBg handles for text/textBoxBg selection)
                    // This includes: line1, line2, arrowHead, textBoxBg, text

                    // FIXED: Exclude line1, line2, arrowHead from forced textBoxBg selection 
                    // to allow them to be dragged directly.
                    if (!calloutPart.partType ||
                        // calloutPart.partType === 'line1' || // DISABLED
                        // calloutPart.partType === 'line2' || // DISABLED
                        // calloutPart.partType === 'arrowHead' || // DISABLED
                        calloutPart.partType === 'textBoxBg') {

                        // Use setTimeout to avoid interfering with Fabric's selection process
                        setTimeout(() => {
                            canvas.setActiveObject(textBoxBg);
                            canvas.requestRenderAll();
                        }, 0);
                    }
                }
            }
        };

        const handleSelectionCleared = (opt?: any) => {
            // Only clear when user clicks empty canvas while in Select tool.
            if (activeTool !== 'select') return;

            // When dragging/moving, Fabric may briefly clear selection; don't clear our selection state.
            const isTransforming = Boolean((canvas as any)._currentTransform);
            if (isTransforming) return;

            if (isEditingTextRef.current) return;

            const clickedTarget = opt?.e ? canvas.findTarget(opt.e) : null;
            if (clickedTarget) return;

            // Clear wasSelectedRef when selection is cleared
            wasSelectedRef.current = null;
            setSelectedCalloutId(null);
        };

        const getParts = (calloutId: string) => {
            const parts = calloutObjectsRef.current.get(calloutId) ?? [];
            const byType = new Map<string, CalloutPart>();
            parts.forEach((p) => {
                const part = p as CalloutPart;
                if (part.partType) byType.set(part.partType, part);
            });
            return byType;
        };



        const handleObjectMoving = (opt: { target: FabricObject; e: MouseEvent | TouchEvent }) => {
            const target = opt.target as CalloutPart;

            // Callout Logic
            if (target.calloutId && target.partType) {
                // Clear pending edit flag
                pendingEditRef.current = null;

                // Keep selected
                setSelectedCalloutId(target.calloutId);

                const parts = getParts(target.calloutId);
                const line1 = parts.get('line1') as unknown as Line | undefined;
                const line2 = parts.get('line2') as unknown as Line | undefined;
                const arrowHead = parts.get('arrowHead') as unknown as Triangle | undefined;
                const textBoxBg = parts.get('textBoxBg') as unknown as Rect | undefined;
                const textObj = parts.get('text') as unknown as Textbox | undefined;
                const arrowTipHandle = parts.get('arrowTip') as unknown as Rect | undefined;
                const kneeHandle = parts.get('knee') as unknown as Rect | undefined;

                if (!line1 || !line2) return;

                // Helper: Get Target's ID for tracking safe pos
                const safeKey = `${target.calloutId}-${target.partType}`;

                // Init initial drag position if missing
                if (!lastSafeObjectPosRef.current.has(safeKey)) {
                    if (textBoxBg) lastSafeObjectPosRef.current.set(`${target.calloutId}-textBoxBg`, { left: textBoxBg.left ?? 0, top: textBoxBg.top ?? 0 });
                    if (textObj) lastSafeObjectPosRef.current.set(`${target.calloutId}-text`, { left: textObj.left ?? 0, top: textObj.top ?? 0 });
                    if (arrowTipHandle) lastSafeObjectPosRef.current.set(`${target.calloutId}-arrowTipHandle`, { left: arrowTipHandle.left ?? 0, top: arrowTipHandle.top ?? 0 });
                    const arrowX = arrowTipHandle ? (arrowTipHandle.left! + 6) : (line2.x2 ?? 0);
                    const arrowY = arrowTipHandle ? (arrowTipHandle.top! + 6) : (line2.y2 ?? 0);
                    lastSafeObjectPosRef.current.set(`${target.calloutId}-arrowTip`, { left: arrowX - 6, top: arrowY - 6 });
                    if (kneeHandle) lastSafeObjectPosRef.current.set(`${target.calloutId}-kneeHandle`, { left: kneeHandle.left ?? 0, top: kneeHandle.top ?? 0 });
                    lastSafeObjectPosRef.current.set(safeKey, { left: target.left ?? 0, top: target.top ?? 0 });
                    console.log('[Debug] Initial safe positions saved:', Array.from(lastSafeObjectPosRef.current.entries()));
                }

                const PADDING_X = 8;
                const PADDING_Y = 4;

                // Check for Ctrl/Cmd key - move entire callout
                // OR if the target is one of the lines (line1/line2) - moving a line moves the whole callout
                const isWholeMove = (opt.e && ('ctrlKey' in opt.e || 'metaKey' in opt.e) &&
                    ((opt.e as MouseEvent).ctrlKey || (opt.e as MouseEvent).metaKey)) ||
                    target.partType === 'line1' || target.partType === 'line2';

                if (isWholeMove) {
                    const currentX = target.left ?? 0;
                    const currentY = target.top ?? 0;

                    if (!lastDragPosRef.current) {
                        lastDragPosRef.current = { x: currentX, y: currentY };
                        return;
                    }

                    const dx = currentX - lastDragPosRef.current.x;
                    const dy = currentY - lastDragPosRef.current.y;

                    if (textBoxBg && target.partType !== 'textBoxBg') textBoxBg.set({ left: (textBoxBg.left ?? 0) + dx, top: (textBoxBg.top ?? 0) + dy });
                    if (textObj && target.partType !== 'text') textObj.set({ left: (textObj.left ?? 0) + dx, top: (textObj.top ?? 0) + dy });
                    if (arrowTipHandle && target.partType !== 'arrowTip') arrowTipHandle.set({ left: (arrowTipHandle.left ?? 0) + dx, top: (arrowTipHandle.top ?? 0) + dy });
                    if (kneeHandle && target.partType !== 'knee') kneeHandle.set({ left: (kneeHandle.left ?? 0) + dx, top: (kneeHandle.top ?? 0) + dy });
                    // Always move arrowHead as it's not a direct drag target (it's part of line2 group logically)
                    if (arrowHead && target.partType !== 'arrowHead') arrowHead.set({ left: (arrowHead.left ?? 0) + dx, top: (arrowHead.top ?? 0) + dy });

                    // Only update lines if they are NOT the target (Fabric handles the target)
                    if (line1 && target.partType !== 'line1') {
                        line1.set({ x1: (line1.x1 ?? 0) + dx, y1: (line1.y1 ?? 0) + dy, x2: (line1.x2 ?? 0) + dx, y2: (line1.y2 ?? 0) + dy });
                    }
                    if (line2 && target.partType !== 'line2') {
                        line2.set({ x1: (line2.x1 ?? 0) + dx, y1: (line2.y1 ?? 0) + dy, x2: (line2.x2 ?? 0) + dx, y2: (line2.y2 ?? 0) + dy });
                    }

                    lastDragPosRef.current = { x: currentX, y: currentY };
                    canvas.requestRenderAll();
                    return;
                }

                // Reset last drag pos when not whole move
                lastDragPosRef.current = null;

                const updateLine1StartFromBox = (preserveKneePosition: boolean = false) => {
                    if (!textBoxBg) return;

                    const boxLeft = textBoxBg.left ?? 0;
                    const boxTop = textBoxBg.top ?? 0;
                    const width = textBoxBg.getScaledWidth();
                    const height = textBoxBg.getScaledHeight();

                    let kneeX = line1.x2 ?? 0;
                    let kneeY = line1.y2 ?? 0;

                    if (preserveKneePosition && kneeHandle) {
                        const initialKneePos = lastSafeObjectPosRef.current.get(`${target.calloutId}-kneeHandle`);
                        if (initialKneePos) {
                            kneeX = initialKneePos.left + 6;
                            kneeY = initialKneePos.top + 6;
                        }
                    }

                    const arrowTipX = line2.x2 ?? 0;
                    const arrowTipY = line2.y2 ?? 0;

                    const callout = callouts.find(c => c.id === target.calloutId);
                    const { line1Start, shouldHideLine1: shouldHide, line2Start: initialLine2Start, effectiveKnee } = calculateCalloutConnection(
                        boxLeft, boxTop, width, height,
                        { x: kneeX, y: kneeY },
                        { x: arrowTipX, y: arrowTipY },
                        callout?.style.lineThickness ?? 0
                    );

                    let kneeForLines = preserveKneePosition ? { x: kneeX, y: kneeY } : effectiveKnee;
                    let line2Start = preserveKneePosition ? { x: kneeX, y: kneeY } : (initialLine2Start ? { ...initialLine2Start } : { x: effectiveKnee.x, y: effectiveKnee.y });

                    if (!line1 || !line2) return;

                    line1.set({ x1: line1Start.x, y1: line1Start.y, x2: kneeForLines.x, y2: kneeForLines.y, opacity: shouldHide ? 0 : (line1.opacity || 1) });
                    line2.set({ x1: line2Start.x, y1: line2Start.y, x2: arrowTipX, y2: arrowTipY });

                    if (kneeHandle && !preserveKneePosition) {
                        kneeHandle.set({ left: effectiveKnee.x - 6, top: effectiveKnee.y - 6 });
                    }
                    if (arrowHead) {
                        const angleDeg = (Math.atan2(arrowTipY - kneeForLines.y, arrowTipX - kneeForLines.x) * 180) / Math.PI;
                        arrowHead.set({
                            left: arrowTipX,
                            top: arrowTipY,
                            angle: angleDeg + 90
                        });
                        arrowHead.setCoords();
                    }
                };

                if (target.partType === 'textBoxBg' || target.partType === 'text') {
                    let newBoxLeft = target.partType === 'text' ? (target.left ?? 0) - PADDING_X : (textBoxBg?.left ?? 0);
                    let newBoxTop = target.partType === 'text' ? (target.top ?? 0) - PADDING_Y : (textBoxBg?.top ?? 0);

                    if (textBoxBg && textObj) {
                        // Check constraints before applying
                        if (kneeHandle) {
                            const kneeX = (kneeHandle.left ?? 0) + 6;
                            const kneeY = (kneeHandle.top ?? 0) + 6;
                            const width = textBoxBg.getScaledWidth();
                            const height = textBoxBg.getScaledHeight();

                            const clampedX = Math.max(newBoxLeft, Math.min(kneeX, newBoxLeft + width));
                            const clampedY = Math.max(newBoxTop, Math.min(kneeY, newBoxTop + height));

                            let dist = Math.sqrt(Math.pow(kneeX - clampedX, 2) + Math.pow(kneeY - clampedY, 2));

                            // Robust "Pop Out" logic if overlapping or too close
                            if (dist < MIN_HANDLE_DISTANCE) {
                                // If perfectly inside or extremely close, force a direction towards the nearest edge
                                if (dist < 0.1) {
                                    // Find distance to each edge
                                    const dLeft = Math.abs(kneeX - newBoxLeft);
                                    const dRight = Math.abs(kneeX - (newBoxLeft + width));
                                    const dTop = Math.abs(kneeY - newBoxTop);
                                    const dBottom = Math.abs(kneeY - (newBoxTop + height));

                                    const minD = Math.min(dLeft, dRight, dTop, dBottom);

                                    // Push away from nearest edge
                                    if (minD === dLeft) newBoxLeft += (MIN_HANDLE_DISTANCE + 1); // Push box RIGHT so knee is LEFT
                                    else if (minD === dRight) newBoxLeft -= (MIN_HANDLE_DISTANCE + 1); // Push box LEFT
                                    else if (minD === dTop) newBoxTop += (MIN_HANDLE_DISTANCE + 1); // Push box DOWN
                                    else newBoxTop -= (MIN_HANDLE_DISTANCE + 1); // Push box UP

                                } else {
                                    // Standard push away
                                    const pushDist = MIN_HANDLE_DISTANCE - dist + 1;
                                    const angle = Math.atan2(clampedY - kneeY, clampedX - kneeX);
                                    const pushX = Math.cos(angle) * pushDist;
                                    const pushY = Math.sin(angle) * pushDist;

                                    newBoxLeft += pushX;
                                    newBoxTop += pushY;
                                }
                            }
                        }

                        // Apply confirmed positions (potentially adjusted)
                        textBoxBg.set({ left: newBoxLeft, top: newBoxTop });
                        textBoxBg.setCoords();
                        textObj.set({ left: newBoxLeft + PADDING_X, top: newBoxTop + PADDING_Y });
                        if (target.partType === 'text') target.set({ left: newBoxLeft + PADDING_X, top: newBoxTop + PADDING_Y });
                        if (target.partType === 'textBoxBg') target.set({ left: newBoxLeft, top: newBoxTop }); // Ensure target is synced if adjusted
                    }

                    // Maintain absolute knee position
                    if (kneeHandle) {
                        const initialKneePos = lastSafeObjectPosRef.current.get(`${target.calloutId}-kneeHandle`);
                        if (initialKneePos) {
                            kneeHandle.set({ left: initialKneePos.left, top: initialKneePos.top });
                            kneeHandle.setCoords();
                        }
                    }
                    updateLine1StartFromBox(true);
                    canvas.requestRenderAll();
                    return;
                }

                if (target.partType === 'arrowTip') {
                    let tipX = (target.left ?? 0) + 6;
                    let tipY = (target.top ?? 0) + 6;

                    // Constraint: Distance from Knee
                    if (kneeHandle) {
                        const kneeX = (kneeHandle.left ?? 0) + 6;
                        const kneeY = (kneeHandle.top ?? 0) + 6;
                        const dist = Math.sqrt(Math.pow(tipX - kneeX, 2) + Math.pow(tipY - kneeY, 2));

                        if (dist < MIN_HANDLE_DISTANCE) {
                            // Clamp to minimum distance
                            const angle = Math.atan2(tipY - kneeY, tipX - kneeX);
                            tipX = kneeX + Math.cos(angle) * MIN_HANDLE_DISTANCE;
                            tipY = kneeY + Math.sin(angle) * MIN_HANDLE_DISTANCE;

                            // Update target position
                            target.left = tipX - 6;
                            target.top = tipY - 6;
                        }
                    }

                    line2.set({ x2: tipX, y2: tipY });
                    updateLine1StartFromBox();
                    canvas.requestRenderAll();
                    return;
                }

                if (target.partType === 'arrowHead') {
                    // ArrowHead origin is center, so left/top are the tip coordinates
                    let tipX = target.left ?? 0;
                    let tipY = target.top ?? 0;

                    // Constraint: Distance from Knee
                    if (kneeHandle) {
                        const kneeX = (kneeHandle.left ?? 0) + 6;
                        const kneeY = (kneeHandle.top ?? 0) + 6;
                        const dist = Math.sqrt(Math.pow(tipX - kneeX, 2) + Math.pow(tipY - kneeY, 2));

                        if (dist < MIN_HANDLE_DISTANCE) {
                            // Clamp to minimum distance
                            const angle = Math.atan2(tipY - kneeY, tipX - kneeX);
                            tipX = kneeX + Math.cos(angle) * MIN_HANDLE_DISTANCE;
                            tipY = kneeY + Math.sin(angle) * MIN_HANDLE_DISTANCE;

                            // Update target position
                            target.left = tipX;
                            target.top = tipY;
                        }
                    }

                    line2.set({ x2: tipX, y2: tipY });

                    // Also update the arrowTip handle so state persists correctly
                    if (arrowTipHandle) {
                        arrowTipHandle.set({
                            left: tipX - 6,
                            top: tipY - 6
                        });
                        arrowTipHandle.setCoords();
                    }

                    updateLine1StartFromBox();
                    canvas.requestRenderAll();
                    return;
                }

                if (target.partType === 'knee') {
                    let kneeX = (target.left ?? 0) + 6;
                    let kneeY = (target.top ?? 0) + 6;

                    // Constraint 1: Distance from Arrow Tip
                    if (arrowTipHandle) { // Tip handle is the truth if it exists
                        const tipX = (arrowTipHandle.left ?? 0) + 6;
                        const tipY = (arrowTipHandle.top ?? 0) + 6;
                        const dist = Math.sqrt(Math.pow(kneeX - tipX, 2) + Math.pow(kneeY - tipY, 2));

                        if (dist < MIN_HANDLE_DISTANCE) {
                            const angle = Math.atan2(kneeY - tipY, kneeX - tipX);
                            kneeX = tipX + Math.cos(angle) * MIN_HANDLE_DISTANCE;
                            kneeY = tipY + Math.sin(angle) * MIN_HANDLE_DISTANCE;
                        }
                    } else if (line2) { // Fallback to line2 end
                        const tipX = line2.x2 ?? 0;
                        const tipY = line2.y2 ?? 0;
                        const dist = Math.sqrt(Math.pow(kneeX - tipX, 2) + Math.pow(kneeY - tipY, 2));

                        if (dist < MIN_HANDLE_DISTANCE) {
                            const angle = Math.atan2(kneeY - tipY, kneeX - tipX);
                            kneeX = tipX + Math.cos(angle) * MIN_HANDLE_DISTANCE;
                            kneeY = tipY + Math.sin(angle) * MIN_HANDLE_DISTANCE;
                        }
                    }

                    // Constraint 2: Distance from Text Box (Rect)
                    // We need to calculate where the box is relative to this NEW knee position
                    if (textBoxBg) {
                        const boxLeft = textBoxBg.left ?? 0;
                        const boxTop = textBoxBg.top ?? 0;
                        const width = textBoxBg.getScaledWidth();
                        const height = textBoxBg.getScaledHeight();

                        // Calculate closest point on the box rectangle to the knee
                        const clampedX = Math.max(boxLeft, Math.min(kneeX, boxLeft + width));
                        const clampedY = Math.max(boxTop, Math.min(kneeY, boxTop + height));

                        const dist = Math.sqrt(Math.pow(kneeX - clampedX, 2) + Math.pow(kneeY - clampedY, 2));

                        if (dist < MIN_HANDLE_DISTANCE) {
                            // Constraint violation. Clamp knee to minimum distance from closest point.
                            // We need to push the knee out along the vector from closest point to knee
                            let angle = Math.atan2(kneeY - clampedY, kneeX - clampedX);

                            // Edge case: if literally inside center (dist=0) or extremely close (overlap), pop out to nearest edge
                            if (dist < 0.1) {
                                const dLeft = Math.abs(kneeX - boxLeft);
                                const dRight = Math.abs(kneeX - (boxLeft + width));
                                const dTop = Math.abs(kneeY - boxTop);
                                const dBottom = Math.abs(kneeY - (boxTop + height));

                                const minD = Math.min(dLeft, dRight, dTop, dBottom);

                                if (minD === dLeft) angle = Math.PI; // Knee left of box
                                else if (minD === dRight) angle = 0; // Knee right of box
                                else if (minD === dTop) angle = -Math.PI / 2; // Knee above box
                                else angle = Math.PI / 2; // Knee below box

                                // Ensure we push strictly OUT + buffer
                                // Reset kneeX/Y to the edge + buffer
                                if (minD === dLeft) { kneeX = boxLeft - MIN_HANDLE_DISTANCE; kneeY = clampedY; }
                                else if (minD === dRight) { kneeX = boxLeft + width + MIN_HANDLE_DISTANCE; kneeY = clampedY; }
                                else if (minD === dTop) { kneeX = clampedX; kneeY = boxTop - MIN_HANDLE_DISTANCE; }
                                else { kneeX = clampedX; kneeY = boxTop + height + MIN_HANDLE_DISTANCE; }

                                // Skip the standard cos/sin calc since we set absolute pos
                            } else {
                                kneeX = clampedX + Math.cos(angle) * MIN_HANDLE_DISTANCE;
                                kneeY = clampedY + Math.sin(angle) * MIN_HANDLE_DISTANCE;
                            }
                        }
                    }

                    // Apply constrained position
                    target.left = kneeX - 6;
                    target.top = kneeY - 6;

                    line1.set({ x2: kneeX, y2: kneeY });
                    updateLine1StartFromBox(false);
                    canvas.requestRenderAll();
                    return;
                }

                return;
            }

            // If mouse is up, ignore further movement events (they're queued from before mouseup)
            if (isMouseUpRef.current) {
                return;
            }

            // Check if this is a line/arrow handle being dragged
            const objectId = (target as any).objectId;
            const handleType = (target as any).handleType as 'start' | 'end' | 'midpoint' | undefined;
            const objectType = (target as any).objectType as 'line' | 'arrow' | undefined;

            // Track if line body is being dragged (has lineId but no objectId means it's the line itself)
            const lineIdForTracking = (target as any).lineId;
            if (lineIdForTracking && !objectId) {
                draggingLineBodyRef.current = lineIdForTracking;


                // [FIX] Removed lazy initialization here since we do it in handleMouseDown
                // Verify we have the original pos, if not try to recover (fallback)
                if (!lineOriginalPosRef.current.has(lineIdForTracking)) {
                    // Fallback recovery
                    const line = linesRef.current.find(l => l.id === lineIdForTracking);
                    if (line && (target instanceof Line || target instanceof Path)) {
                        lineOriginalPosRef.current.set(lineIdForTracking, {
                            left: target.left ?? 0,
                            top: target.top ?? 0,
                            start: line.start,
                            end: line.end,
                        });
                    }
                }

                // Update handles dynamically during drag
                const originalPos = lineOriginalPosRef.current.get(lineIdForTracking);
                if (originalPos && (target instanceof Line || target instanceof Path)) {
                    let currentLeft = target.left ?? 0;
                    let currentTop = target.top ?? 0;

                    // FIX: Use getBoundingRect for Path to match handleMouseDown logic
                    // This ensures that for curved lines (Path objects), we calculate the delta
                    // from the same visual bounding box used in handleMouseDown
                    if (target instanceof Path) {
                        const bounds = target.getBoundingRect();
                        currentLeft = bounds.left;
                        currentTop = bounds.top;
                    }

                    const deltaX = currentLeft - originalPos.left;
                    const deltaY = currentTop - originalPos.top;

                    const newStart = {
                        x: originalPos.start.x + deltaX,
                        y: originalPos.start.y + deltaY,
                    };
                    const newEnd = {
                        x: originalPos.end.x + deltaX,
                        y: originalPos.end.y + deltaY,
                    };
                    const newMidpoint = (originalPos.midpoint)
                        ? {
                            x: originalPos.midpoint.x + deltaX,
                            y: originalPos.midpoint.y + deltaY,
                        }
                        : getMidpoint(newStart, newEnd);

                    const handles = lineHandleObjectsRef.current.get(lineIdForTracking);
                    if (handles) {
                        handles.start.set({
                            left: newStart.x - 6,
                            top: newStart.y - 6,
                        });
                        handles.start.setCoords();
                        handles.end.set({
                            left: newEnd.x - 6,
                            top: newEnd.y - 6,
                        });
                        handles.end.setCoords();
                        handles.midpoint.set({
                            left: newMidpoint.x - 6,
                            top: newMidpoint.y - 6,
                        });
                        handles.midpoint.setCoords();
                        canvas.requestRenderAll();
                    }
                }


            }



            if (objectId && handleType && objectType) {


                // Track dragging state for arrow handles
                if (objectType === 'arrow') {
                    draggingArrowIdRef.current = objectId;
                    draggingArrowHandleRef.current = { arrowId: objectId, handleType };
                }
                // This is a line/arrow handle being dragged
                const handleCenter = {
                    x: (target.left ?? 0) + 6,
                    y: (target.top ?? 0) + 6,
                };

                if (objectType === 'line' && setLines) {
                    // Track that this line handle is being dragged
                    draggingLineHandleRef.current = { lineId: objectId, handleType };

                    const line = linesRef.current.find(l => l.id === objectId);
                    if (line) {
                        let newStart = line.start;
                        let newEnd = line.end;
                        let newMidpoint = line.midpoint;

                        if (handleType === 'start') {
                            newStart = handleCenter;
                            const SNAP_THRESHOLD = 10;
                            const isLinear = shouldSnapToLinear(line.midpoint, line.start, line.end, SNAP_THRESHOLD);

                            if (isLinear) {
                                // Linear Mode: Recalculate midpoint to remain centered
                                newMidpoint = getMidpoint(newStart, newEnd);
                            } else {
                                // Arc Mode: Keep midpoint fixed at absolute coordinates
                                newMidpoint = line.midpoint;
                                // Auto-Reversion: Check if new path overlaps with fixed midpoint
                                if (shouldSnapToLinear(newMidpoint, newStart, newEnd, SNAP_THRESHOLD)) {
                                    newMidpoint = getMidpoint(newStart, newEnd);
                                }
                            }
                        } else if (handleType === 'end') {
                            newEnd = handleCenter;
                            const SNAP_THRESHOLD = 10;
                            const isLinear = shouldSnapToLinear(line.midpoint, line.start, line.end, SNAP_THRESHOLD);

                            if (isLinear) {
                                // Linear Mode: Recalculate midpoint to remain centered
                                newMidpoint = getMidpoint(newStart, newEnd);
                            } else {
                                // Arc Mode: Keep midpoint fixed at absolute coordinates
                                newMidpoint = line.midpoint;
                                // Auto-Reversion: Check if new path overlaps with fixed midpoint
                                if (shouldSnapToLinear(newMidpoint, newStart, newEnd, SNAP_THRESHOLD)) {
                                    newMidpoint = getMidpoint(newStart, newEnd);
                                }
                            }
                        } else if (handleType === 'midpoint') {
                            // Check if we should snap to linear
                            // Use the visual handle center as the source of truth
                            const SNAP_THRESHOLD = 10;
                            const isLinear = shouldSnapToLinear(handleCenter, line.start, line.end, SNAP_THRESHOLD);


                            if (isLinear) {
                                // Snap to exact midpoint (straight line)
                                newMidpoint = getMidpoint(line.start, line.end);
                                // Update handle position to snapped location
                                target.set({
                                    left: newMidpoint.x - 6,
                                    top: newMidpoint.y - 6,
                                });
                                target.setCoords();
                            } else {
                                // Curve Mode: The curve MUST pass through the handle.
                                // We use the handle's center exactly.
                                newMidpoint = handleCenter;
                            }
                        }


                        // Update line path directly on canvas object for real-time feedback (Hypothesis D)
                        let existingLineObject = lineObjectsRef.current.get(objectId);
                        const canvas = fabricCanvasRef.current;

                        // If the object from ref is not in canvas, search for the actual object
                        if (existingLineObject && canvas) {
                            const objects = canvas.getObjects();
                            if (!objects.includes(existingLineObject)) {
                                // Object from ref is stale - search for the actual object in canvas
                                let actualObject = null;
                                for (const obj of objects) {
                                    if ((obj as any).lineId === objectId) {
                                        actualObject = obj;
                                        break;
                                    }
                                }
                                if (actualObject) {
                                    existingLineObject = actualObject;
                                    lineObjectsRef.current.set(objectId, actualObject);
                                }
                            }
                        }

                        if (existingLineObject && canvas) {
                            const isLinearNow = shouldSnapToLinear(newMidpoint, newStart, newEnd, 1);

                            const newPathString = isLinearNow
                                ? `M ${newStart.x},${newStart.y} L ${newEnd.x},${newEnd.y}`
                                : getCurvedPath(newStart, newEnd, newMidpoint);

                            if (isLinearNow) {

                                if (existingLineObject instanceof Line) {
                                    existingLineObject.set({
                                        x1: newStart.x,
                                        y1: newStart.y,
                                        x2: newEnd.x,
                                        y2: newEnd.y,
                                    });
                                    existingLineObject.setCoords();
                                } else {
                                    // Type mismatch - convert Path to Line
                                    const objects = canvas.getObjects();
                                    const currentIndex = objects.indexOf(existingLineObject);

                                    if (currentIndex >= 0) {
                                        canvas.remove(existingLineObject);
                                    }

                                    const newLine = new Line([newStart.x, newStart.y, newEnd.x, newEnd.y], {
                                        stroke: line.style.color,
                                        strokeWidth: line.style.lineThickness,
                                        selectable: activeTool === 'select',
                                        evented: true,
                                        opacity: line.style.opacity,
                                        visible: true,
                                        hasControls: false,
                                        hasBorders: false,
                                        lockScalingX: true,
                                        lockScalingY: true,
                                        lockRotation: true,
                                        perPixelTargetFind: true,
                                    });
                                    (newLine as any).lineId = objectId;
                                    newLine.setCoords();

                                    if (currentIndex >= 0) {
                                        canvas.insertAt(currentIndex, newLine);
                                    } else {
                                        canvas.add(newLine);
                                        (canvas as any).bringForward(newLine);
                                    }

                                    lineObjectsRef.current.set(objectId, newLine);
                                }
                            } else {


                                // For Path updates (curved lines) or Line->Path conversion, we ALWAYS recreate the path
                                const objects = canvas.getObjects();
                                const currentIndex = objects.indexOf(existingLineObject);

                                if (currentIndex >= 0) {
                                    canvas.remove(existingLineObject);
                                }

                                const newPath = new Path(newPathString, {
                                    stroke: line.style.color,
                                    strokeWidth: line.style.lineThickness,
                                    fill: '',
                                    selectable: activeTool === 'select',
                                    evented: true,
                                    opacity: line.style.opacity,
                                    visible: true,
                                    hasControls: false,
                                    hasBorders: false,
                                    lockScalingX: true,
                                    lockScalingY: true,
                                    lockRotation: true,
                                    perPixelTargetFind: true,
                                    objectCaching: false, // Disable caching
                                    strokeUniform: true,
                                });
                                (newPath as any).lineId = objectId;
                                newPath.setCoords();

                                if (currentIndex >= 0) {
                                    canvas.insertAt(currentIndex, newPath);
                                } else {
                                    canvas.add(newPath);
                                    (canvas as any).bringForward(newPath);
                                }

                                lineObjectsRef.current.set(objectId, newPath);
                            }
                            canvas.requestRenderAll();
                        }

                        // Update handle positions during drag (LIVE movement)
                        const handles = lineHandleObjectsRef.current.get(objectId);
                        if (handles) {
                            handles.start.set({
                                left: newStart.x - 6,
                                top: newStart.y - 6,
                                visible: true,
                            });
                            handles.start.setCoords();
                            canvas.bringObjectToFront(handles.start);

                            handles.end.set({
                                left: newEnd.x - 6,
                                top: newEnd.y - 6,
                                visible: true,
                            });
                            handles.end.setCoords();
                            canvas.bringObjectToFront(handles.end);

                            handles.midpoint.set({
                                left: newMidpoint.x - 6,
                                top: newMidpoint.y - 6,
                                visible: true,
                            });
                            handles.midpoint.setCoords();
                            canvas.bringObjectToFront(handles.midpoint);
                        }

                        setLines(prev => prev.map(l =>
                            l.id === objectId
                                ? { ...l, start: newStart, end: newEnd, midpoint: newMidpoint }
                                : l
                        ));
                    }
                } else if (objectType === 'arrow' && setArrows) {
                    const arrow = arrowsRef.current.find(a => a.id === objectId);
                    if (arrow) {
                        let newStart = arrow.start;
                        let newEnd = arrow.end;
                        let newMidpoint = arrow.midpoint;

                        if (handleType === 'start') {
                            newStart = handleCenter;
                            const SNAP_THRESHOLD = 10;
                            const isLinear = shouldSnapToLinear(arrow.midpoint, arrow.start, arrow.end, SNAP_THRESHOLD);

                            if (isLinear) {
                                // Linear Mode: Recalculate midpoint to remain centered
                                newMidpoint = getMidpoint(newStart, newEnd);
                            } else {
                                // Arc Mode: Keep midpoint fixed at absolute coordinates
                                newMidpoint = arrow.midpoint;
                                // Auto-Reversion: Check if new path overlaps with fixed midpoint
                                if (shouldSnapToLinear(newMidpoint, newStart, newEnd, SNAP_THRESHOLD)) {
                                    newMidpoint = getMidpoint(newStart, newEnd);
                                }
                            }
                        } else if (handleType === 'end') {
                            newEnd = handleCenter;
                            const SNAP_THRESHOLD = 10;
                            const isLinear = shouldSnapToLinear(arrow.midpoint, arrow.start, arrow.end, SNAP_THRESHOLD);

                            if (isLinear) {
                                // Linear Mode: Recalculate midpoint to remain centered
                                newMidpoint = getMidpoint(newStart, newEnd);
                            } else {
                                // Arc Mode: Keep midpoint fixed at absolute coordinates
                                newMidpoint = arrow.midpoint;
                                // Auto-Reversion: Check if new path overlaps with fixed midpoint
                                if (shouldSnapToLinear(newMidpoint, newStart, newEnd, SNAP_THRESHOLD)) {
                                    newMidpoint = getMidpoint(newStart, newEnd);
                                }
                            }
                        } else if (handleType === 'midpoint') {
                            // Check if we should snap to linear
                            // Use the visual handle center as the source of truth
                            const SNAP_THRESHOLD = 10;
                            const isLinear = shouldSnapToLinear(handleCenter, arrow.start, arrow.end, SNAP_THRESHOLD);


                            if (isLinear) {
                                // Snap to exact midpoint (straight line)
                                newMidpoint = getMidpoint(arrow.start, arrow.end);
                                // Update handle position to snapped location
                                target.set({
                                    left: newMidpoint.x - 6,
                                    top: newMidpoint.y - 6,
                                });
                                target.setCoords();
                            } else {
                                // Curve Mode: The curve MUST pass through the handle.
                                // We use the handle's center exactly.
                                newMidpoint = handleCenter;
                            }
                        }

                        // Update arrow path directly on canvas object for real-time feedback
                        let existingArrowObject = arrowObjectsRef.current.get(objectId);
                        const canvas = fabricCanvasRef.current;

                        // If the object from ref is not in canvas, search for the actual object
                        if (existingArrowObject && canvas) {
                            const objects = canvas.getObjects();
                            if (!objects.includes(existingArrowObject)) {
                                // Object from ref is stale - search for the actual object in canvas
                                let actualObject = null;
                                for (const obj of objects) {
                                    if ((obj as any).arrowId === objectId) {
                                        actualObject = obj;
                                        break;
                                    }
                                }
                                if (actualObject) {
                                    existingArrowObject = actualObject;
                                    arrowObjectsRef.current.set(objectId, actualObject);
                                }
                            }
                        }

                        if (existingArrowObject && canvas) {
                            const isLinearNow = shouldSnapToLinear(newMidpoint, newStart, newEnd, 1);


                            const newPathString = isLinearNow
                                ? `M ${newStart.x},${newStart.y} L ${newEnd.x},${newEnd.y}`
                                : getCurvedPath(newStart, newEnd, newMidpoint);

                            if (isLinearNow) {

                                if (existingArrowObject instanceof Line) {
                                    existingArrowObject.set({
                                        x1: newStart.x,
                                        y1: newStart.y,
                                        x2: newEnd.x,
                                        y2: newEnd.y,
                                    });
                                    existingArrowObject.setCoords();
                                } else {
                                    // Type mismatch - convert Path to Line
                                    const objects = canvas.getObjects();
                                    const currentIndex = objects.indexOf(existingArrowObject);

                                    if (currentIndex >= 0) {
                                        canvas.remove(existingArrowObject);
                                    }

                                    const newLine = new Line([newStart.x, newStart.y, newEnd.x, newEnd.y], {
                                        stroke: arrow.style.color,
                                        strokeWidth: arrow.style.lineThickness,
                                        selectable: activeTool === 'select',
                                        evented: true,
                                        opacity: arrow.style.opacity,
                                        visible: true,
                                        hasControls: false,
                                        hasBorders: false,
                                        lockScalingX: true,
                                        lockScalingY: true,
                                        lockRotation: true,
                                        perPixelTargetFind: true,
                                        objectCaching: false,
                                        strokeUniform: true,
                                    });
                                    (newLine as any).arrowId = objectId;
                                    newLine.setCoords();

                                    if (currentIndex >= 0) {
                                        canvas.insertAt(currentIndex, newLine);
                                    } else {
                                        canvas.add(newLine);
                                        (canvas as any).bringForward(newLine);
                                    }

                                    arrowObjectsRef.current.set(objectId, newLine);
                                }
                            } else {


                                // For Path updates (curved arrows) or Line->Path conversion, we ALWAYS recreate the path
                                const objects = canvas.getObjects();
                                const currentIndex = objects.indexOf(existingArrowObject);

                                if (currentIndex >= 0) {
                                    canvas.remove(existingArrowObject);
                                }

                                const newPath = new Path(newPathString, {
                                    stroke: arrow.style.color,
                                    strokeWidth: arrow.style.lineThickness,
                                    fill: '',
                                    selectable: activeTool === 'select',
                                    evented: true,
                                    opacity: arrow.style.opacity,
                                    visible: true,
                                    hasControls: false,
                                    hasBorders: false,
                                    lockScalingX: true,
                                    lockScalingY: true,
                                    lockRotation: true,
                                    perPixelTargetFind: true,
                                    objectCaching: false, // Disable caching
                                    strokeUniform: true,
                                });
                                (newPath as any).arrowId = objectId;
                                newPath.setCoords();

                                if (currentIndex >= 0) {
                                    canvas.insertAt(currentIndex, newPath);
                                } else {
                                    canvas.add(newPath);
                                    (canvas as any).bringForward(newPath);
                                }

                                arrowObjectsRef.current.set(objectId, newPath);
                            }
                            canvas.requestRenderAll();
                        }

                        // Update handle positions during drag (LIVE movement)
                        const handles = arrowHandleObjectsRef.current.get(objectId);
                        if (handles) {
                            handles.start.set({
                                left: newStart.x - 6,
                                top: newStart.y - 6,
                                visible: true,
                            });
                            handles.start.setCoords();
                            canvas.bringObjectToFront(handles.start);

                            handles.end.set({
                                left: newEnd.x - 6,
                                top: newEnd.y - 6,
                                visible: true,
                            });
                            handles.end.setCoords();
                            canvas.bringObjectToFront(handles.end);

                            handles.midpoint.set({
                                left: newMidpoint.x - 6,
                                top: newMidpoint.y - 6,
                                visible: true,
                            });
                            handles.midpoint.setCoords();
                            canvas.bringObjectToFront(handles.midpoint);
                        }

                        setArrows(prev => prev.map(a =>
                            a.id === objectId
                                ? { ...a, start: newStart, end: newEnd, midpoint: newMidpoint }
                                : a
                        ));

                        // Update arrowhead during drag
                        const arrowHead = arrowHeadObjectsRef.current.get(objectId);
                        if (arrowHead) {
                            // Check linearity for correct angle
                            const isLinear = shouldSnapToLinear(newMidpoint, newStart, newEnd, 1);
                            const angle = isLinear
                                ? Math.atan2(newEnd.y - newStart.y, newEnd.x - newStart.x) * (180 / Math.PI)
                                : getCurveEndAngle(newStart, newEnd, newMidpoint);

                            arrowHead.set({
                                left: newEnd.x,
                                top: newEnd.y,
                                angle: angle + 90,
                                objectCaching: false, // Ensure no caching issues
                            });
                            arrowHead.setCoords();
                        }
                    }
                }


                canvas.requestRenderAll();

                return;
            }

            // Handle line/arrow movement during drag
            const lineIdForDrag = (target as any).lineId;
            const arrowIdForDrag = (target as any).arrowId;

            // Check if this is actually an arrow (even if it has lineId instead of arrowId)
            // This handles cases where arrow objects might have lineId property
            let actualArrowId = arrowIdForDrag;
            if (!actualArrowId && lineIdForDrag && arrowsRef.current.find(a => a.id === lineIdForDrag)) {
                actualArrowId = lineIdForDrag;
            }


            if (actualArrowId) {
                // Track that this arrow is being dragged
                draggingArrowIdRef.current = actualArrowId;

                // Get the arrow from React state to know original positions
                // Note: We don't lazily init lineOriginalPosRef here anymore, handled in Start

                // Calculate actual transformed positions during drag
                const originalPos = lineOriginalPosRef.current.get(actualArrowId);

                if (originalPos && (target instanceof Line || target instanceof Path)) {
                    let currentLeft = target.left ?? 0;
                    let currentTop = target.top ?? 0;

                    // FIX: Use getBoundingRect for Path to match handleMouseDown logic
                    if (target instanceof Path) {
                        const bounds = target.getBoundingRect();
                        currentLeft = bounds.left;
                        currentTop = bounds.top;
                    }

                    const deltaX = currentLeft - originalPos.left;
                    const deltaY = currentTop - originalPos.top;

                    const newStart = {
                        x: originalPos.start.x + deltaX,
                        y: originalPos.start.y + deltaY,
                    };
                    const newEnd = {
                        x: originalPos.end.x + deltaX,
                        y: originalPos.end.y + deltaY,
                    };
                    const newMidpoint = (originalPos.midpoint)
                        ? {
                            x: originalPos.midpoint.x + deltaX,
                            y: originalPos.midpoint.y + deltaY,
                        }
                        : getMidpoint(newStart, newEnd);

                    const handles = arrowHandleObjectsRef.current.get(actualArrowId);
                    if (handles) {
                        handles.start.set({
                            left: newStart.x - 6,
                            top: newStart.y - 6,
                        });
                        handles.start.setCoords();
                        handles.end.set({
                            left: newEnd.x - 6,
                            top: newEnd.y - 6,
                        });
                        handles.end.setCoords();
                        handles.midpoint.set({
                            left: newMidpoint.x - 6,
                            top: newMidpoint.y - 6,
                        });
                        handles.midpoint.setCoords();
                        canvas.requestRenderAll();
                    }

                    // Update arrowhead position
                    const arrowHead = arrowHeadObjectsRef.current.get(actualArrowId);
                    if (arrowHead) {
                        // Check linearity for correct angle
                        const isLinear = shouldSnapToLinear(newMidpoint, newStart, newEnd, 1);
                        const angle = isLinear
                            ? Math.atan2(newEnd.y - newStart.y, newEnd.x - newStart.x) * (180 / Math.PI)
                            : getCurveEndAngle(newStart, newEnd, newMidpoint);

                        arrowHead.set({
                            left: newEnd.x,
                            top: newEnd.y,
                            angle: angle + 90,
                        });
                        arrowHead.setCoords();
                    }
                }

                canvas.requestRenderAll();
                return; // Don't process as callout
            }

            if (lineIdForDrag) {
                return; // Don't process as callout
            }


        };

        const handleObjectScaling = (opt: { target: FabricObject; e?: any }) => {
            const target = opt.target as CalloutPart;

            // Clear pending edit flag - user is scaling/resizing, not clicking
            pendingEditRef.current = null;

            // Track standard Fabric.js object behavior (non-callout objects) to learn how they handle resizing
            if (!target.calloutId || !target.partType) {
                // This is a standard Fabric.js object (like our test rectangle)
                const obj = target;
                const transform = (canvas as any)._currentTransform;
                const activeControl = transform?.corner;

                // Let Fabric.js handle standard objects normally - we're just observing
                return;
            }



            const parts = getParts(target.calloutId);
            const line1 = parts.get('line1') as unknown as Line | undefined;
            const textBoxBg = parts.get('textBoxBg') as unknown as Rect | undefined;
            const textObj = parts.get('text') as unknown as Textbox | undefined;

            if (!line1 || !textBoxBg) return;

            // Ensure strokeUniform is true and strokeWidth remains constant during scaling
            const callout = callouts.find(c => c.id === target.calloutId);
            if (callout && target.partType === 'textBoxBg') {
                textBoxBg.set({
                    strokeUniform: true,
                    strokeWidth: callout.style.lineThickness,
                });
            }

            // Update line connection point based on current scaled box dimensions
            // Fabric updates .left, .top, .scaleX, .scaleY live.
            const boxLeft = textBoxBg.left ?? 0;
            const boxTop = textBoxBg.top ?? 0;
            const width = textBoxBg.getScaledWidth();
            const height = textBoxBg.getScaledHeight();

            // Update text object position and width in real-time during scaling
            // Text should maintain original font size and stay anchored to top-left with padding
            if (textObj && target.partType === 'textBoxBg') {
                const PADDING_X = 8;
                const PADDING_Y = 4;

                // Position text at top-left of the scaled box with padding
                textObj.set({
                    left: boxLeft + PADDING_X,
                    top: boxTop + PADDING_Y,
                    width: Math.max(width - (PADDING_X * 2), 20),
                    scaleX: 1, // Keep text at original scale (don't scale with box)
                    scaleY: 1,
                });
                textObj.setCoords();
            }

            const kneeX = line1.x2 ?? 0;
            const kneeY = line1.y2 ?? 0;

            const arrowTipX = parseFloat((parts.get('line2') as unknown as Line)?.x2?.toString() ?? '0');
            const arrowTipY = parseFloat((parts.get('line2') as unknown as Line)?.y2?.toString() ?? '0');

            const { line1Start, shouldHideLine1: shouldHide, line2Start, effectiveKnee } = calculateCalloutConnection(
                boxLeft,
                boxTop,
                width,
                height,
                { x: kneeX, y: kneeY },
                { x: arrowTipX, y: arrowTipY },
                callout?.style.lineThickness ?? 0
            );

            line1.set({
                x1: line1Start.x,
                y1: line1Start.y,
                x2: effectiveKnee.x,
                y2: effectiveKnee.y,
                opacity: shouldHide ? 0 : (line1.opacity || 1),
            });

            // Update line2 start as well (clipping if knee is inside)
            if (parts.get('line2')) {
                (parts.get('line2') as unknown as Line).set({
                    x1: line2Start.x,
                    y1: line2Start.y
                });
            }

            // Update visual handle (though this is object scaling, not knee drag)
            const kneeHandle = parts.get('knee') as unknown as Rect | undefined;
            if (kneeHandle) {
                kneeHandle.set({
                    left: effectiveKnee.x - 6,
                    top: effectiveKnee.y - 6
                });
            }

            const arrowHead = parts.get('arrowHead') as unknown as Triangle | undefined;
            if (arrowHead) {
                const angleDeg = (Math.atan2(arrowTipY - effectiveKnee.y, arrowTipX - effectiveKnee.x) * 180) / Math.PI;
                arrowHead.set({
                    left: arrowTipX,
                    top: arrowTipY,
                    angle: angleDeg + 90
                });
                arrowHead.setCoords();
            }

            canvas.requestRenderAll();
        };


        const handleObjectModified = (opt: { target: FabricObject }) => {
            const target = opt.target as CalloutPart;


            // Handle line/arrow movement
            const lineId = (target as any).lineId;
            const arrowId = (target as any).arrowId;

            // Track if line body is being dragged
            if (lineId && !(target as any).objectId) {
                draggingLineBodyRef.current = lineId;
            }

            // Check if this is a line handle being dragged (not the line itself)
            const objectId = (target as any).objectId;
            const handleType = (target as any).handleType as 'start' | 'end' | 'midpoint' | undefined;
            const objectType = (target as any).objectType as 'line' | 'arrow' | undefined;


            // Handle line handle drag completion
            if (objectId && handleType && objectType === 'line' && setLines) {
                // CRITICAL FIX: Disable any handle-specific logic here.
                // handleObjectMoving already handles all position updates (including curve preservation).
                // Re-running this logic on mouse-up resets the midpoint to linear (getMidpoint) which destroys the curve.
                // We rely on the state set during the drag in handleObjectMoving.
                return;
            }

            if (lineId && setLines) {
                // Prevent re-entrant calls (discardActiveObject can trigger another object:modified event)
                if (isProcessingLineModifiedRef.current) {
                    return;
                }
                isProcessingLineModifiedRef.current = true;

                const line = linesRef.current.find(l => l.id === lineId);
                if (line) {

                    // Get new coordinates from the moved object
                    let newStart = line.start;
                    let newEnd = line.end;

                    const originalPos = lineOriginalPosRef.current.get(lineId);

                    if (originalPos) {
                        // Unified delta calculation
                        let currentLeft = target.left ?? 0;
                        let currentTop = target.top ?? 0;

                        // FIX: Use getBoundingRect for Path to match handleMouseDown logic
                        if (target instanceof Path) {
                            const bounds = target.getBoundingRect();
                            currentLeft = bounds.left;
                            currentTop = bounds.top;
                        }

                        // Calculate the movement delta
                        const deltaX = currentLeft - originalPos.left;
                        const deltaY = currentTop - originalPos.top;

                        // Apply the delta to the original start/end coordinates
                        newStart = {
                            x: originalPos.start.x + deltaX,
                            y: originalPos.start.y + deltaY,
                        };
                        newEnd = {
                            x: originalPos.end.x + deltaX,
                            y: originalPos.end.y + deltaY,
                        };

                        // Clear the stored original position
                        lineOriginalPosRef.current.delete(lineId);
                    } else if (target instanceof Line) {
                        // Fallback for Line: use coords directly
                        newStart = { x: target.x1 ?? line.start.x, y: target.y1 ?? line.start.y };
                        newEnd = { x: target.x2 ?? line.end.x, y: target.y2 ?? line.end.y };
                    } else if (target instanceof Path) {
                        // Fallback for Path: try to extract from path data (complex, prone to error, but better than nothing if no originalPos)
                        const pathData = target.path;
                        if (pathData && pathData.length > 0) {
                            let firstPoint: { x: number; y: number } | null = null;
                            let lastPoint: { x: number; y: number } | null = null;

                            for (const command of pathData) {
                                if (command[0] === 'M' && !firstPoint) {
                                    firstPoint = { x: command[1] as number, y: command[2] as number };
                                }
                                if (command[0] === 'L') {
                                    lastPoint = { x: command[1] as number, y: command[2] as number };
                                } else if (command[0] === 'Q') {
                                    lastPoint = { x: command[3] as number, y: command[4] as number };
                                }
                            }

                            if (firstPoint && lastPoint) {
                                const transformArray = target.calcTransformMatrix();
                                const a = transformArray[0];
                                const b = transformArray[1];
                                const c = transformArray[2];
                                const d = transformArray[3];
                                const e = transformArray[4];
                                const f = transformArray[5];

                                newStart = {
                                    x: a * firstPoint.x + c * firstPoint.y + e,
                                    y: b * firstPoint.x + d * firstPoint.y + f,
                                };
                                newEnd = {
                                    x: a * lastPoint.x + c * lastPoint.y + e,
                                    y: b * lastPoint.x + d * lastPoint.y + f,
                                };
                            }
                        } else {
                            // Last resort fallback
                            const left = target.left ?? 0;
                            const top = target.top ?? 0;
                            const width = target.getScaledWidth();
                            const height = target.getScaledHeight();
                            newStart = { x: left, y: top };
                            newEnd = { x: left + width, y: top + height };
                        }
                    }

                    // START FIX: Translate midpoint if available, otherwise recalculate
                    let newMidpoint = getMidpoint(newStart, newEnd);
                    if (originalPos && originalPos.midpoint) {
                        const currentLeft = target instanceof Path ? target.getBoundingRect().left : (target.left ?? 0);
                        const currentTop = target instanceof Path ? target.getBoundingRect().top : (target.top ?? 0);
                        const deltaX = currentLeft - originalPos.left;
                        const deltaY = currentTop - originalPos.top;

                        newMidpoint = {
                            x: originalPos.midpoint.x + deltaX,
                            y: originalPos.midpoint.y + deltaY
                        };
                    }
                    // END FIX




                    // CRITICAL FIX: Only process Line body modifications, not handles
                    // Handles are managed by handleObjectMoving and their state updates are sufficient
                    if (!(target instanceof Line) && !(target instanceof Path)) {
                        return;
                    }

                    // Update handle positions FIRST (before state update to avoid race condition)
                    const handles = lineHandleObjectsRef.current.get(lineId);
                    if (handles) {

                        handles.start.set({
                            left: newStart.x - 6,
                            top: newStart.y - 6,
                        });
                        handles.start.setCoords();
                        handles.end.set({
                            left: newEnd.x - 6,
                            top: newEnd.y - 6,
                        });
                        handles.end.setCoords();
                        handles.midpoint.set({
                            left: newMidpoint.x - 6,
                            top: newMidpoint.y - 6,
                        });
                        handles.midpoint.setCoords();


                        // #endregion
                    } else {
                    }

                    setLines(prev => prev.map(l =>
                        l.id === lineId
                            ? { ...l, start: newStart, end: newEnd, midpoint: newMidpoint }
                            : l
                    ));

                    // Clear dragging flag AFTER updating state and handles
                    // Use setTimeout to ensure state update has propagated before clearing
                    setTimeout(() => {
                        draggingLineBodyRef.current = null;
                    }, 0);

                    // Clear processing flag
                    isProcessingLineModifiedRef.current = false;



                    canvas.requestRenderAll();
                    return;
                }
                // Clear processing flag if line not found
                isProcessingLineModifiedRef.current = false;
            }

            if (arrowId && setArrows) {
                // Prevent re-entrant calls (discardActiveObject can trigger another object:modified event)
                if (isProcessingArrowModifiedRef.current) {
                    return;
                }
                isProcessingArrowModifiedRef.current = true;


                // CRITICAL: Always deactivate the object first to prevent further movement
                // This must happen regardless of whether we find the arrow in the (possibly stale) closure
                canvas.discardActiveObject();
                draggingArrowIdRef.current = null;

                // CRITICAL FIX: Only process Arrow body modifications, not handles
                // Handles are managed by handleObjectMoving and their state updates are sufficient
                if (!(target instanceof Line) && !(target instanceof Path)) {
                    canvas.requestRenderAll();
                    isProcessingArrowModifiedRef.current = false;
                    return;
                }

                const arrow = arrowsRef.current.find(a => a.id === arrowId);
                if (arrow) {
                    // Get new coordinates using delta-based approach (same as handleObjectMoving)
                    // Use lineOriginalPosRef which stores the position at drag start
                    let newStart = arrow.start;
                    let newEnd = arrow.end;

                    const originalPos = lineOriginalPosRef.current.get(arrowId);

                    if (originalPos) {
                        // Unified delta calculation
                        let currentLeft = target.left ?? 0;
                        let currentTop = target.top ?? 0;

                        // FIX: Use getBoundingRect for Path to match handleMouseDown logic
                        if (target instanceof Path) {
                            const bounds = target.getBoundingRect();
                            currentLeft = bounds.left;
                            currentTop = bounds.top;
                        }

                        // Calculate the movement delta
                        const deltaX = currentLeft - originalPos.left;
                        const deltaY = currentTop - originalPos.top;

                        // Apply the delta to the original start/end coordinates
                        newStart = {
                            x: originalPos.start.x + deltaX,
                            y: originalPos.start.y + deltaY,
                        };
                        newEnd = {
                            x: originalPos.end.x + deltaX,
                            y: originalPos.end.y + deltaY,
                        };

                        // Clear the stored original position
                        lineOriginalPosRef.current.delete(arrowId);
                    } else if (target instanceof Line) {
                        // Fallback for Line: use coords directly
                        newStart = { x: target.x1 ?? arrow.start.x, y: target.y1 ?? arrow.start.y };
                        newEnd = { x: target.x2 ?? arrow.end.x, y: target.y2 ?? arrow.end.y };
                    } else if (target instanceof Path) {
                        // Fallback for Path: try to extract from path data 
                        // (Same logic as Lines fallback could be applied here if needed, but originalPos should be consistently set)
                        const left = target.left ?? 0;
                        const top = target.top ?? 0;
                        const width = target.getScaledWidth();
                        const height = target.getScaledHeight();
                        newStart = { x: left, y: top };
                        newEnd = { x: left + width, y: top + height };
                    }

                    // START FIX: Translate midpoint if available, otherwise recalculate
                    let newMidpoint = getMidpoint(newStart, newEnd);
                    if (originalPos && originalPos.midpoint) {
                        const currentLeft = target instanceof Path ? target.getBoundingRect().left : (target.left ?? 0);
                        const currentTop = target instanceof Path ? target.getBoundingRect().top : (target.top ?? 0);
                        const deltaX = currentLeft - originalPos.left;
                        const deltaY = currentTop - originalPos.top;

                        newMidpoint = {
                            x: originalPos.midpoint.x + deltaX,
                            y: originalPos.midpoint.y + deltaY
                        };
                    }
                    // END FIX

                    // Update handle positions FIRST
                    const handles = arrowHandleObjectsRef.current.get(arrowId);
                    if (handles) {
                        handles.start.set({
                            left: newStart.x - 6,
                            top: newStart.y - 6,
                        });
                        handles.start.setCoords();

                        handles.end.set({
                            left: newEnd.x - 6,
                            top: newEnd.y - 6,
                        });
                        handles.end.setCoords();

                        handles.midpoint.set({
                            left: newMidpoint.x - 6,
                            top: newMidpoint.y - 6,
                        });
                        handles.midpoint.setCoords();
                    }

                    // Update arrowhead position
                    const arrowHead = arrowHeadObjectsRef.current.get(arrowId);
                    if (arrowHead) {
                        // Check linearity for correct angle
                        const isLinear = shouldSnapToLinear(newMidpoint, newStart, newEnd, 1);
                        const angle = isLinear
                            ? Math.atan2(newEnd.y - newStart.y, newEnd.x - newStart.x) * (180 / Math.PI)
                            : getCurveEndAngle(newStart, newEnd, newMidpoint);

                        arrowHead.set({
                            left: newEnd.x,
                            top: newEnd.y,
                            angle: angle + 90,
                        });
                        arrowHead.setCoords();
                    }

                    setArrows(prev => prev.map(a =>
                        a.id === arrowId
                            ? { ...a, start: newStart, end: newEnd, midpoint: newMidpoint }
                            : a
                    ));

                    // Clear dragging flag AFTER updating state and handles
                    setTimeout(() => {
                        draggingArrowIdRef.current = null;
                    }, 0);

                    canvas.requestRenderAll();
                    isProcessingArrowModifiedRef.current = false;
                    return;
                }

                // Even if arrow wasn't found in stale closure, we've already deactivated - just return
                // Clear processing flag
                isProcessingArrowModifiedRef.current = false;
                canvas.requestRenderAll();
                return;
            }

            // Track standard Fabric.js object behavior (non-callout objects) to learn how they handle resizing
            if (!target.calloutId || !target.partType) {
                // This is a standard Fabric.js object (like our test rectangle)
                const obj = target;



                // Let Fabric.js handle standard objects normally - we're just observing
                return;
            }

            const calloutId = target.calloutId;
            const partType = target.partType;



            // Clear initial scaling state when scaling completes
            if (initialScalingStateRef.current?.calloutId === calloutId) {
                initialScalingStateRef.current = null;
            }

            // Reset whole-move tracking
            lastDragPosRef.current = null;

            // Keep selected after any edit; we only clear on click-off in Select tool.
            setSelectedCalloutId(calloutId);

            const parts = getParts(calloutId);
            const textBoxBg = parts.get('textBoxBg') as unknown as Rect | undefined;
            const textObj = parts.get('text') as unknown as Textbox | undefined;
            const arrowTipHandle = parts.get('arrowTip') as unknown as Rect | undefined;
            const kneeHandle = parts.get('knee') as unknown as Rect | undefined;

            // If textbox was scaled, reset scale to 1 and apply dimensions directly
            // This prevents uneven borders when scaling with individual handles
            // Only do this when the object was actually scaled (not just moved)
            let wasScaled = false;
            if ((partType === 'textBoxBg' || partType === 'text') && textBoxBg) {
                const scaleXBefore = textBoxBg.scaleX ?? 1;
                const scaleYBefore = textBoxBg.scaleY ?? 1;



                // Only run scale reset logic if the object was actually scaled
                if (scaleXBefore !== 1 || scaleYBefore !== 1) {
                    wasScaled = true;

                    // Calculate new dimensions based on the object's current width * scale factor
                    // Use the object's width property directly (not state) since it reflects current reality
                    // This avoids issues with stale state and getScaledWidth() including stroke width
                    const widthBefore = textBoxBg.width ?? 0;
                    const heightBefore = textBoxBg.height ?? 0;
                    const finalWidth = widthBefore * Math.abs(scaleXBefore);
                    const finalHeight = heightBefore * Math.abs(scaleYBefore);



                    // Reset scale and apply dimensions directly
                    textBoxBg.set({
                        width: finalWidth,
                        height: finalHeight,
                        scaleX: 1,
                        scaleY: 1,
                        flipX: false,
                        flipY: false,
                    });

                    // Update text object position and width to match
                    if (textObj) {
                        const PADDING_X = 8;
                        const PADDING_Y = 4;
                        textObj.set({
                            left: (textBoxBg.left ?? 0) + PADDING_X,
                            top: (textBoxBg.top ?? 0) + PADDING_Y,
                            width: Math.max(finalWidth - (PADDING_X * 2), 20),
                        });
                    }
                } else {
                }
            }

            // Sync all positions from Fabric objects to state (handles whole-move case)
            setCallouts(prev => prev.map(c => {
                if (c.id !== calloutId) return c;

                // Only update width/height if the object was actually scaled
                // For moves, only update position, not dimensions
                const newWidth = textBoxBg && (partType === 'textBoxBg' || partType === 'text') && wasScaled
                    ? textBoxBg.width ?? c.textBoxWidth
                    : c.textBoxWidth;
                const newHeight = textBoxBg && (partType === 'textBoxBg' || partType === 'text') && wasScaled
                    ? textBoxBg.height ?? c.textBoxHeight
                    : c.textBoxHeight;



                return {
                    ...c,
                    arrowTip: arrowTipHandle
                        ? { x: (arrowTipHandle.left ?? 0) + 6, y: (arrowTipHandle.top ?? 0) + 6 }
                        : c.arrowTip,
                    knee: kneeHandle
                        ? { x: (kneeHandle.left ?? 0) + 6, y: (kneeHandle.top ?? 0) + 6 }
                        : c.knee,
                    textBoxPosition: textBoxBg
                        ? { x: textBoxBg.left ?? c.textBoxPosition.x, y: textBoxBg.top ?? c.textBoxPosition.y }
                        : c.textBoxPosition,
                    textBoxWidth: newWidth,
                    textBoxHeight: newHeight,
                };
            }));

            canvas.requestRenderAll();
        };

        const handleTextChanged = (opt: { target: FabricObject }) => {
            const target = opt.target as CalloutPart & Textbox;
            if (!target.calloutId) return;

            setCallouts(prev => prev.map(c => {
                if (c.id !== target.calloutId) return c;
                return { ...c, text: target.text || '' };
            }));
        };

        const handleTextEditingEntered = () => {
            isEditingTextRef.current = true;
        };

        const handleTextEditingExited = () => {
            isEditingTextRef.current = false;
        };

        const handleMouseOver = (opt: TPointerEventInfo<TPointerEvent>) => {
            const target = opt.target as CalloutPart | undefined;
            // Clear any pending timeout
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = null;
            }
            // Show handles when hovering over any handle (arrowTip, knee) or textBoxBg (which has corner resize handles)
            if (target && target.calloutId) {
                if (target.partType === 'arrowTip' || target.partType === 'knee' || target.partType === 'textBoxBg') {
                    setHoveredHandleCalloutId(target.calloutId);
                }
            }
        };

        const handleMouseOut = (opt: TPointerEventInfo<TPointerEvent>) => {
            const target = opt.target as CalloutPart | undefined;
            // Hide handles when mouse leaves any handle or textBoxBg, but use a small delay
            // to prevent flickering when moving between handles
            if (target && target.calloutId) {
                if (target.partType === 'arrowTip' || target.partType === 'knee' || target.partType === 'textBoxBg') {
                    // Clear any existing timeout
                    if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                    }
                    // Set a small delay before clearing to allow moving between handles
                    hoverTimeoutRef.current = setTimeout(() => {
                        setHoveredHandleCalloutId(null);
                        hoverTimeoutRef.current = null;
                    }, 50);
                }
            }
        };

        const handleMouseDblClick = (opt: TPointerEventInfo<TPointerEvent>) => {


            // Clear double-click timeout since we're handling it now
            if (doubleClickTimeoutRef.current) {
                clearTimeout(doubleClickTimeoutRef.current);
                doubleClickTimeoutRef.current = null;
            }

            if (activeTool !== 'select') {
                return;
            }

            // Even if already editing, we can still handle double-click to re-enter edit mode
            // (this handles the case where user double-clicks while already in edit mode)

            const target = opt.target as CalloutPart | undefined;

            // Handle double-click on text or textBoxBg to enter edit mode
            if (target && target.calloutId && (target.partType === 'text' || target.partType === 'textBoxBg')) {
                // Clear pending edit flag since we're handling double-click
                pendingEditRef.current = null;

                const parts = calloutObjectsRef.current.get(target.calloutId) ?? [];
                const textObj = parts.find(p => (p as CalloutPart).partType === 'text') as Textbox | undefined;

                if (textObj) {
                    // Select the callout first
                    setSelectedCalloutId(target.calloutId);
                    // Enter edit mode (even if already editing, this ensures it's focused)
                    canvas.setActiveObject(textObj);
                    textObj.enterEditing();
                    textObj.selectAll();
                    canvas.requestRenderAll();
                }
            }
        };

        canvas.on('mouse:down', handleMouseDown);
        canvas.on('mouse:move', handleMouseMove);
        canvas.on('mouse:up', handleMouseUp);
        canvas.on('mouse:dblclick', handleMouseDblClick);
        canvas.on('mouse:over', handleMouseOver);
        canvas.on('mouse:out', handleMouseOut);
        canvas.on('selection:created', handleSelection);
        canvas.on('selection:updated', handleSelection);
        canvas.on('selection:cleared', handleSelectionCleared);
        canvas.on('object:moving', handleObjectMoving);
        canvas.on('object:scaling', handleObjectScaling);
        canvas.on('object:modified', handleObjectModified);
        canvas.on('text:changed', handleTextChanged);
        canvas.on('text:editing:entered', handleTextEditingEntered);
        canvas.on('text:editing:exited', handleTextEditingExited);

        return () => {
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
            }
            if (doubleClickTimeoutRef.current) {
                clearTimeout(doubleClickTimeoutRef.current);
            }
            canvas.off('mouse:down', handleMouseDown);
            canvas.off('mouse:move', handleMouseMove);
            canvas.off('mouse:up', handleMouseUp);
            canvas.off('mouse:dblclick', handleMouseDblClick);
            canvas.off('mouse:over', handleMouseOver);
            canvas.off('mouse:out', handleMouseOut);
            canvas.off('selection:created', handleSelection);
            canvas.off('selection:updated', handleSelection);
            canvas.off('selection:cleared', handleSelectionCleared);
            canvas.off('object:moving', handleObjectMoving);
            canvas.off('object:scaling', handleObjectScaling);
            canvas.off('object:modified', handleObjectModified);
            canvas.off('text:changed', handleTextChanged);
            canvas.off('text:editing:entered', handleTextEditingEntered);
            canvas.off('text:editing:exited', handleTextEditingExited);
        };
    }, [activeTool, isCreating, creationStart, setCallouts, setSelectedCalloutId, hoveredHandleCalloutId, setLines, setArrows]);

    return (
        <div className="flex-1 overflow-auto bg-canvas-bg p-8">
            <div className="shadow-page mx-auto" style={{ width: '816px', height: '1056px' }}>
                <canvas ref={canvasRef} />
            </div>
        </div>
    );
};
