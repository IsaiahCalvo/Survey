// src/components/LiveStrokeGhosts.jsx
//
// w32 (2026-09-25): other screens' pen / highlighter strokes WHILE they are
// being drawn (annotationLiveStrokes.js), inside one page's annotation SVG.
//
// UX: the ink grows here as the other person draws it (Drawboard/Figma
// feel), drawn exactly like this screen's own in-progress stroke (the
// `freehand-creation-preview` polyline: round caps and joins, the
// highlighter multiplied). It is only a picture — no pointer events, not an
// annotation, never saved — and it is replaced by the real mark the moment
// that arrives. The SVG's viewBox is the page, so points are page units and
// zoom needs no code here.
import React, { useSyncExternalStore } from 'react';
import { getLiveStrokesForPage, subscribeLiveStrokes } from '../services/annotationLiveStrokes.js';

const EMPTY = [];

function pointsAttribute(points) {
  let text = '';
  for (let index = 0; index + 1 < points.length; index += 2) {
    text += `${index ? ' ' : ''}${points[index]},${points[index + 1]}`;
  }
  return text;
}

export default function LiveStrokeGhosts({ documentId, pageNumber }) {
  const strokes = useSyncExternalStore(
    subscribeLiveStrokes,
    () => (documentId ? getLiveStrokesForPage(pageNumber, documentId) : EMPTY),
    () => EMPTY,
  );
  if (!strokes || strokes.length === 0) return null;
  return (
    <g data-live-stroke-layer="true" style={{ pointerEvents: 'none' }}>
      {strokes.map((stroke) => (
        <polyline
          key={stroke.key}
          data-live-stroke-ghost="true"
          data-live-stroke-points={stroke.count}
          points={pointsAttribute(stroke.points)}
          fill="none"
          stroke={stroke.color}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            pointerEvents: 'none',
            ...(stroke.tool === 'highlighter' ? { mixBlendMode: 'multiply' } : {}),
          }}
        />
      ))}
    </g>
  );
}
