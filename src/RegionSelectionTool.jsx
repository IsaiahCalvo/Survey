import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Icon from './Icons';
import { diff, union, intersection } from 'martinez-polygon-clipping';
import { REGION_OPERATIONS, simplifyPolygon, mergeOverlappingRegions, subtractRegionFromRegion } from './utils/regionMath';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const MIN_REGION_SIZE = 5;

// Region Selection Tool Component
// Provides UI for selecting, transforming, and managing regions on PDF pages
// Users can draw rectangular or freehand regions and switch to move mode to adjust existing selections

const RegionSelectionTool = ({
  active,
  onRegionComplete,
  onCancel,
  currentSpaceId,
  currentPageId,
  scale = 1,
  onSetFullPage,
  canSetFullPage = false,
  initialRegions = []
}) => {
  const [toolType, setToolType] = useState('rectangular'); // 'rectangular' | 'freehand' | 'move'
  const [selectionMode, setSelectionMode] = useState(REGION_OPERATIONS.ADD); // 'add' | 'subtract'
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [currentRect, setCurrentRect] = useState(null);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [regions, setRegions] = useState([]);
  const [selectedRegionIds, setSelectedRegionIds] = useState(new Set());
  const [interactionState, setInteractionState] = useState(null);
  const containerRef = useRef(null);
  const [targetElement, setTargetElement] = useState(null);
  const [isCursorOverCanvas, setIsCursorOverCanvas] = useState(false);
  const [canvasRect, setCanvasRect] = useState(null);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [isOptionAltPressed, setIsOptionAltPressed] = useState(false);
  const [isCmdCtrlPressed, setIsCmdCtrlPressed] = useState(false);
  const [lastDrawingTool, setLastDrawingTool] = useState('rectangular');
  const [isToolDropdownOpen, setIsToolDropdownOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, regionId, type: 'merge' | 'separate' }

  // Calculate effective tool type (override with Cmd/Ctrl for quick select)
  const effectiveToolType = useMemo(() => {
    // If drawing, don't switch modes to avoid interrupting the drag
    if (isDrawing) return toolType;

    if (isCmdCtrlPressed && (toolType === 'rectangular' || toolType === 'freehand')) {
      return 'move';
    }
    return toolType;
  }, [toolType, isCmdCtrlPressed, isDrawing]);

  // Calculate effective selection mode (override with modifier keys)
  const effectiveSelectionMode = useMemo(() => {
    // Shift forces additive mode
    if (isShiftPressed) {
      return REGION_OPERATIONS.ADD;
    }
    // Option/Alt forces subtractive mode
    if (isOptionAltPressed) {
      return REGION_OPERATIONS.SUBTRACT;
    }
    // Otherwise use dropdown selection
    return selectionMode;
  }, [isShiftPressed, isOptionAltPressed, selectionMode]);

  useEffect(() => {
    const target = document.getElementById('region-selection-target');
    setTargetElement(target);
  }, [active]);

  useEffect(() => {
    if (!active || !targetElement) {
      setCanvasRect(null);
      return;
    }

    const updateRect = () => {
      const rect = targetElement.getBoundingClientRect();
      setCanvasRect({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      });
    };

    updateRect();

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(updateRect);
      resizeObserver.observe(targetElement);
    }

    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);

    return () => {
      setCanvasRect(null);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [active, targetElement, scale]);

  useEffect(() => {
    if (active) {
      // Deep clone regions preserving all metadata including sourceRegions and originCenter
      const clonedRegions = (initialRegions || []).map(region => ({
        ...region,
        coordinates: Array.isArray(region.coordinates) ? [...region.coordinates] : [],
        // Preserve sourceRegions for unmerge capability
        sourceRegions: Array.isArray(region.sourceRegions)
          ? region.sourceRegions.map(sourceRegion => ({
              ...sourceRegion,
              coordinates: Array.isArray(sourceRegion.coordinates) ? [...sourceRegion.coordinates] : []
            }))
          : undefined,
        // Preserve originCenter for unmerge offset calculation
        originCenter: region.originCenter ? { ...region.originCenter } : undefined
      }));
      setRegions(clonedRegions);
    } else {
      setRegions([]);
    }
    setSelectedRegionIds(new Set());
    setInteractionState(null);
    setIsDrawing(false);
    setCurrentRect(null);
    setPolygonPoints([]);
    setIsCursorOverCanvas(false);
  }, [active, initialRegions]);

  useEffect(() => {
    setPolygonPoints([]);
    setCurrentRect(null);
    setIsDrawing(false);
    setInteractionState(null);
    setIsCursorOverCanvas(false);
    setIsToolDropdownOpen(false);
    if (toolType !== 'move') {
      setSelectedRegionIds(new Set());
    }
  }, [toolType]);

  useEffect(() => {
    if (regions.length === 0) {
      setSelectedRegionIds(new Set());
      setInteractionState(null);
    }
  }, [regions.length]);

  useEffect(() => {
    if (toolType !== 'move') {
      return;
    }

    // When switching to move mode, select the first region if none selected
    setSelectedRegionIds(prevIds => {
      if (prevIds.size > 0) {
        // Filter out IDs that no longer exist
        const validIds = new Set([...prevIds].filter(id => regions.some(r => r.regionId === id)));
        if (validIds.size > 0) return validIds;
      }

      // If no valid selection, select the first region
      return regions.length > 0 ? new Set([regions[0].regionId]) : new Set();
    });
  }, [toolType, regions]);



  const getRegionBounds = useCallback((region) => {
    if (!region || !Array.isArray(region.coordinates) || region.coordinates.length < 4) {
      return null;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < region.coordinates.length; i += 2) {
      const x = region.coordinates[i];
      const y = region.coordinates[i + 1];
      if (typeof x !== 'number' || typeof y !== 'number') {
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    return { minX, minY, maxX, maxY };
  }, []);

  const ensureBoundsMinSize = useCallback((bounds) => {
    if (!bounds) return null;
    const width = bounds.maxX - bounds.minX;
    if (width < MIN_REGION_SIZE) {
      const midX = (bounds.maxX + bounds.minX) / 2;
      bounds.minX = midX - MIN_REGION_SIZE / 2;
      bounds.maxX = midX + MIN_REGION_SIZE / 2;
    }
    const height = bounds.maxY - bounds.minY;
    if (height < MIN_REGION_SIZE) {
      const midY = (bounds.maxY + bounds.minY) / 2;
      bounds.minY = midY - MIN_REGION_SIZE / 2;
      bounds.maxY = midY + MIN_REGION_SIZE / 2;
    }
    return bounds;
  }, []);

  const resizeHandles = useMemo(() => ([
    { key: 'nw', cursor: 'nwse-resize', offsetX: 0, offsetY: 0 },
    { key: 'n', cursor: 'ns-resize', offsetX: 0.5, offsetY: 0 },
    { key: 'ne', cursor: 'nesw-resize', offsetX: 1, offsetY: 0 },
    { key: 'e', cursor: 'ew-resize', offsetX: 1, offsetY: 0.5 },
    { key: 'se', cursor: 'nwse-resize', offsetX: 1, offsetY: 1 },
    { key: 's', cursor: 'ns-resize', offsetX: 0.5, offsetY: 1 },
    { key: 'sw', cursor: 'nesw-resize', offsetX: 0, offsetY: 1 },
    { key: 'w', cursor: 'ew-resize', offsetX: 0, offsetY: 0.5 }
  ]), []);

  const buildRegionPath = useCallback((region) => {
    if (!region || !Array.isArray(region.coordinates)) {
      return null;
    }

    const points = [];
    for (let i = 0; i < region.coordinates.length; i += 2) {
      const x = region.coordinates[i];
      const y = region.coordinates[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      points.push({
        x: x * scale,
        y: y * scale
      });
    }

    if (points.length < 2) {
      return null;
    }

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i += 1) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }
    if (points.length > 2) {
      path += ' Z';
    }

    return path;
  }, [scale]);

  const polygonPreviewPath = useMemo(() => {
    if (toolType !== 'freehand' || polygonPoints.length < 2) {
      return null;
    }

    const scaledPoints = polygonPoints.map(point => ({
      x: point.x * scale,
      y: point.y * scale
    }));

    let path = `M ${scaledPoints[0].x} ${scaledPoints[0].y}`;
    for (let i = 1; i < scaledPoints.length; i += 1) {
      path += ` L ${scaledPoints[i].x} ${scaledPoints[i].y}`;
    }

    if (scaledPoints.length > 2) {
      path += ' Z';
    }

    return path;
  }, [polygonPoints, toolType, scale]);



  // Convert polygon from martinez format back to region coordinates
  const polygonToRegionCoords = useCallback((polygon) => {
    if (!polygon || !Array.isArray(polygon) || polygon.length === 0) {
      return null;
    }

    const firstRing = polygon[0];
    if (!Array.isArray(firstRing) || firstRing.length < 3) {
      return null;
    }

    const coords = [];
    for (const point of firstRing) {
      if (Array.isArray(point) && point.length >= 2) {
        coords.push(point[0], point[1]);
      }
    }

    // Remove duplicate last point if it's the same as first
    if (coords.length >= 4 &&
      coords[0] === coords[coords.length - 2] &&
      coords[1] === coords[coords.length - 1]) {
      coords.pop();
      coords.pop();
    }

    return coords.length >= 6 ? coords : null;
  }, []);

  // Check if two regions overlap (quick bounding box check)
  // Check if two regions overlap (precise polygon intersection check)
  // Helper to convert region to polygon for martinez (copied from regionMath to ensure availability/consistency)
  const regionToPolygon = useCallback((region) => {
    if (!region || !Array.isArray(region.coordinates)) {
      return null;
    }

    const coords = region.coordinates;
    const polygon = [];

    for (let i = 0; i < coords.length; i += 2) {
      if (i + 1 < coords.length) {
        polygon.push([coords[i], coords[i + 1]]);
      }
    }

    // Close the polygon
    if (polygon.length > 0 &&
      (polygon[0][0] !== polygon[polygon.length - 1][0] ||
        polygon[0][1] !== polygon[polygon.length - 1][1])) {
      polygon.push([polygon[0][0], polygon[0][1]]);
    }

    if (polygon.length < 4) return null;

    // Ensure CCW winding
    let area = 0;
    for (let i = 0; i < polygon.length - 1; i++) {
      area += (polygon[i + 1][0] - polygon[i][0]) * (polygon[i + 1][1] + polygon[i][1]);
    }
    if (area < 0) {
      polygon.reverse();
    }

    return [polygon];
  }, []);

  // Helper to convert polygon back to path string
  const polygonToPath = useCallback((polygon, scale) => {
    if (!polygon || !Array.isArray(polygon) || polygon.length === 0) return '';

    const rings = polygon;
    let path = '';

    rings.forEach(ring => {
      if (!Array.isArray(ring) || ring.length < 2) return;

      path += `M ${ring[0][0] * scale} ${ring[0][1] * scale}`;
      for (let i = 1; i < ring.length; i++) {
        path += ` L ${ring[i][0] * scale} ${ring[i][1] * scale}`;
      }
      path += ' Z ';
    });

    return path;
  }, []);

  const checkRegionsOverlap = useCallback((region1, region2) => {
    if (!region1 || !region2 || !Array.isArray(region1.coordinates) || !Array.isArray(region2.coordinates)) {
      return false;
    }

    const bounds1 = getRegionBounds(region1);
    const bounds2 = getRegionBounds(region2);

    if (!bounds1 || !bounds2) {
      return false;
    }

    // Quick bounding box check first
    const bboxOverlap = !(bounds1.maxX < bounds2.minX || bounds2.maxX < bounds1.minX ||
      bounds1.maxY < bounds2.minY || bounds2.maxY < bounds1.minY);

    if (!bboxOverlap) {
      return false;
    }

    // If bounding boxes overlap, perform precise polygon intersection check
    const poly1 = regionToPolygon(region1);
    const poly2 = regionToPolygon(region2);

    if (!poly1 || !poly2) {
      // Fallback to bbox overlap if polygon conversion fails
      return true;
    }

    try {
      const intersectionResult = intersection(poly1, poly2);
      return intersectionResult && intersectionResult.length > 0;
    } catch (error) {
      console.error('Error checking intersection:', error);
      // Fallback to bbox overlap on error
      return true;
    }
  }, [getRegionBounds, regionToPolygon]);

  // Merge overlapping additive regions with a new region
  const mergeRegionWithOverlapping = useCallback((newRegion, existingRegions) => {
    if (!newRegion || !Array.isArray(existingRegions) || existingRegions.length === 0) {
      return [newRegion];
    }

    const newPoly = regionToPolygon(newRegion);
    if (!newPoly) {
      return [...existingRegions, newRegion];
    }

    // Find all overlapping regions
    const overlappingRegions = [];
    const nonOverlappingRegions = [];

    for (const region of existingRegions) {
      if (checkRegionsOverlap(newRegion, region)) {
        overlappingRegions.push(region);
      } else {
        nonOverlappingRegions.push(region);
      }
    }

    // If no overlaps, just add the new region
    if (overlappingRegions.length === 0) {
      return [...existingRegions, newRegion];
    }

    // Collect all polygons to merge (new region + all overlapping regions)
    const polygonsToMerge = [newPoly];
    for (const region of overlappingRegions) {
      const regionPoly = regionToPolygon(region);
      if (regionPoly) {
        polygonsToMerge.push(regionPoly);
      }
    }

    // Merge all polygons together iteratively
    try {
      let mergedPoly = polygonsToMerge[0];

      for (let i = 1; i < polygonsToMerge.length; i++) {
        const unionResult = union(mergedPoly, polygonsToMerge[i]);

        if (unionResult && unionResult.length > 0) {
          // If the result contains more than one polygon, it means they didn't merge into a single shape
          // (e.g. they are disjoint or just touching at a point/line).
          // In this case, we should NOT merge them.
          if (unionResult.length > 1) {
            // Treat as non-overlapping: keep original regions and add new one separately
            // Since we are iterating, this is tricky. The best approach if ANY merge fails 
            // is to assume the new region is disjoint from the group it was trying to merge with.
            // However, we already identified them as "overlapping" via checkRegionsOverlap.
            // If precise intersection says they overlap, union SHOULD return 1 polygon.
            // If union returns > 1, it implies they might be touching or disjoint in a way that
            // martinez considers separate.

            // For the L-polygon case: if we draw in the notch, checkRegionsOverlap (precise) should return FALSE.
            // So we shouldn't even be here for the notch case!
            // But if we ARE here, and union returns > 1, let's be safe and abort the merge for this specific pair.
            // But wait, we are accumulating `mergedPoly`.

            // If we get here, it means checkRegionsOverlap said YES.
            // If union says > 1, it's an edge case.
            // Let's fallback to "don't merge this specific polygon" or abort the whole merge?
            // Aborting the whole merge is safer to prevent data loss.
            return [...existingRegions, newRegion];
          }

          // Take the first (largest) polygon from the result
          mergedPoly = unionResult[0];
        } else {
          // If union fails, break and use what we have
          break;
        }
      }

      // Convert merged polygon back to region coordinates
      let mergedCoords = polygonToRegionCoords(mergedPoly);

      if (mergedCoords && mergedCoords.length >= 6) {
        // Simplify the polygon to remove redundant vertices (e.g. collinear points from merging rectangles)
        // This ensures simple shapes (like L-polygons) stay under the vertex threshold for handles.
        // Use a small tolerance (1.0) to clean up without distorting.
        mergedCoords = simplifyPolygon(mergedCoords, 1.0);

        const mergedRegion = {
          ...newRegion,
          regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          shapeType: 'polygon', // Union result is typically a polygon
          coordinates: mergedCoords
        };

        // Return merged region plus non-overlapping regions
        return [...nonOverlappingRegions, mergedRegion];
      }
    } catch (error) {
      console.error('Error merging regions:', error);
    }

    // If merge fails, just add the new region (fallback)
    return [...existingRegions, newRegion];
  }, [regionToPolygon, polygonToRegionCoords, checkRegionsOverlap]);

  // Subtract a region from all existing regions
  const subtractRegionFromRegions = useCallback((subtractRegion, existingRegions) => {
    if (!subtractRegion || !Array.isArray(existingRegions) || existingRegions.length === 0) {
      return existingRegions;
    }

    const subtractPoly = regionToPolygon(subtractRegion);
    if (!subtractPoly) {
      return existingRegions;
    }

    const resultRegions = [];

    for (const region of existingRegions) {
      const subjectPoly = regionToPolygon(region);
      if (!subjectPoly) {
        resultRegions.push(region);
        continue;
      }

      try {
        // Perform difference operation (subject - subtract)
        const diffResult = diff(subjectPoly, subtractPoly);

        if (!diffResult || diffResult.length === 0) {
          // Region was completely subtracted, skip it
          continue;
        }

        // Convert each resulting polygon back to a region
        for (const polygon of diffResult) {
          const coords = polygonToRegionCoords(polygon);
          if (coords && coords.length >= 6) {
            const isRectangular = region.shapeType === 'rectangular' && polygon.length === 5;
            resultRegions.push({
              ...region,
              regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              shapeType: isRectangular ? 'rectangular' : 'polygon',
              coordinates: simplifyPolygon(coords, 1.0)
            });
          }
        }
      } catch (error) {
        console.error('Error subtracting region:', error);
        // If subtraction fails, keep the original region
        resultRegions.push(region);
      }
    }

    return resultRegions;
  }, [regionToPolygon, polygonToRegionCoords]);

  const handleMouseDown = useCallback((event) => {
    if (!active || !targetElement) return;

    const rect = targetElement.getBoundingClientRect();
    const isWithinCanvas =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!isWithinCanvas) {
      return;
    }

    setIsCursorOverCanvas(true);

    if (effectiveToolType === 'move') {
      return;
    }

    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;

    if (effectiveToolType === 'rectangular') {
      setIsDrawing(true);
      setStartPoint({ x, y });
      setCurrentRect({ x, y, width: 0, height: 0 });
    } else if (effectiveToolType === 'freehand') {
      setIsDrawing(true);
      setPolygonPoints([{ x, y }]);
    }
  }, [active, targetElement, effectiveToolType, scale]);

  const handleMouseMove = useCallback((event) => {
    if (!active || !targetElement) return;

    const rect = targetElement.getBoundingClientRect();
    const isWithinCanvas =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    setIsCursorOverCanvas(isWithinCanvas);

    // Update cursor position for subtractive mode indicator
    if (isWithinCanvas && (effectiveToolType === 'rectangular' || effectiveToolType === 'freehand')) {
      setCursorPosition({
        x: event.clientX,
        y: event.clientY
      });
    }

    if (!isWithinCanvas && !isDrawing && !interactionState) {
      return;
    }

    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;

    if (interactionState) {
      if (interactionState.type === 'move') {
        // Use raw client coordinates for delta to avoid scale/offset mismatch issues
        // interactionState.startPoint is in client coordinates (from handleRegionPointerDown)
        const dx = (event.clientX - interactionState.startPoint.x) / scale;
        const dy = (event.clientY - interactionState.startPoint.y) / scale;

        // Move all selected regions
        const updatedRegions = regions.map(r => {
          // Check if this region is being moved (is in the initial set of moved regions)
          const initialRegion = interactionState.initialRegions.find(ir => ir.regionId === r.regionId);
          if (initialRegion) {
            return {
              ...r,
              coordinates: initialRegion.coordinates.map((coord, index) => {
                return index % 2 === 0 ? coord + dx : coord + dy;
              })
            };
          }
          return r;
        });

        setRegions(updatedRegions);
      } else if (interactionState.type === 'resize') {
        const { handle, initialBounds, initialCoords, regionId } = interactionState;
        if (!initialBounds) return;

        const bounds = { ...initialBounds };

        switch (handle) {
          case 'nw':
            bounds.minX = Math.min(x, initialBounds.maxX - MIN_REGION_SIZE);
            bounds.minY = Math.min(y, initialBounds.maxY - MIN_REGION_SIZE);
            break;
          case 'n':
            bounds.minY = Math.min(y, initialBounds.maxY - MIN_REGION_SIZE);
            break;
          case 'ne':
            bounds.maxX = Math.max(x, initialBounds.minX + MIN_REGION_SIZE);
            bounds.minY = Math.min(y, initialBounds.maxY - MIN_REGION_SIZE);
            break;
          case 'e':
            bounds.maxX = Math.max(x, initialBounds.minX + MIN_REGION_SIZE);
            break;
          case 'se':
            bounds.maxX = Math.max(x, initialBounds.minX + MIN_REGION_SIZE);
            bounds.maxY = Math.max(y, initialBounds.minY + MIN_REGION_SIZE);
            break;
          case 's':
            bounds.maxY = Math.max(y, initialBounds.minY + MIN_REGION_SIZE);
            break;
          case 'sw':
            bounds.minX = Math.min(x, initialBounds.maxX - MIN_REGION_SIZE);
            bounds.maxY = Math.max(y, initialBounds.minY + MIN_REGION_SIZE);
            break;
          case 'w':
            bounds.minX = Math.min(x, initialBounds.maxX - MIN_REGION_SIZE);
            break;
          default:
            break;
        }

        ensureBoundsMinSize(bounds);

        setRegions(prev => prev.map(region => {
          if (region.regionId !== regionId) {
            return region;
          }

          if (region.shapeType === 'rectangular') {
            return {
              ...region,
              coordinates: [
                bounds.minX,
                bounds.minY,
                bounds.maxX,
                bounds.minY,
                bounds.maxX,
                bounds.maxY,
                bounds.minX,
                bounds.maxY
              ]
            };
          }

          const initialWidth = Math.max(initialBounds.maxX - initialBounds.minX, 1);
          const initialHeight = Math.max(initialBounds.maxY - initialBounds.minY, 1);
          const newWidth = bounds.maxX - bounds.minX;
          const newHeight = bounds.maxY - bounds.minY;
          const scaleXFactor = newWidth / initialWidth;
          const scaleYFactor = newHeight / initialHeight;

          const updatedCoordinates = initialCoords.reduce((acc, value, index) => {
            if (index % 2 === 0) {
              const relativeX = value - initialBounds.minX;
              acc.push(bounds.minX + relativeX * scaleXFactor);
            } else {
              const relativeY = value - initialBounds.minY;
              acc.push(bounds.minY + relativeY * scaleYFactor);
            }
            return acc;
          }, []);

          return {
            ...region,
            coordinates: updatedCoordinates
          };
        }));
      } else if (interactionState.type === 'vertex') {
        const { vertexIndex, regionId } = interactionState;

        setRegions(prev => prev.map(region => {
          if (region.regionId !== regionId) {
            return region;
          }

          const newCoords = [...region.coordinates];
          newCoords[vertexIndex * 2] = x;
          newCoords[vertexIndex * 2 + 1] = y;

          return {
            ...region,
            shapeType: 'polygon',
            coordinates: newCoords
          };
        }));
      }
      return;
    }

    if (!isDrawing) return;

    if (!isDrawing) return;

    if (effectiveToolType === 'rectangular' && startPoint) {
      setCurrentRect({
        x: Math.min(startPoint.x, x),
        y: Math.min(startPoint.y, y),
        width: Math.abs(x - startPoint.x),
        height: Math.abs(y - startPoint.y)
      });
    } else if (effectiveToolType === 'freehand') {
      setPolygonPoints(prev => [...prev, { x, y }]);
    }
  }, [active, targetElement, scale, interactionState, ensureBoundsMinSize, isDrawing, effectiveToolType, startPoint, regions]);

  const handleMouseUp = useCallback(() => {
    if (!active) return;

    setIsCursorOverCanvas(false);

    if (interactionState) {
      setInteractionState(null);
      return;
    }

    if (!isDrawing) return;

    if (effectiveToolType === 'rectangular' && currentRect && currentRect.width > MIN_REGION_SIZE && currentRect.height > MIN_REGION_SIZE) {
      const newRegion = {
        regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        pageId: currentPageId,
        shapeType: 'rectangular',
        operation: effectiveSelectionMode,
        coordinates: [
          currentRect.x,
          currentRect.y,
          currentRect.x + currentRect.width,
          currentRect.y,
          currentRect.x + currentRect.width,
          currentRect.y + currentRect.height,
          currentRect.x,
          currentRect.y + currentRect.height
        ]
      };

      if (effectiveSelectionMode === REGION_OPERATIONS.ADD) {
        // Additive mode: just add to list (merge happens on confirm)
        setRegions(prev => [...prev, newRegion]);
      } else {
        // Subtractive mode: immediately apply subtraction to existing regions
        setRegions(prev => {
          let updatedRegions = [];
          // If there are no existing regions, nothing to subtract from
          if (prev.length === 0) return [];

          for (const existingRegion of prev) {
            // subtractRegionFromRegion returns array of regions (or empty if fully subtracted)
            const result = subtractRegionFromRegion(existingRegion, newRegion);
            if (result && result.length > 0) {
              updatedRegions.push(...result);
            }
          }
          return updatedRegions;
        });
      }
    } else if (effectiveToolType === 'freehand' && polygonPoints.length > 2) {
      const newRegion = {
        regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        pageId: currentPageId,
        shapeType: 'polygon',
        operation: effectiveSelectionMode,
        coordinates: polygonPoints.flatMap(point => [point.x, point.y])
      };

      if (effectiveSelectionMode === REGION_OPERATIONS.ADD) {
        // Additive mode: just add to list (merge happens on confirm)
        setRegions(prev => [...prev, newRegion]);
      } else {
        // Subtractive mode: immediately apply subtraction to existing regions
        setRegions(prev => {
          let updatedRegions = [];
          // If there are no existing regions, nothing to subtract from
          if (prev.length === 0) return [];

          for (const existingRegion of prev) {
            // subtractRegionFromRegion returns array of regions (or empty if fully subtracted)
            const result = subtractRegionFromRegion(existingRegion, newRegion);
            if (result && result.length > 0) {
              updatedRegions.push(...result);
            }
          }
          return updatedRegions;
        });
      }
    }

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentRect(null);
    setPolygonPoints([]);
  }, [active, interactionState, isDrawing, effectiveToolType, currentRect, polygonPoints, currentPageId, effectiveSelectionMode, mergeRegionWithOverlapping, subtractRegionFromRegions]);

  const handleConfirm = useCallback(() => {
    if (!onRegionComplete) return;

    // Consolidate regions before confirming
    // This ensures that any overlapping regions are merged into single polygons
    // and any subtractions are applied permanently.
    const consolidatedRegions = mergeOverlappingRegions(regions);

    // Preserve all metadata including sourceRegions and originCenter for unmerge capability
    const payload = consolidatedRegions.map(region => ({
      ...region,
      coordinates: Array.isArray(region.coordinates) ? [...region.coordinates] : [],
      // Deep copy sourceRegions array to ensure it's preserved
      sourceRegions: Array.isArray(region.sourceRegions) 
        ? region.sourceRegions.map(sourceRegion => ({
            ...sourceRegion,
            coordinates: Array.isArray(sourceRegion.coordinates) ? [...sourceRegion.coordinates] : []
          }))
        : undefined,
      // Preserve originCenter if it exists
      originCenter: region.originCenter ? { ...region.originCenter } : undefined
    }));
    onRegionComplete(payload);
    setRegions([]);
    setCurrentRect(null);
    setPolygonPoints([]);
    setSelectedRegionIds(new Set());
    setInteractionState(null);
  }, [regions, onRegionComplete]);

  const handleCancel = useCallback(() => {
    if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    setRegions([]);
    setCurrentRect(null);
    setPolygonPoints([]);
    setSelectedRegionIds(new Set());
    setInteractionState(null);
    setIsDrawing(false);
    setIsCursorOverCanvas(false);
    if (onCancel) {
      onCancel();
    }
  }, [onCancel]);

  const handleSetFullPage = useCallback(() => {
    if (!onSetFullPage) return;

    // Warn user if they have existing selections that will be cleared
    if (regions.length > 0) {
      if (!window.confirm(`You have ${regions.length} area${regions.length !== 1 ? 's' : ''} defined within this region. Setting the region to Full Page will remove all existing areas. Are you sure you want to continue?`)) {
        return;
      }
    }

    onSetFullPage();
    handleCancel();
  }, [onSetFullPage, handleCancel, regions.length]);

  const handleRegionPointerDown = useCallback((region, event) => {
    if (!active || effectiveToolType !== 'move' || !targetElement) return;
    event.stopPropagation();

    // If not in move mode, ignore
    if (effectiveToolType !== 'move') return;

    // Shift always toggles.
    // Cmd/Ctrl only toggles if we are in the persistent Move tool.
    // If using Quick Select (Cmd/Ctrl in Draw mode), it should NOT toggle (allows dragging).
    const isMultiSelect = event.shiftKey || ((event.metaKey || event.ctrlKey) && toolType === 'move');
    const isSelected = selectedRegionIds.has(region.regionId);

    if (isMultiSelect) {
      // Toggle selection
      const newSelection = new Set(selectedRegionIds);
      if (isSelected) {
        newSelection.delete(region.regionId);
      } else {
        newSelection.add(region.regionId);
      }
      setSelectedRegionIds(newSelection);

      // If we just added it, start moving it (and others)
      if (!isSelected) {
        setInteractionState({
          type: 'move',
          startPoint: { x: event.clientX, y: event.clientY },
          initialRegions: regions.filter(r => newSelection.has(r.regionId))
        });
      }
    } else {
      // Single select behavior
      if (!isSelected) {
        // If clicking a new region, select ONLY it
        setSelectedRegionIds(new Set([region.regionId]));
        setInteractionState({
          type: 'move',
          startPoint: { x: event.clientX, y: event.clientY },
          initialRegions: [region]
        });
      } else {
        // If clicking an already selected region, keep selection (allow bulk move)
        // But if we just click and release without moving, we might want to deselect others?
        // Standard behavior: MouseDown doesn't clear others if clicking selected, 
        // but MouseUp might if no drag occurred. For now, keep simple: don't clear.
        setInteractionState({
          type: 'move',
          startPoint: { x: event.clientX, y: event.clientY },
          initialRegions: regions.filter(r => selectedRegionIds.has(r.regionId))
        });
      }
    }
  }, [active, effectiveToolType, targetElement, scale, regions, selectedRegionIds]);

  const handleVertexPointerDown = useCallback((region, vertexIndex, event) => {
    if (!active || effectiveToolType !== 'move' || !targetElement) return;
    event.stopPropagation();
    event.preventDefault();

    setSelectedRegionIds(new Set([region.regionId])); // Select only this region for vertex editing
    setInteractionState({
      type: 'vertex',
      regionId: region.regionId,
      vertexIndex,
      startPoint: { x: event.clientX, y: event.clientY }
    });
  }, [active, effectiveToolType, targetElement]);

  const handleResizePointerDown = useCallback((region, handle, event) => {
    if (!active || effectiveToolType !== 'move' || !targetElement) return;
    event.stopPropagation();
    event.preventDefault();

    const bounds = getRegionBounds(region);
    if (!bounds) return;

    setSelectedRegionIds(new Set([region.regionId])); // Select only this region for resizing
    setInteractionState({
      type: 'resize',
      regionId: region.regionId,
      handle,
      startPoint: { x: event.clientX, y: event.clientY },
      initialBounds: bounds,
      initialCoords: [...region.coordinates]
    });
  }, [active, effectiveToolType, targetElement, getRegionBounds]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedRegionIds.size === 0) return;
    setRegions(prev => prev.filter(r => !selectedRegionIds.has(r.regionId)));
    setSelectedRegionIds(new Set());
    setInteractionState(null);
  }, [selectedRegionIds]);

  const handleContextMenu = useCallback((event) => {
    event.preventDefault();
    // Allow context menu in all modes (Draw or Move)

    // Check if we clicked on a region
    const rect = targetElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;

    const clickedRegion = regions.find(r => {
      const bounds = getRegionBounds(r);
      return bounds && x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
    });

    if (clickedRegion) {
      // If multiple regions are selected, show "Merge" option
      if (selectedRegionIds.size > 1 && selectedRegionIds.has(clickedRegion.regionId)) {
        // Check if they overlap/are contiguous
        const regionsToMerge = regions.filter(r => selectedRegionIds.has(r.regionId));
        let canMerge = false;

        try {
          if (regionsToMerge.length >= 2) {
            let currentUnion = regionToPolygon(regionsToMerge[0]);
            if (currentUnion) {
              for (let i = 1; i < regionsToMerge.length; i++) {
                const nextPoly = regionToPolygon(regionsToMerge[i]);
                if (nextPoly) {
                  const result = union(currentUnion, nextPoly);
                  if (result && result.length > 0) {
                    currentUnion = result;
                  }
                }
              }
              if (currentUnion.length === 1) {
                canMerge = true;
              }
            }
          }
        } catch (e) {
          console.error('Error checking merge capability', e);
        }

        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          type: 'merge',
          canMerge
        });
      }
      // If single region is selected (or clicked), and it has sourceRegions, show "Separate" option
      else if (clickedRegion.sourceRegions && clickedRegion.sourceRegions.length > 0) {
        setSelectedRegionIds(new Set([clickedRegion.regionId]));
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          type: 'separate',
          regionId: clickedRegion.regionId
        });
      }
    } else {
      // Clicked on background/canvas
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        type: 'canvas'
      });
    }
  }, [active, effectiveToolType, regions, selectedRegionIds, targetElement, scale, getRegionBounds]);

  const handleCopy = useCallback(async () => {
    if (selectedRegionIds.size === 0) return;
    const regionsToCopy = regions.filter(r => selectedRegionIds.has(r.regionId));

    try {
      await navigator.clipboard.writeText(JSON.stringify(regionsToCopy));
      setContextMenu(null);
    } catch (err) {
      console.error('Failed to copy regions:', err);
    }
  }, [selectedRegionIds, regions]);

  const handleCut = useCallback(async () => {
    await handleCopy();
    handleDeleteSelected();
    setContextMenu(null);
  }, [handleCopy, handleDeleteSelected]);

  const handlePaste = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const text = await navigator.clipboard.readText();
      const pastedRegions = JSON.parse(text);

      if (!Array.isArray(pastedRegions) || pastedRegions.length === 0) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      pastedRegions.forEach(r => {
        const bounds = getRegionBounds(r);
        if (bounds) {
          minX = Math.min(minX, bounds.minX);
          minY = Math.min(minY, bounds.minY);
          maxX = Math.max(maxX, bounds.maxX);
          maxY = Math.max(maxY, bounds.maxY);
        }
      });

      if (minX === Infinity) return;

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const rect = targetElement.getBoundingClientRect();
      const targetX = (contextMenu.x - rect.left) / scale;
      const targetY = (contextMenu.y - rect.top) / scale;

      const dx = targetX - centerX;
      const dy = targetY - centerY;

      const newRegions = pastedRegions.map(r => {
        const newCoords = r.coordinates.map((val, idx) => {
          return idx % 2 === 0 ? val + dx : val + dy;
        });

        return {
          ...r,
          regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 5)}`,
          coordinates: newCoords,
          pageId: currentPageId
        };
      });

      setRegions(prev => {
        return [...prev, ...newRegions];
      });

      setSelectedRegionIds(new Set(newRegions.map(r => r.regionId)));
      setContextMenu(null);

    } catch (err) {
      console.error('Failed to paste regions:', err);
    }
  }, [contextMenu, targetElement, scale, currentPageId, getRegionBounds]);

  const handleMergeSelected = useCallback(() => {
    if (selectedRegionIds.size < 2) return;

    const regionsToMerge = regions.filter(r => selectedRegionIds.has(r.regionId));
    if (regionsToMerge.length < 2) return;

    // Calculate geometric union
    let mergedPoly = regionToPolygon(regionsToMerge[0]);
    if (!mergedPoly) return;

    try {
      // Start with the first one
      let currentUnion = mergedPoly;

      for (let i = 1; i < regionsToMerge.length; i++) {
        const nextPoly = regionToPolygon(regionsToMerge[i]);
        if (nextPoly) {
          const result = union(currentUnion, nextPoly);
          if (result && result.length > 0) {
            currentUnion = result;
          }
        }
      }

      // Convert back to coords
      let mergedCoords = polygonToRegionCoords(currentUnion);

      // Let's proceed with what we have.
      if (currentUnion.length > 0) {
        // If disjoint (MultiPolygon), abort merge to prevent data loss
        if (currentUnion.length > 1) {
          console.warn('Cannot merge disjoint regions');
          return;
        }
        // Use the first polygon from the result (usually the merged one)
        mergedCoords = polygonToRegionCoords(currentUnion[0]);
      }

      if (mergedCoords) {
        mergedCoords = simplifyPolygon(mergedCoords, 1.0);

        // Calculate center of the new merged region (for restoration offset)
        const bounds = getRegionBounds({ coordinates: mergedCoords });
        const originCenter = {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2
        };

        const newRegion = {
          regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          pageId: currentPageId,
          shapeType: 'polygon',
          operation: REGION_OPERATIONS.ADD,
          coordinates: mergedCoords,
          sourceRegions: regionsToMerge, // Save history
          originCenter // Save origin center
        };

        // Remove original regions and add new one
        setRegions(prev => {
          const remaining = prev.filter(r => !selectedRegionIds.has(r.regionId));
          return [...remaining, newRegion];
        });

        // Select the new region
        setSelectedRegionIds(new Set([newRegion.regionId]));
        setContextMenu(null);
      }
    } catch (err) {
      console.error('Merge failed', err);
    }
  }, [selectedRegionIds, regions, currentPageId, getRegionBounds]);

  const handleSeparateRegion = useCallback(() => {
    if (selectedRegionIds.size !== 1) return;
    const regionId = Array.from(selectedRegionIds)[0];
    const region = regions.find(r => r.regionId === regionId);

    if (!region || !region.sourceRegions || region.sourceRegions.length === 0) return;

    // Calculate current bounds and center
    const currentBounds = getRegionBounds(region);
    if (!currentBounds) return;
    
    const currentCenter = {
      x: (currentBounds.minX + currentBounds.maxX) / 2,
      y: (currentBounds.minY + currentBounds.maxY) / 2
    };

    // Calculate original bounds from sourceRegions (the bounds they had when merged)
    // We need to find the bounding box of all source regions at merge time
    let originMinX = Infinity, originMinY = Infinity, originMaxX = -Infinity, originMaxY = -Infinity;
    region.sourceRegions.forEach(sourceRegion => {
      const bounds = getRegionBounds(sourceRegion);
      if (bounds) {
        originMinX = Math.min(originMinX, bounds.minX);
        originMinY = Math.min(originMinY, bounds.minY);
        originMaxX = Math.max(originMaxX, bounds.maxX);
        originMaxY = Math.max(originMaxY, bounds.maxY);
      }
    });

    // If we have originCenter, use it to calculate the original center
    // Otherwise, calculate from the source regions' bounds
    const originCenter = region.originCenter || {
      x: (originMinX + originMaxX) / 2,
      y: (originMinY + originMaxY) / 2
    };

    // Calculate original bounds dimensions
    const originWidth = originMaxX - originMinX;
    const originHeight = originMaxY - originMinY;
    
    // Calculate current bounds dimensions
    const currentWidth = currentBounds.maxX - currentBounds.minX;
    const currentHeight = currentBounds.maxY - currentBounds.minY;

    // Calculate scale factors (avoid division by zero)
    const scaleX = originWidth > 0 ? currentWidth / originWidth : 1;
    const scaleY = originHeight > 0 ? currentHeight / originHeight : 1;

    // Calculate translation (center movement)
    const dx = currentCenter.x - originCenter.x;
    const dy = currentCenter.y - originCenter.y;

    // Restore source regions with full transformation (scale + translation)
    const restoredRegions = region.sourceRegions.map(sourceRegion => {
      // Apply transformation: scale around origin center, then translate
      const newCoords = sourceRegion.coordinates.map((val, idx) => {
        if (idx % 2 === 0) {
          // X coordinate
          const relativeX = val - originCenter.x;
          return originCenter.x + relativeX * scaleX + dx;
        } else {
          // Y coordinate
          const relativeY = val - originCenter.y;
          return originCenter.y + relativeY * scaleY + dy;
        }
      });

      return {
        ...sourceRegion,
        coordinates: newCoords,
        regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 5)}`
      };
    });

    setRegions(prev => {
      const remaining = prev.filter(r => r.regionId !== regionId);
      return [...remaining, ...restoredRegions];
    });

    setSelectedRegionIds(new Set(restoredRegions.map(r => r.regionId)));
    setContextMenu(null);
  }, [selectedRegionIds, regions, getRegionBounds]);

  // Close context menu on click elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Track keyboard modifiers (Shift, Option/Alt) for mode override
  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event) => {
      // Shift forces additive mode
      if (event.shiftKey) {
        setIsShiftPressed(true);
      }
      // Option (Mac) or Alt (Windows/Linux) forces subtractive mode
      if (event.altKey) {
        setIsOptionAltPressed(true);
      }
      // Cmd (Mac) or Ctrl (Windows/Linux) for quick select
      if (event.metaKey || event.ctrlKey) {
        setIsCmdCtrlPressed(true);
      }
    };

    const handleKeyUp = (event) => {
      // Release Shift
      if (!event.shiftKey) {
        setIsShiftPressed(false);
      }
      // Release Option/Alt
      if (!event.altKey) {
        setIsOptionAltPressed(false);
      }
      // Release Cmd/Ctrl
      if (!event.metaKey && !event.ctrlKey) {
        setIsCmdCtrlPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      setIsShiftPressed(false);
      setIsOptionAltPressed(false);
    };
  }, [active]);

  useEffect(() => {
    if (!active || !targetElement) return;

    const handleDocumentMouseDown = (event) => {
      if (targetElement.contains(event.target)) {
        return;
      }
      if (containerRef.current && containerRef.current.contains(event.target)) {
        return;
      }
      if (event.target.closest('[data-region-selection-ui="true"]')) {
        return;
      }
      handleCancel();
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
    };
  }, [active, targetElement, handleCancel]);

  if (!active) return null;

  return (
    <>
      {/* Toolbar */}
      <div
        data-region-selection-ui="true"
        style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#2b2b2b',
          border: '1px solid #555',
          borderRadius: '8px',
          padding: '8px',
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
          zIndex: 1001,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          fontFamily: FONT_FAMILY
        }}
      >
        <div style={{ fontSize: '13px', color: '#fff', marginRight: '6px' }}>
          Region Selection
        </div>

        {/* Select Button - Separate button for selecting/transforming regions */}
        <button
          onClick={() => {
            if (toolType === 'move') {
              // If already in move mode, switch to rectangular drawing tool
              setToolType('rectangular');
            } else {
              // Otherwise, switch to move mode
              setToolType('move');
            }
          }}
          className={`btn btn-sm ${toolType === 'move' ? 'btn-active' : 'btn-default'}`}
          style={{
            padding: '4px 8px',
            background: toolType === 'move' ? '#4a90e2' : '#3a3a3a',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: 'pointer',
            fontFamily: FONT_FAMILY,
            marginRight: '6px',
            fontWeight: toolType === 'move' ? '500' : '400'
          }}
        >
          <Icon name="pan" size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          Select
        </button>

        {/* Tool Type Selection - Custom Dropdown */}
        <div
          style={{
            position: 'relative',
            marginRight: '6px'
          }}
        >
          <button
            onClick={(e) => {
              // Check if clicking on the arrow (right side of button)
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const buttonWidth = rect.width;

              // If click is in the right 30px (arrow area), toggle dropdown
              if (clickX > buttonWidth - 30) {
                e.stopPropagation();
                setIsToolDropdownOpen(!isToolDropdownOpen);
              } else {
                // Click on button body - exit selection mode if in move mode
                if (toolType === 'move') {
                  setToolType('rectangular');
                }
                setIsToolDropdownOpen(false);
              }
            }}
            style={{
              padding: '4px 8px',
              paddingRight: '28px',
              background: (toolType === 'rectangular' || toolType === 'freehand') ? '#4a90e2' : '#555',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer',
              fontFamily: FONT_FAMILY,
              minWidth: '110px',
              fontWeight: '500',
              textAlign: 'center',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {toolType === 'move' ? 'Rectangular' : (toolType === 'rectangular' ? 'Rectangular' : 'Freehand')}
            <span
              style={{
                position: 'absolute',
                right: '6px',
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '14px',
                height: '14px'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '14px', height: '14px' }}>
                <path d="M6 9L12 15L18 9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>

          {/* Dropdown Menu */}
          {isToolDropdownOpen && (
            <>
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 1000
                }}
                onClick={() => setIsToolDropdownOpen(false)}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: '4px',
                  background: '#3a3a3a',
                  border: '1px solid #555',
                  borderRadius: '4px',
                  minWidth: '110px',
                  zIndex: 1001,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  overflow: 'hidden'
                }}
              >
                <button
                  onClick={() => {
                    setToolType('rectangular');
                    setIsToolDropdownOpen(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 12px',
                    background: toolType === 'rectangular' ? '#4a90e2' : 'transparent',
                    color: '#fff',
                    border: 'none',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontFamily: FONT_FAMILY,
                    textAlign: 'left',
                    fontWeight: toolType === 'rectangular' ? '500' : '400'
                  }}
                  onMouseEnter={(e) => {
                    if (toolType !== 'rectangular') {
                      e.currentTarget.style.background = '#4a4a4a';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (toolType !== 'rectangular') {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  Rectangular
                </button>
                <button
                  onClick={() => {
                    setToolType('freehand');
                    setIsToolDropdownOpen(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 12px',
                    background: toolType === 'freehand' ? '#4a90e2' : 'transparent',
                    color: '#fff',
                    border: 'none',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontFamily: FONT_FAMILY,
                    textAlign: 'left',
                    borderTop: '1px solid #555',
                    fontWeight: toolType === 'freehand' ? '500' : '400'
                  }}
                  onMouseEnter={(e) => {
                    if (toolType !== 'freehand') {
                      e.currentTarget.style.background = '#4a4a4a';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (toolType !== 'freehand') {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  Freehand
                </button>
              </div>
            </>
          )}
        </div>

        {/* Selection Mode Dropdown (always visible, disabled in selection mode) */}
        <select
          value={selectionMode}
          onChange={(e) => setSelectionMode(e.target.value)}
          disabled={toolType === 'move'}
          style={{
            padding: '4px 8px',
            background: toolType === 'move' ? '#2a2a2a' : '#3a3a3a',
            color: toolType === 'move' ? '#666' : '#fff',
            border: '1px solid #555',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: toolType === 'move' ? 'not-allowed' : 'pointer',
            fontFamily: FONT_FAMILY,
            marginRight: '8px',
            minWidth: '110px',
            textAlign: 'center',
            opacity: toolType === 'move' ? 0.5 : 1,
            transition: 'opacity 0.2s ease, background-color 0.2s ease, color 0.2s ease'
          }}
        >
          <option value={REGION_OPERATIONS.ADD}>Additive</option>
          <option value={REGION_OPERATIONS.SUBTRACT}>Subtractive</option>
        </select>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {effectiveToolType === 'move' && selectedRegionIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="btn btn-default btn-sm"
              style={{
                padding: '6px 12px',
                background: '#611',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
                fontFamily: FONT_FAMILY
              }}
            >
              Delete
            </button>
          )}
          {canSetFullPage && (
            <button
              onClick={handleSetFullPage}
              className="btn btn-default btn-sm"
              style={{
                padding: '6px 12px',
                background: '#555',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
                fontFamily: FONT_FAMILY
              }}
            >
              Full Page
            </button>
          )}
          <button
            onClick={handleConfirm}
            className="btn btn-primary btn-sm"
            style={{ padding: '6px 12px' }}
          >
            Confirm
          </button>
          <button
            onClick={handleCancel}
            className="btn btn-default btn-sm"
            style={{ padding: '6px 12px' }}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Canvas Interaction Layer */}
      {canvasRect && (
        <div
          ref={containerRef}
          onContextMenu={handleContextMenu}
          style={{
            position: 'fixed',
            left: `${canvasRect.left}px`,
            top: `${canvasRect.top}px`,
            width: `${canvasRect.width}px`,
            height: `${canvasRect.height}px`,
            zIndex: 1000,
            cursor: effectiveToolType === 'move' ? 'default' : (isCursorOverCanvas ? 'crosshair' : 'default')
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <svg
            width={canvasRect.width}
            height={canvasRect.height}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              pointerEvents: 'none'
            }}
          >
            {toolType === 'rectangular' && currentRect && (
              <rect
                x={currentRect.x * scale}
                y={currentRect.y * scale}
                width={currentRect.width * scale}
                height={currentRect.height * scale}
                fill={effectiveSelectionMode === REGION_OPERATIONS.SUBTRACT ? "rgba(226, 74, 74, 0.12)" : "rgba(74, 144, 226, 0.12)"}
                stroke={effectiveSelectionMode === REGION_OPERATIONS.SUBTRACT ? "#E24A4A" : "#4A90E2"}
                strokeWidth="2"
                strokeDasharray="8 6"
              />
            )}

            {polygonPreviewPath && (
              <path
                d={polygonPreviewPath}
                fill={effectiveSelectionMode === REGION_OPERATIONS.SUBTRACT ? "rgba(226, 74, 74, 0.12)" : "rgba(74, 144, 226, 0.12)"}
                stroke={effectiveSelectionMode === REGION_OPERATIONS.SUBTRACT ? "#E24A4A" : "#4A90E2"}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {/* Render unified path for all regions to show them as merged */}
            {(() => {
              // Calculate union of all regions for visual display
              // This ensures overlapping regions look like a single shape
              try {
                const additiveRegions = regions.filter(r => !r.operation || r.operation === REGION_OPERATIONS.ADD);
                const subtractiveRegions = regions.filter(r => r.operation === REGION_OPERATIONS.SUBTRACT);

                let mergedPolygons = [];

                // Union all additive regions
                for (const region of additiveRegions) {
                  const poly = regionToPolygon(region);
                  if (!poly) continue;

                  if (mergedPolygons.length === 0) {
                    mergedPolygons = [poly];
                  } else {
                    try {
                      // Ensure poly is treated as MultiPolygon (array of polygons)
                      // regionToPolygon returns [Polygon], so it is compatible
                      const result = union(mergedPolygons, poly);
                      if (result && result.length > 0) {
                        mergedPolygons = result;
                      } else {
                        mergedPolygons.push(poly[0]);
                      }
                    } catch (e) {
                      console.error('Error unioning regions for visual:', e);
                      mergedPolygons.push(poly[0]);
                    }
                  }
                }

                // Subtract subtractive regions
                // (Optional: if we want to show holes visually during selection)
                // For now, let's just show additive regions merged.

                // Generate path
                let unifiedPath = '';
                if (mergedPolygons.length > 0) {
                  mergedPolygons.forEach(polygon => {
                    unifiedPath += polygonToPath(polygon, scale);
                  });
                }

                if (unifiedPath) {
                  return (
                    <path
                      d={unifiedPath}
                      fill="rgba(74, 144, 226, 0.22)"
                      stroke="#4A90E2"
                      strokeWidth="2"
                      style={{ pointerEvents: 'none' }} // Visual only
                    />
                  );
                }
              } catch (e) {
                console.error('Error generating unified path:', e);
              }
              return null;
            })()}

            {regions.map(region => {
              const path = buildRegionPath(region);
              if (!path) return null;
              const isSelected = selectedRegionIds.has(region.regionId);

              // If selected, render with distinct style (on top)
              // If not selected, render transparently for hit testing (visual is handled by unified path)

              if (isSelected) {
                return (
                  <path
                    key={region.regionId}
                    d={path}
                    fill="rgba(245, 166, 35, 0.18)"
                    stroke="#F5A623"
                    strokeWidth={2.5}
                    style={{
                      pointerEvents: effectiveToolType === 'move' ? 'visiblePainted' : 'none',
                      cursor: effectiveToolType === 'move' ? 'move' : 'default'
                    }}
                    onMouseDown={effectiveToolType === 'move' ? (event) => handleRegionPointerDown(region, event) : undefined}
                  />
                );
              } else {
                return (
                  <path
                    key={region.regionId}
                    d={path}
                    fill="transparent"
                    stroke="transparent"
                    strokeWidth={10} // Wider stroke for easier selection
                    style={{
                      pointerEvents: effectiveToolType === 'move' ? 'all' : 'none',
                      cursor: effectiveToolType === 'move' ? 'move' : 'default'
                    }}
                    onMouseDown={effectiveToolType === 'move' ? (event) => handleRegionPointerDown(region, event) : undefined}
                  />
                );
              }
            })}
          </svg>

          {/* Context Menu */}
          {contextMenu && (
            <div
              style={{
                position: 'fixed',
                top: contextMenu.y,
                left: contextMenu.x,
                background: 'white',
                border: '1px solid #ccc',
                borderRadius: '4px',
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                zIndex: 1004,
                padding: '4px 0',
                minWidth: '120px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Clipboard Actions */}
              {(contextMenu.type === 'merge' || contextMenu.type === 'separate' || contextMenu.type === 'canvas') && selectedRegionIds.size > 0 && (
                <>
                  <div
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#333', fontFamily: FONT_FAMILY }}
                    onClick={handleCut}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                  >
                    Cut
                  </div>
                  <div
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#333', fontFamily: FONT_FAMILY }}
                    onClick={handleCopy}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                  >
                    Copy
                  </div>
                  <div style={{ height: '1px', background: '#e0e0e0', margin: '4px 0' }} />
                </>
              )}

              {/* Paste Action */}
              <div
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#333', fontFamily: FONT_FAMILY }}
                onClick={handlePaste}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
              >
                Paste
              </div>

              {/* Separator if we have merge/separate options */}
              {(contextMenu.type === 'merge' || contextMenu.type === 'separate') && (
                <div style={{ height: '1px', background: '#e0e0e0', margin: '4px 0' }} />
              )}

              {contextMenu.type === 'merge' && (
                <div
                  style={{
                    padding: '8px 12px',
                    cursor: contextMenu.canMerge ? 'pointer' : 'not-allowed',
                    opacity: contextMenu.canMerge ? 1 : 0.5,
                    color: '#333',
                    fontSize: '13px',
                    fontFamily: FONT_FAMILY,
                    pointerEvents: contextMenu.canMerge ? 'auto' : 'none',
                    background: 'transparent'
                  }}
                  onClick={handleMergeSelected}
                  onMouseEnter={(e) => {
                    if (contextMenu.canMerge) e.currentTarget.style.background = '#f0f0f0';
                  }}
                  onMouseLeave={(e) => {
                    if (contextMenu.canMerge) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  Merge Areas
                </div>
              )}
              {contextMenu.type === 'separate' && (
                <div
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#333', fontFamily: FONT_FAMILY }}
                  onClick={handleSeparateRegion}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                >
                  Separate Areas
                </div>
              )}
            </div>
          )}

          {/* Resize handles for the selected region (ONLY if single selection) */}
          {effectiveToolType === 'move' && selectedRegionIds.size === 1 && (() => {
            const selectedRegion = regions.find(r => r.regionId === Array.from(selectedRegionIds)[0]);
            if (!selectedRegion) return null;

            const vertexCount = selectedRegion.coordinates.length / 2;
            const useVertexHandles = vertexCount <= 32;

            if (useVertexHandles) {
              // Render handles for each vertex
              const handles = [];
              for (let i = 0; i < vertexCount; i++) {
                const x = selectedRegion.coordinates[i * 2] * scale;
                const y = selectedRegion.coordinates[i * 2 + 1] * scale;

                handles.push(
                  <div
                    key={`v-${i}`}
                    onMouseDown={(event) => handleVertexPointerDown(selectedRegion, i, event)}
                    style={{
                      position: 'absolute',
                      left: `${x}px`,
                      top: `${y}px`,
                      transform: 'translate(-50%, -50%)',
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      background: '#F5A623',
                      border: '2px solid #fff',
                      cursor: 'crosshair',
                      pointerEvents: 'auto',
                      zIndex: 1003
                    }}
                  />
                );
              }
              return <>{handles}</>;
            } else {
              // Render bounding box handles for complex shapes
              const bounds = getRegionBounds(selectedRegion);
              if (!bounds) return null;
              const left = bounds.minX * scale;
              const top = bounds.minY * scale;
              const width = (bounds.maxX - bounds.minX) * scale;
              const height = (bounds.maxY - bounds.minY) * scale;

              return (
                <>
                  {resizeHandles.map(handle => (
                    <div
                      key={handle.key}
                      onMouseDown={(event) => handleResizePointerDown(selectedRegion, handle.key, event)}
                      style={{
                        position: 'absolute',
                        left: `${left + (handle.offsetX * width)}px`,
                        top: `${top + (handle.offsetY * height)}px`,
                        transform: 'translate(-50%, -50%)',
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        background: '#F5A623',
                        border: '2px solid #fff',
                        cursor: handle.cursor,
                        pointerEvents: 'auto',
                        zIndex: 1003
                      }}
                    />
                  ))}
                </>
              );
            }
          })()}
        </div>
      )}

      {/* Floating Plus Sign Indicator for Additive Mode */}
      {effectiveSelectionMode === REGION_OPERATIONS.ADD && isCursorOverCanvas && (toolType === 'rectangular' || toolType === 'freehand') && (
        <div
          style={{
            position: 'fixed',
            left: `${cursorPosition.x + 8}px`,
            top: `${cursorPosition.y - 20}px`,
            pointerEvents: 'none',
            zIndex: 1002
          }}
        >
          <span
            style={{
              color: '#000',
              fontSize: '16px',
              fontWeight: 'bold',
              lineHeight: '1',
              fontFamily: FONT_FAMILY,
              textShadow: '0 0 3px rgba(255, 255, 255, 0.8), 0 0 6px rgba(255, 255, 255, 0.6)'
            }}
          >
            +
          </span>
        </div>
      )}

      {/* Floating Minus Sign Indicator for Subtractive Mode */}
      {effectiveSelectionMode === REGION_OPERATIONS.SUBTRACT && isCursorOverCanvas && (toolType === 'rectangular' || toolType === 'freehand') && (
        <div
          style={{
            position: 'fixed',
            left: `${cursorPosition.x + 8}px`,
            top: `${cursorPosition.y - 20}px`,
            pointerEvents: 'none',
            zIndex: 1002
          }}
        >
          <span
            style={{
              color: '#000',
              fontSize: '16px',
              fontWeight: 'bold',
              lineHeight: '1',
              fontFamily: FONT_FAMILY,
              textShadow: '0 0 3px rgba(255, 255, 255, 0.8), 0 0 6px rgba(255, 255, 255, 0.6)'
            }}
          >
            −
          </span>
        </div>
      )}
    </>
  );
};

export default RegionSelectionTool;
