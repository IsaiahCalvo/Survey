/**
 * SVG Annotation Renderers
 *
 * Pure render functions that convert Fabric.js JSON annotation objects
 * into React SVG elements. Used by SVGAnnotationLayer for display-only
 * rendering with viewBox-based auto-scaling.
 *
 * Each function takes a Fabric.js JSON object and returns a React SVG element.
 */
import React from 'react';
import { measureTextBounds } from './svgBoundingBox';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safe numeric coercion with fallback.
 * @param {*} value - Value to coerce
 * @param {number} fallback - Fallback if not finite
 * @returns {number}
 */
export const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

/**
 * Detect erased outline paths. After boolean eraser subtraction, the path is
 * converted from stroke to fill (strokeWidth: 0, fill: originalColor).
 * @param {object} obj - Fabric.js JSON object
 * @returns {boolean}
 */
export const isErasedOutline = (obj) =>
  obj.strokeWidth === 0 && obj.fill && obj.fill !== 'transparent';

// ---------------------------------------------------------------------------
// Render Functions
// ---------------------------------------------------------------------------

/**
 * Render a Fabric.js path object (pen strokes, highlighter strokes, erased paths)
 * as an SVG <path> element.
 *
 * CRITICAL: Includes pathOffset handling to prevent 50-200px positioning errors.
 * Transform chain: translate(left, top) rotate(angle) scale(scaleX, scaleY) translate(-pathOffset.x, -pathOffset.y)
 *
 * @param {object} obj - Fabric.js path JSON object
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement|null}
 */
export const renderPath = (obj, index) => {
  if (!Array.isArray(obj.path) || obj.path.length === 0) return null;

  const d = obj.path.map((seg) => seg.join(' ')).join(' ');

  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const angle = obj.angle ?? 0;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  const pathOffsetX = obj.pathOffset?.x || 0;
  const pathOffsetY = obj.pathOffset?.y || 0;

  // Build transform: position -> rotate -> scale -> pathOffset
  let transform = `translate(${left}, ${top})`;
  if (angle !== 0) transform += ` rotate(${angle})`;
  if (scaleX !== 1 || scaleY !== 1) transform += ` scale(${scaleX}, ${scaleY})`;
  transform += ` translate(${-pathOffsetX}, ${-pathOffsetY})`;

  const isHighlight = obj.globalCompositeOperation === 'multiply';
  const erased = isErasedOutline(obj);

  const key = `path-${obj.id || obj.highlightId || obj.pdfAnnotationId || index}`;

  return (
    <path
      key={key}
      d={d}
      transform={transform}
      stroke={erased ? 'none' : (obj.stroke || '#000')}
      strokeWidth={erased ? 0 : (obj.strokeWidth || 1)}
      fill={erased ? obj.fill : 'none'}
      fillRule={erased ? 'evenodd' : undefined}
      opacity={obj.opacity ?? 1}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect={obj.strokeUniform ? 'non-scaling-stroke' : undefined}
      style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
    />
  );
};

/**
 * Render a Fabric.js rect object as an SVG <rect> element.
 * Handles highlights (mix-blend-mode: multiply) and shape borders.
 *
 * @param {object} obj - Fabric.js rect JSON object
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement}
 */
export const renderRect = (obj, index) => {
  const effectiveWidth = Math.abs((obj.width || 0) * (obj.scaleX || 1));
  const effectiveHeight = Math.abs((obj.height || 0) * (obj.scaleY || 1));
  const isHighlight = obj.globalCompositeOperation === 'multiply';

  const key = `rect-${obj.id || obj.highlightId || index}`;

  return (
    <rect
      key={key}
      x={obj.left}
      y={obj.top}
      width={effectiveWidth}
      height={effectiveHeight}
      transform={obj.angle ? `rotate(${obj.angle}, ${obj.left + effectiveWidth / 2}, ${obj.top + effectiveHeight / 2})` : undefined}
      fill={obj.fill || 'transparent'}
      stroke={obj.stroke || 'transparent'}
      strokeWidth={obj.strokeWidth || 0}
      opacity={obj.opacity ?? 1}
      vectorEffect={obj.strokeUniform ? 'non-scaling-stroke' : undefined}
      style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
    />
  );
};

/**
 * Render a Fabric.js line object as an SVG <line> element.
 * Uses non-scaling-stroke for constant thickness at all zoom levels.
 *
 * @param {object} obj - Fabric.js line JSON object
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement}
 */
