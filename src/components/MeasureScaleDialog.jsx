import { useRef, useState } from 'react';
import { paperLengthWords, parseRealLength } from '../utils/measure/realLength.js';
import { createPortal } from 'react-dom';
import {
  MEASURE_PRESETS,
  MEASURE_UNITS,
  customMeasureScaleIndex,
  forgetCustomMeasureScale,
  loadCustomMeasureScales,
  loadRecentMeasureScales,
  rememberCustomMeasureScale,
  scaleFromCalibration,
  scaleFromPreset,
} from '../utils/measure/measureScale.js';
import { readUnits } from '../utils/annotationPreferences.js';
import { isFeatureOn } from '../featureFlags.js';
import { Icon } from '../home/HubShell';
import { useFocusTrap } from '../hooks/useFocusTrap';
import MotionPresence from './MotionPresence.jsx';
import ValueSelect from './ValueSelect.jsx';
import { useTooltip } from './Tooltip';
import { moveGroupFocus } from '../utils/radioGroupKeys.js';
import './MeasureScaleDialog.css';
import {
  CUSTOM_SCALE_TITLE_MAX,
  DECIMAL_PRECISIONS,
  FRACTION_PRECISIONS,
  MEASURE_DISPLAYS,
  PAPER_UNITS,
  customMeasureScale,
  customScaleInputs,
  displayForScaleUnit,
  isFractionalDisplay,
  isMeasureDisplay,
  normalizeMeasurePrecision,
} from '../utils/measure/measureFormat.js';

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

