import React, { useEffect, useRef, memo } from 'react';
import { Canvas, Rect, Circle, Line, Triangle, Textbox, PencilBrush, Polyline, Group, util, Path } from 'fabric';
import { regionContainsPoint } from './utils/regionMath';

// Helper function to check if a point is within eraser radius of any point in eraser path
const isPointNearEraserPath = (point, eraserPath, eraserRadius) => {
  return eraserPath.points.some(eraserPoint => {
    const distance = Math.sqrt(
      Math.pow(point.x - eraserPoint.x, 2) +
      Math.pow(point.y - eraserPoint.y, 2)
    );
    return distance < eraserRadius;
  });
};

// Helper function to check if a point is near a path object (for click detection)
const isPointNearPath = (point, pathObj, threshold) => {
  if (pathObj.type !== 'path') return false;
  
  try {
    // First try using Fabric.js's containsPoint method
    if (pathObj.containsPoint && typeof pathObj.containsPoint === 'function') {
      try {
        // containsPoint checks if point is within the stroke
        const contains = pathObj.containsPoint(point);
        if (contains) return true;
      } catch (e) {
        // Fall through to manual check
      }
    }
    
    // Get path bounds for quick rejection
    const bounds = pathObj.getBoundingRect();
    const strokeWidth = pathObj.strokeWidth || 3;
    const effectiveThreshold = Math.max(threshold, strokeWidth / 2 + 2); // Add small buffer
    
    // Quick bounding box check with threshold
    if (point.x < bounds.left - effectiveThreshold || 
        point.x > bounds.left + bounds.width + effectiveThreshold ||
        point.y < bounds.top - effectiveThreshold || 
        point.y > bounds.top + bounds.height + effectiveThreshold) {
      return false;
    }
    
    // For more precise detection, check distance to path segments
    // Extract points from path data
    const pathData = pathObj.path;
    if (!pathData || pathData.length === 0) return false;
    
    let minDistance = Infinity;
    let currentX = 0, currentY = 0;
    
    for (let i = 0; i < pathData.length; i++) {
      const cmd = pathData[i];
      const command = cmd[0];
      let endX, endY;
      
      if (command === 'M' || command === 'm') {
        endX = command === 'M' ? cmd[1] : currentX + cmd[1];
        endY = command === 'M' ? cmd[2] : currentY + cmd[2];
        currentX = endX;
        currentY = endY;
      } else if (command === 'L' || command === 'l') {
        endX = command === 'L' ? cmd[1] : currentX + cmd[1];
        endY = command === 'L' ? cmd[2] : currentY + cmd[2];
        
        // Check distance to line segment
        const canvasStartX = currentX + (pathObj.left || 0);
        const canvasStartY = currentY + (pathObj.top || 0);
        const canvasEndX = endX + (pathObj.left || 0);
        const canvasEndY = endY + (pathObj.top || 0);
        
        // Distance from point to line segment
        const A = point.x - canvasStartX;
        const B = point.y - canvasStartY;
        const C = canvasEndX - canvasStartX;
        const D = canvasEndY - canvasStartY;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) param = dot / lenSq;
        
        let xx, yy;
        if (param < 0) {
          xx = canvasStartX;
          yy = canvasStartY;
        } else if (param > 1) {
          xx = canvasEndX;
          yy = canvasEndY;
        } else {
          xx = canvasStartX + param * C;
          yy = canvasStartY + param * D;
        }
        
        const dx = point.x - xx;
        const dy = point.y - yy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        minDistance = Math.min(minDistance, distance);
        
        currentX = endX;
        currentY = endY;
      } else if (command === 'C' || command === 'c' || command === 'Q' || command === 'q') {
        // For bezier curves, just check end point
        if (command === 'C' || command === 'c') {
          endX = command === 'C' ? cmd[5] : currentX + cmd[5];
          endY = command === 'C' ? cmd[6] : currentY + cmd[6];
        } else {
          endX = command === 'Q' ? cmd[3] : currentX + cmd[3];
          endY = command === 'Q' ? cmd[4] : currentY + cmd[4];
        }
        
        const canvasEndX = endX + (pathObj.left || 0);
        const canvasEndY = endY + (pathObj.top || 0);
        const distance = Math.sqrt(
          Math.pow(point.x - canvasEndX, 2) + Math.pow(point.y - canvasEndY, 2)
        );
        minDistance = Math.min(minDistance, distance);
        
        currentX = endX;
        currentY = endY;
      }
    }
    
    return minDistance < effectiveThreshold;
  } catch (e) {
    // Fallback: use bounding box check
    const bounds = pathObj.getBoundingRect();
    const strokeWidth = pathObj.strokeWidth || 3;
    const effectiveThreshold = Math.max(threshold, strokeWidth / 2);
    return point.x >= bounds.left - effectiveThreshold &&
           point.x <= bounds.left + bounds.width + effectiveThreshold &&
           point.y >= bounds.top - effectiveThreshold &&
           point.y <= bounds.top + bounds.height + effectiveThreshold;
  }
};

// Helper function to get path points from a Fabric.js path object
const getPathPoints = (pathObj) => {
  const points = [];
  if (pathObj.path) {
    // Convert SVG path to points
    const pathData = pathObj.path;
    for (let i = 0; i < pathData.length; i++) {
      const command = pathData[i];
      if (command[0] === 'M' || command[0] === 'L' || command[0] === 'Q' || command[0] === 'C') {
        // Extract coordinates based on command type
        if (command[0] === 'M' || command[0] === 'L') {
          points.push({ x: command[1], y: command[2] });
        } else if (command[0] === 'Q') {
          // Quadratic bezier - use control and end points
          points.push({ x: command[1], y: command[2] });
          points.push({ x: command[3], y: command[4] });
        } else if (command[0] === 'C') {
          // Cubic bezier - use control and end points
          points.push({ x: command[1], y: command[2] });
          points.push({ x: command[3], y: command[4] });
          points.push({ x: command[5], y: command[6] });
        }
      }
    }
  }
  return points;
};

