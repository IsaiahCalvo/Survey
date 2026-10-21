/**
 * SnapGuidesLayer — the dashed alignment guides shown while a dragged mark
 * snaps to another (canvas audit chunk 2, Drawboard's Snapping.jsx look).
 *
 * Drawn INSIDE the page's SVG in page units, so the viewBox owns zoom
 * (CLAUDE.md invariant); only stroke widths, dashes, the 24 px overhang and
 * the X marks are sized in screen px through `inverseScale`.
 *
 * Colour: the canvas selection blue (HANDLE_RING #4a90e2), not Drawboard's
 * pink #FD64D2. Pink sits right next to our default red / pink marks and
 * would read as ink; the selection blue already means "the app is showing
 * you something about this mark", adds no new colour and stays calm. Guides
 * only show mid-drag, when the selection frame and handles are hidden, so
 * they never compete with it.
 */
import React from 'react';
import { HANDLE_RING } from '../utils/handleStyle.js';
import { clampInverseScale } from '../utils/svgTransformMath.js';
import {
  SNAP_GUIDE_OVERHANG_PX,
  SNAP_GUIDE_STROKE_PX,
  SNAP_GUIDE_DASH_PX,
  SNAP_MARK_HALF_PX,
} from '../utils/snapGuides.js';

export const SNAP_GUIDE_COLOR = HANDLE_RING;

const fmt = (n) => (Math.round(n * 1000) / 1000);

export default function SnapGuidesLayer({ guides, inverseScale = 1 }) {
  const k = clampInverseScale(inverseScale);
  // Endpoint snap (drawSnap.js): a small ring on the line end / corner the
  // drawn or dragged point locked onto.
  const endpoint = guides?.endpoint || null;
  if (!guides?.lines?.length) {
    if (!endpoint) return null;
    // Touch / pen: a ring that clears a fingertip (r 16 vs 5 screen px).
    const r = (endpoint.coarse ? 16 : 5) * k;
    const w = endpoint.coarse ? 2.5 : 1.5;
    return (
      <g data-snap-guides="true" pointerEvents="none" style={{ pointerEvents: 'none' }}>
        <circle cx={endpoint.x} cy={endpoint.y} r={r} fill="none" stroke="#ffffff" strokeWidth={(w + 1.5) * k} />
        <circle data-snap-endpoint="true" data-snap-coarse={endpoint.coarse ? 'true' : undefined} cx={endpoint.x} cy={endpoint.y} r={r} fill="none" stroke={SNAP_GUIDE_COLOR} strokeWidth={w * k} />
      </g>
    );
  }
  const overhang = SNAP_GUIDE_OVERHANG_PX * k;
  const half = SNAP_MARK_HALF_PX * k;
  const marks = (guides.points || []).map(({ x, y }) => (
    `M${fmt(x - half)},${fmt(y - half)}L${fmt(x + half)},${fmt(y + half)}`
    + `M${fmt(x + half)},${fmt(y - half)}L${fmt(x - half)},${fmt(y + half)}`
  )).join('');
  return (
    <g data-snap-guides="true" pointerEvents="none" style={{ pointerEvents: 'none' }}>
      {guides.lines.map((line, i) => {
        const a = line.min - overhang;
        const b = line.max + overhang;
        const coords = line.axis === 'x'
          ? { x1: line.value, y1: a, x2: line.value, y2: b }
          : { x1: a, y1: line.value, x2: b, y2: line.value };
        return (
          <line
            key={`${line.axis}-${i}`}
            data-snap-guide-axis={line.axis}
            {...coords}
            stroke={SNAP_GUIDE_COLOR}
            strokeWidth={SNAP_GUIDE_STROKE_PX * k}
            strokeDasharray={`${SNAP_GUIDE_DASH_PX * k} ${SNAP_GUIDE_DASH_PX * k}`}
            fill="none"
          />
        );
      })}
      {marks && (
        <>
          <path d={marks} stroke="#ffffff" strokeWidth={2.6 * k} strokeLinecap="round" fill="none" />
          <path data-snap-guide-points="true" d={marks} stroke={SNAP_GUIDE_COLOR} strokeWidth={1.3 * k} strokeLinecap="round" fill="none" />
        </>
      )}
    </g>
  );
}
