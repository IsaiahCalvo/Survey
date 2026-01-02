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
} from 'fabric';
import { Callout, CalloutStyle, defaultCalloutStyle, Point } from '@/types/callout';
import { calculateCalloutConnection } from '@/lib/calloutGeometry';
import { v4 as uuidv4 } from 'uuid';

type ToolType = 'select' | 'callout';

interface FabricPDFCanvasProps {
    callouts: Callout[];
    setCallouts: React.Dispatch<React.SetStateAction<Callout[]>>;
    selectedCalloutId: string | null;
    setSelectedCalloutId: React.Dispatch<React.SetStateAction<string | null>>;
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
    selectedCalloutId,
    setSelectedCalloutId,
    activeTool,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricCanvasRef = useRef<FabricCanvas | null>(null);
    const calloutObjectsRef = useRef<Map<string, FabricObject[]>>(new Map());
    const [isCreating, setIsCreating] = useState(false);
    const [creationStart, setCreationStart] = useState<Point | null>(null);
    const previewLineRef = useRef<Line | null>(null);
    const previewTextBoxRef = useRef<Rect | null>(null);
    const previewLine1Ref = useRef<Line | null>(null);
    const previewLine2Ref = useRef<Line | null>(null);
    const previewArrowHeadRef = useRef<Triangle | null>(null);
    const isEditingTextRef = useRef(false);
    const [hoveredHandleCalloutId, setHoveredHandleCalloutId] = useState<string | null>(null);
    const wasSelectedRef = useRef<string | null>(null); // Track previously selected callout for two-click edit
    const newCalloutIdRef = useRef<string | null>(null); // Track newly created callout for auto-focus
    const pendingEditRef = useRef<string | null>(null); // Track if we should enter edit mode on mouse up (two-click)
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
    const lastSafeObjectPosRef = useRef<Map<string, { left: number; top: number }>>(new Map());


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
        };
    }, []);

    // Convert callout data to Fabric objects
    const createCalloutObjects = useCallback((callout: Callout, isSelected: boolean): FabricObject[] => {
        const { arrowTip, knee, textBoxPosition, textBoxWidth, textBoxHeight, text, style, id } = callout;

        // Calculate connection point
        const { line1Start, shouldHide, line2Start, effectiveKnee } = calculateCalloutConnection(
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
            selectable: false,
            evented: true, // Make clickable to select callout
            opacity: shouldHide ? 0 : style.opacity,
            perPixelTargetFind: true, // Use per-pixel hit detection for precise clicking
        }) as CalloutPart;
        line1.calloutId = id;
        line1.partType = 'line1';

        // Line from knee to arrow tip (with arrowhead direction)
        const line2 = new Line([line2Start.x, line2Start.y, arrowTip.x, arrowTip.y], {
            stroke: style.borderColor,
            strokeWidth: style.lineThickness,
            selectable: false,
            evented: true, // Make clickable to select callout
            opacity: style.opacity,
            perPixelTargetFind: true, // Use per-pixel hit detection for precise clicking
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
            visible: isSelected,
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
            visible: isSelected,
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
                visible: shouldShowHandles,
            });
            kneeHandle?.set({
                left: callout.knee.x - 6,
                top: callout.knee.y - 6,
                visible: shouldShowHandles,
            });

            // Connector lines
            if (line1 && line2) {
                const { line1Start, shouldHide, line2Start, effectiveKnee } = calculateCalloutConnection(
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
                });

                line2.set({
                    x1: line2Start.x,
                    y1: line2Start.y,
                    x2: callout.arrowTip.x,
                    y2: callout.arrowTip.y,
                    stroke: style.borderColor,
                    strokeWidth: style.lineThickness,
                    opacity: style.opacity,
                    perPixelTargetFind: true, // Maintain per-pixel hit detection
                });

                // Update Knee Handle position to match effective knee
                kneeHandle?.set({
                    left: effectiveKnee.x - 6,
                    top: effectiveKnee.y - 6,
                });

                // Update arrow angle based on effective knee
                if (arrowHead) {
                    const angleDeg = (Math.atan2(callout.arrowTip.y - effectiveKnee.y, callout.arrowTip.x - effectiveKnee.x) * 180) / Math.PI;
                    arrowHead.set({ angle: angleDeg + 90 });
                }
            }
        });

        canvas.requestRenderAll();
    }, [callouts, createCalloutObjects, selectedCalloutId]);

    // Update handle visibility when selection changes (without recreating objects)
    useEffect(() => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;



        calloutObjectsRef.current.forEach((objects, calloutId) => {
            const isSelected = calloutId === selectedCalloutId;
            const textBoxBg = objects.find(o => (o as CalloutPart).partType === 'textBoxBg') as Rect | undefined;
            const activeObject = canvas.getActiveObject();
            const isTextBoxBgActive = activeObject === textBoxBg;



            objects.forEach(obj => {
                const part = obj as CalloutPart;
                if (part.partType === 'arrowTip' || part.partType === 'knee') {
                    part.set('visible', isSelected);
                }
            });

            // Ensure textBoxBg is active when callout is selected to show resize handles
            if (isSelected && textBoxBg && !isTextBoxBgActive) {

                canvas.setActiveObject(textBoxBg);
            } else if (!isSelected && textBoxBg && isTextBoxBgActive) {

                canvas.discardActiveObject();
            }
        });

        canvas.requestRenderAll();
    }, [selectedCalloutId]);

    // Handle tool changes
    useEffect(() => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        if (activeTool === 'callout') {
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
            const target = canvas.findTarget(opt.e);
            const isModifierHeld = opt.e && ('ctrlKey' in opt.e || 'metaKey' in opt.e) &&
                ((opt.e as MouseEvent).ctrlKey || (opt.e as MouseEvent).metaKey);

            // If Ctrl/Cmd is held and clicking on a callout part, don't create new callout
            if (isModifierHeld && target) {
                return;
            }

            // Handle clicks on callout parts (lines, arrow head) to select the callout
            if (activeTool === 'select' && target) {
                const calloutPart = target as CalloutPart;
                if (calloutPart.calloutId && (calloutPart.partType === 'line1' || calloutPart.partType === 'line2' || calloutPart.partType === 'arrowHead')) {
                    // Find the textBoxBg for this callout and set it as active to show all handles
                    const parts = calloutObjectsRef.current.get(calloutPart.calloutId) ?? [];
                    const textBoxBg = parts.find(p => (p as CalloutPart).partType === 'textBoxBg');
                    if (textBoxBg) {
                        canvas.setActiveObject(textBoxBg);
                        setSelectedCalloutId(calloutPart.calloutId);
                        canvas.requestRenderAll();
                        return;
                    }
                }

                // Two-click edit: If clicking on text or textBoxBg of an already-selected callout,
                // set pending flag to enter edit mode on mouse up (if user doesn't drag)
                if (calloutPart.calloutId && (calloutPart.partType === 'text' || calloutPart.partType === 'textBoxBg')) {
                    const wasAlreadySelected = wasSelectedRef.current === calloutPart.calloutId;
                    if (wasAlreadySelected && !isEditingTextRef.current) {
                        // Set pending edit flag - will enter edit mode on mouse up if no drag occurred
                        pendingEditRef.current = calloutPart.calloutId;
                    }
                }
            }

            // Deselect only when clicking empty canvas in Select tool.
            if (activeTool === 'select') {
                if (!target && !isEditingTextRef.current) {
                    canvas.discardActiveObject();
                    canvas.requestRenderAll();
                    setSelectedCalloutId(null);


                }
                return;
            }

            // Don't start callout creation if clicking on existing object
            if (activeTool === 'callout' && !isEditingTextRef.current && !target) {
                const pointer = canvas.getScenePoint(opt.e);
                setIsCreating(true);
                setCreationStart({ x: pointer.x, y: pointer.y });

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
        };

        const handleMouseMove = (opt: TPointerEventInfo<TPointerEvent>) => {
            if (isCreating && creationStart) {
                const pointer = canvas.getScenePoint(opt.e);
                const style = defaultCalloutStyle;
                const textBoxWidth = 120;
                const textBoxHeight = 40;

                // Calculate knee position (midpoint horizontally, 40px above arrow tip)
                const knee: Point = {
                    x: (creationStart.x + pointer.x) / 2,
                    y: creationStart.y - 40,
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

                const { line1Start, shouldHide, line2Start, effectiveKnee } = calculateCalloutConnection(
                    pointer.x,
                    pointer.y,
                    textBoxWidth,
                    textBoxHeight,
                    knee,
                    creationStart,
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
                        x2: creationStart.x,
                        y2: creationStart.y,
                    });
                }

                // Update preview arrowhead
                if (previewArrowHeadRef.current) {
                    const angleDeg = (Math.atan2(creationStart.y - effectiveKnee.y, creationStart.x - effectiveKnee.x) * 180) / Math.PI;
                    previewArrowHeadRef.current.set({
                        left: creationStart.x,
                        top: creationStart.y,
                        angle: angleDeg + 90,
                    });
                }

                canvas.renderAll();
            }
        };

        const handleMouseUp = (opt: TPointerEventInfo<TPointerEvent>) => {
            if (isCreating && creationStart) {
                const pointer = canvas.getScenePoint(opt.e);

                // Remove preview objects
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
                    x: (creationStart.x + pointer.x) / 2,
                    y: creationStart.y - 40,
                };

                const newCallout: Callout = {
                    id,
                    arrowTip: creationStart,
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
                setCreationStart(null);
            } else {
                // Two-click edit: Enter edit mode if pending flag is set (click without drag)
                if (pendingEditRef.current) {
                    const calloutId = pendingEditRef.current;
                    pendingEditRef.current = null;

                    const parts = calloutObjectsRef.current.get(calloutId) ?? [];
                    const textObj = parts.find(p => (p as CalloutPart).partType === 'text') as Textbox | undefined;
                    if (textObj) {
                        canvas.setActiveObject(textObj);
                        textObj.enterEditing();
                        textObj.selectAll();
                        canvas.requestRenderAll();
                        return;
                    }
                }

                // Handle Drop Rejection for Callout Parts (Collision Logic)
                const target = opt.target as CalloutPart;
                if (target && target.calloutId && target.partType) {
                    const safeKey = `${target.calloutId}-${target.partType}`;
                    const parts = getParts(target.calloutId);
                    const textBoxBg = parts.get('textBoxBg') as unknown as Rect | undefined;
                    const line2 = parts.get('line2') as unknown as Line | undefined;
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

                        const buffer = 2;
                        // Check if arrow tip is inside textbox OR if textbox overlaps arrow tip
                        return (
                            arrowX >= boxL - buffer &&
                            arrowX <= boxL + boxW + buffer &&
                            arrowY >= boxT - buffer &&
                            arrowY <= boxT + boxH + buffer
                        );
                    };

                    // Helper to check if knee handle is touching arrow handle
                    const isKneeTouchingArrow = () => {
                        if (target.partType !== 'knee' || !kneeHandle || !arrowTipHandle) return false;

                        // Get current positions of both handles
                        // If dragging knee, use target's current position; otherwise use handle's position
                        const kneeLeft = target.partType === 'knee' ? (target.left ?? 0) : (kneeHandle.left ?? 0);
                        const kneeTop = target.partType === 'knee' ? (target.top ?? 0) : (kneeHandle.top ?? 0);
                        const kneeRight = kneeLeft + 12;
                        const kneeBottom = kneeTop + 12;

                        const arrowLeft = arrowTipHandle.left ?? 0;
                        const arrowTop = arrowTipHandle.top ?? 0;
                        const arrowRight = arrowLeft + 12;
                        const arrowBottom = arrowTop + 12;

                        // Check if the two 12x12 rectangles overlap
                        return (
                            kneeLeft < arrowRight &&
                            kneeRight > arrowLeft &&
                            kneeTop < arrowBottom &&
                            kneeBottom > arrowTop
                        );
                    };

                    if (isColliding() || isKneeTouchingArrow()) {
                        // COLLISION ON DROP - REJECT and snap back to initial position before drag
                        const initialPos = lastSafeObjectPosRef.current.get(safeKey);
                        if (initialPos) {
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
                                const { line1Start, shouldHide, line2Start, effectiveKnee } = calculateCalloutConnection(
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
        };

        const handleSelection = () => {
            const activeObject = canvas.getActiveObject() as CalloutPart | null;



            if (activeObject?.calloutId) {
                // Update wasSelectedRef for two-click edit detection
                // Use setTimeout to update after the current event cycle
                setTimeout(() => {
                    wasSelectedRef.current = activeObject.calloutId ?? null;
                }, 0);
                setSelectedCalloutId(activeObject.calloutId);

                const parts = calloutObjectsRef.current.get(activeObject.calloutId) ?? [];
                const textBoxBg = parts.find(p => (p as CalloutPart).partType === 'textBoxBg') as Rect | undefined;



                // Always set textBoxBg as active when any part of the callout is selected
                // (except when editing text, to allow text editing)
                // This ensures resize handles are always visible
                if (textBoxBg && !isEditingTextRef.current) {
                    // Set textBoxBg as active for all part types except 'text', 'knee', and 'arrowTip'
                    // (to allow text editing and handle dragging)
                    // This includes: line1, line2, arrowHead, textBoxBg
                    if (!activeObject.partType ||
                        activeObject.partType === 'line1' ||
                        activeObject.partType === 'line2' ||
                        activeObject.partType === 'arrowHead' ||
                        activeObject.partType === 'textBoxBg') {

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

        // Track last position for whole-callout drag
        const lastDragPosRef = { x: 0, y: 0 };

        const handleObjectMoving = (opt: { target: FabricObject; e: MouseEvent | TouchEvent }) => {
            const target = opt.target as CalloutPart;
            if (!target.calloutId || !target.partType) return;

            // Clear pending edit flag - user is dragging, not clicking
            pendingEditRef.current = null;

            // Keep selected while dragging any part.
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

            // --- Helper: Get Target's ID for tracking safe pos ---
            const safeKey = `${target.calloutId}-${target.partType}`;

            // Helper function to check collision
            const isColliding = () => {
                if (!textBoxBg || (!arrowTipHandle && !line2)) return false;

                // Collision check irrelevant for knee/line1 drags usually, mostly only ArrowTip or TextBox
                const isRelevantPart = target.partType === 'arrowTip' || target.partType === 'textBoxBg' || target.partType === 'text';
                if (!isRelevantPart) return false;

                // Get Candidate Box Bounds
                let boxL = textBoxBg.left ?? 0;
                let boxT = textBoxBg.top ?? 0;
                let boxW = textBoxBg.getScaledWidth();
                let boxH = textBoxBg.getScaledHeight();

                // If dragging box/text, use target's current (candidate) state
                if (target.partType === 'textBoxBg') {
                    boxL = target.left ?? 0;
                    boxT = target.top ?? 0;
                } else if (target.partType === 'text') {
                    const PADDING_X = 8;
                    const PADDING_Y = 4;
                    boxL = (target.left ?? 0) - PADDING_X;
                    boxT = (target.top ?? 0) - PADDING_Y;
                }

                // Get Candidate Arrow Position
                let arrowX = line2!.x2 ?? 0;
                let arrowY = line2!.y2 ?? 0;
                if (arrowTipHandle) {
                    arrowX = (arrowTipHandle.left ?? 0) + 6;
                    arrowY = (arrowTipHandle.top ?? 0) + 6;
                }

                // If dragging arrowTip, use target's current (candidate) state
                if (target.partType === 'arrowTip') {
                    arrowX = (target.left ?? 0) + 6;
                    arrowY = (target.top ?? 0) + 6;
                }

                // Check Intersection (Arrow Tip vs Box)
                const buffer = 2;
                return (
                    arrowX >= boxL - buffer &&
                    arrowX <= boxL + boxW + buffer &&
                    arrowY >= boxT - buffer &&
                    arrowY <= boxT + boxH + buffer
                );
            };

            // Init initial drag position if missing (start of drag - capture position before drag started)
            // This will be used to snap back if collision detected on mouse up
            if (!lastSafeObjectPosRef.current.has(safeKey)) {
                // Save ALL parts to ensure we can restore the full geometry (angle, knee pos, etc.)
                if (textBoxBg) lastSafeObjectPosRef.current.set(`${target.calloutId}-textBoxBg`, { left: textBoxBg.left ?? 0, top: textBoxBg.top ?? 0 });
                if (textObj) lastSafeObjectPosRef.current.set(`${target.calloutId}-text`, { left: textObj.left ?? 0, top: textObj.top ?? 0 });

                // Save Arrow Tip
                if (arrowTipHandle) {
                    lastSafeObjectPosRef.current.set(`${target.calloutId}-arrowTipHandle`, { left: arrowTipHandle.left ?? 0, top: arrowTipHandle.top ?? 0 });
                }
                const arrowX = arrowTipHandle ? (arrowTipHandle.left! + 6) : (line2.x2 ?? 0);
                const arrowY = arrowTipHandle ? (arrowTipHandle.top! + 6) : (line2.y2 ?? 0);
                lastSafeObjectPosRef.current.set(`${target.calloutId}-arrowTip`, { left: arrowX - 6, top: arrowY - 6 }); // Normalizing to "handle-like" coords? Or just raw? 
                // Let's stick to handle coords for restoration since we use set({left, top})

                // Save Knee
                if (kneeHandle) {
                    lastSafeObjectPosRef.current.set(`${target.calloutId}-kneeHandle`, { left: kneeHandle.left ?? 0, top: kneeHandle.top ?? 0 });
                }
                // Save generic safeKey too just in case logic relies on it existing
                lastSafeObjectPosRef.current.set(safeKey, { left: target.left ?? 0, top: target.top ?? 0 });
            }

            // Allow visual drag over textbox - don't prevent movement during drag
            // The collision check in handleMouseUp will handle snap-back to initial position on mouse release

            const PADDING_X = 8;
            const PADDING_Y = 4;

            // Check for Ctrl/Cmd key - move entire callout
            const isWholeMove = opt.e && ('ctrlKey' in opt.e || 'metaKey' in opt.e) &&
                ((opt.e as MouseEvent).ctrlKey || (opt.e as MouseEvent).metaKey);

            if (isWholeMove) {
                // Calculate movement delta from target's current position
                const currentX = target.left ?? 0;
                const currentY = target.top ?? 0;

                // Get the original position before this drag started (stored on first move)
                if (!lastDragPosRef.x && !lastDragPosRef.y) {
                    // Initialize - we'll compute delta from here
                    lastDragPosRef.x = currentX;
                    lastDragPosRef.y = currentY;
                    return;
                }

                const dx = currentX - lastDragPosRef.x;
                const dy = currentY - lastDragPosRef.y;

                // Move all parts by the delta
                if (textBoxBg && target.partType !== 'textBoxBg') {
                    textBoxBg.set({ left: (textBoxBg.left ?? 0) + dx, top: (textBoxBg.top ?? 0) + dy });
                }
                if (textObj && target.partType !== 'text') {
                    textObj.set({ left: (textObj.left ?? 0) + dx, top: (textObj.top ?? 0) + dy });
                }
                if (arrowTipHandle && target.partType !== 'arrowTip') {
                    arrowTipHandle.set({ left: (arrowTipHandle.left ?? 0) + dx, top: (arrowTipHandle.top ?? 0) + dy });
                }
                if (kneeHandle && target.partType !== 'knee') {
                    kneeHandle.set({ left: (kneeHandle.left ?? 0) + dx, top: (kneeHandle.top ?? 0) + dy });
                }
                if (arrowHead) {
                    arrowHead.set({ left: (arrowHead.left ?? 0) + dx, top: (arrowHead.top ?? 0) + dy });
                }

                // Update lines
                line1.set({
                    x1: (line1.x1 ?? 0) + dx,
                    y1: (line1.y1 ?? 0) + dy,
                    x2: (line1.x2 ?? 0) + dx,
                    y2: (line1.y2 ?? 0) + dy,
                });
                line2.set({
                    x1: (line2.x1 ?? 0) + dx,
                    y1: (line2.y1 ?? 0) + dy,
                    x2: (line2.x2 ?? 0) + dx,
                    y2: (line2.y2 ?? 0) + dy,
                });

                lastDragPosRef.x = currentX;
                lastDragPosRef.y = currentY;

                canvas.requestRenderAll();
                return;
            }

            // Reset last drag pos when not doing whole move
            lastDragPosRef.x = 0;
            lastDragPosRef.y = 0;

            const updateLine1StartFromBox = (preserveKneePosition: boolean = false) => {
                if (!textBoxBg) return;



                const boxLeft = textBoxBg.left ?? 0;
                const boxTop = textBoxBg.top ?? 0;
                const width = textBoxBg.getScaledWidth();
                const height = textBoxBg.getScaledHeight();

                // When preserving knee position, use the initial knee position from storage
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
                const { line1Start, shouldHide, line2Start: initialLine2Start, effectiveKnee } = calculateCalloutConnection(
                    boxLeft,
                    boxTop,
                    width,
                    height,
                    { x: kneeX, y: kneeY },
                    { x: arrowTipX, y: arrowTipY },
                    callout?.style.lineThickness ?? 0
                );

                // When preserving knee position, ensure lines don't stack
                let kneeForLines = preserveKneePosition ? { x: kneeX, y: kneeY } : effectiveKnee;
                // When preserving knee, line2Start should start from the preserved knee, not the calculated midpoint
                let line2Start = preserveKneePosition
                    ? { x: kneeX, y: kneeY }
                    : (initialLine2Start ? { ...initialLine2Start } : { x: effectiveKnee.x, y: effectiveKnee.y });

                if (!line1 || !line2) {
                    return;
                }

                // Line 1: Box border -> Knee/Midpoint
                // Line 2: Knee/Midpoint -> Arrow tip

                line1.set({
                    x1: line1Start.x,  // Box border (start)
                    y1: line1Start.y,
                    x2: kneeForLines.x, // Knee/Midpoint (end)
                    y2: kneeForLines.y,
                    opacity: shouldHide ? 0 : (line1.opacity || 1),
                });

                line2.set({
                    x1: line2Start.x,  // Knee/Midpoint (start)
                    y1: line2Start.y,
                    x2: arrowTipX,    // Arrow tip (end)
                    y2: arrowTipY
                });

                // Update visual handle if dragging box, but preserve position during textbox drag
                if (kneeHandle && !preserveKneePosition) {
                    kneeHandle.set({
                        left: effectiveKnee.x - 6,
                        top: effectiveKnee.y - 6
                    });
                }

                if (arrowHead) {
                    const angleDeg = (Math.atan2(arrowTipY - kneeForLines.y, arrowTipX - kneeForLines.x) * 180) / Math.PI;
                    arrowHead.set({ angle: angleDeg + 90 });
                }
            };

            // Moving the textbox: keep bg + text together AND update connector live.
            if (target.partType === 'textBoxBg' || target.partType === 'text') {
                if (textBoxBg && textObj) {
                    const boxLeft =
                        target.partType === 'text'
                            ? (target.left ?? 0) - PADDING_X
                            : (textBoxBg.left ?? 0);
                    const boxTop =
                        target.partType === 'text'
                            ? (target.top ?? 0) - PADDING_Y
                            : (textBoxBg.top ?? 0);

                    textBoxBg.set({ left: boxLeft, top: boxTop });
                    textBoxBg.setCoords(); // Ensure coordinates are updated before calculating connection
                    textObj.set({ left: boxLeft + PADDING_X, top: boxTop + PADDING_Y });

                    // If the user dragged the text object, snap it back to padding so the box doesn't "drift".
                    if (target.partType === 'text') {
                        target.set({ left: boxLeft + PADDING_X, top: boxTop + PADDING_Y });
                    }
                }

                // Preserve knee position during textbox drag - it will snap back on mouse up
                // Restore knee handle to initial position to prevent it from moving during drag
                if (kneeHandle) {
                    const initialKneePos = lastSafeObjectPosRef.current.get(`${target.calloutId}-kneeHandle`);
                    if (initialKneePos) {
                        kneeHandle.set({
                            left: initialKneePos.left,
                            top: initialKneePos.top
                        });
                        kneeHandle.setCoords();
                    }
                }

                updateLine1StartFromBox(true); // Pass true to preserve knee position
                canvas.requestRenderAll();
                return;
            }

            if (target.partType === 'arrowTip') {


                const tipX = (target.left ?? 0) + 6;
                const tipY = (target.top ?? 0) + 6;

                line2.set({ x2: tipX, y2: tipY });

                // Update line1 connection point when arrow tip moves
                updateLine1StartFromBox();

                if (arrowHead) {
                    const angleDeg = (Math.atan2(tipY - (line2.y1 ?? 0), tipX - (line2.x1 ?? 0)) * 180) / Math.PI;
                    arrowHead.set({ left: tipX, top: tipY, angle: angleDeg + 90 });
                }

                canvas.requestRenderAll();
                return;
            }

            if (target.partType === 'knee') {
                const kneeX = (target.left ?? 0) + 6;
                const kneeY = (target.top ?? 0) + 6;

                line1.set({ x2: kneeX, y2: kneeY });
                line2.set({ x1: kneeX, y1: kneeY });

                updateLine1StartFromBox();

                if (arrowHead) {
                    const tipX = line2.x2 ?? 0;
                    const tipY = line2.y2 ?? 0;
                    const angleDeg = (Math.atan2(tipY - kneeY, tipX - kneeX) * 180) / Math.PI;
                    arrowHead.set({ angle: angleDeg + 90 });
                }

                canvas.requestRenderAll();
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

            const { line1Start, shouldHide, line2Start, effectiveKnee } = calculateCalloutConnection(
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
                arrowHead.set({ angle: angleDeg + 90 });
            }

            canvas.requestRenderAll();
        };


        const handleObjectModified = (opt: { target: FabricObject }) => {
            const target = opt.target as CalloutPart;

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
            lastDragPosRef.x = 0;
            lastDragPosRef.y = 0;

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

        canvas.on('mouse:down', handleMouseDown);
        canvas.on('mouse:move', handleMouseMove);
        canvas.on('mouse:up', handleMouseUp);
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
            canvas.off('mouse:down', handleMouseDown);
            canvas.off('mouse:move', handleMouseMove);
            canvas.off('mouse:up', handleMouseUp);
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
    }, [activeTool, isCreating, creationStart, setCallouts, setSelectedCalloutId, hoveredHandleCalloutId]);

    return (
        <div className="flex-1 overflow-auto bg-canvas-bg p-8">
            <div className="shadow-page mx-auto" style={{ width: '816px', height: '1056px' }}>
                <canvas ref={canvasRef} />
            </div>
        </div>
    );
};
