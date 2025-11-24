import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Icon from './Icons';

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
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [currentRect, setCurrentRect] = useState(null);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [regions, setRegions] = useState([]);
  const [selectedRegionId, setSelectedRegionId] = useState(null);
  const [interactionState, setInteractionState] = useState(null);
  const containerRef = useRef(null);
  const [targetElement, setTargetElement] = useState(null);
  const [isCursorOverCanvas, setIsCursorOverCanvas] = useState(false);
  const [canvasRect, setCanvasRect] = useState(null);

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
      const clonedRegions = (initialRegions || []).map(region => ({
        ...region,
        coordinates: Array.isArray(region.coordinates) ? [...region.coordinates] : []
      }));
      setRegions(clonedRegions);
    } else {
      setRegions([]);
    }
    setSelectedRegionId(null);
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
    if (toolType !== 'move') {
      setSelectedRegionId(null);
    }
  }, [toolType]);

  useEffect(() => {
    if (regions.length === 0) {
      setSelectedRegionId(null);
      setInteractionState(null);
    }
  }, [regions.length]);

  useEffect(() => {
    if (toolType !== 'move') {
      return;
    }

    setSelectedRegionId(prevId => {
      if (prevId && regions.some(region => region.regionId === prevId)) {
        return prevId;
      }
      const nextId = regions.length > 0 ? regions[0].regionId : null;
      return nextId;
    });
  }, [toolType, regions]);

  const selectedRegion = useMemo(
    () => regions.find(region => region.regionId === selectedRegionId) || null,
    [regions, selectedRegionId]
  );

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

    if (toolType === 'move') {
      return;
    }

    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;

    if (toolType === 'rectangular') {
      setIsDrawing(true);
      setStartPoint({ x, y });
      setCurrentRect({ x, y, width: 0, height: 0 });
    } else if (toolType === 'freehand') {
      setIsDrawing(true);
      setPolygonPoints([{ x, y }]);
    }
  }, [active, targetElement, toolType, scale]);

  const handleMouseMove = useCallback((event) => {
    if (!active || !targetElement) return;

    const rect = targetElement.getBoundingClientRect();
    const isWithinCanvas =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    setIsCursorOverCanvas(isWithinCanvas);

    if (!isWithinCanvas && !isDrawing && !interactionState) {
      return;
    }

    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;

    if (interactionState) {
      if (interactionState.type === 'move') {
        const deltaX = x - interactionState.startPoint.x;
        const deltaY = y - interactionState.startPoint.y;
        setRegions(prev => prev.map(region => {
          if (region.regionId !== interactionState.regionId) {
            return region;
          }
          const updated = interactionState.initialCoords.map((value, index) => {
            const isX = index % 2 === 0;
            return value + (isX ? deltaX : deltaY);
          });
          return { ...region, coordinates: updated };
        }));
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
      }
      return;
    }

    if (!isDrawing) return;

    if (toolType === 'rectangular' && startPoint) {
      setCurrentRect({
        x: Math.min(startPoint.x, x),
        y: Math.min(startPoint.y, y),
        width: Math.abs(x - startPoint.x),
        height: Math.abs(y - startPoint.y)
      });
    } else if (toolType === 'freehand') {
      setPolygonPoints(prev => [...prev, { x, y }]);
    }
  }, [active, targetElement, scale, interactionState, ensureBoundsMinSize, isDrawing, toolType, startPoint]);

  const handleMouseUp = useCallback(() => {
    if (!active) return;

    setIsCursorOverCanvas(false);

    if (interactionState) {
      setInteractionState(null);
      return;
    }

    if (!isDrawing) return;

    if (toolType === 'rectangular' && currentRect && currentRect.width > MIN_REGION_SIZE && currentRect.height > MIN_REGION_SIZE) {
      const newRegion = {
        regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        pageId: currentPageId,
        shapeType: 'rectangular',
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
      setRegions(prev => [...prev, newRegion]);
    } else if (toolType === 'freehand' && polygonPoints.length > 2) {
      const newRegion = {
        regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        pageId: currentPageId,
        shapeType: 'polygon',
        coordinates: polygonPoints.flatMap(point => [point.x, point.y])
      };
      setRegions(prev => [...prev, newRegion]);
    }

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentRect(null);
    setPolygonPoints([]);
  }, [active, interactionState, isDrawing, toolType, currentRect, polygonPoints, currentPageId]);

  const handleConfirm = useCallback(() => {
    if (!onRegionComplete) return;
    const payload = regions.map(region => ({
      ...region,
      coordinates: Array.isArray(region.coordinates) ? [...region.coordinates] : []
    }));
    onRegionComplete(payload);
    setRegions([]);
    setCurrentRect(null);
    setPolygonPoints([]);
    setSelectedRegionId(null);
    setInteractionState(null);
  }, [regions, onRegionComplete]);

  const handleCancel = useCallback(() => {
    if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    setRegions([]);
    setCurrentRect(null);
    setPolygonPoints([]);
    setSelectedRegionId(null);
    setInteractionState(null);
    setIsDrawing(false);
    setIsCursorOverCanvas(false);
    if (onCancel) {
      onCancel();
    }
  }, [onCancel]);

  const handleSetFullPage = useCallback(() => {
    if (!onSetFullPage) return;
    onSetFullPage();
    handleCancel();
  }, [onSetFullPage, handleCancel]);

  const handleRegionPointerDown = useCallback((region, event) => {
    if (!active || toolType !== 'move' || !targetElement) return;
    event.stopPropagation();
    event.preventDefault();

    const rect = targetElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;

    setSelectedRegionId(region.regionId);
    setInteractionState({
      type: 'move',
      regionId: region.regionId,
      startPoint: { x, y },
      initialCoords: [...region.coordinates]
    });
  }, [active, toolType, targetElement, scale]);

  const handleHandlePointerDown = useCallback((region, handleKey, event) => {
    if (!active || toolType !== 'move' || !targetElement) return;
    event.stopPropagation();
    event.preventDefault();

    const bounds = getRegionBounds(region);
    if (!bounds) return;

    setSelectedRegionId(region.regionId);
    setInteractionState({
      type: 'resize',
      regionId: region.regionId,
      handle: handleKey,
      initialBounds: { ...bounds },
      initialCoords: [...region.coordinates]
    });
  }, [active, toolType, targetElement, getRegionBounds]);

  const handleDeleteSelected = useCallback(() => {
    const fallbackRegionId = regions.length > 0 ? regions[0].regionId : null;
    const targetRegionId = selectedRegionId || fallbackRegionId;
    console.log('[RegionSelectionTool] delete requested', {
      selectedRegionId,
      fallbackRegionId,
      targetRegionId,
      regionCount: regions.length
    });
    if (!targetRegionId) {
      console.log('[RegionSelectionTool] delete aborted, no target region available');
      return;
    }

    let nextSelectedId = null;
    setRegions(prev => {
      const prevLength = prev.length;
      const nextRegions = prev.filter(region => region.regionId !== targetRegionId);
      nextSelectedId =
        nextRegions.find(region => region.regionId === selectedRegionId)?.regionId ??
        (nextRegions.length > 0 ? nextRegions[0].regionId : null);
      console.log('[RegionSelectionTool] regions updated after deletion', {
        prevLength,
        nextLength: nextRegions.length,
        nextSelectedId
      });
      return nextRegions;
    });
    setSelectedRegionId(nextSelectedId);
    setInteractionState(null);
    console.log('[RegionSelectionTool] delete handler completed', {
      interactionCleared: true,
      nextSelectedId
    });
  }, [selectedRegionId, regions]);

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
          padding: '12px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          zIndex: 1001,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          fontFamily: FONT_FAMILY
        }}
      >
        <div style={{ fontSize: '13px', color: '#fff', marginRight: '8px' }}>
          Region Selection
        </div>

        {/* Tool Type Selection */}
        <div style={{ display: 'flex', gap: '4px', marginRight: '8px' }}>
          <button
            onClick={() => setToolType('move')}
            className={`btn btn-sm ${toolType === 'move' ? 'btn-active' : 'btn-default'}`}
            style={{ padding: '6px 12px' }}
          >
            <Icon name="pan" size={14} style={{ marginRight: '4px' }} />
            Select
          </button>
          <button
            onClick={() => setToolType('rectangular')}
            className={`btn btn-sm ${toolType === 'rectangular' ? 'btn-active' : 'btn-default'}`}
            style={{ padding: '6px 12px' }}
          >
            <Icon name="rect" size={14} style={{ marginRight: '4px' }} />
            Rectangle
          </button>
          <button
            onClick={() => setToolType('freehand')}
            className={`btn btn-sm ${toolType === 'freehand' ? 'btn-active' : 'btn-default'}`}
            style={{ padding: '6px 12px' }}
          >
            <Icon name="pen" size={14} style={{ marginRight: '4px' }} />
            Freehand
          </button>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {toolType === 'move' && selectedRegion && (
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
            Confirm ({regions.length})
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
          style={{
            position: 'fixed',
            left: `${canvasRect.left}px`,
            top: `${canvasRect.top}px`,
            width: `${canvasRect.width}px`,
            height: `${canvasRect.height}px`,
            zIndex: 1000,
            cursor: toolType === 'move' ? 'default' : (isCursorOverCanvas ? 'crosshair' : 'default')
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
                fill="rgba(74, 144, 226, 0.12)"
                stroke="#4A90E2"
                strokeWidth="2"
                strokeDasharray="8 6"
              />
            )}

            {polygonPreviewPath && (
              <path
                d={polygonPreviewPath}
                fill="rgba(74, 144, 226, 0.12)"
                stroke="#4A90E2"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {regions.map(region => {
              const path = buildRegionPath(region);
              if (!path) return null;
              const isSelected = region.regionId === selectedRegionId;
              return (
                <path
                  key={region.regionId}
                  d={path}
                  fill={isSelected ? 'rgba(245, 166, 35, 0.18)' : 'rgba(74, 144, 226, 0.22)'}
                  stroke={isSelected ? '#F5A623' : '#4A90E2'}
                  strokeWidth={isSelected ? 2.5 : 2}
                  style={{ pointerEvents: 'none' }}
                />
              );
            })}
          </svg>

          {/* Draw accumulated regions interaction layer */}
          {toolType === 'move' && regions.map(region => {
            const bounds = getRegionBounds(region);
            if (!bounds) return null;
            const left = bounds.minX * scale;
            const top = bounds.minY * scale;
            const width = (bounds.maxX - bounds.minX) * scale;
            const height = (bounds.maxY - bounds.minY) * scale;
            const isSelected = region.regionId === selectedRegionId;

            return (
              <div
                key={region.regionId}
                style={{
                  position: 'absolute',
                  left: `${left}px`,
                  top: `${top}px`,
                  width: `${width}px`,
                  height: `${height}px`,
                  border: `2px ${isSelected ? 'solid' : 'dashed'} ${isSelected ? '#F5A623' : '#4A90E2'}`,
                  background: isSelected ? 'rgba(245, 166, 35, 0.2)' : 'rgba(74, 144, 226, 0.2)',
                  pointerEvents: toolType === 'move' ? 'auto' : 'none',
                  zIndex: isSelected ? 1002 : 998,
                  cursor: toolType === 'move' ? 'move' : 'default'
                }}
                onMouseDown={toolType === 'move' ? (event) => handleRegionPointerDown(region, event) : undefined}
              >
                {toolType === 'move' && isSelected && resizeHandles.map(handle => (
                  <div
                    key={handle.key}
                    onMouseDown={(event) => handleHandlePointerDown(region, handle.key, event)}
                    style={{
                      position: 'absolute',
                      left: `${handle.offsetX * 100}%`,
                      top: `${handle.offsetY * 100}%`,
                      transform: 'translate(-50%, -50%)',
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      background: '#F5A623',
                      border: '2px solid #fff',
                      cursor: handle.cursor
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

export default RegionSelectionTool;