export const renderLine = (obj, index) => {
  // Fabric.js Line toJSON(): left/top = bounding box top-left corner,
  // x1/y1/x2/y2 = offsets from bounding box CENTER.
  // Must compute center first, then add offsets to get absolute coords.
  const centerX = (obj.left || 0) + (obj.width || 0) / 2;
  const centerY = (obj.top || 0) + (obj.height || 0) / 2;
  const x1 = centerX + (obj.x1 || 0);
  const y1 = centerY + (obj.y1 || 0);
  const x2 = centerX + (obj.x2 || 0);
  const y2 = centerY + (obj.y2 || 0);

  const isArrow = obj.tool === 'arrow';
  const key = `${isArrow ? 'arrow' : 'line'}-${obj.id || index}`;
  const strokeColor = obj.stroke || '#000';
  const sw = obj.strokeWidth || 2;

  if (isArrow) {
    // Arrow: line + arrowhead polygon centered on endpoint 2
    const dx = x2 - x1;
    const dy = y2 - y1;
    const angleRad = Math.atan2(dy, dx);
    const angleDeg = angleRad * (180 / Math.PI);
    const headSize = Math.max(8, sw * 3);

    // Shorten line so it ends at the back of the centered arrowhead (doesn't poke through)
    const lineEndX = x2 - (headSize / 3) * Math.cos(angleRad);
    const lineEndY = y2 - (headSize / 3) * Math.sin(angleRad);

    return (
      <g key={key} opacity={obj.opacity ?? 1}>
        <line
          x1={x1} y1={y1} x2={lineEndX} y2={lineEndY}
          stroke={strokeColor}
          strokeWidth={sw}
          strokeLinecap="round"
        />
        <polygon
          points={`${-headSize / 3},${-headSize / 2} ${headSize * 2 / 3},0 ${-headSize / 3},${headSize / 2}`}
          fill={strokeColor}
          transform={`translate(${x2},${y2}) rotate(${angleDeg})`}
        />
      </g>
    );
  }

  return (
    <line
      key={key}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={strokeColor}
      strokeWidth={sw}
      strokeLinecap="round"
      opacity={obj.opacity ?? 1}
    />
  );
};

/**
 * Render a Fabric.js arrow group (line + triangle arrowhead) as SVG elements.
 * The group contains a line child and an optional triangle arrowhead child.
 *
 * @param {object} obj - Fabric.js group JSON object containing line + arrowhead
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement|null}
 */
export const renderArrow = (obj, index) => {
  if (!Array.isArray(obj.objects) || obj.objects.length === 0) return null;

  const lineChild = obj.objects.find(
    (o) => o && (o.type === 'line' || o.type === 'polyline' || o.type === 'path')
  );
  const arrowHead = obj.objects.find(
    (o) => o && (o.name === 'arrowHead' || o.type === 'triangle')
  );

  if (!lineChild) return null;

  const x1 = (obj.left || 0) + (lineChild.x1 || 0);
  const y1 = (obj.top || 0) + (lineChild.y1 || 0);
  const x2 = (obj.left || 0) + (lineChild.x2 || 0);
  const y2 = (obj.top || 0) + (lineChild.y2 || 0);

  const dx = x2 - x1;
  const dy = y2 - y1;
  const angleRad = Math.atan2(dy, dx);
  const angleDeg = angleRad * (180 / Math.PI);
  const headSize = Math.max(6, (obj.strokeWidth || 2) * 3);

  // Shorten line so it ends at the back of the centered arrowhead
  const lineEndX = arrowHead ? x2 - (headSize / 3) * Math.cos(angleRad) : x2;
  const lineEndY = arrowHead ? y2 - (headSize / 3) * Math.sin(angleRad) : y2;

  const key = `arrow-${obj.id || index}`;

  return (
    <g key={key} opacity={obj.opacity ?? 1}>
      <line
        x1={x1}
        y1={y1}
        x2={lineEndX}
        y2={lineEndY}
        stroke={obj.stroke || '#000'}
        strokeWidth={obj.strokeWidth || 2}
        strokeLinecap="round"
      />
      {arrowHead && (
        <polygon
          points={`${-headSize / 3},${-headSize / 2} ${headSize * 2 / 3},0 ${-headSize / 3},${headSize / 2}`}
          fill={obj.stroke || '#000'}
          transform={`translate(${x2},${y2}) rotate(${angleDeg})`}
        />
      )}
    </g>
  );
};

