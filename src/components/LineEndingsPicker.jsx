// Nightly 'line-endings': Drawboard's Endings control for the Line and Arrow
// tools. A Start | End switch, a quick row of five heads (None, Slash, Square
// and Open arrow are fixed; the fifth is the current pick) and a chevron that
// opens all ten in a 5 x 2 grid. Each tile draws the head the page will draw
// (the same spec, Drawboard's sizes) and is named by the shared tooltip chip.
//
// It works on the one picked line when there is one (the change is an Undo
// step on that mark) and otherwise on the tool's own remembered ends.
import { useState } from 'react';
import { LINE_ENDING_GRID_ORDER, LINE_ENDING_NAMES } from './Callout/types.js';
import {
  LINE_ENDING_SET_DRAWBOARD,
  arrowheadShapePathD,
  buildArrowheadRenderSpec,
  lineEndingBodyInset,
} from '../utils/lineRenderHelpers.js';
import { parsePickedLineEnds, setLineEndingDefault, useLineEndingDefaults } from '../utils/lineEndingDefaults.js';
import { TRANSFORM_SELECTION_EVENT } from '../utils/selectionProperties.js';
import Icon from '../Icons';
import AnnotationDropdown from './AnnotationDropdown.jsx';
import './LineEndingsPicker.css';

const QUICK_FIXED = LINE_ENDING_GRID_ORDER.slice(0, 4);

/**
 * The ends the picker shows and what a pick does: the picked line's own heads
 * (api.selectedLineEnds) or the tool's remembered ones. Null when neither.
 */
export function useLineEndingsControl(api, tool) {
  const defaults = useLineEndingDefaults(tool);
  const picked = parsePickedLineEnds(api?.selectedLineEnds);
  if (picked) {
    return {
      start: picked.start,
      end: picked.end,
      pick: (side, style) => {
        window.dispatchEvent(new CustomEvent(TRANSFORM_SELECTION_EVENT, {
          detail: { pageNumber: picked.pageNumber, op: 'ending', side, style },
        }));
        // The mark just drawn stays picked while its tool is armed; the pick
        // is then the tool's setting too, as the other style controls do.
        if (api?.activeTool === tool) setLineEndingDefault(tool, side, style);
      },
    };
  }
  if (!defaults) return null;
  return { start: defaults.start, end: defaults.end, pick: (side, style) => setLineEndingDefault(tool, side, style) };
}

function headShapes(spec, color, keyPrefix) {
  return (spec.shapes || []).map((shape, i) => (shape.type === 'circle'
    ? <circle key={`${keyPrefix}${i}`} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill === 'none' ? 'none' : color} stroke={shape.stroke === 'none' ? 'none' : color} strokeWidth={shape.strokeWidth} />
    : <path key={`${keyPrefix}${i}`} d={arrowheadShapePathD(shape)} fill={shape.fill === 'none' ? 'none' : color} stroke={shape.stroke === 'none' ? 'none' : color} strokeWidth={shape.strokeWidth} strokeLinejoin="miter" strokeLinecap="butt" strokeMiterlimit={4} />));
}

/** A short line with its two heads, drawn with Drawboard's sizes. */
export function LineEndsSample({ start = 'none', end = 'none', width = 32, height = 20, w = 1.4, color = 'currentColor' }) {
  const y = height / 2;
  const left = 3;
  const right = width - 3;
  const geometry = LINE_ENDING_SET_DRAWBOARD;
  const startSpec = buildArrowheadRenderSpec(start, left, y, 180, color, w, { geometry });
  const endSpec = buildArrowheadRenderSpec(end, right, y, 0, color, w, { geometry });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <line
        x1={left + lineEndingBodyInset(start, w, geometry)} y1={y}
        x2={right - lineEndingBodyInset(end, w, geometry)} y2={y}
        stroke={color} strokeWidth={w} strokeLinecap="round"
      />
      {headShapes(startSpec, color, 's')}
      {headShapes(endSpec, color, 'e')}
    </svg>
  );
}

