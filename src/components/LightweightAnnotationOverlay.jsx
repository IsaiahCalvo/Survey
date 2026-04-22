import React, { memo, useEffect, useMemo } from 'react';
import { calculateCalloutConnection } from '../utils/calloutGeometry';

const MAX_PREVIEW_OBJECTS = 420;
const MAX_PREVIEW_CALLOUTS = 140;
const DEFAULT_CALLOUT_COLOR = '#4A90E2';
const DEFAULT_CALLOUT_FILL = 'rgba(255,255,255,0.22)';

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const isTransparentColor = (value) => {
  if (typeof value !== 'string') return true;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'transparent' || normalized === 'none') return true;
  if (normalized === 'rgba(0,0,0,0)' || normalized === 'rgba(0, 0, 0, 0)') return true;
  return false;
};

const normalizeBounds = (object) => {
  const scaleX = Math.abs(toNumber(object?.scaleX, 1));
  const scaleY = Math.abs(toNumber(object?.scaleY, 1));
  const left = toNumber(object?.left, 0);
  const top = toNumber(object?.top, 0);
  const width = Math.max(1, Math.abs(toNumber(object?.width, 0) * (scaleX || 1)));
  const height = Math.max(1, Math.abs(toNumber(object?.height, 0) * (scaleY || 1)));
  return { left, top, width, height };
};