/**
 * Render a Fabric.js circle or ellipse object as an SVG <ellipse> element.
 * Handles both circle (radius) and ellipse (rx/ry) JSON types.
 *
 * @param {object} obj - Fabric.js circle/ellipse JSON object
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement}
 */
export const renderEllipse = (obj, index) => {
  let rx, ry;

  if (obj.type === 'circle' || obj.radius != null) {
    // Circle type: radius with scaleX/scaleY
    rx = (obj.radius || 0) * Math.abs(obj.scaleX || 1);
    ry = (obj.radius || 0) * Math.abs(obj.scaleY || 1);
  } else {
    // Ellipse type: rx/ry with scaleX/scaleY
    rx = (obj.rx || 0) * Math.abs(obj.scaleX || 1);
    ry = (obj.ry || 0) * Math.abs(obj.scaleY || 1);
  }

  const cx = (obj.left || 0) + rx;
  const cy = (obj.top || 0) + ry;

  const key = `ellipse-${obj.id || index}`;
  const isHighlight = obj.globalCompositeOperation === 'multiply';

  return (
    <ellipse
      key={key}
      cx={cx}
      cy={cy}
      rx={rx}
      ry={ry}
      transform={obj.angle ? `rotate(${obj.angle}, ${cx}, ${cy})` : undefined}
      fill={obj.fill || 'transparent'}
      stroke={obj.stroke || 'transparent'}
      strokeWidth={obj.strokeWidth || 0}
      opacity={obj.opacity ?? 1}
      vectorEffect={obj.strokeUniform ? 'non-scaling-stroke' : undefined}
      style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
    />
  );
};

/**
 * Render a Fabric.js text object as an SVG <foreignObject> element.
 * Uses foreignObject with an inner HTML div to support full CSS text layout
 * including word-wrap, font properties, and text alignment.
 *
 * @param {object} obj - Fabric.js textbox/i-text/text JSON object
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement}
 */
export const renderText = (obj, index) => {
  const scaleX = Math.abs(obj.scaleX ?? 1);
  const scaleY = Math.abs(obj.scaleY ?? 1);
  const objType = String(obj.type || '').toLowerCase();

  // Textbox type: use stored width/height from Fabric.js (authoritative after edit commit)
  let effectiveWidth, effectiveHeight;
  if (objType === 'textbox' && obj.width && obj.height) {
    effectiveWidth = obj.width * scaleX;
    effectiveHeight = obj.height * scaleY;
  } else {
    const measured = measureTextBounds(obj);
    effectiveWidth = measured.width;
    effectiveHeight = measured.height;
  }
  const left = obj.left || 0;
  const top = obj.top || 0;
  const angle = obj.angle || 0;

  const key = `text-${obj.id || index}`;
  // Add buffer for descenders (j,p,g,q,y) + bottom breathing room
  const fontSize = obj.fontSize || 16;
  const descenderBuffer = fontSize * 0.35;
  const displayHeight = effectiveHeight + descenderBuffer;
  const rotateTransform = angle !== 0
    ? `rotate(${angle}, ${left + effectiveWidth / 2}, ${top + displayHeight / 2})`
    : undefined;

  return (
    <g key={key} opacity={obj.opacity ?? 1} transform={rotateTransform}>
      <rect
        x={left}
        y={top}
        width={effectiveWidth}
        height={displayHeight}
        fill="none"
        stroke="#000"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <foreignObject
        x={left}
        y={top}
        width={effectiveWidth}
        height={displayHeight}
        overflow="visible"
      >
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: '100%',
            height: '100%',
            fontSize: `${fontSize}px`,
            fontFamily: obj.fontFamily || 'sans-serif',
            fontWeight: obj.fontWeight || 'normal',
            fontStyle: obj.fontStyle || 'normal',
            color: obj.fill || '#000',
            textAlign: obj.textAlign || 'left',
            lineHeight: obj.lineHeight || 1.16,
            overflow: 'visible',
            wordWrap: 'break-word',
            whiteSpace: 'pre-wrap',
            padding: 0,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          }}
        >
          {obj.text || ''}
        </div>
      </foreignObject>
    </g>
  );
};

