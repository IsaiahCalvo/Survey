import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MEASURE_UNITS, normalizeMeasureDepth } from '../utils/measure/measureScale.js';
import { Icon } from '../home/HubShell';
import { useFocusTrap } from '../hooks/useFocusTrap';
import MotionPresence from './MotionPresence.jsx';
import { useTooltip } from './Tooltip';
import './MeasureScaleDialog.css';

// Depth for Wall area (perimeter x depth) and Volume (area x depth), asked
// when one of those tools is picked (Nightly flag 'measure-depth', Drawboard
// Projects trial audit 2026-11-09). Same card as Set page scale. The depth is
// in the page scale's unit, so 8 on a 1/4" = 1' page means 8 feet.
const KIND_LABEL = { wallArea: 'Wall area', volume: 'Volume' };

export default function MeasureDepthDialog({ kind, initialDepth = 1, scale = null, onApply, onCancel }) {
  const tip = useTooltip();
  const cardRef = useRef(null);
  const [value, setValue] = useState(String(initialDepth ?? ''));
  const depth = normalizeMeasureDepth(value);
  const unitLabel = scale?.unit && MEASURE_UNITS[scale.unit] ? MEASURE_UNITS[scale.unit].label : 'in';
  useFocusTrap(cardRef, true, { onEscape: onCancel });
  const submit = (e) => {
    e.preventDefault();
    if (depth) onApply(depth);
  };
  const title = KIND_LABEL[kind] || 'Depth';
  return createPortal(
    <MotionPresence open>
      <div
        className="measure-scale__scrim"
        data-measure-depth-dialog="true"
        onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      >
        <form
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${title} depth`}
          className="measure-scale__card"
          onSubmit={submit}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="measure-scale__head">
            <div style={{ minWidth: 0 }}>
              <div className="measure-scale__title">{title}</div>
              <div className="measure-scale__sub">
                {kind === 'wallArea' ? 'Outline length × depth' : 'Area × depth'}
                {scale ? ` · page scale ${scale.label}` : ' · no page scale yet'}
              </div>
            </div>
            <button type="button" onClick={onCancel} aria-label="Close" {...tip('Close')} className="hub-icon-btn dialog-close-touch-pad">
              <Icon name="close" size={13} />
            </button>
          </div>
          <div className="measure-scale__body">
            <label className="measure-scale__label" htmlFor="measure-depth">
              {kind === 'wallArea' ? 'Wall height' : 'Depth'} ({unitLabel})
            </label>
            <input
              id="measure-depth"
              autoFocus
              data-autofocus
              data-measure-depth="true"
              className="measure-scale__field"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ fontSize: 16 }}
            />
          </div>
          <div className="measure-scale__foot">
            <button type="button" className="hub-btn measure-scale__btn" onClick={onCancel}>Cancel</button>
            <button type="submit" className="hub-btn hub-btn--primary measure-scale__btn" data-measure-depth-apply="true" disabled={!depth}>Use</button>
          </div>
        </form>
      </div>
    </MotionPresence>,
    document.body,
  );
}
