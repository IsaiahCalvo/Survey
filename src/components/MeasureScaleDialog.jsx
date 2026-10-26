import { useState } from 'react';
import { createPortal } from 'react-dom';
import DialogCard from './DialogCard.jsx';
import { C } from '../uiPalette';
import {
  MEASURE_PRESETS,
  MEASURE_UNITS,
  scaleFromCalibration,
  scaleFromPreset,
} from '../utils/measure/measureScale.js';

// Set page scale (Drawboard "Set page scale" / Calibrate). With a drawn
// calibration line (lengthPt) the user types its real length; without one
// they pick a preset or start "Calibrate" to draw a line.
export default function MeasureScaleDialog({ pageNumber, lengthPt = null, currentScale = null, onApply, onCalibrate, onCancel }) {
  const [real, setReal] = useState('');
  const [unit, setUnit] = useState(currentScale?.unit || 'ft');
  const [preset, setPreset] = useState('1/4');
  const calibrating = Number.isFinite(lengthPt) && lengthPt > 0;
  const scale = calibrating ? scaleFromCalibration(lengthPt, real, unit) : scaleFromPreset(preset);
  // 44px touch targets; 16px text so iOS Safari does not zoom on focus.
  const fieldStyle = { minHeight: 44, fontSize: 16, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-1)', color: 'var(--text-1)', fontFamily: 'inherit' };
  const submit = (e) => {
    e.preventDefault();
    if (scale) onApply(scale);
  };
  // The app's one dialog shell (DialogCard), as a form so Enter applies.
  // Keys stay inside it so a typed number never reaches the viewer's tool
  // shortcuts.
  return createPortal(
    <DialogCard
      as="form"
      title={`Set scale for page ${pageNumber}`}
      message={currentScale ? `Now: ${currentScale.label}` : null}
      ariaLabel="Set page scale"
      onClose={onCancel}
      width={340}
      zIndex={1000000}
      cardProps={{
        'data-measure-scale-dialog': 'true',
        onSubmit: submit,
        onKeyDown: (e) => { if (e.key === 'Escape') onCancel(); e.stopPropagation(); },
      }}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button type="submit" className="hub-btn hub-btn--primary dialog-touch-pad" data-measure-apply="true" disabled={!scale}>Apply</button>
        </>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: C.ink }}>
        {calibrating ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Real length of the line you drew
            <span style={{ display: 'flex', gap: 8 }}>
              <input
                autoFocus
                data-measure-real-length="true"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={real}
                onChange={(e) => setReal(e.target.value)}
                style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
              />
              <select data-measure-unit="true" value={unit} onChange={(e) => setUnit(e.target.value)} style={fieldStyle}>
                {Object.keys(MEASURE_UNITS).map((u) => <option key={u} value={u}>{MEASURE_UNITS[u].label}</option>)}
              </select>
            </span>
          </label>
        ) : (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              Preset
              <select data-measure-preset="true" value={preset} onChange={(e) => setPreset(e.target.value)} style={fieldStyle}>
                {MEASURE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <button type="button" className="hub-btn dialog-touch-pad" data-measure-start-calibrate="true" style={{ minHeight: 44, whiteSpace: 'normal', lineHeight: 1.3 }} onClick={onCalibrate}>
              Calibrate: draw a line over a known distance
            </button>
          </>
        )}
      </div>
    </DialogCard>,
    document.body,
  );
}