// Helper function to erase part of a path by modifying path data
const erasePathSegment = (pathObj, eraserPath, eraserRadius, canvas) => {
  if (pathObj.type !== 'path') {
    return false;
  }

  try {
    // Store properties
    const originalProps = {
      stroke: pathObj.stroke,
      strokeWidth: pathObj.strokeWidth,
      fill: pathObj.fill,
      strokeUniform: pathObj.strokeUniform,
      spaceId: pathObj.spaceId,
      moduleId: pathObj.moduleId,
      left: pathObj.left,
      top: pathObj.top
    };

    // Get path data
    const pathData = pathObj.path;
    if (!pathData || pathData.length === 0) return false;

    // Convert path commands to points
    const pathPoints = [];
    let currentX = 0, currentY = 0;

    for (let i = 0; i < pathData.length; i++) {
      const cmd = pathData[i];
      const command = cmd[0];

      if (command === 'M' || command === 'm') {
        currentX = command === 'M' ? cmd[1] : currentX + cmd[1];
        currentY = command === 'M' ? cmd[2] : currentY + cmd[2];
        pathPoints.push({ x: currentX, y: currentY, command: 'M', index: i });
      } else if (command === 'L' || command === 'l') {
        currentX = command === 'L' ? cmd[1] : currentX + cmd[1];
        currentY = command === 'L' ? cmd[2] : currentY + cmd[2];
        pathPoints.push({ x: currentX, y: currentY, command: 'L', index: i });
      } else if (command === 'C' || command === 'c') {
        // Cubic bezier - use end point
        currentX = command === 'C' ? cmd[5] : currentX + cmd[5];
        currentY = command === 'C' ? cmd[6] : currentY + cmd[6];
        pathPoints.push({ x: currentX, y: currentY, command: 'C', index: i });
      } else if (command === 'Q' || command === 'q') {
        // Quadratic bezier - use end point
        currentX = command === 'Q' ? cmd[3] : currentX + cmd[3];
        currentY = command === 'Q' ? cmd[4] : currentY + cmd[4];
        pathPoints.push({ x: currentX, y: currentY, command: 'Q', index: i });
      }
    }

    if (pathPoints.length < 2) return false;

    // Convert to canvas coordinates
    const pointsInCanvas = pathPoints.map(p => ({
      ...p,
      canvasX: p.x + originalProps.left,
      canvasY: p.y + originalProps.top
    }));

    // Split stroke by eraser - iterate through each point
    const segments = [];
    let currentSegment = [];

    for (let i = 0; i < pointsInCanvas.length; i++) {
      const point = pointsInCanvas[i];
      let isErased = false;

      // Check if this point is within eraser path
      for (const eraserPoint of eraserPath.points) {
        const distance = Math.sqrt(
          Math.pow(point.canvasX - eraserPoint.x, 2) +
          Math.pow(point.canvasY - eraserPoint.y, 2)
        );
        if (distance < eraserRadius) {
          isErased = true;
          break;
        }
      }

      if (isErased) {
        // Point is erased, save current segment if it has enough points
        if (currentSegment.length >= 2) {
          segments.push([...currentSegment]);
        }
        currentSegment = [];
      } else {
        // Point survives, add to current segment
        currentSegment.push(point);
      }
    }

    // Save final segment
    if (currentSegment.length >= 2) {
      segments.push(currentSegment);
    }

    // If no segments remain, remove path
    if (segments.length === 0) {
      canvas.remove(pathObj);
      return true;
    }

    // If path wasn't modified (still has all points), do nothing
    if (segments.length === 1 && segments[0].length === pointsInCanvas.length) {
      return false;
    }

    // Remove original and create new paths for each segment
    canvas.remove(pathObj);

    segments.forEach(segment => {
      if (segment.length < 2) return;

      const newPathData = [];
      for (let i = 0; i < segment.length; i++) {
        const point = segment[i];
        if (i === 0) {
          newPathData.push(['M', point.x, point.y]);
        } else {
          newPathData.push(['L', point.x, point.y]);
        }
      }

      const newPath = new Path(newPathData, originalProps);
      canvas.add(newPath);
    });

    return true;
  } catch (e) {
    console.error('Error erasing path segment:', e);
    return false;
  }
};

