// Nightly 'pen-types': Drawboard's three pens as three round tiles, each with
// its name and what it does ("Fixed width", "Variable width", "Dynamic
// width"). Each disc draws a sample stroke with that pen's own width rule
// (the same factors a real stroke gets), so the tile shows what you will draw.
// The picked tile has a ring. The width stays shared across the three.
import { useState } from 'react';
import AnnotationDropdown from './AnnotationDropdown.jsx';
import { PEN_TYPES, penWidthFactors, setPenType, usePenType } from '../utils/penTypes.js';
import { variableWidthPreviewD } from '../utils/penWidthInk.js';
import './PenTypePicker.css';

// A wave from left to right with a dip, sampled with times: slow at the ends,
// quick in the middle (so Pro shows its speed taper).
const SAMPLE = (() => {
  const pts = [];
  let t = 0;
  for (let i = 0; i <= 40; i += 1) {
    const u = i / 40;
    const x = 6 + u * 36;
    const y = 18 + Math.sin(u * Math.PI * 2) * 7;
    const speed = 0.2 + 1.4 * Math.sin(u * Math.PI);
    const prev = pts[pts.length - 1];
    if (prev) t += Math.hypot(x - prev.x, y - prev.y) / speed;
    pts.push({ x, y, t });
  }
  return pts;
})();

export function PenTypeSample({ type, width = 3, color = 'currentColor' }) {
  const factors = penWidthFactors(SAMPLE, type, width) || SAMPLE.map(() => 1);
  const d = variableWidthPreviewD(SAMPLE, factors.map((f) => Math.max(0.25, (width * f) / 2)));
  return (
    <svg width="48" height="36" viewBox="0 0 48 36" aria-hidden="true" focusable="false">
      <path d={d} fill={color} fillRule="nonzero" />
    </svg>
  );
}

export default function PenTypeTiles({ tip, onPicked }) {
  const current = usePenType();
  return (
    <div className="pen-types" role="radiogroup" aria-label="Pen type" data-pen-types="true">
      {PEN_TYPES.map((type) => {
        const on = type.id === current;
        return (
          <button
            key={type.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${type.label}: ${type.sub}`}
            data-pen-type={type.id}
            className={`pen-types__tile${on ? ' is-current' : ''}`}
            {...(tip ? tip(`${type.label}: ${type.sub}`, 'below') : {})}
            onClick={() => { setPenType(type.id); onPicked?.(type.id); }}
          >
            <span className="pen-types__disc"><PenTypeSample type={type.id} /></span>
            <span className="pen-types__name">{type.label}</span>
            <span className="pen-types__sub">{type.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The desktop bar's Pen pill: names the pen and opens the three tiles. */
export function PenTypeMenu({ tip, compact = false }) {
  const [open, setOpen] = useState(false);
  const current = usePenType();
  const label = PEN_TYPES.find((type) => type.id === current)?.label || 'Basic';
  return (
    <AnnotationDropdown
      compact={compact}
      open={open}
      onOpenChange={setOpen}
      label="Pen type"
      value={current}
      triggerContent={label}
      dataMarker="data-pen-type-menu"
      preview={<span className="pen-types__pill-sample"><PenTypeSample type={current} width={2.4} /></span>}
      width="var(--chrome-field-w-arrowhead)"
      contentClassName="pen-types-popover"
    >
      <PenTypeTiles tip={tip} onPicked={() => setOpen(false)} />
    </AnnotationDropdown>
  );
}
