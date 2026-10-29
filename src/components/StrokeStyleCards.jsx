import './StrokeStyleCards.css';

/*
 * The line samples the Style and Arrow ends menus draw (the pill's drawing
 * and each row's). Owner 2026-10-26 (#11) made them cards with a paper strip
 * and tiles; owner 2026-10-28 ("a little simpler") made them plain lists
 * again, each row drawing its line, so only the sample is left here.
 */

const DASH = {
  solid: null,
  dashed: (s) => `${Math.max(3, s * 3)} ${Math.max(2.5, s * 2)}`,
  dotted: (s) => `0 ${Math.max(3, s * 2.2)}`,
};

/** One head, drawn pointing right with its tip at (x, y). */
function Head({ type, x, y, size, color, stroke, paper }) {
  const L = size;
  const h = L / 2;
  switch (type) {
    case 'solidTriangle':
      return <path d={`M ${x} ${y} L ${x - L} ${y - h} L ${x - L} ${y + h} Z`} fill={color} stroke={color} strokeWidth={Math.min(stroke, 1.5)} strokeLinejoin="round" />;
    case 'openTriangle':
      return <path d={`M ${x} ${y} L ${x - L} ${y - h} L ${x - L} ${y + h} Z`} fill={paper} stroke={color} strokeWidth={stroke} strokeLinejoin="round" />;
    case 'vShape':
      return <path d={`M ${x - L} ${y - h} L ${x} ${y} L ${x - L} ${y + h}`} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />;
    case 'openCircle':
      return <circle cx={x - h} cy={y} r={Math.max(1, h - stroke / 2)} fill={paper} stroke={color} strokeWidth={stroke} />;
    case 'square':
      return <rect x={x - L * 0.8} y={y - L * 0.4} width={L * 0.8} height={L * 0.8} fill={color} />;
    case 'horizontalLine':
      return <path d={`M ${x} ${y - h} L ${x} ${y + h}`} stroke={color} strokeWidth={stroke} strokeLinecap="round" />;
    case 'diamond':
      return <path d={`M ${x} ${y} L ${x - h} ${y - h} L ${x - L} ${y} L ${x - h} ${y + h} Z`} fill={paper} stroke={color} strokeWidth={stroke} strokeLinejoin="round" />;
    case 'slash':
      return <path d={`M ${x - h} ${y + h} L ${x + h * 0.4} ${y - h}`} stroke={color} strokeWidth={stroke} strokeLinecap="round" />;
    default:
      return null;
  }
}

// How far back from the tip a head lets the line run, so a filled head ends
// in a point instead of a blunt line poking through it.
const headInset = (type, L) => {
  if (type === 'solidTriangle' || type === 'openTriangle') return L * 0.9;
  if (type === 'openCircle' || type === 'diamond') return L;
  if (type === 'square') return L * 0.4;
  return 0;
};

/**
 * A straight sample of a line: its dash pattern (or cloud bumps) and the heads
 * on its ends. `strokePx` is the drawn thickness; `paper` is the colour behind
 * it, which hollow heads are filled with.
 */
export function StrokeSample({
  width = 120,
  height = 28,
  strokePx = 2,
  color = 'currentColor',
  paper = 'transparent',
  dash = 'solid',
  endHead = 'none',
  startHead = 'none',
  pad = 6,
  headScale = 1,
}) {
  const y = height / 2;
  const s = strokePx;
  const L = Math.max(7, Math.min(height - 4, s * 3.2 + 4)) * headScale;
  const x0 = pad;
  const x1 = width - pad;
  const a = x0 + headInset(startHead, L);
  const b = x1 - headInset(endHead, L);
  let line;
  if (dash === 'cloud') {
    const r = Math.max(3, Math.min(height / 3, s * 2 + 3));
    const count = Math.max(2, Math.round((b - a) / (r * 2)));
    const step = (b - a) / count;
    let d = `M ${a} ${y}`;
    for (let i = 0; i < count; i += 1) d += ` A ${step / 2} ${r} 0 0 1 ${a + step * (i + 1)} ${y}`;
    line = <path d={d} fill="none" stroke={color} strokeWidth={s} strokeLinecap="round" strokeLinejoin="round" />;
  } else {
    line = (
      <path
        d={`M ${a} ${y} L ${b} ${y}`}
        fill="none"
        stroke={color}
        strokeWidth={s}
        strokeDasharray={DASH[dash]?.(s) ?? undefined}
        strokeLinecap={dash === 'dotted' ? 'round' : 'butt'}
      />
    );
  }
  const headStroke = Math.max(1.25, Math.min(s, 3));
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="stroke-sample">
      {line}
      <Head type={endHead} x={x1} y={y} size={L} color={color} stroke={headStroke} paper={paper} />
      <g transform={`translate(${width} 0) scale(-1 1)`}>
        <Head type={startHead} x={width - x0} y={y} size={L} color={color} stroke={headStroke} paper={paper} />
      </g>
    </svg>
  );
}