// Ensure color is in rgba format with specified opacity (default 0.2, but highlights use 1.0)
const ensureRgbaOpacity = (color, opacity = 0.2) => {
  if (!color) return `rgba(255, 193, 7, ${opacity})`; // Default yellow
  
  // If already rgba, ensure opacity is correct
  if (color.startsWith('rgba')) {
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgbaMatch) {
      return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${opacity})`;
    }
  }
  
  // If hex, convert to rgba
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  
  // Fallback
  return color;
};

const PageAnnotationLayer = memo(({
  pageNumber,
  width,
  height,
  scale,
  tool = 'pan', // 'pen' | 'highlighter' | 'eraser' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'underline' | 'strikeout' | 'squiggly' | 'note' | 'highlight'
  strokeColor = '#DC3545',
  strokeWidth = 3,
  annotations = null,
  onSaveAnnotations = () => {},
  highlightColor = 'rgba(255, 193, 7, 0.3)',
  newHighlights = null, // Array of {x, y, width, height} to add
  highlightsToRemove = null, // Array of {x, y, width, height} to remove
  onHighlightCreated = null, // Callback for when highlight tool creates a rectangle
  onHighlightDeleted = null, // Callback for when highlight is deleted via eraser
  selectedSpaceId = null, // Space ID to filter annotations by
  selectedModuleId = null, // Module ID to filter annotations by
  activeRegions = null,
  eraserMode = 'partial', // 'partial' | 'entire'
  showSurveyPanel = false // Whether survey mode is active
}) => {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const processedHighlightsRef = useRef(new Set());
  const isInitializedRef = useRef(false);
  const drawingStateRef = useRef({ isDrawingShape: false, startX: 0, startY: 0, tempObj: null });
  const toolRef = useRef(tool);
  const strokeColorRef = useRef(strokeColor);
  const strokeWidthRef = useRef(strokeWidth);
  const onHighlightCreatedRef = useRef(onHighlightCreated);
  const onHighlightDeletedRef = useRef(onHighlightDeleted);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const selectedModuleIdRef = useRef(selectedModuleId);
  const showSurveyPanelRef = useRef(showSurveyPanel);
  const eraserModeRef = useRef(eraserMode);
  const isErasingRef = useRef(false);
  const eraserPathRef = useRef(null);
  
  // Keep highlight callback refs in sync
  useEffect(() => {
    onHighlightCreatedRef.current = onHighlightCreated;
  }, [onHighlightCreated]);
  
  useEffect(() => {
    onHighlightDeletedRef.current = onHighlightDeleted;
  }, [onHighlightDeleted]);

  // Keep selectedSpaceId ref in sync
  useEffect(() => {
    selectedSpaceIdRef.current = selectedSpaceId;
  }, [selectedSpaceId]);

  useEffect(() => {
    selectedModuleIdRef.current = selectedModuleId;
  }, [selectedModuleId]);

  // Keep showSurveyPanel ref in sync
  useEffect(() => {
    showSurveyPanelRef.current = showSurveyPanel;
  }, [showSurveyPanel]);

  useEffect(() => {
    eraserModeRef.current = eraserMode;
  }, [eraserMode]);

  // Initialize canvas only once
  useEffect(() => {
    if (!canvasRef.current || !width || !height || isInitializedRef.current) return;
    
    console.log(`[Page ${pageNumber}] Initializing canvas`);
    isInitializedRef.current = true;

    const canvas = new Canvas(canvasRef.current, {
      width: width * scale,
      height: height * scale,
      backgroundColor: 'transparent',
      selection: tool === 'pan' || tool === 'eraser',
      isDrawingMode: tool === 'pen' || tool === 'highlighter',
    });

    const brush = new PencilBrush(canvas);
    brush.color = strokeColor;
    brush.width = strokeWidth;
    canvas.freeDrawingBrush = brush;

    fabricRef.current = canvas;

    if (annotations && annotations.objects && annotations.objects.length > 0) {
      console.log(`[Page ${pageNumber}] Loading ${annotations.objects.length} annotations`);
      annotations.objects.forEach(objData => {
        util.enlivenObjects([objData], (enlivenedObjects) => {
          enlivenedObjects.forEach(obj => {
            obj.set({ strokeUniform: true });
            // Store spaceId on object if not already set (for backward compatibility)
            if (!obj.spaceId) {
              obj.spaceId = objData.spaceId || null;
            }
            if (!obj.moduleId) {
              obj.moduleId = objData.moduleId || null;
            }
            canvas.add(obj);
          });
          // After loading, filter by selectedSpaceId
          canvas.getObjects().forEach(obj => {
            const objSpaceId = obj.spaceId || null;
            const objModuleId = obj.moduleId || null;
            const currentSpaceId = selectedSpaceIdRef.current;
            const currentModuleId = selectedModuleIdRef.current;
            const matchesSpace = currentSpaceId === null || objSpaceId === currentSpaceId;
            const matchesModule = currentModuleId === null || objModuleId === currentModuleId;
            const isVisible = matchesSpace && matchesModule;
            obj.set({ visible: isVisible });
            if (!isVisible) {
              obj.set({ selectable: false, evented: false });
            }
          });
          canvas.renderAll();
        });
      });
    } else {
      // no-op; start with empty canvas
    }

    const saveCanvas = () => {
      if (!fabricRef.current) return;
      try {
        // Include spaceId in the saved JSON to preserve space associations
        const canvasJSON = fabricRef.current.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'highlightId', 'needsBIC']);
        onSaveAnnotations(pageNumber, canvasJSON);
      } catch (e) {
        console.error(`[Page ${pageNumber}] Save error:`, e);
      }
    };

    const setBrushForTool = () => {
      canvas.isDrawingMode = tool === 'pen' || tool === 'highlighter';
      canvas.selection = tool === 'pan'; // Disable selection for eraser to prevent selection box
      canvas.defaultCursor = (tool === 'eraser' ? 'crosshair' : (tool === 'text' ? 'text' : (tool === 'highlight' ? 'crosshair' : (canvas.isDrawingMode ? 'crosshair' : 'default'))));
      canvas.hoverCursor = canvas.defaultCursor;
      const c = tool === 'highlighter' ? highlightColor : strokeColor;
      const w = tool === 'highlighter' ? Math.max(strokeWidth, 8) : strokeWidth;
      canvas.freeDrawingBrush.color = c;
      canvas.freeDrawingBrush.width = w;
    };

    setBrushForTool();

    const handlePathCreated = (e) => {
      if (e.path) {
        e.path.set({ strokeUniform: true });
        // Store current selectedSpaceId on the path
        if (selectedSpaceIdRef.current) {
          e.path.set({ spaceId: selectedSpaceIdRef.current });
        }
      if (selectedModuleIdRef.current) {
        e.path.set({ moduleId: selectedModuleIdRef.current });
      }
      }
      saveCanvas();
    };

    const handleObjectModified = () => saveCanvas();

    const handleMouseDown = (opt) => {
      const currentTool = toolRef.current;
      const currentStrokeColor = strokeColorRef.current;
      const currentStrokeWidth = strokeWidthRef.current;
      const currentEraserMode = eraserModeRef.current;
      const { x, y } = canvas.getPointer(opt.e);
      if (currentTool === 'eraser') {
        // For eraser, we need to find the actual target more precisely
        // canvas.findTarget can be too permissive, so we'll check all objects
        const pointer = canvas.getPointer(opt.e);
        const eraserRadius = currentStrokeWidth || 10;
        
        // Find the closest object that's actually under the cursor
        let target = null;
        let minDistance = Infinity;
        
        const objects = canvas.getObjects();
        for (const obj of objects) {
          // Only check objects from current space
          const objSpaceId = obj.spaceId || null;
          if (selectedSpaceIdRef.current !== null && objSpaceId !== selectedSpaceIdRef.current) {
            continue;
          }
          
          // Check if this is a highlight (always delete entirely)
          const hasHighlightId = obj.highlightId != null;
          const hasNeedsBICFlag = obj.needsBIC === true;
          const isColoredHighlight = obj.type === 'rect' && (
            (obj.fill && typeof obj.fill === 'string' && obj.fill.includes('rgba')) ||
            (obj.fill && typeof obj.fill === 'string' && obj.fill.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/))
          );
          const fillIsTransparent = !obj.fill || obj.fill === 'transparent' || 
            (typeof obj.fill === 'string' && obj.fill === 'transparent');
          const hasStroke = obj.stroke && typeof obj.stroke === 'string' && obj.stroke !== 'transparent';
          const isNeedsBICHighlight = obj.type === 'rect' && fillIsTransparent && hasStroke;
          const isHighlight = hasHighlightId || hasNeedsBICFlag || isColoredHighlight || isNeedsBICHighlight;
          
          if (isHighlight) {
            // For highlights, check if click is within bounds
            const bounds = obj.getBoundingRect();
            if (pointer.x >= bounds.left && pointer.x <= bounds.left + bounds.width &&
                pointer.y >= bounds.top && pointer.y <= bounds.top + bounds.height) {
              target = obj;
              break; // Highlights take priority
            }
          } else if (obj.type === 'path') {
            // For paths, check if point is actually on/near the path
            if (isPointNearPath(pointer, obj, eraserRadius)) {
              const bounds = obj.getBoundingRect();
              const centerX = bounds.left + bounds.width / 2;
              const centerY = bounds.top + bounds.height / 2;
              const distance = Math.sqrt(
                Math.pow(pointer.x - centerX, 2) + Math.pow(pointer.y - centerY, 2)
              );
              if (distance < minDistance) {
                minDistance = distance;
                target = obj;
              }
            }
          } else {
            // For other objects, check if click is within bounds
            const bounds = obj.getBoundingRect();
            if (pointer.x >= bounds.left && pointer.x <= bounds.left + bounds.width &&
                pointer.y >= bounds.top && pointer.y <= bounds.top + bounds.height) {
              target = obj;
              break;
            }
          }
        }
        
        if (target) {
          // Check if this is a highlight
          const hasHighlightId = target.highlightId != null;
          const hasNeedsBICFlag = target.needsBIC === true;
          const isColoredHighlight = target.type === 'rect' && (
            (target.fill && typeof target.fill === 'string' && target.fill.includes('rgba')) ||
            (target.fill && typeof target.fill === 'string' && target.fill.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/))
          );
          const fillIsTransparent = !target.fill || target.fill === 'transparent' || 
            (typeof target.fill === 'string' && target.fill === 'transparent');
          const hasStroke = target.stroke && typeof target.stroke === 'string' && target.stroke !== 'transparent';
          const isNeedsBICHighlight = target.type === 'rect' && fillIsTransparent && hasStroke;
          const isHighlight = hasHighlightId || hasNeedsBICFlag || isColoredHighlight || isNeedsBICHighlight;
          
          // Survey Highlights must always be deleted entirely regardless of mode
          if (isHighlight) {
            // Always delete highlights entirely
            if (onHighlightDeletedRef.current) {
              const currentZoom = canvas.getZoom ? canvas.getZoom() : scale;
              const bounds = {
                x: target.left / currentZoom,
                y: target.top / currentZoom,
                width: target.width / currentZoom,
                height: target.height / currentZoom,
                pageNumber
              };
              const highlightId = target.highlightId || null;
              
              if (highlightId && renderedHighlightsRef.current.has(highlightId)) {
                renderedHighlightsRef.current.delete(highlightId);
              }
              
              const highlightKey = highlightId || `${bounds.x}-${bounds.y}-${bounds.width}-${bounds.height}`;
              processedHighlightsRef.current.delete(highlightKey);
              
              canvas.discardActiveObject();
              canvas.remove(target);
              canvas.requestRenderAll();
              saveCanvas();
              
              if (onHighlightDeletedRef.current) {
                onHighlightDeletedRef.current(pageNumber, bounds, highlightId);
              }
            }
            return;
          }
          
          // For non-highlight objects, check eraser mode
          if (currentEraserMode === 'entire') {
            // Entire mode: Remove object immediately on touch
            canvas.remove(target);
            canvas.discardActiveObject();
            canvas.requestRenderAll();
            saveCanvas();
          } else {
            // Partial mode: Set up erasing state for drag-based erasing
            isErasingRef.current = true;
            canvas.discardActiveObject();
            eraserPathRef.current = {
              target: target,
              startX: x,
              startY: y,
              points: [{ x, y }]
            };
          }
        } else {
          // No target found, start partial erasing if in partial mode (for drag-to-erase)
          if (currentEraserMode === 'partial') {
            isErasingRef.current = true;
            eraserPathRef.current = {
              target: null,
              startX: x,
              startY: y,
              points: [{ x, y }]
            };
          }
        }
        return;
      }
      if (currentTool === 'text') {
        const tb = new Textbox('Text', {
          left: x,
          top: y,
          fontSize: 16,
          fill: currentStrokeColor,
          editable: true,
          backgroundColor: 'transparent'
        });
        // Store current selectedSpaceId on the textbox
        if (selectedSpaceIdRef.current) {
          tb.set({ spaceId: selectedSpaceIdRef.current });
        }
        if (selectedModuleIdRef.current) {
          tb.set({ moduleId: selectedModuleIdRef.current });
        }
        canvas.add(tb);
        canvas.setActiveObject(tb);
        canvas.requestRenderAll();
        saveCanvas();
        return;
      }
      // Shape tools
      const ds = drawingStateRef.current;
      ds.isDrawingShape = false;
      let temp = null;
      if (currentTool === 'highlight') {
        // Highlight tool: create a clear selection rectangle (transparent fill, visible border)
        temp = new Rect({ 
          left: x, 
          top: y, 
          width: 1, 
          height: 1, 
          fill: 'transparent', 
          stroke: '#4A90E2', 
          strokeWidth: 2, 
          strokeDashArray: [5, 5],
          strokeUniform: true,
          selectable: false,
          evented: false
        });
        ds.isDrawingShape = true;
        ds.startX = x;
        ds.startY = y;
        ds.tempObj = temp;
        if (selectedModuleIdRef.current) {
          temp.set({ moduleId: selectedModuleIdRef.current });
        }
        canvas.add(temp);
        return;
      } else if (currentTool === 'rect') {
        temp = new Rect({ left: x, top: y, width: 1, height: 1, fill: 'rgba(0,0,0,0)', stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true });
      } else if (currentTool === 'ellipse') {
        temp = new Circle({ left: x, top: y, radius: 1, fill: 'rgba(0,0,0,0)', stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true, originX: 'left', originY: 'top' });
      } else if (currentTool === 'line' || currentTool === 'underline' || currentTool === 'strikeout') {
        temp = new Line([x, y, x, y], { stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true });
      } else if (currentTool === 'arrow') {
        temp = new Line([x, y, x, y], { stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, strokeUniform: true });
      } else if (currentTool === 'squiggly') {
        temp = new Polyline([[x, y]], { stroke: currentStrokeColor, strokeWidth: currentStrokeWidth, fill: 'transparent', strokeUniform: true });
      } else if (currentTool === 'note') {
        const note = new Group([
          new Rect({ width: 18, height: 18, fill: '#ffeb3b', rx: 4, ry: 4 }),
          new Line([4, 9, 14, 9], { stroke: '#333', strokeWidth: 2 })
        ], { left: x, top: y, hasControls: false, hasBorders: false });
        note.set('noteText', '');
        // Store current selectedSpaceId on the note
        if (selectedSpaceIdRef.current) {
          note.set({ spaceId: selectedSpaceIdRef.current });
        }
        if (selectedModuleIdRef.current) {
          note.set({ moduleId: selectedModuleIdRef.current });
        }
        note.on('mousedblclick', () => {
          const text = window.prompt('Note:', note.get('noteText') || '');
          if (text !== null) {
            note.set('noteText', text);
            saveCanvas();
          }
        });
        canvas.add(note);
        canvas.requestRenderAll();
        saveCanvas();
        return;
      }
      if (temp) {
        // Store current selectedSpaceId on the shape
        if (selectedSpaceIdRef.current) {
          temp.set({ spaceId: selectedSpaceIdRef.current });
        }
        if (selectedModuleIdRef.current) {
          temp.set({ moduleId: selectedModuleIdRef.current });
        }
        ds.isDrawingShape = true;
        ds.startX = x;
        ds.startY = y;
        ds.tempObj = temp;
        canvas.add(temp);
      }
    };

    const handleMouseMove = (opt) => {
      const currentTool = toolRef.current;
      const currentEraserMode = eraserModeRef.current;
      
      // Handle partial erasing
      if (currentTool === 'eraser' && currentEraserMode === 'partial' && isErasingRef.current && eraserPathRef.current) {
        const { x, y } = canvas.getPointer(opt.e);
        const eraserPath = eraserPathRef.current;
        eraserPath.points.push({ x, y });
        
        // Find objects that intersect with the eraser path
        const eraserRadius = strokeWidthRef.current || 10;
        const objects = canvas.getObjects();
        
        objects.forEach(obj => {
          // Skip if not from current space
          const objSpaceId = obj.spaceId || null;
          if (selectedSpaceIdRef.current !== null && objSpaceId !== selectedSpaceIdRef.current) {
            return;
          }
          
          // Skip highlights (they're handled separately)
          const hasHighlightId = obj.highlightId != null;
          const hasNeedsBICFlag = obj.needsBIC === true;
          const isColoredHighlight = obj.type === 'rect' && (
            (obj.fill && typeof obj.fill === 'string' && obj.fill.includes('rgba')) ||
            (obj.fill && typeof obj.fill === 'string' && obj.fill.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/))
          );
          const fillIsTransparent = !obj.fill || obj.fill === 'transparent' || 
            (typeof obj.fill === 'string' && obj.fill === 'transparent');
          const hasStroke = obj.stroke && typeof obj.stroke === 'string' && obj.stroke !== 'transparent';
          const isNeedsBICHighlight = obj.type === 'rect' && fillIsTransparent && hasStroke;
          const isHighlight = hasHighlightId || hasNeedsBICFlag || isColoredHighlight || isNeedsBICHighlight;
          
          if (isHighlight) {
            return; // Highlights are handled separately
          }
          
          // Check if eraser path intersects with object
          // For paths (pen/highlighter strokes), use partial erasing
          if (obj.type === 'path') {
            // Use partial path erasing - only erase the intersected segment
            const wasErased = erasePathSegment(obj, eraserPath, eraserRadius, canvas);
            if (wasErased) {
              canvas.requestRenderAll();
              saveCanvas();
            }
          } else if (obj.type === 'group') {
            // For groups, check if any eraser point is near the object's path
            const objBounds = obj.getBoundingRect();
            const isNear = eraserPath.points.some(point => {
              const distance = Math.sqrt(
                Math.pow(point.x - (objBounds.left + objBounds.width / 2), 2) +
                Math.pow(point.y - (objBounds.top + objBounds.height / 2), 2)
              );
              return distance < eraserRadius + Math.max(objBounds.width, objBounds.height) / 2;
            });
            
            if (isNear) {
              canvas.remove(obj);
              canvas.requestRenderAll();
              saveCanvas();
            }
          } else {
            // For other objects, check if eraser point is within object bounds
            const objBounds = obj.getBoundingRect();
            const isTouching = eraserPath.points.some(point => {
              return point.x >= objBounds.left - eraserRadius &&
                     point.x <= objBounds.left + objBounds.width + eraserRadius &&
                     point.y >= objBounds.top - eraserRadius &&
                     point.y <= objBounds.top + objBounds.height + eraserRadius;
            });
            
            if (isTouching) {
              canvas.remove(obj);
              canvas.requestRenderAll();
              saveCanvas();
            }
          }
        });
        
        return;
      }
      
      // Handle shape drawing
      const ds = drawingStateRef.current;
      if (!ds.isDrawingShape || !ds.tempObj) return;
      const { x, y } = canvas.getPointer(opt.e);
      const sx = ds.startX;
      const sy = ds.startY;
      if (ds.tempObj.type === 'rect') {
        ds.tempObj.set({ left: Math.min(sx, x), top: Math.min(sy, y), width: Math.abs(x - sx), height: Math.abs(y - sy) });
      } else if (ds.tempObj.type === 'circle') {
        ds.tempObj.set({ left: Math.min(sx, x), top: Math.min(sy, y), radius: Math.max(Math.abs(x - sx), Math.abs(y - sy)) / 2 });
      } else if (ds.tempObj.type === 'line') {
        ds.tempObj.set({ x2: x, y2: y });
      } else if (ds.tempObj.type === 'polyline') {
        const points = ds.tempObj.get('points') || [];
        points.push({ x, y });
        ds.tempObj.set({ points });
      }
      canvas.requestRenderAll();
    };

    const handleMouseUp = (opt) => {
      const currentTool = toolRef.current;
      const currentEraserMode = eraserModeRef.current;
      
      // Handle partial erasing end
      if (currentTool === 'eraser' && currentEraserMode === 'partial' && isErasingRef.current) {
        isErasingRef.current = false;
        eraserPathRef.current = null;
        canvas.requestRenderAll();
        return;
      }
      
      const currentStrokeColor = strokeColorRef.current;
      const ds = drawingStateRef.current;
      if (!ds.isDrawingShape || !ds.tempObj) return;
      
      // Handle highlight tool: create rectangle and call callback
      if (currentTool === 'highlight' && ds.tempObj.type === 'rect') {
        const rect = ds.tempObj;
        const rectLeft = rect.left;
        const rectTop = rect.top;
        const rectWidth = rect.width;
        const rectHeight = rect.height;
        const currentZoom = canvas.getZoom ? canvas.getZoom() : scale;
        console.log('[Survey Debug] Highlight drag capture', {
          pageNumber,
          rectLeft,
          rectTop,
          rectWidth,
          rectHeight,
          scale,
          canvasZoom: currentZoom,
          viewportTransform: canvas.viewportTransform,
          selectedModuleId: selectedModuleIdRef.current,
          selectedSpaceId: selectedSpaceIdRef.current
        });
        
        // Remove the temporary selection rectangle from canvas
        canvas.remove(ds.tempObj);
        
        // Only call callback if rectangle has meaningful size (user actually dragged)
        if (rectWidth > 5 && rectHeight > 5 && onHighlightCreatedRef.current) {
          // Canvas has zoom applied via setZoom(), so coordinates are in canvas space
          // Need to divide by currentZoom to convert to PDF coordinates
          // This matches the rendering logic which multiplies by renderScale (lines 667-670)
          onHighlightCreatedRef.current(pageNumber, {
            x: rectLeft / currentZoom,
            y: rectTop / currentZoom,
            width: rectWidth / currentZoom,
            height: rectHeight / currentZoom
          });
        }
      } else if (currentTool === 'arrow' && ds.tempObj.type === 'line') {
        const { x1, y1, x2, y2 } = ds.tempObj;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = new Triangle({
          left: x2,
          top: y2,
          originX: 'center',
          originY: 'center',
          width: 12,
          height: 12,
          fill: currentStrokeColor,
          angle: (angle * 180) / Math.PI + 90
        });
        const group = new Group([ds.tempObj, head], { selectable: true });
        // Store current selectedSpaceId on the arrow group
        if (selectedSpaceIdRef.current) {
          group.set({ spaceId: selectedSpaceIdRef.current });
        }
        if (selectedModuleIdRef.current) {
          group.set({ moduleId: selectedModuleIdRef.current });
        }
        canvas.add(group);
        canvas.remove(ds.tempObj);
      }
      ds.isDrawingShape = false;
      ds.tempObj = null;
      saveCanvas();
    };

    const handleDblClick = (opt) => {
      if (toolRef.current !== 'note') return;
      // handled in creation; keep stub for future
    };

    canvas.on('object:modified', handleObjectModified);
    canvas.on('path:created', handlePathCreated);
    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('mouse:dblclick', handleDblClick);

    return () => {
      console.log(`[Page ${pageNumber}] Cleanup`);
      isInitializedRef.current = false;
      if (fabricRef.current) {
        fabricRef.current.off();
        try {
          fabricRef.current.dispose();
        } catch (e) {
          console.error(`[Page ${pageNumber}] Disposal error:`, e);
        }
        fabricRef.current = null;
      }
    };
  }, [pageNumber, width, height]); // Only depend on essential props

  // Handle scale changes with throttling to avoid excessive renders
  const scaleUpdateTimerRef = useRef(null);
  useEffect(() => {
    if (!fabricRef.current || !width || !height) return;
    
    // Clear any pending scale update
    if (scaleUpdateTimerRef.current) {
      clearTimeout(scaleUpdateTimerRef.current);
    }
    
    // Throttle scale updates to avoid excessive renders during zoom
    scaleUpdateTimerRef.current = setTimeout(() => {
      if (fabricRef.current) {
        fabricRef.current.setWidth(width * scale);
        fabricRef.current.setHeight(height * scale);
        fabricRef.current.setZoom(scale);
        fabricRef.current.renderAll();
      }
      scaleUpdateTimerRef.current = null;
    }, 50); // Wait 50ms after last scale change
    
    return () => {
      if (scaleUpdateTimerRef.current) {
        clearTimeout(scaleUpdateTimerRef.current);
      }
    };
  }, [scale, width, height]);

  // Handle drawing mode changes
  useEffect(() => {
    // Update refs with current prop values
    toolRef.current = tool;
    strokeColorRef.current = strokeColor;
    strokeWidthRef.current = strokeWidth;

    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    canvas.isDrawingMode = tool === 'pen' || tool === 'highlighter';
    canvas.selection = tool === 'pan'; // Disable selection for eraser to prevent selection box
    canvas.defaultCursor = (tool === 'eraser' ? 'crosshair' : (tool === 'text' ? 'text' : (tool === 'highlight' ? 'crosshair' : (canvas.isDrawingMode ? 'crosshair' : 'default'))));
    canvas.hoverCursor = canvas.defaultCursor;
    const c = tool === 'highlighter' ? 'rgba(255, 235, 59, 0.35)' : strokeColor;
    const w = tool === 'highlighter' ? Math.max(strokeWidth, 8) : strokeWidth;
    if (canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = c;
      canvas.freeDrawingBrush.width = w;
    }
    canvas.getObjects().forEach(obj => {
      // Respect space/module filtering - only make objects interactive if they're visible
      const objSpaceId = obj.spaceId || null;
      const objModuleId = obj.moduleId || null;
      const matchesSpace = selectedSpaceIdRef.current === null || objSpaceId === selectedSpaceIdRef.current;
      const matchesModule = selectedModuleIdRef.current === null || objModuleId === selectedModuleIdRef.current;
      const isVisible = matchesSpace && matchesModule;
      
      if (isVisible) {
        // Only make visible objects interactive based on tool
        obj.set({ 
          visible: true,
          selectable: tool !== 'pen' && tool !== 'highlighter' && tool !== 'highlight', 
          evented: tool !== 'pen' && tool !== 'highlighter' && tool !== 'highlight' 
        });
      } else {
        // Keep hidden objects non-interactive and invisible
        obj.set({ visible: false, selectable: false, evented: false });
      }
    });
    canvas.renderAll();
  }, [tool, strokeColor, strokeWidth, selectedModuleId, selectedSpaceId]);

  // Track rendered highlight objects by highlightId for updates
  const renderedHighlightsRef = useRef(new Map()); // Map<highlightId, fabric.Rect>

  // Add highlights when newHighlights prop changes
  useEffect(() => {
    if (!fabricRef.current || !newHighlights || newHighlights.length === 0) return;
    
    const canvas = fabricRef.current;
    const currentZoom = canvas.getZoom();
    let addedAny = false;
    
    newHighlights.forEach((highlight, index) => {
      // Create a unique key for this highlight to avoid duplicates
      // Use highlightId if available, otherwise use coordinates
      const highlightKey = highlight.highlightId || `${highlight.x}-${highlight.y}-${highlight.width}-${highlight.height}`;
      console.log('[Survey Debug] Applying highlight to canvas', {
        pageNumber,
        highlightId: highlight.highlightId || null,
        highlightKey,
        bounds: {
          x: highlight.x,
          y: highlight.y,
          width: highlight.width,
          height: highlight.height
        },
        needsBIC: !!highlight.needsBIC,
        color: highlight.color || null,
        canvasSpaceId: selectedSpaceIdRef.current,
        canvasModuleId: highlight.moduleId || selectedModuleIdRef.current || null,
        canvasZoom: currentZoom
      });
      
      // Remove any existing highlights with the same highlightId
      if (highlight.highlightId) {
        const existingRect = renderedHighlightsRef.current.get(highlight.highlightId);
        if (existingRect && canvas.getObjects().includes(existingRect)) {
          canvas.remove(existingRect);
          renderedHighlightsRef.current.delete(highlight.highlightId);
          // Also remove from processedHighlightsRef so it can be re-added
          processedHighlightsRef.current.delete(highlightKey);
        }
      }
      
      // Also remove any existing highlights with matching bounds (regardless of highlightId)
      // This ensures old colors are removed when ball in court changes
      const tolerance = 1.0; // Tolerance for floating point precision and coordinate system differences
      // Convert PDF coordinates to canvas coordinates for comparison
      // Use actual canvas zoom for consistency
      const renderScale = currentZoom || scale;
      const highlightCanvasX = highlight.x * renderScale;
      const highlightCanvasY = highlight.y * renderScale;
      const highlightCanvasWidth = highlight.width * renderScale;
      const highlightCanvasHeight = highlight.height * renderScale;
      const matchingRects = canvas.getObjects('rect').filter(obj => {
        // Check if this is a highlight rectangle (has fill with rgba or transparent with stroke)
        const isHighlight = (obj.fill && typeof obj.fill === 'string' && 
          (obj.fill.includes('rgba') || obj.fill.includes('transparent'))) ||
          (obj.stroke && typeof obj.stroke === 'string' && obj.stroke !== 'transparent');
        
        if (!isHighlight) return false;
        
        // Match by bounds with tolerance
        // Compare canvas coordinates (obj is in canvas coords, highlight converted to canvas coords)
        const boundsMatch = 
          Math.abs(obj.left - highlightCanvasX) < tolerance &&
          Math.abs(obj.top - highlightCanvasY) < tolerance &&
          Math.abs(obj.width - highlightCanvasWidth) < tolerance &&
          Math.abs(obj.height - highlightCanvasHeight) < tolerance;
        
        return boundsMatch;
      });
      
      // Remove matching highlights
      matchingRects.forEach(rect => {
        // Don't remove if it's the same one we already removed by highlightId
        if (highlight.highlightId && rect.highlightId === highlight.highlightId) {
          return; // Already handled above
        }
        
        // Remove the old highlight
        canvas.remove(rect);
        // Clean up refs if it had a highlightId
        if (rect.highlightId) {
          renderedHighlightsRef.current.delete(rect.highlightId);
        }
        // Remove from processedHighlightsRef using the old key
        const oldKey = rect.highlightId || `${rect.left}-${rect.top}-${rect.width}-${rect.height}`;
        processedHighlightsRef.current.delete(oldKey);
      });
      
      // Check if we've already processed this highlight (by coordinates if no ID)
      if (!processedHighlightsRef.current.has(highlightKey)) {
        // Check if this highlight needs BIC assignment (transparent with dashed outline)
        if (highlight.needsBIC) {
          // Render as transparent with dashed outline (indicating it needs BIC)
          // Convert PDF coordinates to canvas coordinates (multiply by actual zoom)
          const renderScale = currentZoom || scale;
          const rect = new Rect({
            left: highlight.x * renderScale,
            top: highlight.y * renderScale,
            width: highlight.width * renderScale,
            height: highlight.height * renderScale,
            fill: 'transparent',
            stroke: '#4A90E2',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            selectable: toolRef.current !== 'pen' && toolRef.current !== 'highlighter' && toolRef.current !== 'highlight',
            evented: toolRef.current !== 'pen' && toolRef.current !== 'highlighter' && toolRef.current !== 'highlight',
            excludeFromExport: false,
            strokeUniform: true
          });
          // Store the highlightId and needsBIC flag on the object for later reference
          rect.set({ highlightId: highlight.highlightId, needsBIC: true });
          // Store current selectedSpaceId on the highlight
          if (selectedSpaceIdRef.current) {
            rect.set({ spaceId: selectedSpaceIdRef.current });
          }
          if (highlight.moduleId || selectedModuleIdRef.current) {
            rect.set({ moduleId: highlight.moduleId || selectedModuleIdRef.current });
          }
          canvas.add(rect);
          if (highlight.highlightId) {
            renderedHighlightsRef.current.set(highlight.highlightId, rect);
          }
          processedHighlightsRef.current.add(highlightKey);
          addedAny = true;
        } else {
          // Use color from highlight data if provided, otherwise use default
          // Ensure all highlight colors use 100% opacity
          const rawColor = highlight.color || highlightColor;
          const color = ensureRgbaOpacity(rawColor, 1.0);
          // Convert PDF coordinates to canvas coordinates (multiply by actual zoom)
          const renderScale = currentZoom || scale;
          const rect = new Rect({
            left: highlight.x * renderScale,
            top: highlight.y * renderScale,
            width: highlight.width * renderScale,
            height: highlight.height * renderScale,
            fill: color,
            stroke: 'transparent',
            selectable: toolRef.current !== 'pen' && toolRef.current !== 'highlighter' && toolRef.current !== 'highlight',
            evented: toolRef.current !== 'pen' && toolRef.current !== 'highlighter' && toolRef.current !== 'highlight',
            excludeFromExport: false,
            strokeUniform: true
          });
          // Store the highlightId if available
          if (highlight.highlightId) {
            rect.set({ highlightId: highlight.highlightId });
            renderedHighlightsRef.current.set(highlight.highlightId, rect);
          }
          // Store current selectedSpaceId on the highlight
          if (selectedSpaceIdRef.current) {
            rect.set({ spaceId: selectedSpaceIdRef.current });
          }
          if (highlight.moduleId || selectedModuleIdRef.current) {
            rect.set({ moduleId: highlight.moduleId || selectedModuleIdRef.current });
          }
          canvas.add(rect);
          processedHighlightsRef.current.add(highlightKey);
          addedAny = true;
        }
      }
    });
    
    if (addedAny) {
      canvas.renderAll();
      
      // Save annotations
      try {
        const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'highlightId', 'needsBIC']);
        onSaveAnnotations(pageNumber, canvasJSON);
      } catch (e) {
        console.error(`[Page ${pageNumber}] Save error:`, e);
      }
    }
  }, [newHighlights, highlightColor, pageNumber, onSaveAnnotations, scale]);

  // Remove highlights when highlightsToRemove prop changes
  const processedRemovalsRef = useRef(new Set());
  useEffect(() => {
    if (!fabricRef.current || !highlightsToRemove || highlightsToRemove.length === 0) return;

    const canvas = fabricRef.current;
    let removedAny = false;

    highlightsToRemove.forEach((boundsToRemove) => {
      // Create a unique key for this removal to avoid processing twice
      const removalKey = `${boundsToRemove.x}-${boundsToRemove.y}-${boundsToRemove.width}-${boundsToRemove.height}`;

      // Check if we've already processed this removal
      if (processedRemovalsRef.current.has(removalKey)) {
        return;
      }

      // Find and remove all rectangles matching these bounds
      // Convert PDF coordinates to canvas coordinates for comparison
      const boundsCanvasX = boundsToRemove.x * scale;
      const boundsCanvasY = boundsToRemove.y * scale;
      const boundsCanvasWidth = boundsToRemove.width * scale;
      const boundsCanvasHeight = boundsToRemove.height * scale;
      const objectsToRemove = [];
      canvas.getObjects('rect').forEach(obj => {
        // Check if this is a highlight rectangle (has fill with rgba)
        const isHighlight = obj.fill && typeof obj.fill === 'string' &&
          (obj.fill.includes('rgba') || obj.fill.startsWith('#'));

        if (isHighlight) {
          // Match by bounds with tolerance for floating point and scaling
          const tolerance = 1.0; // Increased tolerance for scaled coordinates
          // Compare canvas coordinates (obj is in canvas coords, boundsToRemove converted to canvas coords)
          const boundsMatch =
            Math.abs(obj.left - boundsCanvasX) < tolerance &&
            Math.abs(obj.top - boundsCanvasY) < tolerance &&
            Math.abs(obj.width - boundsCanvasWidth) < tolerance &&
            Math.abs(obj.height - boundsCanvasHeight) < tolerance;

          if (boundsMatch) {
            objectsToRemove.push(obj);
          }
        }
      });

      // Remove the matched objects
      objectsToRemove.forEach(obj => {
        canvas.remove(obj);
        removedAny = true;
      });

      processedRemovalsRef.current.add(removalKey);
    });

    if (removedAny) {
      canvas.requestRenderAll();

      // Save annotations
      try {
        const canvasJSON = canvas.toJSON(['strokeUniform', 'spaceId', 'moduleId']);
        onSaveAnnotations(pageNumber, canvasJSON);
      } catch (e) {
        console.error(`[Page ${pageNumber}] Save error after removal:`, e);
      }
    }
  }, [highlightsToRemove, pageNumber, onSaveAnnotations, scale]);

  // Filter objects by selected space and regions
  useEffect(() => {
    if (!fabricRef.current) return;

    const canvas = fabricRef.current;
    const objects = canvas.getObjects();
    const regions = Array.isArray(activeRegions) && activeRegions.length > 0 ? activeRegions : null;

    let visibleCount = 0;
    let hiddenCount = 0;
    objects.forEach(obj => {
      const objSpaceId = obj.spaceId || null;
      const objModuleId = obj.moduleId || null;
      
      // Check if this is a survey highlight (has moduleId)
      const isSurveyHighlight = objModuleId !== null;
      
      // Filter by space: if selectedSpaceId is set, object must match
      const matchesSpace = selectedSpaceId === null || objSpaceId === selectedSpaceId;
      
      // Filter by module: if selectedModuleId is set, object must match
      const matchesModule = selectedModuleId === null || objModuleId === selectedModuleId;

      // Survey highlights should only be visible when survey mode is active AND a module is selected
      const surveyHighlightVisible = !isSurveyHighlight || (showSurveyPanel && selectedModuleId !== null);

      let withinRegions = true;
      if (regions) {
        const bounds = obj.getBoundingRect(true, true);
        const centerX = bounds.left + (bounds.width || 0) / 2;
        const centerY = bounds.top + (bounds.height || 0) / 2;
        withinRegions = regions.some(region => regionContainsPoint(centerX, centerY, region, scale));
      }

      // Object is visible only if it matches BOTH space and module filters (and regions if applicable)
      // AND survey highlights are only visible when survey mode is active with a module selected
      const isVisible = matchesSpace && matchesModule && withinRegions && surveyHighlightVisible;
      const isInteractive = isVisible && (selectedSpaceId === null || objSpaceId === selectedSpaceId) && (selectedModuleId === null || objModuleId === selectedModuleId);

      obj.set({
        visible: isVisible,
        selectable: isInteractive,
        evented: isInteractive
      });
      if (isVisible) {
        visibleCount += 1;
      } else {
        hiddenCount += 1;
      }
    });

    console.log('[Survey Debug] Canvas visibility update', {
      pageNumber,
      selectedSpaceId,
      selectedModuleId,
      showSurveyPanel,
      regionCount: regions ? regions.length : 0,
      totalObjects: objects.length,
      visibleObjects: visibleCount,
      hiddenObjects: hiddenCount,
      objectBreakdown: objects.map(obj => ({
        type: obj.type,
        spaceId: obj.spaceId || null,
        moduleId: obj.moduleId || null,
        visible: obj.visible
      }))
    });

    canvas.renderAll();
  }, [selectedSpaceId, selectedModuleId, showSurveyPanel, activeRegions, scale]);

  return (
    <div 
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: (tool === 'pen' || tool === 'highlighter' || tool === 'eraser' || tool === 'text' || tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' || tool === 'underline' || tool === 'strikeout' || tool === 'squiggly' || tool === 'note' || tool === 'highlight') ? 'auto' : 'none',
        zIndex: 10,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          cursor: (tool === 'pen' || tool === 'highlighter' || tool === 'highlight') ? 'crosshair' : 'default'
        }}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  // Only re-render if actually relevant props changed
  return (
    prevProps.pageNumber === nextProps.pageNumber &&
    prevProps.width === nextProps.width &&
    prevProps.height === nextProps.height &&
    Math.abs(prevProps.scale - nextProps.scale) < 0.01 && // Only re-render on significant scale change
    prevProps.tool === nextProps.tool &&
    prevProps.strokeColor === nextProps.strokeColor &&
    prevProps.strokeWidth === nextProps.strokeWidth &&
    prevProps.annotations === nextProps.annotations &&
    prevProps.newHighlights === nextProps.newHighlights &&
    prevProps.highlightsToRemove === nextProps.highlightsToRemove &&
    prevProps.onHighlightCreated === nextProps.onHighlightCreated &&
    prevProps.selectedSpaceId === nextProps.selectedSpaceId &&
    prevProps.activeRegions === nextProps.activeRegions
  );
});

PageAnnotationLayer.displayName = 'PageAnnotationLayer';

export default PageAnnotationLayer;

