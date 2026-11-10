import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEPTH_MEASURE_KINDS,
  MEASURE_NAME_MAX,
  MEASURE_UNITS,
  measureName,
  normalizeMeasureDepth,
} from '../utils/measure/measureScale.js';
import { Icon } from '../home/HubShell';
import { useFocusTrap } from '../hooks/useFocusTrap';
import MotionPresence from './MotionPresence.jsx';
import { useTooltip } from './Tooltip';
import './MeasureScaleDialog.css';

// Change a measurement after it is drawn (Nightly flag 'measure-edit',
// Drawboard deep test MS-19 / MS-20 / MS-21): its name, shown in front of the
// value on its caption; its depth (Wall area and Volume); and whether the
// caption shows on the page at all. Same card as Set page scale.
const KIND_LABEL = {
  length: 'Length',
  area: 'Area',
  perimeter: 'Perimeter',
  polylength: 'Polylength',
  wallArea: 'Wall area',
  volume: 'Volume',
};

export default function MeasureEditDialog({ object, scale = null, onApply, onCancel }) {
  const tip = useTooltip();
  const cardRef = useRef(null);
  const measure = object?.data?.measure || {};
  const kind = measure.kind;
  const hasDepth = DEPTH_MEASURE_KINDS.includes(kind);
  const [name, setName] = useState(() => measureName(object));
  const [depthText, setDepthText] = useState(() => String(measure.depth ?? ''));
  const [caption, setCaption] = useState(() => measure.caption !== false);
  const depth = normalizeMeasureDepth(depthText);
  const unitLabel = scale?.unit && MEASURE_UNITS[scale.unit] ? MEASURE_UNITS[scale.unit].label : 'in';
  const canSave = !hasDepth || Boolean(depth);
  useFocusTrap(cardRef, true, { onEscape: onCancel });
  const submit = (e) => {
    e.preventDefault();
    if (!canSave) return;
    onApply({ name, caption, ...(hasDepth ? { depth } : {}) });
  };
  const title = KIND_LABEL[kind] || 'Measurement';
  return createPortal(
    <MotionPresence open>
      <div
        className="measure-scale__scrim"
        data-measure-edit-dialog="true"
        onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      >
        <form
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${title.toLowerCase()}`}
          className="measure-scale__card"
          onSubmit={submit}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="measure-scale__head">
            <div style={{ minWidth: 0 }}>
              <div className="measure-scale__title">{title}</div>
              <div className="measure-scale__sub">{scale ? `Page scale ${scale.label}` : 'No page scale yet'}</div>
            </div>
            <button type="button" onClick={onCancel} aria-label="Close" {...tip('Close')} className="hub-icon-btn dialog-close-touch-pad">
              <Icon name="close" size={13} />
            </button>
          </div>
          <div className="measure-scale__body">
            <label className="measure-scale__label" htmlFor="measure-edit-name">Name</label>
            <input
              id="measure-edit-name"
              autoFocus
              data-autofocus
              data-measure-edit-name="true"
              className="measure-scale__field"
              type="text"
              maxLength={MEASURE_NAME_MAX}
              placeholder="Room 101"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ fontSize: 16 }}
            />
            {hasDepth && (
              <>
                <label className="measure-scale__label" htmlFor="measure-edit-depth">
                  {kind === 'wallArea' ? 'Wall height' : 'Depth'} ({unitLabel})
                </label>
                <input
                  id="measure-edit-depth"
                  data-measure-edit-depth="true"
                  className="measure-scale__field"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={depthText}
                  onChange={(e) => setDepthText(e.target.value)}
                  style={{ fontSize: 16 }}
                />
              </>
            )}
            <label className="measure-scale__check">
              <input
                type="checkbox"
                data-measure-edit-caption="true"
                checked={caption}
                onChange={(e) => setCaption(e.target.checked)}
              />
              <span>Show caption on the page</span>
            </label>
          </div>
          <div className="measure-scale__foot">
            <button type="button" className="hub-btn measure-scale__btn" onClick={onCancel}>Cancel</button>
            <button type="submit" className="hub-btn hub-btn--primary measure-scale__btn" data-measure-edit-apply="true" disabled={!canSave}>Save</button>
          </div>
        </form>
      </div>
    </MotionPresence>,
    document.body,
  );
}
