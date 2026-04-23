import { useRef, useEffect } from 'react';
import { fabric } from 'fabric';
import { renumberCounters } from '../utils/counterNumbering';

export function useCounterTool(canvas, isToolActive, setActiveObject, activeSeriesId, globals) {
  const isDragging = useRef(false);
  const currentPin = useRef(null);
  const startPoint = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 }); // offset from center to mouse during drag-snug

  // Math translation from the original app
  function createCounterPathD(centerX, centerY, radius, pointerAngleDeg) {
    const angleRad = (pointerAngleDeg * Math.PI) / 180;
    const dirX = Math.cos(angleRad);
    const dirY = Math.sin(angleRad);
    const tipExtension = Math.max(5, radius * 0.5);
    const tipDistance = radius + tipExtension;
    const tipX = centerX + dirX * tipDistance;
    const tipY = centerY + dirY * tipDistance;

    const tangentHalfAngle = Math.acos(radius / tipDistance);
    const t1Angle = angleRad + tangentHalfAngle;
    const t2Angle = angleRad - tangentHalfAngle;
    const t1x = centerX + Math.cos(t1Angle) * radius;
    const t1y = centerY + Math.sin(t1Angle) * radius;
    const t2x = centerX + Math.cos(t2Angle) * radius;
    const t2y = centerY + Math.sin(t2Angle) * radius;

    return `M ${tipX} ${tipY} L ${t1x} ${t1y} A ${radius} ${radius} 0 1 1 ${t2x} ${t2y} Z`;
  }

  // Update a pin's path natively
  function updatePinPath(pinGroup) {
      if (!pinGroup) return;
      const data = pinGroup.data || {};
      const radius = data.radius || 14;
      const angle = data.pointerAngle ?? 225;
      
      const newPathD = createCounterPathD(0, 0, radius, angle);
      const pathObj = pinGroup.item(0);
      if (pathObj) {
          pathObj.set({ path: new fabric.Path(newPathD).path });
          pathObj.setCoords();
      }
      pinGroup.setCoords();
  }

  // Re-run global sequence numbering
  const performSequenceRenumbering = () => {
    // 1. Sync the current active canvas into globals.pageMapRef before renumbering
    if (canvas && globals.currentPageRef?.current) {
        // Find which page we are on from canvas bounds or simply dump it.
        // Actually since we have multiple canvases now, we pass `pageNumber` or 
        // we can just renumber the globally aggregated object. 
        // BUT `annotationsByPage` expects `{ [pageKey]: { objects: [...] } }`.
        // If we are operating inside a specific PDFPage, `canvas` belongs to it.
        // The safest mechanism is to sync `canvas` into its specific map.
    }
    
    // In our simplified playground without full central state redux, 
    // we can renumber the current canvas objects in isolation, or if we have
    // full multi-page support, we loop the canvas objects.
    
    // Convert current canvas to JSON payload
    const canvasObjects = canvas.getObjects().filter(o => o.data?.type === 'counter');
    
    // Group inside the current canvas only for now (playground constraint)
    const pageMap = {
        'current_page': { objects: canvasObjects }
    };
    
    renumberCounters(pageMap);
    
    // Apply new display numbers back to canvas
    for (const obj of canvasObjects) {
        const textObj = obj.item(1);
        if (textObj) {
            textObj.set('text', obj.data.displayNumber.toString());
        }
    }
    canvas.requestRenderAll();
  };

  useEffect(() => {
    if (!canvas) return;

    // Build Custom Tip-Rotation Control
    const counterRotateControl = new fabric.Control({
      x: 0,
      y: 0,
      cursorStyle: 'crosshair',
      actionHandler: function(eventData, transform, x, y) {
         // Live rotate custom property
         const target = transform.target;
         const center = target.getCenterPoint();
         const angleDeg = Math.atan2(y - center.y, x - center.x) * 180 / Math.PI;
         target.data.pointerAngle = angleDeg;
         updatePinPath(target);
         canvas.requestRenderAll();
         return true;
      },
      actionName: 'counterRotate',
      positionHandler: function(dim, finalMatrix, fabricObject) {
         const radius = fabricObject.data?.radius || 14;
         const angle = fabricObject.data?.pointerAngle ?? 225;
         const tipExtension = Math.max(5, radius * 0.5);
         const tipDist = radius + tipExtension;
         const angleRad = (angle * Math.PI) / 180;
         
         const x = Math.cos(angleRad) * tipDist;
         const y = Math.sin(angleRad) * tipDist;
         return fabric.util.transformPoint(
            new fabric.Point(x, y),
            fabricObject.calcTransformMatrix()
         );
      },
      render: function(ctx, left, top, styleOverride, fabricObject) {
         ctx.save();
         ctx.beginPath();
         // Sqrt damped stroke radius matching original SVG overlay
         const r = 7; 
         ctx.arc(left, top, r, 0, 2 * Math.PI, false);
         ctx.fillStyle = '#ffffff';
         ctx.fill();
         ctx.lineWidth = 1.5;
         ctx.strokeStyle = '#4a90e2';
         ctx.stroke();
         ctx.restore();
      }
    });

    const setupCounterControls = (pinGroup) => {
        pinGroup.setControlsVisibility({
            tl: false, tr: false, bl: false, br: false,
            ml: false, mt: false, mr: false, mb: false,
            mtr: false // Remove standard rotator
        });
        pinGroup.controls = {
            customRotation: counterRotateControl
        };
        pinGroup.set({
            hasBorders: false,
            transparentCorners: false,
            padding: 0
        });
    };

    const handleMouseDown = (o) => {
      // Allow modifying existing objects safely
      if (canvas.getActiveObject() && !isToolActive) return;
      if (!isToolActive) return;
      
      const pointer = canvas.getPointer(o.e);
      if (canvas.getActiveObject()) return; // Don't drop exactly on another boundary

      isDragging.current = true;
      startPoint.current = pointer;

      const initialRadius = 14;
      const initialAngle = 225; // Default bottom-left pointer
      
      const pathD = createCounterPathD(0, 0, initialRadius, initialAngle);
      
      const bubblePath = new fabric.Path(pathD, {
        fill: globals.currentColorRef.current || '#ef4444',
        originX: 'center',
        originY: 'center',
      });

      const textNode = new fabric.Text("1", { // Temporary "1", renumbered on mouseup
        fontSize: Math.max(11, initialRadius * 1.05),
        fontWeight: 'bold',
        fill: '#ffffff',
        originX: 'center',
        originY: 'center',
        fontFamily: '-apple-system, system-ui, sans-serif',
      });

      currentPin.current = new fabric.Group([bubblePath, textNode], {
        left: pointer.x,
        top: pointer.y,
        originX: 'center',
        originY: 'center',
        selectable: true,
        data: { 
          type: 'counter', 
          radius: initialRadius,
          pointerAngle: initialAngle,
          seriesId: activeSeriesId || '__legacy__',
          createdAt: Date.now(),
          displayNumber: 1
        }
      });
      
      setupCounterControls(currentPin.current);
      
      // Calculate offset inside the drag snug mechanism
      dragOffset.current = { x: 0, y: 0 }; 

      canvas.add(currentPin.current);
      canvas.setActiveObject(currentPin.current);
      // Run quick sequence fix immediately visually
      performSequenceRenumbering();
    };

    const handleMouseMove = (o) => {
      if (!isDragging.current || !currentPin.current) return;

      const pointer = canvas.getPointer(o.e);
      
      if (o.e.shiftKey) {
          // SHIFT Rotate Mode
          // Freeze position, calculate pointer angle mapped to center
          const center = currentPin.current.getCenterPoint();
          const dy = pointer.y - center.y;
          const dx = pointer.x - center.x;
          let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
          
          currentPin.current.data.pointerAngle = angleDeg;
          updatePinPath(currentPin.current);
      } else {
          // Normal Drag Move Mode
          currentPin.current.set({
              left: pointer.x - dragOffset.current.x,
              top: pointer.y - dragOffset.current.y
          });
          currentPin.current.setCoords();
      }
      
      canvas.requestRenderAll();
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      
      performSequenceRenumbering(); // Finalize sequencing globally across page
      setActiveObject(currentPin.current);
      currentPin.current = null;
      startPoint.current = null;
      
      // Save checkpoint state to main Map...
      // Handled via selection/modified events natively in App.jsx.
    };

    const handleSelectionCreated = (e) => {
      if (e.selected && e.selected.length > 0) {
        const obj = e.selected[0];
        if (obj && obj.type === 'group' && obj.data?.type === 'counter') {
          setupCounterControls(obj); // ensure controls exist
          setActiveObject(obj);
        }
      }
    };

    const handleSelectionCleared = () => {
      if (!isDragging.current) {
         setActiveObject(null);
      }
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('selection:created', handleSelectionCreated);
    canvas.on('selection:updated', handleSelectionCreated);
    canvas.on('selection:cleared', handleSelectionCleared);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('selection:created', handleSelectionCreated);
      canvas.off('selection:updated', handleSelectionCreated);
      canvas.off('selection:cleared', handleSelectionCleared);
    };
  }, [canvas, isToolActive, setActiveObject, globals, activeSeriesId]);
}
