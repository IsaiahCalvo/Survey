import './StrokeStyleCards.css';

/*
 * Owner 2026-10-26 (issue note #11): the line-style and arrow pickers were
 * plain word lists ("Solid" in one pill, "Solid" again in the arrowhead pill
 * beside it, and "None" in both the arrowhead and the arrow-ends menus). They
 * are cards now, the same kind of card as the Width picker, after Drawboard
 * PDF's pen card: the line it will draw on a strip of paper, in the tool's own
 * colour and width, then the choices drawn as tiles.
 *
 *   Style card  - Solid / Dashed / Dotted (/ Cloud) tiles.
 *   Ends card   - which ends carry a head (End / Both), then the head tiles
 *                 (None, Filled, Open, Circle, Square, Bar). One card for what
 *                 used to be two pills, so "no head" lives in one place.
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

const PAPER = '#f7f7f4';
// The strip shows the line at its 100% zoom size (1 pt = 4/3 px), up to what
// the strip can hold.
const paperPx = (widthPt) => Math.min(12, Math.max(1, (Number(widthPt) || 2) * (4 / 3)));

function Paper({ children, mixed }) {
  return (
    <div className="stroke-card__paper" data-stroke-card-sample="true">
      {mixed ? <span className="stroke-card__mixed">Mixed</span> : children}
    </div>
  );
}

function Tile({ active, label, onPick, children, testValue }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      data-stroke-tile={testValue}
      className={`stroke-card__tile${active ? ' is-active' : ''}`}
      onClick={onPick}
    >
      <span className="stroke-card__tile-sample" aria-hidden="true">{children}</span>
      <span className="stroke-card__tile-label" aria-hidden="true">{label}</span>
    </button>
  );
}

/** The Style pill's card. */
export function LineStyleCard({ label = 'Style', value, mixed, options, onSelect, color, widthPt, endHead = 'none', startHead = 'none' }) {
  const ink = color || '#1f2937';
  return (
    <div className="stroke-card" data-line-style-card="true">
      <Paper mixed={mixed}>
        <StrokeSample width={212} height={44} pad={14} strokePx={paperPx(widthPt)} color={ink} paper={PAPER} dash={value} endHead={endHead} startHead={startHead} />
      </Paper>
      <div className="stroke-card__tiles" role="radiogroup" aria-label={label} style={{ '--stroke-card-cols': options.length }}>
        {options.map((option) => (
          <Tile key={option.value} active={!mixed && option.value === value} label={option.label} testValue={option.value} onPick={() => onSelect(option.value)}>
            <StrokeSample width={40} height={16} pad={3} strokePx={2} dash={option.value} />
          </Tile>
        ))}
      </div>
    </div>
  );
}

/**
 * The arrow's (or callout leader's) Ends card. `ends` is 'end' | 'both', or
 * null when the card has no ends to choose (a callout has one end).
 */
export function ArrowEndsCard({
  head,
  ends,
  headMixed,
  endsMixed,
  headOptions,
  onHead,
  onEnds,
  color,
  widthPt,
  dash = 'solid',
}) {
  const ink = color || '#1f2937';
  const showEnds = ends != null;
  const both = ends === 'both';
  return (
    <div className="stroke-card" data-arrow-ends-card="true">
      <Paper mixed={headMixed || endsMixed}>
        <StrokeSample
          width={212}
          height={44}
          pad={14}
          strokePx={paperPx(widthPt)}
          color={ink}
          paper={PAPER}
          dash={dash === 'cloud' ? 'solid' : dash}
          endHead={head}
          startHead={both ? head : 'none'}
        />
      </Paper>
      {showEnds && (
        <div className="stroke-card__ends" role="radiogroup" aria-label="Which ends">
          {[['end', 'End'], ['both', 'Both ends']].map(([value, word]) => {
            const active = !endsMixed && head !== 'none' && ends === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                data-arrow-ends-option={value}
                className={`stroke-card__end${active ? ' is-active' : ''}`}
                onClick={() => onEnds(value)}
              >
                <StrokeSample width={30} height={14} pad={2} strokePx={1.5} endHead="vShape" startHead={value === 'both' ? 'vShape' : 'none'} headScale={0.85} />
                <span>{word}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="stroke-card__tiles" role="radiogroup" aria-label="Arrowhead" style={{ '--stroke-card-cols': 3 }}>
        {headOptions.map((option) => (
          <Tile key={option.value} active={!headMixed && option.value === head} label={option.label} testValue={option.value} onPick={() => onHead(option.value)}>
            <StrokeSample width={40} height={16} pad={3} strokePx={1.5} endHead={option.value} startHead={both && option.value !== 'none' ? option.value : 'none'} />
          </Tile>
        ))}
      </div>
    </div>
  );
}
