import React, { useEffect, useRef, memo } from 'react';
import { Canvas, Rect, Circle, Line, Triangle, Textbox, PencilBrush, Polyline, Group, util, Path } from 'fabric';
import * as fabric from 'fabric';
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

const DEFAULT_SURVEY_HIGHLIGHT_OPACITY = 0.4;

const normalizeHighlightColor = (color, fallbackOpacity = DEFAULT_SURVEY_HIGHLIGHT_OPACITY) => {
  if (!color || typeof color !== 'string') {
    return null;
  }

  const trimmed = color.trim();
  const rgbaMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);

  if (rgbaMatch) {
    const [, r, g, b, opacityStr] = rgbaMatch;
    if (opacityStr !== undefined) {
      const parsedOpacity = parseFloat(opacityStr);
      const clampedOpacity = Number.isFinite(parsedOpacity)
        ? Math.min(1, Math.max(0, parsedOpacity))
        : fallbackOpacity;
      return `rgba(${r}, ${g}, ${b}, ${clampedOpacity})`;
    }
    return `rgba(${r}, ${g}, ${b}, ${fallbackOpacity})`;
  }

  if (trimmed.startsWith('#')) {
    return ensureRgbaOpacity(trimmed, fallbackOpacity);
  }

  return trimmed;
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
  onSaveAnnotations = () => { },
  highlightColor = 'rgba(255, 193, 7, 0.3)',
  newHighlights = null, // Array of {x, y, width, height} to add
  highlightsToRemove = null, // Array of {x, y, width, height} to remove
  onHighlightCreated = null, // Callback for when highlight tool creates a rectangle
  onHighlightDeleted = null, // Callback for when highlight is deleted via eraser
  onHighlightClicked = null, // Callback for when a highlight is clicked (reverse navigation)
  selectedSpaceId = null, // Space ID to filter annotations by
  selectedModuleId = null, // Module ID to filter annotations by
  selectedCategoryId = null, // Category ID to keep highlights visible when panel is hidden
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
  const onHighlightClickedRef = useRef(onHighlightClicked);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const selectedModuleIdRef = useRef(selectedModuleId);
  const showSurveyPanelRef = useRef(showSurveyPanel);
  const eraserModeRef = useRef(eraserMode);
  // Selection rect tracks start position and direction for AutoCAD-style selection
  const selectionRectRef = useRef(null);
  const isErasingRef = useRef(false);
  const eraserPathRef = useRef(null);

  // Keep highlight callback refs in sync
  useEffect(() => {
    onHighlightCreatedRef.current = onHighlightCreated;
  }, [onHighlightCreated]);

  useEffect(() => {
    onHighlightDeletedRef.current = onHighlightDeleted;
  }, [onHighlightDeleted]);

  useEffect(() => {
    onHighlightClickedRef.current = onHighlightClicked;
  }, [onHighlightClicked]);

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

    // console.log(`[Page ${pageNumber}] Initializing canvas`);
    isInitializedRef.current = true;

    const canvas = new Canvas(canvasRef.current, {
      width: width * scale,
      height: height * scale,
      backgroundColor: 'transparent',
      selection: tool === 'pan' || tool === 'eraser' || tool === 'select',
      isDrawingMode: tool === 'pen' || tool === 'highlighter',
      // AutoCAD-style selection: mode determined dynamically by drag direction
      // Default to window selection (L→R) styling - solid blue
      selectionColor: 'rgba(0, 100, 255, 0.15)',
      selectionBorderColor: 'rgba(0, 100, 255, 0.8)',
      selectionLineWidth: 1,
      selectionDashArray: null,
      selectionFullyContained: true, // Will be toggled based on drag direction
    });

    const brush = new PencilBrush(canvas);
    brush.color = strokeColor;
    brush.width = strokeWidth;
    canvas.freeDrawingBrush = brush;

    fabricRef.current = canvas;

    if (annotations && annotations.objects && annotations.objects.length > 0) {
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
            // Enforce multiply blend mode for highlights
            if (obj.highlightId || obj.needsBIC) {
              obj.set({ globalCompositeOperation: 'multiply' });
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
        const canvasJSON = fabricRef.current.toJSON(['strokeUniform', 'spaceId', 'moduleId', 'highlightId', 'needsBIC', 'globalCompositeOperation']);
        onSaveAnnotations(pageNumber, canvasJSON);
      } catch (e) {
        console.error(`[Page ${pageNumber}] Save error:`, e);
      }
    };

    const setBrushForTool = () => {
      canvas.isDrawingMode = tool === 'pen' || tool === 'highlighter';
      canvas.selection = tool === 'pan' || tool === 'select'; // Enable selection for select tool
      canvas.defaultCursor = (tool === 'eraser' ? 'crosshair' : (tool === 'select' ? 'default' : (tool === 'text' ? 'text' : (tool === 'highlight' ? 'crosshair' : (canvas.isDrawingMode ? 'crosshair' : 'default')))));
      canvas.hoverCursor = canvas.defaultCursor;
      const c = tool === 'highlighter' ? highlightColor : strokeColor;
      const w = tool === 'highlighter' ? Math.max(strokeWidth, 8) : strokeWidth;
      canvas.freeDrawingBrush.color = c;
      canvas.freeDrawingBrush.width = w;
    };

    setBrushForTool();

    const handlePathCreated = (e) => {
      if (e.path) {
        e.path.set({
          strokeUniform: true,
          perPixelTargetFind: true, // Enable pixel-perfect hit detection, removes boundary box selection
          targetFindTolerance: 5 // Add small tolerance for easier selection
        });
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

      // Handle highlight clicks for reverse navigation (non-eraser tools)
      if (currentTool !== 'eraser' && currentTool !== 'highlight') {
        const pointer = canvas.getPointer(opt.e);
        const objects = canvas.getObjects();

        for (const obj of objects) {
          // Check if this is a highlight with a highlightId
          const hasHighlightId = obj.highlightId != null;
          const isColoredHighlight = obj.type === 'rect' && (
            (obj.fill && typeof obj.fill === 'string' && obj.fill.includes('rgba')) ||
            (obj.fill && typeof obj.fill === 'string' && obj.fill.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/))
          );

          if ((hasHighlightId || isColoredHighlight) && obj.highlightId) {
            // Check if click is within highlight bounds
            const bounds = obj.getBoundingRect();
            if (pointer.x >= bounds.left && pointer.x <= bounds.left + bounds.width &&
              pointer.y >= bounds.top && pointer.y <= bounds.top + bounds.height) {
              // Call the reverse navigation callback
              if (onHighlightClickedRef.current) {
                onHighlightClickedRef.current(obj.highlightId);
              }
              return; // Don't continue with other click handling
            }
          }
        }
      }

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
        /* console.log('[Survey Debug] Highlight drag capture', {
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
        }); */

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

    // Get actual geometric bounds of an object (not bounding box)
    // This function is kept for potential future use with more precise path geometry
    // Currently we use aCoords in the selection handler for consistent coordinate space
    const getActualObjectBounds = (obj) => {
      // For paths (pen strokes), get the actual path point extremes
      if (obj.type === 'path' && obj.path) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        obj.path.forEach(pathCmd => {
          // Path commands are arrays: ['M', x, y] or ['L', x, y] or ['Q', x1, y1, x2, y2], etc.
          for (let i = 1; i < pathCmd.length; i += 2) {
            const x = pathCmd[i];
            const y = pathCmd[i + 1];
            if (typeof x === 'number' && typeof y === 'number') {
              // Transform each point to canvas coordinates
              const transformed = fabric.util.transformPoint({ x, y }, obj.calcTransformMatrix());
              minX = Math.min(minX, transformed.x);
              maxX = Math.max(maxX, transformed.x);
              minY = Math.min(minY, transformed.y);
              maxY = Math.max(maxY, transformed.y);
            }
          }
        });

        return { left: minX, top: minY, right: maxX, bottom: maxY };
      }

      // For other objects (rectangles, circles, text, etc.), use corner coordinates
      const coords = obj.getCoords();
      const xs = coords.map(c => c.x);
      const ys = coords.map(c => c.y);

      return {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys)
      };
    };

    // Track mouse down for selection rectangle
    // AutoCAD/Bluebeam-style: direction determines selection mode
    const handleMouseDownForSelection = (e) => {
      if (toolRef.current !== 'select') return;

      // Only track if not clicking on an object (i.e., doing a drag selection)
      if (e.target) {
        return;
      }

      // Use ignoreVpt=true to get coordinates in absolute canvas space (ignoring zoom/pan)
      // This matches the coordinate space of object.aCoords
      const pointer = canvas.getPointer(e.e, true);

      // Initialize selection rect with start position
      // isWindowSelection will be determined by drag direction
      selectionRectRef.current = {
        startX: pointer.x,
        startY: pointer.y,
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        isWindowSelection: true // Default to window (L→R), updated during drag
      };

      // Set initial styling for window selection (blue, solid)
      canvas.selectionColor = 'rgba(0, 100, 255, 0.15)';
      canvas.selectionBorderColor = 'rgba(0, 100, 255, 0.8)';
      canvas.selectionDashArray = null;
    };

    // Track mouse move to update selection rectangle and visual style based on direction
    const handleMouseMoveForSelection = (e) => {
      if (!selectionRectRef.current) return;

      // Use ignoreVpt=true to match mouseDown coordinates
      const pointer = canvas.getPointer(e.e, true);
      const startX = selectionRectRef.current.startX;
      const startY = selectionRectRef.current.startY;

      // Determine drag direction: L→R = Window (contain), R→L = Crossing (touch)
      const isWindowSelection = pointer.x >= startX;
      const prevIsWindowSelection = selectionRectRef.current.isWindowSelection;

      // Update selection rect
      selectionRectRef.current = {
        startX: startX,
        startY: startY,
        left: Math.min(startX, pointer.x),
        top: Math.min(startY, pointer.y),
        width: Math.abs(pointer.x - startX),
        height: Math.abs(pointer.y - startY),
        isWindowSelection: isWindowSelection
      };

      // Only update canvas styling if direction changed (for performance)
      if (isWindowSelection !== prevIsWindowSelection) {
        if (isWindowSelection) {
          // Window Selection (L→R): Solid Blue - only fully enclosed objects
          canvas.selectionColor = 'rgba(0, 100, 255, 0.15)';
          canvas.selectionBorderColor = 'rgba(0, 100, 255, 0.8)';
          canvas.selectionDashArray = null;
        } else {
          // Crossing Selection (R→L): Dashed Green - any touching objects
          canvas.selectionColor = 'rgba(0, 200, 100, 0.15)';
          canvas.selectionBorderColor = 'rgba(0, 200, 100, 0.8)';
          canvas.selectionDashArray = [5, 5];
        }
      }
    };

    // Track mouse up to perform AutoCAD-style selection based on drag direction
    const handleMouseUpForSelection = (e) => {
      // Only handle if we're in select mode and have a selection rect
      if (toolRef.current !== 'select' || !selectionRectRef.current) {
        selectionRectRef.current = null;
        return;
      }

      // Get pointer in absolute canvas coordinates (ignoring zoom/pan)
      // This matches the coordinate space we used in mouseDown and the object aCoords
      const pointer = canvas.getPointer(e.e, true);
      const startX = selectionRectRef.current.startX;
      const startY = selectionRectRef.current.startY;

      // Final direction determination (based on screen direction, not scaled)
      const isWindowSelection = pointer.x >= startX;

      // Selection rectangle in canvas coordinates
      const selLeft = Math.min(startX, pointer.x);
      const selTop = Math.min(startY, pointer.y);
      const selWidth = Math.abs(pointer.x - startX);
      const selHeight = Math.abs(pointer.y - startY);

      // Only perform selection if there was meaningful drag (more than 5px in either direction)
      if (selWidth > 5 || selHeight > 5) {
        const selRight = selLeft + selWidth;
        const selBottom = selTop + selHeight;

        // DEBUG: Log all coordinate info
        const zoom = canvas.getZoom();
        const vpt = canvas.viewportTransform;
        console.log('=== SELECTION DEBUG ===');
        console.log('Canvas zoom:', zoom);
        console.log('Viewport transform:', vpt);
        console.log('Selection mode:', isWindowSelection ? 'WINDOW (L→R)' : 'CROSSING (R→L)');
        console.log('Selection rect:', { left: selLeft, top: selTop, right: selRight, bottom: selBottom });

        // Collect objects based on direction-determined selection mode
        const allObjects = canvas.getObjects();
        console.log('Total objects on canvas:', allObjects.length);

        const objectsToSelect = [];
        allObjects.forEach((obj, idx) => {
          console.log(`--- Object ${idx} ---`);
          console.log('Type:', obj.type);
          console.log('Selectable:', obj.selectable);
          console.log('Visible:', obj.visible);

          // Skip non-selectable or non-visible objects
          if (!obj.selectable || !obj.visible) {
            console.log('SKIPPED: not selectable or not visible');
            return;
          }

          // Try multiple ways to get bounds
          console.log('obj.aCoords:', obj.aCoords);
          console.log('obj.oCoords:', obj.oCoords);
          console.log('obj.getCoords():', obj.getCoords ? obj.getCoords() : 'N/A');
          console.log('obj.getBoundingRect():', obj.getBoundingRect ? obj.getBoundingRect() : 'N/A');
          console.log('obj.left/top/width/height:', { left: obj.left, top: obj.top, width: obj.width, height: obj.height });
          console.log('obj.scaleX/scaleY:', { scaleX: obj.scaleX, scaleY: obj.scaleY });

          // Use aCoords which are in absolute canvas space (same as our pointer coords)
          const aCoords = obj.aCoords || obj.getCoords();
          if (!aCoords) {
            console.log('SKIPPED: no aCoords');
            return;
          }

          // Get bounding box from corner coordinates
          const xs = Object.values(aCoords).map(c => c.x);
          const ys = Object.values(aCoords).map(c => c.y);
          const bounds = {
            left: Math.min(...xs),
            top: Math.min(...ys),
            right: Math.max(...xs),
            bottom: Math.max(...ys)
          };
          console.log('Computed bounds from aCoords:', bounds);

          if (isWindowSelection) {
            // Window Selection (L→R): Object must be FULLY inside the selection box
            const checks = {
              leftCheck: `${bounds.left} >= ${selLeft} = ${bounds.left >= selLeft}`,
              topCheck: `${bounds.top} >= ${selTop} = ${bounds.top >= selTop}`,
              rightCheck: `${bounds.right} <= ${selRight} = ${bounds.right <= selRight}`,
              bottomCheck: `${bounds.bottom} <= ${selBottom} = ${bounds.bottom <= selBottom}`
            };
            console.log('Window selection checks:', checks);

            const isFullyContained =
              bounds.left >= selLeft &&
              bounds.top >= selTop &&
              bounds.right <= selRight &&
              bounds.bottom <= selBottom;

            console.log('Fully contained:', isFullyContained);
            if (isFullyContained) {
              objectsToSelect.push(obj);
            }
          } else {
            // Crossing Selection (R→L): Object must INTERSECT with the selection box
            const checks = {
              objRightOfSel: `${bounds.right} < ${selLeft} = ${bounds.right < selLeft}`,
              objLeftOfSel: `${bounds.left} > ${selRight} = ${bounds.left > selRight}`,
              objAboveSel: `${bounds.bottom} < ${selTop} = ${bounds.bottom < selTop}`,
              objBelowSel: `${bounds.top} > ${selBottom} = ${bounds.top > selBottom}`
            };
            console.log('Crossing selection checks (all should be false for intersection):', checks);

            const intersects = !(
              bounds.right < selLeft ||
              bounds.left > selRight ||
              bounds.bottom < selTop ||
              bounds.top > selBottom
            );

            console.log('Intersects:', intersects);
            if (intersects) {
              objectsToSelect.push(obj);
            }
          }
        });

        console.log('Objects to select:', objectsToSelect.length);
        console.log('=== END SELECTION DEBUG ===');

        // Apply our custom selection
        canvas.discardActiveObject();
        if (objectsToSelect.length === 1) {
          canvas.setActiveObject(objectsToSelect[0]);
          console.log('Set single active object');
        } else if (objectsToSelect.length > 1) {
          const activeSelection = new fabric.ActiveSelection(objectsToSelect, { canvas });
          canvas.setActiveObject(activeSelection);
          console.log('Set active selection with', objectsToSelect.length, 'objects');
        } else {
          console.log('No objects selected');
        }
        canvas.requestRenderAll();
      } else {
        console.log('Selection drag too small:', selWidth, 'x', selHeight);
      }

      // Clear selection rect and reset styling
      selectionRectRef.current = null;
      canvas.selectionColor = 'rgba(0, 100, 255, 0.15)';
      canvas.selectionBorderColor = 'rgba(0, 100, 255, 0.8)';
      canvas.selectionDashArray = null;
    };

    // Register selection tracking handlers first (they need to run before main handlers)
    canvas.on('mouse:down', handleMouseDownForSelection);
    canvas.on('mouse:move', handleMouseMoveForSelection);
    canvas.on('mouse:up', handleMouseUpForSelection);

    // Then register main handlers
    canvas.on('object:modified', handleObjectModified);
    canvas.on('path:created', handlePathCreated);
    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('mouse:dblclick', handleDblClick);

    return () => {
      // console.log(`[Page ${pageNumber}] Cleanup`);
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
    canvas.selection = tool === 'pan' || tool === 'select'; // Enable selection for select tool
    canvas.defaultCursor = (tool === 'eraser' ? 'crosshair' : (tool === 'select' ? 'default' : (tool === 'text' ? 'text' : (tool === 'highlight' ? 'crosshair' : (canvas.isDrawingMode ? 'crosshair' : 'default')))));
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
        const isSelectable = tool !== 'pen' && tool !== 'highlighter' && tool !== 'highlight';
        obj.set({
          visible: true,
          selectable: isSelectable,
          evented: isSelectable,
          // Increase hit area for thin/small objects in select mode
          perPixelTargetFind: tool === 'select',
          targetFindTolerance: tool === 'select' ? 5 : 0
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

      // Check if we already have this highlight rendered
      if (highlight.highlightId && renderedHighlightsRef.current.has(highlight.highlightId)) {
        const existingRect = renderedHighlightsRef.current.get(highlight.highlightId);

        // Verify it's still on the canvas
        if (canvas.getObjects().includes(existingRect)) {
          // Check if properties match (color, needsBIC, bounds)
          const rawColor = highlight.color || highlightColor;
          const color = normalizeHighlightColor(rawColor) || highlightColor;
          const renderScale = currentZoom || scale;

          // Check bounds
          const currentLeft = existingRect.left;
          const currentTop = existingRect.top;
          const currentWidth = existingRect.width;
          const currentHeight = existingRect.height;

          const targetLeft = highlight.x * renderScale;
          const targetTop = highlight.y * renderScale;
          const targetWidth = highlight.width * renderScale;
          const targetHeight = highlight.height * renderScale;

          const tolerance = 1.0;
          const boundsMatch =
            Math.abs(currentLeft - targetLeft) < tolerance &&
            Math.abs(currentTop - targetTop) < tolerance &&
            Math.abs(currentWidth - targetWidth) < tolerance &&
            Math.abs(currentHeight - targetHeight) < tolerance;

          // Check visual style
          const needsBIC = !!highlight.needsBIC;
          const existingNeedsBIC = !!existingRect.needsBIC;

          // If everything matches, skip update
          if (boundsMatch && needsBIC === existingNeedsBIC) {
            // For solid highlights, check color
            if (!needsBIC) {
              if (existingRect.fill === color) {
                return; // Skip, already rendered correctly
              }
            } else {
              return; // Skip, already rendered correctly (BIC style is constant)
            }
          }

          // If we get here, something changed. Remove the old one and let it be re-added.
          canvas.remove(existingRect);
          renderedHighlightsRef.current.delete(highlight.highlightId);
          processedHighlightsRef.current.delete(highlightKey);
        } else {
          // Reference exists but object not on canvas (weird), clean up
          renderedHighlightsRef.current.delete(highlight.highlightId);
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
        // Don't match the object we just verified as correct above (if any)
        if (highlight.highlightId && obj.highlightId === highlight.highlightId) return false;

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
            strokeUniform: true,
            globalCompositeOperation: 'multiply'
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
          // Use color from highlight data if provided, otherwise use default, and preserve stored opacity
          const rawColor = highlight.color || highlightColor;
          const color = normalizeHighlightColor(rawColor) || highlightColor;
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
            strokeUniform: true,
            globalCompositeOperation: 'multiply'
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

        // Clean up refs
        if (obj.highlightId) {
          renderedHighlightsRef.current.delete(obj.highlightId);
        }
        // Remove from processedHighlightsRef
        const key = obj.highlightId || `${obj.left}-${obj.top}-${obj.width}-${obj.height}`;
        processedHighlightsRef.current.delete(key);
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
    if (!canvasRef.current || !fabric) return;

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
      // Also keep them visible if a category is selected (even if panel is hidden)
      const surveyHighlightVisible = !isSurveyHighlight || ((showSurveyPanel || selectedCategoryId !== null) && selectedModuleId !== null);

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

    /* console.log('[Survey Debug] Canvas visibility update', {
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
        visible: obj.visible,
        selectable: obj.selectable
      }))
    }); */

    canvas.renderAll();
  }, [selectedSpaceId, selectedModuleId, selectedCategoryId, showSurveyPanel, activeRegions, scale]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: (tool === 'pen' || tool === 'highlighter' || tool === 'eraser' || tool === 'select' || tool === 'text' || tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' || tool === 'underline' || tool === 'strikeout' || tool === 'squiggly' || tool === 'note' || tool === 'highlight') ? 'auto' : 'none',
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

