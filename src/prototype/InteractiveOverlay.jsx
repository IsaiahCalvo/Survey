// ============================================================================
// PROTOTYPE — THROWAWAY. Shared interactive annotation overlay.
// ============================================================================
// One <svg> per page, authored in UNSCALED PDF page space with
// viewBox="0 0 W H" + preserveAspectRatio="none". The browser maps page-space
// → screen-space at exactly `scale` on each axis with ZERO JS zoom math — the
// same contract as the real app's SVGAnnotationLayer. Because shapes are stored
// in page-space points, they stay pixel-locked to the page through any zoom or
// rotation, and the SAME annotations render identically in BOTH arms (PDF points
// are renderer-independent).
//
// Shapes are selectable (click) and movable (drag). Strokes use
// vector-effect="non-scaling-stroke" so they stay a constant screen thickness.
// ============================================================================
import { useEffect, useRef, useState } from 'react';

// Default seed shapes for a freshly-mounted page, expressed as fractions of the
// page's point size so they look right on any page geometry.
export function makeDefaultAnnotations(pageW, pageH, pageIndex) {
  return [
    { id: `r${pageIndex}`, type: 'rect', x: pageW * 0.12, y: pageH * 0.12, w: pageW * 0.30, h: pageH * 0.10, stroke: '#ff2d55' },
    { id: `e${pageIndex}`, type: 'ellipse', cx: pageW * 0.52, cy: pageH * 0.5, rx: pageW * 0.13, ry: pageH * 0.08, stroke: '#30d158' },
    { id: `l${pageIndex}`, type: 'line', x1: pageW * 0.1, y1: pageH * 0.86, x2: pageW * 0.62, y2: pageH * 0.7, stroke: '#0a84ff' },
    { id: `t${pageIndex}`, type: 'text', x: pageW * 0.12, y: pageH * 0.105, text: `pg ${pageIndex + 1} · drag me`, color: '#ff9f0a', size: Math.max(9, pageW * 0.016) },
  ];
}

// Which numeric fields are (x,y) point-pairs to translate when dragging.
const POINT_FIELDS = {
  rect: [['x', 'y']],
  ellipse: [['cx', 'cy']],
  line: [['x1', 'y1'], ['x2', 'y2']],
  text: [['x', 'y']],
};

function bboxOf(a) {
  switch (a.type) {
    case 'rect': return { x: a.x, y: a.y, w: a.w, h: a.h };
    case 'ellipse': return { x: a.cx - a.rx, y: a.cy - a.ry, w: a.rx * 2, h: a.ry * 2 };
    case 'line': return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
    case 'text': return { x: a.x, y: a.y - a.size, w: (a.text.length * a.size) * 0.55, h: a.size * 1.3 };
    default: return { x: 0, y: 0, w: 0, h: 0 };
  }
}

export default function InteractiveOverlay({ pageWidth, pageHeight, annotations, onChange }) {
  const svgRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const dragRef = useRef(null); // { id, startClientX, startClientY, originals }
  const teardownRef = useRef(null); // removes the in-flight drag's window listeners

  // if the page unmounts mid-drag, tear down the window listeners
  useEffect(() => () => { teardownRef.current?.(); }, []);

  if (!pageWidth || !pageHeight || !annotations) return null;

  // Convert a client-pixel delta into a page-space delta using the SVG's actual
  // rendered size — the inverse of the viewBox forward map. Works in BOTH arms
  // regardless of how zoom is applied (CSS transform or page-box resize).
  const pageDelta = (dxClient, dyClient) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      dx: (dxClient / rect.width) * pageWidth,
      dy: (dyClient / rect.height) * pageHeight,
    };
  };

  const onShapePointerDown = (e, a) => {
    e.stopPropagation();
    setSelected(a.id);
    dragRef.current = {
      id: a.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originals: { ...a },
    };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const { dx, dy } = pageDelta(ev.clientX - d.startClientX, ev.clientY - d.startClientY);
      const next = annotations.map((s) => {
        if (s.id !== d.id) return s;
        const moved = { ...d.originals };
        for (const [fx, fy] of POINT_FIELDS[s.type] || []) {
          moved[fx] = d.originals[fx] + dx;
          moved[fy] = d.originals[fy] + dy;
        }
        return moved;
      });
      onChange(next);
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      teardownRef.current = null;
    };
    teardownRef.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const renderShape = (a) => {
    const isSel = a.id === selected;
    const common = {
      onPointerDown: (e) => onShapePointerDown(e, a),
      // shapes are interactive; the rest of the SVG is pass-through so the page
      // underneath stays scrollable/zoomable in both arms.
      style: { cursor: 'grab', pointerEvents: 'auto' },
      vectorEffect: 'non-scaling-stroke',
    };
    switch (a.type) {
      case 'rect':
        return <rect key={a.id} x={a.x} y={a.y} width={a.w} height={a.h} fill="rgba(255,45,85,0.10)" stroke={a.stroke} strokeWidth={2} {...common} />;
      case 'ellipse':
        return <ellipse key={a.id} cx={a.cx} cy={a.cy} rx={a.rx} ry={a.ry} fill="rgba(48,209,88,0.10)" stroke={a.stroke} strokeWidth={2} {...common} />;
      case 'line':
        return <line key={a.id} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={a.stroke} strokeWidth={2.5} {...common} />;
      case 'text':
        return (
          <text key={a.id} x={a.x} y={a.y} fill={a.color} fontSize={a.size} fontFamily="Helvetica, Arial, sans-serif" fontWeight="700" {...common}>
            {a.text}
          </text>
        );
      default:
        return null;
    }
  };

  const selAnn = annotations.find((a) => a.id === selected);
  const selBox = selAnn ? bboxOf(selAnn) : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
    >
      {annotations.map(renderShape)}
      {selBox && (
        <rect
          x={selBox.x - 3} y={selBox.y - 3} width={selBox.w + 6} height={selBox.h + 6}
          fill="none" stroke="#ffffff" strokeDasharray="5 4" strokeWidth={1.5}
          vectorEffect="non-scaling-stroke" pointerEvents="none"
        />
      )}
    </svg>
  );
}