/**
 * Render a callout annotation as SVG elements (lines + circle + rect + text).
 * Converts normalized (0-1) coordinates to page coordinates, computes connection
 * geometry via calculateCalloutConnection, and renders connection lines, arrowhead
 * circle, text box rect, and optional text via foreignObject.
 *
 * @param {object} callout - Callout data object with normalized coordinates
 * @param {number} index - Array index for key fallback
 * @param {number} pageWidth - Unscaled PDF page width
 * @param {number} pageHeight - Unscaled PDF page height
 * @param {Function} calculateConnection - The calculateCalloutConnection function
 * @returns {React.ReactElement|null}
 */
export const renderCallout = (callout, index, pageWidth, pageHeight, calculateConnection) => {
  if (!callout || !callout.arrowTip || !callout.knee) return null;

  // Convert normalized (0-1) coordinates to page coordinates
  const arrowTip = {
    x: callout.arrowTip.x * pageWidth,
    y: callout.arrowTip.y * pageHeight,
  };
  const knee = {
    x: callout.knee.x * pageWidth,
    y: callout.knee.y * pageHeight,
  };
  const textBox = {
    x: (callout.textBoxPosition?.x ?? callout.textBox?.x ?? 0) * pageWidth,
    y: (callout.textBoxPosition?.y ?? callout.textBox?.y ?? 0) * pageHeight,
    width: Math.max(18, (callout.textBoxWidth ?? callout.textBox?.width ?? 0.1) * pageWidth),
    height: Math.max(18, (callout.textBoxHeight ?? callout.textBox?.height ?? 0.05) * pageHeight),
  };

  // Style extraction
  const lineColor = callout.style?.borderColor || callout.style?.lineColor || '#4A90E2';
  const lineThickness = Math.max(1, callout.style?.lineThickness || 2);
  const fillColor = callout.style?.fillColor || 'rgba(255, 255, 255, 0.22)';
  const fillOpacity = Math.max(0.08, Math.min(1, callout.style?.fillOpacity || 0.4));
  const borderOpacity = Math.max(0.2, Math.min(1, callout.style?.borderOpacity || 1));

  // Calculate connection geometry
  const connection = calculateConnection(
    textBox.x, textBox.y, textBox.width, textBox.height,
    knee, arrowTip, lineThickness
  );

  const key = `callout-${callout.id || index}`;

  const lineStyle = {
    stroke: lineColor,
    strokeWidth: lineThickness,
    strokeLinecap: 'round',
    vectorEffect: 'non-scaling-stroke',
  };

  return (
    <g key={key} opacity={borderOpacity}>
      {/* Line 1: knee to border (skip if shouldHideLine1) */}
      {!connection.shouldHideLine1 && (
        <line
          x1={connection.line1Start.x}
          y1={connection.line1Start.y}
          x2={connection.effectiveKnee.x}
          y2={connection.effectiveKnee.y}
          {...lineStyle}
        />
      )}
      {/* Line 2: knee to arrowTip */}
      <line
        x1={connection.line2Start.x}
        y1={connection.line2Start.y}
        x2={arrowTip.x}
        y2={arrowTip.y}
        {...lineStyle}
      />
      {/* ArrowTip circle */}
      <circle
        cx={arrowTip.x}
        cy={arrowTip.y}
        r={Math.max(2, lineThickness + 0.4)}
        fill={lineColor}
      />
      {/* Text box rect */}
      <rect
        x={textBox.x}
        y={textBox.y}
        width={textBox.width}
        height={textBox.height}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={lineColor}
        strokeWidth={Math.max(1, lineThickness * 0.7)}
        rx={4}
        ry={4}
        vectorEffect="non-scaling-stroke"
      />
      {/* Text box text (if callout has text) */}
      {callout.text && (
        <foreignObject
          x={textBox.x}
          y={textBox.y}
          width={textBox.width}
          height={textBox.height}
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              width: '100%',
              height: '100%',
              fontSize: `${callout.style?.fontSize || 12}px`,
              fontFamily: callout.style?.fontFamily || 'sans-serif',
              color: callout.style?.textColor || '#000',
              overflow: 'hidden',
              wordWrap: 'break-word',
              whiteSpace: 'pre-wrap',
              boxSizing: 'border-box',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {callout.text}
          </div>
        </foreignObject>
      )}
    </g>
  );
};
