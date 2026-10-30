import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MEASURE_PRESETS,
  MEASURE_UNITS,
  loadRecentMeasureScales,
  scaleFromCalibration,
  scaleFromPreset,
} from '../utils/measure/measureScale.js';
import { Icon } from '../home/HubShell';
import { useFocusTrap } from '../hooks/useFocusTrap';
import MotionPresence from './MotionPresence.jsx';
import { useTooltip } from './Tooltip';
import { moveGroupFocus } from '../utils/radioGroupKeys.js';
import './MeasureScaleDialog.css';

// Set page scale (Drawboard "Set page scale" / Calibrate). With a drawn
// calibration line (lengthPt) the user types its real length; without one
// they pick a preset or start "Calibrate" to draw a line.
//
// Owner 2026-10-26 (issue note #13: "setting the scale of a page looks kind
// of ugly"): it was a bare form with two native dropdowns. It is the app's
// dialog card now (the ConfirmModal shell: title, muted line, close x, footer
// bar with Cancel and the gold primary), the presets are chips grouped as
// architectural and metric, and the units are chips too. 44px touch targets
// and 16px fields stay, so iOS Safari does not zoom on focus.
//
// Drawboard Projects parity (2026-10-27): "Apply to" this page or all pages,
// and the last five scales picked on this screen as one-tap chips.
const IMPERIAL = MEASURE_PRESETS.filter((p) => p.unit === 'ft');
const OTHER = MEASURE_PRESETS.filter((p) => p.unit !== 'ft');

export default function MeasureScaleDialog({ pageNumber, pageCount = 1, lengthPt = null, currentScale = null, onApply, onCalibrate, onCancel }) {
  const tip = useTooltip();
  const cardRef = useRef(null);
  const [real, setReal] = useState('');
  const [unit, setUnit] = useState(currentScale?.unit || 'ft');
  const [preset, setPreset] = useState(
    () => MEASURE_PRESETS.find((p) => p.label === currentScale?.label)?.id || '1/4',
  );
  const [recent] = useState(() => loadRecentMeasureScales());
  const [recentPick, setRecentPick] = useState(null);
  const [allPages, setAllPages] = useState(false);
  const calibrating = Number.isFinite(lengthPt) && lengthPt > 0;
  const scale = calibrating
    ? scaleFromCalibration(lengthPt, real, unit)
    : (recentPick != null ? recent[recentPick] : scaleFromPreset(preset));
  useFocusTrap(cardRef, true, { onEscape: onCancel });
  const submit = (e) => {
    e.preventDefault();
    if (scale) onApply(scale, { allPages: allPages && pageCount > 1 });
  };
  const chip = (id, label, active, onPick, marker) => (
    <button
      key={id}
      type="button"
      role="radio"
      aria-checked={active}
      className={`measure-scale__chip${active ? ' is-active' : ''}`}
      onClick={onPick}
      {...marker}
    >
      {label}
    </button>
  );
  return createPortal(
    <MotionPresence open>
      <div
        className="measure-scale__scrim"
        data-measure-scale-dialog="true"
        onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      >
        <form
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label="Set page scale"
          className="measure-scale__card"
          onSubmit={submit}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="measure-scale__head">
            <div style={{ minWidth: 0 }}>
              <div className="measure-scale__title">Set page scale</div>
              <div className="measure-scale__sub">
                Page {pageNumber}
                {currentScale ? ` · now ${currentScale.label}` : ' · no scale yet'}
              </div>
            </div>
            <button type="button" onClick={onCancel} aria-label="Close" {...tip('Close')} className="hub-icon-btn dialog-close-touch-pad">
              <Icon name="close" size={13} />
            </button>
          </div>
          <div className="measure-scale__body">
            {calibrating ? (
              <>
                <label className="measure-scale__label" htmlFor="measure-real-length">Real length of the line you drew</label>
                <input
                  id="measure-real-length"
                  autoFocus
                  data-autofocus
                  data-measure-real-length="true"
                  className="measure-scale__field"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={real}
                  onChange={(e) => setReal(e.target.value)}
                  style={{ fontSize: 16 }}
                />
                <div className="measure-scale__label">Unit</div>
                <div className="measure-scale__chips measure-scale__chips--units" role="radiogroup" onKeyDown={moveGroupFocus} aria-label="Unit" data-measure-unit="true">
                  {Object.keys(MEASURE_UNITS).map((u) => chip(u, MEASURE_UNITS[u].label, unit === u, () => setUnit(u), { 'data-measure-unit-option': u }))}
                </div>
              </>
            ) : (
              <>
                {recent.length > 0 && (
                  <>
                    <div className="measure-scale__label">Recent</div>
                    <div className="measure-scale__chips" role="radiogroup" onKeyDown={moveGroupFocus} aria-label="Recent scale" data-measure-recent="true">
                      {recent.map((r, i) => chip(`recent-${i}`, r.label, recentPick === i, () => setRecentPick(i), { 'data-measure-recent-option': i }))}
                    </div>
                  </>
                )}
                <div className="measure-scale__label">Architectural</div>
                <div className="measure-scale__chips" role="radiogroup" onKeyDown={moveGroupFocus} aria-label="Architectural scale" data-measure-preset="true">
                  {IMPERIAL.map((p) => chip(p.id, p.label, recentPick == null && preset === p.id, () => { setPreset(p.id); setRecentPick(null); }, { 'data-measure-preset-option': p.id }))}
                </div>
                <div className="measure-scale__label">Ratio</div>
                <div className="measure-scale__chips" role="radiogroup" onKeyDown={moveGroupFocus} aria-label="Ratio scale">
                  {OTHER.map((p) => chip(p.id, p.label, recentPick == null && preset === p.id, () => { setPreset(p.id); setRecentPick(null); }, { 'data-measure-preset-option': p.id }))}
                </div>
                <button type="button" className="measure-scale__calibrate" data-measure-start-calibrate="true" onClick={onCalibrate}>
                  <span className="measure-scale__calibrate-glyph" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20 20 4" />
                      <path d="M4 15v5h5M20 9V4h-5" />
                    </svg>
                  </span>
                  <span>
                    <span className="measure-scale__calibrate-title">Calibrate instead</span>
                    <span className="measure-scale__calibrate-sub">Draw a line over a known distance</span>
                  </span>
                </button>
              </>
            )}
            {pageCount > 1 && (
              <>
                <div className="measure-scale__label">Apply to</div>
                <div className="measure-scale__chips measure-scale__chips--units" role="radiogroup" onKeyDown={moveGroupFocus} aria-label="Apply to" data-measure-apply-to="true">
                  {chip('this-page', 'This page', !allPages, () => setAllPages(false), { 'data-measure-apply-to-option': 'page' })}
                  {chip('all-pages', `All ${pageCount} pages`, allPages, () => setAllPages(true), { 'data-measure-apply-to-option': 'all' })}
                </div>
              </>
            )}
          </div>
          <div className="measure-scale__foot">
            <button type="button" className="hub-btn measure-scale__btn" onClick={onCancel}>Cancel</button>
            <button type="submit" className="hub-btn hub-btn--primary measure-scale__btn" data-measure-apply="true" disabled={!scale}>Apply</button>
          </div>
        </form>
      </div>
    </MotionPresence>,
    document.body,
  );
}