/** One tile's drawing: the head on the end being picked. */
export function LineEndingSample({ style, side = 'end', ...rest }) {
  return side === 'start' ? <LineEndsSample start={style} {...rest} /> : <LineEndsSample end={style} {...rest} />;
}

/**
 * The toolbar's Endings pill (desktop): draws the line with both heads and
 * opens the picker. Its own component so the picker's hook has a home.
 */
export function LineEndingsMenu({ api, tool, tip, compact = false }) {
  const [open, setOpen] = useState(false);
  const control = useLineEndingsControl(api, tool);
  if (!control) return null;
  return (
    <AnnotationDropdown
      compact={compact}
      open={open}
      onOpenChange={setOpen}
      label="Endings"
      value={`${control.start}|${control.end}`}
      triggerContent="Ends"
      dataMarker="data-line-endings-menu"
      preview={<LineEndsSample start={control.start} end={control.end} width={22} height={14} w={1} />}
      width="var(--chrome-field-w-arrowhead)"
      contentClassName="line-endings-popover"
    >
      <LineEndingsPicker control={control} tip={tip} />
    </AnnotationDropdown>
  );
}

export default function LineEndingsPicker({ control, tip, compact = false }) {
  const [side, setSide] = useState('end');
  const [expanded, setExpanded] = useState(false);
  if (!control) return null;
  const current = side === 'start' ? control.start : control.end;
  // The fifth quick tile is the current pick when it is not one of the four
  // fixed ones (Drawboard); otherwise the next head in the grid.
  const fifth = QUICK_FIXED.includes(current) ? LINE_ENDING_GRID_ORDER[4] : current;
  const quick = [...QUICK_FIXED, fifth];
  const tile = (style) => {
    const name = LINE_ENDING_NAMES[style] || style;
    const pressed = style === current;
    return (
      <button
        key={style}
        type="button"
        className={`line-endings__tile${pressed ? ' is-current' : ''}`}
        aria-label={name}
        aria-pressed={pressed}
        data-line-ending={style}
        {...(tip ? tip(name, 'below') : {})}
        onClick={() => control.pick(side, style)}
      >
        <LineEndingSample style={style} side={side} />
      </button>
    );
  };
  return (
    <div className={`line-endings${compact ? ' line-endings--compact' : ''}`} data-line-endings="true">
      <div className="line-endings__head">
        <span className="line-endings__title">Endings</span>
        <div className="line-endings__switch" role="group" aria-label="Which end">
          {['start', 'end'].map((value) => (
            <button
              key={value}
              type="button"
              className={`line-endings__side${side === value ? ' is-current' : ''}`}
              aria-pressed={side === value}
              data-line-ending-side={value}
              onClick={() => setSide(value)}
            >
              {value === 'start' ? 'Start' : 'End'}
            </button>
          ))}
        </div>
      </div>
      <div className="line-endings__row" role="group" aria-label={side === 'start' ? 'Start ending' : 'End ending'}>
        {quick.map(tile)}
        <button
          type="button"
          className={`line-endings__more${expanded ? ' is-open' : ''}`}
          aria-label={expanded ? 'Fewer endings' : 'All endings'}
          aria-expanded={expanded}
          data-line-endings-more="true"
          {...(tip ? tip(expanded ? 'Fewer endings' : 'All endings', 'below') : {})}
          onClick={() => setExpanded((open) => !open)}
        >
          <Icon name="chevronDown" size={12} color="currentColor" />
        </button>
      </div>
      {expanded && (
        <div className="line-endings__grid" role="group" aria-label="All endings">
          {LINE_ENDING_GRID_ORDER.map(tile)}
        </div>
      )}
    </div>
  );
}

/** The picker with its own control, for the phone sheet and the panel. */
export function LineEndingsPanel({ api, tool, tip, compact = false }) {
  const control = useLineEndingsControl(api, tool);
  return <LineEndingsPicker control={control} tip={tip} compact={compact} />;
}