// `markMode` 'add' / 'edit' (measure-plus): Drawboard's Add Scale / Edit
// Scale from the Measurement card. Only the custom row, Title, Units and
// Precision show; Apply gives the scale to the picked measurement, and an
// edit replaces custom scale `editIndex` in the list.
export default function MeasureScaleDialog({ pageNumber, pageCount = 1, lengthPt = null, currentScale = null, onApply, onCalibrate, onCancel, markMode = null, editIndex = -1 }) {
  const tip = useTooltip();
  const cardRef = useRef(null);
  const [real, setReal] = useState('');
  // With no scale yet, start from the default units (Settings > Annotations).
  // Nightly 'default-units': with the flag off a stored metric choice is ignored.
  const [metric] = useState(() => isFeatureOn('default-units') && readUnits() === 'metric');
  const [unit, setUnit] = useState(currentScale?.unit || (metric ? 'm' : 'ft'));
  const [preset, setPreset] = useState(
    () => MEASURE_PRESETS.find((p) => p.label === currentScale?.label)?.id || (metric ? '1:100' : '1/4'),
  );
  const [recent] = useState(() => loadRecentMeasureScales());
  const [recentPick, setRecentPick] = useState(null);
  const [allPages, setAllPages] = useState(false);
  const calibrating = Number.isFinite(lengthPt) && lengthPt > 0;
  // Nightly 'calibrate-entry': the box takes feet-inches as plans write them
  // (20' 6", 20-6, 6") and says what the traced line is on paper.
  // 'measure-plus' takes it too: Drawboard's calibrate reads `40'` as typed.
  const [entryOn] = useState(() => isFeatureOn('calibrate-entry') || isFeatureOn('measure-plus'));
  const realValue = entryOn ? parseRealLength(real, unit) : real;
  // Nightly 'measure-plus': a custom scale row, Drawboard's number formats
  // (units + precision) and "Set as default". Reopens on the live scale.
  const [plusOn] = useState(() => isFeatureOn('measure-plus'));
  const [custom, setCustom] = useState(() => Boolean(markMode) || Boolean(plusOn && currentScale?.display && !MEASURE_PRESETS.some((p) => p.label === currentScale?.label) && !calibrating));
  const [display, setDisplay] = useState(() => (isMeasureDisplay(currentScale?.display) ? currentScale.display : displayForScaleUnit(currentScale?.unit || (metric ? 'm' : 'ft'))));
  const [precision, setPrecision] = useState(() => normalizeMeasurePrecision(display, currentScale?.precision));
  // Reopened on a custom scale, the row starts filled so Apply keeps it.
  const [customStart] = useState(() => (custom ? customScaleInputs(currentScale) : null));
  const [paper, setPaper] = useState(customStart?.paper || '1');
  const [paperUnit, setPaperUnit] = useState(customStart?.paperUnit || 'in');
  const [customReal, setCustomReal] = useState(customStart?.real || '');
  // Drawboard's Title: empty follows the numbers live; typed, it names the scale.
  const [customTitle, setCustomTitle] = useState(customStart?.title || '');
  const [setDefault, setSetDefault] = useState(false);
  // Drawboard's "Apply to existing measurements": also puts measures on
  // their own scale back on this one. Off each time the dialog opens.
  const [resetOwn, setResetOwn] = useState(false);
  // Drawboard's CUSTOM SCALES: every custom scale applied on this screen.
  // A chip fills the custom row; its x takes it off the list.
  const [customs, setCustoms] = useState(() => (plusOn ? loadCustomMeasureScales() : []));
  const pickCustomScale = (saved) => {
    const inputs = customScaleInputs(saved);
    if (!inputs) return;
    setCustom(true);
    setPaper(inputs.paper);
    setPaperUnit(inputs.paperUnit);
    setCustomReal(inputs.real);
    setCustomTitle(inputs.title || '');
    setDisplay(saved.display);
    setPrecision(normalizeMeasurePrecision(saved.display, saved.precision));
  };
  const pickDisplay = (next) => {
    setDisplay(next);
    if (isFractionalDisplay(next) !== isFractionalDisplay(display)) setPrecision(normalizeMeasurePrecision(next, null));
  };
  const baseScale = calibrating
    ? scaleFromCalibration(lengthPt, realValue, unit)
    : (recentPick != null ? recent[recentPick] : scaleFromPreset(preset));
  let scale = baseScale;
  if (plusOn) {
    if (custom && !calibrating) scale = customMeasureScale({ paper, paperUnit, realText: customReal, display, precision, title: customTitle });
    else if (baseScale) scale = { ...baseScale, display, precision };
  }
  useFocusTrap(cardRef, true, { onEscape: onCancel });
  const submit = (e) => {
    e.preventDefault();
    if (!scale) return;
    if (markMode === 'edit' && editIndex >= 0) forgetCustomMeasureScale(editIndex);
    if (plusOn && scale.custom) rememberCustomMeasureScale(scale);
    onApply(scale, { allPages: allPages && pageCount > 1, setDefault: plusOn && setDefault, resetOwn: plusOn && resetOwn });
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
          aria-label={markMode === 'edit' ? 'Edit scale' : markMode ? 'Add scale' : 'Set page scale'}
          className="measure-scale__card"
          onSubmit={submit}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="measure-scale__head">
            <div style={{ minWidth: 0 }}>
              <div className="measure-scale__title">{markMode === 'edit' ? 'Edit scale' : markMode ? 'Add scale' : 'Set page scale'}</div>
              <div className="measure-scale__sub">
                {markMode ? 'For this measurement; kept under Custom scales' : (
                  <>
                    Page {pageNumber}
                    {currentScale ? ` · now ${currentScale.label}` : ' · no scale yet'}
                  </>
                )}
              </div>
            </div>
            <button type="button" onClick={onCancel} aria-label="Close" {...tip('Close')} className="hub-icon-btn dialog-close-touch-pad">
              <Icon name="close" size={13} />
            </button>
          </div>
          <div className="measure-scale__body">
            {calibrating ? (
              <>
                <label className="measure-scale__label" htmlFor="measure-real-length">
                  Real length of the line you drew
                  {entryOn && <span data-measure-paper-length="" style={{ color: 'var(--text-3)', fontWeight: 400 }}> ({paperLengthWords(lengthPt, ['m', 'cm', 'mm'].includes(unit))})</span>}
                </label>
                <input
                  id="measure-real-length"
                  autoFocus
                  data-autofocus
                  data-measure-real-length="true"
                  className="measure-scale__field"
                  type={entryOn ? 'text' : 'number'}
                  inputMode={entryOn ? 'text' : 'decimal'}
                  autoComplete="off"
                  min={entryOn ? undefined : '0'}
                  step={entryOn ? undefined : 'any'}
                  placeholder={entryOn ? (unit === 'ft' ? `e.g. 20' 6"` : '0') : '0'}
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
                {plusOn && !markMode && (
                  <>
                    <div className="measure-scale__label">Scale</div>
                    <div className="measure-scale__chips measure-scale__chips--units" role="radiogroup" onKeyDown={moveGroupFocus} aria-label="Scale kind" data-measure-scale-kind="true" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                      {chip('preset', 'Preset', !custom, () => setCustom(false), { 'data-measure-scale-kind-option': 'preset' })}
                      {chip('custom', 'Custom', custom, () => setCustom(true), { 'data-measure-scale-kind-option': 'custom' })}
                    </div>
                  </>
                )}
                {plusOn && !markMode && customs.length > 0 && (
                  <>
                    <div className="measure-scale__label">Custom scales</div>
                    <div className="measure-scale__chips measure-scale__chips--custom" role="radiogroup" onKeyDown={moveGroupFocus} aria-label="Custom scale" data-measure-custom-scales="true">
                      {customs.map((saved, i) => (
                        <span key={`${saved.label}-${i}`} className="measure-scale__custom-chip">
                          {chip(`custom-${i}`, saved.label, custom && customMeasureScaleIndex(customs, scale) === i, () => pickCustomScale(saved), { 'data-measure-custom-scale': i })}
                          <button
                            type="button"
                            className="measure-scale__custom-remove"
                            aria-label={`Remove ${saved.label}`}
                            data-measure-custom-scale-remove={i}
                            {...tip('Remove')}
                            onClick={() => setCustoms(forgetCustomMeasureScale(i))}
                          >
                            <Icon name="close" size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {plusOn && custom && (
                  <div className="measure-scale__custom" data-measure-custom-row="true" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                    <input
                      className="measure-scale__field"
                      aria-label="Drawing measurement"
                      data-measure-custom-paper="true"
                      inputMode="decimal"
                      value={paper}
                      onChange={(e) => setPaper(e.target.value)}
                      style={{ fontSize: 16, width: 64 }}
                    />
                    <span data-measure-custom-paper-unit="true" style={{ width: 72, flexShrink: 0 }}>
                      <ValueSelect menuClassName="measure-scale__menu" label="Drawing unit" value={paperUnit} onChange={setPaperUnit} options={PAPER_UNITS.map((u) => ({ value: u, label: u }))} />
                    </span>
                    <span aria-hidden="true">=</span>
                    <input
                      className="measure-scale__field"
                      aria-label="Real distance"
                      data-measure-custom-real="true"
                      inputMode={isFractionalDisplay(display) ? 'text' : 'decimal'}
                      placeholder={isFractionalDisplay(display) ? `8' 6"` : '10'}
                      value={customReal}
                      onChange={(e) => setCustomReal(e.target.value)}
                      style={{ fontSize: 16, flex: 1, minWidth: 0 }}
                    />
                    {!isFractionalDisplay(display) && <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{display}</span>}
                  </div>
                )}
                {plusOn && custom && (
                  <>
                    <label className="measure-scale__label" htmlFor="measure-custom-title">Title</label>
                    <input
                      id="measure-custom-title"
                      className="measure-scale__field"
                      data-measure-custom-title="true"
                      autoComplete="off"
                      maxLength={CUSTOM_SCALE_TITLE_MAX}
                      placeholder={customMeasureScale({ paper, paperUnit, realText: customReal, display, precision })?.label || 'Scale name'}
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      style={{ fontSize: 16 }}
                    />
                  </>
                )}
                {(!plusOn || !custom) && recent.length > 0 && (
                  <>
                    <div className="measure-scale__label">Recent</div>
                    <div className="measure-scale__chips" role="radiogroup" onKeyDown={moveGroupFocus} aria-label="Recent scale" data-measure-recent="true">
                      {recent.map((r, i) => chip(`recent-${i}`, r.label, recentPick === i, () => setRecentPick(i), { 'data-measure-recent-option': i }))}
                    </div>
                  </>
                )}
                {(!plusOn || !custom) && (<>
                <div className="measure-scale__label">Architectural</div>
                <div className="measure-scale__chips" role="radiogroup" onKeyDown={moveGroupFocus} aria-label="Architectural scale" data-measure-preset="true">
                  {IMPERIAL.map((p) => chip(p.id, p.label, recentPick == null && preset === p.id, () => { setPreset(p.id); setRecentPick(null); }, { 'data-measure-preset-option': p.id }))}
                </div>
                <div className="measure-scale__label">Ratio</div>
                <div className="measure-scale__chips" role="radiogroup" onKeyDown={moveGroupFocus} aria-label="Ratio scale">
                  {OTHER.map((p) => chip(p.id, p.label, recentPick == null && preset === p.id, () => { setPreset(p.id); setRecentPick(null); }, { 'data-measure-preset-option': p.id }))}
                </div>
                </>)}
                {!markMode && <button type="button" className="measure-scale__calibrate" data-measure-start-calibrate="true" onClick={onCalibrate}>
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
                </button>}
              </>
            )}
            {plusOn && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <div style={{ flex: 2, minWidth: 0 }} data-measure-display="true">
                  <span className="measure-scale__label" aria-hidden="true" style={{ display: 'block', marginTop: 0 }}>Units</span>
                  <ValueSelect menuClassName="measure-scale__menu" label="Units" value={display} onChange={pickDisplay} options={MEASURE_DISPLAYS.map((d) => ({ value: d.id, label: d.label }))} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }} data-measure-precision="true">
                  <span className="measure-scale__label" aria-hidden="true" style={{ display: 'block', marginTop: 0 }}>Precision</span>
                  <ValueSelect menuClassName="measure-scale__menu" label="Precision" value={precision} onChange={setPrecision} options={(isFractionalDisplay(display) ? FRACTION_PRECISIONS : DECIMAL_PRECISIONS).map((p) => ({ value: p.value, label: p.label }))} />
                </div>
              </div>
            )}
            {plusOn && !markMode && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: 'var(--text-2)' }}>
                <input type="checkbox" data-measure-apply-existing="true" checked={resetOwn} onChange={(e) => setResetOwn(e.target.checked)} />
                Apply to existing measurements (ones on their own scale too)
              </label>
            )}
            {plusOn && !markMode && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: 'var(--text-2)' }}>
                <input type="checkbox" data-measure-set-default="true" checked={setDefault} onChange={(e) => setSetDefault(e.target.checked)} />
                Set as default (new drawings start at this scale)
              </label>
            )}
            {pageCount > 1 && !markMode && (
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
            <button type="submit" className="hub-btn hub-btn--primary measure-scale__btn" data-measure-apply="true" disabled={!scale}>{markMode === 'edit' ? 'Save' : markMode ? 'Add' : 'Apply'}</button>
          </div>
        </form>
      </div>
    </MotionPresence>,
    document.body,
  );
}