const LightweightAnnotationOverlay = memo(({
  pageNumber,
  width,
  height,
  scale,
  interactionSessionId = null,
  proxyObjects = null,
  proxyCallouts = null,
  annotations,
  callouts = [],
  selectedModuleId = null,
  showSurveyPanel = false,
  annotationRevision = null,
  calloutRevision = null,
  onRenderReady = null
}) => {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const overlayWidth = Math.max(1, toNumber(width, 0) * safeScale);
  const overlayHeight = Math.max(1, toNumber(height, 0) * safeScale);

  const objectPreviewBase = useMemo(() => {
    const useProxyPayload = Array.isArray(proxyObjects);
    const objects = useProxyPayload
      ? proxyObjects
      : (Array.isArray(annotations?.objects) ? annotations.objects : []);
    if (objects.length === 0) return [];

    const previews = [];

    for (let index = 0; index < objects.length; index += 1) {
      const object = objects[index];
      if (!object || object.visible === false) continue;
      if (previews.length >= MAX_PREVIEW_OBJECTS) break;

      if (!useProxyPayload) {
        const isSurveyScoped = object.moduleId !== null && object.moduleId !== undefined;
        if (showSurveyPanel && selectedModuleId && isSurveyScoped && object.moduleId !== selectedModuleId) {
          continue;
        }
        if (showSurveyPanel && selectedModuleId && !isSurveyScoped) {
          continue;
        }
      }

      const objectType = String(object.type || '').toLowerCase();
      const bounds = normalizeBounds(object);
      const stroke = !isTransparentColor(object.stroke)
        ? object.stroke
        : (!isTransparentColor(object.fill) ? object.fill : 'rgba(255, 255, 255, 0.55)');
      const fill = !isTransparentColor(object.fill) ? object.fill : 'transparent';

      // Detect object type for SVG rendering
      const isPath = objectType === 'path' && Array.isArray(object.path) && object.path.length > 0;
      const isLine = objectType === 'line';
      const isGroup = objectType === 'group' && Array.isArray(object.objects) && object.objects.length > 0;
      const lineChild = isGroup ? object.objects.find(o => o && (o.type === 'line' || o.type === 'polyline' || o.type === 'path')) : null;
      const arrowHeadChild = isGroup ? object.objects.find(o => o && (o.name === 'arrowHead' || o.type === 'triangle')) : null;
      const isArrow = isGroup && lineChild;

      // Determine render type
      let renderType = 'shape';
      if (isPath) renderType = 'path';
      else if (isLine) renderType = 'line';
      else if (isArrow) renderType = 'arrow';

      // Build type-specific data
      let pathData = null;
      if (isPath) {
        pathData = object.path.map(seg => seg.join(' ')).join(' ');
      }

      // For path objects, capture object scaleX/scaleY for SVG transform
      const objScaleX = toNumber(object.scaleX, 1);
      const objScaleY = toNumber(object.scaleY, 1);

      previews.push({
        key: object.id || object.highlightId || object.pdfAnnotationId || `obj-${index}`,
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        stroke,
        fill,
        strokeWidth: Math.max(1, toNumber(object.strokeWidth, 1)),
        opacity: Math.max(0.08, Math.min(1, toNumber(object.opacity, 1))),
        borderRadius: objectType === 'circle' || objectType === 'ellipse' ? '999px' : '2px',
        angle: toNumber(object.angle, 0),
        blendMode: object.globalCompositeOperation === 'multiply' ? 'multiply' : 'normal',
        text: objectType === 'textbox' || objectType === 'i-text' || objectType === 'text'
          ? String(object.text || '')
          : '',
        fontSizeBase: Math.max(9, toNumber(object.fontSize, 12)),
        // SVG rendering fields
        renderType,
        pathData,
        objScaleX,
        objScaleY,
        // Line coordinates (for line objects)
        x1: isLine ? toNumber(object.x1, 0) : 0,
        y1: isLine ? toNumber(object.y1, 0) : 0,
        x2: isLine ? toNumber(object.x2, 0) : 0,
        y2: isLine ? toNumber(object.y2, 0) : 0,
        // Arrow coordinates (from group's line child)
        lineX1: isArrow ? toNumber(lineChild.x1, 0) : 0,
        lineY1: isArrow ? toNumber(lineChild.y1, 0) : 0,
        lineX2: isArrow ? toNumber(lineChild.x2, 0) : 0,
        lineY2: isArrow ? toNumber(lineChild.y2, 0) : 0,
        hasArrowHead: isArrow && !!arrowHeadChild
      });
    }

    return previews;
  }, [
    annotationRevision,
    annotations?.objects,
    interactionSessionId,
    pageNumber,
    proxyObjects,
    selectedModuleId,
    showSurveyPanel
  ]);

  const objectPreviews = useMemo(() => objectPreviewBase.map((preview) => {
    const scaled = {
      ...preview,
      left: preview.left * safeScale,
      top: preview.top * safeScale,
      width: preview.width * safeScale,
      height: preview.height * safeScale,
      fontSize: Math.max(9, preview.fontSizeBase * safeScale * 0.92)
    };

    // Scale line coordinates (absolute endpoints)
    if (preview.renderType === 'line') {
      scaled.x1 = (preview.left + preview.x1) * safeScale;
      scaled.y1 = (preview.top + preview.y1) * safeScale;
      scaled.x2 = (preview.left + preview.x2) * safeScale;
      scaled.y2 = (preview.top + preview.y2) * safeScale;
    }

    // Scale arrow line coordinates (group left/top + child coords)
    if (preview.renderType === 'arrow') {
      scaled.lineX1 = (preview.left + preview.lineX1) * safeScale;
      scaled.lineY1 = (preview.top + preview.lineY1) * safeScale;
      scaled.lineX2 = (preview.left + preview.lineX2) * safeScale;
      scaled.lineY2 = (preview.top + preview.lineY2) * safeScale;
    }

    // Path coordinates are NOT scaled here -- SVG transform handles it
    return scaled;
  }), [objectPreviewBase, safeScale]);

  const calloutPreviewBase = useMemo(() => {
    const useProxyPayload = Array.isArray(proxyCallouts);
    const calloutSource = useProxyPayload ? proxyCallouts : callouts;
    if (!Array.isArray(calloutSource) || calloutSource.length === 0) return [];

    const pageCallouts = useProxyPayload
      ? calloutSource.slice(0, MAX_PREVIEW_CALLOUTS)
      : calloutSource
        .filter((callout) => callout?.pageNumber === pageNumber)
        .filter((callout) => {
          if (!(showSurveyPanel && selectedModuleId)) {
            return true;
          }
          return callout.moduleId === selectedModuleId;
        })
        .slice(0, MAX_PREVIEW_CALLOUTS);

    return pageCallouts.map((callout, index) => {
      const style = callout?.style || {};
      return {
        key: callout.id || `callout-${index}`,
        arrowTip: {
          x: toNumber(callout?.arrowTip?.x, 0),
          y: toNumber(callout?.arrowTip?.y, 0)
        },
        knee: {
          x: toNumber(callout?.knee?.x, 0),
          y: toNumber(callout?.knee?.y, 0)
        },
        textBox: {
          x: toNumber(callout?.textBoxPosition?.x ?? callout?.textBox?.x, 0),
          y: toNumber(callout?.textBoxPosition?.y ?? callout?.textBox?.y, 0),
          width: Math.max(0.015, toNumber(callout?.textBoxWidth ?? callout?.textBox?.width, 0)),
          height: Math.max(0.015, toNumber(callout?.textBoxHeight ?? callout?.textBox?.height, 0))
        },
        lineColor: !isTransparentColor(style.borderColor) ? style.borderColor : DEFAULT_CALLOUT_COLOR,
        lineThickness: Math.max(1, toNumber(style.lineThickness, 2)),
        borderOpacity: Math.max(0.2, Math.min(1, toNumber(style.borderOpacity, 1))),
        fillColor: !isTransparentColor(style.fillColor) ? style.fillColor : DEFAULT_CALLOUT_FILL,
        fillOpacity: Math.max(0.08, Math.min(1, toNumber(style.fillOpacity, 0.4)))
      };
    });
  }, [
    calloutRevision,
    callouts,
    interactionSessionId,
    pageNumber,
    proxyCallouts,
    selectedModuleId,
    showSurveyPanel
  ]);

  const calloutPreviews = useMemo(() => calloutPreviewBase.map((callout) => {
    const arrowTip = {
      x: callout.arrowTip.x * overlayWidth,
      y: callout.arrowTip.y * overlayHeight
    };
    const knee = {
      x: callout.knee.x * overlayWidth,
      y: callout.knee.y * overlayHeight
    };
    const textBox = {
      x: callout.textBox.x * overlayWidth,
      y: callout.textBox.y * overlayHeight,
      width: Math.max(18, callout.textBox.width * overlayWidth),
      height: Math.max(18, callout.textBox.height * overlayHeight)
    };

    const connection = calculateCalloutConnection(
      textBox.x,
      textBox.y,
      textBox.width,
      textBox.height,
      knee,
      arrowTip,
      callout.lineThickness
    );

    return {
      ...callout,
      arrowTip,
      knee,
      textBox,
      line1Start: connection.line1Start,
      line2Start: connection.line2Start,
      effectiveKnee: connection.effectiveKnee,
      shouldHideLine1: connection.shouldHideLine1
    };
  }), [calloutPreviewBase, overlayHeight, overlayWidth]);

  const hasRenderablePreview = objectPreviews.length > 0 || calloutPreviews.length > 0;

  useEffect(() => {
    if (!hasRenderablePreview) return;
    if (typeof onRenderReady !== 'function') return;
    onRenderReady(pageNumber, interactionSessionId);
  }, [hasRenderablePreview, interactionSessionId, onRenderReady, pageNumber]);

  if (!hasRenderablePreview) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${overlayWidth}px`,
        height: `${overlayHeight}px`,
        pointerEvents: 'none',
        zIndex: 10,
        overflow: 'hidden',
        contain: 'layout style paint'
      }}
    >
      {objectPreviews.map((preview) => {
        // SVG path rendering for freehand/ink annotations
        if (preview.renderType === 'path' && preview.pathData) {
          return (
            <svg
              key={preview.key}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: overlayWidth,
                height: overlayHeight,
                pointerEvents: 'none',
                overflow: 'visible'
              }}
            >
              <path
                d={preview.pathData}
                stroke={preview.stroke}
                strokeWidth={preview.strokeWidth}
                fill="none"
                opacity={preview.opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
                transform={`translate(${preview.left}, ${preview.top}) scale(${preview.objScaleX * safeScale}, ${preview.objScaleY * safeScale})`}
              />
            </svg>
          );
        }

        // SVG line rendering for line annotations
        if (preview.renderType === 'line') {
          return (
            <svg
              key={preview.key}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: overlayWidth,
                height: overlayHeight,
                pointerEvents: 'none',
                overflow: 'visible'
              }}
            >
              <line
                x1={preview.x1}
                y1={preview.y1}
                x2={preview.x2}
                y2={preview.y2}
                stroke={preview.stroke}
                strokeWidth={preview.strokeWidth}
                opacity={preview.opacity}
                strokeLinecap="round"
              />
            </svg>
          );
        }

        // SVG arrow rendering for arrow (group) annotations
        if (preview.renderType === 'arrow') {
          const dx = preview.lineX2 - preview.lineX1;
          const dy = preview.lineY2 - preview.lineY1;
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          const headSize = Math.max(6, preview.strokeWidth * 3);
          return (
            <svg
              key={preview.key}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: overlayWidth,
                height: overlayHeight,
                pointerEvents: 'none',
                overflow: 'visible'
              }}
            >
              <line
                x1={preview.lineX1}
                y1={preview.lineY1}
                x2={preview.lineX2}
                y2={preview.lineY2}
                stroke={preview.stroke}
                strokeWidth={preview.strokeWidth}
                opacity={preview.opacity}
                strokeLinecap="round"
              />
              {preview.hasArrowHead && (
                <polygon
                  points={`0,${-headSize / 2} ${headSize},0 0,${headSize / 2}`}
                  fill={preview.stroke}
                  opacity={preview.opacity}
                  transform={`translate(${preview.lineX2},${preview.lineY2}) rotate(${angle})`}
                />
              )}
            </svg>
          );
        }

        // Default: div-based rendering for shapes, text, and other types
        return (
          <div
            key={preview.key}
            style={{
              position: 'absolute',
              left: `${preview.left}px`,
              top: `${preview.top}px`,
              width: `${preview.width}px`,
              height: `${preview.height}px`,
              border: `${preview.strokeWidth}px solid ${preview.stroke}`,
              borderRadius: preview.borderRadius,
              background: preview.fill,
              opacity: preview.opacity,
              boxSizing: 'border-box',
              transform: preview.angle ? `rotate(${preview.angle}deg)` : undefined,
              transformOrigin: 'top left',
              mixBlendMode: preview.blendMode
            }}
          >
            {preview.text ? (
              <span
                style={{
                  display: 'inline-block',
                  maxWidth: '100%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontSize: `${preview.fontSize}px`,
                  lineHeight: 1.2,
                  color: preview.stroke,
                  opacity: 0.92
                }}
              >
                {preview.text}
              </span>
            ) : null}
          </div>
        );
      })}

      {calloutPreviews.length > 0 ? (
        <svg
          width={overlayWidth}
          height={overlayHeight}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
            overflow: 'visible'
          }}
        >
          {calloutPreviews.map((callout) => (
            <g key={callout.key} opacity={callout.borderOpacity}>
              {!callout.shouldHideLine1 && (
                <line
                  x1={callout.line1Start.x}
                  y1={callout.line1Start.y}
                  x2={callout.effectiveKnee.x}
                  y2={callout.effectiveKnee.y}
                  stroke={callout.lineColor}
                  strokeWidth={callout.lineThickness}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              <line
                x1={callout.line2Start.x}
                y1={callout.line2Start.y}
                x2={callout.arrowTip.x}
                y2={callout.arrowTip.y}
                stroke={callout.lineColor}
                strokeWidth={callout.lineThickness}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx={callout.arrowTip.x}
                cy={callout.arrowTip.y}
                r={Math.max(2, callout.lineThickness + 0.4)}
                fill={callout.lineColor}
              />
              <rect
                x={callout.textBox.x}
                y={callout.textBox.y}
                width={callout.textBox.width}
                height={callout.textBox.height}
                fill={callout.fillColor}
                fillOpacity={callout.fillOpacity}
                stroke={callout.lineColor}
                strokeWidth={Math.max(1, callout.lineThickness * 0.7)}
                rx={3}
                ry={3}
              />
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  );
});

LightweightAnnotationOverlay.displayName = 'LightweightAnnotationOverlay';

export default LightweightAnnotationOverlay;
